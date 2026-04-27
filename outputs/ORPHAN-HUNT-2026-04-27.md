# VOYO Orphan Hunt — 2026-04-27 (post v702)

Read-only sweep. No source files edited. Goal: runtime orphans that mount, fail, or reload silently and trigger sibling cascades.

---

## Summary

- **Files scanned:** ~50 hot files (App.tsx, AudioPlayer, YouTubeIframe, VoyoPortraitPlayer, HomeFeed, VoyoMoments, DynamicIsland, SearchOverlayV2, ArtistPage, Library, NowPlaying, SignInPrompt/VoyoLiveCard, ProfilePage, PortalChat, SmartImage, TrackThumbnail, useMoments, useDashNotifications, useMessagingViewport, useIdleDim, useWakeLock, bgEngine, audioEngine, useHotSwap, playerStore, reactionStore, warmingStore, universeStore, voyo-api, dahub-api, supabase, lib/realtime/reconnect, services/oyo, services/telemetry, atmosphere, navigation, classic/{StationHero,GreetingBanner,AnchoredTaleHeader})
- **Hits found:** 17 (4 P0/P1, 6 P2, 7 P3)
- **Severity legend:**
  - **P0** — active leak that already causes a sibling reload or measurable user-visible regression
  - **P1** — slow leak / waste that compounds with normal usage (skip patterns, BG/FG cycles, search churn)
  - **P2** — bounded / cosmetic / requires unusual conditions to surface
  - **P3** — style or micro-optimisation, no real-world cost

---

## §1 Active leaks (P0/P1) — fix in this session

### O1: VoyoLiveCard re-fetches friends + activity on every track change
**File:** `/home/dash/voyo-music/src/components/social/SignInPrompt.tsx:116-178`
**Severity:** **P1** (slow leak by skip-rate; user-visible only as bandwidth + Supabase HTTP-2 stream pressure)

**What it is:**
The hero card on Home (`VoyoLiveCard`) reads `currentTrack` via `usePlayerStore(s => s.currentTrack)` and lists it in the deps of the friends-fetch effect (`}, [dashId, isLoggedIn, currentTrack]`). Every track change re-fires the effect:

```ts
useEffect(() => {
  if (!dashId || !isLoggedIn) return;
  let cancelled = false;
  const loadData = async () => {
    const [friendsList, activity] = await Promise.all([
      friendsAPI.getFriends(dashId),
      activityAPI.getFriendsActivity(dashId),
    ]);
    // ... setFriends, setFriendsActivity, setFriendsListening
  };
  loadData();
  const interval = setInterval(() => { if (!document.hidden) loadData(); }, 30000);
  return () => { cancelled = true; clearInterval(interval); };
}, [dashId, isLoggedIn, currentTrack]);  // ← currentTrack
```

**Cascade chain:**
User taps Next → `playerStore.setCurrentTrack(B)` → playerStore subscribers wake → `VoyoLiveCard` re-renders (currentTrack prop changed) → effect tears down 30s interval → re-runs `loadData()` → 2 parallel HTTP fetches (`get_friends_with_presence` RPC + `getFriendsActivity`) → re-installs a fresh 30s interval.

Each rapid skip = 2 fetches. 5-skip burst = 10 fetches against `mclbbkmpovnvcfmwsoqt`/Command-Center, all racing each other. The internal `friendsAPI.getFriends` only consumes the cancelled flag for the LATEST fetch; earlier ones complete network-wise but are discarded — wasted bandwidth + Supabase stream slots that competing audio queries (R2 HEAD, voyo_uploads_extracted realtime) need.

The reason `currentTrack` ended up in deps is the inner `if (currentTrack) realList.push({ id: 'me', ... })` block — the effect needs the latest currentTrack to set the user's own card. But the heavy I/O (friends + activity) doesn't depend on it.

**Fix sketch:** Split the effect. Move the friends + activity fetches into an effect with deps `[dashId, isLoggedIn]` only. Build `realList` in a separate `useMemo` over `[friends, friendsActivity, currentTrack]` and feed it into the existing `setFriendsListening` via a derived effect (or just compute it inline at render). Same UX, no per-skip refetch.

---

### O2: SmartImage useEffect lists `currentSrc` in deps, re-fires on every internal `setCurrentSrc`
**File:** `/home/dash/voyo-music/src/components/ui/SmartImage.tsx:89-183`
**Severity:** **P1** (effect storm on every image surface — 4× re-runs per successful load)

