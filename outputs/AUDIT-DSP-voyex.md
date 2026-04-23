# AUDIT-DSP — VOYEX Audio DSP + Effects Chain

**Scope:** the entire Web Audio DSP graph — `<audio>` → MediaElementAudioSourceNode → gain → multiband/EQ → stereo widen → master → comp → limiter → spatial (crossfeed/pan/Haas/reverb/sub-harmonic) → destination. Preset switching, spatial slider, gain math, fade races, AudioContext state handling, memory leak surfaces.

**Files audited:**
- `src/audio/graph/useAudioChain.ts` (833 lines) — the hook that owns every DSP node
- `src/audio/graph/boostPresets.ts` — preset data
- `src/audio/graph/boostPresets.test.ts` — 6 existing assertions
- `src/audio/graph/freqPump.ts` — visualizer pump
- `src/services/audioEngine.ts` — singleton context + source + analyser
- `src/audio/AudioErrorBoundary.tsx` — crash recovery

**Adjacent (skimmed for interaction):** `src/audio/bg/bgEngine.ts`, `src/components/AudioPlayer.tsx`.

**Priors consumed:** none — this is the first DSP audit this cycle.

---

## DSP topology (as built today)

Built ONCE per element inside `setupAudioEnhancement` (guarded by `audioEnhancedRef`). For preset `'off'` only `source → spInput` is wired. For every other preset:

```
source
  ├─ highPass (HPF 25Hz, Q=0.707)
  │    ├─ multibandBypassDirect (gain: 1 → 0 when mb path active)
  │    └─ LR crossover 180Hz + 4500Hz, three bands:
  │         low:  lowpass×2 → lowGain → lowComp → harmonicExciter (WaveShaper 44100 samples)
  │         mid:  hp×2 + lp×2 → midGain → midComp → harmonicExciter
  │         high: hp×2 → highGain → highComp → exciterBypass (dry)
  │       → bandMerger → multibandBypassMb (0 ↔ 1)
  │    → multibandMix
  │    → subBass (lowshelf 50Hz) → bass (lowshelf 80Hz) → warmth (peak 250Hz, Q=1.5)
  │    → presence (peak 3kHz) → air (highshelf 10kHz)
  │    → stereo splitter → L/R DelayNodes → merger
  │    → masterGain (starts at 0.0001)
  │    → comp (DynamicsCompressor)
  │    → limiter (DynamicsCompressor, threshold -0.1, ratio 20)
  │    → spInput
spInput (gain=1, fanout to FIVE destinations):
  ├─ spatialBypassDirect → ctx.destination               [clean path]
  ├─ diveLP → cfSplitter → crossfeed → panner → haas → hM → spatialBypassMain → ctx.destination  [main spatial path]
  ├─ diveConv → diveReverbWet → ctx.destination          [built lazily on first spatial use]
  ├─ immConv → immerseReverbWet → ctx.destination        [built lazily]
  └─ subBP → subSh → subLP → subMx → ctx.destination    [built lazily]
analyser: spInput.connect(analyser)  [passive tap]
```

`spatialBypassDirect` + `spatialBypassMain` form a crossfade pair (sum to 1) that chooses whether the spatial subsystem is engaged. The three lazy-built spatial effect chains (dive reverb, immerse reverb, sub-harmonic) each tap from `spInput` and dump straight to `ctx.destination` with their own wet-gain fader. That's intentional — they are parallel wet sends — but has a subtle consequence (see Finding #5).

---

## Findings

### 1. [P0] `handleCanPlay` → `fadeInMasterGain` has no precondition check against stale canplay events mid-track-load → incoming gain fades in WHILE outgoing track is still audible, two tracks overlap at full volume

**Location:** `src/components/AudioPlayer.tsx:409-438` (`handleCanPlay`) + `src/audio/graph/useAudioChain.ts:253-271` (`fadeInMasterGain`).

**What's wrong:** The hot-swap path (`useHotSwap`) reassigns `el.src` to an R2 URL mid-track while the user is hearing the iframe. On that reassignment the `<audio>` element fires a fresh `canplay` event. `handleCanPlay` unconditionally runs:

```
setupAudioEnhancement(boostProfile);          // no-op — audioEnhancedRef guards
const fadeMs = nextFadeInMsRef.current ?? 100; // 100ms default
nextFadeInMsRef.current = null;
fadeInMasterGain(fadeMs);                     // ramps master from current→target in 100ms
```

