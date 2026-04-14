# VOYO Client-Side Audio Chain

How the Web Audio chain in `src/components/AudioPlayer.tsx` and `src/services/audioEngine.ts` actually flows. Read this before touching anything in either file.

---

## Core principles

1. **Singleton AudioContext, singleton MediaElementAudioSourceNode**. `createMediaElementSource` can only be called ONCE per audio element — calling it twice silently breaks the chain in some browsers and crashes in others. The singleton pattern is enforced in `audioEngine.ts:connectAudioChain()`.

2. **The audio element is persistent**. It's never unmounted. The Web Audio chain stays wired through `audio.src` changes — that's by design (Web Audio API spec).

3. **`audio.volume = 1.0` at all times**. All loudness control happens via `masterGain` inside the Web Audio chain. The HTML element's `volume` is a digital jump that leaks into the source node as a click. We never touch it during playback.

4. **Click-free param writes**. Every AudioParam mutation uses the textbook DAW pattern:
   ```ts
   param.cancelScheduledValues(now);
   param.setValueAtTime(param.value, now);
   param.linearRampToValueAtTime(target, now + 0.025);
   ```
   `setTargetAtTime` is asymptotic and never reaches the target — that's the difference between "reduces clicks" and "eliminates clicks".

5. **`latencyHint: 'playback'`** on the AudioContext. Larger buffers (~256-512 samples) give the audio thread breathing room when CPU spikes. ~10ms more latency, invisible for music.

---

## Signal path (boosted preset, the default)

```
audio element
  ↓ (createMediaElementSource — ONCE)
sourceNode
  ↓
highPass (25Hz HP, kills rumble)
  ↓
multibandBypassDirect (gain=1 default)  ←─── direct path (zero phase distortion)
  ↓
multibandMix
  ↓
subBass → bass → warmth → presence → air  ←── parametric EQ shelves/peaks
  ↓
stSplitter → stDelayL/R → stMerger  ←── stereo widening (delay=0 = transparent)
  ↓
masterGain  ←── single source of truth for loudness (preset × spatial × volume)
  ↓
comp (DynamicsCompressor)
  ↓
limiter (brickwall, threshold=-0.3, ratio=8)
  ↓
spInput
  ↓
spatialBypassDirect (gain=1 default)  ←── direct path to destination
  ↓
ctx.destination
```

The **multiband chain** (3 bands × LR4 crossover + per-band gain + per-band compressor + harmonic exciter) is wired in parallel to `multibandBypassDirect` but its gain (`multibandBypassMb`) is 0 by default. **Web Audio doesn't optimize away muted-output nodes** — they keep computing on the audio thread. We accept this CPU cost as the trade-off for click-free preset switching.

The **spatial chain** (diveLP → cfSplitter → cfMerger → panner → hS → hD → hM) is wired in parallel to `spatialBypassDirect` with the same pattern. Both chains light up only on the VOYEX preset.

---

## Preset switching

`updateBoostPreset(preset)` cross-fades between the direct path and the multiband+spatial path via gain ramps:

| Preset | direct gain | mb gain | spDirect gain | spMain gain |
|--------|-------------|---------|---------------|-------------|
| `'off'` | 1 | 0 | 1 | 0 |
| `'boosted'` | 1 | 0 | 1 | 0 |
| `'calm'` | 1 | 0 | 1 | 0 |
| `'voyex'` | 0 | 1 | 0 | 1 |

The cross-fade is 25ms linear. For 'off'/'boosted'/'calm' → 'voyex' the two signals being cross-faded are different (mastered vs raw), so there's a brief 25ms morph. Imperceptible at that duration.

For 'off' specifically: there's an early-return path in `setupAudioEnhancement` (line 569) that connects `source → spInput` directly, **skipping the entire EQ + multiband chain creation**. This is the cleanest possible 'off' mode (just `source → spInput → spatialBypassDirect → destination`). **Pre-existing caveat**: if 'off' is the user's saved preset on first load, switching to 'boosted' later won't apply EQ because the chain was never created. They'd need to reload on a non-off preset to recover. Not fixed because the trade-off (forcing 'off' through 12+ nodes) hurts the raw mode quality.

---

## Track load flow (the orchestration)

