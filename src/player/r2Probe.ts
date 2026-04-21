/**
 * r2Probe — single source of truth for R2 cache checks.
 *
 * AudioPlayer + useHotSwap previously had identical copies of this
 * function. Consolidated here so probe logic stays consistent and
 * future edge-caching / ETag optimizations happen in one place.
 */

import { getYouTubeId } from '../utils/voyoId';

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
  // R2 stores by raw YouTube ID; callers may pass a VOYO ID (vyo_<base64>).
  // Dedup on the decoded id so vyo_<X> and its decoded form share one probe.
  const ytId = getYouTubeId(trackId);
  const existing = _inflight.get(ytId);
  if (existing) return existing;

  const promise = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
    try {
      // Cache-buster — the edge worker and any intermediary CDN may
      // cache 404 responses longer than the 2s dedup window. Without
      // this, once a track 404s the probe keeps returning false even
      // AFTER the R2 upload completes, because we're reading a stale
      // cached 404. The _v= query param changes per-request so caches
      // treat each HEAD as a unique URL.
      const bust = Date.now();
      const res = await fetch(`${R2_AUDIO_BASE}/${ytId}?q=high&_v=${bust}`, {
        method: 'HEAD',
        signal: ctrl.signal,
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  })();

  _inflight.set(ytId, promise);
  // Clear from the dedup map shortly after resolve so subsequent checks
  // (a minute later, same session) re-probe with fresh data.
  promise.finally(() => {
    setTimeout(() => { _inflight.delete(ytId); }, 2000);
  });
  return promise;
}
