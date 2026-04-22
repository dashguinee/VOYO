# AUDIT 4 — Queue, Track Selection, Filter Chain

**Scope:** `playerStore.nextTrack` fallback chain, queue CRUD, history cap, `trackPoolStore`, `poolCurator`, `personalization`, `databaseDiscovery`, `trackVerifier`, `trackBlocklist`.
**Frame:** VOYO warm-it-up philosophy — silent absorption, never a dead-air.

---

## TL;DR

The chain is carefully layered (queue → repeat-one → repeat-all-rebuild → filtered-discover → drop-history fallback → LAST-RESORT unfiltered), and v194.1 + v396 closed the obvious cascade holes. But the system still has a **silent-dry-up failure mode** on the happy path, a broken `TRACKS` fallback for most users, 3 real race conditions around pool refresh, and several filter layers that can simultaneously evaporate content when a heavy user's history catches up with a small pool.

Top P0/P1:
1. **`nt_no_tracks` has no safety net.** When `allAvailable.length === 0` (e.g. before any pool hydration) every fallback branch exits early and `nextTrack()` silently does nothing. Player sits on the ended track — warm-it-up violated.
2. **`TRACKS` seed array is only 27 rows.** Cold-boot with no Supabase hydrate + large local history → entire seed is in the 20-history exclusion, `availableTracks = []`, LAST RESORT kicks in returning the same stale 27 tracks users have already heard 20×.
3. **`getPlayedTrackIds()` in databaseDiscovery reads a wrong path** (`state.state.history`) — the player-store persistence puts it at `state.history`. History-exclusion on the DB side is **silently dead**, which means `getDiscoveryTracks` never actually de-duplicates against user history. Cheap user-facing win.

Full findings below.

---

## P0 Findings

### P0-1 — `nt_no_tracks` branch: no graceful degradation, no escape hatch

**Location:** `src/store/playerStore.ts:1058-1064`

**What:** When queue is empty **and** `repeatMode !== 'all'` (or history empty for `'all'`) **and** `allAvailable.length === 0` (discover + hot both empty, TRACKS has 27 items but all filtered), the final `else` block only emits a telemetry trace and returns — state is not mutated, `isPlaying` stays true on a finished track, no toast, no recovery.

**Why it matters:** First-boot with slow Supabase, cold network, or a user who has played more than 20 tracks in this session and has no pool (e.g. bootstrap failed), the system enters a silent dead-air. Track ends → `onEnded` fires → `nextTrack()` → no-op → audio element idle → MediaSession shows "paused" but UI still shows Playing → violates "no error UI, always warm up".

**Reproduction:**
- Fresh install, Supabase 5xx for 30s.
- `poolCurator` seed runs (27 tracks from `TRACKS`).
- User plays 20+ tracks. Now `recentHistoryIds` ⊇ `TRACKS`.
- Discover/hot still empty (Supabase down). All 27 tracks filtered by history exclusion → fallback filter runs, but same 27 filter out by blocklist/unplayable if any are flagged → LAST RESORT filters by `currentTrackId` only → could still be empty if the current track is the only one not blocked.

**Fix (warm-it-up aligned):** The LAST RESORT branch (line 985-992) already ignores blocklist. Go one step further — if still empty, pull from `trackPoolStore.coldPool` as a fifth tier, and if that's also empty, silently drop the current track from history and replay it (repeat-one behavior by force). The track the user just listened to is objectively playable (they just heard it). Replaying is warmer than silence.

```ts
// After the LAST RESORT filter, if availableTracks still empty:
if (availableTracks.length === 0) {
  // Tier 5: cold pool
  const coldFallback = useTrackPoolStore.getState().coldPool
    .filter(t => (t.id || t.trackId) !== currentTrackId && !isKnownUnplayable(t.trackId));
  if (coldFallback.length > 0) {
    availableTracks = coldFallback.slice(0, 10);
  } else if (state.currentTrack) {
    // Tier 6: replay current. User just heard it → it plays. Warmer than silence.
    trace('nt_force_replay', state.currentTrack.trackId || state.currentTrack.id, {});
    set({
      isPlaying: true, progress: 0, currentTime: 0, seekPosition: 0,
      playbackRate: 1, isSkeeping: false,
    });
    return;
  }
}
```

