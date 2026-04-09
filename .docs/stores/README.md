# VOYO Music - Store Documentation

Complete, exhaustive documentation for all Zustand state management stores in the VOYO music application.

---

## Documentation Files

This directory contains comprehensive documentation for the VOYO Music state management system:

### 1. [STORES-DOCUMENTATION.md](./STORES-DOCUMENTATION.md)
**76KB | 2,863 lines**

The complete reference - every store, every action, every property documented in detail.

**Contents**:
- Full state shape for each store
- Line-by-line action explanations
- Complex logic breakdowns
- Persistence strategies
- Store interactions
- Code examples and snippets
- State flow diagrams

**Use this when**:
- Learning how a store works
- Understanding specific actions
- Debugging store behavior
- Implementing new features
- Onboarding new developers

---

### 2. [QUICK-REFERENCE.md](./QUICK-REFERENCE.md)

Fast lookup guide for common operations and patterns.

**Contents**:
- Store overview table
- Most used actions
- State flow examples
- Common patterns
- Debugging tips
- Performance tips
- Common issues & solutions

**Use this when**:
- Need quick action syntax
- Looking up store interactions
- Checking persistence locations
- Finding common patterns
- Troubleshooting issues

---

### 3. [ARCHITECTURE.md](./ARCHITECTURE.md)

Visual and architectural overview of the entire state management system.

**Contents**:
- System architecture diagrams
- Data flow patterns
- Responsibility matrix
- Persistence strategy
- Event flow diagrams
- Error handling strategy
- Performance optimization
- Testing strategy
- Security considerations

**Use this when**:
- Understanding system design
- Planning new features
- Optimizing performance
- Setting up monitoring
- Architecting changes

---

## Store Overview

| # | Store | File | Lines | Purpose |
|---|-------|------|-------|---------|
| 1 | playerStore | playerStore.ts | 764 | Audio player state, queue, history, recommendations |
| 2 | playlistStore | playlistStore.ts | 182 | Playlist CRUD and cloud sync |
| 3 | preferenceStore | preferenceStore.ts | 365 | User behavior learning and personalization |
| 4 | downloadStore | downloadStore.ts | 474 | Boost HD downloads and auto-cache |
| 5 | intentStore | intentStore.ts | 410 | User intent tracking from MixBoard |
| 6 | reactionStore | reactionStore.ts | 595 | Social reactions and engagement |
| 7 | trackPoolStore | trackPoolStore.ts | 442 | Dynamic track pool management |
| 8 | universeStore | universeStore.ts | 757 | Universe sync, portal system, and authentication |

**Total**: 3,989 lines of production code

---

## Quick Start

### Reading Store State

```typescript
import { usePlayerStore } from './store/playerStore';

// In React component
function MyComponent() {
  const currentTrack = usePlayerStore(state => state.currentTrack);
  const isPlaying = usePlayerStore(state => state.isPlaying);

  return <div>{currentTrack?.title} - {isPlaying ? 'Playing' : 'Paused'}</div>;
}

// Outside React
const currentTrack = usePlayerStore.getState().currentTrack;
```

### Calling Actions

```typescript
import { usePlayerStore } from './store/playerStore';

// In React component
function PlayButton() {
  const togglePlay = usePlayerStore(state => state.togglePlay);

  return <button onClick={togglePlay}>Toggle Play</button>;
}

// Outside React
usePlayerStore.getState().togglePlay();
```

### Subscribing to Changes

```typescript
import { usePlayerStore } from './store/playerStore';

// Subscribe to specific property
const unsubscribe = usePlayerStore.subscribe(
  (state) => state.isPlaying,
  (isPlaying) => {
    console.log('Playing state changed:', isPlaying);
  }
);

// Cleanup
unsubscribe();
```

---

## Store Relationships

```
                    playerStore (Orchestrator)
                          |
      +-------------------+-------------------+
      |                   |                   |
trackPoolStore    preferenceStore      universeStore
      |                   |                   |
  intentStore             |              Supabase
                          |
                    +-----+-----+
                    |           |
            downloadStore  reactionStore
                                |
                          Supabase Realtime
```

**Key Relationships**:
- **playerStore** triggers engagement events in trackPoolStore and preferenceStore
- **intentStore** provides weights to trackPoolStore for scoring
- **universeStore** syncs state from preferenceStore, playerStore, and playlistStore
- **reactionStore** broadcasts social events via Supabase Realtime
- **downloadStore** operates independently for local caching

---

## Persistence Summary

