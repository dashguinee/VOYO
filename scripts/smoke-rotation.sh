#!/bin/bash
# Quick rotation smoke — no set -e so one bad account doesn't abort

echo "--- 5 rotation runs ---"
for i in 1 2 3 4 5; do
  RES=$(sudo /usr/local/bin/yt-dlp-safe -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1)
  if echo "$RES" | grep -q "googlevideo.com"; then
    echo "  run $i: ✅ URL ok"
  else
    LAST=$(echo "$RES" | tail -1 | head -c 100)
    echo "  run $i: ❌ $LAST"
  fi
done
