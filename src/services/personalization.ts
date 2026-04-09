/**
 * VOYO Music - Personalization Service v2.0
 * INTENT-FIRST RECOMMENDATION ENGINE
 *
 * HOT ENGINE: What's trending + what you WANT
 * DISCOVERY ENGINE: What's similar + what you WANT
 *
 * Key Innovation: INTENT > BEHAVIOR
 * - MixBoard bars = explicit user intent (what they WANT)
 * - Drag-to-queue = strongest intent signal
 * - Listen history = passive behavior (what they DID)
 *
 * Final Score = Behavior (40%) + Intent (60%)
 *
 * When user sets Party Mode to 5 bars but history is all chill,
 * we prioritize Party Mode because that's their CURRENT intent.
 */

import { Track } from '../types';
import { TrackPreference, usePreferenceStore } from '../store/preferenceStore';
import { TRACKS } from '../data/tracks';
import { useIntentStore, matchTrackToMode, VibeMode, MODE_KEYWORDS } from '../store/intentStore';
import { useTrackPoolStore, PooledTrack } from '../store/trackPoolStore';
import { safeAddManyToPool } from './trackVerifier';
import { saveVerifiedTrack } from './centralDJ';

// ============================================
// SCORING WEIGHTS
// ============================================

const WEIGHTS = {
  // Direct track signals
  EXPLICIT_LIKE: 100,
  EXPLICIT_DISLIKE: -200,
  COMPLETION_RATE: 50, // max 50 points for 100% completion
  REACTIONS: 10, // points per reaction
  SKIP_PENALTY: -30, // per skip

  // Indirect signals (artist, tags, mood)
  ARTIST_AFFINITY: 40,
  TAG_AFFINITY: 20,
  MOOD_AFFINITY: 15,

  // Popularity boost
  OYE_SCORE_BOOST: 0.00001, // Small boost for popular tracks

  // INTENT WEIGHTING (new!)
  INTENT_WEIGHT: 0.6,    // Intent = 60% of final score
  BEHAVIOR_WEIGHT: 0.4,  // Behavior = 40% of final score
  MODE_MATCH_BONUS: 80,  // Bonus for matching dominant mode
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate skip penalty with time decay
 * Skips from long ago have less impact than recent skips
 * Decay: 100% impact today, 0% after 30 days
 */
function calculateDecayedSkipPenalty(pref: TrackPreference): number {
  if (pref.skips === 0) return 0;

  const daysSinceLastPlay = (Date.now() - new Date(pref.lastPlayedAt).getTime()) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.max(0, 1 - (daysSinceLastPlay / 30)); // Decays to 0 over 30 days
  const baseSkipPenalty = pref.skips * WEIGHTS.SKIP_PENALTY;

  return baseSkipPenalty * decayFactor;
}

// ============================================
// SCORING FUNCTIONS
// ============================================

/**
 * Calculate BEHAVIOR score based on listen history
 * What the user DID (passive signals)
 * Now includes time decay for skip penalties
 */
export function calculateBehaviorScore(track: Track, preferences: Record<string, TrackPreference>): number {
  const pref = preferences[track.id];
  let score = 0;

  // 1. EXPLICIT SIGNALS (strongest)
  if (pref?.explicitLike !== undefined) {
    score += pref.explicitLike ? WEIGHTS.EXPLICIT_LIKE : WEIGHTS.EXPLICIT_DISLIKE;
  }

  // 2. LISTEN BEHAVIOR (strong)
  if (pref) {
    // Completion rate (0-100%)
    const completionRate = pref.totalListens > 0
      ? (pref.completions / pref.totalListens) * 100
      : 0;
    const completionScore = (completionRate / 100) * WEIGHTS.COMPLETION_RATE;
    score += completionScore;

    // Reactions
    const reactionScore = pref.reactions * WEIGHTS.REACTIONS;
    score += reactionScore;

    // Skip penalty WITH TIME DECAY (new!)
    const skipScore = calculateDecayedSkipPenalty(pref);
    score += skipScore;
  }

  // 3. POPULARITY BOOST (small)
  const popularityBoost = track.oyeScore * WEIGHTS.OYE_SCORE_BOOST;
  score += popularityBoost;

  return score;
}

/**
 * Calculate INTENT score based on MixBoard settings
 * What the user WANTS (active signals)
 *
 * This is the secret sauce!
 * - Match track to vibe mode (afro-heat, party-mode, etc.)
 * - Multiply by that mode's intent weight
 * - Dominant modes get bonus points
 */
export function calculateIntentScore(track: Track): number {
  const intentStore = useIntentStore.getState();
  const intentWeights = intentStore.getIntentWeights();
  const dominantModes = intentStore.getDominantModes(2);

  // Match track to its best vibe mode
  const trackMode = matchTrackToMode({
    title: track.title,
    artist: track.artist,
    tags: track.tags,
    mood: track.mood,
  });

  let score = 0;

  // 1. Base intent score from matching mode's weight
  // If track matches 'party-mode' and party-mode has 40% intent weight → base score
  const modeWeight = intentWeights[trackMode] || 0;
  score += modeWeight * 100; // Scale to 0-100

  // 2. BONUS if track matches a dominant mode
  if (dominantModes.includes(trackMode)) {
    const dominanceRank = dominantModes.indexOf(trackMode);
    if (dominanceRank === 0) {
      // Top dominant mode = full bonus
      score += WEIGHTS.MODE_MATCH_BONUS;
    } else if (dominanceRank === 1) {
      // Second dominant = half bonus
      score += WEIGHTS.MODE_MATCH_BONUS * 0.5;
    }
  }

  // 3. Keyword match bonus (finer granularity)
  const keywords = MODE_KEYWORDS[trackMode] || [];
  const searchText = `${track.title} ${track.artist} ${track.tags?.join(' ') || ''}`.toLowerCase();
  let keywordMatches = 0;
  keywords.forEach((kw) => {
    if (searchText.includes(kw.toLowerCase())) {
      keywordMatches++;
    }
  });
  // Each keyword match = +5 points (max 25 for 5+ matches)
  score += Math.min(keywordMatches * 5, 25);

  return score;
}

/**
 * Calculate COMBINED score (Behavior + Intent)
 * INTENT > BEHAVIOR (60/40 split)
 */
export function calculateTrackScore(track: Track, preferences: Record<string, TrackPreference>): number {
  const behaviorScore = calculateBehaviorScore(track, preferences);
  const intentScore = calculateIntentScore(track);

  // Weighted combination: Intent wins!
  const combinedScore = (behaviorScore * WEIGHTS.BEHAVIOR_WEIGHT) + (intentScore * WEIGHTS.INTENT_WEIGHT);

  return combinedScore;
}

/**
 * HOT ENGINE v2.0 - Intent-First Recommendations
 *
 * Strategy:
 * 1. Get dominant modes from MixBoard (what user WANTS)
 * 2. Pull tracks matching those modes
 * 3. Score by combined (behavior + intent)
 * 4. Ensure diversity (don't just play one mode)
 *
 * This is the "What's Hot FOR YOU" belt
 */
export function getPersonalizedHotTracks(limit: number = 5): Track[] {
  const preferences = usePreferenceStore.getState().trackPreferences;
  const intentStore = useIntentStore.getState();
  const dominantModes = intentStore.getDominantModes(3); // Top 3 modes

  // Score all tracks with combined scoring
  const scored = TRACKS.map((track) => {
    const trackMode = matchTrackToMode({
      title: track.title,
      artist: track.artist,
      tags: track.tags,
      mood: track.mood,
    });

    return {
      track,
      mode: trackMode,
      score: calculateTrackScore(track, preferences),
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // DIVERSITY PASS: Ensure we don't just return all one mode
  // Take top scorer from each dominant mode, then fill with highest overall
  const result: Track[] = [];
  const usedIds = new Set<string>();

  // First: Grab top track from each dominant mode
  for (const mode of dominantModes) {
    const topFromMode = scored.find(
      (s) => s.mode === mode && !usedIds.has(s.track.id)
    );
    if (topFromMode) {
      result.push(topFromMode.track);
      usedIds.add(topFromMode.track.id);
    }
    if (result.length >= limit) break;
  }

  // Second: Fill remaining slots with highest scoring tracks
  for (const { track } of scored) {
    if (result.length >= limit) break;
    if (!usedIds.has(track.id)) {
      result.push(track);
      usedIds.add(track.id);
    }
  }

  return result;
}

/**
 * DISCOVERY ENGINE v2.0 - Intent-Influenced Discovery
 *
 * Strategy:
 * 1. Start with similarity to current track (classic approach)
 * 2. BOOST tracks that match dominant MixBoard modes
 * 3. Balance discovery (new) vs. familiarity (similar)
 *
 * The magic: If user is playing a chill track but MixBoard says they want party,
 * Discovery will surface party tracks that are SOMEWHAT similar to current track
 *
 * This is the "Based on what you're playing + what you WANT" belt
 */
export function getPersonalizedDiscoveryTracks(
  currentTrack: Track,
  limit: number = 5,
  excludeIds: string[] = []
): Track[] {
  const preferences = usePreferenceStore.getState().trackPreferences;
  const intentStore = useIntentStore.getState();
  const dominantModes = intentStore.getDominantModes(2);
  const intentWeights = intentStore.getIntentWeights();

  // Filter out excluded tracks
  const candidates = TRACKS.filter(
    (t) => t.id !== currentTrack.id && !excludeIds.includes(t.id)
  );

  // Score each track
  const scored = candidates.map((track) => {
    let score = 0;

    // Get track's mode
    const trackMode = matchTrackToMode({
      title: track.title,
      artist: track.artist,
      tags: track.tags,
      mood: track.mood,
    });

    // =====================================
    // SIMILARITY SCORE (40% of total)
    // =====================================
    let similarityScore = 0;

    // Same artist (strongest similarity signal)
    if (track.artist.toLowerCase() === currentTrack.artist.toLowerCase()) {
      similarityScore += 50;
    }

    // Same mood
    if (track.mood && currentTrack.mood && track.mood === currentTrack.mood) {
      similarityScore += 30;
    }

    // Matching tags
    const matchingTags = track.tags.filter((tag) =>
      currentTrack.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    );
    similarityScore += matchingTags.length * 10;

    // Same region
    if (track.region && currentTrack.region && track.region === currentTrack.region) {
      similarityScore += 5;
    }

    // =====================================
    // INTENT SCORE (40% of total)
    // =====================================
    let intentScore = 0;

    // Mode weight (how much user wants this vibe)
    const modeWeight = intentWeights[trackMode] || 0;
    intentScore += modeWeight * 80;

    // Dominant mode bonus
    if (dominantModes.includes(trackMode)) {
      const rank = dominantModes.indexOf(trackMode);
      intentScore += rank === 0 ? 40 : 20;
    }

    // =====================================
    // BEHAVIOR SCORE (20% of total)
    // =====================================
    const behaviorScore = calculateBehaviorScore(track, preferences);

    // =====================================
    // COMBINED SCORE
    // =====================================
    score = (similarityScore * 0.4) + (intentScore * 0.4) + (behaviorScore * 0.2);

    // Small popularity boost
    score += track.oyeScore / 10000000;

    return {
      track,
      mode: trackMode,
      score,
      similarity: similarityScore,
      intent: intentScore,
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // DIVERSITY: Don't return all from same mode
  const result: Track[] = [];
  const usedIds = new Set<string>();
  const modeCount: Record<string, number> = {};

  for (const item of scored) {
    if (result.length >= limit) break;

    // Limit max 2 tracks per mode for diversity
    const currentModeCount = modeCount[item.mode] || 0;
    if (currentModeCount >= 2 && Object.keys(modeCount).length < 3) {
      continue; // Skip if we already have 2 from this mode and haven't seen 3 modes
    }

    if (!usedIds.has(item.track.id)) {
      result.push(item.track);
      usedIds.add(item.track.id);
      modeCount[item.mode] = currentModeCount + 1;
    }
  }

  // Fill any remaining slots
  for (const { track } of scored) {
    if (result.length >= limit) break;
    if (!usedIds.has(track.id)) {
      result.push(track);
      usedIds.add(track.id);
    }
  }

  return result;
}

/**
 * Get tracks the user is likely to skip (for testing)
 */
export function getLikelySkips(limit: number = 5): Track[] {
  const preferences = usePreferenceStore.getState().trackPreferences;

  const scored = TRACKS.map((track) => {
    const pref = preferences[track.id];
    if (!pref) return { track, skipRate: 0 };

    const skipRate = pref.totalListens > 0
      ? (pref.skips / pref.totalListens) * 100
      : 0;

    return { track, skipRate };
  });

  // Sort by skip rate descending
  scored.sort((a, b) => b.skipRate - a.skipRate);

  return scored.slice(0, limit).map((s) => s.track);
}

/**
 * Get user's top tracks (most completed, most reactions)
 * POOL-AWARE: Combines static TRACKS + dynamic pool for full coverage
 */
export function getUserTopTracks(limit: number = 10): Track[] {
  const preferences = usePreferenceStore.getState().trackPreferences;
  const poolStore = useTrackPoolStore.getState();
  const hotPool = poolStore.hotPool;

  // Combine static TRACKS + pool tracks (dedupe by id)
  const seenIds = new Set<string>();
  const allTracks: Track[] = [];

  // Add static tracks first
  for (const track of TRACKS) {
    if (!seenIds.has(track.id)) {
      seenIds.add(track.id);
      allTracks.push(track);
    }
  }

  // Add pool tracks (discovered via search, DJ, etc)
  for (const poolTrack of hotPool) {
    if (!seenIds.has(poolTrack.id)) {
      seenIds.add(poolTrack.id);
      allTracks.push(poolTrack);
    }
  }

  const scored = allTracks.map((track) => {
    const pref = preferences[track.id] || preferences[track.trackId];
    if (!pref) return { track, score: 0 };

    const completionRate = pref.totalListens > 0
      ? (pref.completions / pref.totalListens) * 100
      : 0;

    const score = pref.completions * 10 + pref.reactions * 5 + completionRate;
    return { track, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map((s) => s.track);
}

/**
 * Get tracks for a specific vibe mode
 * Used by MixBoard drag-to-queue to find matching tracks
 */
export function getTracksByMode(modeId: VibeMode, limit: number = 5): Track[] {
  const keywords = MODE_KEYWORDS[modeId] || [];

  if (keywords.length === 0) {
    // Random mixer = random tracks
    return [...TRACKS].sort(() => Math.random() - 0.5).slice(0, limit);
  }

  // Score tracks by keyword matches
  const scored = TRACKS.map((track) => {
    const searchText = `${track.title} ${track.artist} ${track.tags?.join(' ') || ''} ${track.mood || ''}`.toLowerCase();

    let matches = 0;
    keywords.forEach((kw) => {
      if (searchText.includes(kw.toLowerCase())) {
        matches++;
      }
    });

    return { track, matches };
  });

  // Sort by matches descending
  scored.sort((a, b) => b.matches - a.matches);

  // Filter to tracks with at least 1 match, or return random if none match
  const matching = scored.filter((s) => s.matches > 0);

  if (matching.length >= limit) {
    return matching.slice(0, limit).map((s) => s.track);
  }

  // Fill with random tracks if not enough matches
  const usedIds = new Set(matching.map((s) => s.track.id));
  const filler = TRACKS.filter((t) => !usedIds.has(t.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, limit - matching.length);

  return [...matching.map((s) => s.track), ...filler];
}

/**
 * Get mixed tracks based on current MixBoard distribution
 * Returns tracks proportional to mode weights
 *
 * Example: If MixBoard is 50% party, 30% chill, 20% workout
 * Returns: 2-3 party, 1-2 chill, 1 workout tracks
 */
export function getMixedTracks(limit: number = 10): Track[] {
  const intentStore = useIntentStore.getState();
  const intentWeights = intentStore.getIntentWeights();

  const result: Track[] = [];
  const usedIds = new Set<string>();

  // Calculate how many tracks per mode
  const modeAllocation: { modeId: VibeMode; count: number }[] = [];
  let allocated = 0;

  Object.entries(intentWeights).forEach(([modeId, weight]) => {
    const count = Math.round(weight * limit);
    if (count > 0) {
      modeAllocation.push({ modeId: modeId as VibeMode, count });
      allocated += count;
    }
  });

  // Adjust for rounding (add/remove from largest allocation)
  if (allocated !== limit && modeAllocation.length > 0) {
    modeAllocation[0].count += (limit - allocated);
  }

  // Get tracks for each mode
  for (const { modeId, count } of modeAllocation) {
    const modeTracks = getTracksByMode(modeId, count * 2); // Get extra for filtering

    for (const track of modeTracks) {
      if (result.length >= limit) break;
      if (!usedIds.has(track.id)) {
        result.push(track);
        usedIds.add(track.id);
      }
    }
  }

  // Fill any remaining with random
  if (result.length < limit) {
    const filler = TRACKS.filter((t) => !usedIds.has(t.id))
      .sort(() => Math.random() - 0.5)
      .slice(0, limit - result.length);
    result.push(...filler);
  }

  // Shuffle to mix modes together
  return result.sort(() => Math.random() - 0.5);
}

/**
 * Debug: Print preference stats
 */
export function debugPreferences(): void {
  const state = usePreferenceStore.getState();
  const prefs = Object.values(state.trackPreferences);

  if (prefs.length === 0) {
    return;
  }
}

/**
 * Debug: Print intent stats
 */
export function debugIntent(): void {
  const intentStore = useIntentStore.getState();
  const dominantModes = intentStore.getDominantModes(3);
  const weights = intentStore.getIntentWeights();

  console.log('[VOYO Intent Engine]');
  console.log('Dominant Modes:', dominantModes);
  console.log('Mode Weights:', weights);
}

// ============================================
// POOL-AWARE ENGINES (v3.0)
// Uses dynamic Track Pool instead of static TRACKS
// ============================================

/**
 * HOT ENGINE v3.0 - Pool-Aware, Intent-First
 *
 * Uses Track Pool Store for dynamic track management.
 * Falls back to static TRACKS if pool is empty.
 *
 * Key difference from v2.0:
 * - Pulls from growing pool (not static 11 tracks)
 * - Uses pool scores (engagement + recency + intent)
 * - Blends new tracks smoothly (no jarring refresh)
 *
 * v3.1 IMPROVEMENTS:
 * - Added randomization factor to prevent same tracks every time
 * - Better deduplication with trackId fallback
 */
export function getPoolAwareHotTracks(limit: number = 5): Track[] {
  const poolStore = useTrackPoolStore.getState();
  const hotPool = poolStore.hotPool;

  // Fallback to static if pool empty
  if (hotPool.length === 0) {
    console.log('[VOYO] Pool empty, falling back to static tracks');
    return getPersonalizedHotTracks(limit);
  }

  const intentStore = useIntentStore.getState();
  const dominantModes = intentStore.getDominantModes(3);
  const intentWeights = intentStore.getIntentWeights();

  // Score pool tracks with fresh intent weighting
  const scored = hotPool.map((pooledTrack) => {
    // Base pool score (engagement + recency)
    let score = pooledTrack.poolScore;

    // Intent boost (current session)
    const modeWeight = intentWeights[pooledTrack.detectedMode] || 0.1;
    score += modeWeight * 30; // Up to +30 for matching intent

    // Dominant mode bonus
    if (dominantModes.includes(pooledTrack.detectedMode)) {
      const rank = dominantModes.indexOf(pooledTrack.detectedMode);
      score += rank === 0 ? 20 : rank === 1 ? 10 : 5;
    }

    // RANDOMIZATION: Add small jitter to prevent deterministic ordering
    score += Math.random() * 5; // Up to 5 points of randomness

    return { track: pooledTrack as Track, mode: pooledTrack.detectedMode, score };
  });

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Diversity pass (same as v2.0)
  const result: Track[] = [];
  const usedIds = new Set<string>();

  // First: Top from each dominant mode
  for (const mode of dominantModes) {
    const topFromMode = scored.find(
      (s) => s.mode === mode && !usedIds.has(s.track.id)
    );
    if (topFromMode) {
      result.push(topFromMode.track);
      usedIds.add(topFromMode.track.id);
      // Also track trackId for robust dedup
      if (topFromMode.track.trackId) usedIds.add(topFromMode.track.trackId);
    }
    if (result.length >= limit) break;
  }

  // Fill remaining
  for (const { track } of scored) {
    if (result.length >= limit) break;
    if (!usedIds.has(track.id)) {
      result.push(track);
      usedIds.add(track.id);
    }
  }

  return result;
}

/**
 * DISCOVERY ENGINE v3.0 - Pool-Aware, Intent-Influenced
 *
 * Uses Track Pool Store for dynamic discovery.
 * Blends similarity + intent + pool engagement.
 *
 * v3.1 IMPROVEMENTS:
 * - Added randomization factor to prevent same tracks appearing
 * - Better deduplication with trackId fallback
 * - Shuffle equivalent scores for variety
 */
export function getPoolAwareDiscoveryTracks(
  currentTrack: Track,
  limit: number = 5,
  excludeIds: string[] = []
): Track[] {
  const poolStore = useTrackPoolStore.getState();
  const hotPool = poolStore.hotPool;

  // Fallback to static if pool empty
  if (hotPool.length === 0) {
    return getPersonalizedDiscoveryTracks(currentTrack, limit, excludeIds);
  }

  const intentStore = useIntentStore.getState();
  const dominantModes = intentStore.getDominantModes(2);
  const intentWeights = intentStore.getIntentWeights();

  // Get current track's mode
  const currentMode = matchTrackToMode({
    title: currentTrack.title,
    artist: currentTrack.artist,
    tags: currentTrack.tags,
    mood: currentTrack.mood,
  });

  // BUILD EXCLUSION SET: Include both id and trackId for robust dedup
  const excludeSet = new Set<string>();
  excludeIds.forEach(id => excludeSet.add(id));
  excludeSet.add(currentTrack.id);
  if (currentTrack.trackId) excludeSet.add(currentTrack.trackId);

  // Filter and score - check both id and trackId for thorough deduplication
  const candidates = hotPool.filter((t) => {
    if (excludeSet.has(t.id)) return false;
    if (t.trackId && excludeSet.has(t.trackId)) return false;
    return true;
  });

  const scored = candidates.map((pooledTrack) => {
    let score = 0;

    // 1. POOL SCORE (30%) - engagement + recency
    score += pooledTrack.poolScore * 0.3;

    // 2. SIMILARITY (30%)
    if (pooledTrack.detectedMode === currentMode) score += 15;
    if (pooledTrack.artist.toLowerCase() === currentTrack.artist.toLowerCase()) score += 20;
    // Tag matching
    const matchingTags = pooledTrack.tags?.filter((tag) =>
      currentTrack.tags?.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    ) || [];
    score += matchingTags.length * 3;

    // 3. INTENT (40%)
    const modeWeight = intentWeights[pooledTrack.detectedMode] || 0.1;
    score += modeWeight * 40;

    // Dominant mode bonus
    if (dominantModes.includes(pooledTrack.detectedMode)) {
      score += 10;
    }

    // 4. RANDOMIZATION FACTOR: Add small random jitter to prevent deterministic ordering
    // This ensures variety even when scores are similar
    score += Math.random() * 5; // Up to 5 points of randomness

    return { track: pooledTrack as Track, mode: pooledTrack.detectedMode, score };
  });

  // Sort and apply diversity
  scored.sort((a, b) => b.score - a.score);

  const result: Track[] = [];
  const usedIds = new Set<string>();
  const modeCount: Record<string, number> = {};

  for (const item of scored) {
    if (result.length >= limit) break;

    // Limit 2 per mode for diversity
    const currentModeCount = modeCount[item.mode] || 0;
    if (currentModeCount >= 2 && Object.keys(modeCount).length < 3) {
      continue;
    }

    if (!usedIds.has(item.track.id)) {
      result.push(item.track);
      usedIds.add(item.track.id);
      // Also track trackId to prevent duplicates with different id formats
      if (item.track.trackId) usedIds.add(item.track.trackId);
      modeCount[item.mode] = currentModeCount + 1;
    }
  }

  // Fill remaining
  for (const { track } of scored) {
    if (result.length >= limit) break;
    if (!usedIds.has(track.id)) {
      result.push(track);
      usedIds.add(track.id);
    }
  }

  return result;
}

/**
 * Add tracks to pool from search results
 * Call this when user searches and plays a track
 * Validates each track before adding - no bad thumbnails enter
 * Also syncs to Supabase collective brain for other users
 */
export async function addSearchResultsToPool(tracks: Track[]): Promise<void> {
  const added = await safeAddManyToPool(tracks, 'search');
  console.log(`[VOYO Pool] Added ${added}/${tracks.length} validated search results to pool`);

  // COLLECTIVE BRAIN: Sync validated search results to Supabase
  // So other users can benefit from discovered tracks
  for (const track of tracks) {
    saveVerifiedTrack(track, undefined, 'user_search').catch(() => {
      // Silent fail - local pool is the source of truth
    });
  }
}

/**
 * Record track engagement (wire to player events)
 */
export function recordPoolEngagement(
  trackId: string,
  event: 'play' | 'skip' | 'complete' | 'react' | 'queue',
  data?: { completionRate?: number }
): void {
  const poolStore = useTrackPoolStore.getState();

  switch (event) {
    case 'play':
      poolStore.recordPlay(trackId);
      break;
    case 'skip':
      poolStore.recordSkip(trackId);
      break;
    case 'complete':
      poolStore.recordCompletion(trackId, data?.completionRate || 100);
      break;
    case 'react':
      poolStore.recordReaction(trackId);
      break;
    case 'queue':
      poolStore.recordQueue(trackId);
      break;
  }
}

/**
 * Get pool statistics for debugging
 */
export function getPoolStats(): { hot: number; cold: number; total: number; byMode: Record<VibeMode, number> } {
  const poolStore = useTrackPoolStore.getState();
  const stats = poolStore.getPoolStats();

  // Count by mode
  const byMode: Record<VibeMode, number> = {
    'afro-heat': 0,
    'chill-vibes': 0,
    'party-mode': 0,
    'late-night': 0,
    'workout': 0,
    'random-mixer': 0,
  };

  poolStore.hotPool.forEach((t) => {
    byMode[t.detectedMode] = (byMode[t.detectedMode] || 0) + 1;
  });

  return { ...stats, byMode };
}
