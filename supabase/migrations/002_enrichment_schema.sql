-- VOYO Enrichment Schema Migration
-- ===================================
-- Adds enrichment columns to video_intelligence table
-- Run in Supabase SQL Editor

-- ============================================
-- ADD ENRICHMENT COLUMNS
-- ============================================

-- Artist tier (A/B/C/D)
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

-- Aesthetic tags (array)
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS aesthetic_tags TEXT[] DEFAULT '{}';

-- Vibe scores (JSONB)
-- Structure: {"afro_heat": 0-100, "chill": 0-100, "party": 0-100, "workout": 0-100, "late_night": 0-100}
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS vibe_scores JSONB DEFAULT '{}';

-- Enrichment metadata
ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS enrichment_source TEXT;  -- 'artist_master', 'title_pattern', 'gemini', 'community'

ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS enrichment_confidence REAL DEFAULT 0;

ALTER TABLE video_intelligence
ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- ============================================
-- ADD CONSTRAINTS
-- ============================================

-- Valid tier values
ALTER TABLE video_intelligence
ADD CONSTRAINT check_artist_tier
CHECK (artist_tier IS NULL OR artist_tier IN ('A', 'B', 'C', 'D'));

-- Valid era values
ALTER TABLE video_intelligence
ADD CONSTRAINT check_era
CHECK (era IS NULL OR era IN ('pre-1990', '1990s', '2000s', '2010s', '2020s', 'unknown'));

-- Valid enrichment source
ALTER TABLE video_intelligence
ADD CONSTRAINT check_enrichment_source
CHECK (enrichment_source IS NULL OR enrichment_source IN ('artist_master', 'title_pattern', 'gemini', 'community', 'hybrid'));

-- ============================================
-- INDEXES FOR VIBE QUERIES
-- ============================================

-- Tier index for filtering
CREATE INDEX IF NOT EXISTS idx_vi_tier ON video_intelligence(artist_tier);

-- Era index for filtering
CREATE INDEX IF NOT EXISTS idx_vi_era ON video_intelligence(era);

-- Genre index for filtering
CREATE INDEX IF NOT EXISTS idx_vi_genre ON video_intelligence(primary_genre);

-- Vibe scores index for JSON queries
CREATE INDEX IF NOT EXISTS idx_vi_vibes ON video_intelligence USING gin(vibe_scores);

-- Cultural tags index for array queries
CREATE INDEX IF NOT EXISTS idx_vi_cultural ON video_intelligence USING gin(cultural_tags);

-- Aesthetic tags index for array queries
CREATE INDEX IF NOT EXISTS idx_vi_aesthetic ON video_intelligence USING gin(aesthetic_tags);

-- Enrichment status index (for finding unenriched tracks)
CREATE INDEX IF NOT EXISTS idx_vi_enriched ON video_intelligence(enriched_at) WHERE enriched_at IS NULL;

-- ============================================
-- VIBE QUERY FUNCTIONS
-- ============================================