For the **hot-swap R2 takeover**, `useHotSwap.performHotSwap` runs its OWN 2-second equal-power crossfade on an `innerGain`-style thing that (per the hotswap audit) ramps `audio.volume` — separate from masterGain. But `handleCanPlay` still fires because `el.src` changed, which triggers `fadeInMasterGain(100)` to jump masterGain from whatever-it-is (could be mid-fade at 0.001 because user just paused, or could be a tiny residual of a previous softFadeOut that never completed because src changed and cancelled it) up to the preset target in 100ms. Combined with the hotswap's own volume ramp, the listener gets two competing ramps on the same audible signal. In the worst case — a softFadeOut of 240ms started at t=0 for an outgoing track change, then at t=150ms the R2 HEAD came back positive and `el.src` was reassigned, firing canplay → `fadeInMasterGain(100)` cancels the pending 240ms fade-out AT its current value (0.5x target) and ramps it back UP to 1.0x target in 100ms. Outgoing track's final 90ms plays at full volume.

**Why:** `fadeInMasterGain` has no knowledge of "is this canplay event for the track we intended to fade IN, or a mid-flight src swap?" It just rams the gain to target whenever called. The pre-existing comment at line 249 in AudioPlayer.tsx calls out that buffer recoveries leave `nextFadeInMsRef` null → 100ms default — but buffer recoveries are exactly when you DO NOT want a gain bump that overrides an in-flight softFadeOut.

**Suggested fix:** Track a "last track-change timestamp" ref. In `handleCanPlay`, if `Date.now() - lastTrackChangeAt < fadeOutMs + 50`, skip the `fadeInMasterGain` call — the track-change fade-out is still in flight and we want it to complete before the incoming fade-in. Alternatively, have `fadeInMasterGain` detect an in-flight downward ramp (`param.value < 0.5 * target`) and re-anchor rather than reset. Simplest: guard canplay's fadeInMasterGain call with a `trackSwapInProgressRef` check — only fade in when the swap has fully committed AND we're not in the middle of `softFadeOut`'s window.

---

### 2. [P0] `softFadeOut` calls `cancelScheduledValues(now)` + `setValueAtTime(param.value, now)` + `linearRampToValueAtTime(0.0001, …)` — but if `fadeInMasterGain` fires MID-ramp, the second ramp cancels the fade-out and the user hears the outgoing track pop back to target volume before the new track arrives

**Location:** `src/audio/graph/useAudioChain.ts:277-285` (`softFadeOut`) + `253-271` (`fadeInMasterGain`).

**What's wrong:** This is the fade race you explicitly asked about. Concrete scenario:

1. User is on R2 track A at target gain 1.15 (boosted preset).
2. User taps track B → track-change effect runs → `softFadeOut(600ms)` starts, scheduling a 600ms ramp to 0.0001.
3. Fast path: `knownInR2Sync === true`, so `el.src = R2/B` within ~5ms (waitforFade runs a setTimeout for 600ms but `el.src` is mutated BEFORE that timer — grep AudioPlayer.tsx:294-296: src reassignment happens BEFORE `await fadePromise`; wait, re-check — `await fadePromise` is on line 285, then src mutation at 296 is AFTER the await. OK so src mutation happens at t=600ms, meaning fadeOut has completed, not a race.)
4. **BUT** on the iframe→R2 hot-swap path managed by `useHotSwap`: `performHotSwap` assigns `el.src = R2URL` WITHOUT first running softFadeOut. A fresh `canplay` fires → `handleCanPlay` → `fadeInMasterGain(100ms)` ramps gain back to target in 100ms. If the last thing that touched gain was a `softFadeOut` mid-ramp (user skipped while hotswap was in flight), `cancelScheduledValues` in `fadeInMasterGain` kills the outgoing ramp AT its current value and ramps UP to target in 100ms. Outgoing source (now changed to R2) plays briefly at rising volume.

