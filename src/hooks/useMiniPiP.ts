/**
 * VOYO Mini Picture-in-Picture
 *
 * Minimal floating album art window for background playback safety.
 * Uses canvas-to-video approach (Chrome 70+, Safari 13.1+).
 *
 * Flow:
 * 1. Create canvas with album art
 * 2. Convert to video stream
 * 3. Request PiP when backgrounded
 * 4. MediaSession handles controls (already implemented)
 */

import { useRef, useCallback, useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { getYouTubeThumbnail } from '../data/tracks';

// PiP window size (card-like ratio)
const PIP_SIZE = 320;

export function useMiniPiP() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);

  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  // Check if PiP is supported
  const isSupported = useCallback(() => {
    return 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  }, []);

  // Initialize canvas and video elements
  const initElements = useCallback(() => {
    if (canvasRef.current) return; // Already initialized

    // Create canvas for album art
    const canvas = document.createElement('canvas');
    canvas.width = PIP_SIZE;
    canvas.height = PIP_SIZE;
    canvasRef.current = canvas;

    // Create video element from canvas stream
    const video = document.createElement('video');
    video.srcObject = canvas.captureStream(1); // 1 FPS is enough for static image
    video.muted = true;
    video.playsInline = true;
    video.style.display = 'none';
    document.body.appendChild(video);
    videoRef.current = video;

    // Handle PiP window close
    video.addEventListener('leavepictureinpicture', () => {
      isActiveRef.current = false;
      console.log('[VOYO PiP] Mini player closed');
    });

    console.log('[VOYO PiP] Initialized');
  }, []);

  // Draw VOYO card on canvas (album art + gradient overlay + title/artist)
  const drawAlbumArt = useCallback(async (trackId: string, title?: string, artist?: string) => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const thumbnailUrl = getYouTubeThumbnail(trackId, 'high');

    // Dark base
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, PIP_SIZE, PIP_SIZE);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = thumbnailUrl;
      });

      // Draw album art (centered crop to square)
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, PIP_SIZE, PIP_SIZE);
    } catch {
      // Fallback gradient if image fails
      const gradient = ctx.createLinearGradient(0, 0, PIP_SIZE, PIP_SIZE);
      gradient.addColorStop(0, '#7c3aed');
      gradient.addColorStop(1, '#ec4899');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, PIP_SIZE, PIP_SIZE);
    }

    // Bottom gradient overlay (VOYO card style)
    const overlay = ctx.createLinearGradient(0, PIP_SIZE * 0.55, 0, PIP_SIZE);
    overlay.addColorStop(0, 'rgba(0,0,0,0)');
    overlay.addColorStop(0.4, 'rgba(0,0,0,0.6)');
    overlay.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, PIP_SIZE * 0.55, PIP_SIZE, PIP_SIZE * 0.45);

    // Track title
    const trackTitle = title || currentTrack?.title || 'VOYO';
    const trackArtist = artist || currentTrack?.artist || '';

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // Truncate title if too long
    const maxWidth = PIP_SIZE - 32;
    let displayTitle = trackTitle;
    while (ctx.measureText(displayTitle).width > maxWidth && displayTitle.length > 3) {
      displayTitle = displayTitle.slice(0, -2) + '...';
    }
    ctx.fillText(displayTitle, 16, PIP_SIZE - 28);

    // Artist name
    if (trackArtist) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      let displayArtist = trackArtist;
      while (ctx.measureText(displayArtist).width > maxWidth && displayArtist.length > 3) {
        displayArtist = displayArtist.slice(0, -2) + '...';
      }
      ctx.fillText(displayArtist, 16, PIP_SIZE - 10);
    }

    // Small VOYO badge (top-left)
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const badgeWidth = 52;
    const badgeHeight = 20;
    const badgeRadius = 10;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(12, 12, badgeWidth, badgeHeight, badgeRadius);
    } else {
      ctx.rect(12, 12, badgeWidth, badgeHeight);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VOYO', 12 + badgeWidth / 2, 12 + badgeHeight / 2);

    console.log('[VOYO PiP] Card updated:', trackTitle);
  }, [currentTrack]);

  // Enter PiP mode
  const enterPiP = useCallback(async () => {
    if (!isSupported()) {
      console.log('[VOYO PiP] Not supported');
      return false;
    }

    if (isActiveRef.current) {
      console.log('[VOYO PiP] Already active');
      return true;
    }

    initElements();

    if (!videoRef.current || !currentTrack) return false;

    try {
      // Draw VOYO card (album art + title + artist)
      await drawAlbumArt(currentTrack.trackId, currentTrack.title, currentTrack.artist);

      // Play video (required for PiP)
      await videoRef.current.play();

      // Request PiP
      await videoRef.current.requestPictureInPicture();
      isActiveRef.current = true;

      console.log('[VOYO PiP] Entered mini player mode');
      return true;
    } catch (err) {
      console.warn('[VOYO PiP] Failed to enter:', err);
      return false;
    }
  }, [isSupported, initElements, drawAlbumArt, currentTrack]);

  // Exit PiP mode
  const exitPiP = useCallback(async () => {
    if (!isActiveRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      isActiveRef.current = false;
      console.log('[VOYO PiP] Exited mini player mode');
    } catch (err) {
      // Ignore errors
    }
  }, []);

  // Toggle PiP
  const togglePiP = useCallback(async () => {
    if (isActiveRef.current) {
      await exitPiP();
    } else {
      await enterPiP();
    }
  }, [enterPiP, exitPiP]);

  // Update card when track changes (while PiP is active)
  useEffect(() => {
    if (isActiveRef.current && currentTrack) {
      drawAlbumArt(currentTrack.trackId, currentTrack.title, currentTrack.artist);
    }
  }, [currentTrack?.trackId, drawAlbumArt]);

  // Auto-enter PiP when app goes to background (SAFETY NET)
  // Shows floating album art when user switches away while music is playing
  // This ensures visibility of playback controls even if iframe background playback struggles
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isPlaying && currentTrack) {
        // Small delay to avoid triggering on quick tab switches
        setTimeout(() => {
          if (document.visibilityState === 'hidden') {
            enterPiP();
          }
        }, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying, currentTrack, enterPiP]);

  // Cleanup
  useEffect(() => {
    return () => {
      exitPiP();
      if (videoRef.current) {
        videoRef.current.remove();
      }
    };
  }, [exitPiP]);

  return {
    isSupported: isSupported(),
    isActive: isActiveRef.current,
    enterPiP,
    exitPiP,
    togglePiP,
  };
}
