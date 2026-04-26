# Stores & State Audit (Audit 2)

Department: STORES & STATE. Files: `playerStore.ts`, `r2KnownStore.ts`, `warmingStore.ts`, `preferenceStore.ts`, `downloadStore.ts`, `intentStore.ts`, `reactionStore.ts`, `trackPoolStore.ts`, `oyoStore.ts`, `universeStore.ts`, `playlistStore.ts`.

Each finding verified with file:line + code excerpt. Glitch / race / leak only.

---

## [P1] downloadStore.boostTrack — stale Map snapshot loses concurrent boost entries
**File:** src/store/downloadStore.ts:201-226
**What:**
```ts
boostTrack: async (trackId, title, artist, duration, thumbnail) => {
  const normalizedId = decodeVoyoId(trackId);
  const { downloads, manualBoostCount, autoBoostEnabled, boostStartTimes } = get();   // ← snapshot at line 201
  ...
  set({ boostStartTimes: { ...boostStartTimes, [normalizedId]: boostStartTime } });   // ← line 205, spread of stale snapshot

  // Update status to downloading
  const newDownloads = new Map(downloads);                                             // ← line 224, fresh Map from STALE snapshot
  newDownloads.set(normalizedId, { trackId: normalizedId, progress: 0, status: 'downloading' });
  set({ downloads: newDownloads });                                                    // ← line 226, OVERWRITES any concurrent set
```
**Why it's a bug:** `get()` is called once at line 201 and `downloads` / `boostStartTimes` are then re-written via spread/clone using that captured snapshot. There is an `await getTrackQuality(normalizedId)` at line 214 — the `await` releases the microtask queue, and any concurrent boost (B) that fires in that window will also `set({ downloads: ... })` from the same captured snapshot. Whichever finishes its `set()` last wins, and the loser's `'downloading'` entry is gone. Two paths trigger this in practice: (1) addReaction's auto-boost on OYE (`playerStore.ts:1788-1804`) firing while the user manually taps Boost on a different track; (2) two cards fast-tapped from a roulette / playlist injection. The progress callback at line 252 uses fresh `get().downloads`, so the entry self-heals once download progress lands, but the UI briefly shows no entry for one of the two tracks.

The same captured-snapshot pattern poisons the early-return branch at line 216-218, the auto-boost-prompt counter at line 284-294 (`newCount = manualBoostCount + 1` from stale snapshot — manualBoostCount under-counts when two boosts complete simultaneously, delaying the auto-boost prompt), and `queueDownload` at line 397-399.

**Repro:** Tap two non-R2 search results within ~50ms (faster than the `await getTrackQuality` round-trip). Inspect `useDownloadStore.getState().downloads` — only one of the two appears as `'downloading'` until the loser's first progress callback (~500ms) lands.
**Fix sketch:** Convert all three set() calls to the `set((state) => ({ downloads: new Map(state.downloads).set(...), boostStartTimes: { ...state.boostStartTimes, ... } }))` callback form, same as `setPrefetchStatus` (playerStore.ts:1897). For the manualBoostCount counter, also move the increment inside the callback.

---

## [P2] warmingStore — module-level Map of setTimeouts grows with every non-R2 tap, never cleared on R2 confirmation
**File:** src/store/warmingStore.ts:28-46
**What:**
```ts
const _timers = new Map<string, ReturnType<typeof setTimeout>>();
const SAFETY_MS = 60_000;

markWarming: (trackId) => {
  ...
  _timers.set(id, setTimeout(() => {
    get().clearWarming(id);
  }, SAFETY_MS));
},
```
**Why it's a bug:** `clearWarming` is called in exactly two places: (1) the 60s self-fired safety timer (line 45), and (2) explicit external calls — but `grep -rn "clearWarming(" src` returns ZERO callers outside the warmingStore itself. The MAP.md claim that "r2KnownStore later confirms the track, consumers prefer known over warming visually" is correct for the OyeButton's `inDisco` derivation (computeOyeState at OyeButton.tsx:137-153) but the `warming` Set is never proactively pruned. Consequence: every tap on a non-R2 search/feed result keeps the entry alive for the full 60s + holds a setTimeout in `_timers`, even when R2 lands in 5s. Worse — `SearchOverlayV2` subscribes to the entire `warming` Set (`useWarmingStore(s => s.warming)` at SearchOverlayV2.tsx:250). Every additional warming entry is a new Set identity → SearchOverlayV2 re-renders. A user fast-tapping 30 search results in a minute creates 30 Set re-allocations + 30 active setTimeouts + 30 SearchOverlayV2 re-renders even when R2 lands instantly for all of them.

