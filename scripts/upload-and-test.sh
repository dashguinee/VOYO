#!/bin/bash
# Step 2: after fix-cookie-destruction.sh, re-upload fresh cookies and test

echo "=== Lift immutable, replace cookies, re-set immutable ==="
sudo chattr -i /opt/voyo/cookies.txt 2>/dev/null || true
sudo cp /tmp/cookies-fresh.txt /opt/voyo/cookies.txt
sudo chown root:root /opt/voyo/cookies.txt
sudo chmod 600 /opt/voyo/cookies.txt
sudo chattr +i /opt/voyo/cookies.txt 2>/dev/null || true
ls -la /opt/voyo/cookies.txt
sudo wc -l /opt/voyo/cookies.txt

echo ""
echo "=== Test wrapper manually AS ROOT ==="
sudo /usr/local/bin/yt-dlp-safe -f "bestaudio" --get-url --no-warnings --geo-bypass "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | tail -3

echo ""
echo "=== Cookies unchanged after run? ==="
sudo wc -l /opt/voyo/cookies.txt

echo ""
echo "=== Restart voyo-audio ==="
sudo pm2 restart voyo-audio --update-env
sleep 3

echo ""
echo "=== HTTP test: Mnike ==="
curl -s -m 60 "https://stream.zionsynapse.online:8443/voyo/audio/g_hgm2Mf6Ag?quality=high" -o /tmp/mnike.opus -w "HTTP=%{http_code} total=%{time_total}s ttfb=%{time_starttransfer}s size=%{size_download}B\n"
file /tmp/mnike.opus | head -1
if [ -s /tmp/mnike.opus ] && [ "$(file -b --mime-type /tmp/mnike.opus)" = "audio/ogg" ]; then echo "✅ MNIKE PLAYS"; else echo "❌ still failing"; head -c 300 /tmp/mnike.opus; fi

echo ""
echo "=== HTTP test: BADMAN ==="
curl -s -m 60 "https://stream.zionsynapse.online:8443/voyo/audio/Zck0zkv67gs?quality=high" -o /tmp/badman.opus -w "HTTP=%{http_code} total=%{time_total}s ttfb=%{time_starttransfer}s size=%{size_download}B\n"
file /tmp/badman.opus | head -1

echo ""
echo "=== Logs ==="
sudo pm2 logs voyo-audio --lines 15 --nostream 2>&1 | tail -20

rm -f /tmp/mnike.opus /tmp/badman.opus /tmp/cookies-fresh.txt
