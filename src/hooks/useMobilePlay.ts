/**
 * Mobile Play Hook
 *
 * Provides direct audio playback control that works with mobile autoplay restrictions.
 * On mobile, audio.play() MUST be called directly in a user gesture handler.
 *
 * Usage:
 * const { handlePlayPause } = useMobilePlay();
 * <button onClick={handlePlayPause}>Play</button>
 */

import { useCallback } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { voyoStream } from '../services/voyoStream';
import { unlockMobileAudio, isAudioUnlocked } from '../utils/mobileAudioUnlock';
import { devLog, devWarn } from '../utils/logger';

/**
 * Get the global audio element used by AudioPlayer
 */
function getAudioElement(): HTMLAudioElement | null {
  return document.querySelector('audio');
}

export function useMobilePlay() {
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);

  /**
   * Handle play/pause with mobile-compatible direct audio control.
   * Call this DIRECTLY in your onClick handler.
   */
  const handlePlayPause = useCallback(async (e?: React.MouseEvent | React.TouchEvent) => {
    // Prevent event bubbling if needed
    e?.stopPropagation?.();

    // Always use audio element (for cached mode) - iframe mode controlled via YT API
    const element = getAudioElement();

    // If no audio element yet, just toggle state and let AudioPlayer handle it
    if (!element) {
      togglePlay();
      return;
    }

    // Unlock audio if needed (this is a user gesture context)
    if (!isAudioUnlocked()) {
      await unlockMobileAudio();
    }

    // FIX: Get fresh state to avoid race conditions
    const currentState = usePlayerStore.getState().isPlaying;

    if (currentState) {
      // Pause - this always works
      try {
        voyoStream.intentionalPause = true;
        element.pause();
        togglePlay();
      } catch (err) {
        // Fallback: still toggle state
        togglePlay();
      }
    } else {
      // Play - DIRECTLY in user gesture handler
      try {
        // No active session yet (first-song tap on a staged track, or after
        // session was ended without starting a new one). Start the session
        // NOW — we are inside a user gesture so play() will be allowed.
        if (!element.src || element.src === '') {
          const store = usePlayerStore.getState();
          const currentTrack = store.currentTrack;
          if (!currentTrack) {
            // Nothing staged — just flip the UI state and let AudioPlayer sort it
            togglePlay();
            return;
          }
          devLog('[useMobilePlay] No src — starting session from user gesture');
          // Mark as playing immediately so the UI responds
          store.setIsPlaying(true);
          const queueTracks = store.queue.map(qi => qi.track);
          // startSession calls audioEl.play() internally after setting src.
          // Since we are in a user gesture context the play() will succeed.
          voyoStream.startSession(currentTrack, queueTracks).catch(e => {
            devWarn('[useMobilePlay] startSession failed:', e);
            store.setIsPlaying(false);
          });
          return;
        }

        // Try to play directly - wait for promise to resolve
        await element.play();

        // Update state only after successful play
        const newState = usePlayerStore.getState().isPlaying;
        if (!newState) {
          togglePlay();
        }

      } catch (err: any) {
        if (err.name === 'NotAllowedError') {
          // Autoplay was blocked - try again on next tap
          devWarn('[VOYO] Autoplay blocked - user interaction required');
        } else if (err.name === 'AbortError') {
          // Play was interrupted (user paused quickly) - ignore
          return;
        }

        // Still toggle state so UI stays in sync
        togglePlay();
      }
    }
  }, [togglePlay]);

  /**
   * Check if we can play (has source and ready)
   */
  const canPlay = useCallback(() => {
    const element = getAudioElement();
    return element && element.src && element.readyState >= 2;
  }, []);

  return {
    handlePlayPause,
    canPlay,
    isUnlocked: isAudioUnlocked(),
  };
}
