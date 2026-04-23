/**
 * VOYO Database Discovery Service
 *
 * VIBES FIRST discovery from 324K tracks
 *
 * - HOT: Trending NOW + matches your vibes
 * - DISCOVERY: Expand horizons + unique flavors
 * - SEARCH: Supabase first, YouTube fallback
 *
 * Uses essence engine to extract user's vibe fingerprint,
 * then queries Supabase for matching tracks.
 */

import { supabase, isSupabaseConfigured as supabaseConfigured } from '../lib/supabase';
import { getVibeEssence, type VibeEssence } from './essenceEngine';
import { searchMusic as searchYouTube } from './api';
import { TRACKS } from '../data/tracks';
import type { Track } from '../types';
import { devLog, devWarn } from '../utils/logger';

// Helper to get supabase client with null check (TypeScript guard)
function getSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  return supabase;
}

// ============================================
// TYPES
// ============================================

export interface DiscoveryTrack {
  youtube_id: string;
  title: string;
  artist: string;
  vibe_match_score: number;
  artist_tier: string | null;
  primary_genre: string | null;
  cultural_tags: string[] | null;
  thumbnail_url: string | null;
  discovery_reason?: string;
  heat_score?: number;
}

// ============================================
// HELPERS
// ============================================

// ============================================
// CONTENT FILTER (Block non-music)
// ============================================

const NON_MUSIC_KEYWORDS = [
  // News & Politics
  'news', 'live:', 'breaking', 'trump', 'biden', 'president', 'election',
  'politics', 'political', 'congress', 'senate', 'white house', 'capitol',
  'maga', 'democrat', 'republican', 'cnn', 'fox news', 'msnbc',
  // Non-music content
  'warning', 'alert', 'podcast', 'interview', 'speech', 'conference',
  'urgent', 'update:', 'reaction', 'drama', 'beef', 'diss',
  'full movie', 'documentary', 'lecture', 'sermon', 'preaching',
  'asmr', 'meditation guide', 'sleep sounds', 'white noise',
  // Clickbait
  'you wont believe', 'shocking', 'exposed', 'leaked', 'scandal',
];

/**
 * Check if a track is likely non-music content
 * Checks BOTH title and artist for better coverage
 */
function isNonMusic(title: string, artist?: string): boolean {
  const lowerTitle = title.toLowerCase();
  const lowerArtist = (artist || '').toLowerCase();
  const combined = `${lowerTitle} ${lowerArtist}`;
  return NON_MUSIC_KEYWORDS.some(keyword => combined.includes(keyword));
}

/**
 * Filter out non-music content from track list
 */
function filterMusicOnly<T extends { title: string; artist?: string }>(tracks: T[]): T[] {
  return tracks.filter(track => !isNonMusic(track.title, (track as any).artist));
}

/**
 * Convert database track to app Track format
 */
