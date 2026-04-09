-- VOYO Simplified Fix
-- The previous queries were too complex/slow
-- This version is simpler and faster

-- ============================================
-- 1. CHECK WHAT DATA EXISTS
-- ============================================
-- Run this first to see what we have:
-- SELECT
--   COUNT(*) as total,
--   COUNT(artist_tier) as has_tier,
--   COUNT(vibe_scores) as has_vibes,
--   COUNT(primary_genre) as has_genre
-- FROM video_intelligence;

-- ============================================
-- 2. SIMPLE get_hot_tracks (no tier filter)
-- ============================================

DROP FUNCTION IF EXISTS get_hot_tracks(REAL, REAL, REAL, REAL, REAL, INTEGER, TEXT[]);

CREATE OR REPLACE FUNCTION get_hot_tracks(
  p_afro_heat REAL DEFAULT 0.2,
  p_chill REAL DEFAULT 0.2,
  p_party REAL DEFAULT 0.2,
  p_workout REAL DEFAULT 0.2,
  p_late_night REAL DEFAULT 0.2,
  p_limit INTEGER DEFAULT 30,
  p_exclude_ids TEXT[] DEFAULT '{}'
)
RETURNS TABLE(
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  vibe_match_score REAL,
  artist_tier TEXT,
  primary_genre TEXT,
  cultural_tags TEXT[],
  thumbnail_url TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    COALESCE(vi.play_count, 0)::REAL / 100.0 AS vibe_match_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url
  FROM video_intelligence vi
  WHERE
    vi.title IS NOT NULL
    AND vi.artist IS NOT NULL
    AND NOT (vi.youtube_id = ANY(p_exclude_ids))
    -- Simple content filter
    AND vi.title NOT ILIKE '%news%'
    AND vi.title NOT ILIKE '%trump%'
    AND vi.title NOT ILIKE '%election%'
    AND vi.title NOT ILIKE '%president%'
  ORDER BY COALESCE(vi.play_count, 0) DESC, RANDOM()
  LIMIT p_limit;
$$;

-- ============================================
-- 3. SIMPLE get_discovery_tracks (fast random)
-- ============================================

DROP FUNCTION IF EXISTS get_discovery_tracks(REAL, REAL, REAL, REAL, REAL, TEXT, INTEGER, TEXT[], TEXT[]);

CREATE OR REPLACE FUNCTION get_discovery_tracks(
  p_afro_heat REAL DEFAULT 0.2,
  p_chill REAL DEFAULT 0.2,
  p_party REAL DEFAULT 0.2,
  p_workout REAL DEFAULT 0.2,
  p_late_night REAL DEFAULT 0.2,
  p_dominant_vibe TEXT DEFAULT 'afro_heat',
  p_limit INTEGER DEFAULT 30,
  p_exclude_ids TEXT[] DEFAULT '{}',
  p_played_ids TEXT[] DEFAULT '{}'
)
RETURNS TABLE(
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  vibe_match_score REAL,
  artist_tier TEXT,
  primary_genre TEXT,
  cultural_tags TEXT[],
  thumbnail_url TEXT,
  discovery_reason TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    RANDOM()::REAL AS vibe_match_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url,
    'Fresh discovery'::TEXT AS discovery_reason
  FROM video_intelligence vi
  WHERE
    vi.title IS NOT NULL
    AND vi.artist IS NOT NULL
    AND NOT (vi.youtube_id = ANY(p_exclude_ids))
    AND NOT (vi.youtube_id = ANY(p_played_ids))
    -- Simple content filter
    AND vi.title NOT ILIKE '%news%'
    AND vi.title NOT ILIKE '%trump%'
    AND vi.title NOT ILIKE '%election%'
    AND vi.title NOT ILIKE '%president%'
    AND vi.title NOT ILIKE '%podcast%'
  ORDER BY RANDOM()
  LIMIT p_limit;
$$;

-- ============================================
-- 4. FIX increment functions (simple)
-- ============================================

DROP FUNCTION IF EXISTS increment_video_play(TEXT);

CREATE OR REPLACE FUNCTION increment_video_play(video_id TEXT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE video_intelligence
  SET play_count = COALESCE(play_count, 0) + 1
  WHERE youtube_id = video_id;
$$;

DROP FUNCTION IF EXISTS increment_video_queue(TEXT);

CREATE OR REPLACE FUNCTION increment_video_queue(video_id TEXT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE video_intelligence
  SET voyo_queue_count = COALESCE(voyo_queue_count, 0) + 1
  WHERE youtube_id = video_id;
$$;

-- ============================================
-- 5. INDEX for faster random queries
-- ============================================

CREATE INDEX IF NOT EXISTS idx_vi_random
ON video_intelligence(youtube_id)
WHERE title IS NOT NULL AND artist IS NOT NULL;

-- ============================================
-- 6. Verify it works
-- ============================================
-- Test: SELECT * FROM get_hot_tracks() LIMIT 5;
-- Test: SELECT * FROM get_discovery_tracks() LIMIT 5;
