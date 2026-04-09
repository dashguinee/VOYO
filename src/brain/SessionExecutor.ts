/**
 * VOYO Brain - Session Executor
 *
 * Local math execution of Brain's decisions.
 * Brain sets DIRECTION, Executor handles SPEED.
 *
 * Responsibilities:
 * 1. Execute transition rules from Brain
 * 2. Blend between shadow sessions
 * 3. Track queue position
 * 4. Handle real-time adjustments
 * 5. Manage belt updates
 *
 * No LLM calls - pure local logic!
 */

import { signals, SignalPayload } from './SignalEmitter';
import { voyoBrain, BrainOutput, ShadowSession, TransitionRule } from './VoyoBrain';
import { searchMusic } from '../services/api';
import { Track } from '../types';
import { getThumb } from '../utils/thumbnail';
import { encodeVoyoId } from '../utils/voyoId';

// ============================================
// TYPES
// ============================================

export interface ExecutorState {
  // Queue state
  currentSession: 'main' | string; // 'main' or shadow session ID
  queuePosition: number;
  currentQueue: string[]; // Active video IDs
  upNext: string[]; // Prepared next tracks

  // Transition state
  isBlending: boolean;
  blendFrom: string;
  blendTo: string;
  blendProgress: number; // 0-1
  blendTracks: number;

  // Belt state
  hotBeltPosition: number;
  discoveryBeltPosition: number;
  lastBeltRefresh: string;

  // Stats
  tracksPlayed: number;
  sessionSwitches: number;
  mixesPlayed: number;
}

export interface NextTrackResult {
  videoId: string;
  title: string;
  artist: string;
  type: 'track' | 'mix';
  source: 'main' | 'shadow' | 'hot' | 'discovery' | 'blend';
  djIntro?: string;
  djOutro?: string;
}

// ============================================
// PATTERN DETECTORS
// ============================================

interface PatternState {
  consecutiveSkips: number;
  consecutiveCompletes: number;
  consecutiveOyes: number;
  modeChanges: number;
  lastModes: string[];
  isLateNight: boolean;
  hasSearched: boolean;
}

// ============================================
// SESSION EXECUTOR CLASS
// ============================================

class SessionExecutor {
  private state: ExecutorState;
  private patterns: PatternState;
  private brainOutput: BrainOutput | null = null;
  private shadowQueues: Map<string, string[]> = new Map();

  constructor() {
    this.state = this.createInitialState();
    this.patterns = this.createInitialPatterns();
    this.subscribeToSignals();
    console.log('[Brain] SessionExecutor initialized');
  }

  private createInitialState(): ExecutorState {
    return {
      currentSession: 'main',
      queuePosition: 0,
      currentQueue: [],
      upNext: [],
      isBlending: false,
      blendFrom: 'main',
      blendTo: 'main',
      blendProgress: 0,
      blendTracks: 0,
      hotBeltPosition: 0,
      discoveryBeltPosition: 0,
      lastBeltRefresh: new Date().toISOString(),
      tracksPlayed: 0,
      sessionSwitches: 0,
      mixesPlayed: 0
    };
  }

  private createInitialPatterns(): PatternState {
    return {
      consecutiveSkips: 0,
      consecutiveCompletes: 0,
      consecutiveOyes: 0,
      modeChanges: 0,
      lastModes: [],
      isLateNight: false,
      hasSearched: false
    };
  }

  // ============================================
  // SIGNAL HANDLING
  // ============================================

  private subscribeToSignals(): void {
    // Track skips
    signals.on('skip', () => {
      this.patterns.consecutiveSkips++;
      this.patterns.consecutiveCompletes = 0;
      this.checkTransitions();
    });

    // Track completes
    signals.on('complete', () => {
      this.patterns.consecutiveCompletes++;
      this.patterns.consecutiveSkips = 0;
      this.state.tracksPlayed++;
      this.checkTransitions();
    });

    // Track OYEs
    signals.on('oye', () => {
      this.patterns.consecutiveOyes++;
      this.checkTransitions();
    });

    // Track mode changes
    signals.on('mode_tap', (signal) => {
      if ('modeId' in signal) {
        const payload = signal as { modeId?: string };
        if (payload.modeId) {
          this.patterns.lastModes.push(payload.modeId);
          if (this.patterns.lastModes.length > 5) {
            this.patterns.lastModes.shift();
          }
          this.patterns.modeChanges++;
        }
      }
    });

    // Track searches
    signals.on('search', () => {
      this.patterns.hasSearched = true;
      this.checkTransitions();
    });

    // Track time
    signals.on('time_of_day', (signal) => {
      if ('value' in signal) {
        const payload = signal as { value: string };
        this.patterns.isLateNight = payload.value === 'late_night';
      }
    });

    // Track mix completions
    signals.on('mix_complete', () => {
      this.state.mixesPlayed++;
    });
  }

