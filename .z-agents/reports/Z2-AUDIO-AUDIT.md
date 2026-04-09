# Z2 Audio/Playback Audit Report
**VOYO Music - Complete Audio System Analysis**

**Date:** 2025-12-13
**Agent:** Z2 (Audio/Playback Specialist)
**Codebase:** /home/dash/voyo-music

---

## Executive Summary

The VOYO Music audio system uses a **hybrid playback architecture** combining:
1. **HTML5 Audio** for boosted/cached tracks (IndexedDB)
2. **YouTube IFrame API** for unboosted tracks (streaming)
3. **IndexedDB** for offline "Boost" caching system

**Overall Assessment:** The architecture is sound, but there are **critical race conditions, memory leaks, and state synchronization issues** that can cause playback failures, especially on mobile.

---

## Critical Issues (Blocking Playback)

### 🔴 CRITICAL-1: IFrame Player Not Waiting for API Ready
**File:** `src/components/AudioPlayer.tsx:70-75`
**Impact:** HIGH - IFrame playback fails silently

```typescript
const initIframePlayer = useCallback((videoId: string) => {
  if (!(window as any).YT?.Player) {
    console.log('[VOYO] YT API not ready, retrying...');
    setTimeout(() => initIframePlayer(videoId), 500);  // ⚠️ UNBOUNDED RETRY
    return;
  }
```

**Problems:**
- No retry limit - can infinite loop
- No timeout handling - user waits forever if API fails to load
- No error state set - UI doesn't know playback failed
- `isPlaying` state not updated - play button shows wrong state

**Consequence:** On slow connections or if YouTube blocks the IFrame API, user taps play but nothing happens. UI shows "playing" but audio is silent.

---

### 🔴 CRITICAL-2: Race Condition Between Track Load and Play State
**File:** `src/components/AudioPlayer.tsx:131-199`
**Impact:** HIGH - Play/pause broken on mobile

**The Race:**
```typescript
// Effect 1: Loads track (async)
useEffect(() => {
  const loadTrack = async () => {
    if (!currentTrack?.trackId) return;
    if (loadingRef.current) return;  // ⚠️ BLOCKS CONCURRENT LOADS
    if (currentVideoId.current === currentTrack.trackId) return;

    loadingRef.current = true;
    // ... async operations ...
    loadingRef.current = false;  // ⚠️ SET IN FINALLY, BUT...
  };
}, [currentTrack?.trackId]);

// Effect 2: Handles play/pause (runs independently)
useEffect(() => {
  if (playbackMode === 'cached' && audioRef.current) {
    if (isPlaying) {
      audioRef.current.play();  // ⚠️ MAY RUN BEFORE SRC IS SET
    }
  }
}, [isPlaying, playbackMode]);
```

**Scenario:**
1. User taps track → `setCurrentTrack()` → `isPlaying=true`
2. Effect 1 starts loading (async)
3. Effect 2 runs immediately → tries to play → **NO SRC YET** → fails
4. Track loads → src set → but play already failed → **no playback**

**Mobile Impact:** On mobile, `audio.play()` MUST be called in the user gesture handler. By the time the track loads, the gesture context is lost → `NotAllowedError`.

---

### 🔴 CRITICAL-3: YouTube IFrame Player Destroyed Without Cleanup
**File:** `src/components/AudioPlayer.tsx:78-83`
**Impact:** MEDIUM - Memory leaks, event handler pollution

```typescript
if (playerRef.current) {
  try {
    playerRef.current.destroy();  // ⚠️ DESTROYS PLAYER
  } catch (e) {
    // Ignore  // ⚠️ IGNORES ERRORS
  }
}
```

**Missing Cleanup:**
- IFrame `onStateChange` handlers still fire after destroy
- No check if player is still referenced by YouTube's internal state
- No removal of event listeners (they persist in memory)
- `playerRef.current = null` not set after destroy

**Consequence:** Destroyed players continue firing events → calling `nextTrack()` → loading new tracks when user didn't ask for them.

