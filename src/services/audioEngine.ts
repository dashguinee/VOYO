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

import { mediaCache } from './mediaCache';
import { devLog, devWarn } from '../utils/logger';

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
  const resumeCtx = () => {
    if (_audioCtx && (_audioCtx.state === 'suspended' || (_audioCtx as any).state === 'interrupted')) {
      _audioCtx.resume().catch(() => {});
    }
  };
  const onVisibilityChange = () => {
    if (document.hidden) return;
    requestAnimationFrame(resumeCtx);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', () => requestAnimationFrame(resumeCtx));
  // iOS/Android: After phone lock/unlock, AudioContext goes to 'interrupted' state.
  // A user gesture (touch/click) is required to resume it.
  // CRITICAL: only attach the gesture listeners while context is actually
  // suspended/interrupted. Previously these were always-on at document level
  // and fired on EVERY tap/click in the app — even though resumeCtx() does
  // a fast state check, the listener overhead added micro-jank to every
  // interaction. Now we install on-demand and remove after the first
  // successful resume.
  let gestureListenerActive = false;
  const installGestureListener = () => {
    if (gestureListenerActive) return;
    gestureListenerActive = true;
    const resumeOnce = () => {
      resumeCtx();
      // Wait one tick — if context successfully ran, remove the listener.
      setTimeout(() => {
        if (_audioCtx && _audioCtx.state === 'running') {
          document.removeEventListener('touchstart', resumeOnce);
          document.removeEventListener('click', resumeOnce);
          gestureListenerActive = false;
        }
      }, 50);
    };
    document.addEventListener('touchstart', resumeOnce, { once: false, passive: true });
    document.addEventListener('click', resumeOnce, { passive: true });
  };
  // Watch for context state changes — install gesture listener when needed.
  const watchContextState = setInterval(() => {
    if (_audioCtx && (_audioCtx.state === 'suspended' || (_audioCtx as any).state === 'interrupted')) {
      installGestureListener();
    }
  }, 2000);
  // Cleanup interval on page unload (best effort)
  window.addEventListener('beforeunload', () => clearInterval(watchContextState));
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

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    // latencyHint: 'playback' uses larger audio buffers (~256-512 samples
    // vs ~128 for 'interactive') which dramatically reduces audio thread
    // pressure on weak devices. For music playback this is invisible — the
    // user doesn't care about ~10ms more latency. The trade-off prevents
    // the audio thread from underrunning when CPU spikes (= audible cracks).
    if (!_audioCtx) _audioCtx = new AudioContextClass({ latencyHint: 'playback' });
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

  // Preload cache - stores blob URLs for preloaded tracks
  private preloadCache: Map<string, string> = new Map();
  private readonly MAX_CACHE_SIZE = 10;  // LRU cache limit

  // Prefetch tracking
  private activePrefetch: Map<string, PrefetchStatus> = new Map();
  private prefetchAbortController: AbortController | null = null;

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

  // Active buffer monitoring state
  private bufferMonitorInterval: ReturnType<typeof setInterval> | null = null;
  private monitoredElement: HTMLMediaElement | null = null;
  private onBufferEmergency: ((health: BufferHealth) => void) | null = null;
  private onBufferWarning: ((health: BufferHealth) => void) | null = null;

  /**
   * Start active buffer health monitoring during playback.
   * Checks every 2 seconds and triggers callbacks on emergency/warning.
   *
   * @param audioElement - The audio element to monitor
   * @param onEmergency - Called when buffer < 3s (emergency)
   * @param onWarning - Called when buffer < 8s (warning)
   * @returns cleanup function to stop monitoring
   */
  startBufferMonitoring(
    audioElement: HTMLMediaElement,
    onEmergency: (health: BufferHealth) => void,
    onWarning: (health: BufferHealth) => void
  ): () => void {
    // Stop any existing monitoring first
    this.stopBufferMonitoring();

    this.monitoredElement = audioElement;
    this.onBufferEmergency = onEmergency;
    this.onBufferWarning = onWarning;

    this.bufferMonitorInterval = setInterval(() => {
      if (!this.monitoredElement || this.monitoredElement.paused) return;

      const health = this.getBufferHealth(this.monitoredElement);

      if (health.status === 'emergency' && this.onBufferEmergency) {
        this.onBufferEmergency(health);
      } else if (health.status === 'warning' && this.onBufferWarning) {
        this.onBufferWarning(health);
      }
    }, 5000); // Check every 5 seconds — was 2s, reduced to lower wasted CPU during steady playback

    return () => this.stopBufferMonitoring();
  }

  /**
   * Stop active buffer monitoring
   */
  stopBufferMonitoring(): void {
    if (this.bufferMonitorInterval) {
      clearInterval(this.bufferMonitorInterval);
      this.bufferMonitorInterval = null;
    }
    this.monitoredElement = null;
    this.onBufferEmergency = null;
    this.onBufferWarning = null;
  }

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

  /**
   * Preload a track into cache
   */
  async preloadTrack(
    trackId: string,
    apiBase: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    // Check if already cached
    if (this.preloadCache.has(trackId)) {
      return;
    }

    // Check if already loading
    if (this.activePrefetch.has(trackId)) {
      return;
    }


    const prefetchStatus: PrefetchStatus = {
      trackId,
      status: 'loading',
      progress: 0,
      startTime: Date.now(),
    };

    this.activePrefetch.set(trackId, prefetchStatus);

    // Create abort controller for this prefetch
    this.prefetchAbortController = new AbortController();

    try {
      const bitrate = this.selectOptimalBitrate();
      const streamUrl = `${apiBase}/audio/${trackId}?quality=${bitrate}`;

      const startTime = Date.now();
      const response = await fetch(streamUrl, {
        signal: this.prefetchAbortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Prefetch failed: ${response.status}`);
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

      // Stream the response and track progress
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const chunks: BlobPart[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Convert to ArrayBuffer for Blob compatibility
        chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        receivedBytes += value.length;

        // Update progress
        if (contentLength > 0) {
          const progress = Math.round((receivedBytes / contentLength) * 100);
          prefetchStatus.progress = progress;
          onProgress?.(progress);
        }
      }

      // Combine chunks into single blob
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      const blobUrl = URL.createObjectURL(blob);

      // Cache the blob URL with LRU eviction
      this.preloadCache.set(trackId, blobUrl);

      // LRU eviction: if cache exceeds limit, remove oldest entry
      if (this.preloadCache.size > this.MAX_CACHE_SIZE) {
        const oldestKey = this.preloadCache.keys().next().value;
        if (oldestKey) {
          const oldestUrl = this.preloadCache.get(oldestKey);
          if (oldestUrl) {
            URL.revokeObjectURL(oldestUrl);
          }
          this.preloadCache.delete(oldestKey);
        }
      }

      const duration = Date.now() - startTime;

      // Record download measurement for network speed estimation
      this.recordDownloadMeasurement(receivedBytes, duration);

      prefetchStatus.status = 'ready';
      prefetchStatus.progress = 100;
      prefetchStatus.endTime = Date.now();

    } catch (error: any) {
      if (error.name === 'AbortError') {
        prefetchStatus.status = 'pending';
      } else {
        prefetchStatus.status = 'failed';
      }

      this.activePrefetch.delete(trackId);
    }
  }

  /**
   * Cancel active prefetch
   */
  cancelPrefetch(): void {
    if (this.prefetchAbortController) {
      this.prefetchAbortController.abort();
      this.prefetchAbortController = null;
    }
  }

  /**
   * Get cached blob URL for a track
   */
  getCachedTrack(trackId: string): string | null {
    return this.preloadCache.get(trackId) || null;
  }

  /**
   * Check if a track is cached
   */
  isTrackCached(trackId: string): boolean {
    return this.preloadCache.has(trackId);
  }

  /**
   * Get prefetch status for a track
   */
  getPrefetchStatus(trackId: string): PrefetchStatus | null {
    return this.activePrefetch.get(trackId) || null;
  }

  /**
   * Clear a specific track from cache
   */
  clearTrackCache(trackId: string): void {
    const blobUrl = this.preloadCache.get(trackId);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      this.preloadCache.delete(trackId);
    }
    this.activePrefetch.delete(trackId);
  }

  /**
   * Clear all cached tracks (for memory management)
   */
  clearAllCache(): void {
    // Revoke all blob URLs to free memory
    for (const blobUrl of this.preloadCache.values()) {
      URL.revokeObjectURL(blobUrl);
    }

    this.preloadCache.clear();
    this.activePrefetch.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cachedTracks: this.preloadCache.size,
      activePrefetches: this.activePrefetch.size,
      prefetchStatuses: Array.from(this.activePrefetch.values()),
    };
  }

  /**
   * Get best audio URL for a track - checks all caches first
   * Priority: 1. MediaCache blob, 2. AudioEngine blob, 3. CDN URL
   */
  getBestAudioUrl(trackId: string, apiBase: string): { url: string; cached: boolean; source: string } {
    // 1. Check MediaCache (from feed pre-caching)
    const mediaCached = mediaCache.get(trackId);
    if (mediaCached?.audioUrl) {
      devLog(`[AudioEngine] Using MediaCache blob for ${trackId}`);
      return { url: mediaCached.audioUrl, cached: true, source: 'mediaCache' };
    }

    // 2. Check AudioEngine's own preload cache
    const engineCached = this.preloadCache.get(trackId);
    if (engineCached) {
      devLog(`[AudioEngine] Using AudioEngine blob for ${trackId}`);
      return { url: engineCached, cached: true, source: 'audioEngine' };
    }

    // 3. Fall back to CDN
    const quality = this.selectOptimalBitrate();
    const cdnUrl = `${apiBase}/audio/${trackId}?quality=${quality}`;
    return { url: cdnUrl, cached: false, source: 'cdn' };
  }

  /**
   * Get best thumbnail URL for a track
   */
  getBestThumbnailUrl(trackId: string): string {
    // Check MediaCache first
    const mediaCached = mediaCache.get(trackId);
    if (mediaCached?.thumbnailUrl) {
      return mediaCached.thumbnailUrl;
    }

    // Fall back to YouTube
    return `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`;
  }
}

// Export singleton instance
export const audioEngine = AudioEngine.getInstance();