  // ============================================
  // BRAIN OUTPUT LOADING
  // ============================================

  /**
   * Load new Brain output and prepare queues
   */
  loadBrainOutput(output: BrainOutput): void {
    this.brainOutput = output;

    // Load main queue
    this.state.currentQueue = output.mainQueue.tracks.map(t => t.youtubeId);
    this.state.queuePosition = 0;

    // Load shadow queues
    this.shadowQueues.clear();
    output.shadows.forEach(shadow => {
      this.shadowQueues.set(shadow.id, [...shadow.tracks]);
    });

    // Reset transition state
    this.state.isBlending = false;
    this.state.currentSession = 'main';

    console.log(`[Brain] Loaded Brain output: "${output.sessionName}" with ${this.state.currentQueue.length} main tracks, ${output.shadows.length} shadows`);
  }

  // ============================================
  // TRANSITION LOGIC
  // ============================================

  /**
   * Check if any transition should be triggered
   */
  private checkTransitions(): void {
    if (!this.brainOutput || this.state.isBlending) return;

    // Check each transition rule
    for (const rule of this.brainOutput.transitionRules) {
      if (this.evaluateCondition(rule.condition)) {
        this.initiateTransition(rule);
        return;
      }
    }

    // Check shadow triggers
    for (const shadow of this.brainOutput.shadows) {
      if (this.evaluateShadowTrigger(shadow)) {
        this.transitionToShadow(shadow);
        return;
      }
    }
  }

  /**
   * Evaluate transition condition
   */
  private evaluateCondition(condition: string): boolean {
    const lower = condition.toLowerCase();

    // Skip patterns
    if (lower.includes('skip') && lower.includes('2')) {
      return this.patterns.consecutiveSkips >= 2;
    }
    if (lower.includes('skip') && lower.includes('3')) {
      return this.patterns.consecutiveSkips >= 3;
    }

    // Complete patterns
    if (lower.includes('complete') && lower.includes('3')) {
      return this.patterns.consecutiveCompletes >= 3;
    }

    // OYE patterns
    if (lower.includes('oye') || lower.includes('reaction')) {
      return this.patterns.consecutiveOyes >= 1;
    }

    // Time patterns
    if (lower.includes('11pm') || lower.includes('late') || lower.includes('night')) {
      const hour = new Date().getHours();
      return hour >= 23 || hour < 5;
    }

    // Search patterns
    if (lower.includes('search')) {
      return this.patterns.hasSearched;
    }

    // Mode hopping
    if (lower.includes('mode') && lower.includes('hop')) {
      const uniqueModes = new Set(this.patterns.lastModes);
      return uniqueModes.size >= 3;
    }

    return false;
  }

  /**
   * Evaluate shadow session trigger
   */
  private evaluateShadowTrigger(shadow: ShadowSession): boolean {
    const trigger = shadow.trigger.toLowerCase();

    if (shadow.id === 'chill_shift' && this.patterns.consecutiveSkips >= 2) {
      return true;
    }

    if (shadow.id === 'energy_boost' && this.patterns.consecutiveOyes >= 1) {
      return true;
    }

    if (shadow.id === 'deep_afro' && this.patterns.consecutiveCompletes >= 3) {
      return true;
    }

    if (shadow.id === 'late_night') {
      const hour = new Date().getHours();
      if ((hour >= 23 || hour < 5) && this.patterns.consecutiveCompletes >= 2) {
        return true;
      }
    }

    if (shadow.id === 'discovery' && this.patterns.hasSearched) {
      return true;
    }

    return false;
  }

