# BG Hunt — Post-v188 Telemetry Analysis

**Date:** 2026-04-15
**Query window:** 2026-04-15T16:01:41Z → 16:31:41Z (last 30 min)
**Session found:** `voyo_mo09j5n2_0815nf` (only session in window)
**Session span:** 2026-04-15T16:26:50Z → 16:30:11Z (200.87s, 30 events)
**Device:** Android 10, Chrome 146 Mobile

---

## TL;DR — Brutal summary

1. **v188 watchdog fix is in the code** (`src/components/AudioPlayer.tsx:1826`), but **no `watchdog_fire` event was emitted in this session at all.** That's not "fix worked"; that's "the code path never ran in this test." We cannot confirm nor refute v188's fix from this trace alone — there was no watchdog-cascade pathology this time.
2. **The `ended` event NEVER fired for any track** — no `ended_fire`, no `ended_bail`, no `ended_dedup`, no `next_call from=ended_advance`. The natural end-of-track auto-advance path was never traversed.
3. **The BG track change DID happen anyway** — track rotated from `3bFPDfWReN0` → `B9H3iinXZv0` at +158.6s, with **zero telemetry explaining how the advance was dispatched.** No `next_call`, no `load_enter`, no `play_call`, no `canplay_fire`, no `source_resolved`, no `silent_wav_engage`. Just a `visibility:visible` → `stall` → `play_success` → `heartbeat_kick(element_silently_paused)` all flushed at the same moment when the user unlocked the screen.
4. **The audio element was silently paused in BG.** The `heartbeat_kick` event with `why: element_silently_paused, hidden: true` is the smoking gun: once the user's phone went back to hidden state, the OS paused the `<audio>` element, and the 4s heartbeat's recovery path had to call `el.play()` to kick it awake. This is the canonical Android "OS silent-suspend" signature.
5. **The `audio_error` 10.5s after unlock (src="") is a secondary signal**: an audio element briefly held an empty `src` — likely during the load/advance path that didn't leave its own breadcrumbs.

---

## 1) Did v188's watchdog fix land?

### Verdict: **UNVERIFIED in this session** (no watchdog events fired)

- The NEW `bg-5s` watchdog with `elapsedMs` field (`AudioPlayer.tsx:1826`) is present in source.
- In the 30-minute query window (and the 200s live session), **zero `watchdog_fire` events** were logged.
- That means: the user's BG test did not trip the load-watchdog path at all. Whatever is breaking BG auto-advance is **upstream of the watchdog** — the watchdog is defensive, meant to catch a stuck load; if the load was never attempted, the watchdog never gets the chance.

**What this implies:** v188 may have stopped the watchdog-cascade crash (prior session had 196 watchdog_fires in 50s) but revealed a more fundamental failure: **the advance path is NEVER reached in BG.** No ended → no next_call → no loadTrack → no watchdog. Silence.

---

## 2) Exact Timeline of the BG Test Session

