# VOYO Home Proxy — Tier D residential exit

Insurance layer. Runs a tinyproxy forward proxy on Dash's machine, exposed via Cloudflare Quick Tunnel. VPS routes extraction through it when the server-side tiers (A, B, C) all fail.

## When to use

Only when Tier A (VPS no-proxy nightly+cookies) success rate drops below ~85%. Check `/voyo/health` or Supabase telemetry. Right now Tier A is ~95% → this is parked.

## Setup (first time, ~5 min)

On Dash's WSL or Linux laptop:

```bash
cd /home/dash/voyo-music/scripts/home-proxy
bash start-home-proxy.sh
```

The script will:
1. Install `tinyproxy` and `cloudflared` if missing (asks sudo once)
2. Start tinyproxy on 127.0.0.1:8888
3. Open a Cloudflare Quick Tunnel — prints a URL like `https://xyz-random.trycloudflare.com`

Copy that URL.

## Wire into VPS

SSH to VPS and set the env var, restart voyo-audio:

```bash
ssh vps
sudo -E PM2_HOME=/root/.pm2 pm2 set voyo-audio:VOYO_HOME_TUNNEL 'https://xyz-random.trycloudflare.com'
sudo -E PM2_HOME=/root/.pm2 pm2 restart voyo-audio --update-env
```

The VPS's `voyo-proxy.js` already knows how to use this as Tier B fallback (between no-proxy and Webshare). Extraction requests that fail Tier A automatically route through your home's residential IP.

## Turning it off

Ctrl+C in the terminal running `start-home-proxy.sh`. The tunnel dies; VPS falls through to Webshare as before.

If the URL changes after a restart (quick tunnels rotate on each run), re-`pm2 set` the new URL on VPS.

## For 24/7 resilience later

Quick tunnels are ephemeral. If you want a stable URL, run an authenticated Cloudflare Tunnel bound to a subdomain like `home-proxy.dasuperhub.com`:

```bash
cloudflared tunnel login    # one-time browser auth
cloudflared tunnel create voyo-home
cloudflared tunnel route dns voyo-home home-proxy.dasuperhub.com
cloudflared tunnel --name voyo-home run
```

Add the persistent URL to VPS env once. Tunnel auto-reconnects across restarts.
