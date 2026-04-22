# AUDIT-SEARCH-2 — Discovery Pools + Personalization Surfaces

**Scope:** Mood shelves, vibes, smart picks, pool refresh cadence — the "what to play next OUTSIDE direct playback path" system. Inputs: `poolCurator`, `personalization`, `databaseDiscovery`, `trackPoolStore`, `data/tracks`, `HomeFeed`, `VibesReel`, `oyoDJ`, `centralDJ`, `essenceEngine`, `oyo/pools`, `oyo/index`, `useVibePoolPick`, `intentStore.MODE_KEYWORDS`.

**Date:** 2026-04-22. After `edbc10a` (databaseDiscovery.getPlayedTrackIds fixed) and after AUDIT-4/5.

---

## TL;DR

Discovery is two stacks glued together and the seams are visible.

- **Stack A** (HomeFeed "OYÉ Africa / Next Voyage / Vibes on Vibes / Top 10 / OYO's Picks"): hydrates via `oyo/pools.hot()+discovery()` — a 60s TTL cache of R2-cached `video_intelligence` rows, client-side reranked by `calculateBehaviorScore`, session-seed shuffled. This is the "good stack." It works.
- **Stack B** (HomeFeed "Vibes reel", VibesReel → `useVibePoolBatch`): reads `trackPoolStore.hotPool` (the local Zustand pool seeded by `poolCurator.seedPool` + bootstrapped by backend search), filters by `detectedMode`, sorts by `poolScore`. This is the "old stack." It has the staleness, keyword, and seed-only-27 problems.
- **Stack C** (Stations rail): reads `voyo_stations` directly from Supabase on mount. One-shot query, no TTL, no retry.

The three stacks never talk. `trackPoolStore.hotPool` is what feeds VibesReel's per-vibe 5 thumbs, but `hotPool` is populated from **search-query bootstrapping** (BOOTSTRAP_QUERIES, WEST_AFRICAN_QUERIES, CLASSICS_QUERIES) — not from the 324K `video_intelligence` table. So the vibe reel's "5 tracks × 5 vibes = 25 thumbs" is drawn from whatever `searchMusic('Burna Boy 2024')` returned and got `detectedMode`-classified by **keyword string-matching**. On a cold-boot with backend slow, the reel falls back to the static 27 TRACKS, and `'afro-heat'` will be the dominant mode for everything because `MODE_KEYWORDS['afro-heat']` is the biggest bucket.

**Top 3 P0/P1:**

1. **P0 — `MODE_KEYWORDS` "party" contains `"mix"` + `"dj"` → every DJ mix / AI-curated mix track lands in party, not in the actual vibe of the music.** The seed track `id:'0'` "GINJA SESSIONS | Afrobeats, Dancehall, Amapiano Mix" gets `detectedMode='party-mode'` even though its tag is `afrobeats` and its mood is `hype`. Every `CLASSICS_QUERIES` result containing "mix" gets miscategorized. VibesReel's party lane is padded with non-party content. (`intentStore.ts:443`, detection logic `trackPoolStore.ts:142-155`).

2. **P0 — `MODE_KEYWORDS['chill-vibes']` contains `"love"` and `"vibe"` — which match ~60% of African music titles.** "Last Last" (heartbreak/afrobeats), "Love Nwantiti", "Calm Down" (chill), "Essence" (chill already) all route into `chill-vibes`. But so does any banger with "love" or "vibe" in the title — `inferTags` even auto-adds `'love'` as a tag if title contains "heart". Result: chill-vibes pool bloats with non-chill tracks; afro-heat pool underfills. (`intentStore.ts:436`).

