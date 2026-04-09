# VOYO Stores - Architecture Overview

Visual representation of the VOYO Music state management architecture.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                              VOYO MUSIC                              │
│                          State Management                            │
└─────────────────────────────────────────────────────────────────────┘

                                  UI Layer
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
            │   Player UI  │  │  Portal UI   │  │ Settings UI  │
            └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                   │                 │                 │
                   └─────────────────┼─────────────────┘
                                     ▼
                          ┌─────────────────────┐
                          │    playerStore      │
                          │  (Orchestrator)     │
                          └──────────┬──────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
┌──────────────┐            ┌──────────────┐            ┌──────────────┐
│ trackPool    │            │ preference   │            │  universe    │
│   Store      │            │   Store      │            │   Store      │
│              │            │              │            │              │
│ • Hot Pool   │            │ • Learning   │            │ • Sync       │
│ • Cold Pool  │            │ • Tracking   │            │ • Portal     │
│ • Scoring    │            │ • Analytics  │            │ • Backup     │
└──────┬───────┘            └──────────────┘            └──────┬───────┘
       │                                                        │
       │                                                        │
       ▼                                                        ▼
┌──────────────┐                                      ┌──────────────┐
│   intent     │                                      │   Supabase   │
│   Store      │                                      │              │
│              │                                      │ • universes  │
│ • MixBoard   │                                      │ • reactions  │
│ • Intent     │                                      │ • profiles   │
│   Weights    │                                      └──────────────┘
└──────────────┘

        ┌────────────────────────────────────────────┐
        │           Supporting Stores                 │
        └────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  download    │      │  reaction    │      │  playlist    │
│   Store      │      │   Store      │      │   Store      │
│              │      │              │      │              │
│ • Boost HD   │      │ • Social     │      │ • CRUD       │
│ • Cache      │      │ • Hotspots   │      │ • Sync       │
│ • IndexedDB  │      │ • For You    │      └──────────────┘
└──────────────┘      └──────────────┘

```

---

## Data Flow Patterns

### Pattern 1: Playback Flow

```
User Action (Play Track)
         │
         ▼
┌─────────────────────┐
│   playerStore       │
│ setCurrentTrack()   │
└──────────┬──────────┘
           │
    ┌──────┴──────┬──────────────────┬───────────────┐
    ▼             ▼                  ▼               ▼
┌─────────┐  ┌─────────┐      ┌─────────┐    ┌─────────┐
│trackPool│  │preference│      │universe │    │download │
│recordPlay│ │startSession│    │updateNow│    │checkCache│
│         │  │         │       │Playing  │    │         │
└─────────┘  └─────────┘      └─────────┘    └─────────┘
```

### Pattern 2: Intent Learning Flow

```
User Interaction (MixBoard)
         │
         ▼
┌─────────────────────┐
│   intentStore       │
│ setManualBars()     │
└──────────┬──────────┘
           │
           ▼
    Calculate intentScore
           │
           ▼
┌─────────────────────┐
│  trackPoolStore     │
│ rescoreAllTracks()  │
└──────────┬──────────┘
           │
           ▼
   Update HOT/DISCOVERY
```

### Pattern 3: Social Reaction Flow

```
User Reaction (OYÉ)
         │
         ▼
┌─────────────────────┐
│   playerStore       │
│ addReaction()       │
└──────────┬──────────┘
           │
    ┌──────┴──────┬──────────────────┐
    ▼             ▼                  ▼
┌─────────┐  ┌─────────┐      ┌─────────┐
│preference│ │trackPool│       │reaction │
│recordRxn │ │recordRxn│       │create   │
└─────────┘  └─────────┘       └────┬────┘
                                     │
                                     ▼
                              ┌─────────┐
                              │Supabase │
                              │INSERT   │
                              └────┬────┘
                                   │
                                   ▼
                            Realtime Broadcast
                                   │
                                   ▼
                            All Connected Users
```

### Pattern 4: Download Flow

```
User Action (Boost HD)
         │
         ▼
