# Transition Audit 4 — Cascade / Skip / Visibility

Scope: commits `99765ce`, `3a5d379`, `58580e2`, `3b449d4`. Target files:
`src/components/AudioPlayer.tsx`, `src/components/voyo/VoyoPortraitPlayer.tsx`,
`src/store/playerStore.ts`.

---

## Per-Commit Audit

### 99765ce — wasSkeeping stuck-true fix (FG manual skip)
**Change**: `VoyoPortraitPlayer.tsx` adds `wasSkeepingClearedAt` timestamp
(line 4482), triple-belt clear via rAF + 80ms setTimeout (lines 4632–4635),
hard 250ms upper bound + self-heal in `handleNextTrack` (lines 4641–4642).
**HEAD state**: Present and intact.
**Regression risk**: LOW. 250ms window is short enough that even back-to-back
SKEEP→tap-Next sequences in the user's natural cadence (>300ms) are
unaffected. Self-heal `wasSkeeping.current = false` on line 4642 means a
single suppressed tap auto-unlocks the next.
**BG manual-skip via OS lockscreen**: SAFE. `AudioPlayer.tsx:2794` (`nexttrack`
MediaSession handler) calls `nextTrack()` directly from the store, not
`handleNextTrack`. The wasSkeeping guard sits only in the VoyoPortraitPlayer
component path, so OS lockscreen bypasses it entirely.

### 3a5d379 — blocklist filter + cascade circuit breaker
**Change**: `playerStore.ts:922-958` applies `isKnownUnplayable`+`isBlocklisted`
across all three discover/hot fallback tiers. `AudioPlayer.tsx:1621-1644`
adds the `blocklistCascadeRef` counter: increment on isBlocked hit, force-pause
at >=5, reset to 0 when a non-blocked track arrives (line 1644).
**HEAD state**: Present (lines 168, 1622–1644).
**Regression risk**: MEDIUM. See cascade map below.

### 58580e2 — double-resume race kill
**Change**: Visibility re-kick bails when `isLoadingTrackRef.current` is true
(AudioPlayer.tsx:603). `lastPlaySuccessIdRef` dedups onPlay telemetry
(lines 169, 1610, 3471–3472).
**HEAD state**: Present.
**Regression risk**: See re-kick scenario below — dependent on canplay
firing reliably after visibility wake.

### 3b449d4 — cascade extension to max_retries
**Change**: `AudioPlayer.tsx:2083` increments `blocklistCascadeRef` on
retry-exhaustion (MAX_RETRIES branch). Force-pause at >=5 (lines 2094–2098).
**HEAD state**: Present.
**Regression risk**: MEDIUM. Counter is now shared between two very
different failure signals, and a single user session through 5 legitimately
broken tracks pauses playback — user must manually resume.

---

## Complete Cascade Counter Map (`blocklistCascadeRef`)

**Declared**: line 168, `useRef(0)`.

**Increments** (2 sites, both in loadTrack):
1. Line 1628 — when `isBlocked(trackId)` returns true (track on collective
   blocklist before load begins).
2. Line 2083 — when MAX_RETRIES exhausted on VPS-retry path (track markBlocked
   just fired).

**Resets to 0** (1 site):
- Line 1644 — immediately after the `isBlocked` guard, when load proceeds
  toward a non-blocked track.

**Force-pause triggers** (2 sites):
- Line 1622–1625: blocklist path, cascade >=5 → `setIsPlaying(false)`.
- Line 2094–2097: max_retries path, cascade >=5 → `setIsPlaying(false)`.

**False-positive check**: Neither increment fires on a successful load.
Line 1644 reset runs BEFORE any async work, so any load that passes the
blocklist gate resets the counter even if it later stalls. Good — transient
network hiccups don't poison the counter.

**Edge case (real)**: The counter is NEVER reset on `play_success` or
`onEnded`. If a user plays 4 blocked tracks, then one non-blocked track
loads and plays cleanly, the counter resets at line 1644. But if between
blocked track #4 and #5 the user's queue accidentally contains a successful
load that was then cancelled by a rapid user skip BEFORE reaching line 1644
(the `same_track_id` guard at 1604 returns early without resetting)
— the counter stays at 4, and the next blocked track pushes to 5
→ force-pause. In practice: unlikely, but the counter is not bulletproof
against rapid-skip scenarios.

---

## Visibility Re-Kick Scenario Walkthrough

**Question**: Can BG→FG return while `isLoadingTrackRef=true` leave audio
permanently paused?

**Path trace**:
1. Track A playing in BG. Track ends → onEnded → nextTrack → loadTrack(B)
   starts → `isLoadingTrackRef = true` (line 1665).
2. User returns to FG mid-load. Visibility handler fires (line 577).
3. Line 603 bails because loading is in-flight. Visibility does NOT call play().
4. canplay fires for B (line 1847 or 1917). Handler calls `audioRef.play()`
   (line 1866/1945). `fadeInMasterGain` runs (line 1283) which sets
   `isLoadingTrackRef = false`.
5. Audio plays. No stall.

**Failure scenario (THEORETICAL, ~rare)**: If the BG load was heavily throttled
and the `canplay` event listener was attached (line 1877/1956) but the browser
dropped the event while hidden — after FG return, canplay fires immediately
(browser re-dispatches pending media events on visibility). Handler runs,
calls play(). SAFE.

**The actual risk**: the load watchdog. BG load watchdog is 5s (line 1794).
If FG return happens AFTER the 5s BG watchdog fires but BEFORE canplay, the
watchdog nextTrack()s track B → starts loadTrack(C). Visibility re-kick
now bails because isLoadingTrackRef flipped back true for C. CORRECT behavior.

**Silent-paused heartbeat** (line 2966) is the backstop: if element is paused
but store says playing and NOT loading, kick play(). This fires on a periodic
timer independent of visibility. If any visibility re-kick bails early AND
canplay somehow doesn't fire, the heartbeat catches it within its interval.
No permanent pause scenario found.

---

## Cascade Force-Pause Recovery

When `setIsPlaying(false)` fires at cascade >=5, can the user resume?
YES. `isLoadingTrackRef.current = false` is set before the force-pause (line
2093) and the blocklist branch returns before setting it (line 1625), BUT
the effect-cleanup at line 2303 (runs on next trackId change) clears it.
User tapping play → `togglePlay` → `setIsPlaying(true)` → heartbeat at 2966
kicks the current paused element. SAFE.

**However**: `blocklistCascadeRef` stays at 5 after force-pause. Next user
action that triggers loadTrack on a blocked track immediately re-hits the
>=5 brake (line 1622) without incrementing — permanent brake until a
non-blocked track reaches line 1644. If the discover pool remains stale,
the user clicks play, gets nothing, and the counter never decrements.
**This is a latent bug**: the counter should reset when user manually
toggles play after a cascade brake. Currently it doesn't.

---

## BG Silent-Fail Scenarios Caused By These Fixes

1. **Stale cascade counter** (described above): after FG cascade-brake, BG
   auto-advance into another blocked track silently pauses again with no
   user-visible signal beyond an OS notification flicker.
2. **None found** for the visibility re-kick guard — the canplay handlers
   + heartbeat provide redundant paths to play().
3. **wasSkeeping fix** does not touch BG paths. Zero BG regression risk.
