-- ============================================
-- VOYO: VIBES FIRST DISCOVERY
-- ============================================
-- Queries 324K tracks by user's vibe essence
--
-- HOT = Trending NOW + matches your vibes
-- DISCOVERY = Expand horizons + unique flavors
--
-- VIBES FIRST. Not genre. Not popularity. VIBES.
-- ============================================

-- ============================================
-- HOT TRACKS RPC
-- ============================================
-- What's trending right now WITHIN the vibes you like

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
    -- Calculate vibe match score (weighted by user's essence)
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) / 100.0 AS vibe_match_score,
    -- Heat from YouTube metrics (likes, views)
    COALESCE(vi.like_count, 0) + (COALESCE(vi.view_count, 0) / 1000) AS heat_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url
  FROM video_intelligence vi
  WHERE
    -- Must have some vibe data
    vi.vibe_scores IS NOT NULL
    AND vi.vibe_scores != '{}'::jsonb
    -- Exclude already played (optional)
    AND (p_exclude_ids = '{}' OR vi.youtube_id != ALL(p_exclude_ids))
    -- Minimum vibe match threshold
    AND (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) > 20  -- At least 20% match
  ORDER BY
    -- HOT = Heat first, then vibe match
    (COALESCE(vi.like_count, 0) + (COALESCE(vi.view_count, 0) / 1000)) DESC,
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DISCOVERY TRACKS RPC
-- ============================================
-- Expand your horizons + unique flavors
-- You like afro, but you really like CHILL... try Congolese rumba?

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
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    -- Vibe match
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) / 100.0 AS vibe_match_score,
    -- Discovery score: vibe match + novelty bonus
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) / 100.0 +
    -- Novelty bonus (not in played list)
    CASE WHEN vi.youtube_id = ANY(p_played_ids) THEN -0.3 ELSE 0.2 END +
    -- Tier bonus (discover quality artists)
    CASE vi.artist_tier
      WHEN 'A' THEN 0.15
      WHEN 'B' THEN 0.10
      WHEN 'C' THEN 0.05
      ELSE 0
    END AS discovery_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url,
    -- Explain why this is a discovery
    CASE
      WHEN vi.youtube_id = ANY(p_played_ids) THEN 'Familiar favorite'
      WHEN vi.artist_tier = 'A' THEN 'Top artist you might love'
      WHEN COALESCE((vi.vibe_scores->>p_dominant_vibe)::REAL, 0) > 70 THEN 'Strong vibe match'
      WHEN array_length(vi.cultural_tags, 1) > 0 THEN 'Cultural discovery'
      ELSE 'Fresh find'
    END AS discovery_reason
  FROM video_intelligence vi
  WHERE
    vi.vibe_scores IS NOT NULL
    AND vi.vibe_scores != '{}'::jsonb
    -- Exclude specific IDs
    AND (p_exclude_ids = '{}' OR vi.youtube_id != ALL(p_exclude_ids))
    -- Minimum vibe match
    AND (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) > 15  -- Slightly lower threshold for discovery
  ORDER BY
    -- Discovery = Vibe match first, then novelty
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) DESC,
    -- Prefer not-played tracks
    CASE WHEN vi.youtube_id = ANY(p_played_ids) THEN 1 ELSE 0 END,
    -- Then by tier
    CASE vi.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
    -- Randomize within same score for variety
    RANDOM()
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIBE SEARCH RPC
-- ============================================
-- Search within 324K tracks (Supabase first, YouTube fallback)

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
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) / 100.0 AS vibe_match_score,
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
    -- Then vibe match
    (
      COALESCE((vi.vibe_scores->>'afro_heat')::REAL, 0) * p_afro_heat +
      COALESCE((vi.vibe_scores->>'chill')::REAL, 0) * p_chill +
      COALESCE((vi.vibe_scores->>'party')::REAL, 0) * p_party +
      COALESCE((vi.vibe_scores->>'workout')::REAL, 0) * p_workout +
      COALESCE((vi.vibe_scores->>'late_night')::REAL, 0) * p_late_night
    ) DESC,
    -- Tier as tiebreaker
    CASE vi.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FAMILIAR TRACKS RPC (For 70/30 ratio)
-- ============================================
-- Get tracks user has played before (the 30% familiar)

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
  ORDER BY RANDOM()  -- Shuffle familiar tracks
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_vi_fts ON video_intelligence
USING gin(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(artist, '')));

-- Heat score composite for HOT queries
CREATE INDEX IF NOT EXISTS idx_vi_heat ON video_intelligence(
  (COALESCE(like_count, 0) + (COALESCE(view_count, 0) / 1000)) DESC
) WHERE vibe_scores IS NOT NULL AND vibe_scores != '{}'::jsonb;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION get_hot_tracks IS 'HOT: Trending tracks that match user vibe essence. VIBES FIRST.';
COMMENT ON FUNCTION get_discovery_tracks IS 'DISCOVERY: Expand horizons within vibes + unique flavors. Not just more of same.';
COMMENT ON FUNCTION search_tracks_by_vibe IS 'Search 324K tracks with vibe-weighted ranking. Supabase first.';
COMMENT ON FUNCTION get_familiar_tracks IS 'Get previously played tracks for 70/30 fresh/familiar ratio.';
