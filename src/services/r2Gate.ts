/**
 * r2Gate — single source of truth for "is this track displayable right now?".
 *
 * Display rule: tracks with r2_cached=true leak through to UI cards.
 * Curation rule: anything that misses the gate gets pushed into
 * voyo_upload_queue so the lanes fill it in for next refresh.
 *
 * This is the abstraction Dash wanted: the UI only ever shows what's
 * instantly playable. Curation (OYO) works behind it to keep R2 populated
 * with the right taste.
 */

import { supabase } from '../lib/supabase';
import type { Track } from '../types';

const VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface GateOptions {
  /** If true, uncached candidates are upserted to voyo_upload_queue so they
   *  become displayable next time. Default true. */
  queueUncached?: boolean;
  /** Priority bucket for the prefetch upsert. 10 = user-waiting, 5 = predicted
   *  taste, 0 = background. Default 5. */
  prefetchPriority?: number;
  /** Session tag for the upsert, lands in requested_by_session. */
  sessionTag?: string;
}

/**
 * Filter a candidate list to R2-cached tracks. Returns the instantly-playable
 * subset. Side effect: non-cached candidates get queued so lanes extract them.
 *
 * Safe default on error: returns [] — showing nothing is better than showing
 * broken cards.
 */
export async function gateToR2(
  candidates: Track[],
  opts: GateOptions = {},
): Promise<Track[]> {
  if (!candidates.length || !supabase) return [];
  const queueUncached = opts.queueUncached ?? true;
  const prefetchPriority = opts.prefetchPriority ?? 5;

  const ids = candidates.map(t => t.trackId).filter(Boolean);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('video_intelligence')
    .select('youtube_id, r2_cached')
    .in('youtube_id', ids);
  if (error || !data) return [];

  const cachedSet = new Set(
    data.filter(r => r.r2_cached === true).map(r => r.youtube_id),
  );

  if (queueUncached) {
    const uncached = candidates.filter(t => !cachedSet.has(t.trackId));
    if (uncached.length) {
      void queueForExtraction(uncached, prefetchPriority, opts.sessionTag ?? 'r2gate');
    }
  }

  return candidates.filter(t => cachedSet.has(t.trackId));
}

/**
 * Upsert tracks into voyo_upload_queue so the always-on lanes extract them
 * to R2. Priority defaults to 5 (predicted taste, sits between user clicks
 * at 10 and seed/background at 0).
 */
export async function queueForExtraction(
  tracks: Track[],
  priority: number = 5,
  sessionTag: string = 'curation',
): Promise<void> {
  if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY || !tracks.length) return;
  const body = tracks.map(t => ({
    youtube_id: t.trackId,
    status: 'pending',
    title: t.title ?? null,
    artist: t.artist ?? null,
    priority,
    requested_by_session: sessionTag,
  }));
  await fetch(`${VITE_SUPABASE_URL}/rest/v1/voyo_upload_queue?on_conflict=youtube_id`, {
    method: 'POST',
    headers: {
      apikey: VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/**
 * HEAD probe for a single track's R2 status (live, not via the video_intelligence
 * flag which may lag). Use this in the player's hot-swap watcher.
 */
const R2_AUDIO = 'https://voyo-edge.dash-webtv.workers.dev/audio';
export async function r2HasTrack(trackId: string, quality: string = 'high'): Promise<boolean> {
  try {
    const res = await fetch(`${R2_AUDIO}/${trackId}?q=${quality}`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
