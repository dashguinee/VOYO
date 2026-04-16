#!/bin/bash
# VOYO — extraction health probe.
# Runs every 15 min. Performs a known-good extraction through the live
# wrapper, records outcome, escalates on consecutive failures, and posts
# critical events to Supabase voyo_playback_events for downstream monitoring.
#
# Three canaries:
#   1. yt-dlp-safe extraction of Rickroll (cookies + PoToken + wrapper)
#   2. Chrome remote-debug endpoint reachable (browser session alive)
#   3. /voyo/health responds (proxy alive + edge circuit state recorded)
#
# Sign-in detection — grep the extraction output for the bot-check phrase.
# If it fires, the browser profile has been force-logged-out and the file
# fallback is stale — we emit cookie_login_lost which is the "Dash, re-login"
# alert.

set -uo pipefail

CANARY_ID="dQw4w9WgXcQ"
LOG=/var/log/voyo-health.log
FAIL_STATE=/var/lib/voyo-health-fails
ENV_FILE=/etc/voyo-health.env
mkdir -p /var/log /var/lib
: >> "$LOG"
touch "$FAIL_STATE"

# Load Supabase credentials if available — optional, probe still works
# without them (local logging only).
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

TS=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
HOSTNAME=$(hostname)

# POST a critical event to Supabase voyo_playback_events.
post_critical() {
  local subtype="$1"
  local meta="$2"
  [ -z "${VOYO_SUPABASE_URL:-}" ] && return
  [ -z "${VOYO_SUPABASE_ANON_KEY:-}" ] && return
  curl -s -o /dev/null --max-time 5 \
    -X POST "$VOYO_SUPABASE_URL/rest/v1/voyo_playback_events" \
    -H "Content-Type: application/json" \
    -H "apikey: $VOYO_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $VOYO_SUPABASE_ANON_KEY" \
    -H "Prefer: return=minimal" \
    -d "{\"event_type\":\"critical_alert\",\"track_id\":\"-\",\"meta\":{\"subtype\":\"$subtype\",\"source\":\"vps\",\"host\":\"$HOSTNAME\",$meta},\"user_agent\":\"voyo-health-probe\",\"session_id\":\"vps_health_$HOSTNAME\"}" \
    2>/dev/null || true
}

# Clear stale negative cache for the canary so we actually hit yt-dlp
rm -f "/tmp/voyo-yt-neg/${CANARY_ID}.dead" 2>/dev/null || true

# Probe 1: wrapper can extract → cookies+PoToken pipeline healthy
START=$(date +%s)
OUT=$(timeout 25 /usr/local/bin/yt-dlp-safe -f bestaudio --get-url --no-warnings --geo-bypass \
  "https://www.youtube.com/watch?v=${CANARY_ID}" 2>&1)
ELAPSED=$(( $(date +%s) - START ))
LAST_LINE=$(echo "$OUT" | tail -1)

SIGN_IN_DETECTED=0
if echo "$OUT" | grep -q "Sign in to confirm"; then
  SIGN_IN_DETECTED=1
fi

if [[ "$LAST_LINE" == https://* ]]; then
  echo "$TS  OK    wrapper_extract  ${ELAPSED}s" >> "$LOG"
  echo 0 > "$FAIL_STATE"
  FAIL_COUNT=0
else
  OUT_SHORT=$(echo "$LAST_LINE" | head -c 100 | tr '"' "'")
  echo "$TS  FAIL  wrapper_extract  ${ELAPSED}s  out=$OUT_SHORT  signIn=$SIGN_IN_DETECTED" >> "$LOG"
  FAIL_COUNT=$(cat "$FAIL_STATE" 2>/dev/null || echo 0)
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "$FAIL_COUNT" > "$FAIL_STATE"

  # Sign-in detected = Chrome force-logged-out. Fire alert immediately, don't
  # wait for 3-fail threshold — every minute here is users sitting on skips.
  if [ "$SIGN_IN_DETECTED" -eq 1 ]; then
    echo "$TS  CRITICAL  cookie_login_lost  browser profile needs re-login" >> "$LOG"
    post_critical "cookie_login_lost" "\"failCount\":$FAIL_COUNT,\"elapsedSec\":$ELAPSED"
  fi
fi

# Probe 2: Chrome remote-debug endpoint responsive → browser session alive
if curl -s --max-time 3 http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
  echo "$TS  OK    chrome_debug" >> "$LOG"
else
  echo "$TS  FAIL  chrome_debug" >> "$LOG"
  echo "$TS  CRITICAL  chrome_dead  remote-debug unreachable" >> "$LOG"
  post_critical "chrome_dead" "\"port\":9222"
fi

# Probe 3: /voyo/health responsive + edge circuit state
HEALTH=$(curl -s --max-time 3 https://stream.zionsynapse.online:8443/voyo/health 2>/dev/null)
if [[ -n "$HEALTH" ]]; then
  CIRCUIT=$(echo "$HEALTH" | grep -oE '"open":(true|false)' | head -1)
  CACHE_COUNT=$(echo "$HEALTH" | grep -oE '"count":[0-9]+' | grep -oE '[0-9]+$' | head -1)
  echo "$TS  OK    proxy_health  $CIRCUIT  cache_count=${CACHE_COUNT:-?}" >> "$LOG"
else
  echo "$TS  FAIL  proxy_health" >> "$LOG"
  echo "$TS  CRITICAL  proxy_dead  /voyo/health no response" >> "$LOG"
  post_critical "proxy_dead" "\"reason\":\"health_endpoint_timeout\""
fi

# Escalation: 3 consecutive wrapper failures = CRITICAL
if [ "$FAIL_COUNT" -ge 3 ]; then
  echo "$TS  CRITICAL  extraction_down  consecutive_fails=$FAIL_COUNT" >> "$LOG"
  # Only post if we haven't already detected sign-in (avoid double-alert)
  if [ "$SIGN_IN_DETECTED" -eq 0 ]; then
    post_critical "extraction_down" "\"failCount\":$FAIL_COUNT,\"lastElapsedSec\":$ELAPSED"
  fi
fi