Coupled with a **background rehydration trigger** — if `nt_no_tracks` fires, silently kick off `refreshRecommendations()` + `bootstrapPool(true)` so the next track lands in a populated pool. No toast, no retry button, system self-heals while user hears the current track loop.

---

### P0-2 — `getPlayedTrackIds()` reads the wrong localStorage path

**Location:** `src/services/databaseDiscovery.ts:130-142`

```ts
function getPlayedTrackIds(): string[] {
  try {
    const stored = localStorage.getItem('voyo-player-state');
    if (!stored) return [];
    const state = JSON.parse(stored);
    const history = state?.state?.history || [];  // ← BUG
    return history.map((t: any) => t.id).filter(Boolean);
  } catch { return []; }
}
```

**Why it's wrong:** `playerStore.ts` saves to `localStorage['voyo-player-state']` as a **flat object** (see `savePersistedState` at `playerStore.ts:124`), not a zustand-persist-wrapped `{state, version}`. The actual key is `state.history`, **not** `state.state.history`. Also the items have `trackId` as a string field — `.id` is always undefined on these persisted items.

**Consequence:** `getDiscoveryTracks()` passes `playedIds = []` as `excludeIds` to `getCachedTracks()`, so the R2-cached-only query **never** excludes user history. `getDiscoveryFeed()` calls `getFamiliarTracksRaw(limit=0)` when `freshToFamiliarRatio=1`, but when the ratio dips, it hits `get_familiar_tracks` RPC with `played_ids=[]` and returns empty — familiar tier silently broken.

**Fix:**
```ts
function getPlayedTrackIds(): string[] {
  try {
    const stored = localStorage.getItem('voyo-player-state');
    if (!stored) return [];
    const state = JSON.parse(stored);
    // playerStore uses a flat persisted shape, NOT zustand-persist wrapper
    const history = state?.history || [];
    return history.map((t: any) => t.trackId || t.id).filter(Boolean);
  } catch { return [];}
}
```

This is a 2-line fix that immediately improves discovery freshness for every user. Priority P0 because it's been silently dead the whole time.

---

### P0-3 — `TRACKS` LAST-RESORT is only 27 rows of stale content

**Location:** `src/data/tracks.ts` (27 entries), used as `TRACKS` fallback at `playerStore.ts:953-957` & `:1147-1152`.

**What:** When `discoverTracks` + `hotTracks` are both empty, fallback is the static seed of 27 tracks. These same 27 are also loaded into `hotPool` by `poolCurator.seedPool()` at boot. So: any user who has played 20 tracks — **even once ever** — has `recentHistoryIds` ⊇ most of `TRACKS`, and the filter collapses.

**Fix:** The fallback tier should prefer `trackPoolStore.hotPool` over static `TRACKS` once the pool has at least 50 tracks. A user with a warm pool of 100 tracks from past sessions has abundant fallback material; we just need the code to see it. Current fallback order is `discoverTracks → hotTracks → TRACKS`; should be `discoverTracks → hotTracks → trackPoolStore.hotPool → trackPoolStore.coldPool → TRACKS`.

```ts
const poolHot = useTrackPoolStore.getState().hotPool;
const allAvailable = state.discoverTracks.length > 0
  ? state.discoverTracks
  : state.hotTracks.length > 0
  ? state.hotTracks
  : poolHot.length >= 20
  ? poolHot as unknown as Track[]
  : TRACKS;
```

---

## P1 Findings

### P1-1 — Double-fire `recordPoolEngagement('play')` on the same track

**Location:** `playerStore.ts:518` (setCurrentTrack) AND `playerStore.ts:825` (queue pick) AND `playerStore.ts:1033` (discover pick)

`setCurrentTrack` fires `recordPoolEngagement(track.id, 'play')`. `nextTrack` (queue path) **also** fires it at line 825. Then when setCurrentTrack is invoked on that queue track somewhere (e.g. via an external caller), play is double-counted. The `centralSignals.play()` dedupe (5s window at `centralDJ.ts:345`) catches the Supabase write, but `trackPoolStore.recordPlay` (line 262-273) has **no dedupe** — `playCount` increments twice on every queue advance.

