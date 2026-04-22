# AUDIT-MOMENTS-2 — Creator Uploads + Reaction Collection

**Date:** 2026-04-22
**Scope:** Creator-side of VOYO Moments — upload pipeline, moment creation, reaction collection on one's own moments.
**Agent:** One of 9 parallel audit agents (consumer-side covered separately).

---

## TL;DR — HEADLINE FINDING

**There is no creator upload UI. There is no creator session. There are no per-moment reactions.**

The "creator side" of Moments is currently an **offline batch pipeline** (a CJS script scanning local siphon directories and PUTing to R2), plus two TODO slots in the frontend:

1. `src/types/index.ts:191` declares `VoyoTab = 'music' | 'feed' | 'upload' | 'dahub'` — an `'upload'` tab exists in the type union.
2. `src/components/voyo/PortraitVOYO.tsx:333` contains the exact comment `{/* LAYER 3: CREATOR MODE — hidden until backend ready */}` — the UI slot is reserved but **the component is not rendered**.
3. No file in `src/**` writes to `voyo_moments` via an INSERT authored by a user. Every INSERT is the Gemini discoverer / the CJS upload script / an enrichment cron.

So the audit splits cleanly:
- **P0/P1** findings live in the DATA LAYER (RLS is wide open, counters bypass the trigger, no FK sanity).
- **Client-visible creator flow** is still an empty slot, so most "upload flow" questions are N/A.

---

## 1. UPLOAD PIPELINE — CJS-ONLY, UNAUTHED, RESUME-ABLE

File: `/home/dash/voyo-music/scripts/upload-moments-videos.cjs`

**Flow:**
```
local disk (~/.zion/renaissance/siphon/content/{platform}/{creator}/*.mp4)
   ↓  scanVideos()
   ↓  r2Exists(key) → HEAD check (resume)
   ↓  r2.send(PutObjectCommand) — reads ENTIRE file into memory (fs.readFileSync)
   ↓  PATCH voyo_moments?source_id=eq.X  r2_video_key=...
```

**Findings:**

### P2 — `fs.readFileSync` on every video (`upload-moments-videos.cjs:62`)
The uploader reads each `.mp4` fully into RAM, then hands the Buffer to `PutObjectCommand`. On a 50MB TikTok clip × CONCURRENCY=3 that's ~150MB resident. Fine for now, but the moment we wire this to a webhook/user-submission path the equivalent would OOM on the Cloudflare Worker. If a creator UI gets built, the upload path **must** stream (multipart upload or presigned PUT straight to R2 from the browser).

### P2 — Orphan risk: R2 PUT succeeds, Supabase PATCH fails
Lines 189-190 in `upload-moments-videos.cjs`:
```js
const size = await r2Upload(r2Key, filePath);        // R2 object now exists
const ok = await supabaseUpdateVideoKey(sourceId, r2Key);  // DB may fail
// ... just prints "DB_WARN" and moves on. R2 is stranded.
```
No compensation — the R2 object is never deleted. In a creator-facing flow this is a cost leak (pay for bytes nobody links to) and a privacy leak (video exists at a known-pattern URL but the row disappeared).

### P2 — `PATCH ...source_id=eq.X` writes to **every row with that source_id** (`upload-moments-videos.cjs:73`)
`voyo_moments` has `UNIQUE(source_platform, source_id)`, NOT `UNIQUE(source_id)` alone. Today that's irrelevant (TikTok IDs don't collide with Instagram IDs), but the PATCH filter only pins `source_id`, so if a future collision or manual import lands two rows with the same id across platforms, both get the same `r2_video_key`. Should be `source_id=eq.X&source_platform=eq.Y`.

### P3 — Credentials hard-coded in the CJS file (`upload-moments-videos.cjs:23-28`)
Supabase URL + anon key + R2 access key + R2 secret key are literals in the script. For a local-only Dash-runs-it script this is fine, but it's a different Supabase project (`anmgyxhnyhbyxzpjhxgx`) than the main VOYO stack (`mclbbkmpovnvcfmwsoqt`). Confirm this is intentional — today it writes to a project the rest of the app doesn't read.

### N/A — Progress feedback, cancellation, size validation, format validation
No UI exists, so none of these apply yet. When the creator tab is built, the worker check-path at `/r2/feed/:id/check` is ready (`worker/index.js:1056`) but there is **no POST/upload endpoint** on the worker; the upload must go via presigned URL or a new worker route.

---

## 2. MOMENT CREATION (`momentsService.createMoment`)

File: `src/services/momentsService.ts:136-180`