3. **P1 — Pool never refreshes mid-session.** `poolCurator` bootstraps once (`isBootstrapped = true` flag), auto-runs `curateAllSections` on mount and on HomeFeed mount. After that, the ONLY ways the pool grows are (a) `recordTrackInSession` → `expandPool` triggered every 5 plays + 60s gate, (b) user search results via `addSearchResultsToPool`, (c) scheduled `rescoreAllTracks` every 5 min (doesn't add tracks — just rescores + ages). There is **no periodic new-content fetch**. A 2-hour listening session sees the same 100-200 pool tracks recycled. (`poolCurator.ts:326-333, 537-561`; `trackPoolStore.ts:545-572`).

Everything else below.

---

## The Topology

```
             ┌────────────────────────────────────────────────────────────┐
             │                    HOME FEED SHELVES                       │
             └────────────────────────────────────────────────────────────┘
                              │              │              │
                    ┌─────────┘              │              └─────────┐
                    ▼                        ▼                        ▼
         STACK A (oyo/pools)       STACK B (trackPoolStore)     STACK C (direct)
         · Back in the Mood        · Vibes reel (VibesReel)     · Stations rail
         · Heavy Rotation          · Classics shelf              (voyo_stations)
         · OYÉ Africa              · African Vibes
         · Next Voyage             · (everything using
         · Top 10                    useVibePoolBatch)
         · OYO's Picks
                    │                        │
                    ▼                        ▼
         ┌──────────────────┐       ┌───────────────────┐
         │ oyo/pools.hot()  │       │ trackPoolStore    │
         │ + discovery()    │       │   .hotPool        │
         │ 60s TTL          │       │ zustand-persist   │
         │ R2-cached pool   │       │ keyword-detected  │
         └────────┬─────────┘       │ "detectedMode"    │
                  │                 └─────────┬─────────┘
                  ▼                           │
         ┌────────────────────┐               │
         │ databaseDiscovery  │               │
         │  getHotTracks(60)  │               │
         │  getDiscovery(60)  │               │
         │ video_intelligence │               │
         │ 324K, r2_cached=T  │               │
         └────────────────────┘               │
                                              ▼
                           ┌──────────────────────────────────────┐
                           │  poolCurator (bootstrap + expand)    │
                           │  Searches BOOTSTRAP_QUERIES etc.     │
                           │  via backend `searchMusic()` →       │
                           │  safeAddToPool → detectTrackMode     │
                           │  → hotPool entry                     │
                           └──────────────────────────────────────┘
                                              ▲
                                              │ (auto-tags by substring)
                           ┌──────────────────────────────────────┐
                           │  TRACKS (27 rows, data/tracks.ts)    │
                           │  Seed on boot if pool empty          │
                           └──────────────────────────────────────┘
```

`getPoolAwareHotTracks` / `getPoolAwareDiscoveryTracks` in `personalization.ts` are Stack B readers that are called as **fallback** when `getPersonalizedHotTracks` etc. are invoked. They are NOT called directly by HomeFeed (Stack A is preferred). But `playerStore.refreshRecommendations` still invokes them, so they feed the **player's** background-advance queue (see AUDIT-4, AUDIT-5).

`essenceEngine.getVibeEssence()` is the only bridge between user intent/reactions and discovery. It returns `{afro_heat, chill, party, workout, late_night}` weights — consumed ONLY by `databaseDiscovery.getHotTracksRaw/getDiscoveryTracksRaw` → `get_hot_tracks` / `get_discovery_tracks` RPCs. Stack B (trackPoolStore) ignores `essenceEngine` entirely; its scoring uses `useIntentStore.getIntentWeights()` directly. Two separate taste graphs feed two separate shelf systems.

---

## P0 Findings

### P0-1 — "mix" and "dj" are party keywords; DJ-mix tracks all mis-bucket

**Location:** `src/store/intentStore.ts:442-444`

```ts
'party-mode': [
  'party', 'club', 'dance',
  'turn up', 'lit', 'banger',
  'hype', 'energy',
  'mix', 'dj',   // ← P0
],
```

`matchTrackToMode` (intentStore.ts:466-489) scores by string containment count — whichever mode has the most hits wins. Track `id:'0'` (seed row):
- title: "GINJA SESSIONS | Afrobeats, Dancehall, Amapiano Mix"
- artist: "Ethan Tomas"
- tags: `['afrobeats', 'dancehall', 'amapiano', 'mix', 'party']`

When scored:
- afro-heat: hits `afrobeats`, `amapiano` → 2
- party-mode: hits `party`, `mix`, `dj` (from artist "Ethan **Tomas**" — no, but from tag `'party'`) → 2, tied

Because `Object.entries` iteration order is insertion order and `afro-heat` is first, it happens to win this one. But ANY track with `"mix"` in the title OR tag (which is common — DJ mixes, album-of-mixes, "Best Amapiano Mix", etc.) gets a point in party. And `'energy'` hits workout's keyword set too (`workout` has 'energy'? no — checking line 453-456: workout = `workout, gym, fitness, pump, run, motivation, power, beast, grind`. So `'energy'` is ONLY in party). Still, "mix" and "dj" are substring-hits on every YouTube search result that has the phrase "Official Mix", "DJ Maphorisa", or "DJ Khaled". `CLASSICS_QUERIES` returns artists like "King Sunny Ade" — hits nothing. But mid-pool, a Burna Boy track titled "Burna Boy - Last Last (DJ Remix)" becomes party, not afro-heat.

**Downstream effect:** VibesReel's party chapter shows DJ Maphorisa amapiano mixes; its afro-heat chapter shows fewer Burna/Wizkid. `getPoolAwareHotTracks` ranks with `intentWeights[detectedMode]` — user who cranks afro-heat to 6 bars still gets mis-tagged afro songs demoted because they show up as party.

**Fix:** Remove `'mix'` and `'dj'` from party-mode (they're metadata artifacts, not vibe signals). Replace with `'anthem'`, `'remix'` (which usually IS party-y), or let the tag system handle it.

**Related bug in same scoring:** `party-mode` contains `'hype'` and `'energy'`. The `Track.mood` field can be `'hype'` (see TRACKS seed — ids 0,1,3,5,8,11,12,14,15,18,19,21,24 all have `mood:'hype'`). So any track with `mood:'hype'` — which is supposed to mean "high-energy afrobeats" — scores 1 point for party-mode. Hype IS adjacent to party, but the user's intent model separates them. Tracks like "City Boys" (Burna Boy, afrobeats/street/hype) tie between afro-heat (2 hits: burna, afrobeats) and party-mode (1 hit: hype from mood). Keep afro-heat in the lead here, but the signal is messy.

---

### P0-2 — "love" and "vibe" in chill-vibes keywords bloat the chill bucket

**Location:** `src/store/intentStore.ts:433-437`

```ts
'chill-vibes': [
  'chill', 'relax', 'smooth', 'slow', 'calm',
  'acoustic', 'rnb', 'r&b',
  'love', 'essence', 'vibe',   // ← P0
],
```

`'love'` matches:
- "Love Nwantiti" (CKay, rnb/chill) — fine
- "I'm In Love With U" (anthem) — rarely chill
- "Love No Dey" (any party anthem saying "love")
- Albums: "Love, Damini" (Burna Boy)
- Auto-added by `poolCurator.inferTags` when title contains "heart" or "love"

`'vibe'` matches half of modern African music titles: "Vibes", "Vibration", "Vybz", "Good Vibes", "Ginja Vibes", "Mr Vibes". The seed TRACKS has 4 tracks with `tags:['rnb','chill']` or similar — but after `poolCurator` adds 50 search results, ~40% of those will have `'vibe'` or `'love'` somewhere and route into chill.

**Quantitative check (from TRACKS seed):**
- Tracks explicitly `mood:'chill'`: ids 6, 17, 20, 22 → 4 tracks
- Tracks that would MATCH chill-vibes via keywords (title/artist/tags containing love/essence/vibe/r&b/rnb/chill/smooth/etc): ids 2, 6, 8, 10, 13, 17, 20, 22, 25 → 9 tracks

So chill-vibes bucket sees 9/27 = **33%** of the static pool while afro-heat sees the rest. That's not wrong per se (chill is a legit subset of afrobeats), but in VibesReel where we show 5 tracks PER vibe, both buckets will overlap heavily on the same tracks. "Essence" (Wizkid/Tems) will appear in both afro-heat (artist `wizkid` + tag `afrobeats`) and chill-vibes (title `essence` + mood `chill`). `useVibePoolBatch(vibeId, 5)` just filters by `detectedMode === vibeId` so "Essence" lands wherever it won the `matchTrackToMode` tie — but user expectation is "this track represents afro-heat OR chill, not both in the same session."

**Fix:** Drop `'love'`, `'essence'`, `'vibe'` from chill-vibes keywords. Keep `chill, relax, smooth, slow, calm, acoustic, rnb, r&b, mellow`. Let tag=`'chill'` be authoritative if present (which is already true via `tags?.join(' ')` in the searchText, but the bare words are the trap).

**Stronger fix:** Move mode detection out of keyword-substring and into `video_intelligence.vibe_*` columns (Supabase already stores 5 vibe scores per track). `trackPoolStore.createPooledTrack` should `syncToDatabase` and read back `vibe_afro_heat/chill/party/workout/late_night`, then assign `detectedMode = argmax(vibe_*)`. Collective intelligence replaces local string-matching.

---

### P0-3 — `MODE_KEYWORDS['afro-heat']` is the universal "default" — everything lands here when unsure

**Location:** `intentStore.ts:425-431`; `personalization.inferTags` at `poolCurator.ts:266-270` returns `['afrobeats']` when no keywords match.

In `matchTrackToMode`, when no keyword hits anything, the function returns `'random-mixer'`. BUT:
- `poolCurator.inferTags` defaults to `['afrobeats']` if nothing matches (poolCurator.ts:267)
- Every pool track gets tagged `afrobeats`
- `afrobeats` is a keyword in `afro-heat` mode

So `detectedMode` cascades to `afro-heat` for any search result that didn't trip another mode. "Tyla - Water" (Amapiano/South African R&B) ends up `afro-heat` because `'tyla'` is an artist keyword there.

Combined with P0-1 and P0-2: chill leaks anywhere with "love/vibe", party leaks anywhere with "mix/dj", and everything else is afro-heat by default. The late-night, workout buckets are nearly empty in VibesReel unless a track literally says "night" or "workout" — which music rarely does.

**VibesReel visible consequence:** Late Night chapter = 0-2 tracks. Workout chapter = 0-2 tracks. Both will fall back to the LAST `[0]` pick from `useVibePoolBatch` → an empty array. Chapter renders as just the `VibeCoverCard` with zero track tiles after it. User sees a lonely AI vibe portrait with no music. `VibesReel.tsx:117-128`.

**Fix:** Seed TRACKS with at least 2-3 explicitly late-night and workout tracks (add a "late-night" tag + `mood:'chill'|'moody'` manually). Also — fallback from `detectedMode === 'random-mixer'` to round-robin across underfilled modes so no vibe chapter is empty.

---

### P0-4 — Pool never refreshes on a cadence; long sessions stagnate

**Locations:**
- `src/services/poolCurator.ts:537-561` — `setTimeout(() => bootstrapPool/seedPool/curateAllSections, 1500)` fires ONCE on module load. `isBootstrapped = true` then gates further bootstraps.
- `src/services/poolCurator.ts:326-333` — `checkCurationTrigger` fires `expandPool` only when `currentSession.tracks.length >= 5 && timeSinceLastCuration >= 60000ms`. `currentSession.tracks` caps at 10 (`:312-314`). So expansion is: first 5 plays trigger one expansion, next 5 trigger another (if 60s passed). With 3-minute tracks, 15min → 1 expansion. 2hr session → ~8 expansions. Each expansion adds 3 queries × 10 results = 30 tracks max. Total pool growth over 2hr: ~240 tracks (before dedupe + validation failures). Reasonable — but:
- **No time-based refresh.** `startPoolMaintenance` (`trackPoolStore.ts:545-572`) runs every 5min but only **rescores and ages out** — it never adds new tracks.
- **No cadence-based new-content fetch.** `expandPool` is gated on user activity. A passive listener who leaves the app playing during a lunch break gets no new pool content.
- **`refreshPools` (oyo/pools.ts:121)** only invalidates TTL cache; the underlying `databaseDiscovery.getHotTracks` is still deterministic on the same essence + excludedIds.

**Consequence:** Hot cache is refilled from video_intelligence every 60s (fine) but rows like "Next Voyage" and "OYO's Picks" present tracks drawn from the SAME 50-80 R2-cached-hot tracks plus the accumulated `trackPoolStore.hotPool` which isn't growing much. After 30-45 min of continuous listening, the user starts seeing the same 15-track carousels on every shelf.

**Related:** `oyo/pools.refreshPools` is called by `maybeRefreshPools` (oyo/index.ts:42-47) with a **30s cooldown** — fine. But `maybeRefreshPools` is only called on `onPlay`. Skip, complete, react don't trigger it. A user rapidly skipping through tracks will not refresh the pool (which would normally surface fresher vibe-matched cached tracks).

**Fix:**
1. Add a 3-5min timer to trigger `refreshPools()` + optionally `curateSection('trending')` while session is active.
2. Also call `maybeRefreshPools()` from `onSkip` and `onComplete` — taste changes faster than plays alone.
3. For very long sessions, periodically force `poolCurator.forceBootstrap()` every ~45min to rotate the local-pool base queries.

---

### P0-5 — `pools.hot()` prefers `trackPoolStore.hotPool` over server when local pool ≥ 20, even if server has more/better

**Location:** `src/services/oyo/pools.ts:67-93`

```ts
const localPool = useTrackPoolStore.getState().hotPool;
let raw: Track[] = [];
if (localPool && localPool.length >= 20) {
  raw = localPool as Track[];   // ← prefers local bootstrap over server 324K pool
} else {
  raw = await getHotTracks(60); // server fallback
}
```

`trackPoolStore.hotPool` is populated by `poolCurator.bootstrapPool` (12 hand-coded queries like `'Burna Boy 2024'`, `'Fela Kuti best songs'`). These queries hit the backend `searchMusic()` — NOT `video_intelligence`. So:
- Local pool ≥ 20 after 2 queries succeed.
- From that point on, `pools.hot()` ignores `video_intelligence` (324K vibe-scored tracks) and only re-reranks the ~30-100 bootstrapped tracks.
- The R2-cached pool (`databaseDiscovery.getCachedTracks` queries `video_intelligence.r2_cached=true`, up to 1500 rows, verified 575 actually exist) is **skipped by the Hot pool** except on cold first load.

**This is upside-down.** `video_intelligence` has the vibe scores + cultural tags + heat scores + R2 guarantee. The local pool has keyword-inferred `detectedMode` and `poolScore` that decays after 15 days.

**Consequence:** The Hot stream downstream of `pools.hot()` — used by "Next Voyage", "Top 10 on VOYO", "OYO's Picks" — runs mostly on the 12 bootstrap queries' results after first boot, NOT on the 575 R2-cached tracks. New content added to video_intelligence doesn't surface until local pool gets cleared (`clearStalePool`) or user shifts device.

**Fix:** Reverse the preference — always prefer `video_intelligence` (R2-cached, heat-sorted, fresh) as the base, merge in `trackPoolStore.hotPool` tracks that have engagement signals (`playCount > 0 || reactionCount > 0 || queuedCount > 0`). Local pool becomes the "learned taste" layer on top of the content layer.

```ts
const serverPool = await getHotTracks(80);
const localEngaged = useTrackPoolStore.getState().hotPool.filter(
  t => t.playCount > 0 || t.reactionCount > 0 || t.queuedCount > 0,
);
const seen = new Set(serverPool.map(t => t.id));
const merged = [...serverPool, ...localEngaged.filter(t => !seen.has(t.id))];
```

---

## P1 Findings

### P1-1 — VibesReel chapter emptiness is not handled

**Location:** `src/components/classic/VibesReel.tsx:117-128`

```ts
const Chapter = memo(({ vibe, onOpenVibe }) => {
  const tracks = useVibePoolBatch(vibe.id as VibeMode, 5);
  return (
    <>
      <VibeCoverCard vibe={vibe} onTap={() => onOpenVibe(vibe)} />
      {tracks.map((t) => ( <ReelTrackCard .../> ))}
    </>
  );
});
```

If `tracks` is empty (late-night / workout underfilled, see P0-3), the chapter renders as a single `VibeCoverCard` followed by NOTHING — not even a placeholder, skeleton, or "loading" state. The next chapter's VibeCoverCard appears immediately after, so the user sees two AI cards side-by-side with no music between — looks broken.

**Fix:** If `tracks.length === 0`, fall back to `useVibePoolBatch('afro-heat', 3)` or render a "curating..." skeleton tile that tap-opens the vibe (triggers `onOpenVibe` which will at least find something via `app.playFromVibe`).

---

### P1-2 — Gemini smart picks path is dead code for most users (offline + rate-limited without surfacing)

**Locations:**
- `src/services/intelligentDJ.ts:325-386` — `callGeminiDJ` expects `VITE_GEMINI_API_KEY`; if not set, logs `"No API key configured"` and returns null → falls through to `fallbackToSearch`.
- `src/services/oyoDJ.ts:29-30` — same env var for DJ announcements.
- No caching: every `runIntelligentDJ` call fires a new Gemini request. Rate-limited by the server (15 RPM on free tier); no client-side limiter.
- On error (401, 429, 5xx), returns null → `fallbackToSearch` → single-query backend search. No user-facing signal.

The "Smart Picks" value proposition is absent unless the key is configured and the user is online. There's no offline cache of past Gemini suggestions — each session starts cold.

**Secondary:** `intelligentDJ.ts:546-603` — flow is `getTracksByMode` from Central DB FIRST (flywheel), Gemini fallback only if DB has <8 tracks for that mode. **But** `getTracksByMode` (`centralDJ.ts:143-169`) queries `voyo_tracks` table (not `video_intelligence`). `voyo_tracks` is smaller — maybe a few thousand rows — and uses a different schema (`vibe_afro_heat` as 0-100 score column, not normalized). Running `getTracksByMode('afro-heat', 16)` rarely returns <8 rows, so Gemini path is near-dead. That's actually fine (flywheel working) — but the `intelligentDJ` module is loaded + ~170kB of code for paths that almost never run. Consider lazy-loading.

**Fix:**
1. Add a 10-minute result cache keyed on `(dominantMode, favoriteArtistsHash)` so rapid skips don't re-hit Gemini.
2. On Gemini failure, SURFACE the fallback — even if invisibly. `oyoPlan` or `recommendStream` could fire a "curating new tracks..." toast once per session.
3. Lazy-import `intelligentDJ` — it's only needed when pool drought is detected.

---

### P1-3 — `getMixedTracks` in personalization is unused (dead feature)

**Location:** `src/services/personalization.ts:514-561`

`getMixedTracks` constructs tracks proportional to MixBoard mode weights. Not called anywhere in `src/`. Verified:
```
grep -r "getMixedTracks" /home/dash/voyo-music/src/ → 1 hit (the definition)
```

It's 50 lines of dead code. Either wire it into a "Your Mix" shelf (natural fit — user's MixBoard → tracks that proportionally represent that blend), or remove it.

Same check for `getLikelySkips` (`personalization.ts:392-410`) — not called anywhere in `src/`. Dead.

---

### P1-4 — `voyo_seed` table is referenced in memory but not queried

**Locations:**
- Memory says 324K rows in `voyo_seed`.
- Grep of `/home/dash/voyo-music/src/`: no `voyo_seed` query anywhere.
- The only hit is `centralDJ.ts:567` — `const SEED_SYNC_KEY = 'voyo_seed_synced_v1'` — a **localStorage key**, not the table.
- The 324K rows that discovery actually queries: `video_intelligence` (see `databaseDiscovery.ts:200`).

Either `voyo_seed` was renamed to `video_intelligence` at some point and the memory note is stale, or `voyo_seed` exists but is orphaned. Either way: **not dead weight** (if renamed, inventory is intact), but the memory reference should be updated to `video_intelligence` to avoid future confusion.

---

### P1-5 — "Made For You" shelf doesn't exist; "Heavy Rotation" is local-only

**Location:** HomeFeed.tsx:1588-1625.

"Heavy Rotation" = `getUserTopTracks(15)` (personalization.ts:416-460). Combines static TRACKS (27) + `hotPool` tracks, scores each by `(completions * 10) + (reactions * 5) + completionRate`, filters by `score > 0`. This means:
- On cold boot / fresh install: Heavy Rotation is **empty** because no track has any score.
- After the user plays 5-10 tracks: shows their top plays from those 5-10 tracks — a tautology.
- Never references the 324K `video_intelligence` or cross-user signals.

"Made For You" as a concept (Spotify's Daily Mix / Discover Weekly analog) does not exist. The closest is "OYO's Picks" — but that's just `pools.hot` filtered by favoriteArtists, not a genuine collaborative-filter recommendation.

**Gap (design):** Cross-user collaborative filtering is absent. `voyo_signals` table has every user's skip/complete/love/queue signal (AUDIT-5). No code reads anyone else's signals. The "flywheel" that `saveVerifiedTrack` describes is track-metadata sharing, not taste-similarity.

**Low-cost fix for Made For You:** `video_intelligence.heat_score` is already a cross-user heat signal (driven by the global record_signal RPC). A "Made For You" shelf could be `getHotTracks(30)` filtered by `byFavoriteArtists(favorites)` → personal + global. Already have the primitives.

---

### P1-6 — Duplicate tracks across shelves are prevented in Stack A but not Stack B

**Location:** HomeFeed.tsx:1468-1487.

`trending` (Top 10) uses `usedIds = new Set([...oyosPicks, ...discoverMoreTracks, ...africanVibes])` to exclude already-shown tracks. Good.

But `africanVibes` itself (HomeFeed.tsx:1409-1437) uses `getWestAfricanTracks(hotPool)` which is filtered by `tags?.includes('west-african')`. A track showing in africanVibes CAN also show in `oyosPicks` because `oyosPicks = pools.hot` is from `video_intelligence`, and the dedupe only goes one direction (trending excludes oyosPicks, not the reverse).

Also: VibesReel + africanVibes + OYÉ Africa can all surface "Last Last" by Burna Boy (tagged `west-african` + `afrobeats` + `rnb` + `heartbreak`). User scrolls and sees Burna Boy's same track 3-4 times.

**Fix:** Pass `excludeIds` through the shelf construction chain. `pools.excludeIds` (oyo/pools.ts:172) is already designed for this; HomeFeed just doesn't use it. After computing `africanVibes`, pass its IDs as exclusion into `oyosPicks` construction (and vice versa).

---

### P1-7 — `refreshRecommendations` is called on EVERY `hotPool.length` change

**Location:** HomeFeed.tsx:1319-1321

```ts
useEffect(() => {
  refreshRecommendations();
}, [hotPool.length, refreshRecommendations]);
```

`hotPool.length` changes whenever `addToPool` succeeds. During `bootstrapPool` (parallel batches of ~12 queries × 10 results = ~120 safe-adds), every successful add increments the length. That's ~60-80 `refreshRecommendations()` calls in the first 10 seconds after boot.

`refreshRecommendations` (playerStore.ts:1457) re-queries `getPoolAwareHotTracks + getPoolAwareDiscoveryTracks`, rebuilds `hotTracks` + `discoverTracks`, triggers a zustand set → re-render cascade. 60x in 10s = render thrashing during cold boot.

**Fix:** Debounce the effect, or gate on threshold crossings (e.g., only fire when `hotPool.length` crosses multiples of 10).

---

### P1-8 — `getUserTopTracks` double-counts preferences

**Location:** `personalization.ts:441-445`

```ts
const pref = preferences[track.id] || preferences[track.trackId];
```

Tracks have BOTH `id` and `trackId`. They can differ (e.g. local-pool track id `'0'` vs trackId `'mhd0RcE6XC4'`). The preference store is keyed by whichever ID the action site used (inconsistent across the codebase). When `getUserTopTracks` falls back `preferences[track.id] || preferences[track.trackId]`, it only reads ONE side — if the user completed the track while the store keyed by `trackId` but the current track object has it keyed by `id`, preferences `[track.id]` exists as undefined, and the fallback reads `preferences[track.trackId]` — fine. But if BOTH keys have entries (user completed the same track from two sources that keyed differently), only one is counted.

**Fix:** Canonicalize on `trackId` at the preference-store write site. Add a migration that merges any `preferences[id]` into `preferences[trackId]` on boot.

---

### P1-9 — `databaseDiscovery.getCachedTracks` in-memory cache is never invalidated

**Location:** `databaseDiscovery.ts:176-223`

```ts
let _cachedPoolCache: {...} | null = null;
const CACHED_POOL_TTL_MS = 60_000;
// ...
if (!_cachedPoolCache || now - _cachedPoolCache.at > CACHED_POOL_TTL_MS) { ... fetch ... }
```

60s TTL on the R2-cached 575-row pool. Fine. But:
- No invalidation when `r2_cached` transitions fire in the DB.
- The `curateUncachedForPrefetch` callback queues **uncached** candidates for extraction, but after extraction (which can take 30-60s), `_cachedPoolCache` still holds the stale 575 rows until 60s expiry. So newly-cached tracks don't surface for up to 60s after the lane finishes.

Not critical (60s is tolerable latency), but: combined with P0-4, the system has no reactive path for "new cached tracks available — refresh everything now." Stations rail (HomeFeed.tsx:1282-1297) fires once on mount and has no refresh at all.

---

## P2 Findings

### P2-1 — Seed TRACKS static array IS too small (confirmed)

27 rows. AUDIT-4 flagged this. Mitigation: `nt_no_tracks` safety net added. But discovery-side is ALSO affected:
- `getPersonalizedHotTracks` / `getPersonalizedDiscoveryTracks` (fallback paths in personalization.ts:197, 263) both iterate TRACKS only.
- `getMixedTracks` iterates TRACKS only.
- `getTracksByMode` (personalization.ts:466) iterates TRACKS only.

These paths matter when `hotPool.length === 0` (which only happens if `clearStalePool` was run or zustand-persist is cleared). But they DO run, and in those cases VibesReel/Classics/etc. all see the same 27 tracks.

**Fix:** Add 30-40 more seed rows covering late-night, workout, chill explicitly. Tag them so at least 3-5 per mode exist. Or migrate `TRACKS` to a generated asset from `video_intelligence.heat_score desc limit 100`.

---

### P2-2 — VibesReel `vibe.id` includes `afro-heat` which matches `VibeMode` but NOT `'random-mixer'`

`VIBES` (data/tracks.ts:79-125) has 5 entries: `afro-heat, chill-vibes, party-mode, late-night, workout`. Matches `VibeMode` minus `'random-mixer'`. Good.

But `useVibePoolBatch` accepts `VibeMode | string` — so you could pass any string and it filters by `detectedMode === vibeId`. A typo or future vibe ID like `'house-party'` would silently return [] instead of failing loudly. Low urgency. Could tighten the type.

---

### P2-3 — `poolCurator.inferMood` returns incomplete enum

**Location:** `poolCurator.ts:272-278`

```ts
function inferMood(title: string): 'afro' | 'hype' | 'chill' | 'rnb' { ... }
```

But `Track.mood` in types probably accepts more values (`TRACKS` uses `'dance'`, `'heartbreak'` too). So mood inference is lossy on the pool path — a pool track from searchMusic never gets `mood:'dance'` even if the search query was `amapiano dance`. Downstream scoring in `matchTrackToMode` uses `track.mood` as a keyword source; narrow inference means fewer correct mode matches.

---

### P2-4 — `essenceEngine.getVibeEssence()` calls `useIntentStore.getState()` inside `extractBehaviorSignals` loop

**Location:** `essenceEngine.ts:200-226`

```ts
Object.entries(trackPrefs).forEach(([trackId, pref]) => {
  const dominantModes = useIntentStore.getState().getDominantModes(2);  // ← inside loop
  dominantModes.forEach(mode => { ... });
});
```

Not a correctness bug but O(N×getStateCost) where N = trackPreferences entries (could be hundreds). `getState()` is cheap but `getDominantModes(2)` does sorting inside. Hoist outside the loop.

Also the logic is weird: behavior signals (completions/skips per track) are being distributed to whatever the CURRENT dominant intent mode is, not to each track's actual mode. This means if a user listens to all-chill music but currently has party-mode cranked, their chill completions get credited to party's behavior weight. Inverted learning.

**Fix:** Credit each track's completions/skips to the track's own `detectedMode`, not the user's current intent.

---

## What works well

- **Dedupe on trackId + id** in personalization.getPoolAwareHotTracks/Discovery is thorough (handles the id/trackId inconsistency).
- **Session-seed shuffle** in `oyo/pools` gives stable-within-session, fresh-across-session track ordering without expensive re-computation.
- **Prefetch queuing** in `databaseDiscovery.curateUncachedForPrefetch` — the system correctly pushes vibe-matched uncached candidates into voyo_upload_queue so next refresh has more cached content.
- **Hydrate from signals** in `oyoDJ.hydrateFromSignals` (post 2026-04-22) correctly reads voyo_signals, scores, resolves artists from video_intelligence, merges with in-session favorites. The merge is the right primitive for cross-session continuity.
- **Idle-deferred pool maintenance** (`trackPoolStore.startPoolMaintenance`) correctly uses requestIdleCallback so rescore doesn't hit audio thread.
- **R2-gated everything** (`oyo/index.getHot/getDiscovery`) guarantees instant-playable cards — good UX principle.

---

## Design gaps (not bugs, but worth flagging)

1. **No collaborative filtering.** voyo_signals has millions of cross-user signals; none are read by the UI. Could ship a "Similar Listeners" shelf with a single SQL aggregate.
2. **Cold-start degrades to TRACKS seed (27 rows).** New user + slow backend = same 27 tracks on every shelf. Could ship an embedded top-100 JSON (gzipped, 20kB) as the real static seed.
3. **No trending detection.** `TRENDING_QUERIES` is hand-coded in poolCurator and never changes. Real trending (heat_score rising velocity) would come from `video_intelligence` but isn't surfaced.
4. **VibesReel is all-or-nothing.** Vibe chapter with 0 tracks is silent. Should degrade gracefully (fill from adjacent vibe via `essenceEngine.discoveryHints`).
5. **Two taste graphs.** AUDIT-5 flagged brain vs centralDJ. This audit flags a third: `trackPoolStore.detectedMode` (keyword) vs `video_intelligence.vibe_*` (learned scores). Pick one source of truth.

---

## Fix priority

| # | Finding | Effort | Impact |
|---|---|---|---|
| P0-1 | Remove 'mix','dj' from party-mode keywords | 1 line | High — stops mass miscategorization |
| P0-2 | Remove 'love','essence','vibe' from chill-vibes keywords | 1 line | High — rebalances buckets |
| P0-3 | Add explicit late-night + workout seed tracks | 10 rows in TRACKS | Medium — fixes empty vibe chapters |
| P0-4 | 3-5min periodic `refreshPools + curateSection` | 10 lines | High — stops mid-session stagnation |
| P0-5 | Prefer server pool over local in `pools.hot()` | 10 lines | High — unlocks 324K-row discovery |
| P1-1 | Empty vibe-chapter fallback in VibesReel | 5 lines | Medium — UX polish |
| P1-2 | Gemini smart-picks cache + lazy-load | 30 lines | Low — path rarely runs |
| P1-6 | excludeIds across shelves | 10 lines | Medium — kills visible dupes |
| P1-7 | Debounce `refreshRecommendations` on hotPool changes | 3 lines | High — cold-boot perf |
| P1-8 | Canonicalize preferences on trackId | Migration | Low — edge case |
