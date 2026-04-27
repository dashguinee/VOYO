# Globals Specialist Fix Report — 2026-04-27

## Summary
- Items in scope: 12
- Applied: 11
- Skipped: 1 (G11 — `@media (hover: hover) and (pointer: fine)` codemod, intentionally deferred to per-surface agents)
- TypeScript compile: PASS (`npx tsc -b` exit 0, no diagnostics)

## Fixes Applied

### G1: Global tap-highlight transparent
- File: `src/index.css` (`@layer base { * { ... } }`)
- Snippet added: `-webkit-tap-highlight-color: transparent;` on the universal selector inside `@layer base`.
- Reason: research §1 #5 — only `CardHoldActions.tsx:193` had this; every other tappable showed the iOS grey flash. One-line global removes the artefact across the whole app.

### G2: 16px input zoom floor
- File: `src/index.css` (`@layer base`, after the `*` reset)
- Snippet added:
  ```css
  input, textarea, select { font-size: max(16px, 1rem); }
  ```
- Reason: research §1 #8 — Search (`text-[15px]`), Library (`text-[14px]`), VoyoMoments comment (`fontSize: 13`), DynamicIsland reply (`text-[12px]`) all triggered iOS zoom-on-focus. The base-layer floor uses `max(16px, 1rem)` so existing visual classes still control non-input typography while the *computed* input font-size is clamped.

### G3: --vh JS bridge
- File: `src/main.tsx` (after `installWebVitals();`, before the orientation unlock block)
- Snippet added: 11-line block that sets `document.documentElement.style.setProperty('--vh', ...)` from `visualViewport?.height ?? innerHeight`, wired to `resize` + `orientationchange` + `visualViewport.resize` listeners (all `passive: true`).
- Reason: research §1 #3 — `index.css:55` has declared `--vh: 1vh` for months with no JS ever updating it. Now `calc(var(--vh) * 100)` is a real, dynamic, keyboard-aware viewport height.

