/**
 * AudioPlayer — R2-first playback shell.
 *
 * Responsibilities of this file (kept narrow):
 *   1. Mount the <audio> element and wire Web Audio chain (VOYEX EQ/spatial)
 *   2. React to currentTrack changes → R2 HEAD probe → route audio to either
 *      the <audio> element (R2 direct) or YouTubeIframe (fallback)
 *   3. MediaSession handlers for OS lock-screen controls
 *   4. Update progress bar at 4Hz from audio.currentTime
 *
 * The hot-swap cross-fade (iframe → R2 when lane finishes extraction) lives
 * in ../player/useHotSwap. Iframe player control + volume fading lives in
 * ../player/iframeBridge. This file stays focused on lifecycle.
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { voyoStream, ensureTrackReady } from '../services/voyoStream';
import { useHotSwap } from '../player/useHotSwap';
import { oyo, app } from '../services/oyo';
import { useAudioChain } from '../audio/graph/useAudioChain';
import { useFrequencyPump } from '../audio/graph/freqPump';
import { devLog, devWarn } from '../utils/logger';
import { logPlaybackEvent } from '../services/telemetry';
import { loadOyoState, handleRapidSkip } from '../services/oyoState';
import { onSignal as oyaPlanSignal } from '../services/oyoPlan';
import type { Track } from '../types';

import type { BoostPreset } from '../audio/graph/boostPresets';
export type { BoostPreset };

const EDGE_ART = 'https://voyo-edge.dash-webtv.workers.dev/cdn/art';
const YT_ART   = 'https://i.ytimg.com/vi';
const R2_AUDIO = 'https://voyo-edge.dash-webtv.workers.dev/audio';

/**
 * Probe R2 for a track. Returns true if the object is served (200), false if
 * the edge reports 404 or the request fails.
 */
