-- ============================================
-- VOYO CENTRAL DJ - Collective Intelligence
-- ============================================
-- The flywheel: Every user makes the DJ smarter for everyone
-- Gemini discovers → Supabase stores → Next user gets it FREE

-- ============================================
-- VERIFIED TRACKS (The Gold Mine)
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyo_id TEXT UNIQUE NOT NULL,          -- vyo_XXXXX encoded ID
  youtube_id TEXT NOT NULL,               -- Raw YouTube ID
  title TEXT NOT NULL,
  artist TEXT NOT NULL,

  -- Discovery metadata
  discovered_by TEXT DEFAULT 'gemini',    -- gemini | user_search | related | seed
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  verified BOOLEAN DEFAULT true,

  -- Vibe tags (matches MixBoard modes exactly)
  -- Array of mode IDs: afro-heat, chill-vibes, party-mode, late-night, workout, random-mixer
  vibe_tags TEXT[] DEFAULT '{}',

  -- Vibe scores (0-100) for weighted matching
  vibe_afro_heat INTEGER DEFAULT 0,
  vibe_chill_vibes INTEGER DEFAULT 0,
  vibe_party_mode INTEGER DEFAULT 0,
  vibe_late_night INTEGER DEFAULT 0,
  vibe_workout INTEGER DEFAULT 0,

  -- Collective scores (updated by signals)
  play_count INTEGER DEFAULT 0,
  love_count INTEGER DEFAULT 0,
  skip_count INTEGER DEFAULT 0,
  queue_count INTEGER DEFAULT 0,
  complete_count INTEGER DEFAULT 0,

  -- Calculated metrics
  skip_rate DECIMAL(5,2) DEFAULT 0,       -- skip_count / play_count
  completion_rate DECIMAL(5,2) DEFAULT 0, -- complete_count / play_count
  love_rate DECIMAL(5,2) DEFAULT 0,       -- love_count / play_count
  heat_score INTEGER DEFAULT 0,           -- Composite popularity score

  -- Content metadata
  duration INTEGER DEFAULT 0,
  thumbnail TEXT,
  tags TEXT[] DEFAULT '{}',
  language TEXT DEFAULT 'en',
  region TEXT DEFAULT 'NG',

  -- Timestamps
  last_played TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes for fast vibe matching
  CONSTRAINT valid_vibe_scores CHECK (
    vibe_afro_heat BETWEEN 0 AND 100 AND
    vibe_chill_vibes BETWEEN 0 AND 100 AND
    vibe_party_mode BETWEEN 0 AND 100 AND
    vibe_late_night BETWEEN 0 AND 100 AND
    vibe_workout BETWEEN 0 AND 100
  )
);

-- ============================================
-- USER SIGNALS (Anonymous Engagement)
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id TEXT NOT NULL REFERENCES voyo_tracks(voyo_id) ON DELETE CASCADE,

  -- Anonymous user identifier (hashed device/session ID)
  user_hash TEXT NOT NULL,

  -- Signal type
  action TEXT NOT NULL CHECK (action IN ('play', 'love', 'skip', 'complete', 'queue', 'unlove')),

  -- Context
  session_vibe TEXT,                      -- What vibe was active
  time_of_day TEXT,                       -- morning | afternoon | evening | late_night
  listen_duration INTEGER DEFAULT 0,      -- How long they listened (seconds)

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CURATED VIBES (Smart Playlists)
-- ============================================
CREATE TABLE IF NOT EXISTS voyo_vibes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "late-night-afro-chill"
  display_name TEXT NOT NULL,             -- "Late Night Afro Chill"
  description TEXT,

  -- Vibe profile (what tracks match)
  target_afro INTEGER DEFAULT 50,
  target_chill INTEGER DEFAULT 50,
  target_hype INTEGER DEFAULT 50,
  target_romantic INTEGER DEFAULT 50,
  target_workout INTEGER DEFAULT 50,

  -- Curated tracks (manual picks)
  curated_tracks TEXT[] DEFAULT '{}',

  -- Stats
  play_count INTEGER DEFAULT 0,
  follower_count INTEGER DEFAULT 0,

  -- Metadata
  cover_url TEXT,
  created_by TEXT DEFAULT 'system',
  is_featured BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR FAST QUERIES
-- ============================================

