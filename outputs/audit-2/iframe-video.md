# Iframe / Video Pipeline Audit (audit-2)

Scope: `src/components/YouTubeIframe.tsx`, `src/services/pipService.ts`, `src/player/iframeBridge.ts`.

Six findings, glitch / race / leak only.

---

## P0-IF-1 — Rapid track skip strands player on previous track (the "video stays black after track change" symptom)

**File**: `src/components/YouTubeIframe.tsx:226–246, 487–501`

**Race**:

1. Track A change → effect at line 487 fires → calls `initPlayer(A)`.
2. `initPlayer` synchronously sets `initializingRef.current = true` (line 232), `currentVideoIdRef.current = A` (line 233), constructs `new YT.Player(target)` (line 251). `onReady` is async — it fires later when the iframe boots.
3. Before `onReady` for A fires, user skips to track B. `youtubeId` flips → effect re-fires → calls `initPlayer(B)`.
4. `initPlayer(B)` hits the early return at line 229: `if (initializingRef.current) return;`. Nothing else happens. `currentVideoIdRef` stays at A. **There is no retry, no queueing, no re-arm.**
5. A's `onReady` eventually fires → resets `initializingRef = false`, registers A's player on `iframeBridge` (line 273), pauses-or-plays based on store (which now reflects track B). The player on screen is for A; the audio (R2 fast path) is for B.
6. Subsequent effect re-fires for B (only happens if a dep besides youtubeId changes — videoTarget, playbackSource, initPlayer/volume) hit the line 230 guard `playerRef.current && currentVideoIdRef.current === videoId` — but `videoId` arg is the new B and `currentVideoIdRef.current` is A, so this check passes (it's the OPPOSITE — if they MATCH, it returns). They don't match → `initPlayer` proceeds, destroys A, builds B. So eventually a non-youtubeId dep re-fire rescues us — but if the user is settled on B and no other dep changes, the player stays stuck on A.

The v647 keying of `<div ref={mountRef} key={youtubeId}>` (line 803-807) makes this **worse**, not better, in this race: when A's `onReady` fires, the target div React mounted for A has already been physically removed from the DOM by React (B's div replaced it). The YT player happily registers itself on `iframeBridge` anyway because `e.target` is the JS player object, not the DOM node. AudioPlayer's `useHotSwap` then calls `iframeBridge.getCurrentTime()` against a player whose iframe is detached — returns null/throws, falls to snapshot.

**Repro**:
- Search → tap an uncached track (engages iframe-as-audio).
- Within ~1.5s, tap a different uncached track.
- First track's `new YT.Player()` is in flight; second track's `initPlayer` early-returns.
- Watch network: only first videoId is requested.

**Fix sketch**: Track a `pendingVideoId` and on `onReady`, if it differs from `currentVideoIdRef`, immediately re-init. Or, on the early-return path, set a flag and re-call `initPlayer` from `onReady`/`onError` once `initializingRef` clears.

**Severity**: P0. Matches the "video frames go black after track change despite audio playing" symptom from tonight. The mountRef-keying fix in v647 cleans up the DOM but the JS-side race remains.

---

## P0-IF-2 — Destroy during init leaks `initializingRef = true` forever; bridge gets a destroyed player

**File**: `src/components/YouTubeIframe.tsx:215–224, 226–246, 269–273`

The destroy effect:

```ts
useEffect(() => {
  const isBoosted = playbackSource === 'cached' || playbackSource === 'r2';
  if (isBoosted && videoTarget === 'hidden' && playerRef.current) {
    try { playerRef.current.destroy(); } catch {}
    playerRef.current = null;
    iframeBridge.register(null);
    currentVideoIdRef.current = null;
    if (mountRef.current) mountRef.current.innerHTML = '';
  }
}, [playbackSource, videoTarget]);
```

If destroy fires while `initializingRef.current === true` (i.e. a `new YT.Player` constructed but `onReady` not yet fired), two bugs land:

1. **`initializingRef` is never reset**. `onReady` for the now-destroyed player may not fire (or may throw inside YT internals). `initializingRef` is stuck at `true`, and **every future `initPlayer` call returns early at line 229**. Iframe initialization is permanently bricked for the rest of the session — until something else resets the ref (only `onReady` line 270 and `onError` line 393 ever do).
2. **If `onReady` does fire after destroy** (YT can fire it asynchronously even on already-destroyed players in certain race windows), it runs line 273 `iframeBridge.register(e.target)` and registers a destroyed player. AudioPlayer's hot-swap then talks to a dead player.

