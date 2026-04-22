# AUDIT-1 — Playback Lifecycle (setCurrentTrack → audio.src → play())

**Scope:** every code path from "new track selected" to "audible bytes playing or silently failing."
**Files audited:** `src/components/AudioPlayer.tsx` (707 lines, post-refactor), `src/store/playerStore.ts` (1854), `src/services/oyo/index.ts`, `src/services/oyo/app.ts`, `src/player/useHotSwap.ts`, `src/services/voyoStream.ts`, `src/components/YouTubeIframe.tsx` (selected sections), `src/player/r2Probe.ts`, `src/player/iframeBridge.ts`.
**Priors consumed:** `outputs/AUDIO-PIPELINE-INVENTORY.md` + `outputs/AUDIT-skip-state-leaks.md` (both Apr 16). AudioPlayer was **3844 lines** in that audit — it is **707 lines** now. Massive extraction since. The VPS session model is fully ripped. Recommendations below reflect the CURRENT code, not a diff.

---

## Lifecycle map (as of today's commits)

A track change begins when something mutates `playerStore.currentTrack.trackId`. Entry points: (a) `app.playTrack(track, source)` which calls `setCurrentTrack` + `setIsPlaying(true)` + `ensureTrackReady(priority:10)` + logs a `play_intent` trace; (b) `playerStore.nextTrack()` which advances the queue or picks from the discover/hot pool and uses a **direct `set({...})`** — NOT `setCurrentTrack`; (c) `playerStore.prevTrack()` similarly; (d) `stopRoulette` which calls `setCurrentTrack`; (e) the recommendation-seed branch in `refreshRecommendations` which writes `currentTrack` via `set` without going through `setCurrentTrack`; (f) the rapid-skip pivot in AudioPlayer which calls `setCurrentTrack(pivot)` and then `ensureTrackReady` on top of it.

`AudioPlayer`'s `useEffect(..., [currentTrack?.trackId])` reacts: it issues an optimistic `setIsPlaying(true)` if not already playing, picks a fade length from `el.currentTime` (outgoing track elapsed), kicks off a soft fade-out, flips `trackSwapInProgressRef.current = true`, increments `trackChangeTokenRef`, then inside an async IIFE awaits the fade timer, checks `r2KnownStore.has(currentTrack.trackId)` synchronously, and branches: **R2 fast path** (sets `el.src` to `R2_AUDIO/<ytId>?q=high`, fires `tryPlay` ladder [0,120,500,1500]ms, `setPlaybackSource('r2')`, logs `play_start` after 300ms) OR **iframe path** (pauses + removes src from `<audio>`, `setPlaybackSource('iframe')`, logs `play_start` after 300ms, queues `ensureTrackReady` and kicks a background HEAD probe to warm `r2KnownStore`). Whichever path, `oyo.onPlay(track)` fires synchronously; prewarm fires for upcoming queue items.

`useHotSwap` watches `playbackSource === 'iframe'`. It starts a 1s snapshot ticker (captures iframe `currentTime`), subscribes to Supabase Realtime on the `voyo_upload_queue` row (if status is non-terminal), and starts a 2s HEAD poll (capped at 60 attempts). Whichever detects R2 first calls `trigger(reason)` which runs `performHotSwap` — that sets `el.src` to R2, seeks to snapshot, waits 2.5s for canplay, runs an equal-power crossfade 0→volume over 2s (40 steps), and finally sets `playbackSource='r2'`. Watchers tear down when `playbackSource` flips to r2, on track change, or on unmount.

On natural end: `<audio>` fires `ended` → `handleEnded` sets `trackSwapInProgressRef=true`, logs `stream_ended`, calls `playerStore.nextTrack()`. If backgrounded, the `timeupdate` watchdog at `AudioPlayer.tsx:512` fires a synthetic `nextTrack()` when within 0.3s of duration and `el.paused` is true. `YouTubeIframe`'s `onStateChange` also has a 3s ENDED watchdog for iframe-source (or for R2 tracks that didn't advance). `handleCanPlay` commits the track swap (clears `trackSwapInProgressRef`, fades gain in, re-calls `el.play()` if isPlaying). Transient 'pause' events during src reassignment are absorbed by `handlePause`'s `trackSwapInProgressRef` guard.

