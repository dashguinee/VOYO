-- RLS hardening v2 — drops ALL existing policies first, then rebuilds clean.
-- Run in VOYO project SQL editor (anmgyxhnyhbyxzpjhxgx).

-- ─── Step 1: see what policies currently exist (for reference) ───────────────
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('voyo_upload_queue', 'video_intelligence', 'voyo_playback_events')
ORDER BY tablename, policyname;

-- ─── Step 2: drop ALL existing policies on these tables ─────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE tablename IN ('voyo_upload_queue', 'video_intelligence', 'voyo_playback_events')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ─── Step 3: enable RLS on all three tables ──────────────────────────────────
ALTER TABLE voyo_upload_queue     ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_intelligence    ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_playback_events  ENABLE ROW LEVEL SECURITY;

-- ─── Step 4: voyo_upload_queue policies ──────────────────────────────────────
-- Anyone can read (feed checks r2_cached / status)
CREATE POLICY "queue_select_all"
  ON voyo_upload_queue FOR SELECT USING (true);

-- Only service_role may write (workers use service key, RPCs are SECURITY DEFINER)
CREATE POLICY "queue_insert_service"
  ON voyo_upload_queue FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "queue_update_service"
  ON voyo_upload_queue FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "queue_delete_service"
  ON voyo_upload_queue FOR DELETE USING (auth.role() = 'service_role');

-- ─── Step 5: video_intelligence policies ─────────────────────────────────────
CREATE POLICY "vi_select_all"
  ON video_intelligence FOR SELECT USING (true);

CREATE POLICY "vi_insert_service"
  ON video_intelligence FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "vi_update_service"
  ON video_intelligence FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "vi_delete_service"
  ON video_intelligence FOR DELETE USING (auth.role() = 'service_role');

-- ─── Step 6: voyo_playback_events policies ───────────────────────────────────
-- Anon can insert their own play events (not worker_tick/worker_error)
CREATE POLICY "pev_insert_client"
  ON voyo_playback_events FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR event_type NOT IN ('worker_tick', 'worker_error', 'worker_start')
  );

-- Only service_role reads (telemetry dashboard uses service key)
CREATE POLICY "pev_select_service"
  ON voyo_playback_events FOR SELECT USING (auth.role() = 'service_role');

-- ─── Step 7: cleanup audit test rows ─────────────────────────────────────────
DELETE FROM voyo_upload_queue WHERE youtube_id IN ('AUDIT_TEST1', 'AUDIT_SEC_TEST99');

-- ─── Step 8: verify ──────────────────────────────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('voyo_upload_queue', 'video_intelligence', 'voyo_playback_events');
