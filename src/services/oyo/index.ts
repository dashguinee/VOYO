/**
 * OYO Intelligence — the smart layer.
 *
 * Public facade over the scattered curation services (oyoPlan, oyoDJ, oyoState,
 * intelligentDJ, poolCurator, databaseDiscovery). Player code talks ONLY to this
 * module; internal taste/curation implementation is free to evolve without
 * touching AudioPlayer/voyoStream.
 *
 * Contract:
 *   Signals in  →  oyo.onPlay/onSkip/onComplete
 *   Tracks out  →  oyo.getHot / getDiscovery / getNextTrack  (always R2-gated)
 *   Prefetch    →  oyo.prefetch(tracks[])  — writes to voyo_upload_queue
 *                  at priority=5 so lanes extract the predicted taste
 *
 * Everything that leaves this module is R2-cached, so the UI is guaranteed
 * instant-playable.
 */

import type { Track } from '../../types';
import { getHotTracks, getDiscoveryTracks } from '../databaseDiscovery';
import { onSignal as oyoPlanSignal } from '../oyoPlan';
import { onTrackPlay as oyoDJOnTrackPlay, onTrackSkip as oyoDJOnTrackSkip } from '../oyoDJ';
import { recordPlay as djRecordPlay } from '../intelligentDJ';
import { recordTrackInSession } from '../poolCurator';
import { recordPoolEngagement } from '../personalization';
import { gateToR2 } from '../r2Gate';
import * as pools from './pools';
export { usePools } from './usePools';
export { app, type PlaySource } from './app';

// Supabase record_signal RPC cooldown — if it returns 401 or 42501 (RLS
// denied), we stop retrying to avoid flooding console with errors.
let _rpcSignalBlocked = false;

// Pool-refresh throttle. refreshPools() drops the 60s hot/discovery cache
// → next shelf render re-ranks. Firing it on every play (user clicks 4
// tracks/min → cache rebuilds every 15s) defeats the TTL. Debounce to
// once per REFRESH_POOLS_COOLDOWN_MS so the session adapts meaningfully
// (3-5 engagements worth) without thrashing the pool compute.
const REFRESH_POOLS_COOLDOWN_MS = 30_000;
let _lastRefreshAt = 0;
function maybeRefreshPools(): void {
  const now = Date.now();
  if (now - _lastRefreshAt < REFRESH_POOLS_COOLDOWN_MS) return;
  _lastRefreshAt = now;
  pools.refreshPools();
}
// Batch record_signal RPCs. Previously 3 roundtrips per track lifecycle
// (play/skip/complete + optional oye). On a typical 3-track/min session
// that's 9+ RPCs/min = main-thread jitter + battery cost over time.
// Queue and flush once per SIGNAL_FLUSH_MS, or on page unload so nothing
// is lost. Keeps the taste-graph write cadence but kills the chatter.
const SIGNAL_FLUSH_MS = 10_000;
type SignalAction = 'play' | 'skip' | 'complete' | 'react';
interface QueuedSignal { track_id: string; action: SignalAction; at: number }
let _signalQueue: QueuedSignal[] = [];
let _signalFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSignals(): Promise<void> {
  if (_rpcSignalBlocked || _signalQueue.length === 0) {
    _signalFlushTimer = null;
    return;
  }
  const batch = _signalQueue;
  _signalQueue = [];
  _signalFlushTimer = null;
  try {
    const { supabase } = await import('../../lib/supabase');
    // record_signal RPC accepts a single row. Fire them in parallel — one
    // RTT per row but they share the HTTP/2 connection, no new handshakes.
    // If the server adds a batched variant later, swap this to one call.
    const results = await Promise.all(
      batch.map(s =>
        supabase?.rpc('record_signal', { p_youtube_id: s.track_id, p_action: s.action })
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of results) {
      const err = (r as any)?.error;
      if (err && (err.status === 401 || err.code === '42501')) {
        _rpcSignalBlocked = true;
        break;
      }
    }
  } catch { /* non-fatal; local learning keeps going */ }
}

function recordRemoteSignal(trackId: string, action: SignalAction): void {
  if (_rpcSignalBlocked) return;
  _signalQueue.push({ track_id: trackId, action, at: Date.now() });
  if (_signalFlushTimer == null) {
    _signalFlushTimer = setTimeout(() => { void flushSignals(); }, SIGNAL_FLUSH_MS);
  }
}

// Flush on page-hide / unload so nothing queued gets lost when the user
// closes the tab or backgrounds the PWA. Guard against double-registration
// (Vite HMR re-evaluates this module, which would otherwise stack listeners).
if (typeof window !== 'undefined' && !(window as unknown as { __voyoSignalFlushBound?: boolean }).__voyoSignalFlushBound) {
  (window as unknown as { __voyoSignalFlushBound?: boolean }).__voyoSignalFlushBound = true;
  const onExit = () => { void flushSignals(); };
  window.addEventListener('pagehide', onExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onExit();
  });
}

