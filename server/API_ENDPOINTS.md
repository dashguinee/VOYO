# VOYO Music Backend - API Endpoints Reference

## Production Endpoints (NEW)

### Health Check & Monitoring
```
GET /health
```
**Response**: Comprehensive health metrics including cache stats, memory, uptime

**Example**:
```bash
curl https://voyo-music-server-production.up.railway.app/health
```

---

### Prefetch Warming
```
GET /prefetch?v=VIDEO_ID&quality=LEVEL
```
**Parameters**:
- `v` (required): YouTube video ID or VOYO ID
- `quality` (optional): `low` | `medium` | `high` (default: `high`)

**Response**: 202 Accepted (non-blocking)
```json
{
  "status": "warming",
  "videoId": "dQw4w9WgXcQ",
  "message": "Stream warming initiated"
}
```

**Example**:
```bash
curl "https://voyo-music-server-production.up.railway.app/prefetch?v=dQw4w9WgXcQ&quality=medium"
```

---

## Streaming Endpoints (ENHANCED)

### STEALTH: CDN Stream (Recommended)
```
GET /cdn/stream/VOYO_ID?quality=LEVEL
```
**Parameters**:
- `VOYO_ID`: Encoded VOYO track ID (e.g., `vyo_T1NCYW5fc0hfYjg`)
- `quality` (optional): `low` | `medium` | `high` (default: `high`)

**Features**:
- HTTP range request support (seeking)
- Quality selection
- Full CORS support

**Example**:
```bash
curl -H "Range: bytes=0-1024" \
  "https://voyo-music-server-production.up.railway.app/cdn/stream/vyo_T1NCYW5fc0hfYjg?quality=medium"
```

---

### Legacy: Proxy Stream
```
GET /proxy?v=VIDEO_ID&quality=LEVEL&type=TYPE
```
**Parameters**:
- `v` (required): YouTube video ID
- `quality` (optional): `low` | `medium` | `high` (default: `high`)
- `type` (optional): `audio` | `video` (default: `audio`)

**Example**:
```bash
curl "https://voyo-music-server-production.up.railway.app/proxy?v=dQw4w9WgXcQ&quality=low"
```

---

### Legacy: Get Stream URL
```
GET /stream?v=VIDEO_ID&quality=LEVEL&type=TYPE
```
**Parameters**: Same as `/proxy`

**Response**:
```json
{
  "url": "https://googlevideo.com/...",
  "audioUrl": "https://googlevideo.com/...",
  "videoId": "dQw4w9WgXcQ",
  "type": "audio",
  "quality": "high"
}
```

---

## Quality Levels

| Level | Bitrate | Use Case | Network |
|-------|---------|----------|---------|
| `low` | ~64kbps | Data saver mode | 2G / Slow 3G |
| `medium` | ~128kbps | Balanced quality | 3G / Decent WiFi |
| `high` | Best available | Maximum quality | 4G / Fast WiFi |

---

## Other Endpoints

### STEALTH: Search with VOYO IDs
```
GET /api/search?q=QUERY&limit=LIMIT
```

### STEALTH: Album Art
```
GET /cdn/art/VOYO_ID?quality=QUALITY
```
**Quality**: `max` | `high` | `medium` | `default`

### Legacy: Search
```
GET /search?q=QUERY&limit=LIMIT
```

### Legacy: Thumbnail
```
GET /thumbnail?id=VIDEO_ID&quality=QUALITY
```

### Downloads
```
GET    /download?v=VIDEO_ID     # Download track
DELETE /download?v=VIDEO_ID     # Delete track
GET    /downloaded               # List downloaded tracks
GET    /downloads/VIDEO_ID.mp3  # Serve downloaded file
```

---

## HTTP Range Requests (Seeking)

All streaming endpoints support HTTP range requests for instant seeking.

**Example**:
```bash
# Request first 1KB
curl -H "Range: bytes=0-1023" "https://voyo-music-server-production.up.railway.app/cdn/stream/vyo_XXX"

# Request from 1MB onwards
curl -H "Range: bytes=1048576-" "https://voyo-music-server-production.up.railway.app/cdn/stream/vyo_XXX"
```

**Response**: `206 Partial Content` with `Content-Range` header

---

## Frontend Integration Examples

### Adaptive Quality
```typescript
// Detect network type and choose quality
const getOptimalQuality = () => {
  const connection = (navigator as any).connection;
  if (connection?.effectiveType === '2g' || connection?.saveData) return 'low';
  if (connection?.effectiveType === '3g') return 'medium';
  return 'high';
};

const streamUrl = `${API_BASE}/cdn/stream/${voyoId}?quality=${getOptimalQuality()}`;
```

### Prefetch Next Track
```typescript
// When current track reaches 50%, warm up next track
const handleProgress = (progress: number) => {
  if (progress > 0.5 && nextTrack && !prefetched.has(nextTrack.id)) {
    fetch(`${API_BASE}/prefetch?v=${nextTrack.id}&quality=${currentQuality}`)
      .then(() => prefetched.add(nextTrack.id));
  }
};
```

### Monitor Health
```typescript
// Check server health and cache stats
const checkHealth = async () => {
  const health = await fetch(`${API_BASE}/health`).then(r => r.json());
  console.log('Cache Hit Rate:', health.cache.streamHitRate);
  console.log('Active Streams:', health.cache.stats.activeStreams);
};
```

---

## CORS

All endpoints include CORS headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## Production URL

```
https://voyo-music-server-production.up.railway.app
```

---

**Last Updated**: December 9, 2025
