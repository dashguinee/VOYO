#!/bin/bash
# VPS queue drainer — deploy + run on the VPS itself.
#
# Pulls pending rows from voyo_upload_queue, hits localhost:8443/voyo/audio/{id}
# for each (which triggers Tier A extraction → uploads to R2), then marks the
# row done. Uses the voyo-proxy we already trust.
#
# Usage (local):   ./scripts/vps-drain-queue.sh               # deploy + run on vps
# Usage (on vps):  SUPABASE_KEY=... SESSION_FILTER=seed-2025-2026 bash ~/drain.sh

set -u

# If we are NOT on the vps, scp this file over and run it there under nohup
# so it survives the ssh disconnect.
if [ "${ON_VPS:-0}" != "1" ]; then
  KEY=$(grep -oE '^VITE_SUPABASE_ANON_KEY=.*' /home/dash/voyo-music/.env | cut -d= -f2-)
  [ -z "$KEY" ] && { echo "ERROR: VITE_SUPABASE_ANON_KEY missing in .env" >&2; exit 2; }
  echo "deploying drainer to vps and starting..."
  scp -q "$0" vps:/tmp/voyo-drain.sh
  ssh vps "chmod +x /tmp/voyo-drain.sh && \
    SUPABASE_KEY='$KEY' \
    SESSION_FILTER='seed-2025-2026' \
    RETRY_FAILED='${RETRY_FAILED:-0}' \
    BATCH='${BATCH:-2}' \
    ON_VPS=1 \
    nohup /tmp/voyo-drain.sh > /tmp/voyo-drain.log 2>&1 < /dev/null & \
    disown; \
    echo 'started. tail with: ssh vps tail -f /tmp/voyo-drain.log'"
  echo
  echo "monitor: ssh vps tail -f /tmp/voyo-drain.log"
  exit 0
fi

# ── on-vps execution ────────────────────────────────────────────────────────

URL="${SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
KEY="${SUPABASE_KEY:?need SUPABASE_KEY}"
SESSION_FILTER="${SESSION_FILTER:-}"
BATCH="${BATCH:-2}"                 # concurrent extractions (voyo-proxy 503s above ~4)
PROXY="${PROXY:-https://127.0.0.1:8443}"
MAX_ITER="${MAX_ITER:-0}"           # 0 = until queue empty
# RETRY_FAILED=1 first resets seed rows currently in status=failed back to
# pending (with failure_count=0) then drains. Useful after a different worker
# (e.g. GH Actions) failed the rows with a different error path — VPS Tier A
# with Chrome profile cookies bypasses most of those.
RETRY_FAILED="${RETRY_FAILED:-0}"

extract_one() {
  local yid="$1"
  local row_id="$2"
  local t0=$(date +%s)

  # Trigger extraction by HEAD — the proxy will cache to disk and push to R2.
  # Timeout 90s; Tier A takes 3-8s normally, allow margin for first-run cold.
  # -k: self-signed VPS cert.  -r 0-0: force GET of 1 byte so the proxy
  # runs the full extraction path (HEAD bails out too early).
  local http=$(curl -sSk -o /dev/null -w '%{http_code}' --max-time 90 \
    -r 0-0 "${PROXY}/voyo/audio/${yid}?quality=medium" 2>/dev/null)
  local dt=$(( $(date +%s) - t0 ))

  local status="failed"
  local err=""
  case "$http" in
    200|206|302) status="done" ;;
    *)           err="HTTP $http after ${dt}s" ;;
  esac

  # Update the queue row
  local body
  if [ "$status" = "done" ]; then
    body='{"status":"done","completed_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
  else
    body='{"status":"failed","failure_count":1,"last_error":"'"$err"'"}'
  fi
  curl -sS -o /dev/null -X PATCH \
    "${URL}/rest/v1/voyo_upload_queue?id=eq.${row_id}" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    --data "$body"

  if [ "$status" = "done" ]; then
    echo "[$(date -u +%H:%M:%S)] ✓ $yid (${dt}s)"
  else
    echo "[$(date -u +%H:%M:%S)] ✗ $yid ($err)"
  fi
}

export -f extract_one
export URL KEY PROXY

# Optional pre-step: reset failed seed rows back to pending so this drain
# takes a second crack at them. Scoped to the SESSION_FILTER to avoid
# touching unrelated work.
if [ "$RETRY_FAILED" = "1" ]; then
  reset_filter="status=eq.failed"
  [ -n "$SESSION_FILTER" ] && reset_filter="${reset_filter}&requested_by_session=eq.${SESSION_FILTER}"
  echo "[$(date -u +%H:%M:%S)] RETRY_FAILED=1 — resetting failed rows (filter='$reset_filter') → pending"
  curl -sS -o /dev/null -X PATCH \
    "${URL}/rest/v1/voyo_upload_queue?${reset_filter}" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    --data '{"status":"pending","failure_count":0,"last_error":null}'
fi

iter=0
while true; do
  iter=$((iter+1))
  [ "$MAX_ITER" != "0" ] && [ "$iter" -gt "$MAX_ITER" ] && break

  # Fetch up to 32 pending rows (we'll xargs them in batches of $BATCH)
  filter="status=eq.pending&failure_count=lt.3"
  [ -n "$SESSION_FILTER" ] && filter="${filter}&requested_by_session=eq.${SESSION_FILTER}"
  # Sort by requested_at DESC so freshly-resolved rows (higher quality IDs from
  # v3 / re-resolves) get extracted first. Old stale v1 rows drain last.
  rows=$(curl -sS "${URL}/rest/v1/voyo_upload_queue?select=id,youtube_id&${filter}&order=requested_at.desc&limit=32" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
    | python3 -c "import json,sys; [print(r['youtube_id'], r['id']) for r in json.load(sys.stdin)]")

  if [ -z "$rows" ]; then
    echo "[$(date -u +%H:%M:%S)] queue empty for filter='$filter' — exiting"
    break
  fi

  echo "[$(date -u +%H:%M:%S)] iter=$iter  processing $(echo "$rows" | wc -l) rows (batch=$BATCH)..."

  # Parallel execute: xargs -P $BATCH
  echo "$rows" | xargs -n 2 -P "$BATCH" bash -c 'extract_one "$@"' _
done

echo "[$(date -u +%H:%M:%S)] drainer done after $iter iterations."