  /**
   * Initiate transition to another session
   */
  private initiateTransition(rule: TransitionRule): void {
    console.log(`[Brain] Transitioning from ${rule.from} to ${rule.to} (${rule.blendTracks} track blend)`);

    this.state.isBlending = true;
    this.state.blendFrom = rule.from;
    this.state.blendTo = rule.to;
    this.state.blendTracks = rule.blendTracks;
    this.state.blendProgress = 0;

    // Reset patterns after transition
    this.patterns.consecutiveSkips = 0;
    this.patterns.consecutiveOyes = 0;
    this.patterns.hasSearched = false;
  }

  /**
   * Transition to a shadow session
   */
  private transitionToShadow(shadow: ShadowSession): void {
    console.log(`[Brain] Transitioning to shadow: ${shadow.name} (${shadow.blendSpeed})`);

    const blendTracks = shadow.blendSpeed === 'instant' ? 1 :
                        shadow.blendSpeed === 'smooth' ? 3 : 5;

    this.state.isBlending = true;
    this.state.blendFrom = this.state.currentSession;
    this.state.blendTo = shadow.id;
    this.state.blendTracks = blendTracks;
    this.state.blendProgress = 0;
    this.state.sessionSwitches++;

    // Reset patterns
    this.patterns.consecutiveSkips = 0;
    this.patterns.consecutiveOyes = 0;
    this.patterns.hasSearched = false;
  }

  // ============================================
  // QUEUE OPERATIONS
  // ============================================

  /**
   * Get next track to play
   */
  getNextTrack(): NextTrackResult | null {
    if (!this.brainOutput) {
      console.warn('[Brain] No Brain output loaded');
      return null;
    }

    // If blending, mix from both queues
    if (this.state.isBlending) {
      return this.getBlendedTrack();
    }

    // Get from current session
    if (this.state.currentSession === 'main') {
      return this.getFromMainQueue();
    } else {
      return this.getFromShadow(this.state.currentSession);
    }
  }

  /**
   * Get track from main queue
   */
  private getFromMainQueue(): NextTrackResult | null {
    const track = this.brainOutput?.mainQueue.tracks[this.state.queuePosition];
    if (!track) {
      console.log('[Brain] Main queue exhausted');
      return null;
    }

    this.state.queuePosition++;

    return {
      videoId: track.youtubeId,
      title: track.title,
      artist: track.artist,
      type: track.type,
      source: 'main',
      djIntro: track.djIntro,
      djOutro: track.djOutro
    };
  }

  /**
   * Get track from shadow session
   */
  private getFromShadow(shadowId: string): NextTrackResult | null {
    const shadowQueue = this.shadowQueues.get(shadowId);
    if (!shadowQueue || shadowQueue.length === 0) {
      console.log(`[Brain] Shadow ${shadowId} exhausted, returning to main`);
      this.state.currentSession = 'main';
      return this.getFromMainQueue();
    }

    const videoId = shadowQueue.shift()!;
    const shadow = this.brainOutput?.shadows.find(s => s.id === shadowId);

    return {
      videoId,
      title: '', // Will be resolved by player
      artist: '',
      type: 'track',
      source: 'shadow'
    };
  }

  /**
   * Get blended track during transition
   */
  private getBlendedTrack(): NextTrackResult | null {
    this.state.blendProgress += 1 / this.state.blendTracks;

    // Alternate between from and to based on progress
    const useNew = this.state.blendProgress > 0.5;

    if (this.state.blendProgress >= 1) {
      // Blend complete
      this.state.isBlending = false;
      this.state.currentSession = this.state.blendTo;
      console.log(`[Brain] Blend complete, now in ${this.state.currentSession}`);
    }

    // Get track from appropriate queue
    if (useNew) {
      if (this.state.blendTo === 'main') {
        return this.getFromMainQueue();
      } else {
        const result = this.getFromShadow(this.state.blendTo);
        if (result) result.source = 'blend';
        return result;
      }
    } else {
      if (this.state.blendFrom === 'main') {
        return this.getFromMainQueue();
      } else {
        const result = this.getFromShadow(this.state.blendFrom);
        if (result) result.source = 'blend';
        return result;
      }
    }
  }

