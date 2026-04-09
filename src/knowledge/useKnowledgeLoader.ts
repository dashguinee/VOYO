/**
 * VOYO Knowledge Loader Hook
 *
 * Loads canonized track data into KnowledgeStore from JSON.
 * Supports both static import and dynamic fetching.
 */

import { useCallback, useState } from 'react';
import { useKnowledgeStore, TrackKnowledge, ArtistKnowledge } from './KnowledgeStore';
import {
  ArtistTier,
  CanonLevel,
  CulturalTag,
  AestheticTag,
  ContentType,
  MusicalEra,
  PrimaryMood,
  EnergyLevel,
  FeelingTag,
  AfricanRegion,
  AfricanGenre,
} from './MoodTags';

// ============================================
// TYPES
// ============================================

interface CanonizedTrack {
  id: string;
  title: string;
  artist: string;
  channel: string;
  tier: string;
  canon_level: string;
  content_type: string;
  view_count: number;
  view_percentile: number;
  cultural_significance: {
    historical: number;
    social: number;
    diasporic: number;
    preservational: number;
    overall: number;
  };
  aesthetic_merit: {
    innovation: number;
    craft: number;
    influence: number;
    overall: number;
  };
  accessibility: {
    mainstream: number;
    specialist: number;
    educational: number;
  };
  release_year: number | null;
  era: string;
  timelessness: number;
  cultural_tags: string[];
  aesthetic_tags: string[];
  confidence: number;
  classified_by: string;
  classified_at: string;
  is_echo: boolean;
}

interface LoaderState {
  isLoading: boolean;
  progress: number;
  total: number;
  loaded: number;
  error: string | null;
}

// ============================================
// INFERENCE HELPERS
// ============================================

function inferMood(track: CanonizedTrack): PrimaryMood {
  const tags = track.cultural_tags;

  if (tags.includes('spiritual') || tags.includes('prayer')) {
    return 'spiritual';
  }
  if (tags.includes('revolution') || tags.includes('protest')) {
    return 'aggressive';
  }
  if (tags.includes('wedding') || tags.includes('celebration') || tags.includes('festival')) {
    return 'party';
  }
  if (tags.includes('homecoming') || tags.includes('tradition')) {
    return 'nostalgic';
  }
  if (tags.includes('healing')) {
    return 'peaceful';
  }

  // Default based on view percentile
  if (track.view_percentile > 90) {
    return 'energetic';
  }

  return 'energetic';
}

function inferEnergy(track: CanonizedTrack): EnergyLevel {
  const contentType = track.content_type;
  const tags = track.cultural_tags;

  if (contentType === 'acoustic' || contentType === 'slowed') {
    return 2;
  }
  if (contentType === 'dj_mix' || contentType === 'live') {
    return 5;
  }
  if (tags.includes('spiritual') || tags.includes('healing') || tags.includes('prayer')) {
    return 2;
  }
  if (tags.includes('party') || tags.includes('festival') || tags.includes('celebration')) {
    return 5;
  }

  return 4; // Default high energy
}

function inferFeelings(track: CanonizedTrack): FeelingTag[] {
  const feelings: FeelingTag[] = [];
  const tags = track.cultural_tags;

  if (track.tier === 'A' && track.view_percentile > 80) {
    feelings.push('fire', 'lit');
  }
  if (tags.includes('celebration') || tags.includes('party')) {
    feelings.push('celebration', 'vibing');
  }
  if (tags.includes('spiritual')) {
    feelings.push('grateful', 'blessed');
  }
  if (track.is_echo) {
    feelings.push('classic', 'timeless');
  }

  return feelings.length > 0 ? feelings : ['vibing'];
}