┌─────────────────────┐
│  downloadStore      │
│ boostTrack()        │
└──────────┬──────────┘
           │
           ▼
    Check if cached
           │
           ▼
    Download from proxy
           │
    ┌──────┴──────┐
    │  Progress   │
    │  Updates    │ (throttled 500ms)
    └──────┬──────┘
           │
           ▼
    Save to IndexedDB
           │
           ▼
    Increment manualBoostCount
           │
           ▼
    Show auto-boost prompt? (≥3 boosts)
           │
           ▼
    Emit lastBoostCompletion
           │
           ▼
    AudioPlayer hot-swap (if < 7s)
```

### Pattern 5: Cloud Sync Flow

```
User Action (Login/Explicit Save)
         │
         ▼
┌─────────────────────┐
│  universeStore      │
│ syncToCloud()       │
└──────────┬──────────┘
           │
    ┌──────┴──────┬──────────────────┐
    ▼             ▼                  ▼
┌─────────┐  ┌─────────┐      ┌─────────┐
│preference│ │player   │       │playlist │
│getState  │ │getState │       │getState │
└────┬────┘  └────┬────┘       └────┬────┘
     │            │                  │
     └────────────┴──────────────────┘
                  │
                  ▼
           Build UniverseState
                  │
                  ▼
           ┌─────────────┐
           │  Supabase   │
           │   UPDATE    │
           └─────────────┘
```

---

## Store Responsibility Matrix

| Store | Read | Write | Compute | Sync | Realtime |
|-------|------|-------|---------|------|----------|
| playerStore | ✓ | ✓ | ✓ (discovery) | → universe | → universe |
| trackPoolStore | ✓ | ✓ | ✓ (scoring) | ✗ | ✗ |
| intentStore | ✓ | ✓ | ✓ (intent weights) | ✗ | ✗ |
| preferenceStore | ✓ | ✓ | ✓ (analytics) | → universe | ✗ |
| universeStore | ✓ | ✓ | ✗ | ✓ Supabase | ✓ Portal |
| downloadStore | ✓ | ✓ | ✗ | ✗ | ✗ |
| reactionStore | ✓ | ✓ | ✓ (hotspots) | ✓ Supabase | ✓ Reactions |
| playlistStore | ✓ | ✓ | ✗ | ✓ Supabase | ✗ |

---

## Persistence Strategy

```
┌────────────────────────────────────────────────────────────┐
│                    Persistence Layers                       │
└────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     localStorage                            │
│                                                             │
│  • Player state (track ID, position, tab)                  │
│  • Preferences (listening behavior)                        │
│  • Intent (MixBoard state)                                 │
│  • Track pool (hot/cold pools)                             │
│  • Playlists (local-first)                                 │
│  • Download settings                                       │
│  • Encrypted backups                                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      IndexedDB                              │
│                                                             │
│  • Cached audio files (Boost HD)                           │
│  • Track metadata (title, artist, thumbnail)               │
│  • Quality level (standard vs boosted)                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Supabase                               │
│                                                             │
│  • User universes (state, profile, portal)                 │
│  • Social reactions (realtime)                             │
│  • Track stats (aggregated)                                │
│  • Public profiles                                         │
│  • Now playing (realtime)                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Event Flow Diagram

### Startup Sequence

```
1. App Loads
   │
   ▼
2. Load localStorage
   │
   ├─→ playerStore: Restore track, position, tab
   ├─→ preferenceStore: Restore learning data
   ├─→ intentStore: Restore intent state
   ├─→ trackPoolStore: Restore pools
   └─→ universeStore: Check username & auth
   │
   ▼
3. Initialize downloadStore
   │
   ├─→ Migrate old VOYO IDs
   ├─→ Load cached tracks from IndexedDB
   └─→ Calculate cache size
   │
   ▼
4. Start pool maintenance
   │
   └─→ Rescore tracks every 5 minutes
   │
   ▼
5. Subscribe to reactions (if online)
   │
   └─→ Listen for realtime reaction events
   │
   ▼
6. Sync from cloud (if logged in)
   │
   └─→ Restore likes, preferences, queue
   │
   ▼
7. Detect network quality
   │
   └─→ Adjust stream quality
   │
   ▼
8. Ready
```

