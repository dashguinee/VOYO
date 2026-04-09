/**
 * VOYO Music - Intent Engine
 * Captures ACTIVE user intent from MixBoard interactions
 *
 * Intent signals are STRONGER than behavior because they represent
 * what the user WANTS to hear, not just what they listened to.
 *
 * Signal Sources:
 * 1. manualBars: User's preferred vibe distribution (MixBoard taps)
 * 2. queueComposition: Tracks added to queue by mode
 * 3. dragToQueue: Modes actively dragged to queue (strongest signal!)
 * 4. modeActivity: Recent activity per mode (decay over time)
 *
 * VOYO Philosophy: Intent > Behavior
 * If user sets Party Mode to 5 bars but history is all chill,
 * we prioritize Party Mode because that's their CURRENT intent.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// TYPES
// ============================================

export type VibeMode =
  | 'afro-heat'
  | 'chill-vibes'
  | 'party-mode'
  | 'late-night'
  | 'workout'
  | 'random-mixer';

export interface ModeIntent {
  modeId: VibeMode;
  // Bar settings (0-6 scale)
  manualBars: number;
  // Queue activity
  tracksQueued: number;
  dragToQueueCount: number;
  // Time decay
  lastActivity: string;
  // Calculated intent score (0-100)
  intentScore: number;
}

export interface IntentSession {
  sessionId: string;
  startedAt: string;
  // Mode activity during this session
  modeActivity: Record<VibeMode, number>;
  // Drag-to-queue events (highest intent signal)
  dragEvents: Array<{ modeId: VibeMode; timestamp: string }>;
}

interface IntentStore {
  // Current intent state per mode
  modeIntents: Record<VibeMode, ModeIntent>;

  // Active session (resets on app close)
  currentSession: IntentSession | null;

  // Historical intent (persisted for learning)
  totalDragEvents: Record<VibeMode, number>;
  totalTracksQueued: Record<VibeMode, number>;

  // Actions - MixBoard Interactions
  setManualBars: (modeId: VibeMode, bars: number) => void;
  recordDragToQueue: (modeId: VibeMode) => void;
  recordTrackQueued: (modeId: VibeMode) => void;

  // Actions - Session Management
  startSession: () => void;
  endSession: () => void;

  // Computed - Intent Scores
  getIntentScore: (modeId: VibeMode) => number;
  getDominantModes: (limit?: number) => VibeMode[];
  getIntentWeights: () => Record<VibeMode, number>;

  // Reset
  clearIntent: () => void;
}

// ============================================
// WEIGHTS FOR INTENT SCORING
// ============================================

const INTENT_WEIGHTS = {
  MANUAL_BAR: 15,           // Each bar = 15 points (max 90)
  DRAG_TO_QUEUE: 25,        // Drag event = 25 points (strongest signal!)
  TRACK_QUEUED: 5,          // Each track queued = 5 points
  SESSION_ACTIVITY: 10,     // Recent session activity = 10 points
  TIME_DECAY: 0.9,          // Decay factor per hour of inactivity
};

// Default modes (must match VoyoPortraitPlayer)
const DEFAULT_MODES: VibeMode[] = [
  'afro-heat',
  'chill-vibes',
  'party-mode',
  'late-night',
  'workout',
  'random-mixer',
];

// ============================================
// HELPERS
// ============================================

function createDefaultModeIntent(modeId: VibeMode): ModeIntent {
  return {
    modeId,
    manualBars: 1, // Start with 1 bar each
    tracksQueued: 0,
    dragToQueueCount: 0,
    lastActivity: new Date().toISOString(),
    intentScore: 15, // Default score = 1 bar * 15
  };
}

function createDefaultSession(): IntentSession {
  return {
    sessionId: `session_${Date.now()}`,
    startedAt: new Date().toISOString(),
    modeActivity: {
      'afro-heat': 0,
      'chill-vibes': 0,
      'party-mode': 0,
      'late-night': 0,
      'workout': 0,
      'random-mixer': 0,
    },
    dragEvents: [],
  };
}

function calculateIntentScore(intent: ModeIntent, sessionActivity: number = 0): number {
  let score = 0;

  // 1. Manual bars (strongest explicit signal)
  score += intent.manualBars * INTENT_WEIGHTS.MANUAL_BAR;

  // 2. Drag-to-queue events (highest intent)
  score += intent.dragToQueueCount * INTENT_WEIGHTS.DRAG_TO_QUEUE;

  // 3. Tracks queued in this mode
  score += intent.tracksQueued * INTENT_WEIGHTS.TRACK_QUEUED;

  // 4. Session activity bonus
  score += sessionActivity * INTENT_WEIGHTS.SESSION_ACTIVITY;

  // 5. Time decay (reduce score for stale intents)
  const lastActivity = new Date(intent.lastActivity);
  const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
  if (hoursSinceActivity > 1) {
    const decayFactor = Math.pow(INTENT_WEIGHTS.TIME_DECAY, Math.floor(hoursSinceActivity));
    score *= decayFactor;
  }

  return Math.round(score);
}

// ============================================
// STORE
// ============================================

export const useIntentStore = create<IntentStore>()(
  persist(
    (set, get) => ({
      // Initial State
      modeIntents: DEFAULT_MODES.reduce((acc, modeId) => {
        acc[modeId] = createDefaultModeIntent(modeId);
        return acc;
      }, {} as Record<VibeMode, ModeIntent>),

      currentSession: null,

      totalDragEvents: DEFAULT_MODES.reduce((acc, modeId) => {
        acc[modeId] = 0;
        return acc;
      }, {} as Record<VibeMode, number>),

      totalTracksQueued: DEFAULT_MODES.reduce((acc, modeId) => {
        acc[modeId] = 0;
        return acc;
      }, {} as Record<VibeMode, number>),

      // =====================================
      // ACTIONS - MixBoard Interactions
      // =====================================

      setManualBars: (modeId: VibeMode, bars: number) => {
        const now = new Date().toISOString();

        set((state) => {
          const existing = state.modeIntents[modeId];
          const sessionActivity = state.currentSession?.modeActivity[modeId] || 0;

          const updated: ModeIntent = {
            ...existing,
            manualBars: Math.max(0, Math.min(6, bars)), // Clamp 0-6
            lastActivity: now,
            intentScore: 0, // Will be recalculated
          };

          // Recalculate score
          updated.intentScore = calculateIntentScore(updated, sessionActivity);

          // Update session activity
          const updatedSession = state.currentSession
            ? {
                ...state.currentSession,
                modeActivity: {
                  ...state.currentSession.modeActivity,
                  [modeId]: sessionActivity + 1,
                },
              }
            : null;

          return {
            modeIntents: {
              ...state.modeIntents,
              [modeId]: updated,
            },
            currentSession: updatedSession,
          };
        });
      },

      recordDragToQueue: (modeId: VibeMode) => {
        const now = new Date().toISOString();

        set((state) => {
          const existing = state.modeIntents[modeId];
          const sessionActivity = state.currentSession?.modeActivity[modeId] || 0;

          const updated: ModeIntent = {
            ...existing,
            dragToQueueCount: existing.dragToQueueCount + 1,
            lastActivity: now,
            intentScore: 0, // Will be recalculated
          };

          // Recalculate score
          updated.intentScore = calculateIntentScore(updated, sessionActivity + 1);

          // Update session
          const updatedSession = state.currentSession
            ? {
                ...state.currentSession,
                modeActivity: {
                  ...state.currentSession.modeActivity,
                  [modeId]: sessionActivity + 1,
                },
                dragEvents: [
                  ...state.currentSession.dragEvents,
                  { modeId, timestamp: now },
                ],
              }
            : null;

          return {
            modeIntents: {
              ...state.modeIntents,
              [modeId]: updated,
            },
            currentSession: updatedSession,
            totalDragEvents: {
              ...state.totalDragEvents,
              [modeId]: state.totalDragEvents[modeId] + 1,
            },
          };
        });
      },

      recordTrackQueued: (modeId: VibeMode) => {
        const now = new Date().toISOString();

        set((state) => {
          const existing = state.modeIntents[modeId];
          const sessionActivity = state.currentSession?.modeActivity[modeId] || 0;

          const updated: ModeIntent = {
            ...existing,
            tracksQueued: existing.tracksQueued + 1,
            lastActivity: now,
            intentScore: 0, // Will be recalculated
          };

          // Recalculate score
          updated.intentScore = calculateIntentScore(updated, sessionActivity);

          return {
            modeIntents: {
              ...state.modeIntents,
              [modeId]: updated,
            },
            totalTracksQueued: {
              ...state.totalTracksQueued,
              [modeId]: state.totalTracksQueued[modeId] + 1,
            },
          };
        });
      },

      // =====================================
      // ACTIONS - Session Management
      // =====================================

      startSession: () => {
        set({ currentSession: createDefaultSession() });
      },

      endSession: () => {
        // Recalculate all intent scores before ending
        set((state) => {
          const updatedIntents = { ...state.modeIntents };

          Object.keys(updatedIntents).forEach((modeId) => {
            const mode = modeId as VibeMode;
            const sessionActivity = state.currentSession?.modeActivity[mode] || 0;
            updatedIntents[mode] = {
              ...updatedIntents[mode],
              intentScore: calculateIntentScore(updatedIntents[mode], sessionActivity),
            };
          });

          return {
            modeIntents: updatedIntents,
            currentSession: null,
          };
        });
      },

      // =====================================
      // COMPUTED - Intent Scores
      // =====================================

      getIntentScore: (modeId: VibeMode) => {
        const state = get();
        const intent = state.modeIntents[modeId];
        const sessionActivity = state.currentSession?.modeActivity[modeId] || 0;
        return calculateIntentScore(intent, sessionActivity);
      },

      getDominantModes: (limit = 3) => {
        const state = get();
        const scores = DEFAULT_MODES.map((modeId) => ({
          modeId,
          score: state.getIntentScore(modeId),
        }));

        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, limit).map((s) => s.modeId);
      },

      getIntentWeights: () => {
        const state = get();
        const weights: Record<VibeMode, number> = {} as Record<VibeMode, number>;

        // Calculate total score
        let totalScore = 0;
        DEFAULT_MODES.forEach((modeId) => {
          const score = state.getIntentScore(modeId);
          weights[modeId] = score;
          totalScore += score;
        });

        // Normalize to 0-1 (relative weights)
        if (totalScore > 0) {
          DEFAULT_MODES.forEach((modeId) => {
            weights[modeId] = weights[modeId] / totalScore;
          });
        } else {
          // Equal weights if no intent data
          DEFAULT_MODES.forEach((modeId) => {
            weights[modeId] = 1 / DEFAULT_MODES.length;
          });
        }

        return weights;
      },

      // Reset
      clearIntent: () => {
        set({
          modeIntents: DEFAULT_MODES.reduce((acc, modeId) => {
            acc[modeId] = createDefaultModeIntent(modeId);
            return acc;
          }, {} as Record<VibeMode, ModeIntent>),
          currentSession: null,
          totalDragEvents: DEFAULT_MODES.reduce((acc, modeId) => {
            acc[modeId] = 0;
            return acc;
          }, {} as Record<VibeMode, number>),
          totalTracksQueued: DEFAULT_MODES.reduce((acc, modeId) => {
            acc[modeId] = 0;
            return acc;
          }, {} as Record<VibeMode, number>),
        });
      },
    }),
    {
      name: 'voyo-intent', // localStorage key
      version: 1,
    }
  )
);

// ============================================
// EXPORTS FOR PERSONALIZATION SERVICE
// ============================================

/**
 * Get mode keywords for matching tracks to modes
 * Used by personalization service to score tracks
 *
 * IMPORTANT: Keywords must match actual track data!
 * - Tags in TRACKS use 'afrobeats' (with 's')
 * - Artist names: 'burna', 'davido', 'wizkid', 'rema', 'asake', 'ayra'
 * - Moods: 'hype', 'chill', 'dance', 'rnb', 'heartbreak', 'afro'
 */
