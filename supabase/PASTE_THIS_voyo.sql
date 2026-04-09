-- =============================================
-- PASTE THIS INTO: VOYO Music (anmgyxhnyhbyxzpjhxgx)
-- Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Combines: 013 + 014 + 015
-- =============================================

-- === 013: ARTISTS TABLE ===

CREATE TABLE IF NOT EXISTS voyo_artists (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT[],
  country TEXT,
  region TEXT,
  genres TEXT[],
  tier TEXT DEFAULT 'B',
  image_url TEXT,
  bio TEXT,
  youtube_channel_id TEXT,
  spotify_id TEXT,
  track_count INTEGER DEFAULT 0,
  moment_count INTEGER DEFAULT 0,
  total_plays BIGINT DEFAULT 0,
  heat_score REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artists_slug ON voyo_artists(slug);
CREATE INDEX IF NOT EXISTS idx_artists_country ON voyo_artists(country);
CREATE INDEX IF NOT EXISTS idx_artists_tier ON voyo_artists(tier);
CREATE INDEX IF NOT EXISTS idx_artists_heat ON voyo_artists(heat_score DESC);

ALTER TABLE voyo_artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Artists are viewable by everyone"
  ON voyo_artists FOR SELECT USING (true);

COMMENT ON TABLE voyo_artists IS 'Artist catalog with metadata for artist pages and search';

-- === 014: R2 TRACK CACHE COLUMNS ===

ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_cached BOOLEAN DEFAULT false;
ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_quality TEXT;
ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_size BIGINT;
ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_cached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tracks_r2_cached ON voyo_tracks(r2_cached) WHERE r2_cached = true;

COMMENT ON COLUMN voyo_tracks.r2_cached IS 'Whether audio file exists in R2 bucket';

-- === 015: BACKFILL VIDEO KEYS ===

UPDATE voyo_moments
SET r2_video_key = 'moments/' || source_platform || '/' || source_id || '.mp4'
WHERE r2_video_key IS NULL
  AND source_id IS NOT NULL
  AND source_platform IS NOT NULL;

-- DONE! All 3 migrations applied.
