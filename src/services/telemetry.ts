/**
 * VOYO Playback Telemetry
 *
 * Observability layer for streaming playback. Batched Supabase inserts for
 * every playback event — success, failure, source, latency, stall.
 * Fire-and-forget. Never blocks audio. Never throws. sendBeacon on pagehide.
 *
 * Design goals:
 * - Zero impact on audio thread (no sync work, no awaits in call path)
 * - Survives network failures (batching + retry)
 * - Survives page unload (sendBeacon)
 * - Easy to apply to sibling apps (Tivi, Hub) — copy this file, change APP_ID
 *
 * Table: voyo_playback_events
 * See: voyo-music/supabase/migrations/telemetry.sql
 */

import { supabase } from '../lib/supabase';
import { devLog, devWarn } from '../utils/logger';

// App identity — swap for Tivi: 'dashtivi' / table: 'dashtivi_playback_events'
const APP_ID = 'voyo';
const TABLE = 'voyo_playback_events';

export type PlaybackEventType =
  | 'play_start'         // user-initiated session start
  | 'play_success'       // audio element's onPlay — actually playing
  | 'play_fail'          // audio.play() rejected
  | 'stream_error'       // audio element onError — MediaError.code + message
  | 'stream_stall'       // audio element waiting/stalled with readyState
  | 'stream_ended'       // audio element ended while session still active (unexpected)
  | 'bg_disconnect'      // stream dropped on background
  | 'bg_reconnect'       // stream recovered after background disconnect
  | 'skip_stuck'         // isSkipping flag stuck for >10s — cleared automatically
  | 'source_resolved'    // a source (cache/r2/vps/edge) delivered the track
  | 'stall'              // playback stalled during streaming
  | 'skip_auto'          // track auto-skipped (watchdog / max-retry / recovery)
  | 'trace';             // full-session debug trace (localStorage.voyoDebug = '1')

export type PlaybackSource =
  | 'preload'
  | 'cache'
  | 'r2'
  | 'iframe'
  | 'vps'
  | 'vps-r2'
  | 'edge'
  | null;

export type ErrorCode =
  | 'vps_timeout'
  | 'edge_fail'
  | 'decode_error'
  | 'network_error'
  | 'not_allowed'
  | 'max_retries'
  | 'load_watchdog'
  | 'aborted'
  | 'unknown';

interface PlaybackEvent {
  event_type: PlaybackEventType;
  track_id: string;
  track_title?: string;
  track_artist?: string;
  source?: PlaybackSource;
  error_code?: ErrorCode;
  latency_ms?: number;
  is_background: boolean;
  user_agent: string;
  session_id: string;
  meta?: Record<string, unknown>;
}