---

### 🔴 CRITICAL-4: Boost Download Progress Not Updating UI State
**File:** `src/store/downloadStore.ts:200-208`
**Impact:** MEDIUM - UI frozen during downloads

```typescript
const success = await downloadTrack(
  trackId,
  proxyUrl,
  { title, artist, duration, thumbnail, quality: 'boosted' },
  'boosted',
  (progress) => {
    const currentDownloads = new Map(get().downloads);  // ⚠️ CREATES NEW MAP
    currentDownloads.set(trackId, {
      trackId,
      progress,
      status: 'downloading',
    });
    set({ downloads: currentDownloads });  // ⚠️ TRIGGERS RE-RENDER ON EVERY %
  }
);
```

**Problems:**
- `new Map()` on every progress update → expensive
- Zustand `set()` called 100 times (0-100%) → triggers 100 re-renders
- No throttling/debouncing → UI freezes
- Progress updates can arrive out-of-order → UI jumps around

---

### 🔴 CRITICAL-5: No Error Recovery for Failed IFrame Playback
**File:** `src/components/AudioPlayer.tsx:122-125`
**Impact:** HIGH - User stuck on broken track

```typescript
onError: (event: any) => {
  console.error('[VOYO IFrame] Error:', event.data);
  setBufferHealth(0, 'emergency');  // ⚠️ SETS HEALTH BUT...
},
```

**Missing:**
- No automatic skip to next track
- No retry attempt with different quality
- No fallback to cached version (if exists)
- No user notification ("This track is unavailable")
- `isPlaying` state not set to false → UI still shows "playing"

**User Experience:** Track errors → infinite loading spinner → user has to manually skip.

---

## State Management Issues

### ⚠️ STATE-1: Double Space Bug in Notion Not Handled
**File:** Not in codebase (mentioned in CLAUDE.md)
**Impact:** LOW - But shows integration risks

The backend integrates with Notion which has a schema bug: `Date de  Reabonnement` (double space). While not directly audio-related, this shows:
- External API quirks not documented in code
- No schema validation layer
- Tight coupling to buggy external schemas

---

### ⚠️ STATE-2: `seekPosition` State Not Cleared on Track Change
**File:** `src/store/playerStore.ts:175-185`
**Impact:** MEDIUM - Seek position from old track applied to new track

```typescript
setCurrentTrack: (track) => {
  const state = get();
  if (state.currentTrack) {
    get().addToHistory(state.currentTrack, state.currentTime);
  }
  set({ currentTrack: track, isPlaying: true, progress: 0, currentTime: 0 });
  // ⚠️ seekPosition NOT CLEARED
  get().updateDiscoveryForTrack(track);
},
```

**Scenario:**
1. User seeks to 2:30 in Track A
2. User switches to Track B
3. `seekPosition` still = 2:30
4. AudioPlayer seeks Track B to 2:30 → starts mid-song

---

### ⚠️ STATE-3: Buffer Health Not Updated for Cached Playback
**File:** `src/components/AudioPlayer.tsx:301-316`
**Impact:** LOW - Misleading UI indicators

Buffer health handlers only attached to `audioRef` (cached mode):
```typescript
const handleProgress = useCallback(() => {
  const el = audioRef.current;
  if (!el || !el.buffered.length) return;
  // ... calculate buffer health ...
  setBufferHealth(100, 'healthy');
}, [setBufferHealth]);
```

But IFrame mode uses a **polling interval** (line 254-274) that doesn't check buffer health → IFrame tracks always show "100% healthy" even when buffering.

**Result:** User sees green "healthy" indicator while IFrame is buffering → misleading.

---

### ⚠️ STATE-4: `loadingRef` Prevents Track Switching Mid-Load
**File:** `src/components/AudioPlayer.tsx:134`
**Impact:** MEDIUM - User can't skip during load

```typescript
if (loadingRef.current) return;  // ⚠️ BLOCKS NEW LOADS
```

