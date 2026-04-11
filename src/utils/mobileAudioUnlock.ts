/**
 * Mobile Audio Unlock Utility
 *
 * iOS/Android require audio to be triggered from a user gesture.
 * This utility unlocks the audio pipeline on first user interaction.
 *
 * CRITICAL FIX: Previously this created its OWN AudioContext separate
 * from the one in audioEngine.ts → two contexts on the same page → CPU
 * competition + iOS context limit hits (typically 4-6 per page) + thread
 * thrashing. Now we reuse the singleton from audioEngine.ts. If the
 * singleton doesn't exist yet, we DON'T create one — we just mark unlocked
 * and let connectAudioChain() handle creation when called from a real
 * user gesture (which it will be, since track loads happen from a tap).
 */

import { getAudioContext } from '../services/audioEngine';

let audioUnlocked = false;

export function unlockMobileAudio(): Promise<void> {
  if (audioUnlocked) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      // Reuse the audioEngine singleton if it exists
      const ctx = getAudioContext();
      if (ctx) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        // Play a 1-sample silent buffer to satisfy iOS gesture requirement
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      }
      // If singleton doesn't exist yet, do nothing — connectAudioChain
      // will create it on the next track load (which happens from a user
      // gesture, satisfying iOS unlock requirements organically).
      audioUnlocked = true;
      resolve();
    } catch {
      audioUnlocked = true;
      resolve();
    }
  });
}

export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints > 0 && /Mobi|Touch/i.test(navigator.userAgent));
}

export function setupMobileAudioUnlock(): void {
  const unlockHandler = () => {
    unlockMobileAudio();
    document.removeEventListener('touchstart', unlockHandler);
    document.removeEventListener('click', unlockHandler);
  };

  document.addEventListener('touchstart', unlockHandler, { once: true, passive: true });
  document.addEventListener('click', unlockHandler, { once: true });
}
