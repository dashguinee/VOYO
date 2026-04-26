# Player UI Audit — VOYO Music (audit-2)

Department: Player UI (VoyoPortraitPlayer, LandscapeVOYO, VoyoMoments, VoyoBottomNav, OyeButton, PortraitVOYO)
Discipline: glitch / race / leak only — no perf suggestions.
Convention: each finding has file:line + verbatim excerpt; severity is conservative.

---

## P0 — Real bugs that affect core flow

### P0-1 — SKEEP setInterval leaks on unmount (active mic-style resource leak)

**File**: `src/components/voyo/VoyoPortraitPlayer.tsx`
**Lines**: cleanup at 4799-4804 vs. interval created at 4695

```ts
// 4628: declared
const skeepSeekInterval = useRef<ReturnType<typeof setInterval> | null>(null);

// 4695: started — fires every 100ms, calls seekTo on the player store
skeepSeekInterval.current = setInterval(() => {
  const { duration: dur } = usePlayerStore.getState();
  ...
  seekTo(skeepTargetTime.current);
  haptics.light();
}, 100);

// 4799-4804: cleanup MISSES skeepSeekInterval
useEffect(() => {
  return () => {
    if (skeepEscalateTimer.current) clearInterval(skeepEscalateTimer.current);
    if (skeepHoldTimer.current) clearTimeout(skeepHoldTimer.current);
  };
}, []);
```

**Repro**: Hold the prev/next button to enter SKEEP mode (200ms hold). While the 100ms seek interval is firing, force the player to unmount (rotate device → LandscapeVOYO swap, or trigger Suspense fallback during code-split chunk reload). The `skeepSeekInterval` keeps firing `seekTo()` on the dead component every 100ms, indefinitely.

**Why P0**: continuous setInterval against playerStore = silent battery drain + scrubbing the audio of whatever the new mounted player loaded. Also, `skeepEscalateTimer` is a `setTimeout` but cleared with `clearInterval` (line 4801) — works in browsers but is wrong API and obscures intent. `handleScrubEnd` (line 4736-4753) does clear all three; the bug is ONLY on the unmount path.

---

### P0-2 — Voice-recording countdown chain leaks an active microphone

**File**: `src/components/voyo/VoyoPortraitPlayer.tsx`
**Lines**: 2296-2310 (the voice hold countdown), 2280-2289 (`stopVoiceRecording`)

```ts
// 2296-2310 — handleMicHoldStart
holdTimerRef.current = setTimeout(() => {
  setIsVoiceMode(true);
  setVoiceTranscript('');
  setVoiceCountdown(3);
  haptics.medium();

  // Countdown 3-2-1 — these THREE setTimeouts are NEVER tracked.
  setTimeout(() => setVoiceCountdown(2), 1000);
  setTimeout(() => setVoiceCountdown(1), 2000);
  setTimeout(() => {
    setVoiceCountdown(null);
    startVoiceRecording();          // acquires mic, AudioContext, MediaRecorder, rAF loop
  }, 3000);
}, 400);
```

`handleMicHoldEnd` only clears `holdTimerRef.current` — it cannot cancel the THREE inner setTimeouts because their IDs were never stored. Also: no unmount cleanup ever calls `stopVoiceRecording`. `mediaRecorderRef`, `audioContextRef`, `recognitionRef`, and `animationRef` (rAF) are all started in `startVoiceRecording` (lines 2225-2270) and only released by an explicit user release after recording started.

**Repro**:
1. Hold the mic button until `holdTimerRef` fires the outer timeout (400ms).
2. Within the next 3s of countdown, release / unmount / navigate away.
3. The inner countdown setTimeouts continue. At 3000ms, `startVoiceRecording()` fires on the unmounted component → microphone permission requested or held → `MediaStream`, `MediaRecorder`, `AudioContext`, `SpeechRecognition`, and a perpetual rAF loop all leak. The mic light stays on.

**Why P0**: leaks a hardware resource (mic) + perpetual rAF that React no longer owns + setState calls on unmounted component (warnings + potential phantom UI on remount).

---

### P0-3 — `reactions[]` selector defeats reference equality → re-render storm on always-mounted player

**File**: `src/components/voyo/VoyoPortraitPlayer.tsx:3596`
**Store mutation**: `src/store/playerStore.ts:1766`

```ts
// VoyoPortraitPlayer.tsx:3596 — NO useShallow
const reactions = usePlayerStore(s => s.reactions);

// playerStore.ts:1766 — every addReaction creates a new array
set((state) => ({
  reactions: [...state.reactions, newReaction],
  ...
}));
```

