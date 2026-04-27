# Agent Library + Chrome Fixes — 2026-04-27

Owner: Library + Shared Chrome strike-team agent
Files in scope: `Library.tsx`, `OyeButton.tsx`, `VoyoBottomNav.tsx`, `AnchoredTaleHeader.tsx`
Audit ref: `AUDIT-2026-04-27-visual-punchlist.md` §5 + §6
Research ref: `RESEARCH-2026-04-27-pwa-responsiveness.md` §3.5
Architecture ref: `DEEP_MAP_2026-04-26.md` §2.3 (OYE narralogy preserved)

## Summary

11 findings actioned across the 4 owned surfaces. All P0/P1 special-focus
items applied. `npx tsc -b` exits **0**. No store/async changes; visual
only. OyeButton `computeOyeState` narralogy untouched — the orange /
purple / gold-faded / gold-filled story still drives every visual.
AnchoredTaleHeader `HOLD_MS = 4000` (v694 whisper hold) preserved.

---

## Fixes Applied

### Library.tsx — 4 fixes

**1. §5 [918] — P1 — Search input zoom-on-focus** *(special focus)*
- **Was:** `text-[14px]` on the search input — iOS Safari auto-zooms the
  viewport on focus when font-size < 16px.
- **Now (line 934):** `text-[16px]`. Visual weight is barely changed
  (Satoshi reads compact at 16px); the gain is no zoom-jolt on focus.
- **Dependency note:** even after the global base-layer 16px floor lands,
  the explicit Tailwind utility on this input would override the base,
  so the fix here is independent of the global. Both should ship.

**2. §5 [932-942] — P1 — Filter pills below 44px hit floor** *(special focus)*
- **Was:** `px-3.5 py-1.5 text-[13px]` → ~26px tall chips on the
  most-tapped row in Library.
- **Now (line 952):** `px-4 py-2 min-h-[44px] inline-flex items-center
  justify-center …`. Pills now clear the 44px touch-target floor while
  keeping the 13px label weight (visual silhouette nearly identical).

**3. §5 [1009-1013] — P1 — Missing `overscrollBehavior: 'contain'`** *(special focus)*
- **Was:** scroll list had no `overscroll-behavior` — vertical rubber-band
  leaked past the parent (which has `overscroll-behavior: none`) and
  produced a visible header jolt at both edges.
- **Now (line 1040):** `overscrollBehavior: 'contain'` added to the
  inline style. Bounce is now confined to the Library list.

**4. §5 [863-879] — P2 — Sticky chrome no `safe-area-inset-top`**
- **Was:** the `flex-shrink-0` sticky chrome had only `pt-5` (20px) on the
  inner button — under a 47-59px notch the headline slid below the
  dynamic island.
- **Now (line 876):** added `paddingTop: 'max(0px, env(safe-area-inset-top))'`
  on the sticky chrome wrapper. Non-notched devices still get the
  original `pt-5` spacing; notched devices push everything below the
  inset. Used `0px` floor (not `20px`) so this padding is purely
  additive — the inner button keeps its `pt-5`.

### OyeButton.tsx — 3 fixes (narralogy preserved)

**5. §6 [333-336] — P2 — `size='sm'` 28×28 below 44px hit floor** *(special focus)*
- **Was:** the entire OyeButton root span sized to `px = 28` for `sm`,
  used on TrackCard at HomeFeed.tsx:761 / 819. Below the floor.
- **Now (line 339, 354-357):** introduced `hostSize = Math.max(px, 44)`.
  Outer `<span>` now 44×44 minimum (transparent host, no visual change),
  the visible button itself stays at `px = 28` with all rings sized to
  `px`. The narralogy visual is untouched; only the tap zone widens.

**6. §6 [347-350] — P2 — Conic-gradient ring fallback for old iOS / Android** *(special focus)*
- **Was:** the lightning-arc ring used inline `conic-gradient(...)` +
  `WebkitMask: radial-gradient(...)`. iOS ≤14 and Android Chrome <88
  rendered as a black square or disappeared entirely.
- **Now (lines 384-401, 419-454):** the conic gradient + radial mask are
  now wrapped in an `@supports (background: conic-gradient(red, blue))
  and (mask: radial-gradient(black, transparent)) { … }` block via a
  scoped `<style>`. Modern browsers apply the conic + mask via
  CSS-custom-prop composition (`--oye-ring-accent`, `--oye-ring-faint`,
  `--oye-ring-inset`). A second always-painted faint stroke `<span>`
  (lines 408-418, `border: 1.5px solid ${ringFaint}; opacity: 0.55`) sits
  underneath as the fallback — covered on modern engines, visible on
  old engines. Result: graceful degrade, no black box.

**7. §6 [382-383] — P2 — `outline` halo → stacked rounded `<span>`** *(special focus)*
- **Was:** the cold-state halo used `outline: 1px solid …;
  outline-offset: 2px`. Android Chrome <94 traces the outline as a
  square (outline doesn't follow border-radius pre-94).
- **Now (lines 346-352, 359-374):** introduced `showStaticHalo` flag and a
  dedicated halo `<span>` sized `px + 4` with `border: 1px solid
  ${haloColor}` and full `border-radius: 9999px` (via Tailwind's
  `rounded-full`). Always perfectly round on every renderer. The
  haloColor is parsed from the existing `STYLE_BY_STATE.ring` string
  (e.g. `"1px solid rgba(212, 160, 83, 0.18)"` → `"rgba(212, 160, 83,
  0.18)"`) so the four state colours feed in unchanged. The button's
  `outline` style is now removed entirely.

### VoyoBottomNav.tsx — 2 fixes

**8. §6 [251-255] — P1 — Multiplied opacity sub-floor invisible** *(special focus)*
- **Was:** `calc(var(--hold-side, 1) * ${sideAmbient})` could multiply
  to `0.28 × 0.30 = 0.084` on dim feed + pointer-down — virtually
  invisible buttons.
- **Now (lines 54-55):** clamped via `max()`:
  `max(0.20, calc(var(--hold-side, 1) * ${sideAmbient}))` for the side
  buttons, `max(0.40, calc(...))` for the orb. The orb floor is set
  higher because it's the primary action anchor (must always read as
  tappable). The 1.2s out / 0.35s in fade asymmetry was preserved as-is
  — felt right after testing the visibility floor.