### Shutdown Sequence

```
1. User Closes App
   │
   ▼
2. End intent session
   │
   └─→ Recalculate intent scores
   │
   ▼
3. Close portal (if open)
   │
   └─→ Set portal_open = false in Supabase
   │
   ▼
4. Unsubscribe from reactions
   │
   └─→ Remove Supabase channel
   │
   ▼
5. Stop pool maintenance
   │
   └─→ Clear interval
   │
   ▼
6. Final sync to cloud (if logged in)
   │
   └─→ Save state to Supabase
   │
   ▼
7. Persist to localStorage
   │
   └─→ Save all stores
   │
   ▼
8. Done
```

---

## Error Handling Strategy

### Network Errors

```
┌─────────────────────────────────────────────────────────────┐
│                    Error Hierarchy                          │
└─────────────────────────────────────────────────────────────┘

Level 1: Critical (Blocks Core Functionality)
  • Authentication failure → Show error, prompt retry
  • Playback failure → Fallback to cached version or skip

Level 2: Important (Degrades Experience)
  • Cloud sync failure → Continue offline, retry later
  • Download failure → Show toast, keep retrying
  • Portal connection lost → Show "reconnecting..."

Level 3: Non-Critical (Silent Failures)
  • Reaction creation failed → Retry in background
  • Stats update failed → Skip, try next time
  • Prefetch failed → Skip, will fetch on demand
```

### Recovery Mechanisms

```
1. Automatic Retry
   • Network requests: 3 attempts with exponential backoff
   • Downloads: Queue for retry on network change

2. Fallback Strategies
   • Cloud sync → Use localStorage
   • Realtime → Poll API
   • Cached audio → Direct stream

3. User Feedback
   • Toasts for important errors
   • Silent retry for background tasks
   • Clear error messages with actions
```

---

## Performance Optimization

### Memory Management

```
┌─────────────────────────────────────────────────────────────┐
│                  Memory Budget                              │
└─────────────────────────────────────────────────────────────┘

Store               Max Size        Strategy
─────────────────────────────────────────────────────────────
playerStore
  • queue           50 items       Remove oldest
  • history         UNLIMITED      Consider cap at 500
  • hotTracks       5 items        Refresh on demand
  • discoverTracks  5 items        Refresh on demand

trackPoolStore
  • hotPool         100 tracks     Age out to cold
  • coldPool        200 tracks     LRU eviction

reactionStore
  • recentReactions 50 items       Ring buffer
  • trackReactions  100/track      LRU per track

preferenceStore
  • trackPref       UNLIMITED      Compress old data?
  • artistPref      UNLIMITED      Aggregate?

downloadStore
  • downloads       Map            Sync with IndexedDB
  • cachedTracks    UNLIMITED      User controls quota
```

### Computation Optimization

```
Expensive Operations:
1. trackPoolStore.rescoreAllTracks()
   • Runs every 5 minutes
   • Iterates all hot pool tracks
   • Optimization: Use Web Worker?

2. reactionStore.computeHotspots()
   • Runs on new reaction with position
   • Divides track into zones
   • Optimization: Debounce by 1 second

3. playerStore.refreshRecommendations()
   • Runs on user action
   • Queries hot/discovery tracks
   • Optimization: Cache for 30 seconds

4. intentStore.getIntentWeights()
   • Runs on trackPool rescore
   • Normalizes all mode scores
   • Optimization: Memoize result?
```

---

## Testing Strategy

### Unit Tests (Per Store)

```
✓ State initialization
✓ Action execution
✓ State updates
✓ Side effects (mocked)
✓ Edge cases (null, undefined, empty)
```

