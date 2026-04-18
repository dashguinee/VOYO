/**
 * OYO Session Plan Engine
 *
 * Owns the HOT and DISCOVER track pools. Replaces random refreshRecommendations()
 * with a directed, signal-driven plan. Pure logic + Supabase queries — no Gemini.
 *
 * Public API:
 *   initPlan()              — call on session start
 *   onSignal(type, data?)   — skip | reaction | chat | search_play | completion
 *   getSuggestedDirections() — pre-computed [HOT label, DISCOVER label] for OYO UI
 *   getPlan()               — current plan state or null
 */

import { getHotTracks, getDiscoveryTracks } from './databaseDiscovery';
import { loadOyoState } from './oyoState';
import { getInsights } from './oyoDJ';
import { usePlayerStore } from '../store/playerStore';
import { devLog, devWarn } from '../utils/logger';
import type { Track } from '../types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type SignalType = 'skip' | 'reaction' | 'chat' | 'search_play' | 'completion';

export interface Signal {
  type: SignalType;
  data?: string;
  at: number;
}

export interface OyoPlan {
  direction: string;
  hotPool: Track[];
  discoverPool: Track[];
  builtAt: number;
  nextShiftAt: number;
  consecutiveCompletions: number;
  consecutiveSkips: number;
  sessionSignals: Signal[];
  suggestedDirections: [string, string];
}

type BuildTrigger =
  | 'init'
  | 'skip_pivot'
  | 'reaction_boost'
  | 'chat_pivot'
  | 'scheduled';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const SHIFT_INTERVAL_MS = 15 * 60 * 1000;      // 15 min default
const FLOW_DELAY_MS     = 10 * 60 * 1000;      // +10 min when in flow
const SEARCH_INTERVAL_MS =  5 * 60 * 1000;     // 5 min after search_play
const FLOW_THRESHOLD    = 3;                   // consecutiveCompletions to be "in flow"
const SKIP_PIVOT_THRESHOLD = 2;                // consecutiveSkips before micro-pivot

const DIRECTION_CYCLE: string[] = [
  'afro-heat',
  'chill-vibes',
  'party-mode',
  'late-night',
];

// ─────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────

let plan: OyoPlan | null = null;
let shiftTimer: ReturnType<typeof setTimeout> | null = null;

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export async function initPlan(): Promise<void> {
  devLog('[OyoPlan] Initialising session plan');
  await buildPlan('init');
}

export function onSignal(type: SignalType, data?: string): void {
  if (!plan) {
    devWarn('[OyoPlan] onSignal called before initPlan — ignoring');
    return;
  }

  const signal: Signal = { type, data, at: Date.now() };
  plan.sessionSignals.push(signal);
  devLog(`[OyoPlan] signal: ${type}`, data ?? '');

  switch (type) {
    case 'completion':
      plan.consecutiveCompletions += 1;
      plan.consecutiveSkips = 0;
      break;

    case 'skip':
      plan.consecutiveSkips += 1;
      plan.consecutiveCompletions = 0;
      if (plan.consecutiveSkips >= SKIP_PIVOT_THRESHOLD) {
        buildPlan('skip_pivot');
      }
      break;

    case 'reaction':
      plan.consecutiveCompletions = 0;
      plan.consecutiveSkips = 0;
      buildPlan('reaction_boost', data);
      break;

    case 'chat':
      plan.consecutiveCompletions = 0;
      plan.consecutiveSkips = 0;
      buildPlan('chat_pivot', data);
      break;

    case 'search_play':
      // Shorten next scheduled shift
      scheduleShift(SEARCH_INTERVAL_MS);
      break;
  }
}

export function getSuggestedDirections(): [string, string] {
  return plan?.suggestedDirections ?? ['More Afrobeats', 'Try Something New'];
}

export function getPlan(): OyoPlan | null {
  return plan;
}

// ─────────────────────────────────────────────────────────────
// Core build logic
// ─────────────────────────────────────────────────────────────

