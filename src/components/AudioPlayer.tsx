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
import { iframeBridge } from '../player/iframeBridge';
import { oyo, app } from '../services/oyo';
import { useAudioChain } from '../audio/graph/useAudioChain';
import { useFrequencyPump } from '../audio/graph/freqPump';
import { devLog, devWarn } from '../utils/logger';
import { logPlaybackEvent } from '../services/telemetry';
import { loadOyoState, handleRapidSkip } from '../services/oyoState';
import { onSignal as oyaPlanSignal } from '../services/oyoPlan';
import type { Track } from '../types';

import type { BoostPreset } from '../audio/graph/boostPresets';
// r2Probe is the shared probe — useHotSwap imports the same function,
// so one fix = both paths. R2_AUDIO stays here for the src-assignment URL.
import { r2HasTrack, R2_AUDIO_BASE as R2_AUDIO } from '../player/r2Probe';
import { useR2KnownStore } from '../store/r2KnownStore';
import { getYouTubeId } from '../utils/voyoId';
export type { BoostPreset };

const EDGE_ART = 'https://voyo-edge.dash-webtv.workers.dev/cdn/art';
const YT_ART   = 'https://i.ytimg.com/vi';

// Circuit breaker — 3 errors within 10s on the same session = tear down
// and rebuild instead of looping el.src assignments. Module-scope so it
// survives re-renders of the AudioPlayer component.
const ERROR_BURST_WINDOW_MS = 10_000;
const ERROR_BURST_LIMIT     = 3;
let errorBurst: number[] = [];

// How long a `waiting` event must persist before it counts as a real stall
// (vs. the normal initial-buffer pause on src assignment). If readyState
// reaches HAVE_FUTURE_DATA (>=3) within this window, skip logging.
const STALL_LOG_DELAY_MS = 800;

