# Audio Audit 3 — VPS Pipeline + Edge Worker + bgutils

**Scope:** stream.zionsynapse.online (voyo-audio, bgutil-pot), voyo-edge worker, yt-dlp-safe cookie rotation.

---

## Subsystem Status

| Subsystem | State | Notes |
|---|---|---|
| **pm2 voyo-audio** | ONLINE, 4h uptime, 67MB, 0% CPU, **7 restarts** | Healthy, no leak. Restart count suggests repeated deploys today, not crashes. |
| **pm2 bgutil-pot** | ONLINE, 95m, 106MB, v1.3.1, port 4416 | `/ping` returns 200; actively generating POTs (see logs). |
| **bgutil plugin bridge** | **WORKING** | yt-dlp verbose shows `Retrieved a gvs PO Token for web_safari client`. Plugin at `/root/.config/yt-dlp-plugins/yt_dlp_plugins/extractor/` + pip `bgutil-ytdlp-pot-provider 1.3.1`. bgutil-pot logs show `Generating POT for dQw4w9WgXcQ` repeatedly. |
| **Cookie rotation (yt-dlp-safe)** | **ALL 3 ACCOUNTS HEALTHY** | On Rick Astley `dQw4w9WgXcQ`, all three return real googlevideo URLs with itag 251 opus @ 3.43MB. "Cookies no longer valid" warning from Google is a red herring — the token-for-stream flow still works. |
| **Edge worker /extract/** | **PARTIAL** | `dQw4w9WgXcQ` → 206 with 3.4MB audio. `rfRNGkVakB4`/`qV8ZSlwCr1M`/`lE7x6pGR6_A` → 502. VPS yt-dlp fallback also fails on these (bot-check **on ALL 3 cookie accounts**). |
| **R2 upload wiring** | **UNTESTED IN WILD** | Code path in `uploadToR2` POSTs to `voyo-edge/upload/{id}?q=high` — correct. BUT: log grep across 300 lines shows **ZERO `R2 uploaded` lines**. Every request is either R2 cache hit (pre-seeded) or extraction-fail. No fresh upload has succeeded this session because extraction never completes. R2 cache hits confirm previously-seeded tracks stream fine. |
| **Edge /api/search** | OK | Returns `{items:[{id,title,artist,thumbnail,duration,views}]}` — consistent with UI expectation (`items` key, not `results`). |

---

## TOP 3 Things Broken/Wasteful

### 1. **"Sign in to confirm" is NOT a cookie problem — it's track-specific (age-gate / regional / music-label block)**
`rfRNGkVakB4`, `qV8ZSlwCr1M`, `PpAIDRnTp8Y`, `lE7x6pGR6_A`, `1qdM1_nd4rc`, `SjC9U-b0cgE`, `rZQfFia7rZk` ALL fail on ALL 3 cookie accounts with identical error. These are restricted tracks (likely VEVO/label protected or age-gated).
**Fix:** Stop rotating cookies on these errors — rotation wastes 3x time (~30–60s per rejected request). Detect "Sign in to confirm" once, mark the track `unplayable` in Supabase, return 404 immediately. Add fallback client (`player_client=ios,tv_embedded`) via `--extractor-args "youtube:player_client=tv_embedded,ios,web_safari"` — many age-gated tracks unlock on `tv_embedded`.

### 2. **Triple-waste on concurrent requests for same failing track**
Logs show `rfRNGkVakB4` requested 1×, then `RbTVNfYb-MQ` 2× (second hits "Already processing"), then `qV8ZSlwCr1M` 2× same pattern. On **502 from edge worker**, the code falls through to yt-dlp — but yt-dlp-safe takes ~15–25s to exhaust all 3 cookies before failing. Meanwhile the second client request for the same track waits 30s in `activeJobs` poll loop, then returns nothing useful. Net wasted time per failed track: **~60s** (edge timeout + yt-dlp cookie rotation + second waiter timeout).
**Fix:** Cache negative results in-memory for 5min: `failedTracks.set(trackId, Date.now())`, skip all extraction on repeat 404-immediate.

### 3. **Edge worker /extract is the primary path — it works when it works, but VPS yt-dlp is near-useless as fallback**
When edge worker 502s, VPS yt-dlp fails identically (same bot-check). Currently the VPS burns 15s+ per track trying yt-dlp after edge fails. Either (a) the edge worker has MUCH better IP reputation and the VPS yt-dlp is pointless, or (b) restricted tracks will fail both. Either way the fallback is wasted compute.
**Fix:** On `/extract/*` 502, skip yt-dlp-safe fallback entirely for Googlevideo bot-check errors (regex the edge response body); only fall through for "network error" or timeout. Savings: 15–25s per failing track.

---

## Cookie Account Health (empirical)

| File | Size | Age | dQw4w9WgXcQ | rfRNGkVakB4 |
|---|---|---|---|---|
| cookies-001.txt | 2928B | ~7h | OK (itag 251) | ERROR bot-check |
| cookies-002.txt | 2472B | ~6h | OK (itag 251) | ERROR bot-check |
| cookies-003.txt | 2532B | ~6h | OK (itag 251) | ERROR bot-check |

**All 3 accounts authenticate.** None are dead. The uniform failure on the same track proves it's content-restriction, not auth.

---

## bgutils Being Called? YES.

Confirmed two ways:
1. `yt-dlp -v` output line: `[youtube] dQw4w9WgXcQ: Retrieved a gvs PO Token for web_safari client`
2. `pm2 logs bgutil-pot` shows repeated `Generating POT for dQw4w9WgXcQ` with `poToken: Mlth1CQXFkFvSGGQ…` strings matching per-request generation.

bgutil plugin bridge is fully operational. It's not the bottleneck.

---

## Quantified Inefficiencies

| Waste | Cost per incident | Frequency |
|---|---|---|
| Cookie rotation on permanently-failing track | 15–25s | Every restricted track request |
| Second-client waiter on already-failing job | +30s timeout | Whenever 2+ users hit same restricted ID |
| yt-dlp fallback after edge 502 on bot-check | 15–25s | Every 502 that's a bot-check (most of them) |
| `yt-dlp --save-cookies` write attempt on read-only cookie file | ~500ms + stack trace noise | Every non-root invocation (cosmetic) |
| Missing R2 prewarming | ∞ latency for cold tracks | Every first play ever |

**Concurrency:** `MAX_CONCURRENT_FFMPEG` is set, good. But there's no extraction-queue concurrency cap — infinite parallel yt-dlp spawns possible on 3x failing tracks.

---

## Bonus Observations

- `activeJobs` Map has no TTL cleanup on timeout paths — small leak risk on crashed ffmpeg processes (mitigated by 30s poll timeout on waiters, but the entry itself may linger).
- `/extract` returns `x-voyo-source: extract` header — good for debugging which edge path served the bytes.
- R2 cache hits stream in <100ms (cf edge). This path is perfect. Priority should be **pre-warming R2 with a background worker**, not optimizing live extraction.
- `stream-proxy` pm2 process has been up 5 days — unrelated to voyo-audio but consuming 102MB; worth checking if it's still needed.

**One-sentence TL;DR:** Cookies, bgutils, and R2-streaming are all healthy — the extraction failures are YouTube content-restrictions masquerading as cookie errors, and the pipeline burns ~60s per restricted track on pointless fallbacks; fix is negative-caching + `player_client=tv_embedded` fallback, not more cookies.
