# AUDIT PWA-2 — Service-worker lifecycle, update flow, crash recovery

Scope: `main.tsx` SW registration + message bridge, `App.tsx` UpdateButton
polling / AppErrorBoundary / preflight, `public/service-worker.js` install
+ activate + fetch routing, and `AudioErrorBoundary` interaction with the
outer `AppErrorBoundary`.

Prior pass: `outputs/AUDIT-6-bg-os-recovery.md` flagged (a) force-update
tearing audio mid-track and (b) ChunkLoadError racking up 3 strikes. This
audit re-verifies those on the current code (v404, version.json shipped
with `"force":true`) and adds new findings.

Context for today: `public/version.json` = `{"version":"2026.04.22.404","force":true}`.
So **every running client is currently configured to force-reload** the
next time it polls /version.json and `__APP_VERSION__` diverges. This
makes every finding below live, not theoretical.

---

## P0 · Force-update reload during playback — NO `isPlaying` / `currentTime` guard

**Location:** `src/App.tsx:306-330` (UpdateButton checkVersion)
**Severity:** P0 — today's v404 ship (`force:true`) reloads EVERY playing
client mid-track.

```ts
if (data.version && data.version !== __APP_VERSION__) {
  if (data.force) {
    setForceUpdate(true);
    if (document.pictureInPictureElement) {
      try { await document.exitPictureInPicture(); } catch {}
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    window.location.reload();
  }
}
```

The poll runs on mount (`checkVersion()` at line 333) AND every 2 minutes.
There is zero consideration of playback state:
- `usePlayerStore.getState().isPlaying` — not read.
- `usePlayerStore.getState().currentTime` / `duration` — not read.
- MediaSession state — not read.

So a user who is 0:30 into a 3:45 track, with a BT headset, walking to
work, gets:
1. `/version.json?t=…` fetched.
2. Version mismatch + force:true → `setForceUpdate(true)` flips an
   overlay covering the whole app.
3. `caches.delete()` wipes the SW cache (including `voyo-audio-v2` — see
   P1 below).
4. `window.location.reload()` kills the `<audio>` element immediately.
   No fade, no "will resume from 0:30" marker, no telemetry on what was
   playing.

This is the same finding as AUDIT-6 P1 (`Force-update path in UpdateButton
can nuke mid-track`). Not yet fixed. Now critical because today's ship
has `force:true`.

**Fix (minimum):**
1. Guard the force reload:
   ```ts
   if (data.force) {
     const { isPlaying, currentTime, duration } = usePlayerStore.getState();
     const nearEnd = duration > 0 && (duration - currentTime) < 10;
     const earlyEnough = currentTime < 1;
     if (isPlaying && !earlyEnough && !nearEnd) {
       // Defer until track end — set a flag + listen for 'ended' on the store.
       setPendingForceUpdate(true);
       return;
     }
     // …existing cache-clear + reload…
   }
   ```
2. Persist a resume marker before reload:
   `localStorage.setItem('voyo-force-resume', JSON.stringify({trackId, currentTime, at: Date.now()}))`
   and read+consume it in the AudioPlayer mount path (within a 2-min
   staleness window) so the track resumes where it left off.
3. Wire a telemetry event (`force_update_deferred` / `force_update_applied`)
   with trackId + position so we can see frequency in production.

---

## P0 · ChunkLoadError path has no inner error boundary — 3 strikes in ~40s on a flaky network

**Location:** `src/App.tsx:867-1125` (outer `<Suspense>` + top-level
`<AppErrorBoundary>` at 853 / 1127)
**Severity:** P0 — a flaky cell tower racks up the crash counter to
threshold, triggering a full nuke-and-reload on what was a transient
network event. After nuke the user has no cached assets, so the next
reload is guaranteed slower / more likely to fail again, building a
doom-loop on bad networks.

The lazy-chunk tree:
```ts
const PortraitVOYO = lazy(() => import('./components/voyo/PortraitVOYO'));
const LandscapeVOYO = lazy(() => import('./components/voyo/LandscapeVOYO'));
const VideoMode = lazy(() => import('./components/voyo/VideoMode'));
const ClassicMode = lazy(() => import('./components/classic/ClassicMode'));
const SearchOverlay = lazy(() => import('./components/search/SearchOverlayV2'));
const ArtistPage = lazy(() => import('./components/voyo/ArtistPage'));
const UniversePanel = lazy(() => import('./components/universe/UniversePanel').then(m => ({ default: m.UniversePanel })));
```

