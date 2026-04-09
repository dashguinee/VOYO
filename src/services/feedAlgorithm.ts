/**
 * VOYO Feed Algorithm
 *
 * Intelligent feed treatment system that determines:
 * - WHERE to start each track (start time)
 * - HOW LONG to play (duration)
 * - WHAT ORDER to show tracks (feed score)
 *
 * Uses hotspot data when available, falls back to smart estimation
 */

import { Track } from '../types/index';
import {
  FeedTrack,
  FeedMetadata,
  FeedTreatment,
  EnergyLevel,
  UserFeedContext,
  FeedScoreFactors
} from '../types/feed';
import { TrackHotspot } from '../store/reactionStore';

// =============================================
// TREATMENT ESTIMATION (When No LLM Data)
// =============================================

/**
 * Estimate treatment for a track based on metadata
 * Falls back when no LLM/AI analysis available
 */
export function estimateTreatment(track: Track, hotspots?: TrackHotspot[]): FeedMetadata {
  const duration = track.duration || 180;
  const title = track.title.toLowerCase();
  const artist = track.artist.toLowerCase();

  // Check if we have hotspot data from reactions
  if (hotspots && hotspots.length > 0) {
    const hottestSpot = hotspots[0]; // Already sorted by intensity
    const startPercent = hottestSpot.position;
    const startSeconds = Math.floor((startPercent / 100) * duration);

    // Determine duration based on energy
    const durationSeconds = hottestSpot.intensity > 0.7 ? 15 : 20;

    return {
      treatment: 'heat_drop',
      startSeconds: Math.max(0, startSeconds - 2), // Start 2s before peak
      durationSeconds,
      energyLevel: hottestSpot.intensity > 0.7 ? 'high' : 'medium',
      skipIntro: true,
      reason: `Hotspot detected at ${startPercent.toFixed(0)}% with ${hottestSpot.reactionCount} reactions`
    };
  }

  // Short tracks (< 2min) - play from start
  if (duration < 120) {
    return {
      treatment: 'full_intro',
      startSeconds: 0,
      durationSeconds: 30,
      energyLevel: detectEnergyFromTitle(title),
      skipIntro: false,
      reason: 'Short track, play from intro'
    };
  }

  // Detect energy level from tags/title
  const energy = detectEnergyLevel(track);

  // High energy - likely has a drop
  if (energy === 'high') {
    const dropPosition = estimateDropPosition(duration);
    return {
      treatment: 'heat_drop',
      startSeconds: dropPosition,
      durationSeconds: 15,
      energyLevel: 'high',
      skipIntro: true,
      reason: 'High energy track, estimated drop position'
    };
  }

  // Chill vibes - start at 30% (skip slow intro)
  if (energy === 'chill') {
    return {
      treatment: 'bridge_moment',
      startSeconds: Math.floor(duration * 0.30),
      durationSeconds: 20,
      energyLevel: 'chill',
      skipIntro: true,
      reason: 'Chill track, start at emotional section'
    };
  }

  // Default - start at 25% (safe bet for most tracks)
  return {
    treatment: 'chorus_hook',
    startSeconds: Math.floor(duration * 0.25),
    durationSeconds: 20,
    energyLevel: 'medium',
    skipIntro: true,
    reason: 'Default 25% start position'
  };
}

/**
 * Detect energy level from track metadata
 */
function detectEnergyLevel(track: Track): EnergyLevel {
  const title = (track.title || '').toLowerCase();
  const tags = (track.tags || []).filter(t => typeof t === 'string').map(t => t.toLowerCase());

  // High energy indicators
  const highEnergyKeywords = ['drill', 'amapiano', 'party', 'turn up', 'hype', 'fire'];
  const isHighEnergy = highEnergyKeywords.some(kw =>
    title.includes(kw) || tags.some(tag => tag.includes(kw))
  );

  if (isHighEnergy) return 'high';

  // Chill indicators
  const chillKeywords = ['chill', 'slow', 'rnb', 'soul', 'acoustic', 'ballad'];
  const isChill = chillKeywords.some(kw =>
    title.includes(kw) || tags.some(tag => tag.includes(kw))
  );

  if (isChill) return 'chill';

  return 'medium';
}

/**
 * Detect energy from title only (quick check)
 */
function detectEnergyFromTitle(title: string): EnergyLevel {
  const t = title.toLowerCase();

  if (t.includes('drill') || t.includes('amapiano') || t.includes('party')) {
    return 'high';
  }

  if (t.includes('chill') || t.includes('rnb') || t.includes('soul')) {
    return 'chill';
  }

  return 'medium';
}

/**
 * Estimate where the drop/hook likely is
 * Based on typical song structures
 */
function estimateDropPosition(duration: number): number {
  // Most drops happen between 25-35% of the song
  // For a 3min song, that's ~45-60s
  const dropPercent = 0.30; // 30% is a safe bet
  const estimated = Math.floor(duration * dropPercent);

  // Ensure it's not too early or too late
  return Math.max(15, Math.min(estimated, duration * 0.5));
}

// =============================================
// TREATMENT APPLICATION
// =============================================

/**
 * Apply treatment to a track
 * Returns the track with feedMetadata attached
 */
export function applyTreatment(track: Track, hotspots?: TrackHotspot[]): FeedTrack {
  const feedMetadata = estimateTreatment(track, hotspots);

  return {
    ...track,
    feedMetadata
  };
}