The 6k-line always-mounted `VoyoPortraitPlayer` re-renders on every reaction insert anywhere in the app (reactions are realtime-broadcast across users). Compare to its sibling selectors at lines 3587-3590, all of which DO use `useShallow` for the same reason (and the inline comment at 3582-3586 explicitly explains why playerStore array spreads break default ===).

**Repro**: open Chrome React DevTools profiler on the player. Trigger `addReaction` (any OYÉ / fire / wazzguan tap, or a realtime push from another user). VoyoPortraitPlayer re-renders even when nothing visible to it changed.

**Why P0**: this is the largest always-mounted component in the app, the comment block at 3582-3586 already calls out this exact pattern as something to avoid, and `reactions` is hit by the realtime socket.

---

## P1 — Stuck-state glitches and unmount setState

### P1-4 — `feedNavDim` stuck-on after 5 keyboard arrow swipes

**File**: `src/components/voyo/feed/VoyoMoments.tsx:1308, 1367-1368, 1411`

```ts
const swipeCountRef = useRef(0);

// nav() — fires on swipe AND on keyboard ArrowUp/Down/Left/Right (line 1538-1541)
swipeCountRef.current += 1;
if (swipeCountRef.current >= 5) setFeedNavDim(true);

// onTS (touchStart) — the ONLY place that resets:
setFeedNavDim(false);
swipeCountRef.current = 0;       // line 1411
armDimTimer();
```

Keyboard navigation calls `nav()` (line 1538-1541), which increments `swipeCountRef`. After 5 keyboard navs without a touch, `feedNavDim` flips to true and stays — keyboard users have no `onTS` reset path. Even after the dim signal is cleared elsewhere, `swipeCountRef` is still ≥5, so the next `nav()` immediately re-arms dim.

**Repro**: Mount VoyoMoments on desktop, press ArrowDown 5 times. Nav goes ambient (30% opacity sides, 50% orb) and stays there until you touch the screen.

---

### P1-5 — VoyoBottomNav prompt sequence: nested setTimeouts not cleaned

**File**: `src/components/voyo/navigation/VoyoBottomNav.tsx:215-228`

```ts
const showPromptTimer = setTimeout(() => {
  setPromptState('love');

  setTimeout(() => {                      // INNER 1 — orphaned
    setPromptState('keep');

    setTimeout(() => {                    // INNER 2 — orphaned
      setPromptState('clean');
      setPromptCount(prev => prev + 1);
    }, 2500);
  }, 2000);
}, 8000);

return () => clearTimeout(showPromptTimer);
```

When `isPlaying` or `isOnFeed` flips to false during the love→keep window (2-4.5s after the outer timer fires), the cleanup runs and the early branch at line 209 forces `setPromptState('clean')`. But the inner setTimeouts continue: 2s later `setPromptState('keep')` fires (the orb fills with "Keep Playing" while user is no longer playing), then 2.5s later `setPromptState('clean')` AND `setPromptCount(prev => prev + 1)` — the prompt counter ticks even though the prompt was visually aborted.

**Repro**:
1. Start playback on the Moments feed. Wait 8s for `setPromptState('love')`.
2. Within ~2s of seeing "Love this Vibe?", tap pause OR navigate to Music tab.
3. ~2s later the orb fills with "Keep Playing" anyway (off-feed, off-playing).
4. promptCount increments even though the prompt was cancelled.

**Why P1**: visible glitch + counter pollution (limits the "max 3 per session" to silently fire less often than 3 visible prompts).

---

### P1-6 — `headerHideTimer` not cleared on unmount

**File**: `src/components/voyo/feed/VoyoMoments.tsx:1130, 1186-1187, 1549-1555`

```ts
// 1130: ref declared
const headerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

// 1183-1188: wakeHeaderOnTap
const wakeHeaderOnTap = useCallback(() => {
  setHeaderVisible(true);
  pingWidgets();
  if (headerHideTimer.current) clearTimeout(headerHideTimer.current);
  headerHideTimer.current = setTimeout(() => setHeaderVisible(false), 5000);
}, [pingWidgets]);

// 1549-1555: unmount cleanup — MISSES headerHideTimer
useEffect(() => () => {
  if (lpTimer.current) clearTimeout(lpTimer.current);
  if (tapTimer.current) clearTimeout(tapTimer.current);
  if (volTimer.current) clearTimeout(volTimer.current);
  if (starHoldTimer.current) clearTimeout(starHoldTimer.current);
}, []);
```

Tap to wake the header, then unmount within 5s → `setHeaderVisible(false)` fires on a dead component (React 18 warning + zombie state).

---

### P1-7 — LandscapeVOYO `YouTubeInterceptor` setTimeouts orphaned

**File**: `src/components/voyo/LandscapeVOYO.tsx:341-349`

