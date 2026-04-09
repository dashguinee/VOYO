/**
 * VOYO Brain - Store Integration
 *
 * Wires Brain signals to existing stores without modifying them directly.
 * This file subscribes to store changes and emits appropriate signals.
 *
 * Integration points:
 * 1. PlayerStore - Playback signals (play, skip, complete, etc.)
 * 2. IntentStore - MixBoard signals (bar changes, mode taps)
 * 3. PreferenceStore - Reaction signals (OYE, love, dislike)
 * 4. TrackPoolStore - Pool state signals
 * 5. ReactionStore - OYE reactions
 *
 * Philosophy: Observe and emit, don't modify behavior
 */

import { signals } from './SignalEmitter';
import { signalBuffer } from './SignalBuffer';
import { voyoBrain } from './VoyoBrain';
import { sessionExecutor } from './SessionExecutor';
import { youtubeInterceptor } from './YouTubeInterceptor';
import { usePlayerStore } from '../store/playerStore';
import { useIntentStore, VibeMode } from '../store/intentStore';
import { usePreferenceStore } from '../store/preferenceStore';
import { useReactionStore } from '../store/reactionStore';
import { Track } from '../types';

// ============================================
// TYPES
// ============================================

interface IntegrationState {
  initialized: boolean;
  lastTrackId: string | null;
  lastPlayState: boolean;
  lastProgress: number;
  lastModeSettings: Record<VibeMode, number>;
  sessionStartTime: number;
  skipCount: number;
  completeCount: number;
  oyeCount: number;
}

// ============================================
// STATE
// ============================================

let state: IntegrationState = {
  initialized: false,
  lastTrackId: null,
  lastPlayState: false,
  lastProgress: 0,
  lastModeSettings: {} as Record<VibeMode, number>,
  sessionStartTime: Date.now(),
  skipCount: 0,
  completeCount: 0,
  oyeCount: 0
};

// Track consecutive patterns
let consecutiveSkips = 0;
let consecutiveCompletes = 0;
let consecutiveOyes = 0;

// ============================================
// HELPER: Extract track info
// ============================================

function getTrackInfo(track: Track | null): { trackId: string; videoId: string; artist: string; title: string } | null {
  if (!track) return null;
  return {
    trackId: track.id || track.trackId || '',
    videoId: track.trackId || track.id || '',
    artist: track.artist || '',
    title: track.title || ''
  };
}

// ============================================
// PLAYER STORE INTEGRATION
// ============================================

function setupPlayerStoreIntegration(): () => void {
  console.log('[Brain] Setting up PlayerStore integration');

  return usePlayerStore.subscribe((newState, prevState) => {
    const newTrack = newState.currentTrack;
    const prevTrack = prevState.currentTrack;
    const newTrackId = newTrack?.id || newTrack?.trackId;
    const prevTrackId = prevTrack?.id || prevTrack?.trackId;

    // Track change detection
    if (newTrackId !== prevTrackId && newTrack) {
      const info = getTrackInfo(newTrack);
      if (info) {
        // Determine if previous track was skipped or completed
        if (prevTrack && prevState.duration > 0) {
          const completionRate = (prevState.currentTime / prevState.duration) * 100;
          const prevInfo = getTrackInfo(prevTrack);

          if (prevInfo) {
            if (completionRate < 30) {
              // Skip
              signals.skip({
                ...prevInfo,
                completionRate,
                position: prevState.currentTime
              });
              consecutiveSkips++;
              consecutiveCompletes = 0;
              consecutiveOyes = 0;
              state.skipCount++;

              // Emit skip streak if applicable
              if (consecutiveSkips >= 3) {
                signals.skipStreak(consecutiveSkips, [prevInfo.trackId]);
              }
            } else {
              // Complete
              signals.complete({
                ...prevInfo,
                duration: prevState.duration
              });
              consecutiveCompletes++;
              consecutiveSkips = 0;
              state.completeCount++;

              // Emit complete streak if applicable
              if (consecutiveCompletes >= 3) {
                signals.completeStreak(consecutiveCompletes, [prevInfo.trackId]);
              }
            }
          }
        }

        // Emit play for new track
        signals.play(info);
        state.lastTrackId = newTrackId || null;
      }
    }

    // Play/Pause detection
    if (newState.isPlaying !== prevState.isPlaying && newTrack) {
      const info = getTrackInfo(newTrack);
      if (info) {
        if (newState.isPlaying && !prevState.isPlaying) {
          // Resume (not initial play)
          if (newState.currentTime > 0) {
            signals.resume({ ...info, position: newState.currentTime });
          }
        } else if (!newState.isPlaying && prevState.isPlaying) {
          // Pause
          signals.pause({ ...info, position: newState.currentTime });
        }
      }
    }

    // Seek detection
    if (Math.abs(newState.currentTime - prevState.currentTime) > 5 && newTrack) {
      const info = getTrackInfo(newTrack);
      if (info && prevState.currentTime > 0) {
        if (newState.currentTime > prevState.currentTime) {
          signals.seek({ ...info, position: newState.currentTime });
        } else {
          signals.seekBack({ ...info, position: newState.currentTime });
        }
      }
    }

    // Queue changes
    if (newState.queue.length !== prevState.queue.length) {
      if (newState.queue.length > prevState.queue.length) {
        // Track added to queue
        const addedItem = newState.queue[newState.queue.length - 1];
        if (addedItem) {
          const info = getTrackInfo(addedItem.track);
          if (info) {
            signals.queueAdd({ ...info, queueLength: newState.queue.length });
          }
        }
      } else if (newState.queue.length < prevState.queue.length && newState.queue.length === 0) {
        // Queue cleared
        signals.queueClear(prevState.queue.length);
      }
    }

    state.lastPlayState = newState.isPlaying;
    state.lastProgress = newState.progress;
  });
}

