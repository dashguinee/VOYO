# Transition Audit 3 — Silent WAV + Loop Flag Wave

**Scope:** three commits touching the silent-WAV bridge directly.
**HEAD file:** `/home/dash/voyo-music/src/components/AudioPlayer.tsx` (3509 lines).
**Mode:** read-only.

---

## Per-commit summary

### c86af95 — clear `audio.loop=true` left by silent-WAV bridge
**What changed:** added explicit `audioRef.current.loop = false` before `src =` assignment in TWO fast-paths inside `loadTrack`:
- preload fast-path (now at line 1834, immediately before `src = preloaded.url` on 1835)
- cached fast-path (now at line 1909, immediately before `src = cachedUrl` on 1910)

Also fixed `onPlay` handler ordering (line ~3453) — silent-WAV guard now runs BEFORE `setIsPlaying(true)`, so bridge plays are invisible to the store.
**Rationale:** `HTMLMediaElement.loop` is sticky across `src` changes. Without the reset, the real track would loop forever and `ended` would never fire → BG auto-advance dies silently.

### 997f2f9 — extract `runEndedAdvance`
**What changed:** consolidated `handleEnded` (React) + `onEndedDirect` (native listener) into one `runEndedAdvance` `useCallback` (line 3070). React onEnded now just points at it (`handleEnded = runEndedAdvance`, line 3171). Native listener wires through `el.addEventListener('ended', runEndedAdvance)` (line 3188).
**Loop-reset impact:** the refactor does NOT touch any loop assignment in loadTrack. Pure extraction of the ended-handler body. c86af95's two `loop = false` points (1834, 1909) are preserved intact in HEAD.

### 08764bc — pre-advance silent-WAV bridge
**What changed:** two synchronous silent-WAV engagements BEFORE `nextTrack()` fires:
- Inside `runEndedAdvance` at lines 3119-3126: BG-only, sets `loop = true`, `src = silentKeeperUrlRef.current`, calls `play()`.
- Inside `mediaSession.setActionHandler('nexttrack')` at lines 2800-2807: same pattern, BG-only.

**Rationale:** closes the focus-loss gap between `ended` (audio.ended=true, no active src) and the eventual `loadTrack` run for the new track. Keeps Android audio focus alive across the React reconciliation window.
**Consequence:** when these handlers fire in BG, `audio.loop === true` is guaranteed by the time the downstream `loadTrack` runs for the new track. Every src-assignment path downstream MUST reset `loop=false` or the real track inherits the loop and `ended` never fires again.

---

## Complete silent-WAV → real-src → loop-reset coverage map

All `.loop =` sites in HEAD, grouped by role:

| Line | Role | Value | Context |
|------|------|-------|---------|
| 1669 | Reset at top of loadTrack | `= false` | Fires BEFORE the BG bridge block; always runs when `audioRef.current` exists |
| 1704 | **BG bridge inside loadTrack** | `= true` | Re-sets true IF `document.hidden && silentKeeperUrlRef.current` |
| 1834 | Preload fast-path (c86af95) | `= false` | Before `src = preloaded.url` |
| 1909 | Cached fast-path (c86af95) | `= false` | Before `src = cachedUrl` |
| **1982** | **R2-hit direct path** | **(missing)** | `src = r2Result.url` at line 1982 — NO `loop = false` before it |
| 2129 | Retry `playFromUrl` (VPS/edge race) | `= false` | Before `src = url` at 2131 |
| 2147 | Keeper-timer re-engage (3s buffer-gap fallback) | `= true` | Reverts to silent WAV if canplay doesn't fire |
| 2153 | Keeper-timer recovery | `= false` | Re-attempts real URL after 800ms |
| 2802 | `mediasession_next` bridge (08764bc) | `= true` | Pre-advance silent-WAV engage |
| 3121 | `runEndedAdvance` bridge (08764bc) | `= true` | Pre-advance silent-WAV engage |
| 3212 | `iframe`-phase error recovery | `= true` | Re-arms silent keeper on error |

### Walk-through: BG ended-transition scenario

1. Track A `ended` fires in BG → `audio.ended=true`.
2. `runEndedAdvance` (line 3070) runs.
3. Line 3119-3126: `loop=true`, `src=silentWAV`, `play()`. Focus preserved.
4. `nextTrack()` (line 3129) updates store synchronously.
5. React re-renders → `loadTrack` useEffect fires for Track B's `trackId`.
6. `loadTrack` line 1669: `loop = false` (reset).
7. `loadTrack` line 1700-1710: BG + silentKeeperUrl present → `loop = true`, `src=silentWAV` (re-engages for the load window).
8. Path fork for Track B's real src — where does the reset happen?

| Path | Where `src = realUrl` | Does it reset `loop=false` FIRST? |
|------|-----------------------|-----------------------------------|
| **Preload fast-path** | line 1835 | **YES** (1834) — OK |
| **Cached fast-path** (IndexedDB hit) | line 1910 | **YES** (1909) — OK |
| **R2 direct hit** (checkR2Cache → `r2Result.exists`) | **line 1982** | **NO** — gap |
| **VPS / edge race retry** (`playFromUrl`) | line 2131 | **YES** (2129) — OK |
| **Keeper-timer recovery** (3s buffer-gap) | line 2154 | **YES** (2153) — OK |

---

## Flagged paths — `loop=true` can leak onto real src

### PATH R2-HIT (line 1980-1983) — MISSING `loop=false`
```
1980  if (audioRef.current) {
1981    audioRef.current.volume = 1.0;
1982    audioRef.current.src = r2Result.url;   // ← loop still TRUE from line 1704 BG bridge
1983    audioRef.current.load();
```
This is reached when: preload miss + local IndexedDB miss + R2 collective has the track. In that case, line 1669 resets loop=false, then line 1704 re-sets loop=true (BG bridge), then line 1982 swaps to the real URL — and `loop` is never cleared. The real track will loop indefinitely. `ended` never fires. Silent auto-advance failure. **Exactly the bug c86af95 fixed for the preload/cached paths — this path was missed.**

### Secondary concern: `mediasession_next` handler order (line 2794-2808)
The silent-WAV engage runs at 2800-2807, THEN `nextTrack()` at 2808. Same pattern as `runEndedAdvance`. The same downstream reset coverage applies — so it shares the R2-hit gap identified above.

### Keeper-timer (line 2138-2161) — benign but worth noting
This path flips loop true → false correctly (2147 → 2153). Not a leak source.

---

## TL;DR

c86af95 patched two of the three fast-paths in `loadTrack` (preload + cached). 997f2f9's refactor preserved both. 08764bc added two more silent-WAV engages (`runEndedAdvance` + `mediasession_next`) that set `loop=true` BEFORE any downstream path runs — which means every `src = realUrl` in `loadTrack` must reset `loop=false` or the loop leaks.

**Line 1982 (R2 direct-hit path) does NOT reset `loop=false` before `audioRef.current.src = r2Result.url`.** When the BG transition lands on a track that's in the R2 collective cache but not preloaded and not in the local IndexedDB cache, the silent-WAV's `loop=true` persists onto the real track. Track B plays on loop, `ended` never fires, auto-advance dies. Identical failure mode to the pre-c86af95 preload/cached bug. This is the surviving instance of the exact class of bug c86af95 was hunting.

Fix is a one-liner: insert `audioRef.current.loop = false;` between lines 1981 and 1982.
