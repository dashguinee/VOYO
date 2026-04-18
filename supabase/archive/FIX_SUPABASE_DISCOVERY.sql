-- ============================================
-- VOYO SUPABASE DISCOVERY FIX
-- ============================================
-- Run this in Supabase SQL Editor to fix:
-- 1. Missing enrichment columns
-- 2. Missing RPC functions (get_hot_tracks, get_discovery_tracks, search_tracks_by_vibe)
--
-- After running this, the app's search and discovery will work!
-- ============================================

-- ============================================
-- STEP 1: ADD MISSING COLUMNS
-- ============================================

-- Artist tier (A/B/C/D for quality classification)
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS artist_tier TEXT;

-- Era (time period)
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS era TEXT;

-- Primary genre
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS primary_genre TEXT;

-- Cultural tags (array)
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS cultural_tags TEXT[] DEFAULT '{}';

-- Vibe scores (JSONB with afro_heat, chill, party, workout, late_night)
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS vibe_scores JSONB DEFAULT '{}';

-- Matched artist (from enrichment)
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS matched_artist TEXT;

-- YouTube metrics (for heat scoring)
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS like_count BIGINT DEFAULT 0;

ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS view_count BIGINT DEFAULT 0;

-- Alias columns for compatibility (RPCs use play_count, base has voyo_play_count)
-- We'll reference the correct columns in RPCs

-- ============================================
-- STEP 2: CREATE INDEXES FOR PERFORMANCE
-- ============================================

-- Tier index
CREATE INDEX IF NOT EXISTS idx_vi_tier ON video_intelligence(artist_tier);

-- Genre index
CREATE INDEX IF NOT EXISTS idx_vi_genre ON video_intelligence(primary_genre);

-- Vibe scores GIN index for JSON queries
CREATE INDEX IF NOT EXISTS idx_vi_vibes ON video_intelligence USING gin(vibe_scores);

-- Cultural tags GIN index
CREATE INDEX IF NOT EXISTS idx_vi_cultural ON video_intelligence USING gin(cultural_tags);

-- Full-text search index (for search_tracks_by_vibe)
CREATE INDEX IF NOT EXISTS idx_vi_fts ON video_intelligence
USING gin(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(artist, '')));

-- ============================================
-- STEP 3: CREATE RPC FUNCTIONS
-- ============================================

-- ============================================
-- HOT TRACKS - Trending + Vibe Match
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
  heat_score BIGINT,
  artist_tier TEXT,
  primary_genre TEXT,
  cultural_tags TEXT[],
  thumbnail_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    -- Calculate vibe match score from cultural_tags OR vibe_scores
    CASE
      -- If vibe_scores exist, use them
      WHEN vi.vibe_scores IS NOT NULL AND vi.vibe_scores != '{}'::jsonb THEN
        (
          COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
          COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
          COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
          COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
          COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
        ) / 100.0
      -- Otherwise use cultural_tags
      WHEN vi.cultural_tags && ARRAY['Afrobeats', 'African', 'Naija'] THEN p_afro_heat * 0.8
      WHEN vi.cultural_tags && ARRAY['Soul', 'R&B', 'Smooth'] THEN p_chill * 0.8
      WHEN vi.cultural_tags && ARRAY['Caribbean', 'Soca', 'party'] THEN p_party * 0.8
      WHEN vi.cultural_tags && ARRAY['Reggae', 'Zouk', 'Kompa'] THEN p_late_night * 0.8
      WHEN vi.cultural_tags && ARRAY['Dancehall', 'uptempo'] THEN p_workout * 0.8
      ELSE 0.3
    END AS vibe_match_score,
    -- Heat score from play counts + YouTube metrics
    (
      COALESCE(vi.voyo_play_count, 0) * 10 +
      COALESCE(vi.voyo_queue_count, 0) * 5 +
      COALESCE(vi.like_count, 0) +
      (COALESCE(vi.view_count, 0) / 1000)
    )::BIGINT AS heat_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url
  FROM video_intelligence vi
  WHERE
    -- Must have some data (tags, tier, or vibe_scores)
    (
      (vi.cultural_tags IS NOT NULL AND array_length(vi.cultural_tags, 1) > 0)
      OR vi.artist_tier IN ('A', 'B')
      OR (vi.vibe_scores IS NOT NULL AND vi.vibe_scores != '{}'::jsonb)
    )
    -- Exclude specific IDs
    AND (p_exclude_ids = '{}' OR vi.youtube_id != ALL(p_exclude_ids))
  ORDER BY
    -- HOT = Heat first
    (
      COALESCE(vi.voyo_play_count, 0) * 10 +
      COALESCE(vi.voyo_queue_count, 0) * 5 +
      COALESCE(vi.like_count, 0) +
      (COALESCE(vi.view_count, 0) / 1000)
    ) DESC,
    -- Then tier
    CASE vi.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DISCOVERY TRACKS - Expand Horizons
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
  discovery_score REAL,
  artist_tier TEXT,
  primary_genre TEXT,
  cultural_tags TEXT[],
  thumbnail_url TEXT,
  discovery_reason TEXT
) AS $$
DECLARE
  v_dominant_tags TEXT[];
