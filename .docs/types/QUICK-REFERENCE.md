# VOYO Music Types - Quick Reference

**Quick lookup guide for common types**

---

## Most Frequently Used Types

### Track
```typescript
interface Track {
  id: string;
  title: string;
  artist: string;
  trackId: string;        // YouTube ID
  coverUrl: string;
  duration: number;       // seconds
  tags: string[];
  mood?: MoodType;
  oyeScore: number;
}
```

### PlayerStore State
```typescript
currentTrack: Track | null
isPlaying: boolean
progress: number          // 0-100
currentTime: number       // seconds
volume: number           // 0-100
queue: QueueItem[]
history: HistoryItem[]
```

### VOYOAccount
```typescript
interface VOYOAccount {
  username: string;       // voyomusic.com/[username]
  whatsapp: string;       // +224XXXXXXXXX
  pin: string;            // 6-digit
  displayName: string;
  subscription: 'active' | 'trial' | 'overdue' | 'banned' | 'vip'
  friendIds: string[];
  nowPlaying?: {...}
}
```

---

## Type Cheat Sheet

### Enums & Unions

```typescript
// Moods
type MoodType = 'afro' | 'feed' | 'rnb' | 'hype' | 'chill' | 'heartbreak'
              | 'dance' | 'street' | 'party' | 'worship' | 'focus' | 'gym'

// Vibe Modes (Intent)
type VibeMode = 'afro-heat' | 'chill-vibes' | 'party-mode'
              | 'late-night' | 'workout' | 'random-mixer'

// View Modes
type ViewMode = 'card' | 'lyrics' | 'video' | 'feed'

// Tabs
type VoyoTab = 'music' | 'feed' | 'upload' | 'dahub'

// Queue Sources
type QueueSource = 'auto' | 'manual' | 'roulette' | 'ai'

// Reaction Types
type ReactionType = 'oyo' | 'oye' | 'wazzguan' | 'yoooo'
                  | 'mad_oh' | 'eyyy' | 'fire' | 'we_move' | 'custom'

// Subscription Status
type SubscriptionStatus = 'active' | 'trial' | 'overdue' | 'banned' | 'vip'

// Audio Quality
type BitrateLevel = 'low' | 'medium' | 'high'
type BufferStatus = 'healthy' | 'warning' | 'emergency'
type NetworkQuality = 'slow' | 'medium' | 'fast' | 'unknown'

// Download Status
type DownloadStatus = 'queued' | 'downloading' | 'complete' | 'failed'
```

---

## Store Type Lookup

### playerStore.ts
- `PlayerStore` - Main player state
- `NetworkQuality`, `PrefetchStatus`

### preferenceStore.ts
- `TrackPreference` - Listen behavior per track
- `ArtistPreference`, `TagPreference`, `MoodPreference`
- `ListenSession` - Current session tracking

### universeStore.ts
- `UniverseData` - Exportable state
- `UniverseRow` - Database schema
- `PortalSession`, `ViewingUniverse`

### downloadStore.ts
- `DownloadProgress` - Download state
- `CachedTrackInfo` - Cache metadata
- `BoostCompletion` - Boost events

### trackPoolStore.ts
- `PooledTrack` - Enhanced track with scoring

### intentStore.ts
- `ModeIntent` - User intent per mode
- `IntentSession` - Session tracking

### reactionStore.ts
- `Reaction` - User reactions
- `TrackStats` - Track analytics
- `TrackHotspot` - Reaction clusters
- `CategoryPulse`, `CategoryPreference`

---

## Common Patterns

### Accessing Player State
```typescript
import { usePlayerStore } from '@/store/playerStore';

const currentTrack = usePlayerStore(state => state.currentTrack);
const isPlaying = usePlayerStore(state => state.isPlaying);
```

### Adding to Queue
```typescript
const addToQueue = usePlayerStore(state => state.addToQueue);
addToQueue(track);  // Automatic source detection
```

### Checking Cache
```typescript
import { useDownloadStore } from '@/store/downloadStore';

const checkCache = useDownloadStore(state => state.checkCache);
const cachedUrl = await checkCache(trackId);
```

