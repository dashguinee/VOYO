/**
 * useVibePoolBatch — returns the top N R2-cached tracks from the hot pool
 * that match a given vibe. Used by the Vibes reel to show 5 real covers
 * per vibe, each tappable and instantly playable.
 *
 * The caller (e.g. VibesReel) can also use useVibePoolPick for a single
 * rotating pick if they want a different treatment.
 */

import { useMemo } from 'react';
import { useTrackPoolStore } from '../store/trackPoolStore';
import type { VibeMode } from '../store/intentStore';
import type { Track } from '../types';

const DEFAULT_BATCH = 5;

export function useVibePoolBatch(vibeId: VibeMode | string, size: number = DEFAULT_BATCH): Track[] {
  const matches = useTrackPoolStore(s =>
    s.hotPool.filter(t => t.detectedMode === vibeId),
  );
  return useMemo(() => {
    return [...matches]
      .sort((a, b) => (b.poolScore ?? 0) - (a.poolScore ?? 0))
      .slice(0, size) as unknown as Track[];
  }, [matches, size]);
}

/**
 * Single rotating pick — kept for surfaces that want one tile per vibe.
 * Not used by the current reel design but left in as a future building block.
 */
export function useVibePoolPick(vibeId: VibeMode | string): Track | null {
  const batch = useVibePoolBatch(vibeId, 5);
  return batch[0] ?? null;
}
