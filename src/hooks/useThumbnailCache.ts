/**
 * VOYO Music - Thumbnail Cache Hook
 * Caches verified working thumbnails in localStorage for instant loading
 */

import { useEffect, useState } from 'react';
import { findWorkingThumbnail, getThumbnailQualityFromUrl, type ThumbnailQuality } from '../utils/imageUtils';

interface CachedThumbnail {
  url: string;
  quality: ThumbnailQuality | null;
  verified: number; // timestamp
}

const CACHE_KEY = 'voyo_thumbnail_cache';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Get thumbnail cache from localStorage
 */
const getCache = (): Record<string, CachedThumbnail> => {
  try {
    const data = localStorage.getItem(CACHE_KEY);
    if (!data) return {};

    const cache = JSON.parse(data) as Record<string, CachedThumbnail>;
    const now = Date.now();

    // Filter out expired entries
    const validCache: Record<string, CachedThumbnail> = {};
    for (const [trackId, cached] of Object.entries(cache)) {
      if (now - cached.verified < CACHE_EXPIRY) {
        validCache[trackId] = cached;
      }
    }

    return validCache;
  } catch (error) {
    return {};
  }
};

/**
 * Save thumbnail cache to localStorage
 */
const setCache = (cache: Record<string, CachedThumbnail>): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
  }
};

/**
 * Hook to get cached or find working thumbnail
 */
export const useThumbnailCache = (trackId: string | undefined) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!trackId) {
      setThumbnailUrl(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadThumbnail = async () => {
      setIsLoading(true);

      // Check cache first
      const cache = getCache();
      const cached = cache[trackId];

      if (cached) {
        if (!cancelled) {
          setThumbnailUrl(cached.url);
          setIsLoading(false);
        }
        return;
      }

      // Not in cache, find working thumbnail
      const workingUrl = await findWorkingThumbnail(trackId);

      if (!cancelled) {
        if (workingUrl) {
          setThumbnailUrl(workingUrl);

          // Save to cache
          const quality = getThumbnailQualityFromUrl(workingUrl);
          const newCache = { ...getCache() };
          newCache[trackId] = {
            url: workingUrl,
            quality,
            verified: Date.now(),
          };
          setCache(newCache);
        } else {
          setThumbnailUrl(null);
        }
        setIsLoading(false);
      }
    };

    loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [trackId]);

  return { thumbnailUrl, isLoading };
};

/**
 * Get cached thumbnail synchronously (returns null if not cached)
 */
export const getCachedThumbnail = (trackId: string): string | null => {
  const cache = getCache();
  const cached = cache[trackId];
  return cached ? cached.url : null;
};

/**
 * Manually cache a thumbnail
 */
export const cacheThumbnail = (trackId: string, url: string): void => {
  const cache = getCache();
  const quality = getThumbnailQualityFromUrl(url);

  cache[trackId] = {
    url,
    quality,
    verified: Date.now(),
  };

  setCache(cache);
};

/**
 * Clear entire thumbnail cache
 */
export const clearThumbnailCache = (): void => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = () => {
  const cache = getCache();
  const entries = Object.entries(cache);

  return {
    totalEntries: entries.length,
    oldestEntry: entries.reduce(
      (oldest, [, cached]) => (cached.verified < oldest ? cached.verified : oldest),
      Date.now()
    ),
    newestEntry: entries.reduce(
      (newest, [, cached]) => (cached.verified > newest ? cached.verified : newest),
      0
    ),
  };
};
