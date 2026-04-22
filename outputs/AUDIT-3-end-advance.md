# AUDIT 3 — Track-End Detection & Advance Paths

**Agent**: 3 of 6 (dimension: `nextTrack()` fire & silent-fail paths)
**Date**: 2026-04-22
**Telemetry baseline**: 102 play_start vs 7 stream_ended = 7% observed completion. Target 50-70%.

---

## TL;DR — 3 P0 findings that explain the 93% gap

1. **P0 — `stream_ended` only fires on R2/cached audio-element `ended`. Iframe-source ended events go through `YouTubeIframe.onStateChange` → `nextTrack()` directly and never emit `stream_ended`.** That's a structural telemetry hole, not a code bug — every iframe listen-through is invisible to the completion ratio. *File:* `src/components/AudioPlayer.tsx:553-571` (only site) vs `src/components/YouTubeIframe.tsx:291,316` (nextTrack called, no `stream_ended` logged).
2. **P0 — `trackSwapInProgressRef` can stick at `true` forever if `handleCanPlay` never fires for the new track.** This silently disables the BG auto-advance watchdog (`AudioPlayer.tsx:512`), the entire handlePause recovery path (`:455`), and makes the app look "paused but trying to play" on every failed-to-load next track — which is exactly the "app just stops after one song" symptom. No timeout, no reset on error, no reset on track change.  *File:* `src/components/AudioPlayer.tsx:74, 218, 414, 455-457, 512`.
3. **P0 — `nt_no_tracks` terminal path leaves `isPlaying=true` but the track never advances.** When queue is empty, repeat≠all, and discover/hot/TRACKS all filter to zero playable items, `nextTrack()` emits a trace and returns without any state change. UI still shows the same track; user thinks they're still playing; no retry, no surface-level signal. *File:* `src/store/playerStore.ts:1058-1064`.

---

## P0 Findings

### P0-1 — `stream_ended` only covers the R2/cached path; iframe ENDED bypasses it entirely

**Where:**
- `src/components/AudioPlayer.tsx:553-571` — only emit site for `stream_ended`; fires from `<audio>.onended`.
- `src/components/YouTubeIframe.tsx:267-319` — iframe ENDED handler calls `nextTrack()` but emits **zero** `stream_ended`. Only the watchdog path (`iframe_ended_watchdog_fired` trace, v397) is observable.

**Why this explains the 7% ratio:** every listen that plays entirely on iframe (R2 never landed) advances through the iframe path silently. Given `hotswap_poll_cap` exists (2-min cap before giving up on R2) and the pipeline has real extraction failures, a large fraction of plays live their whole life on iframe and exit without telemetry.

**Severity:** P0 telemetry gap; not a functional bug but it explains most of the 93%.

**Fix:** in `YouTubeIframe.tsx:291` (pre-iframe-case advance) and `:316` (r2 watchdog advance), log `stream_ended` with `source: 'iframe'` before calling `nextTrack()`. For the watchdog path, also log `stream_ended` because the track really did end. Keep `iframe_ended_watchdog_fired` as a sub-trace.

---

### P0-2 — `trackSwapInProgressRef` can stick at `true` permanently; kills BG watchdog + recovery

**Lifecycle of the ref (file `AudioPlayer.tsx`):**
- `:218`  set `true` on every track-change effect.
- `:414`  cleared `false` in `handleCanPlay` — **the only path that clears it**.
- `:563`  set `true` in `handleEnded` (v383 fix) before calling `nextTrack`.

**When does `handleCanPlay` never fire?**
- Audio element got `src = R2` but the R2 fetch 404s → `onError` fires, no `canplay`. Ref stays `true`.
- `knownInR2Sync === true` but R2 actually evicted → same result.
- Rapid A→B→C skip where B's effect sets the ref to `true`, then C's effect runs, sets the token, and B's `canplay` is pre-empted by el.src = C; canplay for B never arrives; canplay for C fires and clears — **sometimes**, but there's a race:
  - If C path enters the **iframe branch** (`else` at `:292`), el.src is cleared; no `canplay` will ever fire because the element has no media. **Ref stays `true` until the user manually picks another track that lands on R2.**
