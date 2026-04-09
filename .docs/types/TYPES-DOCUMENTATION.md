# VOYO Music - Complete TypeScript Types Documentation

**Generated**: 2025-12-19
**Purpose**: Comprehensive catalog of ALL types and interfaces in the VOYO music app
**Organization**: By domain (Music, Player, User, Social, System)

---

## Table of Contents

1. [Core Music Types](#core-music-types)
2. [Player State Types](#player-state-types)
3. [User & Account Types](#user--account-types)
4. [Social & Reaction Types](#social--reaction-types)
5. [VOYO Superapp Types](#voyo-superapp-types)
6. [Personalization & Intent Types](#personalization--intent-types)
7. [Download & Caching Types](#download--caching-types)
8. [Universe & Sync Types](#universe--sync-types)
9. [YouTube & External API Types](#youtube--external-api-types)
10. [Audio Engine Types](#audio-engine-types)
11. [Type Relationships Diagram](#type-relationships-diagram)

---

## Core Music Types

### `MoodType`
**Location**: `/src/types/index.ts:4-16`
**Purpose**: Represents the emotional/genre categories for music tracks and mood-based filtering

```typescript
type MoodType =
  | 'afro'        // Afrobeats and African music
  | 'feed'        // TikTok-style feed content
  | 'rnb'         // R&B and soul music
  | 'hype'        // High energy, pump-up music
  | 'chill'       // Relaxed, laid-back vibes
  | 'heartbreak'  // Emotional, sad songs
  | 'dance'       // Dance and club music
  | 'street'      // Street/urban music
  | 'party'       // Party anthems
  | 'worship'     // Religious/spiritual music
  | 'focus'       // Concentration music
  | 'gym';        // Workout music
```

**Usage**:
- Track classification: `track.mood`
- Mood tunnel navigation
- Recommendation filtering
- Preference tracking

**Example Values**:
```typescript
const afroTrack: MoodType = 'afro';
const chillMood: MoodType = 'chill';
```

---

### `MoodTunnel`
**Location**: `/src/types/index.ts:18-25`
**Purpose**: UI configuration for mood-based navigation tunnels

```typescript
interface MoodTunnel {
  id: MoodType;           // Unique identifier (matches MoodType)
  name: string;           // Display name ("Afro Heat", "Chill Vibes")
  icon: string;           // Emoji or icon identifier
  color: string;          // Primary color (hex)
  gradient: string;       // CSS gradient for UI
}
```

**Properties**:
- `id` - Required - Links to MoodType enum
- `name` - Required - Human-readable label
- `icon` - Required - Visual representation
- `color` - Required - Theme color
- `gradient` - Required - Background styling

**Usage**: Mood navigation UI, tunnel drawer components

**Example**:
```typescript
const afroTunnel: MoodTunnel = {
  id: 'afro',
  name: 'Afro Heat',
  icon: '🔥',
  color: '#FF6B35',
  gradient: 'linear-gradient(135deg, #FF6B35, #F7931E)'
};
```

---

### `Track`
**Location**: `/src/types/index.ts:28-41`
**Purpose**: Core music track entity with metadata and scoring

```typescript
interface Track {
  id: string;              // Internal VOYO ID (unique)
  title: string;           // Track title
  artist: string;          // Artist name
  album?: string;          // Optional album name
  trackId: string;         // YouTube video ID (streaming source)
  coverUrl: string;        // Thumbnail/artwork URL
  duration: number;        // Length in seconds
  tags: string[];          // Genre/style tags (['afrobeats', 'dance'])
  mood?: MoodType;         // Assigned mood category
  region?: string;         // Geographic origin ('Nigeria', 'Ghana')
  oyeScore: number;        // Social engagement score (0-infinity)
  createdAt: string;       // ISO 8601 timestamp
}
```

**Properties**:
- `id` - Required - Internal identifier (persistent)
- `title` - Required - Display name
- `artist` - Required - Creator attribution
- `album` - Optional - Album grouping
- `trackId` - Required - YouTube video ID for streaming
- `coverUrl` - Required - Visual asset URL
- `duration` - Required - Playback length in seconds
- `tags` - Required - Array of classification tags
- `mood` - Optional - Primary mood assignment
- `region` - Optional - Geographic metadata
- `oyeScore` - Required - Social engagement metric
- `createdAt` - Required - Entry timestamp

**Usage**:
- Current playback
- Queue management
- Search results
- Recommendation engines

**Example**:
```typescript
const track: Track = {
  id: 'last-last',
  title: 'Last Last',
  artist: 'Burna Boy',
  album: 'Love, Damini',
  trackId: 'VLW1ieN9Cg8',
  coverUrl: 'https://i.ytimg.com/vi/VLW1ieN9Cg8/maxresdefault.jpg',
  duration: 162,
  tags: ['afrobeats', 'dance'],
  mood: 'afro',
  region: 'Nigeria',
  oyeScore: 8547,
  createdAt: '2024-01-15T10:30:00Z'
};
```

---

### `Album`
**Location**: `/src/types/index.ts:54-63`
**Purpose**: YouTube playlist wrapper for album/playlist functionality

```typescript
interface Album {
  id: string;              // YouTube playlist ID
  name: string;            // Album/playlist name
  artist: string;          // Album artist
  thumbnail: string;       // Album artwork URL
  trackCount: number;      // Number of tracks
  tracks?: Track[];        // Lazily loaded track list
  source: 'piped' | 'local'; // Data source
}
```

**Properties**:
- `id` - Required - YouTube playlist identifier
- `name` - Required - Display name
- `artist` - Required - Album artist
- `thumbnail` - Required - Cover art
- `trackCount` - Required - Total tracks
- `tracks` - Optional - Loaded on demand to save memory
- `source` - Required - Origin of data

**Usage**: Album browsing, playlist import, batch track loading

**Example**:
```typescript
const album: Album = {
  id: 'PLxA687tYuMWj3Rg5JNh',
  name: 'Love, Damini',
  artist: 'Burna Boy',
  thumbnail: 'https://i.ytimg.com/vi/xyz/hqdefault.jpg',
  trackCount: 19,
  source: 'piped'
};
```

---

### `ViewMode`
**Location**: `/src/types/index.ts:66`
**Purpose**: Display modes for the player interface

```typescript
type ViewMode = 'card' | 'lyrics' | 'video' | 'feed';
```

**Values**:
- `card` - Default: Album art + controls
- `lyrics` - Lyrics display mode
- `video` - Full video playback
- `feed` - TikTok-style vertical feed

**Usage**: Player UI state, view cycling

---

### `Playlist`
**Location**: `/src/types/index.ts:44-52`
**Purpose**: User-created or curated track collections

```typescript
interface Playlist {
  id: string;                    // Unique playlist ID
  title: string;                 // Playlist name
  coverUrl: string;              // Cover image
  trackIds: string[];            // Ordered track IDs
  type: 'CURATED' | 'ALGO' | 'USER'; // Origin type
  mood?: MoodType;               // Optional mood association
  createdAt: string;             // Creation timestamp
}
```

**Properties**:
- `id` - Required - Unique identifier
- `title` - Required - Display name
- `coverUrl` - Required - Visual representation
- `trackIds` - Required - Ordered list of track IDs
- `type` - Required - Source classification
  - `CURATED` - Hand-picked by editors
  - `ALGO` - Algorithm-generated
  - `USER` - User-created
- `mood` - Optional - Mood association
- `createdAt` - Required - Timestamp

**Usage**: Playlist management, saved collections

**Example**:
```typescript
const playlist: Playlist = {
  id: 'pl_afro_hits_2024',
  title: 'Afro Hits 2024',
  coverUrl: 'https://...',
  trackIds: ['last-last', 'essence', 'calm-down'],
  type: 'CURATED',
  mood: 'afro',
  createdAt: '2024-01-01T00:00:00Z'
};
```

---

## Player State Types

### `PlayerState`
**Location**: `/src/types/index.ts:69-77`
**Purpose**: Core player state snapshot

```typescript
interface PlayerState {
  currentTrack: Track | null;    // Currently playing track
  isPlaying: boolean;            // Playback state
  progress: number;              // Progress percentage (0-100)
  currentTime: number;           // Playback position (seconds)
  volume: number;                // Volume level (0-100)
  viewMode: ViewMode;            // Display mode
  isVideoMode: boolean;          // Video playback enabled
}
```

**Properties**:
- `currentTrack` - Nullable - Active track or null when stopped
- `isPlaying` - Required - True when audio is playing
- `progress` - Required - UI progress bar (0-100)
- `currentTime` - Required - Seek position in seconds
- `volume` - Required - Audio volume (0-100)
- `viewMode` - Required - Current UI mode
- `isVideoMode` - Required - Video toggle state

**Usage**: Player component state, persistence, UI rendering

---

### `PlayerStore` (Zustand Store Interface)
**Location**: `/src/store/playerStore.ts:59-184`
**Purpose**: Complete player state management with actions

**State Properties**:
```typescript
interface PlayerStore {
  // Current Track State
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  volume: number;
  viewMode: ViewMode;
  isVideoMode: boolean;
  seekPosition: number | null;

  // SKEEP (Fast-forward) State
  playbackRate: number;          // 1, 2, 4, 8
  isSkeeping: boolean;

  // Streaming Optimization
  networkQuality: NetworkQuality;
  streamQuality: BitrateLevel;
  bufferHealth: number;          // 0-100
  bufferStatus: BufferStatus;
  prefetchStatus: Map<string, PrefetchStatus>;
  playbackSource: 'cached' | 'direct' | 'iframe' | null;

  // Audio Presets
  boostProfile: 'boosted' | 'calm' | 'voyex' | 'xtreme';
  oyeBarBehavior: 'fade' | 'disappear';

  // Playback Modes
  shuffleMode: boolean;
  repeatMode: 'off' | 'all' | 'one';

  // Queue & History
  queue: QueueItem[];
  history: HistoryItem[];

  // Recommendations
  hotTracks: Track[];
  aiPicks: Track[];
  discoverTracks: Track[];
  isAiMode: boolean;

  // Mood Tunnel
  currentMood: MoodType | null;

  // OYE Reactions
  reactions: Reaction[];
  oyeScore: number;

  // Roulette
  isRouletteMode: boolean;
  rouletteTracks: Track[];

  // VOYO Superapp Tab
  voyoActiveTab: VoyoTab;

  // Actions (90+ methods - see full interface for details)
}
```

**Key Type Dependencies**:
- `NetworkQuality`: `'slow' | 'medium' | 'fast' | 'unknown'`
- `PrefetchStatus`: `'idle' | 'loading' | 'ready' | 'error'`
- `BitrateLevel`: From audio engine types
- `BufferStatus`: From audio engine types

---

### `QueueItem`
**Location**: `/src/types/index.ts:80-84`
**Purpose**: Tracks in the playback queue with metadata

```typescript
interface QueueItem {
  track: Track;                  // Track reference
  addedAt: string;               // ISO timestamp
  source: 'auto' | 'manual' | 'roulette' | 'ai'; // How it was added
}
```

**Properties**:
- `track` - Required - Complete track object
- `addedAt` - Required - Queue entry time
- `source` - Required - Addition method
  - `auto` - Algorithm-added
  - `manual` - User-added
  - `roulette` - Roulette mode
  - `ai` - AI recommendation

**Usage**: Queue management, source tracking, UI display

---

### `HistoryItem`
**Location**: `/src/types/index.ts:87-92`
**Purpose**: Playback history with engagement metrics

```typescript
interface HistoryItem {
  track: Track;                  // Track that was played
  playedAt: string;              // ISO timestamp
  duration: number;              // How long it was played (seconds)
  oyeReactions: number;          // Reactions received during play
}
```

**Properties**:
- `track` - Required - Track reference
- `playedAt` - Required - Playback start time
- `duration` - Required - Listen duration (not track duration)
- `oyeReactions` - Required - Engagement count

**Usage**: History view, preference learning, stats

---

### `Recommendation`
**Location**: `/src/types/index.ts:98-103`
**Purpose**: Recommended track with context

```typescript
interface Recommendation {
  track: Track;                  // Recommended track
  zone: RecommendationZone;      // Recommendation source
  reason?: string;               // Optional explanation
  score: number;                 // Relevance score (0-100)
}
```

**Properties**:
- `track` - Required - Track to recommend
- `zone` - Required - Recommendation algorithm zone
- `reason` - Optional - Human-readable explanation
- `score` - Required - Confidence/relevance score

**Related Types**:
```typescript
type RecommendationZone = 'hot' | 'ai' | 'discover';
```

**Usage**: Recommendation engines, discovery UI

---

## User & Account Types

### `User`
**Location**: `/src/types/index.ts:139-149`
**Purpose**: Basic user profile (legacy/simple)

```typescript
interface User {
  id: string;                    // User ID
  displayName: string;           // Display name
  avatarUrl?: string;            // Profile picture
  country?: string;              // User country
  oyoLevel: number;              // Gamification level
  oyeScore: number;              // Total engagement score
  likedTracks: string[];         // Liked track IDs
  playlists: string[];           // Playlist IDs
  createdAt: string;             // Account creation
}
```

**Note**: This is the simplified user type. See `VOYOAccount` for full account system.

---

### `VOYOAccount`
**Location**: `/src/types/index.ts:237-270`
**Purpose**: Full WhatsApp-based account system with social features

```typescript
interface VOYOAccount {
  // Identity
  id: string;                    // Unique user ID
  username: string;              // voyomusic.com/[username]
  whatsapp: string;              // +224XXXXXXXXX
  pin: string;                   // 6-digit PIN (hashed in production)
  displayName: string;           // Display name
  avatarUrl?: string;            // Profile picture URL
  bio?: string;                  // User bio

  // Subscription
  subscription: SubscriptionStatus;
  banReason?: string;            // "Payment overdue since Dec 1"
  subscriptionEnds?: string;     // ISO date

  // Social
  friendIds: string[];           // Friend user IDs
  friendRequestIds: string[];    // Pending request IDs

  // Music Stats
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

  // Stories
  stories: VOYOStory[];

  createdAt: string;
  lastSeenAt: string;
}
```

**Related Types**:
```typescript
type SubscriptionStatus =
  | 'active'      // Paid up, full access
  | 'trial'       // New user, 7 day trial
  | 'overdue'     // Payment pending, grace period
  | 'banned'      // Blocked for non-payment
  | 'vip';        // Lifetime/special access

type VerificationState =
  | 'idle'
  | 'sending_pin'
  | 'waiting_pin'
  | 'verifying'
  | 'verified'
  | 'error';
```

**Usage**: Account system, profile pages, authentication

---

### `VOYOStory`
**Location**: `/src/types/index.ts:273-297`
**Purpose**: 24-hour ephemeral content for friends

```typescript
interface VOYOStory {
  id: string;                    // Story ID
  userId: string;                // Creator ID
  type: 'now_playing' | 'image' | 'video' | 'text';
  content: {
    // For now_playing
    trackId?: string;
    title?: string;
    artist?: string;
    thumbnail?: string;
    // For media
    url?: string;
    // For text
    text?: string;
    backgroundColor?: string;
  };
  viewerIds: string[];           // Who has viewed
  reactions: {
    emoji: string;
    userId: string;
    timestamp: string;
  }[];
  expiresAt: string;             // 24h from creation
  createdAt: string;
}
```

**Properties**:
- `type` - Required - Story content type
- `content` - Required - Type-specific content
- `viewerIds` - Required - Track viewers
- `reactions` - Required - Story reactions
- `expiresAt` - Required - Auto-delete time

**Usage**: Friend stories, DAHUB feed

---

### `FriendWithStory`
**Location**: `/src/types/index.ts:300-305`
**Purpose**: Friend metadata for DAHUB display

```typescript
interface FriendWithStory {
  account: VOYOAccount;          // Full account data
  hasUnviewedStory: boolean;     // Story indicator
  latestStoryTime?: string;      // Last story timestamp
  unreadMessageCount: number;    // Chat unread count
}
```

**Usage**: DAHUB friend list rendering

---

## Social & Reaction Types

### `ReactionType`
**Location**: `/src/types/index.ts:106-115`
**Purpose**: Available reaction types for tracks

```typescript
type ReactionType =
  | 'oyo'         // Basic reaction
  | 'oye'         // Main VOYO reaction
  | 'wazzguan'    // West African slang
  | 'yoooo'       // Excitement
  | 'mad_oh'      // Amazement (Nigerian)
  | 'eyyy'        // Acknowledgment
  | 'fire'        // Hot track
  | 'we_move'     // Agreement (slang)
  | 'custom';     // User-defined
```

**Usage**: Reaction buttons, engagement tracking

---

### `Reaction`
**Location**: `/src/types/index.ts:118-128`
**Purpose**: User reaction instance with animation data

```typescript
interface Reaction {
  id: string;                    // Unique reaction ID
  type: ReactionType;            // Reaction type
  text: string;                  // Display text ("OYÉ!", "🔥")
  emoji?: string;                // Optional emoji
  x: number;                     // Screen position X
  y: number;                     // Screen position Y
  multiplier: number;            // Score multiplier (1x, 2x, etc.)
  userId: string;                // Who reacted
  createdAt: string;             // Reaction time
}
```

**Properties**:
- Animation coordinates: `x`, `y` for floating reactions
- `multiplier` - Combo system (tapping increases multiplier)
- `userId` - Attribution in multi-user scenarios

**Usage**: Real-time reaction animations, score calculation

---

### `OyeScore`
**Location**: `/src/types/index.ts:131-136`
**Purpose**: Engagement score breakdown

```typescript
interface OyeScore {
  total: number;                 // Combined score
  reactions: number;             // From reactions
  storms: number;                // From reaction storms
  peak: number;                  // Highest score achieved
}
```

**Usage**: Track popularity, user stats, leaderboards

---

### `ReactionCategory` (Supabase)
**Location**: `/src/store/reactionStore.ts:21-26`
**Purpose**: Music vibe categorization for social reactions

```typescript
type ReactionCategory =
  | 'afro-heat'      // African music energy
  | 'chill-vibes'    // Relaxed vibes
  | 'party-mode'     // Party music
  | 'late-night'     // Moody atmosphere
  | 'workout';       // Gym motivation
```

---

### `TrackStats`
**Location**: `/src/store/reactionStore.ts:54-68`
**Purpose**: Aggregated reaction statistics per track

```typescript
interface TrackStats {
  track_id: string;
  track_title?: string;
  track_artist?: string;
  track_thumbnail?: string;
  total_reactions: number;
  afro_heat_count: number;
  chill_vibes_count: number;
  party_mode_count: number;
  late_night_count: number;
  workout_count: number;
  dominant_category?: ReactionCategory;
  first_reaction_at?: string;
  last_reaction_at?: string;
}
```

**Usage**: Track analytics, vibe detection, trending

---

### `TrackHotspot`
**Location**: `/src/store/reactionStore.ts:47-52`
**Purpose**: Reaction clusters within a track (where people react most)

```typescript
interface TrackHotspot {
  position: number;              // 0-100 percentage in track
  intensity: number;             // 0-1 heat intensity
  reactionCount: number;         // Reactions at this position
  dominantType: ReactionType;    // Most common reaction here
}
```

**Usage**: Heatmap visualization, skip detection, viral moments

---

### `CategoryPulse`
**Location**: `/src/store/reactionStore.ts:70-75`
**Purpose**: Real-time activity per category

```typescript
interface CategoryPulse {
  category: ReactionCategory;
  count: number;                 // Total reactions
  lastReaction?: Reaction;       // Most recent
  isHot: boolean;                // Activity in last 30s
}
```

**Usage**: Live feed, trending categories

---

### `CategoryPreference`
**Location**: `/src/store/reactionStore.ts:78-86`
**Purpose**: User's affinity scoring per category (For You algorithm)

```typescript
interface CategoryPreference {
  category: ReactionCategory;
  reactionCount: number;         // Total reactions given
  likeCount: number;             // Like reactions
  oyeCount: number;              // OYE reactions
  fireCount: number;             // Fire reactions
  lastReactedAt?: string;        // Recency
  score: number;                 // Computed preference (0-100)
}
```

**Usage**: Personalization, For You recommendations

---

## VOYO Superapp Types

### `VoyoTab`
**Location**: `/src/types/index.ts:192`
**Purpose**: Main navigation tabs in VOYO superapp

```typescript
type VoyoTab = 'music' | 'feed' | 'upload' | 'dahub';
```

**Values**:
- `music` - Music player interface
- `feed` - TikTok-style content feed
- `upload` - Creator upload interface
- `dahub` - Social hub (friends, stories)

---

### `FeedItem`
**Location**: `/src/types/index.ts:195-209`
**Purpose**: TikTok-style content item

```typescript
interface FeedItem {
  id: string;                    // Unique item ID
  user: string;                  // Creator username
  userAvatar?: string;           // Creator avatar
  caption: string;               // Content description
  likes: string;                 // Like count (formatted)
  oyes: string;                  // OYE count (formatted)
  videoUrl: string;              // Video source URL
  thumbnailUrl?: string;         // Video thumbnail
  songId?: string;               // Associated track ID
  songTitle?: string;            // Associated track title
  songArtist?: string;           // Associated artist
  tags?: string[];               // Content tags
  createdAt: string;             // Post time
}
```

**Usage**: Vertical feed, content discovery

---

### `DJMode`
**Location**: `/src/types/index.ts:212`
**Purpose**: AI DJ conversation states

```typescript
type DJMode = 'idle' | 'listening' | 'thinking' | 'responding';
```

**Usage**: DJ interface animations, loading states

---

### `VoyoClip`
**Location**: `/src/types/index.ts:152-163`
**Purpose**: User-created video clips linked to music

```typescript
interface VoyoClip {
  id: string;                    // Clip ID
  trackId: string;               // Source track
  userId: string;                // Creator ID
  videoUrl: string;              // Video URL
  thumbnailUrl: string;          // Thumbnail URL
  caption?: string;              // Clip description
  tags: string[];                // Content tags
  oyeScore: number;              // Engagement score
  viewCount: number;             // Total views
  createdAt: string;             // Upload time
}
```

**Usage**: UGC management, feed content

---

### `SessionType`
**Location**: `/src/types/index.ts:166-172`
**Purpose**: Live session formats

```typescript
type SessionType =
  | 'private_showcase'    // Invite-only
  | 'oyo_circle'          // Small group
  | 'choir_mode'          // Collaborative sing-along
  | 'street_festival'     // Public large event
  | 'voyo_concert'        // Virtual concert
  | 'oye_arena';          // Competitive arena
```

---

### `LiveSession`
**Location**: `/src/types/index.ts:175-185`
**Purpose**: Live streaming/listening session

```typescript
interface LiveSession {
  id: string;                    // Session ID
  artistId: string;              // Host artist
  oyeGoal: number;               // Target OYE score
  currentOye: number;            // Current score
  sessionType: SessionType;      // Session format
  scheduledAt?: string;          // Schedule time
  isLive: boolean;               // Live now
  rsvpCount: number;             // Attendee count
  highlightClipIds: string[];    // Featured clips
}
```

**Usage**: Live events, virtual concerts

---

## Personalization & Intent Types

### `VibeMode`
**Location**: `/src/store/intentStore.ts:26-32`
**Purpose**: User intent categories for intelligent recommendation

```typescript
type VibeMode =
  | 'afro-heat'        // African music energy
  | 'chill-vibes'      // Relaxed listening
  | 'party-mode'       // High energy party
  | 'late-night'       // Moody atmosphere
  | 'workout'          // Exercise motivation
  | 'random-mixer';    // No filtering
```

**Relationship**: Similar to `ReactionCategory` but for intent, not just reactions

---

### `ModeIntent`
**Location**: `/src/store/intentStore.ts:34-45`
**Purpose**: Tracks user's preference strength for each vibe mode

```typescript
interface ModeIntent {
  modeId: VibeMode;              // Mode identifier
  manualBars: number;            // User-set preference (0-6 bars)
  tracksQueued: number;          // Tracks added from this mode
  dragToQueueCount: number;      // Drag events (strongest signal)
  lastActivity: string;          // ISO timestamp
  intentScore: number;           // Calculated score (0-100)
}
```

**Properties**:
- `manualBars` - User's explicit setting (MixBoard)
- `dragToQueueCount` - Highest intent signal (user actively pulled tracks)
- `intentScore` - Computed from multiple signals with time decay

**Usage**: Recommendation weighting, personalization engine

---

### `IntentSession`
**Location**: `/src/store/intentStore.ts:47-54`
**Purpose**: Tracks user behavior during an app session

```typescript
interface IntentSession {
  sessionId: string;             // Unique session ID
  startedAt: string;             // Session start
  modeActivity: Record<VibeMode, number>; // Activity per mode
  dragEvents: Array<{            // Drag-to-queue events
    modeId: VibeMode;
    timestamp: string;
  }>;
}
```

**Usage**: Session analytics, intent scoring

---

### `TrackPreference`
**Location**: `/src/store/preferenceStore.ts:21-36`
**Purpose**: Detailed listening behavior per track

```typescript
interface TrackPreference {
  trackId: string;               // Track identifier

  // Listen behavior
  totalListens: number;          // Play count
  totalDuration: number;         // Total seconds listened
  completions: number;           // Plays >80% complete
  skips: number;                 // Plays <20% complete

  // User actions
  reactions: number;             // OYE reactions given
  explicitLike?: boolean;        // Manual like/dislike

  // Metadata
  lastPlayedAt: string;          // ISO timestamp
  createdAt: string;             // First play
}
```

**Usage**: Preference learning, skip detection, recommendation scoring

---

### `ArtistPreference`
**Location**: `/src/store/preferenceStore.ts:38-44`
**Purpose**: Aggregated artist-level preferences

```typescript
interface ArtistPreference {
  artist: string;                // Artist name
  totalListens: number;          // Total plays
  avgCompletion: number;         // Average completion rate (0-100)
  reactions: number;             // Total reactions
  lastPlayedAt: string;          // Last play time
}
```

---

### `TagPreference`, `MoodPreference`
**Location**: `/src/store/preferenceStore.ts:46-60`
**Purpose**: Similar structure for tags and moods

```typescript
interface TagPreference {
  tag: string;
  totalListens: number;
  avgCompletion: number;
  reactions: number;
  lastPlayedAt: string;
}

interface MoodPreference {
  mood: string;
  totalListens: number;
  avgCompletion: number;
  reactions: number;
  lastPlayedAt: string;
}
```

---

### `ListenSession`
**Location**: `/src/store/preferenceStore.ts:62-70`
**Purpose**: Tracks a single listen session for analytics

```typescript
interface ListenSession {
  trackId: string;               // Track being listened to
  startedAt: string;             // Session start
  endedAt?: string;              // Session end
  duration: number;              // How long listened
  completed: boolean;            // >80% played
  skipped: boolean;              // <20% played
  reactions: number;             // Reactions during session
}
```

**Usage**: Real-time preference tracking

---

### `PooledTrack`
**Location**: `/src/store/trackPoolStore.ts:40-64`
**Purpose**: Enhanced track with pool metadata and scoring

```typescript
interface PooledTrack extends Track {
  // Pool metadata
  pooledAt: string;              // When added to pool
  lastPlayedAt?: string;         // Last play time
  lastScoredAt?: string;         // Last scoring time

  // Engagement signals
  playCount: number;             // Times played
  completionRate: number;        // Avg % listened (0-100)
  reactionCount: number;         // OYE reactions
  queuedCount: number;           // Times queued
  skippedCount: number;          // Times skipped

  // Classification
  detectedMode: VibeMode;        // Auto-detected vibe
  confidence: number;            // Detection confidence (0-1)

  // Pool status
  poolScore: number;             // Relevance score (0-100)
  isHot: boolean;                // In active pool
  isCold: boolean;               // In cold storage

  // Source tracking
  source: 'seed' | 'search' | 'related' | 'trending' | 'llm' | 'album';
}
```

**Purpose**: Intelligent track pool management with automatic scoring and lifecycle

**Usage**: Dynamic recommendations, hot/cold pool management

---

## Download & Caching Types

### `DownloadProgress`
**Location**: `/src/store/downloadStore.ts:30-35`
**Purpose**: Track download state for UI

```typescript
interface DownloadProgress {
  trackId: string;               // Track being downloaded
  progress: number;              // 0-100 percentage
  status: 'queued' | 'downloading' | 'complete' | 'failed';
  error?: string;                // Error message if failed
}
```

---

### `CachedTrackInfo`
**Location**: `/src/store/downloadStore.ts:37-44`
**Purpose**: Metadata for cached tracks

```typescript
interface CachedTrackInfo {
  id: string;                    // Track ID
  title: string;                 // Track title
  artist: string;                // Artist name
  size: number;                  // File size in bytes
  quality: 'standard' | 'boosted'; // Cache quality
  downloadedAt: number;          // Timestamp
}
```

---

### `BoostCompletion`
**Location**: `/src/store/downloadStore.ts:47-52`
**Purpose**: Boost completion event for DJ rewind feature

```typescript
interface BoostCompletion {
  trackId: string;               // Completed track
  duration: number;              // Download duration (seconds)
  isFast: boolean;               // < 7 seconds (instant playback)
  timestamp: number;             // Completion time
}
```

**Usage**: Hot-swap audio when boost completes mid-playback

---

### `DownloadSetting`
**Location**: `/src/services/downloadManager.ts` (inferred)
**Purpose**: User preference for auto-downloads

```typescript
type DownloadSetting = 'always' | 'wifi-only' | 'never';
```

---

## Universe & Sync Types

### `UniverseData`
**Location**: `/src/store/universeStore.ts:38-58`
**Purpose**: Complete exportable/importable user state

```typescript
interface UniverseData {
  version: string;               // Format version
  exportedAt: string;            // Export timestamp
  username: string;              // User identifier

  preferences: {
    trackPreferences: Record<string, any>;
    artistPreferences: Record<string, any>;
    tagPreferences: Record<string, any>;
    moodPreferences: Record<string, any>;
  };

  player: {
    currentTrackId?: string;
    currentTime?: number;
    volume: number;
    boostProfile: string;
    shuffleMode: boolean;
    repeatMode: string;
  };

  boostedTracks: string[];       // Cached track IDs
  playlists: Array<{             // User playlists
    id: string;
    name: string;
    trackIds: string[];
    createdAt: string;
  }>;
  history: Array<{               // Play history
    trackId: string;
    playedAt: string;
    duration: number;
  }>;
}
```

**Usage**: Backup/restore, device sync, account migration

---

### `UniverseRow` (Supabase)
**Location**: `/src/lib/supabase.ts:34-45`
**Purpose**: Database schema for universes table

```typescript
interface UniverseRow {
  username: string;              // Primary key
  pin_hash: string;              // Hashed PIN
  phone: string | null;          // WhatsApp number
  state: UniverseState;          // User state (JSONB)
  public_profile: PublicProfile; // Public data
  now_playing: NowPlaying | null; // Current track
  portal_open: boolean;          // Portal visibility
  portal_viewers: string[];      // Connected viewers
  created_at: string;            // Account creation
  updated_at: string;            // Last update
  last_active: string;           // Last activity
}
```

---

### `UniverseState` (Supabase)
**Location**: `/src/lib/supabase.ts:48-63`
**Purpose**: User state stored in database

```typescript
interface UniverseState {
  likes: string[];               // Liked track IDs
  playlists: Playlist[];         // User playlists
  queue: string[];               // Current queue
  history: HistoryItem[];        // Play history
  preferences: {
    boostProfile: string;
    shuffleMode: boolean;
    repeatMode: string;
  };
  stats: {
    totalListens: number;
    totalMinutes: number;
    totalOyes: number;
  };
}
```

---

### `PublicProfile`
**Location**: `/src/lib/supabase.ts:65-71`
**Purpose**: Publicly visible user data

```typescript
interface PublicProfile {
  displayName: string;           // Display name
  bio: string;                   // User bio
  avatarUrl: string | null;      // Profile picture
  topTracks: string[];           // Favorite tracks
  publicPlaylists: string[];     // Public playlists
  isPublic: boolean;             // Profile visibility
}
```

---

### `NowPlaying`
**Location**: `/src/lib/supabase.ts:74-81`
**Purpose**: Real-time now playing status for portal

```typescript
interface NowPlaying {
  trackId: string;               // Current track ID
  title: string;                 // Track title
  artist: string;                // Artist name
  thumbnail: string;             // Cover art
  currentTime: number;           // Playback position
  duration: number;              // Track length
  isPlaying: boolean;            // Playing state
}
```

---

### `PortalSession`
**Location**: `/src/store/universeStore.ts:60-66`
**Purpose**: Active portal listening session

```typescript
interface PortalSession {
  id: string;                    // Session ID
  hostUsername: string;          // Portal host
  isHost: boolean;               // Is current user host
  connectedPeers: string[];      // Connected users
  isLive: boolean;               // Session active
  startedAt: string;             // Session start
}
```

---

### `ViewingUniverse`
**Location**: `/src/store/universeStore.ts:70-75`
**Purpose**: State when viewing someone's universe

```typescript
interface ViewingUniverse {
  username: string;              // Universe owner
  profile: PublicProfile;        // Public profile data
  nowPlaying: NowPlaying | null; // Current playback
  portalOpen: boolean;           // Portal status
}
```

---

## YouTube & External API Types

### `YT` Namespace
**Location**: `/src/types/youtube.d.ts:5-91`
**Purpose**: YouTube IFrame Player API type definitions

```typescript
declare namespace YT {
  interface Player {
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    setVolume(volume: number): void;
    getVolume(): number;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getCurrentTime(): number;
    getDuration(): number;
    getVideoLoadedFraction(): number;
    getPlayerState(): number;
    destroy(): void;
  }

  interface PlayerOptions {
    height?: string | number;
    width?: string | number;
    videoId?: string;
    playerVars?: PlayerVars;
    events?: PlayerEvents;
  }

  interface PlayerVars {
    autoplay?: 0 | 1;
    cc_load_policy?: 0 | 1;
    color?: 'red' | 'white';
    controls?: 0 | 1 | 2;
    disablekb?: 0 | 1;
    enablejsapi?: 0 | 1;
    end?: number;
    fs?: 0 | 1;
    hl?: string;
    iv_load_policy?: 1 | 3;
    list?: string;
    listType?: 'playlist' | 'search' | 'user_uploads';
    loop?: 0 | 1;
    modestbranding?: 0 | 1;
    origin?: string;
    playlist?: string;
    playsinline?: 0 | 1;
    rel?: 0 | 1;
    showinfo?: 0 | 1;
    start?: number;
  }

  interface PlayerEvents {
    onReady?: (event: PlayerEvent) => void;
    onStateChange?: (event: OnStateChangeEvent) => void;
    onPlaybackQualityChange?: (event: OnPlaybackQualityChangeEvent) => void;
    onPlaybackRateChange?: (event: OnPlaybackRateChangeEvent) => void;
    onError?: (event: OnErrorEvent) => void;
    onApiChange?: (event: PlayerEvent) => void;
  }

  interface PlayerEvent {
    target: Player;
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: PlayerState;
  }

  interface OnPlaybackQualityChangeEvent extends PlayerEvent {
    data: string;
  }

  interface OnPlaybackRateChangeEvent extends PlayerEvent {
    data: number;
  }

  interface OnErrorEvent extends PlayerEvent {
    data: number;
  }

  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
}
```

**Usage**: YouTube player integration, video playback

---

### Window Extensions
**Location**: `/src/types/youtube.d.ts:93-99`
**Purpose**: Global window object extensions

```typescript
interface Window {
  YT: {
    Player: new (elementId: string, options: YT.PlayerOptions) => YT.Player;
    PlayerState: typeof YT.PlayerState;
  };
  onYouTubeIframeAPIReady: () => void;
}
```

---

## Audio Engine Types

### `BitrateLevel`
**Location**: `/src/services/audioEngine.ts:13`
**Purpose**: Audio quality levels

```typescript
type BitrateLevel = 'low' | 'medium' | 'high';
```

**Values**:
- `low` - 64 kbps
- `medium` - 128 kbps
- `high` - 256 kbps

---

### `BufferStatus`
**Location**: `/src/services/audioEngine.ts:14`
**Purpose**: Buffer health status

```typescript
type BufferStatus = 'healthy' | 'warning' | 'emergency';
```

**Values**:
- `healthy` - Buffer > 8 seconds
- `warning` - Buffer 3-8 seconds
- `emergency` - Buffer < 3 seconds

---

### `BufferHealth`
**Location**: `/src/services/audioEngine.ts:16-21`
**Purpose**: Detailed buffer state

```typescript
interface BufferHealth {
  current: number;               // Current buffer (seconds)
  target: number;                // Target buffer (15s)
  status: BufferStatus;          // Health status
  percentage: number;            // 0-100 fullness
}
```

---

### `NetworkStats`
**Location**: `/src/services/audioEngine.ts:23-27`
**Purpose**: Network performance metrics

```typescript
interface NetworkStats {
  speed: number;                 // Estimated speed (kbps)
  latency: number;               // Average latency (ms)
  lastMeasured: number;          // Measurement timestamp
}
```

---

### `PrefetchStatus`
**Location**: `/src/services/audioEngine.ts:29-35`
**Purpose**: Track prefetch progress

```typescript
interface PrefetchStatus {
  trackId: string;               // Track identifier
  status: 'pending' | 'loading' | 'ready' | 'failed';
  progress: number;              // 0-100 percentage
  startTime: number;             // Start timestamp
  endTime?: number;              // End timestamp
}
```

---

### `NetworkQuality` (Player)
**Location**: `/src/store/playerStore.ts:19`
**Purpose**: Detected network quality

```typescript
type NetworkQuality = 'slow' | 'medium' | 'fast' | 'unknown';
```

**Detection**:
- `slow` - 2G/slow-2G
- `medium` - 3G
- `fast` - 4G with >5 Mbps
- `unknown` - Cannot detect

---

## Type Relationships Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CORE MUSIC LAYER                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Track ──────┬──> PooledTrack (+ pool metadata)                │
│              │                                                  │
│              ├──> QueueItem (+ queue metadata)                 │
│              │                                                  │
│              └──> HistoryItem (+ playback metadata)            │
│                                                                 │
│  MoodType ───┬──> MoodTunnel (+ UI config)                     │
│              │                                                  │
│              └──> MoodPreference (+ user preference)           │
│                                                                 │
│  Album ──────────> Track[] (lazy loaded)                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PLAYER STATE LAYER                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PlayerState ─────> Track (current)                            │
│              │                                                  │
│              ├────> ViewMode                                   │
│              │                                                  │
│              └────> Volume, Progress, etc.                     │
│                                                                 │
│  PlayerStore ─────> PlayerState (+ actions + advanced state)   │
│              │                                                  │
│              ├────> Queue: QueueItem[]                         │
│              │                                                  │
│              ├────> History: HistoryItem[]                     │
│              │                                                  │
│              ├────> Reactions: Reaction[]                      │
│              │                                                  │
│              ├────> NetworkQuality, BitrateLevel, BufferStatus │
│              │                                                  │
│              └────> VoyoTab (superapp state)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PERSONALIZATION LAYER                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TrackPreference ─> Track (+ behavior analytics)               │
│                                                                 │
│  ArtistPreference ──> aggregated from TrackPreference          │
│                                                                 │
│  TagPreference ──────> aggregated from TrackPreference         │
│                                                                 │
│  MoodPreference ─────> aggregated from TrackPreference         │
│                                                                 │
│  ModeIntent ─────────> VibeMode (+ intent signals)             │
│                                                                 │
│  IntentSession ──────> ModeIntent[] (session tracking)         │
│                                                                 │
│  PooledTrack ────────> Track + VibeMode + scoring              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SOCIAL & USER LAYER                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User ────────────────> simplified user profile                │
│                                                                 │
│  VOYOAccount ─────────> full account system                    │
│              │                                                  │
│              ├────> SubscriptionStatus                         │
│              │                                                  │
│              ├────> NowPlaying                                 │
│              │                                                  │
│              └────> VOYOStory[]                                │
│                                                                 │
│  Reaction ────────────> ReactionType + Track + User            │
│                                                                 │
│  ReactionCategory ────> CategoryPulse (real-time)              │
│              │                                                  │
│              └────> CategoryPreference (user affinity)         │
│                                                                 │
│  TrackStats ──────────> Track + Reaction analytics             │
│                                                                 │
│  TrackHotspot ────────> Track position + Reaction clusters     │
│                                                                 │
│  FriendWithStory ─────> VOYOAccount + Story metadata           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     UNIVERSE & SYNC LAYER                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  UniverseData ────────> complete exportable state              │
│              │                                                  │
│              ├────> Preferences (all types)                    │
│              │                                                  │
│              ├────> PlayerState snapshot                       │
│              │                                                  │
│              └────> Playlists, History                         │
│                                                                 │
│  UniverseRow (DB) ────> UniverseState (JSONB)                  │
│              │                                                  │
│              ├────> PublicProfile                              │
│              │                                                  │
│              ├────> NowPlaying                                 │
│              │                                                  │
│              └────> PortalSession                              │
│                                                                 │
│  ViewingUniverse ─────> viewing other user's universe          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DOWNLOAD & CACHE LAYER                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  DownloadProgress ────> Track download state                   │
│                                                                 │
│  CachedTrackInfo ─────> Track + cache metadata                 │
│                                                                 │
│  BoostCompletion ─────> Track + completion event               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AUDIO ENGINE LAYER                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  BitrateLevel ────────> quality setting                        │
│                                                                 │
│  BufferStatus ────────> buffer health enum                     │
│                                                                 │
│  BufferHealth ────────> detailed buffer state                  │
│                                                                 │
│  NetworkStats ────────> network performance                    │
│                                                                 │
│  PrefetchStatus ──────> Track prefetch state                   │
│                                                                 │
│  NetworkQuality ──────> detected connection quality            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL API LAYER                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  YT.Player ───────────> YouTube IFrame API                     │
│                                                                 │
│  YT.PlayerOptions ────> player configuration                   │
│                                                                 │
│  YT.PlayerEvents ─────> event handlers                         │
│                                                                 │
│  YT.PlayerState ──────> playback state enum                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Common Type Patterns

### 1. **ID Fields**
All entities use `string` IDs for flexibility:
```typescript
id: string;           // Internal ID
trackId: string;      // YouTube video ID
username: string;     // Account identifier
```

### 2. **Timestamps**
All timestamps use ISO 8601 format:
```typescript
createdAt: string;    // "2024-01-15T10:30:00Z"
playedAt: string;
lastSeenAt: string;
```

### 3. **Scores & Metrics**
Numeric scores with different ranges:
```typescript
oyeScore: number;         // 0-infinity (social engagement)
poolScore: number;        // 0-100 (relevance)
intentScore: number;      // 0-100 (preference)
completionRate: number;   // 0-100 (percentage)
```

### 4. **Optional vs Required**
Optional fields use `?` suffix:
```typescript
mood?: MoodType;          // Optional
title: string;            // Required
```

### 5. **Union Types**
Enums implemented as string literals:
```typescript
type ViewMode = 'card' | 'lyrics' | 'video' | 'feed';
type SubscriptionStatus = 'active' | 'trial' | 'overdue' | 'banned' | 'vip';
```

### 6. **Extends Pattern**
Type composition via extension:
```typescript
interface PooledTrack extends Track {
  // Additional pool-specific fields
}
```

### 7. **Record Pattern**
Key-value mappings:
```typescript
Record<VibeMode, number>           // Intent weights
Record<string, TrackPreference>    // Preference lookup
```

---

## Where Types Are Used

### Player Components
- `/src/components/AudioPlayer.tsx` - `PlayerState`, `Track`, `ViewMode`
- `/src/components/player/PlaybackControls.tsx` - `Track`, `RepeatMode`
- `/src/components/player/TunnelDrawer.tsx` - `MoodTunnel`, `MoodType`

### Store Files
- `/src/store/playerStore.ts` - `PlayerStore`, `QueueItem`, `HistoryItem`
- `/src/store/preferenceStore.ts` - `TrackPreference`, `ArtistPreference`
- `/src/store/universeStore.ts` - `UniverseData`, `PortalSession`, Auth state
- `/src/store/downloadStore.ts` - `DownloadProgress`, `CachedTrackInfo`
- `/src/store/trackPoolStore.ts` - `PooledTrack`
- `/src/store/intentStore.ts` - `ModeIntent`, `VibeMode`
- `/src/store/reactionStore.ts` - `Reaction`, `TrackStats`, `TrackHotspot`

### Service Files
- `/src/services/audioEngine.ts` - `BitrateLevel`, `BufferHealth`, `NetworkStats`
- `/src/services/api.ts` - `Track`, Album` (API responses)
- `/src/services/personalization.ts` - `Track`, `MoodType`, `TrackPreference`
- `/src/services/downloadManager.ts` - `DownloadProgress`, `CachedTrackInfo`

### Database/Supabase
- `/src/lib/supabase.ts` - `UniverseRow`, `UniverseState`, `PublicProfile`, `NowPlaying`

---

## Key Type Dependencies

```
Track
  ├─> QueueItem
  ├─> HistoryItem
  ├─> PooledTrack
  └─> TrackPreference

MoodType
  ├─> MoodTunnel
  ├─> Track.mood
  └─> MoodPreference

VibeMode
  ├─> ModeIntent
  ├─> PooledTrack.detectedMode
  └─> ReactionCategory (similar but different)

VOYOAccount
  ├─> SubscriptionStatus
  ├─> VOYOStory
  └─> NowPlaying

PlayerStore (master state)
  ├─> PlayerState (core)
  ├─> QueueItem[] (queue)
  ├─> HistoryItem[] (history)
  ├─> Reaction[] (reactions)
  ├─> BitrateLevel, BufferStatus (audio)
  └─> VoyoTab (superapp)

UniverseData (exportable)
  ├─> TrackPreference
  ├─> ArtistPreference
  ├─> TagPreference
  ├─> MoodPreference
  └─> Playlist[]
```

---

## Type Safety Guidelines

### 1. **Always use proper types for IDs**
```typescript
// Good
const trackId: string = track.trackId;

// Bad
const trackId = track.trackId as any;
```

### 2. **Handle nullable types**
```typescript
// Good
if (player.currentTrack) {
  console.log(player.currentTrack.title);
}

// Bad
console.log(player.currentTrack.title); // Error if null
```

### 3. **Use type guards for unions**
```typescript
// Good
if (playlist.type === 'CURATED') {
  // TypeScript knows type is 'CURATED'
}

// Bad
if (playlist.type) {
  // Type could be any value
}
```

### 4. **Leverage inference when possible**
```typescript
// Good (inferred)
const track = TRACKS.find(t => t.id === trackId);

// Unnecessary
const track: Track | undefined = TRACKS.find(t => t.id === trackId);
```

---

## Migration Notes

### Breaking Changes in v2.0
1. `Track.trackId` changed from optional to required
2. `PooledTrack` added new fields: `detectedMode`, `poolScore`
3. `VOYOAccount` replaced simplified `User` for authentication
4. `ReactionCategory` introduced (separate from `MoodType`)

### Deprecated Types
- `User` - Use `VOYOAccount` for full features
- Old `Playlist` without `type` field

---

## Future Type Extensions

### Planned Additions
1. `AIAnalysis` - LLM-generated insights
2. `CollaborativeSession` - Multi-user sessions
3. `CreatorAnalytics` - Artist dashboard metrics
4. `PaymentMethod` - Subscription payments

---

## Summary Statistics

- **Total Types**: 60+
- **Total Interfaces**: 45+
- **Total Enums/Unions**: 20+
- **Total Store Interfaces**: 10+
- **Lines of Type Definitions**: 1500+

---

**Document Version**: 1.0
**Last Updated**: 2025-12-19
**Maintainer**: VOYO Development Team
