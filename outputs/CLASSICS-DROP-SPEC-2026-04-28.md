# VOYO Classics Drop — Implementation Spec

**Date:** 2026-04-28
**Status:** Bonus edition. Off by default. Manual trigger primary, system fallback secondary (out of V1 scope — V1 is manual-only).
**Risk posture:** Additive only. Must not change behavior of the existing All-Time Classics shelf when no drop is active.

---

## What we're building

Dash fires a "Classics Drop" from the Hub cockpit. When fired, the VOYO Music Home page transforms its **All-Time Classics** shelf into a single-disc ceremony surface for the duration of the drop. After the drop expires (or is dismissed), the shelf returns to its current state with zero residue.

---

## Architecture (3 layers)

### 1. Supabase table `voyo_classics_drops`

Project: `mclbbkmpovnvcfmwsoqt`

```sql
CREATE TABLE voyo_classics_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  track_ids   text[],          -- optional manual selection (max 7)
  is_active   boolean NOT NULL DEFAULT true,
  notes       text,
  fired_by    text             -- admin email or 'cockpit'
);

CREATE INDEX idx_classics_drops_live
  ON voyo_classics_drops(is_active, expires_at)
  WHERE is_active = true;

-- RLS: read for everyone, write for service-role only.
ALTER TABLE voyo_classics_drops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read live drops" ON voyo_classics_drops
  FOR SELECT USING (is_active = true AND expires_at > now());
-- Inserts/updates happen via service-role key from the cockpit only.
```

**Active drop query** (clients use this):

```sql
SELECT * FROM voyo_classics_drops
WHERE is_active = true AND expires_at > now()
ORDER BY scheduled_at DESC
LIMIT 1;
```

**Realtime channel:** subscribe to `voyo_classics_drops` table for INSERT and UPDATE events. Refilter on every event.

### 2. Hub cockpit panel — "VOYO Classics Drop"

Location: `/home/dash/Hub/src/cockpit/`

Register in `src/cockpit/admin/appRegistry.ts` (hand-crafted, no auto-gen).

**Panel UI:**

- Header: "VOYO Classics Drop" — bronze accent matching VOYO design language (`#D4A053`)
- **Active drop card** (top) — if a live drop exists:
  - Shows: dropped at, expires in, track count (or "system curated"), notes
  - Button: **End Drop Now** (sets `is_active = false`)
- **New drop form**:
  - Track IDs textarea (optional) — paste up to 7 IDs, one per line or comma-sep. Empty = system curated.
  - Duration selector: `30 min` / `1 hr` / `4 hr` / `Until I dismiss` (24hr cap)
  - Notes input (optional, internal only)
  - Big primary button: **Drop Now**
- **Recent drops** (last 5):
  - Timestamp, duration, track count, notes, status (`live` / `expired` / `dismissed`)

**Backend wiring:**

Use `SUPABASE_SERVICE_KEY` from the existing Hub `.env` (already wired for admin ops). All writes via the service-role client. Pattern matches existing Hub admin panels.

`Until I dismiss` = `expires_at = now() + 24 hours` (hard cap), surfaces an active state until the user clicks End Drop Now.

**Validation:**
- Track IDs (if provided): trim whitespace, dedupe, cap at 7.
- Duration: must be one of the four options.
- Don't allow stacking — if a live drop already exists, disable Drop Now and surface a "End the live drop first" hint.

### 3. VOYO Music — subscriber + ceremony

Location: `/home/dash/voyo-music/src/`

#### 3a. Subscriber service

New file: `src/services/classicsDropService.ts`

- Exports a hook `useActiveClassicsDrop(): Drop | null`
- Internally:
  - On mount: fetch the current live drop via the active-drop query above
  - Subscribe to realtime on `voyo_classics_drops` (INSERT + UPDATE), refilter on each event
  - Returns the live drop object or null
  - Cleans up subscription on unmount

#### 3b. Feature flag

`VITE_VOYO_CLASSICS_DROP_ENABLED` env var. Gates the whole subscriber + ceremony. When unset/false, the hook returns null and the existing shelf renders unchanged.

**For dev/testing:** also support a localStorage override `voyo:classics:drop:enabled = "1"` so Dash can toggle it on his device without an env redeploy.

#### 3c. Ceremony component

New file: `src/components/classic/ClassicsDropCeremony.tsx`

Lives inside the existing All-Time Classics section in `HomeFeed.tsx` around line 3308 (where `{classicsTracks.length > 0 && ...` block currently is). When an active drop exists AND the feature flag is on, the ceremony **replaces** the existing shelf carousel. When no drop, the existing shelf renders as today.

**Drop track resolution:**
- If `drop.track_ids` is provided: look up those exact IDs from the existing `hotPool` / `TRACKS` data (use the same lookup pattern as elsewhere in HomeFeed). Fall back to system-curated if any IDs miss.
- If `drop.track_ids` is null/empty: use the existing `getClassicsTracks(hotPool, 7)` to pick 7 from the `'classic'`-tagged pool.
- Cap at 7. If fewer than 3 resolved tracks, gracefully fall back to today's shelf (don't ship a broken ceremony).