This is bounded (60s self-cleanup, max ~hundreds of pending entries) so it's not catastrophic, but the timer-Map grows linearly with tap rate during burst use and SearchOverlayV2 churns on every entry.

**Repro:** Open SearchOverlayV2, tap 20 search results in 5 seconds. Inspect `useWarmingStore.getState().warming.size` — it stays at 20 for ~55 more seconds even if all 20 land in r2KnownStore within 10s. Re-render count on SearchOverlayV2 ≥ 20 from this source alone.
**Fix sketch:** Subscribe `r2KnownStore` to its own `add` and call `useWarmingStore.getState().clearWarming(id)` whenever a track lands in R2. Cleanest place is inside r2KnownStore.add itself — after the set, if `useWarmingStore.getState().warming.has(id)`, fire `clearWarming(id)`. This auto-prunes the Set + timers Map the moment R2 confirms.

---

## [P2] playerStore.nextTrack / prevTrack — playbackSource not reset, OyeButton briefly shows wrong "cooking" state on auto-advance
**File:** src/store/playerStore.ts:856-865 (queue path), 1085-1093 (discover path), 1158-1167 (prevTrack path)
**What:**
```ts
// nextTrack queue path:
set({
  currentTrack: nextPlayable.track,
  queue: rest,
  isPlaying: true,
  progress: 0,
  currentTime: 0,
  seekPosition: null,
  playbackRate: 1,
  isSkeeping: false,
});      // ← no playbackSource: null
```
Compare with `setCurrentTrack` (line 508-518) which DOES include `playbackSource: null`.

**Why it's a bug:** When auto-advance fires (queue or discover), `currentTrack` flips to track B but `playbackSource` retains the OLD track A's value (`'iframe'` or `'r2'`). OyeButton (OyeButton.tsx:196-200) reads two independent selectors:
```ts
const isCurrent = usePlayerStore(s => s.currentTrack?.trackId === track.trackId || ...);
const isIframe = usePlayerStore(s => s.playbackSource === 'iframe');
const isActiveIframe = isCurrent && isIframe;
```
For ~one render frame after `nextTrack()` lands, OyeButton for track B sees `isActiveIframe = true` even when B will play directly from R2. `computeOyeState`'s branch `if (isActiveIframe && !inDisco) return 'bubbling'` (OyeButton.tsx:152) flips B's button to purple cooking. AudioPlayer's track-change effect then runs, calls `setSource('r2')` via `setPlaybackSource`, and the button flips back to `gold-faded` / `grey-faded`. Visible flicker on every auto-advance from an iframe-played track.

If B is in r2KnownStore (`isInR2 = true`) the bubble is suppressed by `inDisco` — so the flicker is only visible when B is *not* known to be in R2 yet. Common case for a fresh discover-pool track immediately after iframe playback.

