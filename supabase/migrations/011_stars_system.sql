-- ============================================
-- VOYO Stars System
-- 1 star = follow. Stars are the currency of attention.
-- ============================================

CREATE TABLE IF NOT EXISTS voyo_stars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid REFERENCES voyo_moments(id) ON DELETE SET NULL,
  creator_username text NOT NULL,
  stars int NOT NULL DEFAULT 1 CHECK (stars >= 1 AND stars <= 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookups by creator (who do I follow?)
CREATE INDEX idx_voyo_stars_creator ON voyo_stars(creator_username);
-- Fast lookups by moment (star count per moment)
CREATE INDEX idx_voyo_stars_moment ON voyo_stars(moment_id);

-- View: followers (anyone who gave at least 1 star)
CREATE OR REPLACE VIEW voyo_follows AS
  SELECT
    creator_username,
    COUNT(*) as star_count,
    SUM(stars) as total_stars,
    MIN(created_at) as followed_at,
    MAX(created_at) as last_star_at
  FROM voyo_stars
  GROUP BY creator_username;

-- RLS: allow anonymous inserts (no auth yet)
ALTER TABLE voyo_stars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous star inserts" ON voyo_stars;
CREATE POLICY "Allow anonymous star inserts" ON voyo_stars
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anonymous star reads" ON voyo_stars;
CREATE POLICY "Allow anonymous star reads" ON voyo_stars
  FOR SELECT USING (true);
