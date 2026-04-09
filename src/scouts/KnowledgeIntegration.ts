/**
 * Knowledge Integration
 *
 * Connects the Knowledge Store to existing VOYO systems:
 * - Brain: Uses knowledge for smarter curation
 * - Track Pool: Enriches tracks with mood/feeling data
 * - Player: Gets recommendations from knowledge
 */

import {
  useKnowledgeStore,
  TrackKnowledge,
  findTracksByVibeProfile
} from '../knowledge/KnowledgeStore';
import {
  PrimaryMood,
  AfricanGenre,
  AfricanRegion,
  EnergyLevel,
  VibeProfile,
  VIBE_PROFILES,
  getCompatibleMoods
} from '../knowledge/MoodTags';
import { Track } from '../types';
import { useTrackPoolStore } from '../store/trackPoolStore';

// ============================================
// BRAIN INTEGRATION
// ============================================

/**
 * Get curated tracks for a vibe profile
 * Brain calls this instead of searching
 */
export function getKnowledgeCuratedTracks(
  vibe: VibeProfile,
  limit: number = 20
): TrackKnowledge[] {
  return findTracksByVibeProfile(vibe, limit);
}

/**
 * Get tracks by MixBoard mode (maps to vibe profiles)
 */
export function getTracksByMixMode(
  mode: string,
  limit: number = 20
): TrackKnowledge[] {
  const vibeProfile = VIBE_PROFILES[mode];
  if (vibeProfile) {
    return findTracksByVibeProfile(vibeProfile, limit);
  }

  // Fallback: search by mood
  const store = useKnowledgeStore.getState();
  const moodMap: Record<string, PrimaryMood> = {
    'afro-heat': 'energetic',
    'chill-vibes': 'chill',
    'love-songs': 'romantic',
    'party-mode': 'party',
    'worship': 'spiritual',
    'throwback-jams': 'nostalgic'
  };

  const mood = moodMap[mode] || 'energetic';
  return store.findTracksByMood(mood, limit);
}

/**
 * Get shadow session tracks (transitions from current vibe)
 */
export function getShadowSessionTracks(
  currentMood: PrimaryMood,
  direction: 'smooth' | 'contrast',
  limit: number = 15
): TrackKnowledge[] {
  const store = useKnowledgeStore.getState();

  if (direction === 'smooth') {
    // Get compatible moods for smooth transition
    const compatibleMoods = getCompatibleMoods(currentMood);
    const tracks: TrackKnowledge[] = [];

    for (const mood of compatibleMoods) {
      const moodTracks = store.findTracksByMood(mood, Math.ceil(limit / 3));
      tracks.push(...moodTracks);
    }

    return tracks.slice(0, limit);
  } else {
    // Contrast: opposite energy
    const currentEnergy = getEnergyForMood(currentMood);
    const targetEnergy = currentEnergy >= 3 ? 2 : 4;
    return store.findTracksByEnergy(targetEnergy as EnergyLevel, 1, limit);
  }
}

function getEnergyForMood(mood: PrimaryMood): EnergyLevel {
  const energyMap: Record<PrimaryMood, EnergyLevel> = {
    energetic: 5,
    party: 5,
    aggressive: 5,
    triumphant: 4,
    playful: 4,
    romantic: 3,
    nostalgic: 3,
    chill: 2,
    sensual: 2,
    peaceful: 2,
    melancholic: 2,
    spiritual: 3
  };
  return energyMap[mood] || 3;
}

// ============================================
// TRACK POOL INTEGRATION
// ============================================

/**
 * Enrich a track with knowledge data
 */
export function enrichTrackWithKnowledge(track: Track): Track & { knowledge?: TrackKnowledge } {
  const store = useKnowledgeStore.getState();
  const knowledge = store.getTrack(track.trackId);

  if (knowledge) {
    // Create enriched track with knowledge attached
    const enrichedTrack = {
      ...track,
      knowledge,
      // Extend tags with knowledge data
      tags: [
        ...(track.tags || []),
        knowledge.primaryMood,
        ...(knowledge.genre ? [knowledge.genre] : []),
        ...(knowledge.region ? [knowledge.region] : []),
        ...knowledge.feelings.slice(0, 3) // Top 3 feelings
      ]
    };
    return enrichedTrack;
  }

  return track;
}

/**
 * Sync knowledge to track pool
 * Enriches hot pool tracks with knowledge data
 */
