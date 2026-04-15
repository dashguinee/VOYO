# VOYO Audio Pipeline — Full Audit (post-v193)

Everything I know, ordered by confidence + impact. No guesses marked as bugs.

---

## CONFIRMED BUGS (evidence in hand)

### 🔴 B1 — `nextTrack` is random, `predictNextTrack` picks first → preload always caches the wrong track

**Evidence:** v193 session `voyo_mo0ci0ql_rbb07k`, every `preload_check hit=False` despite `preload_complete` firing.

**Code:**
- `playerStore.ts:969` → `nextTrack` uses `availableTracks[Math.floor(Math.random() * ...)]`
- `playerStore.ts:1115` → `predictNextTrack` uses `availableTracks[0]`
- The comment on line 1113 even says *"actual nextTrack uses random, but for preloading we pick first to ensure consistency"* — which is exactly NOT consistent

**Scope:** Only when queue is empty (discover-only mode). When user queues tracks explicitly, it works.

**Fix:** Make both deterministic — use `availableTracks[0]`. Discover already shuffles on load.

---

### 🔴 B2 — Ended-event cascade skipping 2-3 tracks per track-end

**Evidence:** v192 session at +42.15s and +287.87s, 3 `ended_fire` events within 50ms each.

**Code:** `AudioPlayer.tsx:3145` runEndedAdvance — native listener + React onEnded both fire while `audio.ended=true` and `lastEndedTrackIdRef` just got reset by loadTrack.

**Status:** Fixed in v193 (src-based dedup) — awaiting confirmation from next natural track end in telemetry.

---

### 🔴 B3 — AudioContext suspended in BG → HTMLAudioElement.currentTime advances but silent

**Evidence:** v191 session +927.76s unlock trace showed `ctxState=suspended` while el was playing.

**Code:** `AudioPlayer.tsx:2988` heartbeat.
**Status:** v191 adds ctx.resume() + gain_rescue in heartbeat. Awaiting BG telemetry to verify.

---

### 🔴 B4 — BG telemetry blind (v190 fetch+keepalive was deferred, v192 sendBeacon unverified)

**Evidence:** 32s black hole in v191 session, 4min black hole in earlier sessions.
**Status:** v192 switched to sendBeacon. No BG session since v192 to verify.

---

### 🟡 B5 — Stall recovery `setTimeout` throttled in BG

**Code:** `AudioPlayer.tsx:3483` stallTimerRef
**Status:** Fixed in v190 (MC-based 4s timer in BG). Unverified.

---

### 🟡 B6 — `loadWatchdog` armed/cancelled per loadTrack — FIXED v188, stopped cascading

**Status:** v188 fix confirmed — zero `watchdog_fire` in v191+ sessions.

---

## SUSPECTED BUGS (strong signal, needs trace)

### 🟠 S1 — BG extraction failure kills transitions for 6s minimum

**Evidence:** Logic only — no preload = every transition hits live extraction. MAX_RETRIES=3 with 2s gaps = 6s silence if fast-path fails. v192 session had `play_fail source=vps+edge attempt=1`.

**Impact:** If B1 is fixed, preload hits and this goes away for most transitions. Still relevant for preload miss path.

---

### 🟠 S2 — Chrome may not fire `ended` event in deep BG

**Evidence:** v190 telemetry showed 0× ended_fire during 32s BG window where track rotated.
**Status:** v189 synthetic_ended + v190 stuck_escalate are fallbacks. Both unconfirmed in BG.

---

### 🟠 S3 — `masterGain` can get stuck at 0.0001

**Evidence:** v191 session +927.76s unlock showed `gain=0.0001` on a paused element.
**Status:** v191 gain_rescue kicks in if gain < 0.01 while playing. Unconfirmed.

---

### 🟠 S4 — Preload cancellation storm on track changes

**Code:** `AudioPlayer.tsx:570-574` preload cleanup effect fires on every `currentTrack.trackId` change. v193 added `preload_cancel` trace to measure.
**Impact:** Reduced by B2 cascade fix — no more 3 nextTracks per end = no more 3 cancelPreloads per end. Remaining cost is 1 cancel per normal transition, which is correct behavior (canceling in-flight preloads for tracks we skipped past).

---

## NO-TELEMETRY BLIND SPOTS (fix these to see bugs)

### 📡 T1 — `audioEngine.ts` visibility/context-resume has ZERO traces

**Code:** `audioEngine.ts:66-117` — the "canonical" ctx resume handler
**Missing:**
- `ctx_resume_attempt` (when handler fires)
- `ctx_resume_success` (when resume() resolves)
- `gesture_listener_install` / `gesture_resume_success`
- `watch_interval_install` (the 2s polling for suspended state)

### 📡 T2 — `handleAudioError` has minimal trace

**Code:** `AudioPlayer.tsx:3295`
**Missing:** error recovery path taken (cache-swap success, fallback to next, full reload), latency of recovery.

### 📡 T3 — Hot-swap path invisible

**Code:** `AudioPlayer.tsx:2401-2580`
**Missing:** `hotswap_start`, `hotswap_aborted`, `hotswap_complete`, position carry-over accuracy.

### 📡 T4 — `handlePlayFailure` partial

**Code:** `AudioPlayer.tsx:244-307`
**Has:** `play_failure` with err.name.
**Missing:** which retry path triggered, cascade counter state at failure, whether NotAllowedError fell through to gesture-listener.