```
[+  0.000s]  trace        sub=pause_accept         track=JQArf1e5yDM  (storeSet:false)
[+  0.000s]  play_success track=JQArf1e5yDM        src=r2             "Pop Latino 2025..."
[+  0.000s]  play_start   track=JQArf1e5yDM                           bg=false
[+  0.000s]  trace        sub=preload_check        track=JQArf1e5yDM  (hit:false)
[+  0.000s]  trace        sub=load_enter           track=JQArf1e5yDM  (hidden:false, prev:null, isPlaying:false)
[+  0.000s]  trace        sub=battery_init                            (level:82, charging:true)

[+ 16.169s]  trace        sub=play_resolved        track=3bFPDfWReN0  (path:retry_VPS, attempt:1)
[+ 16.169s]  play_success track=3bFPDfWReN0        src=r2             "Davido - KANTE"
[+ 16.169s]  trace        sub=play_call            track=3bFPDfWReN0  (path:retry_VPS, hidden:false)
[+ 16.169s]  trace        sub=canplay_fire         track=3bFPDfWReN0  (readyState:4)
[+ 16.169s]  trace        sub=canplay_await        track=3bFPDfWReN0
[+ 16.169s]  source_resolved track=3bFPDfWReN0     src=VPS  lat=2071ms
[+ 16.169s]  trace        sub=pause_guard          track=3bFPDfWReN0  (why:loading)
[+ 16.169s]  play_start   track=3bFPDfWReN0                           bg=false
[+ 16.169s]  trace        sub=preload_check        track=3bFPDfWReN0
[+ 16.169s]  trace        sub=load_enter           track=3bFPDfWReN0  (hidden:false, prev:JQArf1e5yDM, isPlaying:true)

                          ── FIRST manual advance: JQArf -> 3bFPD.  Went through the full VPS retry path.
                             'retry_VPS' means R2 failed first; VPS succeeded on attempt 1.

[+ 42.916s]  trace        sub=visibility           track=3bFPDfWReN0  state=HIDDEN   isPlaying:true
                          ── SCREEN LOCKED.  BG phase starts.

[+ 78.777s]  trace        sub=pause_accept         track=3bFPDfWReN0  (storeSet:false)
[+ 78.777s]  trace        sub=visibility           track=3bFPDfWReN0  state=VISIBLE  isPlaying:true
                          ── User briefly unlocked at +78.8s (36s of BG).

[+101.887s]  trace        sub=battery_change                          (level:83, charging:true)

[+126.893s]  trace        sub=visibility           track=3bFPDfWReN0  state=HIDDEN   isPlaying:true
                          ── SCREEN LOCKED AGAIN.  Second BG phase.

 ══════ ~32 second black hole — NOTHING logged while BG ══════
 ══════ Track SHOULD have ended (3bFPD Davido-KANTE is ~3:16) sometime in here ══════

[+158.632s]  trace        sub=visibility           track=B9H3iinXZv0  state=VISIBLE  isPlaying:true
                          ── USER UNLOCKS. Track is ALREADY B9H3iinXZv0 (Davido-Risky).
                             Advance happened silently in BG. No telemetry for it.
[+158.632s]  stall        track=B9H3iinXZv0        src=r2             (position:0)
                          ── Audio element is stalled at position 0.
[+158.632s]  play_success track=B9H3iinXZv0        src=r2             "Davido - Risky"
[+158.632s]  trace        sub=heartbeat_kick       track=B9H3iinXZv0  (why:element_silently_paused, hidden:true)
                          ── !!! heartbeat_kick with hidden=true confirms element was silent-paused in BG.

[+169.125s]  trace        sub=battery_change                          (level:83, charging:false)
[+169.125s]  trace        sub=audio_error          track=B9H3iinXZv0  (src:'', hidden:false)
                          ── audio element briefly had empty src.  Error suppressed; recovery ran.

[+180.293s]  trace        sub=battery_change                          (level:84, charging:true)
[+180.293s]  trace        sub=battery_change                          (level:83, charging:true)

[+200.869s]  trace        sub=visibility           track=B9H3iinXZv0  state=HIDDEN   isPlaying:true
                          ── User locks screen again. Session cut off by query window.
```

### Timestamp batching artifact

Events flushed at identical `created_at` were logged in-memory over a period of time and flushed together (10s batching window / 20-event buffer). `is_background` is snapshotted at `logPlaybackEvent()` call, so the flag is trustworthy per-event even though batch timestamps coalesce.

---

## 3) The specific event where BG transition died

**Between [+126.893s] `visibility:hidden` and [+158.632s] `visibility:visible`:**

- Everything we expect from a healthy auto-advance is **missing**:
  - No `ended_fire` / `ended_dedup` / `ended_bail`
  - No `silent_wav_engage` (should fire in `runEndedAdvance` at line 3164 since `document.hidden === true`)
  - No `next_call { from: 'ended_advance' }` (line 3168)
  - No `load_enter` for `B9H3iinXZv0`
  - No `play_call` / `play_resolved` / `canplay_fire` / `source_resolved`
- Yet when the user unlocked, the `currentTrack` had already rotated to `B9H3iinXZv0` and the audio was NOT playing (heartbeat_kick says paused, stall event).

