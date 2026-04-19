# VOYO pipeline — testing playbook

End-to-end validation of the autonomous extraction + playback path. Run these
whenever you touch voyo-proxy, queue-worker, the PWA streaming code, or after
any YouTube-side regression suspicion.

Throughout, `anon key` = `VITE_SUPABASE_ANON_KEY` from `/home/dash/voyo-music/.env`.

---

## 0. Quick health

One-liner to confirm everything is alive:

```bash
ssh vps "sudo -n PM2_HOME=/root/.pm2 pm2 list | grep -E 'voyo-(audio|stream|lane)'"
```

Expect all of these `online`:
- `voyo-audio`   — port 8443, listener streaming
- `voyo-stream`  — port 8444, session orchestrator
- `voyo-lane-001` / `voyo-lane-002`   — always-on queue drainers

If any is `errored` or `stopped`, check the tail of its log under
`/root/.pm2/logs/*-err.log` before anything else.

---

## 1. Lanes are actually polling

```bash
ssh vps "sudo -n tail -5 /var/log/voyo/lane-001-out.log /var/log/voyo/lane-002-out.log"
```

Healthy steady state (idle queue):
- Most recent lines are either `starting — profile=...` or a trailing success `✓ <id> in Ns`
- No `SIGTERM` loop (that means the worker is crashing + restarting)

If you see `Failed to open IPC channel from NODE_CHANNEL_FD`, the `env -i`
wrapper got bypassed — redeploy `vps/queue-worker.py`.

---

## 2. Fresh track end-to-end (the canonical test)

This is the gold test. Pick a YouTube ID that's **not** in R2 yet and drive it
all the way through.

```bash
# 1. pick a fresh ID
FRESH=$(ssh vps "/usr/local/bin/yt-dlp --no-warnings --flat-playlist --print id \
  'ytsearch1:some-obscure-query-here' 2>/dev/null | head -1")
curl -sI "https://voyo-edge.dash-webtv.workers.dev/audio/$FRESH?q=high" \
  -w 'R2: %{http_code}\n' -o /dev/null
# If R2=200, pick a different track — this one's already cached.

# 2. queue it priority=10 (simulates user click)
KEY=<anon key>
curl -sS -X POST "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_upload_queue?on_conflict=youtube_id" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  --data "[{\"youtube_id\":\"$FRESH\",\"status\":\"pending\",\"priority\":10,\
\"requested_by_session\":\"manual-e2e\"}]"

# 3. Supabase upsert RLS doesn't update existing rows — if this ID was ever in
#    the queue before (failed etc.), follow with a PATCH to force-reset:
curl -sS -X PATCH "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_upload_queue?youtube_id=eq.$FRESH" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  --data '{"status":"pending","failure_count":0,"last_error":null,
           "claimed_at":null,"claimed_by_worker":null}'

# 4. watch a lane grab it (takes <3s to claim, 5-30s to extract)
ssh vps "sudo -n tail -f /var/log/voyo/lane-001-out.log" &
# Ctrl-C once you see ✓ <FRESH> in Ns

# 5. confirm R2 + queue row
curl -sI "https://voyo-edge.dash-webtv.workers.dev/audio/$FRESH?q=high" \
  -w 'R2: %{http_code}\n' -o /dev/null
# Expect: R2: 200

curl -s "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_upload_queue?youtube_id=eq.$FRESH&select=status,claimed_by_worker,completed_at" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# Expect: status=done, claimed_by_worker=vps-lane-00N, completed_at set
```

If extraction fails, check `last_error` on the row. Common cases:

| Error pattern | Cause | Fix |
|---|---|---|
| `Video unavailable` on every tier | YouTube genuinely doesn't have that ID, or hardened against the recipe | Pick a different track; if widespread, test manual `yt-dlp --get-url` on VPS |
| `Sign in to confirm you're not a bot` | Profile cookies expired | Log in to chrome-profile-NNN on the VPS via VNC and refresh cookies |
| `Failed to open IPC channel from NODE_CHANNEL_FD` | Lane's env -i wrapper got stripped | Redeploy `vps/queue-worker.py` via `scp + pm2 restart` |
| `Requested format is not available` | Data Sync ID issue (account-family profiles) | Should be masked by player_client cascade; if persistent, add `data_sync_id` to extractor-args |

---

