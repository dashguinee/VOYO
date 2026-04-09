# Z5 Server/Backend Audit Report

**Audit Date**: 2025-12-13
**Agent**: Z5 (Server/Backend Audit Agent)
**Server Version**: VOYO Backend v2.0.0
**Location**: `/home/dash/voyo-music/server/`

---

## Executive Summary

The VOYO backend server is a **production-grade streaming service** with sophisticated caching, rate limiting, and anti-blocking protection. However, there are **critical security vulnerabilities**, **performance bottlenecks**, and **reliability concerns** that need immediate attention.

**Overall Health Score**: 6.5/10

---

## Critical Issues

### 1. HARDCODED API KEY EXPOSED
- **File**: `server/index.js:445`
- **Severity**: 🔴 CRITICAL - P0
- **Issue**: YouTube Innertube API key hardcoded in source
  ```javascript
  const response = await fetch('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
  ```
- **Risk**: Key can be revoked by Google, causing total service outage
- **Impact**: Complete search functionality failure
- **Recommendation**: Move to environment variable or rotate from YouTube session

### 2. RACE CONDITION IN CACHE CLEANUP
- **File**: `server/index.js:227-262`
- **Severity**: 🟠 HIGH - P1
- **Issue**: Cache cleanup runs while requests are being processed, potential iterator invalidation
- **Code**:
  ```javascript
  for (const [key, entry] of streamCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      streamCache.delete(key); // Modifying during iteration
    }
  }
  ```
- **Risk**: Crashes during high traffic when cleanup runs mid-request
- **Impact**: Service downtime, lost cache entries
- **Recommendation**: Collect keys first, then delete; or use WeakMap with automatic GC

### 3. INNERTUBE FALLBACK TO PIPED IS BROKEN
- **File**: `server/index.js:1285-1319`
- **Severity**: 🟠 HIGH - P1
- **Issue**: Piped fallback uses `fetch()` which is NOT available in Node.js by default (requires Node 18+ with experimental flags)
- **Code**:
  ```javascript
  const pipedResponse = await fetch(`${pipedInstance}/streams/${youtubeId}`, {
    signal: AbortSignal.timeout(8000), // AbortSignal.timeout() also Node 18+
  });
  ```
- **Risk**: Runtime error if Innertube fails on Node < 18 or without `--experimental-fetch`
- **Impact**: Stream extraction failures, 503 errors
- **Recommendation**: Import `node-fetch` or use native https module

### 4. MEMORY LEAK IN THUMBNAIL CACHE
- **File**: `server/index.js:239-245`
- **Severity**: 🟠 HIGH - P1
- **Issue**: Thumbnail cache stores full Buffer objects in memory (can be 50-500KB each)
- **Code**:
  ```javascript
  thumbnailCache.set(cacheKey, {
    data: imageData, // Full buffer stored in RAM
    timestamp: Date.now()
  });
  ```
- **Risk**: With 1000 cached thumbnails = 50-500MB RAM, can OOM on low-memory environments
- **Impact**: Server crashes, deployment failures on Railway/Fly.io free tier
- **Recommendation**: Use LRU cache with max size, or store on disk

