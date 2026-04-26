# VOYO Final Prune — Audit 3 (2026-04-26)

Verified line-by-line on the post-v660 tree. No invented bugs. Every claim
backed by file:line + code excerpt. Severity grading reflects actual user-
felt impact, not theoretical cost.

---

## PART 1 — TIMER / WATCHDOG / RAF AUDIT

Format: **NAME** — Cadence — Where — Purpose — Verdict

### Audio core

- **bgEngine heartbeat** — every 4s (gated inside MC microtask loop) — `src/audio/bg/bgEngine.ts:290-485` — Detect ctx-suspend / silent-paused element / synthetic-ended / stuck playback in BG. — **KEEP**.
  - Already MessageChannel-driven (not throttled in BG, unlike setInterval). Cadence gate is `now - lastTick < 4000`.
  - Dash's question "do we need it at all? or 3s? 2s?" — **the answer is 4s is right**:
    - At 4s, stuck-detector escalates after 2 ticks = 8s of frozen `currentTime`. That's already aggressive — the user notices stalled audio at ~5-8s.
    - At 3s the kick rate increases 33% → more `el.play()` calls in BG → iOS specifically logs `NotAllowedError` more often (recorded as `heartbeat_kick_rejected` in telemetry). Power cost rises with no detection upside.
    - At 2s the synthetic-ended detector would race the natural `ended` event — they'd both fire on the 0.5s pre-end window and the dedup in `lastEndedTrackIdRef` would have to absorb it. Risk of duplicate advances spiked in v633's 2s pre-fix telemetry.
    - Cost of NOT having it: BG playback dies on iOS within ~2 minutes of screen lock. This is the watchdog of the entire BG strategy.

- **AudioPlayer time-update** — *event-driven, not interval* — `src/components/AudioPlayer.tsx:638-722` (handler) + `src/components/AudioPlayer.tsx:871` (`onTimeUpdate={handleTimeUpdate}`). — Browser fires native `timeupdate` ~4-15Hz on the `<audio>` element. **KEEP**.
  - The legacy `setInterval` watchdog on AudioPlayer was removed (comment at line 724-728 explains the migration to bgEngine). Verified — there is no setInterval in AudioPlayer.tsx.

- **YouTubeIframe time-update** — every 250ms — `src/components/YouTubeIframe.tsx:715-732` — Pulls iframe `getCurrentTime()` to playerStore so progress bar moves while `playbackSource === 'iframe'`. **KEEP**.
  - Atomically batched (one Zustand `setState` per tick — see comment at lines 700-707). Visibility-gated (line 718). Only mounted while `playbackSource === 'iframe' && isPlaying`. The 250ms = 4Hz cadence is already at the floor for a smooth-looking progress bar.

- **YouTubeIframe drift sync** — every 1500ms — `src/components/YouTubeIframe.tsx:677-693` — Re-snap iframe to audio time when drift > 0.6s, while `playbackSource ∈ {cached, r2}`. — **REDUCE** (gating tightening).
  - **The interval mounts on every `playbackSource ∈ {cached, r2}`, including `videoTarget === 'hidden'`** — when the iframe player is destroyed (effect at line 222-227 destroys it on `isBoosted && videoTarget === 'hidden'`). Inside the timer, `playerRef.current` is null so it just no-ops, but it's still a wasted timer firing every 1.5s for the entire R2 lifetime.
  - **Recommendation**: add `videoTarget !== 'hidden'` to the early-return at line 660. Cost of NOT doing this: 40 wasted timer wakes per minute during pure-audio R2 playback (the dominant flow). Trivial save individually, real save in aggregate.

- **freqPump (rAF)** — 10fps gated (every 6th rAF) — `src/audio/graph/freqPump.ts:43-87` — Reads AnalyserNode → writes CSS vars for visual reactivity. — **KEEP**. Gated by `isPlaying`, paused on `document.hidden` (line 45), delta-gated CSS writes (>5% change).

