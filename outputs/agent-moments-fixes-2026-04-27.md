# Agent Moments + DynamicIsland — Fixes Applied (2026-04-27)

Phase 2 polish strike. Two files touched: `VoyoMoments.tsx` + `DynamicIsland.tsx`. Plus a read-only consumption of `useMessagingViewport` from `hooks/`. No store/async changes. `npx tsc -b` passes clean.

---

## Summary

- **Applied:** 9
- **Skipped (not in scope or already correct):** 3
- **Flagged (needs design call / out-of-scope):** 3
- **tsc:** PASS (no output)

---

## Fixes Applied

### 1. CompassArc — drop `filter: blur` on offset items  *(P1, §3 [362-371])*

**Quote:** "Filter:blur is a known Safari/iOS jank trigger especially during the rotation. The 0.3s `transition: 'all 0.3s ease'` on line 380 includes the filter, so each axis swap re-rasterizes."

**File:** `src/components/voyo/feed/VoyoMoments.tsx` ~lines 359-376

**Old:**
```tsx
const blur = absOffset <= 1 ? 0 : absOffset * 0.5;
const fontSize = absOffset === 0 ? 14 : absOffset === 1 ? 12 : 10;
...
return {
  transform: `scale(${scale}) translateY(${yShift}px)`,
  opacity,
  filter: blur > 0 ? `blur(${blur}px)` : 'none',
  fontSize,
```

**New:**
```tsx
// No filter:blur — Safari/iOS re-rasterizes per-frame during the 0.3s
// axis-swap transition (research §2F). Opacity ramp already carries the
// depth read; blur was redundant chrome on a P1 jank vector.
const fontSize = absOffset === 0 ? 14 : absOffset === 1 ? 12 : 10;
...
return {
  transform: `scale(${scale}) translateY(${yShift}px)`,
  opacity,
  fontSize,
```

**Why:** Removes the dominant per-frame paint trigger on category swipe; opacity ramp (1 → 0.6 → 0.35 → 0.18) already reads as depth.

---

### 2. CompassArc — key by positional offset, not category-index  *(P1, §3 [411-444])*

**Quote:** "When `currentIndex` shifts, the wrapping `((currentIndex + offset) % categories.length …)` produces a different `idx` for the same offset slot. So index 0 (offset -3) becomes index N-1, the React reconciler unmounts/remounts. New mount = transition starts from mount-time = fade-from-zero on every category step."

**File:** `src/components/voyo/feed/VoyoMoments.tsx` ~lines 412-424

**Old:** `key={\`${category}-${index}\`}`

**New:** `key={offset}` (with explanatory comment about positional slots)

**Why:** Same DOM node persists across category steps; CSS transition interpolates between styles smoothly instead of unmounting → remounting → fading from zero on every step.

---

### 3. Comments drawer — subscribe to visualViewport  *(P2, §3 [217-218])*

**Quote:** "`maxHeight: '70%', minHeight: '50%'`. Computed BEFORE `paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))'` at line 277. With a 34px home indicator, the input is ~22px above the bottom of the visible drawer. Combined with the lack of `useMessagingViewport` integration."

**File:** `src/components/voyo/feed/VoyoMoments.tsx` (CommentsDrawer component, ~lines 829-841 plus drawer style consumption)

**New imports:** Added `useMessagingViewport` import at top.

**New body:**
```tsx
const { vh, keyboardOpen } = useMessagingViewport();
const drawerStyle: React.CSSProperties = {
  ...S.commentsDrawer,
  maxHeight: vh > 0 ? Math.round(vh * 0.7) : '70%',
  minHeight: keyboardOpen ? Math.min(280, vh > 0 ? Math.round(vh * 0.6) : 280) : '50%',
};
```

Drawer `style={S.commentsDrawer}` → `style={drawerStyle}`.

**Why:** When the soft keyboard opens, `vh` shrinks (visualViewport tracks it); `keyboardOpen` lifts `minHeight` so the input stays visible above the keyboard.

---

