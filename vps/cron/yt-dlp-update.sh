#!/bin/bash
# VOYO — weekly yt-dlp auto-update.
# YouTube breaks extraction every 2-6 weeks. yt-dlp community usually
# publishes a fix within 24-48h. Without this cron we silently drift
# until a user reports extraction failures.
#
# Install as /etc/cron.weekly/yt-dlp-update (Sunday 04:00 UTC via
# systemd timer) or as an explicit crontab line.
#
# Uses pip with --break-system-packages because Ubuntu 25.04 marks
# the system Python as externally-managed. We're in a VPS-only env so
# this is safe; pipx would be cleaner but adds a dependency.

set -euo pipefail

LOG=/var/log/voyo-ytdlp-update.log
mkdir -p /var/log
: >> "$LOG"

echo "=== $(date -u +"%Y-%m-%d %H:%M:%S UTC") — yt-dlp update start ===" >> "$LOG"

BEFORE=$(/usr/local/bin/yt-dlp --version 2>/dev/null || echo "unknown")
echo "before: $BEFORE" >> "$LOG"

# Try the bundled-binary update first (fastest path for standalone installs)
if /usr/local/bin/yt-dlp -U >> "$LOG" 2>&1; then
  AFTER=$(/usr/local/bin/yt-dlp --version 2>/dev/null || echo "unknown")
  echo "after (self-update): $AFTER" >> "$LOG"
else
  # Fallback: pip (for pip-managed installs)
  pip install --break-system-packages --upgrade yt-dlp >> "$LOG" 2>&1 || true
  AFTER=$(/usr/local/bin/yt-dlp --version 2>/dev/null || echo "unknown")
  echo "after (pip): $AFTER" >> "$LOG"
fi

# Restart voyo-audio only if version actually changed (avoid pointless restart)
if [ "$BEFORE" != "$AFTER" ]; then
  echo "version changed, restarting voyo-audio" >> "$LOG"
  /usr/bin/pm2 restart voyo-audio --update-env >> "$LOG" 2>&1 || true
else
  echo "no version change, skipping restart" >> "$LOG"
fi

echo "=== done ===" >> "$LOG"
