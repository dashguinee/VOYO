#!/bin/bash
# Find the 500 cause

echo "=== Actual JSON error body from Mnike request ==="
curl -s -m 15 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high"
echo ""
echo ""
echo "=== pm2 logs (correct name: voyo-audio) ==="
sudo pm2 logs voyo-audio --lines 40 --nostream 2>&1 | tail -50

echo ""
echo "=== voyo-proxy.js lines 100-200 (primary extraction path) ==="
sed -n '100,200p' /home/ubuntu/voyo-proxy.js

echo ""
echo "=== voyo-proxy.js lines 380-430 (other exec path) ==="
sed -n '380,430p' /home/ubuntu/voyo-proxy.js
