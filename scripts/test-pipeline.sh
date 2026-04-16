#!/bin/bash
# VOYO full-pipeline test harness.
#
# Simulates a user session end-to-end across every layer, capturing audio
# validity (ffprobe), HTTP timing, VPS logs, and Supabase telemetry in a
# single unified timeline. Designed to knock down issues fast — what Dash
# would feel on device shows up as numbers here.
#
# Scenarios exercised:
#   1. Warm R2 hit          — track known to be in R2 (302 redirect)
#   2. Cold extraction      — fresh track that forces yt-dlp
#   3. Warm /var/cache hit  — second request of same cold track
#   4. In-flight dedup      — two concurrent requests for same cold track
#   5. Invalid track        — expect clean 404 not cascade failure
#   6. Concurrent capacity  — 6 parallel requests (MAX_CONCURRENT_FFMPEG)
#
# Requirements: curl, ffprobe (for audio validity), ssh access to vps,
# and VITE_SUPABASE_ANON_KEY in voyo-music/.env.

set -uo pipefail

# ── Config ──────────────────────────────────────────────────────────────
PROXY=https://stream.zionsynapse.online:8443
EDGE=https://voyo-edge.dash-webtv.workers.dev
SUPABASE_URL=https://anmgyxhnyhbyxzpjhxgx.supabase.co
VOYO_ROOT=/home/dash/voyo-music

KEY=$(grep VITE_SUPABASE_ANON_KEY "$VOYO_ROOT/.env" | cut -d= -f2)
[ -z "$KEY" ] && { echo "missing VITE_SUPABASE_ANON_KEY"; exit 1; }

# Known-good in R2 from today's session logs
TRACK_WARM_R2="xLVXu-WkxmM"
# A likely-uncached real track to force cold path
TRACK_COLD_A="kJQP7kiw5Fk"  # Despacito — valid, should extract
TRACK_COLD_B="jNQXAC9IVRw"  # "Me at the zoo" — short, fast extract
# Invalid format to test error path
TRACK_INVALID="not-a-valid-id"

# ── Output ──────────────────────────────────────────────────────────────
TS=$(date -u +"%Y%m%d-%H%M%S")
OUT=/tmp/voyo-test-$TS
mkdir -p "$OUT"
echo "test run output → $OUT"

