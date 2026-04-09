# VOYO Music - Production Deployment Checklist

## Pre-Deployment Testing

### 1. Local Testing
- [ ] Start server: `cd server && node index.js`
- [ ] Run test suite: `./test-production-features.sh`
- [ ] Verify all 5 tests pass

### 2. Feature Verification
- [ ] Health check returns metrics: `curl localhost:3001/health`
- [ ] Quality selection works: Test `?quality=low/medium/high`
- [ ] Range requests work: Test seeking with `-H "Range: bytes=0-1024"`
- [ ] Prefetch endpoint responds 202: Test `/prefetch?v=VIDEO_ID`
- [ ] Cache statistics update correctly

---

## Deployment Steps

### 1. Git Commit
```bash
cd /home/dash/voyo-music

git add server/index.js
git add server/test-production-features.sh
git add server/API_ENDPOINTS.md
git add PRODUCTION_OPTIMIZATIONS.md
git add DEPLOYMENT_CHECKLIST.md

git commit -m "feat: production streaming optimizations

Implemented 5 production-grade features:

1. Stream Caching Layer
   - Quality-aware cache keys
   - Separate caches for streams, thumbnails, prefetch
   - Cache statistics tracking (hits, misses, hit rate)
   - 4-hour TTL for stream URLs

2. Quality Selection API
   - Three tiers: low (64kbps), medium (128kbps), high (best)
   - Supported on all streaming endpoints
   - Network-adaptive quality selection

3. HTTP Range Request Support
   - Full range header forwarding
   - 206 Partial Content responses
   - Instant seeking support

4. Enhanced Health Check
   - Cache metrics and hit rates
   - Memory usage monitoring
   - Uptime tracking
   - Active stream counter

5. Prefetch Warming Endpoint
   - Async 202 response
   - Background stream warming
   - Zero-latency next track playback

All endpoints backward compatible.
Ready for production deployment."
```

### 2. Push to Repository
```bash
git push origin main
```

### 3. Railway Deployment
If Railway auto-deploys:
- [ ] Monitor deployment logs in Railway dashboard
- [ ] Wait for deployment to complete (~2-3 minutes)

If manual deployment needed:
- [ ] Trigger manual deployment in Railway
- [ ] Monitor build and deploy logs

---

## Post-Deployment Verification

### 1. Health Check
```bash
curl https://voyo-music-server-production.up.railway.app/health
```
**Expected**: `"status": "healthy"` with cache metrics

### 2. Test Quality Selection
```bash
# Low quality
curl "https://voyo-music-server-production.up.railway.app/stream?v=dQw4w9WgXcQ&quality=low"

# Should return: "quality": "low"
```

### 3. Test Prefetch
```bash
curl "https://voyo-music-server-production.up.railway.app/prefetch?v=dQw4w9WgXcQ&quality=medium"

# Should return: "status": "warming"
```

### 4. Test Range Requests
```bash
curl -I -H "Range: bytes=0-1024" \
  "https://voyo-music-server-production.up.railway.app/proxy?v=dQw4w9WgXcQ"

# Should return: 206 Partial Content
# Or at minimum: Accept-Ranges: bytes
```

### 5. Verify Cache Behavior
```bash
# Make 2 identical requests
curl "https://voyo-music-server-production.up.railway.app/stream?v=dQw4w9WgXcQ" > /dev/null
sleep 1
curl "https://voyo-music-server-production.up.railway.app/stream?v=dQw4w9WgXcQ" > /dev/null

# Check cache stats
curl "https://voyo-music-server-production.up.railway.app/health" | jq '.cache.stats.streamHits'

# Should show: streamHits >= 1
```

---

## Railway Configuration

### Environment Variables
No new environment variables needed. Existing config:
```
YT_DLP_PATH=yt-dlp
NODE_ENV=production
```

### Health Check Endpoint
Configure in Railway dashboard:
- **Path**: `/health`
- **Expected Status**: `200`
- **Timeout**: `30 seconds`
- **Interval**: `60 seconds`

### Auto-Restart Policy
- **On Failure**: Enabled
- **Max Restarts**: 5 per hour
- **Health Check**: Enabled

---

## Monitoring Setup

### 1. Cache Performance
Monitor cache hit rate over time:
```bash
watch -n 30 'curl -s https://voyo-music-server-production.up.railway.app/health \
  | jq ".cache.streamHitRate"'
```

