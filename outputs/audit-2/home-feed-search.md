# Home / Feed / Search Audit (Audit 2)

Department: HOME / FEED / SEARCH. Files: `HomeFeed.tsx`, `Library.tsx`, `StationHero.tsx`, `VibesReel.tsx`, `SearchOverlayV2.tsx`, `AlbumSection.tsx`, `VibesSection.tsx`, `TrackCardGestures.tsx`.

Each finding verified with file:line + code excerpt. Glitch / race / leak only.

---

## [P0] SearchOverlayV2 morphTimerRef + toastTimerRef leak across close → re-open → ghost "Play now" pill for previous tap
**File:** src/components/search/SearchOverlayV2.tsx:224-228, 378-391, 612-628
**What:**
```ts
// 224-228
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// Single morph timer — handleSelectTrack schedules the warming → play_now
// morph 3s out. Rapid taps on different non-R2 results would otherwise
// ping-pong as both timers fire; cancel any pending morph on new tap.
const morphTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// 378-391 — close-on-isOpen=false handler
useEffect(() => {
  if (isOpen && inputRef.current) {
    setTimeout(() => inputRef.current?.focus(), 100);
  }
  if (!isOpen) {
    setResults([]);
    setQuery('');
    setError(null);
    setIsSearching(false);
    setActiveIndex(-1);
    searchIdRef.current++; // cancel any in-flight search
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }
}, [isOpen]);

// 612-628 — handleSelectTrack schedules the morph
showToast({ type: 'warming', trackTitle: track.title });
if (morphTimerRef.current) clearTimeout(morphTimerRef.current);
morphTimerRef.current = setTimeout(() => {
  morphTimerRef.current = null;
  showToast({ type: 'play_now', trackTitle: track.title, onPlayNow: () => { ... } });
}, 3000);
```
**Why it's a bug:** Three timer refs (`morphTimerRef`, `toastTimerRef`, the unguarded focus `setTimeout` at 380) are NEVER cleared on `isOpen=false` and never cleared on unmount. There is no `useEffect(() => () => { ... }, [])` to drain them. The close handler explicitly drains only `debounceRef`. Concrete failure path:

1. User taps non-R2 search row → 3s morph timer scheduled, `markWarming(trackId)`, warming toast shown.
2. User taps × (close) at t=1s. `setResults([])` runs. The card disappears. `morphTimerRef` keeps running.
3. At t=3s, callback fires `showToast({ type: 'play_now', trackTitle, onPlayNow })`. `setToast(...)` runs on the still-mounted-but-hidden component (the `{toast && (...)}` JSX is wrapped in `{isOpen && (...)}` at line 668, so it doesn't render — but state is now stale).
4. User re-opens search 5s later (`isOpen=true`). `toast` state still holds the previous `play_now` payload. `{toast && ...}` renders the ghost "Play now" pill for a track the user navigated away from. Tapping it now calls `app.playTrack(track, 'search')` for the OLD track from the OLD search session. `onEnterVideoMode?.()` opens the float-over for the wrong song.

The `toastTimerRef` is also never cleared on close, so if the previous toast was a `play_now` (7s window), the old timer keeps running and may fire `setToast(null)` mid-new-session, dismissing the *new* warming toast prematurely.
**Repro:** Open Search, type "Wizkid", tap a non-cached row, tap × within 3 seconds. Wait 3s. Re-open Search. The "Play now →" pill appears immediately for the song you'd already abandoned. Tap it — wrong track plays.
**Fix sketch:** Add unmount cleanup `useEffect(() => () => { if (morphTimerRef.current) clearTimeout(morphTimerRef.current); if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);` AND extend the close branch (`!isOpen`) to clear both timers, set `setToast(null)`, and `morphTimerRef.current = null`.

---

## [P1] "in_disco" announcer fires showToast on closed overlay; toast persists into next open
**File:** src/components/search/SearchOverlayV2.tsx:261-272, 382-391
**What:**
```ts
const announcedDiscoRef = useRef<Set<string>>(new Set());
useEffect(() => {
  for (const id of warmingSet) {
    if (r2KnownSet.has(id) && !announcedDiscoRef.current.has(id)) {
      announcedDiscoRef.current.add(id);
      const result = results.find(r => getYouTubeId(r.voyoId) === id);
      if (result) showToast({ type: 'in_disco', trackTitle: result.title });
      break; // one announcement per tick — don't pile up
    }
  }
}, [warmingSet, r2KnownSet, results]);
```
**Why it's a bug:** This effect subscribes to two GLOBAL stores (`warmingStore`, `r2KnownStore`) which mutate independent of `isOpen`. When the user closes Search, this effect remains live (component is mounted). If a track that was warming when Search closed lands in R2 a few seconds later, this effect fires `showToast({ type: 'in_disco', ... })`. Combined with the bug above (toast state isn't reset on close), the next time the user opens Search, the "✦ in Disco · {title}" pill flashes in for a song they were no longer thinking about.

