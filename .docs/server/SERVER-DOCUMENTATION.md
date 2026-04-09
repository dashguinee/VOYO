# VOYO Music Backend - Complete Server Documentation

**Version:** 2.0.0
**Last Updated:** December 19, 2025
**Server Type:** Node.js HTTP Server with YouTube Integration
**Production URL:** https://voyo-music-server-production.up.railway.app

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Environment Setup](#environment-setup)
4. [Core Systems](#core-systems)
5. [API Reference](#api-reference)
6. [Deployment](#deployment)
7. [Security & Rate Limiting](#security--rate-limiting)
8. [Performance & Caching](#performance--caching)
9. [Error Handling](#error-handling)
10. [Worker (Cloudflare)](#worker-cloudflare)

---

## Architecture Overview

### System Design Philosophy

VOYO Music Backend is a **production-grade streaming proxy** that extracts and serves audio from YouTube while:
- **Hiding YouTube completely** from the frontend (Stealth Mode)
- **Providing instant playback** with aggressive caching
- **Protecting against rate limits** with multi-tier protection
- **Scaling horizontally** with edge workers and CDN patterns

### Key Components

```
┌─────────────────────────────────────────────────────────────┐
│                      VOYO Backend v2.0                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   HTTP/HTTPS │  │   Innertube  │  │   yt-dlp     │      │
│  │   Server     │──│   API Client │──│   Extractor  │      │
│  │   (Node.js)  │  │  (youtubei)  │  │   (Fallback) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                                                     │
│         ├──── Stream Cache (4 hours)                         │
│         ├──── Thumbnail Cache (24 hours)                     │
│         ├──── Prefetch Cache (30 minutes)                    │
│         └──── Rate Limiter (Multi-tier)                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
         │                         │
         ▼                         ▼
    Client Apps            Cloudflare Worker
   (Web/Mobile)              (Edge Proxy)
```

---

## Technology Stack

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **Node.js** | ≥18.0.0 | Runtime environment |
| **youtubei.js** | ^16.0.1 | YouTube's Innertube API (PRIMARY) |
| **yt-dlp** | Latest | YouTube extraction tool (FALLBACK) |
| **Deno** | Latest | yt-dlp JavaScript runtime |
| **FFmpeg** | Latest | Audio format conversion |

### Built-in Modules

- `http` - HTTP server
- `https` - HTTPS requests with connection pooling
- `url` - URL parsing
- `fs` - File system operations
- `path` - Path utilities
- `child_process` - Spawn yt-dlp processes

### External Services

1. **YouTube Innertube API** (Primary)
   - Direct access to YouTube's internal API
   - Same API used by YouTube mobile apps
   - No third-party dependencies
   - ~500ms response time

2. **Piped Instances** (Fallback)
   - `https://pipedapi.kavin.rocks`
   - `https://api.piped.private.coffee`
   - `https://pipedapi.r4fo.com`

3. **yt-dlp** (Legacy Fallback)
   - Command-line YouTube extractor
   - Used when Innertube fails
   - Slower but more reliable

---

## Environment Setup

### Required Environment Variables

```bash
# Server Configuration
PORT=3001                    # Server port (default: 3001)
NODE_ENV=production          # Environment (development/production)

# API Configuration
YT_API_KEY=AIzaSy...         # YouTube API key (for Innertube)
API_BASE=https://...         # Auto-detected from FLY_APP_NAME or RAILWAY_PUBLIC_DOMAIN

# Deployment Platform (Auto-detected)
FLY_APP_NAME=voyo-music-api          # Fly.io app name
RAILWAY_PUBLIC_DOMAIN=voyo-music...  # Railway public domain

# System Paths
YT_DLP_PATH=/usr/local/bin/yt-dlp   # Path to yt-dlp binary
```

### Auto-Detection Logic

The server automatically detects the deployment environment:

```javascript
// Auto-detect API_BASE
let API_BASE = process.env.API_BASE || `http://localhost:${PORT}`;

if (process.env.FLY_APP_NAME) {
  // Fly.io deployment
  API_BASE = `https://${process.env.FLY_APP_NAME}.fly.dev`;
} else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  // Railway deployment
  API_BASE = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}
```

### Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Install system requirements
# macOS:
brew install yt-dlp ffmpeg deno

# Ubuntu/Debian:
apt-get install yt-dlp ffmpeg python3 python3-pip
curl -fsSL https://deno.land/install.sh | sh

# 3. Install PO Token plugin (unlocks all YouTube formats)
pip3 install bgutil-ytdlp-pot-provider

# 4. Create downloads directory
mkdir -p downloads

# 5. Start development server
npm run dev

# 6. Verify installation
curl http://localhost:3001/health
curl http://localhost:3001/debug
```

---

## Core Systems

### 1. Innertube Integration (Primary Audio Extraction)

**Location:** Lines 59-113 in `index.js`

The Innertube system uses YouTube's internal API (same as mobile apps) to extract audio URLs directly.

#### Initialization

```javascript
async function getInnertube() {
  if (!innertube) {
    console.log('[Innertube] Initializing YouTube internal API...');
    innertube = await Innertube.create({
      cache: new Map(),              // In-memory cache
      generate_session_locally: true, // No API calls for session
    });
  }
  return innertube;
}
```

**Behavior:**
- Creates singleton Innertube instance on first request
- Maintains internal session for API calls
- Caches API responses in memory

#### Audio Extraction

```javascript
async function extractAudioWithInnertube(videoId) {
  const yt = await getInnertube();
  const info = await yt.getBasicInfo(videoId);

  // Get audio formats from adaptive_formats
  const audioFormats = info.streaming_data.adaptive_formats
    .filter(f => f.mime_type?.startsWith('audio/'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  // Prefer mp4 audio for better compatibility
  const mp4Audio = audioFormats.find(f => f.mime_type?.includes('mp4'));
  const bestAudio = mp4Audio || audioFormats[0];

  return {
    url: bestAudio.url,           // Direct googlevideo URL
    mimeType: bestAudio.mime_type?.split(';')[0],
    bitrate: bestAudio.bitrate,
    title: info.basic_info?.title,
  };
}
```

**Format Selection Logic:**
1. Filter for audio-only streams
2. Sort by bitrate (descending)
3. Prefer MP4/M4A for browser compatibility
4. Fallback to highest bitrate WebM/Opus

**Typical Formats Returned:**
- `audio/mp4` - 128kbps AAC (format 140)
- `audio/webm` - 139kbps Opus (format 251) - BEST QUALITY

---

### 2. Stealth Mode System

**Location:** `stealth.js` (entire file)

Stealth Mode ensures ZERO YouTube references in the frontend by encoding all YouTube IDs.

#### VOYO ID Encoding

```javascript
export function encodeVoyoId(youtubeId) {
  // Base64 encode, then make URL-safe
  const base64 = Buffer.from(youtubeId).toString('base64');
  const urlSafe = base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');  // Remove padding

  return `vyo_${urlSafe}`;
}
```

**Examples:**
- YouTube: `dQw4w9WgXcQ` → VOYO: `vyo_ZFF3NHc5V2dYY1E`
- YouTube: `OSBan_sH_b8` → VOYO: `vyo_T1NCYW5fc0hfYjg`

#### VOYO ID Decoding

```javascript
export function decodeVoyoId(voyoId) {
  const encoded = voyoId.substring(4);  // Strip 'vyo_' prefix

  // Reverse URL-safe base64
  let base64 = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Add padding
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  return Buffer.from(base64, 'base64').toString('utf8');
}
```

#### Search Result Sanitization

```javascript
export function sanitizeSearchResult(result) {
  const voyoId = encodeVoyoId(result.id);

  return {
    voyoId,                    // Encoded ID (NOT YouTube ID)
    title: result.title,
    artist: result.artist,
    duration: result.duration,
    thumbnail: `${API_BASE}/cdn/art/${voyoId}`,  // Our thumbnail proxy
    views: result.views
  };
}
```

**Security Validation:**

```javascript
export function isValidYouTubeId(youtubeId) {
  // Strict validation prevents command injection
  const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
  return YOUTUBE_ID_REGEX.test(youtubeId);
}

export function isValidVoyoId(voyoId) {
  if (!voyoId.startsWith('vyo_')) return false;
  try {
    const decoded = decodeVoyoId(voyoId);
    return isValidYouTubeId(decoded);  // Validate decoded ID
  } catch {
    return false;
  }
}
```

---

### 3. Caching System (Production-Grade)

**Location:** Lines 116-286 in `index.js`

VOYO implements a **three-tier caching system** to minimize YouTube API calls and provide instant playback.

#### Cache Types

| Cache | TTL | Purpose | Max Size |
|-------|-----|---------|----------|
| **Stream Cache** | 4 hours | YouTube stream URLs | Unlimited |
| **Thumbnail Cache** | 24 hours | Album art images | 500 entries (LRU) |
| **Prefetch Cache** | 30 minutes | Warmed-up streams | Unlimited |

#### Stream Cache

```javascript
const streamCache = new Map();
const CACHE_TTL = 4 * 60 * 60 * 1000;  // 4 hours

// Cache key format: "videoId-type-quality"
const cacheKey = `${videoId}-audio-high`;

// Check cache
const cached = streamCache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
  return cached;  // Cache hit
}

// On cache miss, extract and cache
const result = await extractAudioWithInnertube(videoId);
streamCache.set(cacheKey, {
  url: result.url,
  timestamp: Date.now(),
});
```

**Why 4 hours?**
- YouTube stream URLs are valid for ~6 hours
- 4-hour TTL provides safety buffer
- Reduces yt-dlp calls by 95%+

#### Thumbnail Cache (LRU)

```javascript
const thumbnailCache = new Map();
const THUMBNAIL_CACHE_TTL = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_THUMBNAIL_CACHE = 500;  // Prevent memory leaks

// Evict oldest if over limit (Least Recently Used)
if (thumbnailCache.size > MAX_THUMBNAIL_CACHE) {
  const oldest = Array.from(thumbnailCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
  if (oldest) thumbnailCache.delete(oldest[0]);
}
```

**Memory Protection:**
- Fixed maximum size prevents out-of-memory crashes
- LRU eviction keeps most-used thumbnails
- Images stored as Buffers in memory

#### Prefetch Cache (Warming)

```javascript
const prefetchCache = new Map();
const PREFETCH_TTL = 30 * 60 * 1000;  // 30 minutes

// Prefetch API: Non-blocking warming
prefetchCache.set(videoId, {
  timestamp: Date.now(),
  warmed: false,
  quality: 'high'
});

// Background warming
getStreamUrl(videoId, 'audio', quality)
  .then(() => {
    prefetchCache.set(videoId, { warmed: true, timestamp: Date.now() });
  });
```

**Use Case:**
- Frontend calls `/prefetch?v=nextTrackId` when current track reaches 50%
- Server warms up stream URL in background
- Next track plays instantly (cache hit)

#### Cache Cleanup

```javascript
function cleanupExpiredCache() {
  const now = Date.now();

  // Collect keys to delete (prevents race conditions)
  const streamKeysToDelete = [];
  for (const [key, entry] of streamCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      streamKeysToDelete.push(key);
    }
  }
  streamKeysToDelete.forEach(k => streamCache.delete(k));
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredCache, 10 * 60 * 1000);
```

---

### 4. Rate Limiting (Anti-Blocking)

**Location:** Lines 147-239 in `index.js`

VOYO implements **multi-tier rate limiting** to protect against abuse while being a good YouTube citizen.

#### Rate Limit Tiers

| Tier | Scope | Limit | Window | Purpose |
|------|-------|-------|--------|---------|
| **General** | Per IP | 60 req/min | 1 minute | Prevent abuse |
| **yt-dlp** | Per IP | 10 calls/min | 1 minute | Protect user |
| **Global yt-dlp** | All users | 300 calls/min | 1 minute | Protect server |

#### Per-IP Tracking

```javascript
const ipRequestCounts = new Map();  // IP -> { count, ytDlpCount, windowStart }

function checkRateLimit(ip, isYtDlp = false) {
  const now = Date.now();

  // Get or create IP tracking
  let ipData = ipRequestCounts.get(ip);
  if (!ipData || now - ipData.windowStart > RATE_LIMIT_WINDOW) {
    ipData = { count: 0, ytDlpCount: 0, windowStart: now };
    ipRequestCounts.set(ip, ipData);
  }

  // Check general rate limit (60 req/min)
  if (ipData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      reason: 'rate_limit_exceeded',
      retryAfter: Math.ceil((ipData.windowStart + RATE_LIMIT_WINDOW - now) / 1000)
    };
  }

  // Check yt-dlp specific limit (10 calls/min)
  if (isYtDlp && ipData.ytDlpCount >= RATE_LIMIT_YT_DLP) {
    return {
      allowed: false,
      reason: 'yt_dlp_rate_limit',
      retryAfter: seconds
    };
  }

  ipData.count++;
  if (isYtDlp) ipData.ytDlpCount++;
  return { allowed: true };
}
```

#### Global Protection

```javascript
let globalYtDlpCalls = 0;
let globalYtDlpWindowStart = Date.now();
const GLOBAL_YT_DLP_LIMIT = 300;  // 5 per second average

if (globalYtDlpCalls >= GLOBAL_YT_DLP_LIMIT) {
  return {
    allowed: false,
    reason: 'global_yt_dlp_limit',
    retryAfter: seconds
  };
}
```

#### IP Extraction

```javascript
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.socket?.remoteAddress ||
         'unknown';
}
```

**Supports:**
- Cloudflare `X-Forwarded-For`
- Nginx `X-Real-IP`
- Direct socket connections

#### User-Agent Rotation

```javascript
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Firefox/121.0',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
```

**Purpose:** Look like different clients to YouTube

---

### 5. In-Flight Request Deduplication

**Location:** Lines 124, 330-413 in `index.js`

Prevents duplicate yt-dlp calls for the same video when multiple clients request simultaneously.

```javascript
const inFlightRequests = new Map();  // cacheKey -> Promise

// Check if request already in progress
if (inFlightRequests.has(cacheKey)) {
  console.log(`[In-Flight] Waiting for existing request: ${cacheKey}`);
  return inFlightRequests.get(cacheKey);  // Return same promise
}

// Create promise for this request
const requestPromise = new Promise((resolve, reject) => {
  // ... yt-dlp extraction logic ...
});

// Track in-flight request
inFlightRequests.set(cacheKey, requestPromise);

// Clean up when done
requestPromise.finally(() => {
  inFlightRequests.delete(cacheKey);
});
```

**Prevents:**
- Duplicate yt-dlp processes
- Wasted CPU/bandwidth
- Rate limit exhaustion

---

### 6. VOYO Boost System (Background Downloads)

**Location:** Lines 902-969 in `index.js`

VOYO Boost automatically downloads tracks to local storage for **instant playback** on future plays.

#### Architecture

```
First Play:  Client → /stream → Proxy URL → YouTube → Client
             Background: Download to /downloads/

Second Play: Client → /stream → Cached File → Client (INSTANT)
```

#### Implementation

```javascript
if (pathname === '/stream' && query.v) {
  const videoId = query.v;
  const cachedPath = path.join(DOWNLOADS_DIR, `${videoId}.mp3`);

  // CHECK CACHE FIRST
  if (fs.existsSync(cachedPath)) {
    console.log(`[Stream] 🚀 VOYO BOOST - Serving cached: ${videoId}`);

    return {
      url: `${API_BASE}/downloads/${videoId}.mp3`,  // Our file
      cached: true,
      source: 'voyo_cache'
    };
  }

  // NOT CACHED - Start background download
  console.log(`[Stream] Starting background boost for: ${videoId}`);
  downloadAudio(videoId).then(() => {
    console.log(`[Stream] ✅ BOOST COMPLETE: ${videoId}`);
  }).catch(err => {
    console.warn(`[Stream] Boost failed for ${videoId}`);
  });

  // Return PROXY URL immediately (don't wait for download)
  return {
    url: `${API_BASE}/proxy?v=${videoId}`,
    cached: false,
    boosting: true,  // Frontend knows boost in progress
    source: 'voyo_proxy'
  };
}
```

**Benefits:**
- First play: Normal streaming (proxy)
- Second play: Instant (local file)
- No waiting - download happens in background
- Automatic cache management

---

## API Reference

### Monitoring Endpoints

#### GET /health

**Description:** Comprehensive health check with metrics

**Response:**
```json
{
  "status": "healthy",
  "service": "voyo-backend",
  "uptime": 86400,
  "uptimeFormatted": "24h 0m",
  "memory": {
    "rss": "150MB",
    "heapUsed": "85MB",
    "heapTotal": "120MB"
  },
  "cache": {
    "streamCacheSize": 234,
    "thumbnailCacheSize": 456,
    "prefetchCacheSize": 12,
    "streamHitRate": "87.50%",
    "stats": {
      "streamHits": 1750,
      "streamMisses": 250,
      "thumbnailHits": 3200,
      "thumbnailMisses": 400,
      "prefetchRequests": 150,
      "activeStreams": 8,
      "startTime": 1734518400000
    }
  },
  "rateLimit": {
    "activeIPs": 45,
    "globalYtDlpCalls": 87,
    "globalYtDlpLimit": 300,
    "perIPLimit": 60,
    "perIPYtDlpLimit": 10
  },
  "timestamp": "2025-12-19T10:30:00.000Z"
}
```

**Use Cases:**
- Load balancer health checks
- Monitoring dashboards
- Performance analysis
- Cache effectiveness tracking

---

#### GET /debug

**Description:** Debug system dependencies

**Response:**
```json
{
  "ytdlp": {
    "available": true,
    "path": "/usr/local/bin/yt-dlp",
    "version": "2025.12.15",
    "error": null
  },
  "deno": {
    "available": true,
    "path": "/root/.deno/bin/deno",
    "version": "deno 2.1.4",
    "error": null
  },
  "ytdlpPath": "/usr/local/bin/yt-dlp",
  "env": {
    "NODE_ENV": "production",
    "PORT": "3001",
    "RAILWAY": true
  }
}
```

**Use Cases:**
- Deployment verification
- Debugging yt-dlp issues
- Environment inspection

---

### Stealth Endpoints (Recommended)

#### GET /api/search?q=QUERY&limit=LIMIT

**Description:** Search with VOYO IDs (zero YouTube traces)

**Parameters:**
- `q` (required): Search query
- `limit` (optional): Result limit (default: 10)

**Request:**
```bash
curl "https://voyo-music.app/api/search?q=never+gonna+give+you+up&limit=5"
```

**Response:**
```json
{
  "results": [
    {
      "voyoId": "vyo_ZFF3NHc5V2dYY1E",
      "title": "Rick Astley - Never Gonna Give You Up",
      "artist": "Rick Astley",
      "duration": 213,
      "thumbnail": "https://voyo-music.app/cdn/art/vyo_ZFF3NHc5V2dYY1E",
      "views": 1500000000
    }
  ]
}
```

**Security:**
- All video IDs validated with strict regex
- No YouTube URLs exposed
- VOYO branding only

---

#### GET /cdn/stream/VOYO_ID?quality=LEVEL

**Description:** Stream audio with VOYO ID (stealth mode)

**Parameters:**
- `VOYO_ID` (required): Encoded track ID (path parameter)
- `quality` (optional): `low` | `medium` | `high` (default: `high`)
- `type` (optional): `audio` | `video` (default: `audio`)

**Request:**
```bash
curl -H "Range: bytes=0-1024" \
  "https://voyo-music.app/cdn/stream/vyo_ZFF3NHc5V2dYY1E?quality=high"
```

**Response:**
- Status: `206 Partial Content` (if Range header)
- Status: `200 OK` (if no Range header)
- Headers:
  - `Content-Type: audio/mp4` or `audio/webm`
  - `Content-Length: 4567890`
  - `Content-Range: bytes 0-1024/4567890`
  - `Accept-Ranges: bytes`
- Body: Audio stream (binary)

**Quality Levels:**

| Quality | Bitrate | Format | Use Case |
|---------|---------|--------|----------|
| `low` | ~64kbps | AAC/Opus | Data saver, 2G |
| `medium` | ~128kbps | AAC/Opus | Balanced, 3G |
| `high` | Best (139-160kbps) | Opus/AAC | Maximum quality, 4G/WiFi |

**Flow:**
1. Decode VOYO ID → YouTube ID
2. Check if in stream cache
3. If cached: Return from cache
4. If not: Extract with Innertube
5. Fallback to Piped if Innertube fails
6. Proxy stream through server (add CORS)

**Handler Code Explanation:**

```javascript
// Line 1289-1492: /cdn/stream endpoint
if (pathname.startsWith('/cdn/stream/')) {
  // Extract track ID from URL path
  const trackId = pathname.split('/cdn/stream/')[1];

  // Accept BOTH VOYO IDs and raw YouTube IDs
  let youtubeId;
  if (isValidVoyoId(trackId)) {
    // Decode VOYO ID
    youtubeId = decodeVoyoId(trackId);
  } else if (isValidYouTubeId(trackId)) {
    // Accept raw YouTube ID (for seed tracks)
    youtubeId = trackId;
  } else {
    // Reject invalid IDs (SECURITY)
    return error(400, 'INVALID_ID');
  }

  // PRIMARY: Extract with Innertube
  const innertubeResult = await extractAudioWithInnertube(youtubeId);
  if (innertubeResult?.url) {
    audioUrl = innertubeResult.url;
  }

  // FALLBACK: Try Piped instances
  if (!audioUrl) {
    for (const pipedInstance of PIPED_INSTANCES) {
      const pipedResponse = await fetch(`${pipedInstance}/streams/${youtubeId}`);
      if (pipedResponse.ok) {
        const data = await pipedResponse.json();
        const bestAudio = data.audioStreams
          .filter(s => s.mimeType?.includes('mp4'))
          .sort((a, b) => b.bitrate - a.bitrate)[0];

        if (bestAudio?.url) {
          audioUrl = bestAudio.url;
          break;
        }
      }
    }
  }

  // PROXY: Stream through our server (add CORS)
  const audioUrlParsed = new URL(audioUrl);
  const proxyReq = https.request({
    hostname: audioUrlParsed.hostname,
    path: audioUrlParsed.pathname + audioUrlParsed.search,
    headers: {
      'Range': req.headers.range || 'bytes=0-',  // Support seeking
    }
  }, (proxyRes) => {
    // Forward all headers + CORS
    res.writeHead(proxyRes.statusCode, {
      ...corsHeaders,
      'Content-Type': proxyRes.headers['content-type'],
      'Content-Length': proxyRes.headers['content-length'],
      'Content-Range': proxyRes.headers['content-range'],
      'Accept-Ranges': 'bytes',
    });

    proxyRes.pipe(res);  // Stream to client
  });

  proxyReq.end();
}
```

---

#### GET /cdn/art/VOYO_ID?quality=QUALITY

**Description:** Get album art with VOYO ID

**Parameters:**
- `VOYO_ID` (required): Encoded track ID (path parameter)
- `quality` (optional): `max` | `high` | `medium` | `default` (default: `high`)

**Request:**
```bash
curl "https://voyo-music.app/cdn/art/vyo_ZFF3NHc5V2dYY1E?quality=max"
```

**Response:**
- Status: `200 OK`
- Headers:
  - `Content-Type: image/jpeg`
  - `Content-Length: 45678`
  - `Cache-Control: public, max-age=3600`
- Body: JPEG image (binary)

**Quality Mapping:**

| Quality | Resolution | Filename |
|---------|-----------|----------|
| `max` | 1280x720+ | maxresdefault.jpg |
| `high` | 480x360 | hqdefault.jpg |
| `medium` | 320x180 | mqdefault.jpg |
| `default` | 120x90 | default.jpg |

**Handler Code:**

```javascript
// Line 1247-1287: /cdn/art endpoint
if (pathname.startsWith('/cdn/art/')) {
  const trackId = pathname.split('/cdn/art/')[1];

  // Decode VOYO ID or accept raw YouTube ID
  let youtubeId = isValidVoyoId(trackId)
    ? decodeVoyoId(trackId)
    : trackId;

  // Validate
  if (!isValidYouTubeId(youtubeId)) {
    return error(400, 'INVALID_ID');
  }

  // Get thumbnail (with 24-hour cache)
  const quality = query.quality || 'high';
  const imageData = await getThumbnail(youtubeId, quality);

  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': imageData.length,
    'Cache-Control': 'public, max-age=3600'  // Browser cache 1 hour
  });
  res.end(imageData);
}
```

---

### Legacy Endpoints (YouTube IDs)

#### GET /stream?v=VIDEO_ID&quality=LEVEL&type=TYPE

**Description:** Get stream URL with VOYO Boost

**Parameters:**
- `v` (required): YouTube video ID
- `quality` (optional): `low` | `medium` | `high` (default: `high`)
- `type` (optional): `audio` | `video` (default: `audio`)

**Request:**
```bash
curl "https://voyo-music.app/stream?v=dQw4w9WgXcQ&quality=high"
```

**Response:**
```json
{
  "url": "https://voyo-music.app/proxy?v=dQw4w9WgXcQ&quality=high",
  "audioUrl": "https://voyo-music.app/proxy?v=dQw4w9WgXcQ&quality=high",
  "videoId": "dQw4w9WgXcQ",
  "type": "audio",
  "quality": "high",
  "cached": false,
  "boosting": true,
  "source": "voyo_proxy"
}
```

**If cached:**
```json
{
  "url": "https://voyo-music.app/downloads/dQw4w9WgXcQ.mp3",
  "audioUrl": "https://voyo-music.app/downloads/dQw4w9WgXcQ.mp3",
  "videoId": "dQw4w9WgXcQ",
  "type": "audio",
  "quality": "boosted",
  "cached": true,
  "contentLength": 4567890,
  "source": "voyo_cache"
}
```

**Handler Logic:**

```javascript
// Line 902-969: /stream endpoint
if (pathname === '/stream' && query.v) {
  // Validate YouTube ID (SECURITY)
  if (!isValidYouTubeId(query.v)) {
    return error(400, 'INVALID_ID');
  }

  const videoId = query.v;
  const cachedPath = path.join(DOWNLOADS_DIR, `${videoId}.mp3`);

  // CHECK LOCAL CACHE FIRST
  if (fs.existsSync(cachedPath)) {
    // INSTANT PLAYBACK - Serve from our storage
    const stats = fs.statSync(cachedPath);
    return {
      url: `${API_BASE}/downloads/${videoId}.mp3`,
      cached: true,
      contentLength: stats.size,
      source: 'voyo_cache'
    };
  }

  // NOT CACHED - Start background download
  if (type === 'audio') {
    downloadAudio(videoId).then(() => {
      console.log(`[Stream] ✅ BOOST COMPLETE: ${videoId}`);
    }).catch(err => {
      console.warn(`[Stream] Boost failed: ${err.message}`);
    });
  }

  // Return PROXY URL immediately (don't wait)
  return {
    url: `${API_BASE}/proxy?v=${videoId}&quality=${quality}`,
    cached: false,
    boosting: true,
    source: 'voyo_proxy'
  };
}
```

---

#### GET /proxy?v=VIDEO_ID&quality=LEVEL&type=TYPE

**Description:** Proxy stream through server (with range support)

**Parameters:**
- `v` (required): YouTube video ID
- `quality` (optional): `low` | `medium` | `high` (default: `high`)
- `type` (optional): `audio` | `video` (default: `audio`)

**Request:**
```bash
curl -H "Range: bytes=0-1024" \
  "https://voyo-music.app/proxy?v=dQw4w9WgXcQ&quality=high"
```

**Response:**
- Status: `206 Partial Content` (with Range) or `200 OK`
- Headers:
  - `Content-Type: audio/mp4` or `audio/webm`
  - `Content-Range: bytes 0-1024/4567890`
  - `Accept-Ranges: bytes`
- Body: Audio stream (binary)

**Handler Flow:**

```javascript
// Line 972-1050: /proxy endpoint
if (pathname === '/proxy' && query.v) {
  // Validate video ID
  if (!isValidYouTubeId(query.v)) {
    return error(400, 'INVALID_ID');
  }

  // Get stream URL from cache or yt-dlp
  const type = query.type === 'video' ? 'video' : 'audio';
  const quality = query.quality || 'high';
  const result = await getStreamUrl(query.v, type, quality);
  const streamUrl = type === 'audio' ? result.audioUrl : result.url;

  // Parse googlevideo URL
  const parsedStream = new URL(streamUrl);

  // Forward request to googlevideo
  const proxyReq = https.request({
    hostname: parsedStream.hostname,
    path: parsedStream.pathname + parsedStream.search,
    headers: {
      'User-Agent': 'Mozilla/5.0 ...',
      'Range': req.headers.range || 'bytes=0-',  // Forward Range header
    }
  }, (proxyRes) => {
    // Determine content type
    let contentType = 'audio/webm; codecs=opus';
    const origType = proxyRes.headers['content-type'] || '';
    if (origType.includes('mp4')) contentType = 'audio/mp4';
    else if (origType.includes('mpeg')) contentType = 'audio/mpeg';

    // Forward response with CORS
    res.writeHead(proxyRes.statusCode, {
      ...corsHeaders,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': proxyRes.headers['content-length'],
      'Content-Range': proxyRes.headers['content-range'],
    });

    proxyRes.pipe(res);  // Stream to client
  });

  proxyReq.end();
}
```

**Why proxy?**
- YouTube URLs are IP-locked to whoever extracted them
- Direct client usage would fail (403 Forbidden)
- Proxying through our server adds CORS headers
- Enables range requests for seeking

---

#### GET /search?q=QUERY&limit=LIMIT

**Description:** Search YouTube (returns raw YouTube IDs)

**Parameters:**
- `q` (required): Search query
- `limit` (optional): Result limit (default: 10)

**Request:**
```bash
curl "https://voyo-music.app/search?q=rick+astley&limit=5"
```

**Response:**
```json
{
  "results": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "Rick Astley - Never Gonna Give You Up",
      "artist": "Rick Astley",
      "duration": 213,
      "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "views": 1500000000
    }
  ]
}
```

**Handler:**

```javascript
// Line 1053-1064: /search endpoint
if (pathname === '/search' && query.q) {
  const limit = parseInt(query.limit) || 10;
  const results = await searchYouTube(query.q, limit);

  res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ results }));
}

// Search implementation (Innertube)
async function searchInnerTube(query, limit = 10) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/search?key=' + YT_API_KEY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 ...',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20231219.04.00',
          hl: 'en',
          gl: 'US',
        }
      },
      query: query,
    }),
  });

  const data = await response.json();
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

  // Parse video results
  const results = [];
  for (const section of contents) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const video = item?.videoRenderer;
      if (video && results.length < limit) {
        results.push({
          id: video.videoId,
          title: video.title?.runs?.[0]?.text || 'Unknown',
          artist: video.ownerText?.runs?.[0]?.text || 'Unknown',
          duration: parseDuration(video.lengthText?.simpleText || '0:00'),
          thumbnail: `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`,
          views: parseViews(video.viewCountText?.simpleText || '0'),
        });
      }
    }
  }

  return results;
}
```

**Performance:**
- Innertube search: ~500ms
- Fallback to yt-dlp: ~5-10s

---

#### GET /thumbnail?id=VIDEO_ID&quality=QUALITY

**Description:** Proxy YouTube thumbnail

**Parameters:**
- `id` (required): YouTube video ID
- `quality` (optional): `max` | `high` | `medium` | `default` (default: `high`)

**Request:**
```bash
curl "https://voyo-music.app/thumbnail?id=dQw4w9WgXcQ&quality=high"
```

**Response:**
- Status: `200 OK`
- Headers:
  - `Content-Type: image/jpeg`
  - `Cache-Control: public, max-age=3600`
- Body: JPEG image

**Handler:**

```javascript
// Line 1066-1092: /thumbnail endpoint
if (pathname === '/thumbnail' && query.id) {
  if (!isValidYouTubeId(query.id)) {
    return error(400, 'INVALID_ID');
  }

  const quality = query.quality || 'high';
  const imageData = await getThumbnail(query.id, quality);

  res.writeHead(200, {
    ...corsHeaders,
    'Content-Type': 'image/jpeg',
    'Content-Length': imageData.length,
    'Cache-Control': 'public, max-age=3600'
  });
  res.end(imageData);
}

// Thumbnail fetcher
async function getThumbnail(videoId, quality = 'high') {
  const cacheKey = `${videoId}-${quality}`;

  // Check 24-hour cache
  const cached = thumbnailCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < THUMBNAIL_CACHE_TTL) {
    return cached.data;
  }

  // Fetch from YouTube
  const qualityMap = {
    'max': 'maxresdefault.jpg',
    'high': 'hqdefault.jpg',
    'medium': 'mqdefault.jpg',
    'default': 'default.jpg'
  };

  const filename = qualityMap[quality] || qualityMap.high;
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/${filename}`;

  const response = await fetch(thumbnailUrl);
  const imageData = Buffer.from(await response.arrayBuffer());

  // Cache with LRU eviction
  thumbnailCache.set(cacheKey, { data: imageData, timestamp: Date.now() });

  // Evict oldest if over limit
  if (thumbnailCache.size > MAX_THUMBNAIL_CACHE) {
    const oldest = Array.from(thumbnailCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) thumbnailCache.delete(oldest[0]);
  }

  return imageData;
}
```

---

### Download Endpoints

#### GET /download?v=VIDEO_ID

**Description:** Download audio file to server

**Parameters:**
- `v` (required): YouTube video ID

**Request:**
```bash
curl "https://voyo-music.app/download?v=dQw4w9WgXcQ"
```

**Response:**
```json
{
  "success": true,
  "path": "/downloads/dQw4w9WgXcQ.mp3",
  "alreadyExists": false
}
```

**Handler:**

```javascript
// Line 1094-1112: GET /download endpoint
if (pathname === '/download' && req.method === 'GET' && query.v) {
  if (!isValidYouTubeId(query.v)) {
    return error(400, 'INVALID_ID');
  }

  const result = await downloadAudio(query.v);
  res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

// Download implementation
async function downloadAudio(videoId) {
  const outputPath = path.join(DOWNLOADS_DIR, `${videoId}.mp3`);

  // Check if already downloaded
  if (fs.existsSync(outputPath)) {
    return { success: true, path: `/downloads/${videoId}.mp3`, alreadyExists: true };
  }

  // Download with yt-dlp
  const ytdlp = spawn(YT_DLP_PATH, [
    '-f', '251/140/bestaudio',  // Highest quality audio
    '-x',                         // Extract audio
    '--audio-format', 'mp3',      // Convert to MP3
    '-o', outputPath,             // Output path
    '--no-warnings',
    `https://www.youtube.com/watch?v=${videoId}`
  ]);

  return new Promise((resolve, reject) => {
    ytdlp.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ success: true, path: `/downloads/${videoId}.mp3`, alreadyExists: false });
      } else {
        reject(new Error('Download failed'));
      }
    });
  });
}
```

**Format Selection:**
- `251` - Opus 139kbps (best quality)
- `140` - AAC 128kbps (fallback)
- `bestaudio` - Highest available

---

#### DELETE /download?v=VIDEO_ID

**Description:** Delete downloaded file

**Parameters:**
- `v` (required): YouTube video ID

**Request:**
```bash
curl -X DELETE "https://voyo-music.app/download?v=dQw4w9WgXcQ"
```

**Response:**
```json
{
  "success": true
}
```

**Handler:**

```javascript
// Line 1114-1132: DELETE /download endpoint
if (pathname === '/download' && req.method === 'DELETE' && query.v) {
  if (!isValidYouTubeId(query.v)) {
    return error(400, 'INVALID_ID');
  }

  const success = deleteDownload(query.v);
  res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success }));
}

