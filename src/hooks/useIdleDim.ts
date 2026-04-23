import { useEffect, useRef, useState } from 'react';

/**
 * useIdleDim — gentle ambient dim after user inactivity.
 *
 * Returns dimLevel:
 *   0 — active (any input within last 30s)
 *   1 — soft (30–60s idle)
 *   2 — full (60s+ idle)
 *
 * Any pointer / keyboard / scroll / touch / wheel event resets to 0.
 * Respects prefers-reduced-motion (stays at 0 permanently).
 * Disabled when `disabled=true` (caller passes true for video mode, etc.).
 */
export function useIdleDim(opts: { disabled?: boolean } = {}): { dimLevel: 0 | 1 | 2 } {
  const [dimLevel, setDimLevel] = useState<0 | 1 | 2>(0);
  const lastInteractionRef = useRef<number>(Date.now());
  const lastUpdateRef = useRef<number>(0);
  const { disabled = false } = opts;

  useEffect(() => {
    if (disabled) {
      setDimLevel(0);
      return;
    }
    if (typeof window === 'undefined') return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setDimLevel(0);
      return;
    }

    const touch = () => {
      const now = Date.now();
      // Throttle writes — at most one per 500ms.
      if (now - lastUpdateRef.current < 500) return;
      lastUpdateRef.current = now;
      lastInteractionRef.current = now;
      setDimLevel(prev => (prev === 0 ? prev : 0));
    };

    const events: Array<keyof WindowEventMap> = [
      'pointermove',
      'pointerdown',
      'keydown',
      'scroll',
      'touchstart',
      'wheel',
    ];
    for (const ev of events) {
      window.addEventListener(ev, touch, { passive: true });
    }

    const interval = setInterval(() => {
      const idleMs = Date.now() - lastInteractionRef.current;
      const next: 0 | 1 | 2 = idleMs > 60_000 ? 2 : idleMs > 30_000 ? 1 : 0;
      setDimLevel(prev => (prev === next ? prev : next));
    }, 5000);

    return () => {
      for (const ev of events) window.removeEventListener(ev, touch);
      clearInterval(interval);
    };
  }, [disabled]);

  return { dimLevel };
}
