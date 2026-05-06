-- ============================================
-- 031: Curated Pool Rotation
-- Implements the rotating-pool architecture documented in
-- voyo-music-server/catalogs/_strategy.md.
--
-- Two new boolean flags + archive metadata:
--   in_pool     — row currently active in the feed (default true)
--   is_core     — top-tier permanent rows that never rotate out
--   archived_at — when the row left the pool (null while in pool)
--   archive_reason — 'rotation' | 'low_engagement' | 'manual' | 'orphan_purge'
--   embed_url   — source-platform embed URL for creator-page render
--                 after R2 file is deleted
-- ============================================

ALTER TABLE voyo_moments
  ADD COLUMN IF NOT EXISTS in_pool         BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_core         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_reason  TEXT,
  ADD COLUMN IF NOT EXISTS embed_url       TEXT;

-- Feed reads this index thousands of times — partial keeps it slim.
CREATE INDEX IF NOT EXISTS idx_voyo_moments_in_pool
  ON voyo_moments (in_pool, virality_score DESC)
  WHERE in_pool = true AND is_active = true;

-- Cron eviction needs a fast scan over current in-pool to score them.
CREATE INDEX IF NOT EXISTS idx_voyo_moments_pool_score
  ON voyo_moments (in_pool, voyo_plays, voyo_skips, archived_at)
  WHERE in_pool = true;

-- Core rows are queried by creator pages and feed top-up; tiny set.
CREATE INDEX IF NOT EXISTS idx_voyo_moments_is_core
  ON voyo_moments (is_core)
  WHERE is_core = true;

-- Creator-page lookups by handle (for the archived-embed path).
CREATE INDEX IF NOT EXISTS idx_voyo_moments_creator_handle
  ON voyo_moments (creator_username, in_pool DESC, archived_at DESC)
  WHERE creator_username IS NOT NULL;

COMMENT ON COLUMN voyo_moments.in_pool        IS 'Currently active in the feed (rotates daily, target ~2,500 rows total).';
COMMENT ON COLUMN voyo_moments.is_core        IS 'Permanent core entry — never rotates out. ~50-200 hand-picked + top virality_score.';
COMMENT ON COLUMN voyo_moments.archived_at    IS 'When the row was removed from in_pool. NULL while in pool.';
COMMENT ON COLUMN voyo_moments.archive_reason IS 'rotation | low_engagement | manual | orphan_purge';
COMMENT ON COLUMN voyo_moments.embed_url      IS 'Source-platform embed URL for creator-page render after R2 file is deleted.';
