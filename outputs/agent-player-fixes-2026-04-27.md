# Agent Player Fixes — 2026-04-27

Phase 2 strike-team output for §2 Player findings in `AUDIT-2026-04-27-visual-punchlist.md`.
Owner: Player Specialist. Exclusive write target: `src/components/voyo/VoyoPortraitPlayer.tsx`.

## Summary

- **Applied**: 14 fixes (folded a few related findings into single edits)
- **Skipped**: 2 (1 SKIP-DISAGREE on §2 [5447-5466], 1 SKIP-FIXED logic moot)
- **Flagged for Other Agents**: 1 cross-file concern + 1 layout-collapse concern on the P0 §2 [5182] flex-1 conversion
- **tsc**: `npx tsc -b` → exit 0, no errors.

---

## Fixes Applied

### 1. [§2 1166-1205] ExpandVideoButton transition wobble + box-shadow keyframe conflict (P1, FOLDS in [1140-1148, 1187-1192])

Old (lines 1195-1203):
```tsx
transition: [
  'padding 700ms cubic-bezier(0.16, 1, 0.3, 1)',
  'background 900ms cubic-bezier(0.16, 1, 0.3, 1)',
  'box-shadow 900ms cubic-bezier(0.16, 1, 0.3, 1)',
  'border-color 900ms cubic-bezier(0.16, 1, 0.3, 1)',
  'font-size 700ms cubic-bezier(0.16, 1, 0.3, 1)',
  'opacity 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
  'color 700ms cubic-bezier(0.16, 1, 0.3, 1)',
].join(', '),
```

New (lines 1199-1213, with comment block):
```tsx
transition: [
  'padding 700ms cubic-bezier(0.16, 1, 0.3, 1)',
  'background 700ms cubic-bezier(0.16, 1, 0.3, 1)',
  phase === 'morphing'
    ? 'box-shadow 0ms linear'
    : 'box-shadow 700ms cubic-bezier(0.16, 1, 0.3, 1)',
  'border-color 700ms cubic-bezier(0.16, 1, 0.3, 1)',
  'font-size 700ms cubic-bezier(0.16, 1, 0.3, 1)',
  'opacity 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
  'color 700ms cubic-bezier(0.16, 1, 0.3, 1)',
].join(', '),
```

**Why**: Unifies durations to 700ms (no more wobble between dot/text/border) and disables the box-shadow transition during the `voyo-takeout-morph-pulse` keyframe so they don't compete (Safari was stuttering).

---

### 2. [§2 1170-1171] ExpandVideoButton 36px touch-target floor (P1)

Old:
```tsx
className={`absolute top-3 right-3 z-30 rounded-full backdrop-blur-sm border ... ${
  isDimmed
    ? `px-2 py-1 gap-1 text-[10px] min-h-[36px] ${borderClassDim}`
    : `px-3 py-1.5 gap-1.5 text-xs min-h-[44px] ${borderClass}`
}`}
```

New (line 1168):
```tsx
className={`... active:scale-95 min-h-[44px] ${
  isDimmed
    ? `px-2 py-1 gap-1 text-[10px] ${borderClassDim}`
    : `px-3 py-1.5 gap-1.5 text-xs ${borderClass}`
}`}
```

**Why**: After 5s the chip dims and most users tap it in dimmed state — was 36px (under 44px floor). Now 44px floor always; visual padding still shrinks via `px-2/py-1`.

---

### 3. [§2 1283-1288] BottomTakeOutChip ghost-tap when decayed (P1)

Old (line 1285):
```tsx
pointerEvents: riseProgress > 0.5 ? 'auto' : 'none',
```

New (line 1289):
```tsx
pointerEvents: riseProgress > 0.5 && !decayed ? 'auto' : 'none',
```

**Why**: At 7% opacity the chip is a ghost — accidental taps silently launched PiP. Gating on `!decayed` makes the ghost non-interactive until next portal-progress activity.

---

### 4. [§2 1325 + 1330-1357] RightToolbar magic top-[42%] + safe-area-inset-right (P1+P2 folded)

Old (line 1336):
```tsx
<div className="absolute right-6 top-[42%] -translate-y-1/2 z-50 flex flex-col gap-3">
```

