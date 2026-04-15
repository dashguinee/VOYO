# Transition Audit 2 — ENDED handler + DEDUP oscillation

File: `src/components/AudioPlayer.tsx`
Commits: `a941991` → `10e8ef2` → `9ea3b67` (same day, same hot path)

---

## Commit a941991 — "remove duplicate ended handlers + replay dedup leak"

**What changed (JSX binding):** Removed `onEnded={handleEnded}` from the `<audio>` element (line ~3257 at the time). Replaced with a comment claiming `onEndedDirect` (native listener at ~2945) is the sole handler.

**What changed (native handler `onEndedDirect`):** Inlined all telemetry that used to live in `handleEnded`:
- `endListenSession`, `recordPoolEngagement`, `useTrackPoolStore.recordCompletion`, `oyoOnTrackComplete`, edge-stream fallback `cacheTrack`, `notifyNextUp`.
- Captured `currentTime / completionRate / wasEdgeStream / cacheNotYetTriggered` BEFORE `nextTrack()` — correct.
- Kept the `if (lastEndedTrackIdRef.current === trackId) return;` dedup at top.

**What changed (`loadTrack` dedup reset):** Added `lastEndedTrackIdRef.current = null;` at line 1592 (atomic block alongside `lastTrackIdRef.current = trackId`). Rationale: replaying the same track was silently failing because the ref was set-once.

**Regression risk at the time:** React's synthetic `onEnded` was gone, so background Android Chrome — which can throttle native listeners under battery-saver audio-focus juggling — would drop some ended events with no fallback. This is exactly what 10e8ef2 responded to.

---

## Commit 10e8ef2 — "restore React onEnded as background safety belt"

**What changed:** Re-added `onEnded={handleEnded}` on the JSX. Comment claims the shared `lastEndedTrackIdRef` dedup guarantees only one handler actually runs.

**Did it restore everything a941991 removed?** NO — and this is the crux of the regression. The telemetry side effects (pool/OYO/edge-stream fallback) live ONLY inside `onEndedDirect`. The old `handleEnded` body (pre-a941991) is not restored. So at 10e8ef2 HEAD, when React's `onEnded` wins the race and sets the dedup ref first, `onEndedDirect` early-returns — and `handleEnded` (still the OLD pre-inline body, or whatever it points to) runs without the merged telemetry. Meanwhile when native wins, telemetry DOES fire via `onEndedDirect`. This made telemetry non-deterministic.

**The second, worse problem:** the dedup ref is **reset inside `loadTrack`** (a941991 added that). The sequence the v183 commit describes is:
1. Native `onEndedDirect` fires for track A, sets ref=A, calls `nextTrack()`.
2. Store advances to B; `useEffect` triggers `loadTrack(B)`; loadTrack resets `lastEndedTrackIdRef = null`.
3. React's synthetic `onEnded` finally fires (React 18 delivers synthetic events AFTER native bubbling for attached listeners), reads `currentTrack = B`, ref = null — passes dedup, fires a SECOND `nextTrack()`.
4. Track B is skipped before it plays.

This is the "every other track in BG" bug.

---

## Commit 9ea3b67 — "stale React onEnded skipped every other track in BG"

**What changed:** Added a stale-event guard at the top of `runEndedAdvance` (AudioPlayer.tsx:3073-3085):
```
const audioEnded = audioRef.current?.ended === true;
if (!audioEnded) { trace('ended_dedup', ..., {why:'audio_not_ended_stale'}); return; }
```

Rationale: the moment `loadTrack` sets `audio.src = silentKeeperUrlRef.current` (line 1705), `audio.ended` flips to `false`. The stale late-arriving React synthetic event reads `audio.ended === false` and bails.

**Does it work?** Only when the BG silent-WAV bridge engaged. In BG (`document.hidden && silentKeeperUrlRef.current`) loadTrack hits line 1700-1706 and src gets replaced → `audio.ended = false` → guard fires → stale event bails. Good. In foreground, loadTrack goes to `audio.pause(); currentTime = 0` (line 1712-1713), which also flips `audio.ended` to false. Good.

**Edge case that still leaks:** if `silentKeeperUrlRef.current` is null in BG (blob creation failed, or revoked), loadTrack skips the src swap AND skips the else-branch pause (the else only runs when not hidden). The audio element stays in ended state. Stale React synthetic then sees `audio.ended=true`, dedup ref null (just reset), and fires a second `nextTrack`. Not theoretical: silentKeeperUrlRef is revoked in cleanup (line 673-674), and on re-mount there's a window where it's null.

---

## Current HEAD ended-chain map

- `runEndedAdvance` (3070-3169): consolidated body. Guards: `audio.ended===true` check (3082) → `!trackId || ref===trackId` dedup (3086) → source check (`cached`/`r2` only, 3093) → `isPlaying` check (3094). Then silent-WAV pre-advance bridge (3119), `nextTrack()` (3129), mediaSession + `notifyNextUp`, deferred telemetry.
- `handleEnded = runEndedAdvance` (3171).
- `lastEndedTrackIdRef` declared at 3180. Native listener attached at 3188.
- JSX `onEnded={handleEnded}` at 3438. Both React + native bound → same function → same dedup ref.
- `loadTrack` resets `lastEndedTrackIdRef.current = null` at 1609.

## Silent-bail scenarios in BG (concrete)

1. **`silentKeeperUrlRef` not yet created / already revoked.** loadTrack's BG branch (1700) short-circuits, no pause fallback (pause-branch is `else` of `document.hidden`). `audio.ended` stays true. Stale React synthetic fires, ref was reset → double-advance skip.
2. **`playbackSource` not `cached` or `r2`.** (3093) — edge-stream direct plays return `playbackSource='edge-stream'` (search shows `isEdgeStreamRef` in the captured state). BG natural ends of edge-stream tracks silently bail with `src_edge-stream`. No auto-advance at all.
3. **`isPlaying=false` at end moment.** (3094) — if pause-state racing (e.g., Android audio-focus drop set `isPlaying=false` via `onPause` handler before the ended event settles), handler bails and queue dies.
4. **`audio.ended` false due to error/`stalled`/network-reset.** `ended` never latches true. Handler never runs. No fallback via `onTimeUpdate` duration match.
5. **Dedup ref stays set across restart.** If loadTrack DOESN'T run (same-track-id guard at 1604), ref is not reset — second ended for replayed same track early-returns on `ref===trackId`. a941991 claimed to fix this but the fix only applies when trackId CHANGES.

## TL;DR

The chain is correct under the happy BG path (silent-WAV available, source=`cached`/`r2`, still playing). 9ea3b67's `audio.ended` guard closes the double-fire race introduced by a941991's loadTrack reset + 10e8ef2's dual-binding restore. Still silent in BG when: (a) silentKeeperUrlRef is null, (b) `playbackSource === 'edge-stream'`, (c) `isPlaying` flipped false during the ended moment. Those three paths are where "BG next silently fails" can still land.
