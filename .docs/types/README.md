# VOYO Music - Types Documentation

Complete TypeScript type system documentation for the VOYO Music application.

---

## Documents

### 1. [TYPES-DOCUMENTATION.md](./TYPES-DOCUMENTATION.md)
**Comprehensive catalog of ALL types and interfaces**

- 1,874 lines of detailed documentation
- 60+ types fully documented
- Complete property descriptions
- Usage examples for each type
- Type relationship diagrams
- Migration notes

**Use this when**: You need complete details about any type in the system.

---

### 2. [QUICK-REFERENCE.md](./QUICK-REFERENCE.md)
**Quick lookup guide for common types**

- Most frequently used types
- Type cheat sheet
- Common patterns
- Type guards and helpers
- Import paths
- Gotchas and common mistakes

**Use this when**: You need quick lookup or coding patterns.

---

## Type Organization

### By Domain

1. **Core Music Types** (Track, Album, Playlist, Mood)
2. **Player State Types** (PlayerStore, Queue, History)
3. **User & Account Types** (VOYOAccount, Subscription)
4. **Social & Reaction Types** (Reaction, TrackStats, Hotspots)
5. **VOYO Superapp Types** (Feed, Upload, Stories)
6. **Personalization & Intent Types** (Preferences, Intent, Pool)
7. **Download & Caching Types** (Downloads, Cache, Boost)
8. **Universe & Sync Types** (UniverseData, Portal, Sync)
9. **YouTube & External API Types** (YT namespace)
10. **Audio Engine Types** (Buffer, Network, Prefetch)

### By File Location

```
/src/types/
├── index.ts           # Core music types (Track, Mood, Playlist, etc.)
└── youtube.d.ts       # YouTube IFrame API types

/src/store/
├── playerStore.ts     # Player state + actions
├── preferenceStore.ts # User preference tracking
├── universeStore.ts   # Auth, sync, portal & backup
├── downloadStore.ts   # Caching & downloads
├── trackPoolStore.ts  # Dynamic track pool
├── intentStore.ts     # User intent tracking
└── reactionStore.ts   # Social reactions

/src/services/
├── audioEngine.ts     # Audio streaming types
└── /src/lib/supabase.ts # Database types
```

---

## Quick Start

### 1. Find a Type
```bash
# Search by name
grep -n "interface Track" TYPES-DOCUMENTATION.md

# Search by usage
grep -n "Usage:" TYPES-DOCUMENTATION.md
```

### 2. Import a Type
```typescript
// Core types
import { Track, MoodType, ViewMode } from '@/types';

// Store
import { usePlayerStore } from '@/store/playerStore';
```

### 3. Use a Type
```typescript
const track: Track = {
  id: 'last-last',
  title: 'Last Last',
  artist: 'Burna Boy',
  trackId: 'VLW1ieN9Cg8',
  coverUrl: 'https://...',
  duration: 162,
  tags: ['afrobeats'],
  oyeScore: 8547,
  createdAt: '2024-01-15T10:30:00Z'
};
```

---

## Type Hierarchy Overview

```
Track (base)
  └─> PooledTrack (+ pool scoring)
      └─> QueueItem (+ queue metadata)
          └─> HistoryItem (+ playback data)

VOYOAccount (base)
  └─> PublicProfile (public subset)
      └─> ViewingUniverse (viewing state)

PlayerStore (master state)
  ├─> Track (current)
  ├─> QueueItem[] (queue)
  ├─> HistoryItem[] (history)
  ├─> Reaction[] (reactions)
  └─> NetworkQuality, BitrateLevel, BufferStatus

Personalization
  ├─> TrackPreference (per track)
  ├─> ArtistPreference (aggregated)
  ├─> ModeIntent (vibe modes)
  └─> PooledTrack (intelligent pool)
```

---

## Key Concepts

### 1. Track Identity
- `id` - Internal VOYO ID (persistent)
- `trackId` - YouTube video ID (streaming source)

### 2. Timestamps
All timestamps use ISO 8601:
```typescript
"2024-01-15T10:30:00Z"
```

### 3. Scores
- `oyeScore` - Social engagement (0-infinity)
- `poolScore` - Relevance score (0-100)
- `intentScore` - User preference (0-100)

### 4. Optional Fields
Use `?` for optional properties:
```typescript
mood?: MoodType;      // Optional
title: string;        // Required
```

---

## Common Type Patterns

### 1. Player State Access
```typescript
const currentTrack = usePlayerStore(state => state.currentTrack);
const isPlaying = usePlayerStore(state => state.isPlaying);
```

### 2. Type Guards
```typescript
if (player.currentTrack) {
  // TypeScript knows currentTrack is not null
  console.log(player.currentTrack.title);
}
```

### 3. Union Types
```typescript
type ViewMode = 'card' | 'lyrics' | 'video' | 'feed';

// Type-safe checks
if (viewMode === 'card') {
  // TypeScript knows this is 'card'
}
```

---

## Statistics

- **Total Types Documented**: 60+
- **Total Interfaces**: 45+
- **Total Enums/Unions**: 20+
- **Store Interfaces**: 10+
- **Lines of Type Code**: 1,500+
- **Documentation Lines**: 1,874

---

## Contributing

When adding new types:

1. Add to appropriate domain section in `TYPES-DOCUMENTATION.md`
2. Update `QUICK-REFERENCE.md` if frequently used
3. Include full property documentation
4. Add usage examples
5. Update type relationship diagram
6. Document breaking changes

---

## Version History

### v1.0 (2025-12-19)
- Initial comprehensive documentation
- All core types documented
- Quick reference guide created
- Type hierarchy diagrams added

---

**Maintained by**: VOYO Development Team
**Last Updated**: 2025-12-19
