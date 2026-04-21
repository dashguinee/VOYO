/**
 * useDashNotifications — realtime subscription to the cross-app
 * `dash_notifications` table in the Command Center Supabase.
 *
 * Filters rows to this app's audience:
 *   - `app` is 'all' OR matches `appCode` (e.g. 'voyo', 'hub')
 *   - `target_user` is null (broadcast) OR equals the current dashId
 *   - `status = 'sent'`
 *
 * Returns the latest 20 matching rows, plus a `markRead(id)` function
 * for when the UI surfaces one to the user. Read state is client-local
 * (sessionStorage) — the table itself doesn't track per-recipient read
 * receipts, and we don't need that server-side tracking yet.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ccSupabase } from '../lib/dahub/dahub-api';
import { devLog, devWarn } from '../utils/logger';

export interface DashNotification {
  id: string;
  app: string;
  title: string;
  body: string;
  url: string | null;
  target_tags: string[] | null;
  target_user: string | null;
  sent_by: string | null;
  sent_at: string;
  status: string;
  /** Client-side only — sessionStorage-backed. */
  read?: boolean;
}

interface Options {
  /** App code this client cares about. Rows with app='all' OR app===appCode pass. */
  appCode: 'voyo' | 'hub' | 'giraf' | string;
  /** Current user's dash_id. When present, target_user rows for this user also pass. */
  dashId?: string | null;
  /** How many recent rows to hydrate on mount. */
  limit?: number;
}

const READ_KEY = (id: string) => `dn-read:${id}`;
function isReadLocally(id: string): boolean {
  try { return sessionStorage.getItem(READ_KEY(id)) === '1'; } catch { return false; }
}
function markReadLocally(id: string): void {
  try { sessionStorage.setItem(READ_KEY(id), '1'); } catch { /* noop */ }
}

function matchesAudience(
  row: DashNotification,
  appCode: string,
  dashId: string | null | undefined,
): boolean {
  // App gate
  if (row.app !== 'all' && row.app !== appCode) return false;
  // Status gate
  if (row.status && row.status !== 'sent') return false;
  // Target gate: broadcast OR explicit target
  if (row.target_user && row.target_user !== dashId) return false;
  return true;
}

export function useDashNotifications({ appCode, dashId, limit = 20 }: Options): {
  notifications: DashNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
} {
  const [notifications, setNotifications] = useState<DashNotification[]>([]);

  // Initial fetch. Filter server-side where possible (app + status), do the
  // target_user filter client-side since `(null OR =dashId)` needs an OR which
  // is verbose in PostgREST.
  useEffect(() => {
    if (!ccSupabase) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await ccSupabase
          .from('dash_notifications')
          .select('*')
          .in('app', ['all', appCode])
          .eq('status', 'sent')
          .order('sent_at', { ascending: false })
          .limit(limit);
        if (cancelled) return;
        if (error) { devWarn('[DashNotifications] fetch error:', error.message); return; }
        const rows = (data || [])
          .filter((r: DashNotification) => matchesAudience(r, appCode, dashId))
          .map((r: DashNotification) => ({ ...r, read: isReadLocally(r.id) }));
        setNotifications(rows);
      } catch (e) {
        devWarn('[DashNotifications] fetch exception:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [appCode, dashId, limit]);

  // Realtime subscription to INSERT. Supabase Realtime doesn't let us do
  // compound OR filters on the server, so we subscribe to the whole table
  // and filter client-side (cheap — this table is write-rare).
  useEffect(() => {
    if (!ccSupabase) return;
    const client = ccSupabase;
    // supabase-js tightened .on() overloads in newer versions — the
    // realtime event strings resolve at runtime but TS misfires.
    const channel = (client.channel(`dash_notifications:${appCode}`) as any)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dash_notifications' },
        (payload: { new?: DashNotification }) => {
          const row = payload.new;
          if (!row) return;
          if (!matchesAudience(row, appCode, dashId)) return;
          devLog('[DashNotifications] realtime:', row.title);
          setNotifications(prev => {
            if (prev.some(p => p.id === row.id)) return prev;
            return [{ ...row, read: isReadLocally(row.id) }, ...prev].slice(0, limit);
          });
        },
      )
      .subscribe();
    return () => {
      try { client.removeChannel(channel); } catch { /* noop */ }
    };
  }, [appCode, dashId, limit]);

  const markRead = useCallback((id: string) => {
    markReadLocally(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications],
  );

  return { notifications, unreadCount, markRead };
}
