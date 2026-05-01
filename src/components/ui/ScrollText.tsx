/**
 * ScrollText — premium scroll-to-reveal for long labels.
 *
 * After `delay`ms (default 5000):
 *   1. If content overflows → slides to the end at a calm pace
 *   2. Pauses at the end so the full text can be read
 *   3. Eases back to the start with a gentle spring settle
 *
 * Resets whenever `text` changes (track change). Does nothing if the
 * text fits — no DOM thrash, no animation, zero cost.
 */

import { useRef, useEffect, CSSProperties } from 'react';

interface ScrollTextProps {
  text: string;
  style?: CSSProperties;
  className?: string;
  /** ms to wait before first scroll after text appears. Default: 5000 */
  delay?: number;
  /** px/s scroll pace — lower = more unhurried. Default: 38 */
  pace?: number;
  /** ms to hold at the far end before returning. Default: 1400 */
  holdMs?: number;
}

export const ScrollText = ({
  text,
  style,
  className,
  delay = 5000,
  pace = 38,
  holdMs = 1400,
}: ScrollTextProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancelAll = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    // Snap back to start without transition on new text
    inner.style.transition = 'none';
    inner.style.transform = 'translateX(0)';
    cancelAll();

    const t0 = setTimeout(() => {
      if (!container || !inner) return;
      const overflow = inner.scrollWidth - container.offsetWidth;
      if (overflow <= 4) return;

      // Scroll duration scales with overflow so short titles scroll quicker
      // than very long ones — keeps the pace consistent.
      const scrollMs = Math.round((overflow / pace) * 1000);
      // Return slightly faster (spring settle reads as intentional, not a rewind)
      const returnMs = Math.round(Math.min(scrollMs * 0.65, 2200));

      // Slide to end — ease-in-out so it starts gently and brakes into place
      inner.style.transition = `transform ${scrollMs}ms cubic-bezier(0.45, 0, 0.55, 1)`;
      inner.style.transform = `translateX(-${overflow}px)`;

      // Hold, then return with a spring-out settle
      const t1 = setTimeout(() => {
        if (!inner) return;
        inner.style.transition = `transform ${returnMs}ms cubic-bezier(0.16, 1, 0.3, 1)`;
        inner.style.transform = 'translateX(0)';
      }, scrollMs + holdMs);

      timersRef.current.push(t1);
    }, delay);

    timersRef.current.push(t0);
    return cancelAll;
  }, [text, delay, pace, holdMs]);

  return (
    <div ref={containerRef} style={{ overflow: 'hidden', ...style }} className={className}>
      <div ref={innerRef} style={{ whiteSpace: 'nowrap', display: 'inline-block' }}>
        {text}
      </div>
    </div>
  );
};
