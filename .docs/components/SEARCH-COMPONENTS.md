# VOYO Music - Search Components Documentation

**Last Updated**: 2025-12-19
**Component Directory**: `/home/dash/voyo-music/src/components/search/`

---

## Overview

The search component system provides a dual-portal LED strip interface for searching music and managing queue/discovery. Features hybrid local + YouTube search, drag-and-drop interactions, flying CD animations, and integration with personalization system.

---

## Component: SearchOverlayV2

**File**: `/home/dash/voyo-music/src/components/search/SearchOverlayV2.tsx`

### Purpose
Full-screen search overlay with LED strip portal zones for adding tracks to queue (purple) or discovery pool (blue). Supports hybrid search (local seed data + YouTube API), drag-and-drop, button-based actions, and flying CD animations.

---

## Sub-Components

### FlyingCD Component

**Purpose**: Animated CD disc that flies from search result to portal zone

```typescript
interface FlyingCDProps {
  thumbnail: string;                    // Album art URL
  startPos: { x: number; y: number };  // Starting position
  targetZone: 'queue' | 'discovery';   // Target portal
  onComplete: () => void;              // Completion callback
}
```

**Animation**:
- Start: Scale 1, rotate 0
- End: Scale 0.2, rotate 720deg (2 full spins)
- Duration: 0.6s
- Easing: `[0.32, 0.72, 0, 1]` (custom bezier)
- Ends at right edge of screen in queue (top 25%) or discovery (bottom 75%)

**Visual Elements**:
- Circular disc with album art
- Black center hole with white border
- Linear gradient shine overlay
- Box shadow with purple (queue) or blue (discovery) glow

---

### TrackItem Component

**Purpose**: Individual search result with drag-and-drop and action buttons

```typescript
interface TrackItemProps {
  result: SearchResult;
  index: number;
  onSelect: (result: SearchResult) => void;
  onAddToQueue: (result: SearchResult, pos: { x: number; y: number }) => void;
  onAddToDiscovery: (result: SearchResult, pos: { x: number; y: number }) => void;
  onDragStart: (result: SearchResult, thumbnail: string) => void;
  onDragUpdate: (y: number) => void;
  onDragEnd: (zone: 'queue' | 'discovery' | null, pos: { x: number; y: number }) => void;
  formatDuration: (seconds: number) => string;
  formatViews: (views: number) => string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}
```

**State**:
- `isDragging` - Tracks if item is being dragged

**Drag Behavior**:
- Horizontal drag only (`drag="x"`)
- Constraints: `left: 0, right: 100`
- Elastic: 0.2
- When dragged >50px right and released, triggers zone action

**Buttons**:
- **Add to Queue** (Purple): ListPlus icon, purple gradient
- **Add to Discovery** (Blue): Compass icon, blue gradient
- Always visible on mobile, hover-visible on desktop

**Stagger Animation**:
- Delay: `index * 0.03`
- Creates cascading entrance effect

---

## Main Component Props

```typescript
interface SearchOverlayProps {
  isOpen: boolean;      // Control overlay visibility
  onClose: () => void;  // Close callback
}
```

---

## Dependencies & Imports

**React**:
- Core: `useState`, `useRef`, `useEffect`, `useCallback`, `useMemo`, `memo`
- Performance: `memo` for TrackItem, `useCallback` for handlers, `useMemo` for seed results

**Animation**:
- `motion`, `AnimatePresence`, `useMotionValue`, `useTransform`, `PanInfo` from framer-motion

**Icons**:
- Search: `Search`, `X`, `Loader2`, `Clock`
- Actions: `Play`, `Plus`, `ListPlus`, `Compass`
- States: `Music2`, `Disc3`

**Store Integrations**:
- `usePlayerStore` - Queue management, track playback, discovery updates

**API & Services**:
- `searchMusic()` - YouTube API search
- `SearchResult` type
- `addSearchResultsToPool()` - Personalization system integration

**Data & Utils**:
- `TRACKS` - Local seed data
- `getThumb()` - YouTube thumbnail helper
- `searchCache` - LRU cache for search results

**Constants**:
- `SEARCH_HISTORY_KEY = 'voyo_search_history'`
- `MAX_HISTORY = 10`

---

## State Management

### Search State
```typescript
const [query, setQuery] = useState('');
const [results, setResults] = useState<SearchResult[]>([]);
const [isSearching, setIsSearching] = useState(false);
const [error, setError] = useState<string | null>(null);
const [searchHistory, setSearchHistory] = useState<string[]>([]);
```

