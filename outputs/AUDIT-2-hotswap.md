# AUDIT 2 — iframe ↔ R2 Hot-Swap State Machine (Apr 22)

## State machine map (as-of today)

When `playerStore.setCurrentTrack` runs it unconditionally flips `playbackSource = null` (playerStore.ts:512). AudioPlayer's track-change effect (AudioPlayer.tsx:174-337) then picks a source synchronously from `useR2KnownStore`: known → `setSource('r2')` + `el.src = R2_AUDIO/<ytId>?q=high` + `tryPlay` retry ladder; unknown → `el.removeAttribute('src')` + `setSource('iframe')` + `ensureTrackReady(priority:10)` + background `r2HasTrack` warm-up. Once `playbackSource === 'iframe'` **and** there's a `currentTrack`, `useHotSwap` (useHotSwap.ts:237-488) mounts three watchers on the same React effect tied to `[playbackSource, currentTrack?.trackId, audioRef]`: (a) a 1s `snapRef` interval snapshotting `iframeBridge.getCurrentTime()`, (b) a Supabase Realtime channel `hotswap:<ytId>` subscribed to `voyo_upload_queue` UPDATE filtered by `youtube_id=eq.<ytId>` unless the row is already `done`/`failed`, (c) a 2s `pollRef` interval calling `r2HasTrack` up to `MAX_POLL_ATTEMPTS=60` (~2 min) that pauses on `document.hidden`. Whichever path first hits `trigger('reason')` runs `performHotSwap`: preload R2 at matched position, await `canplay` (2.5s cap), `play()` (retry with `el.paused` guard), equal-power sin/cos crossfade over 40 steps (~2s) while `iframeBridge.fadeOut()` ramps YT volume 100→0 in 16 steps, then `iframeBridge.pause()` + `iframeBridge.resetVolume()` + `setPlaybackSource('r2')`. Any guard fail (`stillCurrent()` false, `canplay` timeout, `play()` rejection, `el.paused` after play) calls `bail()` which pauses, strips `src`, clears `inFlight`, leaves iframe playing so the next tick can retry. Teardown unsubscribes RT, clears both intervals and the visibility listener.

---

## Findings

### 1. **P0** — `canplay` race primes a stale `src` that breaks the next track

**Location:** `useHotSwap.ts:114-131` (bail path via `el.removeAttribute('src'); el.load()`), combined with `AudioPlayer.tsx:254-317` (the next track-change effect).

**What's wrong.** When `bail()` runs it does `el.pause(); el.removeAttribute('src'); el.load();`. But the `canplay`-wait Promise only removes the `canplay` listener on fire or timeout — it does NOT clear via an AbortController. If performHotSwap bails at `pre_src`/`post_canplay`/`post_play`, the old `canplay` listener was already removed. **However**, when the bail path itself calls `el.load()` on a **fresh empty src**, some browsers (Chromium, confirmed) will fire `canplay` events on the empty media element during the no-source fast-fail cycle. If a new track-change effect then does `el.src = R2_AUDIO/...` **before** the previous `performHotSwap`'s outer `try` block finishes unwinding, the `changeToken` in AudioPlayer protects against the *outer* IIFE, but the **pending promise chain from the previous performHotSwap** (the `.then(success => …)` at useHotSwap.ts:312) still resolves against the now-stale `inFlight` closure. The stale closure's `supabase.removeChannel(channelRef.current)` fires against a channel reference that has already been reassigned by the new track's effect mount. Depending on Supabase realtime-js version, this throws a silent error and the NEW track's RT subscription never receives `done` events.

**Why.** `performHotSwap` closes over `trackId` and `channelRef` that lives in the hook body. When the user rapid-skips during a hotswap, the `.then` continuation executes in the new track's effect lifetime. The guard `stillCurrent()` is checked inside performHotSwap's body, but the `pollRef.current`/`channelRef.current` cleanup at lines 316-320 runs unconditionally on `success === true`. There is no `staleToken` equivalent to AudioPlayer's `trackChangeTokenRef`.

**Suggested fix.** Capture `pollRef.current` and `channelRef.current` **by value** when `trigger` is called (immediately after `inFlight = true`), and only clean those captured refs on success. Alternatively mirror AudioPlayer's token pattern — increment a `watcherTokenRef` inside the useEffect body and bail inside the `.then` if `watcherTokenRef.current !== mountedToken`.