### 5. UNVALIDATED ENVIRONMENT VARIABLE USAGE
- **File**: `server/index.js:32-37`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: `FLY_APP_NAME` and `RAILWAY_PUBLIC_DOMAIN` used without validation
- **Code**:
  ```javascript
  if (process.env.FLY_APP_NAME) {
    API_BASE = `https://${process.env.FLY_APP_NAME}.fly.dev`;
  }
  ```
- **Risk**: Malicious env var injection could redirect to attacker-controlled domain
- **Impact**: Thumbnail/stream URLs point to wrong server
- **Recommendation**: Validate env vars match expected format (alphanumeric + hyphens only)

---

## Security Concerns

### 6. CORS ALLOWS ALL ORIGINS
- **File**: `server/index.js:266-270`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: `Access-Control-Allow-Origin: *` allows any website to use backend
- **Risk**: Abuse from third-party sites, bandwidth theft, rate limit exhaustion
- **Impact**: Increased hosting costs, potential service blocking by YouTube
- **Recommendation**: Restrict to known frontend domains (e.g., voyo.app, localhost)

### 7. RATE LIMITING BY IP CAN BE BYPASSED
- **File**: `server/index.js:203-208`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: Uses `x-forwarded-for` header which can be spoofed by client
- **Code**:
  ```javascript
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.socket?.remoteAddress ||
         'unknown';
  ```
- **Risk**: Attacker sends fake `x-forwarded-for` header to bypass rate limits
- **Impact**: Service abuse, YouTube blocking, hosting costs spike
- **Recommendation**: Trust only last proxy in chain (Railway/Fly.io sets this), or use fingerprinting

### 8. NO INPUT SANITIZATION ON SEARCH QUERIES
- **File**: `server/index.js:1181-1196`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: Search query passed directly to Innertube without sanitization
- **Code**:
  ```javascript
  const results = await searchYouTube(query.q, limit); // query.q not sanitized
  ```
- **Risk**: Injection attacks if Innertube API is vulnerable, excessive long queries
- **Impact**: Potential API abuse, excessive bandwidth usage
- **Recommendation**: Limit query length (max 200 chars), strip special chars

### 9. YT-DLP PATH INJECTION RISK
- **File**: `server/index.js:28, 316-326`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: `YT_DLP_PATH` from env var used in spawn() without validation
- **Code**:
  ```javascript
  const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';
  const ytdlp = spawn(YT_DLP_PATH, [...args]);
  ```
- **Risk**: If attacker controls env var, can execute arbitrary commands
- **Impact**: Full server compromise
- **Recommendation**: Validate `YT_DLP_PATH` is absolute path or in whitelist

### 10. DOWNLOADS DIRECTORY TRAVERSAL POSSIBLE
- **File**: `server/index.js:1100-1173`
- **Severity**: 🟢 LOW - P3
- **Issue**: While YouTube ID is validated, extension check relies on array iteration
- **Risk**: Future code changes might allow path traversal if validation removed
- **Impact**: Reading arbitrary files from server
- **Recommendation**: Use `path.resolve()` and ensure result is inside `DOWNLOADS_DIR`

---

## Performance Issues

### 11. NO CONNECTION POOLING FOR HTTPS REQUESTS
- **File**: `server/index.js:409, 947, 1331`
- **Severity**: 🟠 HIGH - P1
- **Issue**: Every proxy request creates new HTTPS connection (slow SSL handshake)
- **Impact**: 100-300ms latency per stream, poor performance under load
- **Recommendation**: Use `https.Agent` with `keepAlive: true` for connection reuse

### 12. SYNCHRONOUS FILE OPERATIONS IN REQUEST HANDLER
- **File**: `server/index.js:869-888, 1123-1167`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: `fs.existsSync()` and `fs.statSync()` block event loop
- **Code**:
  ```javascript
  if (fs.existsSync(cachedPath)) { // Blocking I/O
    const stats = fs.statSync(cachedPath); // Blocking I/O
  ```
- **Impact**: Request handling slows down during disk I/O, poor concurrency
- **Recommendation**: Use async versions (`fs.promises.stat()`, `fs.promises.access()`)

### 13. INEFFICIENT CACHE EXPIRATION STRATEGY
- **File**: `server/index.js:232-253`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: Cleanup iterates entire cache every 10 minutes, O(n) complexity
- **Impact**: CPU spikes during cleanup with large caches (10k+ entries)
- **Recommendation**: Use priority queue (heap) or lazy expiration on access

### 14. NO COMPRESSION FOR JSON RESPONSES
- **File**: Entire `server/index.js`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: JSON responses not gzip compressed
- **Impact**: 3-5x bandwidth usage for search results, slower mobile performance
- **Recommendation**: Add `zlib.gzip()` for responses > 1KB

### 15. INNERTUBE INITIALIZED ON FIRST REQUEST
- **File**: `server/index.js:44-54`
- **Severity**: 🟢 LOW - P3
- **Issue**: First search request has 2-3 second delay for Innertube initialization
- **Code**:
  ```javascript
  async function getInnertube() {
    if (!innertube) {
      innertube = await Innertube.create({ // 2-3 second delay
  ```
- **Impact**: Poor first-request experience
- **Recommendation**: Initialize during server startup, before `server.listen()`

---

## Reliability Issues

### 16. NO HEALTH CHECK FOR YT-DLP AVAILABILITY
- **File**: `server/index.js:1449-1480`
- **Severity**: 🟠 HIGH - P1
- **Issue**: Server starts even if yt-dlp is missing or broken
- **Risk**: Server returns 500 errors for all stream requests until manual intervention
- **Impact**: Silent failures, hard to debug production issues
- **Recommendation**: Check `yt-dlp --version` on startup, exit if missing

### 17. NO RETRY LOGIC FOR YOUTUBE API CALLS
- **File**: `server/index.js:445-495`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: Innertube search fails permanently on network hiccup
- **Impact**: Search failures during temporary network issues
- **Recommendation**: Add exponential backoff retry (max 3 attempts)

### 18. GLOBAL ERROR HANDLERS MISSING
- **File**: `server/index.js`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: No `process.on('uncaughtException')` or `process.on('unhandledRejection')`
- **Risk**: Server crashes on unhandled promise rejection (e.g., fetch timeout)
- **Impact**: Service downtime requiring manual restart
- **Recommendation**: Add global handlers with logging and graceful shutdown

### 19. IN-FLIGHT REQUEST MAP NEVER CLEANED
- **File**: `server/index.js:106, 367-372`
- **Severity**: 🟡 MEDIUM - P2
- **Issue**: `inFlightRequests` Map cleaned via `.finally()` but no guarantee on error paths
- **Code**:
  ```javascript
  requestPromise.finally(() => {
    inFlightRequests.delete(cacheKey); // Might not run on process crash
  });
  ```
- **Risk**: Memory leak if promises never resolve (network timeout without timeout handling)
- **Impact**: Map grows unbounded, OOM after days of uptime
- **Recommendation**: Add timeout wrapper (10 seconds) + periodic cleanup

### 20. BACKGROUND DOWNLOAD HAS NO ERROR HANDLING
- **File**: `server/index.js:894-902`
- **Severity**: 🟢 LOW - P3
- **Issue**: Background download errors logged but not tracked/alerted
- **Code**:
  ```javascript
  downloadAudio(videoId).then(() => {
    console.log(`[Stream] ✅ BOOST COMPLETE: ${videoId} now cached`);
  }).catch(err => {
    console.warn(`[Stream] Boost failed for ${videoId}:`, err.message); // Silent fail
  });
  ```
- **Impact**: Failed downloads go unnoticed, users never get speed boost
- **Recommendation**: Track failed downloads, retry with exponential backoff

---

## Architecture Issues

### 21. MIXED RESPONSIBILITIES (STEALTH + LEGACY ENDPOINTS)
- **File**: `server/index.js:1176-1442 vs 1005-1097`
- **Severity**: 🟢 LOW - P3
- **Issue**: Server has both VOYO stealth endpoints (`/cdn/stream`) and legacy YouTube ID endpoints (`/stream`)
- **Impact**: Code duplication, harder to maintain, confusing API surface
- **Recommendation**: Deprecate legacy endpoints, migrate all clients to stealth endpoints

### 22. CLOUDFLARE WORKER NOT INTEGRATED
- **File**: `worker/index.js` exists but not used
- **Severity**: 🟢 LOW - P3
- **Issue**: Cloudflare Worker provides edge extraction but server doesn't use it
- **Impact**: Missing performance opportunity (edge caching, geo-distribution)
- **Recommendation**: Use Worker as primary extraction, Node.js server as fallback

### 23. NO STRUCTURED LOGGING
- **File**: Entire `server/index.js`
- **Severity**: 🟢 LOW - P3
- **Issue**: Uses `console.log()` without structured fields (JSON logs)
- **Impact**: Hard to parse logs, poor observability in production
- **Recommendation**: Use structured logger (pino, winston) with JSON output

---

## Endpoint Functionality Check

### ✅ Working Endpoints
1. **GET /health** - Returns detailed metrics (cache, uptime, memory)
2. **GET /api/search?q=QUERY** - Innertube search with VOYO IDs
3. **GET /cdn/stream/:id** - Audio streaming with Innertube + Piped fallback
4. **GET /cdn/art/:id** - Thumbnail proxy with caching
5. **GET /proxy?v=ID** - Legacy streaming with yt-dlp
6. **GET /downloads/:id.mp3** - Serves cached downloads with range support
7. **GET /prefetch?v=ID** - Background warming (202 async)

### ⚠️ Partially Working
1. **GET /cdn/stream/:id** - Works but Piped fallback broken on Node < 18
2. **GET /stream?v=ID** - Works but Google URLs expire, needs refresh logic

### ❌ Issues Found
1. **Rate limiting** - Can be bypassed with spoofed headers
2. **Search** - Hardcoded API key vulnerable to revocation
3. **Cache cleanup** - Race condition during iteration

---

## Security Validation

### Input Validation: ✅ GOOD
- YouTube IDs validated with strict regex: `/^[a-zA-Z0-9_-]{11}$/` (lines 123-129 in stealth.js)
- VOYO IDs validated by decoding + YouTube ID check (lines 100-113 in stealth.js)
- Prevents command injection in yt-dlp calls

### CORS Configuration: ⚠️ RISKY
- Allows all origins (`*`) - enables bandwidth theft
- Should restrict to known frontends

### Secrets Management: ❌ POOR
- Hardcoded YouTube API key in source code
- No `.env` file or secret rotation

### Rate Limiting: ⚠️ PARTIAL
- Per-IP rate limiting: 60 req/min (line 136)
- Global yt-dlp limit: 300 calls/min (line 142)
- **BUT**: IP detection can be spoofed

---

## Caching Performance

### Stream URL Cache
- **TTL**: 4 hours (good - YouTube URLs valid ~6 hours)
- **Size**: Unbounded (⚠️ potential memory issue)
- **Hit Rate**: Tracked in `/health` endpoint ✅
- **Cleanup**: Every 10 minutes (⚠️ inefficient O(n) scan)

### Thumbnail Cache
- **TTL**: 24 hours (excellent - images don't change)
- **Size**: Unbounded (🔴 CRITICAL - stores full buffers)
- **Storage**: In-memory Map (⚠️ memory leak risk)
- **Cleanup**: Every 10 minutes ✅

### Prefetch Cache
- **TTL**: 30 minutes (good for session warmup)
- **Size**: Small (only metadata, not actual streams) ✅
- **Usage**: Non-blocking 202 response ✅

### In-Flight Request Deduplication
- **Implementation**: Promise caching ✅
- **Cleanup**: `.finally()` cleanup (⚠️ not guaranteed)
- **Benefit**: Prevents duplicate yt-dlp calls for same track ✅

---

## Concurrent Request Handling

### yt-dlp Concurrency Control
- **Max concurrent**: 3 processes (line 147)
- **Global queue**: `ytDlpQueue` array (⚠️ NOT IMPLEMENTED - queue defined but never used!)
- **Risk**: No actual queueing logic, can spawn unlimited processes
- **Recommendation**: Implement actual queue processing

### Proxy Streaming
- **Connection pooling**: ❌ None (new connection per stream)
- **Range support**: ✅ Implemented for seek/resume
- **Active stream tracking**: ✅ Counted in cache stats
- **Cleanup**: ✅ Decrements on proxy end

---

## Recommended Fixes (Priority Order)

### P0 - Critical (Fix Immediately)
1. **Move YouTube API key to environment variable**
   ```javascript
   const YT_API_KEY = process.env.YT_API_KEY || 'AIzaSy...'; // With fallback
   ```
2. **Fix cache cleanup race condition**
   ```javascript
   const keysToDelete = [];
   for (const [key, entry] of streamCache.entries()) {
     if (now - entry.timestamp > CACHE_TTL) keysToDelete.push(key);
   }
   keysToDelete.forEach(k => streamCache.delete(k));
   ```
3. **Fix Piped fallback for Node < 18**
   ```javascript
   import https from 'https';
   // Replace fetch() with https.get()
   ```

### P1 - High (Fix This Week)
4. **Add LRU cache for thumbnails** (prevent memory leak)
5. **Add connection pooling for HTTPS** (improve performance)
6. **Add yt-dlp health check on startup**
7. **Implement actual yt-dlp queue processing**

### P2 - Medium (Fix This Month)
8. **Restrict CORS to known origins**
9. **Add input sanitization for search queries**
10. **Use async file operations** (fs.promises)
11. **Add retry logic for API calls**
12. **Add compression for JSON responses**

### P3 - Low (Backlog)
13. **Add structured logging**
14. **Deprecate legacy endpoints**
15. **Integrate Cloudflare Worker**
16. **Add monitoring/alerting for failed background downloads**

---

## Testing Recommendations

### Unit Tests Needed
- [ ] VOYO ID encoding/decoding (edge cases, invalid inputs)
- [ ] YouTube ID validation (injection attempts, special chars)
- [ ] Cache expiration logic (race conditions, concurrent access)
- [ ] Rate limiting (bypass attempts, IP spoofing)

### Integration Tests Needed
- [ ] Full stream flow (search → stream → play)
- [ ] Background download + cache serving
- [ ] Fallback behavior (Innertube fails → Piped → yt-dlp)
- [ ] Range request handling (seek/resume)

### Load Tests Needed
- [ ] 100 concurrent streams (check memory usage)
- [ ] Cache cleanup under load (verify no crashes)
- [ ] Rate limit effectiveness (measure false positive rate)

---

## Deployment Concerns

### Railway/Fly.io Compatibility
- ✅ Auto-detects platform via env vars (lines 32-37)
- ⚠️ No validation of env vars (security risk)
- ✅ Uses `PORT` from environment
- ⚠️ No health check endpoint for orchestrator (has `/health` but needs proper status codes)

### Resource Requirements
- **Memory**: Unbounded due to caches (⚠️ will OOM eventually)
- **CPU**: Low except during cache cleanup spikes
- **Disk**: Downloads stored in `./downloads` (✅ good)
- **Network**: High bandwidth for streaming (✅ expected)

### Monitoring Gaps
- ❌ No metrics export (Prometheus, StatsD)
- ❌ No error tracking (Sentry, Rollbar)
- ✅ Basic stats in `/health` endpoint
- ❌ No uptime monitoring integration

---

## Overall Assessment

### Strengths
1. **Sophisticated caching system** - 4-hour stream cache, 24-hour thumbnail cache
2. **Rate limiting** - Both per-IP and global limits
3. **Input validation** - Strict regex for IDs prevents injection
4. **Stealth mode** - VOYO ID encoding hides YouTube completely
5. **Fallback strategy** - Innertube → Piped → yt-dlp
6. **Range support** - Proper HTTP 206 for seeking

### Weaknesses
1. **Security**: Hardcoded API key, CORS wildcard, spoofable rate limits
2. **Memory**: Unbounded caches will cause OOM
3. **Reliability**: No yt-dlp health check, no retry logic, missing error handlers
4. **Performance**: No connection pooling, blocking file I/O, inefficient cache cleanup
5. **Observability**: Only console.log, no structured logging or metrics

### Production Readiness: 6.5/10
- ✅ Core functionality works
- ✅ Good caching strategy
- ⚠️ Will work in production BUT:
  - Will eventually crash from memory leak (days/weeks)
  - Vulnerable to abuse (CORS wildcard, IP spoofing)
  - Hardcoded API key is ticking time bomb
  - No monitoring means blind to issues

---

## Next Steps

1. **Create GitHub issues** for all P0/P1 items
2. **Add monitoring** (APM, error tracking) before scaling
3. **Load test** with realistic traffic (100+ concurrent streams)
4. **Set up alerts** for memory usage > 80%, error rate > 5%
5. **Document** deployment requirements (yt-dlp version, Node.js version)

---

**Report Generated**: 2025-12-13
**Agent**: Z5 Server/Backend Audit Agent
**Status**: ✅ Audit Complete - VOYO backend is functional but needs hardening before scale
