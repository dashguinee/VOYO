# VOYO Audio Pipeline — Full Inventory & Clean Architecture Plan

Written after reading every audio-relevant file with my own eyes. Target: identify the ingredients, spot architectural smells, plan a clean rewrite that doesn't touch recommendation/personalization.

---

## 1. THE INGREDIENTS (what exists today)

### Core playback (the actual sound)
| # | Component | File | Role |
|---|-----------|------|------|
| 1 | HTMLAudioElement | AudioPlayer.tsx | Single `<audio ref>` — THE sound source |
| 2 | Web Audio chain | audioEngine.ts (712 lines) | Singleton AudioContext + MediaElementAudioSourceNode + 20+ EQ/gain/compressor/analyser nodes |
| 3 | Silent WAV keeper | AudioPlayer.tsx:650 | 2-second blob, used as "keep session alive" bridge during transitions |

### State management
| # | Component | File | Scope |
|---|-----------|------|-------|
| 4 | playerStore (Zustand) | store/playerStore.ts (1784 lines) | **MIXED**: playback state (currentTrack, queue, isPlaying, volume, seek) + recommendation (discoverTracks, hotTracks, predictions) |
| 5 | downloadStore | store/downloadStore.ts | Cache settings, download preferences |
| 6 | Lots of refs in AudioPlayer | AudioPlayer.tsx:166-230 | 30+ refs tracking lifecycle state |

### Source resolution (how a trackId → audible bytes)
| # | Component | File | Type |
|---|-----------|------|------|
| 7 | IndexedDB cache | downloadManager.ts | **Authoritative local cache** — `getCachedTrackUrl()` returns blob URL |
| 8 | R2 collective cache | api.ts `checkR2Cache()` | Network endpoint — 170K+ shared tracks |
| 9 | preloadManager | preloadManager.ts (548 lines) | Per-trackId audio elements, Map<id, PreloadedTrack>, max 3 |
| 10 | audioEngine.preloadCache | audioEngine.ts:275 | **ANOTHER** blob Map, max 10, used only via `getBestAudioUrl()` (unused by main flow) |
| 11 | mediaCache | mediaCache.ts (462 lines) | **THIRD** cache system, mostly used for feed thumbnails, has unused `preloadVideoIframe` |
| 12 | VPS direct stream | AudioPlayer.tsx:2254 | `stream.zionsynapse.online:8443/voyo/audio/:id` — normalized, chunked |
| 13 | Edge Worker extraction | AudioPlayer.tsx:2258 | `voyo-edge.../stream?v=:id` — yt-dlp extraction |

### OS/browser integration
| # | Component | File | Role |
|---|-----------|------|------|
| 14 | MediaSession API | AudioPlayer.tsx:2817-2957 | Lock screen, hardware buttons, metadata, artwork |
| 15 | WakeLock API | AudioPlayer.tsx:625 | Keep screen awake during playback |
| 16 | Battery monitor | battery.ts (128 lines) | Correlate BG issues with power state |
| 17 | useMiniPiP | hooks/useMiniPiP.ts (307 lines) | Canvas-to-video PiP for BG lockscreen art |

