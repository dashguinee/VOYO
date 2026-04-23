# AUDIT-SERVER-vps — VPS + Fly.io surface area

**Scope:** every non-client process / script that could run on the VPS, on Fly.io, or on Dash's laptop feeding the pipeline. Extraction path (`queue-worker.py`) audited only enough to understand integration — per scope. First audit of this surface area; no priors.

**Files read in full:**
`vps/voyo-proxy.js` (1108), `vps/voyo-stream.js` (938), `vps/queue-worker.ecosystem.js` (52), `vps/cron/voyo-cache-prune.sh`, `vps/cron/voyo-health-heal.sh`, `vps/cron/voyo-health-probe.sh`, `vps/cron/yt-dlp-update.sh`, `vps/pool/node-bootstrap.sh`, `vps/pool/README.md`, `vps/yt-dlp-safe`, `vps/README.md`, `server/index.js` (2047), `server/fly.toml`, `server/Dockerfile`, `server/package.json`, `server/stealth.js` (head), `scripts/*.sh` (scanned, recently-modified read), `scripts/home-proxy/*.sh`, `scripts/ship-cookies.sh`, `scripts/vps-drain-queue.sh`, `scripts/install-cron.sh`, `scripts/fix-r2-video-keys.cjs`, `scripts/audio_pipeline_r2.py`, `scripts/upload_to_r2.py`, `scripts/hacker_mode.py`, `scripts/cobalt_pipeline.py`, `scripts/upload-moments-videos.cjs`.

---

## TL;DR

The VPS surface is **two live processes + a dead twin + a legacy Fly.io app + a scripts graveyard**:

- `voyo-proxy.js` (pm2 name `voyo-audio`, :8443) — live, healthy, routes all listener audio. **ONE serious rate-limit hole** (`/voyo/audio/:trackId` is unauthenticated and triggers yt-dlp — anyone on the internet can drive extraction cost). Otherwise well-instrumented, good memory discipline.
- `voyo-stream.js` (:8444) — **dead code**. Client was ripped 2026-04-22 (df8d1f2). No pm2 entry registers it, no client reference exists. File can be deleted.
- `server/index.js` (Fly.io `voyo-music-api.fly.dev`) — **P0 security**: hard-codes R2 access key + secret + account ID in source. File committed. Also: TWO overlapping R2 bucket secret leaks — the same credentials appear in **7 script files** under `scripts/`. Entire Fly.io app is also architecturally obsolete (voyo-edge Worker + `voyo-proxy.js` superseded it).
- `cron/` — all four scripts reasonable. `voyo-health-heal.sh` **reads the Supabase key from /proc/$(pgrep)/environ**, which is a privilege boundary concern but not a leak.
- `pool/` — well-designed, firewalled correctly. Bootstrap script is solid.
- `scripts/home-proxy/voyo-home-daemon.sh` — has a **silent `StrictHostKeyChecking=no`** SSH TOFU bypass on a tunnel to VPS (see finding 7).

## Dead-code recommendation

**Delete immediately** — zero live references, safe to remove:
- `vps/voyo-stream.js` (938 lines)
- `server/index.js` + `server/fly.toml` + `server/Dockerfile` + `server/stealth.js` + `server/package.json` + `server/downloads/` (entire directory — 2000+ lines, **leaks R2 secrets**)
- `scripts/fix-r2-video-keys.cjs`, `scripts/audio_pipeline_r2.py`, `scripts/upload_to_r2.py`, `scripts/hacker_mode.py`, `scripts/cobalt_pipeline.py`, `scripts/upload-moments-videos.cjs` — **all leak the same R2 creds**, all predate R2 being fronted by voyo-edge Worker. Rotate the credentials regardless of whether these files survive.

Net delta: **~4000 LOC of code + a hot-wired Fly.io VM you're paying for** removed from the attack surface.

---

## Findings

### 1. [P0] `server/index.js` and 6 scripts hard-code R2 access key + secret + account ID

**Location:**
- `server/index.js:28-30`
- `scripts/fix-r2-video-keys.cjs:21-23`
- `scripts/audio_pipeline_r2.py:31-33`
- `scripts/upload_to_r2.py:30-32` (has `os.environ.get(...)` wrapper but still falls through to literal default — **leaks in code even if env is set**)
- `scripts/hacker_mode.py:30-32`
- `scripts/cobalt_pipeline.py:36-38`
- `scripts/upload-moments-videos.cjs:26-28`

