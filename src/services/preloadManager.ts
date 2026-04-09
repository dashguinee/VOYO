/**
 * VOYO Preload Manager - Professional-grade next-track preloading
 *
 * Inspired by Spotify/YouTube Music for gapless playback.
 *
 * STRATEGY (like major platforms):
 * 1. Start preloading IMMEDIATELY when next track is known
 * 2. Use a hidden audio element that actually buffers the audio data
 * 3. When track changes, audio is already buffered → instant playback
 * 4. For R2 misses, extract via Edge Worker and cache locally
 *
 * PRELOAD SOURCES (priority order):
 * 1. Local IndexedDB cache → Fastest, already downloaded
 * 2. R2 collective cache → Fast, 170K+ shared tracks
 * 3. Edge Worker extraction → Extract, cache, then buffer
 *
 * KEY DIFFERENCE from basic preloading:
 * - We actually LOAD the audio data into the browser's buffer
 * - Not just creating an element, but calling load() and waiting for canplaythrough
 * - This is how Spotify achieves gapless playback
 */

import { checkR2Cache } from './api';
import { devLog, devWarn } from '../utils/logger';

// Edge Worker for extraction (FREE - replaces Fly.io)
const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';

// Decode VOYO ID to YouTube ID
function decodeVoyoId(voyoId: string): string {
  if (!voyoId.startsWith('vyo_')) {
    return voyoId;
  }
  const encoded = voyoId.substring(4);
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  try {
    return atob(base64);
  } catch {
    return voyoId;
  }
}

export interface PreloadedTrack {
  trackId: string;
  normalizedId: string;
  source: 'cached' | 'r2';
  url: string | null;
  audioElement: HTMLAudioElement | null;
  isReady: boolean;
  preloadedAt: number;
}

interface PreloadManager {
  preloaded: PreloadedTrack | null;
  isPreloading: boolean;
  lastPreloadedId: string | null;
  // Multi-track preload cache (up to 3 tracks)
  preloadedTracks: Map<string, PreloadedTrack>;
}

const state: PreloadManager = {
  preloaded: null,
  isPreloading: false,
  lastPreloadedId: null,
  preloadedTracks: new Map(),
};

// Keep reference to abort controllers for cleanup (one per track)
let preloadAbortController: AbortController | null = null;
const trackAbortControllers: Map<string, AbortController> = new Map();

// Max preloaded tracks to keep in memory
const MAX_PRELOADED_TRACKS = 3;

/**
 * Preload the next track for instant playback
 * Supports multiple concurrent preloads (staggered by AudioPlayer)
 */