- Any iframe-source track-change (line `:292-317`): `el.removeAttribute('src')`, `setSource('iframe')`, but `trackSwapInProgressRef.current` was set to `true` at `:218` and is **never cleared** on this branch. The comment at `:414` only runs inside `handleCanPlay` which can't fire without an audio src.

**Blast radius when stuck at `true`:**
- **BG auto-advance watchdog disabled** (`:512`): the guard is `!trackSwapInProgressRef.current`. So if the ref is stuck, every BG track-end stalls forever — `bg_auto_advance_watchdog` never fires even though the track reached its natural end.
- **handlePause short-circuits** (`:455`): every pause the browser fires is swallowed → the pause icon never flips when user taps pause on a non-R2 track.
- **handleEnded still fires** (it flips the ref to true again, no harm) but because iframe-source `<audio>` has no src, 'ended' won't fire on this element anyway.

**Severity:** P0. Directly impacts the "app just stops after one track" bug that the v397 iframe watchdog was meant to cover — but on rapid-skip into iframe, even the watchdog is dead because it routes through `nextTrack()` then hits the frozen state pipeline via `setCurrentTrack`.

**Fix:**
1. Clear `trackSwapInProgressRef.current = false` at the end of the iframe branch (`AudioPlayer.tsx:317`) because the iframe owns playback and there's no canplay to wait for.
2. Add a safety timeout in the track-change effect: `setTimeout(() => { trackSwapInProgressRef.current = false; }, 5000)` so any permanent-stuck case self-heals.
3. Clear the ref in the `onError` handler (`AudioPlayer.tsx:668-702`) — if R2 fetch errored, canplay will never fire, so the ref has to unstick there.

---

### P0-3 — `nt_no_tracks` terminal stall: playback frozen, no user-visible signal

**Where:** `src/store/playerStore.ts:1058-1064`:
```ts
} else {
  trace('nt_no_tracks', currentTrackId || null, { ... });
}
```

**Preconditions to hit it:**
- Queue empty (`state.queue.length === 0`)
- `repeatMode !== 'all'` OR history is empty
- `discoverTracks`, `hotTracks`, and `TRACKS` all filter to zero after exclusion, blocklist, and last-resort fallback (which removes only `currentTrackId`).

**How realistic:** More realistic than it looks. The LAST RESORT (`:987-992`) only drops `currentTrackId`. If the ENTIRE pool equals `[currentTrack]` (very small pool early in session, or after aggressive blocklisting), this path is reached. Also reached if `allAvailable` is literally empty (`discoverTracks=[]`, `hotTracks=[]`, `TRACKS=[]` — rare but possible on first-ever load if database discovery fails).

**What the user sees:** `isPlaying` was NOT set to false. `currentTrack` unchanged. UI shows "playing" the song that just ended. Audio element is at the ended state. Nothing more happens.

**Severity:** P0 because the fallback chain's whole purpose is to never return empty — but it can, silently.

**Fix:** set `isPlaying: false` in the else branch, and fire a retry: call `get().refreshRecommendations()` then schedule a retry of `nextTrack()` 1-2 seconds later. Or at minimum: call `get().setCurrentTrack(state.currentTrack)` with `seekPosition: 0` to restart the same track so the user isn't left on a ended state.

---

## P1 Findings

### P1-1 — Double-fire risk: audio `ended` + iframe ENDED watchdog in the same 3s window

**Where:** `YouTubeIframe.tsx:295-318` (3s timeout) vs `AudioPlayer.tsx:570` (immediate).