The exact same three strings (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`) appear literal-hardcoded across all 7 files. `git log` confirms they're committed to master on the `recover: post-crash baseline` snapshot. These credentials give full read/write on two buckets (`voyo-audio` with ~41K tracks, `voyo-feed` with Moments videos). Repo is presumably public or at minimum widely-cloneable (agents + backups + forks).

**Impact:** Anyone with the repo can wipe both R2 buckets or dump all audio to their own R2 bill. The `voyo-edge` Cloudflare Worker is the intended public-facing reader — these raw S3 credentials should not exist in any file.

**Fix (blast-radius-minimizing order):**
1. **Rotate the R2 keys now** in Cloudflare dashboard (create new, swap, delete old).
2. Delete `server/` entirely (see finding 2).
3. For any scripts kept, read creds from `/home/dash/voyo-music/.env` which already has `.env*` gitignored.
4. `git log -p | grep -c "306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52"` — the secret is in git history regardless. Need `git filter-repo` or accept that the rotate is the only real remedy.

---

### 2. [P0] `server/` is a fully-running but dead Fly.io app still burning VM time

**Location:** `server/fly.toml`, `server/index.js:1-2047`, `server/Dockerfile`

`fly.toml` declares app `voyo-music-api` in region `sin`, 1GB RAM, shared-1-cpu, `min_machines_running = 0` (auto-stop). Code binds to 8080 and exposes **~30 endpoints** including `/stream`, `/proxy`, `/cdn/stream/`, `/cdn/art/`, `/r2/stream/`, `/r2/feed/`. Half of them spawn `yt-dlp` inline with hard-coded User-Agent rotation + an **embedded YouTube API key** at `server/index.js:239` (`AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`).

Client code does not reference `fly.dev` or `voyo-music-api` anywhere outside `server/`. The file was last committed on 2026-04-09 (`recover: post-crash baseline`) — superseded by the pm2/voyo-proxy/voyo-edge-Worker/R2 architecture shortly after. On Fly.io with `auto_stop_machines='stop'` + `min_machines_running=0`, this machine wakes on every HTTP hit — so any internet-facing URL still pointing at `voyo-music-api.fly.dev` (old DNS, old bookmark, old browser cache) wakes a VM that spawns yt-dlp with a leaked API key and hard-coded R2 credentials.

**Impact:** live zombie endpoint. Also: `uncaughtException` handler (line 221) explicitly refuses to exit — so once woken, it stays up until fly idles it, regardless of state.

**Fix:** `fly apps destroy voyo-music-api`, then delete the `server/` directory from the repo.

---

### 3. [P0] `voyo-proxy.js` `/voyo/audio/:trackId` has **no auth, no rate limit, no origin check**

**Location:** `vps/voyo-proxy.js:290-292` + `handleAudio` at 319-677.

The public endpoint serves `stream.zionsynapse.online:8443/voyo/audio/{trackId}?quality={...}` with:
- `Access-Control-Allow-Origin: *` (line 139)
- No `X-Voyo-Key` check (only `/voyo/cookies` has that at line 193)
- No per-IP rate limit
- A `MAX_CONCURRENT_FFMPEG = 6` global gate (line 89), but requests beyond that return 503 with `Retry-After: 5` — no exponential back-off, no ban

An attacker can send 6 concurrent cold-track IDs to keep the gate permanently saturated, then in parallel drain Dash's Webshare (`tryHomeOrWebshare` → `openUpstreamViaProxy` at 932-935) or pool bandwidth, or rack up R2 upload egress via `uploadToR2` at 1065-1074. All of it runs without any client identifying itself.

Compare with `server/index.js:345-411` which HAS a per-IP + global rate limiter, though on a dead server.

**Impact:** at scale, a single abuser can flatten extraction for all listeners (6-slot gate), burn Webshare bandwidth until cooldown, or cause R2 upload-egress spikes. During a DashTivi+/VOYO launch this is the attack-of-opportunity.

**Fix:** port the `checkRateLimit` pattern from `server/index.js` into `voyo-proxy.js` before the `audioMatch` branch. Minimum: per-IP 60 req/min for cached hits, 6 req/min for yt-dlp hits. Optional: signed short-lived token from the PWA (the edge worker is well-positioned to mint these).

---

### 4. [P1] `voyo-stream.js` is dead code with a `setInterval` evictCache that deletes `/var/cache/voyo` files if it's ever started

**Location:** `vps/voyo-stream.js:899-928` + entry point 933.

If the file is ever invoked (e.g., pm2 has it saved in `pm2.dump`, or Dash restores from an old ecosystem file, or a future automation runs `node voyo-stream.js` to test something), it will:
- Bind :8444 and start accepting unauthenticated POST /voyo/session/create
- Start an `evictCache()` that fires on boot (line 928) and then every 30 min — this **shares `/var/cache/voyo` with `voyo-proxy.js`**, so if both run they'll race on the same directory with different eviction caps (10GB in both, but different code paths can unlink files mid-serve)
- Keep reading SSL cert at boot (line 60-62) with no try/catch — a cert rotation moment where this accidentally boots will crash hard

**Verification that it's dead:**
- `grep -rn "8444\|voyo/session/create\|voyo-stream" src/ --include=*.ts` → zero hits outside the doc comment in `src/services/voyoStream.ts:5`
- `queue-worker.ecosystem.js` only declares `voyo-lane-001/002` apps
- README at `vps/README.md:13` explicitly flags it as obsolete
- pm2 service name in healer scripts is `voyo-audio` — no `voyo-stream` pm2 reference anywhere

**Fix:** `rm vps/voyo-stream.js`. Then `ssh vps "pm2 delete voyo-stream || true; pm2 save"` to scrub the pm2 dump if it was ever registered.

---

### 5. [P1] `voyo-proxy.js` reads SSL certs at top-level with no error handling (line 96-99)

**Location:** `vps/voyo-proxy.js:96-99`

```
const ssl = {
  key:  fs.readFileSync("/etc/letsencrypt/live/stream.zionsynapse.online/privkey.pem"),
  cert: fs.readFileSync("/etc/letsencrypt/live/stream.zionsynapse.online/fullchain.pem"),
};
```

If certbot renews at 3AM and the cert symlink briefly doesn't exist (rare but documented for certbot), pm2 will crash-loop. `max_restarts: 50` (from the ecosystem spec for lanes — proxy has no explicit `max_restarts`, inherits default 16) will exhaust within ~30 seconds. Same for `voyo-stream.js:60-62`.

**Fix:** wrap in try/catch with a 5-minute retry loop on ENOENT; optional post-hook in certbot to `pm2 reload voyo-audio`.

---

### 6. [P1] `voyo-proxy.js` activeJobs map has three leak defenses but a stale `cookiesBridgeCache` Map grows unbounded

**Location:** `vps/voyo-proxy.js:41,215-242`

`cookiesBridgeCache` is initialized as `null` (line 41) and lazy-created as `Map()` on first cookie-bridge call (line 215). The 10-min TTL is **checked on read but never enforced on write** — entries stay in the map forever, each containing a full Netscape cookie file (~2-10KB). Bounded by the number of `chrome-profile-NN` directories (currently 2), so not a near-term risk. But if the profile count grows to e.g. 20 or Dash does something like `?account=...` enumeration in a test, it compounds.

Also: the `cookiesBridgeCache.get(chosen)` check at line 217 returns stale entries after 10 min to the client's response, but the *stale entry never gets evicted from the map* — it just gets overwritten by the fresh dump (line 242). Correct behavior, but worth flagging.

**Fix:** periodic eviction of stale entries (same pattern as `setInterval` at line 119-134 for TMP_DIR).

---

### 7. [P1] `scripts/home-proxy/voyo-home-daemon.sh` disables host-key checking on a long-lived SSH tunnel

**Location:** `scripts/home-proxy/voyo-home-daemon.sh:54-60`

```
ssh \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -N -R 18888:127.0.0.1:8888 vps
```

This daemon runs **forever**, reconnecting every 5s on failure. `StrictHostKeyChecking=no` + `/dev/null` host-key store means if Dash's ISP is ever MitM'd (or the home router is compromised, or there's a DNS hijack of the `vps` host alias), the daemon silently forwards tinyproxy traffic to an attacker who then sees **every yt-dlp extraction request** — including the cookie files (yt-dlp streams them through the proxy for the download step).

It's especially bad because this exposes YouTube SAPISID/SID cookies, which are full YouTube-account-compromise material.

**Fix:** drop both flags. First-run `ssh vps` accepts the key TOFU-style and writes to `~/.ssh/known_hosts`; subsequent runs use it normally.

---

### 8. [P2] `voyo-health-heal.sh` extracts Supabase key from `/proc/$(pgrep voyo-proxy.js)/environ`

**Location:** `vps/cron/voyo-health-heal.sh:26-28`

```
KEY="$(sudo cat /proc/$(pgrep -f voyo-proxy.js | head -1)/environ 2>/dev/null \
     | tr '\0' '\n' | grep ^VOYO_SUPABASE_ANON_KEY= | cut -d= -f2-)"
```

Works, but:
- Requires `sudo cat` — the script runs under root cron, OK
- If voyo-proxy.js isn't running, `pgrep` returns nothing, `$(...)` expands to empty, `/proc//environ` is invalid → silent `no supabase key, skipping`. Means **if voyo-proxy dies, self-healer goes dark and never requeues stale failed rows**. Compounds the outage.
- The proper fix is to put the key in `/etc/voyo-health.env` (like `voyo-health-probe.sh` does at line 29-32) and source it.

**Fix:** use `/etc/voyo-health.env` consistently across both heal + probe scripts.

---

### 9. [P2] Fly.io config is tiny (1GB RAM) but Dockerfile installs yt-dlp + Deno + ffmpeg

**Location:** `server/fly.toml:19-23`, `server/Dockerfile:1-57`

`1gb` RAM and `shared cpu_kind` for a Node server that spawns `yt-dlp` (Python, ~100MB RSS) plus does **audio transcoding intent** (`ffmpeg` installed but not used in current code) plus holds **5+ in-memory caches** (`streamCache`, `thumbnailCache`, `prefetchCache`, `r2Cache`, `r2FeedCache`, `inFlightRequests`). Thumbnail cache alone is capped at **500 entries × ~50KB average image = 25MB**, multiplied by other caches the peak is ~200MB. Leaves headroom, but a DDoS on `/cdn/stream/` would OOM-kill well before the rate limiter saves us.

**Moot if the app is destroyed (finding 2)**. Noted for completeness.

---

### 10. [P2] `voyo-proxy.js` `uploadToR2` does `fs.readFileSync(filePath)` into memory before POST

**Location:** `vps/voyo-proxy.js:1065-1074`

```js
async function uploadToR2(filePath, trackId, quality) {
  const buf = fs.readFileSync(filePath);  // whole file into RAM
  const url = `${R2_BASE}/upload/${trackId}?q=${quality}`;
  const res = await fetch(url, { method: "POST", body: buf, ... });
}
```

Cache files are 2-8MB (opus at 64-320kbps × 60-240s). 6 concurrent uploads × 8MB = 48MB spike. VPS is 4 vCPU / presumably ≥4GB RAM, so not a problem *today*. Becomes one if concurrent playback grows or audio quality defaults go up. The pipe-tee path does this correctly with streaming; only the **post-transcode R2 upload** reads the whole file.

**Fix:** switch to `fs.createReadStream(filePath)` body + `Content-Length` from the fs.statSync. Or — more elegantly — use `Readable.toWeb` and pass as a streaming body.

---

### 11. [P3] `voyo-proxy.js` console.logs track IDs + FFmpeg stderr but doesn't log raw upstream URLs — good

**Location:** scattered; representative lines 324, 627, 905-907.

Scanned all `console.log/error` calls; **no raw googlevideo URLs logged, no cookies, no SAPISID**. The only logged secret-adjacent data is the Chrome profile label (e.g., `chrome-profile-002`) — non-sensitive. Health probe script also respects this (`voyo-health-probe.sh:73` truncates OUT to 100 chars before logging). Good discipline overall.

No fix needed.

---

### 12. [P3] Cron cadence review

| Script | Cadence | Reasonable? |
|--------|---------|-------------|
| `voyo-cache-prune.sh` | Daily (cron.daily, 14-day atime + 10GB size cap) | Yes |
| `voyo-health-heal.sh` | Every 15 min | Yes — queue reset is idempotent |
| `voyo-health-probe.sh` | Every 15 min | Yes — paired with heal |
| `yt-dlp-update.sh` (two variants — `vps/cron/` + `scripts/install-cron.sh`) | Weekly Sun 03:00 UTC + a "first test run" on install | **Flag: duplicate scripts** — `vps/cron/yt-dlp-update.sh` and `scripts/install-cron.sh` contain nearly-identical logic. Only one should be installed. |

**Fix for the duplicate:** delete `scripts/install-cron.sh` (it also has the one-shot test-run side effect that isn't idempotent across re-invocations).

---

### 13. [P3] `voyo-stream.js` (if it ever ran) has MediaPipeline `setImmediate(runSession)` that never awaits → unhandled rejection trap is missing

**Location:** `vps/voyo-stream.js:673-677`

```js
setImmediate(() => {
  runSession(session).catch(e => {
    logGlobal(`runSession error [${session.id}]: ${e.message}`);
  });
});
```

The catch exists, so this is correct. Called out only because I was looking for it per the scope note. No fix.

---

### 14. [P3] `voyo-proxy.js` cookies-bridge shell-interpolates profile path into `exec` (line 230-232) — safe *today* because source is `fs.readdirSync` filtered by regex, but the pattern is risky

**Location:** `vps/voyo-proxy.js:230-232`

```js
const tmpFile = `/tmp/voyo-cookies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
const cmd = `/usr/local/bin/voyo-dump-cookies "${chosen}" "${tmpFile}" 2>&1`;
exec(cmd, { timeout: 20_000 }, (err) => { ... });
```

`chosen` is always `/opt/voyo/chrome-profile-NN` (filtered by `/^chrome-profile-\d+$/`). `tmpFile` is `Date.now()` + random string. Neither contains shell metacharacters in practice. But using `exec` with a string template (vs `execFile` with argv array) is the pattern that *next year's ill-advised refactor* will turn into an RCE — e.g., if someone adds `?account=` pass-through.

Same pattern at lines 867, 880, 963, 976 (yt-dlp + curl commands that interpolate URLs and cookie paths) — currently safe because `trackId` is regex-validated earlier (line 326), but again, brittle by convention.

**Fix:** migrate to `execFile(binary, [args])` everywhere. Low-priority because no exploitable vector exists today, but a material hardening upgrade.

---

## Summary of recommended actions

| Priority | Action | File(s) |
|---|---|---|
| **P0 NOW** | Rotate R2 credentials in Cloudflare | (external) |
| **P0** | `fly apps destroy voyo-music-api` + delete `server/` directory | `server/*` |
| **P0** | Add per-IP rate limit to `/voyo/audio/:trackId` | `vps/voyo-proxy.js` |
| **P0** | Delete 6 scripts leaking R2 creds (or strip + move to `.env`) | `scripts/fix-r2-video-keys.cjs`, `scripts/audio_pipeline_r2.py`, `scripts/upload_to_r2.py`, `scripts/hacker_mode.py`, `scripts/cobalt_pipeline.py`, `scripts/upload-moments-videos.cjs` |
| P1 | Delete `voyo-stream.js` + scrub pm2 dump | `vps/voyo-stream.js` |
| P1 | Wrap cert `readFileSync` in try/retry | `vps/voyo-proxy.js:96-99` |
| P1 | Drop `StrictHostKeyChecking=no` on home-proxy daemon | `scripts/home-proxy/voyo-home-daemon.sh:58-59` |
| P1 | Evict stale `cookiesBridgeCache` entries | `vps/voyo-proxy.js:215-242` |
| P2 | Move `VOYO_SUPABASE_ANON_KEY` to `/etc/voyo-health.env` | `vps/cron/voyo-health-heal.sh:26-28` |
| P2 | Stream R2 upload body (not readFileSync) | `vps/voyo-proxy.js:1065-1074` |
| P2 | Delete duplicate `scripts/install-cron.sh` | (use `vps/cron/yt-dlp-update.sh`) |
| P3 | Migrate `exec` → `execFile` in proxy | `vps/voyo-proxy.js:230-232,867-914,963-1011` |

Dead-code deletion alone: `~4000 LOC + 1 Fly VM + 7 credential-leaking files`. Single-day cleanup, high operational clarity gain.
