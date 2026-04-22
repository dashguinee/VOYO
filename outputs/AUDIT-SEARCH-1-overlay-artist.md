# AUDIT — Search Overlay V2 + Artist Page

**Scope:** `SearchOverlayV2`, `AlbumSection`, `VibesSection`, `ArtistPage`, `useArtist`, `searchCache`, `databaseDiscovery.getPlayedTrackIds` (for parity), `useBackGuard`, and the App.tsx wiring (`openVideoOverlay` / `closeSearch` / `onArtistTap`).
**Frame:** VOYO warm-it-up — no dead-air, no retry buttons, latency as design feature. Search should feel instant, results should feel fresh, artist taps should feel like a proper surface change (not a dead-end).

---

## TL;DR

The debounce + stale-result guard (`searchIdRef`) is tight and the sectioned Library/YouTube layout is clean. But there's a **real cache-poisoning bug** that writes stale results under new query keys, an **ArtistPage that hides tracks for 90% of artists** (r2_cached-only filter), **no back-stack between search and ArtistPage** (tapping artist closes search → back escapes to home feed, not search), and **zero search telemetry** so we're flying blind on conversion.

**Top P0/P1:**
1. **P0 — Search cache poisoning.** `performSearch`'s final setter uses `setResults(prev => { if (prev.length > 0) searchCache.set(searchQuery, prev) ... })`. If a previous search left results in state AND the new query returns empty, the OLD results get cached under the NEW query key. Next search for that query → instant "hit" with wrong data. `SearchOverlayV2.tsx:435-443`
2. **P0 — ArtistPage shows empty for uncached artists.** `useArtist.ts:278-308` filters `rows.filter(r => r.r2_cached === true)` and returns ONLY cached. Artists with 50 tracks but 0 cached show "No tracks found in our library yet." — making the page look broken. All 700+ non-tier-A artists in `ARTIST_LIST` are tappable but lead to ghost pages.
3. **P1 — Back gesture broken between search → artist.** `App.tsx:1079` does `setArtistPageName(name); closeSearch();` so the search is torn down before ArtistPage mounts. There's no `useBackGuard` on ArtistPage either (`ArtistPage.tsx:509-583` — the two header buttons both call `onClose`, no history integration). Back from artist escapes the app on a fresh session; on a stale-history session it jumps to whatever modal was last pushed. Users can't "peel" artist → search → home.

Full findings below.

---

## P0 Findings

### P0-1 — Cache poisoning via stale `setResults(prev => ...)` closure

**Location:** `src/components/search/SearchOverlayV2.tsx:435-443`

```ts
setIsSearching(false);
setResults(prev => {
  if (prev.length > 0) {
    searchCache.set(searchQuery, prev);     // ← prev may be from the PREVIOUS query
    syncSearchResults(prev);
  } else {
    setError('No results found. Try a different search.');
  }
  return prev;
});
```

**Why it's wrong:**
- The UX intent at `:449-450` is "Don't clear results while typing — keep showing previous results. Only clear if input is empty." So `results` state can hold the PREVIOUS query's data while the NEW query is inflight.
- When the new query returns fully empty (`library.length === 0 && youtube.length === 0`), the `if (library.length > 0 || youtube.length > 0)` at line 426 skips the `setResults([...])`. State still holds stale results.
- Line 435's `setResults(prev => …)` then reads `prev.length > 0` (true — from old query) and caches THAT old array under `searchCache.set(searchQuery, prev)` where `searchQuery` is the NEW query string.
- Next time anyone types the new query, line 347-354 hits the cache and returns the poisoned data **as if it were fresh**.

**Repro:**
1. Type "burna" → gets results, cached under "burna".
2. Immediately type "qwerty" (not clearing input).
3. Results for "qwerty" come back empty. setResults-with-stale-prev fires.
4. Cache key `"qwerty"` now holds Burna Boy tracks.
5. Close search. Re-open. Type "qwerty" → instant "cache hit" showing Burna tracks.