function inferRegion(artist: string): AfricanRegion | undefined {
  const lowerArtist = artist.toLowerCase();

  // Nigerian
  if (['burna', 'wizkid', 'davido', 'rema', 'tems', 'asake', 'fela', 'olamide'].some(n => lowerArtist.includes(n))) {
    return 'west-africa';
  }
  // South African
  if (['black coffee', 'maphorisa', 'kabza', 'uncle waffles', 'tyla'].some(n => lowerArtist.includes(n))) {
    return 'south-africa';
  }
  // East African
  if (['diamond', 'sauti sol', 'harmonize'].some(n => lowerArtist.includes(n))) {
    return 'east-africa';
  }
  // Congolese
  if (['fally', 'koffi', 'papa wemba'].some(n => lowerArtist.includes(n))) {
    return 'central-africa';
  }
  // Francophone
  if (['youssou', 'salif', 'magic system'].some(n => lowerArtist.includes(n))) {
    return 'francophone';
  }

  return undefined;
}

function inferGenre(artist: string, contentType: string): AfricanGenre | undefined {
  const lowerArtist = artist.toLowerCase();

  if (['black coffee', 'maphorisa', 'kabza', 'uncle waffles'].some(n => lowerArtist.includes(n))) {
    return 'amapiano';
  }
  if (['burna', 'wizkid', 'davido', 'rema', 'asake'].some(n => lowerArtist.includes(n))) {
    return 'afrobeats';
  }
  if (['fela', 'femi kuti', 'seun kuti'].some(n => lowerArtist.includes(n))) {
    return 'afro-fusion';
  }
  if (['fally', 'koffi', 'papa wemba'].some(n => lowerArtist.includes(n))) {
    return 'rumba';
  }
  if (contentType === 'dj_mix') {
    return 'afro-house';
  }

  return 'afrobeats'; // Default
}

