-- Atomic priority-escalation RPC for voyo_upload_queue.
--
-- Problem: when a user clicks a cold track that OYO prefetch already queued
-- at priority=7, the UPSERT from the client didn't reliably bump priority to
-- 10. Result: user click sits behind 200+ prefetch rows in the lane queue.
--
-- This RPC does two things atomically:
--   1. Insert the row if not present (priority = p_priority)
--   2. If present, set priority to GREATEST(existing, p_priority) — never
--      downgrade, always escalate on user intent.
--   3. If row was 'failed', reset status='pending' and failure_count=0 so
--      user intent retries a previously-dead row.

CREATE OR REPLACE FUNCTION bump_queue_priority(
  p_youtube_id text,
  p_priority int DEFAULT 10,
  p_title text DEFAULT NULL,
  p_artist text DEFAULT NULL,
  p_session text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_priority int;
BEGIN
  INSERT INTO voyo_upload_queue (
    youtube_id, title, artist, requested_by_session, priority,
    status, requested_at
  ) VALUES (
    p_youtube_id, p_title, p_artist, p_session, p_priority,
    'pending', now()
  )
  ON CONFLICT (youtube_id) DO UPDATE SET
    priority = GREATEST(voyo_upload_queue.priority, EXCLUDED.priority),
    requested_by_session = COALESCE(EXCLUDED.requested_by_session, voyo_upload_queue.requested_by_session),
    title  = COALESCE(EXCLUDED.title,  voyo_upload_queue.title),
    artist = COALESCE(EXCLUDED.artist, voyo_upload_queue.artist),
    status = CASE WHEN voyo_upload_queue.status = 'failed' THEN 'pending'
                  ELSE voyo_upload_queue.status END,
    failure_count = CASE WHEN voyo_upload_queue.status = 'failed' THEN 0
                         ELSE voyo_upload_queue.failure_count END,
    last_error = CASE WHEN voyo_upload_queue.status = 'failed' THEN NULL
                      ELSE voyo_upload_queue.last_error END
  RETURNING priority INTO v_new_priority;

  RETURN v_new_priority;
END;
$$;

-- Allow anon role to call the RPC (client-side will use anon key).
GRANT EXECUTE ON FUNCTION bump_queue_priority(text, int, text, text, text) TO anon, authenticated;