### Portal Zone State
```typescript
const [activeZone, setActiveZone] = useState<'queue' | 'discovery' | null>(null);
const [queueItems, setQueueItems] = useState<Track[]>([]);
const [discoveryItems, setDiscoveryItems] = useState<Track[]>([]);
const [showQueuePreview, setShowQueuePreview] = useState(false);
const [showDiscoveryPreview, setShowDiscoveryPreview] = useState(false);
```

### Flying CD State
```typescript
const [flyingCD, setFlyingCD] = useState<{
  thumbnail: string;
  startPos: { x: number; y: number };
  targetZone: 'queue' | 'discovery';
} | null>(null);
```

### Dragging State
```typescript
const [isDraggingTrack, setIsDraggingTrack] = useState(false);
const [dragThumbnail, setDragThumbnail] = useState<string>('');
```

### Refs
```typescript
const inputRef = useRef<HTMLInputElement>(null);        // Auto-focus input
const containerRef = useRef<HTMLDivElement>(null);      // Portal zone calculations
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const abortControllerRef = useRef<AbortController | null>(null);
```

---

## Store Subscriptions

**From usePlayerStore**:
- `setCurrentTrack(track)` - Play selected track
- `addToQueue(track)` - Add to queue
- `queue` - Current queue for display
- `updateDiscoveryForTrack(track)` - Trigger discovery recommendations

---

## Core Effects

### Effect 1: Sync Queue Items
```typescript
useEffect(() => {
  setQueueItems(queue.map(q => q.track));
}, [queue]);
```
**Purpose**: Keep local queue items in sync with store

### Effect 2: Load Search History
```typescript
useEffect(() => {
  const history = localStorage.getItem(SEARCH_HISTORY_KEY);
  if (history) setSearchHistory(JSON.parse(history));
}, []);
```
**Purpose**: Load search history from localStorage on mount

### Effect 3: Focus Input
```typescript
useEffect(() => {
  if (isOpen && inputRef.current) {
    setTimeout(() => inputRef.current?.focus(), 100);
  }
  if (!isOpen) {
    setResults([]);
    setQuery('');
    setError(null);
    setActiveZone(null);
  }
}, [isOpen]);
```
**Purpose**: Auto-focus search input and reset state on open/close

### Effect 4: Show Seed Results Instantly
```typescript
useEffect(() => {
  if (seedResults.length > 0) {
    setResults(seedResults);
  }
}, [seedResults]);
```
**Purpose**: Display local seed data immediately without waiting for API

---

## Search Logic

### Hybrid Search Architecture

**Step 1: Local Seed Search** (instant):
```typescript
const searchSeedData = useCallback((searchQuery: string): SearchResult[] => {
  const query = searchQuery.toLowerCase().trim();
  if (!query) return [];

  // Search in title, artist, album, and tags
  const matches = TRACKS.filter(track => {
    const title = track.title.toLowerCase();
    const artist = track.artist.toLowerCase();
    const album = (track.album || '').toLowerCase();
    const tags = track.tags.join(' ').toLowerCase();

    return title.includes(query) ||
           artist.includes(query) ||
           album.includes(query) ||
           tags.includes(query);
  });

  // Convert Track to SearchResult format
  return matches.slice(0, 5).map(track => ({
    voyoId: track.trackId,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnail: getThumb(track.trackId),
    views: track.oyeScore,
  }));
}, []);
```

**Step 2: Memoized Seed Results** (re-compute only when query changes):
```typescript
const seedResults = useMemo(() => {
  if (!query || query.trim().length < 2) return [];
  return searchSeedData(query);
}, [query, searchSeedData]);
```

**Step 3: YouTube API Search** (cached + debounced):
```typescript
const performSearch = useCallback(async (searchQuery: string) => {
  // ... abort previous request ...

  // 1. Show seed results first
  const seedResults = searchSeedData(searchQuery);
  if (seedResults.length > 0) {
    setResults(seedResults);
  }

  // 2. Search YouTube (only if 3+ chars)
  if (searchQuery.trim().length >= 3) {
    // CHECK CACHE FIRST
    const cachedResults = searchCache.get(searchQuery);
    let youtubeResults: SearchResult[];

    if (cachedResults) {
      youtubeResults = cachedResults;  // Cache hit!
    } else {
      youtubeResults = await searchMusic(searchQuery, 15);
      searchCache.set(searchQuery, youtubeResults);  // Cache for next time
    }

    // 3. Merge results (seed first, then unique YouTube results)
    const seedIds = new Set(seedResults.map(r => r.voyoId));
    const uniqueYoutubeResults = youtubeResults.filter(r => !seedIds.has(r.voyoId));
    const mergedResults = [...seedResults, ...uniqueYoutubeResults];
    setResults(mergedResults);
    saveToHistory(searchQuery);
  }
}, [searchSeedData]);
```

