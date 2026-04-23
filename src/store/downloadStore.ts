/**
 * VOYO Download Store - Zustand state for local caching
 *
 * BOOST SYSTEM:
 * - Manual Boost: User clicks "⚡ Boost HD" to download to IndexedDB
 * - Auto-Boost: After 3 manual boosts, prompt to enable auto-download
 * - All downloads go to USER's device (IndexedDB), not server
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  isTrackCached,
  getCachedTrackUrl,
  downloadTrack,
  getCachedTracks,
  getCacheSize,
  deleteTrack,
  clearCache,
  getDownloadSetting,
  setDownloadSetting,
  shouldAutoDownload,
  migrateVoyoIds,
  getTrackQuality,
  type DownloadSetting,
} from '../services/downloadManager';
import { audioEngine } from '../services/audioEngine';
import { devLog, devWarn } from '../utils/logger';

// Edge Worker for extraction (replaces Fly.io - FREE + faster)
const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';

interface DownloadProgress {
  trackId: string;
  progress: number;
  status: 'queued' | 'downloading' | 'complete' | 'failed';
  error?: string;
}

interface CachedTrackInfo {
  id: string;
  title: string;
  artist: string;
  size: number;
  quality: 'standard' | 'boosted';
  downloadedAt: number;
}

// Boost completion event for hot-swap
interface BoostCompletion {
  trackId: string;
  duration: number; // seconds it took
  isFast: boolean;  // < 7 seconds
  timestamp: number;
}

interface DownloadStore {
  // State
  downloads: Map<string, DownloadProgress>;
  cachedTracks: CachedTrackInfo[];
  cacheSize: number;
  downloadSetting: DownloadSetting;
  isInitialized: boolean;

  // Boost tracking (persisted)
  manualBoostCount: number;
  autoBoostEnabled: boolean;
  showAutoBoostPrompt: boolean;

  // Hot-swap tracking (for DJ rewind feature)
  boostStartTimes: Record<string, number>;
  lastBoostCompletion: BoostCompletion | null;

  // Actions
  initialize: () => Promise<void>;
  checkCache: (trackId: string) => Promise<string | null>;

  // MANUAL BOOST - User triggers HD download
  boostTrack: (trackId: string, title: string, artist: string, duration: number, thumbnail: string) => Promise<void>;

  // AUTO-CACHE - Silent background caching at standard quality
  cacheTrack: (trackId: string, title: string, artist: string, duration: number, thumbnail: string) => Promise<void>;

  // Legacy queue (for auto-boost when enabled)
  queueDownload: (trackId: string, title: string, artist: string, duration: number, thumbnail: string) => void;
  processQueue: () => Promise<void>;

  getDownloadStatus: (trackId: string) => DownloadProgress | undefined;
  isTrackBoosted: (trackId: string) => Promise<boolean>;
  removeDownload: (trackId: string) => Promise<void>;
  clearAllDownloads: () => Promise<void>;
  updateSetting: (setting: DownloadSetting) => void;
  refreshCacheInfo: () => Promise<void>;

  // Auto-boost management
  enableAutoBoost: () => void;
  disableAutoBoost: () => void;
  dismissAutoBoostPrompt: () => void;
}

// Download queue (for auto-boost)
const downloadQueue: Array<{
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}> = [];

let isProcessing = false;

/**
 * Decode VOYO ID to YouTube ID
 */
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

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  downloads: new Map(),
  cachedTracks: [],
  cacheSize: 0,
  downloadSetting: 'wifi-only',
  isInitialized: false,

  // Boost tracking — wrapped in try-catch because localStorage throws
  // in private/incognito browsing mode. Defaults to 0/false if storage
  // is unavailable so the app still works.
  manualBoostCount: (() => { try { return parseInt(localStorage.getItem('voyo-manual-boost-count') || '0', 10); } catch { return 0; } })(),
  autoBoostEnabled: (() => { try { return localStorage.getItem('voyo-auto-boost') === 'true'; } catch { return false; } })(),
  showAutoBoostPrompt: false,

  // Hot-swap tracking (for DJ rewind feature)
  boostStartTimes: {},
  lastBoostCompletion: null,

  initialize: async () => {
    if (get().isInitialized) return;

    try {
      // Migrate old VOYO IDs to raw YouTube IDs (one-time fix for existing cached tracks)
      await migrateVoyoIds();

      const setting = getDownloadSetting();
      const tracks = await getCachedTracks();
      const size = await getCacheSize();

      set({
        downloadSetting: setting,
        cachedTracks: tracks.map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          size: t.size,
          quality: t.quality,
          downloadedAt: t.downloadedAt,
        })),
        cacheSize: size,
        isInitialized: true,
      });
    } catch (e) {
      // IndexedDB unavailable (private browsing, storage blocked).
      // Initialize with empty state so the app still works.
      devWarn('[DownloadStore] Init failed (private browsing?):', e);
      set({ downloadSetting: getDownloadSetting(), isInitialized: true });
    }
  },

  checkCache: async (trackId: string) => {
    // NORMALIZE: Always check with raw YouTube ID
    const normalizedId = decodeVoyoId(trackId);
    devLog('🎵 CACHE: Checking if trackId is cached:', trackId, '→ normalized:', normalizedId);
    const cached = await isTrackCached(normalizedId);
    devLog('🎵 CACHE: isTrackCached result:', cached);
    if (cached) {
      const url = await getCachedTrackUrl(normalizedId);
      devLog('🎵 CACHE: Got blob URL:', url ? 'YES' : 'NO');
      if (url) {
        return url;
      }
    }
    return null;
  },

  // ⚡ MANUAL BOOST - User clicks button to download
  boostTrack: async (trackId, title, artist, duration, thumbnail) => {
    // NORMALIZE: Always use raw YouTube ID for storage (not VOYO encoded)
    const normalizedId = decodeVoyoId(trackId);
    devLog('🎵 BOOST: Starting boost for trackId:', trackId, '→ normalized:', normalizedId, '| title:', title);
    const { downloads, manualBoostCount, autoBoostEnabled, boostStartTimes } = get();

    // Record boost start time for hot-swap feature
    const boostStartTime = Date.now();
    set({ boostStartTimes: { ...boostStartTimes, [normalizedId]: boostStartTime } });

    // Already downloading or complete?
    const existing = downloads.get(normalizedId);
    if (existing && (existing.status === 'downloading' || existing.status === 'complete')) {
      return;
    }

    // Check if already cached at boosted quality (skip if already HD)
    const currentQuality = await getTrackQuality(normalizedId);
    if (currentQuality === 'boosted') {
      const newDownloads = new Map(downloads);
      newDownloads.set(normalizedId, { trackId: normalizedId, progress: 100, status: 'complete' });
      set({ downloads: newDownloads });
      return;
    }
    // If standard quality exists, we'll upgrade to boosted (re-download)

    // Update status to downloading
    const newDownloads = new Map(downloads);
    newDownloads.set(normalizedId, { trackId: normalizedId, progress: 0, status: 'downloading' });
    set({ downloads: newDownloads });

    try {
      // ADAPTIVE BITRATE: Use audioEngine to select optimal quality based on network
      const optimalBitrate = audioEngine.selectOptimalBitrate();
      const bitrateValue = audioEngine.getBitrateValue(optimalBitrate);
      devLog(`🎵 BOOST: Using adaptive bitrate: ${optimalBitrate} (${bitrateValue}kbps)`);

      // Extract via Edge Worker (FREE, 300+ locations, handles CORS)
      const extractUrl = `${EDGE_WORKER_URL}/extract/${normalizedId}`;

      // Download with progress tracking (throttled to 500ms)
      let lastUpdateTime = 0;
      let downloadStartTime = Date.now();
      let totalBytes = 0;

      const success = await downloadTrack(
        normalizedId,
        extractUrl,
        { title, artist, duration, thumbnail, quality: 'boosted' },
        'boosted',
        (progress) => {
          const now = Date.now();
          if (now - lastUpdateTime < 500) return; // Throttle updates
          lastUpdateTime = now;

          const currentDownloads = new Map(get().downloads);
          currentDownloads.set(normalizedId, {
            trackId: normalizedId,
            progress,
            status: 'downloading',
          });
          set({ downloads: currentDownloads });
        }
      );

      if (success) {
        devLog('🎵 BOOST: ✅ Successfully boosted trackId:', trackId, '→ stored as:', normalizedId, '| title:', title);
        const finalDownloads = new Map(get().downloads);
        finalDownloads.set(normalizedId, { trackId: normalizedId, progress: 100, status: 'complete' });

        // Calculate boost duration for hot-swap feature
        const boostEndTime = Date.now();
        const startTime = get().boostStartTimes[normalizedId] || boostStartTime;
        const boostDuration = (boostEndTime - startTime) / 1000; // seconds
        const isFastBoost = boostDuration < 7; // DJ rewind threshold

        // NETWORK INTELLIGENCE: Record download measurement for adaptive bitrate
        // Estimate file size based on average 3MB for 3min song at high quality
        const estimatedBytes = 3 * 1024 * 1024; // 3MB
        const durationMs = boostEndTime - (get().boostStartTimes[normalizedId] || boostStartTime);
        audioEngine.recordDownloadMeasurement(estimatedBytes, durationMs);

        const networkStats = audioEngine.getNetworkStats();
        devLog(`🎵 BOOST: Completed in ${boostDuration.toFixed(1)}s - ${isFastBoost ? '⚡ FAST (DJ rewind!)' : '📦 Normal'}`);
        devLog(`🎵 BOOST: Network speed estimate: ${networkStats.speed.toFixed(0)} kbps`);

        // Increment manual boost count
        const newCount = manualBoostCount + 1;
        try { localStorage.setItem('voyo-manual-boost-count', String(newCount)); } catch {}

        // Show auto-boost prompt after 3 manual boosts (if not already enabled)
        let dismissed = false;
        try { dismissed = !!localStorage.getItem('voyo-auto-boost-dismissed'); } catch {}
        const shouldPrompt = newCount >= 3 && !autoBoostEnabled && !dismissed;

        set({
          downloads: finalDownloads,
          manualBoostCount: newCount,
          showAutoBoostPrompt: shouldPrompt,
          // Emit completion event for hot-swap
          lastBoostCompletion: {
            trackId: normalizedId,
            duration: boostDuration,
            isFast: isFastBoost,
            timestamp: boostEndTime,
          },
        });

        // Refresh cache info
        await get().refreshCacheInfo();
      } else {
        throw new Error('Download failed');
      }

    } catch (error) {
      const failedDownloads = new Map(get().downloads);
      failedDownloads.set(normalizedId, {
        trackId: normalizedId,
        progress: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Download failed',
      });
      set({ downloads: failedDownloads });
    }
  },

  // 🎵 AUTO-CACHE - Silent background caching after 30s of playback
  cacheTrack: async (trackId, title, artist, duration, thumbnail) => {
    const normalizedId = decodeVoyoId(trackId);

    // Skip if already cached at ANY quality (don't downgrade or waste bandwidth)
    const currentQuality = await getTrackQuality(normalizedId);
    if (currentQuality) {
      devLog('🎵 CACHE: Track already cached at', currentQuality, 'quality, skipping:', title);
      return;
    }

    // Check network settings
    if (!shouldAutoDownload()) {
      devLog('🎵 CACHE: Network settings prevent auto-cache');
      return;
    }

    devLog('🎵 CACHE: Auto-caching track:', title);

    try {
      // Extract via Edge Worker (FREE, handles CORS)
      const extractUrl = `${EDGE_WORKER_URL}/extract/${normalizedId}`;

      // Silent download - no progress UI updates
      const success = await downloadTrack(
        normalizedId,
        extractUrl,
        { title, artist, duration, thumbnail, quality: 'standard' },
        'standard'
      );

      if (success) {
        devLog('🎵 CACHE: ✅ Auto-cached:', title);
        await get().refreshCacheInfo();
        // Emit completion for hot-swap (upgrade stream → cached)
        set({
          lastBoostCompletion: {
            trackId: normalizedId,
            duration: 0,
            isFast: true,
            timestamp: Date.now(),
          },
        });
      }
    } catch (error) {
      // Silent fail - don't interrupt user experience
      devLog('🎵 CACHE: Auto-cache failed for', title, error);
    }
  },

  // Legacy queue for auto-boost
  queueDownload: (trackId, title, artist, duration, thumbnail) => {
    const { downloads, autoBoostEnabled } = get();

    // Only auto-queue if auto-boost is enabled
    if (!autoBoostEnabled) {
      return;
    }

    // Don't queue if already downloading or complete
    const existing = downloads.get(trackId);
    if (existing && (existing.status === 'downloading' || existing.status === 'complete')) {
      return;
    }

    // Check network settings
    if (!shouldAutoDownload()) {
      return;
    }

    // Add to queue
    downloadQueue.push({ trackId, title, artist, duration, thumbnail });

    // Update state
    const newDownloads = new Map(downloads);
    newDownloads.set(trackId, { trackId, progress: 0, status: 'queued' });
    set({ downloads: newDownloads });

    // Start processing
    get().processQueue();
  },

  processQueue: async () => {
    if (isProcessing || downloadQueue.length === 0) return;

    isProcessing = true;

    // FIX: Add iteration limit to prevent infinite loops
    const MAX_ITERATIONS = 100;
    let iterations = 0;

    while (downloadQueue.length > 0 && iterations < MAX_ITERATIONS) {
      const item = downloadQueue.shift();
      if (!item) continue;

      const { trackId, title, artist, duration, thumbnail } = item;

      try {
        // Use boostTrack for actual download
        await get().boostTrack(trackId, title, artist, duration, thumbnail);
      } catch (error) {
        devWarn(`[VOYO] Failed to boost track ${trackId}:`, error);
        // Continue processing next item even if this one fails
      }

      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));
      iterations++;
    }

    if (iterations >= MAX_ITERATIONS) {
      devWarn('[VOYO] processQueue hit iteration limit, clearing queue');
      downloadQueue.length = 0;
    }

    isProcessing = false;
  },

  getDownloadStatus: (trackId) => {
    // NORMALIZE: Always use raw YouTube ID
    const normalizedId = decodeVoyoId(trackId);
    return get().downloads.get(normalizedId);
  },

  isTrackBoosted: async (trackId: string) => {
    // NORMALIZE: Always use raw YouTube ID
    const normalizedId = decodeVoyoId(trackId);
    return isTrackCached(normalizedId);
  },

  removeDownload: async (trackId) => {
    // NORMALIZE: Always use raw YouTube ID
    const normalizedId = decodeVoyoId(trackId);
    await deleteTrack(normalizedId);

    const newDownloads = new Map(get().downloads);
    newDownloads.delete(normalizedId);
    set({ downloads: newDownloads });

    await get().refreshCacheInfo();
  },

  clearAllDownloads: async () => {
    await clearCache();
    set({
      downloads: new Map(),
      cachedTracks: [],
      cacheSize: 0,
    });
  },

  updateSetting: (setting) => {
    setDownloadSetting(setting);
    set({ downloadSetting: setting });
  },

  refreshCacheInfo: async () => {
    const tracks = await getCachedTracks();
    const size = await getCacheSize();

    set({
      cachedTracks: tracks.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        size: t.size,
        quality: t.quality,
        downloadedAt: t.downloadedAt,
      })),
      cacheSize: size,
    });
  },

  // Auto-boost management
  enableAutoBoost: () => {
    try { localStorage.setItem('voyo-auto-boost', 'true'); } catch {}
    set({ autoBoostEnabled: true, showAutoBoostPrompt: false });
  },

  disableAutoBoost: () => {
    try { localStorage.setItem('voyo-auto-boost', 'false'); } catch {}
    set({ autoBoostEnabled: false });
  },

  dismissAutoBoostPrompt: () => {
    try { localStorage.setItem('voyo-auto-boost-dismissed', 'true'); } catch {}
    set({ showAutoBoostPrompt: false });
  },
}));
