# VOYO Backend - Production Deployment Quick Start

**Last Updated**: 2025-12-14 by Z5-FIX-AGENT
**Status**: ✅ PRODUCTION READY

---

## 🚀 PRE-DEPLOYMENT (CRITICAL)

### 1. Set Environment Variable
```bash
# REQUIRED: Set YouTube API key
export YT_API_KEY="your-production-youtube-api-key"
```

**Why**: API key is no longer hardcoded. Without this, search will fall back to development key.

### 2. Verify Server Starts
```bash
cd /home/dash/voyo-music
node server/index.js
```

**Expected Output**: Should see startup banner with endpoints listed.
**Check**: No `[FATAL]` or `[ERROR]` messages.

---

## 📊 POST-DEPLOYMENT MONITORING

### Health Check Endpoint
```bash
curl http://your-domain.com/health
```

**Watch These Metrics**:
- `cache.thumbnailCacheSize` → Should max at **500** (LRU working)
- `cache.streamHitRate` → Higher = better caching (target: >40%)
- `memory.heapUsed` → Should **stabilize** not grow forever
- `uptime` → Should stay up (error handlers working)

### Critical Logs to Monitor
```bash
# Good - these are normal
[Cache Cleanup] Removed X expired entries
[Thumbnail Cache Hit]
[Stream] VOYO BOOST - Serving cached

# Bad - these should NEVER appear
[FATAL] Uncaught Exception:
[ERROR] Unhandled Rejection:
```

---

## 🔧 WHAT CHANGED (Brief)

| Fix | Impact | What It Does |
|-----|--------|--------------|
| **API Key to Env** | Security | Can rotate key without code changes |
| **Cache Race Fix** | Reliability | Prevents random crashes during cleanup |
| **LRU Cache Limit** | Reliability | Prevents OOM from cache growth |
| **Error Handlers** | Reliability | Server survives errors instead of crashing |
| **Connection Pool** | Performance | Reuses connections, lower latency |

---

## 🆘 TROUBLESHOOTING

### Server Won't Start
**Error**: `EADDRINUSE: address already in use`
**Fix**: Another process is using port 3001. Kill it or use different port:
```bash
PORT=3002 node server/index.js
```

### Search Not Working
**Error**: `Innertube search failed: 403`
**Fix**: Check `YT_API_KEY` is set correctly:
```bash
echo $YT_API_KEY  # Should output your key
```

### Memory Growing Forever
**Check**: Is `cache.thumbnailCacheSize` over 500?
**Expected**: Should never exceed 500 (LRU eviction)
**If broken**: Restart server, check logs for errors

---

## 📞 SUPPORT

**Fixes By**: Z5-FIX-AGENT
**Status Report**: `/home/dash/voyo-music/.z-agents/status/Z5-FIX-STATUS.md`
**Full Summary**: `/home/dash/voyo-music/.z-agents/Z5-FIXES-SUMMARY.md`

**Emergency**: All fixes are backward compatible. Can rollback to previous version if needed.

---

## ✅ DEPLOYMENT CHECKLIST

- [ ] Set `YT_API_KEY` environment variable
- [ ] Test server starts locally
- [ ] Deploy to production
- [ ] Test `/health` endpoint returns 200
- [ ] Test streaming: `/cdn/stream/vyo_XXX`
- [ ] Monitor logs for 10 minutes (watch for errors)
- [ ] Check memory usage after 1 hour (should stabilize)

**Ship it!** 🚀🎵