### Hot swap (iframe → R2)

- **useHotSwap snapshot** — every 1000ms — `src/player/useHotSwap.ts:342-347` — Captures iframe `currentTime` so a hotswap can restore position if iframe dies. — **KEEP**. Single-purpose, 1s cadence is the floor — going to 2s widens the position-loss window on iframe death.

- **useHotSwap R2 poll** — every 2000ms — `src/player/useHotSwap.ts:580-612` — HEAD-probes R2 as safety net for missed Realtime UPDATE. — **KEEP**. Already tightened in audit-2 from 5s → 2s. Capped at 60 attempts (~2min). Pauses on `document.hidden`.

- **r2Probe in-flight dedup** — TTL 2000ms after resolve — `src/player/r2Probe.ts:65-67` — Reuses live Promise for parallel callers. — **KEEP**. Combined with the cache-buster `_v=Date.now()` (line 43), every dedup window expiry triggers a fresh network round-trip — that's intentional (cached 404s are the enemy when extraction is racing). 2s is the right floor.

### Long-period intervals

- **Service Worker update poll** — every 15 min (was 60min in MAP) — `src/main.tsx:30-33` — Calls `reg.update()` to fetch new sw.js. **KEEP**. Already visibility-gated (line 31). Every 15min = 96 wakes/day → ~32/day with visibility gate.

- **App version-check poll** — every 2 min — `src/App.tsx:421` — Fetches `/version.json` and compares against `__APP_VERSION__`. — **REDUCE** (5-10 min) OR add visibility gate.
  - Currently fires unconditionally — no `document.hidden` check. Browsers throttle to 1/min on backgrounded tabs anyway, but on the foregrounded tab this is 30 fetches/hour for a deploy that lands maybe once/day.
  - The SW update poll at 15min already covers the "force reload on stale tab" case. The 2min version.json poll is redundant when SW poll exists.
  - **Recommendation**: bump to 5 min + visibility gate. Cost of NOT doing this: ~360 wasted `/version.json` fetches/day for an active session. Saves 10ms/fetch round-trip on weak networks.

- **trackPoolStore maintenance** — every 5 min — `src/store/trackPoolStore.ts:559-573` — Rescore + age-out pool tracks. — **KEEP**. Already idle-deferred via `requestIdleCallback`.

- **trackBlocklist refresh** — every 30 min — `src/services/trackBlocklist.ts:103` — Pull global blocklist. — **KEEP**. Background, single fetch.

### Presence / social pings

- **AuthProvider presence ping** — every 30s — `src/providers/AuthProvider.tsx:300` — Update `friendsAPI.updatePresence` so friends see "Listening to X". — **KEEP**.
  - Already deduped on activity-string change (lines 124-125) — a steady-state idle pinger only emits 1 network request/2-10 min. The 30s interval is the trigger; the early-return is the savings.
  - Visibilitychange at line 310-315 re-pings on FG return. Critical for "friend just opened laptop" presence freshness.

- **VoyoBottomNav unread DM ping** — every 30s — `src/components/voyo/navigation/VoyoBottomNav.tsx:188` — `messagesAPI.getUnreadCount`. — **REDUCE** (60s) OR remove since RT subscription already exists.
  - Lines 190-195 set up a Realtime subscription that increments `setUnreadDMs(prev => prev + 1)` on every new DM. The 30s poll exists as a safety net for Realtime drops.
  - Cost of NOT polling: if RT drops, unread badge is stale until next mount.
  - **Recommendation**: bump to 60s + add `document.hidden` gate. The badge is visual-only — staleness for 60s when backgrounded is invisible.

- **HomeFeed online-friends ping** — every 30s — `src/components/classic/HomeFeed.tsx:2628` — `friendsAPI.getFriends` filtered to `status === 'online'`. — **REDUCE** (60s) OR add visibility gate.
  - **No visibility gate** at all. Every 30s, even on backgrounded tab (browser throttles to 1/min). Used to drive a decorative "live friends" UI.
  - Cost of NOT polling: live count is stale by ≤60s when active. Decorative.
  - **Recommendation**: bump to 60s + add `document.hidden` gate.

