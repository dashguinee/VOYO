/**
 * Preload Trigger — fires preloadNextTrack for the next 2-3 upcoming
 * tracks whenever the current track changes. Key to gapless playback:
 * by the time the current track ends, the next one is already decoded
 * into IndexedDB. sourceResolver picks it up instantly, BG transitions
 * become network-free blob swaps.
 *
 * KEY INVARIANT (v196 fix): dedup by trackId, not by a boolean flag.
 * React effect ordering means any async-reset flag races with the
 * preload effect re-running → preload only fires for track 1 of the
 * session. Per-trackId dedup has no timing dependency.
 *
 * Upcoming tracks: queue first, then predictUpcoming fallback. Stagger
 * the preloads (1.5s, 6s, 12s in FG; 0, 2s, 5s in BG) so they don't
 * compete with the current track's decoder spinning up.
 */

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { preloadNextTrack } from '../../services/preloadManager';
import { devLog, devWarn } from '../../utils/logger';
import type { Track } from '../../types';

interface UsePreloadTriggerParams {
  currentTrack: Track | null;
  queue: { track: Track | null }[];
  checkCache: (trackId: string) => Promise<string | null>;
  /** v214 — N-deep upcoming predictor. Used as discover-pool fallback when queue is thin. */
  predictUpcoming: (n?: number) => Track[];
}

export function usePreloadTrigger(params: UsePreloadTriggerParams) {
  const { currentTrack, queue, checkCache, predictUpcoming } = params;

  // Per-trackId dedup — the one ref that survives every React effect race.
  const preloadedForTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTrack?.trackId) return;
    if (preloadedForTrackIdRef.current === currentTrack.trackId) return;
    preloadedForTrackIdRef.current = currentTrack.trackId;

    // Gather upcoming: queue first, then N-deep prediction to fill.
    // v214 — deep predict. Previously this fell back to ONE predictNextTrack()
    // call, so if queue was empty we only preloaded 1 track ahead. If the user
    // skipped rapidly, the cold path hit every other skip. predictUpcoming(3)
    // returns up to 3 non-duplicate candidates from the discover pool using
    // the same filter as nextTrack, so by the time we pick [0] to play,
    // [1] and [2] are already warming in IDB.
    const upcoming: Track[] = [];
    const seen = new Set<string>();
    for (const qi of queue) {
      if (qi.track?.trackId && !seen.has(qi.track.trackId)) {
        upcoming.push(qi.track);
        seen.add(qi.track.trackId);
        if (upcoming.length >= 3) break;
      }
    }
    if (upcoming.length < 3) {
      const needed = 3 - upcoming.length;
      const predicted = predictUpcoming(needed);
      for (const t of predicted) {
        if (t.trackId && !seen.has(t.trackId)) {
          upcoming.push(t);
          seen.add(t.trackId);
          if (upcoming.length >= 3) break;
        }
      }
    }
    if (upcoming.length === 0) {
      devLog(`🔮 [preload] no upcoming tracks`);
      return;
    }

    // Stagger: 300ms/6s/12s in FG. Fire early (300ms not 1.5s) to maximise
    // VPS extraction lead time — every extra second matters on cold tracks.
    // In BG, fire first preload immediately (setTimeout throttled to 1/min).
    const delays = document.hidden ? [0, 2000, 5000] : [300, 6000, 12000];
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];
    upcoming.forEach((track, index) => {
      const delay = delays[index] || delays[delays.length - 1];
      const tid = setTimeout(() => {
        // Double-check: the user hasn't skipped away from the track that
        // triggered this preload batch.
        if (usePlayerStore.getState().currentTrack?.trackId !== currentTrack.trackId) return;
        preloadNextTrack(track.trackId, checkCache)
          .then(r => { if (r) devLog(`🔮 [preload] ready: ${track.title} (${r.source})`); })
          .catch(err => { devWarn(`🔮 [preload] failed:`, err); });
      }, delay);
      timeoutIds.push(tid);
    });
    return () => timeoutIds.forEach(clearTimeout);
  }, [currentTrack?.trackId, queue, checkCache, predictUpcoming]);

  // NOTE: cancelPreload() on track-change removed. It was killing the very
  // preload about to be consumed by the new track (N→N+1 transition aborted
  // N+1's in-flight VPS preload). Preloads now persist until consumed or
  // evicted by evictOldPreloads() (MAX=3 tracks). The per-track dedup and
  // vpsPreloadInFlight cap prevent runaway concurrent extractions.
}