**Repro**: rapid path: tap iframe-as-audio track → R2 lands within ~500ms (already cached fast path) → `playbackSource` flips to 'r2' → destroy fires before `onReady`. Iframe is now bricked for this session.

**Fix sketch**: `initializingRef.current = false` inside the destroy block. Also null-check `e.target.getPlayerState` inside `onReady` before `iframeBridge.register`.

**Severity**: P0 — silently breaks all subsequent iframe-as-audio fallbacks until full reload.

---

## P1-IF-3 — `pipService.register` is never called; every PiP entry call is a silent no-op

**Files**:
- `src/services/pipService.ts:11–25` — `_enter / _exit / _toggle` start `null`; `enter()` returns `Promise.resolve(false)` until something calls `register`.
- `src/services/oyo/app.ts:255` — `void pipService.enter().catch(...)` (escape-Oye path).
- `src/components/voyo/VoyoPortraitPlayer.tsx:5092` — `const ok = await pipService.enter();`
- `src/components/voyo/VoyoPortraitPlayer.tsx:6093` — `const ok = await pipService.enter();`

**Verification**:
```
grep -rn "pipService.register\|useMiniPiP\b" src/
→ only the comment in pipService.ts mentions useMiniPiP. The hook does not exist.
```

The `pipService.ts` doc comment says "useMiniPiP (in AudioPlayer) registers its functions here on mount", but there is no `useMiniPiP` anywhere in the codebase. Consequently:

- Escape-Oye (`opts.escape === true`) fires `pipService.enter()` → resolves false silently. The "PiP needs a user gesture" comment at line 252 is fully wasted.
- VoyoPortraitPlayer's two PiP buttons (lines 5092, 6093) `await pipService.enter()` — `ok` is always false. Whatever fallback the UI shows for `!ok` is the only path that ever executes.

**Repro**: Tap any PiP entry button. Nothing happens visually. No error, no console message — just nothing.

**Fix sketch**: Either remove `pipService` and the call sites, or implement the `useMiniPiP` hook in AudioPlayer that calls `pipService.register(enter, exit, toggle)` with real `requestPictureInPicture()` impls bound to the audio/video element.

**Severity**: P1 — the feature is shipped-broken, but no playback path depends on it (audio continues either way). Marketing/UX impact, not core flow.

---

## P1-IF-4 — Watchdog setTimeout (3s) and error-recovery setTimeouts (500ms) are never cleared

**File**: `src/components/YouTubeIframe.tsx:334–388 (watchdog)`, `422–434 (error 100)`, `455–467 (error 101/150)`.

Three independent `setTimeout` paths inside `onStateChange` and `onError` callbacks. None capture handles, none are cleared on unmount, on track change, or on `destroy()`.

```ts
// watchdog (line 334):
setTimeout(() => {
  const now = usePlayerStore.getState().currentTrack?.trackId ?? null;
  if (!now || now !== trackAtEnd) return; // audio already advanced
  ...
}, 3000);
```

The internal "track changed" guard (line 336) prevents false-firing `nextTrack()`, but the timer itself still runs, holds a closure over `trackAtEnd`, `currentTimeAtIframeEnd`, `durationAtIframeEnd`, and a fresh `document.querySelector('audio')` call. On rapid auto-advance through a long mix (every track ENDS as iframe-source) you stack one of these every track ending, plus 500ms timers for any embed errors.

The error-100 / error-150 timers (line 422, 455) fire `nextTrack()` blindly inside the 500ms window unless `playbackSource` flipped to r2/cached during the gap. **If the user manually skipped during that 500ms** (track changes from A → B), the guard `playbackSource === 'cached' || 'r2'` may NOT have flipped (B is also iframe-as-audio), and the timer calls `nextTrack()` — skipping B that the user just landed on. This is a real glitch path on a rapid skip across multiple non-cached tracks where one of them throws yt error 101/150.

**Repro for the skip-glitch**: queue contains A (iframe), B (iframe, region-blocked), C. User skips A → B. B throws 101 within ms → 500ms timer scheduled with `videoId=B`. User skips B → C within 200ms. 300ms later the timer wakes, sees `playbackSource === 'iframe'` (C is also iframe), calls `nextTrack()` → C is skipped to D. User loses C without ever hearing it.

