-- Priority column for voyo_upload_queue — user clicks push to front.
-- Workers sort by priority DESC (higher = sooner) then requested_at ASC.

ALTER TABLE voyo_upload_queue
  ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 0;

-- Index on the hot claim subset — pending rows, ordered how workers consume.
-- Partial index keeps it tiny; matches the SELECT in claim_upload_queue.
DROP INDEX IF EXISTS idx_voyo_upload_queue_pending;
CREATE INDEX idx_voyo_upload_queue_pending_priority
  ON voyo_upload_queue(priority DESC, requested_at ASC)
  WHERE status = 'pending';

-- Re-create claim_upload_queue honoring priority.
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
      ORDER BY qq.priority DESC, qq.requested_at ASC
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.id, q.youtube_id, q.title, q.artist;
END;
$$;
