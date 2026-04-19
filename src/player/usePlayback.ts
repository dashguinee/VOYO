/**
 * usePlayback — the ONE hook UI components call to control playback.
 *
 * Every surface — home card taps, search results, queue items, skip buttons,
 * portrait swipes, mobile gestures, media keys — should route through this
 * hook. UI doesn't touch playerStore directly for playback actions, doesn't
 * know about voyoStream, r2Gate, ensureTrackReady, or the iframe fallback.
 *
 * Contract:
 *   play(track)         start playing the given track (replaces current)
 *   pause()             soft pause (UI shows play icon)
 *   resume()            resume from current position
 *   togglePlay()        idempotent play/pause
 *   next()              advance (drains queue, else OYO pick)
 *   prev()              back one
 *   addToQueue(track)   append to user queue (the "Next up" list)
 *   seek(seconds)       scrub
 *
 *   currentTrack, isPlaying, currentTime, duration, queue, playbackSource
 *
 * Internally wraps playerStore actions with the side effects the player
 * layer cares about: setting isPlaying, firing ensureTrackReady for
 * explicit user-waiting intent (priority=10), etc. AudioPlayer's track-
 * change useEffect still handles the R2-first probe and iframe branching.
 */

import { useMemo } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { ensureTrackReady } from '../services/voyoStream';
import type { Track } from '../types';

export interface Playback {
  // State
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  queue: Track[];
  playbackSource: string | null;

  // Actions
  play: (track: Track) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  addToQueue: (track: Track) => void;
  seek: (seconds: number) => void;
}

export function usePlayback(): Playback {
  const currentTrack    = usePlayerStore(s => s.currentTrack);
  const isPlaying       = usePlayerStore(s => s.isPlaying);
  const currentTime     = usePlayerStore(s => s.currentTime);
  const duration        = usePlayerStore(s => s.duration);
  const queue           = usePlayerStore(s => s.queue);
  const playbackSource  = usePlayerStore(s => s.playbackSource);

  // Actions are stable — pull them once.
  return useMemo<Playback>(() => ({
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    queue: queue.map(q => q.track),
    playbackSource,

    play(track: Track) {
      const store = usePlayerStore.getState();
      store.setCurrentTrack(track);
      store.setIsPlaying(true);
      // Explicit user intent — bump the lane priority so the iframe fallback
      // (if it fires) gets hot-swapped to R2 fast.
      void ensureTrackReady(track, null, { priority: 10 });
    },

    pause() {
      usePlayerStore.getState().setIsPlaying(false);
    },

    resume() {
      usePlayerStore.getState().setIsPlaying(true);
    },

    togglePlay() {
      const s = usePlayerStore.getState();
      s.setIsPlaying(!s.isPlaying);
    },

    next() {
      usePlayerStore.getState().nextTrack();
    },

    prev() {
      usePlayerStore.getState().prevTrack();
    },

    addToQueue(track: Track) {
      usePlayerStore.getState().addToQueue(track);
    },

    seek(seconds: number) {
      const s = usePlayerStore.getState();
      if (typeof s.seekTo === 'function') s.seekTo(seconds);
      else s.setCurrentTime(seconds);
    },
  }), [currentTrack, isPlaying, currentTime, duration, queue, playbackSource]);
}