- **VoyoLiveCard friend-activity ping** — every 30s — `src/components/social/SignInPrompt.tsx:172-175` — Pulls `friendsAPI.getFriends` + `activityAPI.getFriendsActivity`. — **REDUCE** (60s).
  - Already `document.hidden` gated (line 173). Two parallel `getFriends`/`getFriendsActivity` calls every 30s. Could be 60s — same trade-off as above (decorative card).

### Decorative loops in SignInPrompt (the heavy hitter)

The SignInPrompt component (always mounted on home tab) carries:

- **Gradient cycle** — every 10000ms — `src/components/social/SignInPrompt.tsx:189` — Cycles background gradient. **KEEP**.
- **Center-avatar cycle** — every 4000ms — `src/components/social/SignInPrompt.tsx:200` — Crossfades center avatar. **KEEP**.
- **Friend cycle** — every 5000ms — `src/components/social/SignInPrompt.tsx:219` — Crossfades friend pair. **KEEP**.
- **Rotation rAF** — 20fps setState (`STATE_THROTTLE_MS = 50`) — `src/components/social/SignInPrompt.tsx:243-259` — Drives `setRotation` for ring animation. — **REDUCE**.
  - This is a `setState` call **20 times per second** for a slow ring rotation. Even with React.memo isolation, the rotation value flows into the rendered transform of avatars. 20Hz state updates on a 6-avatar always-mounted card.
  - Already throttled from 60Hz → 20Hz. Could go further: **10fps (100ms throttle) is indistinguishable for slow rotations** (`speed = 0.02 deg/ms` = 1°/50ms = 0.5°/100ms — still under the perception threshold).
  - Better: **move to pure CSS animation** (`@keyframes rotation` + `animation: rotation 30s linear infinite`). Zero JS, zero state, GPU-only. The reset-on-FG-return logic isn't load-bearing — CSS animations pause when tab is hidden naturally. Eliminates the entire rAF loop + setState chain.
  - Cost of NOT doing this: persistent 20Hz React render churn on a card whose only visible change is a slow rotation.

### NowPlaying ambient reactions

- **NowPlaying ambient emoji spawner** — every 4-7s (random) — `src/components/classic/NowPlaying.tsx:367-370` — Spawns floating emoji while `isPlaying && isOpen`. — **KEEP**. Already visibility-gated (line 375-377), gated by `isOpen`.

### Other

- **LiveStatusBar trending pulse** — every 28000ms — `src/components/classic/LiveStatusBar.tsx:125-133` — Surfaces "Trending · Artist" tale. **KEEP**. Decorative, kicks off after 8s mount.

- **DynamicVignette intensity cycle** — every `beatDuration * 8 * 1000` ms (≈4s @ 120bpm) — `src/components/voyo/feed/DynamicVignette.tsx:77-91` — Random spotlight intensity shift. — **KEEP** (gated by `isPlaying && isActive`). Only mounts inside VoyoMoments. Decorative.

- **useIdleDim** — every 5000ms — `src/hooks/useIdleDim.ts:55-59` — Compute idle level from `lastInteractionRef`. **KEEP**. Single instance from App.tsx. Light.

- **Top10 countdown** — every 2400ms — `src/components/classic/HomeFeed.tsx:1827-1832` — Per-second tick of the 8→0 countdown. **KEEP** (one-shot, terminates at 0).

