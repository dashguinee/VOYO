# `src/audio/` — VOYO Audio Pipeline

Every piece of VOYO's audio pipeline lives here, organized by concern.
The `AudioPlayer.tsx` component is now just a thin host: it renders the
`<audio>` element, wires up the modules below, and handles the load-track
orchestration. Everything else is extracted into focused modules.

**The unifying principle:** the audio element must never be idle. Every
transition (track change, skip, seek, recovery) goes through `silent WAV
bridge → real track`, never `real track → paused → new real track`. The
OS never has a window to revoke audio focus.

## Module Map

```
src/audio/
├── AudioErrorBoundary.tsx      React error boundary around AudioPlayer
├── bg/
│   ├── bgEngine.ts             Everything that happens in background
│   └── useWakeLock.ts          Screen wake lock while playing
├── sources/
│   ├── sourceResolver.ts       trackId → playable URL
│   └── usePreloadTrigger.ts    Preload upcoming tracks
├── playback/
│   ├── mediaSession.ts         OS lock screen + hardware button handlers
│   └── hotSwap.ts              Mid-track R2 → cached upgrade
├── recovery/
│   └── errorRecovery.ts        Audio error + stall recovery ladder
└── graph/
    ├── useAudioChain.ts        Web Audio graph + EQ + gain helpers
    ├── freqPump.ts             Analyser → CSS custom props for visuals
    └── boostPresets.ts         EQ/compressor preset data
```

## bg/bgEngine.ts

The single module that owns all background-playback strategy.

**What it does:**
- Generates the silent WAV blob (used as "keeper" during src swaps)
- Owns the capture-phase `visibilitychange` listener (fires before `pause`)
- Runs a `MessageChannel`-based heartbeat every ~4s (setTimeout is
  throttled to 1/min in BG; MC is not)