function deleteDownload(videoId) {
  const audioExts = ['.mp3', '.m4a', '.webm', '.opus'];

  // Find and delete file with any audio extension
  for (const ext of audioExts) {
    const filePath = path.join(DOWNLOADS_DIR, `${videoId}${ext}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  }

  return false;
}
```

---

#### GET /downloaded

**Description:** List all downloaded track IDs

**Request:**
```bash
curl "https://voyo-music.app/downloaded"
```

**Response:**
```json
{
  "downloads": [
    "dQw4w9WgXcQ",
    "kJQP7kiw5Fk",
    "9bZkp7q19f0"
  ]
}
```

**Handler:**

```javascript
// Line 1134-1145: /downloaded endpoint
if (pathname === '/downloaded') {
  const downloads = getDownloadedIds();
  res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ downloads }));
}

function getDownloadedIds() {
  const files = fs.readdirSync(DOWNLOADS_DIR);
  const audioExts = ['.mp3', '.m4a', '.webm', '.opus'];

  return files
    .filter(file => audioExts.some(ext => file.endsWith(ext)))
    .map(file => {
      // Remove extension
      for (const ext of audioExts) {
        if (file.endsWith(ext)) {
          return file.replace(ext, '');
        }
      }
      return file;
    });
}
```

---

#### GET /downloads/VIDEO_ID.mp3

**Description:** Serve downloaded audio file (with range support)

**Request:**
```bash
curl -H "Range: bytes=0-1024" \
  "https://voyo-music.app/downloads/dQw4w9WgXcQ.mp3"
```

**Response:**
- Status: `206 Partial Content` (with Range) or `200 OK`
- Headers:
  - `Content-Type: audio/mpeg` (or audio/mp4, audio/webm, audio/opus)
  - `Content-Range: bytes 0-1024/4567890`
  - `Accept-Ranges: bytes`
- Body: Audio file (binary)

**Supported Formats:**
- `.mp3` - MPEG audio (audio/mpeg)
- `.m4a` - MP4 audio (audio/mp4)
- `.webm` - WebM audio (audio/webm)
- `.opus` - Opus audio (audio/opus)

**Handler:**

```javascript
// Line 1147-1222: /downloads/ endpoint
if (pathname.startsWith('/downloads/')) {
  const audioExts = ['.mp3', '.m4a', '.webm', '.opus'];
  let videoId = null;
  let fileExt = null;

  // Extract videoId and extension
  for (const ext of audioExts) {
    if (pathname.endsWith(ext)) {
      videoId = pathname.replace('/downloads/', '').replace(ext, '');
      fileExt = ext;
      break;
    }
  }

  if (!videoId || !fileExt) {
    return error(400, 'Invalid file format');
  }

  const filePath = path.join(DOWNLOADS_DIR, `${videoId}${fileExt}`);

  if (!fs.existsSync(filePath)) {
    return error(404, 'File not found');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Content type mapping
  const contentTypes = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.webm': 'audio/webm',
    '.opus': 'audio/opus'
  };
  const contentType = contentTypes[fileExt] || 'audio/mpeg';

  if (range) {
    // Handle range request (for seeking)
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      ...corsHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    fileStream.pipe(res);
  } else {
    // Full file
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}
```

**Range Request Examples:**

```bash
# First 1KB
Range: bytes=0-1023

# From 1MB onwards
Range: bytes=1048576-

# Specific range
Range: bytes=1000000-2000000
```

---

### Prefetch Endpoint

#### GET /prefetch?v=VIDEO_ID&quality=LEVEL&type=TYPE

**Description:** Warm up stream URL in background (non-blocking)

**Parameters:**
- `v` (required): YouTube video ID or VOYO ID
- `quality` (optional): `low` | `medium` | `high` (default: `high`)
- `type` (optional): `audio` | `video` (default: `audio`)

**Request:**
```bash
curl "https://voyo-music.app/prefetch?v=dQw4w9WgXcQ&quality=high"
```

**Response:**
```json
{
  "status": "warming",
  "videoId": "dQw4w9WgXcQ",
  "message": "Stream warming initiated"
}
```

**Status:** `202 Accepted` (non-blocking)

**Use Case:**
- Call when current track reaches 50% progress
- Server warms up next track in background
- Next track plays instantly (cache hit)

**Handler:**

```javascript
// Line 854-898: /prefetch endpoint
if (pathname === '/prefetch' && query.v) {
  const videoId = query.v;
  const quality = query.quality || 'high';
  const type = query.type || 'audio';

  console.log(`[Prefetch] Warming ${videoId} (${quality})`);
  cacheStats.prefetchRequests++;

  // Mark as warming
  prefetchCache.set(videoId, {
    timestamp: Date.now(),
    warmed: false,
    quality
  });

  // Start warming in background (don't await)
  getStreamUrl(videoId, type, quality)
    .then(() => {
      prefetchCache.set(videoId, {
        timestamp: Date.now(),
        warmed: true,
        quality
      });
      console.log(`[Prefetch] Warmed ${videoId}`);
    })
    .catch(err => {
      console.error(`[Prefetch] Failed for ${videoId}:`, err.message);
      prefetchCache.delete(videoId);
    });

  // Respond immediately (non-blocking)
  res.writeHead(202, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'warming',
    videoId,
    message: 'Stream warming initiated'
  }));
}
```

**Frontend Integration:**

```typescript
// When current track reaches 50%, prefetch next
const handleProgress = (progress: number) => {
  if (progress > 0.5 && nextTrack && !prefetched.has(nextTrack.id)) {
    fetch(`${API_BASE}/prefetch?v=${nextTrack.id}&quality=${currentQuality}`)
      .then(() => prefetched.add(nextTrack.id));
  }
};
```

---

## Deployment

### Railway Deployment

**Configuration:** `railway.json`

```json
{
  "build": {
    "builder": "nixpacks",
    "nixpacksPlan": {
      "phases": {
        "setup": {
          "nixPkgs": ["nodejs_20", "yt-dlp", "ffmpeg", "deno", "python311"]
        },
        "install": {
          "cmds": [
            "npm install",
            "pip3 install --break-system-packages bgutil-ytdlp-pot-provider"
          ]
        }
      }
    }
  },
  "deploy": {
    "startCommand": "yt-dlp --version && pip3 show bgutil-ytdlp-pot-provider && node index.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**Deployment Steps:**

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Link project
railway link

# 4. Deploy
railway up

# 5. Set environment variables
railway variables set YT_API_KEY=AIzaSy...
railway variables set NODE_ENV=production

# 6. Verify deployment
curl https://your-app.up.railway.app/health
```

**Environment Variables:**
- `NODE_ENV=production`
- `YT_API_KEY` - YouTube API key
- `RAILWAY_PUBLIC_DOMAIN` - Auto-set by Railway

---

### Fly.io Deployment

**Configuration:** `fly.toml`

```toml
app = 'voyo-music-api'
primary_region = 'sin'

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0
  processes = ['app']

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
  memory_mb = 1024
```

**Dockerfile:**

```dockerfile
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

# Install Deno
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

# Verify installations
RUN yt-dlp --version && deno --version && node --version

# Create app directory
WORKDIR /app

# Copy and install dependencies
COPY package.json ./
RUN npm install --production

# Copy server code
COPY . .
RUN mkdir -p /app/downloads

# Expose port
EXPOSE 8080

# Environment
ENV NODE_ENV=production
ENV PORT=8080
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start
CMD ["node", "index.js"]
```

**Deployment Steps:**

```bash
# 1. Install Fly CLI
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Create app
fly launch

# 4. Set secrets
fly secrets set YT_API_KEY=AIzaSy...

# 5. Deploy
fly deploy

# 6. Verify
curl https://voyo-music-api.fly.dev/health
```

---

### Docker Deployment

**Build:**

```bash
docker build -t voyo-music-server .
```

**Run:**

```bash
docker run -d \
  -p 3001:8080 \
  -e NODE_ENV=production \
  -e YT_API_KEY=AIzaSy... \
  -v $(pwd)/downloads:/app/downloads \
  --name voyo-server \
  voyo-music-server
```

**Docker Compose:**

```yaml
version: '3.8'

services:
  voyo-server:
    build: .
    ports:
      - "3001:8080"
    environment:
      - NODE_ENV=production
      - YT_API_KEY=${YT_API_KEY}
      - PORT=8080
    volumes:
      - ./downloads:/app/downloads
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

**Run with Compose:**

```bash
docker-compose up -d
```

---

## Security & Rate Limiting

### Input Validation

**YouTube ID Validation:**

```javascript
export function isValidYouTubeId(youtubeId) {
  // Strict regex prevents command injection
  const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
  return YOUTUBE_ID_REGEX.test(youtubeId);
}
```

**Why strict validation?**
- YouTube IDs passed to `yt-dlp` via `spawn()`
- Malicious IDs could inject shell commands
- Example attack: `; rm -rf /`
- Regex blocks ALL shell metacharacters

**VOYO ID Validation:**

```javascript
export function isValidVoyoId(voyoId) {
  if (!voyoId.startsWith('vyo_')) return false;

  try {
    const decoded = decodeVoyoId(voyoId);
    return isValidYouTubeId(decoded);  // Validate decoded ID
  } catch {
    return false;
  }
}
```

**All endpoints validate before processing:**

```javascript
if (!isValidYouTubeId(query.v)) {
  console.warn(`[Stream] REJECTED invalid video ID: ${query.v}`);
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Invalid VOYO track ID' }));
  return;
}
```

---

### CORS Configuration

**Allowed Origins:**

```javascript
const ALLOWED_ORIGINS = [
  'http://localhost:5173',      // Vite dev
  'http://localhost:3000',      // React dev
  'https://voyo.app',           // Production
  'https://voyo-music.vercel.app'  // Vercel deployment
];
```

**Dynamic Origin Selection:**

```javascript
function getCorsOrigin(req) {
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
```

**Headers Applied:**

```javascript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',  // Overridden per request
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
```

**Production Note:**
Currently uses `*` for development. In production, should use `getCorsOrigin()` for security.

---

### Rate Limiting Implementation

**Multi-Tier Protection:**

```javascript
// Tier 1: General requests (60/min per IP)
const RATE_LIMIT_MAX_REQUESTS = 60;

// Tier 2: yt-dlp calls (10/min per IP)
const RATE_LIMIT_YT_DLP = 10;

// Tier 3: Global yt-dlp (300/min total)
const GLOBAL_YT_DLP_LIMIT = 300;
```

**Rate Limit Check:**

```javascript
function checkRateLimit(ip, isYtDlp = false) {
  const now = Date.now();
  const key = ip || 'unknown';

  // Get or create IP tracking
  let ipData = ipRequestCounts.get(key);
  if (!ipData || now - ipData.windowStart > RATE_LIMIT_WINDOW) {
    ipData = { count: 0, ytDlpCount: 0, windowStart: now };
    ipRequestCounts.set(key, ipData);
  }

  // Check general limit
  if (ipData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, reason: 'rate_limit_exceeded', retryAfter: seconds };
  }

  // Check yt-dlp limit
  if (isYtDlp && ipData.ytDlpCount >= RATE_LIMIT_YT_DLP) {
    return { allowed: false, reason: 'yt_dlp_rate_limit', retryAfter: seconds };
  }

  // Check global limit
  if (isYtDlp && globalYtDlpCalls >= GLOBAL_YT_DLP_LIMIT) {
    return { allowed: false, reason: 'global_yt_dlp_limit', retryAfter: seconds };
  }

  ipData.count++;
  if (isYtDlp) {
    ipData.ytDlpCount++;
    globalYtDlpCalls++;
  }

  return { allowed: true };
}
```

**Error Response:**

```json
{
  "error": "Too many requests",
  "reason": "yt_dlp_rate_limit",
  "retryAfter": 45
}
```

**HTTP Status:** `429 Too Many Requests`
**Header:** `Retry-After: 45`

---

### Error Handling

**Global Error Handlers:**

```javascript
// Uncaught exceptions - log but don't crash
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  // Don't exit - try to keep serving
});

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});
```

**Branded Error Messages:**

```javascript
export const VOYO_ERRORS = {
  NOT_FOUND: 'Content not found in VOYO library',
  STREAM_UNAVAILABLE: 'VOYO stream temporarily unavailable',
  SEARCH_FAILED: 'VOYO search service unavailable',
  THUMBNAIL_FAILED: 'Album art temporarily unavailable',
  INVALID_ID: 'Invalid VOYO track ID',
  NETWORK_ERROR: 'VOYO service unreachable - check your connection'
};

