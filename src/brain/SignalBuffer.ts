/**
 * VOYO Brain - Signal Buffer
 *
 * Accumulates signals and triggers Brain recuration when conditions are met.
 *
 * Trigger Conditions:
 * 1. Session Start - Always curate on new session
 * 2. 5+ MixBoard Changes - User is actively changing vibe
 * 3. 3+ Consecutive Skips - Current queue not matching
 * 4. Pool Empty - Need more tracks
 * 5. Manual Trigger - User requests recuration
 * 6. Significant Vibe Shift - Detected pattern change
 *
 * Philosophy: Brain sets DIRECTION, Math handles SPEED
 */

import { signals, SignalPayload, SignalType } from './SignalEmitter';

// ============================================
// TYPES
// ============================================

export interface BufferedSignal {
  type: string;
  timestamp: string;
  sessionId: string;
  processed: boolean;
  [key: string]: unknown;
}

export interface TriggerCondition {
  type: 'session_start' | 'mixboard_changes' | 'skip_streak' | 'pool_empty' | 'manual' | 'vibe_shift';
  threshold: number;
  currentCount: number;
  lastTriggered?: string;
}

export interface SignalSummary {
  // Session info
  sessionId: string;
  sessionStartedAt: string;
  signalCount: number;

  // Playback summary
  tracksPlayed: number;
  tracksCompleted: number;
  tracksSkipped: number;
  avgCompletionRate: number;
  replayCount: number;

  // Reaction summary
  oyeCount: number;
  oyeHoldCount: number;
  loveCount: number;
  dislikeCount: number;

  // MixBoard summary
  barChanges: number;
  dragToQueueCount: number;
  modeTaps: Record<string, number>;
  dominantModes: string[];

  // Queue summary
  queueAdds: number;
  queueRemoves: number;
  queueClears: number;

  // Discovery summary
  searches: number;
  searchClicks: number;
  hotClicks: number;
  discoveryClicks: number;

  // Context
  timeOfDay: string;
  dayOfWeek: string;
  sessionLength: number; // minutes

  // Engagement patterns
  skipStreaks: number;
  completeStreaks: number;
  oyeStreaks: number;
  modeHoppingCount: number;
  attentionDrops: number;

  // Mix engagement
  mixesStarted: number;
  mixesCompleted: number;
  avgMixWatchTime: number;

  // YouTube intelligence
  youtubeRecommendations: Array<{
    videoId: string;
    title: string;
    detectedVibe?: string;
    position: number;
    count: number; // How many times recommended
  }>;

  // Recent tracks for context
  recentTracks: Array<{
    trackId: string;
    videoId: string;
    artist: string;
    title: string;
    action: 'complete' | 'skip' | 'oye' | 'love';
  }>;
}

export type BrainTrigger = (summary: SignalSummary) => void;

// ============================================
// SIGNAL BUFFER CLASS
// ============================================

class SignalBuffer {
  private buffer: BufferedSignal[] = [];
  private maxBufferSize: number = 500;
  private sessionStartTime: number = Date.now();

  // Trigger state
  private triggers: Map<TriggerCondition['type'], TriggerCondition> = new Map();
  private brainCallback: BrainTrigger | null = null;
  private cooldownMs: number = 30000; // 30 second cooldown between Brain calls
  private lastBrainTrigger: number = 0;

  // Counters for trigger detection
  private consecutiveSkips: number = 0;
  private mixboardChanges: number = 0;
  private recentModes: string[] = [];

  // YouTube intelligence aggregation
  private youtubeRecs: Map<string, { title: string; vibe?: string; positions: number[]; count: number }> = new Map();

  constructor() {
    this.initializeTriggers();
    this.subscribeToSignals();
    console.log('[Brain] SignalBuffer initialized');
  }

  private initializeTriggers(): void {
    this.triggers.set('session_start', { type: 'session_start', threshold: 1, currentCount: 0 });
    this.triggers.set('mixboard_changes', { type: 'mixboard_changes', threshold: 5, currentCount: 0 });
    this.triggers.set('skip_streak', { type: 'skip_streak', threshold: 3, currentCount: 0 });
    this.triggers.set('pool_empty', { type: 'pool_empty', threshold: 1, currentCount: 0 });
    this.triggers.set('manual', { type: 'manual', threshold: 1, currentCount: 0 });
    this.triggers.set('vibe_shift', { type: 'vibe_shift', threshold: 1, currentCount: 0 });
  }

  private subscribeToSignals(): void {
    // Listen to ALL signals
    signals.on('*', (signal) => this.handleSignal(signal));
  }

  // ============================================
  // SIGNAL HANDLING
  // ============================================

  private handleSignal(signal: SignalPayload): void {
    // Add to buffer
    this.buffer.push({ ...signal, processed: false });

    // Trim buffer if too large
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    // Update trigger counters based on signal type
    this.updateTriggerCounters(signal);

    // Check if any trigger condition is met
    this.checkTriggers();
  }

