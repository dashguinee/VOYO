/**
 * Database Discovery — primary track supply for the player pool.
 *
 * getHotTracks()      R2-cached tracks ordered by heat/vibe score
 * getDiscoveryTracks() Same pool, diversity-ranked (lower heat, broader genres)
 * searchTracks()       Supabase full-text → YouTube fallback
 *
 * All three return only R2-cached tracks (via video_intelligence.r2_cached).
 * essenceEngine provides the vibe fingerprint that biases ordering.
 * playerStore calls these on refreshRecommendations() to fill hotTracks/discoverTracks.
 */

import { supabase, isSupabaseConfigured as supabaseConfigured } from '../lib/supabase';
import type { VideoIntelligenceRow } from '../lib/supabase';
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

// Full-fidelity pool entry — all vibe columns preserved for conductor filtering.
// The conductor reads these directly to apply W (energy) and V (vibe) filters
// before converting winners to Track objects via toTrack().
export interface RawPoolEntry {
  youtube_id: string;
  title: string;
  artist: string | null;
  thumbnail_url: string | null;
  artist_tier: string | null;
  primary_genre: string | null;
  cultural_tags: string[] | null;
  heat_score: number | null;
  vibe_afro_heat: number | null;
  vibe_chill_vibes: number | null;
  vibe_party_mode: number | null;
  vibe_late_night: number | null;
  vibe_workout: number | null;
}

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
  //
  // Bug fix (v765): exclude already-played IDs so the hot pool actually
  // rotates as the user listens. Previously this called getCachedTracks
  // with no excludeIds, so refresh returned the SAME top-30 every call —
  // playerStore's history-exclusion then filtered all 30 out, the
  // available pool collapsed, and the user heard the same handful of
  // tracks on loop ("feels like session was empty and falling back to
  // seed"). Discovery already passed playedIds (line 281); hot was the
  // asymmetric exception.
  const playedIds = getPlayedTrackIds();
  const cached = await getCachedTracks(limit, 'heat_score', playedIds);
  const cachedMusic = filterMusicOnly(cached);
  void curateUncachedForPrefetch('hot', Math.max(limit, 20));
  devLog(`[Discovery] HOT cached-only: ${cachedMusic.length}/${limit} (excluded ${playedIds.length} played)`);
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
      devWarn('[Discovery] Familiar tracks error:', error);
      return [];
    }

    return (data || []).map(toTrack);
  } catch (err) {
    devWarn('[Discovery] Familiar tracks exception:', err);
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
// LAST RESORT POOL (500-track warm cache)
// ============================================

const LAST_RESORT_KEY = 'voyo-last-resort-v1';
const LAST_RESORT_TTL = 24 * 60 * 60 * 1000;

interface LastResortCache {
  tracks: Track[];
  at: number;
}

function viRowToTrack(row: VideoIntelligenceRow): Track {
  return {
    id: `vi_${row.youtube_id}`,
    trackId: row.youtube_id,
    title: row.title,
    artist: row.artist || 'Unknown Artist',
    album: '',
    coverUrl: row.thumbnail_url || `https://i.ytimg.com/vi/${row.youtube_id}/hqdefault.jpg`,
    duration: 0,
    tags: [],
    mood: 'afro',
    region: undefined,
    oyeScore: row.play_count ?? 0,
    createdAt: row.first_seen ?? new Date().toISOString(),
  };
}

export async function warmLastResortPool(): Promise<void> {
  if (!supabase) return;
  try {
    const raw = localStorage.getItem(LAST_RESORT_KEY);
    if (raw) {
      const cached: LastResortCache = JSON.parse(raw);
      if (Date.now() - cached.at < LAST_RESORT_TTL && cached.tracks.length >= 100) return;
    }
  } catch {}

  try {
    // Last-resort pool: no r2_cached filter — this is a fallback, not a gate.
    // r2Gate enforces cache status at play time; here we just want popular tracks.
    // cultural_tags NOT NULL ensures only classified African content enters —
    // unclassified or geo-contaminated rows have cultural_tags = null/[].
    const { data, error } = await supabase
      .from('video_intelligence')
      .select('youtube_id,title,artist,thumbnail_url,play_count,first_seen,cultural_tags')
      .not('cultural_tags', 'is', null)
      .order('play_count', { ascending: false })
      .limit(500);
    if (error || !data || data.length === 0) return;
    const tracks = (data as unknown as VideoIntelligenceRow[]).map(viRowToTrack);
    try {
      localStorage.setItem(LAST_RESORT_KEY, JSON.stringify({ tracks, at: Date.now() }));
    } catch { /* QuotaExceededError in iOS Safari private mode — pool stays cold */ }
    devLog(`[Discovery] Last-resort pool warmed: ${tracks.length} tracks`);
  } catch {}
}

function getLastResortPool(): Track[] {
  try {
    const raw = localStorage.getItem(LAST_RESORT_KEY);
    if (!raw) return [];
    const cached: LastResortCache = JSON.parse(raw);
    return cached.tracks || [];
  } catch {
    return [];
  }
}

// ============================================
// FALLBACK (when Supabase unavailable)
// ============================================

function getFallbackTracks(type: 'hot' | 'discovery', limit: number): Track[] {
  const pool = getLastResortPool();
  const source = pool.length >= limit ? pool : [...pool, ...TRACKS];
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

// ============================================
// CONDUCTOR POOL ACCESS
// ============================================

/**
 * Returns the in-memory cached pool with full vibe-column fidelity.
 * The DJ conductor uses this to apply W (energy) and V (cultural) filters
 * before picking tracks — no extra DB round-trips needed.
 *
 * Callers should warm the pool first via getHotTracks() if needed;
 * this just exposes what's already cached.
 */
export function getRawCachedPool(): RawPoolEntry[] {
  if (!_cachedPoolCache) return [];
  return _cachedPoolCache.rows as unknown as RawPoolEntry[];
}

/**
 * Synchronous O(1) check — is this YouTube ID in the R2-cached pool?
 * Eliminates the async r2HasTrack HEAD probe (up to 3s → 0ms) on track change.
 * Returns false when pool is cold — caller falls to iframe immediately.
 */
export function isTrackInR2Pool(ytId: string): boolean {
  if (!_cachedPoolCache) return false;
  return (_cachedPoolCache.rows as unknown as RawPoolEntry[]).some(r => r.youtube_id === ytId);
}

// ── Conductor full-DB pool ────────────────────────────────────────────────

let _conductorPoolCache: { rows: RawPoolEntry[]; at: number } | null = null;
const CONDUCTOR_POOL_TTL_MS = 120_000; // 2 min — longer than R2 pool, full DB changes slowly

/**
 * Fetch conductor candidates from the full 324K video_intelligence DB via
 * the get_discovery_tracks RPC. No r2_cached gate — the player handles
 * non-R2 tracks via iframe + hotswap. Returns RawPoolEntry[] with vibe
 * columns nulled (RPC does server-side vibe matching, in-memory cultural /
 * tier / echo filters still apply to the returned set).
 */
export async function getConductorCandidates(
  excludeIds: string[] = [],
  limit: number = 60,
): Promise<RawPoolEntry[]> {
  if (!supabaseConfigured) return [];

  const now = Date.now();
  if (!_conductorPoolCache || now - _conductorPoolCache.at > CONDUCTOR_POOL_TTL_MS) {
    try {
      const essence = getVibeEssence();
      const dominant = essence.dominantVibes[0] || 'afro_heat';
      const { data, error } = await getSupabase().rpc('get_discovery_tracks', {
        p_afro_heat: essence.afro_heat,
        p_chill: essence.chill,
        p_party: essence.party,
        p_workout: essence.workout,
        p_late_night: essence.late_night,
        p_dominant_vibe: dominant,
        p_limit: Math.max(limit, 100), // always fetch ≥100 for conductor diversity
        p_exclude_ids: [],
        p_played_ids: [],
      });
      if (error || !data) return [];
      _conductorPoolCache = {
        rows: (data as DiscoveryTrack[]).map(r => ({
          youtube_id: r.youtube_id,
          title: r.title,
          artist: r.artist,
          thumbnail_url: r.thumbnail_url ?? null,
          artist_tier: r.artist_tier ?? null,
          primary_genre: r.primary_genre ?? null,
          cultural_tags: r.cultural_tags ?? null,
          heat_score: r.heat_score ?? null,
          // vibe columns not returned by RPC — energy filter falls back to
          // unfiltered pool gracefully (MIN_CONDUCTOR_POOL guard in conductorFetch)
          vibe_afro_heat: null,
          vibe_chill_vibes: null,
          vibe_party_mode: null,
          vibe_late_night: null,
          vibe_workout: null,
        })),
        at: now,
      };
    } catch {
      return [];
    }
  }

  const excludeSet = new Set(excludeIds);
  return _conductorPoolCache.rows.filter(r => !excludeSet.has(r.youtube_id));
}

/** Convert a RawPoolEntry to Track for playback. */
export function rawEntryToTrack(entry: RawPoolEntry): Track {
  const thumbnail = entry.thumbnail_url || `https://i.ytimg.com/vi/${entry.youtube_id}/hqdefault.jpg`;
  return {
    id: entry.youtube_id,
    trackId: entry.youtube_id,
    title: entry.title || 'Unknown',
    artist: entry.artist || 'Unknown Artist',
    coverUrl: thumbnail,
    duration: 0,
    tags: entry.cultural_tags || [],
    oyeScore: Math.round((entry.heat_score || 0) * 10),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Fetch a single track by YouTube ID — used for deeplink boot.
 * Checks the in-memory R2 pool first (free), falls back to a Supabase point query.
 */
export async function fetchTrackById(youtubeId: string): Promise<Track | null> {
  // Fast path: pool already loaded in memory
  if (_cachedPoolCache) {
    const hit = (_cachedPoolCache.rows as unknown as RawPoolEntry[]).find(r => r.youtube_id === youtubeId);
    if (hit) return rawEntryToTrack(hit);
  }
  // Slow path: direct DB lookup
  if (!supabaseConfigured) return null;
  const { data, error } = await getSupabase()
    .from('video_intelligence')
    .select('youtube_id,title,artist,thumbnail_url,artist_tier,primary_genre,cultural_tags,heat_score,vibe_afro_heat,vibe_chill_vibes,vibe_party_mode,vibe_late_night,vibe_workout')
    .eq('youtube_id', youtubeId)
    .single();
  if (error || !data) return null;
  return toTrack(data as unknown as DiscoveryTrack);
}

