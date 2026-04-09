-- ============================================
-- R2 CACHE TRACKING - Zero Gap Architecture
-- ============================================
-- Supabase is the source of truth for what's cached in R2
-- Worker updates this atomically on every upload

-- Add R2 tracking columns
ALTER TABLE voyo_tracks
  ADD COLUMN IF NOT EXISTS r2_cached BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS r2_quality TEXT,           -- '128' (high) or '64' (low)
  ADD COLUMN IF NOT EXISTS r2_size INTEGER,           -- bytes
  ADD COLUMN IF NOT EXISTS r2_cached_at TIMESTAMPTZ;  -- when uploaded

-- Index for fast "what's cached" queries
CREATE INDEX IF NOT EXISTS idx_voyo_tracks_r2_cached
  ON voyo_tracks(r2_cached)
  WHERE r2_cached = true;

-- Index for cache stats by quality
CREATE INDEX IF NOT EXISTS idx_voyo_tracks_r2_quality
  ON voyo_tracks(r2_quality)
  WHERE r2_cached = true;

-- Comment for documentation
COMMENT ON COLUMN voyo_tracks.r2_cached IS 'Whether audio is cached in R2 bucket';
COMMENT ON COLUMN voyo_tracks.r2_quality IS 'Quality tier: 128 (high) or 64 (low)';
COMMENT ON COLUMN voyo_tracks.r2_size IS 'File size in bytes';
COMMENT ON COLUMN voyo_tracks.r2_cached_at IS 'When the audio was uploaded to R2';
