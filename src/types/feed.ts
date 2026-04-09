// VOYO Feed Treatment System
// Intelligent start/duration for each track in the feed

import { Track } from './index';

/**
 * Feed Treatment Types
 * Each defines HOW a track should play in the vertical feed
 */
export type FeedTreatment =
  | 'full_intro'      // Play from start (new releases, discovery)
  | 'heat_drop'       // Jump to AI-detected drop/hook
  | 'chorus_hook'     // Start at chorus
  | 'bridge_moment'   // Start at bridge (emotional tracks)
  | 'random_slice';   // Random snippet (ambient/background)

/**
 * Energy Level Classification
 * Helps determine treatment type
 */
export type EnergyLevel = 'high' | 'medium' | 'chill';

/**
 * Feed Metadata
 * Applied to each track to control feed playback
 */
export interface FeedMetadata {
  treatment: FeedTreatment;
  startSeconds: number;        // Absolute time to start (e.g., 45)
  durationSeconds: number;      // How long to play (e.g., 15)
  energyLevel: EnergyLevel;     // Track energy classification
  skipIntro: boolean;           // Skip first 30s if intro is slow
  reason?: string;              // Why this treatment? (debug/analytics)
}

/**
 * Feed Track
 * Track with optional feed metadata
 */
export interface FeedTrack extends Track {
  feedMetadata?: FeedMetadata;
  feedScore?: number;           // Sorting score for feed order
}

/**
 * User Context for Feed Algorithm
 * Affects feed scoring and treatment selection
 */
export interface UserFeedContext {
  recentSkips: string[];        // Track IDs skipped recently
  recentCompletes: string[];    // Track IDs completed recently
  preferredArtists: string[];   // Artists user listens to most
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  sessionMood?: 'hype' | 'chill' | 'discover' | 'focus';
}

/**
 * Feed Score Factors
 * Used to calculate feedScore for sorting
 */
export interface FeedScoreFactors {
  recency: number;              // 0-1, newer = higher
  oyeScore: number;             // Native OYE score
  userAffinity: number;         // 0-1, based on past behavior
  diversity: number;            // 0-1, penalize same artist back-to-back
  hotspotStrength: number;      // 0-1, strength of detected hotspot
}