- **HomeFeed audio-glow rAF** — 10fps gated (every 6th rAF) — `src/components/classic/HomeFeed.tsx:2526-2545` — Drives a soft radial pulse from CSS vars. — **REDUCE** (gate by isPlaying via subscription, not by getState).
  - Currently the rAF runs **always** (regardless of `isPlaying`) and just no-ops when paused. ~16 frames/sec of `requestAnimationFrame` callback overhead even when no music is playing.
  - Cost of NOT doing this: ~16 needless rAF ticks/sec on the home feed when the user is browsing without playing music. Trivial individually, but the home tab is the most-mounted view.
  - **Recommendation**: subscribe to `isPlaying` and start/stop the rAF in the effect. Mirrors freqPump's pattern.

- **VoyoPortraitPlayer SuggestionChain glow cycle** — every 300ms (terminates after 5 ticks) — `src/components/voyo/VoyoPortraitPlayer.tsx:2134-2144` — One-shot pill chain animation. **KEEP**.

- **VoyoPortraitPlayer reaction multiplier display** — every 150ms (only while charging) — `src/components/voyo/VoyoPortraitPlayer.tsx:2624-2631` — Updates multiplier number while user holds reaction button. **KEEP**.

- **VoyoPortraitPlayer SKEEP seek interval** — every 100ms (only during scrub) — `src/components/voyo/VoyoPortraitPlayer.tsx:4732-4744` — Seek-based scrubbing for backward + level 2+ forward. **KEEP**. User-active gesture, terminates on release.

- **VoyoPortraitPlayer tagline rotator** — every `timing.taglineDwell` ms (only when in view) — `src/components/voyo/VoyoPortraitPlayer.tsx:391-393` — Cycles community taglines. **KEEP** (`isInView` gated).

- **VoyoPortraitPlayer PortalBelt rAF** — 60fps animate — `src/components/voyo/VoyoPortraitPlayer.tsx:1400-1429` — Drives auto-scroll snake animation. **KEEP** (visibility-gated, `isActive` + `!isPaused` gated). Could pause-when-paused but it's already gated.

- **DynamicIsland waveform rAF** — 60fps (no throttle) — `src/components/ui/DynamicIsland.tsx:382-391` — Updates 5 bars while voice recording. **KEEP**. Only runs during active recording.

- **AtmosphereLayer scroll rAF** — 1 rAF per scroll event — `src/components/atmosphere/AtmosphereLayer.tsx:80-94` — Updates `--voyo-scroll-vis` CSS var. **KEEP**. Idle when no scroll.

### Audit-2 leftover dead code

- **audioEngine.startBufferMonitoring** — every 5000ms — `src/services/audioEngine.ts:433-443` — Buffer health monitoring. — **REMOVE** (dead code).
  - **No callers in the entire codebase** (`grep -rn "startBufferMonitoring" src/` → only the definition).
  - Cost of NOT removing: 80 lines of unused code (the start/stop methods + the `bufferMonitorInterval` field). No runtime cost — never invoked.
  - **Recommendation**: delete `startBufferMonitoring` and `stopBufferMonitoring` from `audioEngine.ts`. Also delete the unused private fields: `bufferMonitorInterval`, `monitoredElement`, `onBufferEmergency`, `onBufferWarning`.

---

## PART 2 — RESIDUAL HOT-PATH INEFFICIENCIES

### 1. YouTubeIframe drift-sync interval mounts during pure-audio playback

**Where**: `src/components/YouTubeIframe.tsx:659-696`
**Issue**: The drift-sync `setInterval` mounts whenever `(playbackSource === 'cached' || playbackSource === 'r2') && isPlaying`. But the YT player itself is **destroyed** when `videoTarget === 'hidden'` (effect at line 222-227). So the timer fires every 1.5s into a dead `playerRef.current` and just no-ops.

For pure audio listening (the dominant flow — most users have video hidden), this is 40 wasted wakes/min for the entire track lifetime.

**Fix**: add `videoTarget === 'hidden'` to the early-return at line 660:
```ts
if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !isPlaying || videoTarget === 'hidden') return;
```

### 2. App version-check poll has no visibility gate

