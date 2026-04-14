-- VOYO Playback Telemetry
-- Captures every playback attempt, success, failure, and source.
-- A streaming platform needs this visibility.

CREATE TABLE IF NOT EXISTS voyo_playback_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  event_type TEXT NOT NULL, -- 'play_start' | 'play_success' | 'play_fail' | 'skip_auto' | 'stall' | 'source_resolved'
  track_id TEXT NOT NULL,
  track_title TEXT,
  track_artist TEXT,
  source TEXT, -- 'cache' | 'r2' | 'vps' | 'edge' | 'preload' | null
  error_code TEXT, -- 'vps_timeout' | 'edge_fail' | 'decode_error' | 'not_allowed' | ...
  latency_ms INT, -- time from request to canplay
  is_background BOOLEAN DEFAULT false,
  user_agent TEXT,
  session_id TEXT,
  meta JSONB -- flexible context
);

CREATE INDEX IF NOT EXISTS voyo_playback_events_created_idx ON voyo_playback_events(created_at DESC);
CREATE INDEX IF NOT EXISTS voyo_playback_events_type_idx ON voyo_playback_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS voyo_playback_events_track_idx ON voyo_playback_events(track_id);
CREATE INDEX IF NOT EXISTS voyo_playback_events_error_idx ON voyo_playback_events(error_code) WHERE error_code IS NOT NULL;

-- Public insert (anon key), no read (use service key for dashboards)
ALTER TABLE voyo_playback_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voyo_playback_events_insert_anon" ON voyo_playback_events
  FOR INSERT TO anon WITH CHECK (true);

-- Quick failure summary view
CREATE OR REPLACE VIEW voyo_recent_failures AS
SELECT
  date_trunc('minute', created_at) as minute,
  error_code,
  source,
  COUNT(*) as count,
  COUNT(DISTINCT track_id) as unique_tracks
FROM voyo_playback_events
WHERE event_type = 'play_fail' AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY 1, 2, 3
ORDER BY 1 DESC;
