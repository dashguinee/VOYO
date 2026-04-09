/**
 * VOYO Music - Preference Engine
 * localStorage-first personalization system
 *
 * Tracks:
 * - Listen duration (completion rate)
 * - Skip patterns (context-aware)
 * - Reactions (OYÉ score)
 * - Explicit likes/dislikes
 *
 * Learns from behavior to personalize HOT and DISCOVERY zones
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// TYPES
// ============================================

export interface TrackPreference {
  trackId: string;
  // Listen behavior
  totalListens: number;
  totalDuration: number; // Total seconds listened
  completions: number; // Times played >80%
  skips: number; // Times skipped <20%

  // User actions
  reactions: number; // OYÉ reactions given
  explicitLike?: boolean; // User explicitly liked/disliked

  // Metadata
  lastPlayedAt: string;
  createdAt: string;
}

export interface ArtistPreference {
  artist: string;
  totalListens: number;
  avgCompletion: number; // 0-100
  reactions: number;
  lastPlayedAt: string;
}

export interface TagPreference {
  tag: string;
  totalListens: number;
  avgCompletion: number;
  reactions: number;
  lastPlayedAt: string;
}

export interface MoodPreference {
  mood: string;
  totalListens: number;
  avgCompletion: number;
  reactions: number;
  lastPlayedAt: string;
}

export interface ListenSession {
  trackId: string;
  startedAt: string;
  endedAt?: string;
  duration: number;
  completed: boolean; // >80% played
  skipped: boolean; // <20% played
  reactions: number;
}

interface PreferenceStore {
  // Core preference data
  trackPreferences: Record<string, TrackPreference>;
  artistPreferences: Record<string, ArtistPreference>;
  tagPreferences: Record<string, TagPreference>;
  moodPreferences: Record<string, MoodPreference>;

  // Active session tracking
  currentSession: ListenSession | null;

  // Actions
  startListenSession: (trackId: string, totalDuration?: number) => void;
  endListenSession: (duration: number, reactions: number) => void;
  recordSkip: (trackId: string, listenDuration: number) => void;
  recordCompletion: (trackId: string, duration: number, reactions: number) => void;
  recordReaction: (trackId: string) => void;
  setExplicitLike: (trackId: string, liked: boolean) => void;

  // Analytics
  getTrackPreference: (trackId: string) => TrackPreference | null;

  // Clear data
  clearPreferences: () => void;
}

// ============================================
// HELPERS
// ============================================

const calculateCompletionRate = (pref: TrackPreference): number => {
  if (pref.totalListens === 0) return 0;
  return (pref.completions / pref.totalListens) * 100;
};

// ============================================
// STORE
// ============================================

export const usePreferenceStore = create<PreferenceStore>()(
  persist(
    (set, get) => ({
      // Initial State
      trackPreferences: {},
      artistPreferences: {},
      tagPreferences: {},
      moodPreferences: {},
      currentSession: null,

      // Start tracking a listen session
      startListenSession: (trackId: string, totalDuration: number = 0) => {
        const now = new Date().toISOString();

        set({
          currentSession: {
            trackId,
            startedAt: now,
            duration: totalDuration, // Total track duration for completion check
            completed: false,
            skipped: false,
            reactions: 0,
          },
        });
      },

      // End listen session (normal completion or navigation away)
      endListenSession: (duration: number, reactions: number = 0) => {
        const { currentSession } = get();
        if (!currentSession) return;

        const now = new Date().toISOString();
        const completed = duration >= currentSession.duration * 0.8; // 80% threshold
        const skipped = duration < currentSession.duration * 0.2; // 20% threshold

        // Update session
        set({
          currentSession: {
            ...currentSession,
            endedAt: now,
            duration,
            completed,
            skipped,
            reactions,
          },
        });

        // Record the listen
        if (completed) {
          get().recordCompletion(currentSession.trackId, duration, reactions);
        } else if (skipped) {
          get().recordSkip(currentSession.trackId, duration);
        }

        // Clear session
        set({ currentSession: null });
      },

      // Record a skip (<20% played)
      recordSkip: (trackId: string, listenDuration: number) => {
        const now = new Date().toISOString();

        set((state) => {
          const existing = state.trackPreferences[trackId];

          const updated: TrackPreference = existing
            ? {
                ...existing,
                totalListens: existing.totalListens + 1,
                totalDuration: existing.totalDuration + listenDuration,
                skips: existing.skips + 1,
                lastPlayedAt: now,
              }
            : {
                trackId,
                totalListens: 1,
                totalDuration: listenDuration,
                completions: 0,
                skips: 1,
                reactions: 0,
                lastPlayedAt: now,
                createdAt: now,
              };

          return {
            trackPreferences: {
              ...state.trackPreferences,
              [trackId]: updated,
            },
          };
        });

        // CONNECT: Feed skip to trackPoolStore for pool scoring
        import('./trackPoolStore').then(({ useTrackPoolStore }) => {
          useTrackPoolStore.getState().recordSkip(trackId);
        }).catch(() => {});
      },

      // Record a completion (>80% played)
      recordCompletion: (trackId: string, duration: number, reactions: number = 0) => {
        const now = new Date().toISOString();

        set((state) => {
          const existing = state.trackPreferences[trackId];

          const updated: TrackPreference = existing
            ? {
                ...existing,
                totalListens: existing.totalListens + 1,
                totalDuration: existing.totalDuration + duration,
                completions: existing.completions + 1,
                reactions: existing.reactions + reactions,
                lastPlayedAt: now,
              }
            : {
                trackId,
                totalListens: 1,
                totalDuration: duration,
                completions: 1,
                skips: 0,
                reactions,
                lastPlayedAt: now,
                createdAt: now,
              };

          return {
            trackPreferences: {
              ...state.trackPreferences,
              [trackId]: updated,
            },
          };
        });

        // CONNECT: Feed completion to trackPoolStore for pool scoring
        import('./trackPoolStore').then(({ useTrackPoolStore }) => {
          useTrackPoolStore.getState().recordCompletion(trackId, 100); // 100% completion rate
        }).catch(() => {});
      },

      // Record a reaction (OYÉ button pressed during playback)
      recordReaction: (trackId: string) => {
        set((state) => {
          const existing = state.trackPreferences[trackId];
          if (!existing) return state;

          const updated: TrackPreference = {
            ...existing,
            reactions: existing.reactions + 1,
          };

          // Also update current session if it matches
          const updatedSession = state.currentSession?.trackId === trackId && state.currentSession
            ? {
                ...state.currentSession,
                reactions: state.currentSession.reactions + 1,
              }
            : state.currentSession;

          return {
            trackPreferences: {
              ...state.trackPreferences,
              [trackId]: updated,
            },
            currentSession: updatedSession,
          };
        });

        // CONNECT: Feed reaction to trackPoolStore for pool scoring
        import('./trackPoolStore').then(({ useTrackPoolStore }) => {
          useTrackPoolStore.getState().recordReaction(trackId);
        }).catch(() => {});
      },

      // Explicit like/dislike (user pressed thumbs up/down)
      setExplicitLike: (trackId: string, liked: boolean) => {
        const now = new Date().toISOString();

        set((state) => {
          const existing = state.trackPreferences[trackId];

          const updated: TrackPreference = existing
            ? {
                ...existing,
                explicitLike: liked,
                lastPlayedAt: now,
              }
            : {
                trackId,
                totalListens: 0,
                totalDuration: 0,
                completions: 0,
                skips: 0,
                reactions: 0,
                explicitLike: liked,
                lastPlayedAt: now,
                createdAt: now,
              };


          return {
            trackPreferences: {
              ...state.trackPreferences,
              [trackId]: updated,
            },
          };
        });

        // Auto-sync to cloud when logged in (debounced)
        setTimeout(async () => {
          try {
            const { useUniverseStore } = await import('./universeStore');
            const universeStore = useUniverseStore.getState();
            if (universeStore.isLoggedIn) {
              universeStore.syncToCloud();
            }
          } catch {
            // Ignore sync errors
          }
        }, 500);
      },

      // Get track preference
      getTrackPreference: (trackId: string) => {
        return get().trackPreferences[trackId] || null;
      },

      // Clear all preferences (reset)
      clearPreferences: () => {
        set({
          trackPreferences: {},
          artistPreferences: {},
          tagPreferences: {},
          moodPreferences: {},
          currentSession: null,
        });
      },
    }),
    {
      name: 'voyo-preferences', // localStorage key
      version: 1,
    }
  )
);
