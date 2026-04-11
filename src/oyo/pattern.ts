/**
 * OYO Pattern Engine — User behavior pattern detection.
 *
 * Aggregates raw signals (plays, skips, completions) into a
 * behavior snapshot: top artists, top genres, skip rate, favorite time.
 * The snapshot gets written into consciousness.signals and consumed
 * by the system prompt so OYO can "feel" the user's patterns.
 *
 * This runs on-demand (snapshot()) — cheap enough to call on every think().
 */

import type { BehaviorSignal, PatternSnapshot, SignalType } from './schema';
import { listSignals, recordSignal } from './memory';

// ---------------------------------------------------------------------------
// Public: record raw behavior signals
// ---------------------------------------------------------------------------

export interface TrackSignalInput {
  trackId?: string;
  artist?: string;
  genre?: string;
  mood?: string;
  value?: number;
}

export async function recordPlay(input: TrackSignalInput): Promise<void> {
  await recordSignal({ type: 'play', ...input, timeOfDay: currentTimeOfDay() });
}

export async function recordSkip(input: TrackSignalInput): Promise<void> {
  await recordSignal({ type: 'skip', ...input, timeOfDay: currentTimeOfDay() });
}

export async function recordComplete(input: TrackSignalInput): Promise<void> {
  await recordSignal({ type: 'complete', ...input, timeOfDay: currentTimeOfDay() });
}

export async function recordReaction(input: TrackSignalInput): Promise<void> {
  await recordSignal({ type: 'reaction', ...input, timeOfDay: currentTimeOfDay() });
}

export async function recordQueueAdd(input: TrackSignalInput): Promise<void> {
  await recordSignal({ type: 'queue-add', ...input, timeOfDay: currentTimeOfDay() });
}

export async function recordSearch(query: string): Promise<void> {
  await recordSignal({
    type: 'search',
    mood: query.slice(0, 50),
    timeOfDay: currentTimeOfDay(),
  });
}

export async function recordMoodShift(mood: string): Promise<void> {
  await recordSignal({ type: 'mood-shift', mood, timeOfDay: currentTimeOfDay() });
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function snapshot(): Promise<PatternSnapshot> {
  const signals = await listSignals(1000);
  return computeSnapshot(signals);
}

function computeSnapshot(signals: BehaviorSignal[]): PatternSnapshot {
  const total = signals.length;
  const result: PatternSnapshot = {
    topArtists: [],
    topGenres: [],
    skipRate: 0,
    completionRate: 0,
    favoriteTimeOfDay: 'evening',
    totalSignals: total,
    updatedAt: Date.now(),
  };

  if (total === 0) return result;

  const artistCount = new Map<string, number>();
  const genreCount = new Map<string, number>();
  const timeCount = new Map<string, number>();
  const typeCount = new Map<SignalType, number>();

  for (const s of signals) {
    if (s.artist) artistCount.set(s.artist, (artistCount.get(s.artist) || 0) + 1);
    if (s.genre) genreCount.set(s.genre, (genreCount.get(s.genre) || 0) + 1);
    if (s.timeOfDay) timeCount.set(s.timeOfDay, (timeCount.get(s.timeOfDay) || 0) + 1);
    typeCount.set(s.type, (typeCount.get(s.type) || 0) + 1);
  }

  const playCount = typeCount.get('play') || 0;
  const skipCount = typeCount.get('skip') || 0;
  const completeCount = typeCount.get('complete') || 0;
  const playsDenominator = playCount + skipCount + completeCount;

  if (playsDenominator > 0) {
    result.skipRate = skipCount / playsDenominator;
    result.completionRate = completeCount / playsDenominator;
  }

  result.topArtists = [...artistCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([artist, count]) => ({ artist, count }));

  result.topGenres = [...genreCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([genre, count]) => ({ genre, count }));

  const topTime = [...timeCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topTime) {
    result.favoriteTimeOfDay = topTime[0] as PatternSnapshot['favoriteTimeOfDay'];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function currentTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 23) return 'evening';
  return 'night';
}
