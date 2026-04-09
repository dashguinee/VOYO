# VOYO Music Backend Infrastructure Audit

**Audit Date**: 2026-01-17
**Auditor**: ZION SYNAPSE
**Status**: PRODUCTION DEPLOYED

---

## Executive Summary

| Service | URL | Status | Purpose |
|---------|-----|--------|---------|
| **Fly.io Backend** | https://voyo-music-api.fly.dev | LIVE | Main API server (search, stream proxy, thumbnails, R2 integration) |
| **Cloudflare Worker** | https://voyo-edge.dash-webtv.workers.dev | LIVE | Edge audio extraction (5 Innertube clients) |
| **Cloudflare R2** | voyo-audio bucket | ACTIVE | Pre-cached audio storage (41K+ tracks) |
| **Railway** | N/A | CONFIGURED (not primary) | Alternative deployment option |

---

## 1. Fly.io Configuration

### fly.toml Details
- **Location**: `/home/dash/voyo-music/server/fly.toml`
- **App Name**: `voyo-music-api`
- **URL**: `https://voyo-music-api.fly.dev`
- **Region**: `sin` (Singapore)
- **Internal Port**: 8080
- **Memory**: 1GB
- **CPU**: 1 shared CPU
- **Auto-scaling**: Enabled (stops when idle, auto-starts on request)

### Deployment Status
```json
{
  "status": "healthy",
  "service": "voyo-backend",
  "memory": {"rss": "73MB", "heapUsed": "20MB"}
}
```

---

## 2. Cloudflare Configuration

### R2 Bucket
- **Bucket Name**: `voyo-audio`
- **Account ID**: `2b9fcfd8cd9aedbd862ffd071d66a3e`
- **Credentials Location**: `~/.r2_credentials`
- **Content**: Pre-cached MP3 files in `128/` and `64/` quality folders
- **Estimated Tracks**: 41,000+

### R2 Credentials (from ~/.r2_credentials)
```
R2_ACCOUNT_ID=2b9fcfd8cd9aedbd862ffd071d66a3e
R2_ACCESS_KEY=82679709fb4e9f7e77f1b159991c9551
R2_SECRET_KEY=306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52
R2_BUCKET=voyo-audio
```

### Cloudflare Worker (Edge)
- **Location**: `/home/dash/voyo-music/worker/` (wrangler.toml only - no index.js in repo)
- **Worker Name**: `voyo-edge`
- **URL**: `https://voyo-edge.dash-webtv.workers.dev`
- **Purpose**: Direct YouTube audio extraction at edge (bypasses backend for speed)
- **Status**: LIVE (returns `{"status":"ok","edge":true,"clients":5}`)

### wrangler.toml
```toml
name = "voyo-edge"
main = "index.js"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
```

**Note**: The `index.js` worker file is deployed to Cloudflare but not present in the local repository.

---

## 3. Server Code Analysis

### Main File
- **Path**: `/home/dash/voyo-music/server/index.js`
- **Port**: 3001 (local) / 8080 (Fly.io production)
- **Type**: ES Module (`"type": "module"`)

### Dependencies
```json
{
  "@aws-sdk/client-s3": "^3.971.0",  // R2 bucket access
  "youtubei.js": "^16.0.1"           // Innertube API
}
```

### System Dependencies (Railway build)
- Node.js 20
- yt-dlp
- ffmpeg
- deno
- python311
- bgutil-ytdlp-pot-provider (PO Token plugin)

### Endpoints Summary

#### Monitoring Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check with cache metrics |
| `/debug` | GET | yt-dlp and deno availability check |

#### Stealth Endpoints (VOYO IDs - vyo_XXXXX)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/search?q=QUERY` | GET | Search with VOYO IDs |
| `/cdn/stream/vyo_XXXXX` | GET | Stream audio (stealth) |
| `/cdn/art/vyo_XXXXX` | GET | Album art (stealth) |

#### Legacy Endpoints (YouTube IDs)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/stream?v=ID` | GET | Get stream URL (with VOYO BOOST) |
| `/proxy?v=ID` | GET | Proxy stream through server |
| `/search?q=QUERY` | GET | Search YouTube |
| `/thumbnail?id=ID` | GET | Proxy thumbnail |
| `/related?v=ID` | GET | Get related videos |
| `/prefetch?v=ID` | GET | Warm cache (async 202) |

#### R2 Cloudflare Storage Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/r2/exists?v=ID&q=128|64` | GET | Check if track in R2 |
| `/r2/stream/VIDEO_ID?q=128|64` | GET | Stream from R2 (fastest!) |
| `/r2/best?v=ID&q=128|64` | GET | Best URL (R2 or YouTube) |
| `/r2/stats` | GET | R2 cache statistics |

#### Offline/Download Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/download?v=ID` | GET | Download track |
| `/download?v=ID` | DELETE | Delete downloaded track |
| `/downloaded` | GET | List downloaded IDs |
| `/downloads/VIDEO_ID.mp3` | GET | Serve downloaded file |

### Key Features
1. **VOYO BOOST**: Background download while streaming from YouTube
2. **R2 Priority**: Checks R2 first (41K+ pre-cached tracks)
3. **Stealth Mode**: Obfuscates YouTube IDs as VOYO IDs
4. **Rate Limiting**: Per-IP (60/min) and global yt-dlp limits (300/min)
5. **Innertube Integration**: Uses YouTube's internal API via youtubei.js
6. **Piped Fallback**: Falls back to Piped instances if Innertube fails
7. **Range Request Support**: Full seeking support for audio streaming

