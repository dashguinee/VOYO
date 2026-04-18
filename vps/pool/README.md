# VOYO Proxy Pool

Self-hosted datacenter exit-IP pool replacing Webshare's 1 GB cap with
effectively-unlimited bandwidth via cheap VPSs running `tinyproxy`.

## Architecture

```
               voyomusic.com
                    │
                    ▼
           main VPS (stream.zionsynapse.online)
              ├─ voyo-stream.js :8444
              └─ voyo-proxy.js :8443
                    │  picks a pool node (round-robin, skip cooldowned)
                    │  runs yt-dlp + curl through the node's HTTP proxy
                    ▼
     ┌──────────────┬──────────────┬──────────────┐
     │  node-1      │  node-2      │  node-3      │
     │  tinyproxy   │  tinyproxy   │  tinyproxy   │
     │  :8888       │  :8888       │  :8888       │
     │  Hetzner CX22│  Hetzner CX22│  Hetzner CX22│
     └──────────────┴──────────────┴──────────────┘
                    │
                    ▼   (each node's public IP)
              youtube.com / googlevideo.com
```

Each pool node is a thin HTTP forward proxy. All the heavy lifting (`yt-dlp`,
`bgutil`, cookies, `ffmpeg`, R2 cache) stays on the main VPS. The pool nodes
are exit-IPs only — easy to rebuild, no state, no services beyond tinyproxy.

## Provisioning a node

### 1. Spin up a fresh VPS

**Hetzner CX22** (€4.59/mo, 20 TB bandwidth, Ubuntu 22.04) is the default recommendation.
Any provider works — Vultr, Contabo, OVH. Key requirements:

- Ubuntu 22.04 or 24.04
- 1 GB RAM minimum (tinyproxy + small buffer)
- Datacenter IP in a region YouTube hasn't heavily flagged (US/EU
  generally OK; Hetzner FSN/Helsinki have been reliable)

### 2. Bootstrap

SSH into the fresh VPS as root. Copy `node-bootstrap.sh` and run:

```bash
scp vps/pool/node-bootstrap.sh root@<node-ip>:/tmp/
ssh root@<node-ip> "MAIN_VPS_IP=91.134.135.58 bash /tmp/node-bootstrap.sh"
```

Or one-liner if you put the script behind a URL:

```bash
ssh root@<node-ip> "MAIN_VPS_IP=91.134.135.58 curl -fsSL <url> | bash"
```

The script:
- Installs `tinyproxy` + `ufw`
- Configures tinyproxy on port 8888, `Allow <MAIN_VPS_IP>` only
- Firewalls everything except 22 (SSH) + 8888 (proxy) + 8889 (health)
- Starts a minimal health endpoint as a systemd service
- Prints the config snippet to add to the main VPS

### 3. Register on main VPS

On the main VPS, update the `VOYO_PROXY_POOL` env var with the new node's IP.
Format is a JSON array:

```bash
export VOYO_PROXY_POOL='[
  {"host":"1.2.3.4","port":8888,"healthPort":8889},
  {"host":"5.6.7.8","port":8888,"healthPort":8889},
  {"host":"9.10.11.12","port":8888,"healthPort":8889}
]'
```

Restart `voyo-proxy.js`. On startup it will log:

```
[VOYO] Pool nodes (3):
[VOYO]   1.2.3.4:8888
[VOYO]   5.6.7.8:8888
[VOYO]   9.10.11.12:8888
```

### 4. Verify

```bash
curl -sk https://stream.zionsynapse.online:8443/health | jq .pool
# [
#   {"host":"1.2.3.4","port":8888,"healthy":true,"failures":0,"cooldownSec":0},
#   ...
# ]
```

## Operations

### Routing rules (voyo-proxy.js)

- **Selection**: round-robin through healthy nodes
- **Failure threshold**: 3 consecutive failures on a node → 5 min cooldown
- **Fallback**: if all nodes are cooldowned, Webshare picks up (if `VOYO_RESIDENTIAL_PROXY` is still set — keep it during rollout)

### When a node gets flagged

Symptoms:
- `/health` shows `cooldownSec > 0` for that node
- Logs show `pool x.x.x.x:8888 DEPRECATED for 300s (bot_challenge)` repeatedly

Remediation — full rebuild (new public IP):
1. Destroy the flagged VPS via provider dashboard
2. Spin up a new one (same config, different IP)
3. Run `node-bootstrap.sh` with `MAIN_VPS_IP`
4. Update `VOYO_PROXY_POOL` env var, replace the old IP with the new one
5. Restart `voyo-proxy.js`

Total time: ~10 minutes.

Recommended cadence: rebuild any node flagged twice in 24h.

### Capacity sizing

- Tinyproxy @ 100 maxClients handles ~1000 sessions/hour comfortably
- Each node = 20 TB/month bandwidth (Hetzner standard)
- 3 nodes ≈ 60 TB/month aggregate — way beyond any growth curve you'll hit this year

### Cost

| Config | Monthly | Bandwidth |
|---|---|---|
| 3× Hetzner CX22 | €13.77 | 60 TB |
| Webshare 1 GB   | €3.00  | 1 GB (hard cap) |
| Webshare 10 GB  | ~€30   | 10 GB |

Pool is **unambiguously cheaper at any meaningful traffic level.**

## Cutover plan (from Webshare → pool)

1. Provision + bootstrap 3 nodes (Phase 1)
2. Set `VOYO_PROXY_POOL` on main VPS, keep `VOYO_RESIDENTIAL_PROXY` as fallback
3. Restart `voyo-proxy.js` — pool is primary, Webshare picks up on pool failure
4. Watch telemetry for 24h: `extract_done` counts per source (pool vs webshare
   fallback) — see `/health`'s `pool` stats for ongoing health
5. When pool success rate is stable (>90% over 24h), unset `VOYO_RESIDENTIAL_PROXY`
6. Cancel Webshare subscription

## File index

- `node-bootstrap.sh` — VPS provisioning script (run on each pool node)
- `../voyo-proxy.js` — main proxy with pool rotation (look for `VOYO_PROXY_POOL`)
