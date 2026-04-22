/**
 * Wake Lock — keeps the screen awake (so the device doesn't deep-sleep)
 * while audio is playing. Screen Wake Lock API is widely supported on
 * Chrome Android + iOS 16.4+.
 *
 * Only requests while isPlaying. Releases when paused. Cleans up on
 * unmount. Silent on unsupported browsers.
 */

import { useEffect, useRef } from 'react';
import { devWarn } from '../../utils/logger';

export function useWakeLock(isPlaying: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    const manage = async () => {
      if (!isPlaying && wakeLockRef.current) {
        await wakeLockRef.current.release().catch(e => devWarn('🔒 [WakeLock] release failed:', e.name));
        wakeLockRef.current = null;
        return;
      }
      if (isPlaying && 'wakeLock' in navigator && !wakeLockRef.current) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } catch (e) {
          devWarn('🔒 [WakeLock] request failed:', (e as Error).name);
        }
      }
    };
    manage();
    return () => {
      wakeLockRef.current?.release().catch(e => devWarn('🔒 [WakeLock] cleanup failed:', e.name));
    };
  }, [isPlaying]);
}
