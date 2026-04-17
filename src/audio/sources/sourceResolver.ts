/**
 * Source Resolver — given a trackId, return a playable URL.
 *
 * The one place that knows HOW to find audio bytes for a track. The caller
 * (AudioPlayer.loadTrack) doesn't care where bytes come from; it receives
 * a URL + source type and handles the audio element itself.
 *
 * PRIORITY ORDER (fastest first):
 *   1. Preloaded blob — already-decoded in preloadManager, instant swap
 *   2. IndexedDB cached blob — previous session's download, instant
 *   3. R2 collective cache — shared network cache, ~1s
 *   4. VPS direct stream — stream.zionsynapse.online, ~3-5s (normalized audio)
 *   5. Edge Worker extraction — yt-dlp via worker, ~3-8s (raw extraction)
 *
 * Steps 4+5 race in parallel; first success wins. If both fail, retry up
 * to 2 more times with 2s gaps. Total budget: ~15s worst case.
 *
 * Everything async. All awaits honor the provided AbortSignal + the caller's
 * `isStale()` check so a rapid-skip doesn't waste extraction on an abandoned
 * track.
 */

import { checkR2Cache } from '../../services/api';
import { getPreloadedTrack, consumePreloadedAudio } from '../../services/preloadManager';
import { trace, logPlaybackEvent } from '../../services/telemetry';
import { markBlocked } from '../../services/trackBlocklist';
import { devLog, devWarn } from '../../utils/logger';

const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';
const VPS_AUDIO_URL = 'https://stream.zionsynapse.online:8443';

export type SourceType = 'preload' | 'cached' | 'r2' | 'vps' | 'edge';

export interface ResolvedSource {
  url: string;
  source: SourceType;
  isBlob: boolean;
  // For preload hits, we also get back the pre-decoded audio element so the
  // caller can consume it (or just read .url, which is what AudioPlayer does).
  preloadedAudio?: HTMLAudioElement | null;
  // R2 quality info — low-quality hits trigger a 50% upgrade check later.
  r2LowQuality?: boolean;
}

export interface ResolveParams {
  trackId: string;
  // Caller's cancellation token — returns true if a newer load has started
  // and this one should abort.
  isStale: () => boolean;
  // Local IndexedDB cache lookup. Injected so the resolver doesn't depend
  // on downloadManager — keeps the module pure.
  checkLocalCache: (trackId: string) => Promise<string | null>;
  // Logged with the caller's track metadata for play_fail telemetry.
  trackTitle?: string;
  trackArtist?: string;
}

/**
 * Resolve a track to a playable URL + source. Returns null if every path
 * failed within the retry budget (track is marked blocked in that case).
 */
export async function resolveSource(params: ResolveParams): Promise<ResolvedSource | null> {
  const { trackId, isStale, checkLocalCache, trackTitle, trackArtist } = params;

  // (1) Preload hit — instant blob transfer from preloadManager.
  const preloadPeek = getPreloadedTrack(trackId);
  if (preloadPeek?.audioElement && preloadPeek?.url &&
      (preloadPeek.source === 'cached' || preloadPeek.source === 'r2')) {
    const preloadedAudio = consumePreloadedAudio(trackId);
    if (preloadedAudio) {
      trace('preload_check', trackId, { hit: true, src: preloadPeek.source });
      return {
        url: preloadPeek.url,
        source: 'preload',
        isBlob: preloadPeek.url.startsWith('blob:'),
        preloadedAudio,
      };
    }
  }
  trace('preload_check', trackId, { hit: false, src: 'none' });

  // (2) IndexedDB cache.
  const cachedUrl = await checkLocalCache(trackId);
  if (isStale()) { trace('load_abandoned', trackId, { at: 'after_checkCache' }); return null; }
  if (cachedUrl) {
    return { url: cachedUrl, source: 'cached', isBlob: cachedUrl.startsWith('blob:') };
  }

  // (3) R2 collective cache.
  const r2Result = await checkR2Cache(trackId);
  if (isStale()) { trace('load_abandoned', trackId, { at: 'after_R2_check' }); return null; }
  if (r2Result.exists && r2Result.url) {
    return {
      url: r2Result.url,
      source: 'r2',
      isBlob: false,
      r2LowQuality: !r2Result.hasHigh && r2Result.hasLow,
    };
  }

  // (4) VPS direct stream — up to 3 attempts with 2s gaps.
  // Edge worker extraction (/stream?v=) removed: YouTube bot-detects all
  // CF datacenter IPs; the endpoint always 502s, wasting 5s per attempt.
  // R2-cached tracks are already handled in step 3 above (via checkR2Cache).
  // VPS yt-dlp path is the authoritative cold-extraction route.
  const MAX_RETRIES = 3;
  let firstFailLogged = false;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (isStale()) return null;

    const retryStart = performance.now();
    let resolved: ResolvedSource | null = null;

    const vpsP = fetch(`${VPS_AUDIO_URL}/voyo/audio/${trackId}?quality=high`, { signal: AbortSignal.timeout(12000) })
      .then(async (res) => {
        if (resolved || isStale()) return;
        if (res.ok || res.redirected) {
          res.body?.cancel().catch(() => {});
          resolved = {
            url: `${VPS_AUDIO_URL}/voyo/audio/${trackId}?quality=high`,
            source: 'vps',
            isBlob: false,
          };
        }
      }).catch(() => {});

    await Promise.allSettled([vpsP]);

    if (resolved && !isStale()) {
      logPlaybackEvent({
        event_type: 'source_resolved',
        track_id: trackId,
        source: (resolved as ResolvedSource).source as any,
        latency_ms: Math.round(performance.now() - retryStart),
        meta: { attempt: attempt + 1 },
      });
      return resolved;
    }

    // Failure-flywheel — log on first failed attempt so dead tracks propagate
    // through the blocklist quickly without waiting for MAX_RETRIES exhaustion.
    if (!firstFailLogged) {
      firstFailLogged = true;
      logPlaybackEvent({
        event_type: 'play_fail',
        track_id: trackId,
        track_title: trackTitle,
        track_artist: trackArtist,
        error_code: 'vps_timeout',
        meta: { attempt: attempt + 1, source: 'vps+edge' },
      });
    }

    if (attempt + 1 < MAX_RETRIES) {
      // 2s gap before next attempt. MessageChannel in BG (setTimeout throttled
      // to 1/min); setTimeout in FG.
      await new Promise<void>(resolve => {
        if (document.hidden) {
          let ticks = 0;
          const mc = new MessageChannel();
          const startMs = Date.now();
          mc.port1.onmessage = () => {
            ticks++;
            if (Date.now() - startMs >= 2000) { mc.port1.close(); resolve(); return; }
            if (ticks > 500) { mc.port1.close(); resolve(); return; } // safety
            mc.port2.postMessage(null);
          };
          mc.port2.postMessage(null);
        } else {
          setTimeout(resolve, 2000);
        }
      });
    }
  }

  // All retries exhausted — mark this trackId blocked for the session so
  // the cascade brake in AudioPlayer can force-pause if multiple tracks
  // in a row hit this path.
  devWarn(`[resolveSource] all ${MAX_RETRIES} retries failed for ${trackId}`);
  markBlocked(trackId);
  return null;
}

// Silence unused-import noise if we end up not using devLog.
void devLog;
