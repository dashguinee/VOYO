/**
 * r2Probe — single source of truth for R2 cache checks.
 *
 * AudioPlayer + useHotSwap previously had identical copies of this
 * function. Consolidated here so probe logic stays consistent and
 * future edge-caching / ETag optimizations happen in one place.
 */

export const R2_AUDIO_BASE = 'https://voyo-edge.dash-webtv.workers.dev/audio';

/**
 * HEAD the R2 audio URL for a track. Returns true on 200. Any non-OK
 * response or network error returns false (never throws).
 */
export async function r2HasTrack(trackId: string): Promise<boolean> {
  try {
    const res = await fetch(`${R2_AUDIO_BASE}/${trackId}?q=high`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