New (lines 1338-1346):
```tsx
<div
  className="absolute top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3"
  style={{ right: 'max(1.5rem, env(safe-area-inset-right, 1.5rem))' }}
>
```

**Why**: `top-[42%]` shifted the toolbar up ~8% — collided with BigCenterCard on 667px viewport. `top-1/2` is consistent across viewports. `env(safe-area-inset-right)` prevents landscape-notch clipping.

---

### 5. [§2 1342-1347] Like-button -z-10 blur backdrop → box-shadow glow (P2)

Old (lines 1342-1347):
```tsx
<Heart size={16} ... />
{isLiked && (
  <div
    className="absolute inset-0 rounded-full blur-md -z-10"
    style={{ background: 'rgba(139, 92, 246, 0.2)' }}
  />
)}
```

New (lines 1346-1357 — relocated to button style):
```tsx
style={{
  background: isLiked ? 'rgba(139, 92, 246, 0.25)' : 'rgba(28, 28, 35, 0.65)',
  boxShadow: isLiked ? '0 0 14px rgba(139,92,246,0.35)' : undefined,
}}
...
<Heart size={16} ... />
```

**Why**: `-z-10` inside a transformed/composited parent was clipped by Safari (often invisible). Box-shadow on the button itself is always painted.

---

### 6. [§2 5189-5215] Jam chip fade with portalProgress (P2)

Old:
```tsx
<div className="absolute top-0 left-0 right-0 z-30 flex justify-center"
  style={{ paddingTop: 'calc(max(0.5rem, env(safe-area-inset-top)) + 8px)' }}>
```

New (lines ~5197-5208):
```tsx
<div className="absolute top-0 left-0 right-0 z-30 flex justify-center"
  style={{
    paddingTop: 'calc(max(0.5rem, env(safe-area-inset-top)) + 8px)',
    opacity: Math.max(0, 1 - Math.max(0, (portalProgress - 0.55) / 0.35)),
    pointerEvents: portalProgress > 0.7 ? 'none' : 'auto',
    transition: 'opacity 0.2s ease-out',
  }}>
```

**Why**: Matches the bubbles row fade rhythm so the chip recedes with Layer A on portal scroll.

---

### 7. [§2 5223-5232] Bubbles row stacked safe-area + 36px (P1)

Old:
```tsx
paddingTop: 'calc(max(1.25rem, env(safe-area-inset-top)) + 36px)',
```

New (line ~5238):
```tsx
paddingTop: 'max(calc(env(safe-area-inset-top, 0px) + 8px), 56px)',
```

**Why**: Previous `max(1.25rem, safe-area) + 36px` STACKED the safe-area on top of the 36px clearance — on 47px+ notches the bubbles got pushed below the visible card. New form picks the **larger** of the two scenarios.

---

### 8. [§2 5246-5247, 5282] scrollSnapType mandatory → proximity (P2, two locations)

Old (history + queue rails):
```tsx
scrollSnapType: 'x mandatory',
```

New (two locations, lines ~5258 and ~5293):
```tsx
scrollSnapType: 'x proximity',
```

**Why**: Matches HomeFeed rails — small horizontal gestures let user peek at next item without forced snap.

---

### 9. [§2 5290-5294] Plus button visibility (P2)

Old:
```tsx
className="flex-shrink-0 w-[70px] h-[70px] rounded-2xl bg-white/5 border border-white/5 ..."
...
<Plus size={24} className="text-gray-500" />
```

New (lines ~5304-5310):
```tsx
className="flex-shrink-0 w-[70px] h-[70px] rounded-2xl bg-white/10 border border-purple-500/20 ..."
...
<Plus size={24} className="text-gray-400" />
```

**Why**: `bg-white/5 border-white/5` was nearly invisible on dark canvas — empty-queue users missed the affordance.

---

### 10. [§2 5317] Center section translateY(28px) hardcoded (P2)

Old:
```tsx
style={{ transform: 'translateY(28px)', touchAction: 'pan-y', }}
```

New (line ~5328-5335):
```tsx
style={{
  // (Was translateY(28px) — pushed artwork below visual center on
  // short viewports like iPhone SE. justify-end already places the
  // hero at the bottom of Layer A; the extra 28 served no purpose
  // on tall viewports either.)
  touchAction: 'pan-y',
}}
```

