/**
 * r2Probe — single source of truth for R2 cache checks.
 *
 * AudioPlayer + useHotSwap previously had identical copies of this
 * function. Consolidated here so probe logic stays consistent and
 * future edge-caching / ETag optimizations happen in one place.
 */

export const R2_AUDIO_BASE = 'https://voyo-edge.dash-webtv.workers.dev/audio';

// In-flight dedup: if rapid card-tapping (or poll + track-change)
// triggers the same HEAD for the same track within a short window,
// we reuse the live Promise instead of firing a duplicate request.
// Expires 2s after resolution so we aren't caching stale "true"s forever.
const _inflight = new Map<string, Promise<boolean>>();
const HEAD_TIMEOUT_MS = 1500;

/**
 * HEAD the R2 audio URL for a track. Returns true on 200. Any non-OK
 * response or network error returns false (never throws). Hard-capped at
 * HEAD_TIMEOUT_MS so a slow edge never stalls a track transition.
 */
export async function r2HasTrack(trackId: string): Promise<boolean> {
  const existing = _inflight.get(trackId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
      const res = await fetch(`${R2_AUDIO_BASE}/${trackId}?q=high`, {
        method: 'HEAD',
        signal: ctrl.signal,
      });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  })();

  _inflight.set(trackId, promise);
  // Clear from the dedup map shortly after resolve so subsequent checks
  // (a minute later, same session) re-probe with fresh data.
  promise.finally(() => {
    setTimeout(() => { _inflight.delete(trackId); }, 2000);
  });
  return promise;
}
