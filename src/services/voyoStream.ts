/**
 * voyoStream — legacy-compat shim.
 *
 * Historical context: this singleton used to orchestrate a VPS chunked-audio
 * session (voyo-stream.js on :8444) with SSE event streaming. The R2-first
 * refactor killed that path — audio now plays direct from R2 (Cloudflare
 * edge) or the YouTube iframe fallback, coordinated by src/player/.
 *
 * What survives:
 *
 *   ensureTrackReady(track, sessionId, { priority })
 *     — upserts the track into voyo_upload_queue so the egyptian lanes
 *       extract it to R2. The sole extraction-queue writer outside of
 *       oyo.prefetch (which itself wraps queueForExtraction in r2Gate).
 *
 *   voyoStream (the instance)
 *     — tiny state bag for three live concerns:
 *         .intentionalPause  flag AudioPlayer's handlePause reads to
 *                            distinguish user-pause from buffer-underrun.
 *         .onRapidSkip       callback AudioPlayer registers; fires from
 *                            skip() when the user triples in 10s.
 *         .skip()            single skip boundary — detector + plan signal
 *                            + playerStore.nextTrack().
 *         .bindAudio / .endSession  mount lifecycle bookkeeping (no-ops
 *                                   kept for call-site compatibility).
 *
 * Every other field (sessionId, streamUrl, currentTrackId, currentDuration,
 * trackStartAudioTime, isSkipping, onBeforeStreamStart, onSoftFade,
 * markAudioRestarted, getPosition, pause, resume) belonged to the VPS
 * session model and was dead read-only state after the rip. Deleted.
 */

import type { Track } from '../types';
import { onSignal as oyoPlanSignal } from './oyoPlan';
import { usePlayerStore } from '../store/playerStore';

// ── Queue upsert helper (internal + exported via ensureTrackReady) ────────

/**
 * Upsert a row into voyo_upload_queue so workers extract it to R2.
 *
 * `priority` bumps the row to the front of the claim queue.
 *   10 = user click (they're waiting)
 *    5 = predicted taste / predictive pre-warm
 *    0 = background
 */
async function queueUpsertForPreWarm(
  track: Track,
  sessionId: string | null,
  priority: number = 0,
): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  // Use bump_queue_priority RPC (migration 022) — atomic GREATEST escalation
  // so user clicks at p=10 beat any prior prefetch at p=7. Also resets
  // failed rows back to pending on user intent.
  await fetch(`${url}/rest/v1/rpc/bump_queue_priority`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_youtube_id: track.trackId,
      p_priority:   priority,
      p_title:      track.title ?? null,
      p_artist:     track.artist ?? null,
      p_session:    sessionId,
    }),
  }).catch(() => {});
}

const R2_POLL_INTERVAL_MS = 2000;
const SEARCH_WAIT_MS      = 30_000;
const R2_EDGE             = 'https://voyo-edge.dash-webtv.workers.dev/audio';

/**
 * Unified handoff — ensure the track is either in R2 or give up gracefully
 * after SEARCH_WAIT_MS. Callers then proceed to play: R2 hit = instant,
 * miss = iframe fallback. Never throws — always resolves.
 *
 * Also upserts the queue row so the lanes extract it. That upsert is
 * fire-and-forget; the R2 poll loop below is the actual gate.
 */
export async function ensureTrackReady(
  track: Track,
  sessionId: string | null,
  opts: { priority?: number } = {},
): Promise<void> {
  // Every click registers with the lanes via bump_queue_priority RPC.
  // For R2-cached tracks it's a no-op (GREATEST, done rows ignored by claim).
  // For cold tracks it forces p>=10 so the lane jumps it to front.
  queueUpsertForPreWarm(track, sessionId, opts.priority ?? 10).catch(() => {});

  // Fast path: R2 already has it → return immediately (caller plays via
  // audio.src = R2 URL or lets iframe start first with hot-swap later).
  try {
    const res = await fetch(`${R2_EDGE}/${track.trackId}?q=high`, { method: 'HEAD' });
    if (res.ok) return;
  } catch { /* fall through to poll */ }

  // Bounded poll — R2 hit wins immediately; queue row going 'failed' wins too
  // (early abort so callers don't wait the full 30s on a known-dead ID).
  const supaUrl = import.meta.env.VITE_SUPABASE_URL;
  const supaKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const start = Date.now();
  while (Date.now() - start < SEARCH_WAIT_MS) {
    try {
      const res = await fetch(`${R2_EDGE}/${track.trackId}?q=high`, { method: 'HEAD' });
      if (res.ok) return;
    } catch { /* transient */ }

    if (supaUrl && supaKey) {
      try {
        const r = await fetch(
          `${supaUrl}/rest/v1/voyo_upload_queue?youtube_id=eq.${track.trackId}&select=status`,
          { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
        );
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]?.status === 'failed') return;
      } catch { /* transient */ }
    }

    await new Promise((r) => setTimeout(r, R2_POLL_INTERVAL_MS));
  }
}

// ── Thin legacy-compat singleton ──────────────────────────────────────────
//
// What's actually live here, post-VPS-rip:
//   - intentionalPause: AudioPlayer flips this on user-initiated pause so
//     handlePause knows not to retry play() (buffer-underrun recovery path).
//   - onRapidSkip: AudioPlayer registers it; skip() fires it on 3-in-10s.
//   - skip(): the single skip boundary — rapid detector + plan signal +
//     playerStore.nextTrack().
//   - bindAudio / endSession: mount lifecycle bookkeeping.
// Every other field that used to live here was read-only dead state from
// the VPS session model. Gone.

class VoyoStreamShim {
  intentionalPause: boolean = false;

  /** Registered by AudioPlayer; invoked from skip() on 3-in-10s. */
  onRapidSkip: (() => void) | null = null;

  private recentSkipTimes: number[] = [];

  /** Mount bookkeeping — no-op, kept so the AudioPlayer call compiles. */
  bindAudio(_el: HTMLAudioElement): void { /* no-op */ }

  endSession(): void {
    this.intentionalPause = false;
  }

  /**
   * Skip signal — fires the rapid-skip detector (3-in-10s → deck pivot via
   * onRapidSkip callback) then delegates to playerStore.nextTrack which runs
   * the full OYO signal fanout + advances the audio.
   */
  skip(): void {
    const now = Date.now();
    this.recentSkipTimes = this.recentSkipTimes.filter(t => now - t < 10_000);
    this.recentSkipTimes.push(now);
    if (this.recentSkipTimes.length >= 3) {
      this.recentSkipTimes = [];
      this.onRapidSkip?.();
    }
    oyoPlanSignal('skip');
    usePlayerStore.getState().nextTrack();
  }
}

export const voyoStream = new VoyoStreamShim();
