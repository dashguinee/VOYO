/**
 * useArtist - Artist Discovery Hook
 *
 * Aggregates artist data from:
 * 1. artist_master.json (static profile data)
 * 2. video_intelligence table (tracks with matched_artist)
 * 3. voyo_moments table (moments linked to artist)
 * 4. Fly.io search API (discover more from YouTube)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import artistMasterData from '../data/artist_master.json';

// ============================================
// TYPES
// ============================================

export interface ArtistProfile {
  canonical_name: string;
  normalized_name: string;
  tier: 'A' | 'B';
  country: string;
  region: string;
  primary_genre: string;
  era_active: string[];
  default_vibe_scores: Record<string, number>;
}

export interface ArtistTrack {
  youtube_id: string;
  title: string;
  artist: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  voyo_play_count: number;
  genres: string[];
  moods: string[];
}

export interface ArtistMoment {
  id: string;
  source_platform: string;
  source_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number;
  content_type: string;
  view_count: number;
  heat_score: number;
}

export interface UseArtistReturn {
  profile: ArtistProfile | null;
  tracks: ArtistTrack[];
  moments: ArtistMoment[];
  trackCount: number;
  momentCount: number;
  totalPlays: number;
  isLoading: boolean;
  error: string | null;
  // Discovery
  searchResults: ArtistTrack[];
  isSearching: boolean;
  discoverMore: () => Promise<void>;
}

// ============================================
// HELPERS
// ============================================

const VOYO_API = 'https://voyo-edge.dash-webtv.workers.dev';

// Type the imported JSON structure
interface ArtistMasterEntry {
  canonical_name: string;
  normalized_name: string;
  tier: string;
  country: string;
  region: string;
  primary_genre: string;
  era_active: string[];
  default_vibe_scores: Record<string, number>;
  [key: string]: unknown;
}

interface ArtistMasterJSON {
  artists: Record<string, ArtistMasterEntry>;
  version: string;
  [key: string]: unknown;
}

const masterJSON = artistMasterData as ArtistMasterJSON;

function normalizeArtistName(name: string): string {
  return name.toLowerCase().trim();
}

function lookupProfile(name: string): ArtistProfile | null {
  const normalized = normalizeArtistName(name);
  const entry = masterJSON.artists[normalized];
  if (!entry) return null;

  return {
    canonical_name: entry.canonical_name,
    normalized_name: entry.normalized_name,
    tier: entry.tier as 'A' | 'B',
    country: entry.country,
    region: entry.region,
    primary_genre: entry.primary_genre,
    era_active: entry.era_active,
    default_vibe_scores: entry.default_vibe_scores,
  };
}

// ============================================
// HOOK
// ============================================

export function useArtist(artistName: string): UseArtistReturn {
  const [tracks, setTracks] = useState<ArtistTrack[]>([]);
  const [moments, setMoments] = useState<ArtistMoment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ArtistTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Prevent stale closures in async callbacks
  const artistRef = useRef(artistName);
  artistRef.current = artistName;

  // Static profile from artist_master.json
  const profile = lookupProfile(artistName);

  // Fetch tracks from video_intelligence
  useEffect(() => {
    if (!artistName) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setTracks([]);
    setMoments([]);
    setSearchResults([]);

    async function fetchData() {
      try {
        // Parallel fetch: tracks + moments
        const [tracksResult, momentsResult] = await Promise.allSettled([
          fetchTracks(artistName),
          fetchMoments(artistName),
        ]);

        if (cancelled) return;

        if (tracksResult.status === 'fulfilled') {
          setTracks(tracksResult.value);
        } else {
          console.warn('[useArtist] Tracks fetch failed:', tracksResult.reason);
        }

        if (momentsResult.status === 'fulfilled') {
          setMoments(momentsResult.value);
        } else {
          console.warn('[useArtist] Moments fetch failed:', momentsResult.reason);
        }

        // Only set error if both failed
        if (tracksResult.status === 'rejected' && momentsResult.status === 'rejected') {
          setError('Failed to load artist data');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [artistName]);

  // Discover more tracks from Fly.io search API
  const discoverMore = useCallback(async () => {
    if (!artistRef.current || isSearching) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `${VOYO_API}/api/search?q=${encodeURIComponent(artistRef.current)}`
      );

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();

      // Map search results to ArtistTrack format
      const results: ArtistTrack[] = (data.items || data.results || []).map(
        (item: Record<string, unknown>) => ({
          youtube_id: (item.id || item.youtube_id || item.videoId || '') as string,
          title: (item.title || '') as string,
          artist: (item.artist || item.uploaderName || item.channel || artistRef.current) as string | null,
          thumbnail_url: (item.thumbnail || item.thumbnail_url || item.thumbnailUrl || null) as string | null,
          duration_seconds: typeof item.duration === 'number'
            ? item.duration
            : typeof item.duration_seconds === 'number'
              ? item.duration_seconds
              : null,
          voyo_play_count: 0,
          genres: [] as string[],
          moods: [] as string[],
        })
      );

      setSearchResults(results);
    } catch (err) {
      console.error('[useArtist] Discover more failed:', err);
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [isSearching]);

  // Aggregated stats
  const trackCount = tracks.length;
  const momentCount = moments.length;
  const totalPlays = tracks.reduce((sum, t) => sum + (t.voyo_play_count || 0), 0);

  return {
    profile,
    tracks,
    moments,
    trackCount,
    momentCount,
    totalPlays,
    isLoading,
    error,
    searchResults,
    isSearching,
    discoverMore,
  };
}

// ============================================
// SUPABASE QUERIES
// ============================================

async function fetchTracks(artistName: string): Promise<ArtistTrack[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('video_intelligence')
    .select('youtube_id, title, artist, thumbnail_url, duration_seconds, voyo_play_count, genres, moods')
    .eq('matched_artist', artistName.toLowerCase())
    .order('voyo_play_count', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[useArtist] fetchTracks error:', error.message);
    throw error;
  }

  return (data || []).map((row) => ({
    youtube_id: row.youtube_id,
    title: row.title || '',
    artist: row.artist || null,
    thumbnail_url: row.thumbnail_url || null,
    duration_seconds: row.duration_seconds || null,
    voyo_play_count: row.voyo_play_count || 0,
    genres: row.genres || [],
    moods: row.moods || [],
  }));
}

async function fetchMoments(artistName: string): Promise<ArtistMoment[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('voyo_moments')
    .select('id, source_platform, source_id, title, thumbnail_url, duration_seconds, content_type, view_count, heat_score')
    .eq('parent_track_artist', artistName.toLowerCase())
    .order('heat_score', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[useArtist] fetchMoments error:', error.message);
    throw error;
  }

  return (data || []).map((row) => ({
    id: row.id,
    source_platform: row.source_platform || '',
    source_id: row.source_id || '',
    title: row.title || '',
    thumbnail_url: row.thumbnail_url || null,
    duration_seconds: row.duration_seconds || 0,
    content_type: row.content_type || '',
    view_count: row.view_count || 0,
    heat_score: row.heat_score || 0,
  }));
}

export default useArtist;
