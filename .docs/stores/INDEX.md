# VOYO Stores Documentation - Index

Quick navigation guide to all store documentation.

---

## Documentation Structure

```
.docs/stores/
├── README.md                    (14KB, 587 lines)  - Start here
├── STORES-DOCUMENTATION.md      (76KB, 2,863 lines) - Complete reference
├── QUICK-REFERENCE.md           (9.5KB, 354 lines) - Fast lookup
├── ARCHITECTURE.md              (24KB, 657 lines)  - System design
└── INDEX.md                     (This file)        - Navigation
```

**Total**: 132KB of comprehensive documentation

---

## Where to Start

### New to VOYO Stores?
**Start here**: [README.md](./README.md)
- Overview of all stores
- Quick start guide
- Common tasks
- Development workflow

### Need to Understand a Store?
**Go to**: [STORES-DOCUMENTATION.md](./STORES-DOCUMENTATION.md)
- Complete documentation for each store
- Every property, action, and interaction
- Line-by-line explanations
- Code examples

### Need Quick Syntax?
**Go to**: [QUICK-REFERENCE.md](./QUICK-REFERENCE.md)
- Most used actions
- Common patterns
- Debugging tips
- Troubleshooting

### Planning Architecture Changes?
**Go to**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- System diagrams
- Data flow patterns
- Performance optimization
- Testing strategy

---

## Store Directory