  private updateTriggerCounters(signal: SignalPayload): void {
    const type = signal.type;

    // Session start trigger
    if (type === 'session_start') {
      this.sessionStartTime = Date.now();
      this.resetCounters();
      const trigger = this.triggers.get('session_start')!;
      trigger.currentCount = 1;
    }

    // Skip tracking
    if (type === 'skip') {
      this.consecutiveSkips++;
      const trigger = this.triggers.get('skip_streak')!;
      trigger.currentCount = this.consecutiveSkips;
    } else if (type === 'complete' || type === 'oye' || type === 'love') {
      // Reset skip streak on positive engagement
      this.consecutiveSkips = 0;
      const trigger = this.triggers.get('skip_streak')!;
      trigger.currentCount = 0;
    }

    // MixBoard changes
    if (type === 'bar_change' || type === 'drag_to_queue' || type === 'mode_tap') {
      this.mixboardChanges++;
      const trigger = this.triggers.get('mixboard_changes')!;
      trigger.currentCount = this.mixboardChanges;

      // Track mode hopping
      if (type === 'mode_tap' && 'modeId' in signal) {
        const payload = signal as { modeId?: string };
        if (payload.modeId) {
          this.recentModes.push(payload.modeId);
          if (this.recentModes.length > 10) {
            this.recentModes = this.recentModes.slice(-10);
          }
        }
      }
    }

    // YouTube recommendations
    if (type === 'youtube_recommendations' && 'recommendations' in signal) {
      const payload = signal as { recommendations?: Array<{ videoId: string; title: string; detectedVibe?: string; position: number }> };
      if (payload.recommendations) {
        payload.recommendations.forEach((rec) => {
          const existing = this.youtubeRecs.get(rec.videoId);
          if (existing) {
            existing.positions.push(rec.position);
            existing.count++;
          } else {
            this.youtubeRecs.set(rec.videoId, {
              title: rec.title,
              vibe: rec.detectedVibe,
              positions: [rec.position],
              count: 1,
            });
          }
        });
      }
    }

    // Detect vibe shift (5+ unique modes in last 10 taps)
    if (this.recentModes.length >= 5) {
      const uniqueModes = new Set(this.recentModes.slice(-10));
      if (uniqueModes.size >= 4) {
        const trigger = this.triggers.get('vibe_shift')!;
        trigger.currentCount = 1;
      }
    }
  }

  private checkTriggers(): void {
    // Respect cooldown
    const now = Date.now();
    if (now - this.lastBrainTrigger < this.cooldownMs) {
      return;
    }

    // Check each trigger
    for (const [type, trigger] of this.triggers) {
      if (trigger.currentCount >= trigger.threshold) {
        console.log(`[Brain] Trigger activated: ${type} (count: ${trigger.currentCount})`);
        this.fireBrain(type);
        return; // Only fire once per check
      }
    }
  }

  private fireBrain(triggerType: TriggerCondition['type']): void {
    if (!this.brainCallback) {
      console.warn('[Brain] No callback registered, skipping Brain call');
      return;
    }

    this.lastBrainTrigger = Date.now();

    // Reset the trigger that fired
    const trigger = this.triggers.get(triggerType)!;
    trigger.currentCount = 0;
    trigger.lastTriggered = new Date().toISOString();

    // Also reset mixboard changes after trigger
    if (triggerType === 'mixboard_changes') {
      this.mixboardChanges = 0;
    }

    // Build summary and call Brain
    const summary = this.buildSummary();
    console.log(`[Brain] Firing Brain with ${summary.signalCount} signals, trigger: ${triggerType}`);

    try {
      this.brainCallback(summary);
    } catch (err) {
      console.error('[Brain] Error calling Brain:', err);
    }

    // Mark signals as processed
    this.buffer.forEach((s) => (s.processed = true));
  }

  // ============================================
  // SUMMARY BUILDING
  // ============================================

  private buildSummary(): SignalSummary {
    const unprocessed = this.buffer.filter((s) => !s.processed);
    const sessionId = signals.getSessionId();

    // Time context
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay =
      hour < 6 ? 'late_night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = days[now.getDay()];
    const sessionLength = Math.floor((Date.now() - this.sessionStartTime) / 60000);

    // Count signal types
    const countType = (type: SignalType): number => unprocessed.filter((s) => s.type === type).length;

    // Track recent tracks
    const recentTracks: SignalSummary['recentTracks'] = [];
    unprocessed
      .filter((s) => ['complete', 'skip', 'oye', 'love'].includes(s.type))
      .slice(-20)
      .forEach((s) => {
        const trackId = s['trackId'] as string | undefined;
        const videoId = s['videoId'] as string | undefined;
        const artist = s['artist'] as string | undefined;
        const title = s['title'] as string | undefined;
        if (trackId && videoId && artist && title) {
          recentTracks.push({
            trackId,
            videoId,
            artist,
            title,
            action: s.type as 'complete' | 'skip' | 'oye' | 'love',
          });
        }
      });

    // Mode taps
    const modeTaps: Record<string, number> = {};
    unprocessed
      .filter((s) => s.type === 'mode_tap' && 'modeId' in s)
      .forEach((s) => {
        const modeId = s['modeId'] as string | undefined;
        if (modeId) {
          modeTaps[modeId] = (modeTaps[modeId] || 0) + 1;
        }
      });

    // Dominant modes (top 3)
    const dominantModes = Object.entries(modeTaps)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([mode]) => mode);

