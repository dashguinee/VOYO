# VOYO Music — Profile + Friends + Auth Identity Audit

District: SOCIAL-3
Scope: user identity, profile state, friend graph, DASH Command Center auth
Files audited: `src/hooks/useAuth.ts`, `src/providers/AuthProvider.tsx`, `src/lib/voyo-api.ts`, `src/lib/dash-auth.tsx`, `src/utils/userHash.ts`, `src/store/universeStore.ts`, `src/components/profile/ProfilePage.tsx`, `src/components/universe/UniversePanel.tsx`, `src/lib/dahub/dahub-api.ts`, `src/services/centralDJ.ts`, `src/services/oyoDJ.ts`, `src/components/classic/StationHero.tsx`, `src/App.tsx`, `supabase/schema_v2.sql`

Date: 2026-04-22

---

## Executive Summary

The profile/auth subsystem is functionally working but structurally fragile. **Three identity systems coexist** (voyo-account anon hash, DASH citizen storage, deprecated universeStore username) with no reconciliation path. The claim that "DASH ID is THE identity" (useAuth.ts:1-14) is *false at the signals layer* — every `voyo_signals` row written by a logged-in user is stamped with an anonymous device hash because the `voyo-account` key `getUserHash()` is hunting for is **never written anywhere in the codebase**. RLS on `voyo_profiles` is wide open (`USING (true)`) so any anon client can edit any user's display name, bio, avatar, likes, now_playing, and portal state. Two concurrent SSO callback paths write conflicting storage formats. Logout clears one key and leaves ~10 personalised keys behind.

---

## P0 Findings

### P0-1. `getUserHash()` logged-in branch is dead code — all signals land under anon hash
**File**: `src/utils/userHash.ts:10-36`

```ts
const accountData = localStorage.getItem('voyo-account');  // ← never written
if (accountData) { ... return parsed.account.id; }
// falls through to voyo_user_hash every time
```

A repo-wide grep for `'voyo-account'` returns exactly one hit — the read in `userHash.ts:12`. **No write site exists.** DASH auth writes `dash_citizen_storage`, never `voyo-account`. Consequences:

- Every `voyo_signals` insert in `centralDJ.ts:371` uses an anon device hash, even after a user signs in with DASH ID.
- `hydrateFromSignals()` in `oyoDJ.ts:988` rebuilds taste from the same anon hash — so a user who clears localStorage, switches devices, or switches browsers loses their entire taste graph and it never re-links to their `voyo_profiles` row (keyed by `dash_id`).
- `StationHero.tsx:90,197` (station subscriptions) are also keyed on anon hash — a user's subscribed stations don't follow them to a new device.
- **The entire `voyo_profiles` ↔ `voyo_signals` contract is broken.** They share no join key for logged-in users.

**Fix**: In `dash-auth.tsx:92` (after successful sign-in) and `store/universeStore.ts:383` (dash callback) write `voyo-account` in the shape userHash expects, OR rewrite `getUserHash()` to prefer `getDashSession()?.user.core_id`. The latter is the correct fix — everything else is compensating for a missing abstraction.

**Bonus pain**: `userHash.ts` module-level `let cached` caches the anon hash forever per JS context. If you fix the DASH-ID path, you must also invalidate `cached` on sign-in / sign-out or the first call wins for the session.

---

### P0-2. `voyo_profiles` RLS is wide open — anyone can impersonate anyone
**File**: `supabase/schema_v2.sql:174-185`

```sql
CREATE POLICY "Allow all for now" ON voyo_profiles FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON voyo_messages FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON voyo_portal_messages FOR ALL USING (true);
CREATE POLICY "Allow all for now" ON voyo_playlists FOR ALL USING (true);
```

The schema file's own comment (line 180) says "In production, verify dash_id matches JWT claim" — that wiring was never done. Because:

- The public profile route `voyomusic.com/:dashId` (`ProfilePage.tsx:104`) is served with the anon key, so the anon role has full write.
- `updatePreferences`, `updateNowPlaying`, `setPortalOpen` (`voyo-api.ts:183-226`) issue raw `.update().eq('dash_id', dashId)` with zero server-side ownership check.

