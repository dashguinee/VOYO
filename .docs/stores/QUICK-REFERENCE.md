# VOYO Stores - Quick Reference

Fast lookup guide for all Zustand stores in VOYO Music.

---

## Store Overview

| Store | File | Purpose | Persistence |
|-------|------|---------|------------|
| **playerStore** | playerStore.ts | Audio player state | `voyo-player-state` |
| **playlistStore** | playlistStore.ts | Playlist management | `voyo-playlists` |
| **preferenceStore** | preferenceStore.ts | User behavior learning | `voyo-preferences` |
| **downloadStore** | downloadStore.ts | Boost HD & auto-cache | IndexedDB + localStorage |
| **intentStore** | intentStore.ts | User intent tracking | `voyo-intent` |
| **reactionStore** | reactionStore.ts | Social reactions | Realtime (no persistence) |
| **trackPoolStore** | trackPoolStore.ts | Dynamic track pool | `voyo-track-pool` |
| **universeStore** | universeStore.ts | Universe sync, portal & auth | `voyo-username` |

---

## Most Used Actions by Store

### playerStore
```typescript
setCurrentTrack(track)          // Play new track
togglePlay()                    // Play/pause
nextTrack()                     // Skip to next
addToQueue(track, position?)    // Add to queue
setVolume(volume)              // Set volume (0-100)
```

### playlistStore
```typescript
createPlaylist(name)                        // Create new playlist
addTrackToPlaylist(playlistId, trackId)    // Add track
removeTrackFromPlaylist(playlistId, trackId) // Remove track
syncToCloud(username)                       // Push to cloud
```

### preferenceStore
```typescript
recordCompletion(trackId, duration, reactions)  // Track completion
recordSkip(trackId, listenDuration)            // Track skip
setExplicitLike(trackId, liked)                // Like/dislike
getTrackPreference(trackId)                    // Get preference data
```

### downloadStore
```typescript
boostTrack(trackId, title, artist, duration, thumbnail)  // Manual boost
cacheTrack(trackId, title, artist, duration, thumbnail)  // Auto-cache
checkCache(trackId)                                      // Check if cached
removeDownload(trackId)                                  // Delete cached track
```

### intentStore
```typescript
setManualBars(modeId, bars)        // Set MixBoard bars
recordDragToQueue(modeId)          // Record drag event
getIntentWeights()                 // Get normalized weights
getDominantModes(limit)            // Get top modes
```

### reactionStore
```typescript
createReaction({ username, trackId, trackTitle, category, ... })  // Create reaction
fetchTrackReactions(trackId, limit)                               // Get reactions for track
subscribeToReactions()                                            // Subscribe to realtime
getHotspots(trackId)                                             // Get track hotspots
```

### trackPoolStore
```typescript
addToPool(track, source)           // Add track to pool
recordPlay(trackId)                // Record play
recordCompletion(trackId, rate)    // Record completion
getHotTracks(limit)                // Get top hot tracks
getTracksForMode(modeId, limit)    // Get tracks for mode
```

### universeStore
```typescript
signup(username, pin, displayName?)  // Sign up
login(username, pin)                 // Login
syncToCloud()                        // Push state to cloud
openPortal()                         // Open portal
viewUniverse(username)               // Visit someone's universe
exportUniverse()                     // Export backup
```

---

## State Flow Examples

### Playing a Track
```
User clicks track
  ↓
playerStore.setCurrentTrack(track)
  ↓
├─→ playerStore.addToHistory(previousTrack)
├─→ trackPoolStore.recordPlay(track.id)
├─→ playerStore.updateDiscoveryForTrack(track)
└─→ universeStore.updateNowPlaying() (if portal open)
```

### Reacting to a Track
```
User clicks OYÉ button
  ↓
playerStore.addReaction(reaction)
  ↓
├─→ preferenceStore.recordReaction(trackId)
├─→ trackPoolStore.recordReaction(trackId)
└─→ reactionStore.createReaction(...) (if logged in)
```

### Boosting a Track
```
User clicks Boost HD
  ↓
downloadStore.boostTrack(trackId, ...)
  ↓
├─→ Download from proxy server
├─→ Save to IndexedDB
├─→ Update manualBoostCount
├─→ Show auto-boost prompt (after 3 boosts)
└─→ Emit lastBoostCompletion (for hot-swap)
```

### Changing MixBoard Bars
```
User sets Afro-Heat to 5 bars
  ↓
intentStore.setManualBars('afro-heat', 5)
  ↓
├─→ Recalculate intentScore
└─→ trackPoolStore.rescoreAllTracks() (on next maintenance cycle)
```

---

## Persistence Locations