**Also:** `setError('No results found…')` inside a functional state-setter is an anti-pattern. It fires during a render cycle and won't always commit. And when `prev.length > 0` is true, the error never fires, so the "No results" state at line 820-825 (`!isSearching && query.length >= 2 && results.length === 0 && !error`) doesn't render — instead users see the stale prev results presented as the answer to their new query with no "this is old" indication.

**Fix:**
```ts
// Use the already-computed `library` and `youtube` from the outer scope
// (they're in closure) instead of reading stale state.
const hasResults = library.length > 0 || youtube.length > 0;
setIsSearching(false);
if (hasResults) {
  const merged = [...library, ...youtube];
  searchCache.set(searchQuery, merged);
  syncSearchResults(merged);
} else {
  // If results are still stale from previous query, clear them now so the
  // "No results for X" UI renders correctly.
  setResults([]);
  setError('No results found. Try a different search.');
}
```

---

### P0-2 — ArtistPage filters uncached tracks → empty page for most artists

**Location:** `src/hooks/useArtist.ts:277-308`

```ts
const rows = (data || []);
const cached = rows.filter(r => r.r2_cached === true);
const uncached = rows.filter(r => r.r2_cached !== true);

// ... prefetch uncached in background ...

return cached.map((row) => ({ ... }));  // ← ONLY returns cached
```

**Why it's wrong:** `ARTIST_LIST` in SearchOverlayV2 comes from `artist_master.json` and exposes ~700 artists. Users see/tap these in the Artists tab. Per `memory/voyo-holy-grail-pipeline-2026-04-20.md`, R2 coverage is growing slowly (the 91% success rate is for extraction, not coverage). Most non-tier-A artists have zero cached tracks at any given moment.

**User-visible consequence:** Tap "Youssou N'Dour" → ArtistPage loads, fetchTracks returns 40 rows, filter leaves 0, tracks.length is 0, renders "No tracks found in our library yet." The artist appears broken — Dash's "warm-it-up / no retry buttons" is violated: the user hit a dead-end that screams "nothing here" when there's actually 40 tracks waiting on the lanes.

**Fix options (pick one):**

**A. Show uncached tracks too, with a subtle warming indicator.** Tap still works because `app.playTrack('artist')` → `ensureTrackReady` at priority 10, so the R2 gate catches up. UX feels "warming up" instead of "empty".

```ts
// Return all rows, but mark cached-ness so the UI can render a soft
// "warming up" dot on uncached cards. Still sorted by play count.
return rows.map((row) => ({
  youtube_id: row.youtube_id,
  // ... existing fields ...
  r2_cached: row.r2_cached === true,    // ← expose to UI
}));
```

Then ArtistPage conditionally renders the `✦ DISCO` pill (matching the search UI pattern) only on cached rows. Tapping an uncached one still plays — just takes the usual "warm up" latency.

**B. Fall back to all rows when cached is empty.**
```ts
return (cached.length > 0 ? cached : rows).map((row) => ({ ... }));
```

Less signal-rich but smallest diff. Prevents the "empty page" without restructuring.

This is P0 because it's the default path for the majority of artists in the library.

---

### P0-3 — Back gesture: search → artist is not reversible

**Location:** `src/App.tsx:1079`, `src/components/voyo/ArtistPage.tsx:509-583`

```tsx
// App.tsx
<SearchOverlay
  ...
  onArtistTap={(name) => { setArtistPageName(name); closeSearch(); }}
  ...
/>
```

**What's wrong:**
1. `closeSearch()` fires synchronously, tearing down the SearchOverlay before ArtistPage mounts. The search back-history entry (`App.tsx:820-836`) is popped. So the back stack has nothing that says "search was open".
2. ArtistPage itself has NO `useBackGuard`. No history entry pushed on mount, no popstate listener. Two header buttons (X and ←) both call `onClose` directly.
3. System back gesture on ArtistPage → no handler → browser navigates to whatever's in history, often exiting the app or jumping to a random state.