**What it is:**
```ts
useEffect(() => {
  if (!isInView) return;
  const srcKey = `${src}|${trackId}|${fallbackSrc}`;
  if (hasLoadedRef.current && prevSrcRef.current === srcKey) return;  // ← guard
  let cancelled = false;
  const loadImage = async () => {
    // sets setCurrentSrc(...) on every fallback path
  };
  loadImage();
  return () => { cancelled = true; };
}, [src, fallbackSrc, trackId, alt, isInView, currentSrc]);  // ← currentSrc in deps
```

When `loadImage()` calls `setCurrentSrc(...)`, the effect's dep array changes → effect re-runs → guard at line 94 catches it → returns early without doing work, BUT the cleanup `cancelled = true` from the prior run fires, then a fresh closure starts. That's not just inert — every successful load can trigger 1-4 effect re-runs (one per fallback step that sets currentSrc).

**Cascade chain:**
Image #1 mounts → Step 2 succeeds → `setCurrentSrc(src)` → useState commit → effect dep change → effect re-runs → guard hits, no I/O, but cleanup fires → another sibling SmartImage re-renders if parent rerendered (e.g. HomeFeed scroll). Each Vibes carousel card has ≥2 SmartImage instances — 12 cards × 2 images × 4 effect re-runs = ~100 wasted commits per scroll session.

Net effect: not a leak, but a permanent base of unnecessary re-runs that compound when SmartImage is dense (Library list with 200+ tracks → 200+ effects with this pattern).

**Fix sketch:** Drop `currentSrc` from the deps array. The guard at line 94 (`hasLoadedRef.current && prevSrcRef.current === srcKey`) already prevents re-loads; it doesn't need `currentSrc` to compute it.

---

### O3: VoyoLiveCard rotation rAF stays armed via setTimeout(1000) when tab hidden
**File:** `/home/dash/voyo-music/src/components/social/SignInPrompt.tsx:238-274`
**Severity:** **P1** (mild battery drain — fires every 1s while hidden instead of pausing properly)

**What it is:**
```ts
const animate = (currentTime: number) => {
  if (document.hidden) {
    animationRef.current = window.setTimeout(() => {
      animationRef.current = requestAnimationFrame(animate);
    }, 1000) as unknown as number;
    return;
  }
  // ... rotation work
  animationRef.current = requestAnimationFrame(animate);
};
animationRef.current = requestAnimationFrame(animate);
// ...
return () => {
  if (animationRef.current) cancelAnimationFrame(animationRef.current);  // ← only cancels rAF
  document.removeEventListener('visibilitychange', handleVisibility);
};
```

The cleanup calls `cancelAnimationFrame(animationRef.current)` — but during a hidden tick, `animationRef.current` holds a `setTimeout` id (cast to number), not a rAF handle. `cancelAnimationFrame(setTimeoutId)` is a no-op on most browsers. If the component unmounts while the tab is hidden, the setTimeout keeps firing and re-arms a fresh rAF on the dead component, which then invokes setState on dead React tree. React 18 silently swallows it; impact is bounded but it's a real orphan.

**Cascade:** Component unmounts (e.g. user opens Library tab while screen is locked) → setTimeout(1000) keeps polling → next visibility check fires `requestAnimationFrame(animate)` → animate re-runs `setRotation` on unmounted component → React swallows.

**Fix sketch:** Track which kind of timer is in `animationRef.current`. Either:
- Use TWO refs (`rafRef` + `timeoutRef`) and clear both in cleanup, or
- Cleanup function calls both: `clearTimeout(animationRef.current); cancelAnimationFrame(animationRef.current);` (one will silently no-op, the other will land).

---

### O4: MomentCard `/check` fetch has no AbortController
**File:** `/home/dash/voyo-music/src/components/voyo/feed/VoyoMoments.tsx:577-593`
**Severity:** **P1** (rapid swiping accumulates in-flight HEAD-equivalent fetches)

**What it is:**
```ts
useEffect(() => {
  let cancelled = false;
  setVideoAvailable(null);
  setVideoError(false);
  fetch(`${videoUrl}/check`)
    .then(r => r.json())
    .then(data => { if (!cancelled) setVideoAvailable(data.exists === true); })
    .catch(() => { if (!cancelled) setVideoAvailable(false); });
  return () => { cancelled = true; };
}, [moment.source_id, videoUrl]);
```