**Scenario:**
1. User taps Track A → starts loading (slow network)
2. User changes mind, taps Track B
3. `loadingRef.current = true` → Track B load **blocked**
4. Track A finishes loading → plays Track A (user wanted Track B)

**Fix Needed:** Each track load should have its own abort controller, not a single flag.

---

### ⚠️ STATE-5: Volume Changes Not Applied During Track Load
**File:** `src/components/AudioPlayer.tsx:224-235`
**Impact:** LOW - Volume resets briefly

Volume effect depends on `playerRef.current` existing:
```typescript
useEffect(() => {
  if (playbackMode === 'iframe' && playerRef.current) {
    try {
      playerRef.current.setVolume(volume);
    } catch (e) {
      // Player not ready yet  // ⚠️ VOLUME CHANGE LOST
    }
  }
}, [volume, playbackMode]);
```

If user changes volume while track is loading → change is ignored → volume resets when track loads.

---

## Memory Leaks

### 💧 LEAK-1: Blob URLs Not Revoked After Cached Playback
**File:** `src/services/downloadManager.ts:94-118`
**Impact:** MEDIUM - Memory grows unbounded

```typescript
export async function getCachedTrackUrl(trackId: string): Promise<string | null> {
  // ... get blob from IndexedDB ...
  if (cached?.blob) {
    const url = URL.createObjectURL(cached.blob);  // ⚠️ CREATES BLOB URL
    resolve(url);  // ⚠️ NEVER REVOKED
  }
}
```

**Problem:** Every time a cached track plays, a new blob URL is created. These URLs are **never revoked** → memory leak.

**Memory Growth:**
- Average song: 5MB
- Play 20 cached songs: 100MB+ of blob URLs in memory
- On mobile: Browser kills tab when memory limit hit

**Fix:** Store blob URL in component state, revoke on unmount.

---

### 💧 LEAK-2: IFrame Time Tracking Interval Not Cleaned Up
**File:** `src/components/AudioPlayer.tsx:253-274`
**Impact:** MEDIUM - Intervals pile up

```typescript
useEffect(() => {
  if (playbackMode !== 'iframe') return;

  const interval = setInterval(() => {
    // ... update time ...
  }, 250);

  return () => clearInterval(interval);  // ✅ CLEANUP EXISTS BUT...
}, [playbackMode, setCurrentTime, setDuration, setProgress]);
```

**Problem:** Effect dependencies include `setCurrentTime`, `setDuration`, `setProgress`. These functions are **recreated** by Zustand on every store update → effect re-runs → old interval cleared, new one created.

**Result:** On a store update every 250ms, the cleanup runs every 250ms → excessive interval churn.

**Fix:** Wrap store setters in `useCallback` or exclude from deps.

---

### 💧 LEAK-3: AudioEngine Preload Cache Never Freed
**File:** `src/services/audioEngine.ts:232-339`
**Impact:** HIGH - Memory grows with every preload

```typescript
async preloadTrack(trackId: string, ...): Promise<void> {
  // ... download track ...
  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  const blobUrl = URL.createObjectURL(blob);

  this.preloadCache.set(trackId, blobUrl);  // ⚠️ NEVER REMOVED
  // No automatic cleanup, no LRU eviction
}
```

**Problem:** AudioEngine is a **singleton**. Preloaded tracks stay in memory for entire session.

**Memory Growth:**
- User plays 50 tracks → 50 blobs in memory
- Average 5MB per track → 250MB
- Mobile: Tab killed

**Fix:** Implement LRU cache with max size (e.g., keep last 10 tracks).

---

### 💧 LEAK-4: Event Listeners Not Removed on Component Unmount
**File:** `src/store/playerStore.ts:529-532`
**Impact:** LOW - Minor leak

```typescript
connection.addEventListener?.('change', () => {
  get().detectNetworkQuality();  // ⚠️ LISTENER NEVER REMOVED
});
```

If user navigates away from player, the `connection` listener persists → memory leak.

---