### Recovery & defense (the thicket)
| # | Component | Where | Purpose |
|---|-----------|-------|---------|
| 18 | handleAudioError | AudioPlayer.tsx:3320 | Audio element `error` event → cache swap or skip |
| 19 | handleStalled | AudioPlayer.tsx:3493 | `stalled` event → 4s BG / 10s FG recovery timer |
| 20 | handlePlayFailure | AudioPlayer.tsx:244 | Promise rejection from `play()` → autoplay-block or skip |
| 21 | loadWatchdog | AudioPlayer.tsx:1803+1834 | 8s FG setTimeout + 5s BG MessageChannel — skip stuck loads |
| 22 | gainWatchdog | AudioPlayer.tsx:1220 | 6s timeout if gain stays muted after load |
| 23 | Stuck playback detector | AudioPlayer.tsx:3128 heartbeat | currentTime frozen for 8s → synthetic advance (v190) |
| 24 | Synthetic ended | AudioPlayer.tsx:3062 heartbeat | Chrome BG doesn't fire `ended` — detect near-duration-paused (v189) |
| 25 | ctx_resume in heartbeat | AudioPlayer.tsx:2995 | Actively resume suspended AudioContext in BG (v191) |
| 26 | gain_rescue in heartbeat | AudioPlayer.tsx:3015 | Force masterGain to target if stuck <0.01 (v191) |
| 27 | Silent WAV bridge | AudioPlayer.tsx — 5+ sites | Engage silent audio during src swap to hold focus |
| 28 | trackBlocklist | trackBlocklist.ts | Collective failure memory, Supabase-backed |
| 29 | trackVerifier | trackVerifier.ts (743 lines) | Known-unplayable tracks, `isKnownUnplayable()` |
| 30 | Cascade brake | AudioPlayer.tsx:1631 | Force-pause after 5 consecutive skip-to-next cascades |

### Telemetry
| # | Component | File | Role |
|---|-----------|------|------|
| 31 | telemetry.ts | services/telemetry.ts (254 lines) | Batched Supabase inserts + sendBeacon for BG flush |
| 32 | Trace points | all files | ~40 subtypes across the pipeline |

---

## 2. ARCHITECTURAL PROBLEMS

### A. Three parallel cache systems
Three code paths claim "cache":
1. `downloadManager.getCachedTrackUrl()` — authoritative (IndexedDB blobs)
2. `preloadManager.getPreloadedTrack()` — per-track audio elements + URLs
3. `audioEngine.preloadCache` + `mediaCache.cache` — legacy blob maps

Each has its own eviction policy, its own cache key convention, its own abort semantics. They don't share. When a track is preloaded, it ends up in one of these — the main loadTrack flow has to check all of them.

### B. AudioPlayer.tsx is 3844 lines
Too many responsibilities in one file:
- Audio element + JSX
- Web Audio chain setup + EQ preset switching
- Load orchestration (checkCache → R2 → VPS+edge)
- MediaSession registration + updates
- Heartbeat + stuck detection + synthetic ended + gain rescue
- Error recovery (audio_error, stall, play_failure)
- Visibility handling
- WakeLock management
- Silent WAV generation + bridge
- Preload trigger + cleanup
- Mute/fade gain ramps
- Hot-swap path (R2 → cached upgrade)
- ~30 refs tracking state

### C. playerStore mixes playback state with recommendation
`nextTrack` does both queue management AND discover-track fallback picking. `predictNextTrack` does the same. The recommendation code (pool curator, OYO DJ, video intelligence) is WIRED INTO the store's actions. Extracting playback from recommendation is the whole challenge.

### D. Silent WAV bridge sprinkled in 5+ places
Silent WAV engage sites:
1. AudioPlayer.tsx:1714 — loadTrack BG bridge
2. AudioPlayer.tsx:2184 — retry-path keeper (buffer gap)
3. AudioPlayer.tsx:2840 — MediaSession nexttrack handler
4. AudioPlayer.tsx:3202 — runEndedAdvance pre-advance bridge
5. AudioPlayer.tsx:3250 — handleAudioError re-arm

Each sets `loop=true` + `src=silentWAV` + `play()`. The fast paths that REPLACE the src must remember to reset `loop=false`. This has caused regressions in v171, v187 — every new path is a potential miss. v196's `swapSrcSafely` helper addresses this but doesn't prevent new silent-WAV sites from forgetting the pattern.

### E. Three competing visibility handlers
1. audioEngine.ts:66 — ctx resume on visibility:visible
2. AudioPlayer.tsx:586 — isTransitioningToBackgroundRef + re-kick on visible
3. useMiniPiP.ts (via useEffect) — PiP lifecycle

They run in unspecified order, each does their own thing, history of contention per code comments.

