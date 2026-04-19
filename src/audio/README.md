# `src/audio/` — Web Audio playback chain

Scope: **playback-side DSP only.** Everything that deals with fetching or
preparing audio bytes lives in `src/services/voyoStream.ts` (VPS session
orchestration) — NOT here. See `docs/PIPELINE.md` for the full pipeline.

## What lives here

```
audio/
├── AudioErrorBoundary.tsx   React error boundary — catches render crashes
│                            in the audio player, shows a minimal fallback
│                            so the whole app doesn't white-screen.
│
└── graph/
    ├── useAudioChain.ts     The Web Audio graph. Creates AudioContext,
    │                        wires master gain → EQ → spatial → analyser.
    │                        Consumed by AudioPlayer.tsx.
    │
    ├── boostPresets.ts      EQ curves keyed by boost profile name
    │                        (normal / bass / vocal / acoustic / etc.).
    │
    ├── boostPresets.test.ts Vitest — verifies preset shape + frequencies.
    │
    └── freqPump.ts          `useFrequencyPump` — drives the frequency
                             visualizer at a bounded rAF rate.
```

## What doesn't live here (intentionally)

- **Audio fetching** — `voyoStream.ts` owns all HTTP. Read `docs/PIPELINE.md`.
- **Preloading / prefetching** — the VPS handles pre-warming the next
  track in the session queue. The browser plays ONE continuous stream.
- **Cache tiers** — `/var/cache` and R2 are VPS/edge concerns. The
  browser never touches either directly (except the single HEAD probe
  in `ensureTrackReady`).
- **Session state / SSE / skip** — all in `voyoStream.ts`.

If you're about to add audio-fetching code here, stop and check
`voyoStream.ts` first.

## History

Earlier revisions of this dir held browser-side extraction logic
(`sourceResolver`, `hotSwap`, `playbackState`, `errorRecovery`,
`bgEngine`, `usePreloadTrigger`, `preloadManager`). All removed on
2026-04-19 when the VPS-owned streaming pipeline (voyo-stream.js)
became the only audio source. If you find references in older
commits or stale docs, ignore them.
