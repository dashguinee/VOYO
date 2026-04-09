-- ============================================
-- VOYO: POPULATE VIBE_SCORES FROM PRIMARY_GENRE
-- ============================================
-- Uses genre_vibe_defaults.json mapping to fill vibe_scores
-- This makes the HOT/DISCOVERY RPCs work with actual data
-- ============================================

-- Step 1: Create genre-to-vibe mapping table
CREATE TABLE IF NOT EXISTS genre_vibe_map (
  genre TEXT PRIMARY KEY,
  afro_heat INTEGER,
  chill INTEGER,
  party INTEGER,
  workout INTEGER,
  late_night INTEGER
);

-- Step 2: Populate genre mappings (from genre_vibe_defaults.json)
INSERT INTO genre_vibe_map (genre, afro_heat, chill, party, workout, late_night) VALUES
  ('afrobeats', 85, 35, 75, 70, 45),
  ('afropop', 80, 45, 70, 60, 50),
  ('afro-fusion', 70, 55, 60, 50, 65),
  ('alte', 50, 80, 40, 30, 85),
  ('fuji', 70, 40, 80, 50, 45),
  ('juju', 60, 55, 70, 40, 50),
  ('amapiano', 70, 50, 90, 60, 80),
  ('gqom', 90, 10, 95, 85, 70),
  ('kwaito', 65, 55, 75, 50, 65),
  ('maskandi', 50, 60, 55, 40, 45),
  ('sa-house', 75, 40, 85, 70, 75),
  ('bongo-flava', 75, 45, 70, 55, 50),
  ('gengetone', 80, 20, 85, 70, 60),
  ('benga', 60, 50, 65, 45, 40),
  ('taarab', 30, 75, 40, 20, 70),
  ('ndombolo', 80, 20, 90, 70, 60),
  ('soukous', 75, 35, 85, 60, 55),
  ('rumba', 50, 75, 60, 30, 80),
  ('makossa', 70, 40, 80, 55, 50),
  ('highlife', 60, 70, 65, 40, 55),
  ('hiplife', 70, 45, 75, 55, 50),
  ('azonto', 85, 20, 90, 75, 55),
  ('mbalax', 75, 30, 80, 65, 40),
  ('coupe-decale', 85, 15, 95, 70, 60),
  ('afro-house', 65, 40, 85, 75, 70),
  ('afro-soul', 40, 85, 30, 20, 75),
  ('afro-rnb', 45, 80, 35, 25, 80),
  ('african-gospel', 30, 70, 40, 35, 25),
  ('reggae', 40, 85, 50, 30, 70),
  ('dancehall', 75, 25, 90, 70, 65),
  ('hip-hop', 70, 40, 65, 80, 55),
  ('rnb', 35, 80, 40, 25, 85),
  ('neo-soul', 30, 90, 25, 20, 80),
  ('gospel', 35, 65, 45, 40, 30),
  ('zouk', 55, 65, 70, 35, 80),
  ('kompa', 50, 70, 65, 30, 75),
  ('soca', 80, 20, 95, 75, 50),
  ('calypso', 65, 45, 75, 50, 40),
  ('afro-jazz', 40, 75, 35, 25, 70),
  ('african-pop', 75, 45, 70, 55, 50),
  ('world-music', 50, 60, 50, 40, 55)
ON CONFLICT (genre) DO UPDATE SET
  afro_heat = EXCLUDED.afro_heat,
  chill = EXCLUDED.chill,
  party = EXCLUDED.party,
  workout = EXCLUDED.workout,
  late_night = EXCLUDED.late_night;

-- Step 3: Update vibe_scores from primary_genre
UPDATE video_intelligence vi
SET vibe_scores = jsonb_build_object(
  'afro_heat', gvm.afro_heat,
  'chill', gvm.chill,
  'party', gvm.party,
  'workout', gvm.workout,
  'late_night', gvm.late_night
)
FROM genre_vibe_map gvm
WHERE LOWER(vi.primary_genre) = gvm.genre
  AND (vi.vibe_scores IS NULL OR vi.vibe_scores = '{}'::jsonb);

-- Step 4: For tracks without primary_genre, use cultural_tags to infer
-- Caribbean = party + late_night heavy
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 55, "chill": 50, "party": 80, "workout": 50, "late_night": 70}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Caribbean', 'Soca', 'Calypso'];

-- Reggae = chill + late_night heavy
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 40, "chill": 85, "party": 50, "workout": 30, "late_night": 70}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Reggae'];

-- R&B/Soul = chill + late_night heavy
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 35, "chill": 80, "party": 40, "workout": 25, "late_night": 85}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['R&B', 'Soul', 'Neo-Soul'];

-- Gospel/Spiritual = chill heavy
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 30, "chill": 70, "party": 40, "workout": 35, "late_night": 25}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Gospel', 'spiritual'];

-- Zouk/Kompa = late_night + chill heavy
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 50, "chill": 70, "party": 65, "workout": 30, "late_night": 80}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Zouk', 'Kompa'];

-- Dancehall = party + workout heavy
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 75, "chill": 25, "party": 90, "workout": 70, "late_night": 65}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Dancehall'];

-- Hip-Hop = workout + afro_heat
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 70, "chill": 40, "party": 65, "workout": 80, "late_night": 55}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['Hip-Hop/Rap', 'Hip-Hop'];

-- African/Afrobeats catch-all
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 80, "chill": 40, "party": 70, "workout": 60, "late_night": 50}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['African', 'Afrobeats', 'Naija'];

-- World music catch-all
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 50, "chill": 60, "party": 50, "workout": 40, "late_night": 55}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND cultural_tags && ARRAY['world_music'];

-- Step 5: For A/B tier artists without vibe_scores, use default afrobeats
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 75, "chill": 45, "party": 70, "workout": 60, "late_night": 50}'::jsonb
WHERE (vibe_scores IS NULL OR vibe_scores = '{}'::jsonb)
  AND artist_tier IN ('A', 'B');

-- Step 6: Ultimate fallback for remaining tracks
UPDATE video_intelligence
SET vibe_scores = '{"afro_heat": 50, "chill": 50, "party": 50, "workout": 50, "late_night": 50}'::jsonb
WHERE vibe_scores IS NULL OR vibe_scores = '{}'::jsonb;

-- Step 7: Create index on vibe_scores for fast queries
CREATE INDEX IF NOT EXISTS idx_vi_vibe_afro ON video_intelligence ((vibe_scores->>'afro_heat')::int DESC);
CREATE INDEX IF NOT EXISTS idx_vi_vibe_chill ON video_intelligence ((vibe_scores->>'chill')::int DESC);
CREATE INDEX IF NOT EXISTS idx_vi_vibe_party ON video_intelligence ((vibe_scores->>'party')::int DESC);

-- Step 8: Verify population
-- SELECT
--   COUNT(*) as total,
--   COUNT(*) FILTER (WHERE vibe_scores IS NOT NULL AND vibe_scores != '{}'::jsonb) as has_vibes
-- FROM video_intelligence;

