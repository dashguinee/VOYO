# Audio Audit 1 — Background Auto-Advance

**Verdict:** ROOT CAUSE FOUND. Silent-WAV bridge leaks `loop=true` onto the new track. The next track plays, but its `ended` event never fires because the element is set to loop.

---

## Event chain — R2/cached track ends with phone locked

1. User is on track A, `audioRef.current.loop === false`, `playbackSource='cached'` (or `'r2'`), `document.hidden === true`.
2. Audio element hits end-of-buffer. Native `ended` fires. (Both `onEndedDirect` — `AudioPlayer.tsx:2974` — and `onEnded={handleEnded}` — `AudioPlayer.tsx:2910/3292` — race. `lastEndedTrackIdRef` at `2914`/`2977` dedups.)
3. Whichever wins calls `nextTrack()` (`playerStore.ts:726`). New `currentTrack` committed, `isPlaying` stays true.
4. `loadTrack` useEffect at `AudioPlayer.tsx:1571` re-runs because `currentTrack` changed.
5. `lastEndedTrackIdRef.current = null` at `1595` — good, dedup reset.
6. BG branch fires at `1667-1681`:
   - `audioRef.current.loop = true`
   - `audioRef.current.src = silentKeeperUrlRef.current`
   - `audioRef.current.play()`
7. Execution continues. Track B is preloaded (fast path at `1776`) OR cached (`1849`) OR hot-swap (`1947+`).
8. **Preload path (`1793-1834`)** and **cached path (`1861-…`)** both do:
   ```
   audioRef.current.volume = 1.0;
   audioRef.current.src = <new url>;   // <-- loop is STILL true!
   ```
   Neither path resets `audioRef.current.loop = false`. `HTMLMediaElement.loop` is a sticky boolean attribute — changing `src` does NOT reset it.
9. `canplay` fires, `play()` is called, track B starts. Audio element has `loop=true`, so when track B reaches its end the browser **silently rewinds and keeps playing**. The `ended` event never fires. Auto-advance never triggers again.

Second-order consequence: from the user's POV, track A auto-advances to track B just fine the first time (we hear track B start), then playback gets stuck looping track B forever. Depending on how long the user observes, it can look like "advance broken right away" because they lock the phone during track A's final 20s and only check 10 min later — still hearing a VOYO track, but not the one they expected.

The hot-swap iframe-miss path at line **2069** *does* reset `loop=false` before the src swap. Only the preload + cached fast-paths forgot.

## Why v168 (restore `onEnded` safety belt) didn't fix it

v168 addressed a *different* failure mode — the hypothesis that `onEndedDirect` misses events in heavy BG throttling. That's a real concern, but it doesn't matter here: the `ended` event isn't being missed by the *listener*, it's being prevented at the *source* by `loop=true`. Adding more listeners to an event that never fires accomplishes nothing.

## Root cause (exact lines)

- `src/components/AudioPlayer.tsx:1673` — sets `loop=true` on the silent bridge.
- `src/components/AudioPlayer.tsx:1795` — preload path, assigns new `src` without resetting `loop`.
- `src/components/AudioPlayer.tsx:1863` — cached path, assigns new `src` without resetting `loop`.
- (`src/components/AudioPlayer.tsx:2069` — hot-swap iframe-miss path correctly resets `loop=false`. This is the template.)

## Fix

Reset `loop=false` *before* every `src=` assignment of a real track. Minimal, surgical:

```tsx
// Line ~1794 (preload path), just before src assignment:
if (audioRef.current && preloaded.url) {
  audioRef.current.loop = false;                        // <-- ADD
  audioRef.current.volume = 1.0;
  audioRef.current.src = preloaded.url;
  …
}

// Line ~1862 (cached path), just before src assignment:
if (audioRef.current) {
  audioRef.current.loop = false;                        // <-- ADD
  audioRef.current.volume = 1.0;
  audioRef.current.src = cachedUrl;
  …
}
```

Belt-and-suspenders option: also set `audioRef.current.loop = false` at the very start of `loadTrack` (line ~1631 block, after `oncanplaythrough = null`). Costs nothing, defends against any future path that forgets.

## Confidence

**HIGH** that this is the primary cause. Reasoning: `loop=true` is set at `1673`, the preload/cached paths provably do not reset it before `src=`, and the spec guarantees `loop` persists across `src` changes. Directly explains "BG auto-advance broken" with zero other assumptions.

**What would raise it to certainty:** Add a `console.log('[VOYO] loop after src:', audioRef.current.loop)` in the canplay handlers at `1806` and `1874`. Reproduce BG end. If log prints `true`, confirmed. (Also visible post-hoc from the telemetry: `voyo_playback_events` should show ONE `play_start` per BG session but MANY `progress_update` events summing to >> track duration — looping.)

## Secondary concerns (not the smoking gun, worth a second pass)

- `onEndedDirect` at `2982` early-returns if `!playing`. The `onPause` guard at `3349` (`audioRef.current?.ended`) prevents the flip on natural end, so this should be fine — but it's timing-dependent. If Chrome fires `pause` BEFORE `ended` on the same element tick, `isPlaying` could flip and the guard trips. Low probability, Chrome's ordering is `pause` → `ended` with `ended: true` already set, so the `audioRef.current?.ended` guard should hold.
- MediaSession action handlers at `2704` depend on `currentTrack` — re-register every track change. Fine.
- `handleEnded` callback at `2910` has `currentTrack` in deps → re-creates each track. The JSX `onEnded={handleEnded}` rebinds. No leak.
- YouTube iframe `onStateChange` ENDED at `YouTubeIframe.tsx:217` calls `nextTrack()` unconditionally. During cached/r2 the iframe is muted but not paused unless `videoTarget==='hidden'` — if the iframe ALSO fires ENDED in BG it would race with audio's `ended`. Same `lastEndedTrackIdRef` doesn't exist on the iframe path, so this could double-advance. Not today's bug (user says NO advance, not double), but worth auditing.

## What I do not know

- Whether Android Chrome *actually* fires `ended` when audio element plays to end with `loop=false` while backgrounded. Assumed yes based on MDN/spec. If it doesn't, the fix above is necessary but not sufficient and we'd need a `timeupdate`-driven fallback when `currentTime >= duration - 0.3`.
- Whether v152-v168 introduced any change to `loop=true/false` elsewhere. I only audited the current file state.
