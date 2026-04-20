/**
 * OYO pools — two canonical streams, every feed row is a filter.
 *
 * Historical context (preserved, not re-invented):
 *
 *   HOT = server RPC get_hot_tracks → scored by (like+view/1000) × vibe
 *         match against user's VibeEssence. Cached tracks only (r2Gate).
 *         Re-ranked locally by client behavior score with time-decayed
 *         skip penalties. Then seededShuffle(sessionSeed) for fresh-feel.
 *
 *   DISCOVERY = server RPC get_discovery_tracks → vibe match + novelty
 *         bonus + tier bonus, returns discovery_reason. Cached only.
 *         Same client re-rank + rotation.
 *
 * Both fetched once per TTL (60s). Every row on the home feed is then a
 * pure filter function on the cached pool — no per-row RPC.
 */

import type { Track } from '../../types';
import { getHotTracks, getDiscoveryTracks } from '../databaseDiscovery';
import { usePreferenceStore } from '../../store/preferenceStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { calculateBehaviorScore } from '../personalization';

// ── TTL cache ─────────────────────────────────────────────────────────────

const TTL_MS = 60_000;

interface PoolCache {
  tracks: Track[];
  at: number;
  sessionSeed: number;
}

let _hotCache: PoolCache | null = null;
let _discoveryCache: PoolCache | null = null;

// sessionSeed is captured when the first pool is loaded, reused until the
// caches expire. That keeps the shuffle stable while the user is browsing
// the feed, fresh on reload. Matches the old HomeFeed behavior.
let _sessionSeed: number = Date.now();

function seededShuffle<T extends Track>(tracks: T[], seed: number): T[] {
  if (!tracks.length) return tracks;
  return [...tracks].sort((a, b) => {
    const keyA = a.trackId || a.id || '';
    const keyB = b.trackId || b.id || '';
    const hashA = ((keyA.charCodeAt(0) || 0) * 31 + (keyA.charCodeAt(1) || 0)) * seed % 1_000_003;
    const hashB = ((keyB.charCodeAt(0) || 0) * 31 + (keyB.charCodeAt(1) || 0)) * seed % 1_000_003;
    return hashA - hashB;
  });
}

// ── The two canonical streams ─────────────────────────────────────────────

/**
 * HOT pool — R2-cached, vibe-matched, behavior-reranked, session-shuffled.
 * All rows that surface "what the user wants right now" share this pool.
 *
 * Source preference:
 *   1. Local trackPoolStore.hotPool — already enriched with poolCurator
 *      tags ('west-african', 'classic', 'trending', 'amapiano', ...) so
 *      tag-filter rows work. Also has poolScore for local ranking.
 *   2. Fallback to server getHotTracks if local pool is thin (<20 tracks
 *      — first visit or after clearStalePool).
 */
export async function hot(): Promise<Track[]> {
  const now = Date.now();
  if (_hotCache && now - _hotCache.at < TTL_MS) return _hotCache.tracks;

  // Prefer local pool — has curator tags + poolScore + accumulates over time.
  const localPool = useTrackPoolStore.getState().hotPool;
  let raw: Track[] = [];
  if (localPool && localPool.length >= 20) {
    raw = localPool as Track[];
  } else {
    raw = await getHotTracks(60); // server fallback, first visit
  }

  const prefs = usePreferenceStore.getState().trackPreferences;
  // Re-rank locally: server vibe-match was first pass; behavior score adds
  // the personal layer (time-decayed skip penalty, completion rate, reactions).
  const scored = raw.map(t => ({
    track: t,
    score: calculateBehaviorScore(t, prefs) + (t.oyeScore || 0) * 0.0001,
  }));
  scored.sort((a, b) => b.score - a.score);
  const topBand = scored.map(s => s.track).slice(0, 60);
  const shuffled = seededShuffle(topBand, _sessionSeed);

  _hotCache = { tracks: shuffled, at: now, sessionSeed: _sessionSeed };
  return shuffled;
}

/**
 * DISCOVERY pool — R2-cached, vibe-adjacent, novelty-weighted, session-shuffled.
 * All "expand horizons" rows share this pool.
 */
export async function discovery(): Promise<Track[]> {
  const now = Date.now();
  if (_discoveryCache && now - _discoveryCache.at < TTL_MS) return _discoveryCache.tracks;

  const raw = await getDiscoveryTracks(60);
  const prefs = usePreferenceStore.getState().trackPreferences;
  const scored = raw.map(t => ({
    track: t,
    score: calculateBehaviorScore(t, prefs),
  }));
  scored.sort((a, b) => b.score - a.score);
  const topBand = scored.map(s => s.track).slice(0, 50);
  const shuffled = seededShuffle(topBand, _sessionSeed);

  _discoveryCache = { tracks: shuffled, at: now, sessionSeed: _sessionSeed };
  return shuffled;
}

/**
 * Pull-to-refresh: invalidate both caches and roll a new sessionSeed so the
 * next reads resurface different tracks.
 */
export function refreshPools(): void {
  _sessionSeed = Date.now();
  _hotCache = null;
  _discoveryCache = null;
}

// ── Filter combinators ────────────────────────────────────────────────────

/**
 * Tag filter — respects the poolCurator tag taxonomy:
 * 'west-african' | 'classic' | 'trending' | 'amapiano' | 'afrobeats' |
 * 'dancehall' | 'rnb' | 'love' | 'party'
 */
export function byTag(tracks: Track[], tag: string): Track[] {
  return tracks.filter(t => (t.tags || []).includes(tag));
}

/**
 * Artist name substring match (poolAware fallback pattern — same as the old
 * getArtistsYouLove helper used).
 */
export function byArtist(tracks: Track[], artistSubstring: string): Track[] {
  const needle = artistSubstring.toLowerCase();
  return tracks.filter(t =>
    typeof t.artist === 'string' && t.artist.toLowerCase().includes(needle),
  );
}

/**
 * Favorite artists — derived from OYO's insight layer (built up from reactions
 * and completions over time). Filters the pool to tracks by artists the user
 * has engaged with positively.
 */
export function byFavoriteArtists(tracks: Track[], favorites: string[]): Track[] {
  if (!favorites.length) return tracks;
  const set = new Set(favorites.map(a => a.toLowerCase()));
  return tracks.filter(t => set.has((t.artist || '').toLowerCase()));
}

/**
 * Recently played — subset of the pool whose ids appear in the user's history.
 * For the "Back in the Mood" row.
 */
export function recentlyPlayed(tracks: Track[], historyIds: Set<string>): Track[] {
  return tracks.filter(t => historyIds.has(t.id || t.trackId));
}

/**
 * Exclude — removes tracks whose id appears in the given set. Used by rows
 * that pad themselves (e.g. "Top 10" excludes what's already in hot slice).
 */
export function excludeIds(tracks: Track[], excludedIds: Set<string>): Track[] {
  return tracks.filter(t => !excludedIds.has(t.id) && !excludedIds.has(t.trackId));
}

/**
 * Newest first — date-sorted by createdAt for the "new releases" row.
 */
export function newest(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => {
    const dateA = new Date(a.createdAt || '2024-01-01').getTime();
    const dateB = new Date(b.createdAt || '2024-01-01').getTime();
    return dateB - dateA;
  });
}

/**
 * Take the first N — convenience so row bodies read naturally: `hot.topN(15)`.
 */
export function topN(tracks: Track[], n: number): Track[] {
  return tracks.slice(0, n);
}