On errors: audio element `onError` pushes into `errorBurst`; ≥3 errors in 10s → force `nextTrack()`. `onWaiting` debounces a stall log 800ms (does NOT skip). `onStalled` just logs. On visibility change back from BG: `visibilitychange` effect retries `el.play()` if store says isPlaying but element is paused — and critically, this is the ONLY BG-recovery code path now; 99% of the old scaffolding (loadWatchdog, gainWatchdog, stuck-playback heartbeat, synthetic-ended heartbeat, silent-WAV bridge, MessageChannel timers, ctx_resume heartbeat) has been **ripped**. Whether that's a feature or a regression is the question this audit answers.

---

## Findings

### 1. [P0] `nextTrack()` fires `recordPoolEngagement(nextTrack.id, 'play')` and `oyo.onSkip/onComplete(currentTrack, pos)` **BEFORE** AudioPlayer's effect runs — but `app.playTrack` delegates the play_start telemetry to AudioPlayer, resulting in play_start never firing for auto-advanced tracks

**Location:** `playerStore.ts:761-885` (`nextTrack`) vs `AudioPlayer.tsx:284-291` (play_start log).

**What's wrong:** `app.playTrack()` intentionally *moved* the `play_start` log into `AudioPlayer`'s track-change effect to avoid double-logging. That's fine for user-initiated plays. But `nextTrack()` is the path for **auto-advance on track end** and **media-key next**. When `nextTrack` fires, AudioPlayer's effect DOES run and DOES log `play_start` at +300ms… IF the trackChangeToken isn't stale. It's almost always fine. However, **`oyo.onPlay(track)` fires synchronously at line 323 of AudioPlayer for every track change**, BUT `oyo.onSkip` / `oyo.onComplete` fire inside `nextTrack` at playerStore.ts:783-790 for the *outgoing* track — meaning the skip/complete signal captures the moment the track is advanced-away-from, which is what we want. The real bug: **the `play_start` telemetry is a `setTimeout(..., 300)` in AudioPlayer that bails via `isStale()` if the token has moved.** On rapid skip A→B→C, B's play_start is rightfully suppressed. But the "102 play_start events vs 7 stream_ended" telemetry ratio is NOT caused by this path — it's caused by fact that **every single track goes through the iframe branch first for cold tracks**, and iframe tracks never fire the audio element's `ended` event (the iframe's ENDED state is handled in YouTubeIframe.tsx, but that path advances via `nextTrack()` which does not emit `stream_ended`). See Finding #2.

**Why:** Instrumentation asymmetry: `stream_ended` is only logged from `handleEnded` on the `<audio>` element. Iframe-source completions use `nextTrack()` directly from YouTubeIframe.tsx:291, which doesn't emit `stream_ended`. R2-source completions that go through the BG watchdog at AudioPlayer.tsx:520 also call `nextTrack()` directly, not through `handleEnded`. Both paths *skip* the `stream_ended` event.

**Suggested fix:** Emit `stream_ended` from `nextTrack()` itself when the outgoing track's completionRate is ≥98%, OR explicitly emit it from the BG watchdog and the iframe ENDED watchdog. That alone will move the 7% ratio to its real value (likely 50%+). Separately, the 93% gap is not entirely a telemetry artifact — see Finding #2 for the actual auto-advance hole.

---

### 2. [P0] BG auto-advance watchdog's `el.paused` precondition is a near-impossible race on R2-source tracks

**Location:** `AudioPlayer.tsx:510-522` (the BG watchdog inside `handleTimeUpdate`).

**What's wrong:** The watchdog fires ONLY when `el.currentTime >= el.duration - 0.3` **AND** `el.paused` is true. For R2 playback in BG, the element doesn't pause at duration — it's already designed to fire `ended`. If `ended` doesn't fire (the whole reason the watchdog exists), the element typically sits at `currentTime === duration` with `paused=true` for a moment, but:
  - (a) `timeupdate` events are throttled aggressively in BG — Chrome Android drops them to sub-1Hz in deep battery save. The 0.3s duration window may never coincide with a firing `timeupdate`.
  - (b) When `timeupdate` IS firing and the element has reached end, the browser may report `paused=false` briefly before flipping to paused, depending on OS audio-focus state — and since timeupdate fires only sporadically in BG, whichever sporadic fire the watchdog sees is random.
  - (c) The only audible symptom: track ends in BG → nothing happens. User comes back, sees a frozen progress bar on the old track, MediaSession says "paused", the visibility recovery effect at line 367 tries `el.play()` but the element has `currentTime === duration`, so play() returns immediately or restarts from end (no effect).