Also note: the effect doesn't gate on `isOpen`. There is no `if (!isOpen) return;`. The effect spends CPU iterating warmingSet on every R2 known-store update across the whole app, even while Search is dismissed.

`announcedDiscoRef` is also never reset — across the full session, it accumulates every track id ever announced. Mostly harmless (Set membership check is O(1)), but a tracked-set leak.
**Repro:** Open Search, tap a non-R2 result, close Search before R2 lands. Wait ~12s for R2 extraction. Re-open Search — "✦ in Disco · {old track}" pill flashes in for a few seconds, even though you're typing a new query.
**Fix sketch:** Gate the effect with `if (!isOpen) return;`. Reset `announcedDiscoRef.current.clear()` in the close branch alongside the timer drains.

---

## [P1] cachedSet /exists/ batch fetches not aborted — typing fast stacks 35-per-query connection backlog
**File:** src/components/search/SearchOverlayV2.tsx:319-348
**What:**
```ts
const [cachedSet, setCachedSet] = useState<Set<string>>(new Set());
useEffect(() => {
  if (results.length === 0) { setCachedSet(new Set()); return; }
  let cancelled = false;
  const ids = results.map(r => r.voyoId).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id));
  // Concurrent /exists/ checks, capped at 25 in-flight   ← claim is wrong, no cap
  const checkOne = async (id: string): Promise<[string, boolean]> => {
    try {
      const res = await fetch(`https://voyo-edge.dash-webtv.workers.dev/exists/${id}`,
        { signal: AbortSignal.timeout(4000) });    // ← only timeout, no user-cancel
      ...
    } catch { return [id, false]; }
  };
  Promise.all(ids.map(checkOne)).then(pairs => {
    if (cancelled) return;
    ...
    if (next.size) markR2KnownMany(Array.from(next));
  });
  return () => { cancelled = true; };
}, [results]);
```
**Why it's a bug:** `cancelled` flag prevents stale `setCachedSet`, but the in-flight HTTP requests keep going. Each search produces up to 35 `/exists/` requests; `Promise.all(ids.map(checkOne))` fires them all in parallel (the comment "capped at 25 in-flight" is wishful — there's no cap). When the user types fast (debounce 120ms for ≥4 chars), `results` updates 4-6× per second. Each update triggers a fresh batch of 35 fetches. Browsers cap concurrent connections per origin at ~6 (Chrome/Edge) so the requests queue up; the latest query's batch waits behind 100+ stale requests. By the time the user finishes typing "kendrick lamar", their final batch of 35 may take 5-10s before connections free up. Symptom: DISCO badges never appear on the final result list, so the fast-path R2 sync never propagates to `r2KnownStore` for the visible results.

Also, `markR2KnownMany` may fire from a stale batch. `cancelled` does guard this (line 334), but only the most recent batch wins — earlier batches' R2-known data is THROWN AWAY. If query A had 12 cached tracks but query B has zero, query A's `markR2KnownMany` never runs because `cancelled` flips before its `then` callback. Net effect: cache hits are lost across rapid typing.
**Repro:** Open Network tab, open Search, type "kendrick" character by character with ~150ms between keystrokes. Watch /exists/ requests pile up in the network panel — 8 keystrokes × 35 = 280 requests, of which only ~6 are active at any time. The DISCO badges don't appear until the queue drains.
**Fix sketch:** Use a single `AbortController` per effect run, pass `controller.signal` to fetch, and call `controller.abort()` in cleanup. Bonus: actually implement the claimed 25-concurrency cap with a small semaphore so you don't saturate the connection pool.

---

## [P1] AfricanVibesVideoCard: `isLoaded` never resets on iframe unmount → first postMessage to remounted iframe is silently dropped
**File:** src/components/classic/HomeFeed.tsx:938-1003
**What:**
```ts
const iframeRef = useRef<HTMLIFrameElement>(null);
const [isLoaded, setIsLoaded] = useState(false);     // ← set true by onLoad, never reset

