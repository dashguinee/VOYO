/**
 * VOYO Mini Picture-in-Picture
 *
 * Canvas-composite PiP — the only path that works for a PWA on top of
 * a cross-origin YouTube iframe. Browsers block requestPictureInPicture()
 * on foreign-origin iframes for security; YT's iframe is sandboxed so
 * we can't grab its inner <video> element either. So instead we paint
 * a VOYO-branded card onto a canvas, captureStream() it as a video,
 * and PiP that.
 *
 * v761+ — premium audio-reactive paint. Each frame is driven by live
 * FFT data from the AudioPlayer's <audio> element (via audioEngine's
 * AnalyserNode, fftSize 256). The album art breathes with bass, a
 * bronze hairline traces real progress around it, and a restrained
 * mid-frequency waveform sits at the bottom edge. The base canvas is
 * deep #0a0a0c so the card reads as floating against the OS PiP
 * backdrop in dark mode (fake-transparent treatment — true alpha is
 * not portable across iOS/Android/Chrome).
 *
 * Registers itself with pipService so the existing tap-to-enter call
 * sites (escape-Oye in app.ts, Mini Player buttons in VoyoPortraitPlayer)
 * actually work. Previously pipService.register was never called and
 * every pipService.enter() returned false silently. (audit-2 P1-IF-3)
 */

