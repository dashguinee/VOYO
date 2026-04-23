-- Migration 026: Fix reactions table so OYE writes actually land
--
-- P0-1: add track_position column that the client inserts with every reaction.
--       Every INSERT was silently 400-ing because PostgREST couldn't find the column.
--
-- P0-2: drop the username → universes FK so anon users (no universes row) can react.
--       The client falls back to username='anonymous' which has no universes row,
--       causing a FK violation on every guest OYE.
--       user_hash is the source-of-truth identity now (matches voyo_signals model).

-- P0-1
ALTER TABLE public.reactions
  ADD COLUMN IF NOT EXISTS track_position INTEGER
  CHECK (track_position IS NULL OR (track_position >= 0 AND track_position <= 100));

-- P0-2: drop FK that blocks anon reactions. Grant INSERT explicitly.
ALTER TABLE public.reactions
  DROP CONSTRAINT IF EXISTS reactions_username_fkey;

GRANT INSERT ON public.reactions TO anon;
GRANT INSERT ON public.reactions TO authenticated;