**Fix sketch**: Track these timers in a ref-set, clear all on unmount + on track change. Inside the 500ms timer, also check `currentTrack.trackId === trackAtErrorTime` before firing nextTrack.

**Severity**: P1 — leak is small, but the skip-glitch is a real user-visible bug on multi-skip across blocked tracks.

---

## P2-IF-5 — `volume` in `initPlayer` deps churns the whole init effect on every volume change

**File**: `src/components/YouTubeIframe.tsx:226 (callback def)`, `476 (deps: [volume, nextTrack, setDuration])`, `487–501 (effects depending on initPlayer)`.

`initPlayer` is memoized with `[volume, nextTrack, setDuration]`. Sliding the volume control re-creates `initPlayer` on every tick → both effects at line 487 and 496 re-run because `initPlayer` is in their dep array → both call `initPlayer(youtubeId)`.

It's mostly defended:
- Line 230: `if (playerRef.current && currentVideoIdRef.current === videoId) return;` — no-ops when player is up.
- Line 229: `if (initializingRef.current) return;` — no-ops mid-init.

But during the init window described in **P0-IF-1** (after `new YT.Player` constructed, before `onReady`), `playerRef.current` is set and `currentVideoIdRef.current` matches → no-op. Fine.

The problem: `volume` is **only used inside `onReady`** (line 289 `e.target.setVolume(volume * 100)`). It's not used in the constructor or the destroy/recreate path. Putting it in deps gains nothing and creates re-run pressure on every Zustand volume tick. Not a bug per se but it makes the P0-IF-1 race worse: every volume tick is another chance for the effect to re-fire mid-init and hit the early-return path.

Volume is already kept in sync by the dedicated effect at line 532 (`useEffect(..., [volume, playbackSource])`) which calls `player.setVolume()` directly — duplicate handling.

**Fix sketch**: Drop `volume` from the `initPlayer` dep array; read it via `usePlayerStore.getState().volume` inside `onReady` if needed (it's already not needed — the line 532 effect handles it).

**Severity**: P2 — degrades but works; amplifies P0-IF-1 race surface.

---

## P2-IF-6 — YouTube API script tag is appended on gesture and never removed; ditto `window.onYouTubeIframeAPIReady`

**File**: `src/components/YouTubeIframe.tsx:171–207`

```ts
const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(tag);
window.onYouTubeIframeAPIReady = () => { ... };
```

The cleanup return only removes the click/touchstart listeners (lines 203-206). The `<script>` tag and the `window.onYouTubeIframeAPIReady` global are never cleaned up.

YouTubeIframe is mounted once at the App root (`App.tsx:1162`) and never unmounted, so this is a **one-time leak** in production. But:

- React 18 StrictMode in dev double-invokes effects → first mount runs cleanup → cleanup removes listeners but not script/global → second mount appends a SECOND script tag → both scripts evaluate → second triggers `onYouTubeIframeAPIReady` again → if it has been overwritten, fine; if not, it fires twice (second time `initPlayerRef.current?.(...)` is called again with the same trackId — guarded by `currentVideoIdRef === videoId` so no-op).
- Hot-module-reload in dev re-creates the component → another script tag appended.

In production with no StrictMode, this is benign. Worth flagging for hygiene.

**Fix sketch**: Capture the script element ref and remove on cleanup. Set `window.onYouTubeIframeAPIReady = undefined` on cleanup. Or use a module-level "loaded once" sentinel.

**Severity**: P2 — dev-only nuisance, prod-silent. Listed for completeness.

---

## Verified-clean (not bugs, despite suspicion)

- **`iframeBridge.register(null)`** is called on every destroy (line 220, 238) AND when player swaps. No stale player ref bug from the bridge side itself.
- **Drift-sync interval** (line 605–623) is properly cleared in the cleanup return. `[playbackSource, isPlaying]` deps avoid re-run on every audio tick (the comment at 599-604 explicitly references the past bug fix).
- **Time-update interval** (line 636–665) is properly cleared, with a `document.hidden` guard inside the tick to avoid stale-iframe writes during BG.
- **`OverlayTimingSync`** subscribes to currentTime via Zustand selector — unsubscribes on unmount automatically. Refs in lastRef are local. No leak.
- **Landscape fade-mute timeout** (line 156) IS cleared in the cleanup return. Good.
- **Pointer event handlers on portrait drag layer** (line 821-855) are React-managed, no manual addEventListener. No leak.
