-- ============================================
-- 012: Moments Video R2 Tracking
-- Adds r2_video_key column to voyo_moments
-- for tracking which moments have video in R2
-- ============================================

ALTER TABLE voyo_moments ADD COLUMN IF NOT EXISTS r2_video_key TEXT;

CREATE INDEX IF NOT EXISTS idx_moments_r2_video
  ON voyo_moments(r2_video_key)
  WHERE r2_video_key IS NOT NULL;

COMMENT ON COLUMN voyo_moments.r2_video_key IS 'R2 object key for video file, e.g. moments/tiktok/7224457422843251974.mp4';