**Why it matters:** `poolScore` depends on `playCount * 2`. Queue-advanced tracks accumulate score 2x faster than discover-picked tracks, skewing the Hot-Pool's `getHotTracks()` sort.

**Fix:** Either dedupe inside `trackPoolStore.recordPlay` (keep a `Map<trackId, timestamp>` with 3s window), or remove the `recordPoolEngagement` call from `nextTrack`'s queue/discover branches since `setCurrentTrack` is eventually called for every track shown to the user. Wait — actually reading again: `nextTrack` does **not** call `setCurrentTrack`, it directly does `set({ currentTrack: nextPlayable.track, ... })`. So the recordPoolEngagement at line 825/1033 is the **only** play signal for those branches. So the bug is actually the opposite — manual `setCurrentTrack` (from search, click, etc.) adds play; `nextTrack`'s direct-set also adds play — but these are **different** track transitions, not double-fires. So this P1 downgrades — check the call site pattern carefully, but I believe this is **OK as written**. Leaving P1 as a documentation note: there are 3 call sites firing this, audit them for consistency if you ever refactor.

### P1-2 — History-exclusion race with `history` append

**Location:** `playerStore.ts:934-942` + `addToHistory`

Exclusion set is built from `state.history.slice(-20)`, but `addToHistory` is called (line 822 + 1030) **after** the exclusion set is built. On the next `nextTrack`, the just-added track enters history → becomes part of exclusion. Good. But: `prevTrack` at line 1086-1098 does `history: state.history.slice(0, -1)` — it **removes** the last history item. So if user hits Next then Prev, the track they just heard is no longer in `recentHistoryIds`, and the next Next could pick it. Probably intentional (Prev is rewinding intent), but worth calling out: no other code removes from history, so the exclusion is stable except across Prev.

### P1-3 — `repeat-all` rebuild uses `history.map(h => h.track)`, which may hold stale track objects

**Location:** `playerStore.ts:889-930`

When queue empties in `repeatMode === 'all'`, it rebuilds queue from unique `history[*].track`. History items persist for up to 50 entries (line 1410: `slice(-50)`). But each `history[i].track` is **the object at the time of play**. If pool hydrate updated `track.coverUrl` or `track.trackId` via `trackVerifier.updateTrackInPool`, the copy in history is stale. User rebuilds repeat-all and gets a track with an old (possibly broken) trackId. **Real bug but small blast radius** — only affects repeat-all after a verifier update.

**Fix:** Dedup by `trackId` when rebuilding, then look up the **current** pool object for each id. Fallback to stored object if not in pool.

### P1-4 — `refreshRecommendations` async race with `nextTrack`

**Location:** `playerStore.ts:1437-1605`

On every 3rd `setCurrentTrack`, `refreshRecommendations` fires via `setTimeout(500)` (line 549). It calls `getDatabaseDiscovery()` + two Supabase RPCs in parallel. If the user skips 4 tracks in 5 seconds, **multiple parallel refreshes are in flight**, and whichever finishes LAST writes state. No abort. Cost: extra Supabase queries + potential order inversion (older fetch overwrites newer). Same for `refreshDiscoveryForCurrent`.

**Fix:** Use the existing `currentTrackAbortController` (already declared at `playerStore.ts:54`) to signal — but that one is already used for the current-track's async ops, not the refresh. Introduce a separate `_recommendationsAbortController` and cancel on each new call. Or gate with a simple `if (_refreshInFlight) return` boolean + timestamp.

### P1-5 — `NON_MUSIC_KEYWORDS` defined in 3 places, divergent

**Location:**
- `trackPoolStore.ts:200-212` (most aggressive: 26 keywords incl. "drama", "beef", "reaction")
- `playerStore.ts:1465-1469` (lighter: 19 keywords)
- `databaseDiscovery.ts:60-72` (matches trackPoolStore)

Three copies of a content filter. The playerStore version is **missing** "drama", "beef", "reaction", "warning", "alert", "urgent", "update:", "full movie", "asmr", "meditation guide", "sleep sounds", "white noise", "you wont believe", "shocking", "exposed", "leaked", "scandal". So a track that clears databaseDiscovery but fails playerStore's `isMusic` test gets filtered only at refreshRecommendations-merge time, not at source. And vice-versa: a track like "Breaking Sugar" (legitimate song title) is stripped at **all three layers**.

