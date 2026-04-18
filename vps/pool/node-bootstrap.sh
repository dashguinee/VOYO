#!/bin/bash
# VOYO proxy pool — node bootstrap
#
# One-shot provisioning for a fresh Ubuntu 22.04+ VPS to act as an HTTP
# forward proxy for voyo-proxy.js extraction traffic.
#
# What it does:
#   1. Installs tinyproxy (HTTP CONNECT proxy, ~200KB RAM)
#   2. Locks it down with firewall — only MAIN_VPS_IP can connect
#   3. Sets up log rotation + basic health endpoint
#
# Usage (from the pool node itself, as root):
#   curl -fsSL <url-to-this-script> | MAIN_VPS_IP=91.134.135.58 bash
#
# Or scp this file and:
#   MAIN_VPS_IP=91.134.135.58 sudo bash node-bootstrap.sh
#
# Rebuild a flagged node: just destroy the VPS, re-provision, re-run this.
# Whole turnaround ~10 min including VPS boot.

set -euo pipefail

MAIN_VPS_IP="${MAIN_VPS_IP:-}"
if [ -z "$MAIN_VPS_IP" ]; then
  echo "ERROR: MAIN_VPS_IP env var required" >&2
  echo "Set it to the IP of the main voyo VPS that will connect to this proxy" >&2
  exit 1
fi

PROXY_PORT="${PROXY_PORT:-8888}"
HEALTH_PORT="${HEALTH_PORT:-8889}"

echo "[voyo-pool] bootstrap starting"
echo "[voyo-pool] main VPS IP (allowed): $MAIN_VPS_IP"
echo "[voyo-pool] proxy port: $PROXY_PORT  health port: $HEALTH_PORT"

# ── 1. System update + packages ──────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq tinyproxy ufw curl netcat-openbsd

# ── 2. Configure tinyproxy ────────────────────────────────────────────────
cat > /etc/tinyproxy/tinyproxy.conf <<EOF
# VOYO pool node — HTTP CONNECT proxy
User tinyproxy
Group tinyproxy
Port $PROXY_PORT
Timeout 60
DefaultErrorFile "/usr/share/tinyproxy/default.html"
LogFile "/var/log/tinyproxy/tinyproxy.log"
LogLevel Connect
PidFile "/run/tinyproxy/tinyproxy.pid"
MaxClients 100
# Allow only the main VPS to talk to this proxy
Allow $MAIN_VPS_IP
# CONNECT for HTTPS (youtube/googlevideo)
ConnectPort 443
ConnectPort 80
# Don't disclose version
DisableViaHeader Yes
EOF

systemctl enable tinyproxy
systemctl restart tinyproxy

# ── 3. Firewall — only allow main VPS + SSH ──────────────────────────────
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow from "$MAIN_VPS_IP" to any port "$PROXY_PORT"
ufw allow from "$MAIN_VPS_IP" to any port "$HEALTH_PORT"
ufw --force enable

# ── 4. Minimal health endpoint ────────────────────────────────────────────
# Tiny standalone HTTP server — answers /health with {status,ip,uptime}
cat > /usr/local/bin/voyo-pool-health.sh <<HEALTH
#!/bin/bash
# Ultra-minimal health probe — no deps beyond netcat
PORT=\${HEALTH_PORT:-$HEALTH_PORT}
while true; do
  RESP_BODY='{"status":"ok","ip":"'\$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo unknown)'","uptime":'\$(awk '{print int(\$1)}' /proc/uptime)'}'
  RESP=\$(printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s' \${#RESP_BODY} "\$RESP_BODY")
  echo -e "\$RESP" | nc -l -p "\$PORT" -q 1 >/dev/null 2>&1 || sleep 1
done
HEALTH
chmod +x /usr/local/bin/voyo-pool-health.sh

cat > /etc/systemd/system/voyo-pool-health.service <<EOF
[Unit]
Description=VOYO pool health endpoint
After=network-online.target

[Service]
Type=simple
Environment=HEALTH_PORT=$HEALTH_PORT
ExecStart=/usr/local/bin/voyo-pool-health.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable voyo-pool-health
systemctl restart voyo-pool-health

# ── 5. Log rotation ───────────────────────────────────────────────────────
cat > /etc/logrotate.d/tinyproxy <<'EOF'
/var/log/tinyproxy/tinyproxy.log {
  daily
  rotate 7
  compress
  missingok
  postrotate
    systemctl reload tinyproxy >/dev/null 2>&1 || true
  endscript
}
EOF

# ── 6. Sanity print ───────────────────────────────────────────────────────
sleep 2
NODE_IP=$(curl -s --max-time 5 ifconfig.me || echo "unknown")
echo ""
echo "[voyo-pool] ✓ bootstrap complete"
echo "[voyo-pool]   node public IP : $NODE_IP"
echo "[voyo-pool]   proxy endpoint : http://$NODE_IP:$PROXY_PORT"
echo "[voyo-pool]   health endpoint: http://$NODE_IP:$HEALTH_PORT/health"
echo ""
echo "[voyo-pool] Add this to main VPS voyo-proxy pool config:"
echo "    { host: '$NODE_IP', port: $PROXY_PORT, healthPort: $HEALTH_PORT }"
echo ""
echo "[voyo-pool] Self-test (from main VPS, should return 200):"
echo "    curl -x http://$NODE_IP:$PROXY_PORT https://www.google.com -o /dev/null -w '%{http_code}\\n'"