### Recording Preferences
```typescript
import { usePreferenceStore } from '@/store/preferenceStore';

const recordCompletion = usePreferenceStore(state => state.recordCompletion);
recordCompletion(trackId, duration, reactions);
```

---

## Type Conversions

### Track ID Normalization
```typescript
// YouTube ID -> VOYO ID
function encodeVoyoId(youtubeId: string): string {
  return 'vyo_' + btoa(youtubeId).replace(/=/g, '');
}

// VOYO ID -> YouTube ID
function decodeVoyoId(voyoId: string): string {
  if (!voyoId.startsWith('vyo_')) return voyoId;
  return atob(voyoId.substring(4));
}
```

### Duration Formatting
```typescript
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```

### Score Formatting
```typescript
function formatOyeScore(score: number): string {
  if (score >= 1000000) return `${(score / 1000000).toFixed(1)}M`;
  if (score >= 1000) return `${(score / 1000).toFixed(1)}K`;
  return score.toString();
}
```

---

## Import Paths

```typescript
// Core types
import { Track, MoodType, ViewMode } from '@/types';

// Store types
import { usePlayerStore } from '@/store/playerStore';
import { usePreferenceStore } from '@/store/preferenceStore';
import { useUniverseStore } from '@/store/universeStore';
import { useDownloadStore } from '@/store/downloadStore';
import { useTrackPoolStore } from '@/store/trackPoolStore';
import { useIntentStore } from '@/store/intentStore';
import { useReactionStore } from '@/store/reactionStore';

// Service types
import { BitrateLevel, BufferStatus } from '@/services/audioEngine';
```

---

## Common Type Guards

```typescript
// Check if track is in queue
function isInQueue(track: Track, queue: QueueItem[]): boolean {
  return queue.some(q => q.track.id === track.id);
}

// Check if user has premium
function isPremium(account: VOYOAccount): boolean {
  return account.subscription === 'vip' || account.subscription === 'active';
}

// Check if track is cached
async function isCached(trackId: string): Promise<boolean> {
  const url = await useDownloadStore.getState().checkCache(trackId);
  return url !== null;
}

// Check if buffer is healthy
function isBufferHealthy(status: BufferStatus): boolean {
  return status === 'healthy';
}
```

---

## Type-Safe Helpers

### Playlist Helpers
```typescript
function isUserPlaylist(playlist: Playlist): boolean {
  return playlist.type === 'USER';
}

function getTrackCount(playlist: Playlist): number {
  return playlist.trackIds.length;
}
```

### Mood Helpers
```typescript
function getMoodColor(mood: MoodType): string {
  const colors: Record<MoodType, string> = {
    afro: '#FF6B35',
    chill: '#4ECDC4',
    hype: '#FF006E',
    // ... etc
  };
  return colors[mood] || '#333';
}
```

### Reaction Helpers
```typescript
function getTotalReactions(reactions: Reaction[]): number {
  return reactions.reduce((sum, r) => sum + r.multiplier, 0);
}
```

---

## Gotchas & Common Mistakes

### 1. Track IDs vs VOYO IDs
```typescript
// Bad - might mix YouTube ID and VOYO ID
track.trackId === voyoId

// Good - normalize first
decodeVoyoId(track.trackId) === decodeVoyoId(voyoId)
```

### 2. Null Checks
```typescript
// Bad - will crash if currentTrack is null
console.log(player.currentTrack.title);

// Good - check first
if (player.currentTrack) {
  console.log(player.currentTrack.title);
}
```

### 3. Completion Rate
```typescript
// Bad - duration might be 0
const rate = currentTime / duration * 100;

// Good - check for division by zero
const rate = duration > 0 ? (currentTime / duration) * 100 : 0;
```

### 4. Queue Duplicates
```typescript
// Bad - adds duplicates
addToQueue(track);

// Good - check first
if (!queue.some(q => q.track.id === track.id)) {
  addToQueue(track);
}
```

---

## TypeScript Config Tips

### Enable Strict Mode
```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true
  }
}
```

### Path Aliases
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@/types": ["./src/types"],
      "@/store": ["./src/store"]
    }
  }
}
```

---

**Quick Ref Version**: 1.0
**Last Updated**: 2025-12-19