```ts
async createMoment(input: MomentInput): Promise<Moment | null> {
  // ... plain .insert() into voyo_moments with 15 fields, returns .single()
}
```

**Findings:**

### P1 — No `user_id` / `owner_id` on `voyo_moments`
Migration `003_moments_schema.sql:16-93` shows zero ownership columns. `creator_username` and `creator_name` are **free-text strings** set by the creator (originally the TikTok/IG handle). There is no `auth.uid()`-linked owner. Consequences:

- A creator cannot query "my moments" — the closest proxy is filtering by `creator_username = '...'`, which is **spoofable** (anyone could claim any handle).
- A creator cannot delete "my moment" — the only delete path is admin-side (`deactivateMoment`, soft delete).
- Stars/follows are coupled to `creator_username` (text), same spoofing surface.

This is the single biggest blocker to shipping a real creator side.

### P2 — `createMoment` never checks the `UNIQUE(source_platform, source_id)` constraint
The `.insert()` call will throw `duplicate key` on retry, but there's no `.upsert()` or `onConflict` handling. The catch silently returns `null`. For bulk discovery pipelines this masks "already exists" vs "actually errored" — both look the same to the caller. Recommendation: `.upsert({...}, { onConflict: 'source_platform,source_id' })` or surface the Postgres error code.

### P2 — No client-side validation
- `input.title` is required in the type but not checked (empty string passes, NULL violates the NOT NULL column).
- `duration_seconds` defaulted to 30 but not bounded (`CHECK (duration_seconds BETWEEN 1 AND 600)` absent at SQL level too — migration `003` has no range check).
- `vibe_tags` / `cultural_tags` arrays are accepted raw — no dedup, no lowercase normalization, no max-length cap.
- If a 10MB caption is posted, Postgres accepts it (TEXT is unbounded).

---

## 3. RLS STORY — WIDE OPEN (P0)

File: `supabase/migrations/003_moments_schema.sql:319-329`

```sql
ALTER TABLE voyo_moments ENABLE ROW LEVEL SECURITY;

-- Everyone can read moments
CREATE POLICY "Moments are viewable by everyone" ON voyo_moments FOR SELECT USING (true);

-- Backend can insert/update
CREATE POLICY "Backend can insert moments" ON voyo_moments FOR INSERT WITH CHECK (true);
CREATE POLICY "Backend can update moments" ON voyo_moments FOR UPDATE USING (true);
```

### P0 — `FOR INSERT WITH CHECK (true)` for every role
The policy name says "Backend can insert" but the `TO` clause is omitted, so it applies to `public` (anon + authenticated). **Any client with the anon key can INSERT arbitrary moments.** Combined with the lack of owner columns, there is zero server-side verification that an inserted moment corresponds to the caller.