### 4. Comments input — touch target + iOS zoom prevention  *(P2, §3 [282])*

**Quote:** "`commentInput.height: 36` with `padding: '0 14px'`. Not 44px tall (touch-target check). Plus `fontSize: 13` triggers iOS zoom (research §1 #8). Both fixable in one shot by bumping height to 44 and font-size to 16."

**File:** `src/components/voyo/feed/VoyoMoments.tsx` ~line 281

**Old:** `height: 36, ..., borderRadius: 18, ..., fontSize: 13`

**New:** `height: 44, ..., borderRadius: 22, ..., fontSize: 16` + comment

**Why:** Single change resolves both the touch-target floor and the iOS focus-zoom.

---

### 5. Bottom fade gradient — clamp max-height  *(P2, §3 [147])*

**Quote:** "On portrait video (9:16) on iPhone 12 Pro Max (~915 tall) that's ~503px of dark wash across the lower video — the user sees the bottom HALF of every video as dimmed. Restraint, but consider clamping to `max-height: 360px`."

**File:** `src/components/voyo/feed/VoyoMoments.tsx` ~line 147

**Old:** `height: '55%', background: 'linear-gradient(...)'`

**New:** `height: '55%', maxHeight: 360, background: 'linear-gradient(...)'` + comment

**Why:** Gradient reads as a footer halo (~360px), not a curtain over the lower half of every video on tall phones.

---

### 6. Creator block max-width — narrow-screen collision  *(P2, §3 [152])*

**Quote:** "Bio card `maxWidth: 'calc(62% - 30px)'` overlaps with actBar on narrow screens (<375px). Fix: ... reduce bio max-width to `calc(56% - 30px)`."

**File:** `src/components/voyo/feed/VoyoMoments.tsx` ~line 154

**Old:** `maxWidth: 'calc(62% - 30px)'`

**New:** `maxWidth: 'calc(56% - 30px)'` + comment

**Why:** Right-side actBar (4 stacked 48px chips) was overlapping with the bio container on iPhone SE viewports.

---

### 7. MIX badge — safe-area-aware top offset  *(P2, §3 [1727-1755])*

**Quote:** "`top: 100` magic number — collides with safe-area-inset-top + the topBar (~64px). On notched devices the MIX pill overlaps the axis tabs."

**File:** `src/components/voyo/feed/VoyoMoments.tsx` ~line 1731

**Old:** `top: 100`

**New:** `top: 'calc(env(safe-area-inset-top, 0px) + 88px)'` + comment

**Why:** Anchors below the topBar/axisTabs/CompassArc rail and respects the notch instead of the magic 100px.

---

### 8. DynamicIsland — reply input + send button (touch + zoom)  *(P1, §3 [767, 771-776])*

**Quote:** "Reply input `text-[12px]` causes iOS zoom-on-focus" + "Send button `w-8 h-8` = 32×32, below 44px touch target."

**File:** `src/components/ui/DynamicIsland.tsx` ~lines 760-776

**Old:** input `text-[12px]`, button `w-8 h-8` (no aria-label)

**New:** input `text-base` + `style={{ fontSize: 16 }}`, button `w-11 h-11 ... flex-shrink-0` + `aria-label="Send reply"` + comments.

**Why:** 16px font kills focus-zoom on iOS; 44×44 hit zone with the same 32px disc visual inside meets touch-target floor; flex-shrink-0 keeps it from collapsing when text is long.

---

### 9. DynamicIsland — collapsed pill width clamp  *(P2, §3 [580-588])*

**Quote:** "On iPhone SE (375 viewport) with the header's `gap-2` siblings, the pill width plus profile button + search button can overflow → forces the search button to wrap or get cut."

**File:** `src/components/ui/DynamicIsland.tsx` ~line 581

**Old:** `width: showWave ? 190 : 165`

**New:** `width: showWave ? 'min(190px, 50vw)' : 'min(165px, 50vw)'` + comment

**Why:** Pill never eats more than ~50% of the viewport width even on iPhone SE; header siblings keep their space.

---