**Where**: `src/App.tsx:421`
**Issue**: `setInterval(checkVersion, 2 * 60 * 1000)` fires unconditionally. No `document.hidden` check. The SW update poll at `main.tsx:30` (15-min cadence) already covers stale-tab updates. The 2-min poll is over-aggressive and redundant.

**Fix**: bump to `5 * 60 * 1000` AND wrap the poll in a visibility gate (skip when `document.hidden`).

### 3. SignInPrompt rotation rAF (20Hz setState forever)

**Where**: `src/components/social/SignInPrompt.tsx:243-259`
**Issue**: A pure-decorative ring rotation triggers `setRotation` 20×/sec while the home tab is mounted. The rotation is `speed = 0.02 deg/ms` — slow enough that 10fps is imperceptible.

Better still: **pure CSS keyframe** (`animation: rotate 30s linear infinite`). Zero state, zero rAF, browser auto-pauses on tab hidden. Removes the entire rAF + visibility-gate + setTimeout-fallback dance (lines 237-273).

### 4. HomeFeed audio-glow rAF runs even when paused

**Where**: `src/components/classic/HomeFeed.tsx:2523-2545`
**Issue**: `useEffect(..., [])` mounts the rAF unconditionally. Inside, `usePlayerStore.getState().isPlaying` is checked but the rAF still fires 60×/sec to reach that check (work-rate gated to 10fps via `frame % 6`). When music is paused, this is pure no-op churn.

**Fix**: subscribe to `isPlaying` in the effect deps; start/stop the rAF based on it. Mirror the `freqPump.ts:30` pattern (early-return when `!isPlaying`).

### 5. downloadStore creates fresh Map on every progress tick

**Where**: `src/store/downloadStore.ts:257-263` (and 4 other call sites)
**Issue**: Every 500ms during an active boost download, `new Map(get().downloads)` creates a fresh Map reference. Subscribers like `useDownloadStore(s => s.downloads)` in `BoostButton.tsx:277` re-render on EVERY tick because default `===` breaks. This only matters DURING active download, but during a boost it's 2 extra renders/sec across BoostButton/BoostSettings.

**Fix**: `BoostButton.tsx:277` should select what it actually uses (e.g. `useDownloadStore(s => s.downloads.get(currentTrack?.trackId)?.progress ?? 0)`) instead of subscribing to the whole Map. Same for `BoostSettings.tsx`.

Verified the core hot-path components are clean: `useShallow` is correctly applied to `reactions[]`, `queue[]`, `history[]`, `hotTracks[]`, `discoverTracks[]`, `cachedTracks[]`, `categoryPulse{}`, `recentReactions[]`, `trackReactions{}`, `trackStats{}`. Audit-2 caught these well.

### Re-render audit (verified clean — no false positives to fix here)

- All `setState` deps in `VoyoPortraitPlayer.tsx` checked — no inline objects/arrays in dep arrays. Most callbacks wrapped in `useCallback`. Multi-key store destructures avoided in favor of fine-grained selectors.
- `key={index}` patterns are all on **static decorative arrays** (skeletons, particles, dots) — not on data lists. No remount-on-reorder bugs.
- `getBoundingClientRect` calls (3 found) are all in one-shot tap handlers, not in scroll/touch loops. `offsetHeight` (1 use) is a deliberate forced reflow after a drag transition reset — correct usage.
- Scroll handlers in `HomeFeed`, `Library`, `SearchOverlayV2`, `VoyoPortraitPlayer`, `VoyoBottomNav`, `Top10Section` all rAF-batched with the `if (rafRef.current != null) return; rafRef.current = requestAnimationFrame(...)` pattern. No raw layout reads in scroll.

### CSS animation review

- All `@keyframes` checked at `src/index.css`. The only animations on layout-affecting properties (`box-shadow`, `top: → left:`) are: `glow-pulse`, `wave-pulse`, `glow-pulse-energy`, `playing-indicator`. **None of these classes are used** (`grep` returned zero matches in `src/`). Dead CSS — could be deleted but zero runtime cost.
- The actively-used keyframes (`voyo-orb-pulse`, `voyo-iframe-pulse`, `voyo-oye-bubble`, `golden-beam-sweep`, etc.) animate `transform` + `opacity` only. GPU-composited, no layout cost.