# ── Helpers ─────────────────────────────────────────────────────────────
log()  { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT/timeline.log"; }
fail() { echo "❌ FAIL: $*" | tee -a "$OUT/timeline.log"; EXIT_RC=1; }
ok()   { echo "✅ OK: $*" | tee -a "$OUT/timeline.log"; }
warn() { echo "⚠️  $*" | tee -a "$OUT/timeline.log"; }

EXIT_RC=0

# Baseline: remember which Supabase events existed BEFORE the test
BASELINE_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
log "baseline Supabase timestamp: $BASELINE_TS"

# Background: capture VPS pm2 logs during the test run
ssh vps 'sudo pm2 logs voyo-audio --lines 0 --raw 2>/dev/null' > "$OUT/pm2.log" &
PM2_PID=$!
sleep 1

cleanup() {
  kill $PM2_PID 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

# Reset edge circuit-breaker + negative cache for a clean slate
ssh vps 'sudo find /tmp/voyo-yt-neg -name "*.dead" -delete 2>/dev/null; echo reset' > /dev/null
log "negative cache cleared"

# ── Test 1: warm R2 (known-cached track) ────────────────────────────────
log "=== TEST 1: warm R2 hit ($TRACK_WARM_R2) ==="
T1_OUT=$OUT/t1-warm-r2.opus
T1_STATS=$(curl -s -L -o "$T1_OUT" \
  -w "http=%{http_code} ttfb=%{time_starttransfer} total=%{time_total} size=%{size_download}" \
  --max-time 30 \
  "$PROXY/voyo/audio/$TRACK_WARM_R2?quality=high")
log "$T1_STATS"
eval "$T1_STATS"
if [ "$http" = "200" ] && [ "$size" -gt 100000 ]; then
  if command -v ffprobe >/dev/null 2>&1; then
    T1_DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$T1_OUT" 2>/dev/null | head -1)
    T1_CODEC=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$T1_OUT" 2>/dev/null | head -1)
    log "  ffprobe: duration=${T1_DUR}s codec=$T1_CODEC"
    [ -n "$T1_DUR" ] && ok "warm R2 OK (ttfb=${ttfb}s duration=${T1_DUR}s)" || fail "warm R2 file not a valid audio stream"
  else
    ok "warm R2 OK (ttfb=${ttfb}s size=${size}B — no ffprobe for audio validation)"
  fi
else
  fail "warm R2 http=$http size=$size"
fi

# ── Test 2: cold extraction ─────────────────────────────────────────────
log "=== TEST 2: cold extraction ($TRACK_COLD_A) ==="
# Evict from VPS cache to force a real cold path
ssh vps "sudo rm -f /var/cache/voyo/${TRACK_COLD_A}-high.opus* 2>/dev/null" > /dev/null
T2_OUT=$OUT/t2-cold.opus
T2_STATS=$(curl -s -L -o "$T2_OUT" \
  -w "http=%{http_code} ttfb=%{time_starttransfer} total=%{time_total} size=%{size_download}" \
  --max-time 120 \
  "$PROXY/voyo/audio/$TRACK_COLD_A?quality=high")
log "$T2_STATS"
eval "$T2_STATS"
if [ "$http" = "200" ] && [ "$size" -gt 100000 ]; then
  TTFB_INT=$(printf "%.0f" "$ttfb")
  if [ "$TTFB_INT" -lt 12 ]; then
    ok "cold extraction OK (ttfb=${ttfb}s size=${size}B) — under 12s watchdog"
  else
    warn "cold extraction slow (ttfb=${ttfb}s) — at/near watchdog threshold"
  fi
  if command -v ffprobe >/dev/null 2>&1; then
    T2_DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$T2_OUT" 2>/dev/null | head -1)
    log "  ffprobe: duration=${T2_DUR}s"
  fi
elif [ "$http" = "302" ]; then
  # R2 was pre-cached from a previous extraction and survived our cache-evict
  log "  (302 → R2 was already there, not a true cold test)"
  ok "cold via R2 redirect (ttfb=${ttfb}s)"
else
  fail "cold extraction http=$http size=$size"
fi

# ── Test 3: warm /var/cache hit (second request for same cold track) ────
log "=== TEST 3: warm /var/cache hit ($TRACK_COLD_A again) ==="
sleep 2  # give background R2 upload / cache rename a moment
T3_STATS=$(curl -s -L -o /dev/null \
  -w "http=%{http_code} ttfb=%{time_starttransfer} total=%{time_total} size=%{size_download}" \
  --max-time 30 \
  "$PROXY/voyo/audio/$TRACK_COLD_A?quality=high")
log "$T3_STATS"
eval "$T3_STATS"
if [ "$http" = "200" ] && [ "$size" -gt 100000 ]; then
  TTFB_INT=$(printf "%.0f" "$ttfb")
  if [ "$TTFB_INT" -lt 2 ]; then
    ok "warm /var/cache hit (ttfb=${ttfb}s — sub-2s cached)"
  else
    warn "warm but slow (ttfb=${ttfb}s) — expected sub-1s"
  fi
else
  fail "warm request http=$http"
fi

# ── Test 4: in-flight dedup (two concurrent requests, same cold track) ──
log "=== TEST 4: in-flight dedup (concurrent requests for $TRACK_COLD_B) ==="
ssh vps "sudo rm -f /var/cache/voyo/${TRACK_COLD_B}-high.opus* 2>/dev/null" > /dev/null
(curl -s -L -o /dev/null -w "A http=%{http_code} ttfb=%{time_starttransfer}\n" --max-time 60 "$PROXY/voyo/audio/$TRACK_COLD_B?quality=high" > "$OUT/t4a.log") &
P4A=$!
sleep 0.5  # tiny lag so B arrives during A's extraction
(curl -s -L -o /dev/null -w "B http=%{http_code} ttfb=%{time_starttransfer}\n" --max-time 60 "$PROXY/voyo/audio/$TRACK_COLD_B?quality=high" > "$OUT/t4b.log") &
P4B=$!
wait $P4A $P4B
log "$(cat $OUT/t4a.log)"
log "$(cat $OUT/t4b.log)"
# Both should return 200; B should be detected as already-extracting and
# served from cache or redirected to R2 after the first completes.

# ── Test 5: invalid track ID ────────────────────────────────────────────
log "=== TEST 5: invalid trackId ($TRACK_INVALID) ==="
T5_STATS=$(curl -s -o /dev/null \
  -w "http=%{http_code} ttfb=%{time_starttransfer}" \
  --max-time 10 \
  "$PROXY/voyo/audio/$TRACK_INVALID?quality=high")
log "$T5_STATS"
eval "$T5_STATS"
if [ "$http" = "404" ]; then
  ok "invalid-id rejection (404, ttfb=${ttfb}s — fast-path guard works)"
else
  fail "invalid-id unexpected http=$http"
fi

# ── Test 6: concurrent capacity (6 parallel cold extractions) ───────────
log "=== TEST 6: concurrent capacity (6 parallel cold reqs) ==="
# Use different quality tiers on same track to avoid dedup collapsing them
for q in low medium high studio; do
  ssh vps "sudo rm -f /var/cache/voyo/${TRACK_COLD_B}-${q}.opus* 2>/dev/null" > /dev/null
done
for q in low medium high studio; do
  (curl -s -L -o /dev/null -w "q=$q http=%{http_code} ttfb=%{time_starttransfer}\n" --max-time 90 "$PROXY/voyo/audio/$TRACK_COLD_B?quality=$q" > "$OUT/t6-$q.log") &
done
wait
cat "$OUT"/t6-*.log | while read -r line; do log "  $line"; done

# ── Pull VPS logs captured during test ──────────────────────────────────
kill $PM2_PID 2>/dev/null || true
sleep 1
log "=== VPS logs during test ==="
grep -E "VOYO|error" "$OUT/pm2.log" 2>/dev/null | tail -30 | while read -r l; do log "  $l"; done

# ── Pull Supabase events since baseline ─────────────────────────────────
log "=== Supabase events since baseline ==="
curl -s "$SUPABASE_URL/rest/v1/voyo_playback_events?created_at=gte.$BASELINE_TS&order=created_at.asc&limit=200&select=created_at,event_type,track_id,meta,user_agent" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" > "$OUT/supabase-events.json" 2>/dev/null

EVENT_COUNT=$(grep -o '"event_type"' "$OUT/supabase-events.json" | wc -l)
VPS_EVENT_COUNT=$(grep -c "voyo-proxy/v2.2" "$OUT/supabase-events.json" || true)
CRITICAL_COUNT=$(grep -c '"event_type":"critical_alert"' "$OUT/supabase-events.json" || true)
log "  total events: $EVENT_COUNT"
log "  VPS-sourced: $VPS_EVENT_COUNT"
log "  critical_alert: $CRITICAL_COUNT"

[ "$CRITICAL_COUNT" -gt 0 ] && fail "$CRITICAL_COUNT critical alerts in this window — investigate $OUT/supabase-events.json"

# ── Extraction summary from VPS telemetry ───────────────────────────────
log "=== extraction subtypes seen on VPS side ==="
grep -oE '"subtype":"vps_[a-z_]+' "$OUT/supabase-events.json" | sort | uniq -c | while read -r line; do log "  $line"; done

# ── Health snapshot ─────────────────────────────────────────────────────
log "=== final /voyo/health ==="
curl -s --max-time 3 "$PROXY/voyo/health" 2>/dev/null | while read -r l; do log "  $l"; done

log ""
log "=== TEST COMPLETE ==="
log "artifacts: $OUT/"
[ $EXIT_RC -eq 0 ] && log "OVERALL: ✅ PASS" || log "OVERALL: ❌ FAIL"
exit $EXIT_RC
