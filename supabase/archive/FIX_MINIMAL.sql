-- VOYO Minimal Fix
-- ONLY fixes what's broken, doesn't touch what works

-- ============================================
-- 1. RESTORE get_hot_tracks (was working!)
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
-- 2. FIX increment_video_play (404 error)
--    Change param from p_youtube_id to video_id
-- ============================================

DROP FUNCTION IF EXISTS increment_video_play(TEXT);

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

-- ============================================
-- 3. FIX get_discovery_tracks (500 timeout)
--    Remove ORDER BY RANDOM() on full table
--    Use TABLESAMPLE instead for speed
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
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) AS vibe_match_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url,
    CASE
      WHEN vi.artist_tier = 'A' THEN 'Top artist in your vibe'
      WHEN vi.artist_tier = 'B' THEN 'Rising artist match'
      WHEN vi.primary_genre IS NOT NULL THEN 'Genre: ' || vi.primary_genre
      ELSE 'Fresh discovery'
    END AS discovery_reason
  FROM video_intelligence vi TABLESAMPLE BERNOULLI(1)  -- Sample ~1% of rows (fast!)
  WHERE vi.vibe_scores IS NOT NULL
    AND NOT (vi.youtube_id = ANY(p_exclude_ids))
    AND NOT (vi.youtube_id = ANY(p_played_ids))
  LIMIT p_limit;
END;
$$;

-- ============================================
-- Done! Content filtering stays CLIENT-SIDE
-- ============================================
