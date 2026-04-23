# VPS lane — extraction pipeline

Two Python + Node processes running on the VPS (OVH Gravelines) that feed
R2 with audio. The client (voyomusic.com) never touches YouTube directly.

## Processes

| File | Role |
|------|------|
| `queue-worker.py` | Drains `voyo_upload_queue`. One process per Chrome profile. Adaptive throttle + per-minute telemetry since 2026-04-23. |
| `queue-worker.ecosystem.js` | pm2 config for the lane processes (env vars, args, restart policy). |
| `voyo-proxy.js` | Reserved for live listener streaming. **Not** involved in extraction — extraction traffic stays on `queue-worker.py` so listener streams never choke on drainer load. |
| `voyo-stream.js` | (Legacy) VPS-owned session streaming. Client code was ripped out 2026-04-22; this file may also be obsolete. |
| `load-test.py` | One-shot test. Queues N tracks, waits, reports ceiling signal + latency + error categories. |

## Adaptive throttle (queue-worker.py since v413 era)

The worker keeps a rolling 40-outcome window, categorizes errors
(`rate_limited`, `format_not_available`, `signature`, `unavailable`,
`timeout`, `network`, `empty_download`, `r2_upload`, `other`), and every
60 seconds:

1. Re-evaluates concurrency:
   - `error_rate_60s ≥ 20%` → halve concurrency (2× cooldown, batch //= 2)
   - `error_rate_60s == 0` AND `queue_depth > 10` AND sustained for 2 min
     → try 25% faster (0.75× cooldown, batch += 1)
2. Emits a `worker_tick` trace to `voyo_playback_events` with:
   `{lane, error_rate_60s, error_rate_300s, latency_p50, latency_p95,
   categories, queue_depth, batch_size, cooldown_min, cooldown_max}`

Bounds are hard-coded so the throttle never chases itself into a burn:

```
MIN_BATCH_SIZE = 1      MAX_BATCH_SIZE = 3  (YT IP-fingerprint ceiling)
MIN_COOLDOWN   = 3s     MAX_COOLDOWN   = 40s
```

## Cookie cache (1h TTL)

Prior version re-dumped Chrome profile cookies per extraction (~1s + disk
churn). Now cached in `/tmp/voyo-lane/cookies-<lane>.txt` with a 1h TTL +
an `invalidate_cookie_cache()` helper that the extraction loop calls on
`signature` / `format_not_available` errors (likely symptoms of stale
SAPISID).

Cookie warmup cron at `/usr/local/bin/voyo-cookie-warmup.py` (every 20
min) keeps the source Chrome profile's SAPISID fresh. See the holy-grail
memory for the full CDP warmup architecture.

## Deploying a new `queue-worker.py`

```bash
# On your laptop
scp vps/queue-worker.py voyo-vps:/opt/voyo/queue-worker.py

# On the VPS — restart both lanes
ssh voyo-vps
sudo pm2 restart voyo-queue-lane-001
sudo pm2 restart voyo-queue-lane-002

# Sanity — watch the adaptive ticks land
sudo pm2 logs voyo-queue-lane-001 --lines 50
# Look for:
#   [vps-lane-001] starting — profile=/opt/voyo/chrome-profile-001 baseline batch=3 cooldown=8-12s
#   [vps-lane-001] ✓ <yt_id> in X.Xs (YYYKB) total=N
#   [vps-lane-001] adaptive: throttle_UP ...   (if backlog is building)
#   [vps-lane-001] adaptive: throttle_DOWN ... (if errors spike)
```

## Reading the `worker_tick` telemetry

Each lane emits a trace every 60s into `voyo_playback_events`. Quick
query to see both lanes right now:

```sql
SELECT
  created_at,
  meta->>'lane'            AS lane,
  (meta->>'error_rate_60s')::float AS err_60s,
  (meta->>'latency_p50')::int      AS p50,
  (meta->>'queue_depth')::int      AS backlog,
  (meta->>'batch_size')::int       AS batch,
  (meta->>'cooldown_min')::int     AS cd_min,
  (meta->>'cooldown_max')::int     AS cd_max
FROM voyo_playback_events
WHERE event_type = 'trace'
  AND meta->>'subtype' = 'worker_tick'
  AND created_at > now() - interval '30 minutes'
ORDER BY created_at DESC;
```

If you see `err_60s` climbing AND `batch` + `cd_min` unchanged, the
throttle hasn't reacted yet — give it another minute.

If you see `batch=1, cd_min=30` holding steady, we're pinned at the
most conservative setting; something is actively flagging the IP and
the back-off has saved us from a burn.

## Running the load test

```bash
export VOYO_SUPABASE_URL=https://anmgyxhnyhbyxzpjhxgx.supabase.co
export VOYO_SUPABASE_SERVICE_KEY=<sb_secret_...>

# 50 cold tracks at priority=5 (below user-tap, above background)
python3 vps/load-test.py --count 50 --priority 5 --source cold

# Output example:
#   LOAD TEST REPORT — 50 tracks submitted
#   ═══════════════════════════════════════════
#     done:       48  (96.0%)
#     failed:     2   (4.0%)
#     extraction_ms  mean=14200  p50=12800  p95=28500
#     failure categories: format_not_available: 2
#     per-lane stats:
#       vps-lane-001: 24 done  mean_lat=13000ms  rate=4.8/min
#       vps-lane-002: 24 done  mean_lat=15400ms  rate=4.7/min
#     CEILING HINT: no 10-track window ever had a failure →
#     today's ceiling is HIGHER than this test. Re-run bigger.
```

Interpretation guide:

- **Success > 95%, no 10-window fails** → ceiling is above this test size.
  Rerun with `--count 100` or `--count 200` until you find the break.
- **First 10-window fail appears** → note the timestamp. That's the
  ceiling for today. The adaptive throttle SHOULD have already started
  dialing down at that point; check `worker_tick` telemetry to confirm.
- **Multiple `rate_limited` fails** → YT explicitly said no. 15-min
  back-off kicks in. Do not re-run for at least that long.

## Holy-grail reminders (DON'T regress)

Per `memory/voyo-holy-grail-pipeline-2026-04-20.md`:

1. Parallel 4-range download — 614× the download step  *(not yet in this file)*
2. Pipelined `ThreadPoolExecutor` — 3× throughput  *(not yet in this file)*
3. yt-dlp library mode — shared YoutubeDL instance  *(not yet in this file)*
4. `player_client=['mweb']` alone — save ~2s/track
5. bgutil-pot plugin with correct `youtubepot-bgutilhttp:base_url=...` format
6. CDP Chrome cookie warmup cron (every 20 min)
7. requests.Session + connection pool
8. Cookie dump cache with 1h TTL  *(IMPLEMENTED 2026-04-23)*

Items marked "not yet" live in the holy-grail memory's reference impl
but are NOT present in this deployed `queue-worker.py`. The adaptive
throttle is a prerequisite for safely landing them — once we have
visibility, we can bring them in one at a time and watch the telemetry
react.
