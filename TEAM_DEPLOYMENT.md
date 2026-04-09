# VOYO - Multi-Agent Team Deployment Plan

## CRITICAL SHARED DEPENDENCIES (DO NOT BREAK)

All teams must preserve these connections:

### 1. playerStore (The Heart)
```
Location: /src/store/playerStore.ts
Used by: ALL sections
Critical methods:
- currentTrack, isPlaying, progress
- playTrack(), addToQueue()
- history, hotTracks, discoverTracks
- refreshRecommendations()
```

### 2. trackPoolStore (The Brain)
```
Location: /src/store/trackPoolStore.ts
Used by: Home + Feed sections
Critical methods:
- hotPool, coldPool
- getHotTracks(), getDiscoveryTracks()
- recordPlay(), recordCompletion()
- rescoreAllTracks()
```

### 3. AudioPlayer (The Engine)
```
Location: /src/components/AudioPlayer.tsx
Status: Must exist and be initialized in App.tsx
Interfaces with: playerStore exclusively
```

### 4. reactionStore (Social Signals)
```
Location: /src/store/reactionStore.ts
Used by: NowPlaying, App.tsx (DynamicIsland)
Critical methods:
- createReaction()
- trackReactions, trackStats
```

---

## TEAM STRUCTURE

### TEAM ALPHA: Home + Player + Feed
**Scope**: The core music experience
**Components**:
- `/src/components/classic/HomeFeed.tsx`
- `/src/components/classic/NowPlaying.tsx`
- `/src/components/voyo/feed/VoyoVerticalFeed.tsx`
- `/src/components/voyo/PortraitVOYO.tsx`
- `/src/components/voyo/LandscapeVOYO.tsx`
- `/src/components/AudioPlayer.tsx`

**Supporting files**:
- `/src/services/personalization.ts`
- `/src/services/poolCurator.ts`
- `/src/components/voyo/feed/*` (all feed components)
- `/src/components/player/*`

**Shared state**: playerStore, trackPoolStore, reactionStore, intentStore

**Risk level**: HIGH - Core functionality, many dependencies

---

### TEAM BETA: Hub (Social Mini-App)
**Scope**: The DAHUB social features
**Components**:
- `/src/components/classic/Hub.tsx`
- `/src/components/universe/UniversePanel.tsx`
- `/src/components/universe/UserSearch.tsx`
- `/src/components/profile/ProfilePage.tsx`
- `/src/components/portal/PortalChat.tsx`

**Current state**: ISOLATED - Only reads playerStore.currentTrack

**Shared state**: playerStore (read-only)

**Risk level**: LOW - Can redesign freely without breaking core

---

### TEAM GAMMA: Infrastructure + Navigation
**Scope**: App shell, routing, shared UI
**Components**:
- `/src/App.tsx` (mode switching, DynamicIsland)
- `/src/components/voyo/navigation/VoyoBottomNav.tsx`
- `/src/components/voyo/OyoIsland.tsx` (Dynamic Island)
- `/src/components/voyo/VoyoSplash.tsx`
- `/src/components/search/SearchOverlayV2.tsx`

**Supporting files**:
- `/src/store/*` (all stores)
- `/src/services/*` (all services)
- `/src/utils/*`
- `/src/hooks/*`

**Risk level**: CRITICAL - Changes affect all teams

---

## CONNECTION MAP

```
                    ┌─────────────────────┐
                    │   TEAM GAMMA        │
                    │   (Infrastructure)   │
                    │                     │
                    │   App.tsx           │
                    │   All Stores        │
                    │   All Services      │
                    └──────────┬──────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   TEAM ALPHA     │  │   TEAM BETA      │  │   Shared State   │
│   (Core Music)   │  │   (Social Hub)   │  │                  │
│                  │  │                  │  │  playerStore     │
│  HomeFeed        │  │  Hub             │  │  trackPoolStore  │
│  NowPlaying      │  │  UniversePanel   │  │  reactionStore   │
│  VoyoVerticalFeed│  │  ProfilePage     │  │  intentStore     │
│  AudioPlayer     │  │  PortalChat      │  │                  │
│                  │  │                  │  │                  │
│  ◄──────────────────┼──────────────────────►               │
│  Reads/Writes    │  │  Reads Only      │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## DEPLOYMENT ORDER

### Phase 1: TEAM GAMMA (Infrastructure)
- Audit and document all store interfaces
- Ensure App.tsx routing is solid
- Verify all services have clear contracts
- **Output**: Interface documentation for other teams

### Phase 2: TEAM ALPHA (Core Music)
- Can start after Gamma documents interfaces
- Focus on HomeFeed → NowPlaying → VoyoFeed flow
- Must preserve all playerStore/trackPoolStore calls
- **Output**: Polished core music experience

### Phase 3: TEAM BETA (Social Hub)
- Can work in parallel with Alpha (isolated)
- Free to redesign Hub completely
- Only constraint: playerStore.currentTrack interface
- **Output**: Redesigned social features

---

## AGENT PROMPTS

### TEAM GAMMA Agent Prompt
```
You are working on VOYO Music infrastructure at /home/dash/voyo-music.

Your scope:
- /src/App.tsx
- /src/store/* (all stores)
- /src/services/* (all services)
- /src/components/voyo/navigation/*

Your task: [SPECIFIC TASK HERE]

CRITICAL RULES:
1. Document any interface changes
2. Do not break playerStore or trackPoolStore contracts
3. Test mode switching (classic/voyo/video) still works
4. Preserve DynamicIsland functionality
```

### TEAM ALPHA Agent Prompt
```
You are working on VOYO Music core experience at /home/dash/voyo-music.

Your scope:
- /src/components/classic/HomeFeed.tsx
- /src/components/classic/NowPlaying.tsx
- /src/components/voyo/feed/VoyoVerticalFeed.tsx
- /src/components/AudioPlayer.tsx
- /src/components/voyo/PortraitVOYO.tsx
- /src/services/personalization.ts

Your task: [SPECIFIC TASK HERE]

CRITICAL RULES:
1. Preserve playerStore interface calls
2. Preserve trackPoolStore interface calls
3. Do not modify store files (Team Gamma owns those)
4. Test playback still works after changes
```

### TEAM BETA Agent Prompt
```
You are working on VOYO Music social hub at /home/dash/voyo-music.

Your scope:
- /src/components/classic/Hub.tsx
- /src/components/universe/*
- /src/components/profile/*
- /src/components/portal/*

Your task: [SPECIFIC TASK HERE]

CRITICAL RULES:
1. Only read from playerStore.currentTrack
2. Do not add writes to any store (yet)
3. Free to redesign UI completely
4. Keep social features isolated until integration phase
```

---

## WHAT EACH TEAM NEEDS TO KNOW

### Cross-Team Contract: Track Object
```typescript
interface Track {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
  albumId?: string;
  // Pool-specific fields
  poolScore?: number;
  detectedMode?: string;
  engagement?: { plays: number; skips: number; reactions: number };
}
```

### Cross-Team Contract: Player State
```typescript
interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  queue: Track[];
  history: Track[];
}
```

### Cross-Team Contract: Pool State
```typescript
interface PoolState {
  hotPool: Track[];
  coldPool: Track[];
  getHotTracks(limit: number): Track[];
  recordPlay(trackId: string): void;
  recordCompletion(trackId: string): void;
}
```

---

## READY TO DEPLOY

When you say "deploy teams", I will:
1. Launch TEAM GAMMA first to audit infrastructure
2. Launch TEAM ALPHA + TEAM BETA in parallel
3. Coordinate outputs between teams
4. Merge results safely