All seven lazy chunks sit inside a single `<Suspense>` at `App.tsx:867`
wrapped only by the top-level `<AppErrorBoundary>`. When any of these
import fetches fails (HTTP 504 from Vercel edge, TCP reset, TLS handshake
drop), the Promise rejects with `ChunkLoadError`. That bubbles up through
the Suspense → hits `AppErrorBoundary.componentDidCatch` → calls
`bumpCrashCounter()` at line 173.

The counter bumps without classification:
```ts
componentDidCatch(error: Error, info: ErrorInfo) {
  console.error('[VOYO] Render crash caught by ErrorBoundary:', error, info.componentStack);
  bumpCrashCounter();
  void info;
}
```

No `error.name === 'ChunkLoadError'` check. No `/loading chunk \d+ failed/`
regex. So:
- User on flaky LTE: first lazy import fails → strike 1 → reload button
  → renders same boundary with lazy import → fails again → strike 2 →
  reload → strike 3 → `shouldNuke = true` → user taps reload → nuke path
  clears all caches + unregisters SW.
- Next cold boot: `CACHE_NAME = 'voyo-v122'` is gone so every asset hits
  network. On the same flaky LTE, `precacheFromIndex` (SW install) fails
  per-asset silently (line 37-42), navigation request times out, index.html
  doesn't cache. User is stuck on VoyoSplash until connectivity recovers.

Compounding: `CRASH_WINDOW_MS = 20_000`. User taps reload three times in
20s on a flaky network — very easy, especially because the error UI's
"Hiccup loading. Tap reload to try again." copy invites retries.

**Fix:**
1. Add an inner `<ChunkLoadBoundary>` INSIDE `<Suspense>` (above the main
   tree, below the outer `<AppErrorBoundary>`). Its `componentDidCatch`:
   - If `err.name === 'ChunkLoadError'` OR
     `/Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(err.message)`:
     set internal state to show "Network hiccup — retrying…" toast and
     schedule one `forceUpdate()` after 2s with exponential backoff
     (2s, 4s, 8s, 16s max). Do NOT bump `voyo-crash-counter-v1`.
   - Any other error: re-throw so the outer `AppErrorBoundary` handles it.
2. Alternative / belt-and-braces: in `AppErrorBoundary.componentDidCatch`,
   short-circuit BEFORE bumping if the error is a chunk load error:
   ```ts
   const isChunk = error.name === 'ChunkLoadError' ||
     /loading (css )?chunk|dynamically imported module/i.test(error.message);
   if (isChunk) {
     // retry the page once without bumping
     setTimeout(() => window.location.reload(), 1500);
     return;
   }
   bumpCrashCounter();
   ```
3. On nuke path, DON'T wipe `voyo-audio-v2` — it's orthogonal to the app
   build and wiping it guarantees the first playback after recovery
   re-downloads the stream (same as today's force-update path; see P1
   below).

---

## P1 · `caches.delete()` wipes `voyo-audio-v2` on every force-update / manual update / nuke

**Location:**
- `src/App.tsx:321-324` (UpdateButton force path)
- `src/App.tsx:363-367` (UpdateButton manual "Update available" click)
- `src/App.tsx:137-156` (`nukeAndReload`)

**Severity:** P1 — trashes the entire audio cache on every version bump,
forcing every user to re-download the streams they've already listened to.

All three call sites iterate `caches.keys()` and delete ALL. But
`service-worker.js:7-8` declares:
```js
const CACHE_NAME = 'voyo-v122';
const AUDIO_CACHE_NAME = 'voyo-audio-v2';
```
and the SW's own `activate` handler (line 59-78) deliberately preserves
`AUDIO_CACHE_NAME` across version bumps:
```js
const oldCaches = cacheNames.filter((name) => name !== CACHE_NAME && name !== AUDIO_CACHE_NAME);
```

So the SW's self-maintenance is careful — but the client-side `caches.delete()`
loops bypass it and wipe audio too. Net: every v-bump makes every user
re-download their played tracks. On mobile data in Guinea / SL, that's
direct $ impact on users.

**Fix:**
```ts
const keys = await caches.keys();
const appCacheKeys = keys.filter(k => k !== 'voyo-audio-v2' && !k.startsWith('voyo-audio-'));
await Promise.all(appCacheKeys.map(k => caches.delete(k)));
```

