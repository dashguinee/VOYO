# VOYO Visual Punch List — 2026-04-27 (post v696)

Surface-scoped visual findings. PWA fundamentals (tap-highlight, --vh bridge, input-zoom 16px floor, header button hit-area, z-index system) are owned by `RESEARCH-2026-04-27-pwa-responsiveness.md` §1, §2D, §5A — not restated here. This document is **VISUAL only** — logic / store / async issues belong to audit-2.

Format: `[FILE:LINE]` — Severity (P0/P1/P2/P3) — short description + fix sketch.

---

## §1 Home (HomeFeed.tsx + classic/)

- **[HomeFeed.tsx:3036, 3068]** — P1 — Two stacked fixed-position layers (`zIndex: 500` ripple host + `zIndex: 501` loop-fade) live OUTSIDE the global z-index scale referenced in research §2D. Loop-fade at 501 overlaps the bottom nav (z-50) and the AccountMenu (z-56). Fix: move both into the documented `--z-toast/--z-overlay` scale and below DynamicIsland chrome.

- **[HomeFeed.tsx:3085]** — P1 — Sticky home header sets `bg-transparent` with no `paddingTop: env(safe-area-inset-top)`. On iPhones with notch the "D" button sits under the dynamic island. Fix: add `paddingTop: 'max(8px, env(safe-area-inset-top))'`.

- **[HomeFeed.tsx:3094]** — P2 — Search button is `p-2` with `w-5 h-5` icon → ~36×36 hit target on the home header (search button is duplicated path of the header issue covered in research). Local fix: bump to `min-w-[44px] min-h-[44px]` so home page parity matches Player.

- **[HomeFeed.tsx:752-758]** — P2 — `isHovered && !prefMode` overlay is hover-only (`onMouseEnter`-driven) with no coarse-pointer guard. On touch devices, after pref-mode tap the half-tinted dark overlay sticks until next render. Fix: gate behind `@media (hover: hover) and (pointer: fine)` or use `:active` pseudo.

- **[HomeFeed.tsx:806-813]** — P2 — `WideTrackCard` `isHovered` overlay reuses pure `useState` `setIsHovered` but no `onMouseEnter`/`onMouseLeave` is wired (state is dead code, never set true). Hover overlay never appears. Fix: either wire mouse events with hover-media guard, or remove the `isHovered` state entirely.

- **[HomeFeed.tsx:1099-1100]** — P1 — `AfricanVibesVideoCard` is hard-pinned `width: '95px', height: '142px'`. On iPhone SE (375px viewport) with `paddingLeft: 28` and `gap: 16`, ~3 cards fit but the labels at `text-[6px]` (line 1170) and `text-[7px]` (line 1179) are illegible. Fix: clamp to `clamp(86px, 25vw, 110px)` height ratio + bump label to ≥10px.

- **[HomeFeed.tsx:1109-1117]** — P1 — `AfricanVibesVideoCard` glow uses `filter: blur(8px)` rendered for ALL 3 mounted iframes (active + 2 neighbors). Three `filter: blur` layers on simultaneously composited iframe boxes is a known Android low-end paint stall. Fix: only render the bronze glow on `idx === activeIdx`.

- **[HomeFeed.tsx:1573-1591]** — P2 — `FriendSearchPill` uses `bottom: '20%'` magic number with no safe-area math. On a 667px viewport the pill anchors at 133px from bottom, fighting both the bottom nav (~76px) and the system home indicator. Fix: `bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)'`.

