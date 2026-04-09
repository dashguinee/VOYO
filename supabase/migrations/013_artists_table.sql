-- ============================================
-- 013: Artists Table
-- Creates voyo_artists for proper artist pages
-- Currently using artist_master.json locally
-- ============================================

CREATE TABLE IF NOT EXISTS voyo_artists (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,           -- URL-friendly: "burna-boy"
  name TEXT NOT NULL,                  -- Display: "Burna Boy"
  aliases TEXT[],                      -- Alt names for matching
  country TEXT,                        -- "Nigeria"
  region TEXT,                         -- "West Africa"
  genres TEXT[],                       -- ["afrobeats", "afro-fusion"]
  tier TEXT DEFAULT 'B',               -- A/B/C priority tier
  image_url TEXT,                      -- Profile image
  bio TEXT,                            -- Short biography
  youtube_channel_id TEXT,             -- For linking
  spotify_id TEXT,                     -- For cross-reference
  track_count INTEGER DEFAULT 0,      -- Cached count
  moment_count INTEGER DEFAULT 0,     -- Cached count
  total_plays BIGINT DEFAULT 0,       -- Aggregated
  heat_score REAL DEFAULT 0,          -- Popularity metric
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artists_slug ON voyo_artists(slug);
CREATE INDEX IF NOT EXISTS idx_artists_country ON voyo_artists(country);
CREATE INDEX IF NOT EXISTS idx_artists_tier ON voyo_artists(tier);
CREATE INDEX IF NOT EXISTS idx_artists_heat ON voyo_artists(heat_score DESC);

-- RLS: public read, service-role write
ALTER TABLE voyo_artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Artists are viewable by everyone"
  ON voyo_artists FOR SELECT USING (true);

COMMENT ON TABLE voyo_artists IS 'Artist catalog with metadata for artist pages and search';
