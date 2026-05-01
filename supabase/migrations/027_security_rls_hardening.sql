-- Security hardening: block anon writes on sensitive tables
-- Audit 2026-05-01: anon key could INSERT/UPDATE voyo_upload_queue and
-- PATCH video_intelligence (r2_cached poisoning). Queue lane workers need
-- service_role or a dedicated role — not anon.

-- ─── voyo_upload_queue ───────────────────────────────────────────────────────
-- Enable RLS if not already on
ALTER TABLE voyo_upload_queue ENABLE ROW LEVEL SECURITY;

-- Allow anyone (including anon) to READ the queue (feed checks cache status)
DROP POLICY IF EXISTS "anon can read queue" ON voyo_upload_queue;
CREATE POLICY "anon can read queue"
  ON voyo_upload_queue FOR SELECT
  USING (true);

-- Block all direct writes from non-service roles.
-- Workers use service_role key (set R2_UPLOAD_SECRET + service key in ecosystem).
-- The claim_upload_queue / mark_done / mark_failed RPCs are SECURITY DEFINER
-- and bypass RLS — they continue to work unchanged.
DROP POLICY IF EXISTS "service only insert" ON voyo_upload_queue;
CREATE POLICY "service only insert"
  ON voyo_upload_queue FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service only update" ON voyo_upload_queue;
CREATE POLICY "service only update"
  ON voyo_upload_queue FOR UPDATE
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service only delete" ON voyo_upload_queue;
CREATE POLICY "service only delete"
  ON voyo_upload_queue FOR DELETE
  USING (auth.role() = 'service_role');

-- ─── video_intelligence ───────────────────────────────────────────────────────
-- Anon can read (feed uses r2_cached flag).
-- Only service_role may write (workers flip r2_cached, store scores).
ALTER TABLE video_intelligence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can read video_intelligence" ON video_intelligence;
CREATE POLICY "anon can read video_intelligence"
  ON video_intelligence FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "service only update video_intelligence" ON video_intelligence;
CREATE POLICY "service only update video_intelligence"
  ON video_intelligence FOR UPDATE
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service only insert video_intelligence" ON video_intelligence;
CREATE POLICY "service only insert video_intelligence"
  ON video_intelligence FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service only delete video_intelligence" ON video_intelligence;
CREATE POLICY "service only delete video_intelligence"
  ON video_intelligence FOR DELETE
  USING (auth.role() = 'service_role');

-- ─── voyo_playback_events ─────────────────────────────────────────────────────
-- Anon can INSERT their own playback events (legit — client tracks plays).
-- Restrict worker_tick type to service_role to prevent telemetry spoofing.
ALTER TABLE voyo_playback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon can insert playback events" ON voyo_playback_events;
CREATE POLICY "anon can insert playback events"
  ON voyo_playback_events FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR event_type NOT IN ('worker_tick', 'worker_error', 'worker_start')
  );

DROP POLICY IF EXISTS "anon can read own events" ON voyo_playback_events;
CREATE POLICY "anon can read own events"
  ON voyo_playback_events FOR SELECT
  USING (auth.role() = 'service_role');

-- ─── Cleanup: remove audit test rows left by the security audit ───────────────
DELETE FROM voyo_upload_queue WHERE youtube_id IN ('AUDIT_TEST1', 'AUDIT_SEC_TEST99');
