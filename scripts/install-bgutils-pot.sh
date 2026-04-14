#!/bin/bash
# Install Brainicism/bgutil-ytdlp-pot-provider on VPS.
# - Server: Node.js helper that generates YouTube PO Tokens (port 4416)
# - Plugin: yt-dlp plugin that asks the provider when YT requires PO token
# Result: yt-dlp can extract URLs WITHOUT needing valid cookies. Bot-check bypass.

set +e  # don't abort on individual step failure

echo "=== 1. Clone bgutil repo ==="
if [ -d /opt/bgutil ]; then
  echo "already cloned, pulling latest"
  sudo git -C /opt/bgutil pull --ff-only 2>&1 | tail -3
else
  sudo git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider /opt/bgutil 2>&1 | tail -3
  sudo chown -R ubuntu:ubuntu /opt/bgutil
fi
ls /opt/bgutil/server/ 2>/dev/null | head -5

echo ""
echo "=== 2. Build Node.js provider ==="
cd /opt/bgutil/server
npm install 2>&1 | tail -3
npm run build 2>&1 | tail -3
ls build/ 2>/dev/null | head -5

echo ""
echo "=== 3. Run provider via pm2 (port 4416) ==="
sudo pm2 delete bgutil-pot 2>/dev/null
sudo pm2 start /opt/bgutil/server/build/main.js --name bgutil-pot --interpreter node
sleep 2
sudo pm2 list | grep bgutil

echo ""
echo "=== 4. Verify provider responding ==="
curl -s -m 5 http://127.0.0.1:4416/ping 2>&1 | head -c 200
echo ""

echo ""
echo "=== 5. Install yt-dlp plugin ==="
# Method A: pip with --break-system-packages
sudo pip install --break-system-packages --upgrade bgutil-ytdlp-pot-provider 2>&1 | tail -3

# Method B: direct copy to yt-dlp plugin dir as backup (binary yt-dlp uses ~/.config/yt-dlp-plugins/)
PLUGIN_TARGET=/root/.config/yt-dlp-plugins
sudo mkdir -p "$PLUGIN_TARGET"
if [ -d /opt/bgutil/plugin/yt_dlp_plugins ]; then
  sudo cp -r /opt/bgutil/plugin/yt_dlp_plugins "$PLUGIN_TARGET/"
  echo "plugin copied to $PLUGIN_TARGET"
fi
sudo ls -la "$PLUGIN_TARGET" 2>/dev/null

echo ""
echo "=== 6. Test extraction WITHOUT cookies on a previously-failing track ==="
sudo /usr/local/bin/yt-dlp -f bestaudio --get-url "https://www.youtube.com/watch?v=g_hgm2Mf6Ag" 2>&1 | tail -5

echo ""
echo "=== 7. Test extraction WITHOUT cookies on Rick Astley (sanity) ==="
sudo /usr/local/bin/yt-dlp -f bestaudio --get-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | tail -3