The `cancelled` flag prevents stale state writes but the network fetch itself keeps running. On rapid Moment swipes (left/right/up/down) each MomentCard mounts + unmounts and the effect launches a fetch that completes against /dev/null. Over a 30-moment fast swipe = 30 fetches in flight simultaneously, blocking the browser's 6 concurrent connections to that origin → real Moment video assets queue behind dead probes.

**Cascade:** User flicks through 10 moments fast → 10 `/check` fetches racing → `<video src=...>` HTTP requests for the active moment queue behind them → first frame paints late → `isActive ? play() : pause()` effect fires play() before metadata is loaded → pause() races canplay → "stutter on first frame" perception.

**Fix sketch:** Replace the cancelled-flag with `AbortController`:
```ts
const ctl = new AbortController();
fetch(`${videoUrl}/check`, { signal: ctl.signal }).then(...).catch(...);
return () => ctl.abort();
```

---

## §2 Slow leaks (P2)

### O5: UpdateButton `attachEndedListener` adds a listener it never removes
**File:** `/home/dash/voyo-music/src/App.tsx:367-380`
**Severity:** **P2** (bounded — UpdateButton is mounted once for app lifetime, but on hot-reload or route change it leaks)

`attachEndedListener` calls `audioEl.addEventListener('ended', onEnded)` from inside `useEffect` deps `[]`. The cleanup at line 431 only removes the swHandler + clears the interval; it never calls `audioEl.removeEventListener('ended', onEnded)`. UpdateButton lives at the top of App.tsx and effectively never unmounts in production, but during HMR or if a future refactor moves UpdateButton inside a route, the listener will keep firing `performForceReload()` against a dead component. That triggers `caches.delete()` + `window.location.reload()` — destructive.

**Fix sketch:** Track the audioEl + onEnded handler in refs at effect scope. In the cleanup return: `if (audioElRef.current && onEndedRef.current) audioElRef.current.removeEventListener('ended', onEndedRef.current)`.

---

### O6: DynamicIsland `seenIdsRef` Set grows unboundedly
**File:** `/home/dash/voyo-music/src/components/ui/DynamicIsland.tsx:231-239` + ref decl
**Severity:** **P2** (slow-leak proportional to dash_notifications volume; harmless until 100k+ session-life)

`seenIdsRef.current.add(r.id)` for every dashRow ever observed; never cleared. Bounded by total notification IDs ever fetched in a session — for a long-lived PWA this can creep but at typical usage stays under 1k. Mark for future bounded-set treatment (`if (seen.size > 500) seen.clear()`).

---