**Three hypotheses, ranked:**

### H1 (most likely): The `ended` DOM event never fires in deep BG on Android 10 Chrome 146
The audio element is silently paused by the OS before playback reaches the final byte. `ended` never fires. The store's `currentTrack` rotated via some **other** path — likely the mediaSession `nexttrack` action or a timer/interval that survived BG throttling — but the audio side-effects (loadTrack → play) either didn't run or ran without emitting telemetry because **timers/microtasks were frozen during the throttle** and only flushed when visibility returned.

### H2: `runEndedAdvance` ran but ALL its traces were lost to BG telemetry dropout
`logPlaybackEvent` buffers events and flushes every 10s via `setTimeout`. In deep BG, that timeout is throttled to 1/min. If the whole advance happened AND the browser was killed / service worker reloaded before the next flush window, events could be dropped. **Against this:** `sendBeacon` on `pagehide` should catch it. Also, if the ended path had run, we'd expect the silent-WAV bridge to have kept audio alive — but the user heard silence, which is the opposite.

### H3: The store rotated the track via a non-audio path (UI/routing/hooks) but loadTrack never executed
Something in the store or an effect ran `nextTrack()` without going through `runEndedAdvance`. The `currentTrack` state updated, but the audio element was left on the old src (paused, then the src got blanked somewhere → the `audio_error src=""` at +169s is a downstream symptom). The `play_success` at +158s looks like it was only emitted when the user returned to visible state and something forced a play — **note `play_success` without a preceding `play_call` / `play_start`**, which is structurally impossible in the normal flow.

**My bet:** H1 is dominant, and the recovery-on-visible path is the heartbeat kicking the element after src had been swapped to `B9H3iinXZv0` by a path that doesn't trace. Result: user sees the next track in the UI, but sound is silent until they unlock.

---

## 4) New failure modes v188 may have introduced

Based on this single trace, **v188 did not introduce new pathology**; it appears to have silenced the watchdog cascade without fixing the real BG-advance issue. BUT we observe one new, suspicious fingerprint:

- `play_success` at +158.6s with `is_background: true` — this is logged inside the play resolution path. For this to fire, `el.play()` must have resolved successfully on the B9H3 track. Yet the `stall` event fires at the same moment with `position: 0`, meaning the element is at position 0 and not buffered. Either:
  - The play promise resolved because the element was playing the **silent WAV bridge** (which explains the `stall` because the silent WAV is only a second long and loops) — but then no `silent_wav_engage` telemetry exists.
  - Or play() resolved but the audio pipeline is still frozen (silent-suspend).
- `audio_error` at +169s with `src=''` — this is a **new** recoverable error. Line 3242's handler logs it with the src truncated; an empty string means an audio element was asked to play with no src attached. This happens if:
  - `loadTrack` was interrupted between clearing the old src and setting the new one (very narrow race).
  - A cleanup path blanked src while another path tried to play it.
- **No `silent_wav_engage` from line 3164 despite `document.hidden === true` at the ended moment** — strong evidence that `runEndedAdvance` never ran. That's our big missing piece.

---

## 5) Top suspects for what's STILL broken

### Suspect A (PRIMARY): The `ended` DOM event is not firing for BG track completion on this device
- **Evidence:** zero `ended_fire` events in a session that clearly finished at least one track (3bFPD → B9H3).
- **Mechanism:** Android Chrome aggressively suspends the audio element when the PWA is hidden + lockscreen, especially on Android 10. The element never reaches `duration` because decoding is paused. Tracks "end" only when the user brings the tab back, at which point the element is in a weird half-state.
- **Fix direction:** Don't rely on `ended` in BG. Add a `timeupdate`-driven progress monitor that fires a synthetic "track-ended" event when `currentTime >= duration - 0.3s` (many PWAs do this exactly for Android). Gate it on `isPlaying && !document.hidden || isPlaying && heartbeat seeing progress`. Or better: let the mediaSession `nexttrack` action be the source of truth in BG and have the heartbeat poll for "element is paused with src but store says playing and currentTime near duration."

