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
const HOT_SWAP_STEPS   = 40;

/**
 * Perform the cross-fade. Pure-ish — reads the iframe bridge, mutates the
 * audio element, flips playbackSource at the end. Every stage logs a
 * trace so we can see exactly where a swap gets stuck if it does.
 */
async function performHotSwap(
  trackId: string,
  el: HTMLAudioElement,
  snapshot: { trackId: string; seconds: number } | null,
  iframeStartedAt: number,
): Promise<void> {
  const storeVol = usePlayerStore.getState().volume;
  const elapsed = Date.now() - iframeStartedAt;

  // Position priority: live iframe → snapshot → fall back to 0 (cold).
  let t = iframeBridge.getCurrentTime();
  let posSource: 'live' | 'snapshot' | 'cold' = 'live';
  if (t == null || !isFinite(t)) {
    if (snapshot && snapshot.trackId === trackId && snapshot.seconds > 0) {
      t = snapshot.seconds;
      posSource = 'snapshot';
    } else {
      t = 0;
      posSource = 'cold';
    }
  }

  logPlaybackEvent({
    event_type: 'trace', track_id: trackId,
    meta: { subtype: 'hotswap_start', mode: posSource, at_seconds: Math.round(t), elapsed_ms: elapsed },
  });

  try {
    // Preload R2 silently at the matched position.
    el.src = `${R2_AUDIO}/${trackId}?q=high`;
    try { el.currentTime = t; } catch {}
    el.volume = 0;
    const canplayDeadline = Date.now() + 2500;
    await new Promise<void>((resolve) => {
      const onReady = () => { el.removeEventListener('canplay', onReady); resolve(); };
      el.addEventListener('canplay', onReady);
      setTimeout(() => { el.removeEventListener('canplay', onReady); resolve(); }, 2500);
    });
    const canplayLate = Date.now() > canplayDeadline - 50;
    try { el.currentTime = t; } catch {}
    await el.play().catch((err: Error) => {
      logPlaybackEvent({
        event_type: 'trace', track_id: trackId,
        meta: { subtype: 'hotswap_play_reject', err: err?.message?.slice(0, 80) },
      });
    });

    // Equal-power crossfade. Linear fades briefly dip ~3dB mid-swap (perceived
    // quieter); sin/cos preserves constant perceived loudness — no audible dip.
    const stepMs = Math.max(1, Math.round(HOT_SWAP_FADE_MS / HOT_SWAP_STEPS));
    const iframeFade = iframeBridge.fadeOut(HOT_SWAP_FADE_MS);
    for (let i = 1; i <= HOT_SWAP_STEPS; i++) {
      const p = i / HOT_SWAP_STEPS;          // 0 → 1
      const r2Gain = Math.sin((p * Math.PI) / 2); // 0 → 1 (equal-power in)
      el.volume = Math.min(storeVol, storeVol * r2Gain);
      await new Promise((r) => setTimeout(r, stepMs));
    }
    await iframeFade;

    iframeBridge.pause();
    iframeBridge.resetVolume();
    el.volume = storeVol;
    usePlayerStore.getState().setPlaybackSource('r2');

    logPlaybackEvent({
      event_type: 'trace', track_id: trackId,
      meta: {
        subtype: 'hotswap', mode: posSource,
        elapsed_ms: elapsed, fade_ms: HOT_SWAP_FADE_MS, at_seconds: Math.round(t),
        canplay_late: canplayLate, paused_after: el.paused, el_vol: el.volume,
      },
    });
  } catch (err) {
    // Something threw mid-swap. Emergency instant-swap so we don't leave the
    // user with muted iframe + muted <audio>.
    logPlaybackEvent({
      event_type: 'trace', track_id: trackId,
      meta: {
        subtype: 'hotswap_fail', mode: posSource,
        err: (err as Error)?.message?.slice(0, 120),
      },
    });
    try {
      el.volume = storeVol;
      if (el.paused) await el.play().catch(() => {});
      iframeBridge.pause();
      iframeBridge.resetVolume();
      usePlayerStore.getState().setPlaybackSource('r2');
    } catch { /* can't recover — user hears silence, will skip */ }
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

    // Start snapshot ticker — 1s cadence, writes last-known iframe position.
    snapRef.current = setInterval(() => {
      const t = iframeBridge.getCurrentTime();
      if (t != null && isFinite(t) && t > 0) {
        lastIframePosRef.current = { trackId, seconds: t };
      }
    }, 1000);

    // Unified trigger — whichever watcher fires first wins, both clear.
    // Instrumented so we see every (attempted) fire in telemetry, and
    // can tell stale-track abandonments from real swaps.
    let triggered = false;
    const trigger = (reason: string) => {
      const storeTid = usePlayerStore.getState().currentTrack?.trackId;
      if (storeTid !== trackId) {
        logPlaybackEvent({
          event_type: 'trace', track_id: trackId,
          meta: { subtype: 'hotswap_trigger_stale', reason, now: storeTid ?? 'none' },
        });
        return;
      }
      if (triggered) return;
      triggered = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      devLog(`[useHotSwap] trigger (${reason}) for ${trackId}`);
      const el = audioRef.current;
      if (!el) {
        logPlaybackEvent({
          event_type: 'trace', track_id: trackId,
          meta: { subtype: 'hotswap_no_audio_ref', reason },
        });
        return;
      }
      logPlaybackEvent({
        event_type: 'trace', track_id: trackId,
        meta: { subtype: 'hotswap_trigger', reason },
      });
      void performHotSwap(trackId, el, lastIframePosRef.current, iframeStartedAtRef.current);
    };

    // Realtime subscription — only subscribe if the queue row is still
    // pending. If it's already 'done', R2 just hasn't propagated yet —
    // the poll below will catch it within HOT_SWAP_POLL_MS, no reason
    // to open a WebSocket channel we'll close seconds later. If it's
    // 'failed', no point subscribing at all.
    if (supabase) {
      const checkAndSubscribe = async () => {
        try {
          const { data } = await supabase!
            .from('voyo_upload_queue')
            .select('status')
            .eq('youtube_id', trackId)
            .limit(1);
          const rowStatus = data?.[0]?.status;
          // Only RT-subscribe for pending / in-flight rows. 'done' →
          // poll alone handles the quick R2-propagation window.
          // 'failed' → RT won't fire anyway.
          if (rowStatus && rowStatus !== 'pending' && rowStatus !== 'extracting') {
            return;
          }
        } catch { /* non-fatal, fall through to RT */ }
        channelRef.current = supabase!
          .channel(`hotswap:${trackId}`)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'voyo_upload_queue',
            filter: `youtube_id=eq.${trackId}`,
          }, (payload: { new?: { status?: string } }) => {
            if (payload.new?.status === 'done') trigger('realtime');
          })
          .subscribe();
      };
      void checkAndSubscribe();
    }

    // Poll safety net — fires if realtime drops or never subscribes.
    // Silent: success = performHotSwap's 'hotswap' trace covers it.
    // Paused while the tab is hidden (BG battery saver): hot-swap visual
    // doesn't matter when there's no visible UI; the next foreground tick
    // re-arms the interval and catches any lane completion from the gap.
    const startPoll = () => {
      if (pollRef.current != null) return;
      pollRef.current = setInterval(async () => {
        if (usePlayerStore.getState().currentTrack?.trackId !== trackId) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        const has = await r2HasTrack(trackId);
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
      if (snapRef.current) { clearInterval(snapRef.current); snapRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [playbackSource, currentTrack?.trackId, audioRef]);
}
