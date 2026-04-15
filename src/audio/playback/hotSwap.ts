/**
 * Hot-Swap — mid-track R2 → cached upgrade.
 *
 * When a boost download completes for the CURRENTLY-playing track, we
 * upgrade from streaming (R2/edge) to local IndexedDB blob seamlessly.
 * Muted via masterGain during the swap, current position preserved.
 *
 * GUARDS:
 *   - Only swaps if currently on r2 or (cached+isEdgeStreamRef) — don't
 *     re-swap a track already on local cache.
 *   - Skips if >35% through the track — the 100-300ms swap gap would be
 *     audible, and the cache is ready for the NEXT play regardless.
 *   - AbortController: a new hot-swap (or track change) aborts any
 *     in-flight swap mid-fetch.
 */

import { useEffect, useRef, RefObject } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { devLog } from '../../utils/logger';
import type { Track } from '../../types';
import type { BoostPreset } from '../../components/AudioPlayer';

interface UseHotSwapParams {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioContextRef: RefObject<AudioContext | null>;
  cachedUrlRef: RefObject<string | null>;
  isEdgeStreamRef: RefObject<boolean>;
  lastBoostCompletion: { trackId: string } | null;
  currentTrack: Track | null;
  playbackSource: string | null;
  checkCache: (trackId: string) => Promise<string | null>;
  setPlaybackSource: (src: any) => void;
  setupAudioEnhancement: (profile: BoostPreset) => void;
  muteMasterGainInstantly: () => void;
  fadeInMasterGain: (durationMs?: number) => void;
}

export function useHotSwap(params: UseHotSwapParams) {
  const {
    audioRef,
    audioContextRef,
    cachedUrlRef,
    isEdgeStreamRef,
    lastBoostCompletion,
    currentTrack,
    playbackSource,
    checkCache,
    setPlaybackSource,
    setupAudioEnhancement,
    muteMasterGainInstantly,
    fadeInMasterGain,
  } = params;

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!lastBoostCompletion || !currentTrack?.trackId) return;

    const completedId = lastBoostCompletion.trackId;
    const currentId = currentTrack.trackId.replace('VOYO_', '');
    const isMatch = completedId === currentId || completedId === currentTrack.trackId;
    if (!isMatch) return;
    if (playbackSource !== 'r2' && !(playbackSource === 'cached' && isEdgeStreamRef.current)) return;

    // >35% through the track → skip. The gap would be audible, and the
    // cache will be used on the next play of this track anyway.
    const progress = usePlayerStore.getState().progress;
    if (progress > 35) {
      devLog(`[hotSwap] skipped — ${progress.toFixed(0)}% played`);
      return;
    }

    // Cancel any previous swap.
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    const swapTrackId = currentTrack.trackId;

    const run = async () => {
      if (signal.aborted) return;
      const cachedUrl = await checkCache(currentTrack.trackId);
      if (signal.aborted) return;

      // Track may have changed during the async await.
      if (usePlayerStore.getState().currentTrack?.trackId !== swapTrackId) return;
      if (!cachedUrl || !audioRef.current) return;

      const currentPos = usePlayerStore.getState().currentTime;

      if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
      cachedUrlRef.current = cachedUrl;

      const { boostProfile: profile } = usePlayerStore.getState();
      setupAudioEnhancement(profile);

      // Clear dangling handlers from any previous load path before swap.
      audioRef.current.oncanplaythrough = null;
      audioRef.current.oncanplay = null;
      audioRef.current.onplay = null;

      // Click-free swap via Web Audio gain ramp (not audio.volume).
      muteMasterGainInstantly();
      audioRef.current.src = cachedUrl;
      audioRef.current.load();

      audioRef.current.oncanplaythrough = () => {
        if (signal.aborted || !audioRef.current) return;

        if (currentPos > 2) audioRef.current.currentTime = currentPos;

        const { isPlaying: shouldPlayNow } = usePlayerStore.getState();

        if (shouldPlayNow && (audioRef.current.paused || document.hidden)) {
          audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            isEdgeStreamRef.current = false;
            setPlaybackSource('cached');
            devLog('🔄 [hotSwap] complete — now playing boosted cached audio');
          }).catch((err) => {
            devLog('[hotSwap] play failed:', err);
          });
        } else if (!shouldPlayNow) {
          setPlaybackSource('cached');
        }
      };
    };
    run();

    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
    // isPlaying and playbackSource intentionally excluded — including
    // them re-fires this effect on every play/pause, aborting any
    // in-flight swap and leaving half-loaded state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBoostCompletion, currentTrack?.trackId, checkCache, setPlaybackSource, setupAudioEnhancement]);
}
