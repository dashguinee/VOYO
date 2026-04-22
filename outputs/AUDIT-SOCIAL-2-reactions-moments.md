# AUDIT-SOCIAL-2 — Reactions & Shared Moments

**Scope**: The `reactions` table write path (OYE commit, NowPlaying billboard, VoyoPortraitPlayer signals), the realtime subscription that fans reactions back to every client, shared-moments pipeline, and the combo-fire interaction between `app.oye()` (reactionStore) and `oyo.onOye()` (voyo_signals RPC). Audited after commit `9aa4e91` (SIGNAL_WEIGHTS.react fix).

**TL;DR**: The reactions pipeline is in worse shape than voyo_signals was. There's a **silent-400 bug that kills every single reaction write** (column doesn't exist), an **unreachable FK barrier** for anon users, a **dead-code shareMoment** that pretends to post to DAHUB but writes to localStorage only, and a **realtime channel that silently dies on TIMED_OUT** (same bug class we fixed in useHotSwap). The OYE flywheel also double-fires pool/RPC writes on every commit — currently recoverable because the writes themselves are broken, but will over-count 2-3× the moment the DB path is repaired.

---

## Reaction-Write Topology — What Actually Fires On ONE OYE Tap

```
                        USER TAPS OYE BUTTON
                        (OyeButton.tsx:256  handleClick)
                                 │
                                 ▼
                  app.oyeCommit(track, { escape })
                  services/oyo/app.ts:211
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  app.oye(track)          ds.boostTrack              pipService.enter
  services/oyo/app.ts:139    (R2 warmup)            (escape only)
        │
        ├──► onOye(track)                          [services/oyo/index.ts:160]
        │     ├─► djRecordPlay(track, true, false) [intelligentDJ — local]
        │     ├─► oyoPlan.onSignal('reaction')     [oyoPlan — local]
        │     ├─► recordPoolEngagement('react')    [personalization:815]
        │     │     └─► trackPoolStore.recordReaction(trackId)
        │     │           └─► centralSignals.love(trackId)         ─► INSERT voyo_signals (action='love')
        │     └─► recordRemoteSignal('react')
        │           └─► [10s batched] rpc record_signal           ─► INSERT voyo_signals (action='react')
        │
        └──► reactionStore.createReaction(...)      [reactionStore.ts:184]
              ├─► INSERT reactions (...)                           ❌ SILENT 400 — see P0-1
              ├─► trackPoolStore.recordReaction(trackId)           🚨 DUPLICATE — see P1-3
              │     └─► centralSignals.love(trackId)               ─► INSERT voyo_signals (action='love') AGAIN
              └─► oyoDJ.onTrackReaction(track)
```

Per ONE OYE tap, this pipeline attempts:
- **2× voyo_signals INSERT** with `action='love'` (via centralSignals.love, wired twice)
- **1× voyo_signals INSERT** with `action='react'` (via record_signal RPC)
- **1× reactions INSERT** (which currently 400s — see P0-1)

If/when the reactions INSERT is repaired, the AFTER-INSERT trigger on reactions will ALSO fire an UPDATE on track_stats, adding a 4th write for what the user experiences as a single tap.

---

## Findings

### P0-1 — `track_position` column does not exist; every reaction INSERT silently 400s

**Where**:
- `src/store/reactionStore.ts:248` — `track_position: trackPosition` inside the INSERT body
- `supabase/schema.sql:111-139` — reactions table definition does NOT have `track_position`
- No migration in `supabase/migrations/` adds it (grep verified: zero hits for `track_position` or `ALTER TABLE reactions ADD COLUMN`)

**Why it dies**: PostgREST returns `400 PGRST204 Could not find the 'track_position' column of 'reactions' in the schema cache` the instant the insert body contains that key. The store-side error branch (lines 251-256) only recognises 401/403 specially; 400 just hits `console.error` and `return false`. The UI caller (`VoyoPortraitPlayer:3618`, `NowPlaying:330`) awaits the promise but ignores the boolean return.

**User symptom**: OYE flashes on-screen, floating emoji renders, local pool score bumps, but nothing ever persists. Refresh the tab and your OYEs vanish. Hotspots compute only on local in-memory reactions — they never survive a session. **Every single reactions INSERT written from the app today is failing silently.**

**Cross-check**: `src/brain/BrainIntegration.ts:279` reads `latestOye?.track_position` — this code path has never executed against a persisted row in the history of the app.

**Fix**: Add migration `026_reactions_track_position.sql`:
```sql
ALTER TABLE reactions
  ADD COLUMN IF NOT EXISTS track_position INTEGER
  CHECK (track_position IS NULL OR (track_position >= 0 AND track_position <= 100));

-- Backfill NULL; hotspot code already tolerates undefined.
```