---

## PART 3 — PWA-FUNDAMENTAL COMPROMISES

The honest "we cannot fix this in JS" list. These are platform constraints:

### iOS Safari background audio + AudioContext

- **iOS suspends AudioContext on screen lock** (state transitions to `interrupted`, not `suspended`). The bgEngine subscriber (`src/audio/bg/bgEngine.ts:233-247`) catches this and resumes. But **the resume itself can fail** on long lockscreens — iOS revokes audio focus after extended interruption. We re-kick the element on FG return, but if iOS killed audio mid-track, the user perceives a gap. **No JS fix exists**; this is an OS-level constraint.

- **iOS gesture-locked autoplay**: `el.play()` rejects with `NotAllowedError` outside a user gesture. The fallback at `AudioPlayer.tsx:600-605` retries once at 100ms. If the OS is mid-transition, even the retry can fail. We accept this — `setIsPlaying(false)` is the honest UI response.

- **AudioContext closed on long-BG** — `bgEngine.ts:194-201` catches `state === 'closed'` and tears down the chain so `useAudioChain` re-wires on next render. This works but feels janky; the user gets a brief silence on FG return after a 30+ minute BG session. No fix.

### Chrome / Edge background tab throttling

- `setInterval` is throttled to 1/min on hidden tabs. The bgEngine deliberately uses **MessageChannel** (`bgEngine.ts:293-302`) to escape the throttle for the heartbeat. All other intervals (presence, friends, unread DMs, version-check) intentionally accept the throttle — staleness when backgrounded is fine for those.
- `requestAnimationFrame` is paused entirely on hidden tabs. freqPump (`freqPump.ts:45`) handles this with a `wasHidden` flag to reset frame counter on FG return. SignInPrompt rotation (`SignInPrompt.tsx:244-248`) does a setTimeout fallback to keep accumulating rotation while hidden — questionable value, would die naturally if migrated to CSS.

### Service Worker activation race on first load

- `main.tsx:23-43` registers SW on `window.load`. First-time visitors don't have a SW until that event fires + SW installs + `controllerchange` propagates. During this window:
  - Audio-cache routes serve from network (no offline fallback).
  - SW_UPDATED messages can fire before the listener is attached.
- Mitigations exist (audit-PWA-2 covered the `controllerchange` recovery) but the **first-paint window before SW install is fundamentally network-only**. Can't fix in PWA.

### localStorage quota

- The persisted state at `src/store/playerStore.ts` (queue, history, currentTime) writes synchronously every 5s during playback. Quota cap is 5MB; exceeding it throws `QuotaExceededError`. We catch silently in `savePersistedState`. No graceful overflow — old history just stops persisting. **PWA-COMPROMISE**: we'd need IndexedDB to scale beyond, but that's an async API and the rest of the persist layer is sync.

### React.memo limitations on always-mounted components

- `VoyoPortraitPlayer` (~6k lines) is always-mounted and subscribes to ~25 store fields. Even with `useShallow` + fine-grained selectors, **any store update for any of those 25 fields rebuilds the component tree below**. We've already isolated `CurrentTimeDisplay` / `ProgressSlider` / `ReactionBar` etc. into `memo`'d children — but the parent body still re-renders on every meaningful change.
  - The architectural fix is to **split the 6k-line component into independent memo'd panels** that subscribe directly to the slice they need. This is a substantial refactor (~3-5 days), not a prune.
  - **Accept for now**: audit-2 already extracted the worst offenders into memo'd children. The remaining cost is real but bounded.

### Realtime channel TIMED_OUT on Supabase

