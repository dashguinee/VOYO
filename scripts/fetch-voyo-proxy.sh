#!/bin/bash
# v5: fetch voyo-proxy.js locally + understand how it's running

echo "=== Parent PID of voyo-proxy ==="
ps -p 14912 -o pid,user,ppid,stat,cmd 2>/dev/null || {
  echo "14912 gone — find it now:"
  ps -o pid,ppid,user,stat,cmd $(pgrep -f voyo-proxy) 2>/dev/null
  VOYO_PID=$(pgrep -f voyo-proxy.js | head -1)
  if [ -n "$VOYO_PID" ]; then
    PPID=$(ps -o ppid= -p "$VOYO_PID" | tr -d ' ')
    echo "--- chain ---"
    ps -p "$PPID" -o pid,user,ppid,stat,cmd 2>/dev/null
  fi
}

echo ""
echo "=== Full context around yt-dlp calls in voyo-proxy.js ==="
sed -n '130,200p' /home/ubuntu/voyo-proxy.js
echo "---[break]---"
sed -n '330,400p' /home/ubuntu/voyo-proxy.js
