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
import { voyoStream, ensureTrackReady } from '../services/voyoStream';
import { iframeBridge } from '../services/iframeBridge';
import { supabase } from '../lib/supabase';
import { oyo } from '../services/oyo';
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
const STALL_SKIP_THRESHOLD_MS = 4_000;
// Hot-swap iframe→R2: poll R2 HEAD this often while iframe is the source so
// we can bridge the moment the lane lands the opus in R2 mid-play.
const HOT_SWAP_POLL_MS    = 5_000;
// Total cross-fade duration when performing the iframe→R2 swap. Matches the
// existing track-change fade feel so it reads as "DJ transition" not "glitch".
const HOT_SWAP_FADE_MS    = 450;

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const completionSignaledRef = useRef(false);
  // Stall-skip guard — if the stream sits in 'waiting' state longer than
  // STALL_SKIP_THRESHOLD_MS, we trigger nextTrack() so the groove keeps moving.
  // Cleared on any 'playing' event.
  const stallSkipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hot-swap watchers — detect the moment R2 is ready for the current track
  // so we can cross-fade mid-play. Two mechanisms run in parallel:
  //   • realtime: Supabase channel on voyo_upload_queue status changes (~instant)
  //   • polling:  HEAD R2 every 5s (safety net if realtime drops)
  const hotSwapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hotSwapChannelRef = useRef<any>(null);
  // Last-known iframe currentTime — captured on each tick so that if the
  // iframe cuts (mobile background, YT glitch) we can resume the audio
  // element at the right position without needing the dead iframe.
  const lastIframePosRef = useRef<{ trackId: string; seconds: number } | null>(null);

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
      if (hotSwapPollRef.current) { clearInterval(hotSwapPollRef.current); hotSwapPollRef.current = null; }
      if (hotSwapChannelRef.current && supabase) {
        supabase.removeChannel(hotSwapChannelRef.current);
        hotSwapChannelRef.current = null;
      }
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

    // R2-first playback. HEAD R2 for the track:
    //   • hit  → audio element plays direct from R2 (Cloudflare CDN, zero VPS).
    //            YouTubeIframe stays muted (playbackSource='r2').
    //   • miss → unmute YouTubeIframe as fallback audio source
    //            (playbackSource='iframe') + bump queue priority=10 so the
    //            egyptian lanes extract it ASAP for next time.
    //
    // No more VPS voyo-stream session — the FFmpeg live pipe is the source of
    // every "File ended prematurely" stall. Cached tracks play clean; cold
    // tracks fall back to YouTube's own player until R2 is filled.
    // Always clear any running hot-swap watcher — a fresh track change starts
    // its own monitoring if the iframe branch is taken below.
    if (hotSwapPollRef.current) {
      clearInterval(hotSwapPollRef.current);
      hotSwapPollRef.current = null;
    }
    if (hotSwapChannelRef.current && supabase) {
      supabase.removeChannel(hotSwapChannelRef.current);
      hotSwapChannelRef.current = null;
    }

    (async () => {
      const cached = await r2HasTrack(currentTrack.trackId);
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
        // Set intentionalPause BEFORE pausing — handlePause treats it as a
        // clean teardown and doesn't flip isPlaying to false.
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
        // Fire-and-forget: queue this track for the lanes to extract to R2.
        void ensureTrackReady(currentTrack, null, { priority: 10 });

        // Hot-swap watcher — two mechanisms feeding the same trigger:
        //   1. Realtime: subscribe to voyo_upload_queue UPDATE for this track
        //      and fire the swap when status flips to 'done' (~instant).
        //   2. Polling: HEAD R2 every HOT_SWAP_POLL_MS as a safety net in case
        //      the websocket drops or never connects.
        // Whichever fires first wins — both clear the other.
        const trackId = currentTrack.trackId;
        const trigger = (reason: string) => {
          if (usePlayerStore.getState().currentTrack?.trackId !== trackId) return;
          if (hotSwapPollRef.current) { clearInterval(hotSwapPollRef.current); hotSwapPollRef.current = null; }
          if (hotSwapChannelRef.current && supabase) {
            supabase.removeChannel(hotSwapChannelRef.current);
            hotSwapChannelRef.current = null;
          }
          devLog(`[AudioPlayer] hot-swap trigger (${reason}): ${trackId}`);
          void hotSwapToR2(trackId);
        };

        if (supabase) {
          hotSwapChannelRef.current = supabase
            .channel(`hotswap:${trackId}`)
            .on('postgres_changes', {
              event: 'UPDATE', schema: 'public', table: 'voyo_upload_queue',
              filter: `youtube_id=eq.${trackId}`,
            }, (payload: { new?: { status?: string } }) => {
              logPlaybackEvent({
                event_type: 'trace', track_id: trackId,
                meta: { subtype: 'hotswap_rt_event', new_status: payload.new?.status },
              });
              if (payload.new?.status === 'done') trigger('realtime');
            })
            .subscribe((status: string) => {
              logPlaybackEvent({
                event_type: 'trace', track_id: trackId,
                meta: { subtype: 'hotswap_rt_subscribe', status },
              });
            });
        } else {
          logPlaybackEvent({
            event_type: 'trace', track_id: trackId,
            meta: { subtype: 'hotswap_rt_skip', reason: 'no_supabase_client' },
          });
        }

        let pollTicks = 0;
        hotSwapPollRef.current = setInterval(async () => {
          if (usePlayerStore.getState().currentTrack?.trackId !== trackId) {
            if (hotSwapPollRef.current) clearInterval(hotSwapPollRef.current);
            hotSwapPollRef.current = null;
            return;
          }
          pollTicks++;
          const has = await r2HasTrack(trackId);
          // Trace only every 4th tick to limit telemetry volume, plus any hit.
          if (has || pollTicks % 4 === 0) {
            logPlaybackEvent({
              event_type: 'trace', track_id: trackId,
              meta: { subtype: 'hotswap_poll_tick', ticks: pollTicks, r2_hit: has },
            });
          }
          if (has) trigger('poll');
        }, HOT_SWAP_POLL_MS);
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

  /**
   * Hot-swap iframe → R2 at the current playback timestamp.
   *
   * Reads iframe.currentTime, loads R2 into the audio element, seeks to that
   * position, waits for canplay, then runs a HOT_SWAP_FADE_MS cross-fade: iframe
   * volume 100→0 while audio element volume 0→target. Finally pauses iframe and
   * flips playbackSource='r2' so the YouTubeIframe re-mutes and stays synced
   * for video only. Exit music fades out, R2 music fades in — same timestamp.
   */
  const hotSwapToR2 = useCallback(async (trackId: string) => {
    const el = audioRef.current;
    if (!el) return;
    const storeVol = usePlayerStore.getState().volume;

    // Position priority:
    //   1. Live iframe currentTime (normal hot-swap while playing)
    //   2. Last-known iframe tick snapshot (iframe was cut by background/OS)
    //   3. 0 (cold restart — acceptable graceful degradation)
    let t = iframeBridge.getCurrentTime();
    let posSource: 'live' | 'snapshot' | 'cold' = 'live';
    if (t == null || !isFinite(t)) {
      const snap = lastIframePosRef.current;
      if (snap && snap.trackId === trackId && snap.seconds > 0) {
        t = snap.seconds;
        posSource = 'snapshot';
      }
    }
    if (t == null || !isFinite(t)) {
      // Cold restart from 0 — iframe never had a chance to report position.
      el.src = `${R2_AUDIO}/${trackId}?q=high`;
      el.volume = storeVol;
      el.play().catch(() => {});
      usePlayerStore.getState().setPlaybackSource('r2');
      iframeBridge.pause();
      iframeBridge.resetVolume();
      logPlaybackEvent({ event_type: 'trace', track_id: trackId, meta: { subtype: 'hotswap', mode: 'cold' } });
      return;
    }

    // Preload R2 muted at the iframe position.
    el.src = `${R2_AUDIO}/${trackId}?q=high`;
    try { el.currentTime = t; } catch {}
    el.volume = 0;
    await new Promise<void>((resolve) => {
      const onReady = () => { el.removeEventListener('canplay', onReady); resolve(); };
      el.addEventListener('canplay', onReady);
      // Safety: if canplay doesn't fire in 2.5s, proceed anyway.
      setTimeout(() => { el.removeEventListener('canplay', onReady); resolve(); }, 2500);
    });
    try { el.currentTime = t; } catch {}
    await el.play().catch(() => {});

    // Cross-fade over HOT_SWAP_FADE_MS: iframe volume 100→0, audio volume 0→storeVol.
    const steps = 15;
    const stepMs = Math.max(1, Math.round(HOT_SWAP_FADE_MS / steps));
    const iframeFade = iframeBridge.fadeOut(HOT_SWAP_FADE_MS);
    for (let i = 1; i <= steps; i++) {
      el.volume = Math.min(storeVol, storeVol * (i / steps));
      await new Promise((r) => setTimeout(r, stepMs));
    }
    await iframeFade;

    // Complete the hand-off.
    iframeBridge.pause();
    iframeBridge.resetVolume();
    el.volume = storeVol;
    usePlayerStore.getState().setPlaybackSource('r2');

    logPlaybackEvent({
      event_type: 'trace',
      track_id: trackId,
      meta: { subtype: 'hotswap', mode: posSource === 'snapshot' ? 'resume_snapshot' : 'faded', at_seconds: Math.round(t) },
    });
  }, []);

  /**
   * Background / iframe-cut handling.
   *
   * YouTube iframe audio cuts when the tab goes background on mobile (iOS
   * Safari is strictest, Android Chrome partial). The R2 <audio> element
   * keeps playing in background cleanly — so the strategy is:
   *
   *   1. While iframe is our source, snapshot its currentTime once a second.
   *      This gives hotSwapToR2 a "last known" position even if iframe dies.
   *   2. When iframe reports PAUSED while store.isPlaying is still true, we
   *      treat it as an involuntary cut. The realtime + poll watchers already
   *      running will swap to R2 as soon as the lane finishes.
   *   3. On foregrounding, if we're in iframe mode and R2 still isn't ready
   *      after a short grace (2s), skip forward + requeue the current track
   *      at priority=10 so it's cached by the time the user scrolls back.
   */
  useEffect(() => {
    if (playbackSource !== 'iframe' || !currentTrack) return;

    // Snapshot tick — record iframe currentTime while it's actively playing
    // so hot-swap has a resume point even if iframe gets cut.
    const snap = setInterval(() => {
      const t = iframeBridge.getCurrentTime();
      if (t != null && isFinite(t) && t > 0) {
        lastIframePosRef.current = { trackId: currentTrack.trackId, seconds: t };
      }
    }, 1000);

    // NB: we used to foreground-timeout-skip after 2s if R2 wasn't ready.
    // That was brutal — any tab switch or app resume during the 90–180s
    // extraction window yanked the user off their track. The snapshot
    // ticker above + the realtime/poll watchers already cover the background
    // cut case: when iframe dies on mobile and R2 later lands, hotSwapToR2
    // resumes at the saved position. No skip needed.

    return () => {
      clearInterval(snap);
    };
  }, [playbackSource, currentTrack?.trackId]);

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
    navigator.mediaSession.setActionHandler('nexttrack', () => { voyoStream.skip(); });

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
        logPlaybackEvent({
          event_type: 'stream_stall',
          track_id: curTrack,
          meta: {
            sub: 'waiting',
            source: store.playbackSource,
            ready_state: el?.readyState,
            network_state: el?.networkState,
          },
        });
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
