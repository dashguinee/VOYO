/**
 * VOYO Playback Telemetry
 *
 * Captures every playback event (success, failure, source, latency) and
 * batches them to Supabase. This is what a streaming platform needs to
 * know WHY tracks fail, which backends are slow, and what to fix.
 *
 * Events are batched (every 10s or 20 events) to minimize network overhead.
 * Fire-and-forget — never blocks the audio thread.
 */

import { supabase } from '../lib/supabase';
import { devLog, devWarn } from '../utils/logger';

export type PlaybackEventType =
  | 'play_start'       // loadTrack fired
  | 'play_success'     // audio.play() resolved → playing
  | 'play_fail'        // audio.play() rejected, not NotAllowedError
  | 'source_resolved'  // a source (cache/r2/vps/edge) delivered the track
  | 'stall'            // playback stalled during streaming
  | 'skip_auto';       // track auto-skipped by watchdog/max-retry

export type PlaybackSource =
  | 'preload'
  | 'cache'
  | 'r2'
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

// Session ID persists for the lifetime of the tab
const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let buffer: PlaybackEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 10000;
const FLUSH_SIZE = 20;

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    if (!supabase) return;
    const { error } = await supabase.from('voyo_playback_events').insert(batch);
    if (error) {
      devWarn('[Telemetry] Insert failed:', error.message);
    } else {
      devLog(`[Telemetry] Flushed ${batch.length} events`);
    }
  } catch (e) {
    devWarn('[Telemetry] Flush exception:', e);
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
 */
export function logPlaybackEvent(event: Omit<PlaybackEvent, 'is_background' | 'user_agent' | 'session_id'>): void {
  try {
    buffer.push({
      ...event,
      is_background: typeof document !== 'undefined' && document.hidden,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
      session_id: sessionId,
    });
    if (buffer.length >= FLUSH_SIZE) {
      flush();
    } else {
      scheduleFlush();
    }
  } catch {
    // Never break playback for telemetry
  }
}

// Flush pending events on page unload (best effort)
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (buffer.length === 0) return;
    // Use sendBeacon for reliable delivery during unload
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/voyo_playback_events`;
      const blob = new Blob([JSON.stringify(buffer)], { type: 'application/json' });
      navigator.sendBeacon?.(url, blob);
      buffer = [];
    } catch {
      // Ignore — best effort only
    }
  });
}
