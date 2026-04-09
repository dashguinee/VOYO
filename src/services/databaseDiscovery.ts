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
import { getVibeEssence, getEssenceForQuery, type VibeEssence } from './essenceEngine';
import { searchMusic as searchYouTube } from './api';
import { TRACKS } from '../data/tracks';
import type { Track } from '../types';

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

export interface DiscoveryResult {
  hot: DiscoveryTrack[];
  discovery: DiscoveryTrack[];
  familiar: DiscoveryTrack[];
  essence: VibeEssence;
  source: 'database' | 'fallback';
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
 * Get user's played track IDs from localStorage
 */
function getPlayedTrackIds(): string[] {
  try {
    const stored = localStorage.getItem('voyo-player-state');
    if (!stored) return [];

    const state = JSON.parse(stored);
    const history = state?.state?.history || [];

    return history.map((t: any) => t.id).filter(Boolean);
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
export async function getHotTracks(limit: number = 30): Promise<Track[]> {
  if (!supabaseConfigured) {
    console.log('[Discovery] Supabase not configured, using fallback');
    return getFallbackTracks('hot', limit);
  }

  const essence = getVibeEssence();
  const playedIds = getPlayedTrackIds();

  try {
    const { data, error } = await getSupabase().rpc('get_hot_tracks', {
      p_afro_heat: essence.afro_heat,
      p_chill: essence.chill,
      p_party: essence.party,
      p_workout: essence.workout,
      p_late_night: essence.late_night,
      p_limit: limit,
      p_exclude_ids: [], // Don't exclude for hot - they want to see trending
    });

    if (error) {
      console.error('[Discovery] Hot tracks error:', error);
      return getFallbackTracks('hot', limit);
    }

    // Filter out non-music content (news, podcasts, etc.)
    const tracks = (data || []) as DiscoveryTrack[];
    const musicOnly = filterMusicOnly(tracks);
    console.log(`[Discovery] HOT: ${musicOnly.length} tracks from 324K database (filtered ${tracks.length - musicOnly.length} non-music)`);
    return musicOnly.map(toTrack);
  } catch (err) {
    console.error('[Discovery] Hot tracks exception:', err);
    return getFallbackTracks('hot', limit);
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
    console.log('[Discovery] Supabase not configured, using fallback');
    return getFallbackTracks('discovery', limit);
  }

  const essence = getVibeEssence();
  const playedIds = getPlayedTrackIds();

  try {
    const { data, error } = await getSupabase().rpc('get_discovery_tracks', {
      p_afro_heat: essence.afro_heat,
      p_chill: essence.chill,
      p_party: essence.party,
      p_workout: essence.workout,
      p_late_night: essence.late_night,
      p_dominant_vibe: essence.dominantVibes[0] || 'afro_heat',
      p_limit: limit,
      p_exclude_ids: [],
      p_played_ids: playedIds,
    });

    if (error) {
      console.error('[Discovery] Discovery tracks error:', error);
      return getFallbackTracks('discovery', limit);
    }

    // Filter out non-music content (news, podcasts, etc.)
    const tracks = (data || []) as DiscoveryTrack[];
    const musicOnly = filterMusicOnly(tracks);
    console.log(`[Discovery] DISCOVERY: ${musicOnly.length} tracks (filtered ${tracks.length - musicOnly.length} non-music)`);
    return musicOnly.map(toTrack);
  } catch (err) {
    console.error('[Discovery] Discovery tracks exception:', err);
    return getFallbackTracks('discovery', limit);
  }
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
    // Return from localStorage history directly
    try {
      const stored = localStorage.getItem('voyo-player-state');
      if (!stored) return [];

      const state = JSON.parse(stored);
      const history = state?.state?.history || [];

      return history.slice(0, limit);
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
          console.log(`[Discovery] DB: ${data.length} results for "${query}"`);
          return data.map(toTrack);
        }
        return [];
      } catch (err) {
        console.warn('[Discovery] DB search error:', err);
        return [];
      }
    })() : Promise.resolve([]),

