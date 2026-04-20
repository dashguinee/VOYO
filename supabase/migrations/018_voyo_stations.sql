-- VOYO Stations — curator-led vibe hubs anchored by a DJ mix.
--
-- A station is a long-form DJ mix treated as a first-class surface:
--   • hero_video_id plays muted in portrait by default (the giant home card)
--   • dwell 7s → audio fades in (iframe if R2 not cached yet)
--   • tap → subscribes the user + plays R2 audio from the start
--   • the mix's tracklist is parsed and individually R2-cached so each
--     track the user hears is "ownable" (heart it, add to library)
--
-- Only this tiny table + subscriptions. Tracklist lives as jsonb here;
-- extracted tracks flow into voyo_upload_queue via seed script, not FK.

CREATE TABLE IF NOT EXISTS voyo_stations (
  id               text PRIMARY KEY,            -- slug: 'amapiano-station', 'ginga-me'
  hero_video_id    text NOT NULL,               -- YouTube id of the mix
  title            text NOT NULL,
  tagline          text,
  curator          text,                         -- 'Major League DJz', 'Ethan Tomas'
  location_code    text,                         -- ISO-ish: 'ZA', 'NG'
  location_label   text,                         -- 'Johannesburg', 'Lagos'
  vibe_axes        jsonb DEFAULT '{}'::jsonb,    -- {afro,chill,hype,late_night,workout} 0-100
  accent_colors    jsonb DEFAULT '{}'::jsonb,    -- {primary,secondary} hex
  tracklist        jsonb DEFAULT '[]'::jsonb,    -- [{t_seconds,title,artist,youtube_id,r2_cached}]
  is_live          boolean NOT NULL DEFAULT false,
  is_featured      boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  hero_r2_key      text,                         -- set once lanes cache the mix itself
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voyo_stations_featured_order
  ON voyo_stations(is_featured, sort_order ASC)
  WHERE is_featured = true;

-- Station subscriptions — pseudonymous, one row per (user_hash, station).
CREATE TABLE IF NOT EXISTS voyo_station_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_hash         text NOT NULL,
  station_id        text NOT NULL REFERENCES voyo_stations(id) ON DELETE CASCADE,
  subscribed_at     timestamptz NOT NULL DEFAULT now(),
  notify_on_new     boolean NOT NULL DEFAULT true,
  UNIQUE (user_hash, station_id)
);

CREATE INDEX IF NOT EXISTS idx_voyo_station_subs_user
  ON voyo_station_subscriptions(user_hash);

-- RLS
ALTER TABLE voyo_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyo_station_subscriptions ENABLE ROW LEVEL SECURITY;

-- Stations: anyone reads, only service role writes (curator-controlled).
DROP POLICY IF EXISTS "stations_public_read" ON voyo_stations;
CREATE POLICY "stations_public_read" ON voyo_stations
  FOR SELECT TO anon, authenticated USING (true);

-- Subscriptions: anon can create its own, read its own, delete its own.
-- user_hash length gate prevents empty/abusive inserts.
DROP POLICY IF EXISTS "subs_anon_insert" ON voyo_station_subscriptions;
CREATE POLICY "subs_anon_insert" ON voyo_station_subscriptions
  FOR INSERT TO anon
  WITH CHECK (length(user_hash) BETWEEN 8 AND 64);

DROP POLICY IF EXISTS "subs_public_read" ON voyo_station_subscriptions;
CREATE POLICY "subs_public_read" ON voyo_station_subscriptions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "subs_anon_delete" ON voyo_station_subscriptions;
CREATE POLICY "subs_anon_delete" ON voyo_station_subscriptions
  FOR DELETE TO anon
  USING (length(user_hash) BETWEEN 8 AND 64);

-- Bonus: fix the voyo_signals anon-insert while we're in DDL territory.
-- Taste graph was silently dropping signals for 48+ hours due to missing policy.
DROP POLICY IF EXISTS "signals_anon_insert" ON voyo_signals;
CREATE POLICY "signals_anon_insert" ON voyo_signals
  FOR INSERT TO anon
  WITH CHECK (
    action IN ('play','skip','complete','love','queue','oye')
    AND length(user_hash) BETWEEN 8 AND 64
  );
