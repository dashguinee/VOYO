#!/bin/bash
# VPS: force yt-dlp update + install JS runtime + discover running service
set -e

echo "=== Force-install latest yt-dlp via direct binary ==="
# Debian/Ubuntu blocks system pip → use official binary
sudo curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
hash -r
echo "yt-dlp path:"
which yt-dlp
echo "yt-dlp version:"
/usr/local/bin/yt-dlp --version

echo ""
echo "=== Install deno (JS runtime for yt-dlp) ==="
if command -v deno &>/dev/null; then
  echo "deno already installed: $(deno --version | head -1)"
else
  sudo curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip
  sudo apt-get install -y unzip 2>&1 | tail -2
  sudo unzip -o /tmp/deno.zip -d /usr/local/bin/
  sudo chmod a+rx /usr/local/bin/deno
  rm /tmp/deno.zip
  deno --version | head -1
fi

echo ""
echo "=== Discover what's serving port 8443 ==="
sudo ss -tlnp | grep ':8443' || sudo lsof -i :8443 2>/dev/null || echo "nothing on 8443?"
echo ""
echo "=== All running services containing 'voyo' or 'audio' ==="
systemctl list-units --type=service --state=running 2>&1 | grep -iE 'voyo|audio|stream' || echo "none"
echo ""
echo "=== pm2 processes ==="
pm2 list 2>/dev/null || echo "no pm2"
echo ""
echo "=== docker containers ==="
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || echo "no docker"
echo ""
echo "=== node/python processes bound to audio-ish work ==="
ps aux | grep -iE 'voyo|yt-dlp|ffmpeg' | grep -v grep | head -10

echo ""
echo "=== Cookie file sanity check (first line format) ==="
sudo head -2 /opt/voyo/cookies.txt
echo "youtube cookies present:"
sudo grep -c '^\.youtube\.com' /opt/voyo/cookies.txt

echo ""
echo "=== Test extraction with fresh yt-dlp + cookies ==="
/usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | tail -5
