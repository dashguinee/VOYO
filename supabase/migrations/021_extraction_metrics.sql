-- Extraction metrics on voyo_upload_queue — stop guessing, measure.
--
-- Three cheap columns so we can compute actual MB/s through the pipeline
-- and spot when proxy / YT / R2 degrade before users do.

ALTER TABLE voyo_upload_queue
  ADD COLUMN IF NOT EXISTS extraction_ms   int,    -- wall time claimed→completed
  ADD COLUMN IF NOT EXISTS audio_bytes     bigint, -- opus file size in R2
  ADD COLUMN IF NOT EXISTS duration_sec    int;    -- source video length

-- Throughput view: last 100 completed, what's our proxy doing?
CREATE OR REPLACE VIEW voyo_extraction_throughput AS
  SELECT
    date_trunc('hour', completed_at)        AS hour,
    COUNT(*)                                AS completions,
    AVG(extraction_ms)::int                 AS avg_ms,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY extraction_ms)::int AS p50_ms,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY extraction_ms)::int AS p90_ms,
    SUM(audio_bytes)                        AS total_bytes,
    ROUND(
      (SUM(audio_bytes)::numeric / NULLIF(SUM(extraction_ms), 0) * 1000)
      / 1048576,
      2
    )                                       AS effective_mbps
  FROM voyo_upload_queue
 WHERE status = 'done'
   AND extraction_ms IS NOT NULL
   AND completed_at >= now() - interval '24 hours'
 GROUP BY hour
 ORDER BY hour DESC;