- `useHotSwap.ts:493-555` includes RT_MAX_RECONNECTS=3 with 10s backoff for the hotswap RT subscription. **There's no equivalent reconnect for the reactions / messages / friends-activity RT channels** — when those drop, they stay dropped until re-mount. The poll safety nets (30s for unread, 30s for friends) cover this gap. **PWA-COMPROMISE**: full Realtime resilience requires a session-scoped RT supervisor, which isn't built.

### iOS PWA "WebAPK" rotation lock

- `main.tsx:14` calls `screen.orientation.unlock()` on boot to escape stale WebAPK orientation locks. Chrome's WebAPK on Android can persist a stale `"orientation": "portrait"` even after the manifest changes — until the user uninstalls + reinstalls. **The unlock() call is the workaround**; it throws on iOS / non-fullscreen. We accept the throw silently. **Cannot be fixed without forced reinstall.**

### Web Audio quantization noise on iOS

- During the hotswap crossfade (`useHotSwap.ts:215-229`), the equal-power curve is implemented as 40 discrete `el.volume = ...` writes. iOS Safari's volume property has audible quantization steps below ~5%. There's no `gain` automation API on `<audio>` elements. **Cannot be fixed at JS level** — the only path is routing through MediaElementSourceNode (already done for the audio engine path; fail-safe fallback for the iframe→R2 swap intentionally uses raw el.volume because iframe audio can't be routed through the chain).

---

## SUMMARY OF ACTIONS

### REMOVE (1 candidate, fully defensible)

| Item | File:Line | Justification |
|---|---|---|
| `audioEngine.startBufferMonitoring` + the supporting fields | `src/services/audioEngine.ts:407-465` | Zero callers in codebase. 5s interval + 4 dead fields. Pure dead code. |

### REDUCE (5 candidates)

| Item | Cadence | Recommended | File:Line |
|---|---|---|---|
| App version-check poll | 2 min | 5 min + visibility gate | `src/App.tsx:421` |
| Unread-DM ping | 30s | 60s + visibility gate | `src/components/voyo/navigation/VoyoBottomNav.tsx:188` |
| HomeFeed online-friends ping | 30s | 60s + visibility gate | `src/components/classic/HomeFeed.tsx:2628` |
| VoyoLiveCard friend-activity ping | 30s | 60s | `src/components/social/SignInPrompt.tsx:172` |
| SignInPrompt rotation rAF (20Hz) | 50ms | 100ms OR migrate to CSS keyframe | `src/components/social/SignInPrompt.tsx:243-259` |

### TIGHTEN GATING (2 candidates)

| Item | Issue | File:Line |
|---|---|---|
| YouTubeIframe drift-sync interval | Mounts even when `videoTarget === 'hidden'` and player is destroyed. Add `videoTarget === 'hidden'` to early-return. | `src/components/YouTubeIframe.tsx:660` |
| HomeFeed audio-glow rAF | Always-on rAF — should subscribe to `isPlaying` in deps and start/stop. | `src/components/classic/HomeFeed.tsx:2523-2545` |

### KEEP (everything else verified above)

The bgEngine 4s heartbeat, AudioPlayer's native `timeupdate`, useHotSwap snap (1s) + poll (2s), r2Probe dedup TTL (2s), AuthProvider presence (30s), SW poll (15min), trackPoolStore maintenance (5min), trackBlocklist (30min), freqPump (10fps gated), SKEEP seek interval (100ms), reaction multiplier (150ms), Top10 countdown (2.4s), DynamicVignette intensity (4s, gated), LiveStatusBar trending (28s), useIdleDim (5s).

### ACCEPT AS PWA-COMPROMISE

iOS AudioContext interruption + autoplay gates, Chrome BG `setInterval` throttling, SW first-paint race, localStorage 5MB cap, React.memo limits on always-mounted 6k-line player, Supabase Realtime TIMED_OUT (partially mitigated for hotswap, not for reactions/messages/friends), iOS WebAPK rotation persistence, iOS audio volume quantization.
