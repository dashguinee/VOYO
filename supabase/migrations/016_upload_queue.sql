-- voyo_upload_queue — dynamic extraction queue for the free-path pipeline.
--
-- Flow: PWA search hits a track not in R2 → UPSERT a row here → warm-polling
-- GitHub Actions workers (audio_conquest_queue.yml) claim rows via
-- claim_upload_queue(...), run yt-dlp, upload to R2, mark status='done'.
-- PWA subscribes to status changes via Supabase realtime and OYO plays the
-- track as soon as it's ready.
--
-- Replaces the Webshare cold-miss path. No Webshare bandwidth spent on
-- search results — R2 serves hits, the queue serves misses.

CREATE TABLE IF NOT EXISTS voyo_upload_queue (
  id                    bigserial PRIMARY KEY,
  youtube_id            text NOT NULL UNIQUE,
  requested_at          timestamptz DEFAULT now(),
  requested_by_session  text,
  claimed_at            timestamptz,
  claimed_by_worker     text,
  completed_at          timestamptz,
  status                text DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','done','failed')),
  failure_count         int DEFAULT 0,
  last_error            text,
  -- Metadata snapshot at request time (so workers don't need to re-query
  -- video_intelligence for title/artist to log)
  title                 text,
  artist                text
);

-- Workers read pending rows ordered by age — index only on the hot subset.
CREATE INDEX IF NOT EXISTS idx_voyo_upload_queue_pending
  ON voyo_upload_queue(requested_at)
  WHERE status = 'pending';

-- Quick lookups by youtube_id for the PWA re-request path
CREATE INDEX IF NOT EXISTS idx_voyo_upload_queue_ytid
  ON voyo_upload_queue(youtube_id);

-- Realtime: PWA subscribes to UPDATE events on this table to know when a
-- pending track has landed in R2 (status -> 'done').
ALTER PUBLICATION supabase_realtime ADD TABLE voyo_upload_queue;

-- ──────────────────────────────────────────────────────────────────────────
-- claim_upload_queue — atomic N-row claim with SKIP LOCKED
--
-- Returns up to `batch_size` pending rows, marking them as 'processing' so
-- no other worker can claim them. SELECT ... FOR UPDATE SKIP LOCKED lets
-- any number of workers hit this concurrently without deadlocking.
--
-- failure_count < 3 gate — retry up to 3x before giving up on a track.
-- Permanently failed rows stay as status='failed' for the operator to inspect.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_upload_queue(
  p_worker_id  text,
  p_batch_size int DEFAULT 5
)
RETURNS TABLE(
  id          bigint,
  youtube_id  text,
  title       text,
  artist      text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE voyo_upload_queue q
     SET status             = 'processing',
         claimed_at         = now(),
         claimed_by_worker  = p_worker_id
   WHERE q.id IN (
     SELECT qq.id
       FROM voyo_upload_queue qq
      WHERE qq.status = 'pending'
        AND qq.failure_count < 3
      ORDER BY qq.requested_at ASC
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.youtube_id, q.title, q.artist;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- requeue_stale_claims — safety net for workers that die mid-processing.
--
-- If claimed_at > 10 min ago and status still 'processing', something killed
-- the worker before it could mark done/failed. Reset to pending so the next
-- worker picks it up. Call this periodically (cron / worker startup).
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION requeue_stale_claims()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  n int;
BEGIN
  UPDATE voyo_upload_queue
     SET status             = 'pending',
         claimed_at         = NULL,
         claimed_by_worker  = NULL
   WHERE status = 'processing'
     AND claimed_at < now() - interval '10 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — anon can INSERT (PWA queue requests) and SELECT their own rows.
-- Only service role can UPDATE / claim. Keeps workers authoritative.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE voyo_upload_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS queue_anon_insert ON voyo_upload_queue;
CREATE POLICY queue_anon_insert ON voyo_upload_queue
  FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS queue_anon_upsert ON voyo_upload_queue;
CREATE POLICY queue_anon_upsert ON voyo_upload_queue
  FOR UPDATE TO anon
  USING (status = 'pending')
  WITH CHECK (status = 'pending');  -- only bumps to an already-pending row

DROP POLICY IF EXISTS queue_anon_read ON voyo_upload_queue;
CREATE POLICY queue_anon_read ON voyo_upload_queue
  FOR SELECT TO anon
  USING (true);  -- PWA needs to see status changes via realtime

-- Service role (workers) bypasses RLS entirely.
