# AUDIT-UI — UI Surfaces & Navigation Shell

**Scope:** surfaces NOT covered by prior audits (search, moments, social, PWA, audio lifecycle were already deep-dove).
**Files audited in full:** `src/components/voyo/LandscapeVOYO.tsx` (862), `src/components/voyo/VideoMode.tsx` (287), `src/components/voyo/PortraitVOYO.tsx` (425), `src/components/voyo/navigation/VoyoBottomNav.tsx` (460), `src/components/classic/ClassicMode.tsx` (603), `src/components/classic/HomeFeed.tsx` (2004), `src/components/classic/Library.tsx` (1068), `src/components/classic/NowPlaying.tsx` (754), `src/components/classic/StationHero.tsx` (516), `src/hooks/useTabHistory.ts`, `src/hooks/useBackGuard.ts`, `src/components/ui/Safe.tsx`, `src/components/ui/TrackCardGestures.tsx`, `src/components/ui/SmartImage.tsx`, `src/components/ui/DiscoExplainer.tsx`, `src/components/ui/PushBell.tsx`, `src/components/ui/OfflineIndicator.tsx`.
**Files skimmed:** `src/App.tsx` (1234).
**Priors consumed:** AUDIT 1–6, MOMENTS-1/2, SOCIAL-1/2/3, SEARCH-1/2, PWA-1/2 (did not re-hit anything they covered).

---

## Summary — top P0/P1

1. **[P0] NowPlaying (isOpen modal) has no `useBackGuard`** — back press exits the app instead of closing the sheet. Same class of bug as the repeat/shuffle one (full-screen modal that bypasses the navigation shell). `src/components/classic/NowPlaying.tsx:241`.
2. **[P0] NowPlaying's "heart" button renders an `X` icon and still fires `setExplicitLike`** — users think it's a close button, tap it, accidentally toggle their like state on the current track. `src/components/classic/NowPlaying.tsx:502-507`.
3. **[P0] Bell notification button is a pure no-op that flashes a "No new notifications" toast + carries a hardcoded red unread dot** — never reflects real state. `src/components/classic/HomeFeed.tsx:1338-1341, 1521-1524`.
4. **[P0] `LandscapeVOYO`'s `onVideoMode` prop is received but NEVER wired** — long-press/triple-tap handlers in `PlayCircle` call `onTripleTap` / `onHold` that fire… nothing in the current exported body (the Video-Mode portal is never invoked). `LandscapeVOYO.tsx:506, 248, 98-128`.
5. **[P0] `handleBackToPortrait` is an empty function behind a visible "Portrait" button** — dead UI. `LandscapeVOYO.tsx:637-641, 821-827`.

---

## Findings

### 1. [P0] NowPlaying full-screen modal has no back-gesture coverage

**Location:** `src/components/classic/NowPlaying.tsx:241` (component entry), no `useBackGuard` call anywhere.

NowPlaying is a full-screen `fixed inset-0 z-50` modal opened by ClassicMode via `showNowPlaying` state (`ClassicMode.tsx:475`). Unlike PlaylistModal, DiscoExplainer, SearchOverlayV2, IOSInstallSheet, UniversePanel, ArtistPage, VibesSection, AlbumSection — which all call `useBackGuard(isOpen, onClose, 'name')` — NowPlaying relies solely on a top-left `ChevronDown` button. On Android + iOS PWAs, system back swipe exits the app. On desktop, browser Back navigates off the page. This is the MOST prominent modal in the app (opens every track play from communal sections) and is the only big modal missing the guard.

**Suggested fix:** one line. `useBackGuard(isOpen, onClose, 'now-playing');` at the top of the component body.

---

### 2. [P0] NowPlaying's "like" button renders an `X` icon — dead / wrong / actively misleading

**Location:** `src/components/classic/NowPlaying.tsx:502-507`.

```tsx
<button
  className="p-2"
  onClick={() => currentTrack && setExplicitLike(currentTrack.trackId, !isLiked)}
>
  <X className="w-6 h-6 text-white/60" />
</button>
```

