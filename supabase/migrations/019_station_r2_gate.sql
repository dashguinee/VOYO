-- Station R2 gate: only show stations on home once the hero mix is in R2.
--
-- Product rule (from Dash): stations are previews. Previews play on-screen
-- via iframe fine, but we don't ship a station to users until the hero mix
-- is cached in R2 — that way taps always commit to background-playable audio
-- with lock-screen controls. No flaky "sometimes works" first impression.
--
-- Mechanism: trigger on voyo_upload_queue transitions. When status flips to
-- 'done', find any voyo_stations row whose hero_video_id matches the queue
-- row's youtube_id and stamp hero_r2_key with the canonical opus path.
--
-- HomeFeed query will filter WHERE hero_r2_key IS NOT NULL.

CREATE OR REPLACE FUNCTION mark_station_hero_r2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only react on the transition → 'done'. Other status changes irrelevant.
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    UPDATE voyo_stations
       SET hero_r2_key = '128/' || NEW.youtube_id || '.opus',
           updated_at  = now()
     WHERE hero_video_id = NEW.youtube_id
       AND hero_r2_key IS DISTINCT FROM ('128/' || NEW.youtube_id || '.opus');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_station_hero_r2 ON voyo_upload_queue;
CREATE TRIGGER trg_mark_station_hero_r2
AFTER UPDATE ON voyo_upload_queue
FOR EACH ROW
EXECUTE FUNCTION mark_station_hero_r2();

-- Backfill: any station whose hero is already done in the queue gets stamped.
UPDATE voyo_stations s
   SET hero_r2_key = '128/' || q.youtube_id || '.opus',
       updated_at  = now()
  FROM voyo_upload_queue q
 WHERE s.hero_video_id = q.youtube_id
   AND q.status = 'done'
   AND s.hero_r2_key IS NULL;