// Pause/resume via postMessage based on isActive
useEffect(() => {
  if (!iframeRef.current || !isLoaded) return;
  const cmd = isActive ? 'playVideo' : 'pauseVideo';
  iframeRef.current.contentWindow?.postMessage(
    `{"event":"command","func":"${cmd}","args":""}`, '*'
  );
}, [isActive, isLoaded]);

// Mount when in the 3-window. 800ms grace before unmount.
const [shouldMountIframe, setShouldMountIframe] = useState(inWindow);
useEffect(() => {
  if (inWindow) {
    setShouldMountIframe(true);
    return;
  }
  const t = setTimeout(() => setShouldMountIframe(false), 800);
  return () => clearTimeout(t);
}, [inWindow]);

// JSX
{shouldMountIframe && (
  <iframe ref={iframeRef} src={embedUrl} ... onLoad={() => setIsLoaded(true)} />
)}
```
**Why it's a bug:** When the carousel scrolls so this card leaves the 3-window, `shouldMountIframe` flips false (after 800ms), the `<iframe>` unmounts. `isLoaded` stays `true` because there is no cleanup that does `setIsLoaded(false)` when the iframe goes away. If the user scrolls back and the card re-enters the window, `shouldMountIframe` flips true and a fresh `<iframe>` mounts. The pause/resume effect (line 977-983) sees `isLoaded=true` (stale) AND `iframeRef.current` (which becomes the new element on next render) — and immediately fires `postMessage` to the new iframe BEFORE its YT player has booted. YT silently drops messages received before the player is ready. Result: the card doesn't auto-resume on scroll-back; user sees a paused thumbnail until the carousel re-evaluates `isActive`.

This is masked when `isActive` happens to be the same on remount (no effect re-run), but if `isActive` flipped while the card was unmounted, the very first command — the one that should engage video on the new iframe — is the one that gets dropped.
**Repro:** Open Home, scroll to OYÉ Africa rail. Swipe to card index 3 (it autoplays). Swipe back to card 0, wait 1s, swipe to card 5 (card 3 is now unmounted), wait 1s, swipe back to card 3. Card 3 may stay paused on the static thumbnail because the resume postMessage fired before YT booted.
**Fix sketch:** Reset `isLoaded` when the iframe unmounts. Add `useEffect(() => { if (!shouldMountIframe) setIsLoaded(false); }, [shouldMountIframe]);` or move `isLoaded` to a per-iframe ref keyed on the iframe element. Alternatively, retry postMessage 200ms after mount as a fallback.

---

## [P1] TrackCardGestures double-tap burst timer not tracked — setState fires on unmounted component on rapid scroll-away
**File:** src/components/ui/TrackCardGestures.tsx:92-97, 161-165
**What:**
```ts
const fireOyeBoost = useCallback(() => {
  haptic(12);
  app.oyeAndBoost(track);
  setDoubleTapBurst(true);
  window.setTimeout(() => setDoubleTapBurst(false), 720);    // ← untracked
}, [track, haptic]);