async function r2HasTrack(trackId: string): Promise<boolean> {
  try {
    const res = await fetch(`${R2_AUDIO}/${trackId}?q=high`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

// Circuit breaker — 3 errors within 10s on the same session = tear down
// and rebuild instead of looping el.src assignments. Module-scope so it
// survives re-renders of the AudioPlayer component.
const ERROR_BURST_WINDOW_MS = 10_000;
const ERROR_BURST_LIMIT     = 3;
let errorBurst: number[] = [];

// How long we wait on a stall before skipping forward. The fade cross-over
// masks the hand-off so the skip reads as a DJ transition, not a bug.
// (Only triggers on legacy VPS stream — r2/iframe handle stalls natively.)
const STALL_SKIP_THRESHOLD_MS = 4_000;

// How long a `waiting` event must persist before it counts as a real stall
// (vs. the normal initial-buffer pause on src assignment). If readyState
// reaches HAVE_FUTURE_DATA (>=3) within this window, skip logging.
const STALL_LOG_DELAY_MS = 800;

// Track-to-track transition fades. Outgoing eases down, new track eases in.
// Sequential (one audio element) — perceived length = out + in. Values tuned
// so auto-advance doesn't feel like a hard cut, but user skips still feel
// responsive (620ms total = DJ blend, not sluggish).
const TRACK_CHANGE_FADE_OUT_MS = 220;
const TRACK_CHANGE_FADE_IN_MS  = 400;

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const completionSignaledRef = useRef(false);
  const stallSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounce the `waiting` → stream_stall telemetry. The browser fires
  // 'waiting' once immediately on src assignment (readyState 0, normal
  // initial-buffer state) — NOT a real stall. Only log if the audio
  // hasn't recovered within STALL_LOG_DELAY_MS.
  const stallLogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Carries the fade-in duration the next canplay should use. Track-change
  // sets this to TRACK_CHANGE_FADE_IN_MS so the incoming track eases in;
  // buffer recoveries (no set) get the default short anti-click ramp.
  const nextFadeInMsRef = useRef<number | null>(null);

  // Fine-grained selectors — destructuring the full store re-ran this whole
  // component on every progress / currentTime tick (4Hz) during playback,
  // cascading through the audio chain hooks. Now only the dep that changed
  // triggers a re-render.
  const currentTrack    = usePlayerStore(s => s.currentTrack);
  const isPlaying       = usePlayerStore(s => s.isPlaying);
  const volume          = usePlayerStore(s => s.volume);
  const boostProfile    = usePlayerStore(s => s.boostProfile);
  const voyexSpatial    = usePlayerStore(s => s.voyexSpatial);
  const playbackSource  = usePlayerStore(s => s.playbackSource);
  const setProgress     = usePlayerStore(s => s.setProgress);
  const setCurrentTime  = usePlayerStore(s => s.setCurrentTime);
  const setDuration     = usePlayerStore(s => s.setDuration);
  const setIsPlaying    = usePlayerStore(s => s.setIsPlaying);

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

  // ── Hot-swap: iframe → R2 cross-fade, snapshot resume, watcher lifecycle ──
  // Self-contained hook. Activates whenever playbackSource flips to 'iframe'
  // on a fresh track; idles otherwise. See src/player/useHotSwap.ts.
  useHotSwap(currentTrack, playbackSource, audioRef);

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
      // useHotSwap handles its own watcher teardown on unmount + track change.
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
        // Route through playerStore — AudioPlayer's track-change effect then
        // runs the R2-first flow (iframe fallback + hot-swap). No VPS session.
        usePlayerStore.getState().setCurrentTrack(pivot);
        void ensureTrackReady(pivot, null, { priority: 10 });
        devLog(`[OYO] Rapid skip pivot → ${meta.title}`);
      } catch {}
    };
  }, [muteMasterGainInstantly, setupAudioEnhancement, boostProfile, audioContextRef, softFadeOut]);

  // ── React to currentTrack changes ─────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) return;
    // Reset completion signal on every track change
    completionSignaledRef.current = false;
    if (voyoStream.isSkipping) return;
    if (currentTrack.trackId === voyoStream.currentTrackId) return;

    devLog(`[AudioPlayer] track change: ${currentTrack.trackId}`);

    const el = audioRef.current;
    const setSource = usePlayerStore.getState().setPlaybackSource;

    // Track change = intent to play. Set the play-flag now so the play/pause
    // button flips to the pause icon immediately, even while we're still
    // HEAD-probing R2 / waiting for iframe to mount. The actual audio.play()
    // happens below; this just keeps the UI synced with intent.
    if (!usePlayerStore.getState().isPlaying) {
      usePlayerStore.getState().setIsPlaying(true);
    }

    // Fire fade-out + HEAD probe IN PARALLEL so the src swap lands at
    // exactly the fade-out bottom. Previously HEAD ran first then a
    // separate 220ms timer, leaving a silence gap that sounded like a
    // brief restart. Now the silence window is ~0 — old track dips to
    // zero, src swaps, new track eases in. DJ-smooth.
    const shouldFade = !!el && playbackSource === 'r2';
    if (shouldFade) softFadeOut(TRACK_CHANGE_FADE_OUT_MS);
    nextFadeInMsRef.current = TRACK_CHANGE_FADE_IN_MS;

    // R2-first probe: either set audio.src directly (cached) or hand audio
    // to the YouTubeIframe fallback (useHotSwap handles the cross-fade when
    // the lane catches up). Watcher lifecycle lives in useHotSwap; no refs
    // to manage here.
    (async () => {
      const headPromise = r2HasTrack(currentTrack.trackId);
      const fadePromise = shouldFade
        ? new Promise<void>(r => setTimeout(r, TRACK_CHANGE_FADE_OUT_MS))
        : Promise.resolve();
      const [cached] = await Promise.all([headPromise, fadePromise]);
      if (cached && el) {
        el.src = `${R2_AUDIO}/${currentTrack.trackId}?q=high`;
        el.play().catch(() => {});
        setSource('r2');
        logPlaybackEvent({
          event_type: 'play_start',
          track_id: currentTrack.trackId,
          source: 'r2',
        });
      } else {
        // Blank the audio element so the iframe is the sole audio source.
        // intentionalPause flag prevents handlePause from flipping isPlaying.
        if (el) {
          voyoStream.intentionalPause = true;
          try { el.pause(); } catch {}
          el.removeAttribute('src');
        }
        setSource('iframe');
        logPlaybackEvent({
          event_type: 'play_start',
          track_id: currentTrack.trackId,
          source: 'iframe',
        });
        // Queue the track so lanes extract to R2 → useHotSwap watchers fire
        // the cross-fade as soon as it lands.
        void ensureTrackReady(currentTrack, null, { priority: 10 });
      }
    })();

    // Smart layer hears one clean "play" signal; internals fan out to all
    // taste/curation modules. Player no longer knows about intelligentDJ,
    // poolCurator, personalization, etc.
    oyo.onPlay(currentTrack);

    // Predictive pre-warm (gated on OYE bulb) — fire ensureTrackReady for the
    // next two queue items so they're cached by the time the user gets there.
    // Previously tied to voyoStream's SSE now_playing; that path is gone, so
    // we drive prewarm directly from the track-change boundary now.
    const store = usePlayerStore.getState();
    if (store.oyePrewarm) {
      const upcoming = store.queue.slice(0, 2).map(qi => qi.track);
      for (const t of upcoming) {
        if (!t?.trackId) continue;
        void ensureTrackReady(t, null, { priority: 5 });
      }
    }
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
    // Track-change sets nextFadeInMsRef to TRACK_CHANGE_FADE_IN_MS — real
    // ease-in. Buffer recoveries leave it null → short anti-click default.
    const fadeMs = nextFadeInMsRef.current ?? 100;
    nextFadeInMsRef.current = null;
    fadeInMasterGain(fadeMs);
    const el = audioRef.current;
    if (el && usePlayerStore.getState().isPlaying) {
      el.play().catch(() => {});
    }
    // Recovered — cancel any pending stall-log.
    if (stallLogTimerRef.current) {
      clearTimeout(stallLogTimerRef.current);
      stallLogTimerRef.current = null;
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
    // Audio recovered — cancel any pending stall-skip + stall-log.
    if (stallSkipTimerRef.current) {
      clearTimeout(stallSkipTimerRef.current);
      stallSkipTimerRef.current = null;
    }
    if (stallLogTimerRef.current) {
      clearTimeout(stallLogTimerRef.current);
      stallLogTimerRef.current = null;
    }
  }, [setIsPlaying]);

  const handlePause = useCallback(() => {
    // When iframe is the audio source, the audio element pausing is expected
    // (we intentionally silenced it). Don't let it flip isPlaying — the real
    // playback is happening through the iframe.
    if (usePlayerStore.getState().playbackSource === 'iframe') {
      return;
    }
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
    // R2-direct playback (no VPS session): just advance the queue locally.
    // This is the common case now — the audio element gets a discrete R2 file
    // per track, so 'ended' means track-over, not stream-broken.
    const ps = usePlayerStore.getState().playbackSource;
    if (ps === 'r2' || !voyoStream.sessionId) {
      logPlaybackEvent({
        event_type: 'stream_ended',
        track_id: voyoStream.currentTrackId ?? 'unknown',
        meta: { source: ps, advance: 'local_next' },
      });
      usePlayerStore.getState().nextTrack();
      return;
    }

    // Legacy VPS session path — kept for any code path that still calls
    // voyoStream.startSession(). Can be removed once all sessions are gone.
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
    navigator.mediaSession.setActionHandler('nexttrack', () => { app.skip(); });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      const store = usePlayerStore.getState();
      if ((store.currentTime ?? 0) > 3) {
        // Seek-to-zero via reload of the same R2 src. Setting currentTrack to
        // itself doesn't trigger the effect, so seek directly on the audio el.
        const el = audioRef.current;
        if (el) { try { el.currentTime = 0; el.play().catch(() => {}); } catch {} }
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
        const store = usePlayerStore.getState();
        const curTrack = store.currentTrack?.trackId ?? 'unknown';
        // Debounce telemetry: a 'waiting' event that resolves within
        // STALL_LOG_DELAY_MS is normal initial-buffer pause, not a stall.
        // 86% of our "stalls" in prod were this noise (ready_state 0 on
        // src assignment). Only log if the element is still underbuffered
        // after the delay.
        if (stallLogTimerRef.current) clearTimeout(stallLogTimerRef.current);
        stallLogTimerRef.current = setTimeout(() => {
          stallLogTimerRef.current = null;
          const curEl = audioRef.current;
          if (!curEl || curEl.readyState >= 3) return; // recovered — not a stall
          logPlaybackEvent({
            event_type: 'stream_stall',
            track_id: curTrack,
            meta: {
              sub: 'waiting',
              source: store.playbackSource,
              ready_state: curEl.readyState,
              network_state: curEl.networkState,
              waited_ms: STALL_LOG_DELAY_MS,
            },
          });
        }, STALL_LOG_DELAY_MS);
        // Stall-skip is only meaningful when the audio element is actually
        // trying to be the source. For 'r2', a transient 'waiting' during
        // src assignment / network seek is normal and the browser recovers
        // on its own — auto-skipping here would yank the user off a track
        // that would have played fine 300ms later.
        // For 'iframe', the audio element is silent anyway (iframe owns
        // audio) so a 'waiting' means nothing. Skip logic off.
        // The original case this was built for — VPS live-stream hangs — no
        // longer applies since we removed voyoStream session-based playback.
        if (store.playbackSource === 'r2' || store.playbackSource === 'iframe') {
          return;
        }
        voyoStream.onSoftFade?.(STALL_SKIP_THRESHOLD_MS);
        if (stallSkipTimerRef.current) clearTimeout(stallSkipTimerRef.current);
        stallSkipTimerRef.current = setTimeout(() => {
          stallSkipTimerRef.current = null;
          const curEl = audioRef.current;
          if (curEl && curEl.readyState >= 3) return;
          logPlaybackEvent({
            event_type: 'stream_stall',
            track_id: curTrack,
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
          devWarn('[AudioPlayer] error-burst on current track — advancing');
          logPlaybackEvent({
            event_type: 'trace',
            track_id: usePlayerStore.getState().currentTrack?.trackId ?? 'unknown',
            meta: { subtype: 'error_burst_skip', burst_count: burstCount },
          });
          // Three audio-element errors in 10s → track is toast. Advance
          // instead of rebuilding a VPS session (which no longer exists in
          // the R2-first flow).
          usePlayerStore.getState().nextTrack();
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
