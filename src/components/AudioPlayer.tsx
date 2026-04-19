/**
 * AudioPlayer — v3 (VPS streaming architecture)
 *
 * The browser's only job:
 *   1. Play one persistent stream from the VPS
 *   2. Apply VOYEX EQ/spatial effects via Web Audio API
 *   3. Keep OS lock-screen controls alive via MediaSession
 *   4. Update progress bar at 4Hz from audio.currentTime
 *
 * voyoStream singleton owns the session. AudioPlayer binds the audio
 * element to it and reacts to currentTrack changes from the store:
 *   - VPS-driven change (now_playing SSE) → already handled, no-op here
 *   - User-initiated change (UI tap)       → start new session
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { voyoStream } from '../services/voyoStream';
import { useAudioChain } from '../audio/graph/useAudioChain';
import { useFrequencyPump } from '../audio/graph/freqPump';
import { devLog, devWarn } from '../utils/logger';
import { logPlaybackEvent } from '../services/telemetry';
import { recordPoolEngagement } from '../services/personalization';
import { recordTrackInSession } from '../services/poolCurator';
import { recordPlay as djRecordPlay } from '../services/intelligentDJ';
import { onTrackPlay as oyoOnTrackPlay } from '../services/oyoDJ';
import { loadOyoState, handleRapidSkip } from '../services/oyoState';
import { onSignal as oyaPlanSignal } from '../services/oyoPlan';
import type { Track } from '../types';

import type { BoostPreset } from '../audio/graph/boostPresets';
export type { BoostPreset };

const EDGE_ART = 'https://voyo-edge.dash-webtv.workers.dev/cdn/art';
const YT_ART   = 'https://i.ytimg.com/vi';

// Circuit breaker — 3 errors within 10s on the same session = tear down
// and rebuild instead of looping el.src assignments. Module-scope so it
// survives re-renders of the AudioPlayer component.
const ERROR_BURST_WINDOW_MS = 10_000;
const ERROR_BURST_LIMIT     = 3;
let errorBurst: number[] = [];

// How long we wait on a stall before skipping forward. The fade cross-over
// masks the hand-off so the skip reads as a DJ transition, not a bug.
const STALL_SKIP_THRESHOLD_MS = 4_000;

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const completionSignaledRef = useRef(false);
  // Stall-skip guard — if the stream sits in 'waiting' state longer than
  // STALL_SKIP_THRESHOLD_MS, we trigger nextTrack() so the groove keeps moving.
  // Cleared on any 'playing' event.
  const stallSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    currentTrack,
    isPlaying,
    volume,
    boostProfile,
    voyexSpatial,
    playbackSource,
    setProgress,
    setCurrentTime,
    setDuration,
    setIsPlaying,
  } = usePlayerStore();

  // ── Web Audio chain (VOYEX EQ + spatial effects) ──────────────────────
  const {
    audioContextRef,
    setupAudioEnhancement,
    applyMasterGain,
    fadeInMasterGain,
    muteMasterGainInstantly,
    softFadeOut,
  } = useAudioChain({
    audioRef,
    volume,
    boostProfile: boostProfile as BoostPreset,
    voyexSpatial,
    isPlaying,
    playbackSource,
  });

  // ── Frequency visualizer pump ─────────────────────────────────────────
  useFrequencyPump(isPlaying);

  // ── Bind audio element on mount, end session on unmount ──────────────
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    voyoStream.bindAudio(el);
    return () => {
      voyoStream.onBeforeStreamStart = null;
      voyoStream.onRapidSkip = null;
      voyoStream.endSession();
    };
  }, []);

  // ── Keep voyoStream callbacks current without triggering endSession ───
  useEffect(() => {
    voyoStream.onBeforeStreamStart = () => {
      setupAudioEnhancement(boostProfile as BoostPreset);
      const ctx = audioContextRef.current;
      if (ctx && (ctx.state === 'suspended' || (ctx as any).state === 'interrupted')) {
        ctx.resume().catch(() => {});
      }
      muteMasterGainInstantly();
    };
    voyoStream.onSoftFade = (durationMs: number) => {
      softFadeOut(durationMs);
    };
    voyoStream.onRapidSkip = async () => {
      try {
        const { deck } = await loadOyoState();
        if (deck.trackIds.length === 0) return;
        const { pivotTrackId } = await handleRapidSkip(deck);
        if (!pivotTrackId) return;
        const meta = deck.metadata[pivotTrackId];
        if (!meta) return;
        const pivot: Track = {
          id: pivotTrackId,
          trackId: pivotTrackId,
          title: meta.title,
          artist: meta.artist,
          coverUrl: `${EDGE_ART}/${pivotTrackId}?quality=high`,
          duration: 0,
          tags: [],
          oyeScore: 0,
          createdAt: new Date().toISOString(),
        };
        voyoStream.priorityInject(pivot);
        devLog(`[OYO] Rapid skip pivot → ${meta.title}`);
      } catch {}
    };
  }, [muteMasterGainInstantly, setupAudioEnhancement, boostProfile, audioContextRef, softFadeOut]);

  // ── React to currentTrack changes ─────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) return;
    // Reset completion signal on every track change (VPS-driven or user-initiated)
    completionSignaledRef.current = false;
    if (voyoStream.isSkipping) return;
    // VPS-driven change (now_playing SSE) — stream already advanced, no-op
    if (currentTrack.trackId === voyoStream.currentTrackId) return;
    // VPS-driven track change — don't start a new session.
    // now_playing SSE sets voyoStream.currentTrackId before calling setCurrentTrack,
    // so if they match, the change came from the VPS (skip advance, normal advance).
    // User-initiated taps change the store track before VPS knows about it,
    // so voyoStream.currentTrackId won't match yet → correctly falls through.

    devLog(`[AudioPlayer] user-initiated: ${currentTrack.trackId}`);

    const storeQueue = usePlayerStore.getState().queue;
    const queueTracks = storeQueue.map(qi => qi.track);
    voyoStream.startSession(currentTrack, queueTracks).catch(e => {
      devWarn('[AudioPlayer] startSession failed:', e);
    });

    oyoOnTrackPlay(currentTrack);
    djRecordPlay(currentTrack);
    recordTrackInSession(currentTrack);
    recordPoolEngagement(currentTrack.trackId, 'play');

    logPlaybackEvent({
      event_type: 'play_start',
      track_id: currentTrack.trackId,
      source: 'vps',
    });
  }, [currentTrack?.trackId]);

  // ── Pause / resume sync ───────────────────────────────────────────────
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !voyoStream.sessionId) return;
    if (isPlaying && el.paused) {
      el.play().catch(() => {});
    } else if (!isPlaying && !el.paused) {
      el.pause();
    }
  }, [isPlaying]);

  // ── Background recovery ───────────────────────────────────────────────
  useEffect(() => {
    let wentHiddenAt: number | null = null;

    const handleVisibility = () => {
      if (document.hidden) {
        wentHiddenAt = Date.now();
        return;
      }
      const el = audioRef.current;
      if (!el || !voyoStream.streamUrl) return;
      if (!usePlayerStore.getState().isPlaying) return;
      if (el.paused || el.readyState < 2) {
        const bgDurationMs = wentHiddenAt ? Date.now() - wentHiddenAt : null;
        devLog('[AudioPlayer] back from BG — stream stalled, reconnecting');
        logPlaybackEvent({
          event_type: 'bg_disconnect',
          track_id: voyoStream.currentTrackId ?? 'unknown',
          meta: { bg_duration_ms: bgDurationMs, ready_state: el.readyState, paused: el.paused },
        });
        voyoStream.markAudioRestarted();
        el.src = voyoStream.streamUrl;
        el.load();
        el.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // ── MediaSession playback state sync ─────────────────────────────────
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  // ── Volume sync ───────────────────────────────────────────────────────
  useEffect(() => {
    applyMasterGain();
  }, [volume, boostProfile, applyMasterGain]);

  // ── Audio element event handlers ──────────────────────────────────────

  const handleCanPlay = useCallback(() => {
    setupAudioEnhancement(boostProfile as BoostPreset);
    fadeInMasterGain(100);
    const el = audioRef.current;
    if (el && usePlayerStore.getState().isPlaying) {
      el.play().catch(() => {});
    }
    if (!document.hidden && voyoStream.currentTrackId) {
      logPlaybackEvent({
        event_type: 'bg_reconnect',
        track_id: voyoStream.currentTrackId,
        meta: { ready_state: el?.readyState },
      });
    }
  }, [boostProfile, setupAudioEnhancement, fadeInMasterGain]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, [setIsPlaying]);

  // onPlaying catches buffer-stall auto-resumes — browser fires 'playing' not 'play'
  const handlePlaying = useCallback(() => {
    setIsPlaying(true);
    // Audio recovered — cancel any pending stall-skip.
    if (stallSkipTimerRef.current) {
      clearTimeout(stallSkipTimerRef.current);
      stallSkipTimerRef.current = null;
    }
  }, [setIsPlaying]);

  const handlePause = useCallback(() => {
    // Intentional pause (user tap, MediaSession) — honour it
    if (voyoStream.intentionalPause) {
      voyoStream.intentionalPause = false;
      setIsPlaying(false);
      return;
    }
    // Involuntary stall — stream hiccup or brief disconnect.
    // Try to recover silently instead of showing the paused UI.
    if (voyoStream.sessionId && voyoStream.streamUrl) {
      audioRef.current?.play().catch(() => {});
      return;
    }
    setIsPlaying(false);
  }, [setIsPlaying]);

  const handleTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;

    const position = voyoStream.getPosition();
    const elDur = isFinite(el.duration) ? el.duration : 0;
    const dur = voyoStream.currentDuration || elDur;

    // Track ended — VPS is transitioning, wait for next now_playing SSE
    if (dur > 0 && position >= dur) return;

    const progress = dur > 0 ? position / dur : 0;

    if (progress >= 0.8 && !completionSignaledRef.current) {
      completionSignaledRef.current = true;
      oyaPlanSignal('completion');
    }

    setCurrentTime(position);
    setProgress(progress * 100);
    if (dur > 0) setDuration(dur);

    if (dur > 0 && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          position: Math.min(position, dur),
          playbackRate: 1,
        });
      } catch {}
    }
  }, [setCurrentTime, setProgress, setDuration]);

  const handleEnded = useCallback(() => {
    devWarn('[AudioPlayer] stream ended — reconnecting');
    logPlaybackEvent({
      event_type: 'stream_ended',
      track_id: voyoStream.currentTrackId ?? 'unknown',
      meta: { session_id: voyoStream.sessionId, has_stream_url: !!voyoStream.streamUrl },
    });
    const el = audioRef.current;
    if (!el || !voyoStream.streamUrl) return;
    // Preserve the current playback position so getPosition() stays accurate
    // after the reconnect. markAudioRestarted() resets trackStartAudioTime to 0,
    // which would make the progress bar jump to 0s even though the VPS resumes
    // from the correct byte offset — the user sees a fake "restart".
    // Snapshot position BEFORE reload. After el.src reload, audioEl.currentTime
    // resets to 0 but the VPS resumes from the correct byte offset. We offset
    // trackStartAudioTime so getPosition() = currentTime - trackStartAudioTime
    // stays accurate (no fake "restart" at 0s on the progress bar).
    const positionBeforeReload = voyoStream.getPosition();
    setTimeout(() => {
      if (el && voyoStream.streamUrl) {
        // Do NOT call markAudioRestarted() — that resets trackStartAudioTime to 0
        // and sets _audioRestarted which the SSE handler would clobber on next event.
        voyoStream.trackStartAudioTime = -positionBeforeReload;
        el.src = voyoStream.streamUrl;
        el.play().catch(() => {});
      }
    }, 1000);
  }, []);

  // ── MediaSession ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    const trackId = currentTrack.trackId;
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  currentTrack.title  ?? 'Unknown',
      artist: currentTrack.artist ?? 'VOYO',
      album:  currentTrack.album  ?? '',
      artwork: [
        { src: `${EDGE_ART}/${trackId}?quality=high`, sizes: '512x512', type: 'image/jpeg' },
        { src: `${YT_ART}/${trackId}/hqdefault.jpg`,  sizes: '480x360', type: 'image/jpeg' },
      ],
    });

    navigator.mediaSession.setActionHandler('play',      () => { voyoStream.resume(); });
    navigator.mediaSession.setActionHandler('pause',     () => { voyoStream.pause(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { voyoStream.skip(); });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      const store = usePlayerStore.getState();
      if ((store.currentTime ?? 0) > 3) {
        if (!store.currentTrack) return;
        const queueTracks = store.queue.map(qi => qi.track);
        voyoStream.startSession(store.currentTrack, queueTracks).catch(() => {});
      } else {
        store.prevTrack();
      }
    });

    navigator.mediaSession.playbackState = usePlayerStore.getState().isPlaying ? 'playing' : 'paused';
  }, [currentTrack?.trackId]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <audio
      ref={audioRef}
      onCanPlay={handleCanPlay}
      onPlay={handlePlay}
      onPlaying={handlePlaying}
      onPause={handlePause}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
      onWaiting={() => {
        const el = audioRef.current;
        logPlaybackEvent({
          event_type: 'stream_stall',
          track_id: voyoStream.currentTrackId ?? 'unknown',
          meta: { sub: 'waiting', ready_state: el?.readyState, network_state: el?.networkState },
        });
        // Start a fade on the master gain so the stall isn't just silence —
        // it reads as an intentional transition. If the buffer doesn't recover
        // in STALL_SKIP_THRESHOLD_MS, advance to the next track instead of
        // hanging forever.
        voyoStream.onSoftFade?.(STALL_SKIP_THRESHOLD_MS);
        if (stallSkipTimerRef.current) clearTimeout(stallSkipTimerRef.current);
        stallSkipTimerRef.current = setTimeout(() => {
          stallSkipTimerRef.current = null;
          const curEl = audioRef.current;
          // Don't skip if the browser already recovered — readyState >=3 means
          // we have at least one frame of data queued.
          if (curEl && curEl.readyState >= 3) return;
          logPlaybackEvent({
            event_type: 'stream_stall',
            track_id: voyoStream.currentTrackId ?? 'unknown',
            meta: { sub: 'skip_on_stall', waited_ms: STALL_SKIP_THRESHOLD_MS },
          });
          usePlayerStore.getState().nextTrack();
        }, STALL_SKIP_THRESHOLD_MS);
      }}
      onStalled={() => {
        const el = audioRef.current;
        logPlaybackEvent({
          event_type: 'stream_stall',
          track_id: voyoStream.currentTrackId ?? 'unknown',
          meta: { sub: 'stalled', ready_state: el?.readyState, network_state: el?.networkState },
        });
      }}
      onError={() => {
        const el = audioRef.current;
        const code = el?.error?.code;
        const msg  = el?.error?.message ?? '';
        const now = Date.now();
        errorBurst = errorBurst.filter(t => now - t < ERROR_BURST_WINDOW_MS);
        errorBurst.push(now);
        const burstCount = errorBurst.length;
        devWarn('[AudioPlayer] stream error', { code, msg, burst: burstCount });
        logPlaybackEvent({
          event_type: 'stream_error',
          track_id: voyoStream.currentTrackId ?? 'unknown',
          meta: {
            media_error_code: code,
            media_error_msg: msg,
            ready_state: el?.readyState,
            network_state: el?.networkState,
            has_session: !!voyoStream.sessionId,
            burst_count: burstCount,
          },
        });

        // Circuit breaker — loop detected, rebuild session from scratch.
        // force:true bypasses the 3s cooldown (error burst can fire within
        // seconds of last session create). startSession handles cleanup
        // internally via endSession({keepSrc:true}) — no explicit endSession
        // here so we don't open the Empty-src error window.
        if (burstCount >= ERROR_BURST_LIMIT) {
          errorBurst = [];
          devWarn('[AudioPlayer] error-burst threshold hit — rebuilding session');
          logPlaybackEvent({
            event_type: 'trace',
            track_id: voyoStream.currentTrackId ?? 'unknown',
            meta: { subtype: 'session_rebuild', reason: 'error_burst' },
          });
          const s = usePlayerStore.getState();
          if (s.currentTrack) {
            const queueTracks = s.queue.map(qi => qi.track);
            // force + skipReadyWait: user is already stuck in an error loop,
            // skip the 60s R2-wait flow and go straight to VPS (Webshare
            // fallback) for instant recovery.
            voyoStream.startSession(s.currentTrack, queueTracks, 'high', { force: true, skipReadyWait: true }).catch(() => {});
          }
          return;
        }

        setTimeout(() => {
          const el = audioRef.current;
          if (el && voyoStream.streamUrl) {
            voyoStream.markAudioRestarted();
            el.src = voyoStream.streamUrl;
            el.load();
            el.play().catch(() => {});
          }
        }, 2000);
      }}
      preload="none"
      crossOrigin="anonymous"
    />
  );
};
