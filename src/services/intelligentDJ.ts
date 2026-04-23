/**
 * Intelligent DJ — Central DB flywheel.
 *
 * After DJ_TRIGGER_TRACKS plays, queries Central DB for vibe-matched
 * tracks and adds them to the live pool. Triggers a recommendation
 * refresh after each run. Falls back to YouTube search if Central DB
 * is thin. No AI calls.
 */

import { Track } from '../types';
import { searchMusic } from './api';
import { safeAddToPool } from './trackVerifier';
import { getTracksByMode, centralToTracks, MixBoardMode } from './centralDJ';
import { useReactionStore } from '../store/reactionStore';
import { useTrackPoolStore } from '../store/trackPoolStore';
import { devLog, devWarn } from '../utils/logger';

const DJ_TRIGGER_TRACKS = 4;
const DJ_MIN_INTERVAL = 90_000;
const MAX_VIDEOS_PER_RUN = 8;

// ── Types ─────────────────────────────────────────────────────────────────

interface TrackSnapshot { title: string; artist: string; wasLoved: boolean; wasSkipped: boolean; }
interface CategoryPreference { category: string; score: number; reactionCount: number; isHot: boolean; }
interface ListeningContext {
  recentTracks: TrackSnapshot[];
  favoriteArtists: string[];
  currentMood: string;
  timeOfDay: string;
  skipRate: number;
  lovedTracks: string[];
  categoryPreferences: CategoryPreference[];
  queuedTracks: string[];
  replayedTracks: string[];
  tasteShift: string;
}

// ── State ─────────────────────────────────────────────────────────────────

let listeningHistory: TrackSnapshot[] = [];
let lastDJRun = 0;
let djEnabled = true;

// ── Context building ──────────────────────────────────────────────────────

function inferMood(tracks: TrackSnapshot[]): string {
  if (tracks.length === 0) return 'exploring';
  if (tracks.filter(t => t.wasLoved).length > 2) return 'vibing';
  if (tracks.filter(t => t.wasSkipped).length > tracks.length / 2) return 'searching';
  return 'flowing';
}

function buildContext(): ListeningContext {
  const recent = listeningHistory.slice(-10);
  const artistCounts: Record<string, number> = {};
  const lovedTracks: string[] = [];
  recent.forEach(t => {
    artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
    if (t.wasLoved) lovedTracks.push(`${t.artist} - ${t.title}`);
  });
  const favoriteArtists = Object.entries(artistCounts).filter(([, c]) => c >= 2).map(([a]) => a);
  const skipRate = recent.length > 0 ? recent.filter(t => t.wasSkipped).length / recent.length : 0;
  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? 'late night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  let categoryPreferences: CategoryPreference[] = [];
  let queuedTracks: string[] = [];
  let replayedTracks: string[] = [];
  let tasteShift = 'stable';

  try {
    const reactionState = useReactionStore.getState();
    const prefs = reactionState.userCategoryPreferences;
    const pulse = reactionState.categoryPulse as Record<string, { isHot?: boolean }>;
    categoryPreferences = Object.values(prefs).map((p: any) => ({
      category: p.category, score: p.score, reactionCount: p.reactionCount,
      isHot: pulse[p.category]?.isHot || false,
    }));
    if (categoryPreferences.length > 0) {
      const top = [...categoryPreferences].sort((a, b) => b.score - a.score)[0];
      if (top.score > 70) tasteShift = `leaning towards ${top.category}`;
    }
  } catch { devWarn('[DJ] Could not load category preferences'); }

  try {
    const hotPool = useTrackPoolStore.getState().hotPool;
    queuedTracks = hotPool.filter(t => t.queuedCount >= 2).map(t => `${t.artist} - ${t.title}`);
    replayedTracks = hotPool.filter(t => t.playCount >= 2 && t.completionRate > 80).map(t => `${t.artist} - ${t.title}`);
  } catch { devWarn('[DJ] Could not load pool data'); }

  return {
    recentTracks: recent, favoriteArtists, currentMood: inferMood(recent),
    timeOfDay, skipRate, lovedTracks, categoryPreferences,
    queuedTracks, replayedTracks, tasteShift,
  };
}

