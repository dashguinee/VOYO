-- Hard-isolate lanes to user-intent only (p=10).
--
-- Per spec (2026-04-20): workers only fire on direct user upload requests.
-- No prefetch, no cookie-healer zombie resurrection, no OYO background queue.
-- Mass-populating R2 is a separate deliberate script.
--
-- This migration re-creates claim_upload_queue to reject p<10 rows entirely —
-- even if they exist in the table, lanes can't claim them.

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
SECURITY DEFINER
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
        AND qq.priority >= 10         -- USER-INTENT ONLY
      ORDER BY qq.priority DESC, qq.requested_at ASC
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.youtube_id, q.title, q.artist;
END;
$$;

-- Also cancel any remaining pending p<10 rows so they don't linger in state.
UPDATE voyo_upload_queue
   SET status           = 'failed',
       failure_category = 'cancelled',
       last_error       = 'cancelled: lane user-only isolation (migration 023)'
 WHERE status = 'pending'
   AND priority < 10;