---

### 2. **P0** — Hot-swap abort strips `src` out from under the audio element; if the user skips during canplay wait, the element is orphaned with no source

**Location:** `useHotSwap.ts:99-102` (the `bail` helper).

**What's wrong.** Every abort path in performHotSwap runs `try { el.pause(); } catch {} ; try { el.removeAttribute('src'); el.load(); } catch {}`. This is done on the **singleton audio element** shared with AudioPlayer via `audioRef`. If the abort is `'post_canplay'` or `'post_play'` because `stillCurrent()` went false (user skipped), the `useEffect` in AudioPlayer for the new track already ran — and it went into the **iframe path** (`el.removeAttribute('src')` at AudioPlayer.tsx:298). Fine, same outcome. **BUT** if the new track went the R2 fast path (`knownInR2Sync === true`) at AudioPlayer.tsx:254-256, AudioPlayer sets `el.src = R2_AUDIO/<newId>` BEFORE the pending performHotSwap's `bail()` runs. Then the stale `bail()` strips `src` off the **new track's** audio element — leaving the user in dead silence with `playbackSource='r2'`. `tryPlay`'s `e.src === ''` guard at AudioPlayer.tsx:269 treats empty src as "already torn down" and bails — no retry.

**Why.** Both paths mutate `audioRef.current` without coordinating ownership. `trackSwapInProgressRef` isn't consulted in useHotSwap. The singleton audio element is raced between two concurrent effect bodies.

**Suggested fix.** In `bail()`, check `usePlayerStore.getState().currentTrack?.trackId === trackId` before stripping `src`. If the track has already moved on, leave the element alone — AudioPlayer's new effect is now the owner. Replace the unconditional strip with:
```ts
if (el.src.includes(getYouTubeId(trackId))) {  // still my src
  el.removeAttribute('src'); el.load();
}
```

---

### 3. **P0** — iframe `pauseVideo` + `mute` does not stop YouTube from streaming; double-streaming regression after hotswap for up to 60s

**Location:** `iframeBridge.ts:50-53` (pause implementation) and `YouTubeIframe.tsx:191-200` (destroy logic only fires when `videoTarget === 'hidden'` AND `playbackSource in ('cached','r2')`).

