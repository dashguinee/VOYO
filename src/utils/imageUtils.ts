/**
 * VOYO Music - Image Utilities
 * Re-exports from unified thumbnail utility
 * @deprecated Use utils/thumbnail.ts directly
 */

import { ThumbnailQuality, getThumb, getThumbWithFallback, generatePlaceholder } from './thumbnail';

// Re-export for backward compatibility
export type { ThumbnailQuality };
export { generatePlaceholder };
export const getYouTubeThumbnail = getThumb;

// Get fallback chain as array (for SmartImage compatibility)
export const getThumbnailFallbackChain = (trackId: string): string[] => {
  const fallbacks = getThumbWithFallback(trackId);
  return [fallbacks.primary, fallbacks.fallback, fallbacks.fallback2];
};

// Additional utilities for SmartImage and cache hooks

/**
 * Preload an image and return success status.
 *
 * CRITICAL: includes a 5-second timeout. Without it, a slow/dead CDN
 * (common with YouTube thumbnails — region blocks, expired URLs, hung
 * connections) leaves the Promise pending forever, which strands SmartImage
 * in its 'loading' state showing the skeleton shimmer permanently. With
 * the timeout, a hung URL counts as failure and the fallback chain advances.
 */
export const preloadImage = (src: string, timeoutMs: number = 5000): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    setTimeout(() => finish(false), timeoutMs);
    img.src = src;
  });
};

/**
 * Find first working thumbnail from fallback chain
 */
export const findWorkingThumbnail = async (trackId: string): Promise<string | null> => {
  const chain = getThumbnailFallbackChain(trackId);

  for (const url of chain) {
    const success = await preloadImage(url);
    if (success) return url;
  }

  return null;
};

/**
 * Get thumbnail quality from URL
 */
export const getThumbnailQualityFromUrl = (url: string): ThumbnailQuality | null => {
  const qualityMap: Record<string, ThumbnailQuality> = {
    'maxresdefault': 'max',
    'hqdefault': 'high',
    'mqdefault': 'medium',
    'default': 'default',
  };

  for (const [ytQuality, quality] of Object.entries(qualityMap)) {
    if (url.includes(`/${ytQuality}.jpg`)) {
      return quality;
    }
  }
  return null;
};

/**
 * Extract trackId from YouTube thumbnail URL
 */
export const extractTrackIdFromUrl = (url: string): string | null => {
  const match = url.match(/\/vi\/([^\/]+)\//);
  return match ? match[1] : null;
};

// Backward compatibility
export const THUMBNAIL_QUALITIES = ['maxresdefault', 'hqdefault', 'mqdefault', 'default'] as const;
