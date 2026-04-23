#!/bin/bash
# VOYO home-proxy daemon — persistent Tier C residential exit.
#
# Architecture:
#   tinyproxy on localhost:8888 (handles HTTP/HTTPS forward proxy)
#   SSH reverse tunnel to VPS: vps.localhost:18888 → wsl:127.0.0.1:8888
#   VPS uses VOYO_HOME_TUNNEL=http://127.0.0.1:18888 as its Tier C endpoint
#
# SSH reverse tunnel = completely free, stable, encrypted, no third-party.
# Exits through THIS machine's residential IP. Runs forever via systemd.
#
# Loop retries if ssh dies (network hiccup, sleep/wake, etc).

set -u
LOG="${VOYO_HOME_LOG:-/tmp/voyo-home-daemon.log}"
REMOTE_PORT=18888

exec >>"$LOG" 2>&1
echo ""
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) voyo-home-daemon starting ===="

# ── 1. Ensure tinyproxy is up ────────────────────────────────────────────

if ! pgrep -x tinyproxy >/dev/null; then
  echo "starting tinyproxy"
  cat > /tmp/tinyproxy.conf <<'CONF'
User tinyproxy
Group tinyproxy
Port 8888
Timeout 60
DefaultErrorFile "/usr/share/tinyproxy/default.html"
PidFile "/tmp/tinyproxy.pid"
MaxClients 20
Listen 127.0.0.1
ConnectPort 443
ConnectPort 80
DisableViaHeader Yes
CONF
  sudo tinyproxy -c /tmp/tinyproxy.conf
  sleep 1
fi

# Sanity probe
if ! curl -sx http://127.0.0.1:8888 http://httpbin.org/ip --max-time 8 | grep -q origin; then
  echo "tinyproxy not responding — aborting"
  exit 1
fi
echo "tinyproxy ok ($(curl -sx http://127.0.0.1:8888 http://httpbin.org/ip --max-time 5 | python3 -c 'import json,sys; print(json.load(sys.stdin).get("origin","?"))'))"

# ── 2. Run ssh reverse tunnel in a retry loop ────────────────────────────

while true; do
  echo "opening reverse tunnel: vps:${REMOTE_PORT} → 127.0.0.1:8888"
  # First run: ssh vps manually to TOFU-accept the key. Subsequent runs use ~/.ssh/known_hosts normally.
  ssh \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -N -R ${REMOTE_PORT}:127.0.0.1:8888 vps
  echo "ssh tunnel exited (code=$?) — reconnecting in 5s"
  sleep 5
done
