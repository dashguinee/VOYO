/**
 * OYO Signal Engine — learns user taste from playback behavior.
 *
 * Signal layer only: records plays/skips/reactions into a local profile
 * and hydrates cross-session artist affinities from voyo_signals.
 * No AI calls, no announcements, no TTS.
 *
 * Key exports:
 *   getInsights()          → used by playerStore hot sort
 *   hydrateFromSignals()   → cross-session Supabase load
 *   onTrackPlay/Skip/Reaction/Complete → playback event hooks
 *   getProfile()           → read by OyoIsland for name display
 */

import { Track } from '../types';
import { devLog, devWarn } from '../utils/logger';
import { notifyMilestone, notifyInsight } from './oyoNotifications';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getUserHash } from '../utils/userHash';

// ── Types ─────────────────────────────────────────────────────────────────

export interface DJProfile {
  name: string;
  nickname: string;
  relationship: DJRelationship;
  createdAt: string;
  lastInteractionAt: string;
}

export interface DJRelationship {
  favoriteArtists: string[];
  dislikedArtists: string[];
  favoriteMoods: string[];
  peakListeningHours: number[];
  totalTracksShared: number;
  totalSessionsStarted: number;
  totalTimeListened: number;
  learnedPreferences: LearnedPreference[];
  milestones: DJMilestone[];
}

export interface LearnedPreference {
  type: 'like' | 'dislike' | 'neutral';
  subject: string;
  confidence: number;
  learnedFrom: string;
  learnedAt: string;
}

export interface DJMilestone {
  id: string;
  title: string;
  description: string;
  unlockedAt: string;
  celebrated: boolean;
}

// ── Default profile ───────────────────────────────────────────────────────

const DEFAULT_PROFILE: DJProfile = {
  name: 'OYO',
  nickname: 'fam',
  relationship: {
    favoriteArtists: [],
    dislikedArtists: [],
    favoriteMoods: [],
    peakListeningHours: [],
    totalTracksShared: 0,
    totalSessionsStarted: 0,
    totalTimeListened: 0,
    learnedPreferences: [],
    milestones: [],
  },
  createdAt: new Date().toISOString(),
  lastInteractionAt: new Date().toISOString(),
};

// ── State ─────────────────────────────────────────────────────────────────

let djProfile: DJProfile = { ...DEFAULT_PROFILE };
let recentTracks: Track[] = [];

// ── Persistence ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'voyo-oyo-profile';

// Idle-deferred save: batches rapid calls (play/skip/reaction) into one write.
let _saveScheduled = false;
function saveProfile(): void {
  if (_saveScheduled) return;
  _saveScheduled = true;
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
  const doSave = () => {
    _saveScheduled = false;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(djProfile)); }
    catch (e) { devWarn('[OYO] Failed to save profile:', e); }
  };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(doSave, { timeout: 5000 });
  } else {
    setTimeout(doSave, 500);
  }
}

function loadProfile(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) djProfile = { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
  } catch (e) { devWarn('[OYO] Failed to load profile:', e); }
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initOYO(): void {
  loadProfile();
  djProfile.relationship.totalSessionsStarted++;
  djProfile.lastInteractionAt = new Date().toISOString();
  saveProfile();
  hydrateFromSignals().catch(() => null);
  devLog(`[OYO] ${djProfile.name} ready`);
}

// ── Profile ───────────────────────────────────────────────────────────────

export function getProfile(): DJProfile { return { ...djProfile }; }
export function setDJName(name: string): void { djProfile.name = name; saveProfile(); }
export function setUserNickname(nickname: string): void { djProfile.nickname = nickname; saveProfile(); }
export function resetDJ(): void { djProfile = { ...DEFAULT_PROFILE, createdAt: new Date().toISOString() }; saveProfile(); }

// ── Signal learning ───────────────────────────────────────────────────────