This is the "track info row" action cluster — the button NEXT to it is `Plus` (add to playlist), so a reasonable user interprets the `X` as "close this track / skip / dismiss". Tapping it toggles `explicitLike` on the current track. The user's like graph silently drifts every time they try to dismiss the track info. `isLiked` is computed (line 266) but never visually reflected on this button — no Heart icon, no color shift, no aria-label.

This is the same class of bug as the repeat/shuffle wiring fix today (comment at line 276-282 documents the pattern): a gesture that appears to do one thing but actually does something else. Here the "dead" nature is worse because the tap has a real side effect that corrupts taste data.

**Suggested fix:** replace `<X ... />` with `<Heart className={...} fill={isLiked ? ... : 'none'} />`; add `aria-label={isLiked ? 'Unlike' : 'Like'}`. VideoMode.tsx:164-180 already has a correct like-chip pattern to copy.

---

### 3. [P0] Bell notification button is entirely decorative

**Location:** `src/components/classic/HomeFeed.tsx:1338-1341, 1521-1524`.

```tsx
const handleNotificationClick = () => {
  setShowNotificationHint(true);
  setTimeout(() => setShowNotificationHint(false), 2500);
};
```

The hint popup shown is a hardcoded string: `"No new notifications"` (line 1541). Meanwhile the Bell button has a **static red dot** (line 1523) claiming unread — so the user sees "unread" state, taps, gets told there's nothing. This is a dead button with active disinformation.

The app DOES have a real notification pipeline — DynamicIsland pushes on reactions (App.tsx:803) and DMs (App.tsx:844), and VoyoBottomNav has real unread-DM count wiring (VoyoBottomNav.tsx:162-190 via `messagesAPI.getUnreadCount`). The classic Home header just isn't hooked to any of it.

**Suggested fix:** either (a) remove the bell entirely from the classic Home header (push notifications surface via PushBell in the VOYO header anyway), or (b) wire it to the existing unread-DM count from `messagesAPI` and make the red dot conditional on `unreadDMs > 0`. Current state is worse than either.

---

### 4. [P0] LandscapeVOYO — three dead wires on visible UI

**Location:** `src/components/voyo/LandscapeVOYO.tsx`.

**4a.** `onVideoMode` prop (`line 248, 506`) received but never called.
Triple-tap the center `PlayCircle` (line 98) → `onTripleTap` fires → but the wiring at 506 never forwards it. Hold 500ms on the orb → `onHold` → same story. The *only* caller of `onVideoMode` in the whole file is via the prop declaration; the handlers in the exported component never use it. Cross-checked `App.tsx:1054, 1133` — they DO pass `handleVideoModeEnter` as `onVideoMode`, so the user expects triple-tap / hold to switch modes. It doesn't.

**4b.** `handleBackToPortrait` literally empty (line 637-641):

```tsx
const handleBackToPortrait = () => {
  // Rotate back by exiting fullscreen or just letting orientation change
  // For now, this is handled by the orientation hook in App.tsx
  // We could force portrait mode here if needed
};
```

The visible "Portrait" button (line 821-827 with Smartphone icon) is bound to this function. Tapping does nothing. User flips phone manually or gives up.

**4c.** `setPlaybackSource` selected from store (line 523) but never called. Dead subscription triggering store re-renders for no reason. It was probably used by a ripped hot-swap flow; now it just taxes React reconciliation.