Apply to all 3 call sites. Ideally abstract to a `clearAppCachesOnly()`
helper.

---

## P1 · `AppErrorBoundary` + `AudioErrorBoundary` race on simultaneous throws

**Location:** `src/App.tsx:853-1127` (outer boundary wraps whole tree)
and `src/audio/AudioErrorBoundary.tsx:52-142` (inner boundary wraps
`<AudioPlayer />`)
**Severity:** P1 — interacting crash-counter + remount schemes.

The tree nests:
```
<AppErrorBoundary>                ← crash counter, 20s window, 3 → nuke
  <AuthProvider>
    <Suspense>
      …
      <AudioErrorBoundary>        ← tighter: 5s window, 3 → halt
        <AudioPlayer />
      </AudioErrorBoundary>
      …
    </Suspense>
```

React error-boundary semantics: the NEAREST boundary catches. So an
`AudioPlayer` throw is caught by `AudioErrorBoundary` and does NOT bump
the outer counter — good. But:

1. If `AudioErrorBoundary.componentDidCatch` itself throws (rare — only
   if `trace()` or `usePlayerStore.getState()` throws), that bubbles up
   to `AppErrorBoundary` + bumps the outer counter. Not common but not
   impossible given `trace()` is a sendBeacon wrapper that's been
   touched a lot.
2. `AudioErrorBoundary.componentDidCatch` calls `setTimeout(250ms)` then
   `setState + queueMicrotask`. During the 250ms null-render window,
   anything the rest of the app does that depends on `<audio>` being in
   the DOM (MediaSession handlers, the iframe bridge) can throw into
   `AppErrorBoundary`.
3. `AudioErrorBoundary` halts auto-remount on 3-in-5s (`CRASH_LOOP_THRESHOLD`).
   After halt it just renders `null` forever — but the outer boundary has
   NOT been triggered. So the user sees the full app with no audio
   player at all, no error UI, no way to recover except manual reload.
   The 3-strike NUKE path in `AppErrorBoundary` would never fire for an
   audio-isolated crash loop. We'd sit in silent-audio-halted state.
4. Counters live in different storage: `voyo-crash-counter-v1`
   (sessionStorage, `AppErrorBoundary`) vs `recentCatches: number[]`
   (in-memory, `AudioErrorBoundary`). They don't coordinate.

**Fix:**
1. When `AudioErrorBoundary` halts (3 catches in 5s), surface a toast AND
   a one-tap "Restart audio" button. Currently it's just `return null`
   with no signal.
2. Optionally escalate: after halt, `postMessage` or dispatch a window
   event so `AppErrorBoundary` can bump the shared counter, giving a
   single coherent crash picture.

---

## P1 · Preflight crash-recovery trigger condition is too permissive on some iOS flows

**Location:** `src/App.tsx:246-259` (IIFE at module scope)

```ts
(function preflightCrashRecovery() {
  if (typeof window === 'undefined') return;
  try {
    const hadBootOk = sessionStorage.getItem(BOOT_OK_KEY) === '1';
    const crash = readCrashCounter();
    sessionStorage.removeItem(BOOT_OK_KEY);
    if (!hadBootOk && crash.count >= CRASH_RESET_THRESHOLD) {
      void nukeAndReload();
    }
  } catch { /* noop */ }
})();
```

**Severity:** P1 — rare false-nuke path.

Logic: "if the PREVIOUS session didn't set `BOOT_OK_KEY=1` AND the crash
counter is at threshold, nuke." Intent is a cross-session safety: user
came back to a broken app, we pre-emptively clear everything.

Corner cases:
1. `sessionStorage` is per-tab. If user closes tab then reopens via
   Chrome's "Reopen closed tab" or a share URL, a fresh sessionStorage
   is created — `hadBootOk` is false. If they survived their previous
   session to paint, `crash.count` would have been cleared by
   `clearCrashCounter()` at `App.tsx:432` (the mount effect). BUT if the
   previous session crashed AFTER some survival and before unmount, the
   counter can persist. Across tab restart with fresh sessionStorage,
   counter is reset to 0 anyway → OK.
2. iOS Safari: sessionStorage semantics in "Page Restore" (swipe-back
   cache) differ. When Safari restores from BFCache, module scope doesn't
   re-run at all — IIFE doesn't fire, `BOOT_OK_KEY` is whatever it was.
   Probably fine but untested. Could be verified with `pageshow` event
   (`event.persisted === true` = from BFCache).