    // Completion rates
    const completes = countType('complete');
    const skips = countType('skip');
    const plays = completes + skips;
    const avgCompletionRate = plays > 0 ? Math.round((completes / plays) * 100) : 0;

    // Mix stats
    const mixStarts = unprocessed.filter((s) => s.type === 'mix_start');
    const mixCompletes = countType('mix_complete');
    let totalMixWatchTime = 0;
    unprocessed
      .filter((s) => s.type === 'mix_exit' && 'watchedDuration' in s)
      .forEach((s) => {
        const watchedDuration = s['watchedDuration'] as number | undefined;
        if (watchedDuration) totalMixWatchTime += watchedDuration;
      });
    const avgMixWatchTime = mixStarts.length > 0 ? Math.round(totalMixWatchTime / mixStarts.length) : 0;

    // YouTube recommendations (top 10 recurring)
    const youtubeRecommendations = Array.from(this.youtubeRecs.entries())
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([videoId, data]) => ({
        videoId,
        title: data.title,
        detectedVibe: data.vibe,
        position: Math.min(...data.positions),
        count: data.count,
      }));

    return {
      sessionId,
      sessionStartedAt: new Date(this.sessionStartTime).toISOString(),
      signalCount: unprocessed.length,

      tracksPlayed: plays,
      tracksCompleted: completes,
      tracksSkipped: skips,
      avgCompletionRate,
      replayCount: countType('replay'),

      oyeCount: countType('oye'),
      oyeHoldCount: countType('oye_hold'),
      loveCount: countType('love'),
      dislikeCount: countType('dislike'),

      barChanges: countType('bar_change'),
      dragToQueueCount: countType('drag_to_queue'),
      modeTaps,
      dominantModes,

      queueAdds: countType('queue_add'),
      queueRemoves: countType('queue_remove'),
      queueClears: countType('queue_clear'),

      searches: countType('search'),
      searchClicks: countType('search_click'),
      hotClicks: countType('hot_click'),
      discoveryClicks: countType('discovery_click'),

      timeOfDay,
      dayOfWeek,
      sessionLength,

      skipStreaks: countType('skip_streak'),
      completeStreaks: countType('complete_streak'),
      oyeStreaks: countType('oye_streak'),
      modeHoppingCount: countType('mode_hopping'),
      attentionDrops: countType('attention_drop'),

      mixesStarted: mixStarts.length,
      mixesCompleted: mixCompletes,
      avgMixWatchTime,

      youtubeRecommendations,
      recentTracks,
    };
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Register callback for when Brain should be triggered
   */
  onBrainTrigger(callback: BrainTrigger): void {
    this.brainCallback = callback;
  }

  /**
   * Manually trigger Brain recuration
   */
  triggerManually(): void {
    const trigger = this.triggers.get('manual')!;
    trigger.currentCount = 1;
    this.checkTriggers();
  }

  /**
   * Signal that pool is empty
   */
  signalPoolEmpty(): void {
    const trigger = this.triggers.get('pool_empty')!;
    trigger.currentCount = 1;
    this.checkTriggers();
  }

  /**
   * Get current summary without triggering Brain
   */
  getSummary(): SignalSummary {
    return this.buildSummary();
  }

  /**
   * Get trigger states for debugging
   */
  getTriggerStates(): Record<string, { threshold: number; current: number }> {
    const states: Record<string, { threshold: number; current: number }> = {};
    for (const [type, trigger] of this.triggers) {
      states[type] = { threshold: trigger.threshold, current: trigger.currentCount };
    }
    return states;
  }

  /**
   * Set cooldown between Brain calls
   */
  setCooldown(ms: number): void {
    this.cooldownMs = ms;
  }

  /**
   * Reset all counters
   */
  private resetCounters(): void {
    this.consecutiveSkips = 0;
    this.mixboardChanges = 0;
    this.recentModes = [];
    this.youtubeRecs.clear();
    for (const trigger of this.triggers.values()) {
      trigger.currentCount = 0;
    }
  }

  /**
   * Clear buffer
   */
  clearBuffer(): void {
    this.buffer = [];
    this.resetCounters();
  }

  /**
   * Get buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Get unprocessed count
   */
  getUnprocessedCount(): number {
    return this.buffer.filter((s) => !s.processed).length;
  }
}

// Singleton instance
export const signalBuffer = new SignalBuffer();

export default signalBuffer;