**Visual choreography (Dash's vision, verbatim translation):**

The 36×36 bronze disc icon at line 3395 of HomeFeed.tsx today is the **state indicator**. States:

| State | Icon behavior |
|---|---|
| `idle` (no drop) | Current behavior — static bronze disc with inner dot |
| `incoming` (drop just appeared, 600ms) | Gentle flash — opacity oscillation 0.6 ↔ 1, 2 cycles |
| `live` (drop active, no track playing yet) | Inner dot glows softly, slow fill of outer layer (radial bronze gradient breathes) |
| `playing` (a disc is on stage) | Spinning — the outer layer rotates slowly (~12s/rev), inner dot glows steady |

**The header text retract:**

"All-Time Classics / African Bangers · VOYO Certified" currently lives at lines 3415–3466. When the ceremony is live AND a disc is on stage, this two-line header **retracts**: scales down to ~50%, slides toward the icon, opacity drops to ~0.45 — becomes a "watermark" near the bronze icon.

Where the header was, **the song title now appears**. Two lines:
- Top: track title — Fraunces italic, 20px, 0.92 alpha, matching the "That's All" font choice
- Below: artist · year (or fallback `artist · oyé score / 1M plays / etc.`) — 11px tracking-wide uppercase Satoshi, 0.42 alpha

This text **drifts in from the left** in sync with the disc drifting in from the right.

**The disc drift:**

ONE disc on stage at a time, in the right-hand zone where the previous shelf's first disc would have been. Approx position: right of where the song title sits, roughly `right: 24px`, `width: 200px`, `height: 200px`.

Sequence (per disc):

1. Disc enters from `translateX(110%) rotate(0)` opacity 0
2. During flight (1.0s, cubic-bezier(0.16, 1, 0.3, 1)): translates to rest position AND spins (rotate increases by ~720° — two full rotations)
3. As disc arrives at rest (~T+1.0s): a **purple→gold glow overlay** triggers ON the disc — radial gradient burst, peaks at T+1.2s, fades by T+1.8s. End color: gold (`#D4A053`).
4. The glow's job: **mask the spin deceleration**. While the glow is at peak (T+1.0 → T+1.4s), the disc rotation eases to 0 (so when the glow fades, disc is at rest, not visibly spinning down).
5. Disc settles, art is the album cover (use existing thumbnail utils from `src/utils/thumbnail.ts`).

**Disc visual (peak VOYO design language):**

- Vinyl-disc shape: outer ring (bronze metal), middle ring (slightly darker), label center with album art clipped to a circle
- Subtle bronze hairline at the disc's outer edge
- Purple highlight ring on the inner label boundary
- Restrained — ONE signature element, not three. Read the memory file `voyo-premium-less-is-more.md` before adding ornament.

**Cycling through 7 discs:**

User taps the disc → plays the track → after track completes (or user explicitly skips), the next disc cycles in via the same drift animation. Existing disc drifts out left (mirror of entry) while next drifts in from right. No cross-fade between two discs simultaneously — strict one-at-a-time.

**End-of-drop:**

When the drop expires (subscriber returns null) OR Dash dismisses it from the cockpit, the ceremony **dissolves back** to the current shelf:
- Disc drifts out right with opacity fade (600ms)
- Header text un-retracts (scale 1, opacity full, 600ms)
- Bronze icon returns to idle
- Existing shelf carousel renders as today

**Reduced-motion:**

Wrap all animations behind `@media (prefers-reduced-motion: reduce)` — disable spin, drift, glow keyframes; opacity fades only.

---

## Files to touch (NON-OVERLAPPING between agents)

### Hub agent
- `/home/dash/Hub/src/cockpit/admin/appRegistry.ts` — register the panel
- `/home/dash/Hub/src/cockpit/voyo-classics-drop/VoyoClassicsDropPanel.tsx` — new file
- Possibly: a small Supabase client helper in the panel folder
- Read-only reference: `/home/dash/Hub/src/cockpit/StreamMode.tsx` for nav pattern

### VOYO agent
- `/home/dash/voyo-music/supabase/migrations/2026-04-28-voyo-classics-drops.sql` — new file (migration)
- `/home/dash/voyo-music/src/services/classicsDropService.ts` — new file
- `/home/dash/voyo-music/src/components/classic/ClassicsDropCeremony.tsx` — new file
- `/home/dash/voyo-music/src/components/classic/HomeFeed.tsx` — surgical edit at the All-Time Classics shelf entry point (around line 3308). Wrap existing block in conditional: if active drop exists AND flag on AND flag enabled, render ceremony; else render existing shelf.
- `/home/dash/voyo-music/.env.example` — document the new env var
- `/home/dash/voyo-music/public/version.json` — bump version

---

## Definition of Done

- Migration file produced (Dash runs it via Supabase SQL editor — agents do NOT run DDL)
- Hub panel renders, fires drops, lists history. End Drop Now works. Service-role client wired.
- VOYO subscriber returns the active drop in real time. Ceremony renders only when flag on + active drop exists.
- Existing All-Time Classics shelf is byte-identical when feature flag is off OR no active drop.
- Animations respect `prefers-reduced-motion`.
- TypeScript compiles cleanly (`npx tsc --noEmit`).
- Both repos committed but NOT pushed (Dash reviews before push).

---

## Iteration expectation

Dash explicitly said "millimetric and careful" for the animation. Ship V1 of the ceremony with the choreography described above; expect 2–3 tuning rounds afterwards on timing, glow color stops, drift curve. Don't over-engineer the first pass — make the bones right and leave the timings as named constants at the top of the ceremony file for easy iteration.

---

## What to read before starting

- `/home/dash/.claude/projects/-home-dash-Hub/memory/voyo-premium-less-is-more.md` — restraint philosophy
- `/home/dash/voyo-music/src/components/classic/HomeFeed.tsx` lines 3300–3500 — the existing All-Time Classics surface
- `/home/dash/voyo-music/src/components/ui/DynamicIsland.tsx` — for VOYO design idiom reference (animation timings, easing curves)
- `/home/dash/Hub/src/cockpit/admin/appRegistry.ts` — for cockpit panel registration pattern