- **[HomeFeed.tsx:1612]** — P2 — `FriendSearchPill` input is `text-[15px]` — iOS will zoom on focus (research §1 #8 covers globally; flagging here so the surface-fix agent knows this specific input).

- **[HomeFeed.tsx:1761-1767]** — P2 — `VibesLiveFriendsSheet` close button is `w-8 h-8` (32×32 — under 44px). Fix: bump to `min-w-[44px] min-h-[44px]` with smaller visual `<X>` glyph centered.

- **[HomeFeed.tsx:1746-1758]** — P3 — `VibesLiveFriendsSheet` uses `Italianno` cursive at 2rem for "Vibing Now". On Android Chrome with FOUT (research §2E), Satoshi system fallback is ~25% wider — pushes the close button off-row before font swap. Fix: reserve `min-width: 8rem` on the heading or `font-display: optional`.

- **[HomeFeed.tsx:2078-2114]** — P1 — Top10 cards animate `text-shadow` AND `box-shadow` simultaneously on the active card. `text-shadow` is never composited — paints on every transition tick. Pair this with the 0.85 → 0.35 `opacity` ramp on the radial-blur halo at 2092-2102 (with `filter: blur(12px)`) and you have 3 paint-thread animations on the same element. Fix: replace `text-shadow` with a stacked pseudo-element + `opacity` + `transform` (compositor only).

- **[HomeFeed.tsx:2132]** — P2 — Top10 labels positioned `bottom: '-52px'` outside the parent `rounded-full` overflow context. Works because parent isn't clipping, but the subtitle marquee at line 2032 (`top10-marquee` 10s linear) animates `transform: translateX(-50%)` on a non-promoted layer — known scroll-jank vector on Android. Fix: add `will-change: transform` only while marquee is active (mounting), strip on idle.

- **[HomeFeed.tsx:2289-2300]** — P2 — `NextVoyageShelf` end-of-rail marker has `minHeight: 140` baked in. When `dismissed` collapses `maxWidth: 0` the height stays 140 — produces invisible 140px box that blocks horizontal swipe. Fix: `minHeight: dismissed ? 0 : 140`.

- **[HomeFeed.tsx:3204-3207]** — P3 — Two absolute-positioned 1px gold hairlines `left-8 right-8` work for narrow viewports but on wide tablet (>768) they look like floating disconnected slashes. Fix: `inset-x-12` on tablet+ via responsive utility.

- **[HomeFeed.tsx:3289-3290]** — P2 — Classics carousel side-fades animate `rr-fade-shimmer` on `opacity` (good) but the linear-gradient also includes a `width: 52` overlay over the first/last disk. On iPhone SE the first disk's initials/title get partially veiled — readability dip. Fix: reduce overlay width to `width: 32` or fade inward only past the disk edge.

- **[HomeFeed.tsx:3325-3326]** — P3 — "More from {artist}" pill mini-thumbs use `transform: scale(1.3)` zoom on a 38px circle — produces aliasing on high-DPI screens for low-res YouTube thumbnails. Fix: drop scale or request `'medium'` thumbnail quality (currently `'high'` would suffice without zoom).

- **[HomeFeed.tsx:3461-3470]** — P3 — Stations skeleton uses `voyo-skeleton-pulse` 1.8s opacity 0.55→0.85. Loop is fine, but the rendered card has `aspectRatio: '4/5'` while the resolved StationHero may be different aspect → CLS spike when data lands.

- **[HomeFeed.tsx:3387-3401]** — P3 — Vertical "TRENDING" contour uses `WebkitTextStroke: '0.5px ...'` + `textShadow`. On Safari 14 this produces a ghosted second outline. Cosmetic.

---

## §2 Player (VoyoPortraitPlayer.tsx)

- **[VoyoPortraitPlayer.tsx:5182]** — P0 — `height: 'calc(100% - 264px)'` magic number on the Anchor Layer. If Layer-B `min-h-[360px]` (line 5556 `oyeBarBehavior === 'fade'`) or `min-h-[480px]` (cubeDockOpen) shifts, the Anchor breaks. On iPhone SE (667px) with cube dock open: 480 + 28 (`translateY`) > 50% of viewport — center hero loses vertical room. Fix: replace the calc with `flex-1` on Layer A, fixed `flex-shrink-0` on Layer B.

- **[VoyoPortraitPlayer.tsx:1170-1171]** — P1 — `ExpandVideoButton` toggles between `min-h-[36px]` (dimmed) and `min-h-[44px]` — the 36px state is BELOW the 44px touch-target floor. The fade-to-dimmed is a 5s timer (line 1081), so most users will be tapping the 36px state. Fix: keep `min-h-[44px]` always; let the visual padding shrink only.

- **[VoyoPortraitPlayer.tsx:1166-1205]** — P1 — `ExpandVideoButton` style stack chains 7 transitions (`padding 700ms`, `background 900ms`, `box-shadow 900ms`, `border-color 900ms`, `font-size 700ms`, `opacity 1.4s`, `color 700ms`). When the chip morphs from 'mini' → 'morphing' → 'takeout', overlapping different-duration easings produce a wobble where the dot, text, and box no longer animate together. Fix: collapse to one duration (700ms) for all visual properties.

- **[VoyoPortraitPlayer.tsx:1140-1148, 1187-1192]** — P1 — `phase==='takeout'` morph uses `voyo-takeout-morph-pulse` 0.9s keyframe (line 1189), but the same time the `box-shadow` transition is also 900ms (line 1198). These compete: keyframe sets box-shadow, transition tries to interpolate it → stutter on Safari. Fix: when `phase==='morphing'`, suppress `transition: box-shadow` (set to `none`).

- **[VoyoPortraitPlayer.tsx:1283-1288]** — P1 — `BottomTakeOutChip` decay timer fades chip to `opacity: 0.07` after 5s but keeps `pointerEvents: 'auto'` (line 1285 only gates on `riseProgress > 0.5`, not on decayed). A 7%-opacity 44×44 chip lingering at bottom-right is ghost-tappable — user accidentally triggers PiP. Fix: when decayed, set `pointerEvents: 'none'` until next portal-progress activity.

- **[VoyoPortraitPlayer.tsx:1325]** — P1 — `RightToolbar` uses `top-[42%] -translate-y-1/2` magic positioning. On 667px viewport this lands the toolbar at y=280, which on Layer A height=`calc(100% - 264px)` ≈ 403px collides with the BigCenterCard. On taller viewports (915px Pixel 7) this looks fine. Fix: anchor to the artwork wrap via flex sibling with `align-self: center` instead of percentage from container top.

- **[VoyoPortraitPlayer.tsx:1330-1357]** — P2 — Right-toolbar buttons are `w-11 h-11` (44×44 — passes target floor) but `gap-3` (12px) between them at 320px screen-edge offset (`right-6` = 24px) means the toolbar is 24px from the right edge. With safe-area-inset-right (notch landscape), buttons can be clipped. Fix: `right-[max(1.5rem,env(safe-area-inset-right,1.5rem))]`.

- **[VoyoPortraitPlayer.tsx:1342-1347]** — P2 — Like-button `<div className="absolute inset-0 rounded-full blur-md -z-10">` adds a blurred backdrop only when liked. `-z-10` puts it behind the parent's compositing context — on Safari this often paints on top of nothing (clipped). Fix: render outside the button using `box-shadow` glow.

- **[VoyoPortraitPlayer.tsx:5189-5215]** — P2 — Jam chip uses `paddingTop: 'calc(max(0.5rem, env(safe-area-inset-top)) + 8px)'` good. But its parent is the sticky Layer A at `top: 0` — when the user scrolls Layer C (canvas), the jam chip sticks at the top with no fade, blocking the canvas content. Fix: opacity-fade with portalProgress like the bubbles row at line 5227.

- **[VoyoPortraitPlayer.tsx:5223-5232]** — P1 — Bubbles row uses `paddingTop: 'calc(max(1.25rem, env(safe-area-inset-top)) + 36px)'`. The `+36px` is to clear the ExpandVideoButton at `top-3`. But if the device has a 47px+ notch, `safe-area-inset-top` is already 47, plus 1.25rem (20px) plus 36px = 103px down — the bubbles get pushed below the visible card. Fix: use one of safe-area OR top-3 offset, not both stacked.

- **[VoyoPortraitPlayer.tsx:5246-5247]** — P2 — History row uses `scrollSnapType: 'x mandatory'` (mandatory, not proximity). Hard snap on small horizontal gestures means the user can't peek at the next item. Inconsistent with the rest of the app (HomeFeed.tsx:3293, 2048 use `proximity`). Fix: change to `'x proximity'`.

- **[VoyoPortraitPlayer.tsx:5290-5294]** — P2 — `Plus` button at the end of queue is `w-[70px] h-[70px]` (good) but `bg-white/5 border border-white/5` reads as nearly invisible on the dark canvas. Empty queue users won't notice the affordance. Fix: bump to `bg-white/10 border-purple-500/20`.

- **[VoyoPortraitPlayer.tsx:5317]** — P2 — Center section `transform: 'translateY(28px)'` is hardcoded. On short viewports (iPhone SE 667px) this pushes the artwork below the visual center. Fix: remove translate or replace with `mt-auto mb-auto` flex centering.

- **[VoyoPortraitPlayer.tsx:5447-5466]** — P3 — Floating reactions `position: absolute` with `bottom: '30%'` of parent. When parent height shifts (due to oyeBarBehavior toggling pt-12 vs pt-10 at line 5314), the emojis reposition mid-flight. Fix: anchor to viewport-relative wrapper rather than parent-relative percentages.

- **[VoyoPortraitPlayer.tsx:5472]** — P2 — Progress bar wrapper `max-w-[180px]` — looks fine on 375px but cramped on 412px Pixel 7 (43% of width). Fix: `max-w-[min(220px,60vw)]`.

- **[VoyoPortraitPlayer.tsx:5573-5575]** — P2 — Layer B `pointerEvents: portalProgress > 0.55 ? 'none' : 'auto'` is a hard cutoff. Between 0.0 and 0.55 the layer is up to 0.6 opacity but still fully tappable — looks dim but tap-routes through. Fix: also gate `pointerEvents` at portalProgress > 0.4 to match perceptual fade.

- **[VoyoPortraitPlayer.tsx:5683-5696, 5713-5728]** — P2 — HOT (`#B54A2E`) and DISCOVER (`#D4A053`) labels use `text-shadow: '0 0 8px rgba(212,160,83,0.8), 0 0 16px rgba(212,160,83,0.5)'` (line 5725). `text-shadow` paints every frame the parent transitions box-shadow. With `boxShadow: isDiscoveryBeltActive ? ... : ...` on the same button, every belt-toggle invalidates the text-shadow paint cache. Fix: drop text-shadow, add a sibling `<div>` blur-glow with `transform: translate3d` to GPU-promote.

- **[VoyoPortraitPlayer.tsx:5774-5787]** — P2 — Hot/Discovery portal-line buttons `w-5 h-20` = 20×80 hit area. Touch target only 20px wide. Fix: `w-11 h-20` (44×80) with the visible 1.5px line centered inside.

- **[VoyoPortraitPlayer.tsx:5784-5786]** — P3 — Ambient glow `blur-lg` on the portal line is `absolute inset-0` of a 20×80 box → blurs a thin line into a big halo via Tailwind's `blur-lg` (16px). Cheap on desktop, costly when it animates `opacity-40 ↔ opacity-100`. Already running on every screen with the player. Fix: pre-rasterize via single SVG sprite with feGaussianBlur instead of CSS blur.

- **[VoyoPortraitPlayer.tsx:5862-5872]** — P1 — `cube` button at center has 3 different state-dependent box-shadows that transition between each other (line 5864-5870). `cubeDockOpen` → `cubeHolding` → active belt. Each carries different multi-layer shadow stacks; the transition between two arbitrary multi-layer shadows is undefined behavior in CSS — Safari snaps, Chrome interpolates. Fix: pick ONE shadow stack and animate only its opacity via stacked pseudo-elements.

- **[VoyoPortraitPlayer.tsx:5887-5893]** — P2 — Outer rotating ring on the cube uses `padding-box, border-box` gradient trick which is correct, but no `animation` is defined to actually rotate. The "rotating ring" comment is aspirational — the ring just sits there. Either remove the comment or wire `@keyframes voyo-cube-ring-spin`.

---

## §3 Moments (VoyoMoments.tsx + DynamicIsland)

- **[VoyoMoments.tsx:209-214]** — P1 — `commentsBackdrop` is `position: absolute, inset: 0` on a parent that may have `transform`. On parent with transform, `position:fixed` becomes relative to transformed container — but here it's `absolute` so it follows nearest positioned ancestor. The MomentCard wrap uses `S.card` which is also `position: absolute, inset: 0`. The backdrop covers correctly, but the `commentsDrawer` at line 215-229 uses `position: absolute, bottom: 0` — anchors to the same parent. If the parent has any padding the drawer would lift away from the bottom edge. Fragile. Fix: render comments drawer in a portal or use `position: fixed` relative to the viewport.

- **[VoyoMoments.tsx:217-218]** — P2 — `commentsDrawer` `maxHeight: '70%', minHeight: '50%'`. Computed BEFORE `paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))'` at line 277. With a 34px home indicator, the input is ~22px above the bottom of the visible drawer. Combined with the lack of `useMessagingViewport` integration (research §3.3 #3), keyboard-up gives partial obscure. Fix: subscribe to visualViewport, set `maxHeight: 'calc(70% - keyboardHeight)'`.

- **[VoyoMoments.tsx:282]** — P2 — `commentInput.height: 36` with `padding: '0 14px'`. Not 44px tall (touch-target check). Plus `fontSize: 13` triggers iOS zoom (research §1 #8). Both fixable in one shot by bumping height to 44 and font-size to 16.

- **[VoyoMoments.tsx:147]** — P2 — Bottom fade gradient `height: '55%'` is fixed regardless of card content. On portrait video (9:16) on iPhone 12 Pro Max (~915 tall) that's ~503px of dark wash across the lower video — the user sees the bottom HALF of every video as dimmed. Restraint, but consider clamping to `max-height: 360px`.

- **[VoyoMoments.tsx:152, 297]** — P2 — `creatorBlock` `bottom: 140` magic + `actBar` `bottom: 160` magic. ActBar is 4 stacked items of ~36px+gap20 ≈ 184px tall. Bio card `maxWidth: 'calc(62% - 30px)'` overlaps with actBar on narrow screens (<375px). Fix: anchor both to a shared bottom safe-area math + reduce bio max-width to `calc(56% - 30px)`.

- **[VoyoMoments.tsx:362-371]** — P1 — `getItemStyle` for CompassArc applies `filter: blur(${blur}px)` to offset-2/3 categories. Filter:blur is a known Safari/iOS jank trigger especially during the rotation. The 0.3s `transition: 'all 0.3s ease'` on line 380 includes the filter, so each axis swap re-rasterizes. Fix: drop blur entirely (opacity already does the depth read), or replace with reduced-saturation only.

- **[VoyoMoments.tsx:312]** — P1 — `oyeF` style has no `pointer-events: none` declared. The OYE float-up emoji at z-40 sits over actBar (z-10) — first frame after spawn could intercept tap on Heart/Fire/Comment buttons. Fix: add `pointerEvents: 'none'` to S.oyeF.

- **[VoyoMoments.tsx:411-444]** — P2 — CompassArc items `key={`${category}-${index}`}` — when `currentIndex` shifts, the wrapping `((currentIndex + offset) % categories.length …)` produces a different `idx` for the same offset slot. So index 0 (offset -3) becomes index N-1, the React reconciler unmounts/remounts. New mount = transition starts from mount-time = fade-from-zero on every category step. Fix: key by `offset` only, treat children as positional slots.

- **[VoyoMoments.tsx:1700-1722]** — P2 — Gold transition word "moments" at `fontSize: 56` with Italianno cursive only fires on first scroll then dies for the session. On repeated scroll the word doesn't reappear (uiPhase never goes back to 'transition'). Decide: is it a once-per-session arrival cue or a recurring affordance? Currently feels broken on the second visit.

- **[VoyoMoments.tsx:1727-1755]** — P2 — MIX badge `top: 100` magic number — collides with safe-area-inset-top + the topBar (~64px). On notched devices the MIX pill overlaps the axis tabs. Fix: `top: 'calc(env(safe-area-inset-top, 0px) + 88px)'`.

- **[DynamicIsland.tsx:601]** — P2 — Outer wrapper `<div className="z-20" {...dragHandlers}>` uses Tailwind z-20. App.tsx mounts DynamicIsland inside the header at z-50 already, but the inner z-20 is wasted (relative to header context). When `isReplying`, the expanded card grows to 300px wide — on a 375 viewport that's 80% of width. The card is centered? Need to verify — it's left-aligned within the flex container. Fix: ensure the wrapper has `mx-auto` or absolute center positioning when expanded.

- **[DynamicIsland.tsx:580-588]** — P2 — `collapsedStyle.width: showWave ? 190 : 165`. On iPhone SE (375 viewport) with the header's `gap-2` siblings, the pill width plus profile button + search button can overflow → forces the search button to wrap or get cut. Fix: `width: 'min(190px, 50vw)'`.

- **[DynamicIsland.tsx:767]** — P1 — Reply input `text-[12px]` causes iOS zoom-on-focus (research §1 #8). Keep visual at 12px but raise font-size of input to 16 via base layer override.

- **[DynamicIsland.tsx:771-776]** — P1 — Send button `w-8 h-8` = 32×32, below 44px touch target. Fix: bump to `w-11 h-11` with a smaller `<span>` inside.

- **[DynamicIsland.tsx:611-616]** — P2 — Wave-state pill paints THREE stacked `linear-gradient` layers with `backgroundSize: '200% 100%'` etc. Each pixel is a 3-gradient blend. No `animation` is defined here to actually MOVE the gradients (line 614 doesn't reference any keyframe). Static cost is fine but the comment claims "liquid wave" — verify the wave keyframe is wired or mark dead.

- **[DynamicIsland.tsx:628-633]** — P2 — Preview text `truncate lowercase` with `text-[10px]` — ALL lowercase text from notification subtitle. Loses proper-noun emphasis on "Burna Boy" → "burna boy". Stylistic, but check if intentional (the demo at line 250-252 uses lowercase already).

- **[DynamicIsland.tsx:651-672]** — P2 — Expanded card `bg-white/95` with black-text — pill is light-on-light when notification.type is `music` or `system`. Reply mode (`bg-black/80`) is dark. Switching modes triggers a 380ms `background-color` transition which on Safari produces a flash through transparent (if the underlying alpha hits ~0 mid-interp). Fix: use `mix-blend-mode` or two stacked panels with cross-faded opacity instead of background-color animation.

---

## §4 Search + Artist (SearchOverlayV2.tsx, ArtistPage.tsx)

- **[SearchOverlayV2.tsx:758]** — P1 — `searchAtBottom` transform uses `100dvh` literal. On iOS Safari ≤15 (still ~3% of installed base globally) `dvh` falls back to `vh` which is the wrong number (browser-chrome inflated). The "search dock at bottom" mode lands 60-90px below visible. Fix: feature-test with `@supports (height: 100dvh)` or use the `--vh` JS bridge research recommends wiring.

- **[SearchOverlayV2.tsx:819]** — P1 — Search input `text-[15px]` triggers iOS zoom (research §1 #8). Surface-specific reminder for the fix agent.

- **[SearchOverlayV2.tsx:823-829]** — P1 — Clear-X is `<X className="w-[14px] h-[14px]"> + p-1` → 22×22 hit zone. Below floor. Fix: increase parent button to `w-11 h-11` keeping the small visual icon.

- **[SearchOverlayV2.tsx:738-740]** — P2 — Main container `padding-top: max(16px, env(safe-area-inset-top, 16px))` — but inner header uses `top: 'max(16px, env(safe-area-inset-top, 16px))'` on absolute positioning. Doubles the top padding on notched devices. Fix: header at `top: 0`, parent absorbs safe-area-inset-top.

- **[SearchOverlayV2.tsx:874-879]** — P2 — Results scroll padding-top swings between 8 and 132 (delta 124px) on `searchAtBottom` flip with a 320ms transition. Mid-transition the first result row vanishes behind the header during the slide. Fix: snap padding instantly when threshold crosses, only animate the transform.

- **[SearchOverlayV2.tsx:1109]** — P2 — Toast at `bottom-24` (96px) — lands BEHIND the search dock when `searchAtBottom===true`. Toast is z-60, search header is z-51, so it's "in front" but the user sees the gold burst rendered above the search input rather than above the keyboard area. Fix: when searchAtBottom, raise toast to `bottom-[calc(100dvh-200px)]`.

- **[SearchOverlayV2.tsx:732]** — P3 — Backdrop is `bg-black/90` (good — research §2F notes the v672 lesson dropping backdrop-blur). But the input row inside still uses `backdropFilter: 'blur(14px) saturate(140%)'` (line 789) — costs less than a full-screen blur but still a perf hit on every focus state change.

- **[SearchOverlayV2.tsx:850-856]** — P3 — Tab buttons style switches between `border: 1px solid rgba(...)` and `border: 1px solid transparent` on the same button. Border presence shifts layout 1px in width — visible micro-jolt on tab swap. Fix: always-1px `border-transparent` baseline, only change the color.

- **[ArtistPage.tsx:215]** — P2 — `S.trackCard.minWidth: 280, maxWidth: 320` in a horizontal scroll row. On iPhone SE (375px) 1.16 cards visible — looks like a vertical list pretending to be a carousel. Fix: tablet-only horizontal scroll, vertical stack on phones.

- **[ArtistPage.tsx:104-113]** — P2 — `S.overlay` is `position: fixed, inset: 0` with `overflowY: 'auto'`. No safe-area padding. Header (line 119-121) uses `paddingTop: 'max(16px, env(safe-area-inset-top, 16px))'` ✓. But footer at line 762 uses `height: 'env(safe-area-inset-bottom, 0px)'` — only adds the inset, no minimum. On non-notched phones the close button at the bottom edge of the scrolled-down content butts against the viewport edge with 0 padding.

- **[ArtistPage.tsx:144-156]** — P3 — Avatar fixed at 80px regardless of viewport — fine. But the gradient backgrounds (`REGION_GRADIENTS` line 49-54) read as solid blocks at 80px; no shimmer/breathing motion to differentiate from a placeholder.

- **[ArtistPage.tsx:286-293]** — P2 — `momentThumb` `width: 120, height: 160` (4:5.3 aspect) — close to 9:16 but not quite. Real moment thumbnails are 9:16 → letterboxed black bars top/bottom inside the 120×160 frame. Fix: `aspect-ratio: 9 / 16; width: 90px; height: 160px`.

- **[ArtistPage.tsx:122-134, 580]** — P2 — Header back button is `<ArrowLeft size={20}>` inside a 40×40 rounded `S.headerBtn`. Below the 44px floor (this is the back affordance — most-tapped element on the page). Fix: bump width/height to 44.

- **[ArtistPage.tsx:572]** — P3 — Page enters with `animation: 'voyo-slide-up 0.4s ease forwards'`. No exit animation (parent unmounts immediately). Cosmetic asymmetry — entering feels intentional, leaving feels abrupt.

---

## §5 Library

- **[Library.tsx:918]** — P1 — Search input `text-[14px]` triggers iOS zoom. Surface fix needed alongside the global base-layer 16px floor.

- **[Library.tsx:932-942]** — P1 — Filter pills `py-1.5 text-[13px]` → ~26px tall, with horizontal `px-3.5` ≈ 14px each side. Hit target ~26 tall × content-width. Below 44 floor on a row that's `gap-2 overflow-x-auto`. Fix: `py-2 px-4 min-h-[44px]`.

- **[Library.tsx:1009-1013]** — P1 — Scroll list MISSING `overscrollBehavior: 'contain'` (research §3.5 #5). Vertical rubber-band leaks to the parent (which has `overscrollBehavior: 'none'` per index.css:78) — the leak between Library list and ClassicMode parent produces visible header bounce. Fix: add `overscrollBehavior: 'contain'` to the inline style.

- **[Library.tsx:881-896]** — P2 — `My Disco` heading uses an 8-stop gradient with `backgroundSize: '240% 100%'` — declared as text-clip but no animation moves the background-position. Static gradient is fine, but the `filter: 'drop-shadow(0 0 18px rgba(212,160,83,0.22))'` on a 34px-tall serif glyph is a per-frame paint cost that runs on every Library scroll (sticky header). Fix: replace drop-shadow with a sibling `::before` rendering the glow as `box-shadow` on a transparent placeholder.

- **[Library.tsx:911-922]** — P2 — Search input wrapper uses `onFocus`/`onBlur` to imperatively change `borderColor`. Skipped from React state means the focus ring doesn't react to keyboard navigation (Tab focus). Fix: use `:focus-within` on the parent or React state.

- **[Library.tsx:1072-1090]** — P2 — "In your Loop" thumbs use `transform: 'scale(1.25)'` zoom on circular thumbnails. The `objectPosition: 'center 30%'` shifts focus up — but combined with circle clipping at the same scale the artist face is often half-cropped. Inconsistent with HomeFeed Top10 (`transform: scale(1.3)`, `objectPosition: 'center 35%'`). Fix: standardize all circle-cropped artwork to one scale+position pair across surfaces.

- **[Library.tsx:1126-1133]** — P3 — "Not in your Disco" divider gradient `linear-gradient(90deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 100%)` is 1px tall but fades only LEFT → RIGHT. The matching divider in SearchOverlayV2 (line 1059) uses bronze. Visual rhythm break — same surface "Library not in disco" should match search disco vocabulary.

- **[Library.tsx:946-955]** — P3 — Active filter pill count badge `ml-1.5 px-1.5 py-0.5 text-[10px]` — text at 10px on a glassy pill is borderline on Android low-end. Fix: 11px floor for any number badge.

- **[Library.tsx:863-879]** — P2 — Sticky chrome `flex-shrink-0` parent has no `paddingTop: env(safe-area-inset-top)` — the heading "My Disco" `pt-5` (20px) is the only top padding. On notched iPhones the headline sits 5-15px under the dynamic island. Fix: `paddingTop: 'max(20px, env(safe-area-inset-top))'`.

---

## §6 Shared Chrome (OyeButton, navbar, action rails, AnchoredTaleHeader)

- **[OyeButton.tsx:333-336]** — P2 — `<span className="relative inline-flex">` with `width: px, height: px`. For `size='sm'` (28px), the entire OyeButton is 28×28 — below 44px floor. Used on TrackCard at HomeFeed.tsx:761 and 819 with `size="sm"`. Fix: keep visual at 28px, wrap in 44×44 hit-area span.

- **[OyeButton.tsx:347-350]** — P2 — `conic-gradient` ring with `WebkitMask: radial-gradient(...)` is the LIGHTNING-arc visual. WebKit has known repaint issues when conic-gradient + mask animate `animation` (line 351 spins it). On older iOS (≤15) the ring renders as a black square or disappears. Fix: `@supports` fallback to a borderless ring or single SVG circle stroke.

- **[OyeButton.tsx:382-383]** — P2 — `outline: hasRing && !isCharging && !runBubble ? style.ring : 'none'`. CSS `outline` is rendered by the browser without affecting layout — but on Android Chrome with `outline-offset: 2px` and a rounded button, the outline traces a SQUARE outside the circular button (outline doesn't follow border-radius pre-Chrome 94). Old Android still ships pre-94. Fix: render the ring as another stacked `<span>` with border-radius and box-shadow, never outline.

- **[VoyoBottomNav.tsx:251-255]** — P1 — Nav opacity transition asymmetry: fade-out is 1.2s, fade-in is 0.35s. Combined with `feedNavDim` ambient (0.30 sides / 0.50 orb at line 47-48) and pointer-down dim (0.28/0.78) — three dim sources can run concurrently and the cascade between them produces a "breathing" double-fade. Acceptable as designed, but note that the sub-`calc` opacities at line 49-50 multiply: `var(--hold-side, 1) * 0.30` so during pointer-down on dim feed, side opacity drops to 0.084 — virtually invisible buttons. Fix: clamp lower bound at 0.20 via `max(0.20, calc(...))`.

- **[VoyoBottomNav.tsx:271-289]** — P1 — In `playerMode` the wrapper has `background: transparent, border: none, boxShadow: none`. Floating chips on dark backgrounds with no chrome makes the Home/Dahub buttons hard to find when paused on a dim album art. Fix: add minimal `background: 'rgba(10,10,15,0.45)'` only to the buttons (not the wrapper) when in playerMode.

- **[VoyoBottomNav.tsx:273]** — P2 — `max-w-[280px]` on the pill. On a 320×568 iPhone SE 1st gen (still in field) — pill is 280px wide centered with 20px on each side. Inner `flex items-center justify-around px-3` distributes 3 buttons across 280-24 = 256px. Each button is ~85px wide with 44×44 inner hit area. Fits, but cramped — verify QA.

- **[AnchoredTaleHeader.tsx:225-227]** — P2 — Whisper layer transitions `transform: scaleX(0) translateY(-2px)` on collapse. `scaleX(0)` scales the box to 0 width but the text remains rendered with `transform-origin: left center` — Safari sometimes shows a 1px ghost trail at the left edge for one frame. Fix: also drop opacity to 0 BEFORE the scale starts (currently they're parallel).

- **[AnchoredTaleHeader.tsx:218-238]** — P2 — Whisper sets `fontSize: '0.6em'` (60% of parent) where parent is `text-sm` (14px) → whisper renders at 8.4px. Below readability floor on Android low-DPI. Fix: clamp to 11px minimum (`fontSize: 'max(11px, 0.6em)'`).

- **[AnchoredTaleHeader.tsx:236]** — P2 — `maxHeight: whisperVisible ? '14px' : '0px'` — the row layout shifts by 14px when whisper appears/disappears. With a 4-second hold + 380ms transitions, the parent header height oscillates every few seconds. The dot at line 176 with `marginTop: 6` is anchored against the (changing) parent baseline. Fix: reserve `maxHeight: 14px` always (just hide via opacity).

- **[OyeButton.tsx:285-310]** — P3 — The 3-phase choreography (charge/bubble/glow) uses 4.5s ring spin + 1.6s bubble pulse + 0.5s charge spin = 3 different timeframes the user could see depending on tap timing. Visual rhythm intentional but inconsistent with `feedNavDim`'s 1s ambient transition. Consider unifying ambient durations across surfaces (see §7).

---

## §7 Cross-surface (apply globally)

- **[ALL]** — P1 — **Hover state leak on touch.** 123 `hover:` Tailwind classes across src (research §1 #12). After tap on iOS, `:hover` state can persist until next tap elsewhere — known iOS Safari behavior. The OyeButton `active:scale-95` + `hover:` siblings on TrackCard, Library SongRow, NextVoyageShelf cards, ExpandVideoButton (`hover:border-purple-400/80` line 1154) all leak. Fix: codemod-wrap all `hover:*` classes in `@media (hover: hover) and (pointer: fine)` query (research §5B).

- **[ALL]** — P1 — **Animated `box-shadow` keyframes.** `voyo-glow-pulse`, `voyo-iframe-pulse`, `voyo-oye-bubble`, `voyo-orb-pulse`, `voyo-nextup-pulse`, `glow-pulse`, `playing-pulse`, `voyo-charging-pulse` all paint per-frame (research §2F). On Player surface alone, the active card can run 3 of these simultaneously (Oye top-right + Iframe pulse on chip + nextup-pulse on queue). Fix: replace with stacked pseudo-element `opacity` + scaled `transform` rings.

- **[ALL]** — P1 — **`text-shadow` animations.** Top10 active text-shadow (HomeFeed:2078), DISCOVER label (Player:5725), shimmer subtitle (HomeFeed:3187-3197), classics drift-in (3173-3197) — `text-shadow` is never composited. On Android mid-tier these are the dominant scroll-jank vector when running. Fix: pseudo-element with `box-shadow` + `opacity` instead.

- **[ALL]** — P2 — **`prefers-reduced-motion` coverage gaps.** index.css:607-631 disables ~12 named animations. But voyo-glow-pulse, voyo-iframe-pulse, voyo-oye-bubble, voyo-nextup-pulse, top10-* family, voyo-anchored-halo-breath are NOT in that list. AnchoredTaleHeader.tsx:255-257 honors it locally. Fix: extend the global `@media (prefers-reduced-motion: reduce)` rule to set all `voyo-*-pulse` and `top10-*` animations to `none`.

- **[ALL]** — P2 — **Safe-area-inset-right not applied on landscape.** Only one site (VoyoPortraitPlayer.tsx:1271 BottomTakeOutChip) handles it. ArtistPage, Library, HomeFeed, SearchOverlay, DynamicIsland do not. On landscape iPhones with notch on the left, content slides under the notch shadow. Cross-surface fix: introduce a `--safe-x` CSS var set to `max(env(safe-area-inset-left), env(safe-area-inset-right))` and apply to all top-level page wrappers as `padding-inline`.

- **[ALL]** — P2 — **Tap-targets under 44×44.** Documented header search/profile (research §1 #9), Search clear-X (line 823), DynamicIsland send (line 772), ArtistPage back (line 580), Library filter pills (line 932), bio-card react button (VoyoMoments:202 — `padding: '4px 10px'` ~26px tall). Apply 44×44 floor across all interactive chips.

- **[ALL]** — P3 — **Cosmetic text contrast.** `text-white/30`, `/40`, `/45` widely used (research §4.3). Tracks/artist subtitles, "From {city} to {city}", filter pill inactive label, comment metadata, time-ago strings — at /30 over `#0B0703` or `rgba(8,8,10)` base, contrast ratio is ~3:1, fails WCAG AA. Fix: bump light-on-dark minimums to `/55`.

- **[ALL]** — P3 — **`will-change` budget.** Currently sparse. Some animations would benefit (Top10 marquee, classics drift). But also: AnchoredTaleHeader uses `transform` transitions without `will-change` — fine for short-lived. The rule (research §5C): only on actively-animating elements, removed when idle. Codify in review.

- **[ALL]** — P2 — **Loading skeletons inconsistent across surfaces.** `voyo-skeleton-shimmer` (SearchOverlay:1090, ArtistPage:635), `voyo-skeleton-pulse` (HomeFeed:3469), `animate-pulse` (ArtistPage:620), `VinylLoader` (HomeFeed:1621). Four different skeleton languages. Pick one. Fix: standardize on `voyo-skeleton-shimmer` everywhere, retire pulse variants.

- **[ALL]** — P2 — **`backdrop-blur` budget on glass surfaces.** index.css:643-659 reduces blur on coarse-pointer + ≤768. But glass-card / glass-panel still use 20-40px blur on tablet (research §2F). FriendSearchPill (HomeFeed:1579) has 24px blur + 180% saturate, VibesLiveFriendsSheet uses `bg-black/55 + blur(4px)`, commentsDrawer uses 28px blur + 150% saturate, SearchOverlay input uses 14px blur. Inconsistent rhythm. Fix: introduce 3 tiers (chrome 8px, modal 16px, hero 28px) — pick from research §5C list.

- **[ALL]** — P2 — **Truncation/ellipsis safety.** Track titles use `.truncate` (Tailwind). But OYÉ rotation strings (HomeFeed:3367 `<span>{oyeTitleSuffix}</span>`) have no truncation safety — long city names like "Antananarivo" + parent flex layout could overflow on 320 viewport. Verify or `max-w-[180px] truncate`.

- **[ALL]** — P3 — **Animation timing rhythm.** `feedNavDim` is 1s, `voyo-anchored-anchor-in` is 380ms, ExpandVideoButton chips 700-900ms, Layer-B fade 0.18s, Moments compass 0.3s, Search dock slide 260ms, comments drawer transition 400ms. Five+ different "settle" durations across surfaces. Pick 3 canonical durations (fast 200ms, normal 380ms, slow 700ms) and snap each animation to one of them.

---

*End — 60 findings. Author: Auditor strike-team agent. Cross-references: research-2026-04-27 (PWA fundamentals), DEEP_MAP_2026-04-26 (architecture). Safe to act on each finding independently.*