| Store | Storage | Type | Size |
|-------|---------|------|------|
| playerStore | localStorage | Manual | ~1KB |
| playlistStore | localStorage | persist | ~10KB |
| preferenceStore | localStorage | persist | ~50KB |
| downloadStore | IndexedDB + localStorage | Manual | Varies (user controlled) |
| intentStore | localStorage | persist | ~5KB |
| reactionStore | None (Realtime) | - | - |
| trackPoolStore | localStorage | persist | ~100KB |
| universeStore | localStorage | Manual | ~2KB |

**Total localStorage**: ~170KB
**IndexedDB**: User-controlled (audio files)
**Supabase**: Synced state + realtime

---

## Common Tasks

### Task 1: Add New Track to Queue

```typescript
import { usePlayerStore } from './store/playerStore';

const track = {
  id: 'track-123',
  title: 'Song Title',
  artist: 'Artist Name',
  // ... other track properties
};

usePlayerStore.getState().addToQueue(track);
```

### Task 2: Record User Reaction

```typescript
import { usePlayerStore } from './store/playerStore';

usePlayerStore.getState().addReaction({
  type: 'oye',
  multiplier: 1,
  timestamp: Date.now(),
});
```

### Task 3: Boost Track for Offline

```typescript
import { useDownloadStore } from './store/downloadStore';

const store = useDownloadStore.getState();
await store.boostTrack(
  trackId,
  'Song Title',
  'Artist Name',
  180, // duration in seconds
  'https://...' // thumbnail URL
);
```

### Task 4: Sync to Cloud

```typescript
import { useUniverseStore } from './store/universeStore';

const success = await useUniverseStore.getState().syncToCloud();
if (success) {
  console.log('Synced to cloud');
}
```

### Task 5: Set User Intent

```typescript
import { useIntentStore } from './store/intentStore';

// User sets Afro-Heat to 5 bars on MixBoard
useIntentStore.getState().setManualBars('afro-heat', 5);
```

---

## Development Workflow

### 1. Setup Development Environment

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

### 2. Enable Store Inspector

Add to your browser console:

```typescript
// Access stores in console
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

// Example usage
__VOYO_STORES__.player.getState()
__VOYO_STORES__.trackPool.getState().getPoolStats()
```

### 3. Debug Store Changes

```typescript
// Log all changes to playerStore
usePlayerStore.subscribe(console.log);

// Log specific property changes
usePlayerStore.subscribe(
  (state) => state.currentTrack,
  (track) => console.log('Track changed:', track)
);
```

### 4. Clear Store Data

```typescript
// Clear specific store
localStorage.removeItem('voyo-player-state');

// Clear all VOYO data
Object.keys(localStorage)
  .filter(key => key.startsWith('voyo-'))
  .forEach(key => localStorage.removeItem(key));

// Clear IndexedDB
const store = useDownloadStore.getState();
await store.clearAllDownloads();
```

---

## Testing

### Unit Testing Example

```typescript
import { usePlayerStore } from './store/playerStore';

describe('playerStore', () => {
  beforeEach(() => {
    // Reset store
    usePlayerStore.setState({
      currentTrack: null,
      isPlaying: false,
      queue: [],
      history: [],
    });
  });

  it('should set current track', () => {
    const track = { id: '1', title: 'Test', artist: 'Artist' };

    usePlayerStore.getState().setCurrentTrack(track);

    const state = usePlayerStore.getState();
    expect(state.currentTrack).toEqual(track);
    expect(state.isPlaying).toBe(true);
    expect(state.currentTime).toBe(0);
  });

  it('should add track to queue', () => {
    const track = { id: '1', title: 'Test', artist: 'Artist' };

    usePlayerStore.getState().addToQueue(track);

    const state = usePlayerStore.getState();
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0].track).toEqual(track);
  });
});
```

---

## Performance Considerations

### Selector Optimization

```typescript
// ✅ Good - only re-renders when currentTrack changes
const currentTrack = usePlayerStore(state => state.currentTrack);

// ❌ Bad - re-renders on any state change
const state = usePlayerStore();
const currentTrack = state.currentTrack;
```

### Batch Updates

```typescript
// ✅ Good - single update
set({ isPlaying: true, currentTime: 0, progress: 0 });

// ❌ Bad - three separate updates
set({ isPlaying: true });
set({ currentTime: 0 });
set({ progress: 0 });
```

### Debouncing

