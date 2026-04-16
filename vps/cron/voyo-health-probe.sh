#!/bin/bash
# VOYO — extraction health probe.
# Runs every 15 min. Performs a known-good extraction through the live
# wrapper and records the outcome. If N consecutive failures, logs a
# CRITICAL line that downstream monitoring (Synapse daemon / WhatsApp
# mirror) can pick up.
#
# Uses Rickroll (dQw4w9WgXcQ) as canary: ubiquitous, age-appropriate,
# cached everywhere, never likely to be region-locked or unlisted.
# If this one fails, extraction is genuinely broken.

set -uo pipefail  # allow errors; we handle them explicitly

CANARY_ID="dQw4w9WgXcQ"
LOG=/var/log/voyo-health.log
FAIL_STATE=/var/lib/voyo-health-fails
mkdir -p /var/log /var/lib
: >> "$LOG"
touch "$FAIL_STATE"

TS=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Clear stale negative cache for the canary so we actually hit yt-dlp
rm -f "/tmp/voyo-yt-neg/${CANARY_ID}.dead" 2>/dev/null || true

# Probe 1: wrapper can extract → cookies+PoToken pipeline healthy
START=$(date +%s)
OUT=$(timeout 25 /usr/local/bin/yt-dlp-safe -f bestaudio --get-url --no-warnings --geo-bypass \
  "https://www.youtube.com/watch?v=${CANARY_ID}" 2>&1 | tail -1)
ELAPSED=$(( $(date +%s) - START ))

if [[ "$OUT" == https://* ]]; then
  echo "$TS  OK    wrapper_extract  ${ELAPSED}s" >> "$LOG"
  # Reset fail counter on success
  echo 0 > "$FAIL_STATE"
  FAIL_COUNT=0
else
  echo "$TS  FAIL  wrapper_extract  ${ELAPSED}s  out=$(echo "$OUT" | head -c 80)" >> "$LOG"
  FAIL_COUNT=$(cat "$FAIL_STATE" 2>/dev/null || echo 0)
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "$FAIL_COUNT" > "$FAIL_STATE"
fi

# Probe 2: Chrome remote-debug endpoint responsive → browser session alive
if curl -s --max-time 3 http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
  echo "$TS  OK    chrome_debug" >> "$LOG"
else
  echo "$TS  FAIL  chrome_debug" >> "$LOG"
fi

# Probe 3: /voyo/health responsive + edge circuit visible
HEALTH=$(curl -s --max-time 3 https://stream.zionsynapse.online:8443/voyo/health 2>/dev/null)
if [[ -n "$HEALTH" ]]; then
  CIRCUIT=$(echo "$HEALTH" | grep -oE '"open":(true|false)' | head -1)
  echo "$TS  OK    proxy_health  $CIRCUIT" >> "$LOG"
else
  echo "$TS  FAIL  proxy_health" >> "$LOG"
fi

# Escalation: 3 consecutive wrapper failures = CRITICAL
if [ "$FAIL_COUNT" -ge 3 ]; then
  echo "$TS  CRITICAL  extraction_down  consecutive_fails=$FAIL_COUNT" >> "$LOG"
  # If synapse-gateway is reachable, trigger an alert.
  # (Hook will be added separately — for now just the CRITICAL log line is
  # greppable by any external monitor.)
fi
