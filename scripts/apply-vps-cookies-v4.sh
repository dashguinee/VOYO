#!/bin/bash
# v4: permission fix + voyo-proxy discovery

echo "=== Fix cookies perms (root:ubuntu, 640 — readable by ubuntu for testing, writable by root for SIDCC updates) ==="
sudo chown root:ubuntu /opt/voyo/cookies.txt
sudo chmod 640 /opt/voyo/cookies.txt
ls -la /opt/voyo/cookies.txt

echo ""
echo "=== voyo-proxy.js size + mtime ==="
ls -la /home/ubuntu/voyo-proxy.js
echo ""
echo "=== Grep for yt-dlp invocation inside voyo-proxy.js ==="
grep -n -E 'yt-dlp|ytdl|spawn|exec|cookies' /home/ubuntu/voyo-proxy.js | head -30

echo ""
echo "=== What invokes voyo-proxy at boot? (systemd services, rc.local, cron) ==="
sudo grep -rln 'voyo-proxy' /etc/systemd /etc/rc.local /etc/cron* /root 2>/dev/null | head -10
sudo systemctl list-unit-files | grep -iE 'voyo|proxy' || true
echo "--- current PID details ---"
ps -p 1827532 -o pid,user,ppid,stat,cmd 2>/dev/null || ps aux | grep voyo-proxy | grep -v grep | head

echo ""
echo "=== Test extraction AS ROOT (proper context for voyo-proxy) ==="
sudo /usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | tail -5
echo ""
echo "=== Test a known-good track too (Rick Astley) ==="
sudo /usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt -f bestaudio --get-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | tail -3