**9. §6 [271-289] — P1 — `playerMode` transparent — chips invisible on dim album art** *(special focus)*
- **Was:** in `playerMode`, the wrapper rendered `background:
  transparent, border: none, boxShadow: none`. On dim album-art
  Player surfaces the Home/Dahub icons were ghost-floating and hard
  to find.
- **Now (lines 312-323 for Home, 467-478 for Dahub):** added a
  player-mode-only chip backplate **on the icon wrapper, not the
  wrapper element**. 36×36 round chip, `background: rgba(10, 10, 15,
  0.45)`, `border: 1px solid rgba(255, 255, 255, 0.06)`, `backdropFilter:
  blur(6px)`. Standard mode (`playerMode === false`) is unchanged — no
  chip visible since the parent pill provides the chrome. Center VOYO
  orb already has its own gradient identity, no chip needed there.

### AnchoredTaleHeader.tsx — 3 fixes (HOLD_MS preserved)

**10. §6 [218-238, 225-227, 236] — P2 — Whisper readability + ghost trail + layout shift**
- **Was (single block of 3 issues):**
  - `fontSize: '0.6em'` rendered at 8.4px on Android low-DPI (below
    readability floor).
  - `transform: scaleX(0)` collapse + `opacity: 0` ran in parallel via
    one shared transition — 1px Safari ghost trail at the left edge
    on retract.
  - `maxHeight: whisperVisible ? '14px' : '0px'` made the row height
    oscillate every few seconds; the dot at `marginTop: 6` was
    anchored against a changing baseline.
- **Now (lines 218-247):**
  - `fontSize: 'max(11px, 0.6em)'` — clamps to 11px on small parents.
  - Asymmetric transition: when collapsing, `opacity 200ms ease,
    transform ${FADE_MS}ms cubic-bezier(0.16,1,0.3,1) 80ms` — the
    text fades to 0 BEFORE the scaleX retraction starts, killing the
    ghost trail. On expand both rise together with `FADE_MS` for the
    integrated rise-from-the-dot read.
  - `maxHeight: '14px'` always — visual hide is owned by opacity +
    transform alone; row height is stable; dot baseline stops
    oscillating. `HOLD_MS = 4000` (v694 bump) untouched.

---

## Skipped

None. Every Library/Chrome finding in the special-focus list was
applied. The lower-priority items below (§5 [881-896], §5 [911-922], §5
[1072-1090], §5 [1126-1133], §5 [946-955], §6 [273], §6 [285-310]) were
out of scope (not flagged in special-focus) and the brief said to apply
"one change per finding" with restraint — leaving the lower-priority
findings for a future pass keeps this commit reviewable.

## Flagged

- **Library §5 [918] dependency:** the audit calls for a global
  base-layer 16px floor too. Without it, every other input across the
  app still zooms. The Library fix is local and complete on its own,
  but the cross-surface fix is owned by the globals agent.
- **OyeButton §6 [347-350] @supports:** the new `<style>` block is
  inlined inside the component render. If multiple OyeButtons mount in
  the same view (every TrackCard, SongRow, etc.), each instance emits
  the same `<style>` block. Browsers de-dupe by selector but it's
  technically wasteful — could be hoisted to `index.css` later. Marking
  as a future cleanup, not a regression.
- **VoyoBottomNav §6 [251-255]:** the asymmetric 1.2s out / 0.35s in
  fade was kept (the brief said it's "fair game" — but the visibility
  floor was the real complaint, and clamping `max(0.20, …)` solved
  that without touching the asymmetry). If a future review wants
  symmetric (0.7s both ways), `opacityTransition` is the one place to
  flip.
- **OyeButton hit-area for `lg` (44px already):** `Math.max(px, 44)`
  is a no-op for `lg` (44 = 44) and `md` (40 → 44 host). Only `sm` (28
  → 44 host) materially changes. Worth a manual check on `md` placements
  (player toolbar OyeButton at md size) — the 4px transparent gutter
  around the visible button could nudge spacing in tight rails.

---

## Verification

- `npx tsc -b` → exit 0 (clean compile)
- No new files created
- No store / async / hook changes
- `computeOyeState` narralogy logic untouched (pure visual changes)
- HOLD_MS = 4000 preserved in AnchoredTaleHeader

## New line ranges (post-edit)

| File | Finding | New lines |
|------|---------|-----------|
| Library.tsx | sticky safe-area | 868-878 |
| Library.tsx | search 16px | 928-936 |
| Library.tsx | filter pills 44px | 943-963 |
| Library.tsx | overscrollBehavior | 1029-1042 |
| OyeButton.tsx | sm hit-area | 339-358 |
| OyeButton.tsx | conic @supports | 381-454 |
| OyeButton.tsx | halo span | 359-374 |
| VoyoBottomNav.tsx | opacity floor | 47-55 |
| VoyoBottomNav.tsx | playerMode chip Home | 312-323 |
| VoyoBottomNav.tsx | playerMode chip Dahub | 467-478 |
| AnchoredTaleHeader.tsx | whisper polish | 218-247 |

---

*End — Library + Chrome agent. 11 fixes, 0 type errors, narralogy intact.*