function learnFromBehavior(behavior: {
  type: 'play' | 'skip' | 'reaction' | 'complete';
  track: Track;
  context?: Record<string, unknown>;
}): void {
  const { type, track, context } = behavior;
  const rel = djProfile.relationship;

  if (type === 'reaction') {
    if (!rel.favoriteArtists.includes(track.artist)) {
      rel.favoriteArtists.push(track.artist);
      if (rel.favoriteArtists.length > 20) rel.favoriteArtists = rel.favoriteArtists.slice(-20);
    }
  } else if (type === 'skip') {
    const skips = rel.learnedPreferences.filter(p => p.subject === track.artist && p.type === 'dislike');
    if (skips.length >= 3 && !rel.dislikedArtists.includes(track.artist)) {
      rel.dislikedArtists.push(track.artist);
      if (rel.dislikedArtists.length > 50) rel.dislikedArtists = rel.dislikedArtists.slice(-50);
    }
    const positionSec = context?.positionSec as number | undefined;
    if (positionSec !== undefined && positionSec >= 0) {
      rel.learnedPreferences.push({
        type: 'skip_timing', subject: track.trackId ?? track.id,
        detail: positionSec < 15 ? 'early' : positionSec < 60 ? 'mid' : 'late',
        positionSec, timestamp: Date.now(),
      } as any);
    }
    if (rel.learnedPreferences.length > 200) rel.learnedPreferences = rel.learnedPreferences.slice(-200);
  }

  const hour = new Date().getHours();
  if (!rel.peakListeningHours.includes(hour)) rel.peakListeningHours.push(hour);

  if (track.mood && type === 'complete') {
    rel.favoriteMoods.push(track.mood);
    if (rel.favoriteMoods.length > 30) rel.favoriteMoods = rel.favoriteMoods.slice(-30);
  }

  saveProfile();
}

// ── Milestones ────────────────────────────────────────────────────────────

function checkMilestones(): DJMilestone | null {
  const rel = djProfile.relationship;

  const DEFS = [
    { id: 'first-track', count: 1, title: 'First Vibe Together!', desc: () => `${djProfile.name} played your first track.` },
    { id: '10-tracks', count: 10, title: 'Getting to Know You', desc: () => `10 tracks in. ${djProfile.name} is learning your vibe!` },
    { id: '100-tracks', count: 100, title: 'Century Club', desc: () => `100 tracks! ${djProfile.name} knows your taste now.` },
    { id: 'first-hour', hours: 60, title: 'Hour of Vibes', desc: () => `An hour of vibes with ${djProfile.name}!` },
  ] as const;

  for (const def of DEFS) {
    if (rel.milestones.find(m => m.id === def.id)) continue;
    const triggered = 'count' in def ? rel.totalTracksShared === def.count : rel.totalTimeListened >= def.hours;
    if (!triggered) continue;
    const milestone: DJMilestone = {
      id: def.id, title: def.title, description: def.desc(),
      unlockedAt: new Date().toISOString(), celebrated: false,
    };
    rel.milestones.push(milestone);
    saveProfile();
    if ('hours' in def) notifyMilestone(Math.floor(rel.totalTimeListened / 60));
    return milestone;
  }

  // Rolling hourly milestones (2h+)
  const hours = Math.floor(rel.totalTimeListened / 60);
  if (hours >= 2 && !rel.milestones.find(m => m.id === `hour-${hours}`)) {
    const milestone: DJMilestone = {
      id: `hour-${hours}`, title: `${hours} Hours Deep`,
      description: `${hours} hours of vibes. ${djProfile.name} is impressed!`,
      unlockedAt: new Date().toISOString(), celebrated: false,
    };
    rel.milestones.push(milestone);
    saveProfile();
    notifyMilestone(hours);
    return milestone;
  }

  return null;
}

// ── Event hooks ───────────────────────────────────────────────────────────

export function onTrackPlay(track: Track): void {
  recentTracks.push(track);
  if (recentTracks.length > 15) recentTracks = recentTracks.slice(-15);
  djProfile.relationship.totalTracksShared++;
  djProfile.lastInteractionAt = new Date().toISOString();
  learnFromBehavior({ type: 'play', track });
  checkMilestones();
}

export function onTrackSkip(track: Track, positionSec?: number): void {
  learnFromBehavior({ type: 'skip', track, context: { positionSec } });
}

export function onTrackReaction(track: Track): void {
  learnFromBehavior({ type: 'reaction', track });
}

let _lastInsightMood: string | null = (() => {
  try { return localStorage.getItem('voyo-last-insight-mood') || null; } catch { return null; }
})();