```ts
// 341 — success branch:
setTimeout(() => {
  setSuccessAnimation(false);
  setFeedback(null);
}, 2000);

// 349 — error branch:
setTimeout(() => setFeedback(null), 2000);
```

No refs, no cleanup. `YouTubeInterceptor` mounts/unmounts based on `showInterceptor` (line 365) which flips with the playback zone. If the user clicks the interceptor and the suggestion zone exits within 2s (e.g., they manually skip the song), `YouTubeInterceptor` unmounts and the setTimeout still fires `setFeedback(null)` on a dead component.

---

## P2 — Edge-case leaks / late setState

### P2-8 — `scrollRafRef` rAF not canceled on unmount, plus chat-mode setTimeouts

**File**: `src/components/voyo/VoyoPortraitPlayer.tsx`

**(a)** `scrollRafRef` (line 4111) — declared, set in `handleHeaderScroll` (4119), but no unmount cleanup anywhere. If user scrolls and the player unmounts in the same frame, the rAF callback fires `setPortalProgress` on a dead component.

```ts
const scrollRafRef = useRef<number | null>(null);

const handleHeaderScroll = useCallback(() => {
  if (scrollRafRef.current !== null) return;
  scrollRafRef.current = requestAnimationFrame(() => {
    scrollRafRef.current = null;
    ...
    setPortalProgress(next);
  });
}, [setPortalProgress]);
```

**(b)** Wazzguán chat-mode auto-close setTimeouts (lines 2441, 2446, 2451-2453, 2460, 2463, 2467, 2470, 2473) — every branch of `handleChatSubmitWithText` schedules `setTimeout(() => setIsChatMode(false), 1500-2000)` with no ref, no cleanup. If user manually closes chat (`handleChatClose`, line 2485) within the window, the timer still fires and forces `isChatMode` back to false later — harmless if chat is still closed, but a re-opened chat in that window will be auto-closed by the stale timer.

**(c)** DJ-wake toast setTimeouts (lines 4340, 4348) — same pattern, raw `setTimeout(() => setShowDJWakeMessage(false), 1500/2000)` with no ref. Spamming DJ activation stacks pending timers; fine because they all just set the same flag false, but it's inconsistent with the rest of the file's discipline.

**Repro for (a)**: rotate device while scrolling the player surface. Late rAF callback fires after unmount.

---

## What I checked and found CLEAN

- **OyeButton** (`src/components/oye/OyeButton.tsx`): all 5 store selectors return primitives (booleans / status string), `chargeTimerRef` is properly cleared on unmount (line 241-243). `computeOyeState` is a pure derivation. No bug.
- **PortalBelt drag** (`VoyoPortraitPlayer.tsx:1346-1616`): `pauseTimeoutRef`, `reverseTimeoutRef`, animation rAF all have proper cleanup at lines 1431-1435 and 1383-1385.
- **StreamCard** (line 1622-1646): timeout refs cleaned on unmount.
- **Cube dock** (line 4231-4317): `cubeHoldTimerRef`, `cubeAutoCloseRef`, `cubeOyoLineFadeRef` all cleaned on unmount (4310-4317).
- **Canvas pointer handlers** (line 4514-4525): `handleCanvasPointerCancel` properly resets all gesture refs and springs the card back. No state leaks across tracks.
- **PlayCircle in LandscapeVOYO** (line 100-210): `tapTimeoutRef` and `holdTimeoutRef` properly cleaned on unmount (line 111-122). Triple-tap counter resets correctly.
- **VoyoBottomNav `pointerdown/up/cancel` document listeners** (line 64-81): all three are paired add/remove with proper cleanup.
- **InterceptorTimeSync** (line 479-505): clean memo + ref-deduped state writes, no re-render storm.
- **feedNavDim cleanup on VoyoMoments unmount** (line 1316-1319): correctly clears the timer AND restores `feedNavDim` to false. Note: VoyoMoments under PortraitVOYO is lazy + Suspense-wrapped but the wrapper stays mounted (only opacity/translate changes on tab switch), so the cleanup only fires on full app teardown — but the timer's effect is gated on `voyoActiveTab === 'feed'` in VoyoBottomNav (line 47), so off-feed dim is invisible. Not a real-world issue.

---

## Summary of Severity Distribution

- **P0 (3)**: SKEEP setInterval leak, voice-recording countdown leaks mic, `reactions[]` re-render storm.
- **P1 (4)**: keyboard-nav swipeCount stuck dim, BottomNav prompt nested timers, headerHideTimer no unmount, Interceptor feedback timer no unmount.
- **P2 (1)**: scrollRaf + chat-mode setTimeouts late setState.

All findings verified with file:line + code excerpt against the live source on disk.
