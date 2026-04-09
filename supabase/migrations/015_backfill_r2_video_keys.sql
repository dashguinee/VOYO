-- ============================================
-- 015: Backfill r2_video_key for ALL moments
-- Sets the expected R2 key for every moment that doesn't have one yet
-- This way the upload script knows exactly what to upload
-- ============================================

UPDATE voyo_moments
SET r2_video_key = 'moments/' || source_platform || '/' || source_id || '.mp4'
WHERE r2_video_key IS NULL
  AND source_id IS NOT NULL
  AND source_platform IS NOT NULL;
