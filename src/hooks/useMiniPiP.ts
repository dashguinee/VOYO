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
 *
 * Crash guards (April 2026):
 * - mountedRef prevents state updates after unmount
 * - canvasRef re-checked after every async gap (image load, PiP request)
 * - exitPiP runs before SW update reload
 * - enteringRef prevents visibility race (exit + re-entry fighting)
 */

import { useRef, useCallback, useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { getYouTubeThumbnail } from '../data/tracks';
import { devLog, devWarn } from '../utils/logger';

// PiP window size (card-like ratio)
const PIP_SIZE = 320;

export function useMiniPiP() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);
  const mountedRef = useRef(true); // Prevents crashes after unmount
  const enteringRef = useRef(false); // Prevents visibility race

  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  // Check if PiP is supported
  const isSupported = useCallback(() => {
    return 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  }, []);

  // Initialize canvas and video elements
  const initElements = useCallback(() => {
    if (canvasRef.current) return; // Already initialized

    try {
      // Create canvas for album art
      const canvas = document.createElement('canvas');
      canvas.width = PIP_SIZE;
      canvas.height = PIP_SIZE;

      // captureStream() can throw NotSupportedError on some Android WebViews
      const stream = canvas.captureStream(1); // 1 FPS is enough for static image

      canvasRef.current = canvas;

      // Create video element from canvas stream
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.style.display = 'none';
      document.body.appendChild(video);
      videoRef.current = video;

      // Handle PiP window close
      video.addEventListener('leavepictureinpicture', () => {
        isActiveRef.current = false;
        enteringRef.current = false;
        devLog('[VOYO PiP] Mini player closed');
      });

      devLog('[VOYO PiP] Initialized');
    } catch (err) {
      devWarn('[VOYO PiP] Init failed (captureStream unsupported?):', err);
      canvasRef.current = null;
      videoRef.current = null;
    }
  }, []);

  // Draw VOYO card on canvas (album art + gradient overlay + title/artist)
  const drawAlbumArt = useCallback(async (trackId: string, title?: string, artist?: string) => {
    // Guard: canvas must exist and component must be mounted
    if (!canvasRef.current || !mountedRef.current) return;

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

      // Re-check after async image load — canvas may have been destroyed
      if (!canvasRef.current || !mountedRef.current) return;

      // Draw album art (centered crop to square)
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, PIP_SIZE, PIP_SIZE);
    } catch {
      // Re-check after async catch
      if (!canvasRef.current || !mountedRef.current) return;
      // Fallback gradient if image fails
      const gradient = ctx.createLinearGradient(0, 0, PIP_SIZE, PIP_SIZE);
      gradient.addColorStop(0, '#7c3aed');
      gradient.addColorStop(1, '#ec4899');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, PIP_SIZE, PIP_SIZE);
    }

    // Re-check before final draws
    if (!canvasRef.current || !mountedRef.current) return;

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

    devLog('[VOYO PiP] Card updated:', trackTitle);
  }, [currentTrack]);

  // Enter PiP mode
  const enterPiP = useCallback(async () => {
    if (!isSupported() || !mountedRef.current) {
      return false;
    }

    if (isActiveRef.current || enteringRef.current) {
      return isActiveRef.current;
    }

    enteringRef.current = true;

    try {
      initElements();
    } catch {
      enteringRef.current = false;
      return false;
    }

    if (!videoRef.current || !currentTrack) {
      enteringRef.current = false;
      return false;
    }

    try {
      // Draw VOYO card (album art + title + artist)
      await drawAlbumArt(currentTrack.trackId, currentTrack.title, currentTrack.artist);

      // Re-check after async draw — component may have unmounted
      if (!mountedRef.current || !videoRef.current) {
        enteringRef.current = false;
        return false;
      }

      // Play video (required for PiP)
      await videoRef.current.play();

      // Re-check again before PiP request
      if (!mountedRef.current || !videoRef.current) {
        enteringRef.current = false;
        return false;
      }

      // Request PiP
      await videoRef.current.requestPictureInPicture();
      isActiveRef.current = true;
      enteringRef.current = false;

      devLog('[VOYO PiP] Entered mini player mode');
      return true;
    } catch (err) {
      devWarn('[VOYO PiP] Failed to enter:', err);
      enteringRef.current = false;
      return false;
    }
  }, [isSupported, initElements, drawAlbumArt, currentTrack]);

  // Exit PiP mode
  const exitPiP = useCallback(async () => {
    enteringRef.current = false; // Cancel any pending entry
    if (!isActiveRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      isActiveRef.current = false;
      devLog('[VOYO PiP] Exited mini player mode');
    } catch {
      // Ignore errors — PiP may already be gone
      isActiveRef.current = false;
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
    if (isActiveRef.current && currentTrack && mountedRef.current) {
      drawAlbumArt(currentTrack.trackId, currentTrack.title, currentTrack.artist);
    }
  }, [currentTrack?.trackId, drawAlbumArt]);

  // Auto-enter PiP when app goes to background (SAFETY NET)
  // Shows floating album art when user switches away while music is playing
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isPlaying && currentTrack && !enteringRef.current) {
        // Small delay to avoid triggering on quick tab switches
        setTimeout(() => {
          if (document.visibilityState === 'hidden' && mountedRef.current && !enteringRef.current) {
            enterPiP();
          }
        }, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying, currentTrack, enterPiP]);

  // Cleanup — set mounted=false FIRST to kill all async paths
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      enteringRef.current = false;
      exitPiP();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        videoRef.current.remove();
        videoRef.current = null;
      }
      canvasRef.current = null;
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
