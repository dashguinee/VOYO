/**
 * BG Engine — the single module that owns VOYO's background-playback strategy.
 *
 * Before this module: BG-specific code was smeared across AudioPlayer.tsx
 * (3800+ lines) — visibility handlers, heartbeats, silent WAV generation,
 * context resumption, gain rescues, synthetic-ended detectors, stuck
 * playback detectors. Every new BG quirk needed a new inline patch.
 *
 * After: one module. Every `document.hidden` branch lives here. All BG
 * failure modes we've learned about are detected + mitigated from a single
 * heartbeat loop. The audio element never becomes idle on our watch — OS
 * pauses are detected and re-kicked, context suspensions are resumed, gain
 * stuck-at-zero is rescued.
 *
 * THE INVARIANT we enforce: while the user wants audio (store.isPlaying
 * === true), SOMETHING is always playing through the audio element — a
 * real track, or the silent WAV keeper. Never idle. This is why the OS
 * never revokes our audio focus.
 *
 * What lives here:
 *   - Silent WAV blob generation (2-second near-inaudible 8kHz mono WAV)
 *   - Visibility handler (capture phase): marks transition, suspends ctx
 *     when paused+hidden for battery
 *   - Battery-suspend timer: delays ctx.suspend() 5s after paused+hidden
 *   - Heartbeat: MC-based 4s loop that fires in BG (setTimeout is throttled
 *     to 1/min; MessageChannel is not)
 *   - Heartbeat detectors, in order:
 *       * ctx resume (suspended or interrupted? resume now)
 *       * gain rescue (gain < 0.01 while playing? force to target)
 *       * silent-paused kick (element paused but should be playing? play)
 *       * synthetic-ended (near duration + paused + hidden? advance)
 *       * stuck-playback (currentTime frozen 2 ticks? advance)
 *       * baseline pulse (every 2 ticks, emit heartbeat_tick trace)
 *
 * What we expose to AudioPlayer:
 *   - silentKeeperUrlRef: the blob URL, used by loadTrack and runEndedAdvance
 *     to engage the bridge at their own sync points
 *   - isTransitioningToBackgroundRef: synchronous flag for onPause guard
 *   - engageSilentWav(reason, trackId?): single helper to set loop=true +
 *     src=silentWAV + play(), used by all the places that used to inline it
 *
 * What we DON'T own:
 *   - Source resolution (IDB/R2/VPS/edge) — that's sourceResolver (future phase)
 *   - MediaSession registration — AudioPlayer for now (future phase)
 *   - The proactive-advance trigger at duration - 0.5s — AudioPlayer's
 *     handleTimeUpdate (it's on the hot path, stays there)
 */

import { useEffect, useRef, RefObject } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { trace, logPlaybackEvent } from '../../services/telemetry';
import { getBatteryState } from '../../services/battery';
import { devLog, devWarn } from '../../utils/logger';
import { playbackState } from '../playback/playbackState';
import { teardownAudioChain, subscribeAudioCtxState } from '../../services/audioEngine';

interface UseBgEngineParams {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioContextRef: RefObject<AudioContext | null>;
  gainNodeRef: RefObject<GainNode | null>;
  isLoadingTrackRef: RefObject<boolean>;
  isPlaying: boolean;
  playbackSource: string | null;
  computeMasterTarget: () => number;
  // Called after every ctx.resume() to re-anchor the gain ramp. Gain ramps
  // scheduled before a suspend "freeze" and snap incorrectly on resume —
  // applyMasterGain cancels any frozen schedule and starts a fresh 25ms ramp.
  applyMasterGain: () => void;
  // Pre-zeros gain (8ms ramp to 0.0001) before BG src reassignment so the
  // audio stream cuts at silence, not at a non-zero amplitude → no click.
  muteMasterGainInstantly: () => void;
  // Invoked for synthetic/stuck/proactive forced advances. Caller must
  // set its own bypass ref before this fires if it wants runEndedAdvance
  // to skip the audio.ended check.
  runEndedAdvanceRef: RefObject<() => void>;
  // Write-access so bgEngine can force an advance despite audio.ended=false.
  syntheticEndedBypassRef: RefObject<boolean>;
  // Used by the stuck detector to dedup per-track advances.
  lastEndedTrackIdRef: RefObject<string | null>;
}

