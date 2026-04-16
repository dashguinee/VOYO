#!/bin/bash
# ── EMERGENCY-FALLBACK ONLY (as of v214, 2026-04-16) ─────────────────────
# VOYO switched to persistent Chromium on the VPS with --cookies-from-browser
# in yt-dlp-safe v3. Cookies self-refresh via the browser's live session;
# you no longer need to export cookies from Chrome every few hours.
#
# Use THIS script only if: the persistent Chrome on the VPS has been
# force-logged-out by Google and you need to re-seed the file-based fallback
# while you re-run the remote-DevTools login ritual. Rare.
#
# Normal flow: login via SSH tunnel + chrome://inspect. See docs in chat
# transcript or `pm2 describe voyo-chrome-001` for the profile dir.
# ─────────────────────────────────────────────────────────────────────────
#
# Filter fresh cookies → scp → run upload-and-test on VPS. No manual paste.

set -e

SRC="/mnt/c/Users/User/Downloads/www.youtube.com_cookies.txt"
TMP=/tmp/cookies-fresh-local.txt

echo "=== Filter to YouTube-only ==="
awk -F'\t' 'BEGIN{print "# Netscape HTTP Cookie File"} $1 ~ /\.youtube\.com$/' "$SRC" > "$TMP"
wc -l "$TMP"

echo ""
echo "=== Ship to VPS ==="
scp "$TMP" vps:/tmp/cookies-fresh.txt

echo ""
echo "=== Run upload-and-test on VPS ==="
ssh vps 'bash -s' < /home/dash/voyo-music/scripts/upload-and-test.sh
