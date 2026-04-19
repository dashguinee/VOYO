# VOYO Extraction & Playback Pipeline — Canonical

**Last validated**: 2026-04-19 — end-to-end live.

This document supersedes any older extraction/audio docs. Everything in VOYO flows through this. If you find code that contradicts the flow below, it's either legacy or a bug.

---

## The Pipeline (single source of truth)

```
                        ┌──────────────────────┐
                        │   User plays track   │
                        └──────────┬───────────┘
                                   ▼
                      ┌────────────────────────┐
                      │  Is it in R2?          │
                      │  (HEAD voyo-edge)      │
                      └──────┬─────────┬───────┘
                             │         │
                        YES  │         │  NO
                             ▼         ▼
             ┌───────────────┐    ┌──────────────────────────┐
             │  Play now     │    │ 1. Upsert voyo_upload_    │
             │  (VPS session │    │    queue (Supabase)      │
             │  → /var/cache │    │ 2. Current audio keeps   │
             │  → R2 → bytes)│    │    playing (no cut)      │
             └───────────────┘    │ 3. Wait ≤ SEARCH_WAIT_MS │
                                  │    (60s) for R2 to       │
                                  │    populate              │
                                  └──────────┬───────────────┘
                                             │
                                ┌────────────┴─────────────┐
                                │                           │
                         R2 landed                   Timeout (rare)
                                │                           │
                                ▼                           ▼
                      ┌───────────────┐            ┌──────────────────┐
                      │  VPS session  │            │  VPS session     │
                      │  plays from   │            │  extracts via    │
                      │  R2 hit ($0)  │            │  Webshare        │
                      └───────┬───────┘            │  (fallback path) │
                              │                    │  → also writes   │
                              │                    │    to R2 for     │
                              │                    │    next listener │
                              │                    └────────┬─────────┘
                              │                             │
                              └──────────────┬──────────────┘
                                             ▼
                                   ┌──────────────────┐
                                   │ Gentle cross-fade│
                                   │ from current →   │
                                   │ new track.       │
                                   │ Never a hard cut.│
                                   └──────────────────┘
```

**Principle**: *"No music deserves to be aborted brutally. Music flows at VOYO."*

Every track transition waits for its replacement to be ready before cutting the current one. Ready = in R2 (local or via Webshare fallback after 60s bound).

---

## Tiered read order (at playback time)

Per track, the VPS resolves audio in order:

1. **`/var/cache/voyo`** — 3.2 GB hot local disk on VPS. ~5 ms.
2. **Cloudflare R2** via edge worker `voyo-edge.dash-webtv.workers.dev`. ~50 ms.
3. **Cold extraction** — only if both miss:
   - **PRIMARY** — PWA has already upserted to `voyo_upload_queue`; GH Actions worker extracts (free path) and writes to R2.
   - **FALLBACK** — VPS `voyo-proxy.js` extracts via Webshare (paid, bounded).

At steady state, tier 3 is rare: popular tracks are always already in R2, and the queue-first path catches most unique search misses.

---

## Write paths to R2

Everything that extracts writes to R2 for the next listener. There are exactly three sources:

| Source | Trigger | Bandwidth |
|---|---|---|
| `voyo-proxy.js` on VPS | Cold miss via session extract | Webshare (paid, fallback only) |
| `audio_conquest_queue.yml` GH Actions worker | Row in `voyo_upload_queue` | GitHub runners (free) — primary |
| `audio_conquest_*.yml` GH Actions (legacy batch) | Manual / scheduled | GitHub runners — retained for batch seeding |

All three upload to the same `voyo-audio` R2 bucket via the `voyo-edge/upload/{trackId}` endpoint. No other path writes audio to R2.

---

## The "flow over interruption" pattern (PWA side)

Implemented in `src/services/voyoStream.ts`.

**`ensureTrackReady(track, sessionId)`** is the gate every track goes through before VPS playback:

1. Fire-and-forget `voyo_upload_queue` upsert (GH Actions primary path)
2. HEAD-check R2 — if hit, return immediately (no wait)
3. Poll R2 every 2s up to 60s — return when hit or on timeout

Applied in:
- `priorityInject(track)` — search/rapid-skip/deck injections
- `startSession(firstTrack, queue)` — first track on session create

