# Transition Audit 5 — PLAY-FAILURE + HEARTBEAT + VOLUME

HEAD: `bef4d59` (feat(battery): navigator.getBattery monitor…)
Scope: `src/components/AudioPlayer.tsx` only.

---

## Commit 3759c3e — `handlePlayFailure`

**Change:** Replaced the old FG/BG branch at AudioPlayer.tsx:275-288 with a three-way split at 235-298:
1. `NotAllowedError` → `setIsPlaying(false)` + install a one-time `touchstart/click` resume listener (lines 250-279).
2. `AbortError` → clear `isLoadingTrackRef`, log, return (lines 283-289). Treated as benign src-swap mid-flight.
3. Everything else → `nextTrack()` regardless of `document.hidden` (lines 290-297).

**HEAD state:** Matches the commit. Callsites at lines 1874, 1953, 2018, 2197 all wrap `play().catch` into `handlePlayFailure(...)`.

**BG trace (per failure kind):**
- `AbortError` in BG: returns silently. If this happens because loadTrack raced itself (src swap), the *new* load's own `canplay → play()` should follow. If the abort was terminal (element torn down, no follow-up load), we sit frozen. The watchdog at lines 1770-1801 (8s FG, ~5s BG MessageChannel) is the only safety net — and it's cleared at line 238 by `clearLoadWatchdog()` before the Abort branch returns. **This is a regression risk:** an AbortError that does NOT have a follow-up load will now bypass the watchdog and the nextTrack, and the heartbeat's silent-paused recovery is the only thing that could save it — but that fires only if `!isLoadingTrackRef.current`, which is now `false`, so it WILL fire and re-`.play()`. Net: okay in practice, but brittle.
- `NotAllowedError` in BG: stores `isPlaying=false` and waits for a gesture that will never come while locked. The heartbeat effect cleanup runs (isPlaying flipped false). Acceptable — autoplay-block in BG is genuinely unrecoverable. Note that the watchdog was cleared at line 238, so no auto-skip either.
- Any other error in BG: calls `nextTrack()` → the cascade brake (line 2091-2097) is armed after 5 consecutive failures, which force-pauses. Fine.

---

## Commit c257be2 — `fadeInVolume`

**Change:** Two layers.
1. `fadeInVolume` fallback (lines 1327-1334): rAF loop removed, now snaps to target synchronously.
2. Cached canplay path (lines 1936-1943): always `fadeInMasterGain(...)` instead of conditional `fadeInVolume`.

**HEAD state:** Matches. `fadeInVolume` is now only defined (1306-1335) but has zero callsites in HEAD (grep 236-3350: all fade-in callers use `fadeInMasterGain`).

**All fade-in paths audited for BG safety:**
| Site | Line | Function | BG-safe? |
|------|------|----------|---------:|
| Autoplay resume-on-gesture | 268 | fadeInMasterGain | yes (Web Audio param ramp) |
| Preload canplay | 1861, 1863 | fadeInMasterGain | yes |
| Cached canplay | 1943 | fadeInMasterGain | yes |
| R2 canplay | 2006, 2009 | fadeInMasterGain | yes |
| Retry canplay | 2184, 2186 | fadeInMasterGain | yes |
| Hot-swap canplaythrough | 2465 | fadeInMasterGain | yes |
| User tap resume (Web Audio branch) | 2545 | fadeInMasterGain | yes |
| Visibility snap + media session | 2727, 2878, 2900 | fadeInMasterGain (setTimeout 30ms) | BG-degraded (setTimeout throttled, but ramp itself is Web Audio — harmless delay only) |
| Cascade-break bg resume path | 3288, 3313, 3342 | fadeInMasterGain | yes |