async function buildPlan(trigger: BuildTrigger, triggerData?: string): Promise<void> {
  devLog(`[OyoPlan] buildPlan trigger=${trigger}`, triggerData ?? '');

  // Preserve signal history and counters across rebuilds
  const prevSignals = plan?.sessionSignals ?? [];
  const prevCompletions = plan?.consecutiveCompletions ?? 0;
  const prevSkips = plan?.consecutiveSkips ?? 0;

  // Load OYO context + fetch tracks in parallel
  const [stateBundle, [hotRaw, discoverRaw]] = await Promise.all([
    loadOyoState().catch(() => null),
    Promise.all([getHotTracks(50), getDiscoveryTracks(50)]),
  ]);

  const oyoInsights = getInsights();
  const favoriteArtists = oyoInsights.favoriteArtists ?? [];
  const playedIds = new Set(stateBundle?.deck?.trackIds ?? []);

  // Boost: sort favorite artists first (stable, preserves relative order within groups)
  const boost = (tracks: Track[]): Track[] => {
    const favs = tracks.filter(t => favoriteArtists.includes(t.artist));
    const rest = tracks.filter(t => !favoriteArtists.includes(t.artist));
    return [...favs, ...rest];
  };

  const hotPool     = boost(hotRaw);
  const discoverPool = boost(discoverRaw);

  // Determine direction label
  const direction = resolveDirection(trigger, triggerData, plan?.direction, favoriteArtists);

  // Compute suggested directions from pool vibes
  const suggestedDirections = computeSuggestedDirections(hotPool, discoverPool, favoriteArtists);

  // Decide next shift timing
  const inFlow = prevCompletions >= FLOW_THRESHOLD;
  const shiftMs = inFlow ? SHIFT_INTERVAL_MS + FLOW_DELAY_MS : SHIFT_INTERVAL_MS;

  plan = {
    direction,
    hotPool,
    discoverPool,
    builtAt: Date.now(),
    nextShiftAt: Date.now() + shiftMs,
    consecutiveCompletions: prevCompletions,
    consecutiveSkips: prevSkips,
    sessionSignals: prevSignals,
    suggestedDirections,
  };

  // Push pools to player store
  usePlayerStore.setState({ hotTracks: hotPool, discoverTracks: discoverPool });

  devLog(`[OyoPlan] Built — direction="${direction}", hot=${hotPool.length}, discover=${discoverPool.length}, nextShift=${shiftMs / 1000}s, inFlow=${inFlow}`);

  scheduleShift(shiftMs);
}

// ─────────────────────────────────────────────────────────────
// Shift scheduling
// ─────────────────────────────────────────────────────────────

function scheduleShift(ms: number): void {
  if (shiftTimer) clearTimeout(shiftTimer);
  shiftTimer = setTimeout(() => {
    if (!plan) return;
    const inFlow = plan.consecutiveCompletions >= FLOW_THRESHOLD;
    if (inFlow) {
      devLog('[OyoPlan] In flow — delaying scheduled shift');
      scheduleShift(FLOW_DELAY_MS);
    } else {
      buildPlan('scheduled');
    }
  }, ms);
}

// ─────────────────────────────────────────────────────────────
// Direction resolution
// ─────────────────────────────────────────────────────────────

function resolveDirection(
  trigger: BuildTrigger,
  data: string | undefined,
  current: string | undefined,
  favoriteArtists: string[],
): string {
  switch (trigger) {
    case 'reaction_boost':
      return data ? `user-led: ${data}` : (favoriteArtists[0] ? `user-led: ${favoriteArtists[0]}` : 'reaction-boost');

    case 'chat_pivot':
      return data ? `chat: ${data.slice(0, 40)}` : 'chat-pivot';

    case 'skip_pivot': {
      // Cycle away from current direction
      const idx = DIRECTION_CYCLE.indexOf(current ?? '');
      const next = DIRECTION_CYCLE[(idx + 1) % DIRECTION_CYCLE.length];
      return next;
    }

    case 'init':
      return favoriteArtists.length > 0 ? `user-led: ${favoriteArtists[0]}` : 'afro-heat';

    case 'scheduled':
      return current ?? 'afro-heat';
  }
}

// ─────────────────────────────────────────────────────────────
// Suggested directions computation
// ─────────────────────────────────────────────────────────────

function computeSuggestedDirections(
  hotPool: Track[],
  discoverPool: Track[],
  favoriteArtists: string[],
): [string, string] {
  const dominantArtist = (pool: Track[]): string | null => {
    const counts: Record<string, number> = {};
    for (const t of pool) {
      counts[t.artist] = (counts[t.artist] ?? 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  };

  const dominantGenre = (pool: Track[]): string | null => {
    const counts: Record<string, number> = {};
    for (const t of pool) {
      for (const tag of t.tags ?? []) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  };

  const hotArtist  = dominantArtist(hotPool);
  const hotGenre   = dominantGenre(hotPool);
  const discArtist = dominantArtist(discoverPool.filter(t => !favoriteArtists.includes(t.artist)));
  const discGenre  = dominantGenre(discoverPool);

  const hotLabel  = hotArtist  ? `More ${hotArtist}`  : (hotGenre  ? `More ${capitalize(hotGenre)}`  : 'More Afrobeats');
  const discLabel = discArtist ? `Try ${discArtist}`  : (discGenre ? `Try ${capitalize(discGenre)}`  : 'Try Something New');

  return [hotLabel, discLabel];
}

// ─────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
