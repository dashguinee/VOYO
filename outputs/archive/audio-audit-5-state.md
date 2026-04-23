# Audio Audit 5 — State Machine Integrity

Scope: `playerStore.ts` (1726 lines) + `AudioPlayer.tsx` (3362 lines). Focus: ref lifecycles, `setIsPlaying` ordering, `currentTrack` mutation serialization, silent-WAV bridge, hot-swap/load races.

## 1. Sentinel Ref Inventory

| Ref | Set when | Cleared when | Stuck-risk |
|---|---|---|---|
| `lastTrackIdRef` | top of `loadTrack` (AP:1591) | never reset on same track | **HIGH** — if loadTrack bails before audio plays and user retaps same track, guard at AP:1590 blocks re-entry. Only cleared by switching to a *different* track. |
| `lastEndedTrackIdRef` | `onEndedDirect` (AP:2978) | start of each `loadTrack` (AP:1595) | low — but relies on loadTrack running. If loadTrack is short-circuited by `lastTrackIdRef` guard, ended dedup never resets. |
| `loadAttemptRef` | pre-inc every loadTrack (AP:1576) | never decremented | safe (monotonic counter) |
| `isLoadingTrackRef` | start of `loadTrack` (AP:1632) | on `canplaythrough`/`fadeInMasterGain` (AP:1265), `handlePlayFailure` (AP:251/281/285), effect cleanup (AP:2239), retry success (AP:1748/1765/2040) | **MEDIUM** — recovery paths (AP:3134+) never touch it. If error→cache-recovery path, isLoadingTrackRef stays whatever it was. |
| `shouldAutoResumeRef` | initial-load branch (AP:1696) | canplay handlers (AP:1814/1889/1956/2117) | low — multiple paths clear it |
| `pendingAutoResumeRef` | autoplay-blocked NotAllowedError (AP:252) | first gesture (AP:258) | low — once:true listener |
| `isEdgeStreamRef` | `source === 'edge'` in retry (AP:2064), recovery (AP:3195) | reset in loadTrack (AP:1718), hot-swap complete (AP:2404), recovery paths | **MEDIUM** — if error recovery 2 (R2) succeeds, sets false; but if recovery 3 (re-extract edge) succeeds and then track.trackId hasn't changed, this flag is correct only momentarily |
| `isTransitioningToBackgroundRef` | `visibilitychange` capture → hidden (AP:570) | visibilitychange → visible (AP:583) | **HIGH** — if visibilitychange visible event is *missed* (tab closed, OS kill), ref stays true forever and `onPause` (AP:3354) silently swallows every future pause. Could mask real pauses. |
| `hasRecordedPlayRef` | `recordPlayEvent` (AP:2250) | start of loadTrack (AP:1701) | low |
| `hotSwapAbortRef` | hot-swap effect (AP:2321) | next effect fire (AP:2318) + cleanup (AP:2425) | low |
| `hasTriggered50/75/85PercentCacheRef`, `hasTriggered30sListenRef`, `hasTriggeredContextNotifRef`, `hasTriggeredPreloadRef` | during handleTimeUpdate | reset in loadTrack | safe |

## 2. Race Condition Matrix

### (A) Rapid skip → R2 hot-swap mid-flight
- `setCurrentTrack` at PS:455 aborts `currentTrackAbortController` — **but `nextTrack` at PS:795/971/886 uses `set()` directly and does NOT touch the abort controller**. Lingering portal-sync / recordPool promises from a prior setCurrentTrack are orphaned. If a user calls `setCurrentTrack(A)` → `nextTrack()` (which picks B) → old setCurrentTrack(A)'s portal-sync closure (deferred to `requestIdleCallback`) still fires against **track B's store state**.
- Hot-swap effect (AP:2297) uses its own `hotSwapAbortRef` AND a `storeTrackId !== swapTrackId` belt (AP:2344). Safe here. But it re-reads `usePlayerStore.getState().isPlaying` at AP:2393 — if user paused between boost-complete and canplaythrough, it correctly no-ops.

### (B) Skip during load
- `loadAttemptRef` monotonic + `isStale()` in every async continuation — audited across cached (AP:1878), R2 (AP:1943), edge retry (AP:2108), hot-swap (AP:2380), error recovery (AP:3118). **Gap**: AP:2657 emergency-cache swap `oncanplaythrough` does NOT capture/check a stale guard. If buffer-emergency fires then track changes before canplaythrough, `audioRef.src` is already swapped but then a stale seekTo(savedPos) + play() mutates the new track.
- `lastTrackIdRef` guard (AP:1590) — if same track is re-selected before a different track, the second loadTrack bails. Symptom: tap track A → tap A again (user trying to restart) → nothing happens. Current protection: `lastTrackIdRef.current = null` is never called except implicitly by switching tracks.

### (C) End-during-skip
- `onEndedDirect` (AP:2974) + React `onEnded` (AP:3292) both guarded by `lastEndedTrackIdRef`. OK.
- BUT: `onEndedDirect` checks `playing === false → return` (AP:2982). If user paused exactly at natural end, neither handler advances. Fine intentionally, but `audio.ended === true` persists — next play() on that element will be a no-op until a seek happens. The play/pause effect at AP:2446 does `readyState >= 2` check but not `!audio.ended`.