function toTrack(dbTrack: DiscoveryTrack): Track {
  const thumbnail = dbTrack.thumbnail_url || `https://i.ytimg.com/vi/${dbTrack.youtube_id}/hqdefault.jpg`;
  return {
    id: dbTrack.youtube_id,
    trackId: dbTrack.youtube_id,
    title: dbTrack.title,
    artist: dbTrack.artist || 'Unknown Artist',
    coverUrl: thumbnail,
    duration: 0,
    tags: dbTrack.cultural_tags || [],
    oyeScore: Math.round((dbTrack.vibe_match_score || 0) * 100),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Convert search result to Track format
 */
function searchResultToTrack(r: { voyoId: string; title: string; artist: string; thumbnail: string; duration: number; views: number }): Track {
  return {
    id: r.voyoId,
    trackId: r.voyoId,
    title: r.title,
    artist: r.artist,
    coverUrl: r.thumbnail,
    duration: r.duration,
    tags: [],
    oyeScore: 0,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get user's played track IDs from localStorage.
 *
 * NOTE: playerStore persists via a flat savePersistedState() write at key
 * 'voyo-player-state' — NOT a zustand-persist `{state, version}` wrapper.
 * History items carry `trackId` (string), not `id`. Reading the wrong shape
 * silently returns [] and kills history-exclusion in discovery + familiar.
 */
function getPlayedTrackIds(): string[] {
  try {
    const stored = localStorage.getItem('voyo-player-state');
    if (!stored) return [];

    const state = JSON.parse(stored);
    // Flat shape (current): state.history
    // Legacy/defensive: state.state.history (in case anything ever wraps it)
    const history = state?.history ?? state?.state?.history ?? [];
    if (!Array.isArray(history)) return [];

    return history
      .map((t: any) => t?.trackId ?? t?.id)
      .filter((v: unknown): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

// ============================================
// HOT TRACKS
// ============================================

/**
 * Get HOT tracks: Trending NOW + matches your vibes
 */
/**
 * R2-cached-only query. The home feed must show tracks that will play instantly
 * (every card = cached). Queries video_intelligence directly, filters on the
 * r2_cached flag, orders by the caller-picked heat/vibe signal.
 *
 * Returns [] if Supabase is down — callers fall back to the RPC path which
 * may return uncached tracks (iframe path), still functional, less silky.
 */
type OrderCol =
  | 'heat_score' | 'vibe_afro_heat' | 'vibe_chill_vibes'
  | 'vibe_party_mode' | 'vibe_late_night' | 'vibe_workout';

// In-memory cache of the cached-tracks pool. R2 coverage grows slowly (lanes
// add ~1 track per few minutes), so re-querying for every shelf refresh is
// wasteful — we fetch once per TTL and sort/slice in-memory per caller.
let _cachedPoolCache: { rows: (DiscoveryTrack & Record<string, unknown>)[]; at: number } | null = null;
const CACHED_POOL_TTL_MS = 60_000;

/**
 * R2-cached-only tracks, sorted by the caller's chosen signal.
 *
 * Implementation note: a server-side ORDER BY on video_intelligence (324k rows)
 * times out without a compound index on (r2_cached, <sort_col>). We can't
 * create that index from the client side, so we fetch the ~575 r2_cached rows
 * unsorted (fast, uses the partial index on r2_cached alone) and sort
 * in-memory. 575 * 7 bytes * 7 cols is tiny — JS sort is microseconds.
 */
async function getCachedTracks(
  limit: number,
  orderBy: OrderCol,
  excludeIds: string[] = [],
): Promise<DiscoveryTrack[]> {
  if (!supabaseConfigured) return [];

  const now = Date.now();
  if (!_cachedPoolCache || now - _cachedPoolCache.at > CACHED_POOL_TTL_MS) {
    try {
      const { data, error } = await getSupabase()
        .from('video_intelligence')
        .select('youtube_id,title,artist,thumbnail_url,artist_tier,primary_genre,cultural_tags,heat_score,vibe_afro_heat,vibe_chill_vibes,vibe_party_mode,vibe_late_night,vibe_workout')
        .eq('r2_cached', true)
        .not('youtube_id', 'is', null)
        .limit(1500); // headroom for growth
      if (error) { devWarn('[Discovery] cached pool fetch error:', error); return []; }
      _cachedPoolCache = { rows: (data || []) as unknown as (DiscoveryTrack & Record<string, unknown>)[], at: now };
    } catch (err) {
      devWarn('[Discovery] cached pool exception:', err);
      return [];
    }
  }

  const excludeSet = new Set(excludeIds);
  const filtered = _cachedPoolCache.rows.filter(r => !excludeSet.has(r.youtube_id));
  const sorted = filtered.slice().sort((a, b) => {
    const av = typeof a[orderBy] === 'number' ? (a[orderBy] as number) : -Infinity;
    const bv = typeof b[orderBy] === 'number' ? (b[orderBy] as number) : -Infinity;
    return bv - av;
  });
  return sorted.slice(0, limit).map(r => ({
    ...(r as unknown as DiscoveryTrack),
    vibe_match_score: (r.heat_score as number | undefined) ?? 0,
  }));
}

export async function getHotTracks(limit: number = 30): Promise<Track[]> {
  if (!supabaseConfigured) {
    devLog('[Discovery] Supabase not configured, using fallback');
    return getFallbackTracks('hot', limit);
  }

  // R2-cached-only. Every card the user sees must be instantly playable.
  // If the cached pool is thin, we return whatever we have and kick off a
  // background prefetch (RPC picks vibe-matched uncached candidates, pushes
  // them to voyo_upload_queue so they join the cached set next refresh).
  const cached = await getCachedTracks(limit, 'heat_score');
  const cachedMusic = filterMusicOnly(cached);
  void curateUncachedForPrefetch('hot', Math.max(limit, 20));
  devLog(`[Discovery] HOT cached-only: ${cachedMusic.length}/${limit}`);
  return cachedMusic.map(toTrack);
}

/**
 * Background curation: fetch vibe-matched candidates that are NOT yet cached
 * and push them into voyo_upload_queue at priority=5 so the lanes extract.
 * These candidates will appear as cards on the next refresh, not this one.
 */
async function curateUncachedForPrefetch(
  mode: 'hot' | 'discovery',
  limit: number,
): Promise<void> {
  if (!supabaseConfigured) return;
  const essence = getVibeEssence();
  try {
    const { data } = mode === 'hot'
      ? await getSupabase().rpc('get_hot_tracks', {
          p_afro_heat: essence.afro_heat, p_chill: essence.chill,
          p_party: essence.party, p_workout: essence.workout, p_late_night: essence.late_night,
          p_limit: limit, p_exclude_ids: [],
        })
      : await getSupabase().rpc('get_discovery_tracks', {
          p_afro_heat: essence.afro_heat, p_chill: essence.chill,
          p_party: essence.party, p_workout: essence.workout, p_late_night: essence.late_night,
          p_dominant_vibe: essence.dominantVibes[0] || 'afro_heat',
          p_limit: limit, p_exclude_ids: [], p_played_ids: getPlayedTrackIds(),
        });
    const candidates = ((data || []) as DiscoveryTrack[]).map(toTrack);
    if (!candidates.length) return;
    const { oyo } = await import('./oyo');
    await oyo.prefetch(candidates, 5);
    devLog(`[Discovery] queued ${candidates.length} ${mode} candidates for lane extraction`);
  } catch (err) {
    devWarn('[Discovery] curateUncachedForPrefetch error:', err);
  }
}

// ============================================
// DISCOVERY TRACKS
// ============================================

/**
 * Get DISCOVERY tracks: Expand horizons + unique flavors
 *
 * "You like afro, but you really like CHILL... try Congolese rumba?"
 */
export async function getDiscoveryTracks(limit: number = 30): Promise<Track[]> {
  if (!supabaseConfigured) {
    devLog('[Discovery] Supabase not configured, using fallback');
    return getFallbackTracks('discovery', limit);
  }

  // R2-cached-only, ranked by the user's dominant vibe signal. Uncached
  // vibe-matched candidates get queued in the background for next refresh.
  const essence = getVibeEssence();
  const playedIds = getPlayedTrackIds();
  const dominant = essence.dominantVibes[0] || 'afro_heat';
  const vibeCol: Record<string, Parameters<typeof getCachedTracks>[1]> = {
    afro_heat:   'vibe_afro_heat',
    chill:       'vibe_chill_vibes',
    party:       'vibe_party_mode',
    workout:     'vibe_workout',
    late_night:  'vibe_late_night',
  };
  const orderBy = vibeCol[dominant] || 'vibe_afro_heat';
  const cached = await getCachedTracks(limit, orderBy, playedIds);
  const cachedMusic = filterMusicOnly(cached);
  void curateUncachedForPrefetch('discovery', Math.max(limit, 20));
  devLog(`[Discovery] DISCOVERY cached-only: ${cachedMusic.length}/${limit} (ordered by ${orderBy})`);
  return cachedMusic.map(toTrack);
}

// ============================================
// FAMILIAR TRACKS (30% ratio)
// ============================================

/**
 * Get familiar tracks (previously played) for the 70/30 ratio
 */
export async function getFamiliarTracks(limit: number = 10): Promise<Track[]> {
  const playedIds = getPlayedTrackIds();

  if (playedIds.length === 0) {
    return [];
  }

  if (!supabaseConfigured) {
    // Return from localStorage history directly.
    // Uses the same flat persistence shape as getPlayedTrackIds: items have
    // trackId/title/artist/coverUrl (PersistedHistoryItem) — hydrate them into
    // Track shape so downstream consumers get a consistent object.
    try {
      const stored = localStorage.getItem('voyo-player-state');
      if (!stored) return [];

      const state = JSON.parse(stored);
      const history = state?.history ?? state?.state?.history ?? [];
      if (!Array.isArray(history)) return [];

      return history
        .slice(-limit)
        .reverse()
        .map((h: any): Track => ({
          id: h?.trackId ?? h?.id ?? '',
          trackId: h?.trackId ?? h?.id ?? '',
          title: h?.title ?? '',
          artist: h?.artist ?? '',
          coverUrl: h?.coverUrl ?? '',
          duration: h?.duration ?? 0,
          tags: [],
          oyeScore: 0,
          createdAt: h?.playedAt ?? new Date().toISOString(),
        }))
        .filter((t: Track) => t.trackId.length > 0);
    } catch {
      return [];
    }
  }

  try {
    const { data, error } = await getSupabase().rpc('get_familiar_tracks', {
      p_played_ids: playedIds.slice(0, 50), // Limit to recent 50
      p_limit: limit,
    });

    if (error) {
      console.error('[Discovery] Familiar tracks error:', error);
      return [];
    }

    return (data || []).map(toTrack);
  } catch (err) {
    console.error('[Discovery] Familiar tracks exception:', err);
    return [];
  }
}

// ============================================
// SEARCH
// ============================================

/**
 * Search tracks: Database + YouTube in parallel, merged results
 * DYNAMIC: Best of both worlds - 324K curated + fresh YouTube content
 */
export async function searchTracks(query: string, limit: number = 20): Promise<Track[]> {
  if (!query.trim()) return [];

  const essence = getVibeEssence();

  // Run both searches in parallel for speed
  const [dbResults, ytResults] = await Promise.all([
    // Database search (324K curated tracks)
    supabaseConfigured ? (async () => {
      try {
        const { data, error } = await getSupabase().rpc('search_tracks_by_vibe', {
          p_query: query,
          p_afro_heat: essence.afro_heat,
          p_chill: essence.chill,
          p_party: essence.party,
          p_workout: essence.workout,
          p_late_night: essence.late_night,
          p_limit: limit,
        });
        if (!error && data && data.length > 0) {
          devLog(`[Discovery] DB: ${data.length} results for "${query}"`);
          return data.map(toTrack);
        }
        return [];
      } catch (err) {
        devWarn('[Discovery] DB search error:', err);
        return [];
      }
    })() : Promise.resolve([]),

    // YouTube search (fresh content, new releases)
    (async () => {
      try {
        const results = await searchYouTube(query, Math.ceil(limit / 2));
        if (results.length > 0) {
          devLog(`[Discovery] YT: ${results.length} results for "${query}"`);
          return results.map(r => ({
            id: r.voyoId,
            trackId: r.voyoId,
            title: r.title,
            artist: r.artist,
            coverUrl: r.thumbnail,
            duration: r.duration,
            tags: ['youtube'],
            oyeScore: 0,
            createdAt: new Date().toISOString(),
          } as Track));
        }
        return [];
      } catch (err) {
        devWarn('[Discovery] YT search error:', err);
        return [];
      }
    })(),
  ]);

  // Merge: DB first (curated), then YouTube (fresh), deduplicate
  const seen = new Set<string>();
  const merged: Track[] = [];

  // Add DB results first (higher quality, curated)
  for (const track of dbResults) {
    if (!seen.has(track.id)) {
      seen.add(track.id);
      merged.push(track);
    }
  }

  // Add YouTube results (fresh content not in DB)
  for (const track of ytResults) {
    if (!seen.has(track.id)) {
      seen.add(track.id);
      merged.push(track);
    }
  }

  devLog(`[Discovery] Merged: ${merged.length} total (${dbResults.length} DB + ${ytResults.length - (merged.length - dbResults.length)} new from YT)`);

  return merged.slice(0, limit);
}

// ============================================
// FALLBACK (when Supabase unavailable)
// ============================================

function getFallbackTracks(type: 'hot' | 'discovery', limit: number): Track[] {
  // Use static seed tracks as fallback (no API calls)
  // Shuffle and return subset for variety
  const shuffled = [...TRACKS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