### F. React effect-order races
v196 bug: preload effect bailed because flag reset lived inside async loadTrack body, which ran after preload effect. Telltale symptom: preload only worked for first track of session. This is a **class of bug** — any state that's reset inside async work has the same risk elsewhere. Needs to be reviewed systematically.

### G. Event handler duplication
React `onEnded` + native `addEventListener('ended')` both fire. Deduplicated by refs. Worked around the duplication; didn't eliminate it.

### H. BG-specific code scattered everywhere
Every function has `if (document.hidden)` branches. No single module owns "what we do in BG." Makes the BG path impossible to reason about holistically.

### I. Load orchestration inside the main useEffect
`loadTrack` is a 700-line async function inside a useEffect. Its inner branches (preload / cached / R2 / retry) each have their own canplay handler + play() call + error catch. Testing any one branch in isolation is impossible.

---

## 3. BUGS FIXED (inventory of our journey)

| Version | Bug | Path |
|---------|-----|------|
| v167 | wasSkeeping stuck flag | rAF in BG |
| v171 | Loop=true sticky (preload + cached) | Silent WAV bridge side-effect |
| v172 | Cascade through blocked tracks | Missing blocklist filter in discover |
| v173 | Visibility re-kick race | Double play_success |
| v175 | handlePlayFailure BG silent bail | Track stuck after fail in BG |
| v178 | handleEnded vs onEndedDirect duplication | Refactored to runEndedAdvance |
| v181 | fadeInVolume rAF-based | 47s silent in BG |
| v183 | React onEnded null-dedup cascade | audio.ended===true guard |
| v187 | R2-hit path loop=false missed | Same class as v171 |
| v188 | BG watchdog `ticks < 500` iteration bug | 196 cascades in 50s observed |
| v189 | Chrome BG not firing ended | Synthetic ended in heartbeat |
| v190 | Stall timer throttled in BG | MC-based 4s timer |
| v191 | ctx suspended in BG | Heartbeat resume + gain_rescue |
| v192 | BG fetch deferred by Android | sendBeacon for BG flush |
| v193 | Ended cascade trackId dedup | Src-based dedup |
| v194 | nextTrack random pick | Deterministic [0] in non-shuffle |
| v195 | predict/next filter mismatch | Identical filters |
| v196 | Preload flag reset race | Per-trackId dedup ref |

18 bugs fixed. Pattern: every one was a consequence of the architecture problems in Section 2. The pipeline is dense with special cases and implicit coupling.

---

## 4. UNRESOLVED / SUSPECTED

| Issue | Status |
|-------|--------|
| BG telemetry drops in deep BG | v192 sendBeacon helps but not fully |
| AudioContext resume in deep BG | v191 attempts, unverified |
| Synthetic ended firing in real BG | Unverified (no BG traces land) |
| Multiple cache layers out of sync | Architectural |
| No single "BG strategy" module | Architectural |

---

## 5. THE CLEAN ARCHITECTURE

### Principles
1. **Single source of truth**: audio element = playing/not, store = mirror
2. **One cache**: IndexedDB only. R2 is a network endpoint. Delete mediaCache.cache and audioEngine.preloadCache for audio. preloadManager becomes a thin "decode next trackId into IDB" helper.
3. **One BG strategy module**: owns visibility handler, ctx resume, heartbeat, kick logic. AudioPlayer doesn't branch on `document.hidden` anywhere else.
4. **Explicit state machine**: `IDLE → LOADING → PLAYING → PAUSED → ENDED → ADVANCING → LOADING → ...` — every transition traced, every transition testable.
5. **Event flow one direction**: audio element events → state machine transitions → store updates → UI. No feedback loops.
6. **Isolated from recommendation**: `nextTrackId()` returns a string. How that string is picked (queue, predict, discover) lives in playerStore. The playback pipeline doesn't care.

