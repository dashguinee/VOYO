# VOYO Extraction & Playback Pipeline — Canonical

**Last validated**: 2026-04-19 — end-to-end live, Tier A producing successfully.

This document is the single source of truth. If code contradicts it, the code is legacy.

---

## The Pipeline

```
                        ┌──────────────────────┐
                        │   User plays track   │
                        └──────────┬───────────┘
                                   ▼
                      ┌────────────────────────┐
                      │   R2 hit?              │
                      │  (HEAD voyo-edge)      │
                      └──────┬─────────┬───────┘
                             │         │
                        YES  │         │  NO
                             ▼         ▼
             ┌───────────────┐    ┌──────────────────────────┐
             │ Play now      │    │ PWA upsert voyo_upload_  │
             │ ($0 always)   │    │ queue. Current audio     │
             └───────────────┘    │ keeps playing. Poll R2   │
                                  │ every 2s up to 30s.      │
                                  └──────────┬───────────────┘
                                             │
                      ┌──────────────────────┴─────────────┐
                      ▼                                    ▼
           ┌──────────────────┐              ┌──────────────────┐
           │  VPS Tier chain  │              │  Timeout → VPS   │
           │  extracts within │              │  extracts on     │
           │  the 30s window  │              │  PWA trigger     │
           └────────┬─────────┘              └────────┬─────────┘
                    │                                 │
                    └───────────────┬─────────────────┘
                                    ▼
                         ┌────────────────────┐
                         │  Opus uploaded to  │
                         │  R2. Gentle fade   │
                         │  to new track.     │
                         └────────────────────┘
```

**Principle**: *"No music deserves to be aborted brutally. Music flows at VOYO."*

---

## VPS extraction tier chain (`voyo-proxy.js` → `openUpstream`)

Every cold miss goes through this chain; first tier to return a stream wins:

| Tier | What | When | Cost |
|---|---|---|---|
| **A** | Nightly yt-dlp + `--cookies-from-browser "chrome:/opt/voyo/chrome-profile-NNN"` + NO proxy | **Default**. Works from VPS datacenter IP because cookies come from a live Chrome session Google validates as current; nightly yt-dlp has current challenge-solver fixes. | $0 |
| **B** | Pool nodes (`VOYO_PROXY_POOL` env var) | If configured — unused today, kept for future self-hosted pool | $0 |
| **C** | Home tunnel (`VOYO_HOME_TUNNEL` env var) | Residential-exit insurance — Dash's laptop/WSL via Cloudflare Quick Tunnel. Set up from `scripts/home-proxy/start-home-proxy.sh` when needed. | $0 |
| **D** | Webshare (`VOYO_RESIDENTIAL_PROXY`) | Last-resort paid path. Barely used at steady state. | Webshare bandwidth |

Telemetry: each successful extraction logs `trace` event with `subtype=vps_extract_source` and `source={noproxy|pool|home_tunnel|webshare}` so you can see which tier served each track.

---

## Tiered read order (at playback)

The VPS session resolves audio in this order per track:

1. **`/var/cache/voyo`** — hot local disk on VPS (3 GB, ~220 files). ~5 ms.
2. **Cloudflare R2** via edge worker `voyo-edge.dash-webtv.workers.dev`. ~50 ms.
3. **Cold extraction** via the tier chain above — only if both miss.

At steady state, tier 3 is rare (most tracks are already in R2) and free (Tier A almost always wins).

---

## Write paths to R2

All three write to R2 for the next listener:

| Source | Trigger | Cost |
|---|---|---|
| `voyo-proxy.js` on VPS | Cold miss during user play → Tier A extracts → pipe-tee to user + disk + R2 upload | $0 (Tier A) |
| `audio_conquest_queue.yml` GH Actions worker | Row in `voyo_upload_queue` table | $0 after `--proxy` line removed |
| Legacy `audio_conquest_*.yml` (batch) | **DEPRECATED** — these rely on baked stale cookies, succeed ~0%. Safe to delete. | N/A |

---

## PWA side — `src/services/voyoStream.ts`

