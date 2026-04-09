-- ============================================
-- VOYO Music - Schema V2 (DASH ID Native)
-- ============================================
--
-- Philosophy:
-- - DASH ID is THE identity (no usernames)
-- - Name/avatar fetched from Command Center
-- - VOYO only stores music-specific data
--
-- URL: voyomusic.com/0046AAD
-- Display: V0046AAD
-- ============================================

-- Drop old tables (migration - be careful in prod!)
-- DROP TABLE IF EXISTS universes CASCADE;
-- DROP TABLE IF EXISTS follows CASCADE;
-- DROP TABLE IF EXISTS direct_messages CASCADE;
-- DROP TABLE IF EXISTS portal_messages CASCADE;

-- ============================================
-- VOYO PROFILES
-- Links DASH ID to music preferences
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_profiles (
  dash_id TEXT PRIMARY KEY,              -- "0046AAD" from Command Center

  -- Music preferences (JSONB for flexibility)
  preferences JSONB DEFAULT '{
    "track_preferences": {},
    "artist_preferences": {},
    "tag_preferences": {},
    "vibe_profile": {
      "afro_heat": 0.5,
      "chill": 0.5,
      "party": 0.5,
      "workout": 0.5,
      "late_night": 0.5
    }
  }'::jsonb,

  -- Listening state
  history JSONB DEFAULT '[]'::jsonb,      -- Last 100 plays
  queue JSONB DEFAULT '[]'::jsonb,        -- Current queue
  likes TEXT[] DEFAULT '{}',              -- Liked track IDs

  -- Stats
  total_listens INTEGER DEFAULT 0,
  total_minutes INTEGER DEFAULT 0,

  -- Portal state
  now_playing JSONB DEFAULT NULL,         -- Current track if portal open
  portal_open BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FRIENDS
-- NOTE: Friends are stored in COMMAND CENTER (global)
-- VOYO queries Command Center, no local follows table
-- ============================================
-- NO voyo_follows table - friends are global in Command Center

-- ============================================
-- VOYO MESSAGES
-- Direct messages between users
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id TEXT NOT NULL,                  -- "0046AAD"
  to_id TEXT NOT NULL,                    -- "0012XYZ"
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for conversation queries
CREATE INDEX IF NOT EXISTS idx_messages_from ON voyo_messages(from_id);
CREATE INDEX IF NOT EXISTS idx_messages_to ON voyo_messages(to_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON voyo_messages(
  LEAST(from_id, to_id),
  GREATEST(from_id, to_id),
  created_at DESC
);

-- ============================================
-- VOYO PORTAL MESSAGES
-- Room chat when someone's portal is open
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_portal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id TEXT NOT NULL,                  -- Portal owner "0046AAD"
  sender_id TEXT NOT NULL,                -- Who sent "0012XYZ"
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for portal chat
CREATE INDEX IF NOT EXISTS idx_portal_messages_host ON voyo_portal_messages(host_id, created_at DESC);

-- Auto-delete old portal messages (older than 24h)
-- Run via cron or Supabase scheduled function

-- ============================================
-- VOYO PLAYLISTS
-- User-created playlists
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dash_id TEXT NOT NULL,                  -- Owner "0046AAD"
  name TEXT NOT NULL,
  track_ids TEXT[] DEFAULT '{}',
  cover_url TEXT DEFAULT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user's playlists
CREATE INDEX IF NOT EXISTS idx_playlists_owner ON voyo_playlists(dash_id);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get or create profile (called on first VOYO visit)
CREATE OR REPLACE FUNCTION get_or_create_profile(p_dash_id TEXT)
RETURNS voyo_profiles AS $$
DECLARE
  profile voyo_profiles;
BEGIN
  SELECT * INTO profile FROM voyo_profiles WHERE dash_id = p_dash_id;

  IF NOT FOUND THEN
    INSERT INTO voyo_profiles (dash_id) VALUES (p_dash_id)
    RETURNING * INTO profile;
  END IF;

  RETURN profile;
END;
$$ LANGUAGE plpgsql;

-- NOTE: Friend counts come from Command Center, not VOYO

-- Get unread DM count
CREATE OR REPLACE FUNCTION get_unread_count(p_dash_id TEXT)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM voyo_messages
    WHERE to_id = p_dash_id AND read_at IS NULL
  );
END;
$$ LANGUAGE plpgsql;

-- Update last active timestamp
CREATE OR REPLACE FUNCTION touch_profile(p_dash_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE voyo_profiles
  SET last_active = NOW(), updated_at = NOW()
  WHERE dash_id = p_dash_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE voyo_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_portal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_playlists ENABLE ROW LEVEL SECURITY;

-- For now, allow all (auth handled by Command Center)
-- In production, verify dash_id matches JWT claim

CREATE POLICY "Allow all for now" ON voyo_profiles FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON voyo_messages FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON voyo_portal_messages FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON voyo_playlists FOR ALL USING (true);

-- ============================================
-- REALTIME
-- ============================================

-- Enable realtime for portal and messages
ALTER PUBLICATION supabase_realtime ADD TABLE voyo_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE voyo_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE voyo_portal_messages;