### Proposed module layout
```
src/audio/
  index.ts                  — public API, React hooks
  AudioHost.tsx             — thin component, mounts <audio>, wires events
  graph/
    audioGraph.ts           — Web Audio chain singleton (from audioEngine.ts)
    boost.ts                — EQ presets (BOOSTED, CALM, VOYEX)
    fade.ts                 — masterGain ramp helpers
  sources/
    sourceResolver.ts       — trackId → blob URL (IDB → R2 → extract)
    indexedDBCache.ts       — renamed downloadManager
    r2Client.ts             — checkR2Cache + /audio endpoint
    extract.ts              — VPS + edge race
    preload.ts              — "decode trackId into IDB" helper
  playback/
    stateMachine.ts         — IDLE/LOADING/PLAYING/PAUSED/ENDED
    runLoop.ts              — track-end → advance logic
    mediaSession.ts         — register once, update on change
  bg/
    bgEngine.ts             — the ONE BG strategy module
    heartbeat.ts            — MC-based keep-alive + watchdogs
    silentBridge.ts         — silent WAV keeper, owned here not sprinkled
  recovery/
    errorRecovery.ts        — audio_error, stall, play_failure
    watchdogs.ts            — loadWatchdog, gainWatchdog
  telemetry/
    trace.ts                — re-export of existing telemetry.ts
    events.ts               — typed event enum, no subtype strings
```

### Data flow (clean)
```
user taps play
  → playerStore.currentTrack = track
  → AudioHost useEffect reacts to trackId change
  → stateMachine.transition(LOADING)
  → sourceResolver.resolve(trackId)
    → IDB? return blob URL
    → else: R2 exists? return R2 URL (async fetch starts filling IDB in background)
    → else: VPS+edge race, on success start filling IDB
  → AudioHost: audio.src = url; audio.load(); audio.play()
  → audio element fires canplay → stateMachine.transition(PLAYING)
  → meanwhile: preload.prepare(nextTrackId()) — decode N+1 into IDB
```

### BG transition flow (clean)
```
document hidden
  → bgEngine.onHide()
  → starts heartbeat (MC-based, not rAF)
  → heartbeat every 4s:
      ensure ctx running
      ensure gain healthy
      update mediaSession.setPositionState
      detect stuck playback (currentTime frozen for 2 ticks → advance)
      detect synthetic ended (currentTime near duration, paused → advance)
track ends in BG
  → native 'ended' fires OR synthetic detection in heartbeat
  → stateMachine.transition(ENDED) → ADVANCING
  → runLoop: nextTrack → sourceResolver → AudioHost.play()
  → Because preload.prepare() already filled IDB, sourceResolver returns blob URL instantly
  → No network, no extraction, no race, no focus loss
```

### What changes, what stays
**Changes:**
- AudioPlayer.tsx (3844 lines) → AudioHost.tsx + 10 small modules
- audioEngine.ts + preloadManager.ts + mediaCache.ts → 3 focused modules (graph, preload, delete mediaCache)
- Silent WAV logic → one module (silentBridge.ts) used from 1-2 places, not 5
- BG handling → one module (bgEngine.ts), no `if (document.hidden)` branches elsewhere
- State transitions → explicit state machine, not scattered refs

**Stays untouched (per Dash's instruction):**
- playerStore's recommendation pieces (discoverTracks, hotTracks, predictNextTrack's discovery logic)
- personalization.ts, oyoDJ.ts, poolCurator.ts, intelligentDJ.ts, videoIntelligence.ts
- trackPoolStore.ts
- UI components (PortraitVOYO, ClassicMode, SearchOverlayV2, Library, etc.)

**Clean boundary:**
The NEW audio pipeline exposes a tiny public API:
```typescript
// src/audio/index.ts
export function usePlayback(): {
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended';
  currentTime: number;
  duration: number;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  setBoost: (preset: BoostPreset) => void;
};
export function AudioHost(): JSX.Element;  // mount once in App
```

All callers (UI components) use this. Recommendation code doesn't touch it; it only mutates `playerStore.currentTrack` and the pipeline reacts.

