/**
 * OYO DJ — The mind. The taste. The read.
 *
 * Not an algorithm. A character.
 *
 * A great DJ doesn't play what's popular. They read the room, feel the arc,
 * know when to hold the groove and when to surprise. This module is that mind.
 *
 * U × V × W in practice:
 *   U = engagement state (searching → warming → vibing → locked)
 *       derived from skip/complete/reaction ratio of last 5 tracks
 *   V = phase cultural focus + user's recent genre/cultural fingerprint
 *       filtered via cultural_tags, artist_tier, primary_genre from raw pool
 *   W = phase energy window (energyMin–energyMax) mapped to vibe columns
 *       via ENERGY_TO_VIBE — vibe_afro_heat, vibe_chill_vibes, etc.
 *
 * The conductor doesn't re-architect the existing hot/discovery pools.
 * It queries the full 324K video_intelligence DB via RPC and returns
 * candidates that fit the current moment. Falls back to existing pools
 * if filtering produces < MIN_CONDUCTOR_POOL tracks.
 *
 * Three special moments break the normal phase flow:
 *   bridge — a cultural pivot (different tags, same energy) every N tracks
 *   echo   — a hidden gem (low heat but high vibe quality) every N tracks
 *   trend  — optional VPS/Qwen subsession (stub ready, endpoint TBD)
 */

import type { Track } from '../../types';
import {
  type ArcType, type SessionPhase, type EmotionalArc, type PhaseConfig,
  selectArc, getArc, PHASE_ORDER, ENERGY_TO_VIBE,
} from './arc';
import {
  getConductorCandidates, rawEntryToTrack, type RawPoolEntry,
} from '../databaseDiscovery';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * How engaged the user is right now. Derived from last 5 track interactions.
 *
 * searching → new session or skip streak; DJ anchors on accessible, familiar
 * warming   → mixed signals; probing what lands
 * vibing    → completing tracks, no red flags; can take cultural risks
 * locked    → reactions + completions + zero skips; go deep, go real
 */
export type Engagement = 'searching' | 'warming' | 'vibing' | 'locked';

export interface UserState {
  recentSkips: number;
  recentCompletes: number;
  recentReactions: number;
  favoriteArtists: string[];
  recentGenres: string[];
  recentCulturalTags: string[];
}

export type DJMoveType = 'hot' | 'discovery' | 'bridge' | 'echo';

export interface VibeRules {
  cultural_tags?: string[];
  tiers?: ('A' | 'B' | 'C' | 'D')[];
  genres?: string[];
  vibe_columns?: { col: string; min: number }[];
}

export interface DJMove {
  type: DJMoveType;
  energyTarget: number;
  energyRange: [number, number];
  hotRatio: number;
  canonDepth: 'surface' | 'mixed' | 'deep';
  vibeRules: VibeRules;
  thought: string;
}

export interface DJSessionState {
  arc: ArcType;
  currentPhase: SessionPhase;
  trackCount: number;
  tracksInPhase: number;
  lastBridgeAt: number;
  lastEchoAt: number;
  engagement: Engagement;
  sessionStartedAt: number;
}

// ── Cultural bridge map ───────────────────────────────────────────────────
//
// When the DJ fires a bridge moment, it pivots the cultural_tags away from
// what's been playing into adjacent territory. The bridge should feel
// intentional — "oh this fits perfectly" — not random.
//
// Logic: what are the user's recentCulturalTags → pick from the pivot targets
// to create meaningful contrast while maintaining African cultural coherence.

const CULTURAL_PIVOTS: Record<string, string[]> = {
  celebration:  ['roots', 'tradition', 'healing'],
  festival:     ['liberation', 'pan-african', 'diaspora'],
  street:       ['roots', 'motherland', 'tradition'],
  anthem:       ['prayer', 'healing', 'roots'],
  roots:        ['anthem', 'celebration', 'festival'],
  liberation:   ['street', 'anthem', 'revolution'],
  healing:      ['celebration', 'homecoming', 'prayer'],
  diaspora:     ['motherland', 'roots', 'pan-african'],
  'pan-african':['diaspora', 'liberation', 'tradition'],
  motherland:   ['diaspora', 'roots', 'healing'],
  survival:     ['liberation', 'street', 'roots'],
  tradition:    ['celebration', 'roots', 'prayer'],
  prayer:       ['healing', 'tradition', 'roots'],
  homecoming:   ['roots', 'celebration', 'healing'],
  revolution:   ['liberation', 'anthem', 'survival'],
  bridge:       ['diaspora', 'pan-african', 'homecoming'],
};

