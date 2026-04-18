-- VOYO Performance Fix
-- Run in Supabase SQL Editor
-- Fixes: RPC timeouts, missing increment_video_play

-- ============================================
-- 1. PERFORMANCE INDEXES (prevent timeouts)
-- ============================================

-- Index for hot tracks (artist_tier for A/B filtering)
CREATE INDEX IF NOT EXISTS idx_vi_artist_tier
ON video_intelligence(artist_tier)
WHERE artist_tier IN ('A', 'B');

-- Index for discovery queries (vibe_scores not null)
CREATE INDEX IF NOT EXISTS idx_vi_has_vibes
ON video_intelligence(youtube_id)
WHERE vibe_scores IS NOT NULL;

-- Enable trigram extension for ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index for search (title/artist) - trigram for fast ILIKE
CREATE INDEX IF NOT EXISTS idx_vi_title_trgm
ON video_intelligence USING gin(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vi_artist_trgm
ON video_intelligence USING gin(artist gin_trgm_ops);

-- ============================================
-- 2. MISSING RPC: increment_video_play
-- ============================================

CREATE OR REPLACE FUNCTION increment_video_play(p_youtube_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE video_intelligence
  SET
    play_count = COALESCE(play_count, 0) + 1,
    last_played = NOW()
  WHERE youtube_id = p_youtube_id;
END;
$$;

-- ============================================
-- 3. OPTIMIZE get_hot_tracks (add LIMIT early)
-- ============================================

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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH top_tier AS (
    -- Get A/B tier tracks first (much smaller set)
    SELECT vi.youtube_id, vi.title, vi.artist, vi.artist_tier,
           vi.primary_genre, vi.cultural_tags, vi.thumbnail_url,
           vi.vibe_scores
    FROM video_intelligence vi
    WHERE vi.artist_tier IN ('A', 'B')
      AND vi.vibe_scores IS NOT NULL
      AND NOT (vi.youtube_id = ANY(p_exclude_ids))
    LIMIT 500  -- Pre-filter to 500 candidates
  )
  SELECT
    tt.youtube_id,
    tt.title,
    tt.artist,
    (
      COALESCE((tt.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((tt.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((tt.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((tt.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((tt.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) AS vibe_match_score,
    tt.artist_tier,
    tt.primary_genre,
    tt.cultural_tags,
    tt.thumbnail_url
  FROM top_tier tt
  ORDER BY
    CASE tt.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
    (
      COALESCE((tt.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((tt.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((tt.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((tt.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((tt.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) DESC
  LIMIT p_limit;
END;
$$;

-- ============================================
-- 4. OPTIMIZE get_discovery_tracks
-- ============================================

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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    -- Pre-filter to reasonable candidate set
    SELECT vi.youtube_id, vi.title, vi.artist, vi.artist_tier,
           vi.primary_genre, vi.cultural_tags, vi.thumbnail_url,
           vi.vibe_scores
    FROM video_intelligence vi
    WHERE vi.vibe_scores IS NOT NULL
      AND NOT (vi.youtube_id = ANY(p_exclude_ids))
      AND NOT (vi.youtube_id = ANY(p_played_ids))
    ORDER BY RANDOM()
    LIMIT 1000  -- Sample 1000 random candidates
  )
  SELECT
    c.youtube_id,
    c.title,
    c.artist,
    (
      COALESCE((c.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((c.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((c.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((c.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((c.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) AS vibe_match_score,
    c.artist_tier,
    c.primary_genre,
    c.cultural_tags,
    c.thumbnail_url,
    CASE
      WHEN c.artist_tier = 'A' THEN 'Top artist in your vibe'
      WHEN c.artist_tier = 'B' THEN 'Rising artist match'
      WHEN c.primary_genre IS NOT NULL THEN 'Genre: ' || c.primary_genre
      ELSE 'Fresh discovery'
    END AS discovery_reason
  FROM candidates c
  ORDER BY
    (
      COALESCE((c.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((c.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((c.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((c.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((c.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) DESC,
    RANDOM()
  LIMIT p_limit;
END;
$$;

-- ============================================
-- 5. ANALYZE TABLES (update query planner stats)
-- ============================================

ANALYZE video_intelligence;