/**
 * Get start time for a track (for video/audio seek)
 */
export function getStartTime(track: FeedTrack): number {
  return track.feedMetadata?.startSeconds || 0;
}

/**
 * Get duration for a track (how long to play)
 */
export function getDuration(track: FeedTrack): number {
  return track.feedMetadata?.durationSeconds || 20;
}

// =============================================
// FEED SCORING & ORDERING
// =============================================

/**
 * Calculate feed score for a track
 * Higher score = show earlier in feed
 */
export function calculateFeedScore(
  track: Track,
  userContext?: UserFeedContext,
  hotspots?: TrackHotspot[]
): number {
  const factors: FeedScoreFactors = {
    recency: calculateRecency(track),
    oyeScore: normalizeOyeScore(track.oyeScore),
    userAffinity: calculateUserAffinity(track, userContext),
    diversity: 1.0, // Will be calculated in buildSmartFeed
    hotspotStrength: calculateHotspotStrength(hotspots)
  };

  // Weighted scoring
  const score =
    factors.recency * 0.15 +
    factors.oyeScore * 0.30 +
    factors.userAffinity * 0.25 +
    factors.diversity * 0.10 +
    factors.hotspotStrength * 0.20;

  return score;
}

/**
 * Calculate recency factor (0-1)
 * Newer tracks score higher
 */
function calculateRecency(track: Track): number {
  const createdAt = new Date(track.createdAt).getTime();
  const now = Date.now();
  const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);

  // Decay over 30 days
  return Math.max(0, 1 - (ageInDays / 30));
}

/**
 * Normalize OYE score to 0-1 range
 */
function normalizeOyeScore(oyeScore: number): number {
  // Assuming oyeScore ranges 0-1000+
  return Math.min(1, oyeScore / 100);
}

/**
 * Calculate user affinity (0-1)
 * How much this track matches user preferences
 */
function calculateUserAffinity(track: Track, userContext?: UserFeedContext): number {
  if (!userContext) return 0.5; // Neutral

  let affinity = 0.5;

  // Boost if artist is preferred
  if (userContext.preferredArtists.includes(track.artist)) {
    affinity += 0.3;
  }

  // Penalize if recently skipped
  if (userContext.recentSkips.includes(track.id)) {
    affinity -= 0.4;
  }

  // Boost if recently completed
  if (userContext.recentCompletes.includes(track.id)) {
    affinity += 0.2;
  }

  return Math.max(0, Math.min(1, affinity));
}

/**
 * Calculate hotspot strength (0-1)
 * Stronger hotspots = higher score
 */
function calculateHotspotStrength(hotspots?: TrackHotspot[]): number {
  if (!hotspots || hotspots.length === 0) return 0.3; // Default

  const hottestSpot = hotspots[0];
  return hottestSpot.intensity;
}

/**
 * Build smart feed from track list
 * Applies scoring, sorting, and diversity
 */
export function buildSmartFeed(
  tracks: Track[],
  userContext?: UserFeedContext,
  hotspotsMap?: Map<string, TrackHotspot[]>
): FeedTrack[] {
  // Apply treatments and calculate initial scores
  let feedTracks: FeedTrack[] = tracks.map(track => {
    const hotspots = hotspotsMap?.get(track.id);
    const treated = applyTreatment(track, hotspots);
    const score = calculateFeedScore(track, userContext, hotspots);

    return {
      ...treated,
      feedScore: score
    };
  });

  // Sort by score (descending)
  feedTracks.sort((a, b) => (b.feedScore || 0) - (a.feedScore || 0));

  // Apply diversity boost (penalize same artist back-to-back)
  feedTracks = applyDiversityBoost(feedTracks);

  return feedTracks;
}

/**
 * Apply diversity boost
 * Shuffle to avoid same artist appearing consecutively
 */
function applyDiversityBoost(tracks: FeedTrack[]): FeedTrack[] {
  const result: FeedTrack[] = [];
  const remaining = [...tracks];

  while (remaining.length > 0) {
    const currentArtist = result[result.length - 1]?.artist;

    // Find highest scoring track that's NOT the same artist
    let nextIndex = 0;
    if (currentArtist) {
      nextIndex = remaining.findIndex(t => t.artist !== currentArtist);
      if (nextIndex === -1) {
        // No different artist found, just take the top one
        nextIndex = 0;
      }
    }

    const next = remaining.splice(nextIndex, 1)[0];
    result.push(next);
  }

  return result;
}

// =============================================
// UTILITY FUNCTIONS
// =============================================

/**
 * Get treatment info as readable string (for debugging)
 */
export function getTreatmentInfo(track: FeedTrack): string {
  if (!track.feedMetadata) return 'No treatment';

  const { treatment, startSeconds, durationSeconds, reason } = track.feedMetadata;
  const startTime = formatTime(startSeconds);

  return `${treatment} @ ${startTime} for ${durationSeconds}s - ${reason || 'No reason'}`;
}

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Create user context from behavior data
 */
export function createUserContext(
  recentSkips: string[] = [],
  recentCompletes: string[] = [],
  preferredArtists: string[] = []
): UserFeedContext {
  const hour = new Date().getHours();

  let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  if (hour < 12) timeOfDay = 'morning';
  else if (hour < 17) timeOfDay = 'afternoon';
  else if (hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';

  return {
    recentSkips,
    recentCompletes,
    preferredArtists,
    timeOfDay
  };
}