### G4: Viewport meta `interactive-widget=resizes-content`
- File: `index.html:7`
- Snippet changed: appended `, interactive-widget=resizes-content` to the existing viewport meta (kept `viewport-fit=cover`, kept `user-scalable=no` per existing design choice — research §1 #1b a11y flag is documented but out of scope here).
- Reason: research §1 #1a — Android Chrome keyboard behaviour now predictable; layout reflows when keyboard opens instead of overlaying content.

### G5: `100vh → 100dvh` in YouTubeIframe
- File: `src/components/YouTubeIframe.tsx:795`
- Snippet changed: `height: '100vh'` → `height: '100dvh'`. `maxHeight: '100dvh'` was already there; this aligns the primary value with the clamp.
- Reason: research §1 #3a — only 100vh regression in src; on iOS Safari the `maxHeight` clamp masked display but not layout, leaving the landscape iframe oversized.

### G6: App.tsx header buttons hit area
- File: `src/App.tsx` (Search button line ~1101, Profile button line ~1119)
- Snippet changed: added `inline-flex items-center justify-center min-w-[44px] min-h-[44px]` to both buttons. Visual icons (Search 17px, Profile 15px) unchanged.
- Reason: research §1 #9 — Search ~33×33, Profile ~27×27 hit-areas were below the 44px floor on the most-used header chrome. Visual restraint preserved (icons stay small), tap area now meets HIG/M3 minimums.

### G7: --safe-x CSS variable
- File: `src/index.css` (in `:root`)
- Snippet added: `--safe-x: max(env(safe-area-inset-left), env(safe-area-inset-right));` with a documentation comment block for surface agents.
- Reason: audit §7 — only `VoyoPortraitPlayer.tsx:1271` handles landscape notch today. Var lets every page wrapper apply `padding-inline: var(--safe-x)` consistently.

### G8: --z-* scale
- File: `src/index.css` (in `:root`)
- Snippet added: 6 vars (`--z-base: 0; --z-chrome: 30; --z-overlay: 50; --z-modal: 70; --z-toast: 90; --z-system: 100;`) with a documentation block referencing research §2D and the deferred 27-literal migration.
- Reason: research §2D — establish the scale + comment vocabulary now; literal migration left for follow-up so agents touching individual files can pick from this scale.

### G9: prefers-reduced-motion extension
- File: `src/index.css:617-672` (extending the existing `@media (prefers-reduced-motion: reduce)` block)
- Snippet added: a second selector group targeting `*[style*="voyo-iframe-pulse"]`, `voyo-oye-bubble`, `voyo-orb-pulse`, `voyo-nextup-pulse`, `voyo-charging-pulse`, `top10-marquee`, `voyo-anchored-halo-breath`, `glow-pulse`. Each gets `animation: none !important`.
- Reason: audit §7 — the existing block disables ~12 named animations via class selectors; the listed `voyo-*-pulse` and inline-defined keyframes (`top10-marquee`, `voyo-anchored-halo-breath`) were not covered. Used attribute-substring selectors so the rule catches all inline-style usages without needing to migrate per-component class names. Note: there is NO `voyo-glow-pulse` keyframe in src — the actual name is `glow-pulse` (line 363); rule targets that real name.

### G10: Backdrop-blur tiering vars
- File: `src/index.css` (in `:root`)
- Snippet added: `--blur-chrome: 8px; --blur-modal: 16px; --blur-hero: 28px;` with documentation comment.
- Reason: audit §7 — 132 ad-hoc backdrop-filter sites with inconsistent values (FriendSearchPill 24px, commentsDrawer 28px, Search input 14px, glass-card 20px, glass-panel 40px). Vars give the per-surface agents a 3-tier vocabulary to migrate to. Migration of existing sites is a follow-up.

### G12: font-display: optional for script faces
- File: `index.html:86`
- Snippet changed: split the single Google Fonts `<link>` into two — Space Grotesk keeps `&display=swap` (heading display font, FOUT acceptable), Italianno + Fraunces moved to a second `<link>` with `&display=optional`.
- Reason: research §2E — Italianno is the worst CLS offender (system fallback ~25% wider). `display=optional` means the browser uses the face only if it arrives within ~100ms; otherwise it stays on the fallback for the session. No FOUT swap = no horizontal shift.

## Skipped

### G11: `@media (hover: hover) and (pointer: fine)` codemod
- Status: NOT EXECUTED.
- Reason: research §5B notes 123 `hover:` Tailwind classes across src. A blanket regex replace risks breaking custom variants and is opinionated about which `hover:` classes should also activate on focus-visible. Per-surface agents own this — they understand the local touch ergonomics of TrackCard, OyeButton, ExpandVideoButton, etc.
- Recommendation: each surface agent wraps their `hover:` rules in a media query at the time they're triaging that surface.

## Cross-Surface Notes (for other strike-team agents)

- **`--safe-x`** CSS var defined in `:root` (src/index.css). Surface agents must apply via `padding-inline: var(--safe-x)` to top-level page wrappers (HomeFeed, Library, ArtistPage, SearchOverlay, DynamicIsland chrome). Currently only `VoyoPortraitPlayer.tsx:1271` handles landscape notch — add to all other surfaces.
- **`--z-*`** scale defined: `--z-base/chrome/overlay/modal/toast/system` (0/30/50/70/90/100). Agents touching files with `z-[NN]` literals should migrate to one of these tokens (use `style={{ zIndex: 'var(--z-overlay)' }}` or Tailwind arbitrary `z-[var(--z-modal)]`). 27 hardcoded values still live across src (see research §2D table) — migrate opportunistically.
- **`--blur-chrome`/`--blur-modal`/`--blur-hero`** tiers defined (8 / 16 / 28px). Surface agents migrate their `backdrop-filter: blur(Npx)` sites to one of these vars: 8px for nav/header/light glass, 16px for modals/drawers/comments, 28px for full-bleed hero glass. Mobile clamp in `@media (max-width: 768px)` will further reduce blur intensity.
- **`hover:` codemod** NOT executed — flagged for per-surface review. Each surface agent wraps their hover rules in `@media (hover: hover) and (pointer: fine)` when they triage the surface.
- **`--vh` token** is now JS-driven from `main.tsx`. Components can use `calc(var(--vh) * 100)` instead of `100vh`/`100dvh` when they need a viewport-height that responds to the iOS keyboard or visual viewport changes (already preferable to `useMessagingViewport` for layout-only cases — keep the hook for content reflow).
- **Inputs at 16px floor** is now base-layer enforced. Surface agents can keep their visual `text-[12px]`/`text-[13px]`/`text-[14px]`/`text-[15px]` classes on inputs — the *computed* size is clamped to 16px so iOS won't zoom, but the visual class still wins for non-input siblings. If you intentionally want a smaller-than-16 input visual, you'll need to override locally and accept the iOS zoom (don't recommend).
