-- VOYO Universe Schema
-- The smart KV: username = key, universe = value
-- Run this in Supabase SQL Editor

-- ============================================
-- UNIVERSES TABLE (The Core)
-- ============================================
CREATE TABLE IF NOT EXISTS universes (
  -- THE KEY (URL identity)
  username TEXT PRIMARY KEY,

  -- THE LOCK (PIN auth, no email needed)
  pin_hash TEXT NOT NULL,
  phone TEXT,  -- Optional: for PIN recovery via SMS

  -- THE VALUE (user's universe)
  state JSONB DEFAULT '{
    "likes": [],
    "playlists": [],
    "queue": [],
    "history": [],
    "preferences": {
      "boostProfile": "boosted",
      "shuffleMode": false,
      "repeatMode": "off"
    },
    "stats": {
      "totalListens": 0,
      "totalMinutes": 0,
      "totalOyes": 0
    }
  }'::jsonb,

  -- PUBLIC VIEW (what visitors see without PIN)
  public_profile JSONB DEFAULT '{
    "displayName": "",
    "bio": "",
    "avatarUrl": null,
    "topTracks": [],
    "publicPlaylists": [],
    "isPublic": true
  }'::jsonb,

  -- PORTAL (real-time sync)
  now_playing JSONB,  -- { trackId, title, artist, thumbnail, currentTime, duration }
  portal_open BOOLEAN DEFAULT false,
  portal_viewers TEXT[] DEFAULT '{}',

  -- METADATA
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_active TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_universes_portal_open ON universes(portal_open) WHERE portal_open = true;
CREATE INDEX IF NOT EXISTS idx_universes_last_active ON universes(last_active DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE universes ENABLE ROW LEVEL SECURITY;

-- Anyone can read public profiles and portal state
CREATE POLICY "Public profiles are viewable by everyone"
  ON universes FOR SELECT
  USING (true);

-- Only authenticated user can update their own universe
-- (We'll handle auth via PIN verification in the app)
CREATE POLICY "Users can update own universe"
  ON universes FOR UPDATE
  USING (true)  -- We verify PIN in app before allowing updates
  WITH CHECK (true);

-- Anyone can insert (create account)
CREATE POLICY "Anyone can create universe"
  ON universes FOR INSERT
  WITH CHECK (true);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER universes_updated_at
  BEFORE UPDATE ON universes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- REALTIME
-- ============================================
-- Enable realtime for portal sync
ALTER PUBLICATION supabase_realtime ADD TABLE universes;

-- ============================================
-- REACTIONS TABLE (The Social Spine)
-- ============================================
-- Every reaction connects: User + Track + Category + Moment
CREATE TABLE IF NOT EXISTS reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHO reacted
  username TEXT NOT NULL REFERENCES universes(username) ON DELETE CASCADE,

  -- WHAT track
  track_id TEXT NOT NULL,           -- VOYO ID (vyo_xxx)
  track_title TEXT NOT NULL,
  track_artist TEXT NOT NULL,
  track_thumbnail TEXT,

  -- WHICH category (MixBoard column)
  category TEXT NOT NULL CHECK (category IN (
    'afro-heat', 'chill-vibes', 'party-mode', 'late-night', 'workout'
  )),

  -- THE reaction
  emoji TEXT NOT NULL DEFAULT '🔥',
  reaction_type TEXT NOT NULL DEFAULT 'oye' CHECK (reaction_type IN (
    'oyo', 'oye', 'fire', 'chill', 'hype', 'love'
  )),

  -- Optional text comment
  comment TEXT,

  -- WHEN
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- TRACK STATS TABLE (Aggregated per track)
-- ============================================
-- Cached stats for quick lookups (updated via trigger)
CREATE TABLE IF NOT EXISTS track_stats (
  track_id TEXT PRIMARY KEY,
  track_title TEXT,
  track_artist TEXT,
  track_thumbnail TEXT,

  -- Total reactions
  total_reactions INTEGER DEFAULT 0,

  -- Reactions by category (for vibe breakdown)
  afro_heat_count INTEGER DEFAULT 0,
  chill_vibes_count INTEGER DEFAULT 0,
  party_mode_count INTEGER DEFAULT 0,
  late_night_count INTEGER DEFAULT 0,
  workout_count INTEGER DEFAULT 0,

  -- Dominant category (auto-calculated)
  dominant_category TEXT,

  -- Timestamps
  first_reaction_at TIMESTAMPTZ,
  last_reaction_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- REACTIONS INDEXES
-- ============================================
-- Fast lookup: reactions for a track (comments view)
CREATE INDEX IF NOT EXISTS idx_reactions_track ON reactions(track_id, created_at DESC);

-- Fast lookup: reactions by user (portal history)
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(username, created_at DESC);

-- Fast lookup: reactions by category (MixBoard pulse)
CREATE INDEX IF NOT EXISTS idx_reactions_category ON reactions(category, created_at DESC);

-- Fast lookup: recent reactions globally (live feed)
CREATE INDEX IF NOT EXISTS idx_reactions_recent ON reactions(created_at DESC);

-- ============================================
-- REACTIONS RLS
-- ============================================
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_stats ENABLE ROW LEVEL SECURITY;

-- Anyone can read reactions
CREATE POLICY "Reactions are viewable by everyone"
  ON reactions FOR SELECT USING (true);

-- Only logged-in users can create reactions (verified in app via PIN)
CREATE POLICY "Authenticated users can create reactions"
  ON reactions FOR INSERT WITH CHECK (true);

-- Track stats are public
CREATE POLICY "Track stats are viewable by everyone"
  ON track_stats FOR SELECT USING (true);

-- Track stats updated via trigger only
CREATE POLICY "Track stats updated via system"
  ON track_stats FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- TRACK STATS TRIGGER (Auto-update on reaction)
-- ============================================
CREATE OR REPLACE FUNCTION update_track_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Upsert track stats
  INSERT INTO track_stats (
    track_id, track_title, track_artist, track_thumbnail,
    total_reactions, first_reaction_at, last_reaction_at,
    afro_heat_count, chill_vibes_count, party_mode_count,
    late_night_count, workout_count
  ) VALUES (
    NEW.track_id, NEW.track_title, NEW.track_artist, NEW.track_thumbnail,
    1, NEW.created_at, NEW.created_at,
    CASE WHEN NEW.category = 'afro-heat' THEN 1 ELSE 0 END,
    CASE WHEN NEW.category = 'chill-vibes' THEN 1 ELSE 0 END,
    CASE WHEN NEW.category = 'party-mode' THEN 1 ELSE 0 END,
    CASE WHEN NEW.category = 'late-night' THEN 1 ELSE 0 END,
    CASE WHEN NEW.category = 'workout' THEN 1 ELSE 0 END
  )
  ON CONFLICT (track_id) DO UPDATE SET
    total_reactions = track_stats.total_reactions + 1,
    last_reaction_at = NEW.created_at,
    afro_heat_count = track_stats.afro_heat_count +
      CASE WHEN NEW.category = 'afro-heat' THEN 1 ELSE 0 END,
    chill_vibes_count = track_stats.chill_vibes_count +
      CASE WHEN NEW.category = 'chill-vibes' THEN 1 ELSE 0 END,
    party_mode_count = track_stats.party_mode_count +
      CASE WHEN NEW.category = 'party-mode' THEN 1 ELSE 0 END,
    late_night_count = track_stats.late_night_count +
      CASE WHEN NEW.category = 'late-night' THEN 1 ELSE 0 END,
    workout_count = track_stats.workout_count +
      CASE WHEN NEW.category = 'workout' THEN 1 ELSE 0 END,
    updated_at = now();

  -- Update dominant category
  UPDATE track_stats SET dominant_category = (
    SELECT category FROM (
      VALUES
        ('afro-heat', afro_heat_count),
        ('chill-vibes', chill_vibes_count),
        ('party-mode', party_mode_count),
        ('late-night', late_night_count),
        ('workout', workout_count)
    ) AS t(category, count)
    ORDER BY count DESC
    LIMIT 1
  )
  WHERE track_id = NEW.track_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reaction_stats_trigger
  AFTER INSERT ON reactions
  FOR EACH ROW
  EXECUTE FUNCTION update_track_stats();

-- ============================================
-- REALTIME FOR REACTIONS
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE track_stats;

-- ============================================
-- VOYO LYRICS TABLE (Phonetic Lyrics Engine)
-- ============================================
-- AI-generated lyrics with community polish
CREATE TABLE IF NOT EXISTS voyo_lyrics (
  -- Track identifier (YouTube/Piped ID)
  track_id TEXT PRIMARY KEY,

  -- Track metadata
  title TEXT NOT NULL,
  artist TEXT NOT NULL,

  -- Whisper transcription
  phonetic_raw TEXT NOT NULL,           -- Raw Whisper output
  phonetic_clean TEXT,                  -- Community-polished version

  -- Language & quality
  language TEXT DEFAULT 'unknown',      -- Detected or tagged language
  confidence REAL DEFAULT 0.5,          -- Whisper confidence score

  -- Timestamped segments (JSONB array)
  segments JSONB DEFAULT '[]'::jsonb,   -- [{start, end, text, phonetic, english?, french?, cultural_note?}]

  -- Translations
  translations JSONB DEFAULT '{}'::jsonb, -- {en: "...", fr: "...", ...}

  -- Community workflow
  status TEXT DEFAULT 'raw' CHECK (status IN ('raw', 'polished', 'verified')),
  polished_by TEXT[] DEFAULT '{}',      -- Usernames who contributed
  verified_by TEXT,                     -- Moderator who verified

  -- Analytics
  play_count INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- LYRICS INDEXES
-- ============================================
-- Fast lookup by status (community queue)
CREATE INDEX IF NOT EXISTS idx_lyrics_status ON voyo_lyrics(status);

-- Popular lyrics (most played)
CREATE INDEX IF NOT EXISTS idx_lyrics_popular ON voyo_lyrics(play_count DESC);

-- Full-text search on lyrics
CREATE INDEX IF NOT EXISTS idx_lyrics_search ON voyo_lyrics
  USING gin(to_tsvector('simple', phonetic_raw || ' ' || COALESCE(phonetic_clean, '')));

-- ============================================
-- LYRICS RLS
-- ============================================
ALTER TABLE voyo_lyrics ENABLE ROW LEVEL SECURITY;

-- Anyone can read lyrics
CREATE POLICY "Lyrics are viewable by everyone"
  ON voyo_lyrics FOR SELECT USING (true);

-- Anyone can create lyrics (first transcription)
CREATE POLICY "Anyone can create lyrics"
  ON voyo_lyrics FOR INSERT WITH CHECK (true);

-- Anyone can update lyrics (community polish)
CREATE POLICY "Anyone can polish lyrics"
  ON voyo_lyrics FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================
-- LYRICS FUNCTIONS
-- ============================================

-- Increment play count (called from app)
CREATE OR REPLACE FUNCTION increment_lyrics_play_count(track_id_param TEXT)
RETURNS void AS $$
BEGIN
  UPDATE voyo_lyrics
  SET play_count = play_count + 1,
      updated_at = now()
  WHERE track_id = track_id_param;
END;
$$ LANGUAGE plpgsql;

-- Auto-update updated_at for lyrics
CREATE TRIGGER voyo_lyrics_updated_at
  BEFORE UPDATE ON voyo_lyrics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- FOLLOWS TABLE (Social Graph)
-- ============================================
CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL REFERENCES universes(username) ON DELETE CASCADE,
  following TEXT NOT NULL REFERENCES universes(username) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (follower, following)
);

-- Indexes for fast follower/following lookups
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following);

-- RLS for follows
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Follows are viewable by everyone"
  ON follows FOR SELECT USING (true);

CREATE POLICY "Anyone can create follows"
  ON follows FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can delete follows"
  ON follows FOR DELETE USING (true);

-- ============================================
-- VIDEO INTELLIGENCE TABLE (The Collective Brain)
-- ============================================
-- Every YouTube video VOYO encounters gets stored here
-- One user's discovery = everyone's knowledge
CREATE TABLE IF NOT EXISTS video_intelligence (
  -- THE KEY
  youtube_id TEXT PRIMARY KEY,

  -- METADATA (from YouTube/OCR)
  title TEXT NOT NULL,
  artist TEXT,                          -- Extracted artist name
  channel_name TEXT,                    -- YouTube channel
  duration_seconds INTEGER,
  thumbnail_url TEXT,

  -- SEARCH OPTIMIZATION
  search_terms TEXT[],                  -- Variations: ["davido with you", "davido ft omah lay", "with you remix"]
  normalized_title TEXT,                -- Lowercase, stripped: "davido with you omah lay"

  -- RELATIONSHIPS (The Graph)
  related_ids TEXT[] DEFAULT '{}',      -- YouTube's suggested videos
  similar_ids TEXT[] DEFAULT '{}',      -- VOYO's similarity engine

  -- CLASSIFICATION
  genres TEXT[] DEFAULT '{}',           -- ["afrobeats", "amapiano"]
  moods TEXT[] DEFAULT '{}',            -- ["party", "chill", "workout"]
  language TEXT,                        -- "en", "fr", "yo", "wo"
  region TEXT,                          -- "NG", "GH", "SN"

  -- COMMUNITY SIGNALS
  voyo_play_count INTEGER DEFAULT 0,    -- Times played in VOYO
  voyo_queue_count INTEGER DEFAULT 0,   -- Times added to queue
  voyo_reaction_count INTEGER DEFAULT 0,-- OYE reactions

  -- DISCOVERY SOURCE
  discovered_by TEXT,                   -- Username who first found this
  discovery_method TEXT CHECK (discovery_method IN (
    'manual_play',      -- User played directly
    'ocr_extraction',   -- Extracted from YouTube suggestions
    'api_search',       -- Found via YouTube API
    'related_crawl',    -- Discovered from related videos
    'import'            -- Bulk import
  )),

  -- TIMESTAMPS
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_played_at TIMESTAMPTZ
);

-- ============================================
-- VIDEO INTELLIGENCE INDEXES
-- ============================================
-- Fast fuzzy search on title/artist
CREATE INDEX IF NOT EXISTS idx_video_normalized_title
  ON video_intelligence(normalized_title);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_video_search
  ON video_intelligence USING gin(to_tsvector('simple',
    title || ' ' || COALESCE(artist, '') || ' ' || COALESCE(channel_name, '')
  ));

-- Search terms array (for exact matching variations)
CREATE INDEX IF NOT EXISTS idx_video_search_terms
  ON video_intelligence USING gin(search_terms);

-- Popular videos
CREATE INDEX IF NOT EXISTS idx_video_popular
  ON video_intelligence(voyo_play_count DESC);

-- Recent discoveries
CREATE INDEX IF NOT EXISTS idx_video_recent
  ON video_intelligence(created_at DESC);

-- ============================================
-- VIDEO INTELLIGENCE RLS
-- ============================================
ALTER TABLE video_intelligence ENABLE ROW LEVEL SECURITY;

-- Anyone can read (the whole point is shared knowledge)
CREATE POLICY "Video intelligence is public"
  ON video_intelligence FOR SELECT USING (true);

-- Anyone can contribute
CREATE POLICY "Anyone can add video intelligence"
  ON video_intelligence FOR INSERT WITH CHECK (true);

-- Anyone can update (add related videos, increment counts)
CREATE POLICY "Anyone can update video intelligence"
  ON video_intelligence FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================
-- VIDEO INTELLIGENCE FUNCTIONS
-- ============================================

-- Normalize title for searching
CREATE OR REPLACE FUNCTION normalize_video_title(title_input TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN lower(regexp_replace(
    regexp_replace(title_input, '\(.*?\)|\[.*?\]', '', 'g'),  -- Remove brackets
    '[^a-z0-9\s]', '', 'g'                                     -- Keep only alphanumeric
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Auto-normalize on insert/update
CREATE OR REPLACE FUNCTION video_intelligence_normalize()
RETURNS TRIGGER AS $$
BEGIN
  NEW.normalized_title = normalize_video_title(NEW.title);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_intelligence_normalize_trigger
  BEFORE INSERT OR UPDATE ON video_intelligence
  FOR EACH ROW
  EXECUTE FUNCTION video_intelligence_normalize();

-- Increment play count
CREATE OR REPLACE FUNCTION increment_video_play(video_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE video_intelligence
  SET voyo_play_count = voyo_play_count + 1,
      last_played_at = now()
  WHERE youtube_id = video_id;
END;
$$ LANGUAGE plpgsql;

-- Increment queue count
CREATE OR REPLACE FUNCTION increment_video_queue(video_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE video_intelligence
  SET voyo_queue_count = voyo_queue_count + 1
  WHERE youtube_id = video_id;
END;
$$ LANGUAGE plpgsql;

-- Fuzzy search for video by title
CREATE OR REPLACE FUNCTION search_video_intelligence(search_query TEXT, limit_count INTEGER DEFAULT 5)
RETURNS TABLE(
  youtube_id TEXT,
  title TEXT,
  artist TEXT,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    vi.youtube_id,
    vi.title,
    vi.artist,
    similarity(vi.normalized_title, normalize_video_title(search_query)) as sim
  FROM video_intelligence vi
  WHERE
    vi.normalized_title % normalize_video_title(search_query)
    OR search_query = ANY(vi.search_terms)
  ORDER BY sim DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Enable trigram extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index for fuzzy search
CREATE INDEX IF NOT EXISTS idx_video_title_trgm
  ON video_intelligence USING gin(normalized_title gin_trgm_ops);

-- ============================================
-- REALTIME FOR VIDEO INTELLIGENCE
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE video_intelligence;

-- ============================================
-- FEED CONTENT TABLE (Cached Tracks, UGC, Social Imports)
-- ============================================
-- Stores cached track metadata for the feed experience
-- Enables fast feed loading, access tracking, and content curation
CREATE TABLE IF NOT EXISTS voyo_feed_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id TEXT NOT NULL,                    -- YouTube ID
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  thumbnail_url TEXT,                        -- CDN cached thumbnail
  audio_extract_url TEXT,                    -- 30s audio clip URL
  duration INTEGER,                          -- Track duration in seconds
  source TEXT NOT NULL DEFAULT 'youtube',    -- 'youtube' | 'ugc' | 'social'
  metadata JSONB DEFAULT '{}',               -- Extra data (tags, mood, etc)
  cached_at TIMESTAMPTZ DEFAULT now(),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  access_count INTEGER DEFAULT 0
);

-- Indexes for feed queries
CREATE INDEX IF NOT EXISTS idx_feed_content_track ON voyo_feed_content(track_id);
CREATE INDEX IF NOT EXISTS idx_feed_content_source ON voyo_feed_content(source);
CREATE INDEX IF NOT EXISTS idx_feed_content_cached ON voyo_feed_content(cached_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_content_accessed ON voyo_feed_content(last_accessed_at DESC);

-- ============================================
-- FEED CONTENT RLS
-- ============================================
ALTER TABLE voyo_feed_content ENABLE ROW LEVEL SECURITY;

-- Anyone can read feed content (it's all public discovery)
CREATE POLICY "Feed content is viewable by everyone"
  ON voyo_feed_content FOR SELECT USING (true);

-- Anyone can add feed content (from search, discovery)
CREATE POLICY "Anyone can add feed content"
  ON voyo_feed_content FOR INSERT WITH CHECK (true);

-- Anyone can update feed content (increment access, update metadata)
CREATE POLICY "Anyone can update feed content"
  ON voyo_feed_content FOR UPDATE USING (true) WITH CHECK (true);

-- ============================================
-- FEED CONTENT FUNCTIONS
-- ============================================

-- Increment access count and update last_accessed_at
CREATE OR REPLACE FUNCTION update_feed_content_access(track_id_param TEXT)
RETURNS void AS $$
BEGIN
  UPDATE voyo_feed_content
  SET access_count = access_count + 1,
      last_accessed_at = now()
  WHERE track_id = track_id_param;
END;
$$ LANGUAGE plpgsql;

-- Auto-update trigger for feed content
CREATE TRIGGER voyo_feed_content_updated_at
  BEFORE UPDATE ON voyo_feed_content
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- REALTIME FOR FEED CONTENT
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE voyo_feed_content;

-- ============================================
-- SAMPLE DATA (for testing)
-- ============================================
-- INSERT INTO universes (username, pin_hash, public_profile)
-- VALUES (
--   'dash',
--   '$2a$10$...', -- hashed PIN
--   '{
--     "displayName": "Dash",
--     "bio": "Building the future of music",
--     "topTracks": ["track1", "track2"],
--     "isPublic": true
--   }'::jsonb
-- );