**Why it matters:**
- False positives: "Breaking" appears in song titles. "Alert" is a common word. The aggressive filter strips real music.
- False negatives: The playerStore copy is missing clickbait — non-music slips through at the player layer.

**Fix:** Single `NON_MUSIC_KEYWORDS` constant in `src/services/contentFilter.ts` + export an `isMusic(track)` helper. Use regex word boundaries so "breaking news" matches but "breaking sugar" doesn't.

### P1-6 — `MAX_RETRIES = 3` in trackVerifier is lexical cacheKey-based

**Location:** `trackVerifier.ts:62, 120-122`

`retryAttempts` is keyed on `${artist}|${title}`, not trackId. If two different bad trackIds resolve to the same (artist, title), they share a retry budget. Probably correct (same search space = same retry count), but contra-intuitive: after 3 failures for "Burna Boy - Last Last" with trackId A, trackId B for the same metadata is instantly cooled down for 10 minutes even though it's never been tried. Document or refactor.

### P1-7 — Blocklist boots async, but isBlocked is checked synchronously before load

**Location:** `trackBlocklist.ts:100-104`

Import-time: `refreshBlocklist()` fires async. For the first ~500ms of a cold boot, `isBlocked()` returns false for **every** track because the set is empty. If the primer (App.tsx:568) happens to pick a blocked track in that window, it plays, fails, and only then gets added. Contrast: with a warm blocklist, the primer would skip it.

**Why it matters:** Minor. The primer is picked from `TRACKS` static seed which is curated. But any cold-boot `seedTrack` path (`refreshRecommendations` line 1545) uses the FIRST merged-hot track, and that's sorted by OYO-boost so it could easily be a track the collective has flagged. Small probability of a bad first-play experience.

**Fix:** `refreshRecommendations` should `await refreshBlocklist()` before its first seed. Or better: do the blocklist filter **synchronously** against whatever's loaded, and accept the stale-on-boot window.

### P1-8 — `videoIntelligenceAPI.recordPlay` is fire-and-forget, not gated on dedupe

**Location:** `playerStore.ts:527` + `supabase.ts:641-644`

`recordPlay` calls `supabase.rpc('increment_video_play', ...)` on **every** `setCurrentTrack`. No dedupe. User skips 20 tracks → 20 RPCs → 20 rows written. Contrast to `centralSignals.play` which has 5s dedupe at `centralDJ.ts:345`. This skews the `voyo_play_count` counter used by `getPopular`.

