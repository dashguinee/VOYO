/**
 * VideoSnippet - YouTube iFrame Video for Feed Cards
 *
 * SIMPLE ARCHITECTURE:
 * - YouTube provides BOTH video AND audio (native sync)
 * - Only ACTIVE card plays (via postMessage control)
 * - Preloaded cards are paused until they become active
 * - No separate AudioPlayer - YouTube handles everything
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Film, Play } from 'lucide-react';
import { devLog, devWarn, devError } from '../../../utils/logger';

// Teaser format configurations
export type TeaserFormat = 'hook' | 'instant' | 'full';

export const TEASER_CONFIGS = {
  hook: { start: 30, end: 60, quality: 'medium' as const },      // 30s hook @ 360p
  instant: { start: 45, end: 60, quality: 'small' as const },    // 15s preview @ 240p
  full: { start: 0, end: undefined, quality: 'large' as const }, // Full video @ 480p
};

interface VideoSnippetProps {
  trackId: string; // YouTube video ID or VOYO ID
  isActive: boolean;
  isPlaying: boolean;
  isThisTrack: boolean;
  shouldPreload?: boolean; // Preload this video (for upcoming cards)
  fallbackThumbnail?: string;
  teaserFormat?: TeaserFormat; // Clip format (hook, instant, full)
  onVideoReady?: () => void;
  onVideoError?: () => void;
}

export const VideoSnippet = ({
  trackId,
  isActive,
  isPlaying,
  isThisTrack,
  shouldPreload = false,
  fallbackThumbnail,
  teaserFormat = 'hook', // Default to hook format (30s clip @ 360p)
  onVideoReady,
  onVideoError,
}: VideoSnippetProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [showIframe, setShowIframe] = useState(false);
  const [hasError, setHasError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Decode VOYO ID to YouTube ID if needed
  const youtubeId = useMemo(() => {
    if (!trackId.startsWith('vyo_')) return trackId;

    const encoded = trackId.substring(4);
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';

    try {
      return atob(base64);
    } catch {
      return trackId;
    }
  }, [trackId]);

  // Get teaser config
  const teaserConfig = TEASER_CONFIGS[teaserFormat];

  // Build YouTube embed URL with optimal params
  // VIDEO ONLY: YouTube provides visuals, AudioPlayer handles all sound
  // NOTE: autoplay=0 because we control playback via postMessage (prevents preloaded cards from playing)
  const embedUrl = useMemo(() => {
    const params: Record<string, string> = {
      autoplay: '0', // NO autoplay - we control via postMessage when card becomes active
      mute: '1', // ALWAYS muted - audio comes from AudioPlayer (single source)
      controls: '0',
      disablekb: '1',
      fs: '0',
      iv_load_policy: '3', // Hide annotations
      loop: '0',
      modestbranding: '1',
      playsinline: '1',
      rel: '0',
      showinfo: '0',
      enablejsapi: '1', // Enable JS API for control
      origin: window.location.origin,
    };

    // Add start/end for teaser clipping (skip intro, play hook)
    if (teaserConfig.start > 0) {
      params.start = String(teaserConfig.start);
    }
    if (teaserConfig.end) {
      params.end = String(teaserConfig.end);
    }

    const searchParams = new URLSearchParams(params);
    return `https://www.youtube.com/embed/${youtubeId}?${searchParams.toString()}`;
  }, [youtubeId, teaserConfig]);

  // Load iframe when card becomes active OR when preloading next cards
  useEffect(() => {
    if (isActive && !showIframe) {
      // Immediate load for active card (no delay - preloading handles smoothness)
      setShowIframe(true);
      devLog(`[VideoSnippet] Loading YouTube iframe for ${youtubeId}`);
    }
  }, [isActive, showIframe, youtubeId]);

  // PRELOAD: Start loading iframe for upcoming cards
  // This creates a buffer zone for smoother transitions
  useEffect(() => {
    if (shouldPreload && !isActive && !showIframe) {
      // Preload iframe for next 2 cards
      const preloadTimer = setTimeout(() => {
        setShowIframe(true);
        devLog(`[VideoSnippet] 🔄 Preloading YouTube iframe for ${youtubeId}`);
      }, 300); // 300ms delay to stagger preloads

      return () => clearTimeout(preloadTimer);
    }
  }, [shouldPreload, isActive, showIframe, youtubeId]);

  // Set video quality after load (reduces bandwidth)
  useEffect(() => {
    if (!iframeRef.current || !isLoaded) return;

    const iframe = iframeRef.current;
    // Set quality: small=240p, medium=360p, large=480p, hd720, hd1080
    iframe.contentWindow?.postMessage(
      `{"event":"command","func":"setPlaybackQuality","args":["${teaserConfig.quality}"]}`,
      '*'
    );
    devLog(`[VideoSnippet] 📺 Quality set to ${teaserConfig.quality} for ${youtubeId}`);
  }, [isLoaded, teaserConfig.quality, youtubeId]);

  // Control playback via postMessage - SIMPLE: active card plays, others pause
  useEffect(() => {
    if (!iframeRef.current || !isLoaded) return;

    const iframe = iframeRef.current;

    if (isActive) {
      // Active card: PLAY (this is the only card that should have audio)
      iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      devLog(`[VideoSnippet] ▶️ Playing: ${youtubeId} (${teaserFormat} format)`);
    } else {
      // Inactive cards: PAUSE (prevents audio interference from preloaded cards)
      iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }
  }, [isActive, isLoaded, youtubeId, teaserFormat]);

  // Detect YouTube errors (geo-blocked, unavailable, etc.)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com') return;

      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        // YouTube error codes: 2=invalid param, 5=HTML5 error, 100=not found, 101/150=blocked
        if (data.event === 'onError' || data.info?.errorCode) {
          const errorCode = data.info?.errorCode || data.errorCode;
          devError(`[VideoSnippet] ❌ YouTube error ${errorCode} for ${youtubeId}`);
          setHasError(true);
          onVideoError?.();
        }

        // Also detect "unplayable" state
        if (data.event === 'onStateChange' && data.info === -1) {
          // -1 = unstarted/unplayable after attempt
          setTimeout(() => {
            if (!isLoaded) {
              devWarn(`[VideoSnippet] ⚠️ Video unplayable: ${youtubeId}`);
              setHasError(true);
              onVideoError?.();
            }
          }, 3000);
        }
      } catch {
        // Not JSON, ignore
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [youtubeId, isLoaded, onVideoError]);

  // Timeout fallback - if iframe doesn't load in 8s, assume blocked
  useEffect(() => {
    if (!showIframe || isLoaded || hasError) return;

    const timeout = setTimeout(() => {
      if (!isLoaded) {
        devWarn(`[VideoSnippet] ⏱️ Load timeout for ${youtubeId} - assuming blocked`);
        setHasError(true);
        onVideoError?.();
      }
    }, 8000);

    return () => clearTimeout(timeout);
  }, [showIframe, isLoaded, hasError, youtubeId, onVideoError]);

  // Handle iframe load
  const handleIframeLoad = () => {
    setIsLoaded(true);
    onVideoReady?.();
    devLog(`[VideoSnippet] ✅ YouTube iframe loaded for ${youtubeId}`);
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {/* Fallback thumbnail (shows while iframe loads) */}
      {fallbackThumbnail && (
        <img
          src={fallbackThumbnail}
          alt="Track thumbnail"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: isLoaded ? 0 : 1,
            transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      )}

      {/* YouTube iframe - FULL SCREEN video fill */}
      {showIframe && (
        <div
          className="absolute inset-0 overflow-hidden"
        >
          {/*
            Full screen video container
            16:9 video filling 9:16 portrait = need ~3.16x width scale
            Using fixed viewport units for true full screen
          */}
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="pointer-events-none"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen={false}
            onLoad={handleIframeLoad}
            style={{
              border: 'none',
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              // 16:9 video needs to be scaled to fill 9:16 portrait
              // Width = height * (16/9) to maintain aspect while filling height
              width: '177.78vh', // 100vh * (16/9)
              height: '100vh',
              minWidth: '100vw', // Ensure it's at least full width too
              minHeight: '56.25vw', // 100vw * (9/16) - fallback for landscape
              }}
          />
        </div>
      )}

      {/* Loading indicator */}
      {isActive && showIframe && !isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-12 h-12 rounded-full border-3 border-purple-500/30 border-t-purple-500 animate-spin"
          />
        </div>
      )}

      {/* Video indicator badge */}
      {isLoaded && isActive && (
        <div
          className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-sm"
        >
          <Film className="w-3 h-3 text-purple-400" />
          <span className="text-white/90 text-xs font-medium">Video</span>
          {isPlaying && isThisTrack && (
            <div
              className="w-2 h-2 rounded-full bg-green-500"
            />
          )}
        </div>
      )}

      {/* Play button overlay when paused */}
      {isLoaded && isActive && !isPlaying && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30"
        >
          <div
            className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center"
          >
            <Play className="w-10 h-10 text-white ml-1" style={{ fill: 'white' }} />
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoSnippet;
