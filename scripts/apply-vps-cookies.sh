#!/bin/bash
# VPS: install cookies + update yt-dlp + discover voyo-audio service
set -e

echo "=== Moving cookies into place ==="
sudo mkdir -p /opt/voyo
sudo mv /tmp/cookies.txt /opt/voyo/cookies.txt
sudo chmod 600 /opt/voyo/cookies.txt
sudo chown root:root /opt/voyo/cookies.txt
ls -la /opt/voyo/cookies.txt

echo ""
echo "=== Updating yt-dlp ==="
if sudo pip install --upgrade --pre 'yt-dlp[default]' 2>&1 | tail -5; then
  echo "pip update: ok"
else
  echo "pip failed, falling back to direct download"
  sudo curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
fi

echo ""
echo "=== yt-dlp version ==="
yt-dlp --version

echo ""
echo "=== Service discovery ==="
systemctl cat voyo-audio 2>&1 | head -40 || {
  echo "no 'voyo-audio' service — searching for alternatives:"
  systemctl list-units --type=service --all 2>&1 | grep -iE 'voyo|audio|stream' || true
  echo ""
  echo "--- service files on disk ---"
  sudo find /etc/systemd/system /opt/voyo /opt /srv /home -maxdepth 4 \( -name '*.service' -o -name 'server.js' -o -name 'app.py' -o -name 'main.py' -o -name 'index.js' \) 2>/dev/null | head -20
}

echo ""
echo "=== Test extraction with cookies (Mnike, previously failing) ==="
yt-dlp --cookies /opt/voyo/cookies.txt -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | head -3
