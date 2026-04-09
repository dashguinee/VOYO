# VOYO BOOST Architecture v2

## Philosophy: Collective Intelligence Storage

Every user contributes to the collective library. The more people play and boost, the richer the shared R2 cache becomes.

---

## CURRENT ARCHITECTURE (What Exists Now)

### System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VOYO MUSIC SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   SUPABASE   │    │  CLOUDFLARE  │    │    FLY.IO    │                   │
│  │   Database   │    │   R2 + Edge  │    │   API Server │                   │
│  │   324K tracks│    │   Worker     │    │              │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│         │                   │                   │                            │
│         │ Discovery         │ Audio Stream      │ Search/Download            │
│         ▼                   ▼                   ▼                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         BROWSER CLIENT                               │    │
│  │                                                                      │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │    │
│  │   │ AudioPlayer │  │  YouTube    │  │  IndexedDB  │                 │    │
│  │   │ (Web Audio) │  │  Iframe     │  │  (Cache)    │                 │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘                 │    │
│  │         │                 │                │                         │    │
│  │         └────────┬────────┴────────┬───────┘                         │    │
│  │                  ▼                 ▼                                 │    │
│  │            ┌──────────┐     ┌──────────┐                            │    │
│  │            │ Speakers │     │  Screen  │                            │    │
│  │            └──────────┘     └──────────┘                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Sources

| Source | Purpose | Size | URL |
|--------|---------|------|-----|
| **Supabase** | Track metadata, discovery | 324K tracks | `anmgyxhnyhbyxzpjhxgx.supabase.co` |
| **R2 Edge Worker** | Audio streaming, thumbnails | ~41K cached | `voyo-edge.dash-webtv.workers.dev` |
| **Fly.io API** | Search, download proxy | N/A | `voyo-music-api.fly.dev` |
| **YouTube** | Fallback video/audio | Unlimited | `youtube.com/embed` |
| **IndexedDB** | Local cache (boosted) | User device | Browser local |

### Current Playback Flow (AudioPlayer.tsx) ✅ UPDATED

```
User plays track
       │
       ▼
┌─────────────────────────────┐
│ 1. Check IndexedDB cache    │ ← audioEngine.getBestAudioUrl()
│    (user's boosted tracks)  │
└─────────────────────────────┘
       │
       ├── HIT → Play from cache + Apply EQ enhancement
       │         playbackSource = 'cached'
       │
       └── MISS ↓
              │
              ▼
┌─────────────────────────────┐
│ 2. Check R2 Edge Worker     │ ← checkR2Cache() - NEW!
│    GET /exists/{trackId}    │
└─────────────────────────────┘
       │
       ├── HIT → Play R2 stream + Apply EQ enhancement
       │         playbackSource = 'r2'
       │
       └── MISS ↓
              │
              ▼
┌─────────────────────────────┐
│ 3. Play via YouTube Iframe  │
│    playbackSource = 'iframe'│
└─────────────────────────────┘
       │
       └── Background: Start cacheTrack() download
```

**FIXED:** R2 check now happens before iframe fallback! (Phase 1 Complete)

### R2 Check (api.ts) ✅ NOW USED IN MAIN FLOW

```typescript
// Now called in AudioPlayer.tsx loadTrack()!
async function checkR2Cache(videoId: string): Promise<{exists, url}> {
  // Fast edge check (2s timeout)
  const response = await fetch(`${EDGE_WORKER_URL}/exists/${youtubeId}`);

  if (data.exists) {
    return { exists: true, url: `${EDGE_WORKER_URL}/audio/${youtubeId}` };
  }
  return { exists: false, url: null };
}
```

### Current Boost Flow (downloadStore.ts)

```
User clicks Boost button
       │
       ▼
┌─────────────────────────────┐
│ boostTrack()                │
│ - Download from Fly.io API  │
│ - Save to IndexedDB         │
│ - Track as 'boosted' quality│
└─────────────────────────────┘
       │
       ▼
Track available offline + enhanced EQ
```

**ISSUE:** Doesn't upload to R2 (collective storage missing!)

### Current Auto-Boost (downloadStore.ts)

```typescript
// Settings
autoBoostEnabled: boolean     // User toggle
manualBoostCount: number      // Tracks how many manual boosts
showAutoBoostPrompt: boolean  // Show after 3 manual boosts

// Trigger: When track finishes playing (100%)
// Action: Queue for background download
```

**ISSUE:** Triggers at 100% (should be 50%)

### Audio Enhancement Chain (AudioPlayer.tsx)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WEB AUDIO API ENHANCEMENT                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Audio Source (IndexedDB blob OR R2 stream)                         │
│       │                                                              │
│       ▼                                                              │
│  createMediaElementSource(audioRef)                                 │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐             │
│  │SubBass  │──▶│ Bass    │──▶│ Warmth  │──▶│Harmonic │             │
│  │lowshelf │   │lowshelf │   │peaking  │   │shaper   │             │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘             │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌──────────┐            │
│  │Presence │──▶│  Air    │──▶│  Gain   │──▶│Compressor│──▶ Output  │
│  │peaking  │   │highshelf│   │         │   │          │            │
│  └─────────┘   └─────────┘   └─────────┘   └──────────┘            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Works on:** Any audio through `<audio>` element (R2, IndexedDB, direct URL)
**Does NOT work on:** YouTube iframe (sandboxed)

