# Search + Artist Polish — Phase 2 Fixes (2026-04-27)

Owner files:
- `/home/dash/voyo-music/src/components/search/SearchOverlayV2.tsx`
- `/home/dash/voyo-music/src/components/voyo/ArtistPage.tsx`

`npx tsc -b` → clean (no output, exit 0).

Warming-pill UX preserved: `voyo-disco-arrive` golden-burst keyframe (DEEP_MAP §2.4 patience-as-contribution celebration) still fires on `toast.type === 'in_disco'`. Toast positioning got smarter, animation timing untouched.

---

## Summary

8 fixes applied, 2 skipped/flagged. All changes visual-only; no store, hook, or async logic touched. Restraint kept — one change per finding, no new files, no surfaces beyond the two owned components.

---

## Fixes Applied

### §4 [758] — P1 — `100dvh` Safari ≤15 fallback
**Quote**: "iOS Safari ≤15 falls back to vh which is the wrong number — search-at-bottom dock lands 60-90px below visible."
**Decision**: Inline style cannot host `@supports`. Moved transform into two CSS classes inside the existing `<style>` block — `.voyo-search-header-top` (translateY 0) and `.voyo-search-header-bottom` (translateY with calc). Default uses `100vh`; `@supports (height: 100dvh)` block overrides with `100dvh`. iOS ≤15 lands slightly imprecise but always visible, modern browsers get pixel-perfect dock.
**Where**: `SearchOverlayV2.tsx:731-744` (style additions), `:763` (className wired), `:783` (`top: 0`), `:768-781` (transform now class-based — inline `transform`/`willChange` removed from inline style, transform is class-driven).

### §4 [738-740] — P2 — Double safe-area top padding
**Quote**: "Main container padding-top: max(16px, env(safe-area-inset-top, 16px)) — but inner header uses top: 'max(16px, env(safe-area-inset-top, 16px))' on absolute positioning. Doubles the top padding."
**Decision**: Inner header changed from `top: 'max(16px, env(safe-area-inset-top, 16px))'` to `top: 0`. Parent absolute children sit on the parent's padding box, so `top: 0` already lands below the inset. Single source of truth for safe-area-top now.
**Where**: `SearchOverlayV2.tsx:783` (`top: 0`).

### §4 [823-829] — P1 — Clear-X 22×22 hit zone → 44×44 wrap
**Quote**: "Clear-X is `<X className="w-[14px] h-[14px]"> + p-1` → 22×22 hit zone. Below floor."
**Decision**: Wrapped clear button at `w-11 h-11` (44×44). Visual `<X>` glyph stays at 14×14. Used `-my-2 -mr-2` negative margin so input row doesn't grow vertically.
**Where**: `SearchOverlayV2.tsx:851-858`.

### §4 [874-879] — P2 — Padding swing during dock-slide
**Quote**: "Results scroll padding-top swings between 8 and 132 (delta 124px) on searchAtBottom flip with a 320ms transition. Mid-transition the first result row vanishes behind the header."
**Decision**: Removed `transition: 'padding-top 320ms ease, padding-bottom 320ms ease'`. Padding now snaps instantly on threshold cross. Header still slides via GPU transform (260ms). No more layout interpolation cost.
**Where**: `SearchOverlayV2.tsx:903-912`.

### §4 [1109] — P2 — Toast lands behind search dock at bottom mode
**Quote**: "Toast at bottom-24 (96px) — lands BEHIND the search dock when searchAtBottom===true."
**Decision**: Replaced static `bottom-24` Tailwind with conditional inline `bottom`: 96px when dock is at top, `calc(max(16px, env(safe-area-inset-bottom, 16px)) + 180px)` when dock is at bottom. Gold burst now fires ABOVE the docked input, not behind it. The `voyo-disco-arrive` celebration animation untouched — still fires on `'in_disco'` toast type.
**Where**: `SearchOverlayV2.tsx:1141-1150`.

### §4 [122-134, 580] — P2 — Header back button hit area (40×40 → 44×44)
**Quote**: "Header back button is <ArrowLeft size={20}> inside a 40×40 rounded S.headerBtn. Below the 44px floor (this is the back affordance — most-tapped element on the page)."
**Decision**: `S.headerBtn` width/height bumped from 40 to 44. Visual icon stays at `size={20}`. Since `S.headerBtn` is shared between back button and any future right-side header buttons, this also lifts the close-X chrome to floor (currently rendered via `<VoyoCloseX size="md">` which has its own internal sizing — unaffected).
**Where**: `ArtistPage.tsx:124-128`.