### Integration Tests (Store Interactions)

```
✓ playerStore → trackPoolStore engagement
✓ intentStore → trackPoolStore scoring
✓ playerStore → universeStore portal sync
✓ reactionStore → Supabase realtime
✓ universeStore → Supabase CRUD
```

### E2E Tests (Full Flows)

```
✓ Play track → record engagement → update pool
✓ Set intent → rescore pool → refresh discovery
✓ React to track → create in Supabase → broadcast
✓ Boost track → download → cache → hot-swap
✓ Open portal → share URL → join → see now_playing
✓ Export universe → download → import → verify
```

---

## Monitoring & Debugging

### Store Inspector (Development)

```typescript
// Add to window for debugging
if (process.env.NODE_ENV === 'development') {
  window.__VOYO_STORES__ = {
    player: usePlayerStore,
    trackPool: useTrackPoolStore,
    intent: useIntentStore,
    preference: usePreferenceStore,
    universe: useUniverseStore,
    download: useDownloadStore,
    reaction: useReactionStore,
    playlist: usePlaylistStore,
  };
}

// In console:
__VOYO_STORES__.player.getState()
__VOYO_STORES__.trackPool.getState().getPoolStats()
```

### Performance Metrics

```typescript
// Track action execution time
const startTime = performance.now();
usePlayerStore.getState().nextTrack();
const endTime = performance.now();
console.log(`nextTrack took ${endTime - startTime}ms`);

// Track store size
const storeSize = JSON.stringify(usePlayerStore.getState()).length;
console.log(`playerStore size: ${(storeSize / 1024).toFixed(2)} KB`);
```

---

## Migration Guide

### Adding New Store

1. Create store file in `/src/store/`
2. Define state interface
3. Define actions
4. Add persistence (if needed)
5. Update this documentation
6. Add to store inspector (dev mode)

### Breaking Store Changes

1. Increment version in persist config
2. Add migration logic
3. Test with old localStorage data
4. Document migration in changelog

### Example Migration

```typescript
export const useMyStore = create<MyStore>()(
  persist(
    (set, get) => ({
      // ... store implementation
    }),
    {
      name: 'voyo-my-store',
      version: 2, // Increment version
      migrate: (persistedState: any, version: number) => {
        if (version === 1) {
          // Migrate from v1 to v2
          return {
            ...persistedState,
            newField: 'default value',
          };
        }
        return persistedState;
      },
    }
  )
);
```

---

## Security Considerations

### Sensitive Data

```
✓ PINs: Never stored in plain text (hashed in Supabase)
✓ Session tokens: Stored in localStorage (consider httpOnly cookies?)
✓ Encrypted backups: AES-GCM with PBKDF2 key derivation
✗ WhatsApp numbers: Stored in plain text (consider encryption?)
```

### XSS Protection

```
✓ All user input sanitized before rendering
✓ No eval() or innerHTML usage
✓ Content Security Policy configured
```

### CSRF Protection

```
✓ Supabase handles CSRF via JWT
✓ No state-changing GET requests
```

---

## Future Architecture Improvements

### Phase 1: Performance
- [ ] Add Web Worker for heavy computations
- [ ] Implement request deduplication
- [ ] Add LRU cache for hot data
- [ ] Compress persisted data

### Phase 2: Reliability
- [ ] Add offline queue for failed operations
- [ ] Implement optimistic updates
- [ ] Add retry mechanisms with backoff
- [ ] Improve error recovery

### Phase 3: Scalability
- [ ] Implement virtual scrolling for large lists
- [ ] Add data pagination
- [ ] Lazy load non-critical stores
- [ ] Optimize bundle size

### Phase 4: Developer Experience
- [ ] Add Zustand DevTools integration
- [ ] Create store generator CLI
- [ ] Add TypeScript strict mode
- [ ] Improve documentation with Storybook

---

**Documentation Version**: 1.0.0
**Last Updated**: December 19, 2025
**Maintained By**: VOYO Development Team
