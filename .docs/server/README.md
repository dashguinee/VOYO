# VOYO Music Backend Documentation

Complete documentation for the VOYO Music streaming backend server.

## Documents

- **[SERVER-DOCUMENTATION.md](./SERVER-DOCUMENTATION.md)** - Complete server reference (20,000+ words)

## Quick Links

### Architecture
- Technology stack (Node.js, youtubei.js, yt-dlp)
- Core systems (Innertube, Stealth Mode, Caching, Rate Limiting)
- Multi-tier protection and performance optimization

### API Reference
- **Stealth Endpoints** (Recommended)
  - `/api/search` - Search with VOYO IDs
  - `/cdn/stream/VOYO_ID` - Stream audio
  - `/cdn/art/VOYO_ID` - Album art
- **Legacy Endpoints** (YouTube IDs)
  - `/stream`, `/proxy`, `/search`, `/thumbnail`
- **Download Endpoints**
  - `/download`, `/downloaded`, `/downloads/`
- **Monitoring**
  - `/health`, `/debug`, `/prefetch`

### Deployment
- Railway (nixpacks)
- Fly.io (Docker)
- Cloudflare Workers (edge proxy)

### Key Features

#### 1. Innertube Integration
- Uses YouTube's internal API (same as mobile apps)
- ~500ms response time vs 5-10s with yt-dlp
- Automatic fallback to Piped instances

#### 2. Stealth Mode
- Encodes all YouTube IDs to VOYO IDs (`vyo_XXXXX`)
- Zero YouTube traces in frontend
- Branded error messages

#### 3. Production-Grade Caching
- Stream Cache: 4 hours (YouTube URLs valid ~6 hours)
- Thumbnail Cache: 24 hours (LRU eviction, 500 max)
- Prefetch Cache: 30 minutes (non-blocking warming)

#### 4. Multi-Tier Rate Limiting
- General: 60 req/min per IP
- yt-dlp: 10 calls/min per IP
- Global: 300 yt-dlp calls/min total
- User-Agent rotation

#### 5. VOYO Boost System
- Background downloads for instant playback
- First play: Streams from YouTube
- Second play: Instant (local file)
- Automatic cache management

#### 6. Security
- Strict YouTube ID validation (prevents command injection)
- VOYO ID validation with decoding check
- CORS configuration
- Rate limit protection

### Performance Metrics

**Target Performance:**
- Cache hit rate: >80%
- Memory usage: <500MB
- Stream latency: <1s
- Concurrent streams: 50+

**Monitoring:**
```bash
curl https://voyo-music.app/health
```

### Quick Start

#### Local Development
```bash
# Install dependencies
npm install

# Install system requirements
brew install yt-dlp ffmpeg deno  # macOS
# or
apt-get install yt-dlp ffmpeg python3  # Linux

# Install PO Token plugin
pip3 install bgutil-ytdlp-pot-provider

# Start server
npm run dev

# Verify
curl http://localhost:3001/health
```

#### Production Deployment
```bash
# Railway
railway up

# Fly.io
fly deploy

# Docker
docker build -t voyo-server .
docker run -p 3001:8080 voyo-server
```

### API Examples

#### Search
```bash
curl "https://voyo-music.app/api/search?q=never+gonna+give+you+up&limit=5"
```

#### Stream Audio
```bash
curl -H "Range: bytes=0-1024" \
  "https://voyo-music.app/cdn/stream/vyo_ZFF3NHc5V2dYY1E?quality=high"
```

#### Get Thumbnail
```bash
curl "https://voyo-music.app/cdn/art/vyo_ZFF3NHc5V2dYY1E?quality=high" \
  -o thumbnail.jpg
```

#### Prefetch Next Track
```bash
curl "https://voyo-music.app/prefetch?v=nextTrackId&quality=high"
```

### Environment Variables

```bash
PORT=3001                    # Server port
NODE_ENV=production          # Environment
YT_API_KEY=AIzaSy...         # YouTube API key
API_BASE=https://...         # Auto-detected
YT_DLP_PATH=/usr/local/bin/yt-dlp
```

### File Structure

```
server/
├── index.js           # Main server (1530 lines)
├── stealth.js         # ID encoding/validation (151 lines)
├── package.json       # Dependencies
├── Dockerfile         # Fly.io deployment
├── fly.toml          # Fly.io config
├── railway.json      # Railway config
├── downloads/        # Cached audio files
└── node_modules/     # Dependencies

worker/
├── index.js          # Cloudflare Worker (286 lines)
└── wrangler.toml    # Worker config
```

### Troubleshooting

**yt-dlp not found:**
```bash
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
```

**Deno not found:**
```bash
curl -fsSL https://deno.land/install.sh | sh
export PATH="$HOME/.deno/bin:$PATH"
```

**High memory usage:**
- Check thumbnail cache size in `/health`
- Reduce `MAX_THUMBNAIL_CACHE` if needed

### Production URLs

- **Server:** https://voyo-music-server-production.up.railway.app
- **Worker:** https://voyo-worker.workers.dev (if deployed)

### Documentation Coverage

The complete documentation includes:

1. **Architecture Overview** - System design, components, data flow
2. **Technology Stack** - Dependencies, external services
3. **Environment Setup** - Variables, local dev, auto-detection
4. **Core Systems** (Line-by-line explanations)
   - Innertube Integration
   - Stealth Mode System
   - Caching System (3-tier)
   - Rate Limiting (multi-tier)
   - In-Flight Request Deduplication
   - VOYO Boost System
5. **API Reference** - All 20+ endpoints with examples
6. **Deployment** - Railway, Fly.io, Docker guides
7. **Security & Rate Limiting** - Validation, CORS, protection
8. **Performance & Caching** - Connection pooling, statistics, memory
9. **Worker (Cloudflare)** - Edge proxy, multi-client fallback
10. **Troubleshooting** - Common issues and solutions
11. **Monitoring & Metrics** - Health checks, alerting
12. **API Client Examples** - JavaScript/TypeScript, Python

### Status

- **Version:** 2.0.0
- **Last Updated:** December 19, 2025
- **Status:** Production Ready
- **Documentation:** Complete (20,000+ words)

---

For the complete technical reference, see [SERVER-DOCUMENTATION.md](./SERVER-DOCUMENTATION.md).
