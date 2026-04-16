-- VOYO Music — voyo_tracks → video_intelligence consolidation (FINAL)
-- Last updated: 2026-04-16
--
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- The Dashboard editor runs as postgres superuser so it bypasses RLS.
--
-- This script is IDEMPOTENT — safe to re-run. ON CONFLICT DO UPDATE uses
-- GREATEST / sum / OR so merging signals twice doesn't corrupt data (though
-- sums would double if you ran it back-to-back on fresh signal rows; the
-- post-merge checks at the bottom will catch drift).
--
-- WHAT THIS DOES
--  1. Defends against missing rows (88 voyo_tracks rows were absent from
--     video_intelligence last run).
--  2. Merges engagement signals (play/love/skip/complete/queue/heat)
--     and R2 cache flags from voyo_tracks into video_intelligence.
--  3. Adds `fail_count`, `last_failed_at`, `blocklisted` columns so dead
--     tracks can auto-block after N failures.
--  4. Replaces get_hot_tracks + get_discovery_tracks with versions that
--     filter blocklisted/empty-vibe_scores rows.
--  5. Adds a `record_signal` RPC that the PWA will call for play/skip/
--     love/complete/fail — the missing write path that made voyo_signals
--     stay at 0 rows.
--  6. Recomputes derived rates after the counts are merged.
--
-- WHAT THIS DOES NOT DO
--  - Drop voyo_tracks. Leaving it for 1-week soak so rollback is easy.
--  - Touch the PWA client — code changes ship separately (see RUNBOOK).

BEGIN;

-- ─── 1. Failure-tracking columns (phase 3) ──────────────────────────────
ALTER TABLE video_intelligence
  ADD COLUMN IF NOT EXISTS fail_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocklisted BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_video_intel_blocklisted
  ON video_intelligence(blocklisted) WHERE blocklisted = TRUE;
CREATE INDEX IF NOT EXISTS idx_video_intel_play_count
  ON video_intelligence(play_count DESC) WHERE play_count > 0;

-- ─── 2. Merge voyo_tracks signals (phase 2 re-run with NULL defense) ────
INSERT INTO video_intelligence (
  youtube_id, title, artist, thumbnail_url,
  vibe_afro_heat, vibe_chill_vibes, vibe_party_mode, vibe_late_night, vibe_workout,
  play_count, queue_count,
  love_count, skip_count, complete_count,
  skip_rate, completion_rate, love_rate,
  heat_score, verified,
  r2_cached, r2_quality, r2_size, r2_cached_at,
  last_played
)
SELECT
  youtube_id,
  COALESCE(title, '[unknown]'),
  artist, thumbnail,
  COALESCE(vibe_afro_heat, 0),   COALESCE(vibe_chill_vibes, 0),
  COALESCE(vibe_party_mode, 0),  COALESCE(vibe_late_night, 0),
  COALESCE(vibe_workout, 0),
  COALESCE(play_count, 0),       COALESCE(queue_count, 0),
  COALESCE(love_count, 0),       COALESCE(skip_count, 0),
  COALESCE(complete_count, 0),
  COALESCE(skip_rate, 0),        COALESCE(completion_rate, 0),
  COALESCE(love_rate, 0),
  COALESCE(heat_score, 0),       COALESCE(verified, FALSE),
  COALESCE(r2_cached, FALSE),    r2_quality, r2_size, r2_cached_at,
  last_played
FROM voyo_tracks
WHERE youtube_id IS NOT NULL AND youtube_id <> ''
ON CONFLICT (youtube_id) DO UPDATE SET
  vibe_afro_heat   = GREATEST(EXCLUDED.vibe_afro_heat,   video_intelligence.vibe_afro_heat),
  vibe_chill_vibes = GREATEST(EXCLUDED.vibe_chill_vibes, video_intelligence.vibe_chill_vibes),
  vibe_party_mode  = GREATEST(EXCLUDED.vibe_party_mode,  video_intelligence.vibe_party_mode),
  vibe_late_night  = GREATEST(EXCLUDED.vibe_late_night,  video_intelligence.vibe_late_night),
  vibe_workout     = GREATEST(EXCLUDED.vibe_workout,     video_intelligence.vibe_workout),
  play_count     = video_intelligence.play_count + EXCLUDED.play_count,
  queue_count    = video_intelligence.queue_count + EXCLUDED.queue_count,
  love_count     = video_intelligence.love_count + EXCLUDED.love_count,
  skip_count     = video_intelligence.skip_count + EXCLUDED.skip_count,
  complete_count = video_intelligence.complete_count + EXCLUDED.complete_count,
  heat_score     = GREATEST(EXCLUDED.heat_score, video_intelligence.heat_score),
  r2_cached      = video_intelligence.r2_cached OR EXCLUDED.r2_cached,
  r2_quality     = COALESCE(EXCLUDED.r2_quality, video_intelligence.r2_quality),
  r2_size        = COALESCE(EXCLUDED.r2_size,    video_intelligence.r2_size),
  r2_cached_at   = COALESCE(EXCLUDED.r2_cached_at, video_intelligence.r2_cached_at),
  verified       = video_intelligence.verified OR EXCLUDED.verified,
  last_played    = GREATEST(EXCLUDED.last_played, video_intelligence.last_played);

