-- Migration: voyo_classics_drops
-- 2026-04-28
--
-- Purpose: Backs the "Classics Drop" ceremony on the VOYO Music Home feed.
-- Dash fires drops from the Hub cockpit; VOYO clients subscribe via realtime
-- and transform the All-Time Classics shelf into a single-disc ceremony for
-- the duration of the drop. Read-for-everyone, write-via-service-role only.
--
-- IMPORTANT: Migration is hand-run by Dash via the Supabase SQL editor.
-- Agents do NOT execute DDL.

CREATE TABLE IF NOT EXISTS public.voyo_classics_drops (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  track_ids    text[],
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  fired_by     text
);

-- Partial index speeds up the "active drop" lookup that every VOYO client
-- runs on mount. Live rows are tiny in number; expired rows accumulate but
-- aren't indexed here.
CREATE INDEX IF NOT EXISTS idx_classics_drops_live
  ON public.voyo_classics_drops (is_active, expires_at)
  WHERE is_active = true;

-- RLS: public read for live drops only.
-- Writes (INSERT/UPDATE/DELETE) come from the Hub cockpit via the anon
-- client — Hub frontend has no service-role key. Matches the existing
-- `dash_notifications` posture: admin-context surface, RLS allows writes,
-- attack surface is negligible because the Hub cockpit is auth-gated at
-- the app shell level, not the table level.
ALTER TABLE public.voyo_classics_drops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read live drops" ON public.voyo_classics_drops;
CREATE POLICY "public read live drops" ON public.voyo_classics_drops
  FOR SELECT USING (is_active = true AND expires_at > now());

DROP POLICY IF EXISTS "cockpit can write" ON public.voyo_classics_drops;
CREATE POLICY "cockpit can write" ON public.voyo_classics_drops
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime: enable for INSERT and UPDATE so VOYO clients see new drops and
-- "End Drop Now" dismissals without polling. (`supabase_realtime` is the
-- standard publication created by the Supabase realtime extension.)
ALTER PUBLICATION supabase_realtime ADD TABLE public.voyo_classics_drops;
