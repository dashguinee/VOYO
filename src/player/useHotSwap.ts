/**
 * useHotSwap — orchestrates the iframe-to-R2 cross-fade for a track that
 * started on the iframe fallback and later becomes cached in R2.
 *
 * Responsibilities:
 *   1. Snapshot iframe.currentTime once a second so we have a resume point
 *      even if iframe dies (mobile backgrounding, iOS audio-session claim).
 *   2. Subscribe to Supabase Realtime for voyo_upload_queue UPDATE on the
 *      current trackId — fires ~instantly when the lane marks status=done.
 *   3. Poll R2 HEAD every 5s as a safety net (websocket drop, publication
 *      not firing, etc). Whichever path catches it first wins.
 *   4. Run the cross-fade: iframe volume 100→0 while <audio> volume 0→store
 *      in 15 steps over HOT_SWAP_FADE_MS, seek <audio> to the iframe's
 *      currentTime (or snapshot fallback) so the track continues seamlessly.
 *
 * Lives as a hook because all the state it manages (refs, subscriptions,
 * intervals) is React-lifecycle-bound anyway.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { supabase } from '../lib/supabase';
import { logPlaybackEvent } from '../services/telemetry';
import { devLog } from '../utils/logger';
import { iframeBridge } from './iframeBridge';
import { r2HasTrack, R2_AUDIO_BASE as R2_AUDIO } from './r2Probe';
import { getYouTubeId } from '../utils/voyoId';
import type { Track } from '../types';

// Tightened from 5s → 2s. The Realtime channel TIMED_OUT repeatedly in
// prod, leaving poll as the sole detector. At 5s the perceived gap
// between R2 landing and the crossfade firing was up to 5s — users
// skipped before it caught. 2s keeps the HEAD budget light (~30 per
// 60s track max if the track never gets extracted) while making the
// swap feel near-instant when R2 does land.
const HOT_SWAP_POLL_MS = 2_000;
// One unified swap: always position-matched (no rewind), equal-power curve
// (constant perceived loudness, no dip), 2s fade. Iframe fades out on
// cos(p·π/2), R2 fades in on sin(p·π/2) — sum of squares stays ≈1.
const HOT_SWAP_FADE_MS = 2_000;

// Monotonic counter — incremented at the START of every performHotSwap call.
// Captured at canplay-listener registration; if the value differs at callback
// time (user skipped → new swap started) the listener discards the event.
// Dual-check with el.src: both must match, defence-in-depth. [AUDIT-2 #1]
let _swapToken = 0;
const HOT_SWAP_STEPS   = 40;

/**
 * Perform the cross-fade. Pure-ish — reads the iframe bridge, mutates the
 * audio element, flips playbackSource at the end. Every stage logs a
 * trace so we can see exactly where a swap gets stuck if it does.
 *
 * Returns `true` on a successful slide-in, `false` on any abort (stale
 * track, canplay timeout, etc). Callers use the return value to decide
 * whether the "already triggered" guard should reset so a later poll
 * can try again — an abort without reset would strand the track on
 * iframe forever.
 */
