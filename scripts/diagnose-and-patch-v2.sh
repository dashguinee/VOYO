#!/bin/bash
# Find extractAudioUrl, check PATH, patch with absolute path, re-test

echo "=== Find extractAudioUrl function ==="
grep -n -E 'extractAudioUrl|function extract|const extract' /home/ubuntu/voyo-proxy.js | head -10
echo "---"
grep -n -B2 -A30 'function extractAudioUrl\|async function extractAudioUrl\|const extractAudioUrl' /home/ubuntu/voyo-proxy.js | head -50

echo ""
echo "=== pm2 process env (PATH, etc.) ==="
sudo pm2 env 6 2>&1 | grep -iE 'path|node|voyo' | head -20

echo ""
echo "=== Run the EXACT fallback cmd manually (but with stderr visible) ==="
cd /home/ubuntu
yt-dlp --cookies /opt/voyo/cookies.txt -f "bestaudio" --get-url --no-warnings --geo-bypass "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | tail -8
echo ""
echo "=== Same with absolute path ==="
/usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt -f "bestaudio" --get-url --no-warnings --geo-bypass "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | tail -3

echo ""
echo "=== Force absolute path in voyo-proxy.js ==="
sudo sed -i 's|yt-dlp --cookies|/usr/local/bin/yt-dlp --cookies|g' /home/ubuntu/voyo-proxy.js
grep -n 'yt-dlp' /home/ubuntu/voyo-proxy.js | head -5

echo ""
echo "=== Restart ==="
sudo pm2 restart voyo-audio --update-env

sleep 3
echo ""
echo "=== Re-test Mnike ==="
curl -s -m 20 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" -o /tmp/o.bin -w "HTTP=%{http_code} time=%{time_total}s size=%{size_download}\n"
file /tmp/o.bin | head -1
# If JSON error, show it
head -c 300 /tmp/o.bin; echo
rm -f /tmp/o.bin

echo ""
echo "=== Fresh pm2 logs ==="
sudo pm2 logs voyo-audio --lines 25 --nostream 2>&1 | tail -30