3. The counter is bumped BEFORE `nukeAndReload()` completes. `nukeAndReload`
   calls `clearCrashCounter()` on line 138 first, so this is actually
   fine — counter is cleared, then caches wiped, then reload. But if
   `caches.delete` rejects (rare but possible on iOS Safari under
   storage quota pressure), we reload with counter cleared and caches
   half-wiped — inconsistent state. Not a crash, just wasteful.
4. The preflight runs at MODULE scope, BEFORE React mounts. If `nukeAndReload`
   fires, the reload triggers WHILE the page is still painting the
   initial HTML shell. User sees a flash of the bare HTML + an immediate
   reload. Briefly jarring, not catastrophic.

**Fix:**
1. Gate preflight-nuke on BOTH (a) missing `BOOT_OK_KEY` AND (b) at-least-2
   consecutive cross-session failures. Add a counter
   `voyo-boot-fail-count-v1` that bumps every time preflight sees
   `!hadBootOk`, and only nukes when that counter hits 2.
2. Listen for `pageshow` with `event.persisted` to detect BFCache restores
   and skip preflight entirely in that case.

---

## P1 · BG-tab polling is spec-throttled — 2-min interval can stretch to ~10 min

**Location:** `src/App.tsx:334` (setInterval 2-min UpdateButton poll) +
`src/main.tsx:27` (setInterval 5-min SW update)

**Severity:** P1 — update detection is slower than advertised in BG tabs.

`setInterval(fn, 2*60*1000)` is clamped to minimum 1 call/minute when
`document.hidden` (per WHATWG "timer nesting level" + browser BG throttling).
In practice on Chrome Android, `setInterval` in a hidden tab can be
paused entirely during Power Save or when the tab is not the top of the
"recent tabs" list.

Net effects:
- UpdateButton's 2-min poll can skip 2-3 cycles in BG. Users keeping VOYO
  open + switching to other apps might not see `force:true` for 10+
  minutes, depending on OS aggression.
- `reg.update()` SW update check (main.tsx:27, 5-min interval) similarly
  throttles. So the SW + the app poll are out of sync.
- The SW itself fires `SW_UPDATED` on activate, but activation only
  happens when the browser fetches the new SW — which is triggered by
  `reg.update()` OR by a navigation request (fresh HTML fetch).
  Neither happens in a fully-idle BG tab.

Mitigation strategies (not yet implemented):
- `document.addEventListener('visibilitychange', ...)` to kick
  `checkVersion()` immediately on unhide.
- `pageshow` event handler to catch BFCache restore.
- Piggyback version check on user gestures (play, next-track) —
  lightweight enough to do throttled (once per 60s) on any tap.

**Fix:**
```ts
useEffect(() => {
  const onVisible = () => { if (!document.hidden) checkVersion(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onVisible);
  };
}, []);
```
Place inside `UpdateButton`'s existing effect.

---

## P2 · SW cache poisoning is defended for navigation + hashed assets but NOT for `index.html` offline branch

**Location:** `public/service-worker.js:158-173`
**Severity:** P2 — narrow window where a stale index.html can sneak in
and be served to future users.

```js
if (event.request.mode === 'navigate') {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request)
          .then((cached) => cached || caches.match('/offline.html'));
      })
  );
  return;
}
```

Good:
- Only caches 200 OK (prior fix — line 162).
- Network-first means fresh HTML is served when online.

Subtle issue:
- If the network fetch succeeds but the body contains a known-bad HTML
  (e.g. Vercel edge serves a stale cached index.html that references
  now-deleted chunks), we STILL cache it as "good" and the offline
  fallback will serve a broken app. There's no validation of the HTML
  body itself.
- Harder: no TTL on the cached navigation response. If the app goes
  offline for 2 days, the SW will keep serving a 2-day-old index.html
  whose asset hashes are all invalidated by subsequent deploys. On
  reconnect + navigation, it fetches fresh — but the chunk requests
  fired from the stale HTML will 404 from the CDN.

**Fix:**
1. On navigation response, quick-check the response body for a marker
   (e.g. a `<meta name="voyo-build"`) and only cache if present.
2. Add a `Date` header check on the cached index.html; evict if > 7 days.
3. Stamp the shipped `index.html` (via Vite plugin) with
   `<meta name="voyo-build" content="__APP_VERSION__">` and verify in SW.
   This also lets the UpdateButton compare against the active index.html
   version, not just version.json.

