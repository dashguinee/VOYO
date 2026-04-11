/**
 * useOyoInvocation
 * ----------------
 * The single React hook nav surfaces use to summon OYO.
 *
 * Pattern:
 *   const { isInvoked, invoke, dismiss, bindLongPress } = useOyoInvocation();
 *
 *   // Spread bindLongPress onto a button to make it summon OYO on long press
 *   // while preserving its normal onClick handler:
 *   <button onClick={normalTap} {...bindLongPress('home')}>VOYO</button>
 *
 * Long-press threshold: 600ms. Below that, the bind() handlers stay out
 * of the way and let the existing onClick fire normally. Past 600ms the
 * tap is "consumed" — onClick is suppressed and OYO is invoked.
 */

import { useCallback, useRef } from 'react';
import { useOyoStore } from '../store/oyoStore';
import type { InvocationSurface } from '../store/oyoStore';

const LONG_PRESS_MS = 600;

export interface LongPressBindings {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
}

export function useOyoInvocation() {
  const isInvoked = useOyoStore((s) => s.isInvoked);
  const surface = useOyoStore((s) => s.surface);
  const thinking = useOyoStore((s) => s.thinking);
  const invocationKey = useOyoStore((s) => s.invocationKey);
  const invoke = useOyoStore((s) => s.invoke);
  const dismiss = useOyoStore((s) => s.dismiss);
  const setThinking = useOyoStore((s) => s.setThinking);

  // Per-instance long-press state. Refs avoid re-renders on every press.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedRef = useRef<boolean>(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * bindLongPress(surface) returns a set of pointer handlers + a click
   * capture that suppresses normal onClick if the long-press threshold
   * was crossed. Spread the result onto a button alongside its normal
   * onClick to add OYO summoning without breaking the existing tap.
   */
  const bindLongPress = useCallback(
    (forSurface: InvocationSurface): LongPressBindings => ({
      onPointerDown: () => {
        consumedRef.current = false;
        clearTimer();
        timerRef.current = setTimeout(() => {
          consumedRef.current = true;
          // Light haptic if available — feels like the device "locked in"
          try {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(12);
            }
          } catch {
            /* non-fatal */
          }
          invoke(forSurface);
        }, LONG_PRESS_MS);
      },
      onPointerUp: () => {
        clearTimer();
      },
      onPointerLeave: () => {
        clearTimer();
        // Don't reset consumed — if they slid off after the threshold
        // already fired, the click capture should still suppress.
      },
      onPointerCancel: () => {
        clearTimer();
        consumedRef.current = false;
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (consumedRef.current) {
          // Long-press already fired. Eat the click so the existing
          // onClick (which would do the normal nav action) doesn't run.
          e.preventDefault();
          e.stopPropagation();
          consumedRef.current = false;
        }
      },
    }),
    [clearTimer, invoke],
  );

  return {
    isInvoked,
    surface,
    thinking,
    invocationKey,
    invoke,
    dismiss,
    setThinking,
    bindLongPress,
  };
}