**Debounced Trigger**:
```typescript
const handleSearch = (value: string) => {
  setQuery(value);

  if (value.trim().length < 2) {
    setResults([]);
  }

  // DEBOUNCED: YouTube API search (150ms delay)
  if (debounceRef.current) clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => performSearch(value), 150);
}
```

---

## Event Handlers

### handleSelectTrack
```typescript
const handleSelectTrack = useCallback((result: SearchResult) => {
  const track = resultToTrack(result);
  addSearchResultsToPool([track]);  // Add to personalization pool
  setCurrentTrack(track);
  onClose();
}, [resultToTrack, setCurrentTrack, onClose]);
```
**Purpose**: Play track immediately and add to personalization pool

### handleAddToQueue
```typescript
const handleAddToQueue = useCallback((result: SearchResult, pos: { x: number; y: number }) => {
  setFlyingCD({
    thumbnail: result.thumbnail,
    startPos: pos,
    targetZone: 'queue',
  });
}, []);
```
**Purpose**: Trigger flying CD animation to queue zone

### handleAddToDiscovery
```typescript
const handleAddToDiscovery = useCallback((result: SearchResult, pos: { x: number; y: number }) => {
  setFlyingCD({
    thumbnail: result.thumbnail,
    startPos: pos,
    targetZone: 'discovery',
  });
  const track = resultToTrack(result);
  setDiscoveryItems(prev => [track, ...prev].slice(0, 5));
  addSearchResultsToPool([track]);  // Add to pool
  updateDiscoveryForTrack(track);   // Trigger recommendations
}, [resultToTrack, updateDiscoveryForTrack]);
```
**Purpose**: Trigger CD animation, add to discovery items, update personalization

### handleFlyingCDComplete
```typescript
const handleFlyingCDComplete = useCallback(() => {
  if (flyingCD) {
    if (flyingCD.targetZone === 'queue') {
      const result = results.find(r => r.thumbnail === flyingCD.thumbnail);
      if (result) {
        const track = resultToTrack(result);
        addSearchResultsToPool([track]);
        addToQueue(track);
      }
      setShowQueuePreview(true);
      setTimeout(() => setShowQueuePreview(false), 2000);
    } else {
      setShowDiscoveryPreview(true);
      setTimeout(() => setShowDiscoveryPreview(false), 2000);
    }
  }
  setFlyingCD(null);
}, [flyingCD, results, resultToTrack, addToQueue]);
```
**Purpose**: Complete CD animation, add track to queue/discovery, show preview

### Drag Handlers
```typescript
const handleDragStart = useCallback((result: SearchResult, thumbnail: string) => {
  setIsDraggingTrack(true);
  setDragThumbnail(thumbnail);
}, []);

const handleDragUpdate = useCallback((relativeY: number) => {
  setActiveZone(relativeY < 0.5 ? 'queue' : 'discovery');
}, []);

const handleDragEnd = useCallback((zone: 'queue' | 'discovery' | null, pos: { x: number; y: number }) => {
  setIsDraggingTrack(false);

  if (zone && dragThumbnail) {
    const result = results.find(r => r.thumbnail === dragThumbnail);
    if (result) {
      setFlyingCD({
        thumbnail: dragThumbnail,
        startPos: pos,
        targetZone: zone,
      });
      if (zone === 'discovery') {
        const track = resultToTrack(result);
        setDiscoveryItems(prev => [track, ...prev].slice(0, 5));
        addSearchResultsToPool([track]);
        updateDiscoveryForTrack(track);
      }
    }
  }

  setActiveZone(null);
  setDragThumbnail('');
}, [dragThumbnail, results, resultToTrack, updateDiscoveryForTrack]);
```
**Purpose**: Handle drag lifecycle and trigger CD animation on drop

---

## Render Logic

