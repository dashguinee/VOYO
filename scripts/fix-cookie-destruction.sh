#!/bin/bash
# The cookie-destruction bug: yt-dlp overwrites /opt/voyo/cookies.txt on exit
# with whatever YouTube sent back. Bot-check responses strip auth cookies.
# Fix: wrapper script copies cookies to a temp file before each invocation.

set -e

echo "=== 1. Current (damaged) cookies state ==="
ls -la /opt/voyo/cookies.txt
sudo wc -l /opt/voyo/cookies.txt
sudo head -3 /opt/voyo/cookies.txt

echo ""
echo "=== 2. Restore from fresh upload ==="
# cookies-youtube-only.txt is already uploaded to /tmp from earlier scp-ready file
# But we need to re-upload fresh — signal to Dash

echo ""
echo "=== 3. Install wrapper script /usr/local/bin/yt-dlp-safe ==="
sudo tee /usr/local/bin/yt-dlp-safe >/dev/null <<'WRAP'
#!/bin/bash
# yt-dlp wrapper: isolate the master cookie jar from yt-dlp's write-back
# YouTube's bot-check response overwrites auth cookies. Solution: each call
# gets a fresh COPY of the master; yt-dlp can destroy it, master stays pristine.
MASTER=/opt/voyo/cookies.txt
TMP=$(mktemp /tmp/ytc.XXXXXX)
chmod 600 "$TMP"
cp "$MASTER" "$TMP"
trap 'rm -f "$TMP"' EXIT
exec /usr/local/bin/yt-dlp --cookies "$TMP" "$@"
WRAP
sudo chmod 755 /usr/local/bin/yt-dlp-safe
ls -la /usr/local/bin/yt-dlp-safe

echo ""
echo "=== 4. Patch voyo-proxy.js to use the wrapper ==="
# Replace our previous absolute-path + --cookies with just yt-dlp-safe
sudo sed -i 's|/usr/local/bin/yt-dlp --cookies /opt/voyo/cookies.txt|/usr/local/bin/yt-dlp-safe|g' /home/ubuntu/voyo-proxy.js
grep -n 'yt-dlp' /home/ubuntu/voyo-proxy.js | head -5

echo ""
echo "=== 5. Make master cookies immutable (belt-and-braces — prevents any other path from writing) ==="
sudo chattr +i /opt/voyo/cookies.txt 2>&1 || echo "(chattr unavailable — wrapper alone is enough)"
lsattr /opt/voyo/cookies.txt 2>&1 || true

echo ""
echo "=== 6. Syntax check ==="
node --check /home/ubuntu/voyo-proxy.js && echo "OK"

echo ""
echo "=== Now Dash needs to re-upload fresh cookies ==="
echo "(master file was destroyed by earlier bad runs)"