async function performHotSwap(
  trackId: string,
  el: HTMLAudioElement,
  snapshot: { trackId: string; seconds: number } | null,
  iframeStartedAt: number,
): Promise<boolean> {
  // Claim a unique token for this swap invocation. Incremented before any
  // async work so parallel calls (unlikely but possible if trigger fires
  // twice) each hold a distinct value. [AUDIT-2 #1]
  const myToken = ++_swapToken;

  // playerStore.volume is 0-100 (see playerStore.ts:409). HTMLMediaElement.volume
  // requires [0, 1]. Normalize once so every el.volume = storeVol * r2Gain below
  // stays in range. Prior bug: 100% of hotswaps threw "volume property outside
  // range [0, 1]" on the first fade step, marked hotswap_unrecoverable, left
  // playback stuck on iframe — which in turn killed BG playback on mobile.
  const storeVol = usePlayerStore.getState().volume / 100;
  const elapsed = Date.now() - iframeStartedAt;

  // Abort if the user skipped — checked at every await boundary. Without
  // this guard, a mid-flight swap completes against an old trackId and
  // flips playbackSource='r2' while the NEW track's lifecycle is already
  // running, causing the old R2 audio to bleed over the new track.
  const stillCurrent = () =>
    usePlayerStore.getState().currentTrack?.trackId === trackId;

  // Position priority: live iframe → snapshot → fall back to 0 (cold).
  let t = iframeBridge.getCurrentTime();
  let posSource: 'live' | 'snapshot' | 'cold' | 'restart' = 'live';
  if (t == null || !isFinite(t)) {
    if (snapshot && snapshot.trackId === trackId && snapshot.seconds > 0) {
      t = snapshot.seconds;
      posSource = 'snapshot';
    } else {
      t = 0;
      posSource = 'cold';
    }
  }

  // Per Dash 2026-04-25: "restart if less than 15s in." If the user is
  // still in the intro window when R2 lands, restart the track from 0
  // via the existing crossfade — the user gets the full song from the
  // top, no jarring mid-line jump. Past 15s, seamless in-place swap.
  // 'restart' posSource is logged so we can verify the threshold feels
  // right in telemetry over time.
  const RESTART_THRESHOLD_S = 15;
  if (t > 0 && t < RESTART_THRESHOLD_S) {
    t = 0;
    posSource = 'restart';
  }

  logPlaybackEvent({
    event_type: 'trace', track_id: trackId,
    meta: { subtype: 'hotswap_start', mode: posSource, at_seconds: Math.round(t), elapsed_ms: elapsed },
  });

  // Clean-exit helper — used by every abort path so state is consistent.
  //
  // Guarded src-strip: the <audio> element is a singleton shared with
  // AudioPlayer. If the user rapid-skipped during the hotswap, AudioPlayer
  // has already re-assigned el.src for track N+1 (R2 fast path). An
  // unconditional removeAttribute('src')+load() here would strip the src
  // off the *new* track's element, producing silent dead audio. Only strip
  // if el.src still corresponds to the track this bail is for.
  const bail = (subtype: string, extra: Record<string, unknown> = {}): false => {
    logPlaybackEvent({
      event_type: 'trace', track_id: trackId,
      meta: { subtype, mode: posSource, elapsed_ms: Date.now() - iframeStartedAt, ...extra },
    });
    try { el.pause(); } catch {}
    try {
      const ytId = getYouTubeId(trackId);
      // Only strip src if this element still points at OUR track. If the
      // user skipped and AudioPlayer reassigned el.src to a new ytId,
      // leave it alone — the new effect owns the element now.
      if (ytId && el.src && el.src.includes(ytId)) {
        el.removeAttribute('src');
        el.load();
      }
    } catch {}
    return false;
  };

  try {
    // Guard 1 — before touching the element at all.
    if (!stillCurrent()) return bail('hotswap_abort_stale', { stage: 'pre_src' });

    // Preload R2 silently at the matched position. The audio element
    // ships with preload="none" for battery; without flipping it here,
    // setting .src alone never triggers a network fetch → canplay never
    // fires → every hotswap times out. load() then forces the resource
    // selection algorithm to actually run. Telemetry 2026-04-21 showed
    // 40/45 triggers timing out before this fix.
    el.preload = 'auto';
    // R2 stores audio keyed by raw YouTube ID; app can carry VOYO IDs
    // (vyo_<base64>) in trackId. Telemetry 2026-04-21 showed vyo_ prefixed
    // IDs reaching hotswap_watcher_mount — those would 404 without decode.
    const ourSrc = `${R2_AUDIO}/${getYouTubeId(trackId)}?q=high`;
    el.src = ourSrc;
    try { el.load(); } catch {}
    try { el.currentTime = t; } catch {}
    el.volume = 0;

    // Wait for canplay — if it doesn't fire in 2.5s, the HEAD said yes but
    // the media isn't actually buffered enough. Abort rather than fade
    // iframe out into silence; the poll will re-fire in HOT_SWAP_POLL_MS
    // once R2 is genuinely ready.
    //
    // Stale-src guard: if the user skips during the canplay wait, the next
    // track's effect may reassign `el.src` before our listener fires. Since
    // <audio> fires `canplay` against the CURRENT source, our stale closure
    // would otherwise resolve `true` and proceed to seek/play the new
    // track's src at the OLD track's iframe position. Compare `el.src` to
    // the url we set and bail if it's moved on — the new track owns the
    // element now, leave it alone.
    const canplayFired = await new Promise<boolean>((resolve) => {
      const onReady = () => {
        el.removeEventListener('canplay', onReady);
        // Dual stale-check: el.src guard (commit 1af7671) + token guard [AUDIT-2 #1].
        // Either mismatch means a newer swap has taken over the element.
        if (el.src !== ourSrc || _swapToken !== myToken) { resolve(false); return; }
        resolve(true);
      };
      el.addEventListener('canplay', onReady);
      setTimeout(() => { el.removeEventListener('canplay', onReady); resolve(false); }, 2500);
    });

    // Guard 2 — track may have changed during canplay wait.
    if (!stillCurrent()) return bail('hotswap_abort_stale', { stage: 'post_canplay' });

    if (!canplayFired) {
      // Silence is the opposite of the slide-in — back out cleanly, iframe
      // keeps playing, next poll retries.
      return bail('hotswap_canplay_timeout');
    }

    try { el.currentTime = t; } catch {}
    let playRejected = false;
    await el.play().catch((err: Error) => {
      playRejected = true;
      logPlaybackEvent({
        event_type: 'trace', track_id: trackId,
        meta: { subtype: 'hotswap_play_reject', err: err?.message?.slice(0, 80) },
      });
    });

    // If play() was rejected OR the element still reports paused after
    // await, bail before the crossfade — otherwise iframe fades to 0
    // while the R2 element sits silent, leaving the user in dead air.
    // This was the "feels like it tried to swap and paused" failure
    // mode. The iframe keeps playing; the next poll retries cleanly.
    if (playRejected || el.paused) {
      return bail('hotswap_play_stalled', { paused: el.paused });
    }

    // Guard 3 — user could have skipped during play() await.
    if (!stillCurrent()) return bail('hotswap_abort_stale', { stage: 'post_play' });

    // Equal-power crossfade. Linear fades briefly dip ~3dB mid-swap (perceived
    // quieter); sin/cos preserves constant perceived loudness — no audible dip.
    const stepMs = Math.max(1, Math.round(HOT_SWAP_FADE_MS / HOT_SWAP_STEPS));
    const iframeFade = iframeBridge.fadeOut(HOT_SWAP_FADE_MS);
    for (let i = 1; i <= HOT_SWAP_STEPS; i++) {
      // Guard 4 — bail inside the fade loop. Leaves the new track's
      // lifecycle to take over cleanly; don't flip playbackSource here.
      if (!stillCurrent()) {
        iframeBridge.pause();
        iframeBridge.resetVolume();
        return bail('hotswap_abort_stale', { stage: 'fade', step: i });
      }
      const p = i / HOT_SWAP_STEPS;          // 0 → 1
      const r2Gain = Math.sin((p * Math.PI) / 2); // 0 → 1 (equal-power in)
      el.volume = storeVol * r2Gain;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    await iframeFade;

    // Final guard — extremely narrow race but cheap to check.
    if (!stillCurrent()) {
      iframeBridge.pause();
      iframeBridge.resetVolume();
      return bail('hotswap_abort_stale', { stage: 'post_fade' });
    }

    // stop() kills the YouTube network stream (not just pauses) so it stops
    // buffering in background post-swap. [AUDIT-2 #3]
    iframeBridge.stop();
    iframeBridge.resetVolume();
    // Re-read volume at the final assignment — user may have moved the
    // slider during the 2s fade, and storeVol captured at the top of
    // performHotSwap is now stale. Normalize 0-100 → 0-1 for el.volume.
    el.volume = usePlayerStore.getState().volume / 100;
    usePlayerStore.getState().setPlaybackSource('r2');

    logPlaybackEvent({
      event_type: 'trace', track_id: trackId,
      meta: {
        subtype: 'hotswap', mode: posSource,
        elapsed_ms: elapsed, fade_ms: HOT_SWAP_FADE_MS, at_seconds: Math.round(t),
        paused_after: el.paused, el_vol: el.volume,
      },
    });
    return true;
  } catch (err) {
    // Something threw mid-swap. Emergency instant-swap so we don't leave the
    // user with muted iframe + muted <audio>. Only safe if the track is
    // still current — otherwise just bail.
    logPlaybackEvent({
      event_type: 'trace', track_id: trackId,
      meta: {
        subtype: 'hotswap_fail', mode: posSource,
        err: (err as Error)?.message?.slice(0, 120),
      },
    });
    if (!stillCurrent()) return bail('hotswap_abort_stale', { stage: 'catch' });
    try {
      el.volume = storeVol;
      if (el.paused) await el.play().catch(() => {});
      iframeBridge.pause();
      iframeBridge.resetVolume();
      usePlayerStore.getState().setPlaybackSource('r2');
      return true;
    } catch {
      return bail('hotswap_unrecoverable');
    }
  }
}

/**
 * Hook that activates whenever `playbackSource === 'iframe'` + currentTrack.
 * Sets up watchers + snapshot ticker, tears them down on track change or
 * when the track leaves iframe mode.
 */
export function useHotSwap(
  currentTrack: Track | null,
  playbackSource: string | null | undefined,
  audioRef: RefObject<HTMLAudioElement | null>,
): void {
  // Last-known iframe currentTime — for the iframe-cut resume case.
  const lastIframePosRef = useRef<{ trackId: string; seconds: number } | null>(null);

  // Watcher handles — cleared on every track-change or unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const snapRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Timestamp of when iframe playback started — logged in telemetry so we
  // can see how long each track spent on iframe before the R2 swap landed.
  const iframeStartedAtRef = useRef<number>(0);

  // Watcher setup — fires on every iframe-mode track.
  useEffect(() => {
    if (playbackSource !== 'iframe' || !currentTrack) return;
    const trackId = currentTrack.trackId;
    iframeStartedAtRef.current = Date.now();

    // Diagnostic — confirms useHotSwap actually mounted its watchers.
    // Without this trace, a silent activation failure (import error,
    // early return) is indistinguishable from the happy path where
    // R2 just never lands.
    logPlaybackEvent({
      event_type: 'trace', track_id: trackId,
      meta: {
        subtype: 'hotswap_watcher_mount',
        hidden: typeof document !== 'undefined' ? document.hidden : false,
      },
    });

    // Start snapshot ticker — 1s cadence, writes last-known iframe position.
    snapRef.current = setInterval(() => {
      const t = iframeBridge.getCurrentTime();
      if (t != null && isFinite(t) && t > 0) {
        lastIframePosRef.current = { trackId, seconds: t };
      }
    }, 1000);

    // Unified trigger — whichever watcher fires first wins. `inFlight`
    // (not a one-shot latch) lets a failed swap retry: if performHotSwap
    // returns false (canplay timeout, stale track, etc) we clear the flag
    // so the next poll/RT can try again. A one-shot `triggered` flag
    // would strand the track on iframe after any abort.
    let inFlight = false;
    const trigger = (reason: string) => {
      const storeTid = usePlayerStore.getState().currentTrack?.trackId;
      if (storeTid !== trackId) {
        logPlaybackEvent({
          event_type: 'trace', track_id: trackId,
          meta: { subtype: 'hotswap_trigger_stale', reason, now: storeTid ?? 'none' },
        });
        return;
      }
      if (inFlight) return;
      inFlight = true;
      devLog(`[useHotSwap] trigger (${reason}) for ${trackId}`);
      const el = audioRef.current;
      if (!el) {
        logPlaybackEvent({
          event_type: 'trace', track_id: trackId,
          meta: { subtype: 'hotswap_no_audio_ref', reason },
        });
        inFlight = false;
        return;
      }
      logPlaybackEvent({
        event_type: 'trace', track_id: trackId,
        meta: { subtype: 'hotswap_trigger', reason },
      });
      void performHotSwap(trackId, el, lastIframePosRef.current, iframeStartedAtRef.current)
        .then((success) => {
          if (success) {
            // Success — playbackSource='r2'; the useEffect will re-run
            // with the new source and tear down watchers. Nothing to do.
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            if (channelRef.current && supabase) {
              supabase.removeChannel(channelRef.current);
              channelRef.current = null;
            }
          } else {
            // Abort — reset flag so the NEXT poll/RT fire can retry.
            // Watchers stay active for exactly this reason.
            inFlight = false;
          }
        });
    };

    // Realtime subscription — only subscribe if the queue row is still
    // pending. If it's already 'done', R2 just hasn't propagated yet —
    // the poll below will catch it within HOT_SWAP_POLL_MS, no reason
    // to open a WebSocket channel we'll close seconds later. If it's
    // 'failed', no point subscribing at all.
    //
    // Reconnect strategy: memory notes the RT channel TIMED_OUT/CLOSED
    // in prod. When that happens, the poll safety net was the only
    // detector — capped at MAX_POLL_ATTEMPTS=60 × 2s = 120s, so any
    // cold-queue track whose extraction exceeded ~2 min got stranded on
    // iframe permanently. We now tear down the dead channel and
    // re-subscribe up to RT_MAX_RECONNECTS times with a fixed 10s
    // backoff (~30s recovery window). Each attempt is traced so
    // telemetry can measure reconnect yield.
    const RT_MAX_RECONNECTS = 3;
    const RT_RECONNECT_DELAY_MS = 10_000;
    let rtReconnectAttempts = 0;
    const rtReconnectTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    if (supabase) {
      // voyo_upload_queue is keyed by raw YouTube id. trackId coming in
      // may be VOYO-prefixed (vyo_<base64>) — decode before querying or
      // the .eq() + RT filter will both silently miss.
      const ytId = getYouTubeId(trackId);
      const checkAndSubscribe = async () => {
        // Track may have moved on between scheduling and running the
        // (async) check. Don't subscribe against a stale trackId — the
        // new track's watcher owns the channel now.
        if (usePlayerStore.getState().currentTrack?.trackId !== trackId) return;
        let rowStatus: string | null = null;
        try {
          const { data } = await supabase!
            .from('voyo_upload_queue')
            .select('status')
            .eq('youtube_id', ytId)
            .limit(1);
          rowStatus = data?.[0]?.status ?? null;
          // Subscribe for any non-terminal state. Workers write 'processing'
          // the instant they claim a row (which means extraction is ACTIVELY
          // running and we want the transition-to-done notification above
          // all else). 'pending' = claimed but not yet worked. 'extracting'
          // = legacy synonym. Only 'done' and 'failed' are terminal and
          // worth skipping — 'done' → poll will see it on next tick,
          // 'failed' → RT won't fire a success anyway.
          if (rowStatus === 'done' || rowStatus === 'failed') {
            logPlaybackEvent({
              event_type: 'trace', track_id: trackId,
              meta: { subtype: 'hotswap_rt_skip', rowStatus },
            });
            // Extra guard for 'failed' — row is terminal, R2 will never
            // land. Stop the poll loop now so we don't spam HEAD probes.
            // 'done' needs no guard: poll will confirm within 2s and
            // trigger the swap on the next tick.
            if (rowStatus === 'failed' && pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            return;
          }
        } catch { /* non-fatal, fall through to RT */ }
        // Re-check mount after the await — effect cleanup may have run.
        if (usePlayerStore.getState().currentTrack?.trackId !== trackId) return;
        logPlaybackEvent({
          event_type: 'trace', track_id: trackId,
          meta: {
            subtype: 'hotswap_rt_subscribe',
            rowStatus,
            attempt: rtReconnectAttempts,
          },
        });
        channelRef.current = supabase!
          .channel(`hotswap:${ytId}`)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'voyo_upload_queue',
            filter: `youtube_id=eq.${ytId}`,
          }, (payload: { new?: { status?: string } }) => {
            const next = payload.new?.status;
            if (next === 'done') {
              trigger('realtime');
              return;
            }
            if (next === 'failed') {
              // Extraction failed server-side — give up polling so we
              // stop hitting the edge for a track that'll never land.
              // iframe stays, audio continues, the user just won't get
              // the R2 upgrade for this track.
              logPlaybackEvent({
                event_type: 'trace', track_id: trackId,
                meta: { subtype: 'hotswap_rt_failed' },
              });
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
            }
          })
          .subscribe((status: string) => {
            logPlaybackEvent({
              event_type: 'trace', track_id: trackId,
              meta: {
                subtype: 'hotswap_rt_channel_status',
                status,
                attempt: rtReconnectAttempts,
              },
            });
            // TIMED_OUT / CLOSED / CHANNEL_ERROR: channel is dead and
            // will never recover on its own. Tear down, wait, then
            // re-subscribe — bounded by RT_MAX_RECONNECTS so we don't
            // loop forever against a hard-broken backend.
            if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
              if (rtReconnectAttempts >= RT_MAX_RECONNECTS) {
                logPlaybackEvent({
                  event_type: 'trace', track_id: trackId,
                  meta: {
                    subtype: 'hotswap_rt_reconnect_give_up',
                    status,
                    attempts: rtReconnectAttempts,
                  },
                });
                return;
              }
              // Already scheduled a reconnect — don't stack timers.
              if (rtReconnectTimerRef.current) return;
              // Bail if the watcher has moved on (new track) — no point
              // reconnecting a stale subscription.
              if (usePlayerStore.getState().currentTrack?.trackId !== trackId) return;
              rtReconnectAttempts += 1;
              logPlaybackEvent({
                event_type: 'trace', track_id: trackId,
                meta: {
                  subtype: 'hotswap_rt_reconnect_schedule',
                  status,
                  attempt: rtReconnectAttempts,
                  delay_ms: RT_RECONNECT_DELAY_MS,
                },
              });
              rtReconnectTimerRef.current = setTimeout(() => {
                rtReconnectTimerRef.current = null;
                // Final mount guard — track might have changed during delay.
                if (usePlayerStore.getState().currentTrack?.trackId !== trackId) return;
                // Tear down the dead channel before re-creating so
                // Supabase's per-client channel registry doesn't leak.
                try {
                  if (channelRef.current && supabase) {
                    supabase.removeChannel(channelRef.current);
                  }
                } catch {}
                channelRef.current = null;
                logPlaybackEvent({
                  event_type: 'trace', track_id: trackId,
                  meta: {
                    subtype: 'hotswap_rt_reconnect_fire',
                    attempt: rtReconnectAttempts,
                  },
                });
                void checkAndSubscribe();
              }, RT_RECONNECT_DELAY_MS);
            }
          });
      };
      void checkAndSubscribe();
    }

    // Poll safety net — fires if realtime drops or never subscribes.
    // Silent: success = performHotSwap's 'hotswap' trace covers it.
    // Paused while the tab is hidden (BG battery saver): hot-swap visual
    // doesn't matter when there's no visible UI; the next foreground tick
    // re-arms the interval and catches any lane completion from the gap.
    //
    // MAX_POLL_ATTEMPTS stops the polling after ~2 min of 'has:false'
    // hits. Before this cap, a server-side extraction failure caused
    // the client to keep hitting r2HasTrack every 2s indefinitely —
    // wasted network on a track that was never going to land. Once
    // capped, the iframe continues playing (user hears audio) but we
    // stop spamming HEAD probes for a terminal failure.
    const MAX_POLL_ATTEMPTS = 60;
    const startPoll = () => {
      if (pollRef.current != null) return;
      let pollCount = 0;
      logPlaybackEvent({
        event_type: 'trace', track_id: trackId,
        meta: { subtype: 'hotswap_poll_start' },
      });
      pollRef.current = setInterval(async () => {
        if (usePlayerStore.getState().currentTrack?.trackId !== trackId) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        pollCount++;
        if (pollCount > MAX_POLL_ATTEMPTS) {
          // Extraction likely failed or is unusually stuck. Bail
          // silently — iframe stays on, user keeps hearing audio, we
          // just stop wasting HEAD requests.
          logPlaybackEvent({
            event_type: 'trace', track_id: trackId,
            meta: { subtype: 'hotswap_poll_cap', n: pollCount },
          });
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        const has = await r2HasTrack(trackId);
        // Heartbeat every 5 polls (~10s) so we can confirm the poll is
        // alive in production telemetry even when R2 never lands. Also
        // trace the FIRST hit that comes back true — separate from
        // 'hotswap_trigger' which fires after the inFlight gate, so we
        // know whether the delay is probe-side or trigger-side.
        if (pollCount % 5 === 0 || has) {
          logPlaybackEvent({
            event_type: 'trace', track_id: trackId,
            meta: { subtype: 'hotswap_poll_tick', n: pollCount, has },
          });
        }
        if (has) trigger('poll');
      }, HOT_SWAP_POLL_MS);
    };
    const stopPoll = () => {
      if (pollRef.current != null) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    if (!document.hidden) startPoll();
    const onVis = () => {
      if (document.hidden) stopPoll();
      else {
        // Immediate probe on return in case R2 landed during BG.
        void r2HasTrack(trackId).then(has => { if (has) trigger('poll'); });
        startPoll();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      // visibilitychange listener was leaking — every track change added
      // a new one without removing the prior. Bounded but real (N tracks
      // → N stale listeners → N parallel pokes on every visibility flip).
      // Removed cleanly here now.
      document.removeEventListener('visibilitychange', onVis);
      if (snapRef.current) { clearInterval(snapRef.current); snapRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (rtReconnectTimerRef.current) {
        clearTimeout(rtReconnectTimerRef.current);
        rtReconnectTimerRef.current = null;
      }
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [playbackSource, currentTrack?.trackId, audioRef]);
}
