-- ============================================
-- 014: Reconcile R2 Track Cache Status
-- Problem: R2 has ~342K files but voyo_tracks only shows 14 as r2_cached
-- This sets r2_cached = true for all tracks that have R2 audio
-- Run AFTER the reconcile-r2-to-supabase script
-- ============================================

-- First, add missing columns if not present
ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_cached BOOLEAN DEFAULT false;
ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_quality TEXT;
ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_size BIGINT;
ALTER TABLE voyo_tracks ADD COLUMN IF NOT EXISTS r2_cached_at TIMESTAMPTZ;

-- Index for fast R2 cache queries
CREATE INDEX IF NOT EXISTS idx_tracks_r2_cached ON voyo_tracks(r2_cached) WHERE r2_cached = true;

COMMENT ON COLUMN voyo_tracks.r2_cached IS 'Whether audio file exists in R2 bucket';