### 📡 T5 — Queue state at decision points

**Code:** `playerStore.ts` nextTrack
**Missing:** `queue_consumed` (track popped from queue), `discover_picked` (fallback path + pool size), `repeat_all_rebuild` (history → queue rebuild), `no_tracks_available` (terminal failure).

### 📡 T6 — `loadTrack` entry/exit points

**Has:** `load_enter`, `load_guard`, fast-path traces.
**Missing:** `load_complete` (reached a stable playing state), `load_abandoned` (isStale guard fired), which fast-path was ultimately taken (preload vs cached vs R2 vs retry).

### 📡 T7 — `visibilitychange` capture-phase listener

The top-level `onVisibilityChange` in `audioEngine.ts` runs BEFORE the AudioPlayer one. No trace. Could give us millisecond ordering between the two.

### 📡 T8 — Session startup

**Missing:** `session_start` (session_id, version, queue length, discover pool size, device heuristics beyond user_agent).

### 📡 T9 — Store-level track rotation tracking

If currentTrack ever changes via a path other than nextTrack/prevTrack/setCurrentTrack (unlikely but possible via direct `set({ currentTrack: ... })`), we'd have no visibility. A single `track_rotation` trace in a zustand subscriber would catch any rotation.

### 📡 T10 — MiniPiP hook has no traces

**Code:** `hooks/useMiniPiP.ts`
**Missing:** PiP enter/exit, canvas/video state, effect on audio focus.

### 📡 T11 — Heartbeat tick baseline

Heartbeat only emits traces on anomaly (kick, stuck, gain_rescue, ctx_resume). Normal healthy ticks emit nothing. Hard to tell "heartbeat silent because healthy" from "heartbeat dead."
**Proposal:** Emit a lightweight `heartbeat_tick` every 8s (not 4s) with minimal meta: `{ctxState, gain, paused, currentTime, duration}`. Half the cadence = half the cost but enough to see the pulse.

---

## ARCHITECTURAL DECISIONS TO REVISIT

### ⚙️ A1 — Three visibility handlers competing

`audioEngine.ts` (context resume) + `AudioPlayer.tsx` (suspend-on-hidden + re-kick) + `useMiniPiP` (PiP enter/exit). Previously caused issues per the comments. Hard to reason about order.

**Proposal:** Consolidate to a single handler that fires all subscribers in explicit order.

### ⚙️ A2 — Preload system is "fire and forget then hope for match"

Preload manager doesn't know what nextTrack will return. Preloads whatever predictNextTrack says. If B1 is fixed, this mostly works, but the FUNDAMENTAL architecture is wrong: preload should be called AFTER nextTrack has committed, not BEFORE.

**Better pattern:** "commit-then-preload" — when current track starts, IMMEDIATELY commit what the next track will be (write it to queue or a `upcomingTrack` store field), then preload it. nextTrack just reads `upcomingTrack`.

### ⚙️ A3 — BG transition relies on silent WAV bridge

Works when AudioContext is running. If ctx suspended, the bridge plays silent into a frozen graph — not actually keeping anything alive. The whole bridge assumption breaks if ctx goes under.

**Proposal:** The bridge needs to actively resume ctx BEFORE engaging (not just check src).

### ⚙️ A4 — `audio.loop=true` silent-WAV bridge is fragile

4 fast-paths must ALL reset `loop=false` before src swap. v171 did preload + cached, v187 did R2, retry path also has it. One missed path = track loops forever in BG. Easy to regress.

**Proposal:** Hoist to a helper `swapSrcSafely(el, url)` that handles loop reset + volume pin + load() conditionally. All paths call it instead of duplicating.

---

## PRIORITIZED FIX LIST

**Round 1 — deterministic, confirmed-bug fixes (high ROI):**
1. **B1** — fix predictNextTrack/nextTrack consistency (one-line change: both use `[0]`)
2. **T1** — add audioEngine ctx_resume traces (see if the "canonical" handler works)
3. **T5** — add nextTrack branching traces (queue vs discover vs repeat vs empty)
4. **T6** — add load_complete / load_abandoned traces
5. **T11** — heartbeat_tick baseline pulse (8s cadence)
6. **A4** — hoist loop-false-then-src-swap into `swapSrcSafely` helper

**Round 2 — after seeing Round 1 telemetry:**
7. **B3/S3** verify v191 resume+rescue actually fire
8. **S2** verify synthetic_ended / stuck_escalate fire
9. **B4** confirm sendBeacon delivers BG events reliably
10. **A1** consolidate visibility handlers if issues persist

**Round 3 — architectural:**
11. **A2** commit-then-preload refactor (bigger change, only if B1 fix isn't enough)
12. **A3** resume-ctx-before-bridge if B3 recurs

---

## TELEMETRY HEALTH CHECK

Currently instrumented (100+ trace points):
- load path, preload lifecycle, ended/next, playFailure, stall, watchdog, heartbeat anomalies, visibility, battery, synthetic/stuck

Not instrumented:
- audioEngine, hotSwap, MiniPiP, store-level branches, session boot, heartbeat baseline, handleAudioError recovery paths

Estimated coverage of playback decisions: ~75%. Round 1 telemetry fixes push to ~95%.
