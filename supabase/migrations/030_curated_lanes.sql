-- ============================================
-- 030: Curated Lanes — creator-first moments architecture
-- ============================================
-- Goal: replace the current "scrape-then-categorize" approach with a
-- curator-first one. We pick ~1,000 creators across 17 buckets
-- (travel/genre/trends sub-cats), pull their last 10 reels each, and
-- tag every moment with the lane it was curated for.
--
-- The orphan-import + siphon catalog (6,925 active moments) remains
-- as the Discover tier underneath — useMoments will prefer
-- curated_lane matches and fall back to cultural_tags overlap.
--
-- Two pieces:
--   1) voyo_moments gets curated_lane / curated_creator_handle /
--      curated_at  → so the feed filter is one indexed equality.
--   2) voyo_creator_proposals  → the LLM-bootstrapped queue Dash
--      approves before we scrape. Keeps taste in the loop without
--      hand-typing 1,000 handles.
-- ============================================

-- ── 1) voyo_moments curated columns ──────────────────────────────────

ALTER TABLE voyo_moments
  ADD COLUMN IF NOT EXISTS curated_lane            TEXT,
  ADD COLUMN IF NOT EXISTS curated_creator_handle  TEXT,
  ADD COLUMN IF NOT EXISTS curated_at              TIMESTAMPTZ;

-- One indexed equality is what useMoments will hit per fetch.
-- Partial index keeps the index slim — only the curated rows are in it.
CREATE INDEX IF NOT EXISTS idx_voyo_moments_curated_lane
  ON voyo_moments (curated_lane)
  WHERE curated_lane IS NOT NULL;

-- For the cockpit lane-health panel: count moments by lane fast.
CREATE INDEX IF NOT EXISTS idx_voyo_moments_curated_lane_creator
  ON voyo_moments (curated_lane, curated_creator_handle)
  WHERE curated_lane IS NOT NULL;

COMMENT ON COLUMN voyo_moments.curated_lane            IS 'e.g. genre/kizomba, travel/angola — the bucket this moment was curated for';
COMMENT ON COLUMN voyo_moments.curated_creator_handle  IS 'IG/TikTok handle from the curator proposal — survives username changes via this snapshot';
COMMENT ON COLUMN voyo_moments.curated_at              IS 'when the curated-ingest worker inserted this row';

-- ── 2) voyo_creator_proposals — the LLM approval queue ──────────────

CREATE TABLE IF NOT EXISTS voyo_creator_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- bucket key, e.g. 'genre/kizomba' or 'travel/angola'
  lane            TEXT NOT NULL,
  -- platform handle (no leading @)
  handle          TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('instagram','tiktok')),
  -- LLM-supplied taxonomy + confidence
  region          TEXT,
  language        TEXT,
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  -- one-line LLM rationale ("Angolan kizomba singer-songwriter; ~3M followers")
  rationale       TEXT,
  -- proposal lifecycle
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','ingested','failed')),
  -- audit trail
  proposed_by     TEXT,                 -- e.g. 'claude-sonnet-4-6'
  approved_by     TEXT,                 -- 'dash' (or whoever clicks)
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at     TIMESTAMPTZ,
  ingested_at     TIMESTAMPTZ,
  -- ingest result snapshot
  reels_fetched   INTEGER,
  reels_inserted  INTEGER,
  ingest_error    TEXT,
  -- one creator proposed once per lane (re-proposing same handle in
  -- another lane is allowed — same person can serve afrobeats AND
  -- nigeria, etc.).
  UNIQUE (lane, handle, platform)
);

CREATE INDEX IF NOT EXISTS idx_creator_proposals_lane_status
  ON voyo_creator_proposals (lane, status);

CREATE INDEX IF NOT EXISTS idx_creator_proposals_status_confidence
  ON voyo_creator_proposals (status, confidence DESC);

COMMENT ON TABLE  voyo_creator_proposals IS 'LLM-bootstrapped curator queue. Cockpit panel approves; ingest worker scrapes approved.';
COMMENT ON COLUMN voyo_creator_proposals.lane       IS 'bucket the creator was proposed for, e.g. genre/kizomba';
COMMENT ON COLUMN voyo_creator_proposals.confidence IS '0..1 — LLM''s self-rating that this creator fits the lane';
COMMENT ON COLUMN voyo_creator_proposals.status     IS 'pending → approved → ingested (or rejected/failed)';

-- RLS: service_key bypasses; no anon access (curator queue is internal).
ALTER TABLE voyo_creator_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_all ON voyo_creator_proposals;
CREATE POLICY svc_all ON voyo_creator_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
