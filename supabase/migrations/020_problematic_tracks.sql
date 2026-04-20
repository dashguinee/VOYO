-- Problematic tracks pool — when a queue row hits failure_count=3, classify
-- WHY it failed so we can target the fix (fresh cookies, proxy rotation,
-- alternative extractor, just "skip it, it's DMCA") instead of letting the
-- track rot at status=failed.
--
-- Rule: status=failed rows are auto-categorized by pattern-matching
-- last_error. A `voyo_problematic_tracks` view groups them for triage.
-- To retry a category after fixing its root cause: UPDATE with
-- failure_count=0, status='pending' on that category.

-- 1. Classification column (null for non-failed rows).
ALTER TABLE voyo_upload_queue
  ADD COLUMN IF NOT EXISTS failure_category text;

-- 2. Pure function: error text → category.
CREATE OR REPLACE FUNCTION classify_queue_failure(err text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN err IS NULL                                  THEN NULL
    WHEN err ~* 'sign in to confirm|cookies?|from-browser'     THEN 'cookie_required'
    WHEN err ~* 'rate.?limit(ed)?|too many requests|429'       THEN 'rate_limited'
    WHEN err ~* 'not available in your country|geo.?block|region' THEN 'region_blocked'
    WHEN err ~* 'video unavailable|has been removed|private video'    THEN 'removed'
    WHEN err ~* 'age.?restricted|inappropriate'                THEN 'age_restricted'
    WHEN err ~* 'copyright|content owner|DMCA'                 THEN 'copyright'
    WHEN err ~* 'network|timeout|connection|ECONN'             THEN 'network'
    ELSE 'other'
  END;
$$;

-- 3. Trigger: stamp category whenever the queue row hits failed state.
CREATE OR REPLACE FUNCTION stamp_failure_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'failed' THEN
    NEW.failure_category := classify_queue_failure(NEW.last_error);
  ELSIF NEW.status = 'pending' AND OLD.status = 'failed' THEN
    -- explicit retry → clear category
    NEW.failure_category := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_failure_category ON voyo_upload_queue;
CREATE TRIGGER trg_stamp_failure_category
BEFORE UPDATE ON voyo_upload_queue
FOR EACH ROW
EXECUTE FUNCTION stamp_failure_category();

-- 4. Backfill existing failed rows.
UPDATE voyo_upload_queue
   SET failure_category = classify_queue_failure(last_error)
 WHERE status = 'failed'
   AND failure_category IS NULL;

-- 5. Triage view — easy to query, easy to read.
CREATE OR REPLACE VIEW voyo_problematic_tracks AS
  SELECT
    failure_category,
    COUNT(*)                               AS count,
    MIN(claimed_at)                        AS first_seen,
    MAX(claimed_at)                        AS last_seen,
    ARRAY_AGG(DISTINCT priority ORDER BY priority DESC) AS priorities,
    (ARRAY_AGG(last_error))[1]             AS sample_error
  FROM voyo_upload_queue
 WHERE status = 'failed'
 GROUP BY failure_category
 ORDER BY count DESC;

-- 6. Index for targeted-retry queries.
CREATE INDEX IF NOT EXISTS idx_voyo_upload_queue_failed_category
  ON voyo_upload_queue(failure_category)
  WHERE status = 'failed';