  // ============================================
  // BELT OPERATIONS
  // ============================================

  /**
   * Get next hot belt track
   */
  getNextHotTrack(): string | null {
    const belt = this.brainOutput?.belts.hot;
    if (!belt || belt.tracks.length === 0) return null;

    const track = belt.tracks[this.state.hotBeltPosition];
    this.state.hotBeltPosition = (this.state.hotBeltPosition + 1) % belt.tracks.length;
    return track;
  }

  /**
   * Get next discovery belt track
   */
  getNextDiscoveryTrack(): string | null {
    const belt = this.brainOutput?.belts.discovery;
    if (!belt || belt.tracks.length === 0) return null;

    const track = belt.tracks[this.state.discoveryBeltPosition];
    this.state.discoveryBeltPosition = (this.state.discoveryBeltPosition + 1) % belt.tracks.length;
    return track;
  }

  /**
   * Get all hot belt tracks
   */
  getHotBelt(): string[] {
    return this.brainOutput?.belts.hot.tracks || [];
  }

  /**
   * Get all discovery belt tracks
   */
  getDiscoveryBelt(): string[] {
    return this.brainOutput?.belts.discovery.tracks || [];
  }

  // ============================================
  // DJ MOMENTS
  // ============================================

  /**
   * Check if a DJ moment should trigger
   */
  shouldInsertMix(): { query: string; djIntro?: string; djOutro?: string } | null {
    if (!this.brainOutput?.djMoments || this.brainOutput.djMoments.length === 0) {
      return null;
    }

    for (const moment of this.brainOutput.djMoments) {
      if (this.evaluateDJCondition(moment.condition)) {
        return {
          query: moment.mixQuery,
          djIntro: moment.djIntro,
          djOutro: moment.djOutro
        };
      }
    }

    return null;
  }

  private evaluateDJCondition(condition: string): boolean {
    const lower = condition.toLowerCase();

    // After X minutes of engagement
    const minuteMatch = lower.match(/(\d+)\s*minutes?/);
    if (minuteMatch) {
      const minutes = parseInt(minuteMatch[1]);
      // Rough estimate: 3.5 min per track
      const estimatedMinutes = this.state.tracksPlayed * 3.5;
      return estimatedMinutes >= minutes && this.patterns.consecutiveCompletes >= 2;
    }

    // After X tracks
    const trackMatch = lower.match(/(\d+)\s*tracks?/);
    if (trackMatch) {
      const tracks = parseInt(trackMatch[1]);
      return this.state.tracksPlayed >= tracks;
    }

    // Steady engagement
    if (lower.includes('steady') || lower.includes('engagement')) {
      return this.patterns.consecutiveCompletes >= 3;
    }

    return false;
  }

  // ============================================
  // STATE ACCESS
  // ============================================

  /**
   * Get current executor state
   */
  getState(): ExecutorState {
    return { ...this.state };
  }

  /**
   * Get current patterns
   */
  getPatterns(): PatternState {
    return { ...this.patterns };
  }

  /**
   * Get queue progress
   */
  getProgress(): { current: number; total: number; percent: number } {
    const total = this.state.currentQueue.length;
    const current = this.state.queuePosition;
    return {
      current,
      total,
      percent: total > 0 ? Math.round((current / total) * 100) : 0
    };
  }

  /**
   * Get session info
   */
  getSessionInfo(): { name: string; strategy: string; currentSession: string } {
    return {
      name: this.brainOutput?.sessionName || 'No session',
      strategy: this.brainOutput?.mainQueue.strategy || 'N/A',
      currentSession: this.state.currentSession
    };
  }

  /**
   * Check if queue is low (needs refresh)
   */
  isQueueLow(): boolean {
    const remaining = this.state.currentQueue.length - this.state.queuePosition;
    return remaining < 5;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.state = this.createInitialState();
    this.patterns = this.createInitialPatterns();
    this.brainOutput = null;
    this.shadowQueues.clear();
    console.log('[Brain] SessionExecutor reset');
  }
}

// Singleton
export const sessionExecutor = new SessionExecutor();

export default sessionExecutor;