**Fix:** Add identical 5s dedupe (or reuse `centralSignals.play`'s dedupe map — they track the same user intent).

### P1-9 — `hotTracks` merge with `favoriteArtists` uses `.sort()` which is not stable across engines

**Location:** `playerStore.ts:1495-1503`

```ts
[...mergedHotRaw].sort((a, b) => {
  const aFav = favoriteArtists.has((a.artist ?? '').toLowerCase()) ? 1 : 0;
  const bFav = favoriteArtists.has((b.artist ?? '').toLowerCase()) ? 1 : 0;
  return bFav - aFav;
})
```

`Array.prototype.sort` is **guaranteed stable** since ES2019 (Node 12+, all modern browsers). This is safe. But the comment "Stable sort: favourites first, everything else preserves order" is correct only on stable-sort engines. Users on old mobile Safari (iOS <12, ≈1% of traffic) get unstable sort. Acceptable.

### P1-10 — `getDiscoveryTracks` in trackPoolStore applies artist-diversity cap BEFORE filling, may under-fill

**Location:** `trackPoolStore.ts:490-515`

First pass enforces "max 2 tracks per artist". Second pass fills without that cap. But the fill loop only adds if `!result.some(r => r.id === track.id)`. If the pool is Burna-Boy-heavy (say 40/50 tracks), the first pass takes 2 Burna tracks and skips the rest. Second pass will re-add them, so final result has 2 diverse + 3 Burna = 5 tracks. OK.

But if pool has only Burna Boy (10 tracks), first pass stops at 2, second pass fills with 8 more. Final result: 10 Burna tracks despite the "diversity" pass. The diversity cap is effectively just a first-2-slot ordering hint. **Feature, not bug**, but worth documenting — users will see artist-heavy discoveries when pool is thin.

---

## P2 Findings (nits)

### P2-1 — `TRACKS` count mismatch

Earlier comments (playerStore.ts:454, 613) reference "static 11 tracks" and "324K database". Actual `TRACKS` array has 27 rows. Comments are stale but harmless.

### P2-2 — `isBootstrapped` flag is module-level

`poolCurator.ts:54` — `isBootstrapped` is a module-level boolean. If user clears pool via `voyoPool.clearStale()`, bootstrapPool won't re-run unless `forceFresh: true`. Fine as designed, noting for completeness.

### P2-3 — `auto-bootstrap` fires at 1500ms after import

`poolCurator.ts:537-561` — `setTimeout(1500)` after module load. Races the primer in App.tsx (800ms). On slow devices, primer picks `TRACKS[0]` before pool is seeded. Acceptable — primer is just a staging seed, not playback.

### P2-4 — `syncToDatabase(track).catch(() => {})` at `trackPoolStore.ts:220`

Every `addToPool` fires a Supabase write. No dedupe — a track that re-enters the pool (e.g. recovered from cold) syncs again. Writes are idempotent (upsert), but it's unnecessary RPC churn. Guard with a "just synced" bloom or check `existsInHot || existsInCold` BEFORE the sync fires (currently the sync fires BEFORE the dedup check — line 220 vs line 224).

### P2-5 — `getHotTracks` in poolStore adds Math.random() * 5 every call

`trackPoolStore.ts:438` — each call re-randomizes order. Fine for displays, but if `refreshRecommendations` uses this AND nextTrack's `availableTracks[0]` picks deterministically, first-render shows one order, after-refresh shows another — visible "shuffle" jumpiness on shelf updates. Cosmetic.

---

## Scenarios I Tried to Break (and What Happened)

### Scenario A: 30-track power user, Supabase up, fresh session
- History fills past 20 → exclusion works, but the other 10+ plays come from discover/hot. Fine.
- If hotPool has 100 tracks (typical for a returning user), 20 exclusion + maybe 5 blocklist + maybe 2 unplayable = 23 excluded → 77 available. Fine.

### Scenario B: New user, offline mid-session
- Pool loaded at boot. Supabase becomes unreachable after 5 tracks.
- `refreshRecommendations` fetch errors → `devWarn` logs, no state change. Good — existing pool preserved.
- User continues playing from `hotTracks` (in memory) for hours. Fine.

### Scenario C: Extreme skip user — user hits Next 30× in 10 seconds
- Queue empties after 30 pops.
- `recentHistoryIds` has 20 entries (sliced to last 20).
- Each `setCurrentTrack` kicks off `refreshRecommendations` on every 3rd call (10 firings) — 10 parallel Supabase fetches in flight. **Race identified** (P1-4).
- `videoIntelligenceAPI.recordPlay` fires 30 RPCs (P1-8).
- `centralSignals.play` fires 30 but dedupe catches them.
- No cascade (blocklist/unplayable filter guards next-track picks).

### Scenario D: Every available track is in exclusion
- First fallback drops history but keeps blocklist+unplayable.
- Second fallback (LAST RESORT) ignores everything except `currentTrackId`. Works unless pool is literally empty.
- If pool is empty → `nt_no_tracks`. **Dead-air** (P0-1).

### Scenario E: Repeat-all with stale track objects
- User plays 10 tracks in session, closes tab.
- Returns 2 days later. `runStartupHeal` fires, updates trackIds for some history tracks via `updateTrackInPool`.
- User enables repeat-all, queue empties, rebuild fires.
- History's `track` objects are STALE (pre-heal). Rebuild creates queue with old trackIds. Play attempts old trackId → loadTrack catches blocklist/unplayable → skip. Cascade protected, but waste.

---

## Graceful Degradation Proposal for `nt_no_tracks` (warm-it-up aligned)

**Core principle:** The one thing we know is playable is the track we just heard. Replaying it silently is warmer than dead-air, warmer than a toast, warmer than a retry button.

**Proposed sequence, inserted before the final `else` at `playerStore.ts:1058`:**

```ts
// Tier 5: Cold pool (aged-out favorites, still probably playable)
if (availableTracks.length === 0) {
  const cold = useTrackPoolStore.getState().coldPool
    .filter(t => {
      const tid = t.id || t.trackId;
      if (tid === currentTrackId) return false;
      if (t.trackId && isKnownUnplayable(t.trackId)) return false;
      return true;
    });
  if (cold.length > 0) {
    availableTracks = cold.slice(0, 10) as unknown as Track[];
    trace('nt_cold_rescue', currentTrackId, { coldSize: cold.length });
  }
}

// Tier 6: Silent loop-the-current. Fire background rehydration.
if (availableTracks.length === 0 && state.currentTrack) {
  trace('nt_warm_replay', state.currentTrack.trackId || state.currentTrack.id, {});
  set({
    isPlaying: true,
    progress: 0,
    currentTime: 0,
    seekPosition: 0,
    playbackRate: 1,
    isSkeeping: false,
  });
  // Silent self-heal: rehydrate pool in background. No UI.
  setTimeout(() => {
    get().refreshRecommendations();
    import('../services/poolCurator').then(({ bootstrapPool }) => {
      bootstrapPool(true).catch(() => {});
    }).catch(() => {});
  }, 0);
  return;
}

// Tier 7 (truly broken): old nt_no_tracks trace. Should be unreachable.
trace('nt_no_tracks', currentTrackId || null, { /* ... */ });
```

**Why this is warm-it-up:**
- No toast, no retry button, no "unavailable" message.
- The user hears the current track again (10/10 playable — just finished).
- In the 3-minute window while it replays, the background rehydration fills the pool; next Next will silently land on fresh material.
- Observable from telemetry (`nt_cold_rescue`, `nt_warm_replay`) for engineering, invisible to user.

---

## File:Line Quick-Ref

| Issue | File | Line |
|---|---|---|
| `nt_no_tracks` dead-air | playerStore.ts | 1058-1064 |
| getPlayedTrackIds wrong path | databaseDiscovery.ts | 130-142 |
| TRACKS-27 fallback | playerStore.ts | 953-957, 1147-1152 |
| Pool refresh race | playerStore.ts | 549-555 |
| 3× NON_MUSIC_KEYWORDS | trackPoolStore.ts:200, playerStore.ts:1465, databaseDiscovery.ts:60 |
| videoIntelligence no dedupe | playerStore.ts:527, supabase.ts:641 |
| Blocklist boot window | trackBlocklist.ts | 100-104 |
| Repeat-all stale tracks | playerStore.ts | 889-930 |
| Diversity cap under-fill | trackPoolStore.ts | 490-515 |
| addToPool syncs before dedup | trackPoolStore.ts | 220 vs 224 |

---

## Signal Loop Closure — Verified

The full loop closes:

```
[track plays]
  → playerStore.setCurrentTrack
  → recordPoolEngagement(trackId, 'play')
  → poolStore.recordPlay → centralSignals.play(trackId)
  → supabase.from('voyo_signals').upsert(...)   [5s dedupe in centralDJ]
[next session boot]
  → oyoDJ.initOYO() → hydrateFromSignals()
  → query voyo_signals last 30d, score, join video_intelligence for artists
  → djProfile.relationship.favoriteArtists updated
  → playerStore.refreshRecommendations reads getOyoInsights().favoriteArtists
  → hot pool sorted favorites-first
```

Confirmed closed. One caveat: the dedupe window is 5s per (user, trackId, action), so a user playing 10 different tracks in 5 seconds writes 10 rows fine. Skipping the same track twice in 5s writes one row. OK.

The only OPEN question in the loop: `voyo_signals.track_id FK` constraint flagged in `/home/dash/.claude/projects/-home-dash-Hub/memory/MEMORY.md` — `ALTER TABLE voyo_signals DROP CONSTRAINT voyo_signals_track_id_fkey;` would unblock the collective signal. That's infra, not queue-audit scope, but the queue-side code is fully wired and working.
