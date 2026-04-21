// r2Gate — pure R2-cached filter. No background queueing.
//
// Rule: UI only ever shows tracks with r2_cached=true. Uncached candidates
// are silently dropped; nothing auto-queues. Workers only fire on user click
// via ensureTrackReady. Mass-populating R2 is a separate deliberate flow.

import { supabase } from '../lib/supabase';
import { getYouTubeId } from '../utils/voyoId';
import type { Track } from '../types';

const VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface GateOptions {
  /** Ignored — kept for source-compat with old callers. gateToR2 is now pure filter. */
  queueUncached?: boolean;
  /** Ignored. */
  prefetchPriority?: number;
  /** Ignored. */
  sessionTag?: string;
}

export async function gateToR2(
  candidates: Track[],
  _opts: GateOptions = {},
): Promise<Track[]> {
  if (!candidates.length || !supabase) return [];
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
    // R2 stores by raw YouTube ID; trackId may be a VOYO ID.
    const res = await fetch(`${R2_AUDIO}/${getYouTubeId(trackId)}?q=${quality}`, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