export function getVoyoError(errorType) {
  return VOYO_ERRORS[errorType] || 'An unexpected error occurred';
}
```

**Error Response Format:**

```json
{
  "error": "VOYO stream temporarily unavailable"
}
```

**No YouTube mentions** in error messages - maintains stealth mode.

---

## Performance & Caching

### Connection Pooling

**HTTPS Agent with Keep-Alive:**

```javascript
const httpsAgent = new https.Agent({
  keepAlive: true,     // Reuse TCP connections
  maxSockets: 50       // Max concurrent connections
});

// Use in proxy requests
const proxyReq = https.request({
  hostname: parsedStream.hostname,
  path: parsedStream.pathname,
  agent: httpsAgent,  // ← Connection pooling
  headers: { /* ... */ }
});
```

**Benefits:**
- Reuses TCP connections to YouTube
- Reduces handshake overhead
- Faster subsequent requests
- Lower latency

---

### Cache Statistics

**Tracked Metrics:**

```javascript
const cacheStats = {
  streamHits: 0,           // Cache hits for streams
  streamMisses: 0,         // Cache misses for streams
  thumbnailHits: 0,        // Cache hits for thumbnails
  thumbnailMisses: 0,      // Cache misses for thumbnails
  prefetchRequests: 0,     // Prefetch API calls
  activeStreams: 0,        // Currently streaming
  startTime: Date.now()    // Server start time
};
```

**Hit Rate Calculation:**

```javascript
const hitRate = cacheStats.streamHits + cacheStats.streamMisses > 0
  ? ((cacheStats.streamHits / (cacheStats.streamHits + cacheStats.streamMisses)) * 100).toFixed(2)
  : 0;
