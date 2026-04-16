# VOYO Music — Operations Runbook

Last updated: 2026-04-16 (after v214 + cron hardening shipped)

Quick-reference for recovering from outages, rolling back deploys, and
diagnosing the most common failure modes. Written for a 3am context —
minimal assumed knowledge of what was shipped yesterday.

---

## Topology

```
┌────────────────────────┐       ┌──────────────────────┐
│   PWA (voyomusic.com)  │──HTTPS─▶ Cloudflare Worker   │
│   Vercel                │       │   voyo-edge          │
│   React 19 + Vite 7     │       │   InnerTube extract  │
└───────┬────────────────┘       │   R2 bucket access   │
        │                        └──────────────────────┘
        │
        │ HTTPS (stream.zionsynapse.online:8443)
        ▼
┌────────────────────────────────────────┐
│   OVH VPS (Ubuntu 25.04)               │
│   ┌────────────────────────────────┐   │
│   │ pm2: voyo-audio (port 8443)    │   │  /home/ubuntu/voyo-proxy.js
│   │   → /var/cache/voyo hot tier   │   │
│   │   → /opt/voyo/cookies-*.txt    │   │  file-cookie fallback
│   │   → yt-dlp-safe (wrapper)      │   │  /usr/local/bin/yt-dlp-safe
│   ├────────────────────────────────┤   │
│   │ pm2: voyo-chrome-001 (:9222)   │   │  persistent Chromium
│   │   /opt/voyo/chrome-profile-001 │   │  YouTube login lives here
│   ├────────────────────────────────┤   │
│   │ pm2: bgutil-pot (:4416)        │   │  PoToken generator
│   ├────────────────────────────────┤   │
│   │ pm2: stream-proxy              │   │  (Tivi, unrelated)
│   └────────────────────────────────┘   │
│   /etc/cron.weekly/yt-dlp-update       │  Sunday auto-update
│   /etc/cron.daily/voyo-cache-prune     │  LRU + size cap
│   /etc/cron.d/voyo-health-probe        │  every 15 min
└────────────────────────────────────────┘
```

---

## Common failures — diagnosis + fix

### Nothing plays (user reports "music broken")

1. Check deployed version: `curl -s https://voyomusic.com/version.json`
2. Check VPS health: `curl -s https://stream.zionsynapse.online:8443/voyo/health`
3. Pull recent telemetry:
   ```bash
   KEY=$(grep VITE_SUPABASE_ANON_KEY /home/dash/voyo-music/.env | cut -d= -f2)
   curl -s "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_playback_events?order=created_at.desc&limit=20" \
     -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
   ```
4. Look for recent `critical_alert` rows — those indicate health probe fires.
5. Read the last 15 min of voyo-audio logs: `ssh vps 'sudo pm2 logs voyo-audio --lines 50 --nostream'`

### Cookies went stale (YouTube bot-check firing on many tracks)

**Signal**: `CRITICAL cookie_login_lost` in `/var/log/voyo-health.log`, or
repeated `Sign in to confirm you're not a bot` in voyo-audio logs.

**Fix A (preferred) — re-login the persistent browser:**
1. On laptop: `ssh -L 9222:127.0.0.1:9222 vps`
2. Local Chrome → `chrome://inspect/#devices`
3. Configure target → `localhost:9222` → Done
4. Click `inspect` (or `inspect fallback`) on the youtube.com target
5. Enable screencast (Ctrl+Shift+M in DevTools)
6. Navigate to `https://accounts.google.com/ServiceLogin?service=youtube` in the preview
7. Sign in with the VOYO dedicated Google account
8. Verify on youtube.com that profile circle shows logged-in state
9. Close DevTools. Done.

**Fix B (emergency, lasts hours not days) — ship fresh cookie file:**
Export cookies from your local Chrome, run:
```
/home/dash/voyo-music/scripts/ship-cookies.sh
```
This updates /opt/voyo/cookies-001/002/003.txt. The wrapper tries the
browser profile first, falls back to these files if the browser is
broken.

### Proxy crashed / returning 500s

```bash
ssh vps 'sudo pm2 logs voyo-audio --lines 100 --nostream 2>&1 | tail -50'
ssh vps 'sudo pm2 restart voyo-audio --update-env'
```

If the restart doesn't help, roll back to previous version (see Rollback).

### Chrome died / remote-debug endpoint unreachable

```bash
ssh vps 'sudo pm2 restart voyo-chrome-001'
# If still broken, kill + restart from scratch:
ssh vps 'sudo pm2 delete voyo-chrome-001 && sudo pm2 start /usr/local/bin/voyo-chrome-001.sh --name voyo-chrome-001 --max-restarts 20'
# Profile has been reset — needs re-login per Fix A above.
```

