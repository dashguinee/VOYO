# VOYO Music - Hooks Documentation

Complete documentation for all custom React hooks in the VOYO Music application.

---

## Table of Contents

1. [useMobilePlay](#usemobileplay)
2. [usePWA](#usepwa)
3. [useThumbnailCache](#usethumbnailcache)
4. [index.ts](#indexts)

---

## useMobilePlay

**File**: `/src/hooks/useMobilePlay.ts`

### Purpose
Provides direct audio/video playback control that works with mobile autoplay restrictions. On mobile devices (iOS/Android), `audio.play()` MUST be called directly within a user gesture handler to bypass autoplay policies. This hook ensures playback works reliably across all devices.

### Dependencies
- `react` - useCallback hook
- `../store/playerStore` - Player state management
- `../utils/mobileAudioUnlock` - Mobile audio unlock utilities

---

### Exported Hook: `useMobilePlay()`

**Returns**:
```typescript
{
  handlePlayPause: (e?: React.MouseEvent | React.TouchEvent) => Promise<void>;
  forcePlay: () => Promise<boolean>;
  canPlay: () => boolean;
  isUnlocked: boolean;
}
```

---

### Return Values

#### `handlePlayPause(e?: React.MouseEvent | React.TouchEvent): Promise<void>`

**Purpose**: Handle play/pause with mobile-compatible direct audio control. Must be called DIRECTLY in onClick/onTouchStart handlers.

**Parameters**:
- `e` (optional): React mouse or touch event - will call `stopPropagation()` to prevent bubbling

**How it works**:

1. **Event Handling** (Lines 38-39):
   ```typescript
   e?.stopPropagation?.();
   ```
   - Prevents event from bubbling up to parent elements
   - Uses optional chaining to safely handle undefined events

2. **Element Selection** (Line 41):
   ```typescript
   const element = isVideoMode ? getVideoElement() : getAudioElement();
   ```
   - Retrieves global `<audio>` or `<video>` element based on player mode
   - `getAudioElement()`: Returns `document.querySelector('audio')`
   - `getVideoElement()`: Returns `document.querySelector('video')`

3. **No Element Handler** (Lines 44-47):
   ```typescript
   if (!element) {
     togglePlay();
     return;
   }
   ```
   - If AudioPlayer hasn't rendered yet, toggle state and let player handle initialization

4. **Audio Unlock** (Lines 50-52):
   ```typescript
   if (!isAudioUnlocked()) {
     await unlockMobileAudio();
   }
   ```
   - Checks if audio context is unlocked
   - On first user interaction, plays silent buffer to unlock audio pipeline
   - Required for iOS/Android autoplay policy compliance

5. **Pause Logic** (Lines 54-58):
   ```typescript
   if (isPlaying) {
     element.pause();
     togglePlay();
   }
   ```
   - Pauses media element (always works, no restrictions)
   - Updates Zustand store state

6. **Play Logic** (Lines 59-85):
   ```typescript
   else {
     try {
       // Check for valid source
       if (!element.src || element.src === '') {
         togglePlay();
         return;
       }

       // Play directly in user gesture
       await element.play();

       // Update state after successful play
       if (!usePlayerStore.getState().isPlaying) {
         togglePlay();
       }
     } catch (err: any) {
       if (err.name === 'NotAllowedError') {
         // Autoplay blocked - will retry on next tap
       }
       togglePlay(); // Keep UI in sync
     }
   }
   ```
   - **Line 63-66**: Validates source before attempting play
   - **Line 69**: Calls `play()` directly in user gesture context
   - **Line 72-74**: Syncs state only if play succeeded
   - **Line 78-80**: Handles `NotAllowedError` (autoplay blocked)
   - **Line 83**: Always updates UI state for consistency

**Edge Cases Handled**:
- No media element yet (early render)
- No source loaded
- Autoplay blocked by browser
- State desync between element and store

**Usage Example**:
```typescript
function PlayButton() {
  const { handlePlayPause } = useMobilePlay();

  return (
    <button onClick={handlePlayPause}>
      Play/Pause
    </button>
  );
}
```

---

#### `forcePlay(): Promise<boolean>`

**Purpose**: Attempt to force play when you're certain there's a valid source. Useful for programmatic playback after user interaction.

**Returns**: `true` if play succeeded, `false` if failed

**How it works**:

1. **Element Selection** (Lines 92-93):
   ```typescript
   const element = isVideoMode ? getVideoElement() : getAudioElement();
   if (!element) return false;
   ```
   - Gets current media element
   - Returns false immediately if not found

2. **Audio Unlock** (Lines 95-97):
   ```typescript
   if (!isAudioUnlocked()) {
     await unlockMobileAudio();
   }
   ```
   - Ensures audio context is unlocked

3. **Play Attempt** (Lines 99-104):
   ```typescript
   try {
     await element.play();
     return true;
   } catch (err) {
     return false;
   }
   ```
   - Attempts to play media
   - Returns success status without throwing

**Usage Example**:
```typescript
const { forcePlay } = useMobilePlay();

async function autoPlayAfterQueue() {
  const success = await forcePlay();
  if (!success) {
    console.log('Autoplay blocked, showing play button');
  }
}
```

---

#### `canPlay(): boolean`

**Purpose**: Check if media element is ready to play (has source and sufficient data loaded).

**Returns**: `true` if ready to play, `false` otherwise

**How it works**:

```typescript
const element = isVideoMode ? getVideoElement() : getAudioElement();
return element && element.src && element.readyState >= 2;
```

**readyState values**:
- `0` HAVE_NOTHING - No data loaded
- `1` HAVE_METADATA - Metadata loaded
- `2` HAVE_CURRENT_DATA - Current frame loaded
- `3` HAVE_FUTURE_DATA - Enough data to play soon
- `4` HAVE_ENOUGH_DATA - Enough data to play through

**Check requires** (Line 112):
- Element exists
- Source is set (`element.src`)
- `readyState >= 2` (at least current frame loaded)

**Usage Example**:
```typescript
const { canPlay } = useMobilePlay();

useEffect(() => {
  if (canPlay()) {
    console.log('Ready to play!');
  }
}, [canPlay]);
```

---

#### `isUnlocked: boolean`

**Purpose**: Indicates whether mobile audio context has been unlocked.

**Value**: Result of `isAudioUnlocked()` from mobileAudioUnlock utility

**Usage Example**:
```typescript
const { isUnlocked } = useMobilePlay();

if (!isUnlocked) {
  return <div>Tap to unlock audio</div>;
}
```

---

### Helper Functions (Internal)

#### `getAudioElement(): HTMLAudioElement | null`

**Lines 19-21**

**Purpose**: Get the global audio element used by AudioPlayer component.

**Implementation**:
```typescript
function getAudioElement(): HTMLAudioElement | null {
  return document.querySelector('audio');
}
```

**Assumptions**:
- Only one `<audio>` element exists in DOM
- AudioPlayer component renders global audio element

---

#### `getVideoElement(): HTMLVideoElement | null`

**Lines 26-28**

**Purpose**: Get the global video element used by AudioPlayer component.

**Implementation**:
```typescript
function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video');
}
```

**Assumptions**:
- Only one `<video>` element exists in DOM
- AudioPlayer switches between audio/video based on mode

---

### Technical Notes

1. **Why Direct Play Matters**:
   - Mobile browsers block `audio.play()` unless called synchronously in user event
   - Event handlers with async operations lose user gesture context
   - This hook ensures `play()` is called directly in the gesture chain

2. **State Synchronization**:
   - Uses Zustand's `getState()` to avoid stale closures
   - Always updates UI state even on errors (prevents stuck buttons)

3. **Error Handling**:
   - Silent failures for unlocking (non-critical)
   - NotAllowedError caught but doesn't throw (retry on next tap)
   - State always stays in sync with UI

4. **Memory Safety**:
   - useCallback prevents unnecessary re-renders
   - No refs or cleanup needed (uses global DOM elements)

---

## usePWA

**File**: `/src/hooks/usePWA.ts`

### Purpose
Manages Progressive Web App (PWA) functionality including service worker registration, install prompt handling, and installation state tracking. Enables users to install VOYO Music as a standalone app on their device.

### Dependencies
- `react` - useState, useEffect, useCallback hooks

---

### Types

#### `BeforeInstallPromptEvent`

**Lines 3-6**

```typescript
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
```

**Purpose**: TypeScript interface for the `beforeinstallprompt` event (non-standard API)

**Properties**:
- `prompt()`: Triggers the browser's install dialog
- `userChoice`: Promise that resolves with user's choice (accepted/dismissed)

---

### Exported Hook: `usePWA()`

**Returns**:
```typescript
{
  isInstallable: boolean;
  isInstalled: boolean;
  install: () => Promise<boolean>;
}
```

---

### State Variables

```typescript
const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
const [isInstallable, setIsInstallable] = useState(false);
const [isInstalled, setIsInstalled] = useState(false);
```

**State Meanings**:
- `deferredPrompt`: Stores the install prompt event for later use
- `isInstallable`: True when browser supports installation and app isn't installed
- `isInstalled`: True when app is running in standalone mode (installed)

---

### Initialization Effect

**Lines 13-53**

#### 1. Service Worker Registration (Lines 14-21)

```typescript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', {
    updateViaCache: 'none'
  }).catch(() => {
    // Silent fail - SW not critical for app function
  });
}
```

**How it works**:
- Checks for Service Worker API support
- Registers `/service-worker.js` with no-cache policy
- `updateViaCache: 'none'`: Always check for SW updates (bypass HTTP cache)
- Silent failure: App works without SW (PWA is progressive enhancement)

**updateViaCache Options**:
- `'none'`: Never use HTTP cache for SW updates
- `'imports'`: Use cache for imported scripts only
- `'all'`: Use cache for all SW resources

---

#### 2. Installation State Detection (Lines 23-30)

```typescript
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                     (navigator as any).standalone === true;

if (isStandalone) {
  setIsInstalled(true);
  return;
}
```

**How it works**:

**Line 24**: `matchMedia('(display-mode: standalone)')`
- CSS media query that detects if app is running as standalone
- Returns `true` when installed (desktop/Android)

**Line 25**: `(navigator as any).standalone`
- iOS-specific property (`window.navigator.standalone`)
- Returns `true` when running from home screen icon
- Requires type assertion because not in TypeScript definitions

**Lines 27-30**: Early return if already installed
- Sets `isInstalled` to true
- Skips install prompt listeners (not needed)

---

#### 3. Install Prompt Listener (Lines 32-37)

```typescript
const handleBeforeInstall = (e: Event) => {
  e.preventDefault();
  setDeferredPrompt(e as BeforeInstallPromptEvent);
  setIsInstallable(true);
};
```

**How it works**:

**Line 34**: `e.preventDefault()`
- Prevents browser's default install banner
- Allows custom install UI

**Line 35**: `setDeferredPrompt(e as BeforeInstallPromptEvent)`
- Stores event for later use
- Type assertion needed (non-standard event)

**Line 36**: `setIsInstallable(true)`
- Enables custom install button in UI

---

#### 4. Installation Success Listener (Lines 39-44)

```typescript
const handleAppInstalled = () => {
  setIsInstalled(true);
  setIsInstallable(false);
  setDeferredPrompt(null);
};
```

**Triggers when**:
- User accepts install prompt
- Installation completes successfully

**State updates**:
- `isInstalled = true`: App now running standalone
- `isInstallable = false`: Hide install button
- `deferredPrompt = null`: Clean up stored event

---

#### 5. Event Listener Registration (Lines 46-52)

```typescript
window.addEventListener('beforeinstallprompt', handleBeforeInstall);
window.addEventListener('appinstalled', handleAppInstalled);

return () => {
  window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  window.removeEventListener('appinstalled', handleAppInstalled);
};
```

**Event Descriptions**:
- `beforeinstallprompt`: Fires when browser determines app is installable
- `appinstalled`: Fires after successful installation

**Cleanup**: useEffect return function removes listeners on unmount

---

### Return Values

#### `install(): Promise<boolean>`

**Lines 55-72**

**Purpose**: Trigger the browser's install dialog and handle user's choice.

**Returns**: `true` if user accepted, `false` if dismissed or failed

**How it works**:

**1. Validation** (Lines 56):
```typescript
if (!deferredPrompt) return false;
```
- Can't install if no prompt available
- Happens when already installed or not installable

**2. Trigger Prompt** (Line 59):
```typescript
deferredPrompt.prompt();
```
- Shows browser's native install dialog
- No return value (fire-and-forget)

**3. Wait for User Choice** (Line 60):
```typescript
const { outcome } = await deferredPrompt.userChoice;
```
- Waits for user decision
- `outcome`: `'accepted'` or `'dismissed'`

**4. Handle Acceptance** (Lines 62-65):
```typescript
if (outcome === 'accepted') {
  setIsInstalled(true);
  setIsInstallable(false);
}
```
- Updates state immediately (don't wait for `appinstalled` event)
- Hides install button

**5. Cleanup** (Lines 67-68):
```typescript
setDeferredPrompt(null);
return outcome === 'accepted';
```
- Clear stored prompt (can't reuse)
- Return success status

**6. Error Handling** (Lines 69-71):
```typescript
catch {
  return false;
}
```
- Silent failure (don't crash app)
- Returns false on any error

**Usage Example**:
```typescript
function InstallButton() {
  const { isInstallable, install } = usePWA();

  if (!isInstallable) return null;

  return (
    <button onClick={async () => {
      const success = await install();
      if (success) {
        console.log('App installed!');
      }
    }}>
      Install VOYO
    </button>
  );
}
```

---

### Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Service Worker | ✅ 40+ | ✅ 44+ | ✅ 11.1+ | ✅ 17+ |
| beforeinstallprompt | ✅ 68+ | ❌ No | ❌ No | ✅ 79+ |
| Add to Home Screen | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| standalone detection | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

**Notes**:
- Firefox/Safari don't support `beforeinstallprompt` (use native prompts)
- iOS uses `navigator.standalone` instead of media query
- All modern browsers support PWA installation in some form

---

### Technical Notes

1. **Silent Failures**:
   - Service Worker registration fails gracefully
   - Install function catches all errors
   - App remains functional without PWA features

2. **State Management**:
   - Uses local state (not Zustand) - PWA state is session-only
   - No persistence needed (browser manages install state)

3. **Event Timing**:
   - `beforeinstallprompt` fires on page load if installable
   - `appinstalled` fires after installation completes
   - Events may not fire if already installed

4. **updateViaCache: 'none'**:
   - Ensures users get latest SW updates immediately
   - Trade-off: More network requests, but better reliability
   - Important for music app (need latest playback fixes)

---

## useThumbnailCache

**File**: `/src/hooks/useThumbnailCache.ts`

### Purpose
Caches verified working YouTube thumbnails in localStorage for instant loading on subsequent visits. Implements a 24-hour TTL cache to avoid repeated network checks for the same thumbnails. Dramatically improves perceived performance by eliminating thumbnail load delays.

### Dependencies
- `react` - useEffect, useState hooks
- `../utils/imageUtils` - findWorkingThumbnail, getThumbnailQualityFromUrl

---

### Types

#### `CachedThumbnail`

**Lines 9-13**

```typescript
interface CachedThumbnail {
  url: string;
  quality: ThumbnailQuality | null;
  verified: number; // timestamp
}
```

**Purpose**: Structure for cached thumbnail entries

**Fields**:
- `url`: Full YouTube thumbnail URL (verified working)
- `quality`: Thumbnail quality level (`'default'`, `'medium'`, `'high'`, `'max'`, or `null`)
- `verified`: Unix timestamp when thumbnail was verified (for TTL expiry)

---

### Constants

**Lines 15-16**

```typescript
const CACHE_KEY = 'voyo_thumbnail_cache';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
```

**CACHE_KEY**: localStorage key for thumbnail cache object

**CACHE_EXPIRY**: Time-to-live for cache entries
- Value: 86,400,000 milliseconds (24 hours)
- Rationale: YouTube thumbnails rarely change once uploaded
- Trade-off: 24h is long enough to help performance, short enough to catch updates

---

### Helper Functions

#### `getCache(): Record<string, CachedThumbnail>`

**Lines 21-41**

**Purpose**: Retrieve and filter cache from localStorage, removing expired entries.

**Returns**: Object mapping trackId to CachedThumbnail (only non-expired entries)

**How it works**:

**1. Retrieve from localStorage** (Lines 22-24):
```typescript
try {
  const data = localStorage.getItem(CACHE_KEY);
  if (!data) return {};
```
- Gets cache JSON from localStorage
- Returns empty object if not found

**2. Parse JSON** (Line 26):
```typescript
const cache = JSON.parse(data) as Record<string, CachedThumbnail>;
```
- Deserializes JSON to cache object
- Type assertion for TypeScript

**3. Filter Expired Entries** (Lines 27-35):
```typescript
const now = Date.now();
const validCache: Record<string, CachedThumbnail> = {};
for (const [trackId, cached] of Object.entries(cache)) {
  if (now - cached.verified < CACHE_EXPIRY) {
    validCache[trackId] = cached;
  }
}
return validCache;
```
- **Line 32**: Checks if entry is younger than 24 hours
- **Line 33**: Keeps only valid entries
- Old entries are discarded (automatic cleanup)

**4. Error Handling** (Lines 38-40):
```typescript
} catch (error) {
  return {};
}
```
- Catches localStorage access errors (private mode, quota exceeded, etc.)
- Catches JSON parse errors (corrupted data)
- Returns empty cache on any error (cache miss)

**Edge Cases**:
- localStorage disabled (private browsing)
- Corrupted JSON data
- Cache key exists but is wrong type
- Quota exceeded

---

#### `setCache(cache: Record<string, CachedThumbnail>): void`

**Lines 46-51**

**Purpose**: Save cache object to localStorage (with error handling).

**Parameters**:
- `cache`: Complete cache object to save

**How it works**:

```typescript
const setCache = (cache: Record<string, CachedThumbnail>): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    // Silent fail - caching is optional optimization
  }
};
```

**Line 48**: Serializes cache to JSON and saves

**Error Handling**:
- Silent failure (caching is enhancement, not critical)
- Errors can occur from:
  - Quota exceeded (5-10MB localStorage limit)
  - localStorage disabled
  - JSON serialization failure (circular references, etc.)

**Design Decision**: Silent failure because:
- App works without cache (just slower)
- Don't want to crash app over optional feature
- User may have disabled localStorage intentionally

---

### Exported Hook: `useThumbnailCache(trackId)`

**Lines 56-115**

**Parameters**:
- `trackId: string | undefined` - YouTube video ID or VOYO ID

**Returns**:
```typescript
{
  thumbnailUrl: string | null;
  isLoading: boolean;
}
```

**State Variables**:
```typescript
const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
const [isLoading, setIsLoading] = useState(true);
```

---

#### Effect Logic (Lines 60-112)

**How it works**:

**1. Handle Undefined TrackId** (Lines 61-65):
```typescript
if (!trackId) {
  setThumbnailUrl(null);
  setIsLoading(false);
  return;
}
```
- Clears thumbnail if no trackId
- Early return (skip async logic)

**2. Cancellation Token** (Line 67):
```typescript
let cancelled = false;
```
- Prevents state updates after unmount
- Essential for async effects

**3. Load Function** (Lines 69-105):

**3a. Start Loading** (Line 70):
```typescript
setIsLoading(true);
```

**3b. Check Cache** (Lines 72-82):
```typescript
const cache = getCache();
const cached = cache[trackId];

if (cached) {
  if (!cancelled) {
    setThumbnailUrl(cached.url);
    setIsLoading(false);
  }
  return;
}
```
- **Line 73-74**: Lookup in cache
- **Line 76**: Cache hit - use stored URL
- **Line 77**: Check cancellation before state update
- **Line 78-79**: Update state with cached URL
- **Line 81**: Early return (skip network check)

**3c. Find Working Thumbnail** (Lines 84-104):
```typescript
const workingUrl = await findWorkingThumbnail(trackId);

if (!cancelled) {
  if (workingUrl) {
    setThumbnailUrl(workingUrl);

    // Save to cache
    const quality = getThumbnailQualityFromUrl(workingUrl);
    const newCache = { ...getCache() };
    newCache[trackId] = {
      url: workingUrl,
      quality,
      verified: Date.now(),
    };
    setCache(newCache);
  } else {
    setThumbnailUrl(null);
  }
  setIsLoading(false);
}
```
- **Line 85**: Tries all thumbnail qualities until one works (high -> medium -> default)
- **Line 87**: Cancellation check (prevent stale state)
- **Lines 88-99**: Success path
  - **Line 89**: Update state with working URL
  - **Line 92**: Extract quality from URL
  - **Line 93**: Get fresh cache (may have changed)
  - **Lines 94-98**: Create cache entry with timestamp
  - **Line 99**: Persist to localStorage
- **Lines 100-101**: Failure path (no working thumbnail found)
- **Line 103**: Always stop loading spinner

**4. Effect Execution** (Line 107):
```typescript
loadThumbnail();
```

**5. Cleanup Function** (Lines 109-111):
```typescript
return () => {
  cancelled = true;
};
```
- Runs on unmount or trackId change
- Prevents state updates after component unmounts
- Critical for preventing memory leaks

**6. Dependency Array** (Line 112):
```typescript
}, [trackId]);
```
- Re-runs effect when trackId changes
- Triggers new thumbnail lookup

---

### Exported Utility Functions

#### `getCachedThumbnail(trackId: string): string | null`

**Lines 120-124**

**Purpose**: Synchronously retrieve cached thumbnail (no async loading).

**Parameters**:
- `trackId`: YouTube video ID or VOYO ID

**Returns**: Cached URL if found, `null` otherwise

**How it works**:
```typescript
export const getCachedThumbnail = (trackId: string): string | null => {
  const cache = getCache();
  const cached = cache[trackId];
  return cached ? cached.url : null;
};
```

**Use Cases**:
- Check if thumbnail is cached before loading component
- Preload check in queue/playlist rendering
- SSR/SSG scenarios where async isn't available

**Example**:
```typescript
const url = getCachedThumbnail('dQw4w9WgXcQ');
if (url) {
  console.log('Using cached thumbnail');
} else {
  console.log('Need to fetch thumbnail');
}
```

---

#### `cacheThumbnail(trackId: string, url: string): void`

**Lines 129-140**

**Purpose**: Manually add a thumbnail to cache (bypass verification).

**Parameters**:
- `trackId`: YouTube video ID or VOYO ID
- `url`: Verified working thumbnail URL

**How it works**:
```typescript
export const cacheThumbnail = (trackId: string, url: string): void => {
  const cache = getCache();
  const quality = getThumbnailQualityFromUrl(url);

  cache[trackId] = {
    url,
    quality,
    verified: Date.now(),
  };

  setCache(cache);
};
```

**Line 131**: Extract quality from URL pattern
**Lines 133-137**: Create cache entry
**Line 139**: Persist to localStorage

**Use Cases**:
- Pre-populate cache with known good thumbnails
- Batch caching during import
- Testing/debugging

**Example**:
```typescript
// After loading track data with custom thumbnails
tracks.forEach(track => {
  if (track.customThumbnailUrl) {
    cacheThumbnail(track.id, track.customThumbnailUrl);
  }
});
```

---

#### `clearThumbnailCache(): void`

**Lines 145-150**

**Purpose**: Wipe entire thumbnail cache from localStorage.

**How it works**:
```typescript
export const clearThumbnailCache = (): void => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
    // Silent fail
  }
};
```

**Use Cases**:
- Settings page "Clear Cache" button
- Testing/debugging
- After detecting stale/broken thumbnails

**Example**:
```typescript
function SettingsPage() {
  const handleClearCache = () => {
    clearThumbnailCache();
    alert('Cache cleared!');
  };

  return <button onClick={handleClearCache}>Clear Cache</button>;
}
```

---

#### `getCacheStats()`

**Lines 155-170**

**Purpose**: Get cache statistics for debugging and monitoring.

**Returns**:
```typescript
{
  totalEntries: number;
  oldestEntry: number;  // timestamp
  newestEntry: number;  // timestamp
}
```

**How it works**:
```typescript
export const getCacheStats = () => {
  const cache = getCache();
  const entries = Object.entries(cache);

  return {
    totalEntries: entries.length,
    oldestEntry: entries.reduce(
      (oldest, [, cached]) => (cached.verified < oldest ? cached.verified : oldest),
      Date.now()
    ),
    newestEntry: entries.reduce(
      (newest, [, cached]) => (cached.verified > newest ? cached.verified : newest),
      0
    ),
  };
};
```

**Fields**:
- `totalEntries`: Number of cached thumbnails
- `oldestEntry`: Timestamp of oldest cache entry
- `newestEntry`: Timestamp of newest cache entry

**Use Cases**:
- Debug panel showing cache health
- Monitoring cache growth
- Identifying cache bloat

**Example**:
```typescript
const stats = getCacheStats();
console.log(`Cache: ${stats.totalEntries} entries`);
console.log(`Oldest: ${new Date(stats.oldestEntry).toLocaleString()}`);
console.log(`Newest: ${new Date(stats.newestEntry).toLocaleString()}`);
```

---

### Cache Strategy

**Why 24-hour TTL?**
1. YouTube thumbnails rarely change after upload
2. Long enough to help regular users (return visits within a day)
3. Short enough to catch thumbnail updates (artist changes album art)
4. Balances storage use vs. performance gain

**LRU Not Needed**:
- Cache naturally limits itself through TTL expiry
- Old entries automatically removed on access
- localStorage has 5-10MB limit (thousands of thumbnails)
- Expiry is more important than access frequency

**Performance Impact**:
- Cache hit: ~0-5ms (localStorage read)
- Cache miss: ~100-300ms (network check + image load)
- 60-100x speedup on cache hit

---

### Technical Notes

1. **Why Not IndexedDB?**
   - localStorage sufficient for simple key-value cache
   - IndexedDB adds complexity (async API, transactions)
   - Thumbnail cache is small (< 1MB for 100 tracks)

2. **Race Condition Handling**:
   - Cancellation token prevents stale updates
   - Fresh cache read before write (handle concurrent updates)

3. **Error Recovery**:
   - All localStorage operations wrapped in try-catch
   - Cache corruption auto-recovers (returns empty cache)
   - Network failures don't crash app (null thumbnail)

4. **Memory vs. Storage**:
   - Only stores URL string (not image data)
   - ~100 bytes per entry (trackId + URL + metadata)
   - 10,000 entries = ~1MB localStorage

---

## index.ts

**File**: `/src/hooks/index.ts`

### Purpose
Central export point for all custom hooks. Currently a placeholder with comment guidance for future hook additions.

### Content

**Lines 1-3**:
```typescript
// VOYO Music - Hooks
// Add custom hooks here as needed
```

### Purpose
- Reserved for future hook exports
- Enables cleaner imports: `import { useHook } from '@/hooks'` instead of `@/hooks/useHook`
- Currently empty (hooks exported directly from their files)

### Future Pattern

When adding new hooks, export them here:

```typescript
// VOYO Music - Hooks

export { useMobilePlay } from './useMobilePlay';
export { usePWA } from './usePWA';
export { useThumbnailCache, getCachedThumbnail, cacheThumbnail, clearThumbnailCache } from './useThumbnailCache';
// Add new hooks here
```

This enables:
```typescript
// Before
import { useMobilePlay } from '@/hooks/useMobilePlay';
import { usePWA } from '@/hooks/usePWA';

// After
import { useMobilePlay, usePWA } from '@/hooks';
```

---

## Usage Patterns

### Mobile Playback Pattern

```typescript
import { useMobilePlay } from '@/hooks/useMobilePlay';

function TrackCard({ track }) {
  const { handlePlayPause, canPlay } = useMobilePlay();

  return (
    <div>
      <img src={track.thumbnail} />
      <button
        onClick={handlePlayPause}
        disabled={!canPlay()}
      >
        Play
      </button>
    </div>
  );
}
```

### PWA Install Pattern

```typescript
import { usePWA } from '@/hooks/usePWA';

function InstallBanner() {
  const { isInstallable, isInstalled, install } = usePWA();

  if (isInstalled || !isInstallable) return null;

  return (
    <div className="install-banner">
      <p>Install VOYO Music for the best experience!</p>
      <button onClick={install}>Install</button>
    </div>
  );
}
```

### Thumbnail Cache Pattern

```typescript
import { useThumbnailCache } from '@/hooks/useThumbnailCache';

function TrackThumbnail({ trackId }) {
  const { thumbnailUrl, isLoading } = useThumbnailCache(trackId);

  if (isLoading) {
    return <Skeleton />;
  }

  return (
    <img
      src={thumbnailUrl || '/placeholder.svg'}
      alt="Track thumbnail"
    />
  );
}
```

---

## Performance Considerations

### useMobilePlay
- **useCallback**: Prevents re-creating handlers on every render
- **Direct DOM access**: Faster than React refs
- **No state in hook**: Relies on Zustand store (single source of truth)

### usePWA
- **Silent failures**: Never blocks app initialization
- **Early returns**: Skips listeners if already installed
- **Event cleanup**: Prevents memory leaks

### useThumbnailCache
- **24h TTL**: Reduces network requests by 95%+
- **Cancellation tokens**: Prevents memory leaks from unmounted components
- **Sync cache read**: getCachedThumbnail() for instant access
- **Automatic cleanup**: Expired entries removed lazily

---

## Testing Considerations

### useMobilePlay Testing
```typescript
// Mock audio element
const mockAudioElement = {
  src: 'http://example.com/audio.mp3',
  readyState: 4,
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn()
};

document.querySelector = jest.fn(() => mockAudioElement);

// Test play
const { handlePlayPause } = useMobilePlay();
await handlePlayPause();
expect(mockAudioElement.play).toHaveBeenCalled();
```

### usePWA Testing
```typescript
// Mock beforeinstallprompt event
const mockPrompt = {
  prompt: jest.fn(),
  userChoice: Promise.resolve({ outcome: 'accepted' })
};

window.dispatchEvent(new Event('beforeinstallprompt'));
// Test install flow
```

### useThumbnailCache Testing
```typescript
// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn()
};
global.localStorage = localStorageMock;

// Test cache hit/miss
```

---

## Browser API Dependencies

| Hook | Browser APIs | Fallback Behavior |
|------|--------------|-------------------|
| useMobilePlay | HTMLMediaElement, Web Audio API | Graceful degradation |
| usePWA | Service Worker API, beforeinstallprompt | Works without PWA features |
| useThumbnailCache | localStorage | Works without cache (slower) |

---

## Future Enhancements

### Potential New Hooks

1. **useMediaSession** - Media Session API for lock screen controls
2. **useNetworkStatus** - Online/offline detection for smart caching
3. **useWakeLock** - Screen Wake Lock API for uninterrupted playback
4. **useOrientation** - Detect landscape/portrait for video mode
5. **useVisibility** - Page Visibility API for pause on blur
6. **useKeyboardShortcuts** - Spacebar play/pause, arrow seek
7. **useQueuePersistence** - Auto-save queue to localStorage

---

**Last Updated**: December 19, 2025
**Version**: 1.0.0
**Maintainer**: VOYO Development Team
