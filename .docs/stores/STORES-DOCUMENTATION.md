# VOYO Music - Zustand Stores Documentation

Complete documentation of all Zustand state management stores in the VOYO music application.

---

## Table of Contents

1. [playerStore.ts](#1-playerstorests) - Audio Player State
2. [playlistStore.ts](#2-playliststorests) - Playlist Management
3. [preferenceStore.ts](#3-preferencestorests) - User Preferences & Behavior Learning
4. [downloadStore.ts](#4-downloadstorests) - Download Management & Boost System
5. [intentStore.ts](#5-intentstorests) - User Intent & AI DJ
6. [reactionStore.ts](#6-reactionstorests) - Social Reactions & Engagement
7. [trackPoolStore.ts](#7-trackpoolstorests) - Dynamic Track Pool Management
8. [universeStore.ts](#8-universestorests) - Universe Sync, Portal System & Authentication

---

## 1. playerStore.ts

**Purpose**: Global audio player state management - the heart of VOYO's playback system.

**File**: `/home/dash/voyo-music/src/store/playerStore.ts`

### State Shape

#### Core Playback State
```typescript
currentTrack: Track | null;           // Currently playing track
isPlaying: boolean;                   // Play/pause state
progress: number;                     // Progress percentage (0-100)
currentTime: number;                  // Current playback time in seconds
duration: number;                     // Track duration in seconds
volume: number;                       // Volume level (0-100)
seekPosition: number | null;          // Seek target (when set, AudioPlayer should seek)
```

#### View & Display
```typescript
viewMode: ViewMode;                   // 'card' | 'lyrics' | 'video' | 'feed'
isVideoMode: boolean;                 // Video mode toggle
voyoActiveTab: VoyoTab;              // Active superapp tab
```

#### SKEEP (Fast-forward) Feature
```typescript
playbackRate: number;                 // 1 = normal, 2/4/8 = SKEEP mode
isSkeeping: boolean;                  // True when holding skip button
```

#### Streaming Optimization (Spotify-beating features)
```typescript
networkQuality: NetworkQuality;       // 'slow' | 'medium' | 'fast' | 'unknown'
streamQuality: BitrateLevel;          // 'low' | 'medium' | 'high'
bufferHealth: number;                 // 0-100 percentage
bufferStatus: BufferStatus;           // 'healthy' | 'warning' | 'emergency'
prefetchStatus: Map<string, PrefetchStatus>; // Track prefetch status
playbackSource: 'cached' | 'direct' | 'iframe' | null; // VOYO Boost indicator
```

#### Audio Enhancement
```typescript
boostProfile: 'boosted' | 'calm' | 'voyex' | 'xtreme'; // Audio preset
oyeBarBehavior: 'fade' | 'disappear'; // OYÉ Bar visibility behavior
```

#### Playback Modes
```typescript
shuffleMode: boolean;                 // Shuffle enabled
repeatMode: 'off' | 'all' | 'one';   // Repeat mode
```

#### Queue & History
```typescript
queue: QueueItem[];                   // Upcoming tracks
history: HistoryItem[];               // Previously played tracks
```

#### Recommendations (Personalized Belts)
```typescript
hotTracks: Track[];                   // Hot trending tracks
aiPicks: Track[];                     // AI-selected tracks
discoverTracks: Track[];              // Discovery based on current track
isAiMode: boolean;                    // AI mode toggle
```

#### Mood & Reactions
```typescript
currentMood: MoodType | null;         // Current mood tunnel
reactions: Reaction[];                // OYÉ reactions (temporary 2s display)
oyeScore: number;                     // Cumulative OYÉ score
```

#### Roulette Mode
```typescript
isRouletteMode: boolean;              // Roulette animation active
rouletteTracks: Track[];              // Tracks for roulette selection
```

---

### Actions

#### Playback Control

**`setCurrentTrack(track: Track)`**
- Sets the current track and resets playback state
- Records previous track to history (if played > 5 seconds)
- Records pool engagement (play event)
- Triggers smart discovery update for new track
- Persists track ID to localStorage for refresh recovery
- Syncs now_playing to Universe portal (if open)

```typescript
// Line-by-line breakdown
setCurrentTrack: (track) => {
  const state = get();

  // Add current track to history (if played > 5 seconds)
  if (state.currentTrack && state.currentTime > 5) {
    get().addToHistory(state.currentTrack, state.currentTime);

    // Record pool engagement if completion rate > 30%
    const completionRate = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
    if (completionRate > 30) {
      recordPoolEngagement(state.currentTrack.id, 'complete', { completionRate });
    }
  }

  // Reset state for new track
  set({
    currentTrack: track,
    isPlaying: true,
    progress: 0,
    currentTime: 0,
    seekPosition: null
  });

  // Record play engagement
  recordPoolEngagement(track.id, 'play');

  // Update smart discovery
  get().updateDiscoveryForTrack(track);

  // Persist to localStorage
  const current = loadPersistedState();
  savePersistedState({ ...current, currentTrackId: track.id || track.trackId, currentTime: 0 });

  // Sync to portal (async, non-blocking)
  setTimeout(async () => {
    try {
      const { useUniverseStore } = await import('./universeStore');
      const universeStore = useUniverseStore.getState();
      if (universeStore.isPortalOpen) {
        universeStore.updateNowPlaying();
      }
    } catch {}
  }, 100);
}
```

**`togglePlay()`**
- Toggles play/pause state
- Syncs to portal if open

**`setProgress(progress: number)`**
- Updates progress percentage (0-100)

**`setCurrentTime(time: number)`**
- Updates current playback time
- Persists position every 5 seconds to localStorage
- Syncs to portal every 10 seconds for live position

**`setDuration(duration: number)`**
- Sets track duration (called when metadata loads)

**`seekTo(time: number)`**
- Sets seek position for AudioPlayer to process
- Updates currentTime immediately for UI responsiveness

**`clearSeekPosition()`**
- Clears seek position after seek is processed

**`setVolume(volume: number)`**
- Sets volume (0-100)
- Persists to localStorage immediately

**`nextTrack()`**
- Advances to next track with intelligent logic:
  1. **Repeat One Mode**: Replays current track from start
  2. **Queue Priority**: Plays next track from queue
  3. **Repeat All Mode**: Restarts from first track in history
  4. **Discovery**: Picks from discovery/hot tracks
  5. **Shuffle**: Random selection with roulette animation
- Records skip/complete engagement based on completion rate (<30% = skip, >=30% = complete)
- Updates history

**`prevTrack()`**
- Returns to previous track from history
- Removes from history after playing

**`toggleShuffle()`**
- Toggles shuffle mode on/off

**`cycleRepeat()`**
- Cycles through repeat modes: off → all → one → off

---

#### SKEEP (Fast-forward)

**`setPlaybackRate(rate: number)`**
- Sets playback speed (1 = normal, 2/4/8 = SKEEP)

**`startSkeep()`**
- Begins SKEEP mode at 2x speed
- UI escalates to 4x → 8x on hold

**`stopSkeep()`**
- Returns to normal 1x playback

---

#### View Control

**`cycleViewMode()`**
- Cycles through view modes: card → lyrics → video → feed

**`setViewMode(mode: ViewMode)`**
- Sets specific view mode

**`toggleVideoMode()`**
- Toggles video mode on/off

**`setVoyoTab(tab: VoyoTab)`**
- Sets active superapp tab
- Persists to localStorage

---

#### Queue Management

**`addToQueue(track: Track, position?: number)`**
- Adds track to queue (with duplicate detection)
- Prefetches track for instant playback
- Records queue engagement (strong intent signal)
- Syncs to cloud after 1 second (debounced)

**`removeFromQueue(index: number)`**
- Removes track at index from queue

**`clearQueue()`**
- Empties entire queue

**`reorderQueue(fromIndex: number, toIndex: number)`**
- Reorders queue by moving track from one position to another

---

#### History

**`addToHistory(track: Track, duration: number)`**
- Adds track to history with playback duration
- Syncs to cloud after 2 seconds (debounced)

---

#### Recommendations

**`refreshRecommendations()`**
- Refreshes all recommendation belts
- Uses pool-aware algorithms (pulls from dynamic track pool)
- Excludes current track, queue, and recent history (last 5)

**`toggleAiMode()`**
- Toggles AI mode on/off

**`updateDiscoveryForTrack(track: Track)`**
- Updates discovery belt based on specific track
- Called automatically on track change
- Uses pool-aware discovery algorithm

**`refreshDiscoveryForCurrent()`**
- Manual refresh of discovery for current track

---

#### Mood

**`setMood(mood: MoodType | null)`**
- Sets current mood tunnel
- Affects track filtering and recommendations

---

#### Reactions

**`addReaction(reaction: Omit<Reaction, 'id' | 'createdAt'>)`**
- Adds OYÉ reaction with animation
- Updates oyeScore
- Records to preference store
- Records pool engagement (strong positive signal)
- Auto-removes after 2 seconds

**`multiplyReaction(reactionId: string)`**
- Doubles reaction multiplier
- Increases oyeScore

**`clearReactions()`**
- Removes all active reactions

---

#### Roulette

**`startRoulette()`**
- Activates roulette mode for shuffle animation

**`stopRoulette(track: Track)`**
- Stops roulette and plays selected track

---

#### Streaming Optimization

**`setNetworkQuality(quality: NetworkQuality)`**
- Sets detected network quality

**`setStreamQuality(quality: BitrateLevel)`**
- Sets stream quality level

**`setBufferHealth(health: number, status: BufferStatus)`**
- Updates buffer health (0-100) and status

**`setPlaybackSource(source: 'cached' | 'direct' | 'iframe' | null)`**
- Sets playback source for VOYO Boost indicator

**`setPrefetchStatus(trackId: string, status: PrefetchStatus)`**
- Updates prefetch status for track

**`detectNetworkQuality()`**
- Detects network quality using Navigator API
- Uses singleton pattern to prevent listener leaks
- Adjusts stream quality automatically:
  - 4G + >5 Mbps → high quality
  - 4G/3G → medium quality
  - 2G/slow-2G → low quality

**`setBoostProfile(profile: 'boosted' | 'calm' | 'voyex' | 'xtreme')`**
- Sets audio enhancement profile:
  - **boosted** (Yellow): Standard warm boost with speaker protection (default)
  - **calm** (Blue): Relaxed, balanced
  - **voyex** (Purple): Full holistic experience
  - **xtreme** (Red): Maximum bass power

**`setOyeBarBehavior(behavior: 'fade' | 'disappear')`**
- Sets OYÉ Bar behavior:
  - **fade**: Stays visible but ghosted after timeout (default)
  - **disappear**: Hides completely after timeout

---

### Persistence

**Storage Key**: `voyo-player-state`

**Persisted Data**:
```typescript
{
  currentTrackId?: string;      // Resume track on refresh
  currentTime?: number;          // Resume position on refresh
  voyoActiveTab?: VoyoTab;      // Remember active tab
}
```

**Persistence Strategy**:
- Track ID: Saved on track change
- Current time: Saved every 5 seconds during playback
- Volume: Saved immediately on change (separate key: `voyo-volume`)
- Tab: Saved on change

**Recovery on Refresh**:
```typescript
// Load persisted track
function getPersistedTrack(): Track {
  const { currentTrackId } = loadPersistedState();
  if (currentTrackId) {
    const track = TRACKS.find(t => t.id === currentTrackId || t.trackId === currentTrackId);
    if (track) return track;
  }
  return TRACKS[0]; // Fallback to first track
}
```

---

### Interactions with Other Stores

1. **universeStore**: Syncs now_playing to portal when track changes or time updates
2. **preferenceStore**: Records reactions for personalization learning
3. **trackPoolStore**: Records engagement (play, skip, complete, queue, react)
4. **downloadStore**: Prefetches tracks when added to queue

---

### Complex Logic Breakdown

#### Next Track Logic (Lines 346-440)

```typescript
nextTrack: () => {
  const state = get();

  // STEP 1: Handle repeat one - replay same track
  if (state.repeatMode === 'one' && state.currentTrack) {
    set({ isPlaying: true, progress: 0, currentTime: 0, seekPosition: null });
    return;
  }

  // STEP 2: Record skip vs completion for analytics
  if (state.currentTrack && state.duration > 0) {
    const completionRate = (state.currentTime / state.duration) * 100;
    if (completionRate < 30) {
      recordPoolEngagement(state.currentTrack.id, 'skip');
    } else {
      recordPoolEngagement(state.currentTrack.id, 'complete', { completionRate });
    }
  }

  // STEP 3: Check queue first
  if (state.queue.length > 0) {
    const [next, ...rest] = state.queue;
    if (state.currentTrack && state.currentTime > 5) {
      get().addToHistory(state.currentTrack, state.currentTime);
    }
    recordPoolEngagement(next.track.id, 'play');
    set({
      currentTrack: next.track,
      queue: rest,
      isPlaying: true,
      progress: 0,
      currentTime: 0,
      seekPosition: null,
    });
    return;
  }

  // STEP 4: Handle repeat all - restart from history
  if (state.repeatMode === 'all' && state.history.length > 0) {
    const firstTrack = state.history[0].track;
    if (state.currentTrack && state.currentTime > 5) {
      get().addToHistory(state.currentTrack, state.currentTime);
    }
    set({
      currentTrack: firstTrack,
      isPlaying: true,
      progress: 0,
      currentTime: 0,
      seekPosition: null,
    });
    return;
  }

  // STEP 5: Pick from discovery/hot tracks
  const availableTracks = state.discoverTracks.length > 0
    ? state.discoverTracks
    : state.hotTracks.length > 0
    ? state.hotTracks
    : TRACKS;

  if (availableTracks.length > 0) {
    let nextTrack;

    if (state.shuffleMode) {
      // Shuffle mode: Random with possible roulette animation
      const randomIndex = Math.floor(Math.random() * availableTracks.length);
      nextTrack = availableTracks[randomIndex];
    } else {
      // Regular mode: Pick random from available
      nextTrack = availableTracks[Math.floor(Math.random() * availableTracks.length)];
    }

    if (state.currentTrack && state.currentTime > 5) {
      get().addToHistory(state.currentTrack, state.currentTime);
    }
    recordPoolEngagement(nextTrack.id, 'play');
    set({
      currentTrack: nextTrack,
      isPlaying: true,
      progress: 0,
      currentTime: 0,
      seekPosition: null,
    });
  }
}
```

**Priority Order**:
1. Repeat One → replay current
2. Queue → play from queue
3. Repeat All → restart from history
4. Discovery/Hot → intelligent pick
5. Shuffle → random with animation

---

### State Flow Diagram

```
User Action → playerStore → Side Effects
     |             |              |
     |             |              ├─→ localStorage (persistence)
     |             |              ├─→ universeStore (portal sync)
     |             |              ├─→ preferenceStore (learning)
     |             |              ├─→ trackPoolStore (engagement)
     |             |              └─→ downloadStore (prefetch)
     |             |
     |             └─→ UI Re-render (React components)
     |
     └─→ AudioPlayer Component (playback control)
```

---

## 2. playlistStore.ts

**Purpose**: Local-first playlist management with cloud sync capability.

**File**: `/home/dash/voyo-music/src/store/playlistStore.ts`

### State Shape

```typescript
playlists: Playlist[];  // Array of all playlists
```

**Playlist Interface**:
```typescript
interface Playlist {
  id: string;           // Unique ID (format: pl_timestamp_random)
  name: string;         // Playlist name
  trackIds: string[];   // Array of track IDs
  coverUrl?: string;    // Optional cover image URL
  isPublic: boolean;    // Public/private flag
  createdAt: string;    // ISO timestamp
  updatedAt: string;    // ISO timestamp
}
```

---

### Actions

#### CRUD Operations

**`createPlaylist(name: string): Playlist`**
- Creates new playlist with generated ID
- Returns created playlist

```typescript
createPlaylist: (name: string) => {
  const now = new Date().toISOString();
  const playlist: Playlist = {
    id: generateId(),  // pl_timestamp_random
    name,
    trackIds: [],
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  };

  set((state) => ({
    playlists: [...state.playlists, playlist],
  }));

  return playlist;
}
```

**`deletePlaylist(id: string)`**
- Removes playlist by ID

**`renamePlaylist(id: string, name: string)`**
- Updates playlist name
- Updates `updatedAt` timestamp

**`togglePublic(id: string)`**
- Toggles `isPublic` flag
- Updates `updatedAt` timestamp

---

#### Track Management

**`addTrackToPlaylist(playlistId: string, trackId: string)`**
- Adds track to playlist (with duplicate check)
- Updates `updatedAt` timestamp

**`removeTrackFromPlaylist(playlistId: string, trackId: string)`**
- Removes track from playlist
- Updates `updatedAt` timestamp

**`reorderPlaylist(playlistId: string, fromIndex: number, toIndex: number)`**
- Reorders tracks within playlist
- Updates `updatedAt` timestamp

---

#### Cloud Sync

**`syncToCloud(username: string): Promise<boolean>`**
- Pushes local playlists to Supabase
- Returns success/failure
- Only works if Supabase is configured

```typescript
syncToCloud: async (username: string) => {
  if (!isSupabaseConfigured) return false;

  const { playlists } = get();
  const cloudPlaylists = playlists.map((p) => ({
    id: p.id,
    name: p.name,
    trackIds: p.trackIds,
    isPublic: p.isPublic,
    createdAt: p.createdAt,
  }));

  return universeAPI.updateState(username, { playlists: cloudPlaylists });
}
```

**`syncFromCloud(username: string): Promise<boolean>`**
- Pulls playlists from Supabase
- Overwrites local playlists
- Returns success/failure

---

#### Getters

**`getPlaylist(id: string): Playlist | undefined`**
- Returns playlist by ID

**`getPlaylistsByTrack(trackId: string): Playlist[]`**
- Returns all playlists containing specific track
- Useful for "Added to playlists" UI

---

### Persistence

**Storage Key**: `voyo-playlists`

**Version**: 1

**Middleware**: Zustand `persist` middleware

**Persisted Data**: Entire playlists array

---

### Interactions with Other Stores

1. **universeStore**: Syncs playlists to cloud via `universeAPI.updateState()`

---

## 3. preferenceStore.ts

**Purpose**: localStorage-first personalization system that learns from user behavior to power HOT and DISCOVERY zones.

**File**: `/home/dash/voyo-music/src/store/preferenceStore.ts`

### State Shape

#### Core Preferences
```typescript
trackPreferences: Record<string, TrackPreference>;
artistPreferences: Record<string, ArtistPreference>;
tagPreferences: Record<string, TagPreference>;
moodPreferences: Record<string, MoodPreference>;
```

#### Active Session
```typescript
currentSession: ListenSession | null;
```

**TrackPreference Interface**:
```typescript
interface TrackPreference {
  trackId: string;

  // Listen behavior
  totalListens: number;        // Times played
  totalDuration: number;       // Total seconds listened
  completions: number;         // Times played >80%
  skips: number;              // Times skipped <20%

  // User actions
  reactions: number;           // OYÉ reactions given
  explicitLike?: boolean;      // User explicitly liked/disliked

  // Metadata
  lastPlayedAt: string;
  createdAt: string;
}
```

**ListenSession Interface**:
```typescript
interface ListenSession {
  trackId: string;
  startedAt: string;
  endedAt?: string;
  duration: number;
  completed: boolean;      // >80% played
  skipped: boolean;        // <20% played
  reactions: number;
}
```

---

### Actions

#### Session Tracking

**`startListenSession(trackId: string)`**
- Begins tracking a listen session
- Creates new session object

**`endListenSession(duration: number, reactions: number = 0)`**
- Ends current session
- Determines if completed (80%+) or skipped (20%-)
- Records to trackPreferences
- Clears session

```typescript
endListenSession: (duration: number, reactions: number = 0) => {
  const { currentSession } = get();
  if (!currentSession) return;

  const now = new Date().toISOString();
  const completed = duration >= currentSession.duration * 0.8;  // 80% threshold
  const skipped = duration < currentSession.duration * 0.2;     // 20% threshold

  // Update session
  set({
    currentSession: {
      ...currentSession,
      endedAt: now,
      duration,
      completed,
      skipped,
      reactions,
    },
  });

  // Record the listen
  if (completed) {
    get().recordCompletion(currentSession.trackId, duration, reactions);
  } else if (skipped) {
    get().recordSkip(currentSession.trackId, duration);
  }

  // Clear session
  set({ currentSession: null });
}
```

---

#### Behavior Recording

**`recordSkip(trackId: string, listenDuration: number)`**
- Records a skip (<20% played)
- Increments totalListens, totalDuration, skips
- Creates preference if doesn't exist

**`recordCompletion(trackId: string, duration: number, reactions: number = 0)`**
- Records a completion (>80% played)
- Increments totalListens, totalDuration, completions, reactions
- Creates preference if doesn't exist

**`recordReaction(trackId: string)`**
- Increments reaction count for track
- Updates current session if matches

**`setExplicitLike(trackId: string, liked: boolean)`**
- Sets explicit like/dislike
- Creates preference if doesn't exist
- Auto-syncs to cloud after 500ms (debounced)

---

#### Analytics

**`getTrackPreference(trackId: string): TrackPreference | null`**
- Returns preference for track or null

**`getTopArtists(limit = 10): ArtistPreference[]`**
- Returns top artists by listen count
- Sorted descending

**`getTopTags(limit = 10): TagPreference[]`**
- Returns top tags by listen count
- Sorted descending

**`getTopMoods(limit = 10): MoodPreference[]`**
- Returns top moods by listen count
- Sorted descending

---

#### Reset

**`clearPreferences()`**
- Clears all preferences and session
- Full reset

---

### Persistence

**Storage Key**: `voyo-preferences`

**Version**: 1

**Middleware**: Zustand `persist` middleware

**Persisted Data**:
- trackPreferences
- artistPreferences
- tagPreferences
- moodPreferences
- currentSession

---

### Interactions with Other Stores

1. **universeStore**: Auto-syncs explicit likes to cloud (debounced 500ms)
2. **playerStore**: Receives reaction events via `recordReaction()`

---

### Learning Algorithm

**Completion Rate Calculation**:
```typescript
const calculateCompletionRate = (pref: TrackPreference): number => {
  if (pref.totalListens === 0) return 0;
  return (pref.completions / pref.totalListens) * 100;
}
```

**Usage in Personalization**:
- High completion rate + reactions = strong positive signal
- High skip rate = negative signal
- Explicit likes override behavioral signals

---

## DEPRECATED: accountStore.ts (REMOVED)

> **NOTE**: accountStore has been deprecated and removed. Authentication is now handled by universeStore.
> See [universeStore.ts](#8-universestorests) for the current authentication system.

## SKIP TO NEXT SECTION

**Purpose**: WhatsApp-based authentication system for voyomusic.com/username architecture.

**File**: `/home/dash/voyo-music/src/store/accountStore.ts`

### State Shape

#### Current User
```typescript
currentAccount: VOYOAccount | null;
isLoggedIn: boolean;
isLoading: boolean;
```

#### Verification Flow
```typescript
verificationState: VerificationState;
verificationError: string | null;
pendingUsername: string | null;
pendingWhatsapp: string | null;
generatedPin: string | null;
```

**VOYOAccount Interface**:
```typescript
interface VOYOAccount {
  id: string;
  username: string;
  whatsapp: string;
  pin: string;
  displayName: string;
  bio?: string;
  subscription: SubscriptionStatus;
  subscriptionEnds?: string;
  banReason?: string;
  friendIds: string[];
  friendRequestIds: string[];
  nowPlaying?: {
    trackId: string;
    title: string;
    artist: string;
    thumbnail: string;
    startedAt: string;
  };
  totalListeningHours: number;
  totalOyeGiven: number;
  totalOyeReceived: number;
  stories: any[];
  createdAt: string;
  lastSeenAt: string;
}
```

---

### Actions

#### Signup Flow

**`startSignup(username: string, whatsapp: string): Promise<boolean>`**
1. Normalizes username (lowercase, alphanumeric + underscore only)
2. Checks availability (returns error if taken)
3. Validates WhatsApp format (removes non-digits, checks length)
4. Generates 6-digit PIN
5. Stores pending signup data
6. Updates state to `waiting_pin`
7. Returns true (in production: sends PIN via WhatsApp Business API)

```typescript
startSignup: async (username: string, whatsapp: string) => {
  set({ isLoading: true, verificationState: 'sending_pin', verificationError: null });

  // Check username availability
  const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (MOCK_ACCOUNTS[normalizedUsername]) {
    set({
      isLoading: false,
      verificationState: 'error',
      verificationError: 'Username already taken',
    });
    return false;
  }

  // Validate WhatsApp format
  const cleanWhatsapp = whatsapp.replace(/\D/g, '');
  if (cleanWhatsapp.length < 9) {
    set({
      isLoading: false,
      verificationState: 'error',
      verificationError: 'Invalid WhatsApp number',
    });
    return false;
  }

  // Generate 6-digit PIN
  const pin = Math.floor(100000 + Math.random() * 900000).toString();

  // Store pending signup
  set({
    isLoading: false,
    verificationState: 'waiting_pin',
    pendingUsername: normalizedUsername,
    pendingWhatsapp: cleanWhatsapp,
    generatedPin: pin,
  });

  // In production: Send PIN via WhatsApp Business API
  console.log(`[VOYO] Sending PIN ${pin} to +${cleanWhatsapp}`);

  return true;
}
```

**`verifyPin(enteredPin: string): Promise<boolean>`**
1. Compares entered PIN with generated PIN
2. If incorrect: Returns error
3. If correct:
   - Creates VOYOAccount with 7-day trial
   - Adds to mock database
   - Saves to localStorage
   - Updates state to `verified` and `isLoggedIn`
   - Returns true

**`cancelSignup()`**
- Resets signup flow state
- Clears pending data

---

#### Login Flow

**`login(username: string, pin: string): Promise<boolean>`**
1. Normalizes username
2. Finds account in mock database
3. Validates PIN
4. Updates lastSeenAt
5. Saves to localStorage
6. Sets as currentAccount
7. Returns success/failure

---

#### Logout

**`logout()`**
- Removes account from localStorage
- Clears currentAccount
- Resets verification state

---

#### Profile Management

**`getProfile(username: string): VOYOAccount | null`**
- Returns account by username (case-insensitive)

**`updateProfile(updates: Partial<VOYOAccount>)`**
- Updates currentAccount with partial updates
- Saves to localStorage and mock database

**`updateNowPlaying(track: { ... } | null)`**
- Updates nowPlaying field
- Sets startedAt to current time
- Saves to localStorage and mock database

---

#### Friends

**`addFriend(username: string): Promise<boolean>`**
- Adds friend to both accounts' friendIds
- Saves to localStorage

**`removeFriend(username: string)`**
- Removes from both accounts' friendIds
- Saves to localStorage

**`getFriends(): VOYOAccount[]`**
- Returns array of friend accounts

---

#### Utilities

**`checkUsernameAvailable(username: string): boolean`**
- Checks if username is available
- Requires 3+ characters

**`generateWhatsAppLink(pin: string): string`**
- Generates wa.me link with prefilled PIN message
- Target: VOYO WhatsApp number (224611361300)

---

### Persistence

**Storage Key**: `voyo-account`

**Persisted Data**:
```typescript
{
  account: VOYOAccount | null;
  sessionToken?: string;
}
```

---

### Mock Data

**Mock Accounts** (for development):
- **dash**: VIP subscription, 127 listening hours, 8500 OYÉ received
- **aziz**: Active subscription, 89 listening hours, 2100 OYÉ received
- **kenza**: Banned (payment overdue), 45 listening hours

---

### Interactions with Other Stores

---

## 4. downloadStore.ts

**Purpose**: Local caching and HD download management for VOYO Boost system.

**File**: `/home/dash/voyo-music/src/store/downloadStore.ts`

### Philosophy

**BOOST SYSTEM**:
- **Manual Boost**: User clicks "⚡ Boost HD" to download to IndexedDB
- **Auto-Boost**: After 3 manual boosts, prompt to enable auto-download
- **All downloads go to USER's device (IndexedDB), not server**

---

### State Shape

```typescript
downloads: Map<string, DownloadProgress>;
cachedTracks: CachedTrackInfo[];
cacheSize: number;
downloadSetting: DownloadSetting;
isInitialized: boolean;

// Boost tracking
manualBoostCount: number;
autoBoostEnabled: boolean;
showAutoBoostPrompt: boolean;

// Hot-swap tracking (DJ rewind feature)
boostStartTimes: Record<string, number>;
lastBoostCompletion: BoostCompletion | null;
```

**DownloadProgress Interface**:
```typescript
interface DownloadProgress {
  trackId: string;
  progress: number;  // 0-100
  status: 'queued' | 'downloading' | 'complete' | 'failed';
  error?: string;
}
```

**CachedTrackInfo Interface**:
```typescript
interface CachedTrackInfo {
  id: string;
  title: string;
  artist: string;
  size: number;
  quality: 'standard' | 'boosted';
  downloadedAt: number;
}
```

**BoostCompletion Interface** (for hot-swap/DJ rewind):
```typescript
interface BoostCompletion {
  trackId: string;
  duration: number;  // seconds it took
  isFast: boolean;   // < 7 seconds = DJ rewind eligible
  timestamp: number;
}
```

---

### Actions

#### Initialization

**`initialize(): Promise<void>`**
- Runs once on app start
- Migrates old VOYO IDs to raw YouTube IDs (one-time fix)
- Loads download setting from localStorage
- Loads cached tracks from IndexedDB
- Calculates cache size
- Sets `isInitialized` to true

---

#### Cache Check

**`checkCache(trackId: string): Promise<string | null>`**
- Normalizes VOYO ID to YouTube ID
- Checks if track is cached in IndexedDB
- Returns blob URL if cached, null otherwise

```typescript
checkCache: async (trackId: string) => {
  // NORMALIZE: Always check with raw YouTube ID
  const normalizedId = decodeVoyoId(trackId);
  console.log('🎵 CACHE: Checking if trackId is cached:', trackId, '→ normalized:', normalizedId);

  const cached = await isTrackCached(normalizedId);
  console.log('🎵 CACHE: isTrackCached result:', cached);

  if (cached) {
    const url = await getCachedTrackUrl(normalizedId);
    console.log('🎵 CACHE: Got blob URL:', url ? 'YES' : 'NO');
    if (url) {
      return url;
    }
  }
  return null;
}
```

---

#### Manual Boost

**`boostTrack(trackId, title, artist, duration, thumbnail): Promise<void>`**
- User-triggered HD download
- Records boost start time for hot-swap feature
- Checks if already downloading or complete
- Checks if already cached at boosted quality (skips if yes)
- Builds proxy URL (server fetches and pipes to client)
- Downloads with progress tracking (throttled to 500ms updates)
- On success:
  - Increments manualBoostCount
  - Shows auto-boost prompt after 3 manual boosts
  - Calculates boost duration
  - Emits completion event for hot-swap (if < 7 seconds = DJ rewind!)
  - Refreshes cache info

```typescript
boostTrack: async (trackId, title, artist, duration, thumbnail) => {
  const normalizedId = decodeVoyoId(trackId);
  console.log('🎵 BOOST: Starting boost for trackId:', trackId, '→ normalized:', normalizedId);

  const { downloads, manualBoostCount, autoBoostEnabled, boostStartTimes } = get();

  // Record boost start time for hot-swap feature
  const boostStartTime = Date.now();
  set({ boostStartTimes: { ...boostStartTimes, [normalizedId]: boostStartTime } });

  // Already downloading or complete?
  const existing = downloads.get(normalizedId);
  if (existing && (existing.status === 'downloading' || existing.status === 'complete')) {
    return;
  }

  // Check if already cached at boosted quality
  const currentQuality = await getTrackQuality(normalizedId);
  if (currentQuality === 'boosted') {
    const newDownloads = new Map(downloads);
    newDownloads.set(normalizedId, { trackId: normalizedId, progress: 100, status: 'complete' });
    set({ downloads: newDownloads });
    return;
  }

  // Update status to downloading
  const newDownloads = new Map(downloads);
  newDownloads.set(normalizedId, { trackId: normalizedId, progress: 0, status: 'downloading' });
  set({ downloads: newDownloads });

  try {
    // Build proxy URL
    const proxyUrl = `${API_URL}/proxy?v=${normalizedId}&quality=high`;

    // Download with progress tracking
    let lastUpdateTime = 0;
    const success = await downloadTrack(
      normalizedId,
      proxyUrl,
      { title, artist, duration, thumbnail, quality: 'boosted' },
      'boosted',
      (progress) => {
        const now = Date.now();
        if (now - lastUpdateTime < 500) return; // Throttle
        lastUpdateTime = now;

        const currentDownloads = new Map(get().downloads);
        currentDownloads.set(normalizedId, {
          trackId: normalizedId,
          progress,
          status: 'downloading',
        });
        set({ downloads: currentDownloads });
      }
    );

    if (success) {
      console.log('🎵 BOOST: ✅ Successfully boosted trackId:', trackId);

      const finalDownloads = new Map(get().downloads);
      finalDownloads.set(normalizedId, { trackId: normalizedId, progress: 100, status: 'complete' });

      // Increment manual boost count
      const newCount = manualBoostCount + 1;
      localStorage.setItem('voyo-manual-boost-count', String(newCount));

      // Show auto-boost prompt after 3 manual boosts
      const shouldPrompt = newCount >= 3 && !autoBoostEnabled && !localStorage.getItem('voyo-auto-boost-dismissed');

      // Calculate boost duration for hot-swap feature
      const boostEndTime = Date.now();
      const startTime = get().boostStartTimes[normalizedId] || boostStartTime;
      const boostDuration = (boostEndTime - startTime) / 1000; // seconds
      const isFastBoost = boostDuration < 7; // DJ rewind threshold

      console.log(`🎵 BOOST: Completed in ${boostDuration.toFixed(1)}s - ${isFastBoost ? '⚡ FAST (DJ rewind!)' : '📦 Normal'}`);

      set({
        downloads: finalDownloads,
        manualBoostCount: newCount,
        showAutoBoostPrompt: shouldPrompt,
        lastBoostCompletion: {
          trackId: normalizedId,
          duration: boostDuration,
          isFast: isFastBoost,
          timestamp: boostEndTime,
        },
      });

      await get().refreshCacheInfo();
    } else {
      throw new Error('Download failed');
    }
  } catch (error) {
    const failedDownloads = new Map(get().downloads);
    failedDownloads.set(normalizedId, {
      trackId: normalizedId,
      progress: 0,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Download failed',
    });
    set({ downloads: failedDownloads });
  }
}
```

---

#### Auto-Cache

**`cacheTrack(trackId, title, artist, duration, thumbnail): Promise<void>`**
- Silent background caching after 30s of playback
- Skips if already cached at ANY quality (don't downgrade)
- Checks network settings before proceeding
- Downloads at **standard quality** (saves bandwidth)
- Silent fail - doesn't interrupt UX

```typescript
cacheTrack: async (trackId, title, artist, duration, thumbnail) => {
  const normalizedId = decodeVoyoId(trackId);

  // Skip if already cached at ANY quality
  const currentQuality = await getTrackQuality(normalizedId);
  if (currentQuality) {
    console.log('🎵 CACHE: Track already cached at', currentQuality, 'quality, skipping:', title);
    return;
  }

  // Check network settings
  if (!shouldAutoDownload()) {
    console.log('🎵 CACHE: Network settings prevent auto-cache');
    return;
  }

  console.log('🎵 CACHE: Auto-caching track:', title, '| quality: standard');

  try {
    const proxyUrl = `${API_URL}/proxy?v=${normalizedId}&quality=standard`;

    // Silent download - no progress UI updates
    const success = await downloadTrack(
      normalizedId,
      proxyUrl,
      { title, artist, duration, thumbnail, quality: 'standard' },
      'standard'
    );

    if (success) {
      console.log('🎵 CACHE: ✅ Auto-cached:', title);
      await get().refreshCacheInfo();
    }
  } catch (error) {
    console.log('🎵 CACHE: Auto-cache failed for', title, error);
  }
}
```

---

#### Queue System (for Auto-Boost)

**`queueDownload(trackId, title, artist, duration, thumbnail)`**
- Only queues if auto-boost is enabled
- Checks if already downloading or complete
- Checks network settings
- Adds to queue
- Starts processing

**`processQueue(): Promise<void>`**
- Processes download queue sequentially
- Uses iteration limit (100) to prevent infinite loops
- Calls `boostTrack()` for each item
- Small 500ms delay between downloads
- Clears queue if iteration limit hit

---

#### Status & Management

**`getDownloadStatus(trackId: string): DownloadProgress | undefined`**
- Returns download progress for track

**`isTrackBoosted(trackId: string): Promise<boolean>`**
- Checks if track is cached in IndexedDB

**`removeDownload(trackId: string): Promise<void>`**
- Deletes track from IndexedDB
- Removes from downloads map
- Refreshes cache info

**`clearAllDownloads(): Promise<void>`**
- Clears entire IndexedDB cache
- Resets all state

**`updateSetting(setting: DownloadSetting)`**
- Updates download setting (wifi-only, always, never)
- Persists to localStorage

**`refreshCacheInfo(): Promise<void>`**
- Reloads cached tracks from IndexedDB
- Recalculates cache size
- Updates cachedTracks array

---

#### Auto-Boost Management

**`enableAutoBoost()`**
- Sets auto-boost to true
- Saves to localStorage
- Dismisses prompt

**`disableAutoBoost()`**
- Sets auto-boost to false
- Saves to localStorage

**`dismissAutoBoostPrompt()`**
- Saves dismissal to localStorage
- Hides prompt

---

### Persistence

**Storage Keys**:
- `voyo-manual-boost-count`: Number of manual boosts
- `voyo-auto-boost`: "true" or "false"
- `voyo-auto-boost-dismissed`: "true" if dismissed

**IndexedDB**: All audio files stored in IndexedDB via `downloadManager.ts`

---

### VOYO ID Normalization

**Issue**: Old system used `vyo_` encoded IDs, new system uses raw YouTube IDs.

**Solution**: `decodeVoyoId()` function normalizes all IDs:
```typescript
function decodeVoyoId(voyoId: string): string {
  if (!voyoId.startsWith('vyo_')) {
    return voyoId;
  }
  const encoded = voyoId.substring(4);
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  try {
    return atob(base64);
  } catch {
    return voyoId;
  }
}
```

All storage and lookups use **raw YouTube IDs** for consistency.

---

### Hot-Swap / DJ Rewind Feature

**Concept**: If boost completes in < 7 seconds, AudioPlayer can hot-swap to cached version mid-playback (seamless upgrade).

**Tracking**:
```typescript
boostStartTimes: Record<string, number>;  // Track when boost started
lastBoostCompletion: BoostCompletion | null;  // Last completed boost
```

**BoostCompletion Event**:
```typescript
{
  trackId: string;
  duration: number;  // seconds to complete
  isFast: boolean;   // true if < 7 seconds
  timestamp: number;
}
```

**Usage**: AudioPlayer listens for `lastBoostCompletion` changes and hot-swaps if `isFast === true`.

---

### Interactions with Other Stores

1. **playerStore**: Prefetches tracks when added to queue

---

## 5. intentStore.ts

**Purpose**: Captures ACTIVE user intent from MixBoard interactions to power AI DJ recommendations.

**File**: `/home/dash/voyo-music/src/store/intentStore.ts`

### Philosophy

**Intent > Behavior**

Intent signals are STRONGER than behavior because they represent what the user WANTS to hear, not just what they listened to.

If user sets Party Mode to 5 bars but history is all chill, we prioritize Party Mode because that's their CURRENT intent.

---

### Signal Sources

1. **manualBars**: User's preferred vibe distribution (MixBoard taps)
2. **queueComposition**: Tracks added to queue by mode
3. **dragToQueue**: Modes actively dragged to queue (strongest signal!)
4. **modeActivity**: Recent activity per mode (decay over time)

---

### State Shape

```typescript
modeIntents: Record<VibeMode, ModeIntent>;
currentSession: IntentSession | null;
totalDragEvents: Record<VibeMode, number>;
totalTracksQueued: Record<VibeMode, number>;
```

**VibeMode Type**:
```typescript
type VibeMode =
  | 'afro-heat'
  | 'chill-vibes'
  | 'party-mode'
  | 'late-night'
  | 'workout'
  | 'random-mixer';
```

**ModeIntent Interface**:
```typescript
interface ModeIntent {
  modeId: VibeMode;
  manualBars: number;         // 0-6 scale
  tracksQueued: number;
  dragToQueueCount: number;
  lastActivity: string;
  intentScore: number;        // 0-100 calculated score
}
```

**IntentSession Interface**:
```typescript
interface IntentSession {
  sessionId: string;
  startedAt: string;
  modeActivity: Record<VibeMode, number>;
  dragEvents: Array<{ modeId: VibeMode; timestamp: string }>;
}
```

---

### Actions

#### MixBoard Interactions

**`setManualBars(modeId: VibeMode, bars: number)`**
- Sets bar count (0-6) for mode
- Updates lastActivity timestamp
- Recalculates intentScore
- Updates session activity

**`recordDragToQueue(modeId: VibeMode)`**
- Records drag-to-queue event (STRONGEST signal!)
- Increments dragToQueueCount
- Updates lastActivity
- Recalculates intentScore
- Adds to session dragEvents
- Updates totalDragEvents

**`recordTrackQueued(modeId: VibeMode)`**
- Increments tracksQueued
- Updates lastActivity
- Recalculates intentScore
- Updates totalTracksQueued

---

#### Session Management

**`startSession()`**
- Creates new session with unique ID
- Resets modeActivity counters

**`endSession()`**
- Recalculates all intent scores with final session data
- Clears currentSession

---

#### Intent Scores

**`getIntentScore(modeId: VibeMode): number`**
- Returns real-time intent score for mode
- Includes session activity in calculation

**`getDominantModes(limit = 3): VibeMode[]`**
- Returns top modes by intent score
- Sorted descending

**`getIntentWeights(): Record<VibeMode, number>`**
- Returns normalized weights (0-1) for all modes
- Used by track pool scoring algorithm

---

### Scoring Formula

```typescript
trackScore = intentMatch * 0.4 + recency * 0.3 + engagement * 0.3
```

**Weights**:
```typescript
const INTENT_WEIGHTS = {
  MANUAL_BAR: 15,           // Each bar = 15 points (max 90)
  DRAG_TO_QUEUE: 25,        // Drag event = 25 points (strongest!)
  TRACK_QUEUED: 5,          // Each track queued = 5 points
  SESSION_ACTIVITY: 10,     // Recent session activity = 10 points
  TIME_DECAY: 0.9,          // Decay factor per hour of inactivity
};
```

**Calculation**:
```typescript
function calculateIntentScore(intent: ModeIntent, sessionActivity: number = 0): number {
  let score = 0;

  // 1. Manual bars (strongest explicit signal)
  score += intent.manualBars * INTENT_WEIGHTS.MANUAL_BAR;

  // 2. Drag-to-queue events (highest intent)
  score += intent.dragToQueueCount * INTENT_WEIGHTS.DRAG_TO_QUEUE;

  // 3. Tracks queued in this mode
  score += intent.tracksQueued * INTENT_WEIGHTS.TRACK_QUEUED;

  // 4. Session activity bonus
  score += sessionActivity * INTENT_WEIGHTS.SESSION_ACTIVITY;

  // 5. Time decay (reduce score for stale intents)
  const lastActivity = new Date(intent.lastActivity);
  const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
  if (hoursSinceActivity > 1) {
    const decayFactor = Math.pow(INTENT_WEIGHTS.TIME_DECAY, Math.floor(hoursSinceActivity));
    score *= decayFactor;
  }

  return Math.round(score);
}
```

**Example**:
- User sets Afro-Heat to 4 bars: 4 × 15 = 60 points
- User drags Afro-Heat to queue 2 times: 2 × 25 = 50 points
- Session activity bonus: 10 points
- **Total**: 120 points → capped at 100

---

### Mode Keywords

**Purpose**: Match tracks to vibe modes based on metadata.

```typescript
export const MODE_KEYWORDS: Record<VibeMode, string[]> = {
  'afro-heat': [
    'afrobeats', 'afrobeat', 'afro',
    'amapiano', 'naija', 'lagos',
    'burna', 'davido', 'wizkid', 'rema', 'asake', 'ayra', 'tems',
    'nigeria', 'ghana', 'african',
  ],
  'chill-vibes': [
    'chill', 'relax', 'smooth', 'slow', 'calm',
    'acoustic', 'rnb', 'r&b',
    'love', 'essence', 'vibe',
  ],
  'party-mode': [
    'party', 'club', 'dance',
    'turn up', 'lit', 'banger',
    'hype', 'energy',
    'mix', 'dj',
  ],
  'late-night': [
    'night', 'late', 'midnight',
    'dark', 'moody', 'feels',
    'heartbreak', 'sad', 'emotional',
  ],
  'workout': [
    'workout', 'gym', 'fitness',
    'pump', 'run', 'motivation',
    'power', 'beast', 'grind',
  ],
  'random-mixer': [],  // No filtering
};
```

**Usage**:
```typescript
export function matchTrackToMode(track: { title, artist, tags, mood }): VibeMode {
  const searchText = `${track.title} ${track.artist} ${track.tags?.join(' ')} ${track.mood}`.toLowerCase();

  let bestMatch: VibeMode = 'random-mixer';
  let bestScore = 0;

  Object.entries(MODE_KEYWORDS).forEach(([modeId, keywords]) => {
    if (keywords.length === 0) return;

    let score = 0;
    keywords.forEach((keyword) => {
      if (searchText.includes(keyword.toLowerCase())) {
        score += 1;
      }
    });

    if (score > bestScore) {
      bestScore = score;
      bestMatch = modeId;
    }
  });

  return bestMatch;
}
```

---

### Persistence

**Storage Key**: `voyo-intent`

**Version**: 1

**Middleware**: Zustand `persist` middleware

**Persisted Data**:
- modeIntents
- currentSession
- totalDragEvents
- totalTracksQueued

---

### Interactions with Other Stores

1. **trackPoolStore**: Consumes intent weights via `getIntentWeights()` for track scoring

---

## 6. reactionStore.ts

**Purpose**: The Social Spine - connects Users, Tracks, and Categories through realtime reactions.

**File**: `/home/dash/voyo-music/src/store/reactionStore.ts`

### Philosophy

Social reactions create the pulse of VOYO - what the community is vibing to RIGHT NOW.

---

### State Shape

```typescript
recentReactions: Reaction[];
trackReactions: Map<string, Reaction[]>;
trackStats: Map<string, TrackStats>;
trackHotspots: Map<string, TrackHotspot[]>;
categoryPulse: Record<ReactionCategory, CategoryPulse>;
userCategoryPreferences: Record<ReactionCategory, CategoryPreference>;
isSubscribed: boolean;
```

**Reaction Interface**:
```typescript
interface Reaction {
  id: string;
  username: string;
  track_id: string;
  track_title: string;
  track_artist: string;
  track_thumbnail?: string;
  category: ReactionCategory;
  emoji: string;
  reaction_type: ReactionType;  // 'like' | 'oye' | 'fire'
  comment?: string;
  created_at: string;
  track_position?: number;  // 0-100 percentage
}
```

**ReactionCategory Type**:
```typescript
type ReactionCategory =
  | 'afro-heat'
  | 'chill-vibes'
  | 'party-mode'
  | 'late-night'
  | 'workout';
```

**TrackHotspot Interface** (zones where reactions cluster):
```typescript
interface TrackHotspot {
  position: number;         // 0-100 percentage
  intensity: number;        // 0-1 heat intensity
  reactionCount: number;
  dominantType: ReactionType;
}
```

**CategoryPulse Interface**:
```typescript
interface CategoryPulse {
  category: ReactionCategory;
  count: number;
  lastReaction?: Reaction;
  isHot: boolean;  // Had reaction in last 30 seconds
}
```

**CategoryPreference Interface** (For You algorithm):
```typescript
interface CategoryPreference {
  category: ReactionCategory;
  reactionCount: number;
  likeCount: number;
  oyeCount: number;
  fireCount: number;
  lastReactedAt?: string;
  score: number;  // 0-100
}
```

---

### Actions

#### Create Reaction

**`createReaction({ username, trackId, trackTitle, trackArtist, trackThumbnail, category, emoji, reactionType, comment, trackPosition }): Promise<boolean>`**
- Creates reaction in Supabase
- Falls back to local-only in offline mode
- Pulses category (sets isHot for 30 seconds)
- Updates For You preferences
- Recomputes hotspots if position provided
- Returns success/failure

```typescript
createReaction: async ({ username, trackId, trackTitle, trackArtist, trackThumbnail, category, emoji, reactionType = 'oye', comment, trackPosition }) => {
  if (!isSupabaseConfigured || !supabase) {
    // Offline mode - create local reaction
    const localReaction: Reaction = {
      id: `local_${Date.now()}`,
      username,
      track_id: trackId,
      track_title: trackTitle,
      track_artist: trackArtist,
      track_thumbnail: trackThumbnail,
      category,
      emoji: emoji || CATEGORY_EMOJIS[category],
      reaction_type: reactionType,
      comment,
      created_at: new Date().toISOString(),
      track_position: trackPosition,
    };
    get().addLocalReaction(localReaction);
    get().pulseCategory(category);
    get().updateCategoryPreference(category, reactionType);
    if (trackPosition !== undefined) {
      get().computeHotspots(trackId);
    }
    return true;
  }

  try {
    const { error } = await supabase.from('reactions').insert({
      username,
      track_id: trackId,
      track_title: trackTitle,
      track_artist: trackArtist,
      track_thumbnail: trackThumbnail,
      category,
      emoji: emoji || CATEGORY_EMOJIS[category],
      reaction_type: reactionType,
      comment,
      track_position: trackPosition,
    });

    if (error) {
      console.error('[Reactions] Error creating reaction:', error);
      return false;
    }

    get().pulseCategory(category);
    get().updateCategoryPreference(category, reactionType);
    if (trackPosition !== undefined) {
      get().computeHotspots(trackId);
    }
    return true;
  } catch (err) {
    console.error('[Reactions] Error:', err);
    return false;
  }
}
```

---

#### Fetch Reactions

**`fetchTrackReactions(trackId: string, limit = 50): Promise<Reaction[]>`**
- Fetches reactions for track from Supabase
- Caches locally in trackReactions map
- Returns empty array in offline mode

**`fetchUserReactions(username: string, limit = 50): Promise<Reaction[]>`**
- Fetches reactions by user from Supabase
- Returns empty array in offline mode

**`fetchTrackStats(trackId: string): Promise<TrackStats | null>`**
- Fetches aggregated stats from `track_stats` table
- Caches locally in trackStats map
- Returns null if not found or offline

**`fetchRecentReactions(limit = 20): Promise<Reaction[]>`**
- Fetches recent reactions across all tracks
- Updates recentReactions array
- Returns empty array in offline mode

---

#### Realtime Subscriptions

**`subscribeToReactions()`**
- Subscribes to Supabase Realtime channel for new reactions
- Listens for INSERT events on `reactions` table
- On new reaction:
  - Adds to recentReactions
  - Adds to trackReactions (if tracking that track)
  - Pulses category
- Stores channel reference for cleanup
- Sets isSubscribed to true

**`unsubscribeFromReactions()`**
- Removes Supabase channel
- Clears channel reference
- Sets isSubscribed to false

---

#### Local Updates

**`addLocalReaction(reaction: Reaction)`**
- Adds reaction to recentReactions (top 50)
- Adds to trackReactions map (top 100 per track)

**`pulseCategory(category: ReactionCategory)`**
- Increments category count
- Sets isHot to true
- Auto-resets isHot after 30 seconds

---

#### Hotspot Detection

**Purpose**: Find "hottest" parts of tracks where reactions cluster (like SoundCloud's waveform comments).

**`getHotspots(trackId: string): TrackHotspot[]`**
- Returns computed hotspots for track

**`computeHotspots(trackId: string)`**
- Divides track into 10 zones (each 10% of track)
- Buckets reactions into zones by position
- Calculates intensity (normalized by max count)
- Finds dominant reaction type per zone
- Stores in trackHotspots map

```typescript
computeHotspots: (trackId) => {
  const reactions = get().trackReactions.get(trackId) || [];
  const positionedReactions = reactions.filter(r => r.track_position !== undefined);

  if (positionedReactions.length === 0) return;

  // Divide track into 10 zones
  const ZONE_COUNT = 10;
  const zones: { reactions: Reaction[]; position: number }[] = [];

  for (let i = 0; i < ZONE_COUNT; i++) {
    zones.push({
      position: (i + 0.5) * (100 / ZONE_COUNT),  // Center of zone
      reactions: [],
    });
  }

  // Bucket reactions into zones
  positionedReactions.forEach(r => {
    const zoneIndex = Math.min(
      Math.floor((r.track_position! / 100) * ZONE_COUNT),
      ZONE_COUNT - 1
    );
    zones[zoneIndex].reactions.push(r);
  });

  // Find max count for normalization
  const maxCount = Math.max(...zones.map(z => z.reactions.length), 1);

  // Convert to hotspots
  const hotspots: TrackHotspot[] = zones
    .filter(z => z.reactions.length > 0)
    .map(z => {
      // Count reaction types
      const typeCounts: Record<ReactionType, number> = { like: 0, oye: 0, fire: 0 };
      z.reactions.forEach(r => {
        typeCounts[r.reaction_type]++;
      });

      // Find dominant type
      const dominantType = (Object.entries(typeCounts) as [ReactionType, number][])
        .sort((a, b) => b[1] - a[1])[0][0];

      return {
        position: z.position,
        intensity: z.reactions.length / maxCount,
        reactionCount: z.reactions.length,
        dominantType,
      };
    });

  // Update state
  set((state) => {
    const newMap = new Map(state.trackHotspots);
    newMap.set(trackId, hotspots);
    return { trackHotspots: newMap };
  });
}
```

---

#### For You Algorithm

**Purpose**: Learn user's category preferences to personalize recommendations.

**`updateCategoryPreference(category: ReactionCategory, reactionType: ReactionType)`**
- Increments reaction counters
- Updates lastReactedAt
- Recalculates score:
  ```typescript
  score = Math.min(100, 50 + (reactionCount + 1) * 5)
  ```
- Starts at 50, increases by 5 per reaction, caps at 100

**`getTopCategories(): CategoryPreference[]`**
- Returns all categories sorted by:
  1. Score (descending)
  2. Recency (descending)

**`getCategoryScore(category: ReactionCategory): number`**
- Returns score for category (default 50)

---

### Persistence

**None** - realtime data from Supabase, not persisted locally.

---

### Interactions with Other Stores

None directly - standalone social system.

---

### Initialization Hook

```typescript
export const initReactionSubscription = () => {
  const { subscribeToReactions, isSubscribed } = useReactionStore.getState();
  if (!isSubscribed) {
    subscribeToReactions();
  }
}
```

Call this on app start to subscribe to realtime reactions.

---

## 7. trackPoolStore.ts

**Purpose**: Intelligent dynamic track pool that grows, scores, and ages tracks based on intent + behavior.

**File**: `/home/dash/voyo-music/src/store/trackPoolStore.ts`

### Philosophy

Instead of static tracks, maintain a living pool that:
- Grows from user searches, related tracks, trending
- Scores tracks based on intent + behavior
- Promotes/demotes based on current vibe (never deletes)
- Ages tracks over time (cold storage for stale vibes)

---

### Pool Structure

```
┌─────────────────────────────────────────────────────┐
│  HOT POOL (active)     │  COLD POOL (aged out)     │
│  - High intent match   │  - Low recent activity    │
│  - Recently played     │  - Mismatched intent      │
│  - User reactions      │  - Recoverable on shift   │
└─────────────────────────────────────────────────────┘
```

---

### State Shape

```typescript
hotPool: PooledTrack[];     // Active rotation (HOT/DISCOVERY pull from here)
coldPool: PooledTrack[];    // Aged out (recoverable)

maxHotPoolSize: number;     // Max tracks in hot pool (default: 100)
maxColdPoolSize: number;    // Max tracks in cold pool (default: 200)
ageOutThreshold: number;    // Days without play before aging out (default: 7)
```

**PooledTrack Interface**:
```typescript
interface PooledTrack extends Track {
  // Pool metadata
  pooledAt: string;
  lastPlayedAt?: string;
  lastScoredAt?: string;

  // Engagement signals
  playCount: number;
  completionRate: number;    // 0-100
  reactionCount: number;
  queuedCount: number;
  skippedCount: number;

  // Classification
  detectedMode: VibeMode;
  confidence: number;        // 0-1

  // Pool status
  poolScore: number;         // 0-100
  isHot: boolean;
  isCold: boolean;

  // Source tracking
  source: 'seed' | 'search' | 'related' | 'trending' | 'llm' | 'album';
}
```

---

### Actions

#### Adding Tracks

**`addToPool(track: Track, source: PooledTrack['source'])`**
- Checks if already in pool (hot or cold)
- Detects vibe mode via `matchTrackToMode()`
- Creates PooledTrack with initial score (50)
- Adds to hot pool
- If hot pool exceeds maxHotPoolSize:
  - Sorts by poolScore descending
  - Moves lowest scored to cold pool
  - Trims cold pool to maxColdPoolSize

**`addManyToPool(tracks: Track[], source: PooledTrack['source'])`**
- Adds multiple tracks in batch

---

#### Engagement Tracking

**`recordPlay(trackId: string)`**
- Increments playCount
- Updates lastPlayedAt

**`recordCompletion(trackId: string, completionRate: number)`**
- Updates completionRate (running average)

**`recordReaction(trackId: string)`**
- Increments reactionCount

**`recordQueue(trackId: string)`**
- Increments queuedCount

**`recordSkip(trackId: string)`**
- Increments skippedCount

---

#### Pool Management

**`rescoreAllTracks()`**
- Imports intent weights from intentStore
- Recalculates poolScore for all tracks in hot pool
- Updates lastScoredAt

**`ageOutStale()`**
- Identifies tracks in hot pool that:
  - Haven't been played in > ageOutThreshold days
  - Have poolScore < 30
- Moves them to cold pool
- Trims cold pool to maxColdPoolSize

**`recoverFromCold(modeId: VibeMode, count: number)`**
- Finds tracks in cold pool matching modeId
- Moves them back to hot pool
- Resets poolScore to 50

---

#### Getters for HOT/DISCOVERY

**`getHotTracks(limit: number): PooledTrack[]`**
- Returns top tracks from hot pool sorted by poolScore
- Used by HOT belt

**`getTracksForMode(modeId: VibeMode, limit: number): PooledTrack[]`**
- Filters hot pool by detectedMode
- Sorts by poolScore descending
- Returns top tracks

**`getDiscoveryTracks(currentTrack: Track, limit: number): PooledTrack[]`**
- Detects current track's mode
- Scores hot pool tracks:
  - Same mode: +20 bonus
  - Same artist: +30 bonus
  - Base score: poolScore
- Sorts by total score descending
- Returns top tracks

---

#### Stats

**`getPoolStats(): { hot, cold, total }`**
- Returns pool size statistics

---

### Scoring Algorithm

```typescript
function calculatePoolScore(track: PooledTrack, intentWeights: Record<VibeMode, number>): number {
  let score = 0;

  // 1. INTENT MATCH (40%)
  const modeWeight = intentWeights[track.detectedMode] || 0.1;
  score += modeWeight * 40;

  // 2. RECENCY (30%)
  if (track.lastPlayedAt) {
    const daysSincePlay = (Date.now() - new Date(track.lastPlayedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 30 - daysSincePlay * 2); // Decays over 15 days
    score += recencyScore;
  } else {
    // Never played - give some score for being new
    const daysSincePooled = (Date.now() - new Date(track.pooledAt).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 20 - daysSincePooled * 4); // New tracks get boost that decays
  }

  // 3. ENGAGEMENT (30%)
  const engagementScore =
    (track.playCount * 2) +
    (track.completionRate * 0.2) +
    (track.reactionCount * 5) +
    (track.queuedCount * 3) -
    (track.skippedCount * 2);
  score += Math.min(30, Math.max(0, engagementScore));

  return Math.min(100, Math.max(0, score));
}
```

**Example**:
- Intent match (Afro-Heat): 0.6 × 40 = 24 points
- Recency (played 2 days ago): 30 - (2 × 2) = 26 points
- Engagement:
  - 5 plays × 2 = 10
  - 85% completion × 0.2 = 17
  - 3 reactions × 5 = 15
  - 1 queue × 3 = 3
  - 0 skips × -2 = 0
  - Total: 45 → capped at 30
- **Total**: 24 + 26 + 30 = 80 points

---

### Auto-Maintenance

**Purpose**: Keep pool fresh by rescoring and aging out stale tracks.

```typescript
// Run every 5 minutes when app is active
let maintenanceInterval: ReturnType<typeof setInterval> | null = null;

export function startPoolMaintenance(): void {
  if (maintenanceInterval) return;

  maintenanceInterval = setInterval(() => {
    const store = useTrackPoolStore.getState();
    store.rescoreAllTracks();
    store.ageOutStale();
  }, 5 * 60 * 1000); // 5 minutes
}

export function stopPoolMaintenance(): void {
  if (maintenanceInterval) {
    clearInterval(maintenanceInterval);
    maintenanceInterval = null;
  }
}
```

Call `startPoolMaintenance()` on app start.

---

### Persistence

**Storage Key**: `voyo-track-pool`

**Version**: 1

**Middleware**: Zustand `persist` middleware

**Persisted Data**:
- hotPool
- coldPool
- maxHotPoolSize
- maxColdPoolSize
- ageOutThreshold

---

### Interactions with Other Stores

1. **intentStore**: Consumes intent weights via `getIntentWeights()` for scoring
2. **playerStore**: Receives engagement events (play, complete, skip, queue, react)

---

### Track Detection

**`detectTrackMode(track: Track): { mode, confidence }`**
- Uses `matchTrackToMode()` from intentStore
- Returns best matching mode
- Confidence: 0.7 if matched, 0.3 for random-mixer

---

## 8. universeStore.ts

**Purpose**: The CORE of voyomusic.com/username architecture - manages authentication, sync, and portal system.

**File**: `/home/dash/voyo-music/src/store/universeStore.ts`

### Philosophy

- **URL IS your identity** (voyomusic.com/username)
- **PIN IS your key** (no email, no OAuth)
- **Supabase IS the smart KV** (username → universe)
- **localStorage IS offline cache**
- **Downloads stay LOCAL**

---

### State Shape

#### Auth State
```typescript
isLoggedIn: boolean;
currentUsername: string | null;
isLoading: boolean;
error: string | null;
```

#### Viewing State (when visiting /username)
```typescript
viewingUniverse: ViewingUniverse | null;
isViewingOther: boolean;
```

**ViewingUniverse Interface**:
```typescript
interface ViewingUniverse {
  username: string;
  profile: PublicProfile;
  nowPlaying: NowPlaying | null;
  portalOpen: boolean;
}
```

#### Portal State
```typescript
portalSession: PortalSession | null;
isPortalOpen: boolean;
portalSubscription: any | null;
```

**PortalSession Interface**:
```typescript
interface PortalSession {
  id: string;
  hostUsername: string;
  isHost: boolean;
  connectedPeers: string[];
  isLive: boolean;
  startedAt: string;
}
```

#### Backup State
```typescript
isExporting: boolean;
isImporting: boolean;
lastBackupAt: string | null;
```

---

### Actions

#### Authentication

**`signup(username: string, pin: string, displayName?: string): Promise<boolean>`**
- Normalizes username (lowercase, alphanumeric + underscore)
- Creates universe in Supabase via `universeAPI.create()`
- Falls back to localStorage in offline mode
- Saves username to localStorage
- Sets isLoggedIn and currentUsername
- Returns success/failure

**`login(username: string, pin: string): Promise<boolean>`**
- Validates credentials via `universeAPI.login()`
- Falls back to localStorage in offline mode
- Saves username to localStorage
- Sets isLoggedIn and currentUsername
- Syncs state from cloud (async, non-blocking)
- Returns success/failure

**`logout()`**
- Removes username and session from localStorage
- Clears auth state
- Clears portal session

**`checkUsername(username: string): Promise<boolean>`**
- Checks if username is available
- Returns true if available, false if taken

---

#### Viewing Other Universes

**`viewUniverse(username: string): Promise<boolean>`**
- Fetches public profile via `universeAPI.getPublicProfile()`
- If viewing own universe, returns early
- Sets viewingUniverse and isViewingOther
- If portal is open, subscribes to realtime updates
- Returns success/failure

**`leaveUniverse()`**
- Unsubscribes from realtime updates
- Clears viewingUniverse and isViewingOther

---

#### Cloud Sync

**`syncToCloud(): Promise<boolean>`**
- Collects state from preferenceStore and playerStore
- Builds UniverseState object:
  - likes (explicit likes from preferences)
  - preferences (boostProfile, shuffleMode, repeatMode)
  - queue (last 20 tracks)
  - history (last 50 plays)
  - stats (totalListens, totalMinutes, totalOyes)
- Pushes to Supabase via `universeAPI.updateState()`
- Returns success/failure

```typescript
syncToCloud: async () => {
  const { currentUsername, isLoggedIn } = get();
  if (!isLoggedIn || !currentUsername || !isSupabaseConfigured) return false;

  const preferences = usePreferenceStore.getState();
  const player = usePlayerStore.getState();

  const state: Partial<UniverseState> = {
    likes: Object.keys(preferences.trackPreferences).filter(
      (id) => preferences.trackPreferences[id]?.explicitLike === true
    ),
    preferences: {
      boostProfile: player.boostProfile,
      shuffleMode: player.shuffleMode,
      repeatMode: player.repeatMode,
    },
    queue: player.queue.slice(0, 20).map((q) => q.track.trackId || q.track.id),
    history: player.history.slice(-50).map((h) => ({
      trackId: h.track.trackId || h.track.id,
      playedAt: h.playedAt,
      duration: h.duration,
    })),
    stats: {
      totalListens: Object.values(preferences.trackPreferences).reduce(
        (sum, p) => sum + (p.totalListens || 0),
        0
      ),
      totalMinutes: Math.round(
        Object.values(preferences.trackPreferences).reduce(
          (sum, p) => sum + (p.totalDuration || 0),
          0
        ) / 60
      ),
      totalOyes: Object.values(preferences.trackPreferences).reduce(
        (sum, p) => sum + (p.reactions || 0),
        0
      ),
    },
  };

  return universeAPI.updateState(currentUsername, state);
}
```

**`syncFromCloud(): Promise<boolean>`**
- Fetches universe from Supabase
- Restores state to preferenceStore and playerStore:
  - likes → preferenceStore.setExplicitLike()
  - preferences → playerStore.setBoostProfile(), toggleShuffle()
  - queue → playerStore.addToQueue() (if local queue empty)
  - history → NOT restored (rebuilds naturally)
- Returns success/failure

**`updateNowPlaying(): Promise<void>`**
- Collects current track data from playerStore
- Pushes to Supabase via `universeAPI.updateNowPlaying()`
- Called automatically on track change and time updates (if portal open)

---

#### Portal System

**`openPortal(): Promise<string>`**
- Sets portal_open to true in Supabase
- Updates now_playing
- Creates portal session
- Generates and returns portal URL: `${origin}/${username}`

**`closePortal(): Promise<void>`**
- Sets portal_open to false in Supabase
- Clears now_playing
- Clears portal session

**`joinPortal(username: string): Promise<boolean>`**
- Calls viewUniverse() to join
- Returns success/failure

**`leavePortal()`**
- Calls leaveUniverse()

---

#### Backup System

**`exportUniverse(): UniverseData`**
- Collects all user data:
  - preferences (trackPreferences, artistPreferences, tagPreferences, moodPreferences)
  - player (currentTrackId, currentTime, volume, boostProfile, shuffleMode, repeatMode)
  - boostedTracks (from downloadStore)
  - playlists (empty for now)
  - history (last 100 plays)
- Returns UniverseData object

**`importUniverse(data: UniverseData): Promise<boolean>`**
- Writes data to localStorage
- Reloads page to apply changes
- Returns success/failure

**`downloadBackup()`**
- Exports universe
- Creates JSON blob
- Triggers browser download
- Saves last backup timestamp to localStorage

**`generatePassphrase(): string`**
- Generates 4-word passphrase from African-inspired word list
- Appends current year
- Example: "mango rhythm lagos ocean 2025"

**`saveToCloud(passphrase: string): Promise<boolean>`**
- Exports universe
- Encrypts with passphrase (AES-GCM)
- Hashes passphrase (SHA-256, first 16 hex chars)
- Saves encrypted data to localStorage with key: `voyo-backup-${hash}`
- Saves last backup timestamp
- Returns success/failure

**`restoreFromCloud(passphrase: string): Promise<boolean>`**
- Hashes passphrase
- Retrieves encrypted data from localStorage
- Decrypts with passphrase
- Imports universe
- Returns success/failure (false if wrong passphrase or not found)

---

### Persistence

**Storage Keys**:
- `voyo-username`: Current logged-in username
- `voyo-session`: Session data
- `voyo-last-backup`: Last backup timestamp
- `voyo-backup-{hash}`: Encrypted backups

---

### Encryption

**Algorithm**: AES-GCM with PBKDF2 key derivation

**`encryptData(data: string, passphrase: string): Promise<string>`**
1. Derive key from passphrase using PBKDF2 (100,000 iterations, SHA-256)
2. Generate random salt (16 bytes) and IV (12 bytes)
3. Encrypt data with AES-GCM
4. Combine salt + IV + encrypted data
5. Encode as base64
6. Return encrypted string

**`decryptData(encrypted: string, passphrase: string): Promise<string | null>`**
1. Decode base64
2. Extract salt (first 16 bytes) and IV (next 12 bytes)
3. Derive key from passphrase (same parameters)
4. Decrypt data with AES-GCM
5. Return decrypted string or null on failure

---

### Passphrase Word List

72 African-inspired words:
- Nature: mango, baobab, savanna, sunset, ocean, river, mountain, desert, jungle, forest, sunrise, thunder, rain, wind, fire, earth
- Music: rhythm, melody, drum, bass, guitar, voice, harmony, beat, groove, vibe, soul, spirit, dance, flow, wave, pulse
- Cities: africa, guinea, lagos, accra, dakar, nairobi, abuja, conakry, freetown, bamako, kinshasa, addis, cairo, tunis, algiers, rabat
- Culture: kente, dashiki, ankara, gele, beads, gold, bronze, ivory
- Food: jollof, fufu, suya, palm, coconut, pepper, spice, honey
- Values: peace, love, unity, power, wisdom, truth, light, hope, dream, magic, star, moon, sun, sky, cloud, rainbow

---

### Interactions with Other Stores

1. **preferenceStore**: Syncs explicit likes, restores preferences
2. **playerStore**: Syncs preferences, queue, history, now_playing
3. **playlistStore**: Syncs playlists (future)
4. **downloadStore**: Exports boosted track IDs

---

### Supabase Schema

**Table**: `universes`

**Columns**:
- `username` (primary key): Unique username
- `pin` (encrypted): Authentication PIN
- `public_profile`: Public profile data (JSON)
- `now_playing`: Current track data (JSON)
- `portal_open`: Portal status (boolean)
- `state`: User state (JSON) - preferences, queue, history, stats
- `created_at`: Account creation timestamp
- `updated_at`: Last update timestamp

---

## Store Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         UI Components                                │
└────────────┬────────────────────────────────────────────────────────┘
             │
             ▼
┌───────────────────────────────────────────────────────────────────────┐
│                            playerStore                                │
│  - Playback state, queue, history, recommendations                   │
│  - Triggers engagement events → trackPoolStore                       │
│  - Triggers reactions → preferenceStore                              │
│  - Triggers portal sync → universeStore                              │
└─────────┬─────────────────┬─────────────────┬───────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  trackPoolStore  │ │ preferenceStore  │ │  universeStore   │
│  - Scores tracks │ │ - Learns from    │ │ - Syncs to cloud │
│  - Ages stale    │ │   behavior       │ │ - Portal system  │
│  - Hot/cold pool │ │ - Tracks prefs   │ │ - Backup/restore │
└──────┬───────────┘ └──────────────────┘ └──────────────────┘
       │
       │ ← Consumes intent weights
       ▼
┌──────────────────┐
│   intentStore    │
│  - MixBoard bars │
│  - Drag events   │
│  - Intent scores │
└──────────────────┘

┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  downloadStore   │ │ reactionStore    │ │ playlistStore    │
│  - Boost HD      │ │ - Social spine   │ │ - Playlists      │
│  - Auto-cache    │ │ - Hotspots       │ │ - Cloud sync     │
│  - IndexedDB     │ │ - For You algo   │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘

```

---

## Persistence Summary

| Store | Storage Key | Middleware | What's Persisted |
|-------|-------------|-----------|-----------------|
| playerStore | `voyo-player-state` | Manual | currentTrackId, currentTime, voyoActiveTab |
| playlistStore | `voyo-playlists` | persist | playlists array |
| preferenceStore | `voyo-preferences` | persist | trackPreferences, artistPreferences, tagPreferences, moodPreferences, currentSession |
| downloadStore | `voyo-downloads` + IndexedDB | Manual | downloads map, boostedTracks (audio files in IndexedDB) |
| intentStore | `voyo-intent` | persist | modeIntents, currentSession, totalDragEvents, totalTracksQueued |
| reactionStore | None | None | Realtime from Supabase |
| trackPoolStore | `voyo-track-pool` | persist | hotPool, coldPool, settings |
| universeStore | `voyo-username`, `voyo-session` | Manual | username, auth state, encrypted backups |

---

## Performance Considerations

### Debouncing & Throttling

1. **playerStore.setCurrentTime**: Persists every 5 seconds (not every tick)
2. **downloadStore.boostTrack**: Progress updates throttled to 500ms
3. **preferenceStore.setExplicitLike**: Auto-syncs after 500ms
4. **playerStore.addToQueue**: Cloud sync after 1 second
5. **playerStore.addToHistory**: Cloud sync after 2 seconds

### Memory Management

1. **reactionStore.recentReactions**: Limited to 50 reactions
2. **reactionStore.trackReactions**: Limited to 100 per track
3. **playerStore.history**: Grows unbounded (consider limiting in future)
4. **trackPoolStore.hotPool**: Limited to 100 tracks (configurable)
5. **trackPoolStore.coldPool**: Limited to 200 tracks (configurable)

### Network Optimization

1. **downloadStore**: Prefetches tracks when added to queue
2. **playerStore**: Detects network quality and adjusts stream quality
3. **universeStore**: Syncs to cloud only when logged in and Supabase configured
4. **reactionStore**: Falls back to local-only in offline mode

---

## Testing Recommendations

### Unit Tests

1. Test scoring algorithms (trackPoolStore, intentStore)
2. Test persistence (load/save for each store)
3. Test edge cases (empty state, null values)

### Integration Tests

1. Test store interactions (playerStore → trackPoolStore engagement)
2. Test sync flow (universeStore ↔ Supabase)
3. Test portal realtime updates (reactionStore, universeStore)

### E2E Tests

1. Test full playback flow (play → track change → history)
2. Test download flow (manual boost → auto-cache)
3. Test portal flow (open → share URL → join → see now_playing)
4. Test backup flow (export → import → verify data)

---

## Future Improvements

### Performance

1. Implement queue size limit for playerStore.history
2. Add LRU cache for reactionStore.trackReactions
3. Use Web Workers for trackPoolStore.rescoreAllTracks()

### Features

1. Offline queue for reactionStore (sync when back online)
2. Differential sync for universeStore (only changed data)
3. Compress backups in universeStore
4. Add playlist sharing in playlistStore

### Architecture

1. Extract common persistence logic into middleware
2. Create store factory for consistent store creation
3. Add TypeScript strict mode compliance
4. Add JSDoc comments for all public APIs

---

## Conclusion

This documentation covers all 9 Zustand stores in the VOYO music application. Each store has a clear responsibility, well-defined state shape, and documented actions. The stores work together to create a seamless music experience with intelligent recommendations, social features, and robust offline support.

For questions or clarifications, refer to the source code at `/home/dash/voyo-music/src/store/`.

---

**Last Updated**: December 19, 2025
**Author**: VOYO Documentation Team
**Version**: 1.0.0