// Track-to-track transition fades. Two tiers:
//  - Always-on "polish" fade (SHORT): a mini fade-out + fade-in so NO
//    transition is ever a hard cut. Even fast card-tapping feels smooth.
//  - "Earned" DJ fade (LONG): when the outgoing track has been playing
//    ≥FADE_OUT_MIN_ELAPSED_S, extend the ramps to a proper DJ blend.
// Dash feedback (v330): gating fade entirely on elapsed made quick
// taps feel harsh. Now the SHORT fade is the floor; LONG layers on
// top when the user's actually been listening.
const SHORT_FADE_OUT_MS = 90;
const SHORT_FADE_IN_MS  = 170;
const LONG_FADE_OUT_MS  = 180;
const LONG_FADE_IN_MS   = 320;
const FADE_OUT_MIN_ELAPSED_S = 30;

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const completionSignaledRef = useRef(false);
  // True during track-change (between src swap and the new track's canplay).
  // Prevents handlePause from flipping isPlaying=false on the transient
  // 'pause' event browsers fire when el.src is reassigned — which was
  // the reason BG auto-advance left the app "paused" until manual resume.
  const trackSwapInProgressRef = useRef(false);
  // Debounce the `waiting` → stream_stall telemetry. The browser fires
  // 'waiting' once immediately on src assignment (readyState 0, normal
  // initial-buffer state) — NOT a real stall. Only log if the audio
  // hasn't recovered within STALL_LOG_DELAY_MS.
  const stallLogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Carries the fade-in duration the next canplay should use. Track-change
  // sets this to TRACK_CHANGE_FADE_IN_MS so the incoming track eases in;
  // buffer recoveries (no set) get the default short anti-click ramp.
  const nextFadeInMsRef = useRef<number | null>(null);
  // Trackes the trackId whose "next up" has already been pre-warmed via
  // ensureTrackReady at priority=7. Cleared on every track change so each
  // new track gets exactly one predictive pre-warm round. Without this the
  // 4Hz timeupdate would fire ensureTrackReady hundreds of times per track.
  const prewarmFiredForRef = useRef<string | null>(null);
  // Monotonic counter incremented on every track-change effect entry.
  // Async work inside the effect captures its token and bails if the ref
  // has moved past it — prevents a stale closure from a prior skip from
  // overwriting el.src or logging play_start after the user has already
  // moved on.
  const trackChangeTokenRef = useRef(0);

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
      voyoStream.onRapidSkip = null;
      voyoStream.endSession();
      // useHotSwap handles its own watcher teardown on unmount + track change.
    };
  }, []);

  // ── Rapid-skip handler — fires from voyoStream.skip() when the user
  //    triples in 10s. Pivots the deck to a fresh taste direction.
  useEffect(() => {
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
  }, []);

  // ── React to currentTrack changes ─────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) return;
    // Reset completion signal on every track change
    completionSignaledRef.current = false;
    // Clear predictive pre-warm latch so the new track gets its own single
    // ahead-of-time ensureTrackReady call at the 50% mark.
    prewarmFiredForRef.current = null;

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

    // DASH-STYLE TRANSITION — nothing harsh ever, nothing delayed ever.
    // Pick fade length by how long the outgoing track actually played.
    // Quick taps (<30s in) get a SHORT floor fade so there's never a
    // hard cut; long listens (≥30s) get a proper DJ blend. BG-hidden
    // tabs skip the timer wait (setTimeout throttles to ~1s in BG,
    // which would cause audible silence between outgoing and incoming).
    const isHidden = typeof document !== 'undefined' && document.hidden;
    const wasIframe = playbackSource === 'iframe';
    const wasR2 = playbackSource === 'r2';
    const elapsedS = el?.currentTime ?? 0;
    const earnedLong = elapsedS >= FADE_OUT_MIN_ELAPSED_S;
    const fadeOutMs = earnedLong ? LONG_FADE_OUT_MS : SHORT_FADE_OUT_MS;
    const fadeInMs  = earnedLong ? LONG_FADE_IN_MS  : SHORT_FADE_IN_MS;
    const shouldFade = !!el && !isHidden && (wasR2 || wasIframe);
    if (shouldFade) {
      if (wasR2) softFadeOut(fadeOutMs);
      if (wasIframe) void iframeBridge.fadeOut(fadeOutMs);
    }
    // Incoming ramp — halve in BG; Web Audio clock isn't throttled so
    // the ramp still fires reliably, just shorter (user can't see it).
    nextFadeInMsRef.current = isHidden ? Math.min(fadeInMs, 180) : fadeInMs;

    // R2-first probe: either set audio.src directly (cached) or hand audio
    // to the YouTubeIframe fallback (useHotSwap handles the cross-fade when
    // the lane catches up). Watcher lifecycle lives in useHotSwap; no refs
    // to manage here.
    trackSwapInProgressRef.current = true;
    // Per-effect token. On rapid skips (A→B→C in <200ms) two IIFEs were
    // running concurrently: effect-B's closure would still write el.src=B
    // and log play_start for B after effect-C had already moved on. The
    // token lets the stale closure detect it's been superseded and bail
    // before any mutation. trackId check alone isn't enough because it
    // could equal current if the user skipped back quickly.
    const changeToken = ++trackChangeTokenRef.current;
    const isStale = () => trackChangeTokenRef.current !== changeToken;

    // Fast path: if the shared r2KnownStore already proves R2 has this
    // track (from a prior probe, gateToR2 hit, or hotswap success), skip
    // the HEAD round-trip entirely and go straight to R2. If we don't
    // know, go iframe-first — no HEAD gate. useHotSwap's 2s poll will
    // discover R2 and crossfade if the track is actually cached.
    //
    // Pre-v395 this path did `await Promise.all([headPromise, fadePromise])`
    // which made iframe playback wait on the HEAD (100-500ms typical,
    // 1500ms worst case) for every not-yet-known track. The perceptible
    // tap-to-audio delay is gone in v395: we only wait on the outgoing
    // fade (240ms short / 600ms long), which is natural transition time.
    const knownInR2Sync = useR2KnownStore.getState().has(currentTrack.trackId);

    (async () => {
      const fadePromise = shouldFade
        ? new Promise<void>(r => setTimeout(r, fadeOutMs))
        : Promise.resolve();
      await fadePromise;
      if (isStale()) return;
      // If outgoing was iframe, silence it hard now — the bridge ramp
      // reached 0 by this point; pause+mute ensures it doesn't resume
      // accidentally while the new R2/iframe track takes over.
      if (wasIframe) {
        iframeBridge.pause();
        iframeBridge.resetVolume();
      }
      if (knownInR2Sync && el) {
        // R2 is keyed by raw YouTube ID; trackId may be a VOYO ID (vyo_<b64>).
        el.src = `${R2_AUDIO}/${getYouTubeId(currentTrack.trackId)}?q=high`;
        // Transient 'pause' fires on src reassign; handlePause sees the
        // flag and skips the setIsPlaying(false). The flag clears in
        // handleCanPlay once the new track has data ready. If play() is
        // blocked (autoplay policy hiccup in BG, iOS Safari lock, etc.)
        // we escalate the retry ladder rather than silently failing —
        // the previous single-retry wasn't enough for some BG transitions.
        const tryPlay = async () => {
          const delays = [0, 120, 500, 1500];
          for (const d of delays) {
            if (d > 0) await new Promise(r => setTimeout(r, d));
            if (isStale()) return;
            const e = audioRef.current;
            if (!e || e.src === '' || !e.paused) return; // already playing or torn down
            try { await e.play(); return; } catch { /* retry */ }
          }
          logPlaybackEvent({
            event_type: 'trace', track_id: currentTrack.trackId,
            meta: { subtype: 'play_retry_exhausted', hidden: document.hidden },
          });
        };
        void tryPlay();
        setSource('r2');
        // Defer the play_start log — on rapid skip (A→B→C within a few
        // hundred ms) the user never actually hears B, so logging
        // play_start for it inflates session analytics. 300ms captures
        // "user committed to this track" without delaying real events
        // long enough to matter.
        setTimeout(() => {
          if (isStale()) return;
          logPlaybackEvent({
            event_type: 'play_start',
            track_id: currentTrack.trackId,
            source: 'r2',
          });
        }, 300);
      } else {
        // Blank the audio element so the iframe is the sole audio source.
        // intentionalPause flag prevents handlePause from flipping isPlaying.
        if (el) {
          voyoStream.intentionalPause = true;
          try { el.pause(); } catch {}
          el.removeAttribute('src');
        }
        setSource('iframe');
        // Iframe branch owns playback from here on — the audio element is
        // intentionally silent (no src) and will NEVER fire canplay, so the
        // trackSwap guard can't rely on handleCanPlay to clear it. Left set,
        // the flag would permanently disable the BG auto-advance watchdog
        // (AudioPlayer.tsx:512) and swallow every handlePause call for the
        // lifetime of the iframe-sourced track. handlePause's separate
        // playbackSource==='iframe' guard (line 461) still absorbs the
        // expected audio-element pauses, so clearing here is safe.
        trackSwapInProgressRef.current = false;
        setTimeout(() => {
          if (isStale()) return;
          logPlaybackEvent({
            event_type: 'play_start',
            track_id: currentTrack.trackId,
            source: 'iframe',
          });
        }, 300);
        // Queue the track so lanes extract to R2 → useHotSwap watchers fire
        // the cross-fade as soon as it lands.
        void ensureTrackReady(currentTrack, null, { priority: 10 });
        // Background HEAD probe — warms r2KnownStore even though we're on
        // the iframe path. If the track turns out to be cached already
        // (race case: the store didn't know yet), useHotSwap's poll will
        // catch the positive HEAD and fire the cross-fade on its own.
        void r2HasTrack(currentTrack.trackId);
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

  // ── AudioContext power gate ──────────────────────────────────────────
  // When paused for a while, suspend the Web Audio graph so it stops
  // running the scheduler / tick loop on the audio thread. Resume on
  // next play (canplay's fadeInMasterGain already calls ctx.resume()).
  // Saves measurable battery on mobile during long pauses.
  useEffect(() => {
    if (isPlaying) return;
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'running') return;
    const t = setTimeout(() => {
      const ctxNow = audioContextRef.current;
      if (ctxNow && ctxNow.state === 'running' && !usePlayerStore.getState().isPlaying) {
        ctxNow.suspend().catch(() => {});
      }
    }, 30_000);
    return () => clearTimeout(t);
  }, [isPlaying, audioContextRef]);

  // ── Background recovery ───────────────────────────────────────────────
  // When the user returns from a BG state where audio was playing but
  // got paused mid-track (iOS audio-session yank during a phone call,
  // aggressive Chrome Android battery throttling, Samsung DeX context
  // switch), retry play() so they don't come back to dead silence.
  // Prior gate on voyoStream.streamUrl was always null post-VPS-rip,
  // so this effect silently did nothing for months.
  useEffect(() => {
    let wentHiddenAt: number | null = null;

    const handleVisibility = () => {
      if (document.hidden) {
        wentHiddenAt = Date.now();
        return;
      }
      const el = audioRef.current;
      if (!el) return;
      const store = usePlayerStore.getState();
      // Previous guard: `if (!store.isPlaying) return;`. That blocked the
      // exact recovery case this effect was written for. In deep BG,
      // Chrome Android (and iOS sometimes) pauses the <audio> element
      // under us when autoplay permissions reset. The subsequent 'pause'
      // event lands in handlePause whose play()-retry rejects in BG and
      // flips isPlaying to false as a fallback. When the user returns to
      // FG, isPlaying is false, so the old guard bailed — audio stays
      // silent, user has to manually tap play. That's the "I still have
      // to open the app" symptom.
      //
      // New condition: act whenever there IS a currentTrack, regardless
      // of the flag. If play() succeeds, we reflect reality by setting
      // isPlaying=true. If it rejects (genuinely needs a user gesture),
      // we leave the flag alone so the UI still shows paused. Either way
      // the element has a real shot at resuming instead of being locked
      // out by a stale boolean.
      if (!store.currentTrack) return;
      if (!el.paused && el.readyState >= 2) return; // already playing cleanly
      const bgDurationMs = wentHiddenAt ? Date.now() - wentHiddenAt : null;
      const trackId = store.currentTrack.trackId ?? 'unknown';
      devLog('[AudioPlayer] back from BG — audio paused, attempting resume');
      logPlaybackEvent({
        event_type: 'bg_disconnect',
        track_id: trackId,
        meta: {
          bg_duration_ms: bgDurationMs,
          ready_state: el.readyState,
          paused: el.paused,
          ended: el.ended,
          store_is_playing: store.isPlaying,
        },
      });
      el.play().then(() => {
        if (!usePlayerStore.getState().isPlaying) {
          usePlayerStore.getState().setIsPlaying(true);
        }
      }).catch(() => {
        // Autoplay policy genuinely requires a gesture — leave UI paused.
      });
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
    // New track has data ready → track-change is fully committed. Clear
    // the guard so subsequent user-initiated pauses actually pause.
    trackSwapInProgressRef.current = false;
    const el = audioRef.current;
    if (el && usePlayerStore.getState().isPlaying) {
      el.play().catch(() => {});
    }
    // Recovered — cancel any pending stall-log.
    if (stallLogTimerRef.current) {
      clearTimeout(stallLogTimerRef.current);
      stallLogTimerRef.current = null;
    }
    if (!document.hidden) {
      const trackId = usePlayerStore.getState().currentTrack?.trackId;
      if (trackId) {
        logPlaybackEvent({
          event_type: 'bg_reconnect',
          track_id: trackId,
          meta: { ready_state: el?.readyState },
        });
      }
    }
  }, [boostProfile, setupAudioEnhancement, fadeInMasterGain]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, [setIsPlaying]);

  // onPlaying catches buffer-stall auto-resumes — browser fires 'playing' not 'play'
  const handlePlaying = useCallback(() => {
    setIsPlaying(true);
    // Audio recovered — cancel any pending stall-log.
    if (stallLogTimerRef.current) {
      clearTimeout(stallLogTimerRef.current);
      stallLogTimerRef.current = null;
    }
  }, [setIsPlaying]);

  const handlePause = useCallback(() => {
    // Mid-track-change: browser fires 'pause' on the audio element when
    // we reassign el.src. This is transient — the new track's play() is
    // about to fire. Don't flip isPlaying=false or BG auto-advance will
    // leave the app "paused" until the user opens it and resumes.
    if (trackSwapInProgressRef.current) {
      return;
    }
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
    // Involuntary pause on R2 — typically a brief buffer underrun in the
    // first seconds after a skip (R2 first chunk hasn't arrived by the
    // time the element starts playback). Prior guard was `sessionId &&
    // streamUrl`, both always null in the R2-first flow → recovery never
    // ran → any hiccup froze the UI ("music restarts briefly then pauses"
    // on skip). If the store still says we should be playing, ask the
    // element to resume; on rejection fall back to honouring the pause.
    if (usePlayerStore.getState().isPlaying) {
      const el = audioRef.current;
      if (el) {
        el.play().catch(() => setIsPlaying(false));
        return;
      }
    }
    setIsPlaying(false);
  }, [setIsPlaying]);

  const handleTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;

    // Freeze the store/UI tick when the tab is hidden. MediaSession
    // position still updates below (lock-screen UI needs it), and the
    // completion signal still fires — but Zustand setState at 4Hz on
    // an invisible UI is pure battery cost with zero benefit. Tick
    // resumes naturally on the next visible timeupdate event.
    if (document.hidden) {
      // Still check for the 80% completion signal — it's the taste
      // graph's strongest input and must not miss a BG listen-through.
      if (!completionSignaledRef.current) {
        const dur = isFinite(el.duration) ? el.duration : 0;
        if (dur > 0 && el.currentTime / dur >= 0.8) {
          completionSignaledRef.current = true;
          oyaPlanSignal('completion');
        }
      }
      // BG auto-advance watchdog MOVED out of here to a standalone
      // setInterval below — timeupdate events halt once <audio> enters
      // ended+paused, which is the exact state the watchdog was built
      // to catch.
      return;
    }

    const position = el.currentTime;
    const dur = isFinite(el.duration) ? el.duration : 0;

    if (dur > 0 && position >= dur) return;

    const progress = dur > 0 ? position / dur : 0;

    if (progress >= 0.8 && !completionSignaledRef.current) {
      completionSignaledRef.current = true;
      oyaPlanSignal('completion');
    }

    // ── Predictive pre-warm ──────────────────────────────────────────────
    // At 50% of the current track, fire ensureTrackReady on what's coming
    // next at priority=7 (below user-click p=10, above background p=0). The
    // VPS lane can then extract the next track in parallel with the current
    // track's second half — when A ends, B's R2 file is already warm and
    // the hot-swap lands instantly instead of iframe-bridging 3-12s of
    // extraction lag. Fires exactly once per track (prewarmFiredForRef).
    // Canonical "warm it up and slide it in" loop: predict → warm → arrive.
    const curTrack = usePlayerStore.getState().currentTrack;
    const curTrackId = curTrack?.trackId ?? null;
    if (
      progress >= 0.5 &&
      curTrackId &&
      prewarmFiredForRef.current !== curTrackId
    ) {
      prewarmFiredForRef.current = curTrackId;
      const store = usePlayerStore.getState();
      const upcoming = store.queue[0]?.track ?? store.predictUpcoming(1)[0] ?? null;
      if (upcoming && upcoming.trackId && upcoming.trackId !== curTrackId) {
        void ensureTrackReady(upcoming, null, { priority: 7 });
        logPlaybackEvent({
          event_type: 'trace',
          track_id: upcoming.trackId,
          meta: {
            subtype: 'predictive_prewarm',
            from_track: curTrackId,
            progress_at_fire: progress,
            source: store.queue.length > 0 ? 'queue' : 'predict',
          },
        });
      }
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

  // ── BG auto-advance watchdog — setInterval, not timeupdate ───────────
  // The previous watchdog lived inside handleTimeUpdate. Problem:
  // `timeupdate` events stop firing once <audio> reaches ended+paused —
  // the exact state we were watching for. On Chrome Android Power Save
  // (Pixel 7) this manifests as "app stops after one song". setInterval
  // keeps firing in BG (throttled to ~1/sec min, but never halted), so
  // its cadence is independent of the audio element's event stream.
  //
  // Fires nextTrack() when the element is genuinely finished (ended=true
  // OR paused-at-duration-end) and the store still thinks we're playing.
  // Skips when a track swap is in flight (swap owns advance) and when
  // playbackSource='iframe' (iframe's own ENDED handler owns advance).
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = audioRef.current;
      if (!el) return;
      if (trackSwapInProgressRef.current) return;
      const store = usePlayerStore.getState();
      if (!store.isPlaying) return;
      if (store.playbackSource === 'iframe') return;
      const dur = isFinite(el.duration) ? el.duration : 0;
      const nearEnd = dur > 0 && el.currentTime >= dur - 0.3;
      const finished = el.ended || (el.paused && nearEnd);
      if (!finished) return;
      logPlaybackEvent({
        event_type: 'skip_auto',
        track_id: store.currentTrack?.trackId ?? 'unknown',
        meta: {
          reason: 'bg_auto_advance_watchdog_v2',
          ended: el.ended,
          paused: el.paused,
          current_time: el.currentTime,
          duration: dur,
          hidden: document.hidden,
        },
      });
      store.nextTrack();
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const handleEnded = useCallback(() => {
    // R2-direct playback — the audio element gets a discrete R2 file per
    // track, so 'ended' means track-over, advance the queue locally.
    //
    // The browser fires 'pause' right after 'ended'. Flip the swap flag
    // NOW — before nextTrack() runs its state update + before the 'pause'
    // handler gets a chance to see a stale false. Otherwise handlePause
    // would see store.isPlaying=true (just set by nextTrack) and retry
    // play() on the just-ended element, briefly restarting the finished
    // track before the new track's effect overwrites el.src.
    trackSwapInProgressRef.current = true;
    const trackId = usePlayerStore.getState().currentTrack?.trackId ?? 'unknown';
    logPlaybackEvent({
      event_type: 'stream_ended',
      track_id: trackId,
      meta: { source: usePlayerStore.getState().playbackSource, advance: 'local_next' },
    });
    usePlayerStore.getState().nextTrack();
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

    // OS lock-screen / notification-shade controls. voyoStream.pause/resume
    // are no-op stubs in the R2-first flow — routing through the store +
    // audio element is what actually controls playback. Set
    // intentionalPause on the pause path so handlePause honours it instead
    // of treating the resulting 'pause' event as a buffer underrun.
    navigator.mediaSession.setActionHandler('play', () => {
      usePlayerStore.getState().setIsPlaying(true);
      audioRef.current?.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      voyoStream.intentionalPause = true;
      usePlayerStore.getState().setIsPlaying(false);
      audioRef.current?.pause();
    });
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
        // Skip-on-stall path removed — the only audio sources now are 'r2'
        // (discrete files, browser recovers on its own) and 'iframe' (the
        // <audio> element is silent anyway, iframe owns playback). The
        // VPS live-stream case the timer was built for no longer exists.
      }}
      onStalled={() => {
        const el = audioRef.current;
        logPlaybackEvent({
          event_type: 'stream_stall',
          track_id: usePlayerStore.getState().currentTrack?.trackId ?? 'unknown',
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
        const trackId = usePlayerStore.getState().currentTrack?.trackId ?? 'unknown';
        devWarn('[AudioPlayer] stream error', { code, msg, burst: burstCount });
        logPlaybackEvent({
          event_type: 'stream_error',
          track_id: trackId,
          meta: {
            media_error_code: code,
            media_error_msg: msg,
            ready_state: el?.readyState,
            network_state: el?.networkState,
            burst_count: burstCount,
          },
        });

        // Circuit breaker — three audio-element errors on the current track
        // in 10s → track is toast. Advance so the user doesn't sit on silence.
        if (burstCount >= ERROR_BURST_LIMIT) {
          errorBurst = [];
          devWarn('[AudioPlayer] error-burst on current track — advancing');
          logPlaybackEvent({
            event_type: 'skip_auto',
            track_id: trackId,
            meta: { reason: 'error_burst_skip', burst_count: burstCount },
          });
          usePlayerStore.getState().nextTrack();
        }
      }}
      preload="none"
      crossOrigin="anonymous"
    />
  );
};
