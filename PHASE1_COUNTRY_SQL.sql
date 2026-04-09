-- ============================================
-- VOYO: PHASE 1.1 & 1.2 - ADD AND POPULATE COUNTRY/REGION
-- Run this in Supabase SQL Editor
-- ============================================

-- STEP 1: Add columns
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS region TEXT;

-- STEP 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_vi_country ON video_intelligence (country);
CREATE INDEX IF NOT EXISTS idx_vi_region ON video_intelligence (region);

-- STEP 3: Create temp mapping table
CREATE TEMP TABLE artist_country_map (
  artist_name TEXT PRIMARY KEY,
  country TEXT,
  region TEXT
);

-- STEP 4: Insert mappings
INSERT INTO artist_country_map (artist_name, country, region) VALUES
  ('burna boy', 'NG', 'West Africa'),
  ('wizkid', 'NG', 'West Africa'),
  ('davido', 'NG', 'West Africa'),
  ('rema', 'NG', 'West Africa'),
  ('asake', 'NG', 'West Africa'),
  ('tems', 'NG', 'West Africa'),
  ('ckay', 'NG', 'West Africa'),
  ('ayra starr', 'NG', 'West Africa'),
  ('fela kuti', 'NG', 'West Africa'),
  ('kizz daniel', 'NG', 'West Africa'),
  ('omah lay', 'NG', 'West Africa'),
  ('fireboy dml', 'NG', 'West Africa'),
  ('olamide', 'NG', 'West Africa'),
  ('tiwa savage', 'NG', 'West Africa'),
  ('yemi alade', 'NG', 'West Africa'),
  ('ruger', 'NG', 'West Africa'),
  ('p square', 'NG', 'West Africa'),
  ('dbanj', 'NG', 'West Africa'),
  ('2baba', 'NG', 'West Africa'),
  ('black coffee', 'ZA', 'South Africa'),
  ('tyla', 'ZA', 'South Africa'),
  ('kabza de small', 'ZA', 'South Africa'),
  ('dj maphorisa', 'ZA', 'South Africa'),
  ('master kg', 'ZA', 'South Africa'),
  ('nasty c', 'ZA', 'South Africa'),
  ('focalistic', 'ZA', 'South Africa'),
  ('uncle waffles', 'ZA', 'South Africa'),
  ('black sherif', 'GH', 'West Africa'),
  ('sarkodie', 'GH', 'West Africa'),
  ('stonebwoy', 'GH', 'West Africa'),
  ('shatta wale', 'GH', 'West Africa'),
  ('king promise', 'GH', 'West Africa'),
  ('kidi', 'GH', 'West Africa'),
  ('kuami eugene', 'GH', 'West Africa'),
  ('diamond platnumz', 'TZ', 'East Africa'),
  ('harmonize', 'TZ', 'East Africa'),
  ('rayvanny', 'TZ', 'East Africa'),
  ('zuchu', 'TZ', 'East Africa'),
  ('ali kiba', 'TZ', 'East Africa'),
  ('fally ipupa', 'CD', 'Central Africa'),
  ('koffi olomide', 'CD', 'Central Africa'),
  ('innossb', 'CD', 'Central Africa'),
  ('gims', 'CD', 'Central Africa'),
  ('dadju', 'CD', 'Central Africa'),
  ('papa wemba', 'CD', 'Central Africa'),
  ('saifond balde', 'GN', 'West Africa'),
  ('azaya', 'GN', 'West Africa'),
  ('sekouba bambino', 'GN', 'West Africa'),
  ('mory kante', 'GN', 'West Africa'),
  ('soul bangs', 'GN', 'West Africa'),
  ('djanii alfa', 'GN', 'West Africa'),
  ('instinct killers', 'GN', 'West Africa'),
  ('straiker', 'GN', 'West Africa'),
  ('king alasko', 'GN', 'West Africa'),
  ('youssou ndour', 'SN', 'West Africa'),
  ('akon', 'SN', 'West Africa'),
  ('wally seck', 'SN', 'West Africa'),
  ('dj arafat', 'CI', 'West Africa'),
  ('magic system', 'CI', 'West Africa'),
  ('alpha blondy', 'CI', 'West Africa'),
  ('sauti sol', 'KE', 'East Africa'),
  ('nyashinski', 'KE', 'East Africa'),
  ('salif keita', 'ML', 'West Africa'),
  ('amadou mariam', 'ML', 'West Africa'),
  ('teddy afro', 'ET', 'East Africa'),
  ('adekunle gold', 'NG', 'West Africa'),
  ('simi', 'NG', 'West Africa'),
  ('wande coal', 'NG', 'West Africa'),
  ('flavour', 'NG', 'West Africa'),
  ('tekno', 'NG', 'West Africa'),
  ('phyno', 'NG', 'West Africa'),
  ('zlatan', 'NG', 'West Africa'),
  ('mr eazi', 'NG', 'West Africa'),
  ('joeboy', 'NG', 'West Africa'),
  ('bnxn', 'NG', 'West Africa'),
  ('victony', 'NG', 'West Africa'),
  ('pheelz', 'NG', 'West Africa'),
  ('bella shmurda', 'NG', 'West Africa'),
  ('seyi vibez', 'NG', 'West Africa'),
  ('oxlade', 'NG', 'West Africa'),
  ('mayorkun', 'NG', 'West Africa'),
  ('falz', 'NG', 'West Africa'),
  ('patoranking', 'NG', 'West Africa'),
  ('timaya', 'NG', 'West Africa'),
  ('young stunna', 'ZA', 'South Africa'),
  ('dbn gogo', 'ZA', 'South Africa'),
  ('cassper nyovest', 'ZA', 'South Africa'),
  ('makhadzi', 'ZA', 'South Africa'),
  ('a reece', 'ZA', 'South Africa'),
  ('takana zion', 'GN', 'West Africa'),
  ('mamady keita', 'GN', 'West Africa'),
  ('koury simple', 'GN', 'West Africa'),
  ('bembeya jazz', 'GN', 'West Africa'),
  ('mc freshh', 'GN', 'West Africa'),
  ('thiird', 'GN', 'West Africa'),
  ('maxim bk', 'GN', 'West Africa'),
  ('wada du game', 'GN', 'West Africa'),
  ('hezbo rap', 'GN', 'West Africa'),
  ('nandy', 'TZ', 'East Africa'),
  ('mbosso', 'TZ', 'East Africa'),
  ('marioo', 'TZ', 'East Africa'),
  ('ferre gola', 'CD', 'Central Africa'),
  ('heritier watanabe', 'CD', 'Central Africa'),
  ('werrason', 'CD', 'Central Africa'),
  ('aya nakamura', 'CD', 'Central Africa'),
  ('damso', 'CD', 'Central Africa'),
  ('gyakie', 'GH', 'West Africa'),
  ('camidoh', 'GH', 'West Africa'),
  ('medikal', 'GH', 'West Africa'),
  ('kwesi arthur', 'GH', 'West Africa'),
  ('r2bees', 'GH', 'West Africa'),
  ('burna boy', 'NG', 'West Africa'),
  ('wizkid', 'NG', 'West Africa'),
  ('wizkid', 'NG', 'West Africa'),
  ('davido', 'NG', 'West Africa'),
  ('fela kuti', 'NG', 'West Africa'),
  ('diamond platnumz', 'TZ', 'East Africa'),
  ('black coffee', 'ZA', 'South Africa'),
  ('p square', 'NG', 'West Africa'),
  ('p square', 'NG', 'West Africa'),
  ('innossb', 'CD', 'Central Africa'),
  ('innossb', 'CD', 'Central Africa'),
  ('youssou ndour', 'SN', 'West Africa'),
  ('youssou ndour', 'SN', 'West Africa'),
  ('sekouba bambino', 'GN', 'West Africa'),
  ('sekouba bambino', 'GN', 'West Africa'),
  ('gims', 'CD', 'Central Africa'),
  ('gims', 'CD', 'Central Africa'),
  ('bnxn', 'NG', 'West Africa'),
  ('bnxn', 'NG', 'West Africa');

-- STEP 5: Update video_intelligence from mapping
UPDATE video_intelligence vi
SET 
  country = acm.country,
  region = acm.region
FROM artist_country_map acm
WHERE LOWER(vi.matched_artist) = acm.artist_name
  AND vi.country IS NULL;

-- STEP 6: Also try artist column as fallback
UPDATE video_intelligence vi
SET 
  country = acm.country,
  region = acm.region
FROM artist_country_map acm
WHERE LOWER(vi.artist) LIKE '%' || acm.artist_name || '%'
  AND vi.country IS NULL;

-- STEP 7: Check coverage
SELECT 
  COUNT(*) as total,
  COUNT(country) as has_country,
  ROUND(COUNT(country) * 100.0 / COUNT(*), 1) as pct
FROM video_intelligence;

-- STEP 8: Country breakdown
SELECT 
  country,
  COUNT(*) as count
FROM video_intelligence
WHERE country IS NOT NULL
GROUP BY country
ORDER BY count DESC;