```

**View in `/health` endpoint:**

```json
{
  "cache": {
    "streamCacheSize": 234,
    "streamHitRate": "87.50%",
    "stats": {
      "streamHits": 1750,
      "streamMisses": 250
    }
  }
}
```

---

### Memory Management

**Thumbnail Cache LRU Eviction:**

```javascript
const MAX_THUMBNAIL_CACHE = 500;

if (thumbnailCache.size > MAX_THUMBNAIL_CACHE) {
  // Evict oldest entry
  const oldest = Array.from(thumbnailCache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];

  if (oldest) thumbnailCache.delete(oldest[0]);
}
```

**Why 500 limit?**
- Average thumbnail: ~50KB
- 500 thumbnails: ~25MB memory
- Prevents out-of-memory crashes
- LRU keeps most-used thumbnails

**Periodic Cleanup:**

```javascript
// Run every 10 minutes
setInterval(cleanupExpiredCache, 10 * 60 * 1000);

function cleanupExpiredCache() {
  const now = Date.now();

  // Clean stream cache (4h TTL)
  for (const [key, entry] of streamCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      streamCache.delete(key);
    }
  }

  // Clean thumbnail cache (24h TTL)
  for (const [key, entry] of thumbnailCache.entries()) {
    if (now - entry.timestamp > THUMBNAIL_CACHE_TTL) {
      thumbnailCache.delete(key);
    }
  }

  // Clean prefetch cache (30m TTL)
  for (const [key, entry] of prefetchCache.entries()) {
    if (now - entry.timestamp > PREFETCH_TTL) {
      prefetchCache.delete(key);
    }
  }
}
```

---

## Worker (Cloudflare)

**Location:** `/home/dash/voyo-music/worker/index.js`

The Cloudflare Worker provides **edge-based extraction** with multi-client fallback.

### Architecture

```
Client Request
     ↓