function getDominantMode(context: ListeningContext): MixBoardMode {
  if (context.categoryPreferences.length > 0) {
    const top = [...context.categoryPreferences].sort((a, b) => b.score - a.score)[0].category as MixBoardMode;
    if (['afro-heat', 'chill-vibes', 'party-mode', 'late-night', 'workout'].includes(top)) return top;
  }
  if (context.currentMood === 'vibing') return 'afro-heat';
  if (context.currentMood === 'searching') return 'random-mixer';
  if (context.timeOfDay === 'late night') return 'late-night';
  if (context.timeOfDay === 'morning') return 'chill-vibes';
  // Rotate through neutral modes by minute to avoid monoculture
  const neutralModes: MixBoardMode[] = ['afro-heat', 'chill-vibes', 'late-night', 'random-mixer'];
  return neutralModes[Math.floor(Date.now() / 60_000) % neutralModes.length];
}

// ── Fallback: YouTube search ──────────────────────────────────────────────

async function fallbackToSearch(context: ListeningContext): Promise<number> {
  const query = context.favoriteArtists.length > 0
    ? `${context.favoriteArtists[0]} ${context.currentMood === 'vibing' ? 'hits' : 'songs'}`
    : 'afrobeats trending 2024';
  try {
    const results = await searchMusic(query, 10);
    const tracks: Track[] = results.map(r => ({
      id: r.voyoId, title: r.title, artist: r.artist, album: 'VOYO', trackId: r.voyoId,
      coverUrl: r.thumbnail, duration: r.duration, tags: ['fallback'],
      mood: 'afro' as const, region: 'NG', oyeScore: r.views || 0,
      createdAt: new Date().toISOString(),
    }));
    const CONCURRENCY = 5;
    let added = 0;
    for (let i = 0; i < tracks.length; i += CONCURRENCY) {
      const batch = tracks.slice(i, i + CONCURRENCY);
      const res = await Promise.all(batch.map(t => safeAddToPool(t, 'related').catch(() => false)));
      added += res.filter(Boolean).length;
    }
    return added;
  } catch { return 0; }
}

// ── Run ───────────────────────────────────────────────────────────────────

export async function runDJ(): Promise<number> {
  lastDJRun = Date.now();
  const context = buildContext();
  const dominantMode = getDominantMode(context);
  const centralTracks = await getTracksByMode(dominantMode, MAX_VIDEOS_PER_RUN);

  if (centralTracks.length >= MAX_VIDEOS_PER_RUN / 2) {
    const tracks = centralToTracks(centralTracks);
    const CONCURRENCY = 5;
    let addedCount = 0;
    for (let i = 0; i < tracks.length; i += CONCURRENCY) {
      const batch = tracks.slice(i, i + CONCURRENCY);
      const res = await Promise.all(batch.map(t => safeAddToPool(t, 'related').catch(() => false)));
      addedCount += res.filter(Boolean).length;
    }
    devLog(`[DJ] +${addedCount}/${tracks.length} from Central DB (${dominantMode})`);
    import('../store/playerStore').then(({ usePlayerStore }) => {
      usePlayerStore.getState().refreshRecommendations?.();
    }).catch(() => {});
    return addedCount;
  }

  return fallbackToSearch(context);
}

async function checkDJTrigger(): Promise<void> {
  if (!djEnabled) return;
  if (listeningHistory.length >= DJ_TRIGGER_TRACKS && Date.now() - lastDJRun >= DJ_MIN_INTERVAL) {
    await runDJ();
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export function recordPlay(track: Track, wasLoved = false, wasSkipped = false): void {
  listeningHistory.push({ title: track.title, artist: track.artist, wasLoved, wasSkipped });
  if (listeningHistory.length > 20) listeningHistory = listeningHistory.slice(-20);
  checkDJTrigger();
}

export async function forceDJ(): Promise<number> { return runDJ(); }
export function setDJEnabled(enabled: boolean): void { djEnabled = enabled; }
export function resetDJ(): void { listeningHistory = []; lastDJRun = 0; }
export function getDJStatus() {
  return { enabled: djEnabled, historyLength: listeningHistory.length, lastRun: lastDJRun, timeSinceLastRun: Date.now() - lastDJRun };
}

if (typeof window !== 'undefined') {
  (window as any).voyoDJ = { run: forceDJ, status: getDJStatus, reset: resetDJ };
}

export default { recordPlay, runDJ, forceDJ, getDJStatus, resetDJ, setDJEnabled };