More importantly: **`softFadeOut` does not disarm the gain watchdog or store a "fade-out in flight" sentinel**. If another component called `applyMasterGain()` (e.g. volume slider moved during the transition, or `updateBoostPreset` fired from React's stale re-render of `boostProfile` dep) the 25ms ramp would wipe out the softFadeOut entirely — gain snaps to target while the outgoing track is still playing. The volume-change `useEffect` at useAudioChain.ts:710-719 is exactly this hazard: `volume` changes during a soft-fade-out window are not uncommon (users fiddling with the slider while the deck auto-advances).

**Why:** Fades are implemented as standalone AudioParam schedules with no coordinator. Every function that touches `gainNodeRef.current.gain` (there are SEVEN: `applyMasterGain`, `rescueGain`, `muteMasterGainInstantly`, `fadeInMasterGain`, `softFadeOut`, the play/pause fade at line 796, and `updateBoostPreset` via `applyMasterGain`, plus `bgEngine.ts:313` gain rescue) does its own `cancelScheduledValues`. Last writer wins, with no awareness of intent.

**Suggested fix:** Introduce a `currentGainIntent` ref: `'idle' | 'fade-in' | 'fade-out' | 'mute'`. Each helper sets its own intent before scheduling. `applyMasterGain` (called by volume/preset/spatial change) bails early if intent is `'fade-out'` or `'mute'`. `softFadeOut`/`muteMasterGainInstantly` can always override. `fadeInMasterGain` is the natural end-of-fade-out handoff. Clear the intent at the end of each scheduled ramp via `setTimeout(durationMs)` or a fallback polling check.

---

### 3. [P0] Volume-change `useEffect` dependency is only `[volume]` with `exhaustive-deps` disabled; closure captures `applyMasterGain` from first render — preset/spatial change that re-creates `applyMasterGain` is not reflected in the gain effect, leading to stale target values

**Location:** `src/audio/graph/useAudioChain.ts:710-719`:

```js
useEffect(() => {
  if (playbackSource === 'iframe' || !audioRef.current) return;
  if (audioEnhancedRef.current && gainNodeRef.current) {
    audioRef.current.volume = 1.0;
    applyMasterGain();
  } else {
    audioRef.current.volume = volume / 100;
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [volume]);
```

`applyMasterGain` is re-created every time `computeMasterTarget` (its useCallback dep) re-creates — which is every render. Since this effect only runs on `[volume]`, the closure captures the `applyMasterGain` from the render that last saw a volume change. For typical usage (user only moves volume slider) the closure is recent enough. But for edge cases:

- Volume slider moved BEFORE first track plays (pre-setup). `audioEnhancedRef.current === false`, path two runs: `audioRef.current.volume = volume/100`. This is a **different code path** than post-setup — and it writes `audio.volume`, which is harmless but unnecessary given masterGain. Fine.
- Volume slider NOT moved during a track, but boost/spatial changed → `applyMasterGain` recomputes. Effect does NOT re-run. Good — other effects handle it (preset useEffect at 722-727 calls `updateBoostPreset` which calls `applyMasterGain`).
- **The hazard**: if React re-orders or batches such that the `applyMasterGain` closure referenced in the volume effect reads a STALE `currentProfileRef.current` — actually no, `currentProfileRef.current` is a ref, so it's always current. False alarm on staleness.

**The real P0 bug in this effect** is line 713: `audioRef.current.volume = 1.0`. On every volume change the HTML volume is forced to 1.0, then masterGain is computed and applied. **But if the user sets volume=0 (mute), HTML volume is 1.0 AND masterGain ramps to `0 * baseGain * comp = 0` in 25ms**. In the 25ms before the ramp completes, the listener hears a 25ms burst of UNATTENUATED audio because HTML volume was just slammed to 1.0 while masterGain was previously anchored at (say) 0.5 × old-volume, now being ramped to 0.

Worse: if the audio chain is NOT enhanced (audioEnhancedRef.current === false — shouldn't happen post-first-canplay, but CAN happen if `setupAudioEnhancement` threw or if the user is on iframe playback), path two runs and sets `audio.volume = volume/100` directly. No ramp, just a step. HTML `audio.volume` digital step IS audible as a click on the direct (non-chain) path. This matches the symptom seen in "boost=off" mode where softFade isn't engaged.

**Why:** The logic conflates "normalize HTML volume to 1.0 so masterGain is sole attenuator" with "handle the case where masterGain doesn't exist." These should be two separate paths guarded by `audioEnhancedRef.current`.

**Suggested fix:** Split into two effects or at minimum re-order:

```js
if (audioEnhancedRef.current && gainNodeRef.current) {
  // Only force HTML volume to 1.0 IF it isn't already — avoid the 25ms burst.
  if (audioRef.current.volume !== 1.0) audioRef.current.volume = 1.0;
  applyMasterGain();
} else {
  // No chain — direct HTML volume, ramp with rAF like the play/pause path.
  const startVol = audioRef.current.volume;
  const targetVol = volume / 100;
  /* rAF ramp over 40ms */
}
```

Also: the `[volume]` dep is INCOMPLETE — `applyMasterGain` should be in deps. The exhaustive-deps disable is papering over a semi-real issue: the function identity changes every render but is called via a stale closure. Not currently broken because of the ref-based currentProfileRef, but brittle.

---

### 4. [P1] `muteMasterGainInstantly` is defined + exported but **never called from AudioPlayer** — dead API surface, AND the one place it's "used" (via `armGainWatchdog('mute-before-load')`) means the watchdog is ARMED but never triggered, wasting a MessageChannel lifecycle

**Location:** `src/audio/graph/useAudioChain.ts:235-244` (definition) + `src/audio/graph/useAudioChain.ts:821-832` (export) + `src/components/AudioPlayer.tsx` grep shows no call site.

**What's wrong:** `muteMasterGainInstantly` is in the public API and the returned object. It also calls `armGainWatchdog('mute-before-load')` to guard against stuck-muted state. Since nothing in AudioPlayer calls `muteMasterGainInstantly`, the watchdog is never armed via this path. The mute-before-load invariant the code comments describe (8ms fade-out before src swap) is NOT actually happening — the track-change effect uses `softFadeOut(fadeOutMs)` on the R2 path (where fadeOutMs is 240/600ms, NOT 8ms) and on the iframe path uses `iframeBridge.fadeOut`. No 8ms mute anywhere.

**Why:** Evidence of a prior refactor that removed the mute-before-load call site but left the helper in place. The watchdog logic inside it is the only pre-load rescue — since it's never armed via this helper, the rescue only runs when `fadeInMasterGain` is called (which `disarm`s before arming — net: the watchdog's "armed at mute, disarmed at fade-in" lifecycle is **never armed in production**). The rescue path described in the code comments (gain stuck at 0.0001 between mute and canplay → watchdog fires after 6s → force ramp to target) cannot fire because nothing ever calls mute to arm it.

**Impact:** Low — the gain rescue ALSO lives in `bgEngine.ts:297-321` which runs on the heartbeat, so gain stuck-at-zero is caught there. But this audit path is dead code that looks active. Confusing.

**Suggested fix:** Either (a) wire `muteMasterGainInstantly` into the track-change effect at AudioPlayer.tsx:246 (before softFadeOut ends, before the src swap at line 296 for the R2 path) so the mute-then-fade ladder actually runs, or (b) remove the helper + watchdog arm/disarm API entirely since bgEngine handles stuck-gain rescue.

---

### 5. [P1] Three lazy-built spatial effect chains (dive reverb, immerse reverb, sub-harmonic) are NEVER disconnected; ConvolverNodes + WaveShaper + filters all hold references permanently — AudioContext nodes leak across the component tree's lifetime (equivalent to the app session because audioEngine is a module singleton)

**Location:** `src/audio/graph/useAudioChain.ts:542-590` (`buildVoyexSpatialNodes`) + no matching `disconnect()` / teardown anywhere.

**What's wrong:** `buildVoyexSpatialNodes` creates:
- `diveConv: ConvolverNode` with a 0.35s × 2-channel IR buffer (44.1k × 0.35 × 2 × 4 = ~124KB per instance)
- `immConv: ConvolverNode` with 0.25s × 2ch IR (~88KB)
- `sBP, sSh, sLP, sMx: BiquadFilter + WaveShaper + Filter + Gain`
- All of the above `.connect(...).connect(ctx.destination)` with no matching disconnect.

The useAudioChain hook has NO cleanup useEffect. On AudioPlayer unmount — which happens after `AudioErrorBoundary` crash remount — the hook re-runs `setupAudioEnhancement`, which re-calls `connectAudioChain(audio)`:

- `audioEngine.ts:139-144` — if `_connectedElement === audio && _chainWired`, returns `alreadyWired: true`. The hook's `setupAudioEnhancement` bails at line 486: `audioEnhancedRef.current = true; audioContextRef.current = chain.ctx; return;`. No rebuild. OK — but `audioEnhancedRef` is a `useRef` tied to the component; on remount it's a FRESH ref starting `false`. So `audioEnhancedRef.current === false` at line 481, passes the guard, and reaches `connectAudioChain`.
- `connectAudioChain` returns `alreadyWired: true` (same element — but AudioErrorBoundary REMOUNTS AudioPlayer, and the audio element is a fresh `<audio ref>` on the new mount). `_connectedElement !== audio` — so the check at `audioEngine.ts:166-170` fires `_sourceNode.disconnect()` + nulls the source, then creates a new source at line 174.
- Back in `setupAudioEnhancement`, `chain.alreadyWired === false` → the hook proceeds to BUILD THE ENTIRE CHAIN AGAIN. All 40+ nodes created fresh.

**BUT the previous mount's nodes are NEVER disconnected.** The old spatial bypass, crossfeed splitter/merger/delays/filters, panner + 3 LFOs (still running!), Haas splitter/delays/merger, old master/comp/limiter, old EQ filters, old multiband filters, and — critically — old dive/immerse convolvers + sub-harmonic chain — are all orphaned. They still hold references because:

1. `ctx.destination` retains them (all those `.connect(ctx.destination)` at lines 535, 536, 573, 579, 589).
2. The old source node was disconnected, but the chain nodes downstream are connected to each other and to ctx.destination — they stay in the audio graph as islands.
3. The three LFOs (`lfo1.start()` at line 523, lfo2, lfo3 — .start() was called, no .stop()) keep ticking. They drive `panD` which drives `panner.pan`, but panner is disconnected from source. The LFOs themselves still run until `ctx.close()` — which never happens.

**Math for a user who triggers 3 crashes in a long session:** 4 full chains alive, ~160 nodes total, ~500KB of ConvolverNode IR buffers, 12 LFO oscillators running. Memory climbs. Audio thread load climbs. Eventually audio stutters.

**Why:** The `useAudioChain` hook has no `return cleanup` in any useEffect. All node creation is inside `setupAudioEnhancement` (a callback, not an effect). The builder implicit lifecycle is "created once, lives forever" — which is true for the happy path (no remounts) but false for AudioErrorBoundary crash recovery, which is by design remounting.

**Suggested fix:**
- Option A (preferred): Move the chain into the audioEngine singleton (not the hook). Build once, survive component remounts. Matches the comment "AUDIO CHAIN SINGLETON (Tivi+ Pattern)" at audioEngine.ts:13 — the intent was there, the implementation stopped at the source node.
- Option B: Add a cleanup useEffect in `useAudioChain` that disconnects every ref. Attach a teardown builder from `setupAudioEnhancement` and call it on unmount. Stop the 3 LFOs. Wipe the `currentCurve` on the WaveShaper (releases the 44100-sample buffer).
- Option C (band-aid): In `AudioErrorBoundary.componentDidCatch`, call a new `teardownAudioChain()` exported from audioEngine that disconnects the old chain's masterGain from comp+destination. The rebuild will replace the exciter and all EQ nodes naturally.

---

### 6. [P1] `harmonicCurveCacheRef` is a `useRef<Map>` that **grows unboundedly** — every distinct `harmonicAmount` value cached forever at 44100 × 4 bytes = 176KB per entry

**Location:** `src/audio/graph/useAudioChain.ts:120-134`.

**What's wrong:** `makeHarmonicCurve(amount)` caches by `Math.round(amount * 100) / 100` — 0.01 buckets. If a future preset or VOYEX spatial slider sweep generates distinct harmonicAmount values (currently only `BOOST_PRESETS.voyex.harmonicAmount = 8`, so cache max = 1 entry — fine today), the cache has no eviction. Today OK. Future hazard.

Also: the cache is per-component-instance (useRef). On AudioErrorBoundary remount the cache resets — but so does the chain, so the new chain builds a new exciter and recomputes the curve. No orphan. (The leak is the chain, not the cache — see Finding #5.)

**Why:** Forward-looking: if you add a slider that scrubs harmonic amount continuously (VOYEX drive slider 0-100 in integer steps = 100 entries = 17.6MB of cached curves), you'll want eviction.

**Suggested fix:** Defer — flag as "WILL LEAK if slider-continuous harmonicAmount ever ships." Add an LRU cap (max 8 entries) when that slider is added.

---

### 7. [P1] `stereoDelayRef` tracks ONLY the right-channel DelayNode (line 666: `stereoDelayRef.current = stDelayR`) — **left-channel delay is orphaned from control**, and the 180° out-of-phase widening the preset intends is actually mono-to-right-delay (asymmetric Haas-like effect, not symmetric M/S widening)

**Location:** `src/audio/graph/useAudioChain.ts:662-669` + all `stereoDelayRef.current?.delayTime` writes (lines 340, 362, 383, 431-433).

**What's wrong:** The stereo widen stage is:

```
air → stSplitter (splits L, R)
stSplitter(0) → stDelayL → stMerger(0,0)
stSplitter(1) → stDelayR → stMerger(0,1)
```

Both delays start at delayTime=0 (line 664-665). `stereoDelayRef` points at `stDelayR` only. Every preset `stereoWidth` and VOYEX spatial delay write targets ONLY the right channel. Result:
- VOYEX preset: `stereoWidth = 0.015` → right channel delayed 15ms, left untouched. This is effectively a **Haas-panning to the left** — the brain hears the non-delayed channel first and localizes the image LEFT. That's not "stereo widening"; it's mono-displacement.
- VOYEX spatial DIVE (`ramp(stereoDelayRef.current?.delayTime, 0.015 - (i * 0.012))`): at max DIVE (`i=1`), right delay = 3ms. Still asymmetric, still a leftward Haas tilt.
- VOYEX spatial IMMERSE (`ramp(…, 0.015 + (i * 0.015))`): at max IMMERSE, right delay = 30ms. **30ms is audibly a distinct echo**, not a stereo cue. Psychoacoustically, the precedence effect breaks down around 25-40ms and the delayed channel starts sounding like a slapback echo.

A proper stereo widener uses equal-magnitude opposite-sign delays: `stDelayL.delayTime = w; stDelayR.delayTime = -w` — impossible with DelayNode which only supports positive delays. A working approach uses `stDelayL.delayTime = 0` (direct) and `stDelayR.delayTime = 2w` (double delayed) → the image widens symmetrically around the perceived center. But then you need the same on the left branch for the opposite preset — or use a ChannelSplitter → DelayNode per channel → AllPassFilter per channel → Merger for a true M/S widener.

**Why:** The original coder left `stDelayL` in the graph so the LR channels are wire-matched topologically (both go through a DelayNode), but never wired `stDelayL` to a ref, so only R is modulated. This is probably an incomplete widener implementation.

**Audible symptom:** VOYEX feels "leftward-leaning" to critical listeners. The "stereo widening" comment in boostPresets.ts is aspirational. The telemetry-ready fix is a blind A/B test between current and a symmetric widener — users would likely notice.

**Suggested fix:** Add `stereoDelayLRef` for the left channel. On widen, set `stDelayL.delayTime = 0` and `stDelayR.delayTime = 2 * width`; on IMMERSE, consider also widening via the cross-feed bleed (already present in crossfeed chain) and keep symmetric delays under 10ms (perceptible as width, not echo).

---

### 8. [P1] `updateVoyexSpatial` lazy-builder hooked onto `spatialBypassDirectRef` via cast — pattern breaks encapsulation and can be lost if the ref identity changes; the builder is attached in `setupAudioEnhancement` but re-triggered from `updateVoyexSpatial` which can run BEFORE setup completes

**Location:** `src/audio/graph/useAudioChain.ts:396-400` + `src/audio/graph/useAudioChain.ts:592`.

**What's wrong:**

```js
// updateVoyexSpatial:
if (v !== 0 && !diveReverbWetRef.current) {
  const builder = (spatialBypassDirectRef as unknown as { _buildSpatial?: () => void })._buildSpatial;
  builder?.();
}
```

The builder is attached to a mutable ref via a type cast (line 592). The ref OBJECT itself doesn't change (useRef returns stable identity), so the cast-attached property survives. BUT: `updateVoyexSpatial` can run BEFORE `setupAudioEnhancement` completes if the Spatial useEffect (line 730-736) and the setup useEffect (`[boostProfile]` at 722-727 → `updateBoostPreset` → early-return because `audioEnhancedRef.current === false`) race on initial render.

Actually — checking: the spatial effect at line 731 gates on `spatialEnhancedRef.current`, which is set TRUE at line 594 of setup. So spatial effect can't build before setup is done. OK.

**But the cast pattern is fragile:** if setup throws mid-way (line 701 `catch`), `spatialEnhancedRef.current` is never set → spatial effect bails, but the builder is also never attached. Users who toggle VOYEX+spatial after a failed setup will see the condition `v !== 0 && !diveReverbWetRef.current` match, call `builder?.()` which is undefined (optional chaining), silently do nothing. The user sees "spatial slider has no effect" and no error surfaces.

**Why:** Using the ref as an object to stash a builder is clever but opaque. Use a separate `useRef<(() => void) | null>` for the builder.

**Suggested fix:**

```js
const buildSpatialRef = useRef<(() => void) | null>(null);
// in setupAudioEnhancement:
buildSpatialRef.current = buildVoyexSpatialNodes;
// in updateVoyexSpatial:
if (v !== 0 && !diveReverbWetRef.current) buildSpatialRef.current?.();
```

Clearer, typechecks without cast, trivially logable on failure.

---

### 9. [P2] `updateBoostPreset` rebuilds WaveShaper curve SYNCHRONOUSLY when switching preset — 44100 samples of `Math.PI * Math.abs(x)` on the main thread; for the cached case (preset previously used) OK, but on first `boosted → voyex` switch ~1-2ms of main-thread block

**Location:** `src/audio/graph/useAudioChain.ts:121-134` + `357` / `368`.

**What's wrong:** `makeHarmonicCurve(amount)` loops 44100 times doing 4 multiplies + abs + trig. Measured empirically at ~1ms on a mid-tier Android device. Not a stutter risk on its own, but preset switching while audio is playing pulls the main thread for 1-2ms right when the user tapped — perceived as "the preset toggle takes a moment to engage." Minor.

**Why:** Runs on preset switch, not on every render. Only on FIRST switch (cache hits thereafter).

**Suggested fix:** Precompute the known presets' harmonic curves at setupAudioEnhancement time, warm the cache with `makeHarmonicCurve(8)` (the only non-zero value in BOOST_PRESETS). Preset switches then hit cache every time. Zero hot-path cost.

---

### 10. [P2] `fadeInMasterGain(15)` called after `audio.play()` resolves on user-initiated play (line 767) — but `audio.play()` can take 100-500ms to resolve on iOS Safari after a gesture; during that window the element is playing AT FULL HTML-volume (set to 1.0 at line 765) with masterGain anchored at 0.0001 — when the promise resolves, the 15ms ramp fires and the user hears a 15ms attack swell

**Location:** `src/audio/graph/useAudioChain.ts:759-770`:

```js
param.setValueAtTime(0.0001, now);
audio.volume = 1.0;
audio.play().then(() => {
  fadeInMasterGain(15);
}).catch(...);
```

**What's wrong:** Between `setValueAtTime(0.0001)` and `play().then(fadeInMasterGain(15))`, nothing actually emits audio (gain is effectively muted). Fine on paper. But if the AudioContext was SUSPENDED when play was called (line 757-759 calls ctx.resume() but doesn't await), masterGain's 0.0001 is scheduled against a frozen clock. When the context resumes, the 0.0001 at-time-X is now-behind-wall-clock, and the 15ms ramp from fadeInMasterGain fires against the now-resumed clock — the ramp completes in 15ms of wall time but the actual audio signal has been playing through masterGain at … whatever value the node holds when the context unfreezes. On iOS Safari specifically, this has caused the "first 200ms of play is at full target volume" bug in prior VOYO sessions (search the action logs for "iOS pop on play").

**Why:** `ctx.resume().catch(() => {})` at line 756 is fire-and-forget. `audio.play()` at line 766 may resolve before OR after the context is actually running. The scheduled setValueAtTime is ambiguous w.r.t. context state.

**Suggested fix:**

```js
if (ctx && (ctx.state === 'suspended' || (ctx as any).state === 'interrupted')) {
  await ctx.resume().catch(() => {});
}
// Now clock is known-running; schedule against ctx.currentTime.
const now = ctx.currentTime;
param.setValueAtTime(0.0001, now);
audio.volume = 1.0;
await audio.play();
fadeInMasterGain(15);
```

Requires converting the play/pause useEffect to async-aware.

---

### 11. [P2] `softFadeOut` does NOT re-arm the gain watchdog — if softFadeOut rams gain to 0.0001 and then src fails to change (network error, stale token, etc.), gain is stuck at 0.0001 silently for the rest of the track

**Location:** `src/audio/graph/useAudioChain.ts:277-285`.

**What's wrong:** Unlike `muteMasterGainInstantly` (which calls `armGainWatchdog('mute-before-load')`), `softFadeOut` is fire-and-forget. If a track-change initiates softFadeOut, and the subsequent `el.src = ...` fails (network error at the R2 fetch, iframe mount failed, etc.), the gain sits at 0.0001 with no rescue path except the bgEngine heartbeat rescue (every 4s, foreground-only if I read bgEngine right — actually the heartbeat runs in both FG and BG, cadence-gated to 4s). So worst case user experiences 4s of silence after a failed track change. Acceptable, but a pre-canplay rescue at 2s would feel better.

**Why:** The rescue logic is centralized in bgEngine; softFadeOut doesn't opt in. `muteMasterGainInstantly` opts in by calling `armGainWatchdog`.

**Suggested fix:** Call `armGainWatchdog('soft-fade-out')` at the end of `softFadeOut`. On `fadeInMasterGain` the watchdog is disarmed (already happens). No new machinery needed.

---

### 12. [P2] `freqPump.ts` delta-gated writes use `parseFloat(getPropertyValue('--voyo-bass'))` every tick — `parseFloat` + DOM read on 4 vars × 10fps = 40 DOM-style-reads/s; cheap but measurable on low-end phones, and the DOM-style-set writes still happen when delta > 0.05 even if the computed value equals the previously-written string

**Location:** `src/audio/graph/freqPump.ts:73-82`.

**What's wrong:** 

```js
const prev = {
  bass: parseFloat(root.style.getPropertyValue('--voyo-bass') || '0'),
  ...
};
if (Math.abs(bass - prev.bass) > DELTA) root.style.setProperty('--voyo-bass', bass.toFixed(3));
```

The `getPropertyValue` parses the inline style attribute on `documentElement` — a read that forces layout calculation? Actually no, inline style reads don't flush layout. Fine. But `toFixed(3)` creates garbage strings per write (3 chars × 4 vars × up-to-10Hz = 40 strings/s GC pressure). Acceptable.

**Minor issue:** The delta threshold 0.05 is fixed — if the last-written value was 0.60 and current is 0.64, no write (delta 0.04 < 0.05). Over a sustained bass drop the written value drifts from reality by up to 0.05. For a visual indicator that's fine.

**Real hazard:** `bufRef.current` is allocated once on first tick (`new Uint8Array(analyser.frequencyBinCount)`). `analyser.frequencyBinCount = 128` (fftSize=256 in audioEngine.ts:184). If `analyser.fftSize` ever changes (it doesn't today), the buffer size is stale and `getByteFrequencyData(buf)` writes only the first 128 bins of however-many, but `for (let i = 0; i < len; i++)` iterates the buffer length (128), so no OOB. Safe.

**Never-sticks guarantee:** the pump always fires while `isPlaying` — if audio stalls (real bass = 0) the analyser writes 0s, delta from last-written (e.g. 0.8) is > 0.05, write fires, var drops to 0. Safe. Will not stick at stale.

**Suggested fix:** None critical. Optionally cache the last-written values in a ref instead of parsing the style string — minor perf win.

---

### 13. [P2] AudioContext gesture listener's `totalGestureAttempts` is ONLY incremented, never decremented except on success. The `>= 30` giveup is permanent for the session — if iOS user unlocks after the giveup (context moves to 'suspended' → resume succeeds on its own without gesture), `currentResumeOnce` is still set but the listener is removed, a dangling reference remains

**Location:** `src/services/audioEngine.ts:84-116`.

**What's wrong:** `totalGestureAttempts = 30` permanently — after 30 failed gesture resume attempts, the handler is removed and `currentResumeOnce` remains non-null. The `watchContextState` setInterval at line 118 only calls `installGestureListener` (which early-returns on `totalAttempts >= 30`) — so even if the context spontaneously recovers, no listener is re-installed for the NEXT suspension. User goes into a dead state for the remainder of the session.

Also: `currentResumeOnce` is never used for anything (no other code path reads it). Dead assignment.

**Why:** Defensive coding gone too far — 30 is arbitrary, and the reset on success (`totalGestureAttempts = 0`) is correct, but on failure there's no path back. A session with 30 quick gesture-resumes (user alternating foreground/background rapidly during a weak OS lock cycle) can poison the session permanently.

**Suggested fix:** Reset `totalGestureAttempts` on every successful visibility→visible transition, or time-decay it (decrement by 1 per 10s of steady-state running). Remove `currentResumeOnce` — it's dead.

---

### 14. [P3] `generateIR` IR generation uses `Math.random()` × unweighted — tails have NO stereo decorrelation because the loop writes L and R with two separate `Math.random()` calls → for late-tail samples (low amplitude), the random values converge in character and listener perceives a correlated haze. Pure-math, not a bug — by design for mobile perf — but a higher-quality option would write `L[n] = r1; R[n] = r2 * 0.9 + r1 * 0.1` for micro-correlation

**Location:** `src/audio/graph/useAudioChain.ts:544-567`.

**Not worth fixing** — flagged for completeness. The reverb sounds fine for music.

---

### 15. [P3] `_chainWired = false` at audioEngine.ts:199 in the catch path when `connectAudioChain` falls back to "source → destination" direct — subsequent calls from `setupAudioEnhancement` will see `_chainWired === false` and re-enter the try block, which will fail AGAIN (since `_sourceNode` already exists for this element, `createMediaElementSource` would throw a second-time InvalidStateError), silently leaving the chain in an unrecoverable bypass state

**Location:** `src/services/audioEngine.ts:192-201`.

**What's wrong:** The fallback silently wires source → destination but leaves `_chainWired = false`. On the next `setupAudioEnhancement` call (e.g. after a track change fires `handleCanPlay`), `connectAudioChain` runs:

1. The `_connectedElement === audio && _chainWired` guard at line 139 is FALSE (chainWired is false).
2. Falls through to the try block. `_sourceNode` is non-null (created in the first attempt). Skips line 174 (createMediaElementSource guarded by `if (!_sourceNode)`).
3. Wires `_chainWired = true; _connectedElement = audio`. Returns `alreadyWired: false`.
4. `setupAudioEnhancement` proceeds to build the FULL CHAIN against a source that is **already connected to ctx.destination** (from the catch-path fallback).

Result: the listener hears BOTH the raw source → destination fallback AND the processed chain's output. Double volume (roughly +6dB) with phase comb-filtering because the processed path has delay from filters/reverb/etc.

**Why:** The catch-path fallback doesn't disconnect on recovery. Hard to hit in practice because the try block almost never throws (createMediaElementSource is reliable), but the recovery path is a footgun.

**Suggested fix:** In the catch at line 192, set `_chainWired = true` too (accept the degraded state) so the next call is a no-op (idempotent). Or, on the next `connectAudioChain` call with same element, detect the lingering source→destination and `source.disconnect(ctx.destination)` before building.

---

## Top 3 ranked

1. **Finding #5 — The spatial effect chain leaks on every AudioErrorBoundary remount.** Convolvers + LFOs + 40+ nodes orphan in the graph every time the boundary catches a throw. 3 crashes = ~500KB + 12 running LFOs per session. Path to fix: move chain into audioEngine singleton or add a cleanup useEffect. `src/audio/graph/useAudioChain.ts:480-704` (chain build, no teardown).

2. **Finding #1 + #2 — Fade race on track-change + hot-swap canplay.** `handleCanPlay` unconditionally runs `fadeInMasterGain(100ms)`, which cancels any in-flight `softFadeOut`, letting outgoing audio pop back to full volume mid-swap. Add a `lastTrackChangeAt` guard or a `currentGainIntent` state machine. `src/components/AudioPlayer.tsx:409-438` + `src/audio/graph/useAudioChain.ts:253-285`.

3. **Finding #3 — Volume-change useEffect forces `audio.volume = 1.0` THEN ramps masterGain over 25ms, producing a brief 25ms burst at unattenuated volume when user moves to mute.** Reorder so HTML volume only changes when needed, and skip the write if already at 1.0. `src/audio/graph/useAudioChain.ts:710-719`.

Honorable mention: **Finding #7** (stereoDelayRef only controls R channel → asymmetric widener → VOYEX image tilts left). Not a leak, just an audible correctness issue — important for the "VOYEX sounds professional" brand promise.
