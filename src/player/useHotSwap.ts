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
import type { Track } from '../types';

const R2_AUDIO = 'https://voyo-edge.dash-webtv.workers.dev/audio';
const HOT_SWAP_POLL_MS = 5_000;
const HOT_SWAP_FADE_MS = 450;

/**
 * Probe R2 for a track. 200 = cached, anything else = not yet.
 */
async function r2HasTrack(trackId: string): Promise<boolean> {
  try {
    const res = await fetch(`${R2_AUDIO}/${trackId}?q=high`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Perform the cross-fade. Pure-ish — reads the iframe bridge, mutates the
 * audio element, flips playbackSource at the end.
 */
async function performHotSwap(
  trackId: string,
  el: HTMLAudioElement,
  snapshot: { trackId: string; seconds: number } | null,
): Promise<void> {
  const storeVol = usePlayerStore.getState().volume;

  // Position priority: live iframe → snapshot → cold restart.
  let t = iframeBridge.getCurrentTime();
  let posSource: 'live' | 'snapshot' | 'cold' = 'live';
  if (t == null || !isFinite(t)) {
    if (snapshot && snapshot.trackId === trackId && snapshot.seconds > 0) {
      t = snapshot.seconds;
      posSource = 'snapshot';
    }
  }
  if (t == null || !isFinite(t)) {
    el.src = `${R2_AUDIO}/${trackId}?q=high`;
    el.volume = storeVol;
    el.play().catch(() => {});
    usePlayerStore.getState().setPlaybackSource('r2');
    iframeBridge.pause();
    iframeBridge.resetVolume();
    logPlaybackEvent({ event_type: 'trace', track_id: trackId, meta: { subtype: 'hotswap', mode: 'cold' } });
    return;
  }

  // Preload R2 silently at the iframe's timestamp.
  el.src = `${R2_AUDIO}/${trackId}?q=high`;
  try { el.currentTime = t; } catch {}
  el.volume = 0;
  await new Promise<void>((resolve) => {
    const onReady = () => { el.removeEventListener('canplay', onReady); resolve(); };
    el.addEventListener('canplay', onReady);
    setTimeout(() => { el.removeEventListener('canplay', onReady); resolve(); }, 2500);
  });
  try { el.currentTime = t; } catch {}
  await el.play().catch(() => {});

  // Cross-fade: iframe volume 100→0 while audio element volume 0→storeVol.
  const steps = 15;
  const stepMs = Math.max(1, Math.round(HOT_SWAP_FADE_MS / steps));
  const iframeFade = iframeBridge.fadeOut(HOT_SWAP_FADE_MS);
  for (let i = 1; i <= steps; i++) {
    el.volume = Math.min(storeVol, storeVol * (i / steps));
    await new Promise((r) => setTimeout(r, stepMs));
  }
  await iframeFade;

  iframeBridge.pause();
  iframeBridge.resetVolume();
  el.volume = storeVol;
  usePlayerStore.getState().setPlaybackSource('r2');

  logPlaybackEvent({
    event_type: 'trace',
    track_id: trackId,
    meta: { subtype: 'hotswap', mode: posSource === 'snapshot' ? 'resume_snapshot' : 'faded', at_seconds: Math.round(t) },
  });
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

  // Watcher setup — fires on every iframe-mode track.
  useEffect(() => {
    if (playbackSource !== 'iframe' || !currentTrack) return;
    const trackId = currentTrack.trackId;

    // Start snapshot ticker — 1s cadence, writes last-known iframe position.
    snapRef.current = setInterval(() => {
      const t = iframeBridge.getCurrentTime();
      if (t != null && isFinite(t) && t > 0) {
        lastIframePosRef.current = { trackId, seconds: t };
      }
    }, 1000);

    // Unified trigger — whichever watcher fires first wins, both clear.
    const trigger = (reason: string) => {
      if (usePlayerStore.getState().currentTrack?.trackId !== trackId) return;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      devLog(`[useHotSwap] trigger (${reason}) for ${trackId}`);
      const el = audioRef.current;
      if (!el) return;
      void performHotSwap(trackId, el, lastIframePosRef.current);
    };

    // Realtime subscription — primary path, ~instant when queue row flips.
    if (supabase) {
      channelRef.current = supabase
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

    // 5s poll — safety net in case realtime drops or never fires.
    let pollTicks = 0;
    pollRef.current = setInterval(async () => {
      if (usePlayerStore.getState().currentTrack?.trackId !== trackId) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        return;
      }
      pollTicks++;
      const has = await r2HasTrack(trackId);
      if (has || pollTicks % 4 === 0) {
        logPlaybackEvent({
          event_type: 'trace', track_id: trackId,
          meta: { subtype: 'hotswap_poll_tick', ticks: pollTicks, r2_hit: has },
        });
      }
      if (has) trigger('poll');
    }, HOT_SWAP_POLL_MS);

    return () => {
      if (snapRef.current) { clearInterval(snapRef.current); snapRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [playbackSource, currentTrack?.trackId, audioRef]);
}