**Expected flow (from prompt "v403 fix-pack introduced backguard-modal pattern + artist page tap-in from results"):** open search → tap artist → ArtistPage opens → back gesture → ArtistPage closes, search reopens → back → search closes, home.

**Fix:**
```tsx
// Drop the closeSearch() from onArtistTap — let ArtistPage overlay search.
// Both use useBackGuard, so back peels artist → search → app.
onArtistTap={(name) => { setArtistPageName(name); }}

// ArtistPage.tsx — add useBackGuard inside the component:
import { useBackGuard } from '../../hooks/useBackGuard';
...
useBackGuard(true, onClose, 'artist-page');
```

Since ArtistPage is only rendered when `artistPageName` truthy (App.tsx:1084), we can just pass `true` for `open`. Alternatively, pass `artistPageName != null` if wrapping inside App.

If SearchOverlay can't visually coexist with ArtistPage (z-fighting), the fix becomes "keep search mounted but visually hidden behind ArtistPage" — or explicitly close search AFTER ArtistPage's back-guard peels, not before.

---

## P1 Findings

### P1-1 — `saveToHistory` fires on partial-query DB hits, polluting Recent

**Location:** `SearchOverlayV2.tsx:411-413, 428`

Debounce is 120-200ms. User types "burna boy" (9 keystrokes over ~2s). Each intermediate query that hits the DB and returns ≥1 row saves to Recent. Even "bu" (2 chars, passes the length check at 335) saves if the RPC returns anything for that prefix.

After one real search session, Recent looks like: `"burna boy", "burna bo", "burna b", "burna ", "burna", "burn", "bur", "bu"` — 8 entries for one intent, slice trims oldest, user never sees their older real searches.

**Fix:** Only save to history on a **committed** search. Two options:
- Only save on explicit Enter keypress (good for desktop).
- Only save on `handleSelectTrack` (saves query that led to a tap — highest signal).

Preferred: save on tap (`handleSelectTrack`). That's what "Recent" should mean — queries that produced value.

```ts
const handleSelectTrack = useCallback((result: SearchResult) => {
  ...
  saveToHistory(query);   // ← save only when a result was actually picked
  app.playTrack(track, 'search');
  ...
}, [query, ...]);
```

Remove the two calls at 412 and 428.

---

### P1-2 — No search telemetry at all

**Location:** SearchOverlayV2.tsx entire file

Grep for `logPlaybackEvent`, `trace`, `telemetry` in SearchOverlayV2 returns zero hits. The only telemetry is the `logPlaybackEvent({ subtype: 'play_intent', ui_source: 'search' })` fired downstream by `app.playTrack` (oyo/app.ts:68-72).