    // YouTube search (fresh content, new releases)
    (async () => {
      try {
        const results = await searchYouTube(query, Math.ceil(limit / 2));
        if (results.length > 0) {
          console.log(`[Discovery] YT: ${results.length} results for "${query}"`);
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
        console.warn('[Discovery] YT search error:', err);
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

  console.log(`[Discovery] Merged: ${merged.length} total (${dbResults.length} DB + ${ytResults.length - (merged.length - dbResults.length)} new from YT)`);

  return merged.slice(0, limit);
}

// ============================================
// COMBINED FEED (with 70/30 ratio)
// ============================================

/**
 * Get complete discovery feed with proper fresh/familiar ratio
 */
export async function getDiscoveryFeed(
  hotLimit: number = 20,
  discoveryLimit: number = 20
): Promise<DiscoveryResult> {
  const essence = getVibeEssence();

  // Calculate familiar count based on ratio
  const totalFresh = hotLimit + discoveryLimit;
  const familiarCount = Math.round(totalFresh * (1 - essence.freshToFamiliarRatio));

  // Fetch all in parallel
  const [hot, discovery, familiar] = await Promise.all([
    getHotTracksRaw(hotLimit),
    getDiscoveryTracksRaw(discoveryLimit),
    getFamiliarTracksRaw(familiarCount),
  ]);

  return {
    hot,
    discovery,
    familiar,
    essence,
    source: supabaseConfigured ? 'database' : 'fallback',
  };
}

// Raw versions that return DiscoveryTrack (for internal use)
async function getHotTracksRaw(limit: number): Promise<DiscoveryTrack[]> {
  if (!supabaseConfigured) return [];

  const essence = getVibeEssence();

  try {
    const { data } = await getSupabase().rpc('get_hot_tracks', {
      p_afro_heat: essence.afro_heat,
      p_chill: essence.chill,
      p_party: essence.party,
      p_workout: essence.workout,
      p_late_night: essence.late_night,
      p_limit: limit,
      p_exclude_ids: [],
    });
    return data || [];
  } catch {
    return [];
  }
}

async function getDiscoveryTracksRaw(limit: number): Promise<DiscoveryTrack[]> {
  if (!supabaseConfigured) return [];

  const essence = getVibeEssence();
  const playedIds = getPlayedTrackIds();

  try {
    const { data } = await getSupabase().rpc('get_discovery_tracks', {
      p_afro_heat: essence.afro_heat,
      p_chill: essence.chill,
      p_party: essence.party,
      p_workout: essence.workout,
      p_late_night: essence.late_night,
      p_dominant_vibe: essence.dominantVibes[0] || 'afro_heat',
      p_limit: limit,
      p_exclude_ids: [],
      p_played_ids: playedIds,
    });
    return data || [];
  } catch {
    return [];
  }
}

async function getFamiliarTracksRaw(limit: number): Promise<DiscoveryTrack[]> {
  if (!supabaseConfigured || limit === 0) return [];

  const playedIds = getPlayedTrackIds();
  if (playedIds.length === 0) return [];

  try {
    const { data } = await getSupabase().rpc('get_familiar_tracks', {
      p_played_ids: playedIds.slice(0, 50),
      p_limit: limit,
    });
    return data || [];
  } catch {
    return [];
  }
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

// ============================================
// DEBUG
// ============================================

export function debugDiscovery(): void {
  const essence = getVibeEssence();
  const playedIds = getPlayedTrackIds();

  console.log('[VOYO Discovery Debug]', {
    essence: {
      dominantVibes: essence.dominantVibes,
      confidence: `${(essence.confidence * 100).toFixed(0)}%`,
      freshRatio: `${(essence.freshToFamiliarRatio * 100).toFixed(0)}%`,
    },
    playedTracks: playedIds.length,
    supabaseConfigured: supabaseConfigured,
  });
}
