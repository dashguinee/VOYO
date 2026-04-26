# Audio Pipeline Audit (Audit 2)

Department: AUDIO. Files: `AudioPlayer.tsx`, `bgEngine.ts`, `freqPump.ts`, `useAudioChain.ts`, `audioEngine.ts`, `voyoStream.ts`, `r2Probe.ts`, `useHotSwap.ts`, `iframeBridge.ts`, `usePlayback.ts`, `downloadStore.ts`.

Each finding verified with file:line + the exact code excerpt that proves the bug. Glitch / race / leak only.

---

## [P1] Hotswap leaves HTML volume at storeVol → permanent ~30% volume drop after every iframe→R2 swap

**File:** src/player/useHotSwap.ts:246 (in concert with src/audio/graph/useAudioChain.ts:768-782)

**What:**
```ts
// useHotSwap.ts line 246, AFTER the equal-power crossfade completes:
el.volume = usePlayerStore.getState().volume / 100;     // ← writes 0.7 (e.g.) to HTML volume
usePlayerStore.getState().setPlaybackSource('r2');
```

The volume-sync effect that would normally enforce `HTML volume = 1.0` runs ONLY when the `volume` Zustand state changes:
```ts
// useAudioChain.ts:768
useEffect(() => {
  if (playbackSource === 'iframe' || !audioRef.current) return;
  if (audioEnhancedRef.current && gainNodeRef.current) {
    if (audioRef.current.volume !== 1.0) audioRef.current.volume = 1.0;   // ← only on volume change
    applyMasterGain();
  } ...
}, [volume]);
```

**Why it's a bug:** When the audio chain is enhanced (the normal R2 case), the contract is "HTML volume = 1.0, masterGain handles attenuation." After the hotswap, `el.volume` is left at `storeVol` (e.g. 0.7). The volume-sync effect does NOT re-fire on `playbackSource` change. Meanwhile `handleCanPlay` → `fadeInMasterGain` ramps masterGain to its full target (`vol/100 × preset`) which assumes HTML=1.0. Net amplitude becomes `0.7 × (vol/100) × preset` instead of `(vol/100) × preset` — multiplicatively quieter. The user hears post-hotswap audio measurably quieter than R2-direct playback of the same track, until they touch the volume slider.

**Repro:** Tap a non-R2 search result → iframe-as-audio engages → wait ~11s for R2 to land → hot-swap fires → audio is noticeably quieter than the next R2-direct track of the same volume setting.

**Fix sketch:** In `useHotSwap.ts:246`, write `el.volume = 1.0` (the chain-enhanced contract) instead of `storeVol`, and let masterGain own all attenuation. Also call `applyMasterGain()` defensively at swap-end.

---

## [P1] bgEngine `statechange` listener never attaches — audioContextRef is null at first render and deps are stable

**File:** src/audio/bg/bgEngine.ts:229-247

**What:**
```ts
useEffect(() => {
  const ctx = audioContextRef.current;
  if (!ctx) return;                                  // ← always true on first run
  const handleCtxState = () => { ... };
  ctx.addEventListener('statechange', handleCtxState);
  return () => ctx.removeEventListener('statechange', handleCtxState);
}, [audioRef, audioContextRef]);                     // ← stable RefObject identities — never re-run
```

**Why it's a bug:** AudioContext is created lazily inside `setupAudioEnhancement` (called from `handleCanPlay` AFTER the first track loads), so on AudioPlayer mount `audioContextRef.current === null`. The effect early-returns. The deps are stable RefObject identities — React never re-runs this effect. The entire iOS-`interrupted` / Android-`suspended` "wake on statechange" path documented in the comments above (lines 224-228) is dead code. Recovery falls back to the heartbeat 4-second tick — exactly the slower path this listener was supposed to front-run. The audioEngine singleton has its own `_audioCtx.onstatechange` (audioEngine.ts:167) which DOES fire and triggers the gesture-listener install, but the bgEngine handler that resumes ctx + kicks the audio element is never wired.

**Repro:** Mount AudioPlayer with no track loaded. `getEventListeners(audioContextRef.current)` returns nothing for `statechange` from bgEngine. Load a track → still nothing wired. Lock screen on iOS — `interrupted` event fires, only audioEngine's singleton handler runs (resume + gesture install); bgEngine's "play element + resume ctx on resume" never invoked. Recovery comes from heartbeat ~4s later.

**Fix sketch:** Bind statechange at the audioEngine singleton layer (where the ctx is owned) and fan out to bgEngine via a callback. OR add a bumping state value (`ctxReadyTick`) that flips when `setupAudioEnhancement` finishes wiring `audioContextRef`, and include it in the effect's deps so it re-runs.

---

## [P1] bgEngine statechange listener orphans the OLD ctx after `teardownAudioChain` — the NEW ctx gets no listener

