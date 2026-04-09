-- ============================================
-- VOYO: ADD COUNTRY/REGION TO VIDEO_INTELLIGENCE
-- ============================================
-- Phase 1.1 of the Vibe Matrix
-- VIBE = Tag × Energy × Country × Era
-- ============================================

-- Step 1: Add country and region columns
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS region TEXT;

-- Step 2: Create index for fast country queries
CREATE INDEX IF NOT EXISTS idx_vi_country ON video_intelligence (country);
CREATE INDEX IF NOT EXISTS idx_vi_region ON video_intelligence (region);

-- Step 3: Populate country from matched_artist using artist_master mapping
-- This maps artist names to their countries of origin
-- Will be run after this migration with actual artist_master data

-- Known country mappings from artist_master.json (110 artists)
-- NG = Nigeria, GH = Ghana, ZA = South Africa, KE = Kenya, TZ = Tanzania
-- GN = Guinea, SN = Senegal, CD = Congo, CM = Cameroon, CI = Ivory Coast
-- JM = Jamaica, TT = Trinidad, HT = Haiti, US = USA, UK = United Kingdom

-- Step 4: Create region mapping function
CREATE OR REPLACE FUNCTION get_region_from_country(p_country TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN CASE p_country
    -- West Africa
    WHEN 'NG' THEN 'West Africa'
    WHEN 'GH' THEN 'West Africa'
    WHEN 'SN' THEN 'West Africa'
    WHEN 'CI' THEN 'West Africa'
    WHEN 'GN' THEN 'West Africa'
    WHEN 'ML' THEN 'West Africa'
    WHEN 'BF' THEN 'West Africa'
    WHEN 'BJ' THEN 'West Africa'
    WHEN 'TG' THEN 'West Africa'
    WHEN 'NE' THEN 'West Africa'
    WHEN 'GM' THEN 'West Africa'
    WHEN 'SL' THEN 'West Africa'
    WHEN 'LR' THEN 'West Africa'
    -- East Africa
    WHEN 'KE' THEN 'East Africa'
    WHEN 'TZ' THEN 'East Africa'
    WHEN 'UG' THEN 'East Africa'
    WHEN 'RW' THEN 'East Africa'
    WHEN 'ET' THEN 'East Africa'
    WHEN 'SO' THEN 'East Africa'
    -- Southern Africa
    WHEN 'ZA' THEN 'Southern Africa'
    WHEN 'ZW' THEN 'Southern Africa'
    WHEN 'BW' THEN 'Southern Africa'
    WHEN 'ZM' THEN 'Southern Africa'
    WHEN 'MZ' THEN 'Southern Africa'
    WHEN 'MW' THEN 'Southern Africa'
    WHEN 'AO' THEN 'Southern Africa'
    -- Central Africa
    WHEN 'CD' THEN 'Central Africa'
    WHEN 'CG' THEN 'Central Africa'
    WHEN 'CM' THEN 'Central Africa'
    WHEN 'GA' THEN 'Central Africa'
    WHEN 'CF' THEN 'Central Africa'
    -- North Africa
    WHEN 'EG' THEN 'North Africa'
    WHEN 'MA' THEN 'North Africa'
    WHEN 'DZ' THEN 'North Africa'
    WHEN 'TN' THEN 'North Africa'
    WHEN 'LY' THEN 'North Africa'
    WHEN 'SD' THEN 'North Africa'
    -- Caribbean
    WHEN 'JM' THEN 'Caribbean'
    WHEN 'TT' THEN 'Caribbean'
    WHEN 'HT' THEN 'Caribbean'
    WHEN 'BB' THEN 'Caribbean'
    WHEN 'PR' THEN 'Caribbean'
    WHEN 'CU' THEN 'Caribbean'
    WHEN 'DO' THEN 'Caribbean'
    WHEN 'GP' THEN 'Caribbean'
    WHEN 'MQ' THEN 'Caribbean'
    WHEN 'GY' THEN 'Caribbean'
    -- Diaspora
    WHEN 'US' THEN 'Diaspora'
    WHEN 'UK' THEN 'Diaspora'
    WHEN 'FR' THEN 'Diaspora'
    WHEN 'CA' THEN 'Diaspora'
    WHEN 'NL' THEN 'Diaspora'
    WHEN 'DE' THEN 'Diaspora'
    ELSE 'Unknown'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 5: Check current state
-- SELECT COUNT(*) as total,
--        COUNT(country) as has_country,
--        COUNT(matched_artist) as has_matched_artist
-- FROM video_intelligence;