**Why:** Old pipeline had a MessageChannel heartbeat at 4s cadence (not throttled) that detected near-duration-paused state and fired synthetic ended. That's **deleted**. The new watchdog relies on `timeupdate`, which IS throttled. BG auto-advance is effectively broken for any track where native `ended` doesn't fire — which is a meaningful fraction on Chrome Android.

**Suggested fix:** Either (a) restore an MC-based heartbeat that runs independently of `timeupdate` and checks the same condition, OR (b) rely on the YouTubeIframe ENDED watchdog at YouTubeIframe.tsx:295-318, but that only fires when the iframe is loaded AND its ENDED event reaches us — also BG-throttled. Safer: add an MC-timer started on track-change, reset on every `timeupdate`, that fires `nextTrack()` if no timeupdate arrives for `duration + 2s` since track start (wall-clock).

---

### 3. [P0] `trackSwapInProgressRef` can stick forever if canplay never fires

**Location:** `AudioPlayer.tsx:218` (set to true unconditionally on every track change), `AudioPlayer.tsx:414` (cleared only in `handleCanPlay`).

**What's wrong:** `trackSwapInProgressRef.current = true` is set synchronously at track-change start. It's cleared ONLY inside `handleCanPlay` after the new track has data ready. Paths where canplay never fires:
  - R2 HEAD said yes, but the object is 0 bytes or corrupted → `error` fires, circuit breaker eventually advances (line 692). But during the advance the flag stays true; `handleEnded` on the replacement track's canplay clears it. **Usually self-heals** IF the circuit breaker triggers.
  - R2 track is playable but `el.play()` rejects all four retries → `play_retry_exhausted` logged, flag never cleared. The element sits paused. `handlePause` at line 455 returns early because the flag is true. The store says `isPlaying=true`. User sees the play button showing "pause", no audio. No recovery.
  - Iframe path: `el.removeAttribute('src')` is called, so the element will NEVER fire `canplay` again until something reassigns src. `trackSwapInProgressRef` stays `true` for the entire duration of the iframe-source playback. That's **intentional-looking**, but it means:
    - `handlePause` at line 455-457 returns early on EVERY pause event while on iframe, hiding genuine pauses too (though handlePause at 461 also returns early for iframe source, so this overlaps defensively).
    - `handleEnded` at line 563 sets the flag again (redundantly) — fine.
    - The BG watchdog at line 512 guards on `!trackSwapInProgressRef.current`, which means **the watchdog is DISABLED the entire time we're on iframe-source**. That's possibly correct (iframe has its own ENDED watchdog) but a silent invariant.
  - If the hot-swap succeeds, canplay fires on the R2 src → flag clears → the watchdog can now fire. This means for tracks that spend a long time on iframe before hot-swapping (cold tracks), BG advance depends entirely on the iframe ENDED watchdog + the YouTubeIframe path. If BOTH the iframe (BG-throttled) and the R2 hot-swap fail, there's no watchdog.

**Why:** The flag conflates two meanings: "src just swapped, absorb transient pause" (short-lived) and "iframe is the source, audio element isn't really involved" (long-lived). These need different handling.

**Suggested fix:** Clear `trackSwapInProgressRef` on the iframe branch as soon as `el.removeAttribute('src')` + `el.pause()` settles — the audio element will not fire transient pause events after this point; subsequent pauses are actual state changes and should be honored. AND add a failsafe timeout: `setTimeout(() => { trackSwapInProgressRef.current = false; }, 8000)` inside the track-change effect so no matter what, the flag doesn't persist past 8s on an R2 track. Remove the `!trackSwapInProgressRef.current` guard from the BG watchdog since it now means the right thing.

---

### 4. [P1] Seek during R2 playback does nothing to the audio element

**Location:** `playerStore.ts:743` (`seekTo`), `AudioPlayer.tsx` (no seekPosition effect), `YouTubeIframe.tsx:492-499` (consumer).

**What's wrong:** `seekTo(time)` sets `seekPosition` + `currentTime` in the store. Only `YouTubeIframe` consumes `seekPosition` (and only when it owns playback). AudioPlayer has zero useEffect reading `seekPosition`. So when a user drags the scrubber while on R2:
  - Store reports `currentTime = 45s` (optimistic)
  - Audio element keeps playing from wherever it was (e.g., 12s)
  - UI re-reads `el.currentTime` via `handleTimeUpdate` and jerks back to the real position
  - User experiences "scrubber bounces back"

