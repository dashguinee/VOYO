/**
 * useChillNudge — empathy pill for violent scrolls.
 *
 * Watches window scroll velocity. When the user flicks the feed hard
 * enough to register as "abrupt," fires a Dynamic Island system pill
 * via window.pushNotification with a playful Oyo line ("Yo chill",
 * "Ouuuhh that's violent", etc.).
 *
 * Heavily rate-limited so it stays charming, not naggy:
 *   · max 2 nudges per 5-minute rolling window
 *   · at least 30s between nudges
 *   · velocity must be sustained across a 200ms window (kills false
 *     positives from elastic bounce + single-event spikes)
 *
 * Designed as a temporary cover for known feed-scroll jank — the pill
 * leans into the bug instead of hiding it. Remove the hook when the
 * underlying scroll behavior is fixed.
 */
import { useEffect, useRef } from 'react';

const VELOCITY_THRESHOLD_PX_PER_MS = 4.0;
const SAMPLE_WINDOW_MS = 200;
const MIN_INTERVAL_MS = 30_000;
const MAX_PER_WINDOW = 2;
const RATE_WINDOW_MS = 5 * 60_000;

const LINES = [
  'Yo chill',
  "Ouuuhh that's violent",
  'Easy easy',
  'Catch your breath',
  'Slow down snap',
  'Whoa now',
];

interface OyoNotif {
  id: string;
  type: 'system';
  title: string;
  subtitle: string;
}

declare global {
  interface Window {
    pushNotification?: (n: OyoNotif) => void;
  }
}

export function useChillNudge(enabled: boolean = true): void {
  const samplesRef = useRef<{ y: number; t: number }[]>([]);
  const fireTimesRef = useRef<number[]>([]);
  const lastFiredAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onScroll = (): void => {
      const now = performance.now();
      const y = window.scrollY;
      const samples = samplesRef.current;
      samples.push({ y, t: now });
      while (samples.length && now - samples[0].t > SAMPLE_WINDOW_MS) samples.shift();
      if (samples.length < 2) return;

      const oldest = samples[0];
      const newest = samples[samples.length - 1];
      const dt = newest.t - oldest.t;
      const dy = Math.abs(newest.y - oldest.y);
      // Need a meaningful window — reject single-event spikes.
      if (dt < 80) return;
      const velocity = dy / dt;
      if (velocity < VELOCITY_THRESHOLD_PX_PER_MS) return;

      // Rate-limit gates.
      if (now - lastFiredAtRef.current < MIN_INTERVAL_MS) return;
      const fires = fireTimesRef.current;
      while (fires.length && now - fires[0] > RATE_WINDOW_MS) fires.shift();
      if (fires.length >= MAX_PER_WINDOW) return;

      const text = LINES[Math.floor(Math.random() * LINES.length)];
      try {
        window.pushNotification?.({
          id: `chill-${Date.now()}`,
          type: 'system',
          title: 'Oyo',
          subtitle: text,
        });
        fires.push(now);
        lastFiredAtRef.current = now;
      } catch {
        // Dynamic Island not mounted yet — silently skip.
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);
}