### §4 [104-113] — P2 — Footer safe-area spacer no minimum
**Quote**: "Footer at line 762 uses height: 'env(safe-area-inset-bottom, 0px)' — only adds the inset, no minimum. On non-notched phones the close button at the bottom edge of the scrolled-down content butts against the viewport edge with 0 padding."
**Decision**: Bumped to `max(24px, env(safe-area-inset-bottom, 0px))`. 24px floor on non-notched phones, absorbs full home-indicator on notched.
**Where**: `ArtistPage.tsx:777`.

### §4 [286-293] — P2 — momentThumb 4:5.3 → 9:16
**Quote**: "momentThumb width: 120, height: 160 (4:5.3 aspect) — close to 9:16 but not quite. Real moment thumbnails are 9:16 → letterboxed black bars top/bottom."
**Decision**: Switched to `width: 90, height: 160, aspectRatio: '9 / 16'` for `momentThumb`, `momentThumbPlaceholder`, and `momentCard`. Native 9:16, no letterboxing. Same vertical reach (160px tall) so layout rhythm unchanged.
**Where**: `ArtistPage.tsx:283-313`.

---

## Skipped

### §4 [819] — P1 — Search input `text-[15px]` iOS zoom
**Reason**: Per prompt guidance — depends on Globals base-layer 16px input fix. The Globals agent ships a global solution. Patching this surface in isolation would conflict with the global rule. **Status: depends on Globals base-layer 16px input fix — coordinate with Globals agent.**

### §4 [732] — P3 — Backdrop already correct
The audit confirms the v672 lesson (dropping backdrop-blur on the full backdrop) is already implemented at line 732 (`bg-black/90`, no `backdrop-filter`). No action.

### §4 [789] — P3 — Input row backdrop-filter
P3 cosmetic perf cost. Cross-surface tier work belongs in §7 (forbidden scope per prompt). No action this surface.

### §4 [850-856] — P2 — Tab border layout shift
**Reason**: Re-read code at lines 880-883 — already uses `1px solid transparent` for inactive baseline. Audit's recommended fix is already in place. No layout shift on swap.

### §4 [144-156] — P3 — Avatar gradient solid block
P3 cosmetic. No action; would require new keyframe + `prefers-reduced-motion` gate, beyond restraint budget.

### §4 [572] — P3 — No exit animation
P3 cosmetic asymmetry. Adding exit animation requires lifecycle hook coordination with parent unmount — out of visual-only scope.

---

## Flagged

### §4 [215] — P2 — `S.trackCard.minWidth: 280, maxWidth: 320` on phone
**Why flagged not fixed**: Audit recommendation is "tablet-only horizontal scroll, vertical stack on phones." That's a behavior change requiring viewport-detection logic and restructuring how `S.scrollRow` renders its children — too structural for the visual-only mandate. A subtle alternative (reduce minWidth to ~240 so 1.5 cards peek) would help discoverability without restructuring, but it's a band-aid. **Recommend a follow-up sub-agent that owns the carousel-vs-stack responsive split for both `OUR LIBRARY` and `MOMENTS` rows.**

### Cross-cutting note: Globals dependency
The §4 [819] iOS zoom fix is the only P1 in this district that we deferred. The Globals agent's base-layer rule should ship a `textarea, input, select { font-size: 16px; }` declaration scoped to the input itself (not visual size). Once Globals lands, this surface needs no re-edit — the `text-[15px]` Tailwind class affects display size; iOS reads computed font-size from the cascade.

---

## File Diffs (final line numbers)

`SearchOverlayV2.tsx`:
- L731-744: new `.voyo-search-header-{top,bottom}` classes + `@supports (height: 100dvh)` block in `<style>`
- L763: className wires `searchAtBottom` to class
- L768-781: comment block updated; transform/willChange removed from inline style (now class-driven)
- L783: `top: 0` (was `max(16px, env(safe-area-inset-top, 16px))`)
- L851-858: clear button `w-11 h-11 -my-2 -mr-2` wrap (was `p-1`)
- L903-912: padding-top/bottom transition removed; snap-on-cross
- L1141-1150: toast `bottom` is conditional inline style instead of `bottom-24` Tailwind

`ArtistPage.tsx`:
- L124-128: `headerBtn` width/height 40 → 44
- L283-313: `momentCard`/`momentThumb`/`momentThumbPlaceholder` → 90×160 9:16
- L777: footer spacer `max(24px, env(safe-area-inset-bottom, 0px))`

---

*End of report — Search + Artist agent.*
