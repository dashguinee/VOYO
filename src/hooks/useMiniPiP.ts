/**
 * VOYO Mini Picture-in-Picture
 *
 * Canvas-composite PiP — the only path that works for a PWA on top of
 * a cross-origin YouTube iframe. Browsers block requestPictureInPicture()
 * on foreign-origin iframes for security; YT's iframe is sandboxed so
 * we can't grab its inner <video> element either. So instead we paint
 * a VOYO-branded card (album art + Now Playing chrome + Next Up) onto
 * a canvas, captureStream() it as a video, and PiP that.
 *
 * The card refreshes when:
 *   - track changes (new album art + title + artist)
 *   - upcoming track changes (Next Up label)
 *   - active reaction changes (subtle chrome update — optional)
 *
 * Registers itself with pipService so the existing tap-to-enter call
 * sites (escape-Oye in app.ts, Mini Player buttons in VoyoPortraitPlayer)
 * actually work. Previously pipService.register was never called and
 * every pipService.enter() returned false silently. (audit-2 P1-IF-3)
 *
 * Auto-enter on visibilitychange = hidden when isPlaying. iOS preserves
 * the user-gesture token from a recent tap, which lets the request go
 * through even though it's not directly inside an event handler.
 */

import { useRef, useCallback, useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { pipService } from '../services/pipService';
import { getThumb } from '../utils/thumbnail';

const PIP_W = 360;  // 16:9 friendly aspect for the OS PiP window
const PIP_H = 360;

export function useMiniPiP() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);

  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const queue = usePlayerStore(s => s.queue);
  const upcomingTrack = queue[0]?.track ?? null;

  const isSupported = useCallback(() => {
    return typeof document !== 'undefined' &&
      'pictureInPictureEnabled' in document &&
      document.pictureInPictureEnabled;
  }, []);

  // Lazy-init the canvas + video element. They live for the lifetime
  // of the AudioPlayer mount; created on first PiP request.
  const initElements = useCallback(() => {
    if (canvasRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = PIP_W;
    canvas.height = PIP_H;
    canvasRef.current = canvas;

    const video = document.createElement('video');
    video.srcObject = canvas.captureStream(30); // 30fps so chrome updates feel smooth
    video.muted = true;
    video.playsInline = true;
    // Off-screen, but NOT display:none (some browsers refuse PiP on hidden video).
    video.style.cssText = 'position:fixed;bottom:-1px;right:-1px;width:1px;height:1px;opacity:0.001;pointer-events:none;';
    document.body.appendChild(video);
    videoRef.current = video;

    video.addEventListener('leavepictureinpicture', () => {
      isActiveRef.current = false;
    });
  }, []);

  // Paint the card. Album art fills, dark gradient at bottom, VOYO badge
  // top-left, "NOW PLAYING" label, title, artist. If upcomingTrack exists,
  // small "NEXT" footer line.
  const paintCard = useCallback(async () => {
    if (!canvasRef.current || !currentTrack) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Base
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, PIP_W, PIP_H);

    // Album art
    const thumb = getThumb(currentTrack.trackId, 'high');
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = thumb;
      });
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, PIP_W, PIP_H);
    } catch {
      // Fallback purple gradient if image fails (CORS, network)
      const grad = ctx.createLinearGradient(0, 0, PIP_W, PIP_H);
      grad.addColorStop(0, '#7c3aed');
      grad.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, PIP_W, PIP_H);
    }

    // Bottom gradient overlay for legibility
    const overlay = ctx.createLinearGradient(0, PIP_H * 0.45, 0, PIP_H);
    overlay.addColorStop(0, 'rgba(0,0,0,0)');
    overlay.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    overlay.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, PIP_H * 0.45, PIP_W, PIP_H * 0.55);

    // VOYO badge top-left
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const badgeX = 14, badgeY = 14, badgeW = 56, badgeH = 22;
    if (ctx.roundRect) ctx.beginPath(), ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 11), ctx.fill();
    else ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VOYO', badgeX + badgeW / 2, badgeY + badgeH / 2);

    // "NOW PLAYING" label
    ctx.fillStyle = 'rgba(196,181,253,0.85)';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('NOW PLAYING', 16, PIP_H - 78);

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui';
    ctx.textBaseline = 'top';
    let title = currentTrack.title || '';
    const maxW = PIP_W - 32;
    while (ctx.measureText(title).width > maxW && title.length > 3) {
      title = title.slice(0, -2) + '…';
    }
    ctx.fillText(title, 16, PIP_H - 62);

    // Artist
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px system-ui';
    let artist = currentTrack.artist || '';
    while (ctx.measureText(artist).width > maxW && artist.length > 3) {
      artist = artist.slice(0, -2) + '…';
    }
    ctx.fillText(artist, 16, PIP_H - 40);

    // NEXT line if there's a queued upcoming
    if (upcomingTrack) {
      ctx.fillStyle = 'rgba(212,175,110,0.85)';
      ctx.font = 'bold 9px system-ui';
      let nextLine = `NEXT · ${upcomingTrack.title}`;
      while (ctx.measureText(nextLine).width > maxW && nextLine.length > 8) {
        nextLine = nextLine.slice(0, -2) + '…';
      }
      ctx.fillText(nextLine, 16, PIP_H - 18);
    }
  }, [currentTrack, upcomingTrack]);

  const enterPiP = useCallback(async (): Promise<boolean> => {
    if (!isSupported() || !currentTrack) return false;
    if (isActiveRef.current) return true;

    initElements();
    if (!videoRef.current) return false;

    try {
      await paintCard();
      // requestPictureInPicture requires the video to be playing
      await videoRef.current.play();
      await videoRef.current.requestPictureInPicture();
      isActiveRef.current = true;
      return true;
    } catch {
      return false;
    }
  }, [isSupported, initElements, paintCard, currentTrack]);

  const exitPiP = useCallback(async (): Promise<void> => {
    if (!isActiveRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {
      // ignore
    }
    isActiveRef.current = false;
  }, []);

  const togglePiP = useCallback(async (): Promise<void> => {
    if (isActiveRef.current) {
      await exitPiP();
    } else {
      await enterPiP();
    }
  }, [enterPiP, exitPiP]);

  // Register with the singleton so existing call sites work.
  // (audit-2 P1-IF-3 — register was never called before; pipService.enter()
  // returned false silently from every call site.)
  useEffect(() => {
    pipService.register(enterPiP, exitPiP, togglePiP);
  }, [enterPiP, exitPiP, togglePiP]);

  // Repaint when track or upcoming changes (only matters while PiP is active).
  useEffect(() => {
    if (isActiveRef.current) {
      void paintCard();
    }
  }, [currentTrack?.trackId, upcomingTrack?.trackId, paintCard]);

  // No auto-enter. Per Dash: PiP is an EXPLICIT user action via the
  // "Take Out" button on the floating mini player. Auto-firing on
  // visibilitychange surprises the user and burns the gesture token
  // for nothing on quick tab switches. Keep _isPlaying ref-only to
  // avoid the unused-var lint.
  void isPlaying;

  // Cleanup on unmount — exit PiP, remove the off-screen video element.
  useEffect(() => () => {
    void exitPiP();
    if (videoRef.current) {
      try { videoRef.current.remove(); } catch {}
      videoRef.current = null;
    }
    canvasRef.current = null;
  }, [exitPiP]);
}