- Every heartbeat tick:
  1. Sends `setPositionState` to MediaSession (keeps OS session alive)
  2. Resumes `AudioContext` if suspended (Chrome Android does this for
     power save)
  3. Rescues `masterGain` if stuck <0.01 while playing
  4. Kicks `audio.play()` if element got silent-paused by OS
  5. Synthetic-ended: advances if element is paused + near duration + hidden
     (Chrome BG sometimes doesn't fire the `ended` event)
  6. Stuck-playback: advances if `currentTime` hasn't moved for 2 ticks
  7. Emits `heartbeat_tick` trace every 2 ticks (proves heartbeat is alive)
- 5s battery-save timer: suspends ctx after paused+hidden

**Exposes:** `silentKeeperUrlRef`, `isTransitioningToBackgroundRef`,
`engageSilentWav(reason, trackId?)`.

**The truth it encodes:** OS audio focus is revoked in <500ms of element
idle. Every BG bug traces to this window. Keep SOMETHING playing and
the OS never has a reason to pull focus.

## sources/sourceResolver.ts

Given a `trackId`, returns a playable URL. Single function signature:
`resolveSource({trackId, isStale, checkLocalCache, trackTitle, trackArtist})`.

**Priority order (fastest first):**
1. Preloaded blob (already decoded in `preloadManager`, instant swap)
2. Local IndexedDB blob (from prior session's download)
3. R2 collective cache (shared network cache, ~1s)
4. VPS direct stream + Edge Worker extraction — raced in parallel,
   first success wins. 3 attempts × 2s gap = 6s worst case.

All awaits honor `isStale()` so a rapid skip doesn't waste extraction on
an abandoned track. After all retries exhaust, calls `markBlocked(trackId)`.

## sources/usePreloadTrigger.ts

Fires preloads for the upcoming 2–3 tracks whenever `currentTrack`
changes. Dedup by trackId (fixes the React-effect-ordering bug where a
reset-able flag raced with the preload effect — v196 fix).

Stagger: 1.5/6/12s in FG (after decoder stabilizes). 0/2/5s in BG (first
preload immediately — setTimeout is throttled so a 1.5s delay becomes
60s and misses the next track).

## playback/mediaSession.ts

OS integration: lock-screen art/title/artist, hardware
play/pause/next/previous/seek buttons. Re-registers on every track
change; action handlers read fresh state via `usePlayerStore.getState()`
to avoid stale closures.

`nexttrack` handler has its own pre-advance silent WAV bridge (prevents
focus loss during the React reconciliation window between `nextTrack()`
and `loadTrack()`).

## playback/hotSwap.ts

When a boost download completes mid-track, upgrades from R2 (streaming)
to local IndexedDB (cached) seamlessly. Masked by `muteMasterGainInstantly`
during the src swap — click-free.

**Guards:**
- Only swaps on `r2` or (`cached` + `isEdgeStream`) — doesn't re-swap.
- Skips if >35% through the track (the 100–300ms swap gap would be audible).
- AbortController cancels in-flight swap on track change.

## recovery/errorRecovery.ts

Audio element errors (`audio_error`) and stalls (`stalled` event)
trigger a 4-level recovery ladder:

1. Local IDB cache (fastest — often ready from auto-cache)
2. R2 collective (faster than re-extracting)
3. Re-extract via Edge Worker (last resort before skip)
4. Skip to next track — **foreground only**. In BG, transient failures
   (focus revoke, network blip) resolve on return; visibility handler
   will re-kick.

**Stall timer:** 10s `setTimeout` in FG (patience for network flaps);
4s MC-based in BG (setTimeout throttled to 1/min there, would become 60s).

## graph/useAudioChain.ts

The Web Audio graph, EQ presets, and gain helpers — all packaged into one
hook. The chain:

```
source → highPass → [ multiband | direct ] → standard EQ → stereo widen →
masterGain → compressor → brickwall limiter → spatial (crossfeed, pan,
Haas, dive/immerse reverb, sub-harmonic) → destination
```

**Presets:** `off` / `boosted` / `calm` / `voyex`. The multiband is only
active on `voyex`; non-VOYEX uses a parallel direct path to avoid the
phase-smear-from-Linkwitz-Riley-crossovers that caused "muffling". Same
parallel-path technique for the spatial layer.

**Gain helpers:**
- `computeMasterTarget()` — preset × spatial compensation × volume
- `applyMasterGain()` — 25ms ramp to current target (skips during loadTrack)
- `muteMasterGainInstantly()` — 8ms fade-out + arm watchdog
- `fadeInMasterGain()` — 3ms fade-in from silence to target
- `armGainWatchdog()` / `disarmGainWatchdog()` — 6s safety net if
  `canplaythrough` never fires

Heavy VOYEX spatial nodes (convolvers with 352K math ops, 44100-sample
waveshaper) are deferred to `requestIdleCallback` so first-track startup
isn't blocked.

## graph/freqPump.ts

Reads the AnalyserNode at ~10fps, writes `--voyo-bass/mid/treble/energy`
CSS custom properties. Visual components read these via `var()` — zero
React re-renders, pure GPU-composited visuals. Delta-gated writes (>5%
change) skip style recalcs when nothing's changed.

## graph/boostPresets.ts

Pure data: the `boosted`/`calm`/`voyex` preset configurations.

## AudioErrorBoundary.tsx

React error boundary wrapping AudioPlayer. On a caught throw, logs to
telemetry and auto-remounts after 1s. Music stops briefly on a crash,
but the rest of the app (library, search, UI) survives.

---

## Data Flow

```
usePlayerStore.currentTrack changes
  ↓
AudioPlayer loadTrack useEffect fires
  ↓
sourceResolver.resolveSource(trackId)  // preload → IDB → R2 → VPS+edge
  ↓
AudioPlayer:
  setupAudioEnhancement(profile)       // from useAudioChain (idempotent)
  swapSrcSafely(url)                   // loop=false, volume=1.0, src, load
  add canplay handler
  ↓
canplay fires → play() → fadeInMasterGain(80)
  ↓
Playing.
```

## BG Transition (the thing that matters)

```
Track playing in BG
  ↓
heartbeat tick every 4s:
  - setPositionState → OS keeps session alive
  - ctx.resume() if suspended
  - gain_rescue if stuck
  ↓
At duration - 0.5s: proactive advance (handleTimeUpdate in AudioPlayer):
  - engage silent WAV bridge (element stays playing)
  - nextTrack() → store rotates
  - loadTrack runs for next track
  ↓
Next track is a blob in IDB (from usePreloadTrigger's earlier fire)
  ↓
sourceResolver returns blob URL instantly
  ↓
swapSrcSafely(blob URL) → canplay → play() → fadeInMasterGain
  ↓
Next track playing. No idle window. OS never revoked focus.
```

## The 18 Patches Preserved

Every bug fix from v167 through v206 is preserved inside these modules:

- v167 `wasSkeeping` stuck flag → handled in bgEngine visibility handler
- v171 loop-sticky preload + cached → handled in swapSrcSafely
- v172 cascade through blocked tracks → sourceResolver + cascade brake
- v173 visibility re-kick race → bgEngine's `isLoadingTrackRef` guard
- v175 handlePlayFailure BG silent bail → AudioPlayer's handlePlayFailure
- v178 handleEnded vs onEndedDirect dup → runEndedAdvance (host)
- v181 fadeInVolume rAF in BG → useAudioChain uses context-clock ramps
- v183 React onEnded null-dedup cascade → runEndedAdvance's audio.ended
  guard + synthetic bypass
- v187 R2-hit loop reset missed → swapSrcSafely
- v188 BG watchdog ticks<500 → errorRecovery + sourceResolver use
  Date.now() wall-clock
- v189 synthetic-ended → bgEngine heartbeat
- v190 stall timer throttled → errorRecovery MC-based BG timer
- v191 ctx suspended in BG → bgEngine heartbeat ctx resume
- v192 BG telemetry drops → telemetry.ts sendBeacon for BG
- v193 ended cascade dedup → runEndedAdvance uses audio.currentSrc
- v194 nextTrack random pick → playerStore non-shuffle uses [0]
- v195 predict/next filter mismatch → playerStore predictNextTrack matches
- v196 preload flag reset race → usePreloadTrigger uses trackId dedup
- v197 proactive transition → AudioPlayer handleTimeUpdate at duration-0.5s