---

## 6. MIGRATION PLAN

**Constraint:** must keep app working throughout. No "rebuild from scratch and flip a switch." Incremental.

**Phase 0: Safety net** (no code change)
- This document reviewed with Dash
- Identify what to keep untouched
- Agree on the boundary

**Phase 1: Extract BG strategy** (~2 hours)
- Create `src/audio/bg/bgEngine.ts`
- Move visibility handler, heartbeat, ctx resume, gain rescue, stuck detector, synthetic ended into it
- AudioPlayer.tsx delegates to bgEngine
- Behavior-identical, just reorganized
- **Testable improvement:** single `if (document.hidden)` branch in the codebase

**Phase 2: Consolidate caches** (~2 hours)
- Delete `audioEngine.preloadCache` (unused by main flow)
- Delete `mediaCache` for audio (keep for thumbnails if UI uses it)
- preloadManager writes to IndexedDB instead of its own audio-element Map
- Main flow: `sourceResolver.resolve(trackId)` → single code path
- **Testable improvement:** one cache layer, no duplication

**Phase 3: Extract source resolution** (~3 hours)
- Create `src/audio/sources/sourceResolver.ts`
- Takes a trackId, returns a Promise<{url, source}>
- Moves cached/R2/VPS/edge logic out of loadTrack
- AudioHost becomes thin orchestrator
- **Testable improvement:** sourceResolver is unit-testable in isolation

**Phase 4: Extract state machine** (~3 hours)
- Create `src/audio/playback/stateMachine.ts`
- Explicit transitions, guards, action side-effects
- Replaces the scattered refs
- **Testable improvement:** illegal transitions throw; state is traceable

**Phase 5: Silent WAV owned in one place** (~1 hour)
- Move generation + bridge logic to `silentBridge.ts`
- Called from bgEngine only
- Remove the 5 scattered call sites
- **Testable improvement:** no more v171/v187-class regressions

**Phase 6: Delete dead code, tighten types** (~1 hour)
- Remove unused exports
- Tighten any `any` types
- Rename legacy refs
- **Testable improvement:** AudioPlayer.tsx < 1000 lines

**Total: ~12 hours, spread across sessions.** Each phase shippable independently.

---

---

## 7. THE BROWSER / OS / PWA RULES WE LIVE UNDER

Every hack we wrote exists because of one of these. Understanding them IS understanding the pipeline.

### Chrome Android — what happens when tab is hidden

| API | BG behavior | What we use |
|-----|-------------|-------------|
| `setTimeout` / `setInterval` | Throttled to **1/min** after 5 min BG | ❌ avoid for anything <60s |
| `requestAnimationFrame` | **PAUSED entirely** while hidden | ❌ never rely on rAF in BG |
| `fetch` | Not hard-throttled, but **may be deferred/deprioritized** | ⚠️ keepalive fetch can be delayed |
| `MessageChannel` | **Not throttled** — postMessage dispatches immediately | ✅ heartbeat, watchdogs |
| `navigator.sendBeacon` | **Not throttled** by BG rules (designed for unload) | ✅ telemetry flush |
| WebWorker | Not throttled | ➖ unused |
| Service Worker | Separate context, not throttled | ➖ only for cache |
| `Audio.play()` | Works if user gesture previously given (autoplay permission sticks) | ✅ play() works in BG |
| `HTMLAudioElement.currentTime` | **Advances** if element is actually playing — independent of Web Audio | ⚠️ can be ahead of store |
| `AudioContext` | **Browser may `suspend()`** for power save; clock freezes | ⚠️ v191 actively resumes |
| MediaSession action handlers | Fire reliably in BG (last-registered wins per origin) | ✅ primary control surface |
| `navigator.getBattery()` | Works; events fire | ✅ we correlate |
| `timeupdate` event | Throttled heavily in BG, drops to <1/30s under power save | ⚠️ can't rely on |
| `ended` event | **Sometimes doesn't fire** in deep BG | ⚠️ v189 synthetic detection |
| `pause` event | Fires if OS silent-suspends element | ⚠️ onPause guards BG |

