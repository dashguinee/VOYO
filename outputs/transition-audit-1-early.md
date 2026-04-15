# Transition Audit 1 — Early BG-Fix Wave

Commits: `68eefb2` → `f178ea8` → `d0fabed` (Apr 14, ~2h span)

---

## 68eefb2 — loadTrack guard race

**What it does.** Moves `lastTrackIdRef.current = trackId` from ~L1693 (post-10ms-await fade) to immediately after the guard check at L1608. Atomic claim-on-enter against concurrent `loadTrack` re-entries.

**Bug claimed fixed.** 3–5x duplicate `play_start` per track from concurrent `loadTrack` bodies (effect re-runs, rapid skips) passing a stale guard.

**BG-transition regression risk.** Low-to-medium. The guard is now load-fresh, but this change introduces a new pitfall: once `lastTrackIdRef` is set at L1608, any early bail downstream (stale check, fade timeout `isStale()` at L1698, cascade-brake at L1625, blocklist-skip at L1626, `return` after blocklist cascade) leaves the ref LOCKED on a trackId whose load never completed. If the store later re-dispatches the same trackId (e.g., user taps the same card, visibility-triggered effect re-run while extraction was still in flight), the guard at L1604 now returns silently — no reload, no play. In BG, where visibility re-kicks and `setIsPlaying` transitions are common around transitions, "same trackId came back and bailed" can look exactly like the reported silence. No matching "release lock on bail" was added.

**Current HEAD status.** Still present — L1604–L1608. The old reset comment is still at L1729 as a harmless no-op marker.

---

## f178ea8 — media session keeper + position reset

**What it does.** Three changes:
1. Inside the retry-loop `playFromUrl` (L2138–L2161): arms a 3s `keeperTimer` when `document.hidden`; if `readyState<2` after 3s, sets `loop=true`, swaps to `silentKeeperUrlRef`, then re-swaps the real URL 800ms later.
2. `mediasession.nexttrack` handler (L2794+): adds `setPositionState({duration:0, position:0, playbackRate:1})` + fresh `MediaMetadata` after `nextTrack()`.
3. `'ended'` direct listener: same position reset + metadata refresh after `nextTrack()` (now in the refactored `runEndedAdvance` at L3131–L3147).

**Bug claimed fixed.** Android drops the notification during BG `src`-swap buffer gap; OS sees stale position and treats track as dead.

**BG-transition regression risk. HIGH — already regressed and was patched by c86af95.** The keeper watchdog sets `audio.loop=true` at L2147. `HTMLMediaElement.loop` is sticky across `src` changes (per spec). If the 800ms re-swap happens and the real URL then actually resolves, `loop=true` persists — `ended` never fires → **no auto-advance**. Commit `c86af95` (Apr 14 22:20) explicitly fixes this for the preload + cached fast-paths but only with explicit `audioRef.current.loop = false` at L1792+ and L1867+. The watchdog's 800ms re-swap at L2151–L2156 still sets `audio.src = url` **without** a `loop = false` first — if this path executes on a BG next-track that then plays cleanly, loop stays true and the track loops silently/visibly forever. This is a live latent bug.

Secondary: the watchdog's 800ms `setTimeout` is throttled to ≥1s in BG on Chrome/Android. The re-swap may fire late, overlapping a subsequent `loadTrack` from the store advancing, and trample a fresh src. Not load-bearing today but fragile.

**Current HEAD status.** All three changes intact (L2138–L2161, L2794+, L3131+). The `runEndedAdvance` refactor (997f2f9) kept the position-reset + metadata block. Position reset + metadata also now mirrored in the `mediasession.nexttrack` handler as the pre-advance silent-WAV bridge pattern (08764bc).

---

## d0fabed — telemetry gate + blocklist queue filter

**What it does.** `onPlay` handler: bails early if `src === silentKeeperUrlRef.current` (L3459) AND if `playbackSource` is neither `cached` nor `r2` (L3466). `playerStore.nextTrack` + `addToQueue` now filter on `isBlocklisted()` alongside `isKnownUnplayable()`. `trackBlocklist` strips `vyo_` prefix too.

**Bug claimed fixed.** Silent-WAV bridge firing false `play_success`; blocked tracks entering the queue and causing 4-skip cascades.

**BG-transition regression risk. MEDIUM.** The guard at L3466 early-returns from `onPlay` **before** the dedup-ref-set and before `play_success` logging whenever `playbackSource` is neither `cached` nor `r2`. At BG transition, there is a race window where the real URL has been set but `setPlaybackSource(...)` (L2125) hasn't closed-over into the JSX-rendered handler's `playbackSource` closure yet (it's a React state, stale in closure until re-render). If `onPlay` fires for the real track before the re-render settles, this guard silently eats the first real-source `onPlay`. `setIsPlaying(true)` at L3464 DOES run before the guard (good), but telemetry loses the event. Symptom wouldn't be silence per se, but it would make BG transitions look "missing" in traces — which is exactly the observability gap that made this bug hard to track.

No regression to `nextTrack()` store logic — blocklist filter correctly applied in the same `while` loop that also advances past `isKnownUnplayable`.

**Current HEAD status.** All three guards in place (AudioPlayer L3459/L3466, playerStore L767/L1127, trackBlocklist L78–L82).

---

## TL;DR

**Likely BG-silent-fails contributors: 68eefb2 and f178ea8 (both still live).**

- `68eefb2`'s atomic ref claim has no "release on bail" — any guarded early-return leaves the trackId permanently locked against re-entry. In BG, where effect re-runs and visibility re-kicks routinely re-dispatch the same track, this can silently swallow a valid reload.
- `f178ea8`'s 3s watchdog at L2138–L2161 sets `audio.loop=true` and the 800ms re-swap path does NOT clear it. This is the exact pathology `c86af95` fixed for the sibling fast-paths but never reached the watchdog. When this path triggers on a BG auto-advance, the new track will loop silently — no `ended` event — dead silence at track boundary. This matches the reported symptom precisely.
- `d0fabed`'s telemetry gate is correct intent but the stale-closure `playbackSource` check can hide BG play events from traces, not cause silence directly.

Primary suspect to inspect first: **the 800ms `setTimeout` re-swap in f178ea8's keeper watchdog (L2151–L2156)** — missing `loop=false` before `audio.src = url`. Word count: 597.
