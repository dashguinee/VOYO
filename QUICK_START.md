# VOYO Music - Dynamic Search Quick Start

## Start Development

```bash
# Terminal 1 - Backend
cd /home/dash/voyo-music/server
node index.js

# Terminal 2 - Frontend  
cd /home/dash/voyo-music
npm run dev
```

## Test Search

1. Open http://localhost:5173
2. Click search icon
3. Try these searches:
   - "Burna Boy" → See seed + YouTube results
   - "Taylor Swift" → See YouTube only results
   - "Davido" → See mixed results

## What Changed

### Backend (`server/stealth.js`)
- Production URL auto-detection for Railway deployment

### API (`src/services/api.ts`)
- Split into `searchMusic()` and `searchYouTube()`

### UI (`src/components/search/SearchOverlayV2.tsx`)
- Added local seed data search
- Hybrid search: instant seed results + async YouTube

## Architecture

```
User Input
    ↓
Search Seed Data (instant) → Show 5 results
    ↓
Search YouTube (async) → Add 15 results
    ↓
Display merged results (seed first)
```

## Key Features

- Instant local results from 50+ seed tracks
- Unlimited YouTube search via yt-dlp
- VOYO ID stealth mode (no YouTube traces)
- Graceful fallback if YouTube unavailable

See TEST_DYNAMIC_SEARCH.md for comprehensive testing guide.