**4d.** Timeline card for current track uses `onClick={() => {}}` (line 710) — deliberate no-op (since it's already playing), but it should be `onClick={undefined}` or remove the button to kill dead pointer area.

**Suggested fix:** wire `handleBackToPortrait` to `setAppMode('voyo')` (needs to be lifted from App or expose via store); wire `PlayCircle`'s `onTripleTap` to `onVideoMode`; remove `setPlaybackSource` selector; make the current TimelineCard a passive div.

---

### 5. [P0] VideoMode — entire auto-hide-controls mechanism is neutered but code lingers

**Location:** `src/components/voyo/VideoMode.tsx:51, 59, 60-62, 64-71`.

```tsx
const [showControls, setShowControls] = useState(true);
// ...
const controlsTimeoutRef = useRef<...>(undefined);
const tapCountRef = useRef(0);
const tapTimeoutRef = useRef<...>(undefined);
const lastTapTime = useRef(0);

// Controls stay always visible. We removed the full-screen tap surface
// (it was covering search buttons beneath the overlay), which means
// there's no way to summon hidden controls back — so "auto-hide + tap
// anywhere to reveal" is no longer safe. Keep them on...
void controlsTimeoutRef;
void setShowControls;
```

`showControls` is `true` forever. `setShowControls` is explicitly silenced with `void`. `controlsTimeoutRef`, `tapCountRef`, `tapTimeoutRef`, `lastTapTime` are all declared and cleaned up (line 74-81) but never written to. The documented "Swipe up/down: Next/Prev • Double-tap: Reactions • Triple-tap: Exit" hint at line 277 is flat wrong: the `handleDragEnd` at line 90 handles swipe, but nothing is bound to invoke it (no pointer handlers on the root — the root is `pointer-events: none`). Double-tap and triple-tap are not implemented at all. Users are looking at a hint text that describes gestures that don't work.

**Suggested fix:** delete the dead refs + useState + hint text. Either (a) implement the gestures properly (bind the pointer handlers to a dedicated inset layer that doesn't eat search buttons), or (b) replace the hint with something honest: "Tap a control to play". The current state is misinformation.

---

### 6. [P1] ClassicMode — `handleArtistClick` declared but never bound

**Location:** `src/components/classic/ClassicMode.tsx:505-508`.

```tsx
const handleArtistClick = (artist: { name: string; tracks: Track[] }) => {
  setActiveTab('library');
};
```

Not passed to HomeFeed or Library. No caller in the file. ~~Dead~~ weight.

**Suggested fix:** delete, or wire it into the HomeFeed ArtistCard click if artist→library pivot is still desired UX (I suspect it isn't — ArtistPage modal exists for this purpose now).

---

### 7. [P1] ClassicMode — `activeTab` + `showNowPlaying` have no back-guard

**Location:** `src/components/classic/ClassicMode.tsx:474-475`.

These are the classic analog of VoyoPortraitPlayer's voyoActiveTab (which DOES use useTabHistory, PortraitVOYO.tsx:161). When a user is on Library, presses back, they exit the app instead of returning to Home. Same for closing NowPlaying via back press (which also compounds Finding 1).

**Suggested fix:** `useTabHistory(activeTab, setActiveTab, 'classic-tab');` and the NowPlaying guard from Finding 1.

---

### 8. [P1] HomeFeed — legacy unused props still wired through (dead-prop drift)

**Location:** `src/components/classic/HomeFeed.tsx:181-189, 191-211, 1268, 1330-1336, 1694`.

`ShelfWithRefresh` is called with `onRefresh={handleRefresh}` and `isRefreshing={isRefreshing}` but the component destructures neither (comment: "Unused — legacy prop for compat"). `handleRefresh` sets `isRefreshing` → nothing reads it → 500ms later it flips back. The entire `isRefreshing` state (line 1268) and the `handleRefresh` function (line 1330) is dead code that runs on every "refresh" action. Also confusing for future readers expecting those props to do something.

**Suggested fix:** delete `isRefreshing` state, delete `handleRefresh` (sessionSeed bump is the only real work), delete the vestigial props from `ShelfWithRefreshProps`. Or implement a real pull-to-refresh spinner (there IS one at App.tsx:988, but it's on the whole page, not per shelf).

---

### 9. [P1] HomeFeed — `AfricanVibesVideoCard` sets `isActive` via `onMouseEnter` on desktop only

**Location:** `src/components/classic/HomeFeed.tsx:1079`.

```tsx
<div key={track.id} onMouseEnter={() => setActiveIdx(idx)}>
```

Touch devices never fire mouseenter without a prior tap + the Intersection gate is `threshold: 0.5` on the CAROUSEL CONTAINER (line 1034), not per-card. So on phones, `activeIdx` is always 0 → only the first iframe ever mounts. The stated "lazy-mount 1 iframe at a time" (line 886-899) works BECAUSE `activeIdx` never changes on touch. But the carousel looks broken on mobile: swipe through 5 cards, card 1 keeps showing a "recording dot" (line 980), cards 2-4 show only thumbnails. User perceives that only the first card is "live".

**Suggested fix:** replace `onMouseEnter` with a per-card IntersectionObserver (threshold > 0.6) that picks `activeIdx` from whichever card is centered in the viewport. Pattern already used in StationHero.tsx:114-121 (two-stage observer) — copy it.

---

### 10. [P1] HomeFeed TrackCard — `isHovered` never set on touch, silently used for desktop play overlay

**Location:** `src/components/classic/HomeFeed.tsx:493, 691`.

`TrackCard` and `WideTrackCard` both declare `const [isHovered, setIsHovered] = useState(false);` — `setIsHovered` is never called on TrackCard (the play overlay at line 666 just never appears on touch). On WideTrackCard the play overlay at line 717 is similarly desktop-only but gated by `isHovered` which has no setter.

Not broken so much as confusing dead state that triggers re-renders every time the parent re-renders with a new track array. If you intend touch-only, delete `useState` and the gated overlay. If you want desktop hover parity, bind `onMouseEnter/onMouseLeave`.

**Suggested fix:** delete the useState + the conditional branches. Users on touch devices see the faded Play icon on center card (line 442-458) which is the intended hint anyway.

---

### 11. [P1] HomeFeed `handleRefresh` never ties to ptr.refreshing

**Location:** `App.tsx:517, 988-1014` + `HomeFeed.tsx:1330`.

`usePullToRefresh` at App.tsx:517 returns `ptr.refreshing` which drives the top spinner. HomeFeed's own `handleRefresh` (which bumps sessionSeed to re-shuffle shelves) is never invoked by that hook. So pull-to-refresh reloads the whole app (`window.location.reload()` inside the hook, presumably) instead of re-shuffling in place. Users who pull-to-refresh on Home are burning full page loads for a sessionSeed bump they could get with a one-line `Date.now()`.

Couldn't fully verify without reading `usePullToRefresh` — but the disconnect between in-file refresh state and the global pull gesture is suspicious. Worth a look.

---

### 12. [P1] Library — pointer-down long-press uses `(e.currentTarget as any).__longPressTimer`

**Location:** `src/components/classic/Library.tsx:390-402`.

```tsx
onPointerDown={(e) => {
  const timer = setTimeout(() => { onAddToPlaylist(); }, 500);
  (e.currentTarget as any).__longPressTimer = timer;
}}
onPointerUp={(e) => { clearTimeout((e.currentTarget as any).__longPressTimer); }}
onPointerLeave={(e) => { clearTimeout((e.currentTarget as any).__longPressTimer); }}
```

Smuggling a timer ID onto a DOM element as `__longPressTimer`. Works but:
- Element could unmount mid-press (filter flip clears the SongRow set) → timer fires against a dead component → `onAddToPlaylist` calls `setPlaylistModalTrack(track)` on an unmounted parent → no React warning because Library parent is still mounted, but you open the playlist modal for a track the user already navigated away from.
- Pointer-cancel (system interrupt, incoming call, back gesture mid-hold) never clears the timer. iOS fires pointerleave on gesture-cancel usually, but not guaranteed under notification overlays.

**Suggested fix:** store the timer in a ref inside SongRow (which is a child component — already has its own function scope) or wrap in `useRef<ReturnType<typeof setTimeout>>` the way PlayAllBar (same file, line 62-84) already does correctly. Also add `onPointerCancel` to the handler set.

---

### 13. [P1] Library — `setActiveFilter` closure captures `scrollContainerRef` before it's declared

**Location:** `src/components/classic/Library.tsx:422-435` vs `474`.

`const setActiveFilter = useCallback((next: string) => { ...scrollContainerRef.current... }, []);` at line 422, but `const scrollContainerRef = useRef(...)` is at line 474 — AFTER. Works because useRef returns a stable object referenced lazily; the callback never fires during render so by the time it's called, the ref is populated. But TS should flag this (it doesn't due to the way closures lookup lexical scope). More importantly, it reads as confusing — the body of `setActiveFilter` looks at first glance to be broken.

Lower-priority code-smell but easy to fix by moving the refs above the setter wrapper. Also: the `useCallback` has `[]` deps meaning it never rebinds — fine because refs and setters are stable — but the eslint exhaustive-deps rule would complain if run.

---

### 14. [P1] VoyoBottomNav — global document-level `pointerdown` / `pointerup` listeners on every mount

**Location:** `src/components/voyo/navigation/VoyoBottomNav.tsx:56-68`.

```tsx
const [isHolding, setIsHolding] = useState(false);
useEffect(() => {
  const onDown = () => setIsHolding(true);
  const onUp = () => setIsHolding(false);
  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointercancel', onUp, { passive: true });
  return () => { ... };
}, []);
```

Every pointerdown ANYWHERE on the page triggers a `setIsHolding(true)` on the bottom nav, which re-renders the whole nav bar to apply `sideNavHoldOpacity: 0.28`. On a list scroll (hundreds of pointerdowns over a session), that's a lot of extra React reconciliation for a visual effect that only needs to run when the user is actively gesturing toward the nav. Worse: every nested modal / sheet / overlay on the page triggers it too.

Also: `pointermove` isn't listened to, so if the user presses-and-holds (dial input, word selection), the nav stays at 28% opacity forever until pointerup. Feels broken mid-scroll.

**Suggested fix:** either debounce the hold state, or only trip it when the pointer is within N pixels of the bottom nav (i.e. subscribe on the nav ITSELF and set holding from its own pointer events). Alternatively, fade by scroll-velocity not by any pointerdown.

---

### 15. [P2] StationHero — `isPreviewingAudio` unused (display-only never drives behaviour beyond a brightness filter)

**Location:** `src/components/classic/StationHero.tsx:78, 139, 174, 215-216, 251`.

Minor: `isPreviewingAudio` is set on fade-in, reset on fade-out and commit. Only read to tweak iframe `filter: brightness(...)` (line 251). No other consumer. Works as designed, but the name suggests it does more than it does.

Not a bug — just flagging because the name "previewing audio" feels like it should gate subscription state, audio-level exclusivity vs AudioPlayer, or similar. It's purely a brightness flag.

---

### 16. [P2] PortraitVOYO DJ volume ducking has a priming bug on first-ever activation

**Location:** `src/components/voyo/PortraitVOYO.tsx:170, 182-191`.

```tsx
const originalVolumeRef = useRef(volume);
// ...
useEffect(() => {
  if (djMode !== 'idle') {
    const current = usePlayerStore.getState().volume;
    originalVolumeRef.current = current;
    setVolume(Math.max(10, current * 0.3));
  } else {
    setVolume(originalVolumeRef.current);
  }
}, [djMode, setVolume]);
```

Initial `originalVolumeRef = useRef(volume)` captures `volume` at mount. If `djMode` is `'idle'` on mount and then immediately flips to `'listening'`, the effect runs, overwrites the ref with the current volume (good). BUT if djMode is NOT `'idle'` on first render (future refactor could have it persistent across remounts), the else-branch hasn't yet run and `originalVolumeRef.current` is stale. The effect handles this correctly because the FIRST run captures `current` before ducking. The comment at line 173-181 is well-written and documents this correctly.

Real but minor concern: `setVolume` is in deps — a wrapping selector could cause the effect to re-fire with djMode unchanged if setVolume identity changes. In practice setVolume is zustand-stable so this doesn't happen. Safe.

---

### 17. [P2] Shelf `See all` on HomeFeed is never wired

**Location:** `src/components/classic/HomeFeed.tsx:140, 157-164, 187, 191-208`.

Both Shelf and ShelfWithRefresh accept an `onSeeAll?: () => void` prop. No callsite in HomeFeed passes one (grep for `onSeeAll=` returns only the interface declarations). Dead prop by design — probably "reserve for future". Safe to delete until the feature is real, or add it to at least one shelf with a working target.

---

### 18. [P2] HomeFeed Top 10 — `numberGlow` textShadow for >=3 ranks uses shadows meant to be dark (`rgba(0,0,0,0.6)`)

**Location:** `src/components/classic/HomeFeed.tsx:1817`.

```tsx
const numberGlow = index === 0 ? '0 0 30px rgba(255, 215, 0, 0.5)' : ... : '0 0 25px rgba(157, 78, 221, 0.5), 3px 3px 0 rgba(0,0,0,0.6)';
```

For ranks 4-10 the shadow is purple glow + a hard 3px black offset. That offset is at odds with the stroke-only treatment for non-podium (the numbers are transparent, line 1833: `color: numberFill` which is `'transparent'`). Result: transparent number + hard black offset = weirdly carved-looking digits on a dark background. Easy fix (remove the offset for non-podium ranks) but worth flagging as an aesthetic bug.

---

### 19. [P2] Library SongRow — `isHovered` + matchMedia check runs at render time

**Location:** `src/components/classic/Library.tsx:303, 307`.

```tsx
const [isHovered, setIsHovered] = useState(false);
const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
```

`hasHover` is recomputed on every render of every SongRow. In a library of 100 tracks, that's 100 matchMedia calls per render pass. matchMedia is cheap but not free. Also, for a device that rotates into a dock (keyboard attached → hover becomes available), the value is captured at mount and never re-evaluated.

**Suggested fix:** hoist `hasHover` to module scope or compute once in Library and pass down via context/prop.

---

### 20. [P2] SmartImage loader effect has `currentSrc` in deps → re-runs on every successful load

**Location:** `src/components/ui/SmartImage.tsx:183`.

```tsx
useEffect(() => {
  // ... async loadImage ...
}, [src, fallbackSrc, trackId, alt, isInView, currentSrc]);
```

`currentSrc` is WRITTEN inside this effect (via `setCurrentSrc`). So every successful load re-runs the effect. The `hasLoadedRef + prevSrcRef` short-circuit at lines 94-96 catches the re-entry and returns early, so there's no double-fetch. But adding `currentSrc` to deps means every src change causes the effect to run twice (first with old currentSrc, then again with new currentSrc). Harmless with the guard, but fragile — change the guard, get duplicate fetches.

**Suggested fix:** remove `currentSrc` from deps. The inner check at line 102 (`if (!currentSrc) setLoadState('loading')`) doesn't need it to be reactive; it just needs the initial value which useState provides.

---

### 21. [P3] VideoMode `handleDragEnd` dangles — declared but has no call site

**Location:** `src/components/voyo/VideoMode.tsx:90-97`.

```tsx
const handleDragEnd = useCallback((event: any, info: { offset: { x: number; y: number } }) => {
  ...
}, [nextTrack, prevTrack]);
```

No pointer handlers, no framer-motion `<motion.div>`, nothing calls it. The `any` type on `event` suggests it's left over from a prior framer-motion stripping. Dead.

**Suggested fix:** delete, or implement a real pointer-tracking swipe (similar to ClassicMode MiniPlayer.tsx:88-120).

---

### 22. [P3] InterceptorTimeSync effect depends on `onChange` callback identity

**Location:** `src/components/voyo/LandscapeVOYO.tsx:489-501`.

```tsx
useEffect(() => {
  // ...
  onChange(next);
}, [currentTime, duration, onChange]);
```

If the parent passes a new `onChange` every render (e.g. inline arrow), the effect re-fires on every parent render even when currentTime/duration haven't moved. Parent currently passes `setZoneState` which IS stable (zustand setter), so no bug in practice — but the pattern is fragile.

**Suggested fix:** wrap `onChange` in a ref if you want to defensively decouple.

---

## Positive observations

- `useBackGuard` (hooks/useBackGuard.ts:22) and `useTabHistory` (hooks/useTabHistory.ts:27) are very well-designed. History marker pattern is clean, cleanup handles the closed-via-UI vs closed-via-back distinction correctly, and suppressNextRef in useTabHistory prevents push duplication on programmatic restores. Good docs. The coverage gap is just which components don't use them — the hooks themselves are correct.
- `Safe` boundary (ui/Safe.tsx:21) — tiny, targeted. Used liberally at HomeFeed's per-shelf granularity. Prevents one bad shelf from nuking the whole feed. Good pattern to keep.
- Fine-grained zustand selectors are EVERYWHERE (searched: `usePlayerStore(s =>` appears in every surface audited). Comments document the battery motivation consistently. The `InterceptorTimeSync` sub-component pattern at LandscapeVOYO.tsx:477-504 — extracting a 4Hz subscription into a memoized null-rendering component and pushing derived state up via callback — is a great pattern for future surfaces to copy.
- `TrackCardGestures` (ui/TrackCardGestures.tsx) is properly cleaned up on unmount, uses refs for timer state, includes pointerCancel handler, guards against scroll-as-gesture via MOVE_CANCEL_PX. The `touchAction: 'manipulation'` comment (line 173-174) documents an important fix correctly.
- `StationHero`'s two-observer pattern (`nearObs` with 250% rootMargin for mount-gate, `viewObs` with threshold 0.35 for behaviour-gate) is excellent. The `fadeIntervalRef` cleanup (line 135-138, 158-161) fixes a real interval leak that would have kept postMessage-ing a dead iframe forever.
- VoyoPortraitPlayer's DJ ducking effect (PortraitVOYO.tsx:182-191) intentionally excludes `volume` from deps and documents the reasoning in a full paragraph. Good discipline.

---

## Dead-button summary (answering the specific ask)

Found 5 more dead / miswired UI elements beyond the NowPlaying repeat/shuffle one:

1. **NowPlaying track-info X button** (`NowPlaying.tsx:502-507`) — icon is `X`, fires `setExplicitLike`. Both wrong icon and unwanted side effect.
2. **HomeFeed Bell button** (`HomeFeed.tsx:1521`) — fake red dot + fake "No new notifications" toast. Full no-op.
3. **LandscapeVOYO Portrait button** (`LandscapeVOYO.tsx:821-827`) — bound to empty `handleBackToPortrait`.
4. **LandscapeVOYO triple-tap / long-press** (`LandscapeVOYO.tsx:98-128`) — `onTripleTap` and `onHold` are advertised, bound to `onVideoMode` and DJ-open, but `onVideoMode` is never forwarded from the parent prop chain to mode-switch.
5. **VideoMode hint text "Swipe up/down / Double-tap / Triple-tap"** (`VideoMode.tsx:275-279`) — describes gestures not implemented. Ghost instructions.

Plus non-button dead code (harmless but drift):
- `ClassicMode.handleArtistClick` (line 505) — orphan.
- `HomeFeed.ShelfWithRefresh` `onRefresh` / `isRefreshing` props (line 184-186, 191) — accepted, ignored.
- `HomeFeed.handleRefresh` + `isRefreshing` state (1268, 1330) — wired to ShelfWithRefresh that ignores them.
- `LandscapeVOYO.setPlaybackSource` selector (523) — subscribed, never called.
- `VideoMode.showControls/controlsTimeoutRef/tapCountRef/tapTimeoutRef/lastTapTime` (51-62) — scaffolding for a removed behaviour, silenced with `void`.