### Current Presets (4 presets)

| Preset | Character | Available |
|--------|-----------|-----------|
| Warm (boosted) | Bass boost | Always |
| Calm | Relaxed | Always |
| VOYEX | Full experience | Always |
| Xtreme | Max bass | Always |

### YouTube Iframe Component (YouTubeIframe.tsx)

```
Single iframe - NEVER unmounts
       │
       ├── playbackSource === 'iframe' → UNMUTED (handles audio)
       │
       └── playbackSource === 'cached' → MUTED (video only visual)

Video display modes:
- hidden: offscreen (audio only streaming)
- portrait: 208x208 overlay on BigCenterCard
- landscape: fullscreen
```

---

## TARGET ARCHITECTURE (What We Want)

### New Playback Flow

```
User plays track
       │
       ▼
┌─────────────────────────────┐
│ 1. Check IndexedDB cache    │
│    (user's local boost)     │
└─────────────────────────────┘
       │
       ├── HIT → Play from cache + EQ
       │         playbackSource = 'cached'
       │
       └── MISS ↓
              │
              ▼
┌─────────────────────────────┐
│ 2. Check R2 Edge Worker     │ ← NEW! Check collective cache
│    GET /exists/{trackId}    │
└─────────────────────────────┘
       │
       ├── HIT + quality ≥ 128kbps
       │   │
       │   └── Play R2 stream + EQ
       │       playbackSource = 'r2'
       │
       ├── HIT + quality < 128kbps (old 64kbps)
       │   │
       │   └── Play YouTube iframe
       │       + Background: Re-download to R2 (upgrade)
       │
       └── MISS ↓
              │
              ▼
┌─────────────────────────────┐
│ 3. Play YouTube Iframe      │
│    + Background: Download   │
│      to IndexedDB + R2      │
└─────────────────────────────┘
```

### Collective Storage Flow

```
User plays track (any source)
       │
       ▼
┌─────────────────────────────┐
│ Track plays ≥ 50%           │ ← Changed from 100%
│ (genuine interest)          │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ Auto-Boost triggers:        │
│ 1. Download to IndexedDB    │ ← User's device
│ 2. Upload to R2             │ ← Collective (NEW!)
└─────────────────────────────┘
       │
       ▼
Next user gets instant R2 stream
```

### Manual Boost Button Behavior

| Current State | Click Action | Result |
|---------------|--------------|--------|
| Not boosted | Tap | Download to IndexedDB + queue R2 upload |
| Downloading | Tap | Show progress |
| Boosted | Quick tap | **DJ Rewind** - play from 0:00 |
| Boosted | Long press | Options (delete, info) |

### Video Mode Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                     VIDEO MODE ACTIVE                            │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │ IndexedDB    │ │ R2 cached    │ │ Not cached   │
      │ boosted      │ │ (collective) │ │              │
      └──────────────┘ └──────────────┘ └──────────────┘
              │               │               │
              ▼               ▼               ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │ Cache audio  │ │ R2 audio     │ │ YouTube      │
      │ + muted video│ │ + muted video│ │ iframe       │
      │ (enhanced)   │ │ (enhanced)   │ │ (no enhance) │
      └──────────────┘ └──────────────┘ └──────────────┘
```

### Target Presets (3 presets)

| Preset | Character | Available |
|--------|-----------|-----------|
| **Warm** | Bass boost, smooth | Always |
| **Calm** | Relaxed, reduced bass | Always |
| **VOYEX** | Full experience, premium | **Boosted tracks only** |

### R2 Quality Metadata (NEW)

```typescript
// Edge Worker should return this on /exists/:trackId
interface R2TrackInfo {
  exists: boolean;
  bitrate: number;      // 64, 128, 192, 256, 320
  format: string;       // mp3, opus, aac
  duration: number;
  uploadedAt: string;
}

// Quality threshold
const QUALITY_THRESHOLD = 128; // kbps

