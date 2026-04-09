/**
 * VOYO Music - SmartImage Component
 * Bulletproof image loading with fallback chains, skeleton loading, and caching
 * NEVER shows broken images
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  getThumbnailFallbackChain,
  generatePlaceholder,
  preloadImage,
} from '../../utils/imageUtils';
import { getCachedThumbnail, cacheThumbnail } from '../../hooks/useThumbnailCache';
import { devWarn } from '../../utils/logger';

export interface SmartImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties; // Custom inline styles for the image
  fallbackSrc?: string;
  placeholderColor?: string;
  trackId?: string; // For YouTube thumbnail fallback chain
  lazy?: boolean; // Enable lazy loading
  onLoad?: () => void;
  onError?: () => void;
  // Legacy props (kept for API compatibility, no longer used for self-healing)
  artist?: string;
  title?: string;
}

type LoadState = 'loading' | 'loaded' | 'error';

const SmartImageInner: React.FC<SmartImageProps> = ({
  src,
  alt,
  className = '',
  style,
  fallbackSrc,
  placeholderColor = '#1a1a1a',
  trackId,
  lazy = true,
  onLoad,
  onError,
  artist,
  title,
}) => {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const [isInView, setIsInView] = useState(!lazy);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track previous src to avoid unnecessary reloads
  const prevSrcRef = useRef<string>('');
  const hasLoadedRef = useRef<boolean>(false);

  // Stable callback refs to avoid re-triggering effect
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (!lazy || isInView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before entering viewport
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [lazy, isInView]);

  // Load image with fallback chain
  // CRITICAL: Only reload if src actually changes, not on every parent re-render
  useEffect(() => {
    if (!isInView) return;

    // Skip if we've already loaded this exact src
    const srcKey = `${src}|${trackId}|${fallbackSrc}`;
    if (hasLoadedRef.current && prevSrcRef.current === srcKey) {
      return;
    }

    let cancelled = false;

    const loadImage = async () => {
      // Only show loading state if we don't have an image yet
      if (!currentSrc) {
        setLoadState('loading');
      }

      // Step 1: Check cache if trackId provided
      if (trackId) {
        const cachedUrl = getCachedThumbnail(trackId);
        if (cachedUrl) {
          const success = await preloadImage(cachedUrl);
          if (success && !cancelled) {
            setCurrentSrc(cachedUrl);
            setLoadState('loaded');
            hasLoadedRef.current = true;
            prevSrcRef.current = srcKey;
            onLoadRef.current?.();
            return;
          }
        }
      }

      // Step 2: Try primary src
      if (src) {
        const success = await preloadImage(src);
        if (success && !cancelled) {
          setCurrentSrc(src);
          setLoadState('loaded');
          hasLoadedRef.current = true;
          prevSrcRef.current = srcKey;
          if (trackId) cacheThumbnail(trackId, src);
          onLoadRef.current?.();
          return;
        }
      }

      // Step 3: Try fallback chain if trackId provided
      if (trackId) {
        const fallbackChain = getThumbnailFallbackChain(trackId);
        for (const fallbackUrl of fallbackChain) {
          const success = await preloadImage(fallbackUrl);
          if (success && !cancelled) {
            setCurrentSrc(fallbackUrl);
            setLoadState('loaded');
            hasLoadedRef.current = true;
            prevSrcRef.current = srcKey;
            cacheThumbnail(trackId, fallbackUrl);
            onLoadRef.current?.();
            return;
          }
        }
      }

      // Step 4: Try explicit fallbackSrc
      if (fallbackSrc) {
        const success = await preloadImage(fallbackSrc);
        if (success && !cancelled) {
          setCurrentSrc(fallbackSrc);
          setLoadState('loaded');
          hasLoadedRef.current = true;
          prevSrcRef.current = srcKey;
          onLoadRef.current?.();
          return;
        }
      }

      // Step 5: All sources failed — show placeholder IMMEDIATELY (no self-healing delay)
      if (!cancelled) {
        devWarn(`[SmartImage] All sources failed, showing placeholder. trackId: ${trackId}, src: ${src?.slice(0, 50)}`);
        const placeholderSrc = generatePlaceholder(alt || 'Track', 400);
        setCurrentSrc(placeholderSrc);
        setLoadState('loaded');
        hasLoadedRef.current = true;
        prevSrcRef.current = srcKey;
        onErrorRef.current?.();
      }
    };

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [src, fallbackSrc, trackId, alt, isInView, currentSrc]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      {/* Skeleton Loading State */}
      {loadState === 'loading' && (
        <div
          className="absolute inset-0 z-10 voyo-skeleton-shimmer voyo-transition-opacity"
          style={{ backgroundColor: placeholderColor }}
        />
      )}

      {/* Actual Image */}
      {currentSrc && (
        <img
          ref={imgRef}
          src={currentSrc}
          alt={alt}
          className={`w-full h-full object-cover voyo-transition-opacity ${className}`}
          style={{
            ...style,
            opacity: loadState === 'loaded' ? 1 : 0,
          }}
          loading={lazy ? 'lazy' : 'eager'}
          draggable={false}
        />
      )}
    </div>
  );
};

// Memoize to prevent re-renders when parent re-renders with same props
export const SmartImage = memo(SmartImageInner);

export default SmartImage;