**Repro:** Play a track that falls back to iframe (currentTrack.duration < 300 won't even hot-swap, but iframe path will engage). Let it auto-end. Watch the OyeButton on the next track — observe ~1 render frame of purple bubble before it settles to grey.
**Fix sketch:** Add `playbackSource: null` to the three `set()` calls in nextTrack queue path, nextTrack discover path, and prevTrack history path. Matches setCurrentTrack's existing convention. Single-line fix per site.

---

## [P2] playerStore — in-memory `history` array grows unbounded; repeat-all queue rebuild can balloon
**File:** src/store/playerStore.ts:1500-1511 (addToHistory), 923-963 (repeat-all rebuild)
**What:**
```ts
addToHistory: (track, duration) => {
  set((state) => ({
    history: [
      ...state.history,            // ← unbounded: every play appends
      { track, playedAt: ..., duration, oyeReactions: 0 },
    ],
  }));
  // PERSISTED state truncates to -50 (line 1518), but in-memory history keeps growing
```
And the repeat-all rebuild iterates ALL of in-memory history:
```ts
const historyTracks = state.history.map(h => h.track);   // ← line 931, no slice
const uniqueTracks: Track[] = [];
const seenIds = new Set<string>();
for (const track of historyTracks) {
  if (trackId && !seenIds.has(trackId)) { ... uniqueTracks.push(track); }
}
// later:
const newQueue: QueueItem[] = restTracks.map(track => ({ track, ... }));
set({ ..., queue: newQueue });
```
**Why it's a bug:** Per-track addToHistory (called from setCurrentTrack:500, nextTrack queue path:851, nextTrack discover path:1077, plus the addToHistory action itself which other paths invoke) appends to in-memory `state.history` with no upper bound. Over a long session (1000 tracks played), in-memory history is 1000 entries. The `slice(-40)` calls in nextTrack/predictNextTrack (lines 976, 1224, 1281) only READ a tail window — they don't compact storage. `slice(-50)` in addToHistory's persist path (line 1518) only affects what's *written* to localStorage; the live `state.history` keeps all 1000.

The repeat-all rebuild (line 931) maps the entire in-memory history into a queue. After a 1000-track session, toggling repeat-all when the queue empties triggers a `set({ queue: 1000-item array })` → React reconciliation through every Queue subscriber (VoyoPortraitPlayer, VoyoBottomNav, etc.) for a giant array. Also each QueueItem holds a Track reference, keeping cover URLs / metadata alive.

Memory cost is moderate (a Track object is small) but the queue-rebuild cost is real.

**Repro:** Auto-play 200 tracks. `usePlayerStore.getState().history.length === 200`. Set repeatMode='all', clear queue, call nextTrack(). Observe queue rebuild with 200 entries; React commits visible jank.
**Fix sketch:** In addToHistory, cap in-memory history at e.g. 100 entries: `history: [...state.history.slice(-99), newEntry]`. Matches the persist truncation cadence. Also slice the source in repeat-all rebuild: `state.history.slice(-100).map(h => h.track)`.

---

## [P2] reactionStore.pulseCategory — 30s setTimeout stack on burst reactions, each fires a redundant set()
**File:** src/store/reactionStore.ts:484-508
**What:**
```ts
pulseCategory: (category) => {
  set((state) => ({
    categoryPulse: {
      ...state.categoryPulse,
      [category]: { ...state.categoryPulse[category], count: count + 1, isHot: true },
    },
  }));

  // Reset hot state after 30 seconds
  setTimeout(() => {
    set((state) => ({
      categoryPulse: {
        ...state.categoryPulse,
        [category]: { ...state.categoryPulse[category], isHot: false },
      },
    }));
  }, 30000);
},
```
**Why it's a bug:** Every reaction (local OYE or realtime postgres INSERT received via the channel at line 410-449) calls `pulseCategory`. Each call schedules a NEW 30s setTimeout that flips `isHot` to false — even though the previous timer hasn't fired yet. Five reactions in five seconds → five pending 30s timers, all stacked, each will independently fire `set({ ..., isHot: false })` between t=30 and t=35. After the first one fires, `isHot` is already false; the next four are no-op set() calls but they still trigger Zustand notification → all subscribers (`recentReactions` consumers, MixBoard pulse readers) re-render.

Worse: during a viral burst (50 realtime INSERTs/min on a hot track), 50 pending timers and 50 redundant set() ripples. No timer cleanup if the user navigates away or reactions stop arriving.

**Repro:** In console: `for (let i=0;i<10;i++) useReactionStore.getState().pulseCategory('party-mode')`. Observe 10 pending setTimeouts via DevTools Performance. After 30s, 10 set() ripples.
**Fix sketch:** Track per-category timer in a module-level `Map<ReactionCategory, ReturnType<typeof setTimeout>>`. On pulseCategory, `clearTimeout(timers.get(category))` before scheduling the new one. Keeps exactly one pending timer per category — the latest one wins, which is what the UX wants anyway (hot extends with each new reaction).

---

## [P2] universeStore.viewUniverse — portal subscription leaks if user views a second portal without leaving the first
**File:** src/store/universeStore.ts:463-478
**What:**
```ts
// If portal is open, subscribe to real-time updates
if (result.portalOpen) {
  const subscription = universeAPI.subscribeToUniverse(username, (payload) => { ... });
  set({ portalSubscription: subscription });   // ← overwrites any prior subscription without unsubscribing
}
```
**Why it's a bug:** `viewUniverse` can be called repeatedly (route change to `/another-username`). If the user is viewing portal A and navigates to portal B without going through `leaveUniverse`, the new subscription is created and `portalSubscription` is overwritten with B's channel. A's RealtimeChannel is never `unsubscribe()`'d — it stays connected to Supabase, keeps consuming bandwidth, and fires its now-orphaned callback (which calls `set({ viewingUniverse: ... })` based on stale closure data). The orphaned A callback writes B's `viewingUniverse` slot with A's payload, racing B's legitimate updates.

Also: even the early-return `if (result.portalOpen)` branch at line 464 skips creating a subscription. If user goes from portal A (open) → portal B (closed, no subscription created) → portal C (open), the A channel from step 1 was never cleaned up.

**Repro:** Visit `/userA` (portalOpen=true). Without clicking back, change URL to `/userB`. Inspect `portalSubscription` — references B's channel, A's is orphaned but still receiving INSERT events from Supabase. Network tab shows two active websocket subscriptions on the supabase realtime endpoint.
**Fix sketch:** At the top of viewUniverse (after the same-username early return), unconditionally:
```ts
const prev = get().portalSubscription;
if (prev) { universeAPI.unsubscribe(prev); set({ portalSubscription: null }); }
```
Matches the unsubscribe pattern in `leaveUniverse` (line 491-494).

---

## [P2] playerStore.setCurrentTrack — `_trackChangeCount` module-level counter races recommendation refresh
**File:** src/store/playerStore.ts:68, 550-558
**What:**
```ts
let _trackChangeCount = 0;
...
setCurrentTrack: (track) => {
  ...
  if (_trackChangeCount++ % 3 === 0) {
    const refreshTimeoutId = setTimeout(() => {
      if (!signal.aborted) {
        get().refreshRecommendations();
      }
    }, 500);
    signal.addEventListener('abort', () => clearTimeout(refreshTimeoutId));
  }
```
**Why it's a bug:** `_trackChangeCount` is module-scoped and incremented on every setCurrentTrack call. If three tracks are set in rapid succession (rapid skip / playlist injection), all three increment but only one triggers refresh (modulo 3). The intent is "every third track change refreshes" but because the counter is shared across all callers and never resets, the cadence depends on session-cumulative count — not per-session-meaningful. After 10000 tracks it still fires at 10001, 10004, 10007. Functional but the deterministic pattern means it can correlate with audio glitches (refreshRecommendations triggers `gateToR2` for two pools — a 50+50-track HEAD-probe burst). With non-shuffled rapid skipping, every third skip predictably fires this storm.

Bigger concern: `refreshRecommendations` itself spawns `getDatabaseDiscovery().then(async (discovery) => { ... })` (line 1558) which awaits, calls `gateToR2` (network), then writes `set({ hotTracks, discoverTracks })`. No abort signal is plumbed through this chain. If the user skips 5 tracks while the refresh is in flight, the OLD refresh's stale `hotTracks` overwrites whatever's relevant for the current track.

**Repro:** Skip 6 tracks in 500ms. Two refreshRecommendations fires kick off concurrent gateToR2 round trips (~500ms each). Whichever finishes second writes its result, possibly stomping the more relevant first. Telemetry trace `nt_pool_refill_kick` (also fires concurrent refreshes) compounds this.
**Fix sketch:** Reset `_trackChangeCount = 0` whenever the user explicitly seeks/plays a new track from a surface (vs auto-advance). And/or thread the abort signal into refreshRecommendations so a newer call cancels the older.

---

## [P2] downloadStore.processQueue — module-level `isProcessing` + downloadQueue can wedge if exception escapes the inner try/catch
**File:** src/store/downloadStore.ts:109-110, 405-438
**What:**
```ts
const downloadQueue: Array<{ ... }> = [];
let isProcessing = false;

processQueue: async () => {
  if (isProcessing || downloadQueue.length === 0) return;
  isProcessing = true;
  ...
  while (downloadQueue.length > 0 && iterations < MAX_ITERATIONS) {
    const item = downloadQueue.shift();
    if (!item) continue;
    try {
      await get().boostTrack(...);
    } catch (error) { devWarn(...); }
    await new Promise(resolve => setTimeout(resolve, 500));
    iterations++;
  }
  ...
  isProcessing = false;
},
```
**Why it's a bug:** `boostTrack` itself has an outer try/catch (line 228, 311) so most errors are caught. BUT `getTrackQuality` (line 214) is `await`ed *before* the try block. If IndexedDB fails (Safari quota exceeded, private browsing) the rejection bubbles uncaught from `boostTrack`, escapes processQueue's inner try (which only wraps the call), then the `await new Promise(resolve => setTimeout(resolve, 500))` runs. Wait — re-reading: the inner try at line 419 DOES wrap `await get().boostTrack(...)`, so a rejection from boostTrack is caught. OK. But a rejection from the `await new Promise(setTimeout)` at line 428 (impossible) or an exception in the loop predicate is NOT.

Actual bug here is more subtle: the module-level `downloadQueue` array and `isProcessing` flag are NOT cleaned up on logout / account switch / clearAllDownloads. `clearAllDownloads` (line 464-471) clears the Map and IndexedDB but does NOT touch `downloadQueue` (the in-flight queue) or `isProcessing`. After clearAllDownloads, if the user re-queues a track via auto-boost, processQueue's `if (isProcessing) return` at line 406 might still be true if a previous run got stuck (wedged on a pre-clear download that never resolved because IndexedDB was wiped underneath it). The queue then never drains — auto-boost silently stops working until page reload.

**Repro:** Trigger 5 auto-boosts (quota near limit). Mid-flight, call `clearAllDownloads()`. The in-flight `boostTrack` calls write to IndexedDB that no longer has the right schema → underlying writes hang. `isProcessing` stays true. Subsequent `queueDownload` calls succeed at adding to the queue but `processQueue` returns immediately due to `isProcessing` guard. Auto-boost wedges.
**Fix sketch:** In `clearAllDownloads`, also `downloadQueue.length = 0; isProcessing = false`. Also wrap the entire `while` loop body in a try/finally that resets `isProcessing = false` before re-throwing.

---

## Summary
- 1 P1 (boostTrack stale-snapshot race that drops concurrent download entries from the UI)
- 7 P2 (warming-Set growth, OyeButton flicker on auto-advance, unbounded in-memory history, pulseCategory timer stack, universeStore portal-subscription leak on view-without-leave, _trackChangeCount cadence + concurrent refreshRecommendations, processQueue wedge after clearAllDownloads)
- No P0 found. The store layer is reasonably defensive — most subscribe paths use the callback form of `set()` and the dedup-by-id patterns are correct. The remaining issues are at the boundaries: module-level mutable state without cleanup, captured snapshots before async awaits, and missing cross-store sync (warmingStore ↔ r2KnownStore).
