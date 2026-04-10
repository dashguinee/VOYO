/**
 * VOYO Essence Engine
 *
 * Extracts the user's VIBE FINGERPRINT from all signals:
 * - Past plays (what they listened to)
 * - Completions vs skips (what they REALLY liked)
 * - Reactions (OYÉ, Fire, Like)
 * - MixBoard intent (what they WANT)
 * - Time patterns (when they listen)
 *
 * VIBES FIRST - Not genre, not popularity. VIBES.
 *
 * The essence is used to query 324K tracks that MATCH the user's vibe,
 * whether those tracks are hot or niche doesn't matter.
 */

import { useIntentStore, type VibeMode } from '../store/intentStore';
import { usePreferenceStore } from '../store/preferenceStore';
import { useReactionStore, type ReactionCategory } from '../store/reactionStore';
import { devLog } from '../utils/logger';

// ============================================
// TYPES
// ============================================

export interface VibeEssence {
  // Core vibe weights (0-1, sum to 1)
  afro_heat: number;
  chill: number;
  party: number;
  workout: number;
  late_night: number;

  // Dominant vibes (top 2-3)
  dominantVibes: string[];

  // Discovery hints (cross-genre expansion)
  discoveryHints: DiscoveryHint[];

  // Repeat ratio preference
  freshToFamiliarRatio: number; // 0.7 = 70% fresh, 30% familiar

  // Time context
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';

  // Confidence (how much signal data we have)
  confidence: number; // 0-1
}

export interface DiscoveryHint {
  vibe: string;
  reason: string;
  weight: number;
}

// Map MixBoard modes to DB vibe names
const MODE_TO_VIBE: Record<VibeMode, string> = {
  'afro-heat': 'afro_heat',
  'chill-vibes': 'chill',
  'party-mode': 'party',
  'workout': 'workout',
  'late-night': 'late_night',
  'random-mixer': 'random', // Special case
};

// Map reaction categories to vibe names
const CATEGORY_TO_VIBE: Record<ReactionCategory, string> = {
  'afro-heat': 'afro_heat',
  'chill-vibes': 'chill',
  'party-mode': 'party',
  'workout': 'workout',
  'late-night': 'late_night',
};

// ============================================
// SIGNAL WEIGHTS
// ============================================

const SIGNAL_WEIGHTS = {
  // Intent signals (what user WANTS) - 40%
  MIXBOARD_BAR: 0.08,      // Per bar (max 6 bars = 0.48)
  DRAG_TO_QUEUE: 0.15,     // Strong intent signal

  // Behavior signals (what user DID) - 40%
  COMPLETION: 0.10,        // Finished >80% of track
  REACTION: 0.08,          // OYÉ, Fire, Like
  PLAY_COUNT: 0.02,        // Per play (diminishing returns)

  // Negative signals
  SKIP: -0.05,             // Skipped <30%

  // Time decay
  RECENCY_HALF_LIFE: 7,    // Days until signal strength halves
};

// ============================================
// ESSENCE EXTRACTION
// ============================================

/**
 * Get current time of day context
 */
function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Apply time decay to a signal based on when it occurred
 */
function applyTimeDecay(value: number, timestamp: string | Date): number {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const daysSince = (now - then) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.pow(0.5, daysSince / SIGNAL_WEIGHTS.RECENCY_HALF_LIFE);
  return value * decayFactor;
}

/**
 * Extract vibe weights from MixBoard intent
 */
function extractIntentSignals(): Record<string, number> {
  const intentStore = useIntentStore.getState();
  const weights: Record<string, number> = {
    afro_heat: 0,
    chill: 0,
    party: 0,
    workout: 0,
    late_night: 0,
  };

  // Get intent scores for each mode
  Object.entries(MODE_TO_VIBE).forEach(([mode, vibe]) => {
    if (vibe === 'random') return; // Skip random mixer

    const modeIntent = intentStore.modeIntents[mode as VibeMode];
    if (!modeIntent) return;

    // Bars contribute (0-6 bars)
    weights[vibe] += modeIntent.manualBars * SIGNAL_WEIGHTS.MIXBOARD_BAR;

    // Drag events contribute with time decay
    weights[vibe] += modeIntent.dragToQueueCount * SIGNAL_WEIGHTS.DRAG_TO_QUEUE;
  });

  return weights;
}

