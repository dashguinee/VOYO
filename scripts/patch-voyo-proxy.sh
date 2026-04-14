#!/bin/bash
# Patch voyo-proxy.js to pass --cookies, restart cleanly

set -e

SRC=/home/ubuntu/voyo-proxy.js
BAK="${SRC}.bak-$(date +%Y%m%d-%H%M%S)"
COOKIES=/opt/voyo/cookies.txt

echo "=== Backup ==="
sudo cp "$SRC" "$BAK"
ls -la "$BAK"

echo ""
echo "=== Before patch — all yt-dlp invocations ==="
grep -n 'yt-dlp' "$SRC"

echo ""
echo "=== Inject --cookies flag into every yt-dlp call ==="
# Match the `yt-dlp ` token and insert --cookies right after, but only if not already present
sudo sed -i "s|yt-dlp -f|yt-dlp --cookies ${COOKIES} -f|g" "$SRC"
sudo sed -i "s|yt-dlp --get-url|yt-dlp --cookies ${COOKIES} --get-url|g" "$SRC"

echo ""
echo "=== After patch — verify cookies flag present ==="
grep -n 'yt-dlp' "$SRC"

echo ""
echo "=== Syntax check (node --check) ==="
node --check "$SRC" && echo "SYNTAX OK"

echo ""
echo "=== Find current PID + how it was started ==="
VOYO_PID=$(pgrep -f 'node /home/ubuntu/voyo-proxy.js' | head -1)
echo "PID: $VOYO_PID"
if [ -n "$VOYO_PID" ]; then
  PPID_OF=$(ps -o ppid= -p "$VOYO_PID" | tr -d ' ')
  echo "Parent: $PPID_OF"
  ps -p "$PPID_OF" -o pid,ppid,user,stat,cmd 2>/dev/null || echo "parent gone (orphan)"
  echo "--- startup env ---"
  sudo cat /proc/$VOYO_PID/cmdline | tr '\0' ' '; echo
  sudo readlink /proc/$VOYO_PID/cwd
fi
