-- ============================================
-- VOYO MOMENTS - Short-Form Video Discovery
-- ============================================
-- Moments are short clips (15-60s) that promote full songs
-- Like TikTok sounds - clip plays, user taps to hear full track
--
-- Flow:
-- 1. Moments Discovery finds viral clips (Instagram, TikTok, YouTube Shorts)
-- 2. Each moment links to a parent track in video_intelligence
-- 3. User swipes through moments in feed
-- 4. Tapping "Play Full Song" opens the real track

-- ============================================
-- VOYO MOMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_moments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identification
  source_platform TEXT NOT NULL CHECK (source_platform IN ('youtube', 'youtube_shorts', 'instagram', 'tiktok')),
  source_id TEXT NOT NULL,                    -- Platform-specific ID (video ID, reel ID, etc.)
  source_url TEXT,                            -- Direct URL to original content

  -- Content info
  title TEXT NOT NULL,
  description TEXT,
  creator_username TEXT,                      -- @username of creator
  creator_name TEXT,                          -- Display name
  thumbnail_url TEXT,

  -- Duration & timing
  duration_seconds INTEGER DEFAULT 30,        -- Typical: 15-60s
  hook_start_seconds INTEGER DEFAULT 0,       -- Where the good part starts

  -- CRITICAL: Link to parent track
  parent_track_id TEXT REFERENCES video_intelligence(youtube_id) ON DELETE SET NULL,
  parent_track_title TEXT,                    -- Cached for display
  parent_track_artist TEXT,                   -- Cached for display
  track_match_confidence DECIMAL(3,2) DEFAULT 0.5,  -- 0-1, how confident we are about the match
  track_match_method TEXT DEFAULT 'gemini',   -- gemini | audio_fingerprint | manual | user_tag

  -- Content classification
  content_type TEXT DEFAULT 'dance' CHECK (content_type IN (
    'dance',           -- Dance challenge/choreo
    'lip_sync',        -- Lip sync video
    'reaction',        -- Reaction to song
    'cover',           -- Cover/remix
    'live',            -- Live performance
    'comedy',          -- Comedy skit using song
    'fashion',         -- Fashion/lifestyle with song
    'sports',          -- Sports/fitness with song
    'tutorial',        -- Dance/music tutorial
    'original'         -- Original music video
  )),

  -- Vibe tags (inherited or detected)
  vibe_tags TEXT[] DEFAULT '{}',
  cultural_tags TEXT[] DEFAULT '{}',

  -- Engagement signals (from source platform)
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,

  -- VOYO-specific engagement
  voyo_plays INTEGER DEFAULT 0,
  voyo_skips INTEGER DEFAULT 0,
  voyo_full_song_taps INTEGER DEFAULT 0,      -- How many tapped "Play Full Song"
  voyo_reactions INTEGER DEFAULT 0,

  -- Calculated scores
  virality_score INTEGER DEFAULT 0,           -- Based on source engagement
  conversion_rate DECIMAL(5,2) DEFAULT 0,     -- full_song_taps / plays
  heat_score INTEGER DEFAULT 0,               -- Combined popularity

  -- Discovery metadata
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  discovered_by TEXT DEFAULT 'gemini',        -- gemini | crawler | user_submit
  verified BOOLEAN DEFAULT false,             -- Human verified the track match
  featured BOOLEAN DEFAULT false,             -- Featured in feed

  -- Status
  is_active BOOLEAN DEFAULT true,
  deactivated_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint on platform + source_id
  UNIQUE(source_platform, source_id)
);

