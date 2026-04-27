# Home Specialist Fix Report — 2026-04-27

## Summary
- Findings reviewed: 19 (all of §1 Home)
- Applied: 18
- Skipped (already fixed): 1
- Skipped (disagree): 0
- Flagged (cross-surface): 0
- TypeScript compile: PASS (`npx tsc -b` exit 0)

Hard rules followed: restraint over visual mass; visual-only (no store/async/deps changes); one change per finding; no forbidden files touched.

---

## Fixes Applied

### F1: [HomeFeed.tsx:3040] Ripple host zIndex 500 → 5
- Original: `style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 500 }}`
- Fixed:    `style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5 }}`
- Reason: 500 lived outside the documented z-index scale and overlapped bottom nav (z-50) and AccountMenu (z-56). 5 sits above feed content (z 0-1) but below sticky header (z-10) and all chrome.

### F1b: [HomeFeed.tsx:3073] Loop fade overlay zIndex 501 → 6
- Original: `position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 501`
- Fixed:    `position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 6`
- Reason: Same — keeps the loop transition above ripples but below header/nav/menus/DynamicIsland chrome so it never veils navigation.

### F2: [HomeFeed.tsx:3092-3095] Sticky home header safe-area-top
- Original: `<header className="flex items-center justify-between px-4 py-3 sticky top-0 bg-transparent z-10">`
- Fixed: added inline `style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}`
- Reason: Notched iPhones had the "D" profile button sliding under the dynamic island.

### F3: [HomeFeed.tsx:3103-3110] Search button hit target ≥44×44
- Original: `<button aria-label="Search" className="p-2 rounded-full bg-white/10 hover:bg-white/20" onClick={onSearch}>`
- Fixed:    `<button aria-label="Search" className="rounded-full bg-white/10 hover:bg-white/20 inline-flex items-center justify-center" style={{ minWidth: 44, minHeight: 44 }} onClick={onSearch}>`
- Reason: ~36×36 hit target was below the 44px floor — Home now matches Player parity.

### F4: [HomeFeed.tsx:578-579, deleted overlay 752-758] TrackCard dead `isHovered`
- Original (state): `const [isHovered, setIsHovered] = useState(false);` + `{isHovered && !prefMode && (<div className="absolute inset-0 bg-black/40 ...><Play .../></div>)}`
- Fixed: state declaration removed, hover-only Play overlay removed entirely.
- Reason: `setIsHovered` was never called; the overlay never appeared on touch and was dead code. Aligns with restraint — the prefMode and bucketFly affordances already carry the interaction language.

### F5: [HomeFeed.tsx:778, deleted overlay 806-813] WideTrackCard dead `isHovered`
- Original: `const [isHovered, setIsHovered] = useState(false);` + `{isHovered && (<div className="absolute inset-0 bg-black/30 ..."><Play .../></div>)}`
- Fixed: state and overlay both removed.
- Reason: Same — never set, never appeared, pure dead code. Removing it keeps the wide card surface clean.

### F6: [HomeFeed.tsx:1080-1086] AfricanVibesVideoCard responsive sizing
- Original: `width: '95px', height: '142px'`
- Fixed: `width: 'clamp(86px, 25vw, 110px)', aspectRatio: '95 / 142'`
- Reason: Hard-pinned 95×142 looked cramped on iPhone SE (375). Clamp lets narrow phones go a hair smaller and tablets a touch larger while keeping the 95:142 ratio.

### F6b: [HomeFeed.tsx:1157-1167] AfricanVibesVideoCard label legibility
- Original: genre `text-[6px]`, title `text-[9px]`, artist `text-[7px]`, OYE `text-[6px]`
- Fixed: genre `text-[10px]`, title `text-[11px]`, artist `text-[10px]`, OYE `text-[10px]`
- Reason: 6-7px text is illegible on phone screens. Bumped to ≥10px floor; truncation + card width still fit.

### F7: [HomeFeed.tsx:1090-1100] Bronze glow only on active card
- Original: glow div rendered for every card in the 3-mount window with `filter: blur(8px)`.
- Fixed: wrapped in `{isActive && (...)}` so only the active card paints the blurred glow.
- Reason: Three simultaneous filter:blur layers on adjacent iframe boxes is a known Android paint stall. Restraint also focuses the eye on the hero.

### F8: [HomeFeed.tsx:1565] FriendSearchPill bottom anchor
- Original: `bottom: '20%'`
- Fixed: `bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)'`
- Reason: The 20% magic landed the pill ~133px from bottom on a 667px viewport, fighting both the bottom nav and the home indicator. Now it sits above the nav with proper safe-area math.

### F9: [HomeFeed.tsx:1599-1602] FriendSearchPill input fontSize 16px
- Original: `className="... text-[15px]"`
- Fixed: `className="..."` + inline `style={{ fontSize: 16 }}`
- Reason: 15px triggers iOS zoom-on-focus. 16px is the floor.