export const MODE_KEYWORDS: Record<VibeMode, string[]> = {
  // AFRO HEAT - African music energy (highest priority for African artists)
  'afro-heat': [
    'afrobeats', 'afrobeat', 'afro',  // Genre tags
    'amapiano', 'naija', 'lagos',     // Sub-genres & regions
    'burna', 'davido', 'wizkid', 'rema', 'asake', 'ayra', 'tems', 'ckay', 'tyla', // Artists
    'nigeria', 'ghana', 'african',    // Regions
  ],
  // CHILL VIBES - Relaxed, smooth listening
  'chill-vibes': [
    'chill', 'relax', 'smooth', 'slow', 'calm', // Mood
    'acoustic', 'rnb', 'r&b',                   // Genre
    'love', 'essence', 'vibe',                  // Common chill words
  ],
  // PARTY MODE - High energy, danceable
  'party-mode': [
    'party', 'club', 'dance',         // Direct party keywords
    'turn up', 'lit', 'banger',       // Slang
    'hype', 'energy',                 // Mood (shared with workout but party takes precedence)
    'mix', 'dj',                      // Mix/DJ content
  ],
  // LATE NIGHT - Moody, atmospheric
  'late-night': [
    'night', 'late', 'midnight',      // Time
    'dark', 'moody', 'feels',         // Mood
    'heartbreak', 'sad', 'emotional', // Emotional
    'last last',                      // Specific tracks with late night vibe
  ],
  // WORKOUT - Pump up energy
  'workout': [
    'workout', 'gym', 'fitness',      // Direct workout
    'pump', 'run', 'motivation',      // Action
    'power', 'beast', 'grind',        // Energy words
  ],
  // RANDOM MIXER - No filtering, pure random
  'random-mixer': [],
};

/**
 * Match a track to a vibe mode based on its metadata
 * Returns the best matching mode or 'random-mixer' if no match
 */
export function matchTrackToMode(track: { title: string; artist: string; tags?: string[]; mood?: string }): VibeMode {
  const searchText = `${track.title} ${track.artist} ${track.tags?.join(' ') || ''} ${track.mood || ''}`.toLowerCase();

  let bestMatch: VibeMode = 'random-mixer';
  let bestScore = 0;

  (Object.entries(MODE_KEYWORDS) as [VibeMode, string[]][]).forEach(([modeId, keywords]) => {
    if (keywords.length === 0) return; // Skip random-mixer

    let score = 0;
    keywords.forEach((keyword) => {
      if (searchText.includes(keyword.toLowerCase())) {
        score += 1;
      }
    });

    if (score > bestScore) {
      bestScore = score;
      bestMatch = modeId;
    }
  });

  return bestMatch;
}