## 3. Playback test (OYE bulb ON)

On `voyomusic.com` logged in:

1. Open NowPlaying (portrait player)
2. Secondary controls row — ⚡ OYÉ button + 💡 lightbulb next to it
3. Ensure bulb is **on** (yellow glow, not dim)
4. Queue 3+ tracks not yet in R2
5. Play the first one
6. Watch `scripts/monitor-tiers.sh` or lane logs — expect N+1 and N+2
   to start extracting ~3s after the first track begins (predictive pre-warm)
7. When current ends, next track should start instantly (already in R2)

If N+1 doesn't extract automatically, `oyePrewarm` is false in `playerStore`
or the `now_playing` SSE isn't firing. Check:

```js
// in browser console
window.__playerStore_DEBUG?.getState().oyePrewarm  // should be true
```

---

## 4. Fade-skip test (bad track in queue)

Verifies graceful handling when a track can't stream.

1. Queue a track with a known-dead YT ID (e.g. `ZZZZZZZZZZZ`)
2. Make it current
3. Expected: audio element fires `onWaiting` → soft fade starts → 4s later
   `usePlayerStore.getState().nextTrack()` is called → next track plays
4. Check `voyo_playback_events` for `stream_stall` with `sub:'skip_on_stall'`:

```bash
KEY=<anon key>
SINCE=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)
curl -s "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_playback_events?created_at=gte.$SINCE&event_type=eq.stream_stall&select=created_at,track_id,meta" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

---

## 5. Priority test (user-click jumps the line)

Queue 30 pending rows at priority=0 (background), then insert one at
priority=10. That one should be extracted BEFORE any of the 30.

```bash
# confirm migration 017 shipped
curl -s "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_upload_queue?select=priority&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# Expect: [{"priority": <some int>}]  — not HTTP 400 'column does not exist'
```

Sort should be `priority DESC, requested_at ASC` on every lane claim.

---

## 6. Telemetry sanity (tier distribution)

```bash
bash /home/dash/voyo-music/scripts/monitor-tiers.sh
```

Healthy output example:
```
[tier-monitor] 42 extractions | noproxy=100% pool=0% home=0% webshare=0%
```

Alerts fire if `noproxy` drops under 85% or `webshare` rises above 5%.

Webshare should be near-zero — if it creeps up, Tier A is failing and
falling through the chain. Investigate `voyo-audio-error.log` for the
root cause.

---

## 7. R2 bucket audit (catch orphans)

Occasionally cross-check R2 contents vs queue status — catches silent
failures where the worker thought it uploaded but R2 rejected.

```bash
KEY=<anon key>
# sample 20 "done" rows
curl -s "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_upload_queue?status=eq.done&select=youtube_id&limit=20" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | python3 -c "
import json, sys, subprocess
for r in json.load(sys.stdin):
    y = r['youtube_id']
    out = subprocess.check_output(['curl','-sI','-o','/dev/null','-w','%{http_code}',
        f'https://voyo-edge.dash-webtv.workers.dev/audio/{y}?q=high']).decode()
    if out != '200': print(f'{y}: {out}')"
```

Silent = all 200s. Any non-200 means the queue says done but R2 doesn't
have it — orphan row, needs manual reset to pending.

---

## 8. Manual recovery one-liners

Reset a single stuck row to pending:
```bash
curl -sS -X PATCH "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_upload_queue?youtube_id=eq.<id>" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  --data '{"status":"pending","failure_count":0,"last_error":null,
           "claimed_at":null,"claimed_by_worker":null}'
```

Force-drain the entire queue right now (bypass lanes, test the extractor):
```bash
RETRY_FAILED=1 bash /home/dash/voyo-music/scripts/vps-drain-queue.sh
```

Full-coverage audit seed:
```bash
python3 /tmp/coverage.py   # (one-off, see session transcript)
```

---

## Definition of "working"

✓ Lanes `online` + polling  
✓ Fresh-track test: queue → lane claim → R2 upload → row done in <60s  
✓ R2 HEAD returns 200 for a `done` row  
✓ PWA can play cached R2 tracks instantly  
✓ OYE bulb pre-warms N+1/N+2 automatically on now_playing  
✓ Fade-skip triggers on a stall > 4s  
✓ `monitor-tiers.sh` shows noproxy ≥85%  

If any of these flip, walk back up this doc to the matching section.