### F10: [HomeFeed.tsx:1758-1764] VibesLiveFriendsSheet close button hit target
- Original: `className="w-8 h-8 rounded-full bg-white/10 ..."`
- Fixed: `className="rounded-full bg-white/10 flex items-center justify-center"` + `style={{ minWidth: 44, minHeight: 44 }}`
- Reason: 32×32 is below 44px touch floor.

### F11: [HomeFeed.tsx:1740-1758] "Vibing Now" Italianno FOUT reservation
- Original: heading style had no width reservation.
- Fixed: added `minWidth: '8rem', display: 'inline-block'`.
- Reason: During Italianno load, Satoshi system fallback is ~25% wider — it pushed the close button off-row before the swap settled on Android Chrome.

### F12: [HomeFeed.tsx:2076-2086] Top10 active text-shadow paint kill
- Original: `textShadow: isActive ? <bigGlow> : numberGlow,` + `transition: 'text-shadow 0.8s ease-in-out'`
- Fixed: `textShadow: numberGlow,` (transition removed).
- Reason: text-shadow is never composited — paints per frame. The active-state energy is already carried by the radial-blur halo + box-shadow on the disc; dropping the text-shadow animation removes one of three concurrent paint animations on the same element. Restraint move (one signature, not three).

### F13: [HomeFeed.tsx:2028-2038] Top10 marquee will-change: transform
- Original: `.top10-scroll-title { display: inline-block; animation: top10-marquee 10s linear infinite; }`
- Fixed: added `will-change: transform;` (only mounted while marquee class is conditionally applied).
- Reason: Promotes only while the marquee is active, mitigating Android scroll-jank from translating a non-promoted layer.

### F14: [HomeFeed.tsx:2301] NextVoyageShelf collapsed minHeight
- Original: `minHeight: 140` (constant)
- Fixed: `minHeight: dismissed ? 0 : 140`
- Reason: With width collapsed to 0 but height stuck at 140, an invisible 140px box was blocking horizontal swipe at the rail end.

### F15: [HomeFeed.tsx:3220-3222] Gold hairlines tablet inset
- Original: `className="... left-8 right-8 h-px ..."` (both)
- Fixed: `className="... left-8 right-8 md:left-12 md:right-12 h-px ..."`
- Reason: At >768px wide the 32px inset looked like floating disconnected slashes. The 48px tablet inset reads as intentional underline.

### F16: [HomeFeed.tsx:3306-3307] Classics carousel side-fades 52 → 32
- Original: `width: 52` on both left and right `rr-fade-shimmer` overlays.
- Fixed: `width: 32`
- Reason: 52px overlay was partially veiling the first/last disk's initials and title on iPhone SE. 32px keeps the fade rhythm without the readability dip.

### F17: [HomeFeed.tsx:3343-3346] "More from artist" mini-thumbs drop scale
- Original: `<SmartImage ... style={{ transform: 'scale(1.3)' }} />`
- Fixed: removed `style={{ transform: 'scale(1.3)' }}` entirely.
- Reason: At 38px the YouTube 'high' thumbnail aliases on high-DPI. Native fit is sharper and cheaper.

### F19: [HomeFeed.tsx:3408-3420] Vertical "TRENDING" textShadow drop
- Original: stroke + `textShadow: '0 0 8px rgba(212, 160, 83, 0.15)'` on transparent fill.
- Fixed: removed `textShadow`; kept the `WebkitTextStroke`.
- Reason: Stroke + text-shadow on transparent fill produced a ghosted second outline on Safari 14. The stroke alone reads correctly everywhere — restraint move.

---

## Skipped

### S1: [HomeFeed.tsx:3486] F18 — Stations skeleton aspectRatio CLS claim
- Audit claim: skeleton at `aspectRatio: '4/5'` may CLS-spike when StationHero resolves to a different aspect.
- Verified: `StationHero.tsx:169` itself uses `aspectRatio: '4 / 5'` — the skeleton already matches the resolved card. No CLS.
- Decision: SKIP-DISAGREE (audit assumption was incorrect). No edit needed.

---

## Flagged for Other Agents

None. All §1 Home findings stayed within `HomeFeed.tsx`.

---

## Notes on F12 (Top10) deviation from audit

The audit suggested replacing the active text-shadow with "stacked pseudo-element + opacity + transform (compositor only)". I chose a stricter restraint move: simply drop the active-state text-shadow transition and let the existing radial-blur halo + box-shadow on the disc carry the active energy. Same paint-kill outcome, less added DOM, fewer concurrent animations. Cathedral-pillars warning honored.

## Notes on F4/F5 deviation from audit

Audit gave two options: "wire mouse events with hover-media guard, or remove the `isHovered` state entirely." I picked **remove**. The Play-button overlay was hover-only, never mouse-wired in the first place, never appeared on touch devices, and the prefMode + bucketFly visuals already provide the interaction grammar. Restraint via subtraction.
