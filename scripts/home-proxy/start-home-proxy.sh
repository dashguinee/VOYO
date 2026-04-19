#!/bin/bash
# VOYO home-proxy — Tier D residential exit
#
# Runs a tinyproxy HTTP forward proxy on localhost:8888 AND exposes it via
# a Cloudflare Quick Tunnel (no account/domain needed). Prints the public URL
# you paste into the VPS env var VOYO_HOME_TUNNEL.
#
# When to use: only when VPS Tier A (no-proxy extraction) starts failing.
# You'll see it in telemetry — Webshare usage creeps up, or /voyo/health
# reports extraction failures spiking.
#
# Requirements:
#   - tinyproxy (apt install tinyproxy)
#   - cloudflared (apt install cloudflared — OR download binary)
#
# Both are one-time installs. First run does them for you.
#
# Usage:
#   cd /home/dash/voyo-music/scripts/home-proxy
#   bash start-home-proxy.sh
#
# Output:
#   Public URL to paste into VPS env VOYO_HOME_TUNNEL
#   Proxy runs until you Ctrl+C

set -e
cd "$(dirname "$0")"

# ── 1. Install deps if missing ───────────────────────────────────────────

if ! command -v tinyproxy &>/dev/null; then
  echo "[voyo-home] tinyproxy not found — installing…"
  sudo apt update -qq
  sudo apt install -y tinyproxy
fi

if ! command -v cloudflared &>/dev/null; then
  echo "[voyo-home] cloudflared not found — installing…"
  # Cloudflare's apt repo
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  sudo apt update -qq
  sudo apt install -y cloudflared
fi

# ── 2. Configure tinyproxy for YouTube-only usage ────────────────────────

cat > /tmp/tinyproxy.conf <<'CONF'
User tinyproxy
Group tinyproxy
Port 8888
Timeout 60
DefaultErrorFile "/usr/share/tinyproxy/default.html"
PidFile "/tmp/tinyproxy.pid"
MaxClients 20
# Listen only on localhost — public access is via the Cloudflare tunnel
Listen 127.0.0.1
# Only allow CONNECT for HTTPS (what yt-dlp + curl need)
ConnectPort 443
ConnectPort 80
# Don't disclose we're tinyproxy
DisableViaHeader Yes
CONF

echo "[voyo-home] starting tinyproxy on 127.0.0.1:8888…"
sudo tinyproxy -c /tmp/tinyproxy.conf
sleep 1
curl -sx http://127.0.0.1:8888 http://httpbin.org/ip --max-time 8 \
  | grep -q origin && echo "[voyo-home] ✓ tinyproxy is forwarding requests"

# ── 3. Open a Cloudflare Quick Tunnel ────────────────────────────────────

echo ""
echo "[voyo-home] starting Cloudflare tunnel (prints a public URL below)…"
echo "[voyo-home] copy the https://…trycloudflare.com URL when you see it."
echo ""

# Quick tunnel — random trycloudflare.com subdomain, no account needed
cloudflared tunnel --url http://127.0.0.1:8888