**What we can't measure today:**
- `search_opened` (sessions per day, cold vs warm cache ratio)
- `search_performed` (queries per session, length distribution)
- `search_cache_hit` (effectiveness of searchCache — we don't even know if the 5-min TTL is right)
- `search_no_results` (queries failing — typo rate, coverage holes)
- `search_result_tapped` (which section: library vs youtube, position in list)
- `search_artist_tap` (artists tab conversion)
- `search_timeout` (YT API 4s timeout hits)

**Fix:** Add `logPlaybackEvent({ event_type: 'trace', meta: { subtype: 'search_*', ... } })` at the key points:
- `isOpen` → fires on mount (search_opened)
- `performSearch` start: `{ subtype: 'search_performed', q_len, from_cache: bool }`
- Empty-result branch: `{ subtype: 'search_no_results', q_len, q_hash }`
- `handleSelectTrack`: `{ subtype: 'search_result_tapped', source, position, q_hash }`
- `onArtistTap`: `{ subtype: 'search_artist_tap', artist }`

Hash the query client-side (not the raw text — privacy) so we can correlate repeat queries without storing PII.

---

### P1-3 — Prefetch fires twice per search

**Location:** `services/api.ts:68-81` fires `oyo.prefetch` on top-3 at priority 10 + rest at priority 7. `SearchOverlayV2.tsx:273-276` ALSO calls `prefetchTrack(r.voyoId)` on top-3 as a separate `useEffect`.

`prefetchTrack` hits `/prefetch?v=...` (worker endpoint), `oyo.prefetch` hits `voyo_upload_queue` via the lane pipeline. Two different systems, overlapping intent.

Probably fine today (worker is cheap), but it's duplicated warmup work and doubles worker requests during heavy search. Single path is cleaner — the `oyo.prefetch` route is already the canonical one (matches the commit contract at `oyo/app.ts:30-32`). Drop the `useEffect` in SearchOverlayV2.

---

### P1-4 — Library filter collapses when query has typos

**Location:** `SearchOverlayV2.tsx:694-695` (artists), plus the DB RPC at 378-398

Artists tab filter:
```ts
ARTIST_LIST.filter(a =>
  a.canonical_name.toLowerCase().includes(query.toLowerCase()) ||
  a.normalized_name.includes(query.toLowerCase())
)
```

Pure substring, no fuzzy. "bruna" → 0 hits. "burnaboy" → 0 hits (space matters). Users on mobile mistype often.

Tracks tab goes through `search_tracks_by_vibe` RPC — depends on the DB-side implementation. If it's plain ILIKE `%query%`, same problem. If it's tsquery/trigram, some tolerance.

**Fix (client-side):** For artists, use a simple trigram or Levenshtein on `normalized_name` when substring returns 0 results. The list is 700 entries; brute-force Levenshtein is <1ms.

```ts
// After the substring filter
if (artistMatches.length === 0 && query.trim().length >= 3) {
  artistMatches = ARTIST_LIST
    .map(a => ({ a, d: levenshtein(query.toLowerCase(), a.normalized_name) }))
    .filter(x => x.d <= 2)
    .sort((x, y) => x.d - y.d)
    .slice(0, 10)
    .map(x => x.a);
}
```

For tracks, look at whether `search_tracks_by_vibe` uses `pg_trgm`. If not, that's a DB-side migration.

---

### P1-5 — `onEnterVideoMode` opens portrait iframe at z:60, covers the search

**Location:** `App.tsx:803-805`, `YouTubeIframe.tsx:649-665`

The comment at `App.tsx:1071-1075` claims: *"openVideoOverlay flips videoTarget to 'landscape' so the global iframe renders BEHIND the search backdrop (z:40 under search's z:50 + bg-black/80 blur)"*.

But `openVideoOverlay` actually sets `'portrait'`, not `'landscape'`. `portrait` is `zIndex: 60`, which is **above** SearchOverlay's `z:50`. So instead of "blurred video behind the search", users get a 208×208 draggable mini-video floating ABOVE the search, obscuring 208px of results and stealing tap events in that zone.

Is this intentional or a regression from the comment? If intentional (floating preview mini), update the comment + verify the draggability doesn't conflict with the search results scroll. If unintentional, switch to `'landscape'`:

```ts
const openVideoOverlay = useCallback(() => {
  usePlayerStore.getState().setVideoTarget('landscape');
}, []);
```

That matches the comment — iframe fullscreen at z:40, search's `z:50` stays on top. User sees blurred video through the backdrop.

---

### P1-6 — `syncSearchResults` writes every result to `video_intelligence` on every search

**Location:** `SearchOverlayV2.tsx:438`, `services/databaseSync.ts:130-147`

Every completed search calls `syncSearchResults(prev)` which upserts 25-50 rows into the DB via `videoIntelligenceAPI.batchSync`. There IS a dedupe (`recentlySynced` Map in databaseSync.ts) but it doesn't scope to *this browser's actions* well — a user doing 5 searches in 5 minutes syncs 125 rows, most duplicates already in the DB.

Upsert is idempotent so data doesn't corrupt, but it's unnecessary RPC traffic on every search. Given the P0-1 cache poisoning bug, right now this is **also syncing stale/poisoned results when a query returns empty** — stamping the DB with "the response to query X is these Burna tracks" indirectly.

**Fix:** After P0-1 is fixed (so `prev` is always the real results), add a query-level dedupe inside `syncSearchResults` — don't sync the same query twice within 30 minutes, even if results differ. Or move the sync to `handleSelectTrack` — only persist tracks the user actually engaged with.

---

### P1-7 — Artist tap loses the search context (personalization + plan signal)

**Location:** `ArtistPage.tsx:535-541` → `App.tsx:1088-1100`

SearchOverlay's `handleSelectTrack` (line 488-497) does:
```ts
addSearchResultsToPool([track]);      // personalization hydration
app.playTrack(track, 'search');
oyaPlanSignal('search_play', track.artist);
onEnterVideoMode?.();
```

ArtistPage's `handlePlayTrack` does just:
```ts
app.playTrack({ ... }, 'artist');
```

Missing:
- `addSearchResultsToPool` — the artist's tracks never enter the personalization pool, so the taste graph doesn't see them.
- `oyaPlanSignal('search_play', artist)` or `oyaPlanSignal('artist_play', artist)` — no plan-layer hint for the DJ.
- No `onEnterVideoMode` — so user doesn't see the iframe floating; they have to manually switch mode to watch the video.

**Fix:** Either wrap `onPlayTrack` in App.tsx to fan out the same signals, or centralize this logic in `app.playTrack` itself keyed off the `source` param:

```tsx
// App.tsx
onPlayTrack={(trackId, title, artist) => {
  const track = { id: trackId, trackId, title, artist, ... };
  addSearchResultsToPool([track]);
  oyaPlanSignal('artist_play', artist);
  app.playTrack(track, 'artist');
  openVideoOverlay();
}}
```

Better: add a new `playSource='artist'` branch inside `oyo/app.ts:playTrack` that does the fanout so every caller gets it for free.

---

### P1-8 — `SearchOverlayV2` drops `duration` + `views` on artist-tap `resultToTrack`

**Location:** `SearchOverlayV2.tsx:468-481`

```ts
const resultToTrack = useCallback((result: SearchResult): Track => ({
  ...
  oyeScore: result.views || 0,
  duration: 0,         // ← always 0, ignoring result.duration
  ...
}), []);
```

`SearchResult` has `duration` (line 22 api.ts) but `resultToTrack` hard-codes `duration: 0`. Downstream:
- `ensureTrackReady` uses `duration` for lane priority heuristics.
- `boostTrack` (via OYÉ) passes 0, breaking "how long to keep in cache" heuristics.
- MediaSession `metadata.duration` stays 0 until the iframe reports it, showing 0:00 briefly on the lock screen.

**Fix:** `duration: result.duration || 0`. Tiny 1-char fix.

---

### P1-9 — `AlbumSection` + `VibesSection` useBackGuard uses non-unique names across siblings

**Location:** `AlbumSection.tsx:32`, `VibesSection.tsx:99`

```ts
useBackGuard(!!selectedAlbum, () => setSelectedAlbum(null), 'album-detail');
useBackGuard(!!selectedVibe, () => setSelectedVibe(null), 'vibe-detail');
```

Each has a unique name, but both are mounted as children of SearchOverlayV2 simultaneously (when `activeTab === 'albums'` + user previously opened a vibe, the vibe section unmounts via `{activeTab === 'vibes' && <VibesSection ...>}`). So only one lives at a time via the tab render gates — OK in practice.

However: if a user opens SearchOverlayV2 → taps Albums tab → opens an album detail → switches to Vibes tab without backing out → the AlbumSection unmounts with `selectedAlbum` still set. The `useBackGuard` cleanup fires (line 42-54 of useBackGuard.ts) with `closingFromPop=false`, tries `window.history.back()` because the marker is still on top. **That back navigation could peel the parent SearchOverlay's own pushed marker** if AlbumSection's marker wasn't the topmost.

The hook stacks correctly when siblings mount/unmount in the right order, but tab switches that unmount a guard mid-flight are a known fragile edge case. Minor because the tab UI makes this rare.

---

### P1-10 — Search input autofocus on mount fires a `setTimeout(100)`, vulnerable to overlay race

**Location:** `SearchOverlayV2.tsx:298-301`

```ts
useEffect(() => {
  if (isOpen && inputRef.current) {
    setTimeout(() => inputRef.current?.focus(), 100);
  }
  ...
}, [isOpen]);
```

If a keyboard-equipped user opens search, taps a result, `onEnterVideoMode` fires → floating iframe mounts → some other overlay steals focus, the 100ms focus race may lose.

Also: on iOS Safari, `.focus()` on an input only opens the soft keyboard if invoked synchronously from a user gesture. The 100ms setTimeout breaks the gesture chain — **soft keyboard doesn't open on iOS when search opens**. Users have to tap the input themselves.

**Fix:** Move the focus call out of setTimeout and into a useLayoutEffect OR invoke focus synchronously inside the `onClick` that opens search (preferred — gesture chain preserved). Keep the setTimeout as a fallback only.

---

## P2 Findings (nits)

### P2-1 — ARTIST_LIST built from JSON every module load
`SearchOverlayV2.tsx:168-173` — `Object.values(...)` on every import. Fine if module cached, but adjacent `import artistMasterData` in `useArtist.ts` does the same work. Consider a shared `artistList.ts` that exports both map + values.

### P2-2 — `COUNTRY_FLAGS` duplicated in 2 files
`SearchOverlayV2.tsx:176-182` and `ArtistPage.tsx:28-44` have the same 15-country map. `COUNTRY_NAMES` exists only in ArtistPage. Extract to `src/lib/countries.ts`.

### P2-3 — `handleSelectTrack` doesn't save the query to history
`SearchOverlayV2.tsx:488-497` — after the tap, the query that led here isn't saved. As noted in P1-1, this is actually the RIGHT place to save. Today, saves happen on DB-results-arrive which pollutes the list.

### P2-4 — Empty-state race between "still searching" and "no results"
`SearchOverlayV2.tsx:820-825` renders "No results for X" when `!isSearching && query.length >= 2 && results.length === 0 && !error`. But when `query.length === 1`, `performSearch` early-returns at `:335`, and neither sets loading nor error — the input shows a character but no feedback. Adding a "keep typing…" ghost would be warm-it-up aligned.

### P2-5 — `searchCache` max size 50, TTL 5min — is it right?
`utils/searchCache.ts:19`. Never measured (no telemetry). Could be way under-sized for power users; could be wasteful for casual. See P1-2.

### P2-6 — VibesSection background check for "African vibes" uses regex on untrimmed strings
`VibesSection.tsx:59-63` — regex doesn't tokenize. "Africa" matches, "Afrikaans" matches (intended?), "Africana" matches. Probably intentional for warmth, but flag it so future category additions don't trip it.

### P2-7 — ArtistPage avatar uses `getInitials`, fails on single-word-diacritic artists
`ArtistPage.tsx:93-97` — `"N'Dour".substring(0,2)` = "N'" (with apostrophe). Looks weird. Filter out non-letters.

### P2-8 — `discoverMore` in useArtist has no AbortController
`useArtist.ts:192-232` — if user taps Discover, then closes ArtistPage, the fetch completes and `setSearchResults` fires on unmounted component. React 19 tolerates it but logs a warning. Add an AbortController + unmount cleanup.

---

## Scenarios I Tried to Break (and What Happened)

### Scenario A: User types fast → spams Recent
- Debounce 120ms after 3 chars. Fast typist (100wpm ≈ 500chars/min) = keystroke every 120ms → debounce barely kicks in.
- Each completed DB fetch saves to Recent (P1-1).
- Recent fills with "b, bu, bur, burn, burna" junk. Real behavior confirmed by reading the code path. ✗ (P1-1)

### Scenario B: Type query, get results, type gibberish, get empty
- Step 1: "burna" → cache hit or fresh, results visible.
- Step 2: "xyzzz" → `handleSearch` doesn't clear (line 449-450, "keep showing previous"). `performSearch` runs, DB=[], YT=[].
- Step 3: Line 426 skip (no `setResults`). Line 435 `setResults(prev => ...)` sees `prev.length > 0` (burna still in state) and CACHES IT under "xyzzz". ✗ (P0-1)
- Step 4: User clears, retypes "xyzzz" → cache hit, "xyzzz" instantly shows Burna results. ✗✗ 

### Scenario C: Tap artist, then back
- Tap artist → App.tsx:1079 fires `setArtistPageName(name); closeSearch();`.
- `closeSearch` pops the search back-marker, closes the overlay.
- ArtistPage opens as `artistPageName` becomes truthy.
- System back gesture → no useBackGuard on ArtistPage → popstate finds no marker → navigates back in app history → exits app on fresh session. ✗ (P0-3)

### Scenario D: Tap a less-popular artist
- e.g. "Salatiel" (tier B, Cameroon, not R2-heavy).
- `fetchTracks` returns say 30 rows, `cached.length = 2`, returns the 2.
- UI shows 2 tracks → or, if 0 cached, shows "No tracks found in our library yet."
- User taps Discover More → YouTube fetch → supplements. But the page already felt empty. ✗ (P0-2)

### Scenario E: Open search while in Landscape mode
- `App.tsx:408` tracks `isLandscape`. SearchOverlay renders over the existing fullscreen layout.
- No orientation-specific code in SearchOverlayV2. Tap result → `openVideoOverlay` → `'portrait'` (P1-5). User in landscape gets a 208x208 floating mini centered on a wide screen — odd positioning, drag to reposition still works.
- In landscape, `isLandscape` home feed renders `LandscapeVOYO`. SearchOverlay renders over it at z:50. Backdrop z:40. Works, but the iframe conflict from P1-5 is worse in landscape (user expected landscape playback, got portrait mini).

### Scenario F: Typo tolerance
- "buna" → ARTIST_LIST substring filter → 0 hits. No fuzzy fallback. (P1-4)
- Tracks tab depends on DB RPC — not audited here.

### Scenario G: Supabase down mid-search
- `dbPromise` catches via `(err) => { devWarn(...); return []; }` (line 396). ytPromise similar.
- Both empty → line 426 skip → line 435 the stale-prev bug fires (P0-1 again).
- If prev was empty, `setError('No results found...')` fires inside the setter. Browser tolerates; error renders. But message says "No results" when real problem is "Supabase down". User-facing wrong message.

### Scenario H: Keyboard ArrowDown past end of results
- Line 611: `(i + 1) % results.length` → wraps correctly.
- Line 613: `(i <= 0 ? results.length - 1 : i - 1)` → wraps correctly.
- Enter on empty results (before Arrow): `activeIndex = -1` → target = `results[0]` (line 617) → if results.length === 0, target undefined, `if (target) handleSelectTrack(target)` guards. Safe. ✓

---

## Signal Loop & Warm-it-up Audit

**Where the philosophy breaks in this scope:**

1. **"No retry buttons"** — ArtistPage's "Search YouTube for more X tracks" at line 708 is exactly a retry button, shown when our library is thin. It's aesthetic (subtle, not shouting) but it's still "hey user, click to fix this for me." A warmer approach: auto-trigger discoverMore on mount when `tracks.length < 5`, render results inline, no button. Already loaded by the time the user scrolls past Library.

2. **"Latency as design feature"** — The `isSearching` spinner is a VinylLoader — good. But the prefetch of top-3 (lines 273-276 + api.ts:68-81) isn't telegraphed to the user. Consider a subtle pulse on the top 3 cards indicating "getting these ready" — warm-up as visible affection.

3. **"No dead-air, always warm"** — P0-2 (empty ArtistPage) and P0-1 (cache poisoning) both violate this. ArtistPage dead-ending, and cache returning stale data silently, are both "dry" moments.

4. **Back gesture peel** — P0-3 breaks the "tactile navigation" feel. Modern PWA users EXPECT back to peel layers; exiting the app on back in an overlay feels broken.

---

## File:Line Quick-Ref

| Issue | File | Line |
|---|---|---|
| Cache poisoning via stale prev | SearchOverlayV2.tsx | 435-443 |
| ArtistPage r2_cached-only filter | useArtist.ts | 277-308 |
| No back-guard on ArtistPage | ArtistPage.tsx | 509-583 |
| Search → artist no back-peel | App.tsx | 1079 |
| Recent pollution on partial-query DB hits | SearchOverlayV2.tsx | 411-413, 428 |
| No search telemetry | SearchOverlayV2.tsx | entire file |
| Double prefetch (api.ts + overlay effect) | api.ts:68-81 + SearchOverlayV2.tsx | 273-276 |
| Typo tolerance missing (artists) | SearchOverlayV2.tsx | 694-695 |
| openVideoOverlay uses 'portrait' not 'landscape' (comment lies) | App.tsx:803-805 + YouTubeIframe.tsx | 649-665 |
| syncSearchResults on every search (DB churn) | SearchOverlayV2.tsx:438 + databaseSync.ts | 130-147 |
| Artist tap loses personalization+plan signals | ArtistPage.tsx:535-541 + App.tsx | 1088-1100 |
| resultToTrack duration hard-coded 0 | SearchOverlayV2.tsx | 468-481 |
| Autofocus via setTimeout breaks iOS keyboard | SearchOverlayV2.tsx | 298-301 |
| Sibling back-guard tab-switch race | AlbumSection.tsx:32 + VibesSection.tsx | 99 |
| discoverMore has no AbortController | useArtist.ts | 192-232 |

---

## Cross-reference with AUDIT-4-queue-selection.md

The `getPlayedTrackIds` bug called out in AUDIT-4 (P0-2) has been **fixed** — `databaseDiscovery.ts:135-152` now reads `state?.history ?? state?.state?.history` with proper `trackId ?? id` fallback. So the discovery-side history-exclusion is alive.

Search-side equivalent to watch for: Recent history pollution (P1-1) is the search analog of "stale state-shape assumptions" — both are "read from the wrong source, get wrong data silently." The fix pattern is the same: tighten the write path (only save on explicit intent).

---

## Recommended Fix Order (by blast radius / effort ratio)

1. **P0-1 cache poisoning** — 5-line fix, major user-facing impact. Just stop closure-reading stale state.
2. **P1-8 duration hard-coded 0** — 1-char fix. Free win for MediaSession + lane heuristics.
3. **P1-5 openVideoOverlay 'portrait' vs 'landscape'** — clarify intent, 1-line fix either way.
4. **P0-3 back-gesture peel** — add `useBackGuard` to ArtistPage + remove `closeSearch()` from onArtistTap. Two lines, big UX win.
5. **P0-2 ArtistPage uncached fallback** — fall back to `rows` when `cached` empty. 1-line change.
6. **P1-1 Recent pollution** — move `saveToHistory` to `handleSelectTrack`. 3-line change.
7. **P1-2 search telemetry** — ~6 log points. Medium effort, foundational.
8. **P1-7 artist tap signal parity** — centralize in oyo/app.ts. Medium effort, cleanliness win.
9. **P1-4 fuzzy artist search** — small Levenshtein, self-contained. Easy.
10. **P1-10 iOS autofocus** — tricky (gesture chain), worth validating on device.

---
