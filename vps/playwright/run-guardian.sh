#!/bin/bash
# Cron wrapper for session-guardian.
# Add to cron: 0 */6 * * * root /opt/voyo/playwright/run-guardian.sh
set -e
LOG=/var/log/voyo-session-guardian.log
ENV_FILE=/etc/voyo-health.env

exec >>"$LOG" 2>&1

[ -r "$ENV_FILE" ] && . "$ENV_FILE"

export VOYO_SUPABASE_URL="${VOYO_SUPABASE_URL:-https://anmgyxhnyhbyxzpjhxgx.supabase.co}"
export VOYO_SUPABASE_ANON_KEY="${VOYO_SUPABASE_ANON_KEY:-}"

# Browsers installed under ubuntu user — works whether cron runs as root or ubuntu
export PLAYWRIGHT_BROWSERS_PATH=/home/ubuntu/.cache/ms-playwright

cd /opt/voyo/playwright
node session-guardian.js