### (D) Silent WAV bridge ↔ isPlaying
- When hidden + loadTrack swaps src to silent WAV (AP:1674), audio keeps *playing* the silent WAV → `onPlay` fires → AP:3310 calls `setIsPlaying(true)`. The short-circuit at AP:3315 prevents **telemetry** but **NOT the setIsPlaying call above it** (line 3310 runs BEFORE the silent-WAV check at 3315). So isPlaying will be forced true even if the store was paused mid-transition. **Bug candidate**: if user paused during a bg transition, isPlaying flips back to true when the silent WAV auto-plays.

### (E) MediaSession `play`/`pause` action
- `setActionHandler('pause')` at AP:2729: `isPlaying && togglePlay()`. If audio element is paused but store says `isPlaying: true` (loadTrack mid-flight, autoplay blocked, brief transient), OS pause tap calls togglePlay → sets `isPlaying: false`. Then the loadTrack canplaythrough arrives, checks `shouldPlay` at AP:2115 → sees false → never plays → track sits loaded but silent. User sees "playing" UI briefly flipped off by their own action; flow stalls.

### (F) localStorage persisted-state writes
- `setCurrentTime` (PS:660) dedups by `_lastPersistedSec` module-scope var. Safe single-writer.
- BUT: `setCurrentTrack`, `nextTrack`, `prevTrack`, `playTrack` all do **synchronous** `loadPersistedState()` (full `JSON.parse`) + `savePersistedState()` (full `JSON.stringify`). If two rapid track changes fire within the same tick, both read the SAME baseline and the second clobbers the first's queue/history write. PS:810 reads `state.queue` before the idle-scheduled persist fires → by the time persist runs, queue may have mutated again. Low impact (queue re-persists on next change) but consistency gap.

## 3. Top 3 Highest-Risk Races

### R1 — `isTransitioningToBackgroundRef` stuck TRUE
**Repro**: Play track. Kill the browser process (not a clean tab close). Reopen. visibilitychange "visible" handler never fired → ref is false on fresh mount so safe. **Real repro**: rapid visibility thrash (iOS Lock → unlock → lock within 100ms). The `visibilitychange` capture listener (AP:593) is re-registered per `playbackSource` change. If playbackSource flips during the window between hidden and visible (e.g., hot-swap finishing), the listener is re-attached — the visible-handler on the OLD listener is cleaned up but the flag was set by the OLD hidden-handler. Result: flag never clears → every subsequent `onPause` is swallowed → store says playing while element is paused.
**Fix**: Clear `isTransitioningToBackgroundRef.current = false` inside the cleanup of the visibility effect too, and on every `currentTrack.trackId` change.

### R2 — Silent-WAV auto-onPlay forces `isPlaying = true`
**Repro**: bg-playing → user taps OS pause → loadTrack starts swap → silent WAV src set + `play()` (AP:1677) → `onPlay` JSX handler fires → AP:3310 `setIsPlaying(true)` runs BEFORE the silent-WAV guard at AP:3315. Store flips back to playing; MediaSession widget shows playing; real audio silent.
**Fix**: Move the silent-WAV-src check ABOVE the `setIsPlaying(true)` call in the onPlay handler.

### R3 — `lastTrackIdRef` prevents same-track restart after failed load
**Repro**: Tap track A. loadTrack starts, hits `isBlocked(trackId)` at AP:1600 → `nextTrack()` → returns with `lastTrackIdRef.current === A`. nextTrack picks B. If nextTrack fails to find an available track (rare but possible: discoverTracks empty, history empty, repeatMode none), currentTrack stays A. Effect re-runs with same trackId; AP:1590 bails. Zombie state: track A visible in UI, never plays, lastTrackIdRef poisoned.
**Fix**: In the `isBlocked` / `lastTrackIdRef === trackId` bail-outs, also null out `lastTrackIdRef.current` so a genuine retry can re-enter.

## 4. Defensive Fixes (belts)

1. **Timestamp safety belt on stale guards**: add `loadStartAt = performance.now()` captured with `myAttempt`; if any async continuation resolves more than 30s later, treat as stale regardless of counter (defense against runaway promises).
2. **`isLoadingTrackRef` auto-timeout**: arm a 10s timer alongside `isLoadingTrackRef = true`; if not cleared by fadeIn/cleanup, force-clear it. Prevents onPause/applyMasterGain getting permanently silenced.
3. **`isTransitioningToBackgroundRef` auto-clear**: add `setTimeout(() => { ref = false }, 2000)` alongside the set. visibilitychange-visible transition always completes within ~1s; a 2s cap is invisible to the user but hard-stops the stuck-true case.
4. **MediaSession pause reconciliation**: before calling `togglePlay()` in the pause action handler (AP:2729), verify `audioRef.current?.paused === false` — if the element is already paused, just `setIsPlaying(false)` directly, don't fire togglePlay's side effects.
5. **Serialize track mutations**: wrap `nextTrack`/`prevTrack` in the same `currentTrackAbortController` pattern as `setCurrentTrack`. Every mutation should abort the last one's orphan promises.
6. **`ended` state reset**: in the play/pause effect (AP:2446), if `audio.ended`, call `audio.currentTime = 0` before `audio.play()` so a paused-at-natural-end track can resume.
7. **Silent-WAV onPlay hardening**: check `src === silentKeeperUrlRef.current` FIRST in onPlay, short-circuit before touching store.
8. **Emergency-cache stale guard**: capture `loadAttemptRef` at AP:2641 emergency-swap entry; check in oncanplaythrough at AP:2657 before seek+play.

---
Word count: ~800.
