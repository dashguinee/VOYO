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
import { unlockMobileAudio, isAudioUnlocked } from '../utils/mobileAudioUnlock';
import { devWarn } from '../utils/logger';

/**
 * Get the global audio element used by AudioPlayer
 */
function getAudioElement(): HTMLAudioElement | null {
  return document.querySelector('audio');
}

/**
 * Get the global video element used by AudioPlayer
 */
function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video');
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
        element.pause();
        togglePlay();
      } catch (err) {
        // Fallback: still toggle state
        togglePlay();
      }
    } else {
      // Play - DIRECTLY in user gesture handler
      try {
        // Check if element has a source
        if (!element.src || element.src === '') {
          togglePlay();
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
   * Force play (use when you're certain there's a valid source)
   */
  const forcePlay = useCallback(async () => {
    const element = getAudioElement();
    if (!element) return false;

    if (!isAudioUnlocked()) {
      await unlockMobileAudio();
    }

    try {
      await element.play();
      return true;
    } catch (err) {
      return false;
    }
  }, []);

  /**
   * Check if we can play (has source and ready)
   */
  const canPlay = useCallback(() => {
    const element = getAudioElement();
    return element && element.src && element.readyState >= 2;
  }, []);

  return {
    handlePlayPause,
    forcePlay,
    canPlay,
    isUnlocked: isAudioUnlocked(),
  };
}