-- Get tracks for a specific vibe mode
CREATE OR REPLACE FUNCTION get_vibe_tracks(
  vibe_name TEXT,
  min_score INTEGER DEFAULT 60,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE(
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  vibe_score INTEGER,
  artist_tier TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    COALESCE((vi.vibe_scores->>vibe_name)::INTEGER, 0) as vibe_score,
    vi.artist_tier
  FROM video_intelligence vi
  WHERE COALESCE((vi.vibe_scores->>vibe_name)::INTEGER, 0) >= min_score
    AND vi.artist_tier IS NOT NULL
  ORDER BY
    CASE vi.artist_tier
      WHEN 'A' THEN 1
      WHEN 'B' THEN 2
      WHEN 'C' THEN 3
      ELSE 4
    END,
    COALESCE((vi.vibe_scores->>vibe_name)::INTEGER, 0) DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Get enrichment statistics
CREATE OR REPLACE FUNCTION get_enrichment_stats()
RETURNS TABLE(
  total_tracks BIGINT,
  enriched_tracks BIGINT,
  enrichment_pct NUMERIC,
  tier_a_count BIGINT,
  tier_b_count BIGINT,
  tier_c_count BIGINT,
  tier_d_count BIGINT,
  unknown_tier_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) as total_tracks,
    COUNT(*) FILTER (WHERE enriched_at IS NOT NULL) as enriched_tracks,
    ROUND(COUNT(*) FILTER (WHERE enriched_at IS NOT NULL)::NUMERIC / COUNT(*)::NUMERIC * 100, 1) as enrichment_pct,
    COUNT(*) FILTER (WHERE artist_tier = 'A') as tier_a_count,
    COUNT(*) FILTER (WHERE artist_tier = 'B') as tier_b_count,
    COUNT(*) FILTER (WHERE artist_tier = 'C') as tier_c_count,
    COUNT(*) FILTER (WHERE artist_tier = 'D') as tier_d_count,
    COUNT(*) FILTER (WHERE artist_tier IS NULL) as unknown_tier_count
  FROM video_intelligence;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIBE FEEDBACK TABLE (Community Enrichment)
-- ============================================

CREATE TABLE IF NOT EXISTS vibe_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id TEXT NOT NULL REFERENCES video_intelligence(youtube_id) ON DELETE CASCADE,

  -- The vibe mode that was playing
  suggested_vibe TEXT NOT NULL CHECK (suggested_vibe IN (
    'afro_heat', 'chill', 'party', 'workout', 'late_night'
  )),

  -- User's response
  user_response BOOLEAN NOT NULL,  -- true = correct, false = incorrect
  alternative_vibe TEXT CHECK (alternative_vibe IN (
    'afro_heat', 'chill', 'party', 'workout', 'late_night'
  )),

  -- User info (optional)
  username TEXT,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for aggregation queries
CREATE INDEX IF NOT EXISTS idx_vibe_feedback_track ON vibe_feedback(track_id);
CREATE INDEX IF NOT EXISTS idx_vibe_feedback_vibe ON vibe_feedback(suggested_vibe);

-- RLS for vibe feedback
ALTER TABLE vibe_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read vibe feedback"
  ON vibe_feedback FOR SELECT USING (true);

CREATE POLICY "Anyone can submit vibe feedback"
  ON vibe_feedback FOR INSERT WITH CHECK (true);

-- ============================================
-- AUTO-CORRECT VIBE SCORES TRIGGER
-- ============================================

-- Function to auto-correct vibe scores based on community feedback
CREATE OR REPLACE FUNCTION auto_correct_vibe_scores()
RETURNS TRIGGER AS $$
DECLARE
  feedback_count INTEGER;
  negative_count INTEGER;
  most_suggested TEXT;
  suggested_count INTEGER;
BEGIN
  -- Get feedback stats for this track + vibe combination
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE NOT user_response)
  INTO feedback_count, negative_count
  FROM vibe_feedback
  WHERE track_id = NEW.track_id
    AND suggested_vibe = NEW.suggested_vibe;

  -- If 5+ users say it doesn't fit
  IF negative_count >= 5 THEN
    -- Find most suggested alternative
    SELECT
      alternative_vibe,
      COUNT(*)
    INTO most_suggested, suggested_count
    FROM vibe_feedback
    WHERE track_id = NEW.track_id
      AND suggested_vibe = NEW.suggested_vibe
      AND NOT user_response
      AND alternative_vibe IS NOT NULL
    GROUP BY alternative_vibe
    ORDER BY COUNT(*) DESC
    LIMIT 1;

    -- If 3+ agree on alternative, update vibe scores
    IF suggested_count >= 3 THEN
      UPDATE video_intelligence
      SET
        vibe_scores = jsonb_set(
          jsonb_set(
            vibe_scores,
            ARRAY[NEW.suggested_vibe],
            '30'::jsonb  -- Lower the incorrect vibe
          ),
          ARRAY[most_suggested],
          '80'::jsonb  -- Raise the correct vibe
        ),
        enrichment_source = 'community',
        enriched_at = NOW()
      WHERE youtube_id = NEW.track_id;

      RAISE NOTICE 'Auto-corrected % vibe for track %: % -> %',
        NEW.suggested_vibe, NEW.track_id, NEW.suggested_vibe, most_suggested;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on vibe feedback
CREATE TRIGGER vibe_feedback_auto_correct
  AFTER INSERT ON vibe_feedback
  FOR EACH ROW
  EXECUTE FUNCTION auto_correct_vibe_scores();

-- ============================================
-- REALTIME FOR FEEDBACK
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE vibe_feedback;

-- ============================================
-- SAMPLE QUERIES FOR TESTING
-- ============================================

-- Get enrichment stats
-- SELECT * FROM get_enrichment_stats();

-- Get party tracks
-- SELECT * FROM get_vibe_tracks('party', 70, 20);

-- Get tracks by tier
-- SELECT youtube_id, title, artist, artist_tier, era
-- FROM video_intelligence
-- WHERE artist_tier = 'A'
-- ORDER BY voyo_play_count DESC NULLS LAST
-- LIMIT 20;

-- Find unenriched tracks with high play count
-- SELECT youtube_id, title, artist, voyo_play_count
-- FROM video_intelligence
-- WHERE enriched_at IS NULL
--   AND voyo_play_count > 0
-- ORDER BY voyo_play_count DESC
-- LIMIT 50;