### O7: HotSwap canplay-wait `setTimeout(2500)` never cleared on success
**File:** `/home/dash/voyo-music/src/player/useHotSwap.ts:170-180`
**Severity:** **P2** (already noted in DEEP_MAP §5 — not re-flagging beyond confirming it's still live)

The setTimeout fires regardless of canplay outcome; the listener-remove inside the timeout callback is a no-op if onReady already removed it. Wasted 2.5s timer per swap attempt but no actual leak.

---

### O8: universeStore.viewUniverse leaks portalSubscription on portal-A → portal-B switch
**File:** `/home/dash/voyo-music/src/store/universeStore.ts:433-485`
**Severity:** **P2** (DEEP_MAP §3 known — confirming still present)

`viewUniverse(B)` does NOT call `universeAPI.unsubscribe(portalSubscription)` before subscribing to B. If user A→B→C without explicit `leaveUniverse`, two stale channels accumulate. Cascade: stale channel keeps receiving postgres_changes → `set({ viewingUniverse: ... })` writes the stale row's now_playing into the active universe state → wrong "now playing" flicker on the visible profile card. Already in audit; flagging for visibility.

---

### O9: VoyoMoments stageTimers cleanup is in a different useEffect than where they're set
**File:** `/home/dash/voyo-music/src/components/voyo/feed/VoyoMoments.tsx:1199-1233`
**Severity:** **P2** (works in practice because `pingWidgets` clears timers each call, but coupling is fragile)

`pingWidgets` (line 1197) sets 3 setTimeout entries into `stageTimers.current`. The cleanup that clears them lives in a DIFFERENT useEffect (line 1223-1225, gated on `[uiPhase, pingWidgets]`). Per-`mKey` re-runs (line 1230) call `pingWidgets()` directly without going through the cleanup-bearing effect — relying on `pingWidgets` itself to clear stale timers at the top. Works today; if a future edit removes that internal clear, you get accumulating 6s setTimeout-stacks per swipe.

**Fix sketch:** Move the cleanup (`stageTimers.current.forEach(t => clearTimeout(t))`) to the same effect that sets them, or have `pingWidgets` always go through a single useEffect.

---

### O10: VoyoLiveCard `loadData` interval recreated on every track change (sibling of O1)
**File:** `/home/dash/voyo-music/src/components/social/SignInPrompt.tsx:173-177`
**Severity:** **P2** (subset of O1's cascade — listed separately because the fix is the SAME split-the-effect operation)

The `setInterval(loadData, 30000)` is also re-created per track change because it's in the same effect. If the user is on a 25s track, the interval is torn down before its first tick fires, replaced with a fresh one — meaning the supposed "every 30s presence refresh" never actually fires for users who skip more than once a minute. Defeats the purpose.

---

## §3 P3 (cosmetic / micro)

### O11: VoyoBottomNav pointer listener is at document level + `passive: true` — fine but always-on
File: `/home/dash/voyo-music/src/components/voyo/navigation/VoyoBottomNav.tsx:78-85` — every pointerdown/up in the entire app fires this. Bounded by the 3 listeners + ref-setProperty work; no leak. Move on.

### O12: `seenIdsRef` mirrors O6.

### O13: AudioPlayer line 612 `setTimeout(()=>el.play().catch(...), 100)` has no cleanup but is one-shot 100ms — not a leak.

### O14: VoyoPortraitPlayer line 459 `setTimeout(...)` chain inside double-tap handler — one-shot UI feedback, not a leak.

### O15: HomeFeed VoyoLiveCard friend-count poller (`fetchOnlineFriends` line 2754) — clean (cancelled flag + clearInterval).

### O16: SignInPrompt `setTimeout(() => setPrevCenterIndex(null), ABSORB_MS)` (line 205) — has clearTimeout in next call + on unmount cleanup. Fine.

### O17: detectNetworkQuality singleton listener at playerStore.ts:1946 — properly gated by `listenerAttached` flag so re-calls don't stack. Good defensive code.

---

## §4 Verification of today's strike-team additions

### `main.tsx` --vh JS bridge — **PASS**
Lines 26-35. Listeners (`resize`, `orientationchange`, `visualViewport.resize`) are at module top-level scope, NOT inside a React effect. They live for the lifetime of the page, which is correct — there's no "component" to unmount. The `setVh` closure captures only `document.documentElement` and `window.visualViewport`/`innerHeight`, no React state, no risk of stale closure. Initial `setVh()` invocation present. `passive: true` on all three. No issue.

### VoyoMoments CompassArc positional keys — **PASS**
Confirmed at line 429: `key={offset}` (positional slot, range -3..+3). On `currentIndex` shift, the same DOM node persists across category steps; CSS transitions interpolate smoothly. No leftover state from the old `${category}-${index}` regime — verified `category-` only appears in comments now (line 423-428 explanation block). Reconciler keeps the slot DOM stable as intended.

### DynamicIsland stacked-panel cross-fade — **PASS**
Lines 663-678. Both light + dark panels mount unconditionally inside the expanded card; cross-faded via `opacity` driven by `isReplying`. The previous `backgroundColor: rgba(...)` animation is removed from `expandedStyle` (line 597-603 — no `backgroundColor` in the inline style; transparent inheriting from the wrapper). Safari can no longer interpolate alpha through ~0; no transparent flash mid-transition.

### VoyoMoments comments drawer visualViewport wiring — **PASS**
Line 829-841. `useMessagingViewport()` imports + reads `vh, keyboardOpen`. Drawer style applies `Math.round(vh * 0.7)` for max + `Math.min(280, ...)` for min when keyboard open. The hook itself (`useMessagingViewport.ts:38-43`) properly removes both `resize` and `scroll` listeners on unmount.

### Comments input 16px font + 44px button (Moments + DynamicIsland) — **PASS**
VoyoMoments line ~281: height 44, fontSize 16, borderRadius 22. DynamicIsland line ~767-776: input `text-base + style={{ fontSize: 16 }}`, button `w-11 h-11 flex-shrink-0`. No iOS focus-zoom risk; touch-target floor met.

### CompassArc `filter: blur` removal — **PASS**
Line 359-376. Confirmed: no `filter` declarations on offset items. Only opacity + scale + translateY in the transform. No per-frame Safari rasterise.

### MIX badge safe-area top — **PASS**
Line 1731: `top: 'calc(env(safe-area-inset-top, 0px) + 88px)'`. Respects notch.

### Search header `100dvh` Safari-15 fallback — **PASS** (out of orphan-hunt scope but confirmed in code)
SearchOverlayV2 lines 731-744 ship the @supports block. Style classes wired at 763.

---

## §5 Already-known and tracked (don't re-flag)

These are already in DEEP_MAP §5 / §6 and have been confirmed still in place; not re-listing as new findings:

- **`lib/realtime/reconnect.ts:44-50`** — DEEP_MAP P0-RT-3. Code has been UPDATED: `tearDown` now calls both `ch.unsubscribe()` AND `client.removeChannel(ch)` (lines 40-44). All 7 call sites (reactionStore, profile/ProfilePage, dahub-api×2, voyo-api×4) consume this wrapper correctly. Status: **fixed**.
- **playerStore `_trackChangeCount`** (line 550) — refresh fires every 3rd track without abort plumbing. P2 known.
- **playerStore history unbounded** (line ~1500) — known.
- **r2Probe `_v=Date.now()`** — defeats edge cache, known P2.
- **useHotSwap canplay-wait setTimeout(2500)** — known P2 (also re-noted as O7 above, acknowledging duplicate).
- **warmingStore Timer Map grow** — known P2.
- **downloadStore `boostTrack` race** — fixed v655 per DEEP_MAP, verify only.
- **YouTubeIframe rapid skip race / initializingRef leak** — known P0 already in audit.
- **5 Supabase clients** (voyo-api, dash-auth, dahub-api, supabase, useDashNotifications/ccSupabase) — duplicate WebSockets, known P1.
- **reactionStore `pulseCategory` setTimeout stack on burst** — known P2.

---

## §6 Notes on what this hunt did NOT find

- **No mounted-invisible-but-running components.** Lazy-loaded routes (`PortraitVOYO`, `LandscapeVOYO`, `VideoMode`, `ClassicMode`, `SearchOverlay`, `ArtistPage`, `UniversePanel`) all `lazy()` from App.tsx and unmount when not in their app-mode branch.
- **No iframe re-mount cascade.** YouTubeIframe `key={youtubeId || 'voyo-iframe-empty'}` is intentional remount per track-change; not on every parent re-render.
- **No `useStore()` (no selector) usages.** All store consumers use selectors. Good hygiene.
- **No realtime fan-out duplicates** beyond the 5-Supabase-clients issue already known.
- **No conditional-mount flicker** of major components observed — visible ones all use stable boolean derivations.
- **No image-error retry loops.** TrackThumbnail explicitly remembers failed URLs in localStorage (Set capped at 500); SmartImage has explicit fallback chain with stop conditions.
- **No dynamic imports inside render bodies.** All `await import(...)` calls are inside async functions or effects (preferenceStore, playerStore, oyo, intelligentDJ).

---

## §7 Recommended P0/P1 fix order for this session

1. **O1 + O10 (split VoyoLiveCard friends-fetch effect)** — single fix, kills the per-skip 2-fetch cascade, restores intended 30s presence interval.
2. **O2 (drop `currentSrc` from SmartImage deps)** — one-line fix, eliminates ~100 wasted effect runs per scroll session in image-dense views (Library, Vibes carousel).
3. **O4 (AbortController on MomentCard /check fetch)** — one-block fix, prevents fetch pile-up on rapid swiping; visible improvement to first-frame paint latency on subsequent moments.
4. **O3 (clearTimeout + cancelAnimationFrame in VoyoLiveCard rotation cleanup)** — defensive 2-line fix, no observable user benefit but prevents zombie timer in BG-unmount edge case.

---

*End of orphan hunt — author: Orphan Hunter agent. Cross-references: DEEP_MAP_2026-04-26 §3 §5 §6, agent-globals-fixes-2026-04-27, agent-moments-fixes-2026-04-27, agent-search-fixes-2026-04-27.*
