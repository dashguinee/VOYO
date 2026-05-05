-- 028_train_track_vibe_vi.sql
-- Update train_track_vibe RPC to target video_intelligence (not legacy voyo_tracks).
-- Closes the flywheel: user queue/boost/reaction → vibe column increment on the
-- canonical table that the conductor pool reads from.
--
-- Run in Supabase SQL editor for anmgyxhnyhbyxzpjhxgx project.

CREATE OR REPLACE FUNCTION train_track_vibe(
  p_track_id  TEXT,
  p_mode      TEXT,
  p_increment INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_col TEXT;
BEGIN
  -- Map MixBoardMode → video_intelligence vibe column
  v_col := CASE p_mode
    WHEN 'afro-heat'   THEN 'vibe_afro_heat'
    WHEN 'chill-vibes' THEN 'vibe_chill_vibes'
    WHEN 'party-mode'  THEN 'vibe_party_mode'
    WHEN 'late-night'  THEN 'vibe_late_night'
    WHEN 'workout'     THEN 'vibe_workout'
    ELSE NULL
  END;

  IF v_col IS NULL THEN
    RETURN; -- Unknown mode — silently ignore
  END IF;

  -- Atomic increment; GREATEST prevents going below 0
  EXECUTE format(
    'UPDATE video_intelligence SET %I = GREATEST(0, COALESCE(%I, 0) + $1) WHERE youtube_id = $2',
    v_col, v_col
  ) USING p_increment, p_track_id;
END;
$$;

-- Grant execute to authenticated and anon roles (called from client-side trainVibe)
GRANT EXECUTE ON FUNCTION train_track_vibe(TEXT, TEXT, INTEGER) TO authenticated, anon;