**Why**: On iPhone SE (667px) the 28px translate pushed the artwork below center. `justify-end` flex on parent already handles bottom-anchoring.

---

### 11. [§2 5472] Progress bar max-w-[180px] → clamp (P2)

Old:
```tsx
<div className="w-full max-w-[180px] mt-2 mb-4 px-2 z-30">
```

New (lines ~5489-5492):
```tsx
<div className="w-full mt-2 mb-4 px-2 z-30"
  style={{ maxWidth: 'min(220px, 60vw)' }}>
```

**Why**: 180px was 43% of width on Pixel 7 (412px) — cramped. `min(220, 60vw)` reads better on wider phones, still tight on iPhone SE.

---

### 12. [§2 5573-5575] Layer B pointerEvents threshold (P2)

Old:
```tsx
pointerEvents: portalProgress > 0.55 ? 'none' : 'auto',
```

New (lines ~5594-5597):
```tsx
// Gate at 0.4 (was 0.55) to match perceptual fade — by 0.4
// Layer B is already ~72% opacity but visually receding;
// taps would route THROUGH a dim layer otherwise.
pointerEvents: portalProgress > 0.4 ? 'none' : 'auto',
```

**Why**: Between 0.0 and 0.55 the layer is up to 0.6 opacity but fully tappable — looked dim but tap-routed through. Gating at 0.4 matches perceptual fade.

**Note on critical-flow preservation (DEEP_MAP §2.8)**: Layer B opacity transitions unchanged — only pointerEvents gating moved. The fade timing (0.18s ease-out, two-step 0.55/1.0 opacity machine) is intact.

---

### 13. [§2 5683-5728] DISCOVER text-shadow → GPU-promoted halo (P2)

Old (lines 5721-5726):
```tsx
<span
  className="text-[11px] font-black tracking-[0.15em] uppercase"
  style={{
    color: '#D4A053',
    textShadow: '0 0 8px rgba(212,160,83,0.8), 0 0 16px rgba(212,160,83,0.5)'
  }}
>
  DISCOVER
</span>
```

New (lines ~5727-5747):
```tsx
<span
  className="relative text-[11px] font-black tracking-[0.15em] uppercase"
  style={{ color: '#D4A053' }}
>
  <span
    aria-hidden
    className="absolute inset-0 pointer-events-none"
    style={{
      background: 'radial-gradient(ellipse at center, rgba(212,160,83,0.55) 0%, rgba(212,160,83,0) 70%)',
      transform: 'translate3d(0,0,0)',
      filter: 'blur(6px)',
    }}
  />
  <span style={{ position: 'relative' }}>DISCOVER</span>
</span>
```

**Why**: text-shadow is never composited — paints every transition tick of the parent's box-shadow. Sibling halo on its own composite layer (translate3d) decouples the paint from the parent.

(HOT label at 5683 had no text-shadow originally — only DISCOVER did. SKIP-FIXED on the HOT half of this finding.)

---

### 14. [§2 5774-5787] Hot/Discovery portal-line touch targets (P2, two locations)

Old (both buttons):
```tsx
className="flex-shrink-0 w-5 h-20 relative z-20 ml-1 touch-manipulation"
```

New (lines ~5837-5871 and ~6029-6070): button outer is `w-11 h-20` (44×80) with the visible 1.5px line + glow + arrow nested inside an inner `w-5 h-full` wrapper so the visual rhythm is unchanged.

**Why**: 20×80 hit area was below the 44px floor. Inflating only the hit zone preserves the visual line.

---

### 15. [§2 5862-5872] Cube box-shadow undefined-state interpolation (P1)