const DEFAULT_BRIDGE_TAGS = ['roots', 'tradition', 'pan-african', 'diaspora'];

function getBridgeTags(recentTags: string[]): string[] {
  for (const tag of recentTags) {
    const pivots = CULTURAL_PIVOTS[tag];
    if (pivots?.length) return pivots;
  }
  return DEFAULT_BRIDGE_TAGS;
}

// ── Session state (singleton per tab) ────────────────────────────────────

let _session: DJSessionState | null = null;

// ── Engagement inference ──────────────────────────────────────────────────

function readRoom(userState: UserState): Engagement {
  const { recentSkips, recentCompletes, recentReactions } = userState;
  const total = recentSkips + recentCompletes + recentReactions;
  if (total === 0) return 'searching';

  const skipRate = recentSkips / Math.max(total, 1);
  const completeRate = recentCompletes / Math.max(total, 1);

  if (recentReactions >= 2 && skipRate < 0.1) return 'locked';
  if (completeRate >= 0.7 && skipRate < 0.2) return 'vibing';
  if (completeRate >= 0.4 || skipRate < 0.5) return 'warming';
  return 'searching';
}

// ── Phase management ──────────────────────────────────────────────────────

function shouldAdvancePhase(session: DJSessionState, phase: PhaseConfig, engagement: Engagement): boolean {
  const { tracksInPhase } = session;
  if (tracksInPhase < phase.minTracks) return false;
  if (tracksInPhase >= phase.maxTracks) return true;
  // Reactions + completions accelerate phase advance
  if (engagement === 'locked' && tracksInPhase >= phase.minTracks) return true;
  if (engagement === 'vibing' && tracksInPhase >= Math.ceil((phase.minTracks + phase.maxTracks) / 2)) return true;
  return false;
}

function advancePhase(session: DJSessionState): SessionPhase {
  const idx = PHASE_ORDER.indexOf(session.currentPhase);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return 'flow';
  return PHASE_ORDER[idx + 1];
}

// ── Move builders ─────────────────────────────────────────────────────────

function buildPhaseMove(
  phase: PhaseConfig,
  engagement: Engagement,
  userState: UserState,
  phaseType: SessionPhase,
): DJMove {
  // Engagement steers within the phase's energy window
  let energyTarget = Math.round((phase.energyMin + phase.energyMax) / 2);
  if (engagement === 'locked') energyTarget = phase.energyMax;
  if (engagement === 'searching') energyTarget = phase.energyMin;

  // Blend user's recent cultural tags with phase focus
  const culturalFocus = phase.culturalFocus?.length
    ? phase.culturalFocus
    : userState.recentCulturalTags.slice(0, 3);

  const type: DJMoveType = Math.random() < phase.hotRatio ? 'hot' : 'discovery';

  return {
    type,
    energyTarget,
    energyRange: [phase.energyMin, phase.energyMax],
    hotRatio: phase.hotRatio,
    canonDepth: phase.canonDepth,
    vibeRules: {
      cultural_tags: culturalFocus,
      tiers: phase.preferredTiers,
      genres: userState.recentGenres.slice(0, 2),
    },
    thought: `[${phaseType}:${engagement}] energy=${energyTarget} ratio=${phase.hotRatio.toFixed(2)}`,
  };
}

function buildBridgeMove(session: DJSessionState, userState: UserState, arc: EmotionalArc): DJMove {
  const currentPhase = getArc(session.arc).phases[session.currentPhase as keyof typeof arc.phases];
  const bridgeTags = getBridgeTags(userState.recentCulturalTags);
  const energyTarget = Math.round((currentPhase.energyMin + currentPhase.energyMax) / 2);

  return {
    type: 'bridge',
    energyTarget,
    energyRange: [currentPhase.energyMin, currentPhase.energyMax],
    hotRatio: 0.3, // bridges lean discovery — the point is the unexpected fit
    canonDepth: 'mixed',
    vibeRules: {
      cultural_tags: bridgeTags,
    },
    thought: `[bridge] pivot from [${userState.recentCulturalTags.join(',')}] → [${bridgeTags.join(',')}]`,
  };
}