**Scenario:** audio's `ended` fires, handleEnded sets `trackSwapInProgressRef=true`, calls `nextTrack()`. `currentTrack` changes. iframe ENDED watchdog checks `now !== trackAtEnd` at the 3s mark and bails. **Good.** But there's a narrow race:
- If `nextTrack()` picks a track where neither queue nor history advance → falls to `nt_no_tracks` (above) → `currentTrack` is NOT updated. At the 3s mark, `now === trackAtEnd`. Audio el is at `paused=true, currentTime≈duration`. Watchdog check says `audioFinished=true` → fires **second** `nextTrack()`. Second call hits the same `nt_no_tracks` path. Net effect: two no-op traces, no double-advance. But **telemetry emits two `iframe_ended_watchdog_fired`** for the same perceptual event.
- If the new track is the SAME YouTube ID (extremely rare but possible if track is in hot + queue under different object identity): `trackAtEnd === now`, audio el has been reassigned, el might be in ready state with currentTime=0 → `currentTime/duration < 0.98` → watchdog does NOT fire. Safe.

**Severity:** P1 — mostly self-healing but inflates trace count and can confuse the next debugging session.

**Fix:** add a `lastNextTrackAt` timestamp in playerStore; watchdog skips firing if `Date.now() - lastNextTrackAt < 1000`.

---

### P1-2 — `completionSignaledRef` never resets for the same track played repeatedly

**Where:** `AudioPlayer.tsx:69, 177`.
- `:177` resets to `false` on `currentTrack?.trackId` change.
- Used at `:499-505` (BG) and `:533-536` (FG) to fire `oyaPlanSignal('completion')` at 80%.

**Issue:** `repeatMode='one'` replays the same trackId. `nextTrack()` (`playerStore.ts:765-777`) returns early without calling `setCurrentTrack` — just sets isPlaying=true + resets time. The `currentTrack?.trackId` didn't change, so the useEffect at `:174` doesn't re-run, so `completionSignaledRef.current` stays `true`. **Second playthrough of the same track never fires `completion`** into OYO.

**Severity:** P1 — taste-graph silent signal loss for repeat=one users.

**Fix:** in the repeat-one branch of `nextTrack` (`playerStore.ts:765-777`), expose a callback or reset hook that clears `completionSignaledRef`. Or simpler: reset ref whenever `currentTime` drops below a threshold (`progress < 0.1` AND `completionSignaledRef.current === true`).

---

### P1-3 — Iframe ENDED handler races against iframe's own "spurious-ended-on-init" pattern

**Where:** `YouTubeIframe.tsx:268` — `if (e.data === YT_STATES.ENDED)`.

**Context:** before v397 the comment said "ENDED fires spuriously on player init/destroy." The v397 fix removed the guard that suppressed this during `playbackSource=cached|r2`. Now:
- On a track switch with iframe path, we do `player.destroy()` at `:211-212` then construct a new player at `:221`. YouTube's iframe API can fire ENDED for the destroyed player's last state — which arrives after the new player is mounted. **Watchdog fires against the wrong track.**
- Mitigated by the `trackAtEnd` / `now` comparison at `:294-297` — if currentTrack has advanced, the watchdog bails. **Safe so long as the user has manually/naturally advanced in those 3s.**
- **Still a P1:** if the spurious ENDED fires IMMEDIATELY on init of the new player (before user does anything), and audio element hasn't yet committed to canplay on the new R2 file (so it's paused at 0 duration), the `audioFinished` check passes because `audioEl.paused === true`. Then `nextTrack()` fires 3s later, skipping a track the user never heard. **Unverified but plausible.**

**Severity:** P1 pending real-world verification.

**Fix:** in the watchdog fn at `:295-318`, also check `audioEl.currentTime > 1` (i.e. the new track actually started playing) before firing. If `currentTime ≈ 0`, this is a spurious re-init ENDED, not a real end.

---

### P1-4 — Rapid-skip token (v382) doesn't cover `oyo.onPlay` fanout

**Where:** `AudioPlayer.tsx:323` — `oyo.onPlay(currentTrack)` fires **synchronously inside the track-change effect**, before any `isStale()` guard.

**Issue:** on rapid A→B→C skips, oyo.onPlay(A), oyo.onPlay(B), oyo.onPlay(C) all fire in rapid succession. The token protects el.src writes and play_start telemetry, but NOT the OYO signal fanout. Taste-graph-side: B gets a "play" signal counted even though the user never heard it. Accumulates skip-as-play noise.

**Severity:** P1 taste-graph fidelity issue, not a functional advance bug.