-- Fast vibe matching (by MixBoard mode)
CREATE INDEX IF NOT EXISTS idx_tracks_vibe_afro_heat ON voyo_tracks(vibe_afro_heat);
CREATE INDEX IF NOT EXISTS idx_tracks_vibe_chill_vibes ON voyo_tracks(vibe_chill_vibes);
CREATE INDEX IF NOT EXISTS idx_tracks_vibe_party_mode ON voyo_tracks(vibe_party_mode);
CREATE INDEX IF NOT EXISTS idx_tracks_vibe_late_night ON voyo_tracks(vibe_late_night);
CREATE INDEX IF NOT EXISTS idx_tracks_vibe_workout ON voyo_tracks(vibe_workout);
CREATE INDEX IF NOT EXISTS idx_tracks_vibe_tags ON voyo_tracks USING GIN(vibe_tags);
CREATE INDEX IF NOT EXISTS idx_tracks_heat ON voyo_tracks(heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_recent ON voyo_tracks(last_played DESC NULLS LAST);

-- Fast signal queries
CREATE INDEX IF NOT EXISTS idx_signals_track ON voyo_signals(track_id);
CREATE INDEX IF NOT EXISTS idx_signals_user ON voyo_signals(user_hash);
CREATE INDEX IF NOT EXISTS idx_signals_recent ON voyo_signals(created_at DESC);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update track metrics after new signal
CREATE OR REPLACE FUNCTION update_track_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- Update counts based on action
  IF NEW.action = 'play' THEN
    UPDATE voyo_tracks SET
      play_count = play_count + 1,
      last_played = NOW()
    WHERE voyo_id = NEW.track_id;
  ELSIF NEW.action = 'love' THEN
    UPDATE voyo_tracks SET love_count = love_count + 1 WHERE voyo_id = NEW.track_id;
  ELSIF NEW.action = 'skip' THEN
    UPDATE voyo_tracks SET skip_count = skip_count + 1 WHERE voyo_id = NEW.track_id;
  ELSIF NEW.action = 'complete' THEN
    UPDATE voyo_tracks SET complete_count = complete_count + 1 WHERE voyo_id = NEW.track_id;
  ELSIF NEW.action = 'queue' THEN
    UPDATE voyo_tracks SET queue_count = queue_count + 1 WHERE voyo_id = NEW.track_id;
  ELSIF NEW.action = 'unlove' THEN
    UPDATE voyo_tracks SET love_count = GREATEST(0, love_count - 1) WHERE voyo_id = NEW.track_id;
  END IF;

  -- Recalculate rates
  UPDATE voyo_tracks SET
    skip_rate = CASE WHEN play_count > 0 THEN (skip_count::DECIMAL / play_count) * 100 ELSE 0 END,
    completion_rate = CASE WHEN play_count > 0 THEN (complete_count::DECIMAL / play_count) * 100 ELSE 0 END,
    love_rate = CASE WHEN play_count > 0 THEN (love_count::DECIMAL / play_count) * 100 ELSE 0 END,
    heat_score = (
      play_count * 1 +
      love_count * 5 +
      complete_count * 3 +
      queue_count * 2 -
      skip_count * 2
    ),
    updated_at = NOW()
  WHERE voyo_id = NEW.track_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating metrics
DROP TRIGGER IF EXISTS trigger_update_track_metrics ON voyo_signals;
CREATE TRIGGER trigger_update_track_metrics
  AFTER INSERT ON voyo_signals
  FOR EACH ROW
  EXECUTE FUNCTION update_track_metrics();

-- ============================================
-- RPC FUNCTIONS (Callable from client)
-- ============================================

-- Get tracks matching a MixBoard mode (by tag)
CREATE OR REPLACE FUNCTION get_tracks_by_mode(
  p_mode TEXT DEFAULT 'afro-heat',
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  voyo_id TEXT,
  title TEXT,
  artist TEXT,
  thumbnail TEXT,
  heat_score INTEGER,
  vibe_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.voyo_id,
    t.title,
    t.artist,
    t.thumbnail,
    t.heat_score,
    -- Get the score for the requested mode
    CASE p_mode
      WHEN 'afro-heat' THEN t.vibe_afro_heat
      WHEN 'chill-vibes' THEN t.vibe_chill_vibes
      WHEN 'party-mode' THEN t.vibe_party_mode
      WHEN 'late-night' THEN t.vibe_late_night
      WHEN 'workout' THEN t.vibe_workout
      ELSE 50
    END as vibe_score
  FROM voyo_tracks t
  WHERE t.verified = true
    AND t.skip_rate < 50
    AND (
      p_mode = ANY(t.vibe_tags)  -- Has this tag
      OR CASE p_mode
        WHEN 'afro-heat' THEN t.vibe_afro_heat > 60
        WHEN 'chill-vibes' THEN t.vibe_chill_vibes > 60
        WHEN 'party-mode' THEN t.vibe_party_mode > 60
        WHEN 'late-night' THEN t.vibe_late_night > 60
        WHEN 'workout' THEN t.vibe_workout > 60
        ELSE false
      END
    )
  ORDER BY
    -- Primary: vibe tag match, Secondary: heat score
    (p_mode = ANY(t.vibe_tags))::int DESC,
    CASE p_mode
      WHEN 'afro-heat' THEN t.vibe_afro_heat
      WHEN 'chill-vibes' THEN t.vibe_chill_vibes
      WHEN 'party-mode' THEN t.vibe_party_mode
      WHEN 'late-night' THEN t.vibe_late_night
      WHEN 'workout' THEN t.vibe_workout
      ELSE 50
    END DESC,
    t.heat_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Get tracks matching multiple modes (weighted)
CREATE OR REPLACE FUNCTION get_tracks_by_vibe(
  p_afro_heat INTEGER DEFAULT 50,
  p_chill_vibes INTEGER DEFAULT 50,
  p_party_mode INTEGER DEFAULT 50,
  p_late_night INTEGER DEFAULT 50,
  p_workout INTEGER DEFAULT 50,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  voyo_id TEXT,
  title TEXT,
  artist TEXT,
  thumbnail TEXT,
  heat_score INTEGER,
  vibe_match DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.voyo_id,
    t.title,
    t.artist,
    t.thumbnail,
    t.heat_score,
    -- Calculate weighted vibe match (lower = better)
    (
      ABS(t.vibe_afro_heat - p_afro_heat) * (p_afro_heat / 100.0) +
      ABS(t.vibe_chill_vibes - p_chill_vibes) * (p_chill_vibes / 100.0) +
      ABS(t.vibe_party_mode - p_party_mode) * (p_party_mode / 100.0) +
      ABS(t.vibe_late_night - p_late_night) * (p_late_night / 100.0) +
      ABS(t.vibe_workout - p_workout) * (p_workout / 100.0)
    )::DECIMAL as vibe_match
  FROM voyo_tracks t
  WHERE t.verified = true
    AND t.skip_rate < 50
  ORDER BY
    vibe_match ASC,
    t.heat_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Train a track's vibe score (THE FLYWHEEL!)
-- Called when users interact with modes
CREATE OR REPLACE FUNCTION train_track_vibe(
  p_track_id TEXT,
  p_mode TEXT,
  p_increment INTEGER DEFAULT 3
)
RETURNS BOOLEAN AS $$
DECLARE
  current_tags TEXT[];
BEGIN
  -- Get current tags
  SELECT vibe_tags INTO current_tags FROM voyo_tracks WHERE voyo_id = p_track_id;

  -- Update the appropriate vibe score (cap at 100) and add tag if not present
  UPDATE voyo_tracks SET
    vibe_afro_heat = CASE WHEN p_mode = 'afro-heat' THEN LEAST(100, vibe_afro_heat + p_increment) ELSE vibe_afro_heat END,
    vibe_chill_vibes = CASE WHEN p_mode = 'chill-vibes' THEN LEAST(100, vibe_chill_vibes + p_increment) ELSE vibe_chill_vibes END,
    vibe_party_mode = CASE WHEN p_mode = 'party-mode' THEN LEAST(100, vibe_party_mode + p_increment) ELSE vibe_party_mode END,
    vibe_late_night = CASE WHEN p_mode = 'late-night' THEN LEAST(100, vibe_late_night + p_increment) ELSE vibe_late_night END,
    vibe_workout = CASE WHEN p_mode = 'workout' THEN LEAST(100, vibe_workout + p_increment) ELSE vibe_workout END,
    vibe_tags = CASE
      WHEN p_mode = ANY(current_tags) THEN current_tags
      ELSE array_append(current_tags, p_mode)
    END,
    updated_at = NOW()
  WHERE voyo_id = p_track_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Get hot tracks (trending now)
CREATE OR REPLACE FUNCTION get_hot_tracks(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  voyo_id TEXT,
  title TEXT,
  artist TEXT,
  thumbnail TEXT,
  heat_score INTEGER,
  play_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.voyo_id,
    t.title,
    t.artist,
    t.thumbnail,
    t.heat_score,
    t.play_count
  FROM voyo_tracks t
  WHERE t.verified = true
    AND t.last_played > NOW() - INTERVAL '7 days'
  ORDER BY t.heat_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA (MixBoard modes)
-- ============================================
INSERT INTO voyo_vibes (name, display_name, description, target_afro, target_chill, target_hype, is_featured) VALUES
  ('afro-heat', 'Afro Heat', 'High energy Afrobeats, Naija, Amapiano - for the dance floor 🔥', 90, 20, 90, true),
  ('chill-vibes', 'Chill Vibes', 'Smooth R&B, slow jams, mellow acoustic vibes 🌙', 40, 90, 20, true),
  ('party-mode', 'Party Mode', 'Turn up! Dance floor bangers and hype tracks 🎉', 70, 10, 95, true),
  ('late-night', 'Late Night', 'Moody, atmospheric tracks for after dark 💜', 50, 70, 30, true),
  ('workout', 'Workout', 'High tempo beats to keep you moving 💪', 80, 10, 95, true),
  ('random-mixer', 'Random Mixer', 'Surprise me - a mix of everything ✨', 50, 50, 50, true)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE voyo_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_vibes ENABLE ROW LEVEL SECURITY;

-- Everyone can read tracks and vibes
CREATE POLICY "Tracks are viewable by everyone" ON voyo_tracks FOR SELECT USING (true);
CREATE POLICY "Vibes are viewable by everyone" ON voyo_vibes FOR SELECT USING (true);

-- Everyone can insert signals (anonymous)
CREATE POLICY "Anyone can record signals" ON voyo_signals FOR INSERT WITH CHECK (true);

-- Only authenticated can insert tracks (our backend)
CREATE POLICY "Backend can insert tracks" ON voyo_tracks FOR INSERT WITH CHECK (true);
CREATE POLICY "Backend can update tracks" ON voyo_tracks FOR UPDATE USING (true);