---

## P2 · `version.json` network-only on SW side is good, but Vercel/CDN can still cache

**Location:** `public/service-worker.js:132-137` (SW bypass for
version.json) + `src/App.tsx:308` (client cache-buster).

```js
if (event.request.url.includes('/version.json')) return;
```
and
```ts
const res = await fetch('/version.json?t=' + Date.now(), {
  cache: 'no-store',
  signal: AbortSignal.timeout(5000),
});
```

**Severity:** P2 — belt-and-braces is already present (both SW bypass AND
query cache-buster AND `cache: 'no-store'`). Likely fine. One residual
risk: Vercel's CDN honors no-store only if the origin response has the
right `Cache-Control: no-store, must-revalidate` header. Haven't verified
`vercel.json` sets that on `/version.json`.

**Fix (verification):**
Check `/home/dash/voyo-music/vercel.json` for a header override on
`/version.json`:
```json
"headers": [{
  "source": "/version.json",
  "headers": [{ "key": "Cache-Control", "value": "no-store, max-age=0" }]
}]
```

If missing, add. Current setup works mostly because query-string busts
help, but headers are the canonical defense.

---

## P2 · Crash counter reset is implicit (not on a timer)

**Location:** `src/App.tsx:430-433`

```ts
useEffect(() => {
  markBootOk();
  clearCrashCounter();
}, []);
```

**Severity:** P2 — counter behavior is mostly right (20s rolling window
in `readCrashCounter`) but reset semantics are not explicitly
"successful-minute-of-uptime."

What clears the counter:
1. `markBootOk` effect on first mount (line 432) — clears ON first
   successful render.
2. `readCrashCounter` "forgets" entries older than 20s (line 103) — so a
   single crash more than 20s ago is invisible on next read.
3. `nukeAndReload` line 138.

So: if a user survives first paint, counter clears immediately. If a
crash happens AFTER first paint, bumping happens, and unless another
crash happens within 20s, next `readCrashCounter()` call returns 0.
This is actually sensible — just worth noting the counter doesn't bleed
across sessions unless the user actively crashes multiple times in 20s.

Edge: between `componentDidCatch` (bumps counter) and the render of the
error UI (reads counter), there's a React commit. `readCrashCounter` is
called inside `render()` line 179 AFTER `bumpCrashCounter` fires in
`componentDidCatch`. Both run synchronously in the same commit — value
is consistent. OK.

**Verdict:** Low-priority. Could be cleaner with an explicit
`setTimeout(() => clearCrashCounter(), 60_000)` in the mount effect so
"survived a full minute" is the explicit reset condition, but not
strictly needed.

---

## P3 · SW `SW_UPDATED` postMessage doesn't wait for `clients.claim()`

**Location:** `public/service-worker.js:59-78`

```js
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const oldCaches = cacheNames.filter(…);
      return Promise.all(oldCaches.map(…)).then(() => {
        if (oldCaches.length > 0) {
          self.clients.matchAll({ type: 'window' }).then((tabs) => {
            console.log('[SW] Signaling ' + tabs.length + ' tab(s) — new build ready');
            tabs.forEach((tab) => tab.postMessage({ type: 'SW_UPDATED' }));
          });
        }
      });
    })
  );
  self.clients.claim();
});
```

**Severity:** P3 — minor race.

`self.clients.claim()` is outside the `waitUntil` and fires in parallel
with the cache-cleanup promise. `matchAll` is called inside the cleanup
chain — but `matchAll` returns the clients currently controlled by THIS
SW. If `claim()` hasn't resolved yet, `matchAll` may return fewer
clients than expected (pre-claim, only windows that were already
controlled are visible). Net: some tabs may NOT receive `SW_UPDATED`,
so their UpdateButton's SW path stays silent — they fall back to the
2-min polling which is fine but slower.

**Fix:**
Put `self.clients.claim()` inside `event.waitUntil` and `await` it before
the matchAll:
```js
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const oldCaches = cacheNames.filter(n => n !== CACHE_NAME && n !== AUDIO_CACHE_NAME);
    await Promise.all(oldCaches.map(n => caches.delete(n)));
    await self.clients.claim();
    if (oldCaches.length > 0) {
      const tabs = await self.clients.matchAll({ type: 'window' });
      console.log('[SW] Signaling ' + tabs.length + ' tab(s) — new build ready');
      tabs.forEach((tab) => tab.postMessage({ type: 'SW_UPDATED' }));
    }
  })());
});
```