**Fix:** guard `oyo.onPlay` behind a 300-500ms debounce keyed to trackId (same heuristic as v382's play_start deferral).

---

### P1-5 — `onError` in AudioPlayer doesn't reset `trackSwapInProgressRef`

**Where:** `AudioPlayer.tsx:668-702`.

**Issue:** error fires → circuit breaker triggers `nextTrack()` at `:700` after 3 errors. But `trackSwapInProgressRef` was set to `true` by the previous track-change and never cleared. See P0-2 — the next track load starts with the ref already `true`, so handlePause is suppressed even during the new track's user-initiated pauses. Usually self-heals when new track's canplay fires, but if the new track ALSO errors before canplay, we're stuck permanently.

**Severity:** P1 compound failure mode, worsens P0-2.

**Fix:** in onError, always clear `trackSwapInProgressRef.current = false` before doing the advance.

---

### P1-6 — Error-code 100 path can skip a track whose R2 is already playable

**Where:** `YouTubeIframe.tsx:346-361`.

**Logic:** 500ms delayed skip, re-checks `playbackSource` at fire-time. If hot-swap landed, it bails. **Good.**

**Remaining risk:** `playbackSource` might still be `'iframe'` at the 500ms mark because the hot-swap crossfade takes 2s (HOT_SWAP_FADE_MS=2000 at `useHotSwap.ts:40`). Scenario: 450ms in, R2 HEAD succeeded, hotswap started, source not yet flipped. At 500ms, `ps === 'iframe'` → skip fires. But useHotSwap's mid-fade guard at `:171-175` doesn't check whether another advance is about to happen. Net effect: track is skipped while crossfade was mid-flight; new track's lifecycle starts; the orphaned hotswap continues writing `el.volume` on the old R2 file **of a different track**.

**Severity:** P1 narrow race but audibly bad when it hits — R2 audio bleeds into new track.

**Fix:** the 500ms delay should also check `useR2KnownStore.getState().has(trackId)` — if R2 knows about the track, defer skip by another 2s (let the hotswap finish).

---

## P2 Findings

### P2-1 — `isSkeeping`, `seekPosition`, `playbackRate` reset checklist

**Where:** `playerStore.ts`, `nextTrack` branches.

Every `set({...})` call inside nextTrack that advances a track resets:
- `playbackRate: 1`
- `isSkeeping: false`
- `seekPosition: null`

Checked branches:
- Queue pick (`:827-836`) ✓
- Repeat-all rebuild (`:919-928`) ✓
- Discover pick (`:1038-1046`) ✓
- prevTrack restart (`:1073-1081`) ✓
- prevTrack history pop (`:1088-1097`) ✓

**No bleed found.** Every advance resets these fields. Single `setCurrentTrack` (line `:500-514`) also resets them.

**However:** the `nt_no_tracks` early-exit at `:1058-1064` doesn't reset anything. If `isSkeeping=true` and next() is called when no tracks available, skeep stays active on the now-ended track — meaningless because audio isn't playing, but the UI will show the skeep indicator.

**Severity:** P2 cosmetic.

---

### P2-2 — `repeatMode='one'` fanout misses skip/complete signals

**Where:** `playerStore.ts:765-777`.

The repeat-one early-return bypasses the skip/complete signal fanout at `:783-790`. User listening on repeat for a single song gets zero OYO engagement signals per loop.

**Severity:** P2 — taste graph underweights repeat-listens.

**Fix:** still call `oyo.onComplete(state.currentTrack, 100)` before the early return.

---

### P2-3 — `predictNextTrack` and `predictUpcoming` don't consider repeat-one/repeat-all

**Where:** `playerStore.ts:1125-1184` (predictNextTrack), `:1190-1232` (predictUpcoming).

Both bypass the `repeatMode` branches that `nextTrack` uses at `:765-777` and `:889-931`. Preload caches the discover pick; user on repeat-one expects the same track — preload is wasted bandwidth. User on repeat-all + empty queue expects a history track — preload picks discover, misses.

**Severity:** P2 — wasted prefetch but doesn't break advance.

**Fix:** mirror the repeat logic in both predict helpers.

---

### P2-4 — `handleTimeUpdate` 80% completion fires at `>=0.8` boundary, but can miss on tracks <5s

**Where:** `AudioPlayer.tsx:499-505, 533-536`.

A track <5s: timeupdate events fire every 250ms-ish on the audio element. For a 3s track, you get ~12 timeupdate events — plenty to catch 0.8. Safe.

**But** the BG branch (`:499-505`) checks `elDur > 0` then uses the same threshold. For tracks with malformed duration (Infinity / 0 / NaN), the guard `dur > 0` saves us. Not a leak.

**Severity:** P2 none.

---

## Reconciling the 7% stream_ended ratio — ranked contributors

Estimated contribution to the 93% gap, most-likely to least:

1. **~60% — P0-1 telemetry structural gap.** Every iframe-source completion is invisible. Given that users spend significant time on iframe before R2 extraction catches up (telemetry shows hotswap_poll_cap traces), this alone probably accounts for the majority.
2. **~15% — User-initiated skip.** Skip via UI button / swipe / media key calls `voyoStream.skip()` → `nextTrack()` directly. No `stream_ended` emitted (which is CORRECT — skip is not "ended"). But if the denominator is `play_start` and the numerator is `stream_ended`, every skip of a track reduces the ratio. Healthy 50-70% probably assumes a skip-heavy baseline, so this is expected.
3. **~10% — P0-2 stuck ref leaving track in a stall state.** Track never ends naturally, never skips, user backgrounds app.
4. **~10% — BG tabs where throttled audio 'ended' event never fires and watchdog fires as `bg_auto_advance_watchdog` trace instead of `stream_ended`.** Telemetry hole: watchdog fires `trace` not `stream_ended`.
5. **~3% — Circuit-breaker-triggered skip (`error_burst_skip` trace).** These count play_start but not stream_ended. Correct behavior, wrong telemetry treatment.
6. **~2% — Everything else: 100/101/150 errors, rapid-skip, etc.**

---

## Recommended fix ordering

1. **P0-1 first** — add `stream_ended` emit in iframe ENDED paths (`YouTubeIframe.tsx:291` and `:316`). Largest telemetry gain, trivial code. Also emit `stream_ended` in the BG watchdog at `AudioPlayer.tsx:520` and in the circuit breaker at `:700`. This alone should jump the ratio from 7% → 40%+ overnight without any behavior change.
2. **P0-2 next** — the 3 one-line fixes (clear ref on iframe branch, onError, and 5s safety timeout). Fixes the "stops after one track" persistent bug for a class of users.
3. **P0-3 next** — `nt_no_tracks` needs a recovery path. Trigger refreshRecommendations + retry, or restart the current track, or at minimum set isPlaying=false so UI reflects reality.
4. **P1-2, P1-4** — OYO signal hygiene.
5. **P1-1, P1-3, P1-6** — rare races, ship after telemetry improvements let us see their frequency.

---

## Files referenced

- `/home/dash/voyo-music/src/components/AudioPlayer.tsx` (handleEnded:553, handlePause:450, handleCanPlay:405, BG watchdog:507, onError:668, trackSwapInProgressRef:74)
- `/home/dash/voyo-music/src/components/YouTubeIframe.tsx` (onStateChange ENDED:267, watchdog:295, onError:321)
- `/home/dash/voyo-music/src/store/playerStore.ts` (nextTrack:761, nt_no_tracks:1058, prevTrack:1067, predictNextTrack:1125, predictUpcoming:1190)
- `/home/dash/voyo-music/src/services/voyoStream.ts` (skip:162)
- `/home/dash/voyo-music/src/services/trackVerifier.ts` (isKnownUnplayable:672, markTrackAsFailed:263)
- `/home/dash/voyo-music/src/services/trackBlocklist.ts` (isBlocked:75)
- `/home/dash/voyo-music/src/player/useHotSwap.ts` (performHotSwap:54, MAX_POLL_ATTEMPTS:423)
- `/home/dash/voyo-music/src/services/telemetry.ts` (stream_ended type:31, play_start type:26)