export interface BgEngineApi {
  silentKeeperUrlRef: RefObject<string | null>;
  isTransitioningToBackgroundRef: RefObject<boolean>;
  /**
   * Engage the silent WAV bridge: loop=true + src=silentWAV + play().
   * Used from loadTrack's BG branch, runEndedAdvance's pre-advance, and
   * MediaSession's nexttrack handler. Single source of truth for "keep
   * the element alive during a src transition."
   */
  engageSilentWav: (reason: string, trackId?: string | null) => void;
}

export function useBgEngine(params: UseBgEngineParams): BgEngineApi {
  const {
    audioRef,
    audioContextRef,
    gainNodeRef,
    isLoadingTrackRef,
    isPlaying,
    playbackSource,
    computeMasterTarget,
    applyMasterGain,
    muteMasterGainInstantly,
    runEndedAdvanceRef,
    syntheticEndedBypassRef,
    lastEndedTrackIdRef,
  } = params;
  // Prevent lint "declared but unused" when downstream callers evolve.
  void muteMasterGainInstantly;

  // ── SILENT WAV KEEPER ────────────────────────────────────────────────
  // 2-second silent WAV blob URL. Set on mount, revoked on unmount.
  // 8kHz 8-bit mono = ~16KB — cheap to hold in memory.
  const silentKeeperUrlRef = useRef<string | null>(null);
  // Bypass keeper: a second <audio> element NOT connected to the Web Audio
  // chain. It plays silentWav directly to the OS at near-zero volume.
  // Purpose: maintain OS audio-focus regardless of AudioContext state.
  // When the AudioContext suspends during a BG track transition, the main
  // element's audio output drops to zero and Chrome may revoke the tab's
  // "audible" exemption from intensive throttling — killing the heartbeat MC
  // and all timer-based recovery. The bypass keeper is always playing (while
  // isPlaying=true) and is invisible to the AudioContext, so suspension of
  // the Web Audio chain has no effect on it. Chrome sees continuous audio
  // activity from the tab and keeps throttling exemptions active.
  const bypassKeeperRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const sampleRate = 8000;
    const durationSec = 2;
    const numSamples = sampleRate * durationSec;
    const bufSize = 44 + numSamples;
    const ab = new ArrayBuffer(bufSize);
    const dv = new DataView(ab);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    dv.setUint32(4, bufSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate, true);
    dv.setUint16(32, 1, true);
    dv.setUint16(34, 8, true);
    writeStr(36, 'data');
    dv.setUint32(40, numSamples, true);
    // 8-bit unsigned PCM uses 128 as silent midpoint.
    for (let i = 0; i < numSamples; i++) dv.setUint8(44 + i, 128);
    const blob = new Blob([ab], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    silentKeeperUrlRef.current = url;

    // Bypass keeper: raw <audio>, no Web Audio connection, volume near-zero.
    const keeper = document.createElement('audio');
    keeper.loop = true;
    keeper.volume = 0.001;
    keeper.src = url;
    bypassKeeperRef.current = keeper;

    return () => {
      keeper.pause();
      keeper.src = '';
      bypassKeeperRef.current = null;
      URL.revokeObjectURL(url);
      silentKeeperUrlRef.current = null;
    };
  }, []);

  // Start/stop the bypass keeper with isPlaying. First play() must happen
  // inside a user-gesture context — since isPlaying only becomes true after
  // the user taps play, this useEffect fires within that gesture window.
  useEffect(() => {
    const keeper = bypassKeeperRef.current;
    if (!keeper) return;
    if (isPlaying) {
      keeper.play().catch(() => {
        // NotAllowedError if gesture context expired — non-critical, main
        // element's engageSilentWav path still maintains the audio session.
      });
    } else {
      keeper.pause();
    }
  }, [isPlaying]);

  // ── ENGAGE SILENT WAV (one helper used everywhere) ───────────────────
  const engageSilentWav = (reason: string, trackId?: string | null) => {
    const el = audioRef.current;
    const url = silentKeeperUrlRef.current;
    if (!el || !url) return;
    try {
      el.loop = true;
      el.src = url;
      el.play().catch(() => {});
      // Also ensure the bypass keeper is running — belt-and-suspenders.
      bypassKeeperRef.current?.play().catch(() => {});
      trace('silent_wav_engage', trackId || null, { why: reason });
      playbackState.transition('bridge', trackId ?? null, `silent_wav_${reason}`);
    } catch {}
  };

  // ── VISIBILITY HANDLER ───────────────────────────────────────────────
  // Capture-phase listener so this fires BEFORE other visibilitychange
  // handlers + BEFORE the `pause` event that some mobile browsers emit
  // during the hide transition. Without the capture phase, onPause could
  // clobber the store's isPlaying to false during the transition window.
  const isTransitioningToBackgroundRef = useRef<boolean>(false);
  useEffect(() => {
    const handleVisibility = () => {
      trace('visibility', usePlayerStore.getState().currentTrack?.trackId, {
        state: document.visibilityState,
        isPlaying: usePlayerStore.getState().isPlaying,
        ctxState: audioContextRef.current?.state,
        gain: gainNodeRef.current?.gain.value,
        elPaused: audioRef.current?.paused,
        elCurrentTime: audioRef.current?.currentTime,
      });

      if (document.visibilityState === 'hidden') {
        // Set BEFORE the browser fires any pause — protects onPause.
        isTransitioningToBackgroundRef.current = true;
        const { isPlaying: shouldPlay } = usePlayerStore.getState();

        // BATTERY: suspend context ONLY when paused + hidden (saves power).
        // Never suspend when playing — audio must continue.
        if (!shouldPlay && audioContextRef.current?.state === 'running') {
          audioContextRef.current.suspend().catch(() => {});
          devLog('🔋 [BG] AudioContext suspended (paused + hidden)');
        }
        return;
      }

      // Returning from BG. Clear the flag + re-kick if needed.
      isTransitioningToBackgroundRef.current = false;

      // Always resume AudioContext on FG return — even if a load is in
      // flight. A suspended/interrupted context during load means the
      // canplay gain ramp fires against a frozen clock. The element kick
      // (play()) is still guarded below so it doesn't race canplay.
      const ctx = audioContextRef.current;

      if (ctx && ctx.state === 'closed') {
        // Long-BG AudioContext death: iOS/Safari can fully close the context
        // after extended backgrounding. teardownAudioChain releases the dead
        // node references so the useAudioChain hook re-wires on next render.
        devWarn('[BG] AudioContext closed on FG return — tearing down chain for re-wire');
        const tid = usePlayerStore.getState().currentTrack?.trackId;
        trace('ctx_closed_teardown', tid, { hidden: document.hidden });
        // Typed event_type so dashboards can query disconnect rate directly
        // instead of digging through the trace meta.
        logPlaybackEvent({ event_type: 'bg_disconnect', track_id: tid || '-', meta: { reason: 'ctx_closed' } });
        try { teardownAudioChain(); } catch {}
        // The useAudioChain hook will re-wire on next render cycle.
      } else if (ctx && (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted')) {
        const wasState = ctx.state;
        ctx.resume().then(() => {
          // Re-anchor gain — ramps frozen during suspend snap incorrectly on
          // resume; applyMasterGain cancels the stale schedule + starts fresh.
          applyMasterGain();
          // Typed bg_reconnect alongside ae_resume — dashboards prefer typed.
          logPlaybackEvent({
            event_type: 'bg_reconnect',
            track_id: usePlayerStore.getState().currentTrack?.trackId || '-',
            meta: { from: wasState, hidden: document.hidden },
          });
        }).catch(() => {});
        devLog('🔄 [BG] AudioContext resumed on FG return');
      }

      const { isPlaying: sp } = usePlayerStore.getState();
      // Don't re-kick the element if a load is in flight — its canplay
      // handler will call play() once the new src is ready. Double-play
      // here races with that and causes duplicate play_success events.
      if (isLoadingTrackRef.current) return;
      // Store still says isPlaying=true. On return, restore reality.
      if (sp && audioRef.current?.paused && audioRef.current.src) {
        audioRef.current.play().catch(() => {});
        devLog('🔄 [BG] Re-kicked element on foreground return');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility, true);
    return () => document.removeEventListener('visibilitychange', handleVisibility, true);
    // playbackSource intentionally a dep — different sources may want
    // different return-from-BG handling in future.
  }, [audioRef, audioContextRef, gainNodeRef, isLoadingTrackRef, playbackSource, applyMasterGain]);

  // ── iOS AudioContext 'interrupted' listener ───────────────────────────
  // iOS transitions AudioContext to state='interrupted' on screen lock
  // (not 'suspended'). audioEngine's _audioCtx.onstatechange fires the
  // moment OS audio thread interrupts; we subscribe via the audioEngine
  // fan-out (audit-2 P1-AUD-2/3). Previous version captured
  // audioContextRef.current at first render — null because ctx is created
  // lazily — and the stable RefObject deps prevented re-run, leaving the
  // entire path dead. The subscriber pattern survives ctx swaps too
  // (long-BG iOS close → rebuild → subs preserved).
  useEffect(() => {
    const unsub = subscribeAudioCtxState((state) => {
      if (state !== 'suspended' && state !== 'interrupted') return;
      if (!usePlayerStore.getState().isPlaying) return;
      const ctx = audioContextRef.current;
      if (!ctx) return;
      ctx.resume().then(() => {
        // Re-anchor gain after iOS audio-thread interruption resume.
        applyMasterGain();
        const el = audioRef.current;
        if (el && el.paused && !el.ended && usePlayerStore.getState().isPlaying) {
          el.play().catch(() => {});
        }
      }).catch(() => {});
    });
    return unsub;
  }, [audioRef, audioContextRef, applyMasterGain]);

  // ── BATTERY-SUSPEND TIMER ────────────────────────────────────────────
  // 5s after paused + hidden, suspend the context for battery. Cancels
  // immediately on play or unhide. Separate from the capture-phase
  // visibility handler because that one fires BEFORE we know whether
  // the pause is sticking; this timer gives us 5s of confidence.
  const suspendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (suspendTimerRef.current) {
      clearTimeout(suspendTimerRef.current);
      suspendTimerRef.current = null;
    }
    if (!isPlaying && (playbackSource === 'cached' || playbackSource === 'r2')) {
      suspendTimerRef.current = setTimeout(() => {
        if (!usePlayerStore.getState().isPlaying && document.visibilityState === 'hidden') {
          audioContextRef.current?.suspend().catch(() => {});
          devLog('🔋 [BG] AudioContext suspended (paused + hidden, 5s settle)');
        }
        suspendTimerRef.current = null;
      }, 5000);
    }
    return () => {
      if (suspendTimerRef.current) {
        clearTimeout(suspendTimerRef.current);
        suspendTimerRef.current = null;
      }
    };
  }, [isPlaying, playbackSource, audioContextRef]);

  // ── HEARTBEAT ────────────────────────────────────────────────────────
  // The most important loop in the app. Fires every ~4s while isPlaying.
  // MessageChannel is used (not setTimeout) because MC is NOT throttled
  // by BG tab rules. Every tick:
  //   1. Keep MediaSession alive (setPositionState + playbackState)
  //   2. Ensure AudioContext is running (Chrome suspends it for power save)
  //   3. Rescue masterGain if stuck near zero (failed ramp against frozen
  //      context clock)
  //   4. Detect silent-paused element and kick play() on it
  //   5. Detect synthetic-ended (near duration + paused + hidden)
  //   6. Detect stuck playback (currentTime frozen for 2 ticks)
  //   7. Emit baseline heartbeat_tick trace every 2 ticks (8s) so we can
  //      see the heartbeat is alive even when nothing is wrong
  useEffect(() => {
    if (!isPlaying || !('mediaSession' in navigator)) return;

    const mc = new MessageChannel();
    let active = true;
    let lastTick = performance.now();
    let pulseCounter = 0;
    // Stuck detector state
    let lastObservedTime = -1;
    let lastObservedTrackId: string | null = null;
    let stuckTicks = 0;
    // v938 — synthetic-ended now requires TWO consecutive ticks of "near-end +
    // paused + hidden" before firing. Old code fired on a single tick which
    // could mis-classify a transient pause at 0.5s-from-end (buffer hiccup,
    // brief readiness drop) as a "needs to advance" — premature track skip.
    // Two consecutive ticks ≈ 4s window, still well under any acceptable BG
    // recovery delay but immune to one-shot transients.
    let synthEndedTicks = 0;
    let synthEndedTrackId: string | null = null;

    mc.port1.onmessage = () => {
      if (!active) return;
      const now = performance.now();
      // Cadence gate — fire real work every ~4s regardless of tick rate.
      // v837 (Dash 2026-04-29 "on screen lock audio stops for like a brief
      // brief second"): cadence dropped 4000 → 2000ms. AudioContext
      // suspension on lock muted the Web Audio chain until the next tick
      // resumed it. With 4s cadence the worst-case silence was ~4s; at
      // 2s it's ~2s. MessageChannel isn't throttled in background so the
      // tighter cadence costs us nothing in BG.
      if (now - lastTick < 2000) { mc.port2.postMessage(null); return; }
      lastTick = now;
      pulseCounter++;

      const el = audioRef.current;
      const ctx = audioContextRef.current;

      // (1) MediaSession keep-alive.
      try {
        if (el && el.duration && isFinite(el.duration)) {
          navigator.mediaSession.setPositionState({
            duration: el.duration,
            position: Math.min(el.currentTime, el.duration),
            playbackRate: el.playbackRate || 1,
          });
        }
        navigator.mediaSession.playbackState = 'playing';
      } catch {}

      // (2) AudioContext life support.
      if (ctx) {
        const prevState = ctx.state;
        if (prevState === 'suspended' || (prevState as any) === 'interrupted') {
          ctx.resume()
            .then(() => {
              // Re-anchor gain — frozen ramps snap incorrectly after resume.
              applyMasterGain();
              trace('ctx_resume_ok', usePlayerStore.getState().currentTrack?.trackId, { prevState, hidden: document.hidden });
            })
            .catch(e => trace('ctx_resume_rejected', usePlayerStore.getState().currentTrack?.trackId, { prevState, err: e?.name, msg: (e?.message || '').slice(0, 80), hidden: document.hidden }));
        }

        // (3) Gain rescue — if gain is stuck near zero while playing, force
        // it to target. setValueAtTime jumps (no ramp) — user's been silent
        // for seconds, smoothness is moot.
        const gain = gainNodeRef.current;
        if (
          gain && el && !el.paused &&
          !isLoadingTrackRef.current &&
          el.src !== silentKeeperUrlRef.current &&
          gain.gain.value < 0.01 &&
          usePlayerStore.getState().isPlaying
        ) {
          try {
            const target = computeMasterTarget();
            const now = ctx.currentTime;
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(target, now + 0.05); // 50ms ramp — less click than instant
            trace('gain_rescue', usePlayerStore.getState().currentTrack?.trackId, {
              prevValue: gain.gain.value,
              target,
              ctxState: ctx.state,
              hidden: document.hidden,
            });
          } catch {}
        }
      }

      // (5) Synthetic-ended detector — Chrome BG sometimes doesn't fire
      // `ended`. If element paused + near duration + real src + hidden,
      // force the advance. v938: requires 2 consecutive heartbeat ticks
      // of the condition (≈4s) so a one-shot transient pause near end
      // doesn't fire a false advance.
      const trackIdForSynth = usePlayerStore.getState().currentTrack?.trackId;
      const synthCondition =
        el && el.paused && el.src && document.hidden &&
        !isLoadingTrackRef.current &&
        el.src !== silentKeeperUrlRef.current &&
        el.duration && isFinite(el.duration) && el.duration > 0 &&
        el.currentTime >= el.duration - 0.5 &&
        usePlayerStore.getState().isPlaying;
      if (synthCondition && trackIdForSynth) {
        if (synthEndedTrackId === trackIdForSynth) {
          synthEndedTicks++;
        } else {
          synthEndedTrackId = trackIdForSynth;
          synthEndedTicks = 1;
        }
        if (synthEndedTicks >= 2 && lastEndedTrackIdRef.current !== trackIdForSynth) {
          trace('synthetic_ended', trackIdForSynth, {
            currentTime: el.currentTime,
            duration: el.duration,
            paused: el.paused,
            hidden: document.hidden,
            ticks: synthEndedTicks,
          });
          if (syntheticEndedBypassRef.current !== null) {
            syntheticEndedBypassRef.current = true;
          }
          synthEndedTicks = 0;
          synthEndedTrackId = null;
          runEndedAdvanceRef.current?.();
          mc.port2.postMessage(null);
          return;
        }
      } else {
        // Condition broken on this tick → reset the consecutive-tick counter.
        synthEndedTicks = 0;
        synthEndedTrackId = null;
      }

      // (4) Silent-paused kick — if element is paused but should be playing,
      // kick it. Chrome can silently suspend the element without firing
      // pause. v938: gate on el.readyState >= 2 (HAVE_CURRENT_DATA). Without
      // this guard, the kick races AudioPlayer's tryPlay (which retries play
      // for 1.5s after src assignment) — both fire play() against an element
      // that's still loading metadata and the second call rejects with
      // AbortError, polluting the kick telemetry and confusing the recovery
      // signal. With the gate, the kick only fires once the element is
      // actually capable of playing.
      if (
        el && el.paused && el.src &&
        !isLoadingTrackRef.current &&
        el.readyState >= 2 &&
        usePlayerStore.getState().isPlaying
      ) {
        try {
          ctx?.state === 'suspended' && ctx.resume().catch(() => {});
          const bat = getBatteryState();
          const kickTrackId = usePlayerStore.getState().currentTrack?.trackId;
          trace('heartbeat_kick', kickTrackId, {
            why: 'element_silently_paused',
            hidden: document.hidden,
            readyState: el.readyState,
            batLvl: Math.round(bat.level * 100),
            batCharging: bat.charging,
            batLow: bat.lowBattery,
          });
          el.play()
            .then(() => trace('heartbeat_kick_ok', kickTrackId, { hidden: document.hidden }))
            .catch(e => trace('heartbeat_kick_rejected', kickTrackId, {
              err: e?.name || 'unknown',
              msg: (e?.message || '').slice(0, 80),
              hidden: document.hidden,
            }));
        } catch {}
      }

      // (6) Stuck-playback detector — element not paused, not ended, but
      // currentTime isn't advancing. Chrome silent-suspended mid-playback
      // and play() isn't reviving it. Escalate after 2 ticks (~8s).
      if (
        el && el.src && document.hidden &&
        !isLoadingTrackRef.current &&
        el.src !== silentKeeperUrlRef.current &&
        usePlayerStore.getState().isPlaying
      ) {
        const tid = usePlayerStore.getState().currentTrack?.trackId || null;
        const curTime = el.currentTime;
        if (tid && tid === lastObservedTrackId && Math.abs(curTime - lastObservedTime) < 0.1) {
          stuckTicks++;
          trace('stuck_tick', tid, {
            stuckTicks,
            currentTime: curTime,
            duration: el.duration,
            paused: el.paused,
            readyState: el.readyState,
            hidden: document.hidden,
          });
          if (stuckTicks >= 2 && tid && lastEndedTrackIdRef.current !== tid) {
            trace('stuck_escalate', tid, {
              stuckTicks,
              currentTime: curTime,
              duration: el.duration,
              hidden: document.hidden,
            });
            if (syntheticEndedBypassRef.current !== null) {
              syntheticEndedBypassRef.current = true;
            }
            stuckTicks = 0;
            runEndedAdvanceRef.current?.();
            mc.port2.postMessage(null);
            return;
          }
        } else {
          stuckTicks = 0;
          lastObservedTime = curTime;
          lastObservedTrackId = tid;
        }
      } else {
        stuckTicks = 0;
        lastObservedTime = -1;
        lastObservedTrackId = null;
      }

      // (7) Baseline pulse. Half-cadence (every 2 ticks = 8s) keeps cost
      // low but proves the heartbeat is alive.
      if (pulseCounter % 2 === 0) {
        trace('heartbeat_tick', usePlayerStore.getState().currentTrack?.trackId, {
          hidden: document.hidden,
          ctxState: ctx?.state,
          gain: gainNodeRef.current?.gain.value,
          paused: el?.paused,
          currentTime: el?.currentTime,
          duration: el?.duration,
          readyState: el?.readyState,
        });
      }

      mc.port2.postMessage(null);
    };
    mc.port2.postMessage(null);

    return () => {
      active = false;
      mc.port1.close();
      mc.port2.close();
    };
  }, [isPlaying, audioRef, audioContextRef, gainNodeRef, isLoadingTrackRef, computeMasterTarget, applyMasterGain, runEndedAdvanceRef, syntheticEndedBypassRef, lastEndedTrackIdRef]);

  return {
    silentKeeperUrlRef,
    isTransitioningToBackgroundRef,
    engageSilentWav,
  };
}

// Suppress "declared but unused" for devWarn — it's available for future
// expansion without triggering lint.
void devWarn;