export function onTrackComplete(track: Track, listenDuration: number): void {
  djProfile.relationship.totalTimeListened += listenDuration / 60;
  learnFromBehavior({ type: 'complete', track });
  checkMilestones();

  if (track.mood && track.mood !== _lastInsightMood) {
    const moods = djProfile.relationship.favoriteMoods;
    if (moods.length >= 3) {
      const recent = moods.slice(-5);
      const freq: Record<string, number> = {};
      for (const m of recent) { freq[m] = (freq[m] || 0) + 1; }
      const dominant = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      if (dominant && dominant[0] !== _lastInsightMood && dominant[1] >= 2) {
        _lastInsightMood = dominant[0];
        try { localStorage.setItem('voyo-last-insight-mood', dominant[0]); } catch {}
        notifyInsight(`Your vibe shifted to ${dominant[0]} tonight`);
      }
    }
  }

  saveProfile();
}

// ── Insights (read by playerStore hot sort) ───────────────────────────────

export function getInsights(): {
  favoriteArtists: string[];
  favoriteMoods: string[];
  peakHours: number[];
  totalTime: number;
  milestones: DJMilestone[];
} {
  return {
    favoriteArtists: djProfile.relationship.favoriteArtists,
    favoriteMoods: djProfile.relationship.favoriteMoods,
    peakHours: djProfile.relationship.peakListeningHours,
    totalTime: djProfile.relationship.totalTimeListened,
    milestones: djProfile.relationship.milestones,
  };
}

// ── Signal hydration (cross-session Supabase learning) ────────────────────

const SIGNAL_WEIGHTS: Record<string, number> = {
  react: 5, complete: 3, queue: 2, play: 1, skip: -2,
};

let hydrateDone = false;
let _lastHydrateFailureAt = 0;
const HYDRATE_RETRY_COOLDOWN_MS = 10_000;

export async function hydrateFromSignals(): Promise<void> {
  if (hydrateDone) return;
  if (!supabase || !isSupabaseConfigured) return;
  if (Date.now() - _lastHydrateFailureAt < HYDRATE_RETRY_COOLDOWN_MS) return;

  try {
    const userHash = getUserHash();
    if (!userHash) return;

    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: signalRows, error: sigErr } = await supabase
      .from('voyo_signals').select('track_id, action')
      .eq('user_hash', userHash).gt('created_at', since).limit(2000);

    if (sigErr) { devWarn('[OYO hydrate] signals query failed — will retry', sigErr); _lastHydrateFailureAt = Date.now(); return; }
    if (!signalRows) { _lastHydrateFailureAt = Date.now(); return; }
    if (signalRows.length === 0) { hydrateDone = true; return; }

    const trackScore = new Map<string, number>();
    for (const r of signalRows) {
      const w = SIGNAL_WEIGHTS[r.action] ?? 0;
      trackScore.set(r.track_id, (trackScore.get(r.track_id) || 0) + w);
    }

    const topTrackIds = [...trackScore.entries()]
      .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 200).map(([id]) => id);
    if (topTrackIds.length === 0) { hydrateDone = true; return; }

    const { data: meta, error: metaErr } = await supabase
      .from('video_intelligence').select('youtube_id, artist').in('youtube_id', topTrackIds.slice(0, 100));

    if (metaErr) { devWarn('[OYO hydrate] meta query failed — will retry', metaErr); _lastHydrateFailureAt = Date.now(); return; }
    if (!meta) { _lastHydrateFailureAt = Date.now(); return; }

    const artistScore = new Map<string, number>();
    for (const row of meta) {
      if (!row.artist) continue;
      artistScore.set(row.artist, (artistScore.get(row.artist) || 0) + (trackScore.get(row.youtube_id) || 0));
    }

    const topArtists = [...artistScore.entries()]
      .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([a]) => a);
    if (topArtists.length === 0) { hydrateDone = true; return; }

    // Merge hydrated top artists (sorted by score) with in-session reactions.
    // HEAD slice keeps highest-scored cross-session favorites first.
    const union = new Set<string>();
    for (const a of topArtists) union.add(a);
    for (const a of djProfile.relationship.favoriteArtists) union.add(a);
    djProfile.relationship.favoriteArtists = [...union].slice(0, 20);

    saveProfile();
    hydrateDone = true;
    devLog(`[OYO hydrate] merged ${topArtists.length} artists from ${signalRows.length} signals`);
  } catch (err) {
    devWarn('[OYO hydrate] failed — will retry', err);
    _lastHydrateFailureAt = Date.now();
  }
}

// ── Auto-init ─────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  initOYO();
}

export default {
  getProfile, setDJName, setUserNickname, resetDJ,
  onTrackPlay, onTrackSkip, onTrackReaction, onTrackComplete,
  getInsights, hydrateFromSignals,
};
