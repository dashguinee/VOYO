# Audio Audit 2 — Manual Skip-to-Next Pipeline Integrity

## A. Callsite Inventory

| # | File : line | Surface | Guard that can silently no-op | Sev |
|---|---|---|---|---|
| 1 | `VoyoPortraitPlayer.tsx:4640-4644` `handleNextTrack` | Main portrait "Next" button (via `onNext` prop, line 5046) + control surface | `if (wasSkeeping.current && Date.now()-wasSkeepingClearedAt.current < 250) return;` — 250ms belt after SKEEP end. Post-v167 tight, but STILL silently drops the very-fast-repeat case. | 3 |
| 2 | `VoyoPortraitPlayer.tsx:2052` Next button in `PlayerControls` | Portrait play bar | None locally — calls `onNext()` which is #1. Inherits its guard. | 3 |
| 3 | `VoyoPortraitPlayer.tsx:4057` `launchCardAndSkip` (swipe) | Tinder-style card swipe | Wrapped in `setTimeout(…, 200)` — calls raw `nextTrack()` (NOT `handleNextTrack`), so it bypasses the SKEEP guard entirely. 200ms animation delay means double-swipe can queue two skips. | 4 |
| 4 | `YouTubeIframe.tsx:217` ENDED state | Iframe auto-end (non-manual) | No guard. Can fire alongside native `ended` listener → double skip. | 2 |
| 5 | `YouTubeIframe.tsx:258` error 100 recovery | Iframe video-gone | `setTimeout(…,500)` + playbackSource re-check. Safe. | 1 |
| 6 | `YouTubeIframe.tsx:286` error 101/150 recovery | Iframe embed-blocked | Same 500ms + source check. Safe. | 1 |
| 7 | `LandscapeVOYO.tsx:766` SkipForward button | Landscape mode | None — raw `nextTrack()` call. No SKEEP belt, no haptic/debounce. | 2 |
| 8 | `VideoMode.tsx:162` swipe-up | Video mode vertical swipe | None — raw `nextTrack()`. | 2 |
| 9 | `VideoMode.tsx:324` Next button | Video-mode button | None — raw `nextTrack()`. | 2 |
| 10 | `ClassicMode.tsx:125` swipe-left | Classic carousel | `swipeFiredRef.current = true` locally to eat trailing click. No store-side guard. | 2 |
| 11 | `AudioPlayer.tsx:282` play() reject path | Auto-skip (not manual) | `if (!document.hidden)` then `nextTrack()`. Can fire DURING a manual skip race. | 4 |
| 12 | `AudioPlayer.tsx:1610` blocklist | Auto-skip in loadTrack | Fires inside `loadTrack`. Can race with a manual skip already queued. | 3 |
| 13 | `AudioPlayer.tsx:1749` 8s fg watchdog | Auto-skip | `if (isStale()) return; if (!isPlaying) return;` — robust. | 1 |
| 14 | `AudioPlayer.tsx:1766` 5s bg watchdog | Auto-skip (hidden) | Same `isStale()` guard. | 1 |
| 15 | `AudioPlayer.tsx:2041` `tryAudioSource` max-retries | Auto-skip after 3×2s | Inside async retry loop. Subject to stale-retry clobber (see Q6). | 4 |
| 16 | `AudioPlayer.tsx:2731` MediaSession `nexttrack` handler | Lock screen / headset / BT | None. Raw `nextTrack()` then optimistic metadata write. | 2 |
| 17 | `AudioPlayer.tsx:2925` handleEnded (dedup'd dead path) | React onEnded | Superseded by #18. | 1 |
| 18 | `AudioPlayer.tsx:2992` direct `ended` listener | Natural track end | Track-id dedup via `lastEndedTrackIdRef`. Only fires for cached/r2. | 1 |
| 19 | `AudioPlayer.tsx:3218` (est.) error recovery final skip | Auto-skip on all-recovery-fail | `recoveryIsStale()` guard. | 1 |
| 20 | `oyo/tools/music.ts:327` OYO chat "next" command | Voice/chat intent | None. | 2 |

Total: **20 callsites**. `handleNextTrack` wraps only #1/#2; everything else calls `nextTrack()` raw.

## B. Top 3 Most-Likely Causes of Skip Failures

**1. Stale closure of `nextTrack` across mode surfaces — FALSE ALARM.** All consumers pull `nextTrack` via fine-grained selector `usePlayerStore(s => s.nextTrack)` every render, and `useCallback`s have `[nextTrack]` in deps. Refs update correctly. Not the bug.

**2. `tryAudioSource` retry loop clobbering a freshly-skipped track (Sev 5).**
`AudioPlayer.tsx:2024-2221` — `tryAudioSource` closes over `trackId` from its outer scope. It calls `isStale()` BEFORE each `playFromUrl` attempt (good), but the in-flight `Promise.race` between VPS + edge is NOT cancelled when a manual skip advances the store. The old fetch keeps running; if it resolves AFTER `loadAttemptRef.current` was bumped, the `isStale()` check saves us — but `audioRef.current.src = url` happens inside `playFromUrl` only if `!isStale()`. **However**, the `MAX_RETRIES` reached path at line 2041 calls `nextTrack()` — if a stale retry reaches its own terminal and `isStale()` check at line 2025 already bailed, fine. If the terminal bail happens AFTER isStale but before the `if (attempt >= MAX_RETRIES)` branch, the auto-skip fires on top of the manual skip → store advances two tracks. **Fix: wrap entire terminal branch in `if (isStale()) return;`**, including `markBlocked()` and the `nextTrack()` call (line 2027-2042).

**3. Swipe path (`launchCardAndSkip`) bypasses SKEEP guard (Sev 4).**
`VoyoPortraitPlayer.tsx:4057` calls raw `nextTrack()` inside the swipe animation, not `handleNextTrack`. If a user SKEEPed then immediately swipes, the 250ms belt is bypassed. Also: 200ms animation gate means rapid double-swipes queue two `nextTrack()` calls that fire 200ms+ apart → both succeed, user sees two-track leap. **Fix: route through `handleNextTrack`, and add `swipeLockRef` that blocks another launch until artwork reset completes.**

## C. Race Conditions

**Double-tap skip (rapid repeat):** First tap flips `currentTrack.trackId` → `loadTrack` effect runs, `lastTrackIdRef.current = trackId_B`, `loadAttemptRef = 2`. Second tap 50ms later flips to trackId_C, effect re-runs, `loadAttemptRef = 3`. The cleanup (`return () => {...}`, line 2228) clears the first load's watchdog. But the A→B→A ping-pong question (Q5): **`lastTrackIdRef.current === trackId` at line 1590 WILL short-circuit** if the user skips B→A back to a recently-loaded track whose URL is still in `audioRef.current.src`. Since `lastTrackIdRef` is only reset inside `loadTrack`, ping-pong A→B→A returns without calling `play()` again, leaving the audio paused if the pause-before-load already fired. **This is a latent bug triggered by prev→next→prev in <1s.**

**Q3 (isPlaying=false before skip):** `nextTrack` in store unconditionally sets `isPlaying: true` (line 798, 888, 973). So a skip from paused auto-plays. Good.

**Q6 retry mid-skip:** See #2 above — retry Promise chain is NOT aborted, only gated on `isStale()`. Fine in happy path, but no `AbortController` on `fetch` means VPS response still arrives and briefly runs `setPlaybackSource` if isStale check slips through event-loop ordering.

**Q7 `isStale()`:** Monotonic counter, synchronous increment at effect entry — bulletproof against rapid thrash EXCEPT for the `lastTrackIdRef` short-circuit which sits BEFORE the stale check consumers.

## D. Inefficiencies

1. **Every skip reads `loadPersistedState()` + writes full localStorage JSON synchronously** (line 810, 982) — blocking main thread during the most audio-sensitive window. Idle-callback already used for queue; extend to track metadata.
2. `MediaSession.nexttrack` handler (line 2730) writes metadata TWICE (once via effect re-run on `currentTrack` change, once optimistically inline). Remove inline write; effect re-run covers it.
3. `nextTrack` in store runs `recordPoolEngagement` + `oyoOnTrackSkip` synchronously before any `set()` — user sees skip-to-advance latency of whatever those take. Defer to microtask after the `set()`.
