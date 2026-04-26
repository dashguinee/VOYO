/**
 * VOYO Music - Smart Audio Engine
 * Spotify-beating prebuffer system with adaptive bitrate and intelligent caching
 *
 * Key Features:
 * - 15-second initial buffer target
 * - 3-second emergency threshold
 * - Prefetch next track at 50% progress
 * - Adaptive bitrate based on network speed
 * - Smart buffer health monitoring
 * - Integration with MediaCache for feed pre-caching
 *
 * AUDIO CHAIN SINGLETON (Tivi+ Pattern):
 * - AudioContext created ONCE
 * - MediaElementAudioSourceNode created ONCE per audio element
 * - connectAudioChain() is idempotent — returns existing chain if already wired
 * - Chain survives src changes automatically (Web Audio API design)
 * - iOS context suspend/resume handled via visibility/focus listeners
 */

import { devWarn } from '../utils/logger';
import { trace } from './telemetry';
import { usePlayerStore } from '../store/playerStore';

export type BitrateLevel = 'low' | 'medium' | 'high';
export type BufferStatus = 'healthy' | 'warning' | 'emergency';

// ── AUDIO CHAIN SINGLETON ──
// CRITICAL: MediaElementAudioSourceNode can only be created ONCE per audio element.
// Once connected, the chain stays wired permanently — it follows the audio through
// src changes, pauses, and track switches automatically.

let _audioCtx: AudioContext | null = null;
let _sourceNode: MediaElementAudioSourceNode | null = null;
let _analyserNode: AnalyserNode | null = null;
let _connectedElement: HTMLAudioElement | null = null;
let _chainWired = false;
// Set by the document-block below so connectAudioChain's onstatechange can trigger it
let _installGestureListener: (() => void) | null = null;

// (audit-2 P1-AUD-2/3) Subscribers that want to react to ctx state changes.
// Previously bgEngine.tsx tried to attach its own statechange listener, but
// it captured `audioContextRef.current` (null at first render) and the deps
// were stable RefObjects → never re-run → listener never attached. AND when
// long-BG iOS/Safari closes the ctx and we rebuild it, the listener was
// bound to the dead ctx. Fix: bgEngine subscribes here, audioEngine fans
// out to all subs whenever the OWNED ctx changes state. Survives ctx swaps
// (a new ctx is created but the subscribers list is preserved).
type CtxStateSub = (state: AudioContextState | 'interrupted') => void;
const _ctxStateSubs = new Set<CtxStateSub>();
export function subscribeAudioCtxState(sub: CtxStateSub): () => void {
  _ctxStateSubs.add(sub);
  return () => { _ctxStateSubs.delete(sub); };
}

export interface AudioChainResult {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  alreadyWired: boolean;
}