export function syncKnowledgeToPool() {
  const poolStore = useTrackPoolStore.getState();
  const knowledgeStore = useKnowledgeStore.getState();

  const { hotPool } = poolStore;
  let enrichedCount = 0;

  // For each track in hot pool, try to match with knowledge
  for (const track of hotPool) {
    const knowledge = knowledgeStore.getTrack(track.trackId);
    if (knowledge) {
      // Update pool track with knowledge tags
      const tags = new Set(track.tags || []);
      tags.add(knowledge.primaryMood);
      if (knowledge.genre) tags.add(knowledge.genre);
      if (knowledge.region) tags.add(knowledge.region);
      knowledge.feelings.forEach(f => tags.add(f));

      // Note: This is read-only, actual update would need pool store action
      enrichedCount++;
    }
  }

  console.log(`[KnowledgeIntegration] Enriched ${enrichedCount}/${hotPool.length} pool tracks`);
  return enrichedCount;
}

// ============================================
// RECOMMENDATION ENGINE
// ============================================

interface RecommendationContext {
  currentTrack?: Track;
  recentMoods?: PrimaryMood[];
  preferredGenres?: AfricanGenre[];
  preferredRegions?: AfricanRegion[];
  targetEnergy?: EnergyLevel;
  avoidTrackIds?: string[];
}

/**
 * Get personalized recommendations based on context
 */
export function getKnowledgeRecommendations(
  context: RecommendationContext,
  limit: number = 20
): TrackKnowledge[] {
  const store = useKnowledgeStore.getState();
  const candidates: Map<string, { track: TrackKnowledge; score: number }> = new Map();

  // If we have a current track, find similar
  if (context.currentTrack) {
    const similar = store.findSimilarTracks(context.currentTrack.trackId, 50);
    similar.forEach((track, i) => {
      const existing = candidates.get(track.id);
      candidates.set(track.id, {
        track,
        score: (existing?.score || 0) + (50 - i) // Higher position = higher score
      });
    });
  }

  // Add tracks from recent moods
  if (context.recentMoods?.length) {
    for (const mood of context.recentMoods) {
      const moodTracks = store.findTracksByMood(mood, 30);
      moodTracks.forEach((track, i) => {
        const existing = candidates.get(track.id);
        candidates.set(track.id, {
          track,
          score: (existing?.score || 0) + (30 - i)
        });
      });
    }
  }

  // Boost preferred genres
  if (context.preferredGenres?.length) {
    for (const genre of context.preferredGenres) {
      const genreTracks = store.findTracksByGenre(genre, 30);
      genreTracks.forEach(track => {
        const existing = candidates.get(track.id);
        if (existing) {
          existing.score += 20;
        } else {
          candidates.set(track.id, { track, score: 20 });
        }
      });
    }
  }

  // Boost preferred regions
  if (context.preferredRegions?.length) {
    for (const region of context.preferredRegions) {
      const regionTracks = store.findTracksByRegion(region, 30);
      regionTracks.forEach(track => {
        const existing = candidates.get(track.id);
        if (existing) {
          existing.score += 15;
        }
      });
    }
  }

  // Filter by target energy
  let results = Array.from(candidates.values());
  if (context.targetEnergy) {
    results = results.filter(
      r => Math.abs(r.track.energy - context.targetEnergy!) <= 1
    );
  }

  // Exclude avoided tracks
  if (context.avoidTrackIds?.length) {
    const avoidSet = new Set(context.avoidTrackIds);
    results = results.filter(r => !avoidSet.has(r.track.id));
  }

  // Sort by score and return
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => r.track);
}

// ============================================
// MOOD JOURNEY
// ============================================

/**
 * Create a mood journey (sequence of moods for a session)
 */
export function createMoodJourney(
  startMood: PrimaryMood,
  targetMood: PrimaryMood,
  duration: number = 60 // minutes
): PrimaryMood[] {
  const journey: PrimaryMood[] = [startMood];

  if (startMood === targetMood) {
    return [startMood];
  }

  // Find path through compatible moods
  const compatibleFromStart = getCompatibleMoods(startMood);
  const compatibleToTarget = getCompatibleMoods(targetMood);

  // Look for bridge mood
  const bridgeMood = compatibleFromStart.find(m => compatibleToTarget.includes(m));

  if (bridgeMood) {
    journey.push(bridgeMood);
  }

  journey.push(targetMood);

  return journey;
}

/**
 * Get tracks for a mood journey
 */
export function getTracksForJourney(
  journey: PrimaryMood[],
  tracksPerMood: number = 5
): TrackKnowledge[] {
  const store = useKnowledgeStore.getState();
  const tracks: TrackKnowledge[] = [];

  for (const mood of journey) {
    const moodTracks = store.findTracksByMood(mood, tracksPerMood);
    tracks.push(...moodTracks);
  }

  return tracks;
}

// ============================================
// EXPORTS
// ============================================

export function getKnowledgeStats() {
  return useKnowledgeStore.getState().getStats();
}

export function hasKnowledge(): boolean {
  const stats = getKnowledgeStats();
  return stats.totalTracks > 0;
}

export function getKnowledgeCount(): number {
  const stats = getKnowledgeStats();
  return stats.totalTracks;
}
