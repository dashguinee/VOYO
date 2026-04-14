#!/bin/bash
# Install weekly yt-dlp nightly update cron + log rotation.

set -e

echo "=== Install update script at /usr/local/bin/yt-dlp-update ==="
sudo tee /usr/local/bin/yt-dlp-update >/dev/null <<'SCRIPT'
#!/bin/bash
# Auto-update yt-dlp to latest nightly every week.
# Run by root cron. Logs to /var/log/yt-dlp-update.log
exec >>/var/log/yt-dlp-update.log 2>&1
echo ""
echo "=== $(date -Iseconds) ==="
/usr/local/bin/yt-dlp --update-to nightly
if /usr/local/bin/yt-dlp-safe -f bestaudio --get-url "https://www.youtube.com/watch?v=dQw4w9WgXcQ" >/dev/null 2>&1; then
  echo "post-update smoke test: OK"
else
  echo "post-update smoke test: FAILED — cookies may be stale"
fi
SCRIPT
sudo chmod 755 /usr/local/bin/yt-dlp-update

echo ""
echo "=== Install cron line (every Sunday at 03:00 UTC) ==="
# Idempotent — remove any previous yt-dlp-update line before adding
sudo crontab -l 2>/dev/null | grep -v 'yt-dlp-update' > /tmp/crontab.new || true
echo "0 3 * * 0 /usr/local/bin/yt-dlp-update" >> /tmp/crontab.new
sudo crontab /tmp/crontab.new
rm /tmp/crontab.new
echo "--- root crontab now ---"
sudo crontab -l | grep yt-dlp

echo ""
echo "=== Test run (first entry seeds the log) ==="
sudo /usr/local/bin/yt-dlp-update
sudo tail -6 /var/log/yt-dlp-update.log
