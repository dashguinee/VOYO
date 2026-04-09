/**
 * ContentMixer - Dynamic Content Type Selection
 *
 * Determines what visual content to show for each track in the feed:
 * 1. YouTube Video - If track has video ID, show muted video snippet
 * 2. Animated Art - Default fallback with album art effects
 *
 * This creates variety in the feed like a real social platform.
 */

import { useMemo, useState, useEffect } from 'react';
import { VideoSnippet, type TeaserFormat, TEASER_CONFIGS } from './VideoSnippet';
import { AnimatedArtCard, extractDominantColor, type ArtDisplayMode } from './AnimatedArtCard';
import { DynamicVignette } from './DynamicVignette';
import { devLog } from '../../../utils/logger';

// ============================================
// ADAPTIVE FORMAT SELECTION
// ============================================

/**
 * Detect connection quality and select appropriate teaser format
 * - Fast connection (4g/wifi) → full video
 * - Medium connection (3g) → hook clip (30s @ 360p)
 * - Slow connection (2g) → instant preview (15s @ 240p)
 */
const getAdaptiveTeaserFormat = (): TeaserFormat => {
  // @ts-ignore - navigator.connection is not in all browsers
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  if (!connection) {
    // Default to hook format (most balanced)
    return 'hook';
  }

  const effectiveType = connection.effectiveType;

  switch (effectiveType) {
    case '4g':
      return 'hook'; // Could be 'full' but hook saves bandwidth and engages
    case '3g':
      return 'hook'; // 30s clip @ 360p
    case '2g':
    case 'slow-2g':
      return 'instant'; // 15s preview @ 240p
    default:
      return 'hook';
  }
};

// Cache the format selection (don't recalculate every render)
let cachedTeaserFormat: TeaserFormat | null = null;
const getTeaserFormat = (): TeaserFormat => {
  if (!cachedTeaserFormat) {
    cachedTeaserFormat = getAdaptiveTeaserFormat();
    devLog(`[ContentMixer] Adaptive format selected: ${cachedTeaserFormat}`);
  }
  return cachedTeaserFormat;
};

// Content type enum
export type ContentType = 'video' | 'animated_art' | 'gif';

interface ContentMixerProps {
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  thumbnail?: string;
  isActive: boolean;
  isPlaying: boolean;
  isThisTrack: boolean;
  shouldPreload?: boolean; // Preload for upcoming cards
  // Optional overrides
  forceContentType?: ContentType;
  gifUrl?: string;
  bpm?: number;
}

// Determine content type based on track data
const determineContentType = (
  trackId: string,
  hasVideo: boolean,
  hasGif: boolean,
): ContentType => {
  // MIX IT UP: Some tracks show as floating art for variety
  if (shouldShowAsStaticArt(trackId)) {
    return 'animated_art'; // Floating oval or disc
  }

  // Priority: Video > GIF > Animated Art
  if (hasVideo) return 'video';
  if (hasGif) return 'gif';
  return 'animated_art';
};

// Check if track ID is a YouTube video ID
const isYouTubeId = (id: string): boolean => {
  // YouTube IDs are 11 chars, or VOYO IDs start with vyo_
  if (id.startsWith('vyo_')) return true;
  if (id.length === 11 && /^[a-zA-Z0-9_-]+$/.test(id)) return true;
  return false;
};

// Videos go FULL SCREEN, only non-video tracks get floating art treatment
// This creates the mix: full screen videos + floating boards for audio-only
const shouldShowAsStaticArt = (trackId: string): boolean => {
  // Only tracks WITHOUT video get the floating art treatment
  // Videos always go full screen
  return false; // Let video detection handle it - videos = full, no video = floating art
};

export const ContentMixer = ({
  trackId,
  trackTitle,
  trackArtist,
  thumbnail,
  isActive,
  isPlaying,
  isThisTrack,
  shouldPreload = false,
  forceContentType,
  gifUrl,
  bpm,
}: ContentMixerProps) => {
  const [dominantColor, setDominantColor] = useState<string>('#a855f7');
  const [videoBlocked, setVideoBlocked] = useState(false);

  // Determine content type
  const contentType = useMemo(() => {
    if (forceContentType) return forceContentType;
    return determineContentType(
      trackId,
      isYouTubeId(trackId),
      !!gifUrl
    );
  }, [trackId, forceContentType, gifUrl]);

  // For static content, randomly pick oval or disc based on track ID (consistent per track)
  const artDisplayMode: ArtDisplayMode = useMemo(() => {
    // Use trackId hash to consistently pick same mode for same track
    const hash = trackId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return hash % 2 === 0 ? 'oval' : 'disc';
  }, [trackId]);

  // Extract dominant color for vignette tinting
  useEffect(() => {
    if (thumbnail) {
      extractDominantColor(thumbnail).then(setDominantColor);
    }
  }, [thumbnail]);

  // Render based on content type - all wrapped with DynamicVignette
  switch (contentType) {
    case 'video':
      // If video is geo-blocked/unavailable, fall back to animated art
      if (videoBlocked) {
        return (
          <AnimatedArtCard
            trackId={trackId}
            thumbnail={thumbnail || ''}
            isActive={isActive}
            isPlaying={isPlaying}
            bpm={bpm}
            dominantColor={dominantColor}
            displayMode={artDisplayMode}
          />
        );
      }

      // Get adaptive teaser format based on connection
      const teaserFormat = getTeaserFormat();

      return (
        <div className="absolute inset-0">
          <VideoSnippet
            trackId={trackId}
            isActive={isActive}
            isPlaying={isPlaying}
            isThisTrack={isThisTrack}
            shouldPreload={shouldPreload}
            fallbackThumbnail={thumbnail}
            teaserFormat={teaserFormat}
            onVideoError={() => {
              devLog(`[ContentMixer] Video blocked for ${trackId}, switching to art`);
              setVideoBlocked(true);
            }}
          />
          <DynamicVignette
            isActive={isActive}
            isPlaying={isPlaying}
            bpm={bpm}
            color={dominantColor}
          />
        </div>
      );

    case 'gif':
      // GIF content - loop the gif with audio
      return (
        <div className="absolute inset-0 overflow-hidden bg-black">
          <img
            src={gifUrl}
            alt={trackTitle}
            className="w-full h-full object-cover"
            style={{
              filter: isPlaying ? 'none' : 'grayscale(50%)',
            }}
          />
          {/* Overlay gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/20" />
        </div>
      );

    case 'animated_art':
    default:
      return (
        <AnimatedArtCard
          trackId={trackId}
          thumbnail={thumbnail || ''}
          isActive={isActive}
          isPlaying={isPlaying}
          bpm={bpm}
          dominantColor={dominantColor}
          displayMode={artDisplayMode} // Oval or Disc, floating in darkness
        />
      );
  }
};

// ============================================
// CONTENT STATS TRACKING
// ============================================

// Track which content types perform best
export interface ContentStats {
  type: ContentType;
  views: number;
  avgWatchTime: number; // seconds
  oyeCount: number;
  shareCount: number;
  engagementRate: number; // 0-1
}

// This would connect to analytics in production
export const trackContentEngagement = (
  trackId: string,
  contentType: ContentType,
  event: 'view' | 'oye' | 'share' | 'complete',
  watchTime?: number
) => {
  devLog(`[ContentMixer] ${event} on ${contentType} for ${trackId}`, watchTime ? `(${watchTime}s)` : '');
  // In production, send to analytics
};

export default ContentMixer;
