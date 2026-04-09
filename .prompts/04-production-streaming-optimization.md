# VOYO Music - Production Streaming Optimization

## Context
You are optimizing the VOYO Music streaming architecture for production deployment. The backend uses yt-dlp to stream from YouTube, and we need to ensure fast, reliable playback.

## Current Architecture
- Backend: `/home/dash/voyo-music/server/index.js` (Railway deployed)
- Production URL: `https://voyo-music-server-production.up.railway.app`
- Frontend API: `/home/dash/voyo-music/src/services/api.ts`
- Audio Player: `/home/dash/voyo-music/src/components/AudioPlayer.tsx`

## Your Mission: Production-Grade Streaming

### Backend Optimizations (server/index.js):

#### 1. Stream Caching Layer
```javascript
// In-memory cache for active streams
const streamCache = new Map(); // trackId -> { url, expiry, accessCount }

// Cache streams for 30 minutes after last access
// Clear cache on memory pressure
```

#### 2. Parallel Stream Fetching
```javascript
// When user requests stream, also prefetch next track in background
// /cdn/stream/:trackId?prefetch=nextTrackId
```

#### 3. HTTP Range Request Support
```javascript
// Support partial content for seeking
// Headers: Accept-Ranges, Content-Range
// Status: 206 Partial Content
```

#### 4. Connection Keep-Alive
```javascript
// Keep yt-dlp process warm for faster subsequent requests
// Connection pooling for YouTube requests
```

#### 5. Quality Selection API
```javascript
// /cdn/stream/:trackId?quality=low|medium|high
// low: bestaudio[abr<=64]
// medium: bestaudio[abr<=128]
// high: bestaudio[abr<=256]
```

### Frontend Optimizations (api.ts & AudioPlayer.tsx):

#### 1. Adaptive Streaming Request
```typescript
// Detect network speed and request appropriate quality
const getOptimalQuality = (): 'low' | 'medium' | 'high' => {
  const connection = (navigator as any).connection;
  if (connection) {
    if (connection.effectiveType === '2g' || connection.saveData) return 'low';
    if (connection.effectiveType === '3g') return 'medium';
  }
  return 'high';
};
```

#### 2. Prefetch Manager
```typescript
// Track prefetch states
const prefetchManager = {
  queue: Map<string, 'pending' | 'loading' | 'ready'>,

  // Start prefetch when current track hits 50%
  checkPrefetch: (progress: number, nextTrackId: string) => {
    if (progress > 50 && !this.queue.has(nextTrackId)) {
      this.startPrefetch(nextTrackId);
    }
  },

  // Warm up the stream URL
  startPrefetch: async (trackId: string) => {
    // Make HEAD request to warm up CDN/cache
    await fetch(`${API_BASE}/cdn/stream/${trackId}?prefetch=true`, { method: 'HEAD' });
  }
};
```

#### 3. Error Recovery
```typescript
// Automatic retry with exponential backoff
// Switch to lower quality on repeated failures
// Show user-friendly error states
```

### Railway Deployment Updates:

#### 1. Update nixpacks.toml
```toml
[phases.setup]
nixPkgs = ["nodejs_20", "python311", "ffmpeg", "yt-dlp"]

[phases.install]
cmds = ["npm install"]

[start]
cmd = "node index.js"

[variables]
YT_DLP_PATH = "yt-dlp"
NODE_ENV = "production"
```

#### 2. Add Health Check Endpoint
```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cacheSize: streamCache.size
  });
});
```

### Success Criteria:
1. Stream starts within 1 second on good connections
2. Prefetch warms up next track before needed
3. Graceful quality degradation on slow networks
4. Zero 500 errors on production
5. Health endpoint reports accurate status

## Files to Read First:
1. `/home/dash/voyo-music/server/index.js` - Backend implementation
2. `/home/dash/voyo-music/server/nixpacks.toml` - Railway config
3. `/home/dash/voyo-music/src/services/api.ts` - Frontend API
4. `/home/dash/voyo-music/src/components/AudioPlayer.tsx` - Playback logic

## Output
Implement the backend optimizations first (higher impact), then frontend enhancements. Test locally before deploying to Railway.