Then harden the store — promote 400 to the same non-logging path as 401/403, and make the caller surface failure to UX (a toast or silent retry), not just `return false`.

---

### P0-2 — `reactions.username` is a hard FK to `universes(username)`; anon users (v403 publishable-key flow) cannot write

**Where**:
- `supabase/schema.sql:115` — `username TEXT NOT NULL REFERENCES universes(username) ON DELETE CASCADE`
- `src/services/oyo/app.ts:158` — `username: opts.username ?? 'anonymous'`
- `src/components/classic/NowPlaying.tsx:331` — `username: dashId || 'anonymous'`
- `src/components/voyo/VoyoPortraitPlayer.tsx:3619` — same fallback

**Why it dies**: There's no `universes` row with `username = 'anonymous'`. Every OYE from a guest/first-run user hits `foreign_key_violation` (SQLCODE 23503) before even reaching the trigger. Same bug class as the voyo_signals FK → voyo_tracks frozen-rows bug that migration 024 just fixed. The RLS INSERT policy (`"Authenticated users can create reactions" WITH CHECK (true)`) lies about its name — it allows anon via publishable key — but the FK kills it anyway.

**Also**: no explicit `GRANT INSERT ON reactions TO anon` exists in the SQL tree. The `SELECT` grant comes from the `FOR SELECT USING (true)` policy only implicitly working because PostgREST routes through the role. With the new publishable-key auth model where `anon` is the default for unauth'd clients, INSERT grants are worth auditing explicitly.

**Fix (pick one)**:
1. **Drop the FK** (same move as migration 024): `ALTER TABLE reactions DROP CONSTRAINT reactions_username_fkey;` — cheapest, most aligned with the "DASH citizen hash can be anything" design.
2. Auto-create a `universes` row for every user_hash on boot (heavier; couples social-spine to playback).
3. Switch `username TEXT` to `user_hash TEXT` with no FK, matching the voyo_signals model that now works.

Option 1 + option 3 combined is the clean endpoint.

---

### P1-3 — Double-fire of `centralSignals.love` AND double-fire of `pool.recordReaction` per OYE tap

**Where**:
- `src/services/oyo/index.ts:163` — `onOye` calls `recordPoolEngagement(trackId, 'react')` → `trackPoolStore.recordReaction(trackId)` → `centralSignals.love()` (INSERT voyo_signals action=love)
- `src/store/reactionStore.ts:222, 267` — `createReaction` ALSO calls `useTrackPoolStore.getState().recordReaction(trackId)` → `centralSignals.love()` again

Both paths are triggered by `app.oyeCommit` (which calls `oye()` which calls BOTH `onOye()` AND `reactionStore.createReaction()`). Net: **2 rows in voyo_signals with action='love'** per user tap, both containing the same `created_at` within milliseconds, same user_hash, same track_id. The taste-graph scoring in `oyoDJ.hydrateFromSignals` (SIGNAL_WEIGHTS.love = 5) will then double-count every OYE, inflating favoriteArtists scores by 2× for anyone who ever tapped OYE.

Plus `record_signal('react')` fires separately — so a third row with action='react' (weight 4) adds another +4. Net per OYE tap post-hydrate = 5+5+4 = 14 weight, when the intent was +5 or +4 (pick one).

**Additionally**: `src/store/playerStore.ts:1688-1699` — `addReaction` (the LandscapeVOYO / VoyoPortraitPlayer floating-emoji path) ALSO fires its own `record_signal('love')` RPC AND its own `recordPoolEngagement('react')`. Users who tap the landscape OYO/OYE/FIRE buttons trigger **a fourth signal write path** distinct from the OyeButton path. A user who double-taps on landscape AND uses the global OYE button could plausibly generate 5-6 rows for one intent.

**Why this is hidden today**: Because P0-1 and P0-2 kill the `reactions` INSERT, nobody ever sees the visible "2× reactions table rows" symptom. The voyo_signals double-writes DO happen but get diluted in the larger stream.

**Fix**: Single source of truth. Remove `useTrackPoolStore.getState().recordReaction(trackId)` from BOTH branches of `reactionStore.createReaction` (lines 222 and 267). Let `onOye()` be the only path to pool/signals writes. `createReaction` should ONLY write the reaction row + update local state.

Also remove the stray `record_signal('love')` from `playerStore.addReaction:1694` — it's a parallel universe that predates the oyo/index.ts fanout centralization. Funnel everything through `oyo.onOye(track)` and kill the rest.

---

### P1-4 — Realtime channel dies on TIMED_OUT / CLOSED; no reconnect

**Where**: `src/store/reactionStore.ts:412-456`