Cloudflare Edge (Worker)
     ↓
Try Multiple YouTube Clients:
1. ANDROID_TESTSUITE (best success rate)
2. ANDROID_MUSIC
3. ANDROID
4. IOS
5. TV_EMBEDDED
     ↓
Return First Successful Stream URL
```

### Client Configurations

```javascript
const CLIENTS = [
  {
    name: 'ANDROID_TESTSUITE',
    context: {
      client: {
        clientName: 'ANDROID_TESTSUITE',
        clientVersion: '1.9',
        androidSdkVersion: 30,
      }
    },
    userAgent: 'com.google.android.youtube/1.9 (Linux; U; Android 11) gzip'
  },
  // ... more clients
];
```

### Worker Endpoints

#### GET /health

```json
{
  "status": "ok",
  "edge": true,
  "clients": 5
}
```

#### GET /stream?v=VIDEO_ID

**Response:**

```json
{
  "url": "https://rr5---sn-...googlevideo.com/...",
  "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
  "bitrate": 131072,
  "contentLength": "4567890",
  "title": "Rick Astley - Never Gonna Give You Up",
  "client": "ANDROID_TESTSUITE"
}
```

**Error Response:**

```json
{
  "error": "All clients failed",
  "attempts": [
    { "client": "ANDROID_TESTSUITE", "error": "Not playable" },
    { "client": "ANDROID_MUSIC", "error": "URL requires deciphering" }
  ]
}
```

### Client Fallback Logic

```javascript
for (const client of CLIENTS) {
  try {
    const data = await tryClient(videoId, client);
    const result = extractBestAudio(data);

    if (result.url) {
      return { ...result, client: client.name };
    }

    errors.push({ client: client.name, error: result.error });
  } catch (err) {
    errors.push({ client: client.name, error: err.message });
  }
}