Attack surface with the shipped anon key:
- Rewrite any user's `preferences.display_name / bio / avatar_url / likes`.
- Flip any user's `portal_open` to true and stuff `now_playing` with arbitrary JSON.
- Send `voyo_messages` or `voyo_portal_messages` as any user — `from_id` is a client-supplied string, not a JWT claim.
- Delete any playlist. Create playlists owned by anyone.

Combined with the missing `friendships` RLS (see P1-2) this is a full social-takeover surface.

**Fix**: Move auth to a JWT-backed session (either real Supabase auth or a signed Command Center JWT) and gate policies on `(auth.jwt()->>'dash_id') = dash_id`. For read-side public profiles, add a narrower `SELECT` policy that projects only the columns meant to be public (currently `likes` and `history` leak listening behaviour to the whole internet).

---

### P0-3. Two SSO callback handlers write incompatible storage formats; wrong one wins
**Files**: `src/App.tsx:446-454`, `src/store/universeStore.ts:372-404`, `src/lib/dash-auth.tsx:392-445`

`App.tsx` only ever calls `useUniverseStore.getState().handleDashCallback()` — never `handleSSOCallback` from `dash-auth.tsx`. The two differ:

| Path | Storage format |
|---|---|
| `universeStore.handleDashCallback` (ACTIVE) | `localStorage.setItem(DASH_CITIZEN_KEY, JSON.stringify(citizen))` — **FLAT** `{coreId, fullName, ...}` |
| `dash-auth.signInWithDashId` (also active via PIN panel) | **NESTED** `{state: {citizen: {...}}, version: 0}` |
| `dash-auth.handleSSOCallback` (NEVER CALLED) | **NESTED** same as above |

`getDashSession()` (dash-auth.tsx:105-131) has dual-format read logic to paper over this, which works — but:

1. The `sso_token` flow (`handleSSOCallback` → `exchange_sso_token` RPC) is dead. Only the `dashAuth=base64` flow lives. If Command Center ever switches to token-only SSO, VOYO breaks silently.
2. The flat format drops several fields (`isActivated`, `role`, sometimes `countryCode`) that the nested format carries. Mixed-device users will see their `role` default to `'user'` after an SSO round-trip, even if Command Center issued them `admin`.
3. `dash-auth.tsx:17` hardcodes a fallback anon JWT (line 17). If the env var is set to a *different* anon key than the hardcoded fallback (production misconfig), silent key drift happens.

**Fix**: Delete `universeStore.handleDashCallback`. Wire `App.tsx` to `handleSSOCallback()` (the async version) so both SSO flows work and storage is consistent.

---

## P1 Findings

### P1-1. Friend graph is split across two table names in the same app
**Files**: `src/lib/voyo-api.ts:372`, `src/lib/dahub/dahub-api.ts:180,376,400`

- `voyo-api.friendsAPI.isFriend()` queries `.from('friends')`.
- `dahub-api.friendsAPI.sendFriendRequest/acceptFriendRequest` writes `.from('friendships')`.
- `dahub-api.ts:180` comment literally says: *"No friendships table exists — friends are people on same accounts"* — yet 200 lines later the same file writes to `friendships`.

So:
- DAHUB creates friend *requests* into `friendships` with status pending/accepted.
- VOYO checks `friends` (singular, different table) for acceptance state.
- Accepting a friend request in DAHUB does not make `isFriend()` true in VOYO.
- `addFriend` in VOYO (voyo-api.ts:321-342) delegates to an `add_friend` RPC whose target table is untested from this codebase.

**Additional asymmetry risk**: `acceptFriendRequest` (dahub-api.ts:394-410) upserts BOTH directions into `friendships`. But `sendFriendRequest` (dahub-api.ts:376) only writes A→B. If a user declines (no accept), the A→B pending row is orphaned with no TTL and no decline path. `ProfilePage.tsx:152-159` bails out entirely — clicking "Add Friend" opens Command Center in a new tab and does not wait for confirmation.