```ts
const channel = supabase
  .channel('reactions-realtime')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' },
      (payload) => { /* update recentReactions */ })
  .subscribe();   // ← no status callback
```

No `(status) => { if (status === 'TIMED_OUT' || 'CLOSED' || 'CHANNEL_ERROR') ... }` handler, no exponential-backoff reconnect, no visibility-change re-wire. This is the exact anti-pattern we fixed in `useHotSwap.ts:351` after the Realtime memory note (see MEMORY.md → voyo-holy-grail). On any 20-minute idle / laptop sleep / bad wifi, the channel enters CLOSED and never comes back.

User symptom: you fire an OYE on your phone, it doesn't appear in other sessions' MixBoard pulse until manual refresh. Feels random — sometimes works, sometimes doesn't. This is why "other people's reactions" sometimes take 500ms+ (working channel) and sometimes never arrive (dead channel).

**Fix**: Mirror the useHotSwap reconnect pattern — capture subscribe status, on CLOSED/TIMED_OUT/CHANNEL_ERROR flip `isSubscribed=false`, schedule reconnect with jitter backoff (1s→2s→4s→8s→16s cap), and add a `visibilitychange` handler that force-reconnects when the tab comes back to foreground. Also: the `(window as any).__voyoReactionChannel` stash at line 455 is module-global — Vite HMR + multiple `subscribeToReactions` calls could leak channels. Replace with a ref held in the store itself.

---

### P1-5 — `shareMoment` is a stub: localStorage-only, ZERO DB writes, ZERO callers

**Where**: `src/services/oyoDJ.ts:846-868` (shareMoment), `:874` (getSharedMoments)

```ts
export function shareMoment(type, content, trackId?): SharedMoment {
  const moment: SharedMoment = { id: `moment-${Date.now()}`, ... };
  djProfile.social.sharedMoments.push(moment);   // in-memory
  saveProfile();                                  // localStorage
  devLog(`[OYO] Shared to DAHUB: "${content.slice(0, 50)}..."`);  // lies
  return moment;
}
```

- The devLog says "Shared to DAHUB" — no DAHUB write actually occurs.
- `grep -rn "shareMoment(" /home/dash/voyo-music/src/` returns zero call sites. The only reference is in `oyoDJ.ts` exporting itself from a default export.
- Same for `getSharedMoments` — zero non-self callers.
- Also no `shared_moments` or `oyo_shared_moments` table anywhere in `supabase/migrations/` or `schema.sql`.
- `voyo_moments` (migration 003) is for **video clips that promote tracks** — it is NOT the same thing as "sharedMoments" (DJ announcements / session summaries). They are conceptually unrelated and should stay that way. Current code doesn't confuse them because `shareMoment` never writes anywhere, but the naming is a landmine for future wiring.

**Fix options**:
1. **Delete it.** No callers = no product feature. Every minute spent maintaining `SharedMoment` / `DJSocial.sharedMoments` / the types is waste. Ship the cleanup PR.
2. If the product wants DJ→DAHUB sharing, wire it end-to-end: new table, RLS, realtime, actual call sites in the DJ announcement flow. But that's a feature decision, not a fix.

Recommendation: delete until someone files a "feature: DJ sharing to DAHUB" ticket.

---

### P2-6 — Reaction-type enum drift: DB allows 6 types, app uses 3

**Where**:
- `supabase/schema.sql:130-132` — CHECK `reaction_type IN ('oyo', 'oye', 'fire', 'chill', 'hype', 'love')`
- `src/store/reactionStore.ts:33` — `ReactionType = 'like' | 'oye' | 'fire'`

If any client code ever sends `reaction_type = 'like'`, the DB rejects it with 23514 (check violation). The TS type is narrower than the DB (good direction) but the literal string `'like'` is NOT in the DB enum — it would die. Currently all production callers pass `'oye'`, so no live harm, but:

- `updateCategoryPreference` at `reactionStore.ts:590-613` tracks a `likeCount` field. If anyone ever wires a "like" button, it'll break.
- `computeHotspots` at `:555` has `Record<ReactionType, number> = { like: 0, oye: 0, fire: 0 }` — the hotspot code expects 'like' as a real reaction type.

**Fix**: pick one reality. Either add `'like'` to the DB CHECK constraint, or drop it from `ReactionType` and `likeCount`. Align before the unused code gets wired.

---

### P2-7 — `reactionStore.createReaction` error in `catch { /* non-fatal */ }` swallows bugs

**Where**: `src/services/oyo/app.ts:155-168`

```ts
try {
  (reactionStore as any).createReaction?.({...});
} catch { /* non-fatal */ }
```

