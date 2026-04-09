/**
 * VOYO Media Cache Service
 *
 * Smart caching for seamless feed experience:
 * 1. PRE-CACHE: Load next 3 tracks before user scrolls
 * 2. TEMP-CACHE: Keep last 5 tracks in memory for instant back-scroll
 * 3. AUTO-CLEANUP: Remove stale cache entries after 5 minutes
 * 4. ADAPTIVE QUALITY: Adjust quality based on bandwidth
 *
 * Cache Types:
 * - Audio: Blob URLs from CDN streams
 * - Thumbnails: Image blob URLs (adaptive quality)
 * - Video metadata: YouTube embed readiness
 */

// Simplified - always use high quality for modern connections
type ThumbnailQuality = 'default' | 'medium' | 'high' | 'max';

// Cache configuration
const PRECACHE_AHEAD = 3;      // Pre-cache 3 tracks ahead
const CACHE_BEHIND = 5;        // Keep 5 tracks behind in cache
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL
const MAX_CACHE_SIZE = 15;     // Maximum cached items

// API endpoints
const EDGE_BASE = 'https://voyo-edge.dash-webtv.workers.dev';
const CDN_BASE = `${EDGE_BASE}/cdn`;

// ============================================
// CACHE TYPES
// ============================================

interface CachedMedia {
  trackId: string;
  audioUrl?: string;       // Blob URL for audio
  audioBlobSize?: number;  // Size in bytes
  thumbnailUrl?: string;   // Blob URL for thumbnail
  videoReady?: boolean;    // YouTube iframe preloaded
  cachedAt: number;        // Timestamp
  lastAccessedAt: number;  // For LRU eviction
}

interface CacheStats {
  totalItems: number;
  totalSize: number;
  hitRate: number;
  oldestItem: number;
}

// ============================================
// CACHE STORE
// ============================================