**Remaining rAF volume ramps (unsafe in BG, but NOT on the auto-advance critical path):**
- `audio.play/pause` effect fallback when no Web Audio chain: lines 2552-2561 (play fade-in), 2585-2596 (pause fade-out). Only triggered by user tap on a cached/r2 source WITHOUT `audioEnhancedRef.current`. In BG, a user tap to resume from the notification bypasses this branch because MediaSession `play` action just calls `togglePlay()` — this effect runs synchronously on isPlaying flip. If `audioEnhancedRef.current` is false, the rAF step will stall in BG → user hears silence after tap until FG return. **Flagged.** Low likelihood though: `audioEnhancedRef.current` is wired up whenever Web Audio is available, which is essentially always after the first play.

---

## Commit f0a77e5 — MediaSession heartbeat

**Change:** New useEffect at lines 2938-2990. MessageChannel ping loop fires every ~4s while `isPlaying`. On each tick:
- `setPositionState` + re-assert `playbackState='playing'` (lines 2953-2961).
- Silent-paused recovery: if `el.paused && el.src && !isLoadingTrackRef.current && store.isPlaying`, call `el.play()` and trace `heartbeat_kick` (lines 2965-2978).

**HEAD state:** Matches commit; plus battery observations added at 2970-2977.

**Interaction with pre-advance silent WAV (08764bc, lines 3119-3126):**
`runEndedAdvance` sets `src=silentWAV` and `.play()`s it synchronously BEFORE `nextTrack()`. Then loadTrack runs and sets `isLoadingTrackRef.current = true` at line 1665. The loadTrack mute-before-load runs at 1664-1716 (8ms ramp + silent WAV bridge at 1700-1710). The load watchdog arms at 1770.

Race window: between `runEndedAdvance` line 3129 (`nextTrack()`) and loadTrack line 1665 setting the flag `true`. React reconciliation + useEffect dispatch takes 5-50ms (worse in BG). During this window:
- `isLoadingTrackRef.current` is `false` (it was cleared in `fadeInMasterGain` at line 1283 when the previous track last faded in).
- Element src = silent WAV, element is **playing** (not paused).

Because the heartbeat's recovery requires `el.paused`, it does NOT fire here — the silent WAV is actively playing. **Good.**

However: if the silent WAV itself `.play()` rejected at line 3123 (`.catch(() => {})` swallows), the element is paused with src=silentWAV and `isLoadingTrackRef.current=false` for that window. The heartbeat can then call `.play()` on the silent WAV. When loadTrack subsequently sets `src = cachedUrl` at line 1910, the still-pending heartbeat play() promise may reject with AbortError — routed nowhere (catch is no-op). Safe.

**Heartbeat re-instantiation during fast transitions:** The effect depends on `[isPlaying]` only. `isPlaying` does NOT toggle during a normal track transition — only on user pause or cascade-brake force-pause. So the heartbeat does NOT tear down between tracks. It stays alive across the silent-WAV→real-src swap. Cleanup fires only on true pause, which is correct.

---

## Final TL;DR — most-likely current bug source

The failure wave commits look clean. The highest-risk residual:

**AbortError swallowing (commit 3759c3e) + cleared watchdog at line 238.** If a BG play() rejects with AbortError and no follow-up `canplay → play()` arrives (e.g., loadTrack was superseded and then stale-guarded out at line 1698, or the cached handler removed via `.removeEventListener` at line 1920 before firing), the audio element is paused with real src and no watchdog armed. The *only* recovery is the heartbeat kick at line 2966, which needs `store.isPlaying === true` — it still is — so the heartbeat will call `.play()`. But if that play() also rejects with AbortError, we loop silently forever (catch is no-op) and no trace_fire except `heartbeat_kick`.

Recommendation (read-only, not applied): in 3759c3e's AbortError branch, verify the element actually has a live src. If `audio.src` points to a superseded URL and no new load is in flight (`!isLoadingTrackRef.current`), fall through to `nextTrack()` instead of returning.

Secondary risk: the rAF user-resume fallback at 2552/2585 — cold edge only, but technically BG-unsafe if `audioEnhancedRef.current` is ever false.

Files: `/home/dash/voyo-music/src/components/AudioPlayer.tsx` (all line refs above).
