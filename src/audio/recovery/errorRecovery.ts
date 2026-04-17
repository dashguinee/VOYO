/**
 * Error Recovery — when the audio element errors or stalls, swap to a
 * fresher source instead of letting playback die.
 *
 * RECOVERY LADDER (fastest to slowest):
 *   1. Local IndexedDB cache (often ready from background auto-cache)
 *   2. R2 collective cache (shared network cache)
 *   3. Re-extract via Edge Worker (yt-dlp last resort)
 *   4. Skip to next track — ONLY in foreground. In BG the failure may be
 *      transient (network blip, focus revoke); visibility handler will
 *      re-kick on return.
 *
 * STALL: fires `stalled` event when the element can't get more data. 10s
 * timer in FG (patience for network flaps); 4s MC-based timer in BG
 * (setTimeout throttled to 1/min there). If still stalled at timeout,
 * force handleAudioError recovery.
 */

import { useCallback, useRef, RefObject } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { checkR2Cache } from '../../services/api';
import { trace, logPlaybackEvent } from '../../services/telemetry';
import { devLog, devWarn } from '../../utils/logger';
import type { Track } from '../../types';
import { playbackState } from '../playback/playbackState';

const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';
const VPS_AUDIO_URL = 'https://stream.zionsynapse.online:8443';

interface UseErrorRecoveryParams {
  audioRef: RefObject<HTMLAudioElement | null>;
  cachedUrlRef: RefObject<string | null>;
  isEdgeStreamRef: RefObject<boolean>;
  loadAttemptRef: RefObject<number>;
  playbackSource: string | null;
  currentTrack: Track | null;
  checkCache: (trackId: string) => Promise<string | null>;
  clearLoadWatchdog: () => void;
  nextTrack: () => void;
  setPlaybackSource: (src: any) => void;
  muteMasterGainInstantly: () => void;
  fadeInMasterGain: (durationMs?: number) => void;
}

export interface ErrorRecoveryApi {
  handleAudioError: (e: React.SyntheticEvent<HTMLAudioElement, Event>) => Promise<void>;
  handleStalled: () => void;
  clearStallTimer: () => void;
}

