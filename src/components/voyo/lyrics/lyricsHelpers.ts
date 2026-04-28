/**
 * Lyrics V2 — pure helpers. No React, no DOM.
 *
 * - Hook detection (lines that repeat 3+ times → bigger, heavier)
 * - Lifecycle stage computation (queued / arriving / live / decay / gone)
 * - Window selection (which bars to render around the active one)
 *
 * Spec: outputs/SPEC-lyrics-v2-2026-04-29.md
 */

import type { TranslatedSegment } from '../../../services/lyricsEngine';

export type BarStage =
  | 'queued'    // below fold, pre-arrival
  | 'arriving'  // entering the visible window, just before in-point
  | 'live'      // actively being sung (currentTime in [start, end])
  | 'decay'     // just finished, drifting up
  | 'gone';     // fully out of the visible window

/** Lookahead window before in-point — the bar arrives this many seconds early. */
export const ARRIVE_LEAD_SEC = 0.22;
/** Decay window after out-point — the bar lingers visibly this long before gone. */
export const DECAY_TAIL_SEC = 1.2;
/** How far above/below the live bar we render (in bar-count). */
export const VISIBLE_RADIUS = 2;

/**
 * Hook map — return Set of segment indexes that count as hooks
 * (the line text repeats at least `threshold` times across the song).
 */
export function detectHooks(
  segments: TranslatedSegment[],
  threshold = 3,
): Set<number> {
  const counts = new Map<string, number>();
  segments.forEach((s) => {
    const key = normalize(s.original);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const out = new Set<number>();
  segments.forEach((s, i) => {
    const key = normalize(s.original);
    if ((counts.get(key) ?? 0) >= threshold) out.add(i);
  });
  return out;
}

function normalize(line: string): string {
  return line.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Compute the lifecycle stage of a single bar at the given currentTime. */
export function computeBarStage(
  segment: TranslatedSegment,
  currentTime: number,
): BarStage {
  const start = segment.startTime;
  const end = segment.endTime ?? start + 4;
  if (currentTime >= start && currentTime <= end) return 'live';
  if (currentTime >= start - ARRIVE_LEAD_SEC && currentTime < start) return 'arriving';
  if (currentTime > end && currentTime <= end + DECAY_TAIL_SEC) return 'decay';
  if (currentTime < start - ARRIVE_LEAD_SEC) return 'queued';
  return 'gone';
}

/**
 * Find the active segment index — the one whose [start, end] window contains
 * currentTime, or the closest upcoming one within the lookahead window.
 *
 * Returns -1 before the first bar, segments.length when past the last.
 */
export function findActiveIndex(
  segments: TranslatedSegment[],
  currentTime: number,
): number {
  if (segments.length === 0) return -1;
  // Linear scan is fine — even 100-line songs are nothing.
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const end = s.endTime ?? s.startTime + 4;
    if (currentTime <= end) return i;
  }
  return segments.length;
}

/**
 * Pick the indexes to render — VISIBLE_RADIUS bars on either side of the
 * active one. Clamped to bounds. Returns sorted ascending.
 */
export function pickVisibleIndexes(
  totalCount: number,
  activeIndex: number,
  radius = VISIBLE_RADIUS,
): number[] {
  if (totalCount === 0) return [];
  const lo = Math.max(0, activeIndex - radius);
  const hi = Math.min(totalCount - 1, activeIndex + radius);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/**
 * Linear segmentProgress 0..1 — how far into a 'live' segment we are.
 * Used for active-bar fill effects + future onset-snap drift correction.
 */
export function segmentProgress(
  segment: TranslatedSegment,
  currentTime: number,
): number {
  const start = segment.startTime;
  const end = segment.endTime ?? start + 4;
  const span = Math.max(0.1, end - start);
  return Math.max(0, Math.min(1, (currentTime - start) / span));
}
