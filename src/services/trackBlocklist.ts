/**
 * Collective Failure Memory
 *
 * Tracks that have failed ≥3 times across any user. Loaded once at app start
 * from Supabase telemetry, kept in memory as a Set, checked synchronously
 * in loadTrack to skip known-bad tracks before wasting 20s on retry loops.
 *
 * This is the inverse of R2: R2 is the collective SUCCESS cache. This is
 * the collective FAILURE cache. Same flywheel — each user's failure
 * protects every future user.
 *
 * Refresh cadence: every 30 minutes while app is open. Not real-time —
 * but good enough for a track that reliably fails across sessions.
 */

import { supabase } from '../lib/supabase';
import { devLog, devWarn } from '../utils/logger';

let blocklist: Set<string> = new Set();
let lastRefreshAt = 0;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const FAIL_THRESHOLD = 3; // 3+ max_retries fails = blocked

/**
 * Load the blocklist from Supabase. Idempotent — safe to call multiple times.
 * Runs as a single aggregation query. Typical response: <500 track IDs, <10KB.
 */
export async function refreshBlocklist(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRefreshAt < REFRESH_INTERVAL_MS) return;
  lastRefreshAt = now;

  if (!supabase) return;

  try {
    // Failure-flywheel query: count play_fail (logged per attempt) AND
    // skip_auto/max_retries (logged on full exhaustion). play_fail accumulates
    // fast even when users skip manually before the retry loop completes.
    // 7-day window: fresh failures matter; old ones may be VPS-recovered.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('voyo_playback_events')
      .select('track_id, event_type, error_code')
      .or('event_type.eq.play_fail,and(event_type.eq.skip_auto,error_code.eq.max_retries)')
      .gte('created_at', sevenDaysAgo)
      .limit(10000);

    if (error) {
      devWarn('[Blocklist] Load failed:', error.message);
      return;
    }

    // Count occurrences per track_id (any failure type counts)
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      counts.set(row.track_id, (counts.get(row.track_id) ?? 0) + 1);
    }

    // Keep only tracks that hit the threshold
    const next = new Set<string>();
    for (const [trackId, count] of counts) {
      if (count >= FAIL_THRESHOLD) next.add(trackId);
    }

    blocklist = next;
    devLog(`[Blocklist] Loaded ${blocklist.size} known-bad tracks`);
  } catch (e) {
    devWarn('[Blocklist] Refresh exception:', e);
  }
}

/**
 * Synchronous check — is this track known-bad? O(1).
 */
export function isBlocked(trackId: string): boolean {
  if (!trackId) return false;
  if (blocklist.has(trackId)) return true;
  // Strip either VOYO_ or vyo_ prefix — tracks from DJ/verified pools
  // carry these prefixes but telemetry rows the raw YouTube id.
  const stripped = trackId.replace(/^(VOYO_|vyo_)/, '');
  return stripped !== trackId && blocklist.has(stripped);
}

/**
 * Manually add a track to the blocklist (e.g., immediately after a local max_retries fail).
 * Local addition is lost on reload but prevents re-trying within the session.
 */
export function markBlocked(trackId: string): void {
  if (trackId) blocklist.add(trackId);
}

/**
 * Debug hook
 */
export function getBlocklistSize(): number {
  return blocklist.size;
}

// Boot: load once on import
if (typeof window !== 'undefined') {
  refreshBlocklist().catch(() => {});
  // Periodic refresh
  setInterval(() => refreshBlocklist().catch(() => {}), REFRESH_INTERVAL_MS);
}