### Suspect B (SECONDARY): The heartbeat is treating silent-suspension as recoverable, but it's not recovering
- **Evidence:** `heartbeat_kick { why: element_silently_paused, hidden: true }` fires, and the `el.play()` in the same block resolves successfully (hence `play_success` on B9H3iinXZv0), **but the actual audio output remains silent until the user unlocks.**
- **Mechanism:** When Android silent-suspends, even a successful `play()` call doesn't unsuspend the audio focus. The PlaybackSession is gone; the browser re-creates the element's playback state but not the OS-level audio route.
- **Fix direction:** When the heartbeat detects `el.paused && hidden && isPlaying`, don't just kick `play()`. Also: (1) bump the silent WAV as a "primer" before the real src, (2) rearm mediaSession metadata, (3) log whether `el.paused` is still true 500ms after the kick (follow-up telemetry to confirm the kick actually unsuspended).

### Suspect C (TERTIARY): Telemetry buffer drops events in deep BG
- **Evidence:** huge 32-second gap between `visibility:hidden @ 126s` and `visibility:visible @ 158s`. No battery_change, no heartbeat, no progress events in that window. The `setTimeout`-based flush is likely throttled to 1/min in this state.
- **Mechanism:** `flushTimer` set via `setTimeout(..., FLUSH_INTERVAL_MS)` gets scheduled at normal rate when the page is visible, but Android + Chrome + lockscreen pushes that to ~60s. Events fire, go into buffer, and wait.
- **Fix direction:** Use a MessageChannel-based heartbeat (you already have one for mediaSession) to also trigger `flush()` every 4s regardless of BG state. Or pipe each telemetry event through `navigator.sendBeacon` directly when `document.hidden === true` to bypass buffering entirely. Right now you do sendBeacon only on `pagehide`, not during hidden periods.

### Suspect D: Something rotated `currentTrack` in the store without running loadTrack
- **Evidence:** `play_success` for B9H3iinXZv0 with no preceding `play_call` / `play_start` / `canplay_fire` / `load_enter` in the window for that track.
- **Fix direction:** Audit every site where `nextTrack()` is called, and ensure each one either goes through `runEndedAdvance` OR immediately calls `loadTrack`. In particular, check the mediaSession `nexttrack` handler and any swipe/gesture handlers for UI drift.

---

## 6) Recommended next steps (in priority order)

1. **Add ended-detection via `timeupdate` for BG.** Ship in next build. This is the single biggest lever — the root cause is the browser not firing `ended` in deep BG.
2. **Unthrottle telemetry flush in BG** via MessageChannel or direct-sendBeacon per-event when hidden. Right now we're flying blind in the exact window we most need visibility into.
3. **Add post-heartbeat-kick verification event.** After `el.play()` in the heartbeat, schedule a `setTimeout(500ms, () => trace('heartbeat_verify', { stillPaused: el.paused, currentTime: el.currentTime }))`. Will prove/disprove Suspect B.
4. **Add `track_rotation` trace at the store boundary** — every call site that changes `currentTrack` should emit a trace with `{from: 'ended'|'mediaSession'|'user'|'skip'|...}`. This closes the "how did track rotate silently" gap (Suspect D).
5. Only after the above surface actual signal, revisit the watchdog. v188 looks correct structurally; we just didn't reach it.

---

## Appendix — Raw event dump

30 events, session `voyo_mo09j5n2_0815nf`. All events in `/tmp/voyo-telemetry-30m.json`. Full raw fields in this file's queries.

Event type distribution:
- `trace`: 23 (18 different subtypes)
- `play_success`: 3
- `play_start`: 2
- `source_resolved`: 1
- `stall`: 1

**Absent that should have been present:**
- `watchdog_fire` (0× — fix unverifiable but pathology gone)
- `ended_fire` / `ended_bail` / `ended_dedup` (0× total)
- `next_call` (0× — no advance was dispatched via any known path)
- `silent_wav_engage` (0× — runEndedAdvance never ran)
- `skip_auto` (0×)
- `play_failure` (0×)
