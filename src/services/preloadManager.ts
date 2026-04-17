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
import { trace } from './telemetry';

// VPS audio proxy — authoritative cold-extraction route.
// Edge Worker dropped: CF datacenter IPs get bot-detected by YouTube.
const VPS_AUDIO_URL = 'https://stream.zionsynapse.online:8443';

// Only 1 concurrent VPS cold preload — each uses a FFmpeg slot on the VPS.
// Tracks[1] and [2] in the preload queue are often reshuffled before being
// played; warming them all simultaneously wastes slots.
let vpsPreloadInFlight = 0;

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
    trace('preload_skip', normalizedId, { why: 'already_ready', source: existingPreload.source });
    devLog('🔮 [Preload] Already preloaded in cache:', normalizedId);
    return existingPreload;
  }

  // Already preloading this specific track
  if (trackAbortControllers.has(normalizedId)) {
    trace('preload_skip', normalizedId, { why: 'already_in_flight' });
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

  trace('preload_start', normalizedId, { hidden: typeof document !== 'undefined' && document.hidden });
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
        // FIX: remove the half-baked entry from the map too. Previously
        // aborted preloads left zombie entries that would be returned by
        // isPreloaded()/getPreloadedTrack() (isReady=false) forever.
        audioEl.src = '';
        audioEl.pause();
        state.preloadedTracks.delete(normalizedId);
        trackAbortControllers.delete(normalizedId);
        trace('preload_abort', normalizedId, { source: 'cached', stage: 'after_wait' });
        return null;
      }

      preloadEntry.isReady = true;
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      trace('preload_complete', normalizedId, { source: 'cached' });
      devLog('🔮 [Preload] ✅ Local cache preload complete');
      return preloadEntry;
    }

    // STEP 2: Check R2 collective cache
    const r2Result = await checkR2Cache(normalizedId);

    if (signal.aborted) {
      trackAbortControllers.delete(normalizedId);
      return null;
    }

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
        audioEl.pause();
        state.preloadedTracks.delete(normalizedId);
        trackAbortControllers.delete(normalizedId);
        trace('preload_abort', normalizedId, { source: 'r2', stage: 'after_wait' });
        return null;
      }

      preloadEntry.isReady = true;
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      trace('preload_complete', normalizedId, { source: 'r2' });
      devLog('🔮 [Preload] ✅ R2 preload complete');
      return preloadEntry;
    }

    // STEP 3: Cold track — preload via VPS streaming extraction.
    // Edge Worker /stream path dropped: CF datacenter IPs get bot-detected
    // by YouTube, so the endpoint returns 502 on most cold tracks. VPS yt-dlp
    // is the authoritative cold-extraction route.
    devLog('🔮 [Preload] Not in cache/R2, attempting VPS cold preload');

    if (vpsPreloadInFlight > 0) {
      devLog('🔮 [Preload] VPS preload cap reached — skipping cold preload');
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      return null;
    }

    vpsPreloadInFlight++;
    try {
      const vpsUrl = `${VPS_AUDIO_URL}/voyo/audio/${normalizedId}?quality=high`;
      const audioEl = createPreloadAudioElement(vpsUrl, signal);

      const preloadEntry: PreloadedTrack = {
        trackId,
        normalizedId,
        // 'r2' label so sourceResolver preload_check accepts it (checks for
        // source === 'cached' || source === 'r2'). The actual bytes come from
        // VPS but the contract is identical: url + audioElement already primed.
        source: 'r2',
        url: vpsUrl,
        audioElement: audioEl,
        isReady: false,
        preloadedAt: Date.now(),
      };

      state.preloaded = preloadEntry;
      state.preloadedTracks.set(normalizedId, preloadEntry);
      evictOldPreloads();

      // VPS cold extraction (yt-dlp + FFmpeg) takes 10-20s TTFB on first
      // request. Give the audio element enough time to receive the OGG header
      // and trigger canplaythrough. Resolves on partial buffer (good enough).
      await waitForAudioReady(audioEl, signal, 20000);

      if (signal.aborted) {
        audioEl.src = '';
        audioEl.pause();
        state.preloadedTracks.delete(normalizedId);
        trackAbortControllers.delete(normalizedId);
        trace('preload_abort', normalizedId, { source: 'vps', stage: 'after_wait' });
        return null;
      }

      preloadEntry.isReady = true;
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      trace('preload_complete', normalizedId, { source: 'vps' });
      devLog('🔮 [Preload] ✅ VPS cold stream preload complete');
      return preloadEntry;
    } catch (extractError) {
      devWarn('🔮 [Preload] VPS preload error:', extractError);
      state.isPreloading = false;
      trackAbortControllers.delete(normalizedId);
      trace('preload_fail', normalizedId, { source: 'vps', err: (extractError as Error)?.name, msg: ((extractError as Error)?.message || '').slice(0, 80) });
      return null;
    } finally {
      vpsPreloadInFlight = Math.max(0, vpsPreloadInFlight - 1);
    }

  } catch (error) {
    devWarn('🔮 [Preload] Error:', error);
    state.isPreloading = false;
    trackAbortControllers.delete(normalizedId);
    trace('preload_fail', normalizedId, { source: 'top', err: (error as Error)?.name, msg: ((error as Error)?.message || '').slice(0, 80) });
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
    // ABORT CONTROLLER EVICTION: if a preload got evicted while its
    // fetch was still in flight, the abort controller stayed in the
    // Map forever. Across a long listening session (50+ skips), this
    // leaks a small object per evicted track. Aborting + deleting here
    // releases the memory and cancels the stale fetch.
    const ctrl = trackAbortControllers.get(key);
    if (ctrl) {
      try { ctrl.abort(); } catch {}
      trackAbortControllers.delete(key);
    }
    devLog(`🔮 [Preload] Evicted oldest preload: ${key}`);
  }

  // Safety net: if trackAbortControllers has grown to an absurd size
  // (shouldn't, but defensive), drop any controller whose track is no
  // longer in preloadedTracks. This catches any path that forgot to
  // delete after completion.
  if (trackAbortControllers.size > 20) {
    const liveKeys = new Set(state.preloadedTracks.keys());
    for (const [key, ctrl] of trackAbortControllers) {
      if (!liveKeys.has(key)) {
        try { ctrl.abort(); } catch {}
        trackAbortControllers.delete(key);
      }
    }
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
 *
 * Also sweeps the preloadedTracks map for half-baked (isReady=false) entries
 * whose audio elements were just orphaned by the abort. Without this sweep,
 * repeated cancellations (e.g. rapid track-skipping) would leave zombie
 * entries in the map with dead audio elements, slowly leaking memory.
 */
export function cancelPreload(): void {
  const inFlight = trackAbortControllers.size;
  const nonReadyCount = (() => {
    let n = 0;
    for (const [, entry] of state.preloadedTracks) if (!entry.isReady) n++;
    return n;
  })();
  if (inFlight > 0 || nonReadyCount > 0) {
    trace('preload_cancel', null, { inFlight, nonReadyCount });
  }
  if (preloadAbortController) {
    preloadAbortController.abort();
    preloadAbortController = null;
  }
  // Cancel all track-specific abort controllers
  for (const [, ctrl] of trackAbortControllers) {
    ctrl.abort();
  }
  trackAbortControllers.clear();
  // Sweep non-ready entries from the multi-track cache.
  for (const [key, entry] of state.preloadedTracks) {
    if (!entry.isReady) {
      if (entry.audioElement) {
        try { entry.audioElement.pause(); } catch {}
        entry.audioElement.src = '';
        entry.audioElement = null;
      }
      state.preloadedTracks.delete(key);
    }
  }
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