BEGIN
  -- Map dominant vibe to cultural tags
  v_dominant_tags := CASE p_dominant_vibe
    WHEN 'afro_heat' THEN ARRAY['Afrobeats', 'African', 'Naija', 'Dancehall']
    WHEN 'chill' THEN ARRAY['Soul', 'R&B', 'Smooth', 'Jazz']
    WHEN 'party' THEN ARRAY['Caribbean', 'Soca', 'Afrobeats', 'party']
    WHEN 'workout' THEN ARRAY['Dancehall', 'Soca', 'uptempo', 'Afrobeats']
    WHEN 'late_night' THEN ARRAY['Zouk', 'Kompa', 'R&B', 'Reggae']
    ELSE ARRAY['Afrobeats', 'African']
  END;

  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    -- Vibe match score
    CASE
      WHEN vi.vibe_scores IS NOT NULL AND vi.vibe_scores != '{}'::jsonb THEN
        (
          COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
          COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
          COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
          COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
          COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
        ) / 100.0
      WHEN vi.cultural_tags && v_dominant_tags THEN 0.8
      WHEN vi.cultural_tags && ARRAY['world_music', 'African'] THEN 0.5
      ELSE 0.3
    END AS vibe_match_score,
    -- Discovery score: novelty + tier + vibe match
    (
      CASE WHEN vi.youtube_id = ANY(p_played_ids) THEN -0.3 ELSE 0.2 END +
      CASE vi.artist_tier
        WHEN 'A' THEN 0.15
        WHEN 'B' THEN 0.10
        WHEN 'C' THEN 0.05
        ELSE 0
      END +
      CASE
        WHEN vi.cultural_tags && v_dominant_tags THEN 0.5
        ELSE 0.2
      END
    ) AS discovery_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url,
    -- Discovery reason
    CASE
      WHEN vi.youtube_id = ANY(p_played_ids) THEN 'Familiar favorite'
      WHEN vi.artist_tier = 'A' THEN 'Top artist you might love'
      WHEN vi.cultural_tags && v_dominant_tags THEN 'Strong vibe match'
      WHEN array_length(vi.cultural_tags, 1) > 2 THEN 'Cultural discovery'
      ELSE 'Fresh find'
    END AS discovery_reason
  FROM video_intelligence vi
  WHERE
    -- Must have some data
    (
      (vi.cultural_tags IS NOT NULL AND array_length(vi.cultural_tags, 1) > 0)
      OR vi.artist_tier IN ('A', 'B', 'C')
      OR (vi.vibe_scores IS NOT NULL AND vi.vibe_scores != '{}'::jsonb)
    )
    -- Exclude specific IDs
    AND (p_exclude_ids = '{}' OR vi.youtube_id != ALL(p_exclude_ids))
  ORDER BY
    -- Discovery = Vibe match first
    CASE WHEN vi.cultural_tags && v_dominant_tags THEN 0 ELSE 1 END,
    -- Prefer not-played
    CASE WHEN vi.youtube_id = ANY(p_played_ids) THEN 1 ELSE 0 END,
    -- Then tier
    CASE vi.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
    -- Randomize for variety
    RANDOM()
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEARCH TRACKS BY VIBE - Full Text + Vibe Weighted
-- ============================================
CREATE OR REPLACE FUNCTION search_tracks_by_vibe(
  p_query TEXT,
  p_afro_heat REAL DEFAULT 0.2,
  p_chill REAL DEFAULT 0.2,
  p_party REAL DEFAULT 0.2,
  p_workout REAL DEFAULT 0.2,
  p_late_night REAL DEFAULT 0.2,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  vibe_match_score REAL,
  search_rank REAL,
  artist_tier TEXT,
  thumbnail_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    -- Vibe match
    CASE
      WHEN vi.vibe_scores IS NOT NULL AND vi.vibe_scores != '{}'::jsonb THEN
        (
          COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
          COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
          COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
          COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
          COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
        ) / 100.0
      WHEN vi.cultural_tags && ARRAY['Afrobeats', 'African'] THEN p_afro_heat
      WHEN vi.cultural_tags && ARRAY['Soul', 'R&B'] THEN p_chill
      WHEN vi.cultural_tags && ARRAY['Caribbean', 'Soca'] THEN p_party
      WHEN vi.cultural_tags && ARRAY['Reggae', 'Zouk'] THEN p_late_night
      ELSE 0.2
    END AS vibe_match_score,
    -- Text search rank
    ts_rank(
      to_tsvector('english', COALESCE(vi.title, '') || ' ' || COALESCE(vi.artist, '')),
      plainto_tsquery('english', p_query)
    ) AS search_rank,
    vi.artist_tier,
    vi.thumbnail_url
  FROM video_intelligence vi
  WHERE
    -- Text search on title and artist
    to_tsvector('english', COALESCE(vi.title, '') || ' ' || COALESCE(vi.artist, ''))
    @@ plainto_tsquery('english', p_query)
  ORDER BY
    -- Search relevance first
    ts_rank(
      to_tsvector('english', COALESCE(vi.title, '') || ' ' || COALESCE(vi.artist, '')),
      plainto_tsquery('english', p_query)
    ) DESC,
    -- Tier tiebreaker
    CASE vi.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FAMILIAR TRACKS (For 70/30 ratio)
-- ============================================
CREATE OR REPLACE FUNCTION get_familiar_tracks(
  p_played_ids TEXT[],
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  artist_tier TEXT,
  thumbnail_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    vi.artist_tier,
    vi.thumbnail_url
  FROM video_intelligence vi
  WHERE vi.youtube_id = ANY(p_played_ids)
  ORDER BY RANDOM()
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 4: POPULATE VIBE SCORES (Optional but recommended)
-- ============================================
-- If you have cultural_tags but no vibe_scores, this fills them in

-- Create genre-to-vibe mapping table
CREATE TABLE IF NOT EXISTS genre_vibe_map (
  genre TEXT PRIMARY KEY,
  afro_heat INTEGER,
  chill INTEGER,
  party INTEGER,
  workout INTEGER,
  late_night INTEGER
);

-- Populate genre mappings
INSERT INTO genre_vibe_map (genre, afro_heat, chill, party, workout, late_night) VALUES
  ('afrobeats', 85, 35, 75, 70, 45),
  ('afropop', 80, 45, 70, 60, 50),
  ('amapiano', 70, 50, 90, 60, 80),
  ('reggae', 40, 85, 50, 30, 70),
  ('dancehall', 75, 25, 90, 70, 65),
  ('hip-hop', 70, 40, 65, 80, 55),
  ('rnb', 35, 80, 40, 25, 85),
  ('zouk', 55, 65, 70, 35, 80),
  ('kompa', 50, 70, 65, 30, 75),
  ('soca', 80, 20, 95, 75, 50),
  ('soukous', 75, 35, 85, 60, 55),
  ('highlife', 60, 70, 65, 40, 55)
ON CONFLICT (genre) DO UPDATE SET
  afro_heat = EXCLUDED.afro_heat,
  chill = EXCLUDED.chill,
  party = EXCLUDED.party,
  workout = EXCLUDED.workout,
  late_night = EXCLUDED.late_night;

-- Update tracks with primary_genre
UPDATE video_intelligence vi
SET vibe_scores = jsonb_build_object(
  'afro_heat', gvm.afro_heat,
  'chill', gvm.chill,
  'party', gvm.party,
  'workout', gvm.workout,
  'late_night', gvm.late_night
)
FROM genre_vibe_map gvm
WHERE LOWER(vi.primary_genre) = gvm.genre
  AND (vi.vibe_scores IS NULL OR vi.vibe_scores = '{}'::jsonb);

-- Fill from cultural_tags where vibe_scores still empty
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 80, "chill": 40, "party": 70, "workout": 60, "late_night": 50}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['African', 'Afrobeats', 'Naija'];

UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 40, "chill": 85, "party": 50, "workout": 30, "late_night": 70}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Reggae'];

UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 35, "chill": 80, "party": 40, "workout": 25, "late_night": 85}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['R&B', 'Soul'];

UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 50, "chill": 70, "party": 65, "workout": 30, "late_night": 80}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Zouk', 'Kompa'];

UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 75, "chill": 25, "party": 90, "workout": 70, "late_night": 65}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Dancehall'];

-- Default for A/B tier artists
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 75, "chill": 45, "party": 70, "workout": 60, "late_night": 50}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND artist_tier IN ('A', 'B');

-- ============================================
-- STEP 5: VERIFY
-- ============================================
-- Run this to check everything worked:
-- SELECT
--   COUNT(*) as total,
--   COUNT(*) FILTER (WHERE vibe_scores IS NOT NULL AND vibe_scores != '{}'::jsonb) as has_vibes,
--   COUNT(*) FILTER (WHERE cultural_tags IS NOT NULL AND array_length(cultural_tags, 1) > 0) as has_tags,
--   COUNT(*) FILTER (WHERE artist_tier IS NOT NULL) as has_tier
-- FROM video_intelligence;

-- Test the RPCs:
-- SELECT * FROM get_hot_tracks(0.3, 0.2, 0.2, 0.2, 0.1, 10, '{}');
-- SELECT * FROM search_tracks_by_vibe('burna boy', 0.3, 0.2, 0.2, 0.2, 0.1, 10);

-- ============================================
-- DONE!
-- ============================================
-- The discovery system should now work:
-- - get_hot_tracks: Returns trending tracks matching user vibes
-- - get_discovery_tracks: Returns new tracks for horizon expansion
-- - search_tracks_by_vibe: Full-text search with vibe weighting
-- - get_familiar_tracks: Returns previously played tracks