### Android power save = new class of restrictions
Under low battery (<15-20%) or explicit power save toggle:
- AudioContext suspends aggressively (can be every few minutes)
- fetch() deprioritized further
- Processes killed opportunistically
- Audio focus revocation more aggressive
- MessageChannel may see gaps between dispatches

### Chrome autoplay policy
- Permission **persists per origin** after first user interaction
- Once user tapped play once, subsequent `audio.play()` calls work
- EXCEPT: iOS safari is stricter; AudioContext resume requires gesture
- `NotAllowedError` on play() = gesture-starved
- `AbortError` on play() = src changed mid-flight (benign)

### Android audio focus
- Only ONE app/tab has "audio focus" at a time
- OS can revoke focus silently (another app plays a notification sound)
- Losing focus → element gets paused by OS WITHOUT firing `pause` event in some cases
- **Re-acquiring focus requires `play()` call**
- MediaSession active state helps hold focus

### PWA specifics we have / could use
| Capability | Status |
|------------|--------|
| `display: standalone` in manifest | ✅ yes |
| Installable from Chrome | ✅ yes |
| Service Worker | ✅ /service-worker.js — caches stream responses |
| Background Sync | ❌ unused |
| Periodic Background Sync | ❌ unused (limited support anyway) |
| Web Push | ❌ unused |
| Media Session | ✅ fully wired |
| Picture-in-Picture | ✅ via useMiniPiP (user-triggered) |
| `vibrate()` haptics | ✅ yes |
| `wakeLock('screen')` | ✅ yes |
| `BroadcastChannel` | ❌ unused (could solve multi-tab) |
| Storage API (`navigator.storage.persist`) | ❌ unused (would protect IDB from eviction) |

### The PWA difference from regular web
A standalone PWA gets **slightly better BG treatment** than a regular browser tab:
- Audio focus held longer
- Less aggressive process killing
- System sees it as a "media app" not a tab
- OS media controls integrate more naturally

We're already installable. The install experience IS the BG-playback quality upgrade.

---

## 8. THE WISDOM IN OUR HACKS (don't throw away)

Each patch we shipped encodes a hard-won truth about Chrome/Android. Keep them.

| # | Hack | The truth it encodes |
|---|------|----------------------|
| 1 | Silent WAV bridge | Without SOMETHING playing, OS can revoke audio focus in <500ms — the transition window |
| 2 | `MessageChannel` timers | Only non-throttled timer mechanism in BG |
| 3 | Web Audio gain ramps (ctx-clock) | Survive rAF pausing; `linearRampToValueAtTime` works in BG |
| 4 | Dedup by `audio.currentSrc` (v193) | currentSrc is a stable synchronous primitive; React state is not |
| 5 | `audio.ended === true` guard (v183) | React synthetic events can fire after native — element.ended is truth |
| 6 | `loadAttemptRef` monotonic counter | Async work + rapid state changes need explicit cancellation tokens |
| 7 | Preload `isReady` flag | Can't consume a preload that hasn't buffered — check before transfer |
| 8 | Blob URL for IDB cached audio | Synchronous, no network, no CORS, no retry needed |
| 9 | Cascade brake after 5 skips (v172) | Without a brake, failure loops burn the queue in seconds |
| 10 | Heartbeat silent-paused kick | OS can pause element WITHOUT firing `pause` — poll and re-kick |
| 11 | `sendBeacon` for BG telemetry (v192) | Only way to actually flush in deep BG |
| 12 | WakeLock `screen` | Prevents deep power-save that kills BG audio |
| 13 | Visibility handler capture-phase listener | Fires before `pause` event — protects `onPause` from clobbering store |
| 14 | Src-based cascade dedup (v193) | trackId is store-state — mutates faster than event delivery; src is element-state |
| 15 | Per-trackId preload dedup ref (v196) | Boolean flags + async resets have React effect-order races |
| 16 | `isTransitioningToBackgroundRef` | Pause event fires before visibilitychange on some browsers — need sync flag |
| 17 | `setActionHandler('play' ... reads via getState())` | Action handler closures are long-lived; read fresh state not closure |
| 18 | `Date.now()` wall-clock gate in MC timer (v188) | Iteration count ≠ time; only wall clock is trustworthy |
| 19 | Silent-WAV as `loop=true` anchor | Element needs a reason to keep "playing" while we swap src |
| 20 | Negative cache + blocklist | Dead trackIds stay dead; don't re-extract-fail them |