The call is fire-and-forget inside a try/catch that discards both synchronous throws AND the boolean return of the async `createReaction`. Combined with P0-1, this is why the column-not-found error never surfaces to the user, to telemetry, or to Sentry. Even the `console.error` inside `createReaction` is silent-in-production (and when it does log, `(reactionStore as any)` casts away the type info).

**Fix**: drop the `as any`, drop the optional-chaining, handle the boolean return, and promote failures to a telemetry event (`event_type: 'trace', subtype: 'reaction_write_failed'` with error.code in meta). Without telemetry, nobody notices these are failing.

---

### P3-8 — `trigger_update_moment_heat` + `update_track_stats` trigger are SECURITY INVOKER (implicit)

**Where**:
- `supabase/schema.sql:211-265` — `update_track_stats()` function, no `SECURITY DEFINER`
- `supabase/migrations/003_moments_schema.sql:152-175` — `update_moment_heat_score()`, no `SECURITY DEFINER`

These run as the calling role (anon for publishable-key flows). The policies on `track_stats` do include `FOR ALL USING (true) WITH CHECK (true)` so anon inserts/updates are allowed, but there's no explicit GRANT INSERT on track_stats to anon. In the same bug class as voyo_signals' three-way INSERT-policy tangle — worth an explicit audit with a real anon client to confirm the trigger-fired UPDATE actually lands.

**Fix**: either (a) promote `update_track_stats` to `SECURITY DEFINER OWNER TO postgres`, which is the standard Supabase pattern for aggregate-update triggers, or (b) add explicit `GRANT INSERT, UPDATE ON track_stats TO anon, authenticated;`. (a) is safer and matches what the voyo_signals fix landed.

---

### P3-9 — No offline queue for reactions

**Where**: `src/store/reactionStore.ts:196-234` — when `!isSupabaseConfigured || !supabase`, the local reaction is written but never queued for retry.

If the network drops mid-session, reactions are local-only forever. There's a batched `record_signal` flush (`services/oyo/index.ts:99-106`) that fires on `pagehide` for the RPC path, but no equivalent for the `reactions` table INSERT.

**Fix**: push failed/offline reactions to an IndexedDB outbox, retry on next online + pagehide. Or just trust the RPC-signal path (voyo_signals rows already write) and accept that the `reactions` table is BEST-effort — in which case document that and remove the user-visible comment UX that promises persistence.

---

### P3-10 — OYE button charge effect can race with rapid taps → multiple downloads queued

**Where**: `src/components/oye/OyeButton.tsx:256-267` + `src/services/oyo/app.ts:222` (boostTrack)

`oyeCommit` is idempotent on explicit-like (the preferenceStore short-circuits duplicates) and on `addToQueue` (playerStore de-dupes by trackId). **BUT `boostTrack` is only idempotent when the track is already `complete` in downloadStore.** If a user rapid-taps OYE within the <300ms window (before the first boost's `downloading` status propagates), you can queue 2-3 downloads simultaneously. Each one races for the same R2 slot.

**Fix**: downloadStore.boostTrack should early-return when status is `queued | downloading | complete`, not just `complete`. Minor in practice (400 Conflict gets eaten by r2Gate) but worth tightening.

---

## What's Actually OK

- `pulseCategory` LRU/timeout pattern at `:484-508` — clean.
- `computeHotspots` LRU at 200 tracks (`:573-583`) — prevents OOM. Good pattern.
- `SIGNAL_WEIGHTS` updated in commit 9aa4e91 — confirmed correct for what's emitted.
- `isCharging` latch choreography in OyeButton (`:226-267`) — well-designed, doesn't leak timers.
- `getUserHash` path in oyoDJ hydrateFromSignals — robust, 10s cooldown, retriable.

---

## Top Priority Summary (in build order)

1. **P0-1** (migration 026: add `track_position` column) — un-kills the entire reactions write path. One SQL line. Without this, NOTHING else in reactions works.
2. **P0-2** (migration 027: drop FK on `reactions.username`) — un-kills anon users. One SQL line.
3. **P1-3** (de-duplicate pool/signal writes) — prevents 2-3× inflation of taste graph once reactions DB path is live. TS-only change.
4. **P1-4** (Realtime reconnect) — restores MixBoard pulse for long sessions. TS-only change, mirror useHotSwap pattern.
5. **P1-5** (delete shareMoment stub or wire it) — reduces surface area / kills a fossil.
6. **P2-6, P2-7, P3-8, P3-9, P3-10** — follow-ups, none urgent.

The first three land in <50 LOC combined. Reactions are currently a Potemkin village — the button glows, the emoji floats, everything feels alive, but nothing persists. Fix P0-1 + P0-2 first, then the rest of the taste graph finally gets the OYE signal it's supposed to learn from.