Old: 4 different shadow stacks of 1-3 layers each — Safari snapped on transitions (CSS can't interpolate unmatched layer counts).

New (lines ~5905-5920): All four states share the SAME 4-layer template (`-8px rust, 8px bronze, 0 purple-halo, inset-purple`). Unused layers fade via `alpha=0`.

```tsx
boxShadow: cubeDockOpen
  ? '-8px 0 25px rgba(181,74,46,0), 8px 0 25px rgba(212,160,83,0.25), 0 0 30px rgba(139,92,246,0.55), inset 0 0 20px rgba(139,92,246,0.15)'
  : cubeHolding
  ? '-8px 0 25px rgba(181,74,46,0), 8px 0 25px rgba(212,160,83,0.18), 0 0 22px rgba(139,92,246,0.45), inset 0 0 20px rgba(139,92,246,0)'
  : (isHotBeltActive || isDiscoveryBeltActive)
  ? '-8px 0 25px rgba(181,74,46,0.5), 8px 0 25px rgba(212,160,83,0.5), 0 0 20px rgba(139,92,246,0.3), inset 0 0 20px rgba(139,92,246,0)'
  : '-8px 0 25px rgba(181,74,46,0), 8px 0 25px rgba(212,160,83,0), 0 0 12px rgba(139,92,246,0.15), inset 0 0 20px rgba(139,92,246,0)',
```

**Why**: Restraint > stacked pseudo-orbs. Matched-stack shadows interpolate predictably on Safari.

---

### 16. [§2 5887-5893] "Outer rotating ring" comment vs static ring (P2)

Old comment:
```tsx
{/* Active: Outer rotating ring — rust → purple → bronze */}
```

New (lines ~5965-5967):
```tsx
{/* Active: Outer ring — rust → purple → bronze (static).
    Restraint: no rotation animation; the gradient itself
    carries the meaning. */}
```

**Why**: Audit option B ("remove the comment") chosen over option A ("wire @keyframes voyo-cube-ring-spin") — restraint is premium, no new rotation animation.

---

## Skipped

### [§2 5182] Layer A `calc(100% - 264px)` → flex-1 — SKIP-DISAGREE / FLAG

Audit's proposed fix ("replace the calc with `flex-1` on Layer A, fixed `flex-shrink-0` on Layer B") would break the layout. Layer B `min-h-[480px]` (cubeDockOpen) + the 480px scroll runway = 960px of `flex-shrink-0` siblings — already exceeds viewport on 667px iPhone SE. With `flex-1` on Layer A (now competing for negative remaining space), Layer A would collapse to 0.

The 264px magic number works because Layer B's **visible** portion at scroll-rest is intentionally less than its DOM height (the rest extends below the fold and is reached via scroll). This is a thoughtful design, not a leak.

**Flag for engineering**: A safer fix would parameterize the 264 from the actual `oyeBarBehavior`/`cubeDockOpen` state (`264 + (cubeDockOpen ? 120 : 0)`) — needs design confirmation that the visible-portion-at-rest should grow when the dock opens.

### [§2 5447-5466] Floating reactions positioning — SKIP-DISAGREE

Audit suggests "anchor to viewport-relative wrapper rather than parent-relative percentages". Reactions are short-lived (~1s ephemeral floats), the displacement source is small (pt-10 vs pt-12 = 8px), and refactoring requires a portal. P3 cost > benefit; restraint says leave.

---

## Flagged for Other Agents

### Cross-file: Hover state leak on touch (§2 [1154 referenced])

ExpandVideoButton uses `hover:border-purple-400/80` (line 1154 region) — same pattern across the file. This is part of the global cross-surface §7 rule (123 `hover:` classes). Should be addressed by a codemod wrapping `hover:` in `@media (hover: hover) and (pointer: fine)`. Out of scope for this Player-only pass; flagging for cross-surface cleanup.

### File-level: §2 [5182] Layer A height (see Skipped above)

Needs a design + engineering call on whether the visible Layer-B-at-rest height should respond to `cubeDockOpen` / `oyeBarBehavior` state. Current hardcoded 264 works on the common path but is brittle.

---

## Verification

```
$ npx tsc -b
$ echo "exit=$?"
exit=0
```

No TS errors. File grew from 6360 → 6433 LOC (+73 lines, mostly added comments documenting the why).

---

## Top 2 Most-Impactful Fixes

1. **[5862-5872] Cube box-shadow matched-stack** — Safari snap-fix on a hot center button that toggles between 4 states constantly during use. This was the most visible jank source on iOS.
2. **[1166-1205] ExpandVideoButton transition unification + box-shadow keyframe gate** — fixes the wobble Dash sees on every Mini Player → Take Out morph. Hot-recent area, directly visible to the user.