**`ensureTrackReady(track, sessionId)`** is the gate every track goes through before VPS playback:

1. Fire-and-forget `voyo_upload_queue` upsert (GH Actions pre-warm path)
2. HEAD-check R2 — if hit, return immediately
3. Poll R2 every 2s up to 30s. Also polls queue status for early-abort on failed rows.
4. Return. Caller (priorityInject or startSession) then talks to VPS session; VPS finds it in R2 or runs its own Tier chain.

Applied globally: `priorityInject` and `startSession` both call it. Opt-out (`{ skipReadyWait: true }`) for circuit breaker rebuild.

---

## Components — canonical list

### Frontend (PWA, `dashguinee/VOYO`)

| File | Role |
|---|---|
| `src/services/voyoStream.ts` | Sessions, queue upsert, R2 wait, VPS comms |
| `src/services/api.ts` → `checkR2Cache()` | R2 HEAD probe |
| `src/components/AudioPlayer.tsx` | Audio element bind, MediaSession, circuit breaker |
| `src/audio/graph/useAudioChain.ts` | Web Audio chain (EQ, boost, visualizer) |

### Backend (VPS `stream.zionsynapse.online`)

| Service | Port | Role |
|---|---|---|
| `voyo-proxy.js` | 8443 | Tier chain extraction, `/voyo/cookies` bridge, R2 upload |
| `voyo-stream.js` | 8444 | Session orchestration, SSE, chained OGG |
| `bgutil-pot` | 4416 | PO token provider (localhost) |
| Chrome profiles ×20 | — | Persistent YouTube sessions, cookie source |

### Remote (`DashGN007/voyo-music-server`)

| File | Role |
|---|---|
| `.github/workflows/audio_conquest_queue.yml` | Warm-polling queue worker — uses nightly yt-dlp. Proxy should be removed. |
| `.github/workflows/audio_conquest_*.yml` (others) | **DEPRECATED batch seed workflows**. Stale cookies, ~0% success. Delete to save GH minutes. |

### Data

| Table / bucket | Role |
|---|---|
| `voyo_upload_queue` | Dynamic extraction queue (primary PWA → GH Actions route) |
| `video_intelligence` | 324K+ track catalog |
| `voyo_playback_events` | Telemetry (includes Tier-source tags) |
| `voyo_tracks` | Seed tracks |
| R2 bucket `voyo-audio` | Collective audio cache (tier 2) |

---

## How to verify pipeline health

```sh
# 1. VPS Tier A alive (fresh extract in ~2s)
curl -sI --max-time 30 "https://stream.zionsynapse.online:8443/voyo/audio/<trackId>?quality=high"

# 2. Cookie bridge serving fresh cookies
curl -sk -H "X-Voyo-Key: $VOYO_COOKIES_SECRET" \
  "https://stream.zionsynapse.online:8443/voyo/cookies" | wc -l  # ≥ 40 lines

# 3. Tier distribution over last hour (from Supabase)
# SELECT meta->>'source', COUNT(*)
#  FROM voyo_playback_events
#  WHERE event_type='trace' AND created_at > now() - interval '1 hour'
#        AND meta->>'subtype' = 'vps_extract_source'
#  GROUP BY 1;
# If 'noproxy' dominates → healthy. If 'webshare' rises → Tier A regressing.

# 4. R2 cache size
# ssh vps "ls /var/cache/voyo | wc -l"  # local disk tier
```

---

## Change log

- **2026-04-19 (evening)** — Tier A becomes default. Webshare demoted to last-resort. Tier D (home tunnel) scaffolded. Pipeline verified end-to-end: ~2s extractions via Tier A with zero Webshare bandwidth.
- **2026-04-19 (afternoon)** — Found `deno + yt-dlp-ejs` was the missing piece on GH Actions; 5/5 success immediately. Earlier conclusion "YouTube broke the free path" was wrong.
- **2026-04-19 (morning)** — Pipeline canonicalized; "flow over interruption" applied globally in voyoStream.
- **2026-04-19 (earlier)** — Queue + cookie bridge + VPS dump helper + Supabase RPCs shipped.
