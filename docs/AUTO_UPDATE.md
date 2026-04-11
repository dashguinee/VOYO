# VOYO Auto-Update System

How a new build reaches users without them needing to manually refresh. Three layers cooperate: build-time version stamping, the polling check, and the service worker. All three need to be in sync.

---

## The chain

```
Build:  public/version.json  →  vite.config.ts stamps __APP_VERSION__ into bundle
Deploy: Vercel serves new index.html + new bundle
Tab:    UpdateButton polls /version.json every 2 min
Tab:    SW also detects new sw.js via reg.update() every 5 min
Trigger: One of them sees the mismatch → either pill OR force reload
```

## Files involved

| File | Role |
|------|------|
| `public/version.json` | The deployable version stamp. Read at build time, served at runtime. |
| `vite.config.ts` | Reads `version.json`, stamps `__APP_VERSION__` into the bundle as a constant. |
| `src/main.tsx` | Registers the service worker with `updateViaCache: 'none'`, schedules `reg.update()` every 5 min, listens for `SW_UPDATED` postMessage. |
| `src/App.tsx` (`UpdateButton`) | Polls `/version.json` every 2 min, compares against `__APP_VERSION__`, shows the pill or triggers force reload. |
| `public/service-worker.js` | Cache-first for hashed assets, network-first for navigation, **bypass for `/version.json`**, postMessages tabs on activation. |

---

## How a deploy reaches users

### Step 1: Bump `version.json`

```json
{"version": "2026.04.11.29", "force": true}
```

- `version` — any monotonically increasing string (we use date.serial)
- `force: true` — wipes all caches and reloads immediately, no user choice
- `force: false` — shows the "Update available" pill, user clicks to reload

### Step 2: Bump SW cache name

```js
// public/service-worker.js
const CACHE_NAME = 'voyo-v22';  // increment
```

This forces the SW to invalidate old caches on activation. Without bumping, the SW keeps serving the old bundle even after deploy.

### Step 3: Build + deploy

```bash
npm run build  # stamps __APP_VERSION__ from version.json
vercel --prod
```

### Step 4: Detection (one of two paths)

**Path A — SW message** (faster, ~5 min):
1. Each open tab schedules `reg.update()` every 5 minutes (set in `main.tsx`)
2. `reg.update()` re-fetches `/service-worker.js` (forced by `updateViaCache: 'none'`)
3. Browser detects byte diff → installs new SW
4. New SW's `install` handler calls `self.skipWaiting()` → activates immediately
5. New SW's `activate` handler:
   - Deletes old caches
   - Calls `self.clients.claim()` → takes control of all open tabs immediately
   - `postMessage({ type: 'SW_UPDATED' })` to every open tab
6. `main.tsx` listener catches the message → dispatches `voyo-update-available` window event
7. `UpdateButton` listens for that event → shows the pill
8. User clicks pill → `caches.keys() → caches.delete(...)` → `window.location.reload()`

**Path B — Version poll** (slower, ~2 min):
1. `UpdateButton` fetches `/version.json?t=${Date.now()}` every 2 minutes
2. **Critical**: SW bypasses `/version.json` so the request hits the network (otherwise stale cached version blocks detection)
3. Compares response `version` against build-time `__APP_VERSION__`
4. If they differ:
   - `force: true` → wipe all caches + reload immediately (no UI)
   - `force: false` → show the pill

### Step 5: Reload

After cache wipe + reload, browser:
1. Fetches fresh `index.html` (network-first)
2. Fetches fresh JS bundles (their hashes are new because Vite content-hashes them)
3. New `__APP_VERSION__` matches `version.json` → no more pill
4. New SW (already activated) serves subsequent requests

---

## The historical bug we fixed

Until v22, the SW's "stale-while-revalidate" handler was caching `/version.json`. Result:
1. `UpdateButton` fetches `/version.json?t=...` (with cache: 'no-store')
2. SW intercepts, returns the STALE cached version from previous build
3. Cached version matches `__APP_VERSION__` → no mismatch → no pill
4. User stays on old build forever

The fix is in `service-worker.js`:

```js
// Skip version.json entirely — it MUST hit the network every time
if (event.request.url.includes('/version.json')) return;
```

`return` without `respondWith` means the SW doesn't intercept, browser handles the fetch normally → fresh response every time.

The other piece of this fix was making the SW activate immediately:

```js
// install handler
self.skipWaiting();

// activate handler
self.clients.claim();
```

Without `skipWaiting`, the new SW sits in "waiting" state until all tabs close. Without `clients.claim`, even after activation, existing tabs keep using the OLD SW until they navigate. Both together = new SW takes over immediately on activation.

---

## When force vs prompt

Use `force: true` for:
- Critical bug fixes (audio breaks, data corruption, payment flow)
- Security patches
- Breaking changes that could leave users in a broken state

Use `force: false` for:
- Visual polish
- New features
- Minor fixes
- Anything where the user can finish what they're doing first

The difference is **user experience**. Force is jarring (full-screen "Updating VOYO" overlay + reload mid-action). Pill is polite (user clicks when ready).

---

## How to test the update flow locally

1. Bump `version.json` to a new number
2. Don't bump SW cache name (so we test version polling, not SW message)
3. `npm run build && vercel --prod`
4. Open the live site in a tab
5. Wait up to 2 minutes for the poll
6. Pill should appear (or force reload if force:true)
7. Verify: new bundle hash in DevTools Network tab

For SW path testing:
1. Bump version.json AND SW cache name
2. Build + deploy
3. Open live site
4. DevTools → Application → Service Workers
5. Wait up to 5 min for `reg.update()` OR click "Update" manually
6. New SW should activate immediately, postMessage tabs
7. Pill appears via `voyo-update-available` event

---

## Common failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Pill never appears after deploy | Forgot to bump `version.json` | Bump it |
| Pill appears but reload loads old bundle | Forgot to bump SW `CACHE_NAME` | Bump it |
| User stuck on old build forever | Old SW serving cached `version.json` | Hard refresh once to get the new SW (which has the bypass) |
| Pill appears on EVERY page load | `__APP_VERSION__` not stamped at build time | Check `vite.config.ts` define block |
| Force reload loops infinitely | `force: true` and the new build still has old `version.json` | Verify `version.json` is in the deployed `dist/` |