import { useRef, useCallback, useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { pipService } from '../services/pipService';
import { getAnalyser } from '../services/audioEngine';
import { getThumb } from '../utils/thumbnail';

const PIP_W = 360;
const PIP_H = 360;

export function useMiniPiP() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);

  // Cached album art image — loaded once per track, painted every frame
  // without re-decoding. New track triggers a fresh load via the effect
  // below; old image stays painted until the new one resolves.
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Animation loop handle — cancelled on PiP exit / unmount.
  const rafRef = useRef<number | null>(null);

  // Reusable FFT buffer, allocated once per analyser shape change.
  // Explicit ArrayBuffer (not ArrayBufferLike) so the analyser's
  // getByteFrequencyData signature accepts it under TS strict typing.
  const fftBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

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
    video.srcObject = canvas.captureStream(30);
    video.muted = true;
    video.playsInline = true;
    // Off-screen, but NOT display:none (some browsers refuse PiP on hidden video).
    video.style.cssText = 'position:fixed;bottom:-1px;right:-1px;width:1px;height:1px;opacity:0.001;pointer-events:none;';
    document.body.appendChild(video);
    videoRef.current = video;

    video.addEventListener('leavepictureinpicture', () => {
      isActiveRef.current = false;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    });
  }, []);

  // Load album art when track changes. Cached in imgRef for the render loop.
  useEffect(() => {
    if (!currentTrack) {
      imgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; };
    img.onerror = () => { imgRef.current = null; };
    img.src = getThumb(currentTrack.trackId, 'high');
  }, [currentTrack?.trackId, currentTrack]);

  // Single-frame render. Reads FFT + progress live; everything else is
  // cached in refs. Runs at rAF cadence (~60fps); the captureStream is
  // 30fps, so the browser samples this canvas at 30fps regardless.
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ── Read live signals ─────────────────────────────────────────
    const analyser = getAnalyser();
    let bass = 0;
    let mids: number[] = [];
    if (analyser) {
      const bins = analyser.frequencyBinCount;
      if (!fftBufRef.current || fftBufRef.current.length !== bins) {
        fftBufRef.current = new Uint8Array(new ArrayBuffer(bins));
      }
      const buf = fftBufRef.current;
      analyser.getByteFrequencyData(buf);
      // Bass: low 8 bins (~0–700 Hz), normalised 0–1.
      let sum = 0;
      const bassN = Math.min(8, bins);
      for (let i = 0; i < bassN; i++) sum += buf[i];
      bass = (sum / bassN) / 255;
      // Mids: bins 8..32 → 24 segments for bottom waveform.
      const midStart = 8;
      const midCount = Math.min(24, bins - midStart);
      mids = new Array(midCount);
      for (let i = 0; i < midCount; i++) mids[i] = buf[midStart + i] / 255;
    }

    const state = usePlayerStore.getState();
    const progress = Math.max(0, Math.min(1, state.progress || 0));
    const t = performance.now() / 1000;

    // ── Base — deep canvas matching OS dark backdrop ─────────────
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, PIP_W, PIP_H);

    // ── Drifting bronze→purple radial, bass-modulated ────────────
    // Slow circular drift so the gradient never sits still; bass adds
    // amplitude punch without changing color (premium = restraint).
    const cx = PIP_W / 2;
    const cy = PIP_H / 2;
    const driftX = cx + Math.sin(t * 0.13) * 28;
    const driftY = cy - 30 + Math.cos(t * 0.11) * 18;
    const grad = ctx.createRadialGradient(driftX, driftY, 0, driftX, driftY, PIP_W * 0.72);
    const punch = 0.06 + bass * 0.10;
    grad.addColorStop(0, `rgba(212,160,83,${punch})`);
    grad.addColorStop(0.55, `rgba(139,92,246,${punch * 0.5})`);
    grad.addColorStop(1, 'rgba(10,10,12,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PIP_W, PIP_H);

    // ── Album art as a circle, bass-driven breath ────────────────
    const artCY = cy - 30;
    const baseR = PIP_W * 0.30;
    const r = baseR * (1 + bass * 0.035); // 3.5% peak breath
    const img = imgRef.current;

    // Bronze ambient halo behind the art — gives the "detached card"
    // read Dash asked for; modulated by bass so it pulses with the kick.
    ctx.save();
    const halo = ctx.createRadialGradient(cx, artCY, r * 0.85, cx, artCY, r * 1.55);
    halo.addColorStop(0, `rgba(212,160,83,${0.18 + bass * 0.18})`);
    halo.addColorStop(1, 'rgba(212,160,83,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, artCY, r * 1.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (img && img.complete && img.naturalWidth > 0) {
      // Album clipped to circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, artCY, r, 0, Math.PI * 2);
      ctx.clip();
      const srcSize = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - srcSize) / 2;
      const sy = (img.naturalHeight - srcSize) / 2;
      ctx.drawImage(img, sx, sy, srcSize, srcSize, cx - r, artCY - r, r * 2, r * 2);
      ctx.restore();

      // Hairline circle border for definition against gradient
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, artCY, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      // Fallback solid disc if image not ready
      ctx.fillStyle = 'rgba(139,92,246,0.35)';
      ctx.beginPath();
      ctx.arc(cx, artCY, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Live progress arc — bronze hairline orbiting the art ─────
    ctx.save();
    ctx.strokeStyle = 'rgba(212,160,83,0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const startA = -Math.PI / 2;
    const endA = startA + Math.PI * 2 * progress;
    ctx.arc(cx, artCY, r + 8, startA, endA);
    ctx.stroke();
    // Tail dot at the leading edge
    if (progress > 0.005) {
      const dotX = cx + Math.cos(endA) * (r + 8);
      const dotY = artCY + Math.sin(endA) * (r + 8);
      ctx.fillStyle = '#F4A23E';
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // ── Title + artist ───────────────────────────────────────────
    ctx.fillStyle = '#fff';
    ctx.font = '600 16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxW = PIP_W - 40;
    let title = currentTrack?.title || '';
    while (ctx.measureText(title).width > maxW && title.length > 3) {
      title = title.slice(0, -2) + '…';
    }
    ctx.fillText(title, cx, PIP_H * 0.78);

    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    let artist = currentTrack?.artist || '';
    while (ctx.measureText(artist).width > maxW && artist.length > 3) {
      artist = artist.slice(0, -2) + '…';
    }
    ctx.fillText(artist, cx, PIP_H * 0.85);

    // ── Bottom mids waveform — restrained, bronze ────────────────
    if (mids.length > 0) {
      const waveY = PIP_H - 14;
      const waveW = PIP_W - 60;
      const waveX = (PIP_W - waveW) / 2;
      const segW = waveW / mids.length;
      ctx.fillStyle = 'rgba(212,160,83,0.55)';
      for (let i = 0; i < mids.length; i++) {
        const h = Math.max(1, mids[i] * 9);
        ctx.fillRect(waveX + i * segW, waveY - h / 2, segW * 0.55, h);
      }
    }

    if (isActiveRef.current) {
      rafRef.current = requestAnimationFrame(renderFrame);
    }
  }, [currentTrack]);

  // First-frame static paint (used before requestPictureInPicture so the
  // captureStream has frames to hand off when PiP starts).
  const paintCard = useCallback(() => {
    renderFrame();
  }, [renderFrame]);

  const enterPiP = useCallback(async (): Promise<boolean> => {
    if (!isSupported() || !currentTrack) return false;
    if (isActiveRef.current) return true;

    initElements();
    if (!videoRef.current) return false;

    try {
      // Seed first frame so captureStream is non-empty before PiP request.
      paintCard();
      await videoRef.current.play();
      await videoRef.current.requestPictureInPicture();
      isActiveRef.current = true;
      // Kick off the live render loop.
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(renderFrame);
      }
      return true;
    } catch {
      return false;
    }
  }, [isSupported, initElements, paintCard, renderFrame, currentTrack]);

  const exitPiP = useCallback(async (): Promise<void> => {
    if (!isActiveRef.current) return;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
  useEffect(() => {
    pipService.register(enterPiP, exitPiP, togglePiP);
  }, [enterPiP, exitPiP, togglePiP]);

  // Repaint a single frame when the track or upcoming changes while
  // PiP is paused (rAF loop only runs while active). Keeps the still
  // frame fresh for cases where playback is paused but PiP is open.
  useEffect(() => {
    if (isActiveRef.current && rafRef.current == null) {
      paintCard();
    }
  }, [currentTrack?.trackId, upcomingTrack?.trackId, paintCard]);

  // No auto-enter. Per Dash: PiP is an EXPLICIT user action via the
  // "Take Out" button on the floating mini player.
  void isPlaying;

  // Cleanup on unmount — exit PiP, cancel rAF, remove the off-screen
  // video element.
  useEffect(() => () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    void exitPiP();
    if (videoRef.current) {
      try { videoRef.current.remove(); } catch {}
      videoRef.current = null;
    }
    canvasRef.current = null;
  }, [exitPiP]);
}
