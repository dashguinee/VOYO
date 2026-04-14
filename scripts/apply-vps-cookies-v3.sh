#!/bin/bash
# Continue from where v2 died. No set -e so errors don't abort.

echo "=== Verify deno is working ==="
which deno && deno --version | head -1 || echo "deno not on PATH"

echo ""
echo "=== yt-dlp update to nightly (newest extractor fixes) ==="
sudo /usr/local/bin/yt-dlp --update-to nightly 2>&1 | tail -5
/usr/local/bin/yt-dlp --version

echo ""
echo "=== Test extraction WITH deno + fresh cookies ==="
/usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | tail -8

echo ""
echo "=== Discover what's serving port 8443 ==="
sudo ss -tlnp | grep ':8443' || echo "nothing on 8443"
echo ""
echo "=== Running services with voyo/audio in name ==="
systemctl list-units --type=service --state=running 2>&1 | grep -iE 'voyo|audio|stream' || echo "(none)"
echo ""
echo "=== pm2 processes ==="
pm2 list 2>/dev/null || echo "(no pm2)"
echo ""
echo "=== Docker containers ==="
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || echo "(no docker)"
echo ""
echo "=== All node/python processes ==="
ps aux | grep -E 'node |python|ffmpeg|yt-dlp' | grep -v grep | head -20