```
1. currentTrack changes (Zustand store)
2. loadTrack effect fires (deps: [currentTrack?.trackId])
3. loadAttemptRef++ (cancellation token)
4. isLoadingTrackRef = true (guards onPause sync)
5. muteMasterGainInstantly() → 15ms ramp to 0.0001 + arms 6s watchdog
6. await 18ms (for the gain ramp to settle)
7. Stale guard: if a newer load started, bail
8. audio.pause() + audio.currentTime = 0
9. Resolution chain (each step has stale guard):
   a. Check preloadManager → instant playback path
   b. Check IndexedDB cache (audioEngine.getBestAudioUrl + checkCache)
   c. Check R2 collective cache (checkR2Cache)
   d. Fallback to Edge Worker stream extraction
10. setupAudioEnhancement(profile) — singleton, no-op if already done
11. audio.src = newUrl + audio.load()
12. Wait oncanplaythrough
13. fadeInMasterGain(120) — 120ms ramp + clears watchdog + clears isLoadingTrackRef
14. audio.play() → recordPlayEvent (deferred via setTimeout(0))
```

**Key guards**:
- `loadAttemptRef` — monotonic counter, captured at top of each load. `isStale()` returns true if a newer load started. Every await boundary checks. Prevents stale URLs from clobbering newer tracks during rapid skips.
- `isLoadingTrackRef` — true while loadTrack is mid-pause. The `onPause` handler skips its store sync when this is true. Without it, skips don't auto-play because the load-pause clobbers `isPlaying` to false.
- `watchdogTimerRef` — 6s timer armed by `muteMasterGainInstantly`. If `canplaythrough` never fires, force-fades masterGain back to target. Prevents the "audio loaded but silent" state.

---

## Recovery layers

| Trigger | Layer | What it does |
|---------|-------|--------------|
| `onError` | Recovery 1: local cache check | `checkCache` → swap src instantly |
| `onError` | Recovery 2: R2 collective cache | `checkR2Cache` → swap src |
| `onError` | Recovery 3: re-extract stream URL | `/stream?v=ID` from Edge Worker |
| `onError` | Recovery 4: skip to next track | Last resort |
| `onStalled` | 4s timer → call `handleAudioError` | Same 4-tier recovery |
| Watchdog | 6s timer after load mute | Force fade-in if canplaythrough never fires |

**`onWaiting`** is NOT a recovery trigger anymore — it fires on every brief rebuffer (RTT spike, slow CDN, buffer dip) and `waiting` events are noisy. Only `onStalled` (the more definitive signal) arms recovery. `onWaiting` only updates buffer health.

---

## What runs deferred (off the audio thread)

These were previously synchronous in the play() promise resolution and caused audible cracks. Now wrapped in `setTimeout(0)`:

- `recordPoolEngagement` (personalization)
- `useTrackPoolStore.getState().recordPlay` (O(n) over hot pool)
- `recordTrackInSession` (poolCurator)
- `djRecordPlay` (intelligentDJ)
- **`oyoOnTrackPlay`** → `learnFromBehavior` → `saveProfile` → `JSON.stringify` + `localStorage.setItem` (the worst offender)
- `viRegisterPlay` (videoIntelligence)

The 50% auto-boost cacheTrack is also deferred 5s and only fires if `bufferHealth > 60` AND user is still on the same track.

---

## Background cache timing

| Trigger | When | What |
|---------|------|------|
| 15% iframe retry | progress > 15% + still on iframe | Retry VPS/edge hot-swap for background playback |
| 50% auto-boost (R2 sources) | progress > 50% + 5s defer + buffer healthy | Download HIGH quality version to local cache |
| 30s flag (iframe sources) | 30s elapsed | Flag in `video_intelligence` for batch R2 download |
| 75% kept | progress > 75% | Mark track as permanent (no auto-evict) |
| 85% edge-stream cache | progress > 85% + edge source | Cache + upload to R2 for next play |

**Mid-track hot-swap is skipped if progress > 35%**. The cache is ready for next play either way; interrupting current playback for a hard cut isn't worth the audible glitch.

---

## Background playback guards (Session 12 — April 13, 2026)

