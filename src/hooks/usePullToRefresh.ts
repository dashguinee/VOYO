/**
 * usePullToRefresh — pull-down gesture to reload the app
 *
 * Ported from Tivi+ (`hooks/usePullToRefresh.ts`). Detects a downward
 * pull when the user is at the very top of the page (scrollY <= 5),
 * fades in a circular indicator that rotates with pull distance, and
 * triggers `window.location.reload()` once the threshold is crossed.
 *
 * Returns `{ pulling, pullY, refreshing }` for the consuming component
 * to render the indicator. See App.tsx for the canonical UI shape.
 */

import { useEffect, useRef, useState } from 'react';
import { haptics } from '../utils/haptics';

const THRESHOLD = 140;      // px of pull before triggering (was 80 — too sensitive)
const MAX_PULL = 180;       // max visual distance
const MIN_START_DIST = 20;  // ignore small wiggles at start

/**
 * Walk up from the touched element to find the actual scrollable ancestor.
 * In VOYO the scroll happens inside overflow-y containers, not on window.
 */
function findScrollableAncestor(el: Element | null): Element | null {
  let node: Element | null = el;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function usePullToRefresh() {
  const [pulling, setPulling] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const active = useRef(false);
  const scrollContainer = useRef<Element | null>(null);
  // Refs for state read inside touch handlers — the previous version had
  // pullY/refreshing in the useEffect deps, which made the entire effect
  // re-run on every touchmove during a pull gesture. Document-level touch
  // handlers were being removed and re-added 60+ times per second during
  // the pull. Now the effect has [] deps and the handlers read from refs.
  const pullYRef = useRef(0);
  const refreshingRef = useRef(false);
  pullYRef.current = pullY;
  refreshingRef.current = refreshing;

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      const container = findScrollableAncestor(e.target as Element);
      scrollContainer.current = container;
      const scrollTop = container ? container.scrollTop : window.scrollY;
      if (scrollTop > 2) {
        active.current = false;
        return;
      }
      startY.current = e.touches[0].clientY;
      active.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!active.current || refreshingRef.current) return;

      const container = scrollContainer.current;
      const scrollTop = container ? container.scrollTop : window.scrollY;
      if (scrollTop > 2) {
        active.current = false;
        setPulling(false);
        setPullY(0);
        return;
      }

      const dy = e.touches[0].clientY - startY.current;
      if (dy < 0) { active.current = false; setPulling(false); setPullY(0); return; }
      if (dy > MIN_START_DIST) {
        const newY = Math.min((dy - MIN_START_DIST) * 0.4, MAX_PULL);
        if (newY >= THRESHOLD && pullYRef.current < THRESHOLD) haptics.light();
        setPulling(true);
        setPullY(newY);
      }
    }

    function onTouchEnd() {
      if (!active.current) return;
      active.current = false;
      if (pullYRef.current >= THRESHOLD) {
        haptics.success();
        setRefreshing(true);
        setPullY(THRESHOLD * 0.6);
        setTimeout(() => window.location.reload(), 300);
      } else {
        setPulling(false);
        setPullY(0);
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return { pulling, pullY, refreshing };
}