### Layout Structure
```
AnimatePresence
  ├─ Backdrop (blur overlay)
  └─ Main Container (flex layout)
       ├─ Left Side - Search Results (flex-1)
       │    ├─ Search Header
       │    │    ├─ Title + Close button
       │    │    └─ Search Input (with loading spinner)
       │    ├─ Results List (scrollable)
       │    │    ├─ Search History (if no query)
       │    │    ├─ Empty State
       │    │    ├─ Error State
       │    │    ├─ No Results State
       │    │    ├─ Results (map TrackItem)
       │    │    └─ Loading Skeletons
       │    └─ Footer Hint
       └─ Right Side - LED Strip Portals (w-24)
            ├─ Queue Zone (Purple - Top Half)
            │    ├─ LED gradient background
            │    ├─ Animated glow lines
            │    ├─ Label + track count
            │    ├─ Preview panel (slides in)
            │    └─ Swallow animation (vortex rings)
            ├─ Divider
            └─ Discovery Zone (Blue - Bottom Half)
                 ├─ LED gradient background
                 ├─ Animated glow lines
                 ├─ Label + similar count
                 ├─ Preview panel (slides in)
                 └─ Swallow animation (vortex rings)
```

### Conditional Rendering

**Search History** (no query + history exists):
- Display up to 10 recent searches
- Clock icon + query text
- Click to re-search
- X icon to remove from history

**Empty State** (no query, no results):
- Music2 icon (large, purple)
- "Search for any song or artist"
- "Drag results to the portals →"

**Error State**:
- Red text with error message

**No Results State** (query >= 2 chars, no results):
- "No results for "{query}""
- "Try different keywords"

**Loading Skeletons** (isSearching + no results):
- 5 skeleton items with pulse animation

**Results**:
- Map over results array
- Render TrackItem for each

---

## Styling

### Backdrop
- `bg-black/70` with `backdrop-blur(20px)`
- Full screen overlay

### Search Container
- Left side: `flex-1 min-w-0` - Takes remaining space
- Right side: `w-24 flex-shrink-0` - Fixed 96px width

### Search Input
- `bg: rgba(255,255,255,0.08)`
- `border: 1px solid rgba(255,255,255,0.12)`
- `rounded-2xl`
- Purple-400 spinner when loading

### Track Items
- Default: `bg: rgba(255,255,255,0.03)`
- Hover: `bg: rgba(255,255,255,0.06)`
- Dragging: `bg: rgba(255,255,255,0.08)`
- Thumbnail: 12x12 (3rem), rounded-lg

### Action Buttons
**Queue Button**:
- Background: `linear-gradient(135deg, rgba(139,92,246,0.3) 0%, rgba(168,85,247,0.2) 100%)`
- Border: `1px solid rgba(139,92,246,0.3)`
- Hover shadow: `0 0 15px rgba(139,92,246,0.5)`

**Discovery Button**:
- Background: `linear-gradient(135deg, rgba(59,130,246,0.3) 0%, rgba(96,165,250,0.2) 100%)`
- Border: `1px solid rgba(59,130,246,0.3)`
- Hover shadow: `0 0 15px rgba(59,130,246,0.5)`

### LED Portal Zones
**Queue Zone (Purple)**:
- Background: `linear-gradient(180deg, rgba(139,92,246,0.4) 0%, rgba(139,92,246,0.1) 100%)`
- Active shadow: `inset 0 0 60px rgba(139,92,246,0.8), 0 0 30px rgba(139,92,246,0.4)`
- Inactive shadow: `inset 0 0 30px rgba(139,92,246,0.3)`

**Discovery Zone (Blue)**:
- Background: `linear-gradient(0deg, rgba(59,130,246,0.4) 0%, rgba(59,130,246,0.1) 100%)`
- Active shadow: `inset 0 0 60px rgba(59,130,246,0.8), 0 0 30px rgba(59,130,246,0.4)`
- Inactive shadow: `inset 0 0 30px rgba(59,130,246,0.3)`

**Swallow Animation** (active zone):
- 3 expanding rings
- 20px → 80px width/height
- Opacity: 0.8 → 0
- 1s duration, stagger 0.3s

**Preview Panels**:
- Slide in from right (x: 100% → 0)
- Show last 3 items
- Tiny thumbnails (6x6) + truncated titles

---

## Integration Points

### With PlayerStore
1. **Play Track**: `setCurrentTrack()` when track selected
2. **Queue Management**: `addToQueue()` when track added to queue
3. **Discovery**: `updateDiscoveryForTrack()` when track added to discovery
4. **Read Queue**: `queue` for display in preview panel

### With Personalization System
1. **Track Pool**: `addSearchResultsToPool()` for every played/queued/discovered track
2. **Recommendations**: Triggers via `updateDiscoveryForTrack()`