The `onPause` handler in AudioPlayer.tsx has 4 guards:
1. `isLoadingTrackRef` — skip during track-load src swap
2. `audioRef.current?.ended` — skip during natural-end (ended fires after pause)
3. `document.hidden` — skip browser-initiated background pause
4. `isTransitioningToBackgroundRef` — skip pause events that fire BEFORE `visibilitychange` (some mobile browsers fire pause first → `document.hidden` is still false → isPlaying would be set to false → audio dies on return)

The background transition ref is set in a **capturing** `visibilitychange` listener (fires before all others). This ensures the flag is set before any `pause` event can check it.

YouTubeIframe time tracking interval skips updates when `document.hidden` — prevents stale/zero position data from the frozen iframe corrupting the store.

VPS streaming: R2 redirects use direct CDN URL for progressive decode (no full blob download). Direct VPS processing still uses blob (connection already active, can't restart).

### Chrome background timer throttling

Chrome throttles `setTimeout`/`setInterval` to 1 call per minute when page is hidden. Three critical paths were affected:

1. **loadTrack gain ramp wait** (`setTimeout(10)`) — 10ms becomes 60s. Fix: skip when `document.hidden` (user can't hear click-free transition anyway).
2. **Gain watchdog** (`setTimeout(6000)`) — 6s becomes 60s. Fix: parallel `MessageChannel` rescue loop (300 messages ≈ 3s, not throttled by Chrome). Only activates when backgrounded.
3. **MediaSession seek handlers** (`setTimeout(30)` for mute→fade) — 30ms becomes 60s. Fix: seek directly when `document.hidden`, no mute cycle.

**Not throttled by Chrome**: `MessageChannel`, `queueMicrotask`, `AudioParam` scheduled ramps, `fetch()`, IndexedDB, audio element playback, `canplay`/`canplaythrough` events.

---

## What NOT to touch without consultation

- The cross-fade ramp duration (25ms). Faster = audible step. Slower = noticeable morph between presets.
- The `isLoadingTrackRef` guard in `onPause`. Removing it brings back the skip auto-play bug.
- The `isTransitioningToBackgroundRef` guard in `onPause`. Removing it kills background playback on some mobile browsers.
- The `setTimeout(0)` wrapper around `recordPlayEvent`. Removing it brings back the per-track-start crack.
- The `document.hidden` guard in YouTubeIframe's time tracking interval. Removing it causes false seek positions on return from background.
- The auto-PiP removal in `useMiniPiP.ts`. Re-adding auto-enter PiP on background kills background audio — `video.play()` from a visibility handler steals audio focus even when muted.
- The `document.hidden` pause guard on Moments r2_video elements. Removing it lets video compete with main audio in background.
- The early-return path for 'off' preset. Removing it forces raw mode through 12+ nodes.
- The `latencyHint: 'playback'` on AudioContext. Switching to 'interactive' brings back audio thread underruns on weak devices.
- The `preservesPitch = false` on the audio element. Re-enabling adds an expensive resampler that runs every buffer.
- The `document.hidden` bypass on loadTrack's `setTimeout(10)`. Removing it makes background skip stall for 60 seconds.
- The `MessageChannel` backup in `armGainWatchdog`. Removing it makes background gain rescue take 60 seconds instead of 3.
- The `document.hidden` bypass on MediaSession seek handlers. Removing it makes lock screen seek stall for 60 seconds.
- The `!document.hidden` guard on `audio.pause()` in loadTrack. Removing it kills the Android media session mid-track-swap → skip stops working in background.
- The silent WAV bridge in loadTrack (background only). Removing it breaks the media session continuity during source swaps.
- The track-ID-based ended dedup (`lastEndedTrackIdRef`). Do NOT replace with `requestAnimationFrame` (frozen in background) or `queueMicrotask` (fires too fast, causes double-skip).
- The direct `addEventListener('ended')` (supplements React's `onEnded`). React's synthetic events can be stale in background — this is the reliable path.
- The `(paused || document.hidden)` check in canplay handlers. Removing the `document.hidden` part breaks background next-track — silent WAV bridge leaves `paused = false`.
- The 20s VPS timeouts. Shorter timeouts miss VPS processing time (some tracks need 15-18s).
- The VPS+edge parallel race (no VPS first-try). Sequential VPS-then-retry added 5s of dead silence waiting for VPS to respond.
- The 10s stall timer + buffer runway check. 4s was too aggressive — caused reload gaps bigger than the stall.

If a fix is needed in any of these, ask first.