**Why:** The seek handling was lost in the VPS-rip refactor. When AudioPlayer was 3844 lines, it had a seek effect. The 707-line version does not. Iframe playback still seeks because YouTubeIframe kept its consumer. R2 playback is the dominant path, so this bug affects most sessions.

**Suggested fix:** Add a useEffect in AudioPlayer keyed on `seekPosition`: if non-null and `playbackSource === 'r2'`, set `audioRef.current.currentTime = seekPosition` then call `clearSeekPosition()`. One-liner. `prevTrack()` also uses `seekPosition: 0` to trigger a track restart (line 1077 and 1116), so this fix also repairs "Previous" behavior on R2 tracks after 3s — right now that path silently does nothing for R2.

---

### 5. [P1] Optimistic `setIsPlaying(true)` at track-change can diverge from reality

**Location:** `AudioPlayer.tsx:188-190`.

**What's wrong:** The effect sets `isPlaying=true` unconditionally as soon as `currentTrack?.trackId` changes. That's intentional (so the play/pause button flips instantly). But if the tryPlay ladder exhausts without success (`play_retry_exhausted` at line 272), the store still shows `isPlaying=true` even though audio is silent. Nothing clears it. MediaSession also reports "playing" via the effect at line 392. The only recovery is the user tapping the play button (which calls `togglePlay`, flipping to false, then tapping again).

**Why:** No fallback wiring connects tryPlay's failure back to the store. The `handlePause` absorb-transient logic at line 455 further blocks any corrective signal.