export async function preloadNextTrack(
  trackId: string,
  checkLocalCache: (id: string) => Promise<string | null>
): Promise<PreloadedTrack | null> {
  const normalizedId = decodeVoyoId(trackId);

  // Already preloaded this track in multi-track cache
  const existingPreload = state.preloadedTracks.get(normalizedId);
  if (existingPreload?.isReady) {
    devLog('🔮 [Preload] Already preloaded in cache:', normalizedId);
    return existingPreload;
  }

  // Already preloading this specific track
  if (trackAbortControllers.has(normalizedId)) {
    devLog('🔮 [Preload] Already preloading:', normalizedId);
    return state.preloadedTracks.get(normalizedId) || state.preloaded;
  }

  // Create abort controller for this specific track
  const abortCtrl = new AbortController();
  trackAbortControllers.set(normalizedId, abortCtrl);
  const signal = abortCtrl.signal;

  // Also set legacy single-track state for backward compatibility
  state.isPreloading = true;
  state.lastPreloadedId = normalizedId;

  devLog('🔮 [Preload] Starting preload for:', normalizedId);

  try {
    // STEP 1: Check local cache (IndexedDB) - fastest
    const cachedUrl = await checkLocalCache(trackId);

    if (signal.aborted) return null;

    if (cachedUrl) {
      devLog('🔮 [Preload] Found in local cache, preloading audio element');
      const audioEl = createPreloadAudioElement(cachedUrl, signal);

      const preloadEntry: PreloadedTrack = {
        trackId,
        normalizedId,
        source: 'cached',
        url: cachedUrl,
        audioElement: audioEl,
        isReady: false,
        preloadedAt: Date.now(),
      };

      state.preloaded = preloadEntry;
      state.preloadedTracks.set(normalizedId, preloadEntry);
      evictOldPreloads();

      await waitForAudioReady(audioEl, signal);

      if (signal.aborted) {
        audioEl.src = '';
        return null;
      }

      preloadEntry.isReady = true;
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      devLog('🔮 [Preload] ✅ Local cache preload complete');
      return preloadEntry;
    }

    // STEP 2: Check R2 collective cache
    const r2Result = await checkR2Cache(normalizedId);

    if (signal.aborted) return null;

    if (r2Result.exists && r2Result.url) {
      devLog('🔮 [Preload] Found in R2, preloading audio element');
      const audioEl = createPreloadAudioElement(r2Result.url, signal);

      const preloadEntry: PreloadedTrack = {
        trackId,
        normalizedId,
        source: 'r2',
        url: r2Result.url,
        audioElement: audioEl,
        isReady: false,
        preloadedAt: Date.now(),
      };

      state.preloaded = preloadEntry;
      state.preloadedTracks.set(normalizedId, preloadEntry);
      evictOldPreloads();

      await waitForAudioReady(audioEl, signal, 5000);

      if (signal.aborted) {
        audioEl.src = '';
        return null;
      }

      preloadEntry.isReady = true;
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      devLog('🔮 [Preload] ✅ R2 preload complete');
      return preloadEntry;
    }

    // STEP 3: Get YouTube direct URL and preload
    devLog('🔮 [Preload] Not in cache/R2, getting YouTube stream URL');

    try {
      const streamResponse = await fetch(`${EDGE_WORKER_URL}/stream?v=${normalizedId}`);

      if (signal.aborted) return null;

      const streamData = await streamResponse.json();

      if (!streamData.url) {
        devWarn('🔮 [Preload] No stream URL available for:', normalizedId);
        state.isPreloading = false;
        trackAbortControllers.delete(normalizedId);
        return null;
      }

      const audioEl = createPreloadAudioElement(streamData.url, signal);

      const preloadEntry: PreloadedTrack = {
        trackId,
        normalizedId,
        source: 'r2', // Treat as r2 for consistent handling
        url: streamData.url,
        audioElement: audioEl,
        isReady: false,
        preloadedAt: Date.now(),
      };

      state.preloaded = preloadEntry;
      state.preloadedTracks.set(normalizedId, preloadEntry);
      evictOldPreloads();

      await waitForAudioReady(audioEl, signal, 8000);

      if (signal.aborted) {
        audioEl.src = '';
        return null;
      }

      preloadEntry.isReady = true;
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      devLog('🔮 [Preload] ✅ YouTube direct stream preload complete');
      return preloadEntry;
    } catch (extractError) {
      devWarn('🔮 [Preload] Stream preload error:', extractError);
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      return null;
    }

  } catch (error) {
    devWarn('🔮 [Preload] Error:', error);
    state.isPreloading = false;
    trackAbortControllers.delete(normalizedId);
    return null;
  }
}

/**
 * Evict oldest preloaded tracks when exceeding MAX_PRELOADED_TRACKS
 */
function evictOldPreloads(): void {
  if (state.preloadedTracks.size <= MAX_PRELOADED_TRACKS) return;

  // Sort by preloadedAt, evict oldest
  const entries = Array.from(state.preloadedTracks.entries())
    .sort((a, b) => a[1].preloadedAt - b[1].preloadedAt);

  while (entries.length > MAX_PRELOADED_TRACKS) {
    const [key, entry] = entries.shift()!;
    if (entry.audioElement) {
      entry.audioElement.pause();
      entry.audioElement.src = '';
    }
    state.preloadedTracks.delete(key);
    devLog(`🔮 [Preload] Evicted oldest preload: ${key}`);
  }
}

/**
 * Get preloaded track if available for the given trackId
 * Checks multi-track cache first, then legacy single-track state
 */