**Every one of these is a law of the land.** The rewrite must preserve the behavior behind each. The rewrite is not about deleting these — it's about putting each in ONE place where its purpose is clear, instead of smeared across 3844 lines.

---

## 9. "THE ANSWER"

After reading everything, here's the one principle that unifies the pipeline:

### **The audio element must never be idle.**

That's it. Every bug we've fought is because the element briefly entered an idle/paused state during a transition, and the OS/browser took that moment to revoke audio focus or suspend the context or drop the session.

The architecture that follows from this principle:

```
STATE INVARIANT: audioRef.current is ALWAYS playing something.
  ├── A real track (cached blob / R2 URL)
  ├── A silent WAV bridge (during src swap, waiting for next track)
  └── Never paused-by-us. OS may pause; we detect + re-play.

TRANSITIONS: the element transitions from track → silent-WAV → next-track
without ever going idle. The src swap is "blob → silent WAV → blob" — 
never "blob → null → blob".

GUARANTEE: because we're always playing, OS never revokes focus,
AudioContext stays running, MediaSession stays active, BG auto-advance
works because the element never had to reacquire anything.
```

### What this means concretely

1. **Every `audio.pause()` call becomes suspect.** Audit them — most should be "swap src to silent WAV" instead.
2. **The fade-out-pause dance at loadTrack start** — instead of `mute → pause → swap src`, do `mute → swap to silent WAV → swap to real → fade in`. Never pause.
3. **The silent WAV isn't a "bridge" anymore — it's a first-class state.** One module owns it. Every transition goes through it.
4. **BG doesn't need special case branches.** If the element is always playing, there's nothing to handle differently in BG. BG just happens to be when the element's currentTime doesn't drive UI updates (but playback continues).
5. **Preload's job is simple:** pre-decode the next track into IDB so the "swap silent WAV → real track" step has a blob ready.

### The BG auto-advance bug reframed

Old thinking: "In BG, when track ends, advance to next." We've been trying to make that advance robust.

New thinking: **the element never reaches "ended" for more than a millisecond**. When currentTime hits duration - 0.5s (or slightly before), heartbeat detects it and pre-engages the silent WAV + sets up the next src. The `ended` event barely matters because we've already transitioned.

Actually even cleaner: **set `audio.src` to the next track before the current one ends.** Use the `timeupdate` near-end signal. When we see currentTime > duration - 2s, and the next src is ready in IDB, do the swap. The current track finishes playing naturally (browser handles buffer), next track starts immediately because its blob is pre-decoded.

This is how Spotify does gapless. We have the ingredients — preloadManager caches next-track blob — we just don't commit them pre-emptively.

### The architectural shift

Today: reactive. Track ends → try to advance → handle 15 edge cases.
Tomorrow: **proactive.** Track nearly-ends → element already transitioning → no edge cases because no abrupt state change.

---

## 10. WHAT I PROPOSE NEXT

1. **Dash reviews + challenges this document.** Any wisdom I missed? Any hack whose purpose I got wrong? Any browser behavior I'm wrong about?
2. **Agree on "The Answer"** (Section 9) as the north star.
3. **Phase 1 starts:** extract the silent-WAV-first transition into one module. Everything flows from there.

I did not touch code in this pass. Ready to start Phase 1 when you give the word.
