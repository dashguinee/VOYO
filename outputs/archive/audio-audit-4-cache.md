# Audio Audit 4 — Preload + Cache Flywheel

## Preload Mechanism Summary

**Triggered**: On every `currentTrack.trackId` change (AudioPlayer.tsx:469), via React effect. Also re-runs when `queue` changes (dep array line 547). Not on app idle, not on boot.

**What it preloads**: Up to 3 upcoming tracks (AudioPlayer.tsx:504), pulled from:
1. Queue items (first 3)
2. `predictNextTrack()` fills the remainder — but only returns ONE track (playerStore.ts:1100). So if queue is empty, only 1 track gets preloaded, not 3.

**Stagger delays**: `[1500, 6000, 12000]` ms foreground, `[0, 2000, 5000]` ms background (AudioPlayer.tsx:517).

**Source priority** (preloadManager.ts:113-272):
1. IndexedDB blob (via `downloadStore.checkCache` → `getCachedTrackUrl`)
2. R2 via `checkR2Cache(normalizedId)` — HEAD/GET on `voyo-audio` bucket
3. Edge Worker `/stream?v=` fallback — 5s combined AbortSignal

Creates hidden `<audio preload="auto" volume=0>`, waits on `canplaythrough` (timeout 5–10s; resolves anyway on timeout with partial buffer).

**Consumption** (AudioPlayer.tsx:1776-1840): On track change, `getPreloadedTrack()` returns the matching entry, ownership transferred via `consumePreloadedAudio`. The preloaded `<audio>` element is NOT reused — only its `url` is copied to the real `audioRef.src`. For blob URLs, skips `.load()` to save 30–80ms. For R2 URLs (non-blob), still calls `load()`, which refetches from R2 — **the preload's buffer is effectively wasted** because the browser re-issues the request.

## Telemetry Metrics (last ~1000 events)

| Metric | Value |
|---|---|
| play_success / play_start | 390 / 540 = **72%** (28% never succeed) |
| R2 source share of successes | 386/390 = **99%** |
| IndexedDB cache source share | 4/390 = **1%** |
| Extraction (edge/VPS) avg latency | VPS: **1872ms** (p50 1643, p90 2916, max 4194); edge: 1559ms |
| play_fail errors | `vps_timeout` 9, `not_allowed` 2 |
| skip_auto errors | `max_retries` 10, `load_watchdog` 3 |
| stall events on R2 | 5 |

`play_success` rows have **no** `latency_ms` populated — cache/preload instant-hit latency is invisible. Cannot compute preload-hit-rate from telemetry directly.

## Top 3 Fixes to Make Skip Instant

### 1. Preload re-fetches R2 URL on consumption (biggest win)
`AudioPlayer.tsx:1800` calls `audioRef.current.load()` for non-blob preloads. This discards the hidden audio element's primed buffer and reissues the R2 GET from zero. Fix: either (a) do a swap-in (replace the `<audio>` element outright, not just `.src`) or (b) when `preloaded.source === 'r2'` and readyState >=3, skip `.load()` the same way blobs do. Current code adds ~300–1500ms per skip.

### 2. `predictNextTrack` only returns 1 track
`playerStore.ts:1052-1101` returns a single `Track | null`. Upstream (`AudioPlayer.tsx:493`) only takes one and fills `upcoming` with it. For shuffle/discover sessions where queue is empty (the common case), preload pool is 1 deep, not 3. Telemetry shows 536 play_starts vs 41 `source_resolved` — most skips land on R2 (fast), but the 13 `skip_auto` / 11 `play_fail` cases are exactly when we needed a second preload candidate. Add `predictNextTracks(n: number): Track[]` returning the top-N filtered available tracks (shuffled deterministically so predict === actual).

### 3. No prewarm on app boot
No call to `preloadNextTrack` in `App.tsx` or anywhere on mount. First-track-play latency is fully cold. Telemetry confirms: the worst P90 1559–2916ms hits fire mostly on session start (VPS resolve). Fix: on `initialize()` (downloadStore.ts:148 already awaited on boot), trigger `preloadNextTrack(topDiscoverTrack.trackId, checkCache)` once hotTracks/discoverTracks are populated. Even just R2 HEAD + primed buffer cuts first play from ~2s to <200ms.

## Memory / Leak Concerns

- **`MAX_PRELOADED_TRACKS = 3`**, evicted LRU by `preloadedAt`. Correct, but `evictOldPreloads` runs only in the success path; if preload aborts early, entries are deleted in the abort branch but the abort controller deletion in `cancelPreload` only sweeps `!entry.isReady`. A zombie ready entry can survive if the aborted path was between `isReady=true` and early return — narrow window, but possible.
- `cancelPreload` fires from a dep-array cleanup on `currentTrack.trackId` change (AudioPlayer.tsx:552). This **kills in-flight preloads of the NEW current track too** if the effect re-runs. That re-cancel + re-preload cycle doubles the work on rapid skips.
- `trackAbortControllers` safety-net at size 20 (preloadManager.ts:322) is a band-aid — there's no deterministic cleanup on the success path of step-2 / step-3.

## Blocklist & Verifier Concerns

- `REFRESH_INTERVAL_MS = 30min` (trackBlocklist.ts:21) is too slow given user skip cadence. Failure-flywheel tightens much faster if refreshed every 5 min OR on every `play_fail`/`skip_auto` event locally.
- `PERMANENT_FAILURE_TTL = 24h` is aggressive — YouTube 403 from geo-fences is not permanent. Recommend splitting: geo/401 = 1h, 100/101/150 = 24h.
- `markTrackAsFailed` does NOT update the Supabase blocklist — local-only. Other users don't benefit.

## Concrete Code Fixes

1. `preloadManager.ts:465` — in `createPreloadAudioElement` set `audio.crossOrigin = 'anonymous'` so buffered bytes are reusable across the same-URL fetch.
2. `AudioPlayer.tsx:1800` — guard `load()` by `audioRef.current.readyState < 2`, not just non-blob.
3. `playerStore.ts:1052` — convert `predictNextTrack` to `predictNextTracks(n=3)`; filter blocklist/unplayable upfront.
4. `trackBlocklist.ts:21` — drop `REFRESH_INTERVAL_MS` to 5min; add `markBlocked` write-through to Supabase.
5. Add boot prewarm in `App.tsx` after hot-tracks load: call `preloadNextTrack(hotTracks[0].trackId, checkCache)`.
6. `trackVerifier.ts:58` — split `PERMANENT_FAILURE_TTL` by error code; don't cache network_error at all (already done, good).