// Decision
if (r2Info.bitrate >= QUALITY_THRESHOLD) {
  // Use R2 - it's good quality
} else {
  // Use YouTube + trigger background upgrade
}
```

---

## IMPLEMENTATION GAPS

### Gap 1: R2 Check Missing in Main Flow ✅ FIXED

**Before:** AudioPlayer checks IndexedDB → falls back to iframe
**After:** AudioPlayer checks IndexedDB → R2 → iframe

**File:** `src/components/AudioPlayer.tsx` line ~320
**Fix:** Call `checkR2Cache()` from `api.ts` before iframe fallback
**Commit:** Phase 1 implementation complete

### Gap 2: No R2 Upload on Boost

**Current:** Boost only saves to IndexedDB
**Target:** Boost saves to IndexedDB + uploads to R2

**File:** `src/store/downloadStore.ts`
**Fix:** Add R2 upload call after successful IndexedDB save

### Gap 3: Auto-Boost at 100% ✅ FIXED

**Before:** Background cache started immediately (wasted bandwidth on skipped tracks)
**After:** Cache triggers at 50% progress (genuine interest threshold)

**File:** `src/components/AudioPlayer.tsx`
**Fix:** Added progress listener, triggers at 50% with network preference respect
**Commit:** Phase 2 implementation complete

### Gap 4: No Quality Detection

**Current:** No bitrate info from R2
**Target:** Edge Worker returns bitrate, client decides

**File:** Edge Worker + `src/services/api.ts`
**Fix:** Update `/exists` endpoint, update `checkR2Cache()`

### Gap 5: VOYEX Available Always ✅ FIXED

**Before:** All 4 presets always available
**After:** VOYEX locked to boosted tracks, Xtreme removed

**File:** `src/components/ui/BoostSettings.tsx`
**Fix:** VOYEX button disabled with lock icon when current track not boosted
**Commit:** Phase 3 implementation complete

### Gap 6: Lottie Animations Missing ✅ FIXED

**Before:** Lucide icons only
**After:** Lottie for Warm (Fire), Calm (Sunrise)

**Files:**
- `src/components/ui/BoostSettings.tsx` - Uses LottieIcon component
- `public/lottie/sunrise.json` - Added for Calm preset
- `public/lottie/fire.json` - Used for Warm preset
**Commit:** Phase 3 implementation complete

---

## FILE REFERENCE

| File | Purpose | Key Functions |
|------|---------|---------------|
| `AudioPlayer.tsx` | Main playback, EQ | `loadTrack()`, `setupAudioEnhancement()` |
| `YouTubeIframe.tsx` | Video/fallback audio | Single iframe, never unmounts |
| `downloadStore.ts` | Boost state, IndexedDB | `boostTrack()`, `autoBoostEnabled` |
| `downloadManager.ts` | IndexedDB operations | `downloadTrack()`, `isTrackCached()` |
| `mediaCache.ts` | Temp memory cache | `precacheAhead()`, `cacheTrack()` |
| `api.ts` | R2/API calls | `checkR2Cache()`, `getAudioStream()` |
| `databaseDiscovery.ts` | Supabase 324K tracks | `getHotTracks()`, `searchTracks()` |
| `BoostSettings.tsx` | Settings UI | Presets, auto-boost toggle |
| `BoostButton.tsx` | Boost button UI | Click handlers, progress |

---

## URLS & ENDPOINTS

| Service | URL | Purpose |
|---------|-----|---------|
| R2 Edge Worker | `voyo-edge.dash-webtv.workers.dev` | Audio streaming, existence check |
| Fly.io API | `voyo-music-api.fly.dev` | Search, download proxy |
| Supabase | `anmgyxhnyhbyxzpjhxgx.supabase.co` | 324K track database |

### Edge Worker Endpoints

```
GET  /exists/{trackId}     → { exists, url, bitrate? }
GET  /audio/{trackId}?q=   → Audio stream
GET  /thumb/{trackId}?q=   → Thumbnail
POST /upload/{trackId}     → Upload to R2 (NEW - needed)
```

---

## IMPLEMENTATION PHASES

### Phase 1: Fix Playback Flow (Priority) ✅ COMPLETE
- [x] AudioPlayer: Check R2 before iframe fallback
- [x] Add `playbackSource = 'r2'` state
- [x] Apply EQ enhancement to R2 streams
- [x] YouTubeIframe: Mute when R2 playback (video-only sync)

### Phase 2: Auto-Boost at 50% ✅ COMPLETE
- [x] Progress listener in AudioPlayer
- [x] Trigger download at 0.5 threshold
- [x] Respect `downloadSetting` (always | wifi-only | ask | never)
- [x] Network type detection (wifi vs cellular)

### Phase 3: Presets & UI ✅ COMPLETE
- [x] Remove Xtreme preset (3 presets: Warm, Calm, VOYEX)
- [x] VOYEX locked to boosted tracks (shows lock icon when not boosted)
- [x] Add Lottie animations (Fire for Warm, Sunrise for Calm)
- [x] DJ Rewind on boosted track tap (seekTo(0))

### Phase 4: Collective Storage
- [ ] Edge Worker: POST /upload endpoint
- [ ] downloadStore: Upload after IndexedDB save
- [ ] Quality metadata in R2

### Phase 5: Quality Upgrade
- [ ] Edge Worker: Return bitrate in /exists
- [ ] Client: Compare bitrate to threshold
- [ ] Background upgrade for low-quality R2 tracks

---

*Document updated: 2026-01-18*
*Status: Phase 1, 2 & 3 COMPLETE - R2 check + 50% auto-boost + UI/Presets*