// ============================================
// INTENT STORE INTEGRATION
// ============================================

function setupIntentStoreIntegration(): () => void {
  console.log('[Brain] Setting up IntentStore integration');

  // Initialize last mode settings
  const modes: VibeMode[] = ['afro-heat', 'chill-vibes', 'party-mode', 'late-night', 'workout', 'random-mixer'];
  modes.forEach(m => state.lastModeSettings[m] = 1);

  return useIntentStore.subscribe((newState, prevState) => {
    // Detect bar changes
    modes.forEach(modeId => {
      const newBars = newState.modeIntents[modeId]?.manualBars || 1;
      const prevBars = prevState.modeIntents[modeId]?.manualBars || 1;

      if (newBars !== prevBars) {
        signals.barChange(modeId, prevBars, newBars);
        state.lastModeSettings[modeId] = newBars;
      }
    });

    // Detect drag to queue events
    modes.forEach(modeId => {
      const newDrags = newState.modeIntents[modeId]?.dragToQueueCount || 0;
      const prevDrags = prevState.modeIntents[modeId]?.dragToQueueCount || 0;

      if (newDrags > prevDrags) {
        signals.dragToQueue(modeId);
      }
    });

    // Detect session changes
    if (newState.currentSession && !prevState.currentSession) {
      // New session started
      signals.emit('session_start', { value: newState.currentSession.sessionId });
    }
  });
}

// ============================================
// PREFERENCE STORE INTEGRATION
// ============================================

function setupPreferenceStoreIntegration(): () => void {
  console.log('[Brain] Setting up PreferenceStore integration');

  return usePreferenceStore.subscribe((newState, prevState) => {
    // Detect explicit likes
    Object.keys(newState.trackPreferences).forEach(trackId => {
      const newPref = newState.trackPreferences[trackId];
      const prevPref = prevState.trackPreferences[trackId];

      if (newPref && (!prevPref || newPref.explicitLike !== prevPref.explicitLike)) {
        if (newPref.explicitLike === true) {
          signals.love({ trackId, videoId: trackId });
        } else if (newPref.explicitLike === false) {
          signals.dislike({ trackId, videoId: trackId });
        }
      }
    });
  });
}

// ============================================
// REACTION STORE INTEGRATION
// ============================================

function setupReactionStoreIntegration(): () => void {
  console.log('[Brain] Setting up ReactionStore integration');

  return useReactionStore.subscribe((newState, prevState) => {
    // Detect new reactions using Map
    newState.trackReactions.forEach((newReactions, trackId) => {
      const prevReactions = prevState.trackReactions.get(trackId);

      if (newReactions) {
        // Detect OYE increases (reactions with type 'oye')
        const newOyeCount = newReactions.filter(r => r.reaction_type === 'oye').length;
        const prevOyeCount = prevReactions?.filter(r => r.reaction_type === 'oye').length || 0;

        if (newOyeCount > prevOyeCount) {
          const latestOye = newReactions.filter(r => r.reaction_type === 'oye').pop();
          signals.oye({ trackId, videoId: trackId });

          if (latestOye?.track_position !== undefined) {
            signals.oyePosition({ trackId, videoId: trackId, position: latestOye.track_position });
          }

          consecutiveOyes++;
          state.oyeCount++;

          if (consecutiveOyes >= 3) {
            signals.oyeStreak(consecutiveOyes, [trackId]);
          }
        }

        // Detect love changes (reactions with type 'like')
        const hasLove = newReactions.some(r => r.reaction_type === 'like');
        const hadLove = prevReactions?.some(r => r.reaction_type === 'like') || false;

        if (hasLove && !hadLove) {
          signals.love({ trackId, videoId: trackId });
        } else if (!hasLove && hadLove) {
          signals.unlove({ trackId, videoId: trackId });
        }
      }
    });
  });
}

