-- Migration 025 — voyo_track_heat materialized view
--
-- Purpose: replace the old update_track_metrics trigger (which we dropped
-- on 2026-04-22 because it updated voyo_tracks under the caller's role and
-- tripped RLS for anon writers) with an aggregation keyed by the real track
-- identifier — YouTube id — instead of voyo_tracks.voyo_id.
--
-- Same weighting the old trigger used (play=1, love=5, complete=3, queue=2,
-- skip=-2) plus oye=4 for the new engagement action. Refreshed every 15 min
-- by a pg_cron job (see below) so it stays within the taste-graph freshness
-- window without hammering the primary during every signal insert.
--
-- Consumers:
--   - client-side poolCurator: filter hot/discover pools by heat_score > N
--   - server-side "Rising Now" shelf query (coming in a later migration)
--   - analytics dashboards

CREATE MATERIALIZED VIEW IF NOT EXISTS public.voyo_track_heat AS
SELECT
  track_id,
  COUNT(*) FILTER (WHERE action = 'play')     AS plays,
  COUNT(*) FILTER (WHERE action = 'love')     AS loves,
  COUNT(*) FILTER (WHERE action = 'skip')     AS skips,
  COUNT(*) FILTER (WHERE action = 'complete') AS completes,
  COUNT(*) FILTER (WHERE action = 'queue')    AS queues,
  COUNT(*) FILTER (WHERE action = 'oye')      AS oyes,
  (
    COUNT(*) FILTER (WHERE action = 'play')
    + COUNT(*) FILTER (WHERE action = 'love')     * 5
    + COUNT(*) FILTER (WHERE action = 'complete') * 3
    + COUNT(*) FILTER (WHERE action = 'queue')    * 2
    + COUNT(*) FILTER (WHERE action = 'oye')      * 4
    - COUNT(*) FILTER (WHERE action = 'skip')     * 2
  ) AS heat_score,
  MAX(created_at) AS last_signal_at
FROM public.voyo_signals
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY track_id;

-- Unique index enables REFRESH MATERIALIZED VIEW CONCURRENTLY on subsequent runs.
CREATE UNIQUE INDEX IF NOT EXISTS voyo_track_heat_pk
  ON public.voyo_track_heat(track_id);

CREATE INDEX IF NOT EXISTS voyo_track_heat_score_idx
  ON public.voyo_track_heat(heat_score DESC);

CREATE INDEX IF NOT EXISTS voyo_track_heat_recent_idx
  ON public.voyo_track_heat(last_signal_at DESC);

-- Aggregated read-only — safe for anon.
GRANT SELECT ON public.voyo_track_heat TO anon, authenticated;

-- Refresh function. SECURITY DEFINER so the scheduler (or any caller) can
-- trigger a refresh without needing privileges on voyo_signals directly.
CREATE OR REPLACE FUNCTION public.refresh_voyo_track_heat()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.voyo_track_heat;
EXCEPTION WHEN feature_not_supported THEN
  -- first refresh after a fresh populate can't use CONCURRENTLY; fall back
  REFRESH MATERIALIZED VIEW public.voyo_track_heat;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.refresh_voyo_track_heat() TO anon, authenticated;

-- Optional: schedule 15-minute refresh via pg_cron. Uncomment when ready.
-- Requires `pg_cron` extension. Safe to skip initially — run manually via
-- `SELECT refresh_voyo_track_heat();` while validating.
--
-- SELECT cron.schedule(
--   'refresh-voyo-track-heat',
--   '*/15 * * * *',
--   $$SELECT public.refresh_voyo_track_heat()$$
-- );
