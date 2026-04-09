# VOYO Music - STEALTH MODE Documentation

## Overview
Total YouTube disguise system that hides all traces of YouTube from the frontend. Users see only VOYO-branded content.

## Implementation Summary

### 1. ID Obfuscation System (`server/stealth.js`)
- **Encoding**: Converts YouTube IDs to VOYO IDs using base64url encoding
  - Example: `OSBan_sH_b8` → `vyo_T1NCYW5fc0hfYjg`
- **Decoding**: Reversible transformation for internal use
- **Validation**: `isValidVoyoId()` ensures only valid VOYO IDs are processed
- **Branded Errors**: All error messages use VOYO terminology (no YouTube mentions)

### 2. Backend Stealth Endpoints (`server/index.js`)

#### NEW Stealth Endpoints (VOYO IDs)
- `GET /cdn/stream/vyo_XXXXX` - Stream audio with VOYO ID
- `GET /cdn/art/vyo_XXXXX` - Album art with VOYO ID
- `GET /api/search?q=QUERY` - Search returns VOYO IDs

#### Legacy Endpoints (YouTube IDs - kept for compatibility)
- `GET /proxy?v=VIDEO_ID` - Stream audio/video
- `GET /thumbnail?id=VIDEO_ID` - Proxy thumbnails
- `GET /search?q=QUERY` - Original search

### 3. Frontend API Service (`src/services/api.ts`)

#### Updated Interfaces
```typescript
export interface SearchResult {
  voyoId: string;  // VOYO ID instead of YouTube ID
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;  // Points to /cdn/art/vyo_XXXXX
  views: number;
}
```

#### Stealth Functions
- `searchMusic()` - Uses `/api/search` (returns VOYO IDs)
- `getAudioStream(voyoId)` - Uses `/cdn/stream/` endpoint
- `getThumbnailUrl(voyoId)` - Uses `/cdn/art/` endpoint
- All functions accept VOYO IDs, not YouTube IDs

### 4. Branded Error Messages
All errors now use VOYO terminology:
- "VOYO stream temporarily unavailable" (not "YouTube error")
- "Content not found in VOYO library" (not "Video not found")
- "VOYO search service unavailable" (not "Search failed")
- "Album art temporarily unavailable" (not "Thumbnail failed")

## Verification

### Test Results
```bash
./test-stealth.sh
```

✅ **PASSED Tests:**
1. Search endpoint returns VOYO IDs
2. No YouTube traces in JSON responses
3. CDN Art endpoint serves images (200 OK)
4. CDN Stream endpoint streams audio (206 Partial Content)
5. All IDs use `vyo_` prefix

### Network Inspection
When running the frontend, check DevTools Network tab:

**Before Stealth Mode:**
- Requests to: `youtube.com`, `googlevideo.com`, `ytimg.com`
- Exposed YouTube video IDs in URLs

**After Stealth Mode:**
- All requests to: `localhost:3001/cdn/*` or `localhost:3001/api/*`
- Only VOYO IDs visible (`vyo_XXXXX`)
- No YouTube domains in network traffic

## VOYO ID Examples

| YouTube ID | VOYO ID |
|------------|---------|
| OSBan_sH_b8 | vyo_T1NCYW5fc0hfYjg |
| WcIcVapfqXw | vyo_V2NJY1ZhcGZxWHc |
| RQdxHi4_Pvc | vyo_UlFkeEhpNF9QdmM |

## How It Works

### Search Flow
1. User searches "Davido"
2. Frontend calls `searchMusic("Davido")`
3. Backend searches YouTube via yt-dlp
4. Backend converts YouTube IDs → VOYO IDs
5. Frontend receives results with VOYO IDs only
6. Thumbnails point to `/cdn/art/vyo_XXXXX`

### Playback Flow
1. User clicks track with VOYO ID `vyo_T1NCYW5fc0hfYjg`
2. Frontend calls `getAudioStream(voyoId)`
3. Returns `/cdn/stream/vyo_T1NCYW5fc0hfYjg`
4. Backend decodes VOYO ID → YouTube ID
5. Backend fetches stream from YouTube
6. Backend proxies stream to frontend
7. **User sees only VOYO URLs in browser**