**Fix**: Pick one table. Document it. Add a `friend_requests` vs `friendships` split or single-table with status enum. Add decline/cancel paths. Make VOYO a read-only consumer of the canonical Command Center table.

---

### P1-2. `user_presence` RLS / ownership not verified from this repo
**File**: `src/lib/voyo-api.ts:391-406`, `src/lib/dahub/dahub-api.ts:347-360,613-646`

`updatePresence` calls an RPC `update_presence` with `p_core_id: dashId`. The client passes the dashId as a plain parameter — **no JWT claim check.** If the Command Center policy mirrors VOYO's `USING (true)` pattern, any anon client can set any user's presence + activity ("Listening to …") to arbitrary strings.

The code reads `user_presence` directly (`.from('user_presence').select(...)` in dahub-api.ts:347, voyo-api.ts:422 realtime) — so the read side is confirmed anon-readable.

Can't verify write policy without Command Center schema. Flagged for SOCIAL-1/2 to cross-check.

---

### P1-3. Profile create race — multi-tab, multi-device, and retry loops
**File**: `src/providers/AuthProvider.tsx:74-105`, `voyo-api.ts:129-143`

`get_or_create_profile(p_dash_id)` (schema_v2.sql:130-144) does `SELECT` → `INSERT` without any locking. Two tabs opening simultaneously after a fresh sign-in each run:

```
T1: SELECT (not found) → T2: SELECT (not found) → T1: INSERT (ok)
→ T2: INSERT (PK violation)
```

The function has no `ON CONFLICT` or explicit transaction. T2 returns a plpgsql exception, which surfaces to the client as a 500. `AuthProvider.loadOrCreateProfile` (line 100-103) catches and logs but leaves `profile = null` — every subsequent call bangs on the function. No retry backoff, no cooldown like `oyoDJ.ts:979-983` uses.

**Secondary race**: On sign-in, AuthProvider fires three concurrent writes within ~30s — `getOrCreate` (line 78), `updatePresence` (line 127), `updateNowPlaying` (line 345). If `getOrCreate` is still running when presence/now-playing fire, they update a row that may not exist yet (those use `.update().eq()` with no upsert, so they silently succeed-with-zero-rows; not fatal but the updates are lost).

**Fix**: `INSERT ... ON CONFLICT (dash_id) DO NOTHING RETURNING *`. Add a 5s client-side cooldown on failed profile loads. Queue presence updates until `getOrCreate` resolves.

---

### P1-4. Logout leaves ~10 personalised keys on disk; next user inherits them
**File**: `src/lib/dash-auth.tsx:136-143`, `src/hooks/useAuth.ts:85-90`

`signOutDash()` removes exactly `dash_citizen_storage`. Nothing else. After logout these remain:

