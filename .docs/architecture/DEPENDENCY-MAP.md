# VOYO Music - Comprehensive Dependency Map

**Last Updated**: 2025-12-19
**Codebase**: /home/dash/voyo-music/

---

## Table of Contents

1. [External Dependencies](#external-dependencies)
2. [Internal Module Dependencies](#internal-module-dependencies)
3. [Store Dependencies](#store-dependencies)
4. [Service Dependencies](#service-dependencies)
5. [Component Dependencies](#component-dependencies)
6. [Circular Dependencies](#circular-dependencies)
7. [Bundle Impact Analysis](#bundle-impact-analysis)
8. [Dependency Graphs](#dependency-graphs)

---

## 1. External Dependencies

### Production Dependencies (package.json)

| Package | Version | Purpose | Critical | Security Notes |
|---------|---------|---------|----------|----------------|
| `@supabase/supabase-js` | ^2.88.0 | Backend real-time database | Yes | Authentication, Universe sync, Portal |
| `@tailwindcss/vite` | ^4.1.17 | CSS framework integration | Yes | Styling system |
| `framer-motion` | ^12.23.25 | Animation library | No | UI polish, can be code-split |
| `lucide-react` | ^0.555.0 | Icon library | No | 200+ icons, tree-shakeable |
| `react` | ^19.2.0 | Core framework | Yes | Latest version with concurrent features |
| `react-dom` | ^19.2.0 | React DOM renderer | Yes | Required for web |
| `react-router-dom` | ^7.10.1 | Routing system | Yes | /username routes, navigation |
| `tailwindcss` | ^4.1.17 | CSS framework | Yes | Utility-first styling |
| `youtubei.js` | ^16.0.1 | YouTube client library | Yes | Video metadata extraction (client fallback) |
| `zustand` | ^5.0.9 | State management | Yes | 7 stores, minimal bundle size |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@eslint/js` | ^9.39.1 | ESLint core |
| `@types/node` | ^24.10.1 | Node.js type definitions |
| `@types/react` | ^19.2.5 | React type definitions |
| `@types/react-dom` | ^19.2.3 | React DOM type definitions |
| `@vitejs/plugin-react` | ^5.1.1 | Vite React plugin |
| `eslint` | ^9.39.1 | Code linting |
| `eslint-plugin-react-hooks` | ^7.0.1 | React hooks linting |
| `eslint-plugin-react-refresh` | ^0.4.24 | React Fast Refresh linting |
| `globals` | ^16.5.0 | Global variable definitions |
| `typescript` | ~5.9.3 | Type checking |
| `typescript-eslint` | ^8.46.4 | TypeScript ESLint integration |
| `vite` | ^7.2.4 | Build tool |

### External Service Dependencies

| Service | URL | Purpose | Fallback Strategy |
|---------|-----|---------|-------------------|
| Fly.io API | `voyo-music-api.fly.dev` | Search, thumbnails, streaming | Client extraction |
| Cloudflare Worker | `voyo-edge.dash-webtv.workers.dev` | High-quality direct URLs | API fallback |
| Supabase | `supabase.co` | Database, auth, real-time | Offline mode |
| YouTube | `youtube.com` | IFrame fallback | Last resort |

### Critical Path Analysis

**Cannot run without:**
- `react`, `react-dom` (Core)
- `zustand` (State management)
- `vite` (Build)

**Degraded mode without:**
- `@supabase/supabase-js` - Universe features disabled
- `youtubei.js` - Client extraction unavailable
- `framer-motion` - Animations disabled
- Fly.io API - Client extraction only

---

## 2. Internal Module Dependencies

### Module Structure

```
src/
├── store/           # State management (7 stores)
├── services/        # Business logic (5 services)
├── components/      # UI components (30+ components)
├── hooks/           # Custom React hooks (4 hooks)
├── utils/           # Helper utilities (10 utilities)
├── types/           # TypeScript definitions
├── data/            # Static data (tracks.ts)
└── lib/             # Third-party integrations (supabase.ts)
```

### Import Relationship Matrix

| Module Type | → Store | → Service | → Component | → Hook | → Util | → Types |
|------------|---------|-----------|-------------|--------|--------|---------|
| **Store** | 🔴 Yes | 🟢 Yes | ❌ No | ❌ No | ❌ No | 🟢 Yes |
| **Service** | 🟢 Yes | 🟠 Maybe | ❌ No | ❌ No | 🟢 Yes | 🟢 Yes |
| **Component** | 🟢 Yes | 🟢 Yes | 🟢 Yes | 🟢 Yes | 🟢 Yes | 🟢 Yes |
| **Hook** | 🟢 Yes | 🟢 Yes | ❌ No | 🟠 Maybe | 🟢 Yes | 🟢 Yes |
| **Util** | ❌ No | 🟠 Maybe | ❌ No | ❌ No | 🟢 Yes | 🟢 Yes |
| **Types** | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |

Legend:
- 🟢 Yes = Common pattern
- 🟠 Maybe = Occasional
- 🔴 Yes = Circular risk
- ❌ No = Architecture violation

---

## 3. Store Dependencies

### Store Hierarchy

```
playerStore (Root)
    ↓ imports
    ├── personalization (service)
    ├── audioEngine (service)
    ├── api (service)
    └── universeStore (dynamic import - async)

playlistStore
    ↓ imports
    └── supabase (lib)

preferenceStore
    ↓ imports
    └── universeStore (dynamic import - async)

intentStore
    ↓ imports
    └── (no dependencies)

trackPoolStore
    ↓ imports
    ├── intentStore (store)
    └── tracks (data)

universeStore
    ↓ imports
    ├── preferenceStore (store)
    ├── playerStore (store)
    └── supabase (lib)

downloadStore
    ↓ imports
    └── downloadManager (service)

reactionStore
    ↓ imports
    └── supabase (lib)
```

### Store-to-Store Dependencies

| Store | Depends On | Dependency Type | Reason |
|-------|-----------|-----------------|--------|
| `playerStore` | `universeStore` | Async import | Portal sync (avoid circular) |
| `preferenceStore` | `universeStore` | Async import | Cloud sync (avoid circular) |
| `trackPoolStore` | `intentStore` | Direct import | Mode matching |
| `universeStore` | `preferenceStore` | Direct import | State export |
| `universeStore` | `playerStore` | Direct import | State export |
| `playlistStore` | `universeStore` | Direct import | Cloud sync |

### Circular Dependency Prevention

**CRITICAL**: `playerStore` ↔ `universeStore` circular avoided via:

```typescript
// playerStore.ts - Line 280
setTimeout(async () => {
  const { useUniverseStore } = await import('./universeStore');
  // Use store...
}, 100);
```

**Pattern**: Dynamic imports with setTimeout for cross-store communication.

---

## 4. Service Dependencies

### Service Dependency Graph

```
personalization.ts (ORCHESTRATOR)
    ↓ imports
    ├── preferenceStore
    ├── intentStore
    ├── trackPoolStore
    └── tracks (data)

api.ts
    ↓ imports
    └── playerStore (dynamic import)

audioEngine.ts
    ↓ imports
    └── (no dependencies - pure service)

downloadManager.ts
    ↓ imports
    └── (IndexedDB only)

piped.ts
    ↓ imports
    └── (HTTP fetch only)

clientExtractor.ts
    ↓ imports
    └── youtubei.js
```

### Service-to-Store Flow

```
Component → Store → Service → External API
           ↑__________________|
           (Update state)
```

**Example Flow**: Track playback

1. Component calls `playerStore.setCurrentTrack()`
2. Store imports `personalization.getPoolAwareDiscoveryTracks()`
3. Service reads `useIntentStore.getState().getIntentWeights()`
4. Service reads `useTrackPoolStore.getState().hotPool`
5. Service scores tracks and returns recommendations
6. Store updates `discoverTracks` state
7. Component re-renders with new tracks

---

## 5. Component Dependencies

### Component Architecture

```
App.tsx (Root Router)
    ├── PortraitVOYO (Portrait view)
    │   ├── VoyoPortraitPlayer
    │   ├── VoyoBottomNav
    │   └── VoyoVerticalFeed
    │
    ├── LandscapeVOYO (Landscape view)
    ├── VideoMode (Video player)
    ├── ClassicMode (Classic UI)
    │   ├── HomeFeed
    │   ├── Hub
    │   ├── Library
    │   └── NowPlaying
    │
    ├── AudioPlayer (Global audio)
    ├── SearchOverlay (Search UI)
    ├── AnimatedBackground (Visual effects)
    └── UniversePanel (Social features)
```

### Component Store Usage

| Component | Stores Used | Purpose |
|-----------|------------|---------|
| `AudioPlayer` | `playerStore`, `preferenceStore`, `downloadStore` | Audio playback engine |
| `ClassicMode` | `playerStore` | UI state |
| `HomeFeed` | `playerStore` | Track recommendations |
| `Library` | `playerStore`, `downloadStore`, `preferenceStore`, `playlistStore` | User library |
| `NowPlaying` | `playerStore`, `preferenceStore`, `reactionStore`, `universeStore` | Current track UI |
| `PlaylistModal` | `playlistStore`, `universeStore` | Playlist management |
| `ProfilePage` | `universeStore`, `playerStore` | User profile |
| `SearchOverlay` | `playerStore` (via service) | Search UI |
| `UniversePanel` | `universeStore`, `playerStore` | Social features |
| `VoyoPortraitPlayer` | `playerStore`, `intentStore`, `downloadStore` | VOYO player |
| `VoyoVerticalFeed` | `reactionStore`, `playerStore`, `universeStore` | Social feed |

### Shared Component Usage

| Shared Component | Used By | Props |
|-----------------|---------|-------|
| `SmartImage` | `AlbumCard`, `HomeFeed`, `NowPlaying` | `src`, `alt`, `className` |
| `BoostButton` | `Library`, `NowPlaying` | `trackId`, `title`, `artist` |
| `BoostIndicator` | `AudioPlayer` | `isBoosted`, `isDownloading` |
| `EnergyWave` | `NowPlaying`, `VoyoPortraitPlayer` | `isPlaying`, `color` |
| `InstallButton` | `App` | None (PWA install) |
| `OfflineIndicator` | `App` | None (network status) |

### Props Drilling Analysis

**Minimal props drilling** - Zustand eliminates most prop passing.

**Exceptions** (intentional):
- `AnimatedBackground` → `backgroundType` (user preference)
- `SearchOverlay` → `onClose`, `onSelectTrack` (callbacks)

---

## 6. Circular Dependencies

### Detected Circular Risks

#### ✅ RESOLVED: playerStore ↔ universeStore

**Problem**: Both stores need to call each other
- `playerStore` needs to sync portal now_playing
- `universeStore` needs to read player state

**Solution**: Dynamic imports with async delay

```typescript
// playerStore.ts
setTimeout(async () => {
  const { useUniverseStore } = await import('./universeStore');
  universeStore.updateNowPlaying();
}, 100);
```

#### ✅ RESOLVED: preferenceStore ↔ universeStore

**Problem**: Same bidirectional dependency

**Solution**: Same async import pattern

#### ⚠️ WATCH: trackPoolStore → intentStore → personalization

**Risk**: `trackPoolStore` imports `intentStore`, personalization imports both

**Status**: Safe - No circular because:
- `intentStore` doesn't import `trackPoolStore`
- `personalization` imports both but is a service (leaf node)

**Monitor**: Don't add trackPoolStore import to intentStore

#### ⚠️ WATCH: Service-to-Store imports

**Risk**: Services import stores for state reading

**Status**: Safe - Services are leaf nodes (no store imports services)

**Rule**: Stores can import services, services can import stores, but avoid store → service → same store

---

## 7. Bundle Impact Analysis

### Bundle Size by Category (Estimated)

| Category | Size | Files | Impact |
|----------|------|-------|--------|
| **Stores** | ~180 KB | 8 files | Critical - Always bundled |
| **Services** | ~90 KB | 6 files | Critical - Always bundled |
| **Components** | ~450 KB | 30+ files | High - Core UI |
| **External** | ~600 KB | node_modules | High - Framework + deps |
| **Utilities** | ~30 KB | 10 files | Low - Tree-shakeable |
| **Types** | 0 KB | Compile-time | None |
| **TOTAL** | ~1.35 MB | Initial bundle |

### Largest External Dependencies

| Package | Bundle Size | Tree-Shakeable | Code Split Opportunity |
|---------|------------|----------------|------------------------|
| `react` + `react-dom` | ~140 KB | No | No (core) |
| `framer-motion` | ~160 KB | Partial | Yes (animations) |
| `@supabase/supabase-js` | ~180 KB | No | Yes (universe features) |
| `lucide-react` | ~100 KB | Yes | Yes (lazy icons) |
| `youtubei.js` | ~80 KB | No | Yes (client extractor) |
| `zustand` | ~3 KB | Yes | No (too small) |
| `react-router-dom` | ~30 KB | No | No (routing core) |

### Code Splitting Opportunities

#### High Impact (Save 200+ KB initial)

1. **Lazy load Universe features**
   ```typescript
   const UniversePanel = lazy(() => import('./components/universe/UniversePanel'));
   ```
   Saves: ~180 KB (Supabase) - Only loads when user logs in

2. **Lazy load Classic Mode**
   ```typescript
   const ClassicMode = lazy(() => import('./components/classic/ClassicMode'));
   ```
   Saves: ~60 KB - Only loads when user switches to Classic

3. **Lazy load Search**
   ```typescript
   const SearchOverlay = lazy(() => import('./components/search/SearchOverlayV2'));
   ```
   Saves: ~40 KB - Only loads when user opens search

#### Medium Impact (Save 50-100 KB)

4. **Tree-shake Lucide icons**
   ```typescript
   import { Play, Pause } from 'lucide-react'; // Only what's used
   ```
   Current: Imports all icons (~100 KB)
   After: Import only used (~20 KB)
   Savings: ~80 KB

5. **Lazy load client extractor**
   ```typescript
   // Only load youtubei.js when API fails
   const extractor = await import('./services/clientExtractor');
   ```
   Saves: ~80 KB - Most users never need it

#### Low Impact (Save <50 KB)

6. **Lazy load Background effects**
   ```typescript
   const AnimatedBackground = lazy(() => import('./components/backgrounds/AnimatedBackgrounds'));
   ```
   Saves: ~30 KB

### Tree-Shaking Analysis

**Good**: Already tree-shakeable
- `zustand` - Only imports used stores
- `lucide-react` - Can improve (currently imports all)
- Utility modules - Pure functions

**Blocked**: Not tree-shakeable
- `framer-motion` - Imports full library
- `@supabase/supabase-js` - Imports full client
- `react-router-dom` - Imports full router

**Recommendation**: Use dynamic imports for optional features

---

## 8. Dependency Graphs

### Store Dependency Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     STORE LAYER                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  playerStore (ORCHESTRATOR)                                  │
│       │                                                      │
│       ├─→ personalization (service) ─┐                      │
│       ├─→ audioEngine (service)      │                      │
│       ├─→ api (service)              │                      │
│       └─→ universeStore (async) ←────┼─────┐               │
│                                       │     │               │
│  intentStore                          │     │               │
│       │                               │     │               │
│       └─→ (no deps)                   │     │               │
│                                       │     │               │
│  trackPoolStore                       │     │               │
│       │                               │     │               │
│       ├─→ intentStore ────────────────┘     │               │
│       └─→ tracks (data)                     │               │
│                                             │               │
│  preferenceStore                            │               │
│       │                                     │               │
│       └─→ universeStore (async) ────────────┤               │
│                                             │               │
│  universeStore (SYNC HUB) ←─────────────────┘               │
│       │                                                      │
│       ├─→ preferenceStore                                   │
│       ├─→ playerStore                                       │
│       └─→ supabase (lib)                                    │
│                                                              │
│  playlistStore                                               │
│       └─→ supabase (lib)                                    │
│                                                              │
│  downloadStore                                               │
│       └─→ downloadManager (service)                         │
│                                                              │
│  reactionStore                                               │
│       └─→ supabase (lib)                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Service Dependency Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    SERVICE LAYER                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  personalization.ts (RECOMMENDATION ENGINE)                  │
│       │                                                      │
│       ├─→ preferenceStore (read behavior)                   │
│       ├─→ intentStore (read intent)                         │
│       ├─→ trackPoolStore (read pool)                        │
│       └─→ tracks (data)                                     │
│           │                                                  │
│           └─→ Outputs: Scored track lists                   │
│                                                              │
│  api.ts (STREAMING SERVICE)                                  │
│       │                                                      │
│       ├─→ Fly.io API (external)                             │
│       ├─→ Cloudflare Worker (external)                      │
│       ├─→ playerStore (dynamic - quality)                   │
│       └─→ YouTube (fallback)                                │
│           │                                                  │
│           └─→ Outputs: Stream URLs                          │
│                                                              │
│  audioEngine.ts (BUFFER MANAGER)                             │
│       │                                                      │
│       ├─→ Navigator API (network speed)                     │
│       └─→ MediaElement API (buffer health)                  │
│           │                                                  │
│           └─→ Outputs: Bitrate levels, prefetch             │
│                                                              │
│  downloadManager.ts (OFFLINE STORAGE)                        │
│       │                                                      │
│       ├─→ IndexedDB (local cache)                           │
│       └─→ Navigator API (network detection)                 │
│           │                                                  │
│           └─→ Outputs: Cached blob URLs                     │
│                                                              │
│  piped.ts (METADATA)                                         │
│       │                                                      │
│       └─→ Piped API (external)                              │
│           │                                                  │
│           └─→ Outputs: Track metadata                       │
│                                                              │
│  clientExtractor.ts (FALLBACK)                               │
│       │                                                      │
│       └─→ youtubei.js (library)                             │
│           │                                                  │
│           └─→ Outputs: Direct URLs (when API blocked)       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                  COMPONENT TREE                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  App.tsx (ROOT)                                              │
│    │                                                         │
│    ├─→ VoyoSplash (Initial load)                            │
│    │                                                         │
│    ├─→ PortraitVOYO (Default mobile)                        │
│    │    ├─→ VoyoPortraitPlayer                              │
│    │    │    ├─→ EnergyWave                                 │
│    │    │    ├─→ BoostButton                                │
│    │    │    └─→ PlaybackControls                           │
│    │    ├─→ VoyoBottomNav                                   │
│    │    └─→ VoyoVerticalFeed                                │
│    │         └─→ ReactionCanvas                             │
│    │                                                         │
│    ├─→ LandscapeVOYO (Landscape)                            │
│    ├─→ VideoMode (Video player)                             │
│    │                                                         │
│    ├─→ ClassicMode (Classic UI)                             │
│    │    ├─→ HomeFeed                                        │
│    │    │    └─→ AlbumCard[]                                │
│    │    ├─→ Hub                                             │
│    │    ├─→ Library                                         │
│    │    │    ├─→ SmartImage[]                               │
│    │    │    └─→ BoostButton[]                              │
│    │    └─→ NowPlaying                                      │
│    │         ├─→ TunnelDrawer                               │
│    │         ├─→ EnergyWave                                 │
│    │         └─→ PlaybackControls                           │
│    │                                                         │
│    ├─→ AudioPlayer (GLOBAL - Always mounted)                │
│    │    └─→ <audio> element                                │
│    │                                                         │
│    ├─→ SearchOverlay (Overlay)                              │
│    │    └─→ SearchResult[]                                  │
│    │                                                         │
│    ├─→ UniversePanel (Social)                               │
│    │    ├─→ UserSearch                                      │
│    │    └─→ ProfilePage                                     │
│    │                                                         │
│    ├─→ PlaylistModal (Modal)                                │
│    ├─→ AnimatedBackground (Visual)                          │
│    ├─→ InstallButton (PWA)                                  │
│    └─→ OfflineIndicator (Status)                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   VOYO DATA FLOW                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  USER ACTION (Component)                                     │
│       │                                                      │
│       ↓                                                      │
│  STORE ACTION (Zustand)                                      │
│       │                                                      │
│       ├─→ Sync to localStorage (persist)                    │
│       ├─→ Call service (compute)                            │
│       └─→ Sync to cloud (universe)                          │
│           │                                                  │
│           ↓                                                  │
│  SERVICE (Business Logic)                                    │
│       │                                                      │
│       ├─→ Read other stores (context)                       │
│       ├─→ Call external API (data)                          │
│       └─→ Return processed data                             │
│           │                                                  │
│           ↓                                                  │
│  STORE UPDATE (State change)                                 │
│       │                                                      │
│       ↓                                                      │
│  COMPONENT RE-RENDER (React)                                 │
│       │                                                      │
│       └─→ UI reflects new state                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Recommendation Engine Flow (Key Path)

```
┌─────────────────────────────────────────────────────────────┐
│         INTENT-FIRST RECOMMENDATION FLOW                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. USER ADJUSTS MIXBOARD                                    │
│     ↓                                                        │
│     intentStore.setManualBars('party-mode', 5)              │
│                                                              │
│  2. INTENT WEIGHTS CALCULATED                                │
│     ↓                                                        │
│     intentStore.getIntentWeights()                          │
│     → { 'party-mode': 0.6, 'chill-vibes': 0.3, ... }       │
│                                                              │
│  3. TRACK POOL RESCORED                                      │
│     ↓                                                        │
│     trackPoolStore.rescoreAllTracks()                       │
│     → Uses intent weights to boost matching tracks          │
│                                                              │
│  4. PERSONALIZATION PULLS TRACKS                             │
│     ↓                                                        │
│     personalization.getPoolAwareHotTracks(5)                │
│     │                                                        │
│     ├─→ Read intentStore.getDominantModes()                 │
│     ├─→ Read trackPoolStore.hotPool                         │
│     ├─→ Read preferenceStore.trackPreferences               │
│     └─→ Score = Behavior(40%) + Intent(60%)                 │
│                                                              │
│  5. STORE UPDATES HOT TRACKS                                 │
│     ↓                                                        │
│     playerStore.hotTracks = [...]                           │
│                                                              │
│  6. UI REFLECTS NEW RECOMMENDATIONS                          │
│     ↓                                                        │
│     HomeFeed re-renders with party tracks                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Paths for Performance

### Playback Start (Critical - Must be <500ms)

```
User taps track
   ↓
playerStore.setCurrentTrack()
   ↓
api.getAudioStream() ─────→ Fly.io API (200ms)
   │                           │
   │                           ↓
   │                        Stream URL
   │                           │
   ↓                           ↓
AudioPlayer.load() ←───────────┘
   ↓
<audio>.play() (50ms)
   ↓
MUSIC PLAYING ✅ (Total: ~300ms)
```

### Search (High Priority - Must be <2s)

```
User types query
   ↓
searchCache.check() (10ms)
   │
   ├─→ HIT: Return cached
   │
   └─→ MISS:
       ↓
   api.searchMusic() ───→ Fly.io API (1500ms)
       ↓
   searchCache.set()
       ↓
   Results displayed (Total: ~1600ms)
```

### Boost Download (Background - Can be slow)

```
User clicks Boost
   ↓
downloadStore.boostTrack()
   ↓
downloadManager.downloadTrack()
   │
   ├─→ Fetch audio (streaming, 5-30s)
   ├─→ Store in IndexedDB
   └─→ Progress updates every 500ms
   ↓
Boost complete ✅
   ↓
downloadStore.lastBoostCompletion
   ↓
IF < 7 seconds: Hot-swap enabled 🔥
```

---

## Recommendations

### High Priority Optimizations

1. **Lazy load Universe features** - Save 180 KB initial bundle
2. **Tree-shake Lucide icons** - Save 80 KB
3. **Code-split Classic Mode** - Save 60 KB
4. **Lazy load client extractor** - Save 80 KB

### Architecture Improvements

1. **Add service worker** - Offline-first architecture
2. **Implement request batching** - Reduce API calls
3. **Add CDN caching** - Cache thumbnails, static assets
4. **Optimize store persistence** - Debounce localStorage writes

### Monitoring

1. **Track bundle size** - Alert if >1.5 MB
2. **Monitor circular dependencies** - Automated detection
3. **Measure critical paths** - Real User Monitoring
4. **Track API failures** - Fallback usage metrics

---

## Appendix: Import Analysis

### Store Import Count

| Store | Imported By | Count |
|-------|------------|-------|
| `playerStore` | Components, Hooks, Services | 15+ files |
| `universeStore` | Components, Stores | 8 files |
| `preferenceStore` | Components, Services, Stores | 6 files |
| `intentStore` | Services, Stores | 4 files |
| `downloadStore` | Components, Stores | 5 files |
| `playlistStore` | Components | 3 files |
| `reactionStore` | Components | 3 files |
| `trackPoolStore` | Services | 2 files |

### Most Coupled Modules

| Module | Coupling Score | Risk Level |
|--------|---------------|------------|
| `playerStore` | 15+ imports | High (orchestrator) |
| `personalization` | 7 imports | Medium (complex logic) |
| `universeStore` | 8 imports | Medium (sync hub) |
| `AudioPlayer` | 5 imports | Medium (media handling) |

### Least Coupled Modules (Good!)

- `intentStore` - No dependencies
- `audioEngine` - Pure service
- `types/` - Type-only
- `utils/haptics` - Single purpose
- `utils/format` - Pure functions

---

**End of Dependency Map**