Opt-outs (caller sets `{ skipReadyWait: true }`):
- `AudioPlayer.tsx` circuit breaker rebuild (user already stuck, needs instant recovery)
- Future: any "emergency pivot" path

---

## Components — canonical list

### Frontend (PWA, `dashguinee/VOYO`)

| File | Role in pipeline |
|---|---|
| `src/services/voyoStream.ts` | Owns sessions, queue upsert, R2 wait, VPS communication |
| `src/services/api.ts` → `checkR2Cache()` | R2 HEAD probe (referenced in voyoStream) |
| `src/components/AudioPlayer.tsx` | Binds audio element, media session, circuit breaker |
| `src/audio/graph/useAudioChain.ts` | Web Audio chain (EQ, boost, visualizer) — playback-side only |

### Backend (VPS at `stream.zionsynapse.online`)

| Service | Port | Role |
|---|---|---|
| `voyo-proxy.js` | 8443 | Cold extraction + R2 upload + `/voyo/cookies` bridge |
| `voyo-stream.js` | 8444 | Session orchestration, SSE, chained OGG |
| `bgutil-pot` | 4416 | PO token provider (localhost, consumed by `voyo-proxy`) |
| Chrome profiles × 20 | — | Persistent YouTube sessions, source of fresh cookies |

### Remote automation (`DashGN007/voyo-music-server`)

| File | Role |
|---|---|
| `.github/workflows/audio_conquest_queue.yml` | Warm-polling queue worker (primary free path) |
| `.github/workflows/audio_conquest_*.yml` | Batch seed workflows (one per account) — for pre-warming the catalog from `video_intelligence` |

### Data

| Table | Role |
|---|---|
| `voyo_upload_queue` | Queue for dynamic extraction requests |
| `video_intelligence` | 324K+ track catalog (source of conquest targets) |
| `voyo_playback_events` | Telemetry from both PWA and VPS |
| `voyo_tracks` | Seed tracks |
| R2 bucket `voyo-audio` | Collective audio cache (tier 2) |

---

## What is NOT part of the pipeline (candidates for removal)

Anything the pipeline above doesn't reference is bloat. Known candidates at time of writing:

- Client-side audio caching beyond the Web Audio playback chain (voyoStream owns all fetching)
- Old cobalt/ytsr/alternate-extractor helpers (none active)
- Residential-proxy-as-primary code paths (Webshare is fallback only now)
- Scraped-proxy-pool dead code (never materialized)
- `preloadManager` / browser-based preload refs (removed 2026-04-19, may have stragglers)
- Sample-based "preview" concepts (the pipeline never needs previews — R2 wait handles it)

See `CLEANUP.md` for any remaining scheduled removals.

---

## How to verify the pipeline is healthy

```sh
# 1. R2 HEAD a known track — must be 200
curl -sI "https://voyo-edge.dash-webtv.workers.dev/audio/dQw4w9WgXcQ?q=high" | head -1

# 2. Cookie bridge — auth required, must return ≥5 lines of Netscape cookies
curl -sk -H "X-Voyo-Key: $VOYO_COOKIES_SECRET" "https://stream.zionsynapse.online:8443/voyo/cookies" | wc -l

# 3. VPS health — must be { status: ok, ... }
curl -sk "https://stream.zionsynapse.online:8443/health" | head -c 200

# 4. Insert a canary into the queue, watch GH Actions worker pick it up
curl -X POST "https://anmgyxhnyhbyxzpjhxgx.supabase.co/rest/v1/voyo_upload_queue" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"youtube_id":"<real_ytid>"}'
# within ~60s, HEAD on R2 should return 200 for that trackId
```

---

## Change log

- 2026-04-19 — Pipeline canonicalized. GH Actions queue becomes primary, Webshare demoted to fallback. "Flow over interruption" applied globally in voyoStream (priorityInject + startSession).
- 2026-04-19 — `deno` + `yt-dlp-ejs` added to GH Actions workflow; these were the missing pieces for JS challenge solving. Extraction success rate on live videos jumped from ~10% to 100%.
- 2026-04-19 — Queue + cookie bridge + VPS dump helper + Supabase RPCs shipped. See `memory/voyo-free-path-SOLVED-2026-04-19.md` for the full debug arc.
