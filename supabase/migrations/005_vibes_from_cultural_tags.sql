-- ============================================
-- VOYO: VIBES FROM CULTURAL TAGS
-- ============================================
-- Instead of empty vibe_scores, we use:
-- - cultural_tags (70K+ tracks have these)
-- - artist_tier, era (enriched data)
-- - play_count/queue_count (engagement)
--
-- Maps MixBoard modes to cultural_tags:
-- afro-heat → African, Afrobeats, Dancehall
-- chill → Soul, R&B, Reggae, Zouk
-- party → Caribbean, Soca, Afrobeats
-- workout → uptempo genres
-- late-night → Zouk, Kompa, R&B
-- ============================================

-- ============================================
-- HOT TRACKS v2 - Uses cultural_tags
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
    -- Calculate vibe match score from cultural_tags
    CASE
      -- Match score based on what tags are present
      WHEN vi.cultural_tags && ARRAY['Afrobeats', 'African', 'Naija'] THEN p_afro_heat * 0.8
      WHEN vi.cultural_tags && ARRAY['Soul', 'R&B', 'Smooth'] THEN p_chill * 0.8
      WHEN vi.cultural_tags && ARRAY['Caribbean', 'Soca', 'party'] THEN p_party * 0.8
      WHEN vi.cultural_tags && ARRAY['Reggae', 'Zouk', 'Kompa'] THEN p_late_night * 0.8
      WHEN vi.cultural_tags && ARRAY['Dancehall', 'uptempo'] THEN p_workout * 0.8
      ELSE 0.3  -- Base score for others
    END AS vibe_match_score,
    -- Heat score from engagement
    (COALESCE(vi.play_count, 0) * 2 + COALESCE(vi.queue_count, 0))::BIGINT AS heat_score,
    vi.artist_tier,
    vi.primary_genre,
    vi.cultural_tags,
    vi.thumbnail_url
  FROM video_intelligence vi
  WHERE
    -- Must have some tags or be tier A/B
    (vi.cultural_tags IS NOT NULL AND array_length(vi.cultural_tags, 1) > 0)
    OR vi.artist_tier IN ('A', 'B')
    -- Exclude played
    AND (p_exclude_ids = '{}' OR vi.youtube_id != ALL(p_exclude_ids))
  ORDER BY
    -- HOT = Heat first (play_count + queue)
    (COALESCE(vi.play_count, 0) * 2 + COALESCE(vi.queue_count, 0)) DESC,
    -- Then tier
    CASE vi.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- DISCOVERY TRACKS v2 - Uses cultural_tags
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
  -- Map dominant vibe to cultural tags to search for
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
    -- Vibe match from cultural_tags overlap
    CASE
      WHEN vi.cultural_tags && v_dominant_tags THEN 0.8
      WHEN vi.cultural_tags && ARRAY['world_music', 'African'] THEN 0.5
      ELSE 0.3
    END AS vibe_match_score,
    -- Discovery score: novelty + tier bonus
    CASE
      WHEN vi.youtube_id = ANY(p_played_ids) THEN -0.3
      ELSE 0.2
    END +
    CASE vi.artist_tier
      WHEN 'A' THEN 0.15
      WHEN 'B' THEN 0.10
      WHEN 'C' THEN 0.05
      ELSE 0
    END +
    CASE
      WHEN vi.cultural_tags && v_dominant_tags THEN 0.5
      ELSE 0.2
    END AS discovery_score,
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
    -- Must have tags or be quality tier
    (
      (vi.cultural_tags IS NOT NULL AND array_length(vi.cultural_tags, 1) > 0)
      OR vi.artist_tier IN ('A', 'B', 'C')
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
-- SEARCH BY VIBE v2 - Text + cultural_tags
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
    -- Vibe match from tags
    CASE
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
    -- Text search
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
-- VIBE-BASED QUERY (for vibeEngine)
-- ============================================
-- This RPC supports the vibeEngine.ts query_rules

CREATE OR REPLACE FUNCTION get_tracks_by_vibe_rules(
  p_cultural_tags TEXT[] DEFAULT '{}',
  p_prefer_tiers TEXT[] DEFAULT '{}',
  p_eras TEXT[] DEFAULT '{}',
  p_countries TEXT[] DEFAULT '{}',
  p_title_patterns TEXT[] DEFAULT '{}',
  p_artist_patterns TEXT[] DEFAULT '{}',
  p_sort_by TEXT DEFAULT 'random',
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  thumbnail_url TEXT,
  artist_tier TEXT,
  matched_artist TEXT,
  era TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    vi.thumbnail_url,
    vi.artist_tier,
    vi.matched_artist,
    vi.era
  FROM video_intelligence vi
  WHERE
    -- Cultural tags filter (if provided)
    (p_cultural_tags = '{}' OR vi.cultural_tags && p_cultural_tags)
    -- Tier filter (if provided)
    AND (p_prefer_tiers = '{}' OR vi.artist_tier = ANY(p_prefer_tiers))
    -- Era filter (if provided)
    AND (p_eras = '{}' OR vi.era = ANY(p_eras))
  ORDER BY
    CASE p_sort_by
      WHEN 'play_count' THEN -COALESCE(vi.play_count, 0)
      WHEN 'canon_level' THEN
        CASE vi.artist_tier WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END
      ELSE RANDOM()
    END
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