### localStorage Keys
- `voyo-player-state` - Player position & track ID
- `voyo-volume` - Volume level
- `voyo-playlists` - Playlists array
- `voyo-preferences` - Listening preferences
- `voyo-account` - Account data
- `voyo-intent` - Intent data
- `voyo-track-pool` - Hot/cold pools
- `voyo-username` - Current username
- `voyo-session` - Session data
- `voyo-manual-boost-count` - Boost counter
- `voyo-auto-boost` - Auto-boost setting
- `voyo-backup-{hash}` - Encrypted backups

### IndexedDB
- Database: `voyo-cache`
- Store: `audio-files`
- Used by: downloadStore for cached audio files

### Supabase Tables
- `universes` - User universes (state, profile, portal)
- `reactions` - Social reactions
- `track_stats` - Aggregated reaction stats

---

## Common Patterns

### Accessing Store Outside React
```typescript
import { usePlayerStore } from './store/playerStore';

// Get state
const currentTrack = usePlayerStore.getState().currentTrack;

// Call action
usePlayerStore.getState().setCurrentTrack(track);
```

### Subscribing to Store Changes
```typescript
import { usePlayerStore } from './store/playerStore';

const unsubscribe = usePlayerStore.subscribe(
  (state) => state.isPlaying,
  (isPlaying) => {
    console.log('Playing state changed:', isPlaying);
  }
);

// Cleanup
unsubscribe();
```

### Using in React Component
```typescript
import { usePlayerStore } from './store/playerStore';

function Player() {
  const currentTrack = usePlayerStore(state => state.currentTrack);
  const isPlaying = usePlayerStore(state => state.isPlaying);
  const togglePlay = usePlayerStore(state => state.togglePlay);

  return (
    <button onClick={togglePlay}>
      {isPlaying ? 'Pause' : 'Play'}: {currentTrack?.title}
    </button>
  );
}
```

---

## Key Algorithms

### Track Pool Scoring
```
score = (intentMatch × 0.4) + (recency × 0.3) + (engagement × 0.3)

Where:
- intentMatch: How well track matches current intent weights
- recency: How recently track was played (decays over time)
- engagement: Play count, completion rate, reactions, queued, skipped
```

### Intent Scoring
```
intentScore = (manualBars × 15) + (dragToQueue × 25) + (tracksQueued × 5) + (sessionActivity × 10)

With time decay:
- Decays by 0.9^hours for inactive modes
```

### Completion Detection
```
completed = duration >= totalDuration × 0.8  (80% threshold)
skipped = duration < totalDuration × 0.2     (20% threshold)
```

---

## Debugging Tips

### Check Store State
```typescript
// In browser console
usePlayerStore.getState()
useTrackPoolStore.getState().getPoolStats()
useIntentStore.getState().getDominantModes()
```

### Clear Store Data
```typescript
// Clear specific store
localStorage.removeItem('voyo-player-state')

// Clear all VOYO data
Object.keys(localStorage)
  .filter(key => key.startsWith('voyo-'))
  .forEach(key => localStorage.removeItem(key));
```

### Monitor Store Changes
```typescript
// Log all playerStore changes
usePlayerStore.subscribe(console.log);

// Log specific property changes
usePlayerStore.subscribe(
  (state) => state.currentTrack,
  (track) => console.log('Track changed:', track)
);
```

---

## Performance Tips

1. **Selector Optimization**: Use specific selectors instead of full state
   ```typescript
   // Good
   const track = usePlayerStore(state => state.currentTrack);

   // Bad (causes re-render on any state change)
   const state = usePlayerStore();
   ```

2. **Batch Updates**: Use `set()` once instead of multiple times
   ```typescript
   // Good
   set({ isPlaying: true, currentTime: 0, progress: 0 });

   // Bad
   set({ isPlaying: true });
   set({ currentTime: 0 });
   set({ progress: 0 });
   ```

3. **Debounce Expensive Operations**: Like in downloadStore progress updates
   ```typescript
   if (now - lastUpdateTime < 500) return; // Throttle to 500ms
   ```

4. **Lazy Load Large Data**: Like in reactionStore hotspots
   ```typescript
   // Only compute when requested
   getHotspots: (trackId) => {
     return get().trackHotspots.get(trackId) || [];
   }
   ```

---

## Common Issues & Solutions

### Issue: State not persisting
**Solution**: Check if persist middleware is configured and localStorage is accessible

### Issue: Circular dependency errors
**Solution**: Use dynamic imports with `import()` inside actions

### Issue: Stale state in actions
**Solution**: Always use `get()` inside actions to get fresh state

### Issue: React not re-rendering
**Solution**: Ensure you're using selectors correctly in components

### Issue: IndexedDB quota exceeded
**Solution**: Clear cache via `downloadStore.clearAllDownloads()`

---

## Documentation

- **Full Documentation**: See [STORES-DOCUMENTATION.md](./STORES-DOCUMENTATION.md)
- **Source Files**: `/home/dash/voyo-music/src/store/`

---

**Last Updated**: December 19, 2025
