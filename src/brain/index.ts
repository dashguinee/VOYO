/**
 * VOYO Brain - Central Intelligence Module
 *
 * The Brain is the central nervous system of VOYO's recommendation engine.
 * It captures all user signals, processes them through Gemini, and executes
 * personalized DJ sessions.
 *
 * Architecture:
 * - SignalEmitter: Captures 60+ signal types from user interactions
 * - SignalBuffer: Accumulates signals and triggers Brain when conditions met
 * - VoyoBrain: Gemini-powered curation (ONE call = ~105 tracks)
 * - YouTubeInterceptor: Captures free intelligence from YouTube recommendations
 * - SessionExecutor: Local math execution of Brain's decisions
 *
 * Philosophy: Brain sets DIRECTION, Math handles SPEED
 *
 * Usage:
 * ```typescript
 * import { brain } from './brain';
 *
 * // Emit signals from anywhere in the app
 * brain.signals.play({ trackId, videoId, artist, title });
 * brain.signals.skip({ trackId, videoId, artist, title, completionRate: 15 });
 * brain.signals.oye({ trackId, videoId });
 *
 * // Get next track
 * const next = brain.executor.getNextTrack();
 *
 * // Check if mix should be inserted
 * const mix = brain.executor.shouldInsertMix();
 *
 * // Capture YouTube recommendations
 * brain.interceptor.captureRecommendations(sourceTrackId, relatedVideos);
 * ```
 */

// Export all components
export { signals } from './SignalEmitter';
export type {
  SignalType,
  SignalPayload,
  PlaybackSignal,
  ReactionSignal,
  MixBoardSignal,
  QueueSignal,
  DiscoverySignal,
  SocialSignal,
  ContextSignal,
  EngagementPattern,
  BoostSignal,
  MixSignal,
  YouTubeSignal,
  PlaybackPayload,
  ReactionPayload,
  MixBoardPayload,
  QueuePayload,
  DiscoveryPayload,
  SocialPayload,
  ContextPayload,
  EngagementPayload,
  BoostPayload,
  MixPayload,
  YouTubePayload
} from './SignalEmitter';

export { signalBuffer } from './SignalBuffer';
export type { SignalSummary, TriggerCondition, BrainTrigger, BufferedSignal } from './SignalBuffer';

export { voyoBrain } from './VoyoBrain';
export type {
  BrainOutput,
  ShadowSession,
  Belt,
  TransitionRule,
  DJMoment,
  LearningUpdate
} from './VoyoBrain';

export { youtubeInterceptor } from './YouTubeInterceptor';
export type { YouTubeRecommendation, RecurringTrack } from './YouTubeInterceptor';

export { sessionExecutor } from './SessionExecutor';
export type { ExecutorState, NextTrackResult } from './SessionExecutor';

// Import singletons
import { signals } from './SignalEmitter';
import { signalBuffer } from './SignalBuffer';
import { voyoBrain } from './VoyoBrain';
import { youtubeInterceptor } from './YouTubeInterceptor';
import { sessionExecutor } from './SessionExecutor';

// Export integration
export { brainIntegration, initializeBrainIntegration, cleanupBrainIntegration, getBrainStats } from './BrainIntegration';

// ============================================
// BRAIN FACADE
// ============================================

/**
 * Unified Brain interface for easy access
 */
export const brain = {
  // Signal emission
  signals,

  // Signal buffering and triggers
  buffer: signalBuffer,

  // Core LLM curation
  core: voyoBrain,

  // YouTube free intelligence
  interceptor: youtubeInterceptor,

  // Local execution
  executor: sessionExecutor,

  // ============================================
  // CONVENIENCE METHODS
  // ============================================

  /**
   * Initialize Brain for a new session
   */
  async startSession(): Promise<void> {
    signals.newSession();
    signals.sessionStart();

    // Trigger initial curation
    signalBuffer.triggerManually();
  },

  /**
   * Force Brain recuration
   */
  async forceCurate(): Promise<void> {
    const output = await voyoBrain.forceCurate();
    if (output) {
      sessionExecutor.loadBrainOutput(output);
    }
  },

  /**
   * Get next track (main method for playback)
   */
  getNextTrack() {
    return sessionExecutor.getNextTrack();
  },

  /**
   * Check if should insert a mix
   */
  shouldInsertMix() {
    return sessionExecutor.shouldInsertMix();
  },

  /**
   * Get hot belt tracks
   */
  getHotBelt() {
    return sessionExecutor.getHotBelt();
  },

  /**
   * Get discovery belt tracks
   */
  getDiscoveryBelt() {
    return sessionExecutor.getDiscoveryBelt();
  },

  /**
   * Get session info
   */
  getSessionInfo() {
    return {
      ...sessionExecutor.getSessionInfo(),
      progress: sessionExecutor.getProgress(),
      patterns: sessionExecutor.getPatterns(),
      bufferStats: {
        size: signalBuffer.getBufferSize(),
        unprocessed: signalBuffer.getUnprocessedCount(),
        triggers: signalBuffer.getTriggerStates()
      },
      ytStats: youtubeInterceptor.getStats()
    };
  },

  /**
   * Get learning insights
   */
  getLearning() {
    return voyoBrain.getLearning();
  },

  /**
   * Get discovery queries for background fetching
   */
  getDiscoveryQueries() {
    return voyoBrain.getDiscoveryQueries();
  },

  /**
   * Check if queue needs refresh
   */
  needsRefresh() {
    return sessionExecutor.isQueueLow();
  },

  /**
   * Signal pool empty (triggers Brain)
   */
  signalPoolEmpty() {
    signalBuffer.signalPoolEmpty();
  },

  /**
   * Reset everything
   */
  reset() {
    sessionExecutor.reset();
    signalBuffer.clearBuffer();
    youtubeInterceptor.reset();
  }
};

export default brain;
