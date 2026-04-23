# `src/audio/` — Web Audio playback chain + background invariant

Scope: **playback-side orchestration** — the DSP chain, the BG keep-alive,
and the playback state machine. Source fetching (R2, iframe fallback,
extraction queue) lives in `src/services/voyoStream.ts` +
`src/player/useHotSwap.ts`. See `docs/PIPELINE.md` for the full flow.

## Layout

```
audio/
├── AudioErrorBoundary.tsx   React boundary — catches render crashes in
│                            AudioPlayer; null-cycles currentTrack + crash-
│                            loop guard (3 catches/5s halts auto-remount).
│
├── bg/
│   ├── bgEngine.ts          THE single module that owns every BG-
│   │                        playback mitigation. Silent-WAV keeper,
│   │                        capture-phase visibility handler, 5s
│   │                        battery-suspend timer, MessageChannel
│   │                        heartbeat (~4s, not throttled in BG) with
│   │                        synthetic-ended + stuck-playback detectors,
│   │                        gain rescue, AudioContext resume. Enforces
│   │                        the invariant: while store.isPlaying is
│   │                        true, SOMETHING is always playing through
│   │                        <audio> (real track or silent WAV keeper).
│   │                        See commentary at top of file.
│   │
│   └── useWakeLock.ts       Screen Wake Lock while isPlaying
│                            (Chrome Android + iOS 16.4+).
│
├── playback/
│   └── playbackState.ts     Explicit state machine:
│                            idle | loading | bridge | playing |
│                            paused | advancing | error. Observable
│                            via `usePlaybackState()`. Every transition
│                            emits a `state_transition` telemetry trace
│                            with `{from, to, reason, dwellMs}`.
│                            Illegal transitions silently rejected +
│                            logged as `state_illegal`.
│
└── graph/
    ├── useAudioChain.ts     Web Audio graph: AudioContext →
    │                        MediaElementAudioSourceNode → master gain
    │                        → EQ → spatial → analyser → destination.
    │                        Exposes audioContextRef, gainNodeRef,
    │                        computeMasterTarget for bgEngine.
    │
    ├── boostPresets.ts      EQ curves per boost profile.
    ├── boostPresets.test.ts Vitest.
    └── freqPump.ts          `useFrequencyPump` — rAF-bounded
                             visualizer via AnalyserNode.
```

## What lives elsewhere

- **Source resolution** (R2 probe, iframe fallback, hot-swap crossfade)
  → `src/player/useHotSwap.ts`, `src/player/r2Probe.ts`, `src/player/iframeBridge.ts`
- **Extraction queue** (bump_queue_priority, ensureTrackReady)
  → `src/services/voyoStream.ts`, `src/services/r2Gate.ts`
- **Playback lifecycle** (play/pause/skip/advance, queue management)
  → `src/store/playerStore.ts`, `src/components/AudioPlayer.tsx`

## The BG invariant

**While store.isPlaying is true, the audio element is ALWAYS playing
something** — a real track, or bgEngine's silent WAV keeper. Never idle.
The OS therefore never revokes audio focus, so BG return finds a live
session instead of a dead one requiring a user tap.

bgEngine engages the silent WAV at two bridge points:
1. In `AudioPlayer.handleEnded` before `nextTrack()` — bridges the gap
   between track A ending and track B's src landing.
2. (Future) In `AudioPlayer`'s track-change useEffect BG branch — bridges
   rapid skips while the new src is loading.

## History

- **v198** (2026-04-16): extracted `bgEngine` from `AudioPlayer.tsx`.
- **v219** (2026-04-17): restored BG playback after three BG-killing
  bugs (handlePlayFailure, canplay context-resume path, visibility
  handler capture phase). See commit `f5cfadf`.
- **2026-04-19**: bgEngine + playbackState + hotSwap removed in the
  VPS-owned streaming switch.
- **2026-04-22**: VPS streaming ripped out (commit `df8d1f2`) WITHOUT
  restoring bgEngine, leaving the client with no BG keep-alive.
- **2026-04-22 (same day, later)**: bgEngine + useWakeLock + playbackState
  restored from `1098988^` and re-wired into AudioPlayer.tsx. See commit
  `692d210`. This is the current state.

If you find references to `sourceResolver`, `errorRecovery`,
`usePreloadTrigger`, or `preloadManager` in older commits or stale docs,
those modules are gone for good — their responsibilities live in
`voyoStream.ts` + `useHotSwap.ts` + `r2Gate.ts`.