// ── Signals in ────────────────────────────────────────────────────────────

/**
 * A track started playing (user click or auto-advance). Fans out to all
 * taste-tracking modules so OYO's future suggestions are informed.
 */
export function onPlay(track: Track): void {
  oyoDJOnTrackPlay(track);
  djRecordPlay(track);
  recordTrackInSession(track);
  recordPoolEngagement(track.trackId, 'play');
  // Throttled pool re-rank. Session still adapts, but not 4x/minute.
  maybeRefreshPools();
}

/**
 * User (or the fade-skip safety net) skipped a track before it completed.
 *
 * Fans out to:
 *   • intelligentDJ — recordPlay(skipped=true) for learning
 *   • oyoPlan — the "skip" signal for OYO's pool reshuffling
 *   • oyoDJ — onTrackSkip builds dislikedArtists over time (uses position)
 *   • personalization — recordPoolEngagement for pool-score demotion
 *   • video_intelligence.record_signal RPC — global recommender learning
 */
export function onSkip(track: Track, positionSec: number = 0): void {
  djRecordPlay(track, false, true);
  oyoPlanSignal('skip', track.trackId);
  oyoDJOnTrackSkip(track, positionSec);
  recordPoolEngagement(track.trackId, 'skip');
  void recordRemoteSignal(track.trackId, 'skip');
}

/**
 * Track played to natural completion. Strongest positive signal.
 *
 * Fans out to:
 *   • intelligentDJ — recordPlay(skipped=false)
 *   • oyoPlan — the "completion" signal
 *   • personalization — recordPoolEngagement with completionRate meta
 *   • video_intelligence.record_signal RPC
 */
export function onComplete(track: Track, completionRate: number = 100): void {
  djRecordPlay(track, false, false);
  oyoPlanSignal('completion', track.trackId);
  recordPoolEngagement(track.trackId, 'complete', { completionRate });
  void recordRemoteSignal(track.trackId, 'complete');
}

/**
 * User explicitly OYÉ'd (hearted). Strongest possible positive.
 */
export function onOye(track: Track): void {
  djRecordPlay(track, true, false);
  oyoPlanSignal('reaction', track.trackId);
  recordPoolEngagement(track.trackId, 'react');
  void recordRemoteSignal(track.trackId, 'react');
}

// ── Tracks out (always R2-gated) ──────────────────────────────────────────

/**
 * Hot tracks the user is likely to enjoy right now, R2-cached only.
 * Uncached candidates get pushed to the queue so they're ready next refresh.
 */
export async function getHot(limit: number = 30): Promise<Track[]> {
  const raw = await getHotTracks(limit * 2);     // over-fetch to survive gate
  const gated = await gateToR2(raw, { prefetchPriority: 5, sessionTag: 'oyo-hot' });
  return gated.slice(0, limit);
}

/**
 * Discovery tracks (expand horizons), R2-cached only.
 */
export async function getDiscovery(limit: number = 30): Promise<Track[]> {
  const raw = await getDiscoveryTracks(limit * 2);
  const gated = await gateToR2(raw, { prefetchPriority: 5, sessionTag: 'oyo-discovery' });
  return gated.slice(0, limit);
}

// ── Prefetch ───────────────────────────────────────────────────────────────
// Disabled: uncontrolled prefetch burns YT signals. Workers only fire on user
// clicks (p=10 via ensureTrackReady). Mass-populating R2 is a separate flow.
// Keep stub for source-compat with existing callers.

export async function prefetch(_tracks: Track[], _priority: number = 5): Promise<void> {
  return;
}

// ── Namespaced default export ─────────────────────────────────────────────

export const oyo = {
  // Signals in
  onPlay, onSkip, onComplete, onOye,
  // Tracks out — legacy single-row getters (still used by some surfaces)
  getHot, getDiscovery,
  // Two-stream model (new, preferred): HomeFeed rows are filter chains on these
  pools: {
    hot:         pools.hot,
    discovery:   pools.discovery,
    refresh:     pools.refreshPools,
    byTag:             pools.byTag,
    byArtist:          pools.byArtist,
    byFavoriteArtists: pools.byFavoriteArtists,
    recentlyPlayed:    pools.recentlyPlayed,
    excludeIds:        pools.excludeIds,
    newest:            pools.newest,
    topN:              pools.topN,
  },
  // Prefetch
  prefetch,
  prefetchMany: prefetch,
};