### With Search Cache
1. **Cache Check**: Before API call, check `searchCache.get(query)`
2. **Cache Set**: After API call, `searchCache.set(query, results)`
3. **Benefits**: Instant results for repeat searches

### With Local Storage
1. **Search History**: Save/load from `localStorage`
2. **Max 10 items**: FIFO queue
3. **Persist across sessions**

---

## Performance Optimizations

### 1. Memoization
- `useMemo` for seed results (re-compute only on query change)
- `useCallback` for all event handlers (prevent re-renders)
- `memo` wrapper for TrackItem (prevent unnecessary re-renders)

### 2. Debouncing
- 150ms delay for YouTube API calls
- Instant seed results (no debounce)
- Abort previous requests via AbortController

### 3. Caching
- LRU cache for search results
- Prevents redundant API calls
- Persists during session

### 4. Lazy Rendering
- Only render visible items (virtualization could be added)
- Stagger animation reduces initial render cost

### 5. Efficient Updates
- Direct state updates, no deep cloning
- Slice operations for bounded lists (top 5 discovery items)

---

## Search History Management

### Save to History
```typescript
const saveToHistory = (searchQuery: string) => {
  if (!searchQuery.trim()) return;
  setSearchHistory((prev) => {
    const filtered = prev.filter((q) => q !== searchQuery);
    const updated = [searchQuery, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
    return updated;
  });
};
```

### Remove from History
```typescript
onClick={(e) => {
  e.stopPropagation();
  setSearchHistory(prev => {
    const updated = prev.filter(q => q !== historyQuery);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
    return updated;
  });
}}
```

---

## Helper Functions

### resultToTrack
```typescript
const resultToTrack = useCallback((result: SearchResult): Track => ({
  id: result.voyoId,
  title: result.title,
  artist: result.artist,
  album: 'VOYO',
  trackId: result.voyoId,
  coverUrl: result.thumbnail,
  duration: result.duration,
  tags: ['search'],
  mood: 'afro',
  region: 'NG',
  oyeScore: result.views || 0,
  createdAt: new Date().toISOString(),
}), []);
```

### formatDuration
```typescript
const formatDuration = useCallback((seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}, []);
```

### formatViews
```typescript
const formatViews = useCallback((views: number): string => {
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
  if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
  return views.toString();
}, []);
```

---

## Animation Timeline

**Search Overlay Open**:
1. Backdrop fades in (0s)
2. Search container fades in (0.1s delay)
3. Portal zones slide in (0.2s delay)

**Track Results**:
- Stagger: Each item 0.03s delay
- Up to 50 results = 1.5s total stagger

**Flying CD**:
1. Scale 1 → 0.2, Rotate 0 → 720deg (0.6s)
2. Fly to portal zone
3. onComplete callback

**Portal Preview**:
1. Slide in from right (0s)
2. Show for 2s
3. Slide out

**Swallow Animation** (active zone):
- 3 rings expand infinitely
- Creates "sucking in" visual effect

---

## Error Handling

1. **Empty Query**: Clear results, no API call
2. **Short Query** (<2 chars): Show prompt to type more
3. **API Failure**: Show seed results + error message
4. **Abort Error**: Silent ignore (expected)
5. **No Results**: Show "No results" message
6. **Invalid Track Data**: Skip item in map

---

## Accessibility

1. **Keyboard Navigation**: Tab through results, Enter to select
2. **Focus Management**: Auto-focus input on open
3. **ARIA Labels**: Buttons have titles
4. **Screen Reader**: Loading states announced
5. **Touch Targets**: 44px minimum for mobile

---

## Future Enhancement Opportunities

1. **Voice Search**: Speech-to-text input
2. **Filters**: Genre, year, duration filters
3. **Sort Options**: Relevance, popularity, date
4. **Search Suggestions**: Auto-complete dropdown
5. **Advanced Search**: Boolean operators (AND, OR, NOT)
6. **Playlist Search**: Search within playlists
7. **Artist Search**: Dedicated artist view
8. **Album Search**: Full album results
9. **Lyrics Search**: Search by lyrics
10. **Virtual Scrolling**: Render only visible items

---

## Summary

SearchOverlayV2 is a highly optimized, dual-portal search interface with hybrid local+cloud search, drag-and-drop interactions, flying CD animations, and deep integration with personalization. It balances instant seed results with comprehensive YouTube search, using caching and debouncing for performance. The LED strip portal design creates a unique, gamified UX for queue and discovery management.
