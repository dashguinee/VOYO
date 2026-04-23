#!/bin/bash
# VOYO self-healer — runs every 15 minutes on the VPS.
#
# 1) Probes each /opt/voyo/chrome-profile-NNN for "logged-out" state by
#    dumping cookies and checking for SAPISID presence. If a profile's
#    cookie set is missing critical auth cookies, log an alert — Dash
#    (or a future auto-relog bot) re-authenticates manually.
#
# 2) Reads voyo_upload_queue for rows with status='failed' whose
#    updated_at is > 6 hours old and failure_count >= 3. Resets them to
#    status='pending' and failure_count=0 so the next worker retries.
#    Transient failures (YouTube tightening, Chrome relog, network hiccup)
#    often self-heal within hours — stale 'failed' rows that are actually
#    extractable deserve another shot.
#
# 3) Prunes voyo_upload_queue rows with status='done' older than 30 days
#    so the table doesn't grow unbounded.

set -e
LOG="/home/ubuntu/voyo-health-heal.log"
ENV_FILE=/etc/voyo-health.env
exec >>"$LOG" 2>&1
echo ""
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="

# Load Supabase credentials from /etc/voyo-health.env (same file as
# voyo-health-probe.sh). Decoupled from the voyo-proxy.js process env so
# heal still works when voyo-audio is down — self-heal during outage is
# the whole point. Expected vars: VOYO_SUPABASE_URL, VOYO_SUPABASE_ANON_KEY.
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

URL="${VOYO_SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
KEY="${VOYO_SUPABASE_ANON_KEY:-}"
if [ -z "$KEY" ]; then echo "no VOYO_SUPABASE_ANON_KEY in $ENV_FILE — skipping"; exit 0; fi

# ── 1. Chrome profile health check ───────────────────────────────────────

BAD_PROFILES=()
for P in /opt/voyo/chrome-profile-*; do
  [ -d "$P" ] || continue
  NAME=$(basename "$P")
  OUT=$(timeout 15 sudo /usr/local/bin/voyo-dump-cookies "$P" "/tmp/hh-$NAME.txt" 2>&1 || true)
  if [ ! -s "/tmp/hh-$NAME.txt" ]; then
    echo "PROFILE BAD: $NAME — cookie dump failed"
    BAD_PROFILES+=("$NAME")
    rm -f "/tmp/hh-$NAME.txt"
    continue
  fi
  # Check for critical YouTube auth cookies
  if ! grep -qE '^\.youtube\.com.*(SAPISID|SID)' "/tmp/hh-$NAME.txt"; then
    echo "PROFILE STALE: $NAME — missing SAPISID/SID (likely logged out)"
    BAD_PROFILES+=("$NAME")
  fi
  rm -f "/tmp/hh-$NAME.txt"
done
echo "chrome profiles: ${#BAD_PROFILES[@]} bad out of $(ls -d /opt/voyo/chrome-profile-* 2>/dev/null | wc -l)"

# ── 2. Requeue stale 'failed' rows (> 6h old, failure_count >= 3) ────────

RESET=$(curl -s -X PATCH "$URL/rest/v1/voyo_upload_queue?status=eq.failed&requested_at=lt.$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%S)&failure_count=gte.3" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"status":"pending","failure_count":0,"last_error":null,"claimed_at":null,"claimed_by_worker":null}' \
  --max-time 15 | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
echo "requeued $RESET stale failed rows"

# ── 3. Prune completed queue rows > 30 days old ──────────────────────────

DELETED=$(curl -s -X DELETE "$URL/rest/v1/voyo_upload_queue?status=eq.done&completed_at=lt.$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S)" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: return=representation,count=exact" \
  --max-time 15 -w '|%{http_code}' 2>/dev/null)
echo "pruned completed rows: ${DELETED##*|} response code"

echo "done"
