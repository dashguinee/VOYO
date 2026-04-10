# VOYO RESCUE FILE - Dec 13, 2025

## CURRENT STATE: COMPLETE BOOST SYSTEM V2

### Production URLs
- Frontend: https://voyo-music.vercel.app
- Backend: https://voyo-music-api.fly.dev
- Edge Worker: https://voyo-edge.dash-webtv.workers.dev

### Architecture (FINAL - Tested & Working)
```
PLAYBACK FLOW:
1. User plays track
2. Check IndexedDB cache → If BOOSTED, play from local blob (instant, offline)
3. If NOT boosted → YouTube IFrame plays instantly (no waiting)
4. User can click "⚡ Boost HD" button manually
5. Server downloads via yt-dlp proxy → Browser stores in IndexedDB
6. Next play = instant from cache (BOOSTED)

BOOST FLOW:
1. User clicks "⚡ Boost HD" button
2. Frontend calls /proxy?v=VIDEO_ID endpoint
3. Server uses yt-dlp to get googlevideo URL
4. Server proxies audio bytes to browser
5. Browser stores blob in IndexedDB
6. After 3 manual boosts, prompt: "Enable Auto-Boost?"
```

### Key Components

**NEW FILES (Dec 13, 2025):**
- `src/components/ui/BoostButton.tsx` - Manual boost button with progress + AutoBoostPrompt modal
- `src/components/ui/BoostSettings.tsx` - Settings panel (auto-boost toggle, storage management)
- `src/services/downloadManager.ts` - IndexedDB storage, download queue
- `src/store/downloadStore.ts` - Zustand state for downloads (boostTrack, auto-boost tracking)
- `src/components/ui/BoostIndicator.tsx` - Status badges (Boosted, Downloading, etc.)

**MODIFIED:**
- `src/components/AudioPlayer.tsx` - Simplified: cache first, IFrame fallback (NO proxy for playback)
- `src/components/voyo/VoyoPortraitPlayer.tsx` - Integrated BoostButton, BoostSettings, BoostIndicator
- `src/store/playerStore.ts` - Added `playbackSource` state

### Key Functions

**Manual Boost (User clicks button):**
```typescript
boostTrack(trackId, title, artist, duration, coverUrl);
// Downloads via /proxy endpoint -> IndexedDB
```

**Check cache:**
```typescript
const cachedUrl = await checkCache(trackId);
// Returns blob URL if cached, null otherwise
```

**Auto-boost management:**
```typescript
enableAutoBoost();   // Enable auto-download
disableAutoBoost();  // Disable
dismissAutoBoostPrompt(); // Don't ask again
```

**Playback sources:**
- `cached` = Playing from IndexedDB (⚡ Boosted - HD, offline)
- `iframe` = YouTube IFrame (instant start, standard quality)

### Server Endpoints

**For Boost Downloads:**
- `GET /proxy?v=VIDEO_ID&quality=high` - Proxies audio via yt-dlp (for boost downloads)

**For Playback (NOT USED - IFrame instead):**
- `/stream` - Returns URL info but we don't use raw URLs anymore
- IFrame handles all non-cached playback

### Console Logs to Look For
- `[VOYO] Loading:` - Starting to load track
- `[VOYO] ⚡ BOOSTED - Playing from local cache` - Playing from IndexedDB
- `[VOYO] Not boosted - Using IFrame` - Using YouTube IFrame
- `[VOYO Boost] Starting:` - User clicked Boost button
- `[VOYO Boost] ⚡ SUCCESS:` - Download complete
- `[VOYO Boost] Failed:` - Download error

### Storage
- **IndexedDB**: `voyo-music-cache` database
  - `audio-files` store: Audio blobs
  - `track-meta` store: Track metadata
- **localStorage**:
  - `voyo-download-setting`: 'always' | 'wifi-only' | 'never'
  - `voyo-auto-boost`: 'true' | 'false'
  - `voyo-manual-boost-count`: Number of manual boosts
  - `voyo-auto-boost-dismissed`: 'true' if user dismissed prompt

### If Build Breaks
```bash
cd /home/dash/voyo-music
npm run build
```

### If Need to Revert
```bash
git stash  # Stash current changes
git checkout HEAD~1  # Go back one commit
```

### Tested & Working
- Build: ✓ Compiles without errors
- AudioPlayer: ✓ Cache-first, IFrame fallback
- BoostButton: ✓ Shows download progress
- BoostSettings: ✓ Toggle auto-boost, clear cache
- AutoBoostPrompt: ✓ Shows after 3 manual boosts
- Server /proxy: ✓ Streams via yt-dlp
