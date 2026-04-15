/**
 * MediaSession — OS-level lock screen + hardware button integration.
 *
 * Registers metadata + action handlers on `navigator.mediaSession` whenever
 * the track changes. Survives throughout the app lifecycle — the OS keeps
 * our session registered as long as we're the audio authority (last tab
 * to call setPositionState wins globally per origin, which our heartbeat
 * ensures in bgEngine).
 *
 * Artwork: primary from our edge worker (custom art), fallback to YouTube.
 * Action handlers read fresh state via usePlayerStore.getState() — closures
 * live for a long time and would otherwise capture stale isPlaying/trackId.
 *
 * Seek handlers route to the audio element directly. In BG, skip the
 * mute→seek→fade cycle (inaudible anyway; setTimeout throttled to 1/min).
 */

import { useEffect, RefObject } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { trace } from '../../services/telemetry';
import type { Track } from '../../types';

const EDGE_ART = 'https://voyo-edge.dash-webtv.workers.dev/cdn/art';
const YT_ART = 'https://i.ytimg.com/vi';

function artworkFor(trackId: string) {
  const edge = `${EDGE_ART}/${trackId}?quality=high`;
  const yt = `${YT_ART}/${trackId}/hqdefault.jpg`;
  return [
    { src: edge, sizes: '96x96',   type: 'image/jpeg' },
    { src: edge, sizes: '192x192', type: 'image/jpeg' },
    { src: edge, sizes: '384x384', type: 'image/jpeg' },
    { src: edge, sizes: '512x512', type: 'image/jpeg' },
    { src: yt,   sizes: '480x360', type: 'image/jpeg' },
  ];
}

function writeMetadata(track: Track) {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'VOYO Music',
      artwork: artworkFor(track.trackId),
    });
  } catch {}
}

interface UseMediaSessionParams {
  audioRef: RefObject<HTMLAudioElement | null>;
  silentKeeperUrlRef: RefObject<string | null>;
  currentTrack: Track | null;
  isPlaying: boolean;
  togglePlay: () => void;
  nextTrack: () => void;
  muteMasterGainInstantly: () => void;
  fadeInMasterGain: (durationMs?: number) => void;
}

export function useMediaSession(params: UseMediaSessionParams) {
  const {
    audioRef,
    silentKeeperUrlRef,
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    muteMasterGainInstantly,
    fadeInMasterGain,
  } = params;

  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    writeMetadata(currentTrack);

    navigator.mediaSession.setActionHandler('play', () => {
      trace('mediasession_play', usePlayerStore.getState().currentTrack?.trackId, {
        hidden: document.hidden,
        storeIsPlaying: usePlayerStore.getState().isPlaying,
      });
      if (!usePlayerStore.getState().isPlaying) togglePlay();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      trace('mediasession_pause', usePlayerStore.getState().currentTrack?.trackId, {
        hidden: document.hidden,
        storeIsPlaying: usePlayerStore.getState().isPlaying,
      });
      if (usePlayerStore.getState().isPlaying) togglePlay();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      const nowId = usePlayerStore.getState().currentTrack?.trackId;
      trace('mediasession_next', nowId, { hidden: document.hidden });
      // Pre-advance bridge: engage silent WAV before nextTrack() so the
      // React reconciliation window doesn't become an idle gap. Same
      // pattern as runEndedAdvance's BG path.
      if (document.hidden && silentKeeperUrlRef.current && audioRef.current) {
        try {
          audioRef.current.loop = true;
          audioRef.current.src = silentKeeperUrlRef.current;
          audioRef.current.play().catch(() => {});
          trace('silent_wav_engage', nowId, { why: 'mediasession_next_bridge' });
        } catch {}
      }
      nextTrack();
      // Signal OS immediately: playing + zero position. Otherwise the OS
      // may see the old track's final position hanging and drop the
      // notification during extraction delay.
      navigator.mediaSession.playbackState = 'playing';
      try { navigator.mediaSession.setPositionState({ duration: 0, position: 0, playbackRate: 1 }); } catch {}
      const next = usePlayerStore.getState().currentTrack;
      if (next) writeMetadata(next);
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      usePlayerStore.getState().prevTrack();
      navigator.mediaSession.playbackState = 'playing';
      const prev = usePlayerStore.getState().currentTrack;
      if (prev) writeMetadata(prev);
    });

    const seekOffset = (dir: 1 | -1, offset: number) => {
      if (!audioRef.current) return;
      const newTime = Math.max(0, Math.min(
        audioRef.current.duration || 0,
        audioRef.current.currentTime + dir * offset,
      ));
      if (document.hidden) {
        audioRef.current.currentTime = newTime;
      } else {
        muteMasterGainInstantly();
        audioRef.current.currentTime = newTime;
        setTimeout(() => fadeInMasterGain(80), 30);
      }
    };
    navigator.mediaSession.setActionHandler('seekforward', (d) => seekOffset(1, d.seekOffset || 10));
    navigator.mediaSession.setActionHandler('seekbackward', (d) => seekOffset(-1, d.seekOffset || 10));
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (d.seekTime === undefined || !audioRef.current) return;
      if (document.hidden) {
        audioRef.current.currentTime = d.seekTime;
      } else {
        muteMasterGainInstantly();
        audioRef.current.currentTime = d.seekTime;
        setTimeout(() => fadeInMasterGain(80), 30);
      }
    });

    // OS widgets and Bluetooth controls sometimes fire 'stop' instead of
    // 'pause'. Treat it as pause (don't destroy the audio element or queue).
    try {
      navigator.mediaSession.setActionHandler('stop', () => {
        if (usePlayerStore.getState().isPlaying) togglePlay();
      });
    } catch {}

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying, togglePlay, nextTrack, audioRef, silentKeeperUrlRef, muteMasterGainInstantly, fadeInMasterGain]);
}