### 1. playerStore.ts (764 lines)
**Purpose**: Audio player state, queue, history, recommendations

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#1-playerstorests)
- [Quick Actions](./QUICK-REFERENCE.md#playerstore)
- [Architecture](./ARCHITECTURE.md#pattern-1-playback-flow)

**Key Actions**:
- `setCurrentTrack(track)` - Play new track
- `addToQueue(track)` - Add to queue
- `nextTrack()` - Skip forward
- `togglePlay()` - Play/pause

---

### 2. playlistStore.ts (182 lines)
**Purpose**: Playlist CRUD and cloud sync

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#2-playliststorests)
- [Quick Actions](./QUICK-REFERENCE.md#playliststore)

**Key Actions**:
- `createPlaylist(name)` - Create playlist
- `addTrackToPlaylist(playlistId, trackId)` - Add track
- `syncToCloud(username)` - Sync to Supabase

---

### 3. preferenceStore.ts (365 lines)
**Purpose**: User behavior learning and personalization

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#3-preferencestorests)
- [Quick Actions](./QUICK-REFERENCE.md#preferencestore)

**Key Actions**:
- `recordCompletion(trackId, duration, reactions)` - Track completion
- `recordSkip(trackId, listenDuration)` - Track skip
- `setExplicitLike(trackId, liked)` - Like/dislike

---

### 4. downloadStore.ts (474 lines)
**Purpose**: Boost HD downloads and auto-cache

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#5-downloadstorests)
- [Quick Actions](./QUICK-REFERENCE.md#downloadstore)
- [Architecture](./ARCHITECTURE.md#pattern-4-download-flow)

**Key Actions**:
- `boostTrack(...)` - Manual HD download
- `cacheTrack(...)` - Auto-cache
- `checkCache(trackId)` - Check if cached

---

### 5. intentStore.ts (410 lines)
**Purpose**: User intent tracking from MixBoard

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#5-intentstorests)
- [Quick Actions](./QUICK-REFERENCE.md#intentstore)
- [Architecture](./ARCHITECTURE.md#pattern-2-intent-learning-flow)

**Key Actions**:
- `setManualBars(modeId, bars)` - Set MixBoard bars
- `recordDragToQueue(modeId)` - Record drag event
- `getIntentWeights()` - Get normalized weights

---

### 6. reactionStore.ts (595 lines)
**Purpose**: Social reactions and engagement

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#7-reactionstorests)
- [Quick Actions](./QUICK-REFERENCE.md#reactionstore)
- [Architecture](./ARCHITECTURE.md#pattern-3-social-reaction-flow)

**Key Actions**:
- `createReaction(...)` - Create reaction
- `fetchTrackReactions(trackId)` - Get reactions
- `subscribeToReactions()` - Subscribe to realtime

---

### 7. trackPoolStore.ts (442 lines)
**Purpose**: Dynamic track pool management

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#7-trackpoolstorests)
- [Quick Actions](./QUICK-REFERENCE.md#trackpoolstore)

**Key Actions**:
- `addToPool(track, source)` - Add track
- `rescoreAllTracks()` - Rescore pool
- `getHotTracks(limit)` - Get top tracks

---

### 8. universeStore.ts (757 lines)
**Purpose**: Universe sync, portal system, and authentication

**Documentation**:
- [Complete Docs](./STORES-DOCUMENTATION.md#8-universestorests)
- [Quick Actions](./QUICK-REFERENCE.md#universestore)
- [Architecture](./ARCHITECTURE.md#pattern-5-cloud-sync-flow)

**Key Actions**:
- `signup(username, pin)` - Sign up
- `login(username, pin)` - Login
- `logout()` - Logout
- `syncToCloud()` - Push to cloud
- `openPortal()` - Open portal
- `exportUniverse()` - Export backup

---

## Search by Topic

### Audio Playback
- playerStore: [Docs](./STORES-DOCUMENTATION.md#1-playerstorests) | [Quick](./QUICK-REFERENCE.md#playerstore)

### User Learning & Personalization
- preferenceStore: [Docs](./STORES-DOCUMENTATION.md#3-preferencestorests)
- intentStore: [Docs](./STORES-DOCUMENTATION.md#6-intentstorests)
- trackPoolStore: [Docs](./STORES-DOCUMENTATION.md#8-trackpoolstorests)

### Offline & Downloads
- downloadStore: [Docs](./STORES-DOCUMENTATION.md#5-downloadstorests)

### Social & Realtime
- reactionStore: [Docs](./STORES-DOCUMENTATION.md#7-reactionstorests)
- universeStore (Portal): [Docs](./STORES-DOCUMENTATION.md#9-universestorests)

### Authentication
- universeStore: [Docs](./STORES-DOCUMENTATION.md#8-universestorests)

### Cloud Sync
- universeStore: [Docs](./STORES-DOCUMENTATION.md#9-universestorests)
- playlistStore: [Docs](./STORES-DOCUMENTATION.md#2-playliststorests)

---

## Search by Feature

### Queue Management
- Add to queue: [playerStore.addToQueue](./STORES-DOCUMENTATION.md#queue-management)
- Remove from queue: [playerStore.removeFromQueue](./STORES-DOCUMENTATION.md#queue-management)
- Reorder queue: [playerStore.reorderQueue](./STORES-DOCUMENTATION.md#queue-management)

### Recommendations
- Hot tracks: [playerStore.hotTracks](./STORES-DOCUMENTATION.md#recommendations-personalized-belts)
- Discovery: [playerStore.discoverTracks](./STORES-DOCUMENTATION.md#recommendations-personalized-belts)
- Pool-aware: [trackPoolStore](./STORES-DOCUMENTATION.md#8-trackpoolstorests)

### Downloads
- Boost HD: [downloadStore.boostTrack](./STORES-DOCUMENTATION.md#manual-boost)
- Auto-cache: [downloadStore.cacheTrack](./STORES-DOCUMENTATION.md#auto-cache)
- Check cached: [downloadStore.checkCache](./STORES-DOCUMENTATION.md#cache-check)

### Social
- Create reaction: [reactionStore.createReaction](./STORES-DOCUMENTATION.md#create-reaction)
- Track hotspots: [reactionStore.getHotspots](./STORES-DOCUMENTATION.md#hotspot-detection)
- Realtime: [reactionStore.subscribeToReactions](./STORES-DOCUMENTATION.md#realtime-subscriptions)

### Portal
- Open portal: [universeStore.openPortal](./STORES-DOCUMENTATION.md#portal-system)
- View universe: [universeStore.viewUniverse](./STORES-DOCUMENTATION.md#viewing-other-universes)
- Now playing: [universeStore.updateNowPlaying](./STORES-DOCUMENTATION.md#cloud-sync)

### Backup & Restore
- Export: [universeStore.exportUniverse](./STORES-DOCUMENTATION.md#backup-system)
- Import: [universeStore.importUniverse](./STORES-DOCUMENTATION.md#backup-system)
- Encrypted: [universeStore.saveToCloud](./STORES-DOCUMENTATION.md#backup-system)

---

## Common Workflows

### Workflow 1: Playing Music
1. Load track → [playerStore.setCurrentTrack](./STORES-DOCUMENTATION.md#playback-control)
2. Track engagement → [trackPoolStore.recordPlay](./STORES-DOCUMENTATION.md#engagement-tracking)
3. Update discovery → [playerStore.updateDiscoveryForTrack](./STORES-DOCUMENTATION.md#recommendations)

### Workflow 2: User Reactions
1. React to track → [playerStore.addReaction](./STORES-DOCUMENTATION.md#reactions)
2. Record preference → [preferenceStore.recordReaction](./STORES-DOCUMENTATION.md#behavior-recording)
3. Update pool score → [trackPoolStore.recordReaction](./STORES-DOCUMENTATION.md#engagement-tracking)
4. Broadcast to social → [reactionStore.createReaction](./STORES-DOCUMENTATION.md#create-reaction)

### Workflow 3: Setting Intent
1. Set MixBoard bars → [intentStore.setManualBars](./STORES-DOCUMENTATION.md#mixboard-interactions)
2. Calculate weights → [intentStore.getIntentWeights](./STORES-DOCUMENTATION.md#intent-scores)
3. Rescore pool → [trackPoolStore.rescoreAllTracks](./STORES-DOCUMENTATION.md#pool-management)
4. Refresh discovery → [playerStore.refreshRecommendations](./STORES-DOCUMENTATION.md#recommendations)

### Workflow 4: Cloud Sync
1. Collect state → [preferenceStore, playerStore, playlistStore](./STORES-DOCUMENTATION.md)
2. Build payload → [universeStore.syncToCloud](./STORES-DOCUMENTATION.md#cloud-sync)
3. Push to Supabase → [universeAPI.updateState](./STORES-DOCUMENTATION.md#supabase-schema)

---

## Debugging Guide

### Issue: Store not working
**Check**:
1. Store imported correctly? `import { useXStore } from './store/xStore'`
2. Action called correctly? `useXStore.getState().action()`
3. Selector specific? `useXStore(state => state.property)`
4. Console errors? Check browser DevTools

### Issue: State not persisting
**Check**:
1. Persist middleware configured? See [persistence](./STORES-DOCUMENTATION.md#persistence)
2. localStorage accessible? Not in private mode?
3. Quota exceeded? Check cache size
4. Key correct? See [persistence locations](./QUICK-REFERENCE.md#persistence-locations)

### Issue: Circular dependencies
**Solution**:
1. Use dynamic imports: `await import('./store')`
2. Move shared types to separate file
3. Use callbacks instead of direct imports

### Issue: Performance slow
**Check**:
1. Selector optimization? [Performance tips](./QUICK-REFERENCE.md#performance-tips)
2. Batch updates? [Batch updates pattern](./ARCHITECTURE.md#performance-optimization)
3. Debouncing? [Throttling example](./STORES-DOCUMENTATION.md#manual-boost)

---

## Development Checklist

### Before Making Changes
- [ ] Read relevant store documentation
- [ ] Understand current architecture
- [ ] Check for existing patterns
- [ ] Plan state changes

### While Making Changes
- [ ] Follow existing patterns
- [ ] Use `set()` for updates
- [ ] Use `get()` for current state
- [ ] Add TypeScript types

### After Making Changes
- [ ] Test store actions
- [ ] Verify persistence
- [ ] Check for side effects
- [ ] Update documentation

### Before Committing
- [ ] Run unit tests
- [ ] Test in browser
- [ ] Check bundle size
- [ ] Update changelog

---

## Resources

### Documentation Files
- [README.md](./README.md) - Overview and quick start
- [STORES-DOCUMENTATION.md](./STORES-DOCUMENTATION.md) - Complete reference
- [QUICK-REFERENCE.md](./QUICK-REFERENCE.md) - Fast lookup
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design

### Source Code
- Store files: `/home/dash/voyo-music/src/store/`
- Type definitions: `/home/dash/voyo-music/src/types/`
- Services: `/home/dash/voyo-music/src/services/`

### External Resources
- [Zustand Docs](https://docs.pmnd.rs/zustand)
- [React Patterns](https://kentcdodds.com/blog/application-state-management-with-react)

---

## Getting Help

1. **Search this index** for your topic
2. **Check quick reference** for syntax
3. **Read full docs** for understanding
4. **Review architecture** for design
5. **Ask team** with context

---

**Last Updated**: December 19, 2025
**Documentation Version**: 1.0.0
**Total Lines**: 4,461 lines of documentation
**Total Size**: 132KB
