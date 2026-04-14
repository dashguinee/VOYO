#!/bin/bash
# Upgrade yt-dlp-safe wrapper: try multiple player_clients per cookie account,
# negative-cache failures in /tmp for 5min so retries don't hammer the same dead
# track. Per A3's audit recommendations.

set +e

echo "=== Install upgraded wrapper ==="
sudo tee /usr/local/bin/yt-dlp-safe >/dev/null <<'WRAP'
#!/bin/bash
# yt-dlp-safe v2 — multi-client, negative-cached, cookie-rotated.
#
# Pipeline per request:
#   1. Check 5-min negative cache (/tmp/voyo-yt-neg/<videoId>.dead) — if hit,
#      exit 1 immediately. Stops the same dead track from burning 30+s on
#      every retry attempt.
#   2. Shuffle the cookie accounts.
#   3. For each account, try player_clients in order: tv_embedded → ios →
#      web_safari. tv_embedded often unlocks age-gated content. ios bypasses
#      many regional restrictions. web_safari is the bgutil-pot path.
#   4. First success exits 0. Cookie/auth failures fall through to next
#      account. Hard errors (network, 429, video unavailable) fail fast.
#   5. If everything fails, write to negative cache and exit 1.

shopt -s nullglob
NEG_DIR=/tmp/voyo-yt-neg
mkdir -p "$NEG_DIR" 2>/dev/null
chmod 700 "$NEG_DIR" 2>/dev/null

# Extract videoId from args (last arg looks like https://...?v=ID or just ID)
VIDEO_ID=""
for a in "$@"; do
  if [[ "$a" =~ v=([A-Za-z0-9_-]{11}) ]]; then VIDEO_ID="${BASH_REMATCH[1]}"; fi
  if [[ "$a" =~ ^[A-Za-z0-9_-]{11}$ ]]; then VIDEO_ID="$a"; fi
done

# 1. Negative cache check (5 min TTL)
if [ -n "$VIDEO_ID" ]; then
  NEG_FILE="$NEG_DIR/$VIDEO_ID.dead"
  if [ -f "$NEG_FILE" ]; then
    AGE=$(( $(date +%s) - $(stat -c %Y "$NEG_FILE" 2>/dev/null || echo 0) ))
    if [ "$AGE" -lt 300 ]; then
      echo "yt-dlp-safe: negative-cached for ${AGE}s ($VIDEO_ID)" >&2
      exit 1
    fi
    rm -f "$NEG_FILE"
  fi
fi

MASTERS=(/opt/voyo/cookies-[0-9][0-9][0-9].txt)
[ ${#MASTERS[@]} -eq 0 ] && MASTERS=(/opt/voyo/cookies.txt)
# Shuffle accounts
for ((i=${#MASTERS[@]}-1; i>0; i--)); do
  j=$((RANDOM % (i+1))); tmp=${MASTERS[i]}; MASTERS[i]=${MASTERS[j]}; MASTERS[j]=$tmp
done

# Player client priority order — tv_embedded unlocks many age-gated tracks
CLIENTS=("tv_embedded" "ios" "web_safari")

LAST_OUT=""
LAST_RC=1
for MASTER in "${MASTERS[@]}"; do
  TMP=$(mktemp /tmp/ytc.XXXXXX); chmod 600 "$TMP"; cp "$MASTER" "$TMP"
  for CLIENT in "${CLIENTS[@]}"; do
    LAST_OUT=$(/usr/local/bin/yt-dlp --cookies "$TMP" --extractor-args "youtube:player_client=$CLIENT" "$@" 2>&1)
    LAST_RC=$?
    if [ $LAST_RC -eq 0 ]; then
      rm -f "$TMP"
      echo "$LAST_OUT"
      exit 0
    fi
    # Cookie/auth issue → next account (skip remaining clients for this account)
    if echo "$LAST_OUT" | grep -qE "Sign in to confirm|cookies are no longer valid|cookies.*not valid"; then
      break
    fi
    # Other errors → try next client
  done
  rm -f "$TMP"
done

# All combinations exhausted — write to negative cache
if [ -n "$VIDEO_ID" ]; then
  touch "$NEG_DIR/$VIDEO_ID.dead" 2>/dev/null
fi
echo "$LAST_OUT" >&2
exit $LAST_RC
WRAP
sudo chmod 755 /usr/local/bin/yt-dlp-safe
echo "wrapper installed"

echo ""
echo "=== Smoke test — should now pass for tv-embedded-friendly tracks ==="
for TID in g_hgm2Mf6Ag wLAmuyvXIgY qNZDpLeGqQY; do
  echo "--- $TID ---"
  RES=$(sudo /usr/local/bin/yt-dlp-safe -f bestaudio --get-url "https://www.youtube.com/watch?v=$TID" 2>&1 | tail -1 | head -c 80)
  if echo "$RES" | grep -q "googlevideo"; then echo "✅ $RES..."; else echo "❌ $RES"; fi
done

echo ""
echo "=== Negative cache state ==="
ls -la /tmp/voyo-yt-neg/ 2>/dev/null | head -10

echo ""
echo "=== Restart voyo-audio so any cached subprocess refreshes ==="
sudo pm2 restart voyo-audio --update-env