// ============================================
// CONTEXT TRACKING
// ============================================

function setupContextTracking(): () => void {
  console.log('[Brain] Setting up context tracking');

  // Track time of day
  const updateTimeContext = () => {
    const hour = new Date().getHours();
    const timeOfDay = hour < 6 ? 'late_night'
      : hour < 12 ? 'morning'
      : hour < 18 ? 'afternoon'
      : 'evening';

    signals.contextChange('time_of_day', timeOfDay);
  };

  // Update every 30 minutes
  const intervalId = setInterval(updateTimeContext, 30 * 60 * 1000);
  updateTimeContext(); // Initial

  // Track day of week
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  signals.contextChange('day_of_week', days[new Date().getDay()]);

  return () => clearInterval(intervalId);
}

// ============================================
// BRAIN OUTPUT HANDLER
// ============================================

function setupBrainOutputHandler(): void {
  console.log('[Brain] Setting up Brain output handler');

  // When Brain produces output, load it into executor
  signalBuffer.onBrainTrigger(async (summary) => {
    console.log('[Brain] Triggering curation with', summary.signalCount, 'signals');

    try {
      const output = await voyoBrain.forceCurate();
      if (output) {
        sessionExecutor.loadBrainOutput(output);
        console.log('[Brain] Loaded session:', output.sessionName);
      }
    } catch (err) {
      console.error('[Brain] Curation failed:', err);
    }
  });
}

// ============================================
// MAIN INITIALIZATION
// ============================================

let unsubscribers: Array<() => void> = [];

/**
 * Initialize Brain integration with all stores
 */
export function initializeBrainIntegration(): void {
  if (state.initialized) {
    console.log('[Brain] Already initialized');
    return;
  }

  console.log('[Brain] Initializing integration...');

  // Setup all integrations
  unsubscribers.push(setupPlayerStoreIntegration());
  unsubscribers.push(setupIntentStoreIntegration());
  unsubscribers.push(setupPreferenceStoreIntegration());
  unsubscribers.push(setupReactionStoreIntegration());
  unsubscribers.push(setupContextTracking());

  // Setup Brain output handler
  setupBrainOutputHandler();

  // Start new session
  signals.newSession();
  state.sessionStartTime = Date.now();
  state.initialized = true;

  console.log('[Brain] Integration complete, session:', signals.getSessionId());
}

/**
 * Cleanup Brain integration
 */
export function cleanupBrainIntegration(): void {
  console.log('[Brain] Cleaning up integration');

  // Unsubscribe from all stores
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];

  // Emit session end
  const sessionLength = Math.floor((Date.now() - state.sessionStartTime) / 1000);
  signals.sessionEnd(sessionLength);

  // Reset state
  state = {
    initialized: false,
    lastTrackId: null,
    lastPlayState: false,
    lastProgress: 0,
    lastModeSettings: {} as Record<VibeMode, number>,
    sessionStartTime: Date.now(),
    skipCount: 0,
    completeCount: 0,
    oyeCount: 0
  };

  sessionExecutor.reset();
  signalBuffer.clearBuffer();
  youtubeInterceptor.reset();
}

/**
 * Get integration stats
 */
export function getBrainStats(): {
  sessionId: string;
  sessionDuration: number;
  signalsEmitted: number;
  skips: number;
  completes: number;
  oyes: number;
} {
  return {
    sessionId: signals.getSessionId(),
    sessionDuration: Math.floor((Date.now() - state.sessionStartTime) / 1000),
    signalsEmitted: signals.getSignalCount(),
    skips: state.skipCount,
    completes: state.completeCount,
    oyes: state.oyeCount
  };
}

// Export state for debugging
export const brainIntegration = {
  initialize: initializeBrainIntegration,
  cleanup: cleanupBrainIntegration,
  getStats: getBrainStats,
  isInitialized: () => state.initialized
};

export default brainIntegration;
