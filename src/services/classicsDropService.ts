/**
 * VOYO Classics Drop — subscriber service
 *
 * Reads the live `voyo_classics_drops` row (if any) from Supabase and keeps
 * it in sync via realtime. The All-Time Classics shelf in HomeFeed swaps to
 * the ceremony component when this hook returns a non-null drop. When it
 * returns null, the existing shelf renders unchanged.
 *
 * Platform-wide control IS the drop itself: Dash fires from Hub cockpit =
 * ceremony for every visitor. Dash ends drop = back to shelf for everyone.
 * No flag, no env var, no localStorage — the cockpit is the only switch.
 *
 * Channel name: classics_drops:global  (singleton — only one live drop at a time)
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { devWarn } from '../utils/logger';
import type { Track } from '../types';

export type RevealMode = 'auto' | 'tap';

export interface ClassicsDrop {
  id: string;
  created_at: string;
  scheduled_at: string;
  expires_at: string;
  track_ids: string[] | null;
  is_active: boolean;
  notes: string | null;
  fired_by: string | null;
  reveal_mode: RevealMode | null;
}

const VIEWED_LS_PREFIX = 'voyo:classics:drop:viewed:';

export function isDropViewedByUser(dropId: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(VIEWED_LS_PREFIX + dropId) === '1';
  } catch {
    return false;
  }
}

export function markDropViewedByUser(dropId: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VIEWED_LS_PREFIX + dropId, '1');
    }
  } catch {
    // Quota / private mode — non-fatal.
  }
}

/**
 * Backfill resolver: when a drop's track_ids miss the local hotPool/TRACKS
 * (curated picks often do — they're niche classics, not chart trending),
 * fetch their metadata from `video_intelligence` and synthesize Track shapes.
 *
 * Cheap (single query, IN-list), idempotent, non-fatal on failure.
 */
export async function fetchTracksByYoutubeIds(ids: string[]): Promise<Track[]> {
  if (!supabase || ids.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('video_intelligence')
      .select('youtube_id,title,artist,thumbnail_url,release_year,timelessness')
      .in('youtube_id', ids);
    if (error) {
      devWarn('[ClassicsDrop] backfill fetch error:', error.message);
      return [];
    }
    if (!data) return [];
    return data.map((row): Track => ({
      id: row.youtube_id as string,
      trackId: row.youtube_id as string,
      title: (row.title as string) || 'Unknown',
      artist: (row.artist as string) || 'Unknown',
      coverUrl: (row.thumbnail_url as string) || `https://i.ytimg.com/vi/${row.youtube_id}/hqdefault.jpg`,
      duration: 0,
      tags: ['classic'],
      oyeScore: typeof row.timelessness === 'number' ? row.timelessness * 1_000_000 : 0,
      createdAt: new Date().toISOString(),
    }));
  } catch (e) {
    devWarn('[ClassicsDrop] backfill threw:', e);
    return [];
  }
}

/**
 * Fetch the single live drop, if any. Mirrors the canonical query:
 *   SELECT * FROM voyo_classics_drops
 *   WHERE is_active = true AND expires_at > now()
 *   ORDER BY scheduled_at DESC
 *   LIMIT 1;
 *
 * `now()` is computed by Postgres via the RLS policy — we only need the
 * `is_active` filter here. (RLS already hides expired rows from the anon
 * key, but we double-check `expires_at` client-side as belt-and-braces in
 * case Postgres clock + client clock drift across the boundary.)
 */
async function fetchActiveDrop(): Promise<ClassicsDrop | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('voyo_classics_drops')
      .select('*')
      .eq('is_active', true)
      .order('scheduled_at', { ascending: false })
      .limit(1);
    if (error) {
      // 401/403 = anon role can't read — treat as "no drop" silently.
      const status = (error as { status?: number }).status;
      if (status !== 401 && status !== 403) {
        devWarn('[ClassicsDrop] fetch error:', error.message);
      }
      return null;
    }
    if (!data || data.length === 0) return null;
    const row = data[0] as ClassicsDrop;
    // Client-side expiry guard — if Postgres returned a row whose expires_at
    // has just slipped past, drop it locally instead of showing a ceremony
    // that's about to vanish.
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return row;
  } catch (e) {
    devWarn('[ClassicsDrop] fetch threw:', e);
    return null;
  }
}

/**
 * Subscribe to the live drop. Returns it (or null) and keeps it fresh:
 *   - On mount: fetches the current live drop.
 *   - Realtime: re-fetches on every INSERT or UPDATE to the table. We don't
 *     trust realtime payloads for filtering — the active-drop query is
 *     cheap and authoritative.
 *   - Expiry: schedules a one-shot timer for `expires_at` so the ceremony
 *     dissolves itself even if the cockpit doesn't dismiss explicitly.
 */
export function useActiveClassicsDrop(): ClassicsDrop | null {
  const [drop, setDrop] = useState<ClassicsDrop | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      const live = await fetchActiveDrop();
      if (cancelled) return;
      setDrop(live);
      // Reset expiry timer.
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      if (live) {
        const ms = Math.max(0, new Date(live.expires_at).getTime() - Date.now());
        // Cap at ~24h so a misset drop can't pin a setTimeout forever.
        const safeMs = Math.min(ms, 24 * 60 * 60 * 1000);
        expiryTimer = setTimeout(() => {
          if (!cancelled) setDrop(null);
        }, safeMs);
      }
    };

    // Initial fetch.
    refresh();

    // Realtime — INSERT for new drops, UPDATE for "End Drop Now".
    const channel = supabase
      .channel('classics_drops:global')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'voyo_classics_drops' },
        () => { void refresh(); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'voyo_classics_drops' },
        () => { void refresh(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      try { channel.unsubscribe(); } catch { /* noop */ }
      try { supabase?.removeChannel(channel); } catch { /* noop */ }
    };
  }, []);

  return drop;
}
