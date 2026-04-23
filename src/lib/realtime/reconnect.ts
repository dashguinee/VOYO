/**
 * makeReconnectingChannel — wrap any Supabase RealtimeChannel so it
 * automatically re-subscribes on TIMED_OUT / CLOSED / CHANNEL_ERROR.
 *
 * Problem: Supabase realtime channels silently die when the tab is
 * backgrounded for long periods or when a mobile OS pauses the socket.
 * AUDIT SOCIAL-1/2 confirmed TIMED_OUT + CHANNEL_ERROR are the main
 * culprits. Without recovery the user misses messages until they reload.
 *
 * Usage:
 *   const sub = makeReconnectingChannel(
 *     () => supabase.channel('foo').on('postgres_changes', {...}, cb),
 *     () => { refetch(); }   // called after successful re-subscribe
 *   );
 *   // later:
 *   sub.unsubscribe();
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

export function makeReconnectingChannel(
  createChannel: () => RealtimeChannel,
  onReconnect?: () => void,
): { unsubscribe: () => void } {
  let channel: RealtimeChannel | null = null;
  let disposed = false;
  let retryCount = 0;

  function wire() {
    if (disposed) return;
    channel = createChannel();
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        retryCount = 0;
        if (onReconnect) onReconnect();
      } else if (
        status === 'TIMED_OUT' ||
        status === 'CLOSED' ||
        status === 'CHANNEL_ERROR'
      ) {
        // Exponential backoff capped at 30 s
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30_000);
        retryCount++;
        setTimeout(() => {
          if (!disposed) {
            try { channel?.unsubscribe(); } catch {}
            wire();
          }
        }, delay);
      }
    });
  }

  wire();

  return {
    unsubscribe: () => {
      disposed = true;
      try { channel?.unsubscribe(); } catch {}
    },
  };
}