// Cleanup on unmount — any lingering timer would fire into a dead tree.
useEffect(() => () => {
  clearPressTimer();
  clearTapHold();
  if (overlayDismissTimerRef.current != null) window.clearTimeout(overlayDismissTimerRef.current);
}, []);
```
**Why it's a bug:** The 720ms timer at line 96 is fire-and-forget — no ref. The cleanup at 161 drains `pressTimerRef`, `tapHoldTimerRef`, and `overlayDismissTimerRef` but NOT this one. If the user double-taps a card, then immediately scrolls / navigates such that the card unmounts within 720ms (e.g. tapping a Classics disk, which immediately calls `playTrackFull` and may navigate to player), the timer fires `setDoubleTapBurst(false)` on a dead component. React 18 warns "Can't perform a state update on an unmounted component" and the closure pins the component fiber until GC.

It's a "minor leak" but spread across hundreds of cards in the feed, double-tap-and-scroll users could trigger this many times per session.
**Repro:** Open Home, double-tap any card, immediately scroll the feed hard so the card leaves the screen and any virtualization unmounts it within ~700ms. (Easier to verify in StrictMode dev where the warning fires.)
**Fix sketch:** Track the burst timer in a ref (`burstTimerRef`) and drain it in the unmount effect.

---

## [P1] HomeFeed playlist long-press timer attached to e.currentTarget — leaks on scroll-cancel because pointerLeave doesn't fire on touch
**File:** src/components/classic/Library.tsx:391-413
**What:**
```ts
<button
  className="p-2 relative"
  onClick={(e) => { e.stopPropagation(); onLike(); }}
  onPointerDown={(e) => {
    e.stopPropagation();
    // Start long press timer (500ms)
    const timer = setTimeout(() => {
      onAddToPlaylist();
    }, 500);
    (e.currentTarget as any).__longPressTimer = timer;
  }}
  onPointerUp={(e) => {
    clearTimeout((e.currentTarget as any).__longPressTimer);
  }}
  onPointerLeave={(e) => {
    clearTimeout((e.currentTarget as any).__longPressTimer);
  }}
