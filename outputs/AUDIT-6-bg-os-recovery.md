# AUDIT 6 — Background / OS integration / Crash recovery

Scope: what happens when the tab hides, OS suspends, audio-session is preempted
by a phone call, battery dies, a SW update activates, or React errors cascade.

Primary device targets called out here: Pixel 7 Chrome Android (PWA installed),
iOS Safari (no PWA beforeinstallprompt), installed WebAPK in both power modes.

---

## P0 · AudioErrorBoundary silently drops all child state on remount

**Location:** `src/audio/AudioErrorBoundary.tsx:43-54`
**Severity:** P0 — user-visible, every caught throw drops the track.

```
setTimeout(() => {
  this.setState({ hasError: false, errorKey: this.state.errorKey + 1 });
}, 1000);
...
return <div key={this.state.errorKey}>{this.props.children}</div>;
```

What the boundary does on catch:
1. Unmounts `<AudioPlayer/>` (children return null for 1s).
2. After 1s, remounts with a NEW `key` → React tears down the old mount
   entirely and creates a fresh `AudioPlayer` — new `<audio>` element,
   new `audioRef`, new refs (`trackChangeTokenRef`, `completionSignaledRef`,
   `trackSwapInProgressRef`, `stallLogTimerRef`, `nextFadeInMsRef`), new
   `useAudioChain` call, new `useHotSwap` call.

This is an unconditional state wipe on every catch. Impact chain:

- The singleton in `services/audioEngine.ts` (`_connectedElement`) still
  points at the OLD audio element. When the new AudioPlayer mounts, its
  first `connectAudioChain(newEl)` call hits the `if (_connectedElement && _connectedElement !== audio)`
  branch at `audioEngine.ts:166` — it disconnects the source node. But
  the OLD DOM element it was holding is already gone (React unmounted it),
  so the prior source node reference is dangling. On iOS this is a known
  path to `InvalidStateError: MediaElementAudioSource` because iOS tracks
  source-node-per-element internally. If the mount throws here, we loop.
- MediaSession handlers are NOT set during the 1s null window. OS
  lock-screen buttons do nothing, media keys do nothing, BT headset
  play/pause does nothing. User in-pocket with BT earbuds will think the
  app hung.
- `trackSwapInProgressRef.current` reset to false on the new mount → if
  a track change was mid-flight the stale closure / in-flight `tryPlay`
  retry ladder (`AudioPlayer.tsx:263-276`) still has a captured reference
  to the OLD `audioRef.current` (now null) and silently no-ops.
- Queue and current track survive (Zustand store is module-scoped), so
  *conceptually* state is fine — but the just-unmounted `useEffect` for
  `currentTrack?.trackId` will not re-fire on remount because the trackId
  didn't change. So the new AudioPlayer mounts with `audioRef` bound to
  an empty `<audio>` element and NO src assignment happens. Silent dead
  state until user taps play again or the track changes.
- `voyoStream.bindAudio(el)` runs again in the mount effect (line 134),
  but `endSession()` fires in the cleanup of the OLD mount — this pulls
  session state that the new mount may try to resume. Check `voyoStream.endSession()`
  for side effects on the shared singleton.

**Fix:**
1. On remount, re-trigger the track-change effect by keying on trackId
   AND a mount-generation counter, so the new mount re-runs R2 probe +
   play. E.g. use a top-level store field `audioPlayerGen` that the
   boundary's `componentDidCatch` increments, then the track-change
   effect depends on `[currentTrack?.trackId, audioPlayerGen]`.
2. Don't blank-render for 1s — render a minimal placeholder `<audio/>`
   element so MediaSession handlers (which are owned by the boundary's
   child, not by the boundary itself) at least can't dispatch to a dead
   target. Better: lift MediaSession handler registration to `App.tsx`
   where it survives AudioPlayer remounts.
3. Add a second-catch guard: if we catch twice within 3s, stop
   auto-remounting and surface a toast instead of looping.

---

