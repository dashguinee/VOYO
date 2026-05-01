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

cd /opt/voyo/playwright
node session-guardian.js