### 10. DynamicIsland — expanded card cross-fade flash  *(P2, §3 [651-672])*

**Quote:** "Switching modes triggers a 380ms `background-color` transition which on Safari produces a flash through transparent (if the underlying alpha hits ~0 mid-interp). Fix: use `mix-blend-mode` or two stacked panels with cross-faded opacity instead of background-color animation."

**File:** `src/components/ui/DynamicIsland.tsx` ~lines 591-601 + 656-674

**Old:** `expandedStyle.backgroundColor` animated between `rgba(255,255,255,0.95)` and `rgba(0,0,0,0.8)` via `background-color 380ms ease`.

**New:** `expandedStyle` no longer carries `backgroundColor` (transparent). Two absolute-positioned panels (one light, one dark) are mounted always inside the card, with their `opacity` cross-faded over 380ms based on `isReplying`.

```tsx
<div className="absolute inset-0 pointer-events-none"
     style={{ backgroundColor: 'rgba(255,255,255,0.95)', opacity: isReplying ? 0 : 1, transition: 'opacity 380ms ease' }} />
<div className="absolute inset-0 pointer-events-none"
     style={{ backgroundColor: 'rgba(0,0,0,0.8)', opacity: isReplying ? 1 : 0, transition: 'opacity 380ms ease' }} />
```

**Why:** Same visual transition (light → dark on enter-reply), but the alpha never passes through ~0 mid-interpolation, so Safari has no transparent gap to flash through.

---

## Skipped

### S1. §3 [312] — OYE float-up `pointer-events: none`  *(already correct)*

Audit said "no `pointer-events: none` declared at the css()". Verified line 312:
```tsx
oyeF: css({ position: 'absolute', zIndex: 40, pointerEvents: 'none', fontSize: 28 }),
```
Already present. Auditor likely missed it. No change needed.

### S2. §3 [209-214] — Comments backdrop/drawer in portal  *(no new files allowed)*

Audit suggested "render comments drawer in a portal or use `position: fixed` relative to the viewport". Portal would require a new mount node and `createPortal` — outside the visual-only / no-new-files scope. The drawer's parent (`S.card` `position: absolute, inset: 0`) is itself anchored to the Moments root container (no transform), so the existing absolute positioning works in practice. Mitigation already applied via the visualViewport wiring (#3) which addresses the worst symptom.

### S3. §3 [611-616] — DynamicIsland wave keyframe  *(verify only, no flag warranted)*

Audit suggested "the comment claims 'liquid wave' — verify the wave keyframe is wired or mark dead". The three stacked gradients are visibly distinct on a static pill (different stops, sizes, opacities) and combined with the `showWave` gating produce a clear arrival pulse. Whether they animate or not is a design call; v695 just rebuilt and shipped this. Not in scope to redesign.

---

## Flagged

### F1. §3 [601] — DynamicIsland wrapper `z-20` and centering when expanded

`<div className="z-20" {...dragHandlers}>` — the inner z-20 is wasted (parent is App.tsx z-50). When `isReplying`, the expanded card grows to 300px and is rendered left-aligned inside the flex container. Whether it should auto-center is a layout decision owned by the **Globals agent** (since the mounting/positioning is App.tsx). I did not touch the wrapper.

### F2. §3 [628-633] — Preview text `truncate lowercase`

Lowercase loses proper-noun emphasis (`"Burna Boy"` → `"burna boy"`). Demo notifications already use lowercase strings. Could be intentional brand language; needs design call before changing.

### F3. §3 [1700-1722] — Gold transition word "moments" once-per-session

`uiPhase === 'transition'` only fires the first time and never returns to `'transition'` for the rest of the session. The auditor's question stands: arrival cue (intentional) or recurring affordance (broken)? This is a logic/state question, not visual — would require touching `useMoments` or the uiPhase machine. Out of scope for visual-only sweep. Decision needed from product.

---

*End — author: Moments + DynamicIsland Specialist agent. Cross-references: AUDIT-2026-04-27 §3, RESEARCH-2026-04-27 §3.3.*
