#!/bin/bash
# VOYO — daily /var/cache/voyo LRU prune.
# Deletes .opus files not accessed in the last 14 days. atime is enabled on
# modern ext4 by default (relatime); each served cache hit bumps atime, so
# popular tracks stay resident and long-tail tracks naturally fall off.
#
# Secondary: cap total size at 10GB. If we're over, delete oldest-access first
# until we're under. This protects the VPS from a runaway growth scenario
# (e.g., a bot traversing the catalog at high velocity).
#
# Install via /etc/cron.daily/voyo-cache-prune or explicit cron.

set -euo pipefail

CACHE_DIR=/var/cache/voyo
SIZE_CAP_BYTES=$((10 * 1024 * 1024 * 1024))   # 10 GB
AGE_DAYS=14
LOG=/var/log/voyo-cache-prune.log
mkdir -p /var/log
: >> "$LOG"

[ -d "$CACHE_DIR" ] || { echo "$(date -u): $CACHE_DIR missing, skip" >> "$LOG"; exit 0; }

echo "=== $(date -u +"%Y-%m-%d %H:%M:%S UTC") — cache prune ===" >> "$LOG"

# 1. Age-based: remove files untouched for AGE_DAYS
AGED=$(find "$CACHE_DIR" -maxdepth 1 -name "*.opus" -atime +$AGE_DAYS -print -delete | wc -l)
echo "age-pruned (>${AGE_DAYS}d): $AGED files" >> "$LOG"

# 2. Orphan .tmp files (pre-rename crashes) — always unsafe to keep
TMP=$(find "$CACHE_DIR" -maxdepth 1 -name "*.tmp" -mmin +5 -print -delete | wc -l)
echo "tmp-orphans pruned: $TMP files" >> "$LOG"

# 3. Size-cap enforcement — only if over cap
CURRENT_BYTES=$(du -sb "$CACHE_DIR" | cut -f1)
if [ "$CURRENT_BYTES" -gt "$SIZE_CAP_BYTES" ]; then
  echo "over cap ($CURRENT_BYTES > $SIZE_CAP_BYTES), deleting oldest-access" >> "$LOG"
  # List files sorted by atime ascending, delete until under cap
  find "$CACHE_DIR" -maxdepth 1 -name "*.opus" -printf "%A@ %p\n" \
    | sort -n \
    | while read -r _atime path; do
        CURRENT_BYTES=$(du -sb "$CACHE_DIR" | cut -f1)
        if [ "$CURRENT_BYTES" -le "$SIZE_CAP_BYTES" ]; then break; fi
        rm -f "$path"
        echo "size-evicted: $path" >> "$LOG"
      done
fi

FINAL_BYTES=$(du -sb "$CACHE_DIR" | cut -f1)
FINAL_COUNT=$(find "$CACHE_DIR" -maxdepth 1 -name "*.opus" | wc -l)
echo "final: $FINAL_COUNT files, $(($FINAL_BYTES / 1024 / 1024))MB" >> "$LOG"
echo "=== done ===" >> "$LOG"