---

## 4. Frontend API Configuration

### File Location
- **Path**: `/home/dash/voyo-music/src/services/api.ts`

### Constants
```typescript
const API_URL = 'https://voyo-music-api.fly.dev';
const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';
```

### API Functions
- `searchMusic(query, limit)` - Search via `/api/search`
- `getAudioStream(videoId, quality)` - R2 first, then YouTube
- `checkR2Cache(videoId, quality)` - Check R2 availability
- `tryEdgeExtraction(voyoId)` - Try edge worker extraction
- `getThumbnailUrl(videoId, quality)` - Get proxied thumbnail
- `downloadTrack(trackId)` - Trigger server download
- `getOfflineUrl(trackId)` - Get cached download URL
- `healthCheck()` - Backend health check
- `prefetchTrack(trackId)` - Warm cache

### Stream Priority
1. R2 Cache (41K+ tracks) - fastest
2. VOYO BOOST (local cache on server)
3. YouTube Proxy (via backend)
4. YouTube IFrame (ultimate fallback)

---

## 5. Railway Configuration

### Files
- `/home/dash/voyo-music/railway.json` (root)
- `/home/dash/voyo-music/server/railway.json` (server-specific)

### Build Configuration
```json
{
  "builder": "nixpacks",
  "setup": ["nodejs_20", "yt-dlp", "ffmpeg", "deno", "python311"],
  "install": ["npm install", "pip3 install bgutil-ytdlp-pot-provider"],
  "startCommand": "yt-dlp --version && node index.js"
}
```

### Status
Railway is **configured as an alternative** to Fly.io. The primary deployment is on Fly.io. Railway can be used if Fly.io has issues or for testing.

---

## 6. Environment Variables Required

### Server Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3001 | Server port |
| `R2_ACCOUNT_ID` | No | Hardcoded | Cloudflare account ID |
| `R2_ACCESS_KEY` | No | Hardcoded | R2 access key |
| `R2_SECRET_KEY` | No | Hardcoded | R2 secret key |
| `R2_BUCKET` | No | voyo-audio | R2 bucket name |
| `YT_API_KEY` | No | Hardcoded | YouTube Innertube API key |
| `YT_DLP_PATH` | No | yt-dlp | Path to yt-dlp binary |
| `API_BASE` | No | Auto-detected | Base URL for self-referencing |
| `FLY_APP_NAME` | Auto | - | Set by Fly.io (used for API_BASE) |
| `RAILWAY_PUBLIC_DOMAIN` | Auto | - | Set by Railway (used for API_BASE) |

### Security Note
Credentials are currently hardcoded in the source code as fallbacks. For production security:
1. Use environment variables instead of hardcoded values
2. Rotate the exposed API keys
3. Use Fly.io secrets: `fly secrets set R2_SECRET_KEY=xxx`

---

## 7. Architecture Diagram

```
                                   +------------------+
                                   |  Cloudflare R2   |
                                   |  voyo-audio      |
                                   |  (41K+ tracks)   |
                                   +--------+---------+
                                            |
                                            | S3 API
                                            v
+------------+    HTTPS     +----------------------------------+
|            |   /api/*     |        Fly.io Backend            |
|  Frontend  +------------->|     voyo-music-api.fly.dev       |
|  (React)   |              |                                  |
|            |              |  - Search (/api/search)          |
+-----+------+              |  - Stream proxy (/proxy, /cdn)   |
      |                     |  - R2 check (/r2/exists)         |
      |                     |  - Thumbnails (/cdn/art)         |
      |                     |  - Downloads (/download)         |
      |                     +----------------------------------+
      |
      | /stream (edge)
      v
+----------------------------------+
|     Cloudflare Worker            |
|  voyo-edge.dash-webtv.workers    |
|                                  |
|  - Direct audio extraction       |
|  - 5 Innertube client rotation   |
|  - Edge-close performance        |
+----------------------------------+
```

---

## 8. Recommendations

### Immediate Actions
1. **Rotate Credentials**: R2 keys are exposed in source code
2. **Add Worker to Repo**: `worker/index.js` is deployed but missing from git
3. **Environment Variables**: Move all hardcoded secrets to Fly.io secrets

### Performance Optimizations
1. R2 coverage is good (41K+ tracks) - continue growing cache
2. Edge worker provides fast extraction - ensure it's monitored
3. Consider adding more Fly.io regions for global latency

### Monitoring
- Health endpoint is comprehensive with cache metrics
- Add alerting on cache hit rate drops
- Monitor rate limit triggers for abuse detection

---

## 9. Quick Reference

### Test Commands
```bash
# Health check
curl https://voyo-music-api.fly.dev/health

# Search
curl "https://voyo-music-api.fly.dev/api/search?q=test"

# R2 check
curl "https://voyo-music-api.fly.dev/r2/stats"

# Edge worker
curl https://voyo-edge.dash-webtv.workers.dev/health
```

### Local Development
```bash
cd /home/dash/voyo-music/server
npm install
npm run dev  # Starts on port 3001
```

### Deploy to Fly.io
```bash
cd /home/dash/voyo-music/server
fly deploy
```

---

*Audit completed successfully. Both primary services (Fly.io + Cloudflare Worker) are LIVE and HEALTHY.*