function buildEchoMove(session: DJSessionState, arc: EmotionalArc): DJMove {
  // Echo = give shine to what was overlooked. Low heat, real quality.
  // Energy holds steady — the surprise is the track, not the energy shift.
  const currentPhase = getArc(session.arc).phases[session.currentPhase as keyof typeof arc.phases];
  const energyTarget = Math.round((currentPhase.energyMin + currentPhase.energyMax) / 2);

  return {
    type: 'echo',
    energyTarget,
    energyRange: [currentPhase.energyMin, currentPhase.energyMax],
    hotRatio: 0.0, // always from discovery / hidden pool
    canonDepth: 'deep',
    vibeRules: {
      // No tag filter — echo goes where the overlooked gems are
    },
    thought: `[echo] surface the overlooked at track ${session.trackCount}`,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Initialize a new DJ session. Call this on first play.
 * Reads the local hour to select the arc, sets phase to 'arrival'.
 */
export function initDJ(userState: UserState): DJSessionState {
  const hour = new Date().getHours();
  const arc = selectArc(hour);
  _session = {
    arc,
    currentPhase: 'arrival',
    trackCount: 0,
    tracksInPhase: 0,
    lastBridgeAt: 0,
    lastEchoAt: 0,
    engagement: readRoom(userState),
    sessionStartedAt: Date.now(),
  };
  return _session;
}

/**
 * Update the DJ's read of the room. Call this after each play/skip/complete
 * so the session state reflects the user's current engagement.
 */
export function updateEngagement(userState: UserState): void {
  if (!_session) return;
  _session.engagement = readRoom(userState);
}

/**
 * The main decision: what should the DJ play next?
 *
 * Returns a DJMove that specifies the type (hot/discovery/bridge/echo),
 * energy range, and vibe rules. Pass this to conductorFetch() to get tracks.
 */
export function getNextMove(userState: UserState): DJMove {
  if (!_session) initDJ(userState);
  const session = _session!;
  const arc = getArc(session.arc);

  // Update engagement read
  session.engagement = readRoom(userState);
  session.trackCount += 1;
  session.tracksInPhase += 1;

  // ── Special moments take priority ──────────────────────────────────────

  // Echo: surface a hidden gem
  const tracksSinceEcho = session.trackCount - session.lastEchoAt;
  if (session.trackCount > 5 && tracksSinceEcho >= arc.echoEvery) {
    session.lastEchoAt = session.trackCount;
    return buildEchoMove(session, arc);
  }

  // Bridge: cultural pivot — fires AFTER echo check so they don't collide
  const tracksSinceBridge = session.trackCount - session.lastBridgeAt;
  if (session.trackCount > 3 && tracksSinceBridge >= arc.bridgeEvery) {
    session.lastBridgeAt = session.trackCount;
    return buildBridgeMove(session, userState, arc);
  }

  // ── Phase advancement ──────────────────────────────────────────────────

  const currentConfig = arc.phases[session.currentPhase as keyof typeof arc.phases];
  if (currentConfig && shouldAdvancePhase(session, currentConfig, session.engagement)) {
    const next = advancePhase(session);
    if (next !== session.currentPhase) {
      session.currentPhase = next;
      session.tracksInPhase = 0;
    }
  }

  // ── Normal phase move ──────────────────────────────────────────────────

  const phaseConfig = arc.phases[session.currentPhase as keyof typeof arc.phases];
  if (!phaseConfig) {
    // Shouldn't happen — flow phase always exists. Safe fallback.
    return {
      type: 'hot',
      energyTarget: 3,
      energyRange: [2, 4],
      hotRatio: 0.6,
      canonDepth: 'mixed',
      vibeRules: {},
      thought: '[fallback] no phase config',
    };
  }

  return buildPhaseMove(phaseConfig, session.engagement, userState, session.currentPhase);
}

/** Read the current session state (for telemetry / debug). */
export function getSession(): DJSessionState | null {
  return _session;
}

/** Reset (e.g. user navigates away, foreground-resume after stale background). */
export function resetDJ(): void {
  _session = null;
  _lastTrendAt = 0;
  _trendTrackIds = [];
}

// ── Conductor fetch ───────────────────────────────────────────────────────

const MIN_CONDUCTOR_POOL = 5; // fall back to unfiltered pool below this

/**
 * Apply a DJMove's V×W filters to the in-memory cached pool and return
 * candidate tracks ready for playback.
 *
 * Filter cascade (each step falls back if the result is too thin):
 *   1. Exclude already-played IDs
 *   2. W filter: energy level via vibe column thresholds (ENERGY_TO_VIBE)
 *   3. V filter: cultural_tags intersection
 *   4. V filter: artist_tier
 *
 * Echo move uses a special low-heat / high-quality filter instead.
 */
export async function conductorFetch(
  move: DJMove,
  excludeIds: Set<string>,
  limit: number = 10,
): Promise<Track[]> {
  // Full 324K DB via RPC — no r2_cached gate. Player handles non-R2 tracks
  // via iframe + hotswap. excludeIds applied inside getConductorCandidates.
  let pool = await getConductorCandidates(Array.from(excludeIds), limit * 8);
  if (!pool.length) return [];

  // Step 2 (W): energy filter via vibe columns
  const vibeFilters = ENERGY_TO_VIBE[move.energyTarget] || [];
  if (vibeFilters.length) {
    const energyFiltered = pool.filter(e =>
      vibeFilters.some(({ col, min }) => {
        const score = (e as unknown as Record<string, unknown>)[col];
        return typeof score === 'number' && score >= min;
      }),
    );
    if (energyFiltered.length >= MIN_CONDUCTOR_POOL) pool = energyFiltered;
  }

  // Step 3 (V): cultural tags filter
  if (move.vibeRules.cultural_tags?.length) {
    const tags = new Set(move.vibeRules.cultural_tags);
    const tagFiltered = pool.filter(e =>
      (e.cultural_tags || []).some(t => tags.has(t)),
    );
    if (tagFiltered.length >= MIN_CONDUCTOR_POOL) pool = tagFiltered;
  }

  // Step 4 (V): tier filter
  if (move.vibeRules.tiers?.length) {
    const tiers = new Set<string>(move.vibeRules.tiers);
    const tierFiltered = pool.filter(e => tiers.has(e.artist_tier || 'B'));
    if (tierFiltered.length >= MIN_CONDUCTOR_POOL) pool = tierFiltered;
  }

  // Echo special filter: low heat (hidden gems), decent vibe quality
  if (move.type === 'echo') {
    const echoPool = pool.filter(e => {
      const heat = e.heat_score || 0;
      // Low play-derived heat but still has some vibe quality
      const hasVibeQuality = vibeFilters.some(({ col, min }) => {
        const score = (e as unknown as Record<string, unknown>)[col];
        return typeof score === 'number' && score >= min * 0.6;
      });
      return heat < 30 && (hasVibeQuality || vibeFilters.length === 0);
    });
    if (echoPool.length >= MIN_CONDUCTOR_POOL) pool = echoPool;
  }

  // Shuffle and slice
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit).map(rawEntryToTrack);
}

// ── Trend phase stub (VPS/Qwen — endpoint TBD) ───────────────────────────
//
// The plan: every ~30 min session, the DJ can call a small Qwen model hosted
// on the VPS to fetch "what's trending in Black African music right now."
// That model scans recent plays, social signals, and regional charts, then
// returns a ranked list of youtube_ids. The DJ plays a 3-5 track "trend
// phase" from that list, then returns to the arc.
//
// This breaks the "endless raw discovery loop" — the user gets a pulse on
// what's hot in the culture, curated by something that actually understands
// the culture.
//
// Wiring:
//   VITE_OYO_TREND_ENDPOINT=https://vps.yourdomain.com/oyo/trends
//   POST body: { arc, engagement, recentGenres, limit: 5 }
//   Response: { track_ids: string[], confidence: number }

const TREND_ENDPOINT = (import.meta as unknown as Record<string, unknown>).env
  ? (import.meta as { env: Record<string, string> }).env.VITE_OYO_TREND_ENDPOINT
  : undefined;

const TREND_INTERVAL_MS = 30 * 60 * 1000; // 30 min
let _lastTrendAt = 0;
let _trendTrackIds: string[] = [];

export async function maybeFetchTrends(userState: UserState): Promise<string[]> {
  if (!TREND_ENDPOINT) return [];
  if (Date.now() - _lastTrendAt < TREND_INTERVAL_MS) return _trendTrackIds;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return _trendTrackIds;
  try {
    const res = await fetch(TREND_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arc: _session?.arc || 'afternoon-groove',
        engagement: _session?.engagement || 'warming',
        recentGenres: userState.recentGenres.slice(0, 5),
        limit: 5,
      }),
    });
    if (!res.ok) return _trendTrackIds;
    const data = await res.json() as { track_ids?: string[] };
    _trendTrackIds = data.track_ids || [];
    _lastTrendAt = Date.now();
    return _trendTrackIds;
  } catch {
    return _trendTrackIds;
  }
}