**File:** src/audio/bg/bgEngine.ts:194-205 (compounds Finding #2)

**What:**
```ts
if (ctx && ctx.state === 'closed') {
  devWarn('[BG] AudioContext closed on FG return — tearing down chain for re-wire');
  trace('ctx_closed_teardown', usePlayerStore.getState().currentTrack?.trackId, { hidden: document.hidden });
  try { teardownAudioChain(); } catch {}     // disconnects source; next connectAudioChain creates a NEW _audioCtx
  // The useAudioChain hook will re-wire on next render cycle.
}
```

`audioEngine.ts:148-180` then constructs a fresh `_audioCtx`. The bgEngine statechange effect (line 229) captured the *previous* ctx in `const ctx = audioContextRef.current` and won't re-run because its deps `[audioRef, audioContextRef]` are stable RefObjects.

**Why it's a bug:** Even if Finding #2 is fixed for first-mount, the long-BG iOS/Safari `state === 'closed'` recovery path swaps in a new AudioContext mid-session and the bgEngine handler stays bound to the dead one (or stays unbound from Finding #2). Statechange events on the new ctx vanish into the void. The dead listener is also a small leak — held by the closed ctx until GC.

**Repro:** Background the app long enough for iOS to close the AudioContext (varies, several minutes). Return to FG — `ctx_closed_teardown` trace fires, `useAudioChain` rebuilds. Lock screen again — the freshly-built ctx never receives bgEngine's wake-on-statechange.

**Fix sketch:** Same as Finding #2 — either move statechange ownership to the audioEngine singleton (where ctx lifecycle lives) or make `useAudioChain` call a "ctxRebuilt" callback so bgEngine can re-attach.

---

## [P2] `freqPump` cleanup doesn't reset CSS vars — visualizer freezes at last value on unmount

**File:** src/audio/graph/freqPump.ts:29-86

**What:**
```ts
useEffect(() => {
  if (!isPlaying) {
    const root = document.documentElement;
    root.style.setProperty('--voyo-bass', '0');
    root.style.setProperty('--voyo-mid', '0');
    root.style.setProperty('--voyo-treble', '0');
    root.style.setProperty('--voyo-energy', '0');
    return;
  }
  ...
  return () => cancelAnimationFrame(rafId);     // ← only cancels rAF; CSS vars left at last frame's value
}, [isPlaying]);
```

**Why it's a bug:** When `isPlaying` flips true→false, the next effect invocation resets the CSS vars (the early return). When AudioPlayer unmounts WHILE isPlaying is still true (AudioErrorBoundary remount, route change), only the `cancelAnimationFrame` cleanup runs — CSS vars stay at whatever the last pump frame wrote (e.g. `--voyo-bass: 0.84`). Every visualizer reading these vars then freezes on a non-zero value until next play.

**Repro:** Force AudioPlayer remount during heavy bass (throw a controlled error inside AudioPlayer to trip the boundary). Visualizer locks at last bass value until next play tick.

**Fix sketch:** Move the CSS reset into the cleanup function: `return () => { cancelAnimationFrame(rafId); ['--voyo-bass','--voyo-mid','--voyo-treble','--voyo-energy'].forEach(k => document.documentElement.style.setProperty(k, '0')); };`

---

## [P2] `useAudioChain` unmount cleanup does not cancel `playPauseRafRef`

**File:** src/audio/graph/useAudioChain.ts:805-880, 897-924

**What:**
```ts
const playPauseRafRef = useRef<number | null>(null);
// ... inside the play/pause effect (no-chain fallback path):
const step = () => {
  const t = Math.min((performance.now() - start) / 60, 1);
  if (audioRef.current) audioRef.current.volume = t * target;
  if (t < 1) playPauseRafRef.current = requestAnimationFrame(step);
  else playPauseRafRef.current = null;
};
playPauseRafRef.current = requestAnimationFrame(step);
```

The unmount cleanup at line 897-924 stops LFOs, disconnects nodes, clears watchdog timers — but does NOT touch `playPauseRafRef.current`. The only cancellation is the next-tick play/pause re-run at line 810.

**Why it's a bug:** If AudioPlayer unmounts while a 60ms volume ramp is in flight, the rAF chain keeps writing `audio.volume = t * target` against the singleton audio element from a torn-down hook. If the new mount re-enables the chain (HTML volume forced to 1.0), the stale rAF chain briefly fights it with a 0.x write before the rAF chain finishes.

**Repro:** Play, then near-instantly trigger AudioErrorBoundary (programmatic error). Brief volume jitter on the way down/up.

**Fix sketch:** Add to the unmount cleanup at line 897:
```ts
if (playPauseRafRef.current != null) {
  cancelAnimationFrame(playPauseRafRef.current);
  playPauseRafRef.current = null;
}
```

---

## [P2] `audioEngine.ts` `focus` listener uses inline arrow — unremovable; permanent module-singleton

**File:** src/services/audioEngine.ts:77-78

**What:**
```ts
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('focus', () => resumeCtx('focus')); // Also immediate
```

**Why it's a bug:** Both listeners are module-init and never removed. In production this is acceptable (singleton lifecycle = page lifecycle). The `focus` arrow, however, is anonymous — even an explicit `removeEventListener` could not target it, so the listener is permanently bound. This is a fragility pattern, not a runtime leak in prod, but it WILL leak across HMR cycles in dev (each module reload stacks another listener).

**Repro:** In dev, edit `audioEngine.ts` 5 times to trigger HMR; `getEventListeners(window).focus.length` grows to 6.

**Fix sketch:** Hoist to a named function: `const onFocus = () => resumeCtx('focus'); window.addEventListener('focus', onFocus);` so it can at least be cleaned up if needed.

---

## [P2] `useHotSwap` canplay-wait setTimeout(2500) never cancelled on success — wasted timer per hotswap

**File:** src/player/useHotSwap.ts:170-180

**What:**
```ts
const canplayFired = await new Promise<boolean>((resolve) => {
  const onReady = () => {
    el.removeEventListener('canplay', onReady);
    if (el.src !== ourSrc || _swapToken !== myToken) { resolve(false); return; }
    resolve(true);
  };
  el.addEventListener('canplay', onReady);
  setTimeout(() => { el.removeEventListener('canplay', onReady); resolve(false); }, 2500);  // ← never cleared
});
```

**Why it's a bug:** When canplay fires fast (the happy path) the setTimeout is left armed. It fires 2.5s later, calls `removeEventListener` (no-op — already removed), and `resolve(false)` (no-op — promise already settled). Functionally harmless but wastes one queued task per hotswap. Under heavy hotswap activity (long playlist of cold tracks), microtask queue grows linearly with no upper bound until each timer fires.

**Repro:** Trigger 30 hotswaps inside 30s. DevTools "Performance" → see 30 dead timer callbacks pending up to 2.5s.

**Fix sketch:**
```ts
const tid = setTimeout(...);
const onReady = () => { clearTimeout(tid); el.removeEventListener('canplay', onReady); ... };
```

---

## [P2] `r2Probe.ts` cache-buster `_v=Date.now()` defeats edge worker cache for ALL probes

**File:** src/player/r2Probe.ts:43-48

**What:**
```ts
const bust = Date.now();
const res = await fetch(`${R2_AUDIO_BASE}/${ytId}?q=high&_v=${bust}`, {
  method: 'HEAD',
  signal: ctrl.signal,
  cache: 'no-store',
});
```

**Why it's a bug:** This was deliberately added to defeat stale 404 responses (the comment explains). But it ALSO defeats the edge cache for every successful 200 — every probe hits R2's origin. With 2s polling in `useHotSwap` (line 36) plus per-track-change probes plus search fast-path probes, a single user listening for 5 minutes can rack up 100+ origin hits where a 30-60s edge cache would absorb most. Not a glitch/race/leak per se, but the "every probe is a unique URL" pattern means the dedup map at line 18 (`_inflight`) is the ONLY cache layer, expiring 2s after resolution. Subsequent probes within a track-change boundary all re-hit origin.

**Repro:** Tap 10 cards in a row (R2-known set). Network panel shows 10 distinct HEAD requests, all hitting R2 worker (no `cf-cache-status: HIT`).

**Fix sketch:** Distinguish positive and negative responses — only cache-bust on probes for tracks the queue says are still 'pending'/'extracting'. Once `markR2Known(ytId)` has fired, subsequent probes can drop the `_v=` and trust the edge cache, since 200 responses for a known-good ID are safe to re-use.

---

End of findings. Top 8 reported. Re-verified suspects that I CLEARED before reporting (do not represent bugs):
- Track-change concurrent effect race — `changeToken`/`isStale` correctly guards every async write to `el.src`/`setSource`/`logPlaybackEvent`.
- `engageSilentWav` before R2 probe — call site is inside the IIFE after `await fadePromise`, which itself bails on `isStale()`.
- `synthetic-ended` firing while silent WAV is engaged — `el.src !== silentKeeperUrlRef.current` guard is present (bgEngine.ts:367).
- `handleEnded` vs heartbeat silent-paused kick — `!isLoadingTrackRef.current` guard catches the transition window (bgEngine.ts:393).
- `useHotSwap` cleanup — Supabase channel removal, snapshot/poll/reconnect timer all cleared in the return at line 623-635. (v634 audit's "leak" claim was bogus then and stays bogus now.)
