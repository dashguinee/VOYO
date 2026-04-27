# VOYO Music — PWA & Mobile Responsiveness Baseline (2026-04-27)

**Scope:** Strike-team reference for evaluating mobile-friendliness on Home, Player, Moments, Search, Library. Read-only audit. Companion to `DEEP_MAP_2026-04-26.md`.

**Stack confirmed:** Vite + React 18 + TypeScript, Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`), Zustand stores, in-memory `appMode` state with `react-router-dom` only at the top for `/:username`. PWA shell = `public/manifest.json` + `public/service-worker.js`. No `<meta name="apple-mobile-web-app-capable">` polyfill needed (already present).

---

## 1. PWA-mobile fundamentals — scorecard

| # | Item | Status | Evidence (file:line) |
|---|---|---|---|
| 1 | `viewport-fit=cover` on viewport meta | PASS | `index.html:7` — `width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no` |
| 1a | `interactive-widget` declaration (overlays-content / resizes-content) | **FAIL** | `index.html:7` — absent. Default behavior on Android Chrome resizes content when keyboard opens; no explicit override. |
| 1b | `user-scalable=no` + `maximum-scale=1.0` | PASS as design choice, **a11y red flag** | `index.html:7`. Apple ignores this on iOS but Android Chrome obeys. Fails WCAG 1.4.4 Resize Text. |
| 2 | `env(safe-area-inset-*)` on top + bottom chrome | PARTIAL PASS | 36 call sites across src. Top header: `App.tsx:1053`. Bottom nav: `ClassicMode.tsx:348`. Search overlay: `SearchOverlayV2.tsx:739, 877`. Player: `VoyoPortraitPlayer.tsx:1270, 5189, 5225`. Moments: `VoyoMoments.tsx:119, 277`. Take-Out chip: `VoyoPortraitPlayer.tsx:1270-1271` (also handles `safe-area-inset-right` for notch landscape). |
| 2a | `safe-area-inset-left` / `right` on landscape | PARTIAL | Only `VoyoPortraitPlayer.tsx:1271` uses `safe-area-inset-right`. ArtistPage, Library, HomeFeed don't pad horizontally for landscape notch. |
| 3 | iOS 100vh fix (`100dvh` or JS-set `--vh`) | **FAIL — half-wired** | `index.css:55` declares `--vh: 1vh` "Updated by JS for iOS browser chrome fix" but **no JS ever sets it** (grep `setVh\|--vh` returns only the hook for DM chat). The `--vh` token is a dead variable. Layout works only because `html, body, #root { height: 100% }` (`index.css:74-79`) anchors to viewport via the parent chain — fragile if anyone introduces `100vh`. |
| 3a | `100vh` regressions in code | **1 found** | `YouTubeIframe.tsx:795` — landscape iframe uses `height: '100vh'` with `maxHeight: '100dvh'` as clamp. On mobile Safari this still overflows because the height is set to 100vh; the maxHeight only clamps display, not layout. Should be `height: '100dvh'` directly. |
| 3b | `useMessagingViewport` hook (visualViewport tracking) | PRESENT but underused | `hooks/useMessagingViewport.ts` exists; only consumed in `DirectMessageChat.tsx:179`. Not used by Player, Moments, Search, or comments drawer (`VoyoMoments.tsx:910`). |
| 4 | `touch-action` declarations on draggable / scrollable | PARTIAL | Body has `touch-action: manipulation` (`index.css:94`). Per-surface: Moments container `touchAction: 'none'` (`VoyoMoments.tsx:112`); ClassicMode root `pan-y` (`ClassicMode.tsx:205`); Player canvas `manipulation` (`VoyoPortraitPlayer.tsx:5109`); Player center section `pan-y` (`VoyoPortraitPlayer.tsx:5321`); HomeFeed scroll container `pan-y` (`HomeFeed.tsx:3076`); YouTubeIframe drag overlay `none` (`YouTubeIframe.tsx:947`). DynamicIsland `none` (lines 587, 597). **OK overall.** |
| 5 | `-webkit-tap-highlight-color: transparent` | **FAIL — only ONE site** | `CardHoldActions.tsx:193` is the **only** call site. Body lacks the global declaration. iOS shows the default grey tap flash on every other tappable element (header search, profile, all buttons). |
| 6 | `user-select: none` on draggable handles | PASS at body | `index.css:95`. Reinforced on Moments container, CardHoldActions, TrackCardGestures. |
| 7 | `overscroll-behavior` on scroll containers | PARTIAL | Body `overscroll-behavior: none` (`index.css:78, 96`). Player `overscrollBehavior: 'none'` (`VoyoPortraitPlayer.tsx:5109`). HomeFeed `overscroll-behavior: none` (`HomeFeed.tsx:3076`) AND `overscrollBehaviorX: 'contain'` on a horizontal rail (`HomeFeed.tsx:2048`). Library `flex-1 overflow-y-auto` (`Library.tsx:1012`) — **no overscroll-behavior**, so vertical rubber-band can leak through to the parent. |
| 8 | Input zoom prevention (`font-size ≥ 16px`) | **FAIL — multiple sites** | iOS triggers zoom-on-focus when font-size is < 16px. Found: `SearchOverlayV2.tsx:819` `text-[15px]`; `Library.tsx:918` `text-[14px]`; `DynamicIsland.tsx:767` `text-[12px]` (reply input); `VoyoMoments.tsx:281` (commentInput) `fontSize: 13`; `Dahub.tsx:888` `text-lg` (PASS, this is 18px); `Dahub.tsx:955` no size set → inherits body 16px (PASS). The first four will zoom on iOS focus. |
| 9 | Touch targets ≥ 44×44 px | **PARTIAL FAIL** | Player and full-screen buttons enforce `min-w-[44px] min-h-[44px]` (e.g. `VoyoPortraitPlayer.tsx:859, 962, 1171, 2207, 2299`; `ClassicMode.tsx:261`; `Dahub.tsx:553, 929, 931`). Header buttons FAIL: `App.tsx:1101-1116` Search button is `p-2` with `w-[17px] h-[17px]` icon → ~33×33px hit. `App.tsx:1119-1133` Profile button is `p-1.5` with `w-[15px] h-[15px]` → ~27×27px. DynamicIsland send button `w-8 h-8` (`DynamicIsland.tsx:772`) = 32×32px. Comment send button is 44×44 (`VoyoMoments.tsx:288-296`). Search-clear `X` (`SearchOverlayV2.tsx:823-829`) is `w-[14px] h-[14px]` icon with `p-1` padding → 22×22px. |
| 10 | Service worker scope, offline fallback | PASS | `public/service-worker.js`: scope `/`, AUDIO_CACHE_NAME `voyo-audio-v2` preserved across versions, fetch handler precaches hashed JS/CSS from index.html (`service-worker.js:28-44`), offline fallback page exists (`public/offline.html`). Auto-update broadcast on activate (`service-worker.js:64-74`). Registered with `updateViaCache: 'none'` (`main.tsx:37`). |
| 10a | Manifest icon set | PASS | `manifest.json:12-22` — 72/96/128/144/152/192/384/512 + svg with `purpose: 'any maskable'` on 192/384/512. |
| 10b | `display`, `theme_color`, `background_color`, `start_url`, `scope` | PASS | `manifest.json:5-10`. Theme `#8b5cf6`, bg `#0a0a0c`, display `standalone`, orientation `any`. |
| 10c | `apple-touch-icon` chain | PASS | `index.html:22-25` — 152, 180, 192. |
| 10d | `share_target` declaration | PASS | `manifest.json:40-45` — `q` param routes to `/`. |
| 11 | iOS standalone hacks | PARTIAL | `apple-mobile-web-app-status-bar-style: black-translucent` (`index.html:20`) + `apple-mobile-web-app-capable: yes` (`index.html:19`) — correct. Home-indicator clearance handled via safe-area-inset-bottom on the relevant chrome (see #2). |
| 11a | Detect `standalone` mode for chrome adjustments | **FAIL — not detected anywhere** | grep finds no `navigator.standalone` or `display-mode: standalone` media query. Installed app and browser get the same chrome height. |
| 12 | `pointer: coarse` media-query usage | PARTIAL | One usage: `index.css:637` — `@media (max-width: 768px), (pointer: coarse)` lowers blur intensities. **123 hover: classes** in src (`grep -c hover:`) without coarse-pointer guards. Cards leak hover-state on touch devices (`VoyoPortraitPlayer.tsx:1440` group-hover scale, etc.). |
| 13 | `prefers-reduced-motion` honored | PASS | `index.css:607-631` disables ~12 named animations. |
| 14 | Wake Lock for background play | PASS | `audio/bg/useWakeLock.ts` (request + release). Note: deep map says "WakeLock NOT implemented" — that comment is stale; it IS implemented now. |
| 15 | Window error reporting | PASS | `utils/errorReporter.ts` mounted in `main.tsx:14` — captures `window_error` + `unhandled_rejection` to telemetry. |
| 16 | Web Vitals (LCP/INP/CLS) | PASS | `services/webVitals.ts` mounted in `main.tsx:18`. Metric gives p75 visibility. |

**Bottom line on fundamentals:** PWA shell + safe-area + service worker are solid. Three real holes: (a) missing tap-highlight-transparent globally, (b) inputs that zoom on iOS, (c) the `--vh` JS bridge is declared in CSS but never written.

---

## 2. Responsiveness anti-patterns — what to look for

### 2A. Hard-coded pixel dimensions without `max-w` / `clamp` / `vw`

`HomeFeed.tsx` is the worst offender — 30+ hard-coded pixel sizes for cards, vinyls, albums, station heroes (lines 500-530, 867-868, 902, 1099-1100, 1382, 1965-1966, 2104-2105, 3041, 3325, 3387, 3464, 3493). Some have `max-w` clamp (e.g. `w-[82vw] max-w-[420px]` line 3464 — good pattern). Most don't.

Player has fewer issues but `VoyoPortraitPlayer.tsx:5182` uses `height: 'calc(100% - 264px)'` — magic number that breaks if the Layer-B height changes.

### 2B. Missing `overflow-hidden` causing horizontal scroll

`html, body, #root` have `overflow: hidden` (`index.css:74-79`), so the root is fine. Risk surfaces are the inner scroll containers — already audit-checked: `VoyoPortraitPlayer.tsx:5096` adds `overflow-x-hidden` defensively.

### 2C. `position: fixed` without safe-area

Spot-checks PASS for the user-facing chrome (header, bottom nav, install banner). One miss: `VoyoSplash.tsx:111` `fixed inset-0 z-[9999]` — splash screen ignores safe-area, but that's intentional since it's a full-bleed boot screen. Pull-to-refresh (`App.tsx:954`) uses `top` directly without `env()` — fine because it's a transient indicator.

### 2D. Z-index conflicts (no system)

**Major issue.** 27 `z-[NN]` literals in src, ranging from 55 → 9999, with no documented stacking convention. From `grep "z-\[" src/`:

| Layer | Count | Examples |
|---|---:|---|
| 9999 | 3 | Splash, ErrorBoundary, UpdateButton (`App.tsx:440, 9998`) |
| 9000 | 1 | DreamBackdrop (`oyo-ui/DreamBackdrop.tsx:144`) |
| 200 | 1 | Player overlay (`VoyoPortraitPlayer.tsx:3114`) |
| 150 | 1 | Player share-modal (`VoyoPortraitPlayer.tsx:3237`) |
| 100 | 6 | OfflineIndicator, FirstTimeLoader, several Player modals |
| 90 | 2 | Player drawer, BoostSettings |
| 80 | 1 | DirectMessageChat |
| 70 | 3 | Dahub modals, DiscoExplainer |
| 65 | 1 | Library bottom sheet |
| 60 | 2 | IOSInstallSheet, Search bottom toast |
| 56 | 2 | AccountMenu dropdown, HomeFeed friends modal |
| 55 | 3 | AccountMenu backdrop, HomeFeed backdrop, InstallBanner |
| 51 | 1 | Search header (`SearchOverlayV2.tsx:756`) |
| 50 | 1 | Search container (`SearchOverlayV2.tsx:738`) |
| (Tailwind defaults z-10/20/30/40/50) | many | mixed in |

Bug-prone interactions to test: DynamicIsland reply (z-20 inside the header z-50) over the Player (z-30 internal); Library bottom sheet (z-65) when InstallBanner (z-55) is open; AccountMenu (z-56) over Player modals (z-100 wins).

**Recommendation when fixing:** establish a documented scale `--z-base: 0; --z-chrome: 30; --z-overlay: 50; --z-modal: 70; --z-toast: 90; --z-system: 100;`.

### 2E. Layout shift (CLS) sources

- **Images without `aspect-ratio`:** Found 5 explicit `aspectRatio` declarations (`VibesReel.tsx:47, 99`, `StationHero.tsx:169`, `HomeFeed.tsx:787, 3466`). 50 total `<img>` tags in src; only 27 have explicit `loading="lazy"` (54%). HomeFeed friend avatars (`HomeFeed.tsx:1666-1671`, `1810-…`) have no lazy attr and no skeleton sizing — friend rail will jolt as images load.
- **Late font load:** `index.html:84-86` loads Satoshi + Space Grotesk + Italianno + Fraunces from external CDNs (Fontshare, Google) with `display=swap` — produces FOUT, body falls back to system-ui. CLS impact is mostly horizontal (Italianno especially is wider than fallback). No `font-display: optional` for the script faces. Preconnects on lines 74-83 mitigate but don't eliminate.
- **Late JS-injected layout:** `App.tsx:1046-1066` header `feedHeaderHidden` toggles `maxHeight: 0 → 120px` with 800ms transition. Acceptable (intentional reveal), but the initial mount paints at 0 then jumps to 120px — first frame after JS hydrate has CLS ≈ (120 / viewport-h).
- **Lazy chunk pop-in:** `App.tsx:38-44` lazy-loads PortraitVOYO, ClassicMode, SearchOverlay, ArtistPage, UniversePanel, VideoMode, LandscapeVOYO. Each transition between modes hits Suspense; `App.tsx` wraps with `<Suspense fallback>` — verify the fallback has the same height as the resolved component (otherwise CLS spike on every mode switch).

### 2F. Animation jank / Safari-specific

- **132 `backdrop-blur` / `backdropFilter` usages** across src. The mobile clamp at `index.css:643-659` reduces them on `(max-width: 768px), (pointer: coarse)` — good defense. But `glass-card` and `glass-panel` still use 20-40px blur on tablet sizes. iOS Safari's `backdrop-filter` is GPU-bound and triggers full-layer recomposite each frame.
- **`filter: blur` on Safari** known issue: there's a v672 fix history entry (DEEP_MAP §2.8) — `Layer B opacity blur was re-rasterizing on Safari → dropped, opacity carries the fade`. Lesson learned. But `App.tsx:1077, 1129` still use `filter: drop-shadow` and `filter: 'blur(2px)'` as static decorative effects — small enough to be fine.
- **Animated `box-shadow`:** found in `voyo-glow-pulse`, `voyo-iframe-pulse`, `voyo-oye-bubble`, `voyo-orb-pulse`, `voyo-nextup-pulse`, `glow-pulse`, `playing-pulse`, `voyo-charging-pulse` — each forces a paint on every frame. They run at 1.5-2.4s loops on multiple buttons simultaneously (Oye, Mini Player, Next-Up, orb). On mid-tier Android this is the #1 jank source.
- **Layout-thrashing transforms:** scan PASSED. Most `transform` usages are `translateY/translateX/scale` (composited). `HomeFeed.tsx:2018-2019` has `scale-[1.3]` group-hover scale-[1.4] on backgrounds — promoted, fine.
- **`filter: hue-rotate` in `voyo-araba-shimmer`** (`index.css:771-774`) — Safari treats hue-rotate as a paint trigger. Loops 4s. Verify on iPhone SE.

---

## 3. Per-surface watch-outs

### 3.1 Home (`src/components/classic/HomeFeed.tsx`, 3454 LOC)

1. **Friend avatar rail (line 1606-1675) has no `loading="lazy"` and no fixed aspect-ratio container** — verify no CLS as friend avatars resolve.
2. **Hard-coded card sizes** at lines 500, 867, 1099, 1382, 1965, 2104, 3041, 3325 — test on iPhone SE (375 px). The 440px disc at line 3041 will require horizontal scroll — confirm it lives inside `overflow-hidden` or `overflow-x-auto` parent.
3. **Snap-scroll horizontal rails** at line 2048 use `scrollSnapType: 'x proximity'` with `overscrollBehaviorX: 'contain'` — good. But the parent's `padding-bottom: 60px` is static.
4. **VoyoLiveCard** (per DEEP_MAP §1) has 4Hz cascade; verify still uses `contain: paint` (it does — `HomeFeed.tsx:3136, 3346`).
5. **Friend modal** (line 1573) is `fixed left-4 right-4` — on landscape iPad 1024 width, 16px gutters look comically narrow. Add `max-w-md mx-auto` for tablet.

### 3.2 Player (`src/components/voyo/VoyoPortraitPlayer.tsx`, 6294 LOC)

1. **`height: 'calc(100% - 264px)'` (line 5182)** — magic 264 number. If parent's safe-area padding shifts, anchor breaks. Consider `flex-1` instead.
2. **Drag-to-portal logic** (DEEP_MAP §2.5) — verify on iPad with split-screen Safari (where viewport width can be 320px); the 120px halo trigger zone is set in pixels, not %.
3. **Right toolbar** (line 5332) — touch targets need verification at 375×667.
4. **Floating mini iframe** sits at floating coordinates — verify drag bounds clamp to safe-area on iPhones with home-indicator (env(safe-area-inset-bottom) + 16px is set on Take-Out chip line 1270, but the mini iframe itself in YouTubeIframe.tsx must have similar clamp).
5. **Layer-B opacity transition (line 5481)** — already de-jankified per v672/v673; just verify.
6. **Animated box-shadow on Oye/Iframe/NextUp/Orb pulses** (see §2F) — measure frame rate on Android mid-tier during portal scroll.

### 3.3 Moments (`src/components/voyo/feed/VoyoMoments.tsx`)

1. **Comment input fontSize: 13** (`VoyoMoments.tsx:281`, line 911 inside `commentInputWrap`) — iOS will zoom. Bump to 16 or remove the explicit fontSize.
2. **commentsBackdrop is `position: absolute, inset: 0` (line 209-214)** — relative to the Moments container, not viewport. Verify it covers the whole feed. If parent has any transform, fixed-positioning would be broken anyway.
3. **commentsDrawer maxHeight: '70%'** (line 217) — safe-area-inset-bottom IS applied at `commentInputWrap.paddingBottom` (line 277), but the maxHeight is computed BEFORE the safe-area padding. On iPhones with 34px home indicator, the input ends up partially obscured during scroll-to-bottom. Test with `useMessagingViewport` integration.
4. **CompassArc filter: blur on offset-2/3 items (line 371)** — runs on every frame of category swipe transition. Animate transform/opacity, not filter.
5. **OYE float-up animation (line 312, oyeF)** — no `pointer-events: none` declared at the css(); verify before merging.

### 3.4 Search (`src/components/SearchOverlayV2.tsx`)

1. **Input fontSize text-[15px] (line 819)** — iOS zoom on focus.
2. **Search header transform translates by `100dvh - 100% - safe-areas` (line 758)** — depends on `100dvh`. On iOS Safari 15 and below, `dvh` falls back to `vh` and the search-at-bottom dock will be 60-90px too low. Consider providing a `dvh-supported` feature query fallback.
3. **Backdrop dim is `bg-black/90` `fixed inset-0` (line 732)** — no safe-area adjustment, but it's a full-bleed dim, fine.
4. **Result row** — verify `w-12 h-12` thumbnail (line 116) plus row click target meets 44px.
5. **Bottom toast** at `z-[60]` (line 1109) and `bottom-24` — magic 24. If keyboard opens, toast disappears off-screen.

### 3.5 Library (`src/components/classic/Library.tsx`)

1. **Search input text-[14px] (line 918)** — iOS zoom on focus.
2. **Filter pills at line 932 use `text-[13px]`** — fine for buttons (not inputs), but min-h is `py-1.5` ≈ 26px including border — under 44px. Whole row is `gap-2` `overflow-x-auto`, may hit user fat-finger issues.
3. **Bottom-sheet for playlists (line 196)** uses `pb-[calc(env(safe-area-inset-bottom)+1.25rem)]` (line 201) — good.
4. **Scroll list paddingBottom: `calc(76px + env(safe-area-inset-bottom, 0px))` (line 1013)** — explicitly sized so the bottom nav never covers list end. Pattern to replicate.
5. **No `overscroll-behavior: contain`** on the scroll container — vertical rubber-band leaks.

---

## 4. Verification recipes

### 4.1 DevTools mobile probes

```
Chrome DevTools → Cmd+Shift+M (or F12 → toggle device toolbar)
Test these viewports:

  iPhone SE       375 × 667    — narrowest realistic
  iPhone 12 Pro   390 × 844    — modern iPhone baseline
  Pixel 7         412 × 915    — Android baseline
  iPad mini       768 × 1024   — tablet portrait (verify chrome scales)
  iPad mini land  1024 × 768   — landscape (notch/bezel safe-area)

Throttling:
  Network: Slow 3G  (catches FOUT, image pop-in)
  CPU: 4× slowdown  (catches blur jank)
```

For each viewport, run this sequence:
1. Reload, observe splash → first paint of HomeFeed.
2. Tap header search button — note tap delay + iOS zoom on the input.
3. Open Player, scroll to mix board (Layer B), watch for jank during opacity fade.
4. Open Moments, swipe through 5 categories, open comments drawer, focus input.
5. Open Library search, type 3 chars, tap a result.
6. Rotate to landscape mid-track — verify YouTubeIframe doesn't overflow.

### 4.2 iOS Safari real-device (no devtools shortcut)

1. Connect iPhone via USB to Mac, Settings → Safari → Advanced → Web Inspector ON.
2. Mac Safari → Develop → [iPhone] → voyomusic.com.
3. **Look for**: input zoom on focus, tap-highlight grey flash, safe-area gaps, 100vh overflow on landscape iframe.

### 4.3 Lighthouse PWA + a11y audit

```bash
# From the project root with the build served:
npm run build
npx serve dist -p 4173 &
npx lighthouse http://localhost:4173 \
  --preset=mobile \
  --only-categories=pwa,accessibility,performance,best-practices \
  --output=html --output-path=./outputs/LH-2026-04-27.html \
  --chrome-flags="--headless"
```

Expect drops on:
- **Tap targets** (a11y) — header buttons, DynamicIsland send.
- **Color contrast** — `text-white/30`, `text-white/40`, `text-white/45` are common (search 50+ uses) — fail WCAG AA on dark BG.
- **PWA installability** — should pass; SW + manifest are correct.
- **Performance**: FCP / LCP penalized by 4 external font hosts and the 132 backdrop-blur sites.

### 4.4 Quick smoke for keyboard-overlap

1. Open in Chrome DevTools mobile mode → Pixel 7.
2. Resize window vertical to 500px (simulates keyboard up).
3. Open Search, then Moments comments, then DynamicIsland reply. None of the input bars should be covered by the bottom of the viewport.

---

## 5. Quick-wins glossary — patterns to adopt globally

### 5A. Cheap wins (one-line fixes)

| Fix | Where | Why |
|---|---|---|
| `* { -webkit-tap-highlight-color: transparent; }` in `@layer base` | `index.css:67-72` | Currently only `CardHoldActions.tsx:193` has it. Globally removes iOS grey flash. |
| Set body input `font-size: 16px` minimum via base layer | `index.css` | Kills iOS zoom-on-focus globally. Then per-component can `text-sm` for visual size while keeping the 16px minimum on inputs only. |
| Wire the `--vh` setter in `main.tsx` | `main.tsx`, before `createRoot` | The CSS already declares `--vh: 1vh` (`index.css:55`). 6 lines of JS to make it real. |
| Replace `100vh` → `100dvh` in `YouTubeIframe.tsx:795` | one line | Eliminates the only 100vh regression in src. |
| Add `interactive-widget=resizes-content` to viewport meta | `index.html:7` | Android Chrome behavior on keyboard becomes predictable. |
| Add `overscroll-behavior: contain` to Library list | `Library.tsx:1009` | No more vertical bounce leaking to root. |

### 5B. Medium wins (small refactors)

| Fix | Effort | Payoff |
|---|---|---|
| Adopt z-index scale (CSS vars) and migrate the 27 hardcoded values | ~1h | Predictable stacking, no more "z-[9000] vs z-[100]" surprises. |
| `@media (hover: hover) and (pointer: fine)` wrapper for hover: classes | ~30min global codemod | Stops touch devices from sticking in hover state after tap. |
| Apply `useMessagingViewport` to Search, Moments-comments, DM | ~1h | Inputs always above keyboard. |
| Add `loading="lazy"` to remaining 23 `<img>` tags | 15min | Shaves ~200kb off first paint on Home. |
| Add `font-display: optional` to script-face fonts (Italianno, Fraunces) | 1 line | Eliminates worst FOUT shifts. |

### 5C. Architectural wins (larger investments)

- **`content-visibility: auto`** on off-screen rails in HomeFeed (Top10, OYE Africa, Vibes Reel cards). Saves render budget when not in viewport. Tailwind 4 has `content-visibility-auto` utility — drop-in.
- **`will-change` budget rule:** audit current usage (only `SearchOverlayV2.tsx:766` and one removed line in HomeFeed). Codify "only on actively-animating elements, removed when idle" in a code review checklist.
- **`:where()` to flatten specificity** for the `voyo-*` utility classes — reduces specificity wars when component-level styles need to override animation classes.
- **Replace 8 animated `box-shadow` keyframes with `outline` or pseudo-element ring + opacity** — moves them off the paint thread. Especially for Oye, Iframe, NextUp pulses that run permanently when active.

---

## 6. Surface-by-surface gotcha quick reference

| Surface | Top concern |
|---|---|
| **Home** | Friend avatars CLS + hard-coded card pixel sizes on iPhone SE. |
| **Player** | Animated box-shadow pulses jank during portal scroll. Magic `264px` Layer-B math. |
| **Moments** | Comment input zoom (fontSize:13). CompassArc filter:blur during swipe. |
| **Search** | Input zoom (text-[15px]). 100dvh search-at-bottom transform on Safari ≤15. |
| **Library** | Search input zoom (text-[14px]). Missing overscroll-behavior:contain on list. |
| **Header (App.tsx)** | Search + Profile buttons under 44×44 hit area. No `display-mode: standalone` detection. |

---

## 7. Files of interest (absolute paths)

- `/home/dash/voyo-music/index.html` — viewport, PWA meta, font CDN
- `/home/dash/voyo-music/src/index.css` — Tailwind v4 entry + design tokens + 1182 lines of animations & utilities
- `/home/dash/voyo-music/src/main.tsx` — error reporter, web vitals, SW register
- `/home/dash/voyo-music/src/App.tsx` — orientation, header, Suspense boundaries
- `/home/dash/voyo-music/src/hooks/useMessagingViewport.ts` — visualViewport tracker (under-used)
- `/home/dash/voyo-music/src/audio/bg/useWakeLock.ts` — wake lock (DEEP_MAP outdated, this exists)
- `/home/dash/voyo-music/public/manifest.json`, `/home/dash/voyo-music/public/service-worker.js`, `/home/dash/voyo-music/public/offline.html`
- `/home/dash/voyo-music/vite.config.ts`, `/home/dash/voyo-music/vercel.json`
- `/home/dash/voyo-music/src/components/classic/HomeFeed.tsx` (3454 LOC)
- `/home/dash/voyo-music/src/components/voyo/VoyoPortraitPlayer.tsx` (6294 LOC)
- `/home/dash/voyo-music/src/components/voyo/feed/VoyoMoments.tsx`
- `/home/dash/voyo-music/src/components/search/SearchOverlayV2.tsx`
- `/home/dash/voyo-music/src/components/classic/Library.tsx`
- `/home/dash/voyo-music/src/components/ui/DynamicIsland.tsx`
- `/home/dash/voyo-music/src/components/classic/ClassicMode.tsx` (bottom nav)
- `/home/dash/voyo-music/src/components/YouTubeIframe.tsx` (line 795 — only 100vh in src)

---

*End of baseline. Next steps for the strike team: pick the cheap-wins from §5A, run the Lighthouse + 5-viewport probe in §4, then triage by user-impact (input zoom > tap-highlight > 100dvh polyfill > z-index hygiene).*