// Resume AudioContext when tab regains focus (iOS/Android suspend it)
// Also resume on user interaction — iOS requires a gesture after lock/unlock
//
// CANONICAL visibility handler. Used to be 3 different handlers (here,
// AudioPlayer.tsx, useMiniPiP) all firing on visibilitychange and competing
// for the audio thread. Now AudioPlayer's handler is slimmed down to just
// suspend-on-hidden, useMiniPiP handles PiP only, and THIS handler is the
// single source of truth for context resume. Wrapped in rAF so it batches
// with React updates from other components reacting to visibility.
if (typeof document !== 'undefined') {
  const resumeCtx = (origin: string) => {
    if (_audioCtx && (_audioCtx.state === 'suspended' || (_audioCtx as any).state === 'interrupted')) {
      const prevState = _audioCtx.state;
      trace('ae_resume_attempt', null, { origin, prevState, hidden: typeof document !== 'undefined' && document.hidden });
      _audioCtx.resume()
        .then(() => trace('ae_resume_ok', null, { origin, prevState, newState: _audioCtx?.state }))
        .catch(e => trace('ae_resume_rejected', null, { origin, prevState, err: e?.name, msg: (e?.message || '').slice(0, 80) }));
    }
  };
  // IMMEDIATE resume on visibility change — no rAF delay.
  // Was wrapped in requestAnimationFrame which added ~16ms before the
  // AudioContext actually resumed. On background→foreground transitions,
  // the user heard a brief silence gap while the context spun back up.
  // Now fires synchronously on visibilitychange AND redundantly on focus
  // for maximum speed. The context.resume() call is idempotent, so
  // double-calling is harmless.
  const onVisibilityChange = () => {
    if (document.hidden) return;
    resumeCtx('visibilitychange'); // Immediate — no rAF delay
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', () => resumeCtx('focus')); // Also immediate
  // iOS/Android: After phone lock/unlock, AudioContext goes to 'interrupted' state.
  // A user gesture (touch/click) is required to resume it.
  // CRITICAL: only attach the gesture listeners while context is actually
  // suspended/interrupted. Previously these were always-on at document level
  // and fired on EVERY tap/click in the app — even though resumeCtx() does
  // a fast state check, the listener overhead added micro-jank to every
  // interaction. Now we install on-demand and remove after the first
  // successful resume.
  let gestureListenerActive = false;
  let totalGestureAttempts = 0; // Tracks across install cycles — give up after 30
  let currentResumeOnce: (() => void) | null = null;
  const installGestureListener = () => {
    if (gestureListenerActive || totalGestureAttempts >= 30) return;
    gestureListenerActive = true;
    trace('ae_gesture_install', null, { totalAttempts: totalGestureAttempts, ctxState: _audioCtx?.state });
    const resumeOnce = () => {
      resumeCtx('gesture');
      totalGestureAttempts++;
      setTimeout(() => {
        if (_audioCtx && _audioCtx.state === 'running') {
          // Success — clean up and reset attempts for future lock/unlock cycles
          document.removeEventListener('touchstart', resumeOnce);
          document.removeEventListener('click', resumeOnce);
          gestureListenerActive = false;
          trace('ae_gesture_ok', null, { attempts: totalGestureAttempts });
          totalGestureAttempts = 0; // Reset on success so future suspensions work
          currentResumeOnce = null;
        } else if (totalGestureAttempts >= 30) {
          // Give up — context is truly unrecoverable
          document.removeEventListener('touchstart', resumeOnce);
          document.removeEventListener('click', resumeOnce);
          gestureListenerActive = false;
          trace('ae_gesture_giveup', null, { ctxState: _audioCtx?.state });
          currentResumeOnce = null;
        }
      }, 50);
    };
    currentResumeOnce = resumeOnce;
    document.addEventListener('touchstart', resumeOnce, { once: false, passive: true });
    document.addEventListener('click', resumeOnce, { passive: true });
  };
  // Expose installGestureListener so connectAudioChain's onstatechange can call it.
  // onstatechange fires from the audio thread (not throttled), so this is the
  // correct moment to install a gesture listener if ctx.resume() can't fire alone.
  _installGestureListener = installGestureListener;
}

/**
 * Connect the Web Audio chain to an audio element — SINGLETON.
 *
 * connectAudioChain(audioElement) is idempotent:
 * - First call: creates AudioContext + MediaElementAudioSourceNode + returns them
 * - Subsequent calls with same element: returns existing chain (alreadyWired=true)
 * - If element changes (rare — only if DOM element itself changes): re-creates source
 *
 * The caller is responsible for building the processing chain from the returned source node.
 * The source node stays wired through audio.src changes automatically.
 */
export function connectAudioChain(audio: HTMLAudioElement): AudioChainResult | null {
  // Already wired to this element — just ensure context is running
  if (_connectedElement === audio && _chainWired && _audioCtx && _sourceNode) {
    if (_audioCtx.state === 'suspended' || (_audioCtx as any).state === 'interrupted') {
      _audioCtx.resume().catch(() => {});
    }
    return { ctx: _audioCtx, source: _sourceNode, alreadyWired: true };
  }

  try {
    // Fresh context if closed or missing
    if (_audioCtx && _audioCtx.state === 'closed') {
      _audioCtx = null; _sourceNode = null; _chainWired = false;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    // latencyHint: 'playback' uses larger audio buffers (~256-512 samples
    // vs ~128 for 'interactive') which dramatically reduces audio thread
    // pressure on weak devices. For music playback this is invisible — the
    // user doesn't care about ~10ms more latency. The trade-off prevents
    // the audio thread from underrunning when CPU spikes (= audible cracks).
    if (!_audioCtx) {
      _audioCtx = new AudioContextClass({ latencyHint: 'playback' });
      // onstatechange fires from the OS audio thread — NOT from JS timers, NOT
      // throttled in background. When Chrome/Android suspends the context for
      // power management, this fires immediately and we can resume before the
      // user hears a gap. This is the correct fix; setTimeout/MessageChannel
      // polling is throttled to ~1/min in background tabs.
      _audioCtx.onstatechange = () => {
        const ctx = _audioCtx;
        if (!ctx) return;
        const state = ctx.state as AudioContextState | 'interrupted';
        if (state === 'suspended' || state === 'interrupted') {
          if (usePlayerStore.getState().isPlaying) {
            // Try immediate resume (works if Chrome hasn't fully gated it)
            ctx.resume().catch(() => {});
            // Also install touch/click gesture listener in case resume needs user gesture
            _installGestureListener?.();
          }
        }
        // Fan out to subscribers (bgEngine, etc.) — they may want to
        // do additional recovery work like kicking the audio element.
        for (const sub of _ctxStateSubs) {
          try { sub(state); } catch {}
        }
      };
    }
    if (_audioCtx.state === 'suspended' || (_audioCtx as any).state === 'interrupted') {
      _audioCtx.resume().catch(() => {});
    }

    // Different audio element — rare (only if DOM element itself changes)
    if (_connectedElement && _connectedElement !== audio) {
      if (_sourceNode) try { _sourceNode.disconnect(); } catch {}
      _sourceNode = null;
      _chainWired = false;
    }

    // Create source node ONCE per audio element — this is permanent
    if (!_sourceNode) {
      _sourceNode = _audioCtx.createMediaElementSource(audio);
    }

    // ANALYSER NODE — passive tap on the audio signal for visualization.
    // Doesn't modify the audio chain in any way (no gain, no latency,
    // no CPU cost beyond the FFT when someone reads the data). Only
    // created ONCE — the AudioPlayer's frequency pump reads it via
    // getAnalyser() and writes CSS custom properties for visual response.
    if (!_analyserNode && _audioCtx) {
      _analyserNode = _audioCtx.createAnalyser();
      _analyserNode.fftSize = 256; // 128 frequency bins — lightweight
      _analyserNode.smoothingTimeConstant = 0.8; // smooth visual movement
    }

    _connectedElement = audio;
    _chainWired = true;

    return { ctx: _audioCtx, source: _sourceNode, alreadyWired: false };
  } catch (e) {
    devWarn('[AudioEngine] connectAudioChain failed:', e);
    // Last resort: if source exists, connect straight to destination
    if (_sourceNode && _audioCtx) {
      try { _sourceNode.connect(_audioCtx.destination); } catch {}
    }
    _connectedElement = audio;
    _chainWired = false;
    return null;
  }
}

/**
 * Teardown the audio chain's source connections WITHOUT closing the context
 * or destroying the source node. Used by AudioErrorBoundary before remount
 * (Finding #5 in outputs/AUDIT-DSP-voyex.md): the crashed mount's chain
 * nodes are orphaned by hook-ref teardown, but the _sourceNode → chain
 * connection survives at this (singleton) layer and would cause a doubly-
 * connected graph after remount.
 *
 * We disconnect the source from whatever it's connected to, then flip
 * _chainWired = false so the next connectAudioChain() call will treat this
 * as "fresh wire-up" and the hook can rebuild the processing graph. We
 * deliberately keep _sourceNode alive — createMediaElementSource can only
 * be called ONCE per audio element, so tearing it down would lock the
 * element out of Web Audio for the rest of the session.
 */
export function teardownAudioChain(): void {
  if (_sourceNode) {
    try { _sourceNode.disconnect(); } catch {}
  }
  _chainWired = false;
  _connectedElement = null;
}

/**
 * Get the singleton AudioContext (if created). Used for suspend/resume battery optimization.
 */
export function getAudioContext(): AudioContext | null {
  return _audioCtx;
}

/**
 * Get the AnalyserNode for audio visualization. Returns null if the chain
 * hasn't been wired yet. The caller should check for null and bail.
 */
export function getAnalyser(): AnalyserNode | null {
  return _analyserNode;
}

/**
 * Check if the audio chain is currently wired.
 */
export function isChainConnected(): boolean {
  return _chainWired;
}

export interface BufferHealth {
  current: number;        // Current buffer in seconds
  target: number;         // Target buffer in seconds
  status: BufferStatus;   // Overall health status
  percentage: number;     // 0-100 how full the buffer is
}

export interface NetworkStats {
  speed: number;          // Estimated speed in kbps
  latency: number;        // Average latency in ms
  lastMeasured: number;   // Timestamp of last measurement
}

export interface PrefetchStatus {
  trackId: string;
  status: 'pending' | 'loading' | 'ready' | 'failed';
  progress: number;       // 0-100
  startTime: number;
  endTime?: number;
}

interface DownloadMeasurement {
  bytes: number;
  duration: number;       // in ms
  timestamp: number;
}

class AudioEngine {
  // Buffer configuration
  private readonly BUFFER_TARGET = 15;           // Target 15 seconds buffered
  private readonly EMERGENCY_THRESHOLD = 3;      // Emergency if < 3 seconds
  private readonly WARNING_THRESHOLD = 8;        // Warning if < 8 seconds
  private readonly PREFETCH_PROGRESS = 50;       // Start prefetch at 50% track progress

  // Bitrate thresholds (kbps)
  private readonly BITRATE_HIGH_THRESHOLD = 1000;   // > 1 Mbps
  private readonly BITRATE_MEDIUM_THRESHOLD = 400;  // > 400 kbps

  // Quality levels (match backend expectations)
  private readonly BITRATE_QUALITY: Record<BitrateLevel, number> = {
    low: 64,      // 64 kbps
    medium: 128,  // 128 kbps
    high: 256,    // 256 kbps
  };

  // Network monitoring
  private networkStats: NetworkStats = {
    speed: 1000,        // Assume decent connection initially
    latency: 100,       // Assume 100ms latency initially
    lastMeasured: 0,
  };

  private downloadMeasurements: DownloadMeasurement[] = [];
  private readonly MAX_MEASUREMENTS = 10;  // Keep last 10 measurements

  // Singleton pattern
  private static instance: AudioEngine | null = null;

  private constructor() {
    // Audio engine initialized
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  /**
   * Measure current buffer health for an audio element
   */
  getBufferHealth(audioElement: HTMLMediaElement | null): BufferHealth {
    if (!audioElement) {
      return {
        current: 0,
        target: this.BUFFER_TARGET,
        status: 'emergency',
        percentage: 0,
      };
    }

    const buffered = audioElement.buffered;
    const currentTime = audioElement.currentTime;

    let bufferAhead = 0;

    // Find how much is buffered ahead of current playback position
    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);

      if (start <= currentTime && end > currentTime) {
        bufferAhead = end - currentTime;
        break;
      }
    }

    // Calculate status
    let status: BufferStatus = 'healthy';
    if (bufferAhead < this.EMERGENCY_THRESHOLD) {
      status = 'emergency';
    } else if (bufferAhead < this.WARNING_THRESHOLD) {
      status = 'warning';
    }

    // Calculate percentage (capped at 100%)
    const percentage = Math.min(100, (bufferAhead / this.BUFFER_TARGET) * 100);

    return {
      current: bufferAhead,
      target: this.BUFFER_TARGET,
      status,
      percentage: Math.round(percentage),
    };
  }

  // (audit-3) Removed startBufferMonitoring/stopBufferMonitoring +
  // related state. ~80 lines of dead 5s-interval scaffolding with zero
  // external callers (only self-references). getBufferHealth() is still
  // exposed below for synchronous one-off checks, which is the only
  // pattern actually in use.

  /**
   * Record a download measurement for network speed estimation
   */
  recordDownloadMeasurement(bytes: number, durationMs: number): void {
    const measurement: DownloadMeasurement = {
      bytes,
      duration: durationMs,
      timestamp: Date.now(),
    };

    this.downloadMeasurements.push(measurement);

    // Keep only last N measurements
    if (this.downloadMeasurements.length > this.MAX_MEASUREMENTS) {
      this.downloadMeasurements.shift();
    }

    // Update network stats
    this.updateNetworkStats();
  }

  /**
   * Update network statistics based on recent measurements
   */
  private updateNetworkStats(): void {
    if (this.downloadMeasurements.length === 0) return;

    // Calculate average speed from recent measurements
    let totalSpeed = 0;
    let count = 0;

    const now = Date.now();
    const recentThreshold = 30000; // Only consider measurements from last 30s

    for (const measurement of this.downloadMeasurements) {
      if (now - measurement.timestamp < recentThreshold) {
        // Convert to kbps: (bytes / duration_ms) * 8 * 1000
        const speedKbps = (measurement.bytes / measurement.duration) * 8;
        totalSpeed += speedKbps;
        count++;
      }
    }

    if (count > 0) {
      this.networkStats.speed = Math.round(totalSpeed / count);
      this.networkStats.lastMeasured = now;

    }
  }

  /**
   * Estimate current network speed
   */
  estimateNetworkSpeed(): number {
    return this.networkStats.speed;
  }

  /**
   * Get current network statistics
   */
  getNetworkStats(): NetworkStats {
    return { ...this.networkStats };
  }

  /**
   * Select optimal bitrate based on current network conditions
   */
  selectOptimalBitrate(): BitrateLevel {
    const speed = this.networkStats.speed;

    if (speed >= this.BITRATE_HIGH_THRESHOLD) {
      return 'high';
    } else if (speed >= this.BITRATE_MEDIUM_THRESHOLD) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Get the bitrate value (in kbps) for a quality level
   */
  getBitrateValue(level: BitrateLevel): number {
    return this.BITRATE_QUALITY[level];
  }

}

// Export singleton instance
export const audioEngine = AudioEngine.getInstance();