class MediaCacheService {
  private cache: Map<string, CachedMedia> = new Map();
  private preloadQueue: Set<string> = new Set();
  private hits = 0;
  private misses = 0;
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start cleanup interval
    this.startCleanup();
    console.log('[MediaCache] Service initialized');
  }

  // =====================================
  // PRE-CACHING
  // =====================================

  /**
   * Pre-cache upcoming tracks
   * Call this when currentIndex changes
   */
  async precacheAhead(
    trackIds: string[],
    currentIndex: number,
    options: { audio?: boolean; thumbnail?: boolean; video?: boolean } = { audio: true, thumbnail: true }
  ): Promise<void> {
    const startIdx = currentIndex + 1;
    const endIdx = Math.min(currentIndex + 1 + PRECACHE_AHEAD, trackIds.length);

    const toPrecache = trackIds.slice(startIdx, endIdx);

    console.log(`[MediaCache] Pre-caching ${toPrecache.length} tracks ahead (${startIdx}-${endIdx})`);

    // Stagger precache requests
    for (let i = 0; i < toPrecache.length; i++) {
      const trackId = toPrecache[i];

      // Skip if already cached or in queue
      if (this.cache.has(trackId) || this.preloadQueue.has(trackId)) {
        continue;
      }

      this.preloadQueue.add(trackId);

      // Stagger by 200ms to avoid network congestion
      setTimeout(async () => {
        try {
          await this.cacheTrack(trackId, options);
        } finally {
          this.preloadQueue.delete(trackId);
        }
      }, i * 200);
    }
  }

  /**
   * Cache a single track's media
   */
  async cacheTrack(
    trackId: string,
    options: { audio?: boolean; thumbnail?: boolean; video?: boolean } = {}
  ): Promise<CachedMedia> {
    const existing = this.cache.get(trackId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return existing;
    }

    const cached: CachedMedia = {
      trackId,
      cachedAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    // Cache audio
    if (options.audio) {
      try {
        cached.audioUrl = await this.fetchAudioBlob(trackId);
        console.log(`[MediaCache] ✅ Audio cached: ${trackId}`);
      } catch (e) {
        console.warn(`[MediaCache] Audio cache failed: ${trackId}`, e);
      }
    }

    // Cache thumbnail
    if (options.thumbnail) {
      try {
        cached.thumbnailUrl = await this.fetchThumbnailBlob(trackId);
        console.log(`[MediaCache] ✅ Thumbnail cached: ${trackId}`);
      } catch (e) {
        console.warn(`[MediaCache] Thumbnail cache failed: ${trackId}`, e);
      }
    }

    // Preload video iframe
    if (options.video) {
      cached.videoReady = await this.preloadVideoIframe(trackId);
    }

    this.cache.set(trackId, cached);
    this.enforceMaxSize();

    return cached;
  }

  /**
   * Fetch and cache audio as blob URL
   */
  private async fetchAudioBlob(trackId: string): Promise<string | undefined> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(
        `${EDGE_BASE}/audio/${trackId}`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) return undefined;

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      // Pre-create audio element for instant playback
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = blobUrl;
      this.audioElements.set(trackId, audio);

      return blobUrl;
    } catch (e) {
      clearTimeout(timeoutId);
      return undefined;
    }
  }

  /**
   * Fetch and cache thumbnail as blob URL
   * Uses adaptive quality based on bandwidth
   */
  private async fetchThumbnailBlob(trackId: string): Promise<string | undefined> {
    // Use high quality by default - modern connections can handle it
    const quality: ThumbnailQuality = 'high';

    // Build quality fallback chain based on detected bandwidth
    const qualityMap: Record<ThumbnailQuality, string[]> = {
      'default': [
        `https://i.ytimg.com/vi/${trackId}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${trackId}/default.jpg`,
      ],
      'medium': [
        `https://i.ytimg.com/vi/${trackId}/mqdefault.jpg`,
        `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
      ],
      'high': [
        `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${trackId}/mqdefault.jpg`,
      ],
      'max': [
        `https://i.ytimg.com/vi/${trackId}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
      ],
    };

    const urls = qualityMap[quality] || qualityMap['high'];

    console.log(`[MediaCache] Loading thumbnail at ${quality} quality for ${trackId}`);

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          const blob = await response.blob();
          return URL.createObjectURL(blob);
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  /**
   * Preload YouTube video iframe
   */
  private async preloadVideoIframe(trackId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
      iframe.src = `https://www.youtube.com/embed/${trackId}?autoplay=0&mute=1&controls=0`;

      const timeout = setTimeout(() => {
        iframe.remove();
        resolve(false);
      }, 5000);

      iframe.onload = () => {
        clearTimeout(timeout);
        iframe.remove();
        resolve(true);
      };

      iframe.onerror = () => {
        clearTimeout(timeout);
        iframe.remove();
        resolve(false);
      };

      document.body.appendChild(iframe);
    });
  }

  // =====================================
  // CACHE ACCESS
  // =====================================

  /**
   * Get cached media for a track
   */
  get(trackId: string): CachedMedia | undefined {
    const cached = this.cache.get(trackId);

    if (cached) {
      this.hits++;
      cached.lastAccessedAt = Date.now();
      return cached;
    }

    this.misses++;
    return undefined;
  }

  /**
   * Get cached audio URL (blob or fallback to CDN)
   */
  getAudioUrl(trackId: string): string {
    const cached = this.get(trackId);
    return cached?.audioUrl || `${EDGE_BASE}/audio/${trackId}`;
  }

  /**
   * Get cached thumbnail URL (blob or fallback to YouTube)
   * Falls back to high quality if not cached
   */
  getThumbnailUrl(trackId: string): string {
    const cached = this.get(trackId);
    if (cached?.thumbnailUrl) return cached.thumbnailUrl;

    // Fallback: return direct YouTube URL (browser will cache it)
    return `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`;
  }

  /**
   * Check if track is cached
   */
  has(trackId: string): boolean {
    return this.cache.has(trackId);
  }

  /**
   * Get pre-created audio element for instant playback
   */
  getAudioElement(trackId: string): HTMLAudioElement | undefined {
    return this.audioElements.get(trackId);
  }

  // =====================================
  // CACHE MANAGEMENT
  // =====================================

  /**
   * Enforce max cache size using LRU eviction
   */
  private enforceMaxSize(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return;

    // Sort by lastAccessedAt, oldest first
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    // Remove oldest entries
    const toRemove = entries.slice(0, this.cache.size - MAX_CACHE_SIZE);

    for (const [trackId, cached] of toRemove) {
      this.evict(trackId, cached);
    }
  }

  /**
   * Evict a cache entry and clean up resources
   */
  private evict(trackId: string, cached: CachedMedia): void {
    // Revoke blob URLs to free memory
    if (cached.audioUrl) {
      URL.revokeObjectURL(cached.audioUrl);
    }
    if (cached.thumbnailUrl) {
      URL.revokeObjectURL(cached.thumbnailUrl);
    }

    // Clean up audio element
    const audio = this.audioElements.get(trackId);
    if (audio) {
      audio.src = '';
      this.audioElements.delete(trackId);
    }

    this.cache.delete(trackId);
    console.log(`[MediaCache] Evicted: ${trackId}`);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [trackId, cached] of this.cache) {
      if (now - cached.lastAccessedAt > CACHE_TTL) {
        expired.push(trackId);
      }
    }

    for (const trackId of expired) {
      const cached = this.cache.get(trackId);
      if (cached) {
        this.evict(trackId, cached);
      }
    }

    if (expired.length > 0) {
      console.log(`[MediaCache] Cleaned up ${expired.length} expired entries`);
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // Every minute
  }

  /**
   * Stop cleanup and clear all cache
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [trackId, cached] of this.cache) {
      this.evict(trackId, cached);
    }

    console.log('[MediaCache] Service destroyed');
  }

  // =====================================
  // STATS
  // =====================================

  getStats(): CacheStats {
    let totalSize = 0;
    let oldestItem = Date.now();

    for (const cached of this.cache.values()) {
      if (cached.audioBlobSize) totalSize += cached.audioBlobSize;
      if (cached.cachedAt < oldestItem) oldestItem = cached.cachedAt;
    }

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      totalItems: this.cache.size,
      totalSize,
      hitRate,
      oldestItem,
    };
  }
}

// ============================================
// SINGLETON EXPORT
// ============================================

export const mediaCache = new MediaCacheService();

// React hook for easy access
export function useMediaCache() {
  return mediaCache;
}

export default mediaCache;