- `voyo-user-name` (LOCAL_NAME_KEY — shows previous user's name as greeting)
- `voyo_user_hash` (signals stay linked to previous anon hash)
- `voyo-preferences` (entire trackPreferences map)
- `voyo-player-state`, `voyo-volume`, `voyo-boost-profile`, `voyo-voyex-spatial`, `voyo-oye-behavior`, `voyo-oye-prewarm`
- `voyo-oyo-profile` (oyoDJ hydrated taste)
- `voyo-downloads` (boosted tracks)
- `voyo-manual-boost-count`, `voyo-auto-boost`, `voyo-auto-boost-dismissed`
- `voyo-last-insight-mood`, `voyo-push-prompted`, `voyo-pwa-installed-at`, `voyo-greeting-shown-*`

If user B signs in on user A's device after A logs out, B sees A's greeting name, A's preferences, A's downloads, A's push-prompt state. If B never explicitly updates display name, the UI greets B with A's name indefinitely because `resolvedDisplayName = citizen?.fullName || localName` (`useAuth.ts:98`) and localName is A's.

`universeStore.logout()` (line 346-358) *does* clear `dash_citizen_storage` too, plus `voyo-session`, `voyo-username`. But it's not called from anywhere in the real logout flow — only from the deprecated `UniverseStore`.

**Fix**: Enumerate all `voyo-*` keys and clear them in `signOutDash()`. Or better — scope user-bound state under a key namespaced by `dashId` (`voyo:{dashId}:preferences`) so multi-user devices just work.

---

### P1-5. No username uniqueness enforcement; display names are free-text
**File**: `supabase/schema_v2.sql:24-58`, `voyo-api.ts:183-192`

`voyo_profiles.dash_id` is the PK (unique by DASH auth) but `preferences.display_name` and `preferences.avatar_url` are JSONB blobs with zero validation:
- No length cap
- No character restrictions (XSS vector → ProfilePage.tsx:315 renders `{displayName}` in JSX which React escapes, OK, but any consumer that injects via `innerHTML` or a push notification body gets exploited)
- No collision / uniqueness — ten users can all set `display_name = "Dash"` and the `search()` function (voyo-api.ts:168-178) returns them by `dash_id` ILIKE — so search-by-name doesn't exist, making username squatting a non-problem for now but also making the search feature useless beyond DASH ID prefix matching.

Related: `profileAPI.search` uses `.ilike('dash_id', '%query%')` — that full-wildcard LIKE forces a seq scan on every search. Fine at 1k profiles, a problem at 100k.

**Fix**: (a) cap display_name to 32 chars server-side via CHECK constraint, (b) sanitise on write, (c) if you want name-search, extract to a `display_name` column + trigram index.

---

### P1-6. `universeStore` still pulls `isPortalOpen` / `syncToCloud` from 4 live sites — not just "back-compat skim"
**Files**: `src/store/playerStore.ts:582-586,667-669,723-726,1331-1332,1447-1448`, `src/store/preferenceStore.ts:326-329`, `src/App.tsx:447`

Despite the header calling it deprecated, `universeStore` is:
- Invoked on every track-end (playerStore:582) to toggle portal now-playing.
- Invoked on every preference change (preferenceStore:326) to sync to cloud.
- The sole SSO callback path (App.tsx:447).

The new `voyo_profiles` path is supposed to duplicate portal + sync (`AuthProvider.tsx:333-361`). Result: **every track change fires two sets of writes** — one from universeStore → `universes` table (old), one from AuthProvider → `voyo_profiles.now_playing` (new). If the old `universes` table no longer exists (schema_v2 comment line 14 suggests it's been dropped) those writes silently 404, wasting bandwidth and polluting logs.

Data shape mismatch: universeStore's `NowPlaying` (from `lib/supabase`) has different field names than `voyo-api.NowPlaying` (`coverUrl` vs `thumbnail`, `trackId` normalisation differs). A user viewing an old portal vs new will see inconsistent data.

**Fix**: Either (a) complete the migration — delete universeStore, move `handleDashCallback` into AuthProvider, remove all playerStore/preferenceStore imports — or (b) commit to dual-write with explicit shape adapters. Current half-state is worst of both.

---

### P1-7. Stale-closure bug in AuthProvider presence interval
**File**: `src/providers/AuthProvider.tsx:110-141,284-304`

`updatePresence` is a `useCallback([dashId])`. The presence interval (line 297) is set up in an effect keyed on `[isLoggedIn, updatePresence]`. When a user logs out, dashId flips to null, `updatePresence` re-memoises, effect re-runs, interval is cleared and recreated. Race window: the final `updatePresence()` call that fires right before the cleanup runs `if (!dashId) return` on the *new* null value, so no "offline" presence write ever happens on logout. Friends see the user stuck at "online" with their last activity until the 30s natural expiry (assuming Command Center has one — unverified).

Compounding: logout calls `signOut()` from `useAuth.ts:85` which calls `signOutDash()` which removes storage, fires the storage event, AuthProvider re-reads session as null — all synchronous. The in-flight `updatePresence` that was about to post "listening to X" may still land *after* the session is cleared, leaving a stale activity row with no owner.

**Fix**: On logout, explicitly fire `friendsAPI.updatePresence(dashId, 'offline')` BEFORE clearing session.

---

### P1-8. `voyo_portal_messages` has no auto-delete despite the schema comment
**File**: `supabase/schema_v2.sql:104-105`

> -- Auto-delete old portal messages (older than 24h)
> -- Run via cron or Supabase scheduled function

Never implemented. Portal chat is append-only, unbounded, with anon-writable RLS. Every portal message ever sent is still in the table. Abuse vector: anyone with the anon key can INSERT arbitrary rows with any `host_id` + `sender_id` at ~10k rows/sec.

**Fix**: pg_cron job `DELETE FROM voyo_portal_messages WHERE created_at < NOW() - INTERVAL '24 hours'` + rate limit via trigger.

---

## P2 / Nits

- **Hardcoded anon key in source** (`dash-auth.tsx:17`): acceptable fallback but if the key ever rotates, an out-of-date bundle keeps working against the Command Center indefinitely, making revocation ineffective. Remove the fallback and hard-fail on missing env.
- **`useAuth.ts:77` emits a fake `StorageEvent` via constructor** — works in modern browsers, no-ops in very old Safari. Use a `CustomEvent` like `NAME_CHANGE_EVENT` does (line 34).
- **`getAuthState()` (useAuth.ts:139)** splits `full_name` on whitespace for initials (line 153-155). Single-name users ("Dash") get a one-letter initial — fine. Empty `full_name` returns `null` initials but `isLoggedIn: true`. `DashAuthBadge` depends on fullName charAt indirectly — would crash on a citizen whose fullName is blank. Unlikely but not impossible.
- **`ProfilePage.tsx:157` opens Command Center in a new tab** with `_blank` and never re-polls. The "Follows" state is stale until a full refresh. Either use `postMessage` from Command Center or subscribe to `friendships` realtime.
- **`formatVoyoId` (voyo-api.ts:826)** blindly prepends `V` — does no validation that the input isn't already prefixed, so `formatVoyoId('V0046AAD')` returns `"VV0046AAD"`. Minor but easy to footgun.
- **`preferenceStore` → `universeStore.syncToCloud` debounce is missing** from preferenceStore.ts:326 (it fires immediately), unlike `AuthProvider.tsx:319` which has a 5s debounce. Racing each other — whichever lands last wins.

---

## Quick-Win Ranking (merge order)

1. **Fix getUserHash** to read DASH session first. One-line change + cached invalidation. Unlocks taste graph for logged-in users. → P0-1
2. **INSERT … ON CONFLICT** in `get_or_create_profile`. Three-character SQL change, eliminates the profile-create race. → P1-3
3. **Offline presence on logout** — one line in `signOut()` before clearing storage. → P1-7
4. **Clear all voyo-* keys on logout**. → P1-4
5. **Lock down voyo_profiles RLS** with JWT ownership check. Requires coordinating with Command Center JWT emission. → P0-2
6. **Delete `universeStore.handleDashCallback` and one of `friends` / `friendships`**. Schema cleanup. → P0-3, P1-1

---

## Key File:Line Index

- Identity hash bug: `src/utils/userHash.ts:10-36`
- Missing writer: `src/lib/dash-auth.tsx:92, 370, 416` (all write `dash_citizen_storage`, none write `voyo-account`)
- Signals key: `src/services/centralDJ.ts:371-380`
- Station subs key: `src/components/classic/StationHero.tsx:90,197`
- Hydrate key: `src/services/oyoDJ.ts:988-998`
- RLS open: `supabase/schema_v2.sql:182-185`
- Dual SSO: `src/App.tsx:446-454` vs `src/lib/dash-auth.tsx:392-445`
- Storage format clash: `src/store/universeStore.ts:383` (flat) vs `src/lib/dash-auth.tsx:78-92` (nested)
- Friend table split: `src/lib/voyo-api.ts:372` (`friends`) vs `src/lib/dahub/dahub-api.ts:376,400` (`friendships`)
- Profile create race: `src/providers/AuthProvider.tsx:74-105`, `supabase/schema_v2.sql:130-144`
- Logout leak: `src/lib/dash-auth.tsx:136-143`
- Universe still live: `src/store/playerStore.ts:582,667,723,1331,1447`, `src/store/preferenceStore.ts:326`
- Presence stale-close: `src/providers/AuthProvider.tsx:110-141,284-304`
- Portal-message unbounded: `supabase/schema_v2.sql:93-105`