// Session persists for the lifetime of the tab. Correlates events
// from a single listening session.
const sessionId = `${APP_ID}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// Batching: flush on 10s interval OR when buffer hits 20 events
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_SIZE = 20;
const MAX_BUFFER = 100; // Hard cap — drop oldest on overflow (prevents memory leak)

let buffer: PlaybackEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    if (!supabase) {
      // Supabase not configured — drop silently
      return;
    }
    const { error } = await supabase.from(TABLE).insert(batch);
    if (error) {
      consecutiveFailures++;
      if (consecutiveFailures <= 3) {
        devWarn(`[Telemetry] Insert failed (${consecutiveFailures}):`, error.message);
      }
      // After 3 consecutive failures, stop retrying for this session
      // (schema issue or auth issue — no point spamming)
      if (consecutiveFailures > 10) {
        devWarn('[Telemetry] Too many failures, disabling for this session');
        buffer = []; // drop everything
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      }
    } else {
      consecutiveFailures = 0;
      devLog(`[Telemetry] Flushed ${batch.length} events`);
    }
  } catch (e) {
    consecutiveFailures++;
    if (consecutiveFailures <= 3) {
      devWarn('[Telemetry] Flush exception:', e);
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Log a playback event. Fire-and-forget — never throws, never blocks.
 * Batched and flushed every 10s or when buffer hits 20 events.
 * If the buffer overflows (network is down), oldest events are dropped.
 */
export function logPlaybackEvent(
  event: Omit<PlaybackEvent, 'is_background' | 'user_agent' | 'session_id'>
): void {
  try {
    const hidden = typeof document !== 'undefined' && document.hidden;
    const full: PlaybackEvent = {
      ...event,
      is_background: hidden,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
      session_id: sessionId,
    };

    // BG REAL-TIME FLUSH: setTimeout is throttled 1/min in BG. We tried
    // fetch(keepalive:true) in v190 — it also got deferred by Android
    // Chrome in deep BG, events piling up until visibility returned.
    //
    // sendBeacon is the ONE API specifically designed to bypass BG
    // throttling AND survive page unload. The catch: it can't set custom
    // headers — but Supabase PostgREST accepts `apikey` via URL query
    // string, which is good enough for anon-role inserts (RLS-gated).
    //
    // Cost: one beacon per trace event in BG. Benefit: real-time BG
    // observability, which is literally the only way to debug playback
    // on a locked Android phone.
    if (hidden && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const base = import.meta.env.VITE_SUPABASE_URL;
        const url = `${base}/rest/v1/${TABLE}?apikey=${encodeURIComponent(key)}`;
        const blob = new Blob([JSON.stringify([full])], { type: 'application/json' });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return; // queued for delivery — don't also buffer
        // Beacon rejected (queue full) → fall through to buffer
      } catch {
        // fall through to buffer
      }
    }

    // Hard cap — drop oldest if we overflow (network outage scenario)
    if (buffer.length >= MAX_BUFFER) {
      buffer.shift();
    }
    buffer.push(full);
    if (buffer.length >= FLUSH_SIZE) {
      flush();
    } else {
      scheduleFlush();
    }
  } catch {
    // Never break playback for telemetry
  }
}

/**
 * Flush on page hide — use sendBeacon for reliable delivery during unload.
 * sendBeacon is NOT throttled by background timer rules.
 */
if (typeof window !== 'undefined') {
  const unloadFlush = () => {
    if (buffer.length === 0) return;
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/${TABLE}`;
      const body = JSON.stringify(buffer);
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      // Use fetch with keepalive (beacon doesn't set headers reliably)
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}` },
          body,
          keepalive: true,
        }).catch(() => {});
      }
      buffer = [];
    } catch {
      // best-effort
    }
  };
  window.addEventListener('pagehide', unloadFlush);
  // Also flush on visibilitychange → hidden (user backgrounded the tab)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && buffer.length > 0) {
      flush();
    }
  });
}

/**
 * TRACE helper — fires a full-context trace event at every pipeline decision
 * point. Always-on for now (user is solo, full visibility desired). Cheap —
 * just an enqueue into the existing batch buffer.
 *
 * Caller pattern:
 *   trace('load_guard', trackId, { why: 'same-track' });
 *   trace('play_call', trackId, { path: 'preload', hidden: document.hidden });
 */
export function trace(subtype: string, trackId: string | null | undefined, meta: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  logPlaybackEvent({
    event_type: 'trace',
    track_id: trackId || '-',
    meta: { subtype, ...meta },
  });
}

/**
 * DEBUG: expose telemetry + trace control to window for manual testing.
 * `voyoTelemetry.flush()` — force immediate flush
 * `voyoTelemetry.stats()` — see buffer state
 * `voyoTelemetry.enableDebug()` — turn trace ON for this device (persists)
 * `voyoTelemetry.disableDebug()` — turn trace OFF
 */
if (typeof window !== 'undefined') {
  (window as any).voyoTelemetry = {
    flush,
    stats: () => ({ bufferSize: buffer.length, sessionId, consecutiveFailures, debug: typeof localStorage !== 'undefined' && localStorage.getItem('voyoDebug') === '1' }),
    enableDebug: () => { try { localStorage.setItem('voyoDebug', '1'); console.log('[VOYO] trace ON — session:', sessionId); } catch {} },
    disableDebug: () => { try { localStorage.removeItem('voyoDebug'); console.log('[VOYO] trace OFF'); } catch {} },
    sessionId: () => sessionId,
  };
}