## P0 · No WakeLock — tab is suspend-eligible in every mobile browser

**Location:** global (searched — zero matches for `wakeLock` across src/).
**Severity:** P0 on Android when power-save is on and the user leaves
the app open for passive listening with the screen off.

`navigator.wakeLock.request('screen')` is explicitly for screen sleep,
not what we want for audio-only background (Android keeps media sessions
alive as long as the audio element is actively playing). But:

- The audio-only "keepalive" contract in Chrome Android is: audio is
  playing AND MediaSession metadata is set AND playback state is
  `'playing'`. Lines 392-396 + 574-617 in `AudioPlayer.tsx` satisfy
  those — BUT ONLY when `currentTrack` is set AND `isPlaying` is true.
- There's a race during track change: `AudioPlayer.tsx:284-291` defers
  the `play_start` log by 300ms, and R2 src-swap fires a transient
  `'pause'` event (code handles this with `trackSwapInProgressRef`).
  But `navigator.mediaSession.playbackState` is set to `'paused'` by
  the `[isPlaying]` effect on line 394. If the element briefly goes
  `paused` during src-swap, the `playbackState` can flicker `paused →
  playing` within ~20-80ms. Chrome Android's media-focus manager has
  been observed to DROP audio focus on transient paused states when
  battery is low, which can trigger the audio-session yank path
  referenced in line 359.
- No `navigator.wakeLock.request('screen')` to keep screen awake when
  the user is actively USING the app (Classic Mode scroll-feed during
  playback, for instance) — not fatal, but missing a tier.

**Fix:**
1. Keep `mediaSession.playbackState = 'playing'` across src-swap, just
   like we keep `trackSwapInProgressRef` — don't let it flicker.
2. Optional: acquire `navigator.wakeLock.request('screen')` when
   `appMode === 'video'` or when the user is in Video Mode; release on
   exit. Not for audio-only listening.

---

## P0 · BG auto-advance watchdog only runs when `timeupdate` fires — Chrome Android pauses `timeupdate` in hidden tabs under Power Save

**Location:** `src/components/AudioPlayer.tsx:487-524` (`handleTimeUpdate`)
**Severity:** P0 — direct reproduction of "app just stops after one
track in BG" that the watchdog was meant to prevent.

The watchdog is inside `handleTimeUpdate`:
```
if (document.hidden) {
  ...
  if (elDur > 0 && el.currentTime >= elDur - 0.3 && el.paused) {
    ... nextTrack();
  }
  return;
}
```