export function useErrorRecovery(params: UseErrorRecoveryParams): ErrorRecoveryApi {
  const {
    audioRef,
    cachedUrlRef,
    isEdgeStreamRef,
    loadAttemptRef,
    playbackSource,
    currentTrack,
    checkCache,
    clearLoadWatchdog,
    nextTrack,
    setPlaybackSource,
    muteMasterGainInstantly,
    fadeInMasterGain,
  } = params;

  const handleAudioError = useCallback(async (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    trace('audio_error', usePlayerStore.getState().currentTrack?.trackId, {
      hidden: document.hidden,
      errCode: (e.target as HTMLAudioElement)?.error?.code,
      src: ((e.target as HTMLAudioElement)?.src || '').slice(0, 60),
    });
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;
    playbackState.transition('error', usePlayerStore.getState().currentTrack?.trackId ?? null, 'audio_error');

    const audio = e.currentTarget;
    const error = audio.error;
    const errorCodes: Record<number, string> = {
      1: 'MEDIA_ERR_ABORTED',
      2: 'MEDIA_ERR_NETWORK',
      3: 'MEDIA_ERR_DECODE',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    };
    const errorName = error ? (errorCodes[error.code] || `Unknown(${error.code})`) : 'Unknown';
    const recoveryStart = performance.now();
    devWarn(`🚨 [recover] Audio error: ${errorName}`, error?.message);

    clearLoadWatchdog();
    if (!currentTrack?.trackId || !error) return;

    const savedPos = usePlayerStore.getState().currentTime;

    // Clear dangling handlers + mute via Web Audio gain (no HTML-volume jumps).
    if (audioRef.current) {
      audioRef.current.oncanplaythrough = null;
      audioRef.current.oncanplay = null;
      audioRef.current.onplay = null;
      muteMasterGainInstantly();
    }

    // Stale guard: if a newer loadTrack runs during async recovery, bail
    // before touching audio.src.
    const recoveryAttempt = loadAttemptRef.current;
    const recoveryIsStale = () => loadAttemptRef.current !== recoveryAttempt;

    // (1) Local IDB cache — often ready from background auto-cache.
    try {
      const cachedUrl = await checkCache(currentTrack.trackId);
      if (recoveryIsStale()) return;
      if (cachedUrl && audioRef.current) {
        devLog('🔄 [recover] 1/3 local cache hit');
        if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
        cachedUrlRef.current = cachedUrl;
        audioRef.current.src = cachedUrl;
        audioRef.current.load();
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null;
          if (recoveryIsStale()) return;
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = false;
          setPlaybackSource('cached');
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            devLog(`🔄 [recover] 1/3 done in ${(performance.now() - recoveryStart).toFixed(0)}ms`);
          }).catch(() => {});
        };
        return;
      }
    } catch {}

    // (2) R2 collective cache — faster than re-extracting.
    try {
      const r2Result = await checkR2Cache(currentTrack.trackId);
      if (recoveryIsStale()) return;
      if (r2Result.exists && r2Result.url && audioRef.current) {
        devLog('🔄 [recover] 2/3 R2 hit');
        audioRef.current.src = r2Result.url;
        audioRef.current.load();
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null;
          if (recoveryIsStale()) return;
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = false;
          setPlaybackSource('r2');
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            devLog(`🔄 [recover] 2/3 done in ${(performance.now() - recoveryStart).toFixed(0)}ms`);
          }).catch(() => {});
        };
        return;
      }
    } catch {}

    // (3) VPS direct URL — yt-dlp extraction path. Edge Worker broken for cold
    //     tracks from CF datacenter IPs; VPS is the authoritative cold route.
    try {
      const vpsUrl = `${VPS_AUDIO_URL}/voyo/audio/${currentTrack.trackId}?quality=high`;
      if (recoveryIsStale()) return;
      if (audioRef.current) {
        devLog('🔄 [recover] 3/3 VPS fallback');
        audioRef.current.src = vpsUrl;
        audioRef.current.load();
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null;
          if (recoveryIsStale()) return;
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = false;
          setPlaybackSource('r2');
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            devLog(`🔄 [recover] 3/3 done in ${(performance.now() - recoveryStart).toFixed(0)}ms`);
          }).catch(() => {});
        };
        return;
      }
    } catch {}

    // (4) Skip to next track — ONLY in foreground. BG: transient failures
    // (focus revoke, network blip) resolve on return; visibility handler
    // will re-kick.
    if (recoveryIsStale()) return;
    const elapsed = performance.now() - recoveryStart;
    if (document.hidden) {
      devWarn(`🚨 [recover] failed in BG (${elapsed.toFixed(0)}ms) — NOT skipping`);
      return;
    }
    devLog(`🚨 [recover] cannot recover after ${elapsed.toFixed(0)}ms → skip`);
    audio.pause();
    if (cachedUrlRef.current) {
      URL.revokeObjectURL(cachedUrlRef.current);
      cachedUrlRef.current = null;
    }
    nextTrack();
  }, [playbackSource, currentTrack?.trackId, checkCache, nextTrack, setPlaybackSource, audioRef, cachedUrlRef, isEdgeStreamRef, loadAttemptRef, clearLoadWatchdog, muteMasterGainInstantly, fadeInMasterGain]);

  // ── STALL TIMER ─────────────────────────────────────────────────────
  // Stalls fire without triggering onError. Timer gives buffer time to
  // recover; if stuck, force handleAudioError.
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | { close: () => void } | null>(null);

  const handleStalled = useCallback(() => {
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;
    if (stallTimerRef.current) return; // already armed
    const t = usePlayerStore.getState().currentTrack;
    const audio = audioRef.current;
    const bufEnd = audio?.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : null;
    const ahead = bufEnd != null && audio ? (bufEnd - audio.currentTime) : null;
    if (t?.trackId) {
      logPlaybackEvent({
        event_type: 'stall',
        track_id: t.trackId,
        source: (playbackSource as any),
        meta: { position: audio?.currentTime, readyState: audio?.readyState, bufferedAhead: ahead, hidden: document.hidden },
      });
    }
    const recoverNow = () => {
      stallTimerRef.current = null;
      const el = audioRef.current;
      if (!el || el.paused) return;
      if (!el.seeking && el.readyState >= 2 && el.buffered.length > 0) {
        const bufferedEnd = el.buffered.end(el.buffered.length - 1);
        if (bufferedEnd > el.currentTime + 1) {
          trace('stall_recovered', t?.trackId || null, { bufferedAhead: bufferedEnd - el.currentTime });
          return;
        }
      }
      trace('stall_force_recover', t?.trackId || null, { readyState: el.readyState, position: el.currentTime, hidden: document.hidden });
      devWarn('🚨 [stall] timeout — forcing recovery');
      handleAudioError({ currentTarget: el } as React.SyntheticEvent<HTMLAudioElement, Event>);
    };
    if (document.hidden) {
      // MC-based BG timer (setTimeout throttled 1/min). 4s wall-clock.
      const startMs = Date.now();
      const mc = new MessageChannel();
      stallTimerRef.current = { close: () => { try { mc.port1.close(); } catch {} } };
      const handle = stallTimerRef.current;
      mc.port1.onmessage = () => {
        if (stallTimerRef.current !== handle) { try { mc.port1.close(); } catch {} return; }
        if (Date.now() - startMs < 4000) { mc.port2.postMessage(null); return; }
        try { mc.port1.close(); } catch {}
        recoverNow();
      };
      mc.port2.postMessage(null);
    } else {
      stallTimerRef.current = setTimeout(recoverNow, 10000);
    }
  }, [playbackSource, handleAudioError, audioRef]);

  const clearStallTimer = useCallback(() => {
    const h = stallTimerRef.current;
    if (!h) return;
    if (typeof h === 'object' && 'close' in h) h.close();
    else clearTimeout(h);
    stallTimerRef.current = null;
  }, []);

  return { handleAudioError, handleStalled, clearStallTimer };
}
