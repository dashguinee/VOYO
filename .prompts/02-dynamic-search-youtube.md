# VOYO Music - Dynamic YouTube Search Implementation

## Context
You are implementing dynamic search for VOYO Music that goes beyond seed data. Users should be able to search for ANY song on YouTube and play it through VOYO's interface.

## Current Architecture
- Frontend: `/home/dash/voyo-music/src/`
- Search Component: `/home/dash/voyo-music/src/components/search/SearchOverlayV2.tsx`
- API Service: `/home/dash/voyo-music/src/services/api.ts`
- Backend: `/home/dash/voyo-music/server/index.js`
- Types: `/home/dash/voyo-music/src/types/index.ts`

## Your Mission: Implement Full YouTube Search

### Backend Updates (server/index.js):

#### 1. Add YouTube Search Endpoint
```javascript
// GET /api/search?q=<query>&limit=10
// Uses yt-dlp to search YouTube
app.get('/api/search', async (req, res) => {
  const { q, limit = 10 } = req.query;

  // Use yt-dlp search: ytsearch{limit}:{query}
  // Command: yt-dlp -j "ytsearch10:query" --flat-playlist

  // Transform results to VOYO format:
  // {
  //   voyoId: 'vyo_' + ytVideoId,
  //   title: string,
  //   artist: string (channel name),
  //   duration: number (seconds),
  //   thumbnail: `/cdn/art/vyo_${ytVideoId}`,
  //   views: number
  // }
});
```

#### 2. Stealth Mode - VOYO ID System
To hide YouTube traces from the UI:
- Generate VOYO IDs: `vyo_${base64encode(ytVideoId)}`
- Decode when streaming: `ytVideoId = base64decode(voyoId.replace('vyo_', ''))`
- All frontend code uses voyoId, never raw YouTube IDs

### Frontend Updates:

#### 1. Update SearchOverlayV2.tsx
- Call `/api/search?q=<query>` instead of local filtering
- Handle loading states
- Display search results with VOYO branding
- Transform API results to Track type for playback

#### 2. Update api.ts
Add/update:
```typescript
export interface SearchResult {
  voyoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  views: number;
}

export async function searchMusic(query: string, limit = 10): Promise<SearchResult[]> {
  const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  // ... handle response
}

// Convert SearchResult to Track for playback
export function searchResultToTrack(result: SearchResult): Track {
  return {
    id: result.voyoId,
    title: result.title,
    artist: result.artist,
    trackId: result.voyoId, // Backend handles decoding
    coverUrl: result.thumbnail,
    duration: result.duration,
    tags: [],
    mood: 'afro',
    region: 'NG',
    oyeScore: result.views,
    createdAt: new Date().toISOString()
  };
}
```

### Hybrid Approach:
1. Search seed data first (instant results)
2. Then search YouTube (async, shows "More results...")
3. Merge results, prioritizing seed data matches

### Success Criteria:
1. Search "Burna Boy" returns both seed data + YouTube results
2. Search "Taylor Swift" (not in seed) returns YouTube results
3. Playing a YouTube search result works seamlessly
4. No raw YouTube URLs/IDs visible in frontend code

## Files to Read First:
1. `/home/dash/voyo-music/server/index.js` - Backend implementation
2. `/home/dash/voyo-music/src/components/search/SearchOverlayV2.tsx` - Search UI
3. `/home/dash/voyo-music/src/services/api.ts` - API layer
4. `/home/dash/voyo-music/src/types/index.ts` - Type definitions

## Output
Implement the backend search endpoint and frontend integration. Test by:
1. Running backend: `cd server && node index.js`
2. Running frontend: `npm run dev`
3. Search for songs both in and not in seed data
