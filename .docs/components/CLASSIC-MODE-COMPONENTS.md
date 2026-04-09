# CLASSIC MODE COMPONENTS DOCUMENTATION

## Overview
Classic Mode components provide a Spotify-style music player experience with traditional navigation and UI patterns.

---

## ClassicMode.tsx
**Path:** `/src/components/classic/ClassicMode.tsx`

### Purpose
Main container for Classic Mode that manages tab navigation and renders the appropriate view.

### State
- `activeTab`: `'home' | 'library' | 'nowPlaying'`

### Tab Components
1. **Home**: HomeFeed with recommendations and new releases
2. **Library**: Personal collection and playlists
3. **Now Playing**: Full-screen player view

### Bottom Navigation
- Home icon
- Library icon
- Now Playing icon (with pulse animation when playing)

---

## AlbumCard.tsx
**Path:** `/src/components/classic/AlbumCard.tsx`

### Purpose
Reusable card component for displaying album/track artwork with metadata.

### Props
```typescript
interface AlbumCardProps {
  track: Track;
  onPlay: (track: Track) => void;
  size?: 'small' | 'medium' | 'large';
  showArtist?: boolean;
}
```

### Features
- **Hover Effects**: Play button overlay on hover
- **Lazy Loading**: Images load only when in viewport
- **Fallback**: Graceful handling of missing artwork
- **Responsive**: Adapts to different sizes

### Layout
```
┌──────────────┐
│   Artwork    │ ← SmartImage component
│  (1:1 ratio) │
│    [▶]       │ ← Play button (hover)
├──────────────┤
│ Track Title  │
│ Artist Name  │ (if showArtist)
└──────────────┘
```

---

## HomeFeed.tsx
**Path:** `/src/components/classic/HomeFeed.tsx`

### Purpose
Main discovery feed with horizontal scrollable sections for different content types.

### Sections
1. **New Releases** (top carousel)
2. **Recommended for You** (personalized)
3. **Trending Now** (popularity-based)
4. **Recently Played** (history)

### Key Functions

#### `getRecommendations()`
Fetches personalized tracks based on user preferences:
```typescript
const getRecommendations = () => {
  const preferences = usePreferenceStore.getState().trackPreferences;
  const liked = Object.entries(preferences)
    .filter(([_, p]) => p.explicitLike || p.reactions > 5)
    .map(([trackId, _]) => trackId);
  // Returns similar tracks
};
```

#### Horizontal Scroll Sections
Each section uses:
```tsx
<div className="flex gap-4 overflow-x-auto snap-x">
  {tracks.map(track => (
    <AlbumCard key={track.id} track={track} size="medium" />
  ))}
</div>
```

---

## Hub.tsx
**Path:** `/src/components/classic/Hub.tsx`

### Purpose
Social hub showing activity from followed users and community.

### Features
- **Activity Feed**: Recent plays, likes, playlists from network
- **Trending Tracks**: Community-wide popular tracks
- **User Suggestions**: Discover new users to follow

### State
```typescript
const [activityFeed, setActivityFeed] = useState<Activity[]>([]);
const [trendingTracks, setTrendingTracks] = useState<Track[]>([]);
```

### Activity Types
```typescript
interface Activity {
  id: string;
  username: string;
  type: 'play' | 'like' | 'playlist';
  track?: Track;
  timestamp: number;
}
```

---

## Library.tsx
**Path:** `/src/components/classic/Library.tsx`

### Purpose
Personal collection manager with playlists, liked songs, and downloads.

### Tabs
1. **Playlists**: User-created playlists
2. **Liked Songs**: Favorited tracks
3. **Downloaded**: Offline-available tracks
4. **History**: Recently played

### Key Features

#### Playlist Management
```typescript
const { playlists, createPlaylist, deletePlaylist } = usePlaylistStore();
```

#### Liked Songs Filter
```typescript
const likedTracks = useMemo(() => {
  return Object.entries(trackPreferences)
    .filter(([_, p]) => p.explicitLike === true)
    .map(([trackId, _]) => findTrackById(trackId))
    .filter(Boolean);
}, [trackPreferences]);
```

#### Downloaded Tracks
```typescript
const { downloads } = useDownloadStore();
const downloadedTracks = downloads.map(d => d.track);
```

