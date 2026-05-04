/**
 * OYO pools — two canonical streams, every feed row is a filter.
 *
 * Historical context (preserved, not re-invented):
 *
 *   HOT = server RPC get_hot_tracks → scored by (like+view/1000) × vibe
 *         match against user's VibeEssence. Cached tracks only (r2Gate).
 *         Re-ranked locally by client behavior score with time-decayed
 *         skip penalties. Then freshnessScoreShuffle(sessionSeed) for fresh-feel.
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

// Freshness-score shuffle: generate 5 candidate orderings (each with a varied
// seed), score each by how well it separates same-artist tracks, return the
// best. This is the core of Spotify's anti-clustering technique — same-artist
// back-to-backs feel repetitive even when the tracks are different.
function freshnessScoreShuffle<T extends Track>(tracks: T[], seed: number): T[] {
  if (tracks.length <= 1) return tracks;
  const raw = 1_000_003;

  const makeOrdering = (s: number): T[] =>
    [...tracks].sort((a, b) => {
      const keyA = a.trackId || a.id || '';
      const keyB = b.trackId || b.id || '';
      const hashA = (((keyA.charCodeAt(0) || 0) * 31 + (keyA.charCodeAt(1) || 0)) * s % raw + raw) % raw;
      const hashB = (((keyB.charCodeAt(0) || 0) * 31 + (keyB.charCodeAt(1) || 0)) * s % raw + raw) % raw;
      return hashA - hashB;
    });

  const score = (arr: T[]): number => {
    let penalty = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].artist && arr[i].artist === arr[i - 1].artist) penalty += 3;
      if (i >= 2 && arr[i].artist && arr[i].artist === arr[i - 2].artist) penalty += 1;
    }
    return -penalty; // higher is better
  };

  // 5 candidates, prime-stepped seeds to maximise ordering diversity
  const candidates = [0, 7919, 15791, 23669, 31573].map(offset => makeOrdering((seed + offset) | 0));
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

// ── The two canonical streams ─────────────────────────────────────────────

/**
 * HOT pool — R2-cached, vibe-matched, behavior-reranked, session-shuffled.
 *
 * Architecture: Supabase is ALWAYS the primary source (video_intelligence,
 * r2_cached=true, African catalog). getCachedTracks() keeps a 60s in-memory
 * cache so repeated calls cost nothing after the first.
 *
 * The trackPoolStore.hotPool supplies a small personalisation supplement —
 * tracks the user has actively engaged (played or queued this session) get
 * prepended so they score high during re-rank. They never replace the
 * curated catalog; they only boost what the user already showed intent for.
 * Cap at 10 so one search spree can't crowd out the full catalog.
 */
export async function hot(): Promise<Track[]> {
  const now = Date.now();
  if (_hotCache && now - _hotCache.at < TTL_MS) return _hotCache.tracks;

  // Primary: curated catalog from Supabase (cached in memory, geo-neutral).
  const serverTracks = await getHotTracks(60);

  // Supplement: up to 10 tracks the user has actively played or queued.
  // These carry real engagement signal (playCount/queuedCount > 0) so they
  // belong at the front of the scoring pass. Deduped against server tracks.
  const serverIds = new Set(serverTracks.map(t => t.id || t.trackId));
  const localPool = useTrackPoolStore.getState().hotPool;
  const engaged = localPool
    ? (localPool as (Track & { playCount?: number; queuedCount?: number })[])
        .filter(t => (t.playCount ?? 0) > 0 || (t.queuedCount ?? 0) > 0)
        .filter(t => !serverIds.has(t.id || t.trackId))
        .slice(0, 10) as Track[]
    : [];

  const raw = [...engaged, ...serverTracks];

  const prefs = usePreferenceStore.getState().trackPreferences;
  // Re-rank locally: server vibe-match was first pass; behavior score adds
  // the personal layer (time-decayed skip penalty, completion rate, reactions).
  const scored = raw.map(t => ({
    track: t,
    score: calculateBehaviorScore(t, prefs) + (t.oyeScore || 0) * 0.0001,
  }));
  scored.sort((a, b) => b.score - a.score);
  const topBand = scored.map(s => s.track).slice(0, 60);
  const shuffled = freshnessScoreShuffle(topBand, _sessionSeed);

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
  const shuffled = freshnessScoreShuffle(topBand, _sessionSeed);

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