`timeupdate` fires 4Hz when the tab is visible. When hidden:
- Chrome Android DOES keep firing `timeupdate` at ~1Hz while media is
  actively playing (because it's a native audio event, not throttled).
- BUT when the audio element has `ended` and is in the paused state,
  `timeupdate` stops firing by spec (no time is updating). The
  watchdog literally cannot fire after the track ends, because the
  ended+paused state has no time updates.
- The `ended` event itself (which would call `handleEnded` →
  `nextTrack()`) is the exact event that gets throttled/dropped by
  Chrome Android in hidden tabs per the comment on line 507-511. So
  the watchdog and the event it was meant to replace fail under the
  same condition.

Net: on Pixel 7 with Power Save ON, after the currently-playing track
ends in BG, neither `ended` nor `handleTimeUpdate`'s end-detection
will fire reliably. The app goes silent until user foregrounds.

**Fix:**
1. Use `setInterval` with a 3s cadence (NOT tied to audio events),
   persisting only while `isPlaying && document.hidden`. Interval IS
   throttled to ~1/min in BG but that's enough — we only need one
   wake-up to see `el.paused && el.currentTime >= el.duration - 0.3`.
2. Better: listen to MediaSession's `'nexttrack'` auto-advance hint
   (not every browser supports this) OR schedule a timer pinned to the
   track's remaining duration at play-start time —
   `setTimeout(() => checkAndAdvance(), (duration - currentTime) * 1000 + 2000)`.
   Even if `setTimeout` is clamped to 1/min in BG, it'll fire within
   1 minute of true track end, acceptable.
3. As a belt-and-braces: register an `ended` handler on
   `navigator.mediaSession.setActionHandler('nexttrack', ...)` which is
   already there (line 602). But that requires the OS-level UI to trigger
   it; not useful for autonomous advance.

---

## P1 · Crash counter can rack up 3 legitimate strikes on one network flake

**Location:** `src/App.tsx:85-175`
**Severity:** P1 — nuke-and-reload on an innocent transient flaw.

The counter bumps on:
- `componentDidCatch` of `AppErrorBoundary` (line 173).
- And via the cross-session preflight path (line 246-259) if boot fails
  before `markBootOk()`.

Failure modes that rack up three strikes without the user seeing the
error page in between:
1. `<Suspense>` lazy-chunk fetch throws (offline, 503, Vercel build
   mid-swap). The Suspense boundary (line 867) has no error boundary
   inside — a throw from `PortraitVOYO` import bubbles to
   `AppErrorBoundary`. User taps Reload. Network still flaky. Strike 2.
   Reload again. Strike 3 → nuke SW + caches. On a flaky network, the
   nuke reload then tries to fetch a fresh `index.html` and ALL assets
   (cache is gone) — guaranteed to fail more.
2. `FirstTimeLoader` / `UpdateButton` / `DashAuthBadge` / `UniversePanel`
   — any of these can throw on a null-safe access regression. The
   `<Safe name="DynamicIsland">` wrapper on line 1006 is the ONLY
   per-component isolation; everything else in the header is unguarded.
3. Preflight (line 246-259) does the nuke BEFORE React mounts if previous
   boot didn't set `BOOT_OK_KEY` AND crash count >= 3. But
   `sessionStorage` is per-tab — a tab-restore flow (Chrome "reopen
   closed tabs") may have partial sessionStorage. If `BOOT_OK_KEY` is
   lost but the crash counter survived (different storage semantics are
   possible on iOS Safari in particular), we'd nuke on first boot.

**Fix:**
1. Inside the Suspense tree, add an inner error boundary that catches
   chunk-load errors SPECIFICALLY and retries the import with backoff,
   NOT bumping the global crash counter. A ChunkLoadError is not an
   app crash — it's a network event.
2. Lower the window or add per-error-type classification. Errors with
   `.name === 'ChunkLoadError'` or `/loading (css )?chunk \d+ failed/i`
   message → just retry the import, don't bump. These are by far the
   most common "crash" in production PWAs.
3. Consider requiring TWO consecutive boots without `BOOT_OK_KEY` before
   the preflight nukes. One boot-fail is frequently a cold-cache +
   bad-wifi race that recovers on manual reload.

---

## P1 · MediaSession has no `seekto` / `seekforward` / `seekbackward` / `stop` handlers

**Location:** `src/components/AudioPlayer.tsx:574-617`
**Severity:** P1 — degraded OS lock-screen UX.

Registered: `play`, `pause`, `nexttrack`, `previoustrack`. Missing:
- `seekto` — the Android notification's progress bar is seekable on many
  skins; without a `seekto` handler, the UI is read-only (just shows
  position via `setPositionState` but ignores user drags).
- `seekforward` / `seekbackward` — a few BT headphones map double-tap
  to these; without handlers, OS fires default (±10s). With `preload="none"`
  and R2 as the source, default behavior *probably* works, but not
  guaranteed; explicit is safer.
- `stop` — some OSes (Android Auto) require an explicit stop handler;
  without it, the "stop" button on car head-units may not be wired.

Also: the handlers never register `setActionHandler('nexttrack', null)`
in the cleanup. When `currentTrack?.trackId` changes, the effect reruns
and overrides — that's fine — but if `currentTrack` becomes null
(shouldn't happen, but during the 1s AudioErrorBoundary null-window it
does), the OLD handlers remain wired, pointing to a stale closure that
captures the defunct mount's refs. If a BT tap fires during this window,
the handler runs against a stale `audioRef.current` which is null. It's
a no-op because of the `?.` chain but it also means the user's action
was silently dropped.

**Fix:**
1. Add `seekto` (line ~614): reads `e.seekTime`, sets
   `audioRef.current.currentTime = e.seekTime`.
2. Add `seekbackward` / `seekforward` (default ±10s if `e.seekOffset`
   missing).
3. Add `stop` handler that does the same as `pause` but also sets
   `mediaSession.playbackState = 'none'`.
4. In AudioErrorBoundary's null-render path, call
   `navigator.mediaSession.metadata = null` + unset handlers so the
   OS UI doesn't retain a dead session pointer.

---

## P1 · `handleVisibility` recovery races with `handlePause`'s auto-retry

**Location:**
- `AudioPlayer.tsx:364-389` (`handleVisibility`)
- `AudioPlayer.tsx:450-485` (`handlePause`)
- `services/audioEngine.ts:53-116` (canonical visibility handler)

**Severity:** P1 — double play() calls during BG→FG transition can cause
AbortError spam or briefly double-triggered audio ramps.

When the user unhides the tab:
1. `services/audioEngine.ts:70` fires `resumeCtx('visibilitychange')`.
2. `AudioPlayer.tsx:367` fires `handleVisibility` → if
   `el.paused && store.isPlaying` → `el.play()`.
3. If iOS was in `'interrupted'` state, `ctx.resume()` in (1) can cause
   the `<audio>` to itself resume from the user-agent side. Then (2)
   calls `.play()` again on an already-playing element. `.play()` is
   idempotent but `handlePause` (line 450) would have fired on the
   browser-side transient pause in between, and its retry path (line
   477-482) would then ALSO call `.play()` — three resume attempts in
   ~100ms.
4. Each resume attempt re-triggers `handlePlaying` → `setIsPlaying(true)`
   (no-op but wastes renders) AND can trigger `handleCanPlay` if the
   element was sub-threshold, which in turn calls `fadeInMasterGain(100)`
   — audible short volume bump.

Additionally: the `handlePause` auto-retry at line 477-482 has NO
guard against the element being mid-torn-down by AudioErrorBoundary,
mid-src-swap for the next track, or in `ended` state. `el.play()` on
an `ended` element just restarts the finished track, audible as a
"brief restart before the next one" bug.

**Fix:**
1. De-dupe the visibility handlers: either delete
   `handleVisibility` in AudioPlayer entirely (let audioEngine.ts's
   resumeCtx cover it — but that's context-only, doesn't call
   `el.play()`), OR have audioEngine.ts do the `.play()` and have
   AudioPlayer not install a duplicate listener.
2. In `handlePause` retry path, check `el.ended` and
   `trackSwapInProgressRef.current` before calling `.play()`.
3. Add a monotonic "recovery-in-progress" ref like `trackSwapInProgressRef`
   that gates any resume `.play()` call to one in-flight at a time.

---

## P1 · Force-update path in UpdateButton can nuke mid-track

**Location:** `src/App.tsx:297-340`
**Severity:** P1 — every 2 minutes, a `/version.json` `force:true` flip
tears down audio mid-track.

```
if (data.force) {
  setForceUpdate(true);
  if (document.pictureInPictureElement) { try { await document.exitPictureInPicture(); } catch {} }
  if ('caches' in window) { ... await Promise.all(keys.map(k => caches.delete(k))); }
  window.location.reload();
}
```

No check for `usePlayerStore.getState().isPlaying` or current track
position. If the user is 2:47 into a 3:00 track and the dev bumps
version.json with `force:true`, the tab reloads mid-song. The audio
element gets cut instantly, no fade, no "will resume when back"
marker.

Also: deleting ALL caches right before reload means the SW precache
hit-rate drops to 0 for the next boot. On a slow connection the user
sees a blank VoyoSplash for 3-5s, which looks like a crash.

**Fix:**
1. If `isPlaying` AND `currentTime / duration < 0.9`, DEFER the force
   update until end of current track (via `ended` listener). Store a
   `pendingForceUpdate = true` and run the reload when the current
   track ends or user pauses.
2. Log a telemetry event `force_update_deferred` with the track ID and
   remaining seconds so we can see how often this happens.
3. Don't delete `voyo-audio-v2` cache on force update — only
   `CACHE_NAME`. Audio cache is unrelated to the app build.

---

## P2 · iOS autoplay unlock has a hole on returning users

**Location:** `src/components/voyo/FirstTimeLoader.tsx:32-37, 42-67`
**Severity:** P2 — share-URL auto-load flow on iOS Safari.

`hasStoredName()` gates `FirstTimeLoader`: if `voyo-user-name` is set
in localStorage, the loader is NEVER shown, so `unlockAudio()` never
runs. `setupMobileAudioUnlock()` (line 60-68 of
`utils/mobileAudioUnlock.ts`) installs `{ once: true }` touchstart +
click listeners at document level — that covers the "user opens app,
taps something, audio unlocks."

But:
- If a returning user opens a share URL that immediately triggers
  `app.playTrack()` (e.g. `/username` profile that auto-plays a pinned
  track, or the `voyo:playTrack` event handler at `App.tsx:458-486` if
  fired by an inbound deep-link), audio is requested BEFORE any user
  gesture. iOS rejects. The track-change effect's `tryPlay` (lines
  263-276) retries with a delay ladder `[0, 120, 500, 1500]` — on iOS
  all four reject with `NotAllowedError`. We log `play_retry_exhausted`
  and the user sees a paused-looking UI with metadata filled but no
  audio.
- The user then taps play → fires `unlockHandler` → audio unlocks.
  BUT `handlePause` does NOT re-trigger the R2 src assignment since
  `trackChangeTokenRef` is unchanged and currentTrack is the same.
  So the tap hits the `mediaSession.setActionHandler('play', ...)` path
  or the custom play button → calls `audioRef.current?.play()` which
  now succeeds. OK, minor friction but works.
- Worst case: if the play button tap hits a codepath that assumes
  `.play()` always succeeds (no error catch) in a spot we didn't
  check, we log `stream_error` but the user sees nothing.

**Fix:**
1. On the `play_retry_exhausted` telemetry branch, set a store flag
   `needsGestureUnlock = true` and render a non-blocking toast/ring
   in the player UI: "Tap to start music" — so the user gets a hint.
2. Alternatively: if we detect iOS + no saved unlock, NEVER auto-play
   from a deep-link; require a tap first. Cleaner UX anyway.

---

## P2 · Battery telemetry is wired but NO consumer actually adjusts behavior

**Location:** `src/services/battery.ts:1-131`, `src/components/atmosphere/LowBatteryEffect.tsx:10-21`
**Severity:** P2 — dead code per Triangle Thinking; either do something
with low-battery or remove the monitor.

- `initBatteryMonitor()` is called from `App.tsx:442`.
- It writes telemetry traces (`battery_init`, `battery_change`).
- `useBatteryState()` is consumed ONLY by `LowBatteryEffect`, which
  renders null in all cases (explicit placeholder, line 10-21).
- No reduction of BG telemetry, no fade-out of animations, no pause
  of background precache, no reduction in `setInterval` rate when
  `criticalBattery`. The "correlate with audio" intent is satisfied
  only for post-hoc analysis.

**Fix (pick one):**
1. Actually use it: disable `trace()` for non-critical events when
   `criticalBattery`, halve `FLUSH_INTERVAL_MS` to 20s, pause
   `startPoolMaintenance`, skip `initPlan` second syncs.
2. Or: remove `LowBatteryEffect` from the tree and `initBatteryMonitor`
   call, keep only telemetry-side `getBattery()` in the event
   enrichment (single call, no subscribers). Simpler, still correlatable.

---

## P2 · `AudioContext power gate` suspend conflicts with BG auto-advance

**Location:** `src/components/AudioPlayer.tsx:344-355`
**Severity:** P2 — rare, only under long pauses before BG next-track.

```
useEffect(() => {
  if (isPlaying) return;
  const ctx = audioContextRef.current;
  if (!ctx || ctx.state !== 'running') return;
  const t = setTimeout(() => {
    ... ctx.suspend().catch(() => {});
  }, 30_000);
  ...
}, [isPlaying, audioContextRef]);
```

If the user pauses, tab goes to BG, and 30s later the suspend fires —
that's fine, saves battery. But if BG auto-advance watchdog fires
`nextTrack()` at ~30s into the BG pause (unlikely but possible via
the code at line 507-522 when pause happened right near end-of-track),
the track-change effect hits the R2 fast path, `tryPlay()` fires, and
`handleCanPlay` does `fadeInMasterGain(fadeMs)` which needs
`ctx.state === 'running'`. If the context was suspended 10ms earlier,
the fadeIn's ramp targets are queued against a suspended clock. When
the context resumes, the ramp plays back all at once → audible pop.

`useAudioChain.ts:180-181` does call `ctx.resume()` in the fade-in path,
but it's `.catch(() => {})` — if resume is async (always is), the ramp
schedule can have already fired by the time resume completes.

**Fix:**
1. Move the context-suspend timer ref outside the hook cleanup closure so
   it can be cancelled from track-change. In the track-change effect,
   cancel any pending suspend timer before starting the new track.
2. Or: in `handleCanPlay`, `await ctx.resume()` explicitly (make the
   handler async) before calling `fadeInMasterGain`.

---

## P3 · `navigator.mediaSession.setPositionState` is throttled in BG

**Location:** `src/components/AudioPlayer.tsx:542-550`
**Severity:** P3 — cosmetic only, lock-screen progress bar lags in BG.

`setPositionState` is inside `handleTimeUpdate`, and we return early
at line 496-523 when `document.hidden` before reaching 542. So the
lock-screen progress bar freezes as soon as the user backgrounds.
Not a crash, just UX.

**Fix:**
Keep calling `setPositionState` on BG timeupdates — it's cheap and is
actually meant to update the OS UI. Just skip the Zustand-side updates
(setCurrentTime / setProgress) which cause the 4Hz cascade.

---

## P3 · Service Worker `TEST_PUSH` handler in production

**Location:** `public/service-worker.js:221-226`
**Severity:** P3 — low impact, debug handler shipped to prod.

A malicious page with `navigator.serviceWorker.getRegistration()` access
(only same-origin) could `postMessage({type:'TEST_PUSH'})` to display
a fake system-level notification with "VOYO Test" branding. Not a
real attack (same-origin only), but noise. Remove before wider launch
or gate behind `self.location.hostname === 'localhost'`.

---

## P3 · Orientation unlock on boot is a dead line on Android

**Location:** `src/main.tsx:14`
**Severity:** P3 — no-op for its stated purpose on Chrome Android.

`screen.orientation.unlock()` on a non-fullscreen document throws
`NotSupportedError` on Chrome Android (and the try/catch swallows it).
The comment says "some engines throw NotSupportedError unless in
fullscreen, so we swallow." So on Android Chrome in a regular PWA
context, this line is literally zero-effect. The actual rotation
fix comes from the manifest change; the unlock() is placebo. Not
harmful. Remove with a note that the manifest change was the real fix.

---

## Summary

The BG/recovery story is well-thought-through in places (the
`trackSwapInProgressRef`, `changeToken`, sendBeacon telemetry, the
3-strike staircase) but has TWO critical load-bearing gaps:

1. **AudioErrorBoundary silently destroys audio state on any caught
   throw** with no track-resume path.
2. **BG auto-advance relies on an event the browser stops firing**
   precisely when we need it.

Plus one high-pri incident generator: the force-update path cutting
audio mid-track every time Dash pushes a `force:true` version bump.

Everything else is quality tightening.
