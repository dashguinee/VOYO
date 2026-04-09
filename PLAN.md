# VOYO Artist Discovery System — Implementation Plan

## Overview

Artists become first-class entities in VOYO. Users can discover artists, see their tracks we already have, tap "Discover More" to search YouTube, and any track listened to >30s auto-downloads to R2.

## Current State

| Asset | Count |
|-------|-------|
| Tracks in video_intelligence | 329,331 |
| Tracks with `matched_artist` | ~15,000+ (enriched by artist_master) |
| Artist master profiles | 130 (with country, genre, vibe scores) |
| Distinct artists in moments | 278 |
| Moments with parent_track_id | 1,408 |
| All tracks have audio in R2 | Yes (324K) |

**Existing infra we build on:**
- `searchMusic()` in api.ts → YouTube search via Fly.io backend
- `searchArtistAlbums()` in piped.ts → Piped API album search
- AudioPlayer.tsx → R2 streaming + YouTube iframe fallback chain
- Edge Worker → `/r2/audio/{id}` and `/r2/feed/{id}` streaming
- artist_master.json → 130 curated profiles with vibe/cultural data

## Architecture

```
┌─────────────────────────────────────────────────┐
│                ARTIST PROFILE PAGE               │
│  ┌──────────┐  ┌─────────────────────────────┐  │
│  │ Artist   │  │ Country · Genre · Tier      │  │
│  │ Avatar   │  │ 47 tracks · 12 moments      │  │
│  └──────────┘  └─────────────────────────────┘  │
│                                                  │
│  ═══ OUR LIBRARY ═══                            │
│  [Track 1 ▶] [Track 2 ▶] [Track 3 ▶] ...       │
│                                                  │
│  ═══ MOMENTS ═══                                │
│  [Moment card] [Moment card] [Moment card]      │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │    🔍 DISCOVER MORE ON YOUTUBE           │   │
│  │    Search results appear here            │   │
│  │    [Result 1 ▶] [Result 2 ▶] ...        │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Listen >30s → auto-cache to R2                 │
└─────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Artist Data Layer (Supabase + Hook)

**File: `src/hooks/useArtist.ts`** (NEW)

Hook that aggregates artist data from multiple sources:
```typescript
useArtist(artistName: string) → {
  profile: ArtistProfile | null,   // From artist_master.json
  tracks: Track[],                  // From video_intelligence WHERE matched_artist
  moments: Moment[],               // From voyo_moments WHERE parent_track_artist
  stats: { trackCount, momentCount, totalPlays },
  isLoading: boolean
}
```

- Query `video_intelligence?matched_artist=eq.{name}&order=voyo_play_count.desc`
- Query `voyo_moments?parent_track_artist=eq.{name}&order=heat_score.desc`
- Merge with static `artist_master.json` data (already loaded client-side)
- No new Supabase table needed — artist_master.json + existing tables are enough

### Step 2: Artist Profile Page Component

**File: `src/components/voyo/ArtistPage.tsx`** (NEW)

Sections:
1. **Header**: Avatar (generated from name initials + country flag), name, country, genre, tier badge
2. **Our Library**: Horizontal scrollable track cards from video_intelligence. Tap → play via existing playerStore
3. **Moments**: Horizontal scrollable moment thumbnails. Tap → jump into moments feed for that artist
4. **Discover More**: Button that triggers YouTube search for `"{artistName}" music`

Design: Dark background, consistent with VoyoMoments aesthetic. Framer-motion entrance animations.

### Step 3: YouTube Discovery + Auto-Download Pipeline

**In ArtistPage.tsx — "Discover More" section:**

When user taps "Discover More":
1. Call `searchMusic(artistName)` → returns YouTube results
2. Display results in a scrollable list (thumbnail, title, duration)
3. Tap any result → plays via existing AudioPlayer (YouTube iframe or R2 if cached)

**Auto-download trigger** (in AudioPlayer.tsx):
- Track `currentTime` on the playing track
- When `currentTime > 30` AND track is from YouTube (not R2):
  - POST to Edge Worker: `/r2/cache-request` with `{ youtube_id, artist, title }`
  - Worker queues the download (or we do it client-side via a background fetch to our Fly.io backend)
  - Next time user plays → served from R2

**Simpler v1 approach**: Instead of real-time download, just log the "listened >30s" event to `video_intelligence` (set a flag like `user_requested: true`). A nightly batch script downloads all flagged tracks. This is more robust and doesn't need real-time infra.

### Step 4: Artist Discovery Entry Points

**How users find artists:**

1. **From Moments**: Tapping artist name on a MomentCard → opens ArtistPage
2. **From Now Playing**: Artist name is tappable → opens ArtistPage
3. **From Search**: Add "Artists" section to SearchOverlayV2 that fuzzy-matches artist_master
4. **Artist Browse**: New section in HomeFeed/ClassicMode → grid of artist cards filtered by country/genre

**Implementation:**
- Add `onArtistTap` prop to MomentCard in VoyoMoments.tsx
- Add `onArtistTap` to NowPlaying/VoyoPortraitPlayer
- Add artist section to SearchOverlayV2 (query artist_master.json + `video_intelligence?matched_artist=ilike.*query*`)
- ArtistPage rendered as an overlay/modal (like search overlay) — no routing needed

### Step 5: Listen-30s Tracking

**File: `src/components/AudioPlayer.tsx`** (MODIFY)

Add a `useEffect` that watches `currentTime`:
```typescript
// In AudioPlayer, after track starts playing:
const listened30sRef = useRef(false);

useEffect(() => {
  if (currentTime >= 30 && !listened30sRef.current && currentTrack) {
    listened30sRef.current = true;
    // Mark track as "user-validated" in video_intelligence
    videoIntelligenceAPI.markListened(currentTrack.id);
    // If not in R2, flag for download
    if (playbackSource === 'youtube') {
      videoIntelligenceAPI.flagForDownload(currentTrack.id);
    }
  }
}, [currentTime]);

// Reset on track change
useEffect(() => { listened30sRef.current = false; }, [currentTrack?.id]);
```

**Backend script** (`scripts/download-flagged.cjs`):
- Queries `video_intelligence` for tracks flagged for download
- Downloads audio via yt-dlp
- Uploads to R2
- Clears flag

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useArtist.ts` | CREATE | Artist data aggregation hook |
| `src/components/voyo/ArtistPage.tsx` | CREATE | Artist profile page component |
| `src/components/AudioPlayer.tsx` | MODIFY | Add 30s listen tracking |
| `src/components/voyo/feed/VoyoMoments.tsx` | MODIFY | Add onArtistTap to MomentCard |
| `src/components/search/SearchOverlayV2.tsx` | MODIFY | Add artist search results section |
| `src/lib/supabase.ts` | MODIFY | Add markListened + flagForDownload APIs |
| `scripts/download-flagged.cjs` | CREATE | Batch download flagged tracks |

## Execution Order

1. **useArtist.ts** → data layer first (no UI dependency)
2. **ArtistPage.tsx** → the main component
3. **VoyoMoments.tsx** → wire artist tap from moments
4. **AudioPlayer.tsx** → 30s tracking
5. **supabase.ts** → API helpers
6. **SearchOverlayV2.tsx** → artist search integration
7. **download-flagged.cjs** → batch download script

## What We're NOT Doing (Keep Simple)

- No new Supabase table for artists (artist_master.json + video_intelligence is enough)
- No artist images/photos (use generated avatars from initials + country flag)
- No artist following/favorites (can add later)
- No real-time download on 30s (batch is more robust)
- No artist editing/admin UI