/**
 * Extract vibe weights from reaction history
 */
function extractReactionSignals(): Record<string, number> {
  const reactionStore = useReactionStore.getState();
  const weights: Record<string, number> = {
    afro_heat: 0,
    chill: 0,
    party: 0,
    workout: 0,
    late_night: 0,
  };

  // Get category preferences from reactions
  const prefs = reactionStore.userCategoryPreferences;

  Object.entries(CATEGORY_TO_VIBE).forEach(([category, vibe]) => {
    const pref = prefs[category as ReactionCategory];
    if (!pref) return;

    // Reactions contribute
    const reactionWeight =
      (pref.likeCount * SIGNAL_WEIGHTS.REACTION) +
      (pref.oyeCount * SIGNAL_WEIGHTS.REACTION * 1.5) + // OYÉ is stronger
      (pref.fireCount * SIGNAL_WEIGHTS.REACTION * 1.2);

    weights[vibe] += reactionWeight;
  });

  return weights;
}

/**
 * Extract vibe weights from listening behavior (completions, skips)
 */
function extractBehaviorSignals(): Record<string, number> {
  const prefStore = usePreferenceStore.getState();
  const weights: Record<string, number> = {
    afro_heat: 0,
    chill: 0,
    party: 0,
    workout: 0,
    late_night: 0,
  };

  // Get track preferences
  const trackPrefs = prefStore.trackPreferences || {};

  Object.entries(trackPrefs).forEach(([trackId, pref]) => {
    // For now, distribute behavior signals across dominant modes
    // This would be enhanced with actual track vibe data from DB
    const dominantModes = useIntentStore.getState().getDominantModes(2);

    dominantModes.forEach(mode => {
      const vibe = MODE_TO_VIBE[mode];
      if (!vibe || vibe === 'random') return;

      // Completions are positive
      if (pref.completions > 0) {
        const completionRate = pref.totalListens > 0 ? pref.completions / pref.totalListens : 0;
        if (completionRate > 0.5) {
          weights[vibe] += SIGNAL_WEIGHTS.COMPLETION * pref.completions;
        }
      }

      // Skips are negative
      if (pref.skips > 0) {
        weights[vibe] += SIGNAL_WEIGHTS.SKIP * pref.skips;
      }

      // Play count (diminishing returns)
      weights[vibe] += Math.log2(1 + pref.totalListens) * SIGNAL_WEIGHTS.PLAY_COUNT;
    });
  });

  return weights;
}

/**
 * Generate discovery hints based on vibe patterns
 */
function generateDiscoveryHints(dominantVibes: string[]): DiscoveryHint[] {
  const hints: DiscoveryHint[] = [];

  // Cross-vibe discovery patterns
  const VIBE_EXPANSIONS: Record<string, Array<{ vibe: string; reason: string }>> = {
    'afro_heat': [
      { vibe: 'party', reason: 'High energy crossover' },
      { vibe: 'chill', reason: 'Afro-soul, slower grooves' },
    ],
    'chill': [
      { vibe: 'late_night', reason: 'Moody, atmospheric' },
      { vibe: 'afro_heat', reason: 'Smooth afrobeats' },
    ],
    'party': [
      { vibe: 'afro_heat', reason: 'Afro party anthems' },
      { vibe: 'workout', reason: 'High energy crossover' },
    ],
    'workout': [
      { vibe: 'party', reason: 'Pump up energy' },
      { vibe: 'afro_heat', reason: 'Motivational afrobeats' },
    ],
    'late_night': [
      { vibe: 'chill', reason: 'Smooth night vibes' },
      { vibe: 'afro_heat', reason: 'Slow burns' },
    ],
  };

  dominantVibes.forEach((vibe, index) => {
    const expansions = VIBE_EXPANSIONS[vibe] || [];
    expansions.forEach(exp => {
      // Don't suggest what's already dominant
      if (!dominantVibes.includes(exp.vibe)) {
        hints.push({
          vibe: exp.vibe,
          reason: exp.reason,
          weight: 0.3 - (index * 0.1), // First dominant gets higher weight
        });
      }
    });
  });

  return hints.slice(0, 3); // Top 3 hints
}

/**
 * Calculate confidence based on signal volume
 */