-- ============================================
-- MOMENT-TRACK LINKING TABLE (Many-to-Many)
-- ============================================
-- Sometimes a moment uses multiple songs or can promote multiple
CREATE TABLE IF NOT EXISTS voyo_moment_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id UUID NOT NULL REFERENCES voyo_moments(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,                     -- youtube_id from video_intelligence

  -- Timing within the moment
  starts_at_seconds INTEGER DEFAULT 0,        -- When this track starts in the clip
  ends_at_seconds INTEGER,                    -- When this track ends
  is_primary BOOLEAN DEFAULT true,            -- Is this the main song?

  -- Match info
  match_confidence DECIMAL(3,2) DEFAULT 0.5,
  match_method TEXT DEFAULT 'gemini',

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(moment_id, track_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- Fast lookup by parent track (find all moments using a song)
CREATE INDEX IF NOT EXISTS idx_moments_parent_track ON voyo_moments(parent_track_id);

-- Fast lookup by platform
CREATE INDEX IF NOT EXISTS idx_moments_platform ON voyo_moments(source_platform);

-- Fast lookup by content type
CREATE INDEX IF NOT EXISTS idx_moments_content_type ON voyo_moments(content_type);

-- Hot moments (trending)
CREATE INDEX IF NOT EXISTS idx_moments_heat ON voyo_moments(heat_score DESC) WHERE is_active = true;

-- Recent moments
CREATE INDEX IF NOT EXISTS idx_moments_recent ON voyo_moments(discovered_at DESC) WHERE is_active = true;

-- Featured moments for feed
CREATE INDEX IF NOT EXISTS idx_moments_featured ON voyo_moments(featured, heat_score DESC) WHERE is_active = true;

-- Vibe-based discovery
CREATE INDEX IF NOT EXISTS idx_moments_vibe_tags ON voyo_moments USING GIN(vibe_tags);

-- Moment-track links
CREATE INDEX IF NOT EXISTS idx_moment_tracks_moment ON voyo_moment_tracks(moment_id);
CREATE INDEX IF NOT EXISTS idx_moment_tracks_track ON voyo_moment_tracks(track_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update moment heat score
CREATE OR REPLACE FUNCTION update_moment_heat_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.heat_score := (
    NEW.voyo_plays * 1 +
    NEW.voyo_full_song_taps * 10 +     -- Strong signal: they want the full song!
    NEW.voyo_reactions * 5 -
    NEW.voyo_skips * 2
  );

  NEW.conversion_rate := CASE
    WHEN NEW.voyo_plays > 0 THEN (NEW.voyo_full_song_taps::DECIMAL / NEW.voyo_plays) * 100
    ELSE 0
  END;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_moment_heat
  BEFORE UPDATE ON voyo_moments
  FOR EACH ROW
  EXECUTE FUNCTION update_moment_heat_score();

-- Get moments for a track (find all clips using this song)
CREATE OR REPLACE FUNCTION get_moments_for_track(
  p_track_id TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  source_platform TEXT,
  source_id TEXT,
  title TEXT,
  creator_username TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  content_type TEXT,
  heat_score INTEGER,
  voyo_plays INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.source_platform,
    m.source_id,
    m.title,
    m.creator_username,
    m.thumbnail_url,
    m.duration_seconds,
    m.content_type,
    m.heat_score,
    m.voyo_plays
  FROM voyo_moments m
  WHERE m.parent_track_id = p_track_id
    AND m.is_active = true
  ORDER BY m.heat_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Get hot moments for feed
CREATE OR REPLACE FUNCTION get_hot_moments(
  p_content_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  source_platform TEXT,
  source_id TEXT,
  title TEXT,
  creator_username TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  content_type TEXT,
  parent_track_id TEXT,
  parent_track_title TEXT,
  parent_track_artist TEXT,
  heat_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.source_platform,
    m.source_id,
    m.title,
    m.creator_username,
    m.thumbnail_url,
    m.duration_seconds,
    m.content_type,
    m.parent_track_id,
    m.parent_track_title,
    m.parent_track_artist,
    m.heat_score
  FROM voyo_moments m
  WHERE m.is_active = true
    AND (p_content_type IS NULL OR m.content_type = p_content_type)
    AND m.parent_track_id IS NOT NULL  -- Must have linked track
  ORDER BY m.heat_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Record moment play and optional full song tap
CREATE OR REPLACE FUNCTION record_moment_play(
  p_moment_id UUID,
  p_tapped_full_song BOOLEAN DEFAULT false
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE voyo_moments SET
    voyo_plays = voyo_plays + 1,
    voyo_full_song_taps = voyo_full_song_taps + CASE WHEN p_tapped_full_song THEN 1 ELSE 0 END
  WHERE id = p_moment_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Link moment to track (for AI or manual matching)
CREATE OR REPLACE FUNCTION link_moment_to_track(
  p_moment_id UUID,
  p_track_id TEXT,
  p_confidence DECIMAL DEFAULT 0.8,
  p_method TEXT DEFAULT 'gemini'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_track_title TEXT;
  v_track_artist TEXT;
BEGIN
  -- Get track info from video_intelligence
  SELECT title, artist INTO v_track_title, v_track_artist
  FROM video_intelligence
  WHERE youtube_id = p_track_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Update moment with parent track
  UPDATE voyo_moments SET
    parent_track_id = p_track_id,
    parent_track_title = v_track_title,
    parent_track_artist = v_track_artist,
    track_match_confidence = p_confidence,
    track_match_method = p_method,
    updated_at = NOW()
  WHERE id = p_moment_id;

  -- Also add to moment_tracks for many-to-many
  INSERT INTO voyo_moment_tracks (moment_id, track_id, is_primary, match_confidence, match_method)
  VALUES (p_moment_id, p_track_id, true, p_confidence, p_method)
  ON CONFLICT (moment_id, track_id) DO UPDATE SET
    match_confidence = EXCLUDED.match_confidence,
    match_method = EXCLUDED.match_method;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE voyo_moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_moment_tracks ENABLE ROW LEVEL SECURITY;

-- Everyone can read moments
CREATE POLICY "Moments are viewable by everyone" ON voyo_moments FOR SELECT USING (true);
CREATE POLICY "Moment tracks are viewable by everyone" ON voyo_moment_tracks FOR SELECT USING (true);

-- Backend can insert/update
CREATE POLICY "Backend can insert moments" ON voyo_moments FOR INSERT WITH CHECK (true);
CREATE POLICY "Backend can update moments" ON voyo_moments FOR UPDATE USING (true);
CREATE POLICY "Backend can insert moment tracks" ON voyo_moment_tracks FOR INSERT WITH CHECK (true);

-- ============================================
-- STATS VIEW
-- ============================================
CREATE OR REPLACE VIEW voyo_moments_stats AS
SELECT
  COUNT(*) as total_moments,
  COUNT(*) FILTER (WHERE parent_track_id IS NOT NULL) as linked_moments,
  COUNT(*) FILTER (WHERE verified = true) as verified_moments,
  COUNT(*) FILTER (WHERE featured = true) as featured_moments,
  SUM(voyo_plays) as total_plays,
  SUM(voyo_full_song_taps) as total_full_song_taps,
  ROUND(AVG(conversion_rate), 2) as avg_conversion_rate,
  COUNT(DISTINCT parent_track_id) as unique_tracks_promoted
FROM voyo_moments
WHERE is_active = true;

-- ============================================
-- SAMPLE DATA COMMENT (run separately)
-- ============================================
-- To insert sample moments, use the moments_loader script:
-- node scripts/load_moments.js

COMMENT ON TABLE voyo_moments IS 'Short-form video clips (15-60s) that promote full songs. Each moment links to a parent track in video_intelligence.';
COMMENT ON COLUMN voyo_moments.parent_track_id IS 'The youtube_id of the full song this moment promotes. Links to video_intelligence table.';
COMMENT ON COLUMN voyo_moments.voyo_full_song_taps IS 'How many users tapped "Play Full Song" - strong signal of track discovery.';