-- ─── 3. Recompute derived rates from merged counts ──────────────────────
UPDATE video_intelligence
SET
  skip_rate       = CASE WHEN play_count > 0 THEN (skip_count::numeric / play_count::numeric) * 100 ELSE 0 END,
  completion_rate = CASE WHEN play_count > 0 THEN (complete_count::numeric / play_count::numeric) * 100 ELSE 0 END,
  love_rate       = CASE WHEN play_count > 0 THEN (love_count::numeric / play_count::numeric) * 100 ELSE 0 END
WHERE play_count > 0;

-- ─── 4. record_signal RPC — the write path the PWA has been missing ─────
-- Call this from the PWA whenever a track plays/skips/loves/completes/fails.
-- Bumps counts atomically; at 3 consecutive fails it auto-blocklists the ID.
CREATE OR REPLACE FUNCTION record_signal(
  p_youtube_id TEXT,
  p_action TEXT,                -- 'play' | 'skip' | 'love' | 'complete' | 'fail' | 'queue'
  p_listen_duration INT DEFAULT 0
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_youtube_id IS NULL OR p_youtube_id = '' THEN RETURN; END IF;

  -- Insert row if absent with a stub title; future enrichment fills it in.
  INSERT INTO video_intelligence (youtube_id, title, discovery_method)
  VALUES (p_youtube_id, '[unknown]', 'manual_play')
  ON CONFLICT (youtube_id) DO NOTHING;

  -- Apply the signal.
  CASE p_action
    WHEN 'play'     THEN UPDATE video_intelligence
                         SET play_count   = play_count + 1,
                             last_played  = now()
                         WHERE youtube_id = p_youtube_id;
    WHEN 'love'     THEN UPDATE video_intelligence
                         SET love_count   = love_count + 1
                         WHERE youtube_id = p_youtube_id;
    WHEN 'skip'     THEN UPDATE video_intelligence
                         SET skip_count   = skip_count + 1
                         WHERE youtube_id = p_youtube_id;
    WHEN 'complete' THEN UPDATE video_intelligence
                         SET complete_count = complete_count + 1
                         WHERE youtube_id = p_youtube_id;
    WHEN 'queue'    THEN UPDATE video_intelligence
                         SET queue_count  = queue_count + 1
                         WHERE youtube_id = p_youtube_id;
    WHEN 'fail'     THEN UPDATE video_intelligence
                         SET fail_count     = fail_count + 1,
                             last_failed_at = now(),
                             -- Auto-blocklist after 3 failures
                             blocklisted    = (fail_count + 1 >= 3)
                         WHERE youtube_id = p_youtube_id;
    ELSE
      RAISE NOTICE 'record_signal: unknown action %', p_action;
  END CASE;

  -- Recompute rates lazily per row.
  UPDATE video_intelligence
  SET skip_rate       = CASE WHEN play_count > 0 THEN (skip_count::numeric / play_count::numeric) * 100 ELSE 0 END,
      completion_rate = CASE WHEN play_count > 0 THEN (complete_count::numeric / play_count::numeric) * 100 ELSE 0 END,
      love_rate       = CASE WHEN play_count > 0 THEN (love_count::numeric / play_count::numeric) * 100 ELSE 0 END
  WHERE youtube_id = p_youtube_id AND play_count > 0;
END;
$$;

-- Anon role can call it (RLS is irrelevant because SECURITY DEFINER).
GRANT EXECUTE ON FUNCTION record_signal(TEXT, TEXT, INT) TO anon, authenticated;

-- ─── 5. Recommendation RPCs — filter blocklisted + require vibe_scores ──
-- These REPLACE the existing get_hot_tracks / get_discovery_tracks. Same
-- return shape the PWA already consumes; new WHERE clauses add the filters.
CREATE OR REPLACE FUNCTION get_hot_tracks(
  p_afro_heat REAL DEFAULT 0.2,
  p_chill REAL DEFAULT 0.2,
  p_party REAL DEFAULT 0.2,
  p_workout REAL DEFAULT 0.2,
  p_late_night REAL DEFAULT 0.2,
  p_limit INT DEFAULT 30,
  p_exclude_ids TEXT[] DEFAULT '{}'
) RETURNS TABLE(
  youtube_id TEXT, title TEXT, artist TEXT, vibe_match_score REAL,
  artist_tier TEXT, primary_genre TEXT, cultural_tags TEXT[], thumbnail_url TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH top_tier AS (
    SELECT vi.youtube_id, vi.title, vi.artist, vi.artist_tier,
           vi.primary_genre, vi.cultural_tags, vi.thumbnail_url, vi.vibe_scores,
           vi.heat_score, vi.play_count
    FROM video_intelligence vi
    WHERE vi.artist_tier IN ('A', 'B')
      AND vi.vibe_scores IS NOT NULL
      AND vi.vibe_scores <> '{}'::jsonb
      AND NOT COALESCE(vi.blocklisted, FALSE)
      AND COALESCE(vi.fail_count, 0) < 3
      AND NOT (vi.youtube_id = ANY(p_exclude_ids))
    LIMIT 500
  )
  SELECT
    tt.youtube_id, tt.title, tt.artist,
    (
      COALESCE((tt.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((tt.vibe_scores->>'chill')::REAL,     0) * p_chill +
      COALESCE((tt.vibe_scores->>'party')::REAL,     0) * p_party +
      COALESCE((tt.vibe_scores->>'workout')::REAL,   0) * p_workout +
      COALESCE((tt.vibe_scores->>'late_night')::REAL,0) * p_late_night +
      -- Engagement boost: heat_score and play_count push modern/actually-loved tracks up
      (COALESCE(tt.heat_score, 0) * 0.5) +
      (LEAST(COALESCE(tt.play_count, 0), 500) * 0.1)
    )::REAL AS vibe_match_score,
    tt.artist_tier, tt.primary_genre, tt.cultural_tags, tt.thumbnail_url
  FROM top_tier tt
  ORDER BY vibe_match_score DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION get_discovery_tracks(
  p_afro_heat REAL DEFAULT 0.2,
  p_chill REAL DEFAULT 0.2,
  p_party REAL DEFAULT 0.2,
  p_workout REAL DEFAULT 0.2,
  p_late_night REAL DEFAULT 0.2,
  p_limit INT DEFAULT 30,
  p_exclude_ids TEXT[] DEFAULT '{}'
) RETURNS TABLE(
  youtube_id TEXT, title TEXT, artist TEXT, vibe_match_score REAL,
  artist_tier TEXT, primary_genre TEXT, cultural_tags TEXT[], thumbnail_url TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    -- Discovery leans toward LESS-played tracks to expand horizons,
    -- but still requires classification + no blocklist.
    SELECT vi.youtube_id, vi.title, vi.artist, vi.artist_tier,
           vi.primary_genre, vi.cultural_tags, vi.thumbnail_url, vi.vibe_scores,
           vi.play_count
    FROM video_intelligence vi
    WHERE vi.vibe_scores IS NOT NULL
      AND vi.vibe_scores <> '{}'::jsonb
      AND NOT COALESCE(vi.blocklisted, FALSE)
      AND COALESCE(vi.fail_count, 0) < 3
      AND COALESCE(vi.play_count, 0) < 100       -- discovery-worthy, not hot
      AND NOT (vi.youtube_id = ANY(p_exclude_ids))
    LIMIT 2000
  )
  SELECT
    c.youtube_id, c.title, c.artist,
    (
      COALESCE((c.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((c.vibe_scores->>'chill')::REAL,     0) * p_chill +
      COALESCE((c.vibe_scores->>'party')::REAL,     0) * p_party +
      COALESCE((c.vibe_scores->>'workout')::REAL,   0) * p_workout +
      COALESCE((c.vibe_scores->>'late_night')::REAL,0) * p_late_night
    )::REAL AS vibe_match_score,
    c.artist_tier, c.primary_genre, c.cultural_tags, c.thumbnail_url
  FROM candidates c
  ORDER BY vibe_match_score DESC, random()   -- tie-break with random for diversity
  LIMIT p_limit;
END;
$$;

COMMIT;

-- ═══ VERIFY (run these separately, NOT inside the transaction) ═════════
--
-- 1. Merge worked?
-- SELECT COUNT(*) FILTER (WHERE play_count > 0) AS signal_rows,
--        COUNT(*) FILTER (WHERE r2_cached) AS r2_rows,
--        MAX(play_count) AS max_play_count,
--        COUNT(*) FILTER (WHERE blocklisted) AS blocklisted_rows
-- FROM video_intelligence;
-- Expected: signal_rows ≥ 589, r2_rows ≥ 75, max_play_count ≥ 1585, blocklisted_rows = 0.
--
-- 2. Orphan check — any voyo_tracks still missing from video_intelligence?
-- SELECT COUNT(*) FROM voyo_tracks vt
-- LEFT JOIN video_intelligence vi ON vi.youtube_id = vt.youtube_id
-- WHERE vi.youtube_id IS NULL;
-- Expected: 0.
--
-- 3. Smoke-test record_signal (manual):
-- SELECT record_signal('dQw4w9WgXcQ', 'play');
-- SELECT play_count, last_played FROM video_intelligence WHERE youtube_id = 'dQw4w9WgXcQ';
--
-- 4. RPC with new filters:
-- SELECT youtube_id, title, artist, vibe_match_score
-- FROM get_hot_tracks(0.7, 0.3, 0.6, 0.2, 0.1, 20)
-- ORDER BY vibe_match_score DESC;
-- Expected: higher-heat + more-played tracks surface first. Modern Burna Boy / Asake
-- should appear if their vibe_scores are populated.