function calculateConfidence(
  intentSignals: Record<string, number>,
  reactionSignals: Record<string, number>,
  behaviorSignals: Record<string, number>
): number {
  const totalIntent = Object.values(intentSignals).reduce((a, b) => a + b, 0);
  const totalReactions = Object.values(reactionSignals).reduce((a, b) => a + b, 0);
  const totalBehavior = Object.values(behaviorSignals).reduce((a, b) => a + b, 0);

  // More signals = higher confidence
  const signalVolume = totalIntent + totalReactions + totalBehavior;

  // Confidence curve: 0 signals = 0.1, 10+ signals = 0.9
  return Math.min(0.9, 0.1 + (signalVolume / 12));
}

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Extract the user's complete vibe essence
 *
 * This is the VIBE FINGERPRINT used to query tracks.
 */
export function getVibeEssence(): VibeEssence {
  // Extract signals from all sources
  const intentSignals = extractIntentSignals();
  const reactionSignals = extractReactionSignals();
  const behaviorSignals = extractBehaviorSignals();

  // Combine all signals
  const combined: Record<string, number> = {
    afro_heat: 0,
    chill: 0,
    party: 0,
    workout: 0,
    late_night: 0,
  };

  // Weight: Intent 40%, Reactions 30%, Behavior 30%
  Object.keys(combined).forEach(vibe => {
    combined[vibe] =
      (intentSignals[vibe] || 0) * 0.4 +
      (reactionSignals[vibe] || 0) * 0.3 +
      (behaviorSignals[vibe] || 0) * 0.3;
  });

  // Normalize to sum to 1
  const total = Object.values(combined).reduce((a, b) => a + Math.max(0, b), 0);

  if (total > 0) {
    Object.keys(combined).forEach(vibe => {
      combined[vibe] = Math.max(0, combined[vibe]) / total;
    });
  } else {
    // Default: equal distribution with slight afro bias
    combined.afro_heat = 0.3;
    combined.chill = 0.2;
    combined.party = 0.2;
    combined.workout = 0.15;
    combined.late_night = 0.15;
  }

  // Get dominant vibes (top 2-3 with >15% weight)
  const dominantVibes = Object.entries(combined)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, weight]) => weight > 0.15)
    .slice(0, 3)
    .map(([vibe]) => vibe);

  // Generate discovery hints
  const discoveryHints = generateDiscoveryHints(dominantVibes);

  // Calculate confidence
  const confidence = calculateConfidence(intentSignals, reactionSignals, behaviorSignals);

  // Determine fresh/familiar ratio based on discovery hints and confidence
  // New users get more familiar, experienced users get more fresh
  const freshToFamiliarRatio = 0.6 + (confidence * 0.2); // 0.6-0.8

  return {
    afro_heat: combined.afro_heat,
    chill: combined.chill,
    party: combined.party,
    workout: combined.workout,
    late_night: combined.late_night,
    dominantVibes,
    discoveryHints,
    freshToFamiliarRatio,
    timeOfDay: getTimeOfDay(),
    confidence,
  };
}

/**
 * Get essence as query-ready format for Supabase RPC
 */
export function getEssenceForQuery(): {
  vibeWeights: Record<string, number>;
  dominantVibes: string[];
  timeOfDay: string;
  freshRatio: number;
} {
  const essence = getVibeEssence();

  return {
    vibeWeights: {
      afro_heat: essence.afro_heat,
      chill: essence.chill,
      party: essence.party,
      workout: essence.workout,
      late_night: essence.late_night,
    },
    dominantVibes: essence.dominantVibes,
    timeOfDay: essence.timeOfDay,
    freshRatio: essence.freshToFamiliarRatio,
  };
}

/**
 * Debug: Log current essence to console
 */
export function debugEssence(): void {
  const essence = getVibeEssence();
  devLog('[VOYO Essence]', {
    vibes: {
      afro_heat: `${(essence.afro_heat * 100).toFixed(1)}%`,
      chill: `${(essence.chill * 100).toFixed(1)}%`,
      party: `${(essence.party * 100).toFixed(1)}%`,
      workout: `${(essence.workout * 100).toFixed(1)}%`,
      late_night: `${(essence.late_night * 100).toFixed(1)}%`,
    },
    dominant: essence.dominantVibes,
    hints: essence.discoveryHints.map(h => `${h.vibe}: ${h.reason}`),
    confidence: `${(essence.confidence * 100).toFixed(0)}%`,
    timeOfDay: essence.timeOfDay,
  });
}
