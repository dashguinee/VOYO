/**
 * Mobile Audio Unlock Utility
 *
 * iOS/Android require audio to be triggered from a user gesture.
 * This utility unlocks the audio pipeline on first user interaction.
 */

let audioUnlocked = false;
let audioContext: AudioContext | null = null;

export function unlockMobileAudio(): Promise<void> {
  if (audioUnlocked) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        audioUnlocked = true;
        resolve();
        return;
      }

      audioContext = new AudioContextClass();

      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      // Play silent buffer to unlock
      const buffer = audioContext.createBuffer(1, 1, 22050);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start(0);

      audioUnlocked = true;
      resolve();
    } catch (e) {
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