>
```
**Why it's a bug:** Two distinct issues, both proven:
1. **Touch leak**: `onPointerLeave` does NOT fire on touch devices when the finger slides off the button — touch sticks the pointer to the originating element. If the user starts a press and scrolls the list (finger moves off the button), neither `pointerUp` (still inside the row) nor `pointerLeave` fires, so the 500ms timer DOES fire `onAddToPlaylist()` even though the user was clearly scrolling. False long-press → wrong modal opens mid-scroll.
2. **Timer ref orphan on unmount**: When the row unmounts (filter switch, list re-sort, etc.) mid-press, the `__longPressTimer` on `e.currentTarget` outlives the React node — the DOM element gets GC'd but the closure callback keeps the React tree fiber pinned and fires `onAddToPlaylist` on the dead component.

Compare to the well-behaved pattern at PlayAllButton (line 67-89) which uses a `useRef` + cleanup-on-unmount.
**Repro:** Switch to Library → My Disco. Press and HOLD the heart icon on any row, then drag your finger downward to scroll the list. ~500ms later the AddToPlaylist modal pops despite you clearly being mid-scroll.
**Fix sketch:** Move timer to a `useRef` inside a wrapper component (not on the DOM element). Add an `onPointerMove` that cancels the timer if the pointer drifts >10px (matches `MOVE_CANCEL_PX` pattern in TrackCardGestures). Cleanup in unmount effect.

---

## [P2] HomeFeed.TrackCard pref-mode: `setTimeout(() => setBucketFly(false), 500)` and box-shadow timer untracked
**File:** src/components/classic/HomeFeed.tsx:567-601
**What:**
```ts
if (dy < -BUCKET_THRESHOLD) {
  didPrefRef.current = true;
  app.oyeCommit(track, { position: 0 });
  try { navigator.vibrate?.([15, 8, 15]); } catch {}
  setBucketFly(true);
  setTimeout(() => setBucketFly(false), 500);    // ← untracked
  ...
}
...
if (cardRef.current) {
  cardRef.current.style.transition = 'box-shadow 0.3s ease-out';
  cardRef.current.style.boxShadow = '0 0 20px rgba(212,160,83,0.6), inset 0 0 30px rgba(212,160,83,0.15)';
  setTimeout(() => {
    if (cardRef.current) { cardRef.current.style.boxShadow = ''; cardRef.current.style.transition = ''; }
  }, 500);                                         // ← untracked
}
```
**Why it's a bug:** Same untracked-setTimeout pattern as the burst timer — if the card unmounts within 500ms (filter switch, shelf rerender via session-seed shuffle, scroll virtualization), `setBucketFly(false)` runs against a dead component. This component renders dozens of times in HomeFeed (all the shelves), so probability is non-trivial during normal use.

The box-shadow timer is safer because of the `if (cardRef.current)` guard, but `setBucketFly` has no such guard.
**Repro:** Bucket-flick a card on any shelf, then immediately tap the bottom-nav to switch surfaces. The 500ms `setBucketFly(false)` fires after unmount.
**Fix sketch:** Track both timers in refs and drain in cleanup.

---

## [P2] Top10Section dwell countdown `dwellTimerRef`/`countdownIntervalRef` cleanup OK, but `subtitleTimerRef` nested inner timer untracked
**File:** src/components/classic/HomeFeed.tsx:1832-1849
**What:**
```ts
const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
  if (countdownActive || countdownActiveRef.current) return;
  ...
  if (dt > 0 && dt < 150 && dx > 80) {
    scrollCooldownRef.current = true;
    if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
    subtitleTimerRef.current = setTimeout(() => {
      setSubtitleKey(k => k + 1);
      setTimeout(() => { scrollCooldownRef.current = false; }, 4200);    // ← nested untracked
    }, 280);
  }
}, [countdownActive]);
```
**Why it's a bug:** The OUTER timer (`subtitleTimerRef`) is tracked, but the inner `setTimeout(() => { scrollCooldownRef.current = false; }, 4200)` is not. If the section unmounts mid-cooldown (e.g. user navigates away), this timer keeps a closure over `scrollCooldownRef` (a ref, harmless on its own), but it's a dangling timer that React StrictMode will warn about. More importantly: if the user fast-scrolls the carousel (triggering subtitle flash), then unmounts → re-mounts the section within 4.2s, the cooldown is set to `false` mid-new-mount because the OLD timer fires on the new ref (refs are stable across remounts only if the parent component re-uses the same fiber — but Top10Section is itself memo'd, so this is more of a theoretical issue).

There is NO cleanup `useEffect(() => () => { ... }, [])` in Top10Section that drains `subtitleTimerRef`. The IntersectionObserver effect at line 1791 cleans `dwellTimerRef` and `countdownIntervalRef`, but not the subtitle timers.
**Repro:** Hard to reproduce in normal use because Top10Section rarely unmounts. Theoretical.
**Fix sketch:** Add a final cleanup `useEffect(() => () => { if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current); }, []);` and refactor the nested `setTimeout` into a tracked ref.

---

## Notes on what I checked and did NOT find a bug

- **HomeFeed.AfricanVibesCarousel observer effect** (line 1151): empty-deps + reads `containerRef.current` at mount. Verified safe — React assigns refs before useEffects run, and the `cardRefsMap` catch-up loop at line 1192 handles cards already registered before the observer existed.
- **HomeFeed.feedScrollRef ripple effect** (line 2356-2469): `ringTimers.forEach(clearTimeout)` in cleanup, listeners removed correctly. Clean.
- **HomeFeed.Top10Section IntersectionObserver** (line 1791-1829): `mounted` flag + cleanup drains timers + disconnects observer. Clean.
- **HomeFeed live-friends polling** (line 2565-2583): `cancelled` flag + `clearInterval` in cleanup. Clean.
- **StationHero**: dual observers + iframe-mount-grace timer all properly cleaned on unmount.
- **Library.tsx onListScroll**: rAF + idle timer both drained at line 545-548.
- **AlbumSection**: no timers, no event listeners — fetch races are in-flight but state updates aren't guarded; HOWEVER, this is in the disabled `'albums'` tab path that only renders when `activeTab === 'albums'`, and selectedAlbum has its own back-guard. Not a current-flow bug.
- **VibesReel**: pure render, no lifecycle. Safe (currently behind `VIBES_LIVE=false` kill switch anyway).
- **HomeFeed `prefetchTrack` effect** (line 353-356 in SearchOverlayV2): fires top-3 prefetches per `results` update. Re-fires on every typed character. Wasteful but not a leak — `prefetchTrack` is fire-and-forget HTTP. Soft perf issue, not a bug.

---

## Summary

8 findings, conservative severity:

- **P0 × 1**: SearchOverlayV2 timer leaks — ghost "Play now" pill from previous tap surfaces in next search session
- **P1 × 5**:
  - "in_disco" announcer fires on closed overlay
  - cachedSet /exists/ batch fetches not aborted (stacks 35-per-query backlog on fast typing)
  - AfricanVibesVideoCard `isLoaded` not reset on iframe unmount → first post-remount postMessage dropped
  - TrackCardGestures double-tap burst timer untracked → setState on unmounted card
  - Library heart-button long-press leaks on touch-scroll (false modal trigger) + on unmount
- **P2 × 2**: HomeFeed.TrackCard pref-mode untracked timers; Top10Section subtitle inner timer untracked