---

## P3 · `precacheFromIndex` regex misses `.mp3`, `.webp`, and TypeScript hash prefixes

**Location:** `public/service-worker.js:34-36`

```js
(html.match(/\/assets\/[a-zA-Z0-9._-]+\.(?:js|css|woff2?|svg|png|webp)/g) || [])
```

**Severity:** P3 — doesn't include `.mp3`, `.ogg`, `.ico`, which aren't
in the index.html normally but are present for `index.html` preloads.
Not a bug, just incomplete. Also the character class `[a-zA-Z0-9._-]+`
is fine for Vite's default hash format but won't match path prefixes
like `/assets/chunks/foo-abc123.js` if Vite ever nests assets. Currently
VOYO uses flat `/assets/foo-hash.js`, so this is fine today.

**Fix (optional):**
Broaden the regex to handle subdirs:
```js
/\/assets\/(?:[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+\.(?:js|css|woff2?|svg|png|webp|mp3|ogg)/g
```

---

## P3 · `voyo-splash-v3` sessionStorage gate ignores shared-session flows

**Location:** `src/App.tsx:411-415` (splash gate)

```ts
const [showSplash, setShowSplash] = useState(() => {
  const splashShown = sessionStorage.getItem('voyo-splash-v3');
  return !splashShown;
});
```

**Severity:** P3 — cosmetic, splash re-shows on every new tab.

`sessionStorage` is per-tab, so opening VOYO in a second tab shows
splash again even though the user just saw it. Low priority but worth a
switch to `localStorage` with a 24h staleness window if we want "once
per day" semantics.

---

## P3 · `handleDashCallback` races AudioErrorBoundary's null-render window

**Location:** `src/App.tsx:446-456`

The DASH auth callback dispatches a synthetic `StorageEvent` on mount.
Inside `AudioErrorBoundary`'s 250ms null-render window, components
listening to this event may try to access `document.querySelector('audio')`
or similar and get null. Not observed in practice but a potential race.

**Severity:** P3 — defensive-only.

---

## Summary — Ranked

| Rank | Finding | File | Action |
|------|---------|------|--------|
| **P0** | Force-update reloads mid-track (NO `isPlaying` guard) — live today via v404 `force:true` | `App.tsx:306-330` | Guard on isPlaying + currentTime; persist resume marker |
| **P0** | ChunkLoadError bumps crash counter — 3 strikes → nuke → worse network re-fetch | `App.tsx:165-175` | Classify errors; inner Suspense boundary that retries not bumps |
| **P1** | `caches.delete()` wipes `voyo-audio-v2` on every update path | `App.tsx:321-324, 363-367, 145-150` | Filter out audio cache keys |
| **P1** | AudioErrorBoundary halt state is silent (no UI, no escalation) | `AudioErrorBoundary.tsx:79-85` | Surface toast + "restart audio" button |
| **P1** | Preflight nuke triggers on single cross-session boot fail | `App.tsx:246-259` | Require 2 consecutive fails + BFCache detection |
| **P1** | BG-tab 2-min poll is spec-throttled | `App.tsx:334` | Add visibilitychange + pageshow listeners |
| **P2** | Navigation cache has no TTL, no body-marker validation | `service-worker.js:158-173` | Stamp index.html, validate on cache |
| **P2** | Verify `vercel.json` sets no-store on version.json | `vercel.json` | Add Cache-Control header |
| **P2** | Crash counter has no explicit "survived a minute" reset | `App.tsx:430-433` | Add 60s timer to clear |
| **P3** | `SW_UPDATED` broadcast races `clients.claim()` | `service-worker.js:59-78` | Move claim inside waitUntil + await |
| **P3** | `precacheFromIndex` regex misses some formats | `service-worker.js:34` | Broaden regex |
| **P3** | Splash re-shows in every new tab (sessionStorage) | `App.tsx:411-415` | Switch to localStorage w/ 24h TTL |

**Two must-fix-today P0s**, both currently active in production given
`public/version.json` ships with `force:true`:
1. Force-update mid-track teardown — every playing user eats an interrupt
   the next time their poll fires.
2. ChunkLoadError → nuke spiral on flaky networks — compounded by (1)
   because force-update clears caches, which means the next boot has to
   hit network on a possibly-flaky link.

Fix (1) first. It's 10 lines of code.
