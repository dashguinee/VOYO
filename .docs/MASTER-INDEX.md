# VOYO Music - Documentation Master Index

**Generated:** December 19, 2025
**Codebase:** `/home/dash/voyo-music`
**Status:** Production PWA

---

## Quick Navigation

| Section | Description | Status |
|---------|-------------|--------|
| [Architecture](#architecture) | System design, data flow, deployment | Complete |
| [Stores](#stores) | Zustand state management (9 stores) | Complete |
| [Services](#services) | API, Audio, Download, Personalization | In Progress |
| [Components](#components) | React component library | In Progress |
| [Hooks](#hooks) | Custom React hooks | Complete |
| [Types](#types) | TypeScript interfaces/types | Complete |
| [Utils](#utils) | Utility functions | Complete |
| [Server](#server) | Backend Express server | Complete |

---

## Architecture

### Core Documents
- **[MASTER-ARCHITECTURE.md](./architecture/MASTER-ARCHITECTURE.md)** - Complete system architecture (73KB)
  - System overview, tech stack, data flow
  - Component hierarchy, API architecture
  - Deployment configuration (Vercel + Fly.io + Cloudflare)

- **[DEPENDENCY-MAP.md](./architecture/DEPENDENCY-MAP.md)** - Import/export relationships (33KB)
  - File dependency graph
  - Circular dependency analysis
  - Module boundaries

### Key Architecture Concepts
- **3 UI Modes:** Classic (Spotify-like), VOYO (Netflix-like), Video (Immersive)
- **8 Zustand Stores:** playerStore, playlistStore, preferenceStore, downloadStore, intentStore, reactionStore, trackPoolStore, universeStore
- **YouTube-powered:** Uses Innertube API + Piped for unlimited catalog

---

## Stores

Zustand state management layer - the brain of VOYO.

### Documents
- **[STORES-DOCUMENTATION.md](./stores/STORES-DOCUMENTATION.md)** - Complete store documentation (77KB)
- **[ARCHITECTURE.md](./stores/ARCHITECTURE.md)** - Store architecture patterns (23KB)
- **[QUICK-REFERENCE.md](./stores/QUICK-REFERENCE.md)** - Fast lookup (9KB)
- **[INDEX.md](./stores/INDEX.md)** - Store summary (11KB)
- **[README.md](./stores/README.md)** - Getting started (14KB)

### Store Overview

| Store | Purpose | Persistence |
|-------|---------|-------------|
| `playerStore` | Audio playback, queue, progress | localStorage |
| `playlistStore` | User playlists CRUD | localStorage + Supabase |
| `preferenceStore` | Behavior learning (listens, skips) | localStorage |
| `downloadStore` | Offline downloads, boost system | IndexedDB |
| `intentStore` | MixBoard intent capture | localStorage |
| `reactionStore` | OYE social reactions | localStorage |
| `trackPoolStore` | Dynamic track pool management | Memory |
| `universeStore` | Cross-device sync, portal, authentication | Supabase realtime |

---

## Services

Core business logic layer.

### Documents
- **[SERVICES-DOCUMENTATION.md](./services/SERVICES-DOCUMENTATION.md)** - Complete service docs
- **[README.md](./services/README.md)** - Service layer overview

### Service Overview

| Service | File | Purpose |
|---------|------|---------|
| `api.ts` | `/src/services/api.ts` | Backend API client |
| `audioEngine.ts` | `/src/services/audioEngine.ts` | Smart buffering, playback |
| `clientExtractor.ts` | `/src/services/clientExtractor.ts` | YouTube Innertube extraction |
| `downloadManager.ts` | `/src/services/downloadManager.ts` | Offline download system |
| `personalization.ts` | `/src/services/personalization.ts` | AI recommendations |
| `piped.ts` | `/src/services/piped.ts` | Piped API for albums |

---

## Components

React component library organized by feature.

### Documents
- **[APP-ROOT.md](./components/APP-ROOT.md)** - App.tsx structure
- **[CLASSIC-MODE-COMPONENTS.md](./components/CLASSIC-MODE-COMPONENTS.md)** - Classic mode
- **[VOYO-COMPONENTS.md](./components/VOYO-COMPONENTS.md)** - VOYO mode components
- **[PLAYER-COMPONENTS.md](./components/PLAYER-COMPONENTS.md)** - Player UI
- **[UI-COMPONENTS.md](./components/UI-COMPONENTS.md)** - Reusable UI
- **[BACKGROUNDS-COMPONENTS.md](./components/BACKGROUNDS-COMPONENTS.md)** - Visual effects
- **[PLAYLIST-COMPONENTS.md](./components/PLAYLIST-COMPONENTS.md)** - Playlist management
- **[PROFILE-COMPONENTS.md](./components/PROFILE-COMPONENTS.md)** - User profiles
- **[SEARCH-COMPONENTS.md](./components/SEARCH-COMPONENTS.md)** - Search UI
- **[UNIVERSE-COMPONENTS.md](./components/UNIVERSE-COMPONENTS.md)** - Universe sync
- **[ENTRY-POINTS.md](./components/ENTRY-POINTS.md)** - main.tsx + App.tsx

### Component Structure
```
src/components/
├── classic/          # Spotify-like classic mode
│   ├── ClassicMode.tsx
│   ├── HomeFeed.tsx
│   ├── Library.tsx
│   ├── NowPlaying.tsx
│   └── ...
├── voyo/             # Netflix-like vertical feed
│   ├── PortraitVOYO.tsx
│   ├── LandscapeVOYO.tsx
│   ├── VideoMode.tsx
│   ├── navigation/
│   ├── upload/
│   └── feed/
├── player/           # Audio player components
├── playlist/         # Playlist modals/cards
├── profile/          # User profile pages
├── search/           # Search interface
├── ui/               # Reusable UI primitives
├── backgrounds/      # Visual effects/backgrounds
└── universe/         # Cross-device sync UI
```

---

## Hooks

Custom React hooks for shared logic.

### Documents
- **[HOOKS-DOCUMENTATION.md](./hooks/HOOKS-DOCUMENTATION.md)** - Complete hook documentation (32KB)

### Hook Overview

| Hook | Purpose |
|------|---------|
| `useThumbnailCache` | Caches track thumbnails |
| `usePWA` | PWA install prompt handling |
| `useMobilePlay` | Mobile audio unlock |

---

## Types

TypeScript type definitions.

### Documents
- **[TYPES-DOCUMENTATION.md](./types/TYPES-DOCUMENTATION.md)** - All type definitions (59KB)
- **[QUICK-REFERENCE.md](./types/QUICK-REFERENCE.md)** - Fast lookup
- **[README.md](./types/README.md)** - Type system overview

### Core Types
- `Track` - Music track metadata
- `QueueItem` - Queue entry with source
- `Playlist` - User playlist
- `VOYOAccount` - User account
- `MoodType` - Mood tunnel types
- `ViewMode` - UI view modes

---

## Utils

Utility functions and helpers.

### Documents
- **[UTILS-DOCUMENTATION.md](./utils/UTILS-DOCUMENTATION.md)** - All utilities (71KB)

### Utility Categories
- **Format:** Time formatting, number formatting
- **Image:** Thumbnail processing, optimization
- **Audio:** Mobile unlock, haptics
- **Search:** Cache management, debouncing
- **ID:** VOYO ID generation

---

## Server

Express backend server.

### Documents
- **[SERVER-DOCUMENTATION.md](./server/SERVER-DOCUMENTATION.md)** - Complete server docs (59KB)
- **[README.md](./server/README.md)** - Server overview

### Server Architecture
- **Framework:** Express.js
- **Endpoints:** Search, stream proxy, video info
- **Deployment:** Fly.io (voyo-music-api.fly.dev)
- **Edge:** Cloudflare Workers (voyo-edge.workers.dev)

---

## File Statistics

| Directory | Files | Lines (approx) |
|-----------|-------|----------------|
| src/store/ | 9 | ~2,500 |
| src/services/ | 7 | ~1,800 |
| src/components/ | 30 | ~4,500 |
| src/hooks/ | 4 | ~300 |
| src/utils/ | 10 | ~800 |
| src/types/ | 2 | ~200 |
| server/ | 5 | ~1,200 |
| **Total** | **67** | **~11,300** |

---

## Quick Start for Developers

### 1. Understanding the Codebase
1. Start with [MASTER-ARCHITECTURE.md](./architecture/MASTER-ARCHITECTURE.md)
2. Review [STORES-DOCUMENTATION.md](./stores/STORES-DOCUMENTATION.md) - the brain
3. Check component docs for UI patterns

### 2. Key Files to Know
- `src/App.tsx` - Root component, routing
- `src/store/playerStore.ts` - Playback state (most complex)
- `src/services/audioEngine.ts` - Audio playback logic
- `src/components/voyo/PortraitVOYO.tsx` - Main VOYO experience

### 3. Making Changes
1. Check relevant store for state
2. Review service for business logic
3. Find component in hierarchy
4. Test with `npm run dev`

---

## Documentation Maintenance

When updating code, update corresponding docs:
- Store changes → `./stores/`
- Service changes → `./services/`
- Component changes → `./components/`
- New utilities → `./utils/`

---

*Generated by ZION documentation system*