function generateArtistId(artistName: string): string {
  return artistName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

// ============================================
// CONVERSION
// ============================================

function convertToTrackKnowledge(track: CanonizedTrack): TrackKnowledge {
  const now = Date.now();

  return {
    id: track.id,
    title: track.title,
    artistId: generateArtistId(track.artist),
    artistName: track.artist,
    primaryMood: inferMood(track),
    feelings: inferFeelings(track),
    energy: inferEnergy(track),
    region: inferRegion(track.artist),
    genre: inferGenre(track.artist, track.content_type),
    releaseYear: track.release_year || undefined,
    isClassic: track.timelessness > 3,
    isTrending: track.view_percentile > 95,
    discoveredAt: now,
    classifiedAt: new Date(track.classified_at).getTime() || now,
    confidence: track.confidence,
    canonLevel: track.canon_level as CanonLevel,
    culturalTags: track.cultural_tags as CulturalTag[],
    isEcho: track.is_echo,
    echoReason: track.is_echo ? 'Hidden gem deserving recognition' : undefined,
    contentType: track.content_type as ContentType,
    era: track.era as MusicalEra,
    aestheticTags: track.aesthetic_tags as AestheticTag[],
    viewCount: track.view_count,
    viewPercentile: track.view_percentile,
    classifiedBy: track.classified_by as 'pattern' | 'llm' | 'hybrid' | 'human',
  };
}

// ============================================
// HOOK
// ============================================

export function useKnowledgeLoader() {
  const [state, setState] = useState<LoaderState>({
    isLoading: false,
    progress: 0,
    total: 0,
    loaded: 0,
    error: null,
  });

  const addTrack = useKnowledgeStore(s => s.addTrack);
  const addArtist = useKnowledgeStore(s => s.addArtist);
  const getStats = useKnowledgeStore(s => s.getStats);
  const clear = useKnowledgeStore(s => s.clear);

  const loadFromUrl = useCallback(async (url: string) => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const data = await response.json();
      const tracks: CanonizedTrack[] = data.tracks || [];

      setState(s => ({ ...s, total: tracks.length }));

      // Process in batches to avoid blocking UI
      const batchSize = 100;
      const artistsMap = new Map<string, ArtistKnowledge>();

      for (let i = 0; i < tracks.length; i += batchSize) {
        const batch = tracks.slice(i, i + batchSize);

        for (const track of batch) {
          const converted = convertToTrackKnowledge(track);
          addTrack(converted);

          // Track artist data
          const artistId = converted.artistId;
          if (!artistsMap.has(artistId)) {
            artistsMap.set(artistId, {
              id: artistId,
              name: track.artist,
              normalizedName: artistId,
              primaryMoods: [converted.primaryMood],
              feelings: converted.feelings,
              avgEnergy: converted.energy,
              regions: converted.region ? [converted.region] : [],
              genres: converted.genre ? [converted.genre] : [],
              languages: [],
              similarArtists: [],
              trackCount: 1,
              discoveredAt: Date.now(),
              lastUpdated: Date.now(),
              popularity: track.view_percentile,
              verified: track.tier === 'A',
              tier: track.tier as ArtistTier,
              culturalTags: track.cultural_tags as CulturalTag[],
              aestheticTags: track.aesthetic_tags as AestheticTag[],
            });
          } else {
            const artist = artistsMap.get(artistId)!;
            artist.trackCount++;
          }
        }

        setState(s => ({
          ...s,
          loaded: Math.min(i + batchSize, tracks.length),
          progress: Math.round(((i + batchSize) / tracks.length) * 100),
        }));

        // Yield to event loop
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // Add artists
      for (const artist of artistsMap.values()) {
        addArtist(artist);
      }

      setState(s => ({
        ...s,
        isLoading: false,
        loaded: tracks.length,
        progress: 100,
      }));

      return { success: true, stats: getStats() };
    } catch (error) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
      return { success: false, error };
    }
  }, [addTrack, addArtist, getStats]);

  const loadFromJson = useCallback(async (data: { tracks: CanonizedTrack[] }) => {
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const tracks = data.tracks || [];
      setState(s => ({ ...s, total: tracks.length }));

      const batchSize = 100;
      const artistsMap = new Map<string, ArtistKnowledge>();

      for (let i = 0; i < tracks.length; i += batchSize) {
        const batch = tracks.slice(i, i + batchSize);

        for (const track of batch) {
          const converted = convertToTrackKnowledge(track);
          addTrack(converted);

          const artistId = converted.artistId;
          if (!artistsMap.has(artistId)) {
            artistsMap.set(artistId, {
              id: artistId,
              name: track.artist,
              normalizedName: artistId,
              primaryMoods: [converted.primaryMood],
              feelings: converted.feelings,
              avgEnergy: converted.energy,
              regions: converted.region ? [converted.region] : [],
              genres: converted.genre ? [converted.genre] : [],
              languages: [],
              similarArtists: [],
              trackCount: 1,
              discoveredAt: Date.now(),
              lastUpdated: Date.now(),
              popularity: track.view_percentile,
              verified: track.tier === 'A',
              tier: track.tier as ArtistTier,
              culturalTags: track.cultural_tags as CulturalTag[],
              aestheticTags: track.aesthetic_tags as AestheticTag[],
            });
          } else {
            artistsMap.get(artistId)!.trackCount++;
          }
        }

        setState(s => ({
          ...s,
          loaded: Math.min(i + batchSize, tracks.length),
          progress: Math.round(((i + batchSize) / tracks.length) * 100),
        }));

        await new Promise(resolve => setTimeout(resolve, 0));
      }

      for (const artist of artistsMap.values()) {
        addArtist(artist);
      }

      setState(s => ({
        ...s,
        isLoading: false,
        loaded: tracks.length,
        progress: 100,
      }));

      return { success: true, stats: getStats() };
    } catch (error) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
      return { success: false, error };
    }
  }, [addTrack, addArtist, getStats]);

  const clearKnowledge = useCallback(() => {
    clear();
    setState({
      isLoading: false,
      progress: 0,
      total: 0,
      loaded: 0,
      error: null,
    });
  }, [clear]);

  return {
    ...state,
    loadFromUrl,
    loadFromJson,
    clearKnowledge,
    stats: getStats(),
  };
}

export default useKnowledgeLoader;