### P0 — `FOR UPDATE USING (true)` for every role
**Any client can UPDATE any moment.** That means:
- Change `parent_track_id` on any moment to any string.
- Flip `featured=true` / `verified=true` on their own (or anyone's) moment.
- Edit the title/caption of any creator's moment.
- Delete (soft) any moment by setting `is_active=false` + `deactivated_reason='...'`.

This is the same "promiscuous UPDATE RLS" bug class as today's `voyo_signals` — the policy is "backend" in name only; `TO` is missing, so it grants anon full write. See `supabase/migrations/024_drop_voyo_signals_fk.sql` for precedent.

### P1 — `voyo_moment_tracks` INSERT policy is also `WITH CHECK (true)` for all roles (line 329)
No SELECT policy on `voyo_moment_tracks`, so reads are blocked by RLS — but inserts are wide-open. Any client can claim a moment → track link with any confidence.

### P1 — `voyo_stars` same pattern (`011_stars_system.sql:34-39`)
Both INSERT and SELECT are anonymous, no TO clause, no dedup (a single user can mash the star button and inflate `star_count` arbitrarily — no per-user-per-moment unique). The `voyo_follows` VIEW counts total rows, so any anon can run up a creator's follower count trivially.

---

## 4. REACTION COLLECTION ON MOMENTS — THE CORE PATTERN BUG (P0)

### P0 — `voyo_reactions` is a **counter column**, not a table
`voyo_moments.voyo_reactions INTEGER DEFAULT 0`. Increments happen via the read-modify-write pattern in TWO places:

`src/hooks/useMoments.ts:531-550` (`recordOye`):
```ts
const { data: current } = await supabase.from('voyo_moments')
  .select('voyo_reactions').eq('id', momentId).maybeSingle();
if (current) {
  await supabase.from('voyo_moments')
    .update({ voyo_reactions: (current.voyo_reactions || 0) + 1 })
    .eq('id', momentId);
}
```

`src/services/momentsService.ts:600-638` (`recordReaction`) — **identical pattern**, same race.

Problems:
1. **Lost updates under concurrency.** Two clients read 42, both write 43. Counter gains 1, not 2. For a viral moment where hundreds of users OYE within the same second, this silently under-counts.
2. **Two network roundtrips** per reaction (SELECT + UPDATE). Should be one RPC.
3. **Same skip/play pattern** in `momentsService.recordSkip` (`:560-597`) and `recordPlayFallback` (`:525-555`) — the whole counter surface has this race.

The fix is trivial: a SECURITY DEFINER function `increment_moment_reactions(p_moment_id uuid)` or raw `UPDATE voyo_moments SET voyo_reactions = voyo_reactions + 1 WHERE id=$1` (no SELECT-then-UPDATE). The `record_moment_play` RPC in migration `003:259-272` already does this correctly for plays/full-song-taps — the reactions path just never got converted.

### P0 — No realtime for moment reactions
Creators can NEVER see reactions on their own moment in real time. The `reactionStore` realtime channel (`src/store/reactionStore.ts:412-456`) subscribes to the `reactions` table — which is **track-scoped**, not moment-scoped. No postgres_changes listener anywhere watches `voyo_moments` for UPDATE events, and even if it did, the UPDATE fires for every skip/play/reaction so it would spam.

**Implication:** when the creator tab gets built, showing "live reactions on your moment" requires either:
- A new table `voyo_moment_reactions` (user_id, moment_id, type, created_at) with per-user uniqueness + a materialized counter, OR
- An aggregated per-minute rollup + scheduled poll.

The current `voyo_reactions INTEGER` column is a dead-end for real-time creator feedback. It's also literally impossible to tell the creator **who** reacted (there is no record of WHO, just the scalar count).

### P2 — `voyo_skips` counter uses the same racy pattern, but also: nobody reads it
`momentsService.recordSkip` (`:560-597`) increments `voyo_skips`; the BEFORE UPDATE trigger `update_moment_heat_score()` then subtracts `voyo_skips * 2` from heat. So the lost-update race **directly corrupts ranking** — the hotter a moment gets, the more its skip counter loses updates, the more inflated its heat_score gets. Self-amplifying.

---

## 5. TRIGGERS ON `voyo_moments` — SUBTLE INTERACTION WITH #4 (P1)

File: `003_moments_schema.sql:152-175`

```sql
CREATE OR REPLACE FUNCTION update_moment_heat_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.heat_score := (
    NEW.voyo_plays * 1 +
    NEW.voyo_full_song_taps * 10 +
    NEW.voyo_reactions * 5 -
    NEW.voyo_skips * 2
  );
  NEW.conversion_rate := CASE
    WHEN NEW.voyo_plays > 0 THEN (NEW.voyo_full_song_taps::DECIMAL / NEW.voyo_plays) * 100
    ELSE 0
  END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_moment_heat
  BEFORE UPDATE ON voyo_moments
  FOR EACH ROW
  EXECUTE FUNCTION update_moment_heat_score();
```

**Findings:**

### P1 — Function is NOT `SECURITY DEFINER`, NOT pinned to `public` schema
Unlike the `voyo_signals` trigger bug class called out in today's session, this one is already **SECURITY INVOKER** (default). Good — no privilege escalation. But the `search_path` is unset, so if anyone ever ALTERs the function to `SECURITY DEFINER`, the usual `public.` schema-shadowing attack applies. Recommend `SET search_path = public, pg_temp` on the function body now so the hardening is already there.

### P1 — Trigger fires on EVERY UPDATE, including `verified`/`featured`/`deactivated_reason` toggles
When admin flips `verified=true`, the trigger recomputes heat_score anyway. Harmless today (counters don't change, result is identical), but it also bumps `updated_at`, which the feed's `.order('discovered_at', { ascending: false })` doesn't care about — but any future "recently active" sort would get polluted by admin edits. Move to `BEFORE UPDATE OF voyo_plays, voyo_full_song_taps, voyo_reactions, voyo_skips`.

### P2 — heat_score formula is unbounded + integer-typed
`voyo_plays * 1 + voyo_full_song_taps * 10 + voyo_reactions * 5` on a moment that trends gets into the tens of millions fast. `heat_score INTEGER` (max ~2.1B) is fine for a long time, but the weighting is arbitrary magic numbers with no clamp / no decay. Not urgent — call out for a future rank-quality pass.

---

## 6. MOMENT → TRACK LINKAGE (P2)

`voyo_moments.parent_track_id TEXT REFERENCES video_intelligence(youtube_id) ON DELETE SET NULL`

**Findings:**

### P2 — FK references `video_intelligence.youtube_id`, not a stable internal id
`video_intelligence` is the raw YouTube-sourced table. Migration `013_artists_table.sql` introduced a separate artists concept. If the intelligence table ever gets renamed or partitioned (likely, given the audio-pipeline inventory's "playback state vs recommendation" refactor called out in `outputs/AUDIO-PIPELINE-INVENTORY.md:90`), this FK breaks. Not urgent — noting it for the rewrite.

### P2 — `ON DELETE SET NULL` silently unlinks moments from tracks
If `video_intelligence` row is pruned (bad track, quality issue), the moment stays alive but its `parent_track_id` goes NULL. The moment's `parent_track_title` and `parent_track_artist` are **denormalized snapshots** that stay populated — so the UI shows a song credit that no longer corresponds to any playable track. Either cascade delete the moment, or `ON DELETE RESTRICT` and force explicit curator cleanup.

### P2 — `link_moment_to_track` RPC is `SECURITY INVOKER` + RLS is `WITH CHECK (true)` on INSERT to `voyo_moment_tracks`
Combined with the wide-open UPDATE RLS on `voyo_moments`, any anon client can call the RPC and re-link any moment to any track. The `SELECT` inside the function only checks that the track exists in `video_intelligence` — it doesn't verify the caller owns the moment (no owner concept, see finding #2 P1).

---

## 7. MOMENT DELETION — SOFT-ONLY, R2 ORPHANED (P2)

`momentsService.deactivateMoment` (`:738-761`) sets `is_active=false` + `deactivated_reason`. It does NOT:
- Delete the R2 object at `r2_video_key`.
- Delete child rows in `voyo_moment_tracks`.
- Delete child rows in `voyo_stars` (which use `ON DELETE SET NULL` on `moment_id`, so stars just become orphan rows pointing to nothing).
- Unpublish from any downstream cache (the PWA's `localCache` only invalidates the single row; the hot-moments view still includes deactivated rows until reload).

No hard-delete path exists anywhere in `src/`. The CJS scripts don't call it either. Consequences:
- R2 cost creeps up forever (bucket grows monotonically). Recommend a weekly cron `DELETE FROM r2 WHERE key IN (SELECT r2_video_key FROM voyo_moments WHERE is_active=false AND updated_at < now() - interval '30 days')`.
- There's no GDPR story — a creator cannot request erasure.

---

## 8. CREATOR PROFILE DISPLAY — ABSENT

Searched `src/**` for anything that fetches "all moments by creator X." Only hit: `momentsService.getMomentsByVibe` / `getMomentsByContentType` / `getFeaturedMoments`. There is **no** `getMomentsByCreator(username)` call anywhere.

The consumer UI (`VoyoMoments.tsx:660-683`) renders a creator orb + `@creator` name, but tapping the orb does nothing. There is no "creator page" route. The star panel (`:946-985`) collects stars but has no "view this creator's other moments" link.

This is an empty feature slot — not a bug, but worth flagging for the audit record.

---

## 9. SHARE FLOW + DAHUB — MISLEADING NAME COLLISION (P3)

`src/services/oyoDJ.ts:846` exports a `shareMoment(type, content, trackId)` function. This is NOT related to creator moment uploads — it's the OYO DJ's **internal "DJ shared a thought to DAHUB"** pattern, storing to a `djProfile.social.sharedMoments` array in localStorage. It never touches `voyo_moments`.

The collision is confusing. If a real creator-share flow gets built, rename this to `shareDJThought` or move it under `oyoDJ/social.ts` to avoid a future dev grepping for "share moment" and finding the wrong thing.

DAHUB integration for VOYO is present (`src/lib/dahub/dahub-api.ts`, `src/components/voyo/PortraitVOYO.tsx:335-375`) but the DAHUB tab is a social/messaging surface, not a moment-share surface. No DB table cross-links creator moments into `dash_notes` or `dash_dm_messages`.

---

## 10. REALTIME SURFACE SUMMARY — WHAT THE CREATOR CAN SEE LIVE

| Event | Has realtime today? | Where | Note |
|-------|---------------------|-------|------|
| New OYE on my moment | NO | N/A | `voyo_reactions` is a counter, no postgres_changes sub |
| New star on my moment | NO | N/A | `voyo_stars` has no realtime subscription |
| New comment on my moment | NO | N/A | `voyo_moments.comment_count` is a mirrored scalar from source platform, no comments table |
| Moment featured/verified by admin | NO | N/A | no listener |
| Moment play count live | NO | N/A | counter, no pub |
| DM about my moment | YES (partial) | `hooks/useDashNotifications.ts:102` | DAHUB-level, not moment-tied |

**Conclusion:** zero of the creator's engagement signals are wired to realtime today. The `reactionStore` pattern is a pure analog on the **track** side. The moment side has zero equivalent.

---

## PRIORITY SUMMARY

| P | Finding | File |
|---|---------|------|
| **P0** | RLS on `voyo_moments` INSERT + UPDATE is `WITH CHECK (true)` / `USING (true)` with no TO clause — any anon can insert/mutate any moment | `003_moments_schema.sql:319-329` |
| **P0** | Reaction increments use racy SELECT-then-UPDATE — lost updates under concurrency, corrupts heat_score via skip counter | `useMoments.ts:531-550`, `momentsService.ts:600-638` |
| **P0** | Zero realtime on creator-side signals — no channel, no per-moment reaction table, counters only | `store/reactionStore.ts:412-456` (only listens to `reactions`, not moments) |
| **P1** | `voyo_moments` has no owner column — `creator_username` is spoofable free text, blocks real ownership / delete-mine / my-moments | `003_moments_schema.sql:27` |
| **P1** | `voyo_stars` has no per-user-per-moment uniqueness — follower counts trivially inflatable | `011_stars_system.sql:6-17` |
| **P1** | Heat-score trigger fires on every UPDATE (incl. admin metadata toggles) — move to `BEFORE UPDATE OF <counters>` | `003_moments_schema.sql:172-175` |
| **P2** | CJS uploader PUT-then-PATCH has no rollback — R2 orphans on DB failure | `scripts/upload-moments-videos.cjs:189-194` |
| **P2** | `deactivateMoment` soft-deletes without touching R2, `voyo_moment_tracks`, or `voyo_stars` — storage + row orphans | `momentsService.ts:738-761` |
| **P2** | `createMoment` has no client or server validation beyond NOT NULL — title/description/tags unbounded | `momentsService.ts:136-180` |
| **P2** | PATCH filter on the uploader is `source_id=eq.X` alone, bypassing the `UNIQUE(source_platform, source_id)` constraint | `scripts/upload-moments-videos.cjs:73` |
| **P2** | `link_moment_to_track` RPC has no caller-is-owner check (no owner concept exists) — any anon can relink any moment | `003_moments_schema.sql:275-314` |
| **P2** | `voyo_skips` lost updates directly inflate heat_score — racy counter coupled to ranking | `momentsService.ts:560-597` + trigger `003_moments_schema.sql:152-170` |
| **P3** | Upload credentials hard-coded (different Supabase project from main stack) | `scripts/upload-moments-videos.cjs:23-28` |
| **P3** | `oyoDJ.shareMoment` name collides with future creator-share — rename to `shareDJThought` | `services/oyoDJ.ts:846` |
| N/A | No upload UI exists. Progress/cancellation/size-validation questions deferred | `PortraitVOYO.tsx:333` ("CREATOR MODE — hidden until backend ready") |

---

## RECOMMENDED FIX ORDER (if a creator tab ships)

1. **Add `owner_id UUID REFERENCES auth.users(id)` to `voyo_moments`** (nullable for legacy Gemini-discovered rows). Backfill with a service-role account id.
2. **Rewrite RLS:**
   - `SELECT`: `USING (is_active = true)` for anon, `USING (true)` for authenticated owner.
   - `INSERT`: `TO authenticated WITH CHECK (owner_id = auth.uid())`.
   - `UPDATE`: `TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`. Separate policy for service_role for admin flags.
3. **Create `voyo_moment_reactions` table** (`moment_id`, `user_id`, `reaction_type`, `created_at`) with `UNIQUE(moment_id, user_id, reaction_type)`. Drop the `voyo_reactions INTEGER` column in favor of a view / materialized counter refreshed by trigger.
4. **Add `voyo_moment_reactions` to `supabase_realtime` publication** + update `reactionStore` to listen to both channels (track-scoped AND moment-scoped).
5. **Fix the racy counters** with an RPC: `CREATE FUNCTION increment_moment_counter(p_moment_id uuid, p_column text) LANGUAGE plpgsql` using `EXECUTE format('UPDATE voyo_moments SET %I = %I + 1 WHERE id = $1', col, col)`. Or just inline `.update({ voyo_skips: supabase.raw('voyo_skips + 1') })` per counter.
6. **Add server-side hard-delete path** + compensating R2 delete in a cron/edge function.
7. **Add `UNIQUE(moment_id, user_id)` to `voyo_stars`** (partial dedup without breaking the current rating semantics).

---

*End audit.*
