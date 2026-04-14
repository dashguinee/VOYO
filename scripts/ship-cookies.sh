#!/bin/bash
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