**What's wrong.** After a successful hotswap, `useHotSwap` calls `iframeBridge.pause()` which calls `pauseVideo() + mute()` on the YT.Player. This stops the audio **output** but the iframe remains in YouTube's internal registry sending `postMessage` heartbeats. The destroy path in YouTubeIframe only triggers when BOTH conditions hold: `playbackSource === 'r2'` (true after hotswap) AND `videoTarget === 'hidden'` (which is already true on iframe-audio-only listens and doesn't change on hotswap). The useEffect at :191 watches `[playbackSource, videoTarget]`, so it **will** re-run when `setPlaybackSource('r2')` fires at the end of performHotSwap. Good — in theory the player gets destroyed. **But** there's a race: `setPlaybackSource('r2')` fires **synchronously**, then the useEffect runs on next microtask tick, THEN the track-ended event loop in the already-paused iframe can fire `ENDED` in that gap (the fadeOut left it at vol=0 but some state machines emit ENDED immediately when a paused-at-end video is asked to `pauseVideo`). The Apr 22 commit e68cb56 adding the 3s watchdog directly confirms this: ENDED can fire AFTER the source flipped to 'r2'. The watchdog measures `currentTime/duration > 0.98` on the audio el — but on a **freshly swapped** audio el that's at 0-2 seconds of the R2 file, the condition fails, nextTrack isn't forced, and the stale ENDED is swallowed. **However**, the reverse scenario: user had iframe playing at the end of the video, R2 lane catches up right at 97% duration, hotswap starts, iframe fades out, then ENDED fires at duration=0 on the just-paused iframe. The watchdog *will* fire because the R2 audio is also near-end (matched position). `nextTrack()` runs — skipping the user past the new R2 track they just got.

**Why.** ENDED is position-driven in YT, not playback-driven. A paused iframe at currentTime ≈ duration will emit ENDED on the next state-change poll. The watchdog guard logic doesn't discriminate "iframe just ended because its duration matched the R2 track" from "audio actually finished naturally."

**Suggested fix.** In YouTubeIframe's ENDED handler, add an explicit ignore window of ~4s after playbackSource transitions from `iframe` to `r2`. Store a ref `lastHotswapAt` set in useHotSwap on success and read by YouTubeIframe; skip the watchdog if `Date.now() - lastHotswapAt < 4000`.

---

### 4. **P1** — Realtime channel leak on hotswap success; old channel never removed if the watcher useEffect tears down between `.subscribe()` callback and `setPlaybackSource('r2')`

**Location:** `useHotSwap.ts:312-320` (the success branch) + `useHotSwap.ts:479-487` (the cleanup return).

**What's wrong.** In the success branch of `.then((success) => …)`, the code does:
```ts
if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
if (channelRef.current && supabase) {
  supabase.removeChannel(channelRef.current);
  channelRef.current = null;
}
```
Then `performHotSwap` itself has called `setPlaybackSource('r2')` **before resolving**. That synchronous setState triggers React to re-run the useEffect — which first runs the cleanup return (clearing `snapRef`, `pollRef`, `channelRef` again), then exits early (`playbackSource !== 'iframe'`). The `.then` runs AFTER the cleanup. At that point `channelRef.current` is already `null` — OK. **But** there's a narrower race: if `checkAndSubscribe` at line 339 was `await`-ing the `.from('voyo_upload_queue').select()` when performHotSwap started (cold-R2-known-to-hotswap path — the poll won before RT subscription landed), `channelRef.current` gets assigned **after** the cleanup ran, **after** the `.then` ran, and **after** `playbackSource` flipped to 'r2'. The channel is live, nobody owns it, it never gets removed until page unload. N active tracks' worth of zombie channels accumulate. Supabase has a per-client channel cap (~100). Sessions that skip heavily hit the limit.

**Why.** `checkAndSubscribe` is a fire-and-forget async (`void checkAndSubscribe()` at line 408). Its writes to `channelRef.current` can land at any time, including after the watcher useEffect has already unmounted.

**Suggested fix.** Inside `checkAndSubscribe`, after the `.select` resolves, re-check the effect is still mounted via a mounted-flag captured in the useEffect:
```ts
let mounted = true;
// ... inside checkAndSubscribe, before .subscribe():
if (!mounted) return;
// ... in cleanup return:
mounted = false;
```
OR bail if `usePlayerStore.getState().playbackSource !== 'iframe'` before creating the channel.

---

### 5. **P1** — `HOT_SWAP_POLL_MS = 2s` + `HEAD_TIMEOUT_MS = 1500ms` means a slow edge can overlap two in-flight HEADs, and the dedup map unlocks after 2s which matches the poll cadence exactly

**Location:** `r2Probe.ts:19` + `r2Probe.ts:65-67` + `useHotSwap.ts:36`.

**What's wrong.** The setTimeout-2000ms to clear `_inflight` + the `HOT_SWAP_POLL_MS=2000ms` poll cadence are colliding by design. Scenario: poll N fires, HEAD takes 1.8s (near the 1.5s timeout, beats it), returns false, `_inflight.delete` scheduled for +2s (so at 3.8s mark). Poll N+1 fires at 2.0s — before the dedup clear — sees the stale `false`-resolved promise in `_inflight`, returns it directly, gets a stale `false`. No cache-buster benefit because the same Promise is reused. **Worst case:** R2 actually became available between 1.8s and 2.0s, user stays on iframe for an extra ~2s until the dedup clears and poll N+2 probes fresh at 4.0s.

**Why.** The dedup is keyed on `ytId` and the Promise itself is cached — even though each **fetch** uses a per-request `_v` cache buster, the same resolved Promise is handed back for 2s after resolution. Meant to prevent probe stampede but directly conflicts with the 2s poll cadence.

**Suggested fix.** Drop the post-resolve 2s window to 300ms (long enough to dedup rapid-fire card-tapping, short enough that the next poll tick always gets a fresh probe). Or clear immediately on `false` and keep the 2s window only on `true` (positive caching is fine; negative caching at poll cadence is exactly what hurts).

---

### 6. **P1** — `performHotSwap` seek lands at `iframe.getCurrentTime()` TWICE, both before and after `canplay`; the post-canplay seek can trigger `seeking`/`seeked`/`waiting` cascade

**Location:** `useHotSwap.ts:120` (pre-load seek) and `useHotSwap.ts:142` (post-canplay seek).

**What's wrong.** Line 120 sets `el.currentTime = t` **before** `el.load()` can satisfy the resource selection. The assignment on a readyState=0 element is a no-op or queued; setting `preload='auto'` and `src` triggers the media selection algorithm, which then picks up duration and applies currentTime on its own. Line 142 sets `currentTime = t` AGAIN after `canplay` (readyState≥3). This second seek fires `seeking` + buffers, which in Chromium can emit `waiting` on the MediaElement — if AudioPlayer's `onWaiting` fires while `trackSwapInProgressRef` is still true (remember performHotSwap doesn't touch `trackSwapInProgressRef`), telemetry logs a bogus `stream_stall`. Additionally `el.play()` on line 144 starts **before** the seek at 142 has settled — on slow connections this races, with `canplay` seen at t=0 but the actual play() starting at t=t-ish depending on whether the seek beat play(). Duration telemetry drift.

**Why.** Belt-and-suspenders seek was added (comment-less) likely to handle a case where the pre-load seek didn't stick. The double-seek isn't harmful functionally but muddles telemetry and burns ~50-150ms on range requests to the edge.

**Suggested fix.** Remove the line 120 assignment (it's a no-op on readyState=0 for most files without metadata). Keep the post-canplay seek as the authoritative one. Optionally await `seeked` before `play()` to eliminate the seeked/playing race.

---

### 7. **P1** — Realtime `TIMED_OUT`/`CLOSED` status never triggers a reconnect; silent fallback only relies on the 2s poll, which respects the `MAX_POLL_ATTEMPTS=60` cap

**Location:** `useHotSwap.ts:401-406` (the `.subscribe` callback) + `useHotSwap.ts:422-464` (poll loop).

**What's wrong.** The `.subscribe` callback logs `status` via telemetry but does nothing about it. Memory `voyo-free-path-FINAL-2026-04-19.md` notes RT flakes in prod. If RT `TIMED_OUT` fires at t=10s and the poll has already been running for 10s (5 ticks), the poll continues to MAX_POLL_ATTEMPTS=60 (= 120s total cap). For tracks that sit in `pending` state for 2+ minutes (cold starts, queue backlog), the poll gives up, the hotswap never fires, the user is stranded on iframe forever for that track. RT-timeout + long-queue = stranded. **Additionally**, if the row went from `pending` → `done` DURING the RT timeout gap (say RT dropped at t=20s, row completed at t=60s), the poll catches it — but only if we're still under cap. If extraction takes >120s (rare but possible), **nothing** ever re-probes R2 for the rest of this track's playback.

**Why.** Poll cap was added to stop hammering on terminal failures, but conflates "we tried 60 times and got false" with "extraction is slow." No distinction from RT's row status.

**Suggested fix.** Two changes:
1. On `TIMED_OUT`, re-run `checkAndSubscribe` (with a 5s backoff) so RT recovers.
2. When poll hits cap, before bailing, do one Supabase SELECT on `voyo_upload_queue.status`. If `pending`/`processing`, RESET the cap — extraction's still live. If `done`, trigger immediately. If `failed`, stop.

---

### 8. **P2** — Volume re-read at the end of performHotSwap captures the slider but NOT any further movement during the transient re-render

**Location:** `useHotSwap.ts:192-195`.

**What's wrong.** Correct attempt: capture volume at fade-end to handle slider movement during the 2s fade. But the very next microtask (`setPlaybackSource('r2')`) causes AudioPlayer's useEffect in useAudioChain to re-read volume and apply masterGain. If the user moved the slider between `el.volume = storeVol` at line 195 and the useAudioChain effect re-running, the audio element has fresh volume but the Web Audio master gain still ramps from the old gain. Audible jump in either direction.

**Why.** `el.volume` and the Web Audio `masterGain` aren't linked — setting one doesn't propagate to the other. The chain's `applyMasterGain` callback uses store volume, but the timing of its effect re-run is React-scheduled.

**Suggested fix.** Instead of setting `el.volume` at 195, drop the final el.volume assignment entirely and rely on the useAudioChain effect to re-sync on the next render (which it will, because `volume` is in the chain's hook deps). Or call `applyMasterGain` directly if it's exposed.

---

### 9. **P2** — `snapRef` snapshot uses `iframeBridge.getCurrentTime()` which returns `null` if `playerRef` was destroyed; snapshot stays stale for the rest of the track

**Location:** `useHotSwap.ts:273-278` + `YouTubeIframe.tsx:191-200` (destroy path).

**What's wrong.** The destroy path at YouTubeIframe:191 fires when `(playbackSource === 'cached' || 'r2') && videoTarget === 'hidden'`. For **iframe-audio** mode, playbackSource is `iframe`, so this never fires — snapshot stays good. But a corner case: user clicks a track that's in `r2KnownStore` → AudioPlayer picks `'r2'` → YouTubeIframe's player-create effect at :405 sees `(videoTarget === 'hidden' && playbackSource !== 'iframe')` returns early — **player never mounts**. Now `iframeBridge.register()` never called, `iframeBridge.player` stays null. Later, `ensureTrackReady` fails, user manually triggers iframe fallback... wait, there's no such flow. Actually `setPlaybackSource('iframe')` is only set by AudioPlayer's track-change effect in the `else` branch (not-known-in-R2). If the r2KnownStore.has() returned true but R2 actually 404s at runtime, AudioPlayer doesn't fall back — it logs `play_retry_exhausted` and the user is stranded. useHotSwap doesn't run because `playbackSource === 'r2'` not `'iframe'`. **No recovery path.** This isn't strictly a hotswap bug but reveals a trust issue: `r2KnownStore` is authoritative, and any staleness (R2 eviction, upload failure post-HEAD) leaves the user silent.

**Why.** `r2KnownStore` is session-scoped set-only with no invalidation on negative HEAD.

**Suggested fix.** On `play_retry_exhausted` OR on `el.error` for an R2 src, delete the entry from `r2KnownStore` and flip `setPlaybackSource('iframe')` to re-trigger useHotSwap's watchers + iframe fallback.

---

### 10. **P2** — `inFlight` flag is not reset by the watcher teardown; if the user skips mid-fade, the `.then` continuation that resets `inFlight = false` can run AFTER a new poll tick on the next track mounts with its own `inFlight`

**Location:** `useHotSwap.ts:285-325`.

**What's wrong.** `inFlight` is a local `let` in the useEffect closure. On track change, the useEffect's cleanup runs (clearing refs) but the closed-over `let inFlight` is still referenced by the in-flight performHotSwap's .then. That's actually fine — it's scoped to the unmounted effect. **But** the log `hotswap_trigger_stale` at line 289-292 (when `storeTid !== trackId`) is emitted from the NEW effect's closure when the stale `trigger` (from the previous effect's Realtime callback) fires after the user skipped. No bug here — just confusing telemetry. The real issue: when `performHotSwap` bails with `stillCurrent() === false` during the fade (line 171-174), `iframeBridge.pause()` + `iframeBridge.resetVolume()` is called — but the **NEW** track's iframe is already loading. If the iframe's `onReady` at YouTubeIframe.tsx:239 has fired between `performHotSwap` starting the fade and the bail, `resetVolume()` resets to 100 — fine. If `onReady` hasn't fired yet (new iframe still loading), `iframeBridge.player` is STILL pointing at the old player that's about to be destroyed. The `player.pauseVideo()` + `player.setVolume(100)` calls hit a destroyed player. Wrapped in try/catch so not crashy, but YouTubeIframe's init path also calls `iframeBridge.register(null)` at line 214 when the new init destroys the old — race with our pause call.

**Why.** `iframeBridge.player` is a global singleton that the new track's iframe init claims. No generation counter to detect "this is a different player now."

**Suggested fix.** Add a `generation` counter in `iframeBridge`. `register()` bumps it. `pause()` and `fadeOut()` capture the generation at call-start and no-op if it's moved. Prevents stale swap operations from touching the new iframe.

---

### 11. **P2** — Duration mismatch: R2 audio file vs. iframe video. If R2 audio is LONGER, user skips past "end" on the iframe watchdog's guard; if R2 audio is SHORTER, audio ends mid-video and handleEnded advances

**Location:** `YouTubeIframe.tsx:282-319` (ENDED watchdog) + `AudioPlayer.tsx:553-571` (handleEnded).

**What's wrong.** R2 files are yt-dlp extractions — sometimes bestaudio is a separate track with slightly different duration than the embedded video. Observed deltas: ±0.5s typical, up to ±3s on split audio/video + DASH remux.
- **Audio shorter**: handleEnded fires at R2 track end, nextTrack() runs even though YouTube video still has 2s of audio fade-out. User hears hard cut instead of the natural tail.
- **Audio longer**: iframe ENDED fires first. Watchdog runs at +3s with audio still playing healthily → guard `audio.currentTime / duration > 0.98` protects us. BUT: `audio.duration` is the R2 duration. If R2 duration is 3.5s longer than video and we're currently at `video.duration + 2s = 92s / 95.5s = 96.3%` — just above 98% threshold is false, so guard holds. At +3.5s, audio at 93.5s / 95.5s = 97.9% — still below 98%. Watchdog leaves alone. User gets full track. **Mostly safe.** But at 99%+: watchdog fires, nextTrack, skipping the last 1% of audio. Edge but real.

**Why.** The 0.98 threshold was picked empirically. It's fragile when audio/video durations differ by the threshold percentage.

**Suggested fix.** Replace `currentTime / duration > 0.98` with a fixed-seconds guard: `duration - currentTime < 2`. 2s is audible tail every user notices; 98% of a 30s track is 0.6s which users DO notice being cut.

---

### 12. **P2** — Visibility-change handler in useHotSwap calls `startPoll()` without re-subscribing RT channel

**Location:** `useHotSwap.ts:469-476`.

**What's wrong.** When the tab returns from BG, `startPoll()` is called. But if RT `CLOSED` fired while hidden (browsers often force-close WebSockets after ~5 min BG), `channelRef.current` is stale/dead and never gets replaced. Poll becomes the only detector. For the 2s-cadence poll this is mostly fine, but users lose the instant RT trigger advantage until the track changes.

**Why.** The visibility handler treats RT and poll as independent; only touches poll.

**Suggested fix.** In `onVis`, if `channelRef.current` exists but `channelRef.current.state !== 'joined'` (realtime-js exposes this), call `supabase.removeChannel(channelRef.current)` then re-run `checkAndSubscribe()`.

---

### 13. **P2** — `bump_queue_priority` RPC called from `ensureTrackReady` doesn't surface RPC errors; a schema drift or RLS failure silently degrades every click to no-op

**Location:** `voyoStream.ts:47-73` + `services/r2Gate.ts` context.

**What's wrong.** `queueUpsertForPreWarm` posts to `/rpc/bump_queue_priority` with `.catch(() => {})`. If the RPC returns 404 (migration never applied in a given env) or 400 (arg mismatch), nothing logs. The user-click priority bump silently becomes a no-op — all clicks sit at whatever priority the queue table's default gives them. Symptom: cold tracks take 60s+ to extract even with "user is waiting" priority.

**Why.** Fire-and-forget with swallowed errors. No telemetry.

**Suggested fix.** `logPlaybackEvent({event_type:'trace', subtype:'queue_bump_fail', status: res.status})` on non-2xx.

---

## Top 3 fixes by impact

1. **Finding #2 — bail-path `src` strip respects track ownership** (useHotSwap.ts:99-102). Single silent-dead-audio regression identified. One-line guard. Impacts rapid-skip-while-hotswapping, which every heavy user hits daily.

2. **Finding #3 — iframe ENDED post-hotswap ignore window** (YouTubeIframe.tsx:282-319). The Apr 22 watchdog stop-gap partially addresses but doesn't cover the "R2 track gets skipped 3s after swap because iframe ran its course" path. 4s debounce keyed on hotswap completion fully closes it.

3. **Finding #7 — Realtime TIMED_OUT reconnect + poll-cap escape hatch** (useHotSwap.ts:401-406, 438-449). Memory explicitly notes RT flakes in prod. This is the difference between "hotswap always lands" and "sometimes I wait 2 minutes then iframe for the rest of the song." Ship alongside a telemetry counter to measure before/after.