**Expected Hit Rate**:
- First hour: 20-40% (cold cache)
- After 24 hours: 60-80% (warmed up)
- Steady state: 75-85%

### 2. Active Streams
Monitor concurrent users:
```bash
curl -s https://voyo-music-server-production.up.railway.app/health \
  | jq '.cache.stats.activeStreams'
```

### 3. Memory Usage
Track memory over time:
```bash
curl -s https://voyo-music-server-production.up.railway.app/health \
  | jq '.memory'
```

**Expected Memory**:
- Idle: 30-50MB
- Under load: 60-100MB
- Alert threshold: >150MB (potential leak)

---

## Frontend Integration (Next Phase)

### Update Frontend to Use New Features

#### 1. Quality Selection (`src/services/api.ts`)
```typescript
const getOptimalQuality = (): 'low' | 'medium' | 'high' => {
  const connection = (navigator as any).connection;
  if (connection) {
    if (connection.effectiveType === '2g' || connection.saveData) return 'low';
    if (connection.effectiveType === '3g') return 'medium';
  }
  return 'high';
};

export const getStreamUrl = (voyoId: string): string => {
  const quality = getOptimalQuality();
  return `${API_BASE}/cdn/stream/${voyoId}?quality=${quality}`;
};
```

#### 2. Prefetch Hook (`src/hooks/usePrefetch.ts`)
```typescript
export const usePrefetch = (queue: Track[]) => {
  const prefetched = useRef(new Set<string>());

  const warmUpNext = (currentIndex: number) => {
    const nextTrack = queue[currentIndex + 1];
    if (nextTrack && !prefetched.current.has(nextTrack.voyoId)) {
      fetch(`${API_BASE}/prefetch?v=${nextTrack.voyoId}`);
      prefetched.current.add(nextTrack.voyoId);
    }
  };

  return { warmUpNext };
};
```

#### 3. Use in AudioPlayer
```typescript
// In AudioPlayer component
const { warmUpNext } = usePrefetch(queue);

const handleTimeUpdate = (e: Event) => {
  const audio = e.target as HTMLAudioElement;
  const progress = audio.currentTime / audio.duration;

  if (progress > 0.5) {
    warmUpNext(currentIndex); // Warm up next track at 50%
  }
};
```

---

## Rollback Plan

If issues occur in production:

### Quick Rollback
```bash
git revert HEAD
git push origin main
```

### Specific Rollback Points
```bash
# Rollback to before optimizations
git log --oneline  # Find commit hash
git revert <commit-hash>
git push origin main
```

---

## Success Metrics

Track these KPIs after deployment:

### Performance
- [ ] Average stream start time: <1 second
- [ ] Cache hit rate: >70% after 24 hours
- [ ] Seeking latency: <200ms

### Reliability
- [ ] Zero 500 errors
- [ ] Uptime: >99.9%
- [ ] Health check: Always responding

### User Experience
- [ ] No buffering on prefetched tracks
- [ ] Smooth quality adaptation
- [ ] Instant seeking

---

## Troubleshooting

### Issue: High Memory Usage
**Solution**: Reduce cache TTL or implement cache size limits

### Issue: Low Cache Hit Rate
**Possible Causes**:
- Users skipping tracks frequently
- Not using prefetch
- Cache TTL too short

**Solution**:
- Implement prefetch in frontend
- Monitor user behavior patterns

### Issue: Slow Stream Start
**Check**:
1. Is yt-dlp installed? `which yt-dlp`
2. Is Railway region optimal?
3. Are YouTube rate limits hit?

---

## Documentation Links

- **Implementation Details**: `/home/dash/voyo-music/PRODUCTION_OPTIMIZATIONS.md`
- **API Reference**: `/home/dash/voyo-music/server/API_ENDPOINTS.md`
- **Test Suite**: `/home/dash/voyo-music/server/test-production-features.sh`
- **Main Code**: `/home/dash/voyo-music/server/index.js`

---

## Sign-Off

- [ ] All local tests pass
- [ ] Code committed to git
- [ ] Deployed to Railway
- [ ] Post-deployment tests pass
- [ ] Health check configured
- [ ] Monitoring set up
- [ ] Documentation complete

**Deployed By**: _________________
**Date**: _________________
**Production URL**: https://voyo-music-server-production.up.railway.app
**Status**: ☐ Success ☐ Issues Found

---

**Last Updated**: December 9, 2025