### Thumbnail Flow
1. Frontend renders `<img src="/cdn/art/vyo_XXXXX" />`
2. Backend decodes VOYO ID → YouTube ID
3. Backend fetches thumbnail from YouTube
4. Backend serves cached JPEG to frontend
5. **No YouTube URLs visible**

## Files Modified

### Created
- `/home/dash/voyo-music/server/stealth.js` - ID obfuscation system

### Modified
- `/home/dash/voyo-music/server/index.js` - Added stealth endpoints
- `/home/dash/voyo-music/src/services/api.ts` - Updated to use VOYO IDs

### Backup Files
- `server/index.js.backup` - Original backend
- `src/services/api.ts.backup` - Original API service

## Testing Locally

### 1. Start Backend
```bash
cd /home/dash/voyo-music/server
node index.js
```

You should see:
```
🎵 VOYO Backend running on http://localhost:3001

   🥷 STEALTH MODE ACTIVE - Zero YouTube traces

   📡 STEALTH ENDPOINTS (VOYO IDs):
   - GET /cdn/stream/vyo_XXXXX          → Stream audio (STEALTH)
   - GET /cdn/art/vyo_XXXXX             → Album art (STEALTH)
   - GET /api/search?q=QUERY            → Search with VOYO IDs
```

### 2. Test Search
```bash
curl "http://localhost:3001/api/search?q=burna+boy&limit=2" | python3 -m json.tool
```

Expected output:
```json
{
  "results": [
    {
      "voyoId": "vyo_XXXXX",
      "title": "...",
      "thumbnail": "/cdn/art/vyo_XXXXX",
      ...
    }
  ]
}
```

### 3. Test Thumbnail
```bash
curl -I "http://localhost:3001/cdn/art/vyo_T1NCYW5fc0hfYjg"
```

Expected: `HTTP/1.1 200 OK` with `Content-Type: image/jpeg`

### 4. Test Stream
```bash
curl -I "http://localhost:3001/cdn/stream/vyo_T1NCYW5fc0hfYjg"
```

Expected: `HTTP/1.1 206 Partial Content` with audio content

## Production Considerations

### 1. Environment Variables
```bash
export API_BASE="https://api.voyo-music.com"
```

### 2. HTTPS/SSL
All CDN endpoints should use HTTPS in production to prevent ISP inspection

### 3. Rate Limiting
Consider adding rate limits to prevent abuse:
```javascript
// In server/index.js
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/cdn/', limiter);
```

### 4. Caching Strategy
- Thumbnails: 1 hour browser cache + server cache
- Stream URLs: 1 hour server cache (they expire)
- Search results: No cache (always fresh)

## Limitations

### Seed Data (tracks.ts)
The pre-loaded tracks in `src/data/tracks.ts` still use YouTube IDs internally. This is intentional:
- Seed data doesn't expose IDs to users
- Only used for initial app load
- Search results use VOYO IDs

### Offline Downloads
Download endpoints still use YouTube IDs for file naming. This is backend-only and not exposed to users.

## Future Enhancements

### 1. Database Integration
Store VOYO ID ↔ YouTube ID mappings in a database:
```javascript
{
  voyoId: "vyo_T1NCYW5fc0hfYjg",
  youtubeId: "OSBan_sH_b8",
  title: "UNAVAILABLE",
  artist: "Davido",
  cached: true
}
```

### 2. Content Delivery Network
Move `/cdn/art/` and `/cdn/stream/` to a real CDN:
- CloudFlare for geo-distributed caching
- AWS CloudFront for scalability
- Removes "localhost" from URLs

### 3. Playlist Stealth
Convert playlist IDs to VOYO format:
- YouTube playlist ID → `vpl_XXXXX`
- Keep user-created playlists separate

## Security Notes

- VOYO IDs are NOT encryption (just encoding)
- Anyone can decode `vyo_` IDs back to YouTube IDs
- Purpose is UI/UX disguise, not security
- For true privacy, consider:
  - Server-side playlist storage
  - Encrypted ID mappings
  - No client-side YouTube ID exposure

## Conclusion

VOYO Stealth Mode successfully hides all YouTube traces from end users. The app appears as a native music streaming service with its own CDN infrastructure.

**Key Achievement:** Zero YouTube URLs visible in browser DevTools Network tab.
