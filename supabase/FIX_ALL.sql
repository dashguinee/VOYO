-- VOYO Complete Fix
-- Run in Supabase SQL Editor
-- Fixes: RPC 404s, Discovery 500, Signal 409s, Content filtering

-- ============================================
-- 1. FIX RPC PARAMETER NAMES (404 errors)
-- ============================================

-- DROP old functions first (they have wrong param names)
DROP FUNCTION IF EXISTS increment_video_play(TEXT);
DROP FUNCTION IF EXISTS increment_video_queue(TEXT);
DROP FUNCTION IF EXISTS get_hot_tracks(REAL, REAL, REAL, REAL, REAL, INTEGER, TEXT[]);
DROP FUNCTION IF EXISTS get_discovery_tracks(REAL, REAL, REAL, REAL, REAL, TEXT, INTEGER, TEXT[], TEXT[]);

-- increment_video_play - Code sends { video_id: ... }
CREATE OR REPLACE FUNCTION increment_video_play(video_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE video_intelligence
  SET
    play_count = COALESCE(play_count, 0) + 1,
    last_played = NOW()
  WHERE youtube_id = video_id;
END;
$$;

-- increment_video_queue - Code sends { video_id: ... }
CREATE OR REPLACE FUNCTION increment_video_queue(video_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE video_intelligence
  SET voyo_queue_count = COALESCE(voyo_queue_count, 0) + 1
  WHERE youtube_id = video_id;
END;
$$;

-- ============================================
-- 2. FIX get_hot_tracks (optimized + filtered)
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
    SELECT vi.youtube_id, vi.title, vi.artist, vi.artist_tier,
           vi.primary_genre, vi.cultural_tags, vi.thumbnail_url,
           vi.vibe_scores
    FROM video_intelligence vi
    WHERE vi.artist_tier IN ('A', 'B')
      AND vi.vibe_scores IS NOT NULL
      AND NOT (vi.youtube_id = ANY(p_exclude_ids))
      -- CONTENT FILTER: Exclude news/non-music
      AND vi.primary_genre IS NOT NULL
      AND vi.primary_genre NOT IN ('news', 'podcast', 'talk', 'speech', 'politics')
      AND vi.title NOT ILIKE '%news%'
      AND vi.title NOT ILIKE '%live:%'
      AND vi.title NOT ILIKE '%breaking%'
      AND vi.title NOT ILIKE '%update%'
      AND vi.title NOT ILIKE '%trump%'
      AND vi.title NOT ILIKE '%president%'
      AND vi.title NOT ILIKE '%election%'
    LIMIT 500
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
-- 3. FIX get_discovery_tracks (500 error)
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
    SELECT vi.youtube_id, vi.title, vi.artist, vi.artist_tier,
           vi.primary_genre, vi.cultural_tags, vi.thumbnail_url,
           vi.vibe_scores
    FROM video_intelligence vi
    WHERE vi.vibe_scores IS NOT NULL
      AND NOT (vi.youtube_id = ANY(p_exclude_ids))
      AND NOT (vi.youtube_id = ANY(p_played_ids))
      -- CONTENT FILTER: Exclude news/non-music
      AND (vi.primary_genre IS NULL OR vi.primary_genre NOT IN ('news', 'podcast', 'talk', 'speech', 'politics'))
      AND vi.title NOT ILIKE '%news%'
      AND vi.title NOT ILIKE '%live:%'
      AND vi.title NOT ILIKE '%breaking%'
      AND vi.title NOT ILIKE '%trump%'
      AND vi.title NOT ILIKE '%president%'
      AND vi.title NOT ILIKE '%election%'
      AND vi.title NOT ILIKE '%warning%'
      AND vi.title NOT ILIKE '%alert%'
    ORDER BY RANDOM()
    LIMIT 1000
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
-- 4. FIX voyo_signals CONFLICT (409 errors)
-- ============================================

-- Add unique constraint if not exists (for upsert)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voyo_signals_unique_recent'
  ) THEN
    -- Create a partial unique index instead of constraint
    -- This allows one signal per user per track per action per minute
    CREATE UNIQUE INDEX IF NOT EXISTS voyo_signals_unique_recent
    ON voyo_signals(user_hash, track_id, action, (date_trunc('minute', created_at)));
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Index might already exist or table structure different
  RAISE NOTICE 'Could not create unique index: %', SQLERRM;
END $$;

-- ============================================
-- 5. PERFORMANCE INDEXES
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
-- 6. CONTENT FILTER: Mark non-music in database
-- ============================================

-- Add content_type column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'video_intelligence' AND column_name = 'content_type'
  ) THEN
    ALTER TABLE video_intelligence ADD COLUMN content_type TEXT DEFAULT 'music';
  END IF;
END $$;

-- Mark known non-music content
UPDATE video_intelligence
SET content_type = 'non_music'
WHERE
  title ILIKE '%news%'
  OR title ILIKE '%live:%'
  OR title ILIKE '%breaking%'
  OR title ILIKE '%trump%'
  OR title ILIKE '%president%'
  OR title ILIKE '%election%'
  OR title ILIKE '%warning%'
  OR title ILIKE '%alert%'
  OR title ILIKE '%podcast%'
  OR title ILIKE '%interview%'
  OR title ILIKE '%speech%'
  OR title ILIKE '%conference%';

-- ============================================
-- 7. ANALYZE TABLES (update query planner stats)
-- ============================================

ANALYZE video_intelligence;
ANALYZE voyo_signals;

-- ============================================
-- DONE! Check results:
-- ============================================
-- SELECT content_type, COUNT(*) FROM video_intelligence GROUP BY content_type;