### /var/cache is full

```bash
ssh vps 'sudo /etc/cron.daily/voyo-cache-prune'
# Manually reclaim:
ssh vps 'sudo find /var/cache/voyo -name "*.opus" -atime +7 -delete'
```

### Extraction working for R2 hits but failing for new tracks

Edge worker likely 502'ing. The circuit breaker should auto-skip after
3 consecutive failures. Check:
```
ssh vps 'curl -s https://stream.zionsynapse.online:8443/voyo/health | grep edgeCircuit'
```
If `"open":true`, the wrapper is going straight to yt-dlp. Verify
cookies work via Fix A or B. If both paths fail, escalate to
`github.com/yt-dlp/yt-dlp/issues` — YouTube may have shipped a change.

---

## Rollback

### Proxy (voyo-proxy.js on VPS)

```bash
ssh vps 'sudo cp /home/ubuntu/voyo-proxy-v1.js.bak /home/ubuntu/voyo-proxy.js'
ssh vps 'sudo pm2 restart voyo-audio --update-env'
```

Backups saved on VPS:
- `/home/ubuntu/voyo-proxy-v1.js.bak` — pre-pipe-tee (before v214)
- `/home/ubuntu/voyo-proxy-v2.0.bak` — pre-circuit-breaker (v214 initial)

### yt-dlp-safe wrapper

```bash
ssh vps 'sudo cp /usr/local/bin/yt-dlp-safe.v1.bak /usr/local/bin/yt-dlp-safe'
```

### PWA

```bash
cd /home/dash/voyo-music
git log --oneline -10         # find the tag/SHA to roll to
git revert <sha> --no-edit    # creates a revert commit
npm run build
npx vercel --prod --yes
```

Force field `force:true` in `public/version.json` triggers PWA
auto-update on next client navigation. Bump the version integer.

---

## Deploy procedures

### PWA
```bash
cd /home/dash/voyo-music
# Edit public/version.json — bump the patch number
npm run build
npx vercel --prod --yes
sleep 8 && curl -s https://voyomusic.com/version.json
```

### VPS proxy
```bash
# Edit vps/voyo-proxy.js locally
node --check vps/voyo-proxy.js && echo OK
scp vps/voyo-proxy.js vps:/tmp/voyo-proxy-new.js
ssh vps 'sudo cp /home/ubuntu/voyo-proxy.js /home/ubuntu/voyo-proxy-$(date -u +%Y%m%d-%H%M%S).bak'
ssh vps 'sudo cp /tmp/voyo-proxy-new.js /home/ubuntu/voyo-proxy.js'
ssh vps 'sudo pm2 restart voyo-audio --update-env'
ssh vps 'curl -s https://stream.zionsynapse.online:8443/voyo/health'
```

### Wrapper
```bash
scp vps/yt-dlp-safe vps:/tmp/yt-dlp-safe-new
ssh vps 'sudo cp /usr/local/bin/yt-dlp-safe /usr/local/bin/yt-dlp-safe-$(date -u +%Y%m%d-%H%M%S).bak'
ssh vps 'sudo mv /tmp/yt-dlp-safe-new /usr/local/bin/yt-dlp-safe && sudo chmod +x /usr/local/bin/yt-dlp-safe && sudo chown root:root /usr/local/bin/yt-dlp-safe'
```

---

## Monitoring

- **Real-time**: `/voyo/health` endpoint
- **15-min probe**: `/var/log/voyo-health.log` on VPS
- **CRITICAL events**: Supabase `voyo_playback_events` rows with `event_type='critical_alert'`
- **VPS proxy logs**: `ssh vps 'sudo pm2 logs voyo-audio'`
- **Cache state**: `ssh vps 'sudo du -sh /var/cache/voyo'`
- **yt-dlp update log**: `/var/log/voyo-ytdlp-update.log`

---

## Known trade-offs (not bugs)

- **Pipe-tee slow-client coupling**: if a user's TCP can't keep up, FFmpeg
  pauses — cache completion is slow for that user but memory stays bounded.
- **Waveform regen per extract**: ~200ms extra CPU per cache-finalize.
- **FFmpeg not killed on client disconnect**: intentional — cache still
  completes for the next user. Wastes CPU on truly-abandoned plays.
- **Single Chrome profile**: until chrome-profile-002 is set up, one
  flagged account breaks extraction fallback-to-files. Plan: rotate across
  3 accounts.

---

## Contact

Dash — WhatsApp preferred (CLAUDE.md: WhatsApp > Email, 78% higher response).