**Suggested fix:** On the `play_retry_exhausted` path, also call `setIsPlaying(false)` and surface a toast/log; OR have `handlePause` honor pause events when the element has been paused for >2s while `isPlaying=true` (i.e., if the element genuinely isn't playing a meaningful amount of time has passed, reality wins).

---

### 6. [P1] Token check inside `handlePause.el.play()` retry lets a stale previous track resurrect

**Location:** `AudioPlayer.tsx:477-484`.

**What's wrong:** `handlePause` sees an "involuntary pause" (store says isPlaying but element is paused), and calls `el.play()` to recover. No token check here. If this fires during the window after a skip (B→C), and B's audio happened to pause at that moment, `handlePause` could kick B's element back up before C's src assignment lands. The race window is narrow but real: between the `intentionalPause = true` in the iframe branch (line 296) and the eventual `el.src =` in the NEXT track change.

**Why:** The only defense against this is the `trackSwapInProgressRef` guard at line 455. That flag IS set during every track change, so in practice this is mostly safe. But on the specific sequence:
  1. Track B playing on R2 → `trackSwapInProgressRef=false`, `isPlaying=true`
  2. User skips to C. Track-change effect fires, sets flag true, schedules tryPlay for C (after fade)
  3. During the fade wait (90-180ms), B's element receives a pause event for some reason (OS focus loss, unrelated). flag IS true → handlePause returns early. **OK.**
  4. But if the pause fires AFTER the tryPlay for C succeeds and clears the flag via canplay → at that point the element is on C, which just paused for real → handlePause will try `el.play()` on C. **OK.**

Actually the race is narrower than I thought. This one is P2 at most. Demoting: **P2.**

---

### 7. [P1] `refreshRecommendations` writes `currentTrack` via `set()` — bypassing `setCurrentTrack`'s full teardown

**Location:** `playerStore.ts:1548-1555` and `1593-1602` (stage-seed paths).

**What's wrong:** On cold start, `refreshRecommendations` checks `!stateAfterMerge.currentTrack` and if there's no track, does `set({ currentTrack: seedTrack, isPlaying: false, progress: 0, currentTime: 0, seekPosition: null })`. This bypasses `setCurrentTrack`'s side effects (AbortController cancellation, history save, pool engagement, PersistedState write, portal sync). More importantly it triggers AudioPlayer's useEffect on `currentTrack.trackId` — which optimistically sets `isPlaying=true` at line 188 **despite the seed branch having explicitly set isPlaying=false**.

**Why:** Race: the `set` in the seed branch runs, then React flushes, then the effect fires, sees `!isPlaying`, calls `setIsPlaying(true)`, then tries to play a track that was explicitly seeded for "no autoplay" (browsers block first-visit autoplay). play() rejects → `play_retry_exhausted`. User sees the play icon, scrolled-to track, but taps play and... effect already ran, isPlaying=true, button tries to toggle OFF. Confusing first-visit UX.

**Suggested fix:** Either route the seed through `setCurrentTrack` (preferred — uniform side effects), or make AudioPlayer's optimistic `setIsPlaying(true)` conditional on a fresh flag like "userTriggered" carried on the track change. Simplest: check if the store's `isPlaying` is already set and only flip if so, which is what the current line 188 does (`if (!...isPlaying) setIsPlaying(true)`) — WAIT. Re-read: `if (!usePlayerStore.getState().isPlaying) usePlayerStore.getState().setIsPlaying(true)`. That's `if NOT playing, set TO playing`. This is the BUG: it flips a deliberately false value to true. The condition should be reversed or removed.

---

### 8. [P1] `nextTrack()` does NOT fire `oyo.onPlay()` for the next track — AudioPlayer does — but if trackId somehow matches current, onPlay never fires

**Location:** `playerStore.ts:787-788` (onSkip/onComplete for outgoing only), `AudioPlayer.tsx:337` (dep is `[currentTrack?.trackId]`).

**What's wrong:** AudioPlayer's effect keys on `currentTrack?.trackId`. If two consecutive tracks in the queue have the **same trackId** (can happen on a queue mis-dedup or after `prevTrack()` restarting current track), the effect does not re-fire. `oyo.onPlay` does not fire for the replay. `play_start` is not logged. The user hears the replay (because something else — `seekPosition:0` for prevTrack, or `set currentTime:0` at line 768 for repeatOne — seeks the element) but the signal graph thinks a new track started only if trackId changed.

**Why:** Dep is trackId-scoped, not reference-scoped. Deliberate (avoids spurious re-fires) but has this corner. The `repeatMode === 'one'` path at line 764 explicitly handles this by seeking — but it doesn't fire `oyo.onPlay`, so the signal graph misses the replay.

**Suggested fix:** In the repeatOne branch, call `oyo.onPlay(state.currentTrack)` explicitly. For prevTrack restart (line 1071), decide if a restart is a new "play" signal — probably yes, treat it as such.

---

### 9. [P1] `predictNextTrack` and `nextTrack` diverge the instant queue metadata changes mid-tick

**Location:** `playerStore.ts:1125-1184` vs `nextTrack` logic at `761-1065`.

**What's wrong:** Both compute "next track" independently. They agree today because filters match (`isKnownUnplayable || isBlocklisted` on both). But `predictNextTrack` only reads queue[0]. `nextTrack` also has the "queueToProcess" loop that filters **in place** (line 799) — advancing past blocked items in the queue. `predictNextTrack` does NOT mirror this — if queue[0] is blocked, it returns null even though `nextTrack` would pick queue[1]. Preload wastes a cycle on a non-match. Not severe but visible in telemetry (preload_check hit=False).

**Suggested fix:** Have `nextTrack` internally call `predictNextTrack` + "take it", single source of truth. Today they're two parallel implementations that *almost* match.

---

### 10. [P0] `handlePause`'s recovery `el.play()` has no guard against a cleared src

**Location:** `AudioPlayer.tsx:477-484`.

**What's wrong:** After the iframe-branch path at line 296 does `el.pause()` + `el.removeAttribute('src')`, the element sits with no src. If a `pause` event fires after this (from the natural pause after src removal, or later), `handlePause`'s guards check: `trackSwapInProgressRef` (true during transitions), playbackSource==='iframe' (returns early — good). But if `playbackSource` is set to `'r2'` by a subsequent hot-swap (useHotSwap sets it at line 196 AFTER `el.src = R2` and canplay), and then something pauses the element, `handlePause` hits the `el.play().catch(...)` branch — but there's a tiny window where `playbackSource='r2'` has been set but the element just started with R2 src. Usually fine. The real issue: `handlePause` reads `usePlayerStore.getState().isPlaying` — if it's still true (as it should be), play() is called. **If `el.src === ''` at that exact moment** (between removeAttribute and hot-swap's src assignment, which shouldn't coexist with `playbackSource='r2'` but could during race), play() is a no-op that logs a DOMException. Non-fatal but can log noise.

**Suggested fix:** Add `if (el.src === '') { setIsPlaying(false); return; }` to the recovery branch. Downgrade to **P2** — this is defensive hardening, not a live bug.

---

### 11. [P0] Multiple concurrent track-change IIFEs when user rapid-skips — tokens guard only mutations, not setSource

**Location:** `AudioPlayer.tsx:241-318` (the async IIFE), tokens at 225-226, setSource at 278 & 300.

**What's wrong:** The async IIFE awaits the fade timer, then checks `isStale()`, then branches. The isStale() check protects `el.src`, `tryPlay`, and `logPlaybackEvent`. But it does NOT protect the early-branch assignment pattern: specifically, on the R2 branch at line 278, `setSource('r2')` is called AFTER `el.src=` and `void tryPlay()`, but BEFORE the 300ms setTimeout's isStale() guard. If a skip happens in the 0-300ms window after setSource('r2'), the store now thinks playbackSource='r2' for a track that's already stale. The NEXT track change effect reads `playbackSource === 'r2'` at line 200 (`wasR2`), decides on a fade-out for the outgoing (stale) track, calls `softFadeOut(fadeOutMs)` — but that fades the Web Audio gain on the currently-attached element, which may be the NEW track's element (same element, but with src just reassigned). Net: the incoming track starts faded down, and if the fade-in from canplay's fadeInMasterGain doesn't perfectly cancel the outgoing ramp, the user hears a glitched volume envelope.

**Why:** `softFadeOut` uses `cancelScheduledValues` + `setValueAtTime(param.value, now)` + `linearRampToValueAtTime(0.0001)`. That's safe if the gain is mid-ramp (fadeInMasterGain uses `param.value` as start). But the timing dance relies on the next canplay firing a fadeInMasterGain BEFORE any audible output — which is usually true, but on some devices canplay lags the audible start. Rare but audible.

**Suggested fix:** Defer `setSource` into the tryPlay path — call it INSIDE `tryPlay` after the first successful `e.play()` resolves. Similarly for the iframe branch: set source AFTER the remove-src + pause settle, not before the 300ms play_start timer. This binds source-state to audible-state, not intent-state.

---

### 12. [P1] `handleCanPlay` calls `el.play()` unconditionally if `isPlaying` — double-fires with `tryPlay` from track-change

**Location:** `AudioPlayer.tsx:415-418` (handleCanPlay's play() retry), `AudioPlayer.tsx:263-276` (tryPlay ladder).

**What's wrong:** On R2 fast path, tryPlay's first attempt at d=0 races with the browser's own canplay event. Whichever wins, one of two scenarios:
  - tryPlay wins (resolve before canplay): element is playing. canplay fires → handleCanPlay sees `isPlaying=true` → calls `el.play()` again. Already-playing element ignores it (no error), but generates a `play` event, which may cascade to double-logging of `play_start` events (line 284 vs line 437's setIsPlaying).
  - canplay wins: handleCanPlay calls play(), element plays. tryPlay's d=0 resolve runs, checks `!e.paused` at line 269 and bails early. **OK.**

The visible symptom: some tracks fire two `play` events in telemetry. Not catastrophic. But `handlePlay` at line 436 calls `setIsPlaying(true)` every time, which is idempotent in the store but causes a MediaSession state refresh each time.

**Suggested fix:** Remove the `el.play()` from handleCanPlay OR remove the `d=0` initial attempt from tryPlay. One entry point to `play()` per track-change is enough.

---

### 13. [P1] `errorBurst` is a module-level mutable that survives HMR but not a real teardown

**Location:** `AudioPlayer.tsx:46` (`let errorBurst: number[] = []`).

**What's wrong:** Module-scope state means:
  - Survives React re-renders (good — the burst window needs persistence).
  - Reset to `[]` on page reload (correct).
  - Does NOT clear when `currentTrack` changes. So a track that errored twice, then is manually skipped, then the new track errors ONCE → the old bursts are still in the window → burst-count = 3 → nextTrack fires immediately on the new track despite it only having one error. Cascade potential. It's partly mitigated by `errorBurst.filter(t => now - t < ERROR_BURST_WINDOW_MS)` which trims by time, so after 10s the old bursts age out.

**Why:** Burst is meant to catch "this src is toast" not "this session is toast". A track-change should reset it.

**Suggested fix:** Reset `errorBurst = []` inside the track-change effect (near the top, when `trackSwapInProgressRef` is set true).

---

### 14. [P2] The visibility-recovery `el.play()` can fire on a track that's NOT the current one

**Location:** `AudioPlayer.tsx:367-386`.

**What's wrong:** Handler captures only `audioRef` by reference. Reads `usePlayerStore.getState().isPlaying` + `currentTrack?.trackId` fresh. But doesn't check `trackSwapInProgressRef`. If a user:
  1. Pauses in BG.
  2. In BG, taps a MediaSession next-track button.
  3. Returns to FG.
  4. Track-change effect for the NEW track fires on visibility + set-currentTrack; the async IIFE awaits the fade timer.
  5. Visibility handler fires in parallel, sees old element state (new src not yet assigned), sees `el.paused=true`, `el.readyState < 2`. Calls `el.play()` — which does nothing OR starts buffering the empty src.

**Why:** No coordination between the visibility handler and the track-change IIFE.

**Suggested fix:** Add `if (trackSwapInProgressRef.current) return;` to the visibility handler. Simple.

---

### 15. [P2] `changeToken` is monotonic across the component's lifetime — never reset. On very long sessions token could overflow

**Location:** `AudioPlayer.tsx:89`, `AudioPlayer.tsx:225`.

**What's wrong:** `trackChangeTokenRef.current = 0` at init, `++trackChangeTokenRef.current` each change. No reset. A user running 1000 tracks over multiple hours is fine — JS safe integer limit is 2^53. Flagging for completeness only.

**Suggested fix:** None needed.

---

### 16. [P1] `fadeInMasterGain(100)` default doesn't match the `nextFadeInMsRef.current` pattern for non-track-change canplays

**Location:** `AudioPlayer.tsx:409-411`.

**What's wrong:** When canplay fires from a buffer recovery (not a track change), `nextFadeInMsRef.current` is null, so fade is 100ms (default). But if a track change sets the ref to 180ms (the BG-hidden clamped fade-in), and canplay for the previous track's buffer recovery fires FIRST (before the track change has actually assigned src to the new track), the buffer-recovery canplay consumes the ref! Now when the new track's canplay fires, `nextFadeInMsRef.current` is null → it uses 100ms fade instead of the intended 180ms. Cosmetic glitch in the fade envelope.

**Why:** The ref is a "next canplay" token, not a "next-track-change canplay" token.

**Suggested fix:** Assign the fade duration by wrapping it in a small state object `{token: changeToken, ms: fadeInMs}` and only consume if the token still matches current `trackChangeTokenRef.current`. Otherwise fall back to default.

---

### 17. [P2] `completionSignaledRef` is only reset on track-change effect entry — not on `repeatOne` restart

**Location:** `AudioPlayer.tsx:177` (reset), `playerStore.ts:764-777` (repeatOne doesn't flip trackId).

**What's wrong:** `repeatMode==='one'` replays the same track by setting `currentTime:0` without changing `currentTrack.trackId`. AudioPlayer's track-change effect does NOT re-fire (trackId unchanged). `completionSignaledRef` stays `true` from the first play-through → the next play-through's 80% mark does NOT fire `oyaPlanSignal('completion')`. Taste graph misses repeat-one completions after the first.

**Suggested fix:** Subscribe to `currentTime === 0` as a reset signal, OR add a separate effect keyed on (trackId, playStartTime) that resets completionSignaledRef.

---

### 18. [P1] `setCurrentTrack`'s `currentTrackAbortController` is module-scope and global — it serializes ALL async track-change work across multiple store consumers

**Location:** `playerStore.ts:54`, `playerStore.ts:484-487`.

**What's wrong:** `currentTrackAbortController` is declared at module scope (not per-track-change). If two `setCurrentTrack` calls happen in quick succession (rare but possible — programmatic play + something else), the previous one's abort fires, canceling the previous track's `refreshRecommendations` setTimeout and video-intelligence sync. Fine. But it ALSO aborts the signal that was tied to the previous track's history-save work, which may have been fire-and-forget already. Not a bug yet, but the scope is too broad — any future async work that checks `signal.aborted` will be cancelled by the next setCurrentTrack.

**Suggested fix:** None critical. Consider per-track AbortSignal scope so future work can opt-in to the cancellation rather than inheriting it.

---

### 19. [P0] `trackSwapInProgressRef` is set at track-change start BEFORE the async IIFE awaits — but cleared only on canplay of the R2 branch. Iframe branch NEVER clears it

**Location:** `AudioPlayer.tsx:218` (set), `AudioPlayer.tsx:414` (clear in handleCanPlay), iframe branch at `AudioPlayer.tsx:292-317` (no path ever clears the flag).

**What's wrong:** Re-examining the iframe branch: the element has its src removed and is paused. It will not fire canplay. `trackSwapInProgressRef` stays true for the entire duration of the iframe-sourced playback. Implications:
  - `handlePause`'s guard at line 455 returns early for ANY pause event, hiding all pause events while on iframe. The playbackSource==='iframe' check at line 461 also returns early, which means the first guard is redundant but the second catches it. Net effect: pauses are ignored regardless. Safe for iframe.
  - The BG watchdog at line 512 guards on `!trackSwapInProgressRef.current` → watchdog disabled for all iframe-source tracks. Iframe's own ENDED watchdog at YouTubeIframe.tsx takes over. BUT if the iframe itself fails to load or its state machine stalls, there's NO fallback.
  - When the hot-swap completes, the useHotSwap sets el.src to R2, waits for canplay, fades, sets playbackSource='r2'. That canplay fires handleCanPlay → flag clears. Good.
  - But if the hot-swap aborts (hotswap_play_stalled, canplay_timeout, unrecoverable), the flag stays true forever. The iframe continues to play. BG watchdog stays disabled forever on this track. If the iframe ENDED watchdog doesn't fire (backgrounding), track stalls at end.

**Why:** The flag was bolted on for R2-src transient-pause absorption. It wasn't designed for iframe-source lifetime coverage.

**Suggested fix:** Per Finding #3, clear the flag on the iframe branch after the removeAttribute settles. The handlePause guard at line 461 (playbackSource==='iframe') is already enough to absorb spurious pauses during iframe playback.

---

### 20. [P1] `app.skip()` calls `voyoStream.skip()` → `playerStore.nextTrack()` — but rapid-skip detector fires on 3-in-10s, AND the rapid-skip handler in AudioPlayer calls `setCurrentTrack(pivot)` which in turn bumps trackChangeToken

**Location:** `voyoStream.ts:162-172`, `AudioPlayer.tsx:144-171`.

**What's wrong:** On the 3rd skip in 10s:
  1. `voyoStream.skip` fires `onRapidSkip` callback (registered by AudioPlayer).
  2. `onRapidSkip` runs `handleRapidSkip(deck)` to pick a pivot, then calls `setCurrentTrack(pivot)` + `ensureTrackReady(pivot)`.
  3. voyoStream.skip then fires `oyoPlanSignal('skip')` + `playerStore.nextTrack()` (synchronously, line 170-171).
  4. nextTrack picks a discover track and does `set({ currentTrack: discoveredTrack, ... })`.
  5. So within the same microtask: setCurrentTrack(pivot) → set(discoveredTrack). AudioPlayer's effect fires ONCE for the FINAL trackId (discoveredTrack), not pivot. The pivot's ensureTrackReady fires, but the track is never actually selected.
  6. Telemetry shows the discover track played, not the pivot. Rapid-skip's "fresh taste direction" intent is silently overridden by the default nextTrack() path.

**Why:** `voyoStream.skip()` unconditionally calls `nextTrack()` AFTER firing the rapid-skip callback, instead of letting the callback handle track selection on its own.

**Suggested fix:** In `voyoStream.skip`, early-return after `this.onRapidSkip?.()` if the callback was registered. Let the callback decide whether to advance (which it does via `setCurrentTrack(pivot)`).

---

## Top 3 fixes by impact

1. **Restore a BG auto-advance path that doesn't rely on `timeupdate` in BG** (Finding #2 + #3). This is directly responsible for the 102-play_start-vs-7-stream_ended ratio. Without it, Chrome Android BG sessions silently stall at track-end. Fix: MC-based heartbeat, OR widen the `el.paused` condition, OR trust the iframe ENDED watchdog more aggressively by also firing it when R2 is the source and the trackId hasn't changed after `duration + 3s`.

2. **Add `stream_ended` telemetry to every natural-advance path** (Finding #1). Currently only `handleEnded` (R2-source native end) emits it. Iframe END, BG watchdog, error-burst, hotswap-triggered advance all skip this log → telemetry looks like 93% silent stalls when reality is maybe 40%. Fixes observability and will recolor the entire telemetry interpretation.

3. **Clear `trackSwapInProgressRef` on the iframe branch + add a failsafe timeout** (Finding #3 + #19). The flag is stuck-true for the entire iframe-source lifetime, which silently disables the BG watchdog for every cold track. Combined with fix #1, this re-arms auto-advance for the dominant playback mode (iframe-first for uncached tracks). Also adds a one-liner seekPosition R2 fix (Finding #4) which is unrelated but in the same surface area.