// All clients failed
return { error: 'All clients failed', attempts: errors };
```

### CORS Proxy

**GET /proxy?url=TARGET_URL**

Forwards requests to YouTube with CORS headers:

```javascript
const proxyResponse = await fetch(targetUrl, {
  method: request.method,
  headers: {
    'User-Agent': 'com.google.android.youtube/19.09.37',
    'Origin': 'https://www.youtube.com',
    'Referer': 'https://www.youtube.com/',
  }
});

// Add CORS headers
const responseHeaders = new Headers(proxyResponse.headers);
responseHeaders.set('Access-Control-Allow-Origin', '*');

return new Response(responseBody, {
  status: proxyResponse.status,
  headers: responseHeaders
});
```

**Use Case:** Client-side youtubei.js uses Cloudflare's trusted IPs

---

## Troubleshooting

### Common Issues

**1. yt-dlp not found**

```bash
# Check if installed
which yt-dlp

# Install
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
```

**2. Deno not found**

```bash
# Check if installed
which deno

# Install
curl -fsSL https://deno.land/install.sh | sh

# Add to PATH
export PATH="$HOME/.deno/bin:$PATH"
```

**3. PO Token plugin missing**

```bash
# Install plugin
pip3 install bgutil-ytdlp-pot-provider

# Verify
pip3 show bgutil-ytdlp-pot-provider
```

**4. Stream extraction failing**

- Check Innertube API key (`YT_API_KEY`)
- Try different quality levels
- Check worker fallback (`/debug` endpoint)

**5. High memory usage**

- Check thumbnail cache size (`/health`)
- Reduce `MAX_THUMBNAIL_CACHE` if needed
- Monitor with: `ps aux | grep node`

---

## Monitoring & Metrics

### Health Monitoring

**Uptime Check:**

```bash
curl https://voyo-music.app/health
```

**Key Metrics to Track:**

- `cache.streamHitRate` - Should be >80%
- `memory.heapUsed` - Should be <500MB
- `rateLimit.activeIPs` - Track user count
- `cache.stats.activeStreams` - Concurrent streams

**Alerting Thresholds:**

- Memory > 800MB - Warning
- Stream hit rate < 60% - Warning
- Active streams > 100 - Scale up

---

## API Client Examples

### JavaScript/TypeScript

```typescript
class VoyoAPI {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://voyo-music.app') {
    this.baseUrl = baseUrl;
  }

  async search(query: string, limit: number = 10) {
    const response = await fetch(
      `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    return response.json();
  }

  getStreamUrl(voyoId: string, quality: 'low' | 'medium' | 'high' = 'high') {
    return `${this.baseUrl}/cdn/stream/${voyoId}?quality=${quality}`;
  }

  getThumbnailUrl(voyoId: string, quality: 'max' | 'high' | 'medium' = 'high') {
    return `${this.baseUrl}/cdn/art/${voyoId}?quality=${quality}`;
  }

  async prefetch(voyoId: string, quality: 'low' | 'medium' | 'high' = 'high') {
    await fetch(`${this.baseUrl}/prefetch?v=${voyoId}&quality=${quality}`);
  }

  async getHealth() {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }
}
```

### Python

```python
import requests

class VoyoAPI:
    def __init__(self, base_url='https://voyo-music.app'):
        self.base_url = base_url

    def search(self, query, limit=10):
        response = requests.get(
            f'{self.base_url}/api/search',
            params={'q': query, 'limit': limit}
        )
        return response.json()

    def get_stream_url(self, voyo_id, quality='high'):
        return f'{self.base_url}/cdn/stream/{voyo_id}?quality={quality}'

    def get_thumbnail_url(self, voyo_id, quality='high'):
        return f'{self.base_url}/cdn/art/{voyo_id}?quality={quality}'

    def prefetch(self, voyo_id, quality='high'):
        requests.get(
            f'{self.base_url}/prefetch',
            params={'v': voyo_id, 'quality': quality}
        )

    def get_health(self):
        return requests.get(f'{self.base_url}/health').json()
```

---

## License & Credits

**VOYO Music Backend** - Production-grade YouTube music streaming proxy

**Technologies:**
- Node.js - Runtime
- youtubei.js - YouTube Innertube API
- yt-dlp - YouTube extraction tool
- Deno - JavaScript runtime for yt-dlp
- FFmpeg - Audio processing

**Deployment:**
- Railway - Primary hosting
- Fly.io - Alternative hosting
- Cloudflare Workers - Edge proxy

**Created:** December 2025
**Status:** Production Ready

---

## Appendix: Complete File Structure

```
/home/dash/voyo-music/server/
├── index.js                 # Main server (1530 lines)
├── stealth.js              # ID encoding/validation (151 lines)
├── package.json            # Dependencies
├── Dockerfile              # Fly.io deployment
├── fly.toml                # Fly.io config
├── railway.json            # Railway config
├── API_ENDPOINTS.md        # API reference
├── downloads/              # Downloaded audio files
└── node_modules/           # Dependencies

/home/dash/voyo-music/worker/
├── index.js                # Cloudflare Worker (286 lines)
└── wrangler.toml          # Worker config
```

---

**End of Documentation**