export function getPreloadedTrack(trackId: string): PreloadedTrack | null {
  const normalizedId = decodeVoyoId(trackId);

  // Check multi-track cache first
  const cached = state.preloadedTracks.get(normalizedId);
  if (cached?.isReady) {
    return cached;
  }

  // Fallback to legacy single-track state
  if (state.preloaded?.normalizedId === normalizedId && state.preloaded.isReady) {
    return state.preloaded;
  }

  return null;
}

/**
 * Consume the preloaded audio element (transfers ownership to caller)
 * Returns the element and clears it from preload cache
 */
export function consumePreloadedAudio(trackId: string): HTMLAudioElement | null {
  const normalizedId = decodeVoyoId(trackId);

  // Check multi-track cache first
  const cached = state.preloadedTracks.get(normalizedId);
  if (cached?.audioElement) {
    const audioEl = cached.audioElement;
    cached.audioElement = null; // Transfer ownership
    state.preloadedTracks.delete(normalizedId);
    devLog('🔮 [Preload] Consumed preloaded audio element from multi-track cache');
    return audioEl;
  }

  // Fallback to legacy single-track state
  if (state.preloaded?.normalizedId === normalizedId && state.preloaded.audioElement) {
    const audioEl = state.preloaded.audioElement;
    state.preloaded.audioElement = null; // Transfer ownership
    devLog('🔮 [Preload] Consumed preloaded audio element');
    return audioEl;
  }

  return null;
}

/**
 * Check if a track is currently preloaded and ready
 */
export function isPreloaded(trackId: string): boolean {
  const normalizedId = decodeVoyoId(trackId);
  const cached = state.preloadedTracks.get(normalizedId);
  if (cached?.isReady) return true;
  return state.preloaded?.normalizedId === normalizedId && state.preloaded.isReady;
}

/**
 * Get current preload status
 */
export function getPreloadStatus(): {
  isPreloading: boolean;
  preloadedId: string | null;
  source: 'cached' | 'r2' | null;
} {
  return {
    isPreloading: state.isPreloading,
    preloadedId: state.preloaded?.normalizedId || null,
    source: state.preloaded?.source || null,
  };
}

/**
 * Cleanup preloaded resources (all tracks)
 */
export function cleanupPreloaded(): void {
  // Clean legacy single-track state
  if (state.preloaded?.audioElement) {
    state.preloaded.audioElement.pause();
    state.preloaded.audioElement.src = '';
    state.preloaded.audioElement = null;
  }
  state.preloaded = null;

  // Clean multi-track cache
  for (const [key, entry] of state.preloadedTracks) {
    if (entry.audioElement) {
      entry.audioElement.pause();
      entry.audioElement.src = '';
    }
  }
  state.preloadedTracks.clear();
}

/**
 * Cancel any in-progress preloads
 */
export function cancelPreload(): void {
  if (preloadAbortController) {
    preloadAbortController.abort();
    preloadAbortController = null;
  }
  // Cancel all track-specific abort controllers
  for (const [key, ctrl] of trackAbortControllers) {
    ctrl.abort();
  }
  trackAbortControllers.clear();
  state.isPreloading = false;
}

// ============================================
// INTERNAL HELPERS
// ============================================

function createPreloadAudioElement(url: string, signal: AbortSignal): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = 0; // Silent during preload
  audio.src = url;

  // Cleanup on abort
  signal.addEventListener('abort', () => {
    audio.pause();
    audio.src = '';
  });

  return audio;
}

function waitForAudioReady(
  audio: HTMLAudioElement,
  signal: AbortSignal,
  timeout: number = 10000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      devLog('🔮 [Preload] Timeout waiting for audio ready, proceeding anyway');
      resolve(); // Resolve anyway - partial preload is better than none
    }, timeout);

    const cleanup = () => {
      clearTimeout(timeoutId);
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (e: Event) => {
      cleanup();
      devWarn('🔮 [Preload] Audio error during preload:', e);
      resolve(); // Still resolve - we tried
    };

    // Check if already ready
    if (audio.readyState >= 4) {
      clearTimeout(timeoutId);
      resolve();
      return;
    }

    audio.addEventListener('canplaythrough', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });

    // Handle abort
    signal.addEventListener('abort', () => {
      cleanup();
      reject(new Error('Preload aborted'));
    });

    // Trigger load
    audio.load();
  });
}