### 💧 LEAK-5: IndexedDB Transactions Left Open
**File:** `src/services/downloadManager.ts:173-232`
**Impact:** LOW - Browser handles cleanup, but sloppy

```typescript
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value.buffer.slice(...));  // ⚠️ SLICING CREATES COPIES
}
```

**Problem:** `value.buffer.slice()` creates a **copy** of the ArrayBuffer. For a 5MB file, this creates 5MB of temporary memory per chunk → 100+ chunks → high memory usage during download.

**Fix:** Push `value` directly (it's already a Uint8Array), no need to slice.

---

## Mobile-Specific Issues

### 📱 MOBILE-1: Play Called Outside User Gesture Context
**File:** `src/components/AudioPlayer.tsx:202-222`
**Impact:** CRITICAL - Mobile playback fails

```typescript
useEffect(() => {
  if (playbackMode === 'cached' && audioRef.current) {
    if (isPlaying) {
      audioRef.current.play().catch(err => {  // ⚠️ NOT IN GESTURE
        console.error('[VOYO] Play failed:', err);
      });
    }
  }
}, [isPlaying, playbackMode]);
```

**iOS/Android Requirement:** `audio.play()` must be called **directly** in a user gesture handler (onClick, onTouchEnd).

**Current Flow:**
1. User taps play button → `togglePlay()` → updates store → triggers effect
2. Effect runs **asynchronously** (next tick) → **gesture context lost**
3. `audio.play()` → `NotAllowedError: The request is not allowed by the user agent`

**Fix:** Use `useMobilePlay.ts` hook (already exists!) which calls `audio.play()` directly in onClick.

---

### 📱 MOBILE-2: Mobile Audio Unlock Not Called on First Interaction
**File:** `src/utils/mobileAudioUnlock.ts:57-66`
**Impact:** HIGH - First play always fails

```typescript
export function setupMobileAudioUnlock(): void {
  const unlockHandler = () => {
    unlockMobileAudio();
    document.removeEventListener('touchstart', unlockHandler);
    document.removeEventListener('click', unlockHandler);
  };

  document.addEventListener('touchstart', unlockHandler, { once: true, passive: true });
  document.addEventListener('click', unlockHandler, { once: true });
}
```

**Problem:** `setupMobileAudioUnlock()` is defined but **never called** in the app. Grepping the codebase shows no usage.

**Result:** Mobile audio is never unlocked → first play always fails.

---

### 📱 MOBILE-3: IFrame Autoplay Blocked on Mobile
**File:** `src/components/AudioPlayer.tsx:94`
**Impact:** HIGH - IFrame playback doesn't start

```typescript
playerVars: {
  autoplay: isPlaying ? 1 : 0,  // ⚠️ IGNORED ON MOBILE
  // ...
}
```

**Mobile Restriction:** YouTube IFrame `autoplay: 1` is **blocked** on mobile unless the video is muted or user has interacted with the domain.

**Result:** IFrame created with `autoplay: 1` → YouTube blocks it → video doesn't play → user sees loading spinner forever.

**Fix:** On mobile, call `player.playVideo()` in the `onReady` handler (already done at line 107, but autoplay=1 should be removed).

---

### 📱 MOBILE-4: Buffer Health Calculation Wrong for IFrame
**File:** `src/components/AudioPlayer.tsx:109`
**Impact:** LOW - Misleading UI

```typescript
onReady: (event: any) => {
  event.target.setVolume(volume);
  if (isPlaying) {
    event.target.playVideo();
  }
  setBufferHealth(100, 'healthy');  // ⚠️ ALWAYS 100%
}
```

**Problem:** IFrame buffer health is hardcoded to `100%` in `onReady`. YouTube IFrame API **does** provide buffer info via `getVideoLoadedFraction()` but it's not used.

**Result:** User on slow connection → IFrame buffering → UI shows "100% healthy" → user confused why playback is choppy.

---

## Seek Functionality Issues

### ⏩ SEEK-1: Seek Position Not Validated Against Duration
**File:** `src/components/AudioPlayer.tsx:238-251`
**Impact:** MEDIUM - Seeking past end causes errors

```typescript
useEffect(() => {
  if (seekPosition === null) return;

  if (playbackMode === 'cached' && audioRef.current) {
    audioRef.current.currentTime = seekPosition;  // ⚠️ NO VALIDATION
  } else if (playbackMode === 'iframe' && playerRef.current) {
    try {
      playerRef.current.seekTo(seekPosition, true);  // ⚠️ NO VALIDATION
    } catch (e) {
      // Player not ready yet
    }
  }
  clearSeekPosition();
}, [seekPosition, clearSeekPosition, playbackMode]);
```

**Problem:** No check if `seekPosition > duration`. User can seek to 5:00 on a 3:30 track.

**Result:**
- HTML5 Audio: Clamps to end, fires `ended` event → skips to next track
- IFrame: Seeks to end → fires `onStateChange(ENDED)` → skips to next track

**User Experience:** User tries to seek → track skips instead.

---

### ⏩ SEEK-2: Rapid Seeks Create Race Condition
**File:** `src/store/playerStore.ts:195-196`
**Impact:** MEDIUM - Seek jumps around

```typescript
seekTo: (time) => set({ seekPosition: time, currentTime: time }),
clearSeekPosition: () => set({ seekPosition: null }),
```

**Scenario:**
1. User drags seek bar → calls `seekTo(30)` → `seekTo(31)` → `seekTo(32)` (rapid)
2. Effect runs for `seekPosition=30` → starts seeking
3. Effect runs for `seekPosition=31` → starts seeking (30 not done yet)
4. Effect runs for `seekPosition=32` → starts seeking (31 not done yet)
5. All 3 seeks complete out of order → playback jumps around

**Fix:** Debounce seek requests or cancel pending seeks.

---

## Volume Control Issues

### 🔊 VOLUME-1: Volume State Out of Sync with Audio Element
**File:** `src/components/AudioPlayer.tsx:224-235`
**Impact:** LOW - Volume occasionally wrong

```typescript
useEffect(() => {
  if (playbackMode === 'cached' && audioRef.current) {
    audioRef.current.volume = volume / 100;
  } else if (playbackMode === 'iframe' && playerRef.current) {
    try {
      playerRef.current.setVolume(volume);
    } catch (e) {
      // Player not ready yet  // ⚠️ VOLUME NOT APPLIED
    }
  }
}, [volume, playbackMode]);
```

**Problem:** If `playerRef.current` doesn't exist when volume changes, change is lost. When player loads, it uses the initial volume (80), not the updated volume.

**Fix:** Store pending volume, apply in `onReady`.

---

### 🔊 VOLUME-2: No Persistence of Volume Setting
**File:** `src/store/playerStore.ts:135`
**Impact:** LOW - Volume resets on page reload

```typescript
volume: 80,  // Hardcoded default
```

**User Experience:** User sets volume to 30 → closes tab → reopens → volume is 80 again.

**Fix:** Persist volume in localStorage (like download settings).

---

## Track Change Issues

### 🔄 TRACK-1: History Duplication on Rapid Track Changes
**File:** `src/store/playerStore.ts:175-185`
**Impact:** LOW - History polluted

```typescript
setCurrentTrack: (track) => {
  const state = get();
  if (state.currentTrack) {
    get().addToHistory(state.currentTrack, state.currentTime);  // ⚠️ ALWAYS ADDS
  }
  // ...
}
```

**Scenario:**
1. Track A plays for 0.5 seconds
2. User skips to Track B
3. Track A added to history (0.5s played)
4. User immediately skips to Track C
5. Track B added to history (0.0s played)

**Result:** History full of barely-played tracks.

**Fix:** Only add to history if `currentTime > 5` (played at least 5 seconds).

---

### 🔄 TRACK-2: Session End Called Twice on Track Change
**File:** `src/components/AudioPlayer.tsx:142-149`
**Impact:** LOW - Analytics skewed

```typescript
// End previous session
if (lastTrackId.current && lastTrackId.current !== currentTrack.id) {
  const el = audioRef.current;
  endListenSession(el?.currentTime || 0, 0);  // ⚠️ CALL 1
}

// Start new session
startListenSession(currentTrack.id);

// ... later in handleEnded ...
if (el && currentTrack) {
  endListenSession(el.currentTime, 0);  // ⚠️ CALL 2 (for same track)
}
```

**Problem:** When track ends naturally, `endListenSession` is called twice: once in `loadTrack` (for the ended track) and once in `handleEnded`.

---

### 🔄 TRACK-3: No Cleanup of Old IFrame on Track Change
**File:** `src/components/AudioPlayer.tsx:70-127`
**Impact:** MEDIUM - Multiple IFrames created

```typescript
const initIframePlayer = useCallback((videoId: string) => {
  // ...
  if (playerRef.current) {
    try {
      playerRef.current.destroy();
    } catch (e) {
      // Ignore
    }
  }

  // Create new player
  playerRef.current = new (window as any).YT.Player('voyo-yt-player', {
    // ...
  });
}, [/* dependencies */]);
```

**Problem:** If user switches tracks rapidly:
1. Track A → IFrame created with ID `voyo-yt-player`
2. Track B → `destroy()` called, but IFrame **DOM element not removed**
3. Track B → New player created **targeting the same DOM element ID**
4. YouTube SDK confused → multiple players fighting over same element

**Fix:** Clear innerHTML of `voyo-yt-player` div before creating new player.

---

## Boost/Download Issues

### ⚡ BOOST-1: Download Progress Uses `new Map()` Excessively
**File:** `src/store/downloadStore.ts:201-207`
**Impact:** MEDIUM - Performance hit

Already covered in CRITICAL-4, but worth emphasizing: creating a new Map 100 times during a download is wasteful.

---

### ⚡ BOOST-2: No Queue Limit for Auto-Boost
**File:** `src/store/downloadStore.ts:249-283`
**Impact:** LOW - Unlimited queue

```typescript
queueDownload: (trackId, title, artist, duration, thumbnail) => {
  // ...
  downloadQueue.push({ trackId, title, artist, duration, thumbnail });  // ⚠️ UNBOUNDED
  // ...
}
```

**Problem:** If user enables auto-boost and plays 100 tracks, all 100 are queued for download → browser storage fills up → quota exceeded → downloads fail.

**Fix:** Limit queue to 10 tracks, evict oldest.

---

### ⚡ BOOST-3: Boost Count Stored in localStorage, Not Synced with IndexedDB
**File:** `src/store/downloadStore.ts:119`
**Impact:** LOW - Data inconsistency

```typescript
manualBoostCount: parseInt(localStorage.getItem('voyo-manual-boost-count') || '0', 10),
```

**Problem:** If user clears IndexedDB (via browser settings) but not localStorage, `manualBoostCount` remains high but actual boosts are gone.

**Result:** User sees "You've boosted 10 tracks!" but only 0 tracks in cache.

---

### ⚡ BOOST-4: Auto-Boost Prompt Logic Flawed
**File:** `src/store/downloadStore.ts:222`
**Impact:** LOW - Prompt never shows

```typescript
const shouldPrompt = newCount >= 3 && !autoBoostEnabled && !localStorage.getItem('voyo-auto-boost-dismissed');
```

**Problem:** If user dismisses the prompt once, it **never shows again**, even if they boost 100 more tracks.

**UX:** User might change their mind after dismissing, but no way to see the prompt again.

---

## Recommended Fixes

### Priority 1: Playback Reliability (Ship-Blockers)

#### FIX-1.1: Ensure IFrame Play Waits for API Ready
```typescript
// Add timeout and retry limit
const initIframePlayer = useCallback((videoId: string, retryCount = 0) => {
  if (!(window as any).YT?.Player) {
    if (retryCount >= 10) {
      console.error('[VOYO] YT API failed to load after 10 retries');
      setBufferHealth(0, 'emergency');
      // Show error to user
      return;
    }
    setTimeout(() => initIframePlayer(videoId, retryCount + 1), 500);
    return;
  }
  // ... rest of init
}, [/* deps */]);
```

#### FIX-1.2: Fix Race Condition with AbortController per Track
```typescript
const abortControllerRef = useRef<AbortController | null>(null);

useEffect(() => {
  // Cancel previous load
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
  }

  const controller = new AbortController();
  abortControllerRef.current = controller;

  const loadTrack = async () => {
    try {
      // ... load operations with controller.signal ...
    } catch (error) {
      if (error.name === 'AbortError') {
        // Track load was cancelled, ignore
        return;
      }
      // Handle real errors
    }
  };

  loadTrack();

  return () => {
    controller.abort();
  };
}, [currentTrack?.trackId]);
```

#### FIX-1.3: Call setupMobileAudioUnlock() on App Mount
```typescript
// In App.tsx or main component
useEffect(() => {
  setupMobileAudioUnlock();
}, []);
```

#### FIX-1.4: Use Direct Play on Mobile
Replace store-based play/pause with direct audio control:
```typescript
// Use useMobilePlay hook in play button
const { handlePlayPause } = useMobilePlay();

<button onClick={handlePlayPause}>
  {isPlaying ? 'Pause' : 'Play'}
</button>
```

---

### Priority 2: Memory Management

#### FIX-2.1: Revoke Blob URLs on Unmount
```typescript
// In AudioPlayer component
const cachedUrlRef = useRef<string | null>(null);

useEffect(() => {
  return () => {
    if (cachedUrlRef.current) {
      URL.revokeObjectURL(cachedUrlRef.current);
      cachedUrlRef.current = null;
    }
  };
}, []);

// When getting cached URL
const url = await getCachedTrackUrl(trackId);
if (cachedUrlRef.current) {
  URL.revokeObjectURL(cachedUrlRef.current);
}
cachedUrlRef.current = url;
```

#### FIX-2.2: Implement LRU Cache in AudioEngine
```typescript
private readonly MAX_CACHE_SIZE = 10;

preloadTrack() {
  // ... after caching ...

  // Evict oldest if over limit
  if (this.preloadCache.size > this.MAX_CACHE_SIZE) {
    const oldest = Array.from(this.activePrefetch.entries())
      .sort((a, b) => a[1].endTime - b[1].endTime)[0];

    if (oldest) {
      this.clearTrackCache(oldest[0]);
    }
  }
}
```

#### FIX-2.3: Throttle Download Progress Updates
```typescript
import { throttle } from 'lodash'; // or implement simple throttle

const updateProgress = throttle((progress: number) => {
  const currentDownloads = new Map(get().downloads);
  currentDownloads.set(trackId, { trackId, progress, status: 'downloading' });
  set({ downloads: currentDownloads });
}, 500); // Update UI max once per 500ms
```

---

### Priority 3: State Synchronization

#### FIX-3.1: Clear Seek Position on Track Change
```typescript
setCurrentTrack: (track) => {
  // ...
  set({
    currentTrack: track,
    isPlaying: true,
    progress: 0,
    currentTime: 0,
    seekPosition: null,  // ✅ ADD THIS
  });
  // ...
}
```

#### FIX-3.2: Persist Volume in localStorage
```typescript
// In playerStore.ts
volume: parseInt(localStorage.getItem('voyo-volume') || '80', 10),

setVolume: (volume) => {
  localStorage.setItem('voyo-volume', String(volume));
  set({ volume });
}
```

#### FIX-3.3: Debounce Seek Requests
```typescript
import { debounce } from 'lodash';

const debouncedSeek = debounce((time: number) => {
  set({ seekPosition: time, currentTime: time });
}, 300);

seekTo: (time) => {
  debouncedSeek(time);
}
```

---

### Priority 4: Error Handling

#### FIX-4.1: Auto-Skip on IFrame Error
```typescript
onError: (event: any) => {
  console.error('[VOYO IFrame] Error:', event.data);
  setBufferHealth(0, 'emergency');

  // Show toast notification
  // toast.error('This track is unavailable. Skipping...');

  // Auto-skip after 2 seconds
  setTimeout(() => {
    nextTrack();
  }, 2000);
}
```

#### FIX-4.2: Validate Seek Position
```typescript
useEffect(() => {
  if (seekPosition === null) return;

  // Validate against duration
  const el = playbackMode === 'cached' ? audioRef.current : null;
  const maxSeek = el?.duration || duration || Infinity;

  if (seekPosition > maxSeek) {
    console.warn('[VOYO] Seek beyond duration, clamping');
    seekPosition = Math.max(0, maxSeek - 1);
  }

  // ... perform seek ...
}, [seekPosition]);
```

---

## Testing Checklist

### Core Playback Flow
- [ ] **Test:** User taps unboosted track → IFrame starts playing
- [ ] **Test:** User taps boosted track → Cached audio starts playing
- [ ] **Test:** User switches tracks mid-play → Old track stops, new track starts
- [ ] **Test:** User pauses mid-track → Playback stops, progress saved
- [ ] **Test:** User resumes paused track → Playback continues from same position

### Boost System
- [ ] **Test:** User taps Boost → Download starts, progress shows 0-100%
- [ ] **Test:** Download completes → Next play uses cached version
- [ ] **Test:** User enables auto-boost → Next tracks auto-download
- [ ] **Test:** User on cellular + wifi-only setting → No auto-download
- [ ] **Test:** Cache fills up → Oldest tracks evicted

### Mobile Playback
- [ ] **Test:** First tap on iPhone → Audio unlocks, plays
- [ ] **Test:** IFrame playback on Android → Starts without autoplay error
- [ ] **Test:** Screen lock during playback → Audio continues
- [ ] **Test:** Notification controls → Play/pause works

### Edge Cases
- [ ] **Test:** YouTube blocks IFrame → Error shown, auto-skip
- [ ] **Test:** Network drops mid-stream → Buffer health warning shown
- [ ] **Test:** User seeks past track end → Track skips to next
- [ ] **Test:** Rapid track switching → No memory leaks, correct track plays
- [ ] **Test:** 50 tracks played → Memory usage stable (LRU cache working)

---

## Performance Metrics

### Current State (Estimated)
- **Time to First Byte:** ~500ms (IFrame), ~200ms (cached)
- **Memory per Cached Track:** ~5MB (blob not revoked)
- **Memory after 50 Tracks:** ~250MB (unsustainable)
- **Download Progress Update Frequency:** 100 updates/download (too high)

### Target State
- **Time to First Byte:** ~300ms (IFrame), ~50ms (cached)
- **Memory per Cached Track:** ~5MB (revoked after use = 0MB retained)
- **Memory after 50 Tracks:** ~50MB (LRU keeps 10 tracks max)
- **Download Progress Update Frequency:** ~10 updates/download (throttled)

---

## Conclusion

The VOYO Music audio system has a **solid architecture** with the IFrame + Boost hybrid approach, but **critical race conditions** and **memory leaks** prevent it from being production-ready for mobile.

**Highest Impact Fixes:**
1. Fix mobile playback (use `useMobilePlay` hook)
2. Add AbortController per track load (prevent race conditions)
3. Revoke blob URLs (prevent memory leaks)
4. Call `setupMobileAudioUnlock()` on mount

**Timeline Estimate:**
- Priority 1 fixes: 4-6 hours
- Priority 2 fixes: 3-4 hours
- Priority 3 fixes: 2-3 hours
- Priority 4 fixes: 2-3 hours
- **Total:** ~2 days of focused work

Once these fixes are in, VOYO will have **Spotify-level playback reliability** with the unique advantage of offline Boost caching.

---

**Report Generated:** 2025-12-13
**Agent:** Z2 (Audio/Playback Specialist)
**Status:** AUDIT COMPLETE - READY FOR IMPLEMENTATION