```typescript
// Example from downloadStore
let lastUpdateTime = 0;
const success = await downloadTrack(
  trackId,
  url,
  metadata,
  quality,
  (progress) => {
    const now = Date.now();
    if (now - lastUpdateTime < 500) return; // Throttle to 500ms
    lastUpdateTime = now;
    // Update UI
  }
);
```

---

## Troubleshooting

### Issue: Store state not persisting

**Symptoms**: Changes lost on page refresh

**Solutions**:
1. Check if `persist` middleware is configured
2. Verify localStorage is accessible (not in private mode)
3. Check for localStorage quota exceeded
4. Inspect localStorage in DevTools

### Issue: Circular dependency errors

**Symptoms**: Import errors, undefined store methods

**Solutions**:
1. Use dynamic imports: `const { useXStore } = await import('./xStore')`
2. Move shared types to separate file
3. Use callbacks instead of direct imports

### Issue: React not re-rendering

**Symptoms**: UI doesn't update when store changes

**Solutions**:
1. Use selectors: `useStore(state => state.property)`
2. Check if mutation is happening (use `set()`, not direct mutation)
3. Verify selector returns new reference for objects/arrays

### Issue: IndexedDB quota exceeded

**Symptoms**: Download failures with quota errors

**Solutions**:
1. Clear cache: `useDownloadStore.getState().clearAllDownloads()`
2. Check cache size: `useDownloadStore.getState().cacheSize`
3. Delete specific tracks: `useDownloadStore.getState().removeDownload(trackId)`

---

## Migration Guide

### From v1 to v2

If you have old localStorage data from VOYO v1, migration happens automatically:

1. **VOYO IDs**: Old `vyo_` encoded IDs are decoded to raw YouTube IDs
2. **Preferences**: Structure remains the same
3. **Playlists**: Added `coverUrl` field (optional)
4. **Downloads**: Migrated to new quality system (standard/boosted)

### Manual Migration

```typescript
// Clear old data
localStorage.clear();

// Reimport from backup
const data = JSON.parse(backupJson);
await useUniverseStore.getState().importUniverse(data);
```

---

## Contributing

### Adding New Store

1. Create `/src/store/newStore.ts`
2. Define state interface
3. Implement actions with `set()` and `get()`
4. Add persistence if needed
5. Document in this folder
6. Add to store inspector
7. Write unit tests

### Store Template

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NewStore {
  // State
  value: number;

  // Actions
  increment: () => void;
  decrement: () => void;
}

export const useNewStore = create<NewStore>()(
  persist(
    (set, get) => ({
      // Initial state
      value: 0,

      // Actions
      increment: () => set((state) => ({ value: state.value + 1 })),
      decrement: () => set((state) => ({ value: state.value - 1 })),
    }),
    {
      name: 'voyo-new-store',
      version: 1,
    }
  )
);
```

---

## Resources

### Internal Documentation
- [Full Store Documentation](./STORES-DOCUMENTATION.md) - Complete reference
- [Quick Reference](./QUICK-REFERENCE.md) - Fast lookup guide
- [Architecture Overview](./ARCHITECTURE.md) - System design

### External Resources
- [Zustand Documentation](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [Zustand Persist Middleware](https://docs.pmnd.rs/zustand/integrations/persisting-store-data)
- [React State Management Patterns](https://kentcdodds.com/blog/application-state-management-with-react)

### Source Code
- Store files: `/home/dash/voyo-music/src/store/`
- Type definitions: `/home/dash/voyo-music/src/types/`
- Services: `/home/dash/voyo-music/src/services/`

---

## Support

### Getting Help

1. **Check Documentation**: Start with this README, then drill into specific docs
2. **Search Issues**: Look for similar issues in GitHub
3. **Debug Tools**: Use store inspector and console logging
4. **Ask Team**: Reach out on team chat with context

### Reporting Issues

When reporting store-related issues, include:

1. **Store name**: Which store is affected?
2. **Action/state**: What action was called? What state changed?
3. **Expected behavior**: What should happen?
4. **Actual behavior**: What actually happened?
5. **Reproduction steps**: How to reproduce the issue?
6. **Console logs**: Any errors or warnings?
7. **Store state**: Current state (use `getState()`)

---

## Changelog

### v1.0.0 (December 19, 2025)
- Initial comprehensive documentation
- Documented all 9 stores exhaustively
- Created quick reference guide
- Added architecture overview
- Included examples and patterns

---

**Documentation Maintained By**: VOYO Development Team
**Last Updated**: December 19, 2025
**Documentation Version**: 1.0.0
