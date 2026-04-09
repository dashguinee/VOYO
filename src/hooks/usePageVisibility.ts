/**
 * Page Visibility Hook for Battery Optimization
 * Pauses expensive operations when tab is hidden
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(!document.hidden);

  useEffect(() => {
    const handleVisibility = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return isVisible;
}

/**
 * Returns animation state based on page visibility
 * Use with framer-motion: animate={shouldAnimate ? {...} : undefined}
 */
export function useAnimationPause(): boolean {
  return usePageVisibility();
}

/**
 * Visibility-aware interval that pauses when tab is hidden.
 * Prevents timers from running in background and draining battery.
 */
export function useVisibilityInterval(
  callback: () => void,
  delay: number | null,
): void {
  const savedCallback = useRef(callback);
  const isVisible = usePageVisibility();

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null || !isVisible) return;

    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay, isVisible]);
}

/**
 * Visibility-aware requestAnimationFrame that auto-pauses when hidden.
 * Returns a ref to the running state for manual control.
 */
export function useVisibilityRAF(
  callback: (time: number) => void,
  enabled: boolean = true,
): void {
  const savedCallback = useRef(callback);
  const isVisible = usePageVisibility();

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !isVisible) return;

    let rafId: number;
    const animate = (time: number) => {
      savedCallback.current(time);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafId);
  }, [enabled, isVisible]);
}
