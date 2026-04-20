-- Migration 024 — drop voyo_signals.track_id FK constraint.
--
-- Background: the FK to voyo_tracks(track_id) was added early when
-- voyo_tracks was assumed to be the canonical track registry. Reality
-- diverged — playback tracks (voyomusic.com) come from video_intelligence,
-- with youtube_id as the natural key. The FK has been rejecting every
-- real user signal since 2026-04-18 (34K rows frozen, 0 new inserts).
--
-- Taste graph is dead until this drops. One-line fix.

ALTER TABLE voyo_signals
  DROP CONSTRAINT IF EXISTS voyo_signals_track_id_fkey;
