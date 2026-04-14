#!/bin/bash
# Restart voyo-proxy via root's pm2, then verify

echo "=== Root pm2 list ==="
sudo pm2 list

echo ""
echo "=== Restart the voyo-proxy process ==="
# Try by name, then by id as fallback
sudo pm2 restart voyo-proxy 2>&1 || sudo pm2 restart /home/ubuntu/voyo-proxy.js 2>&1 || {
  echo "restart by name failed — getting id"
  ID=$(sudo pm2 jlist 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); [print(p['pm_id']) for p in d if 'voyo-proxy' in p.get('pm2_env',{}).get('pm_exec_path','') or 'voyo-proxy' in p.get('name','')]" 2>/dev/null | head -1)
  echo "id: $ID"
  [ -n "$ID" ] && sudo pm2 restart "$ID"
}

echo ""
echo "=== Verify new PID ==="
sleep 2
pgrep -fa 'node /home/ubuntu/voyo-proxy.js' | head -3

echo ""
echo "=== Test via HTTP — Mnike via voyo-proxy ==="
# Give node a beat to bind port
sleep 2
curl -s -o /tmp/out.bin -w "HTTP=%{http_code} time=%{time_total}s size=%{size_download} redirect=%{redirect_url}\n" -m 20 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high"
file /tmp/out.bin 2>/dev/null | head -1
rm -f /tmp/out.bin

echo ""
echo "=== Tail recent logs ==="
sudo pm2 logs voyo-proxy --lines 15 --nostream 2>&1 | tail -30