### Layout
```
┌─────────────────────────────┐
│ [Playlists] [Liked] [DLs]   │ ← Tab bar
├─────────────────────────────┤
│ ┌─────────┐ ┌─────────┐     │
│ │ Track 1 │ │ Track 2 │     │ ← Grid/List view
│ └─────────┘ └─────────┘     │
│ ┌─────────┐ ┌─────────┐     │
│ │ Track 3 │ │ Track 4 │     │
│ └─────────┘ └─────────┘     │
└─────────────────────────────┘
```

---

## NowPlaying.tsx
**Path:** `/src/components/classic/NowPlaying.tsx`

### Purpose
Full-screen now playing view with album art, controls, and lyrics.

### Layout Structure
```
┌─────────────────────────────┐
│      [Background Blur]      │
├─────────────────────────────┤
│                             │
│      ┌───────────┐          │
│      │  Album    │          │ ← Large artwork
│      │   Art     │          │
│      └───────────┘          │
│                             │
│     Track Title             │
│     Artist Name             │
│                             │
│  ════════○══════            │ ← Progress bar
│  0:00          3:45         │
│                             │
│   [⏮] [⏯] [⏭]              │ ← Playback controls
│                             │
│   [🔀] [🔁] [🔊]            │ ← Shuffle/Repeat/Volume
│                             │
└─────────────────────────────┘
```

### Key Components

#### Progress Bar
```typescript
const ProgressBar = () => {
  const { progress, duration, seekTo } = usePlayerStore();

  return (
    <input
      type="range"
      min="0"
      max={duration}
      value={currentTime}
      onChange={(e) => seekTo(parseFloat(e.target.value))}
    />
  );
};
```

#### Playback Controls
Uses `PlaybackControls` component with:
- Previous track
- Play/Pause (large center button)
- Next track
- Shuffle toggle
- Repeat cycle
- Volume slider

#### Lyrics Panel (Optional)
```typescript
const [showLyrics, setShowLyrics] = useState(false);

// Fetches lyrics from service
const fetchLyrics = async (trackId: string) => {
  const lyrics = await lyricsAPI.fetch(trackId);
  setLyrics(lyrics);
};
```

---

## SHARED PATTERNS

### Navigation Pattern
All Classic Mode components use bottom tab navigation:
```typescript
const handleTabChange = (tab: ClassicTab) => {
  setActiveTab(tab);
  // Persist to localStorage
  localStorage.setItem('voyo-classic-tab', tab);
};
```

### Track Actions
Consistent track action menu across components:
- Play Now
- Add to Queue
- Add to Playlist
- Like/Unlike
- Download
- Share

### Loading States
All components use skeleton loaders:
```tsx
{isLoading ? (
  <div className="skeleton-card animate-pulse" />
) : (
  <AlbumCard track={track} />
)}
```

### Error Handling
Graceful degradation for missing data:
```typescript
if (!track) return <EmptyState message="Track not found" />;
if (error) return <ErrorState error={error} onRetry={refetch} />;
```

---

## PERFORMANCE OPTIMIZATIONS

### Virtual Scrolling
Large lists use virtual scrolling:
```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={tracks.length}
  itemSize={80}
>
  {({ index, style }) => (
    <div style={style}>
      <TrackRow track={tracks[index]} />
    </div>
  )}
</FixedSizeList>
```

### Image Lazy Loading
All images use `SmartImage` component with intersection observer.

### Memoization
Expensive computations memoized:
```typescript
const sortedTracks = useMemo(() => {
  return [...tracks].sort((a, b) =>
    b.playCount - a.playCount
  );
}, [tracks]);
```

---

## ACCESSIBILITY

- **Keyboard Navigation**: All interactive elements keyboard-accessible
- **ARIA Labels**: Descriptive labels for screen readers
- **Focus Management**: Proper focus states on tab changes
- **Color Contrast**: WCAG AA compliant contrast ratios

---

## MOBILE CONSIDERATIONS

- **Touch Targets**: Minimum 44px hit areas
- **Swipe Gestures**: Swipe to reveal track actions
- **Bottom Sheet**: Modal actions use bottom sheets on mobile
- **Safe Areas**: Respects notch/home indicator spacing
