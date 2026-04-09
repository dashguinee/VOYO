# VOYO Music Architecture

## The Vision

**VOYO** is a new type of music discovery system that combines:
- **YOU** - Your personal taste, reactions, and listening history
- **CROWD** - Collective intelligence from all users (the flywheel)
- **DJ** - AI-powered discovery using Gemini (when needed)

Unlike algorithmic black boxes, VOYO is **transparent** - you see exactly why tracks appear and can directly control the mix through the MixBoard.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THE VOYO FLYWHEEL                                   │
│                                                                               │
│    ┌──────────┐         ┌──────────┐         ┌──────────┐                    │
│    │   YOU    │◄───────►│  CROWD   │◄───────►│    DJ    │                    │
│    │ (Local)  │         │ (Cloud)  │         │  (AI)    │                    │
│    └────┬─────┘         └────┬─────┘         └────┬─────┘                    │
│         │                    │                    │                          │
│         ▼                    ▼                    ▼                          │
│    Your taste          Everyone's          Gemini discovers                  │
│    Your queue          collective          new tracks when                   │
│    Your history        signals             DB is insufficient                │
│                                                                               │
│    Every action trains the crowd. Crowd trains the DJ. DJ feeds everyone.    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Principles

### 1. The Flywheel Effect
Every user action makes the system smarter for everyone:
- You add a track to "Afro Heat" → That track's afro-heat score increases
- You skip a track → Skip count goes up, heat score drops
- You love a track → Love count increases, track rises in HOT

**Zero-sum ends. Positive-sum begins.**

### 2. Local-First, Cloud-Enhanced
- **Local**: Your taste, queue, history, reactions (instant, private)
- **Cloud**: Collective heat, vibe training, verified tracks (shared intelligence)

### 3. Transparent Control
The MixBoard isn't a gimmick - it's the actual algorithm. Move a slider, change your feed.

### 4. Adaptive AI
Gemini only runs when needed:
- Pool starving? → DJ runs
- Enough collective data? → Skip AI, use crowd wisdom
- Every Gemini discovery → Saved to Central DB for future users

---

## The Three Pillars

### Pillar 1: YOU (Personal Intelligence)
**Location**: Local Storage + Zustand Stores

```typescript
// Your personal state
interface PersonalIntelligence {
  // Reactions (what you love/hate)
  lovedTracks: Set<string>;      // Tracks you explicitly loved
  skippedTracks: Set<string>;    // Tracks you skipped

  // Queue (your intent)
  queue: Track[];                // Your manual queue

  // History (your behavior)
  listenHistory: Track[];        // What you played
  searchHistory: string[];       // What you searched

  // Preferences (your settings)
  mixBoardSliders: VibeProfile;  // Your current vibe mix

  // Reactions per category
  categoryPulse: Record<string, { total: number, isHot: boolean }>;
}
```

**Stores**:
- `playerStore.ts` - Current track, queue, playback state
- `reactionStore.ts` - Loves, skips, category pulse
- `intentStore.ts` - Search intent, discovery intent
- `mixBoardStore.ts` - Vibe slider positions

### Pillar 2: CROWD (Collective Intelligence)
**Location**: Supabase Cloud Database

```sql
-- The gold mine: verified tracks with collective scores
voyo_tracks (
  voyo_id TEXT UNIQUE,         -- vyo_XXXXX

  -- Vibe scores (0-100) - trained by user actions
  vibe_afro_heat INTEGER,
  vibe_chill_vibes INTEGER,
  vibe_party_mode INTEGER,
  vibe_late_night INTEGER,
  vibe_workout INTEGER,

  -- Collective engagement
  play_count INTEGER,
  love_count INTEGER,
  skip_count INTEGER,
  complete_count INTEGER,

  -- Calculated metrics
  heat_score INTEGER,          -- Composite popularity
  skip_rate DECIMAL,           -- skip_count / play_count
  love_rate DECIMAL            -- love_count / play_count
)

-- Anonymous signals
voyo_signals (
  track_id TEXT,
  user_hash TEXT,              -- Anonymous identifier
  action TEXT,                 -- play, love, skip, complete, queue
  session_vibe TEXT            -- What mode was active
)
```

**The Heat Score Formula**:
```
heat_score = play_count * 1
           + love_count * 5
           + complete_count * 3
           + queue_count * 2
           - skip_count * 2
```

### Pillar 3: DJ (AI Discovery)
**Location**: Gemini Flash 2.0 via intelligentDJ.ts

The DJ is the scout - it goes out, finds new tracks, verifies they work, and adds them to the collective database.

```typescript
// DJ Decision Tree
async function runDJ(): Promise<number> {
  const dominantMode = getDominantMode();

  // STEP 1: Check Central DB first
  const centralTracks = await getTracksByMode(dominantMode, 20);

  if (centralTracks.length >= 10) {
    // Enough crowd data! Skip AI.
    return addToPool(centralTracks);
  }

  // STEP 2: Not enough - call Gemini
  const suggestions = await callGeminiDJ(buildPrompt());

  // STEP 3: Verify each suggestion works
  for (const suggestion of suggestions) {
    const verified = await verifyTrack(suggestion);
    if (verified) {
      // STEP 4: Save to Central DB for future users
      await saveVerifiedTrack(verified, dominantMode);
      addToPool(verified);
    }
  }
}
```

---

## MixBoard Modes

The MixBoard is the user's direct control over the algorithm. Each mode has a distinct personality:

| Mode ID | Display Name | Target Energy | Target Tempo | Vibe |
|---------|--------------|---------------|--------------|------|
| `afro-heat` | Afro Heat | 90 | High | Dance floor bangers, Amapiano, Naija |
| `chill-vibes` | Chill Vibes | 20 | Low | Smooth R&B, slow jams, mellow |
| `party-mode` | Party Mode | 95 | High | Turn up! Club bangers |
| `late-night` | Late Night | 30 | Medium | Moody, atmospheric, after dark |
| `workout` | Workout | 95 | High | High tempo, motivational |
| `random-mixer` | Random Mixer | 50 | Mixed | Surprise me |

**Mode Detection from Metadata**:
```typescript
function detectModes(title: string, artist: string): MixBoardMode[] {
  const lower = (title + ' ' + artist).toLowerCase();
  const modes: MixBoardMode[] = [];

  if (lower.includes('amapiano') || lower.includes('dance')) modes.push('afro-heat');
  if (lower.includes('chill') || lower.includes('slow')) modes.push('chill-vibes');
  if (lower.includes('party') || lower.includes('club')) modes.push('party-mode');
  if (lower.includes('night') || lower.includes('mood')) modes.push('late-night');
  if (lower.includes('workout') || lower.includes('energy')) modes.push('workout');

  return modes.length > 0 ? modes : ['afro-heat']; // Default
}
```

---

## Feed Algorithms

### HOT Algorithm
**What is HOT?** Tracks that are trending NOW, filtered by YOUR current MixBoard mode.

```
HOT = Collective Heat × Mode Match × Recency

Where:
- Collective Heat = heat_score from voyo_tracks
- Mode Match = track's vibe score for user's active mode
- Recency = prioritize tracks played in last 7 days
```

**SQL Query**:
```sql
SELECT * FROM voyo_tracks
WHERE verified = true
  AND skip_rate < 50
  AND vibe_afro_heat > 60  -- When user has afro-heat active
  AND last_played > NOW() - INTERVAL '7 days'
ORDER BY heat_score DESC
LIMIT 20;
```

### DISCOVERY Algorithm
**What is DISCOVERY?** High-intent tracks from user searches and DJ discoveries.

```
DISCOVERY = User Intent × Novelty × Quality

Where:
- User Intent = Tracks from user's search history (they actively looked for these)
- Novelty = Tracks not in their listen history
- Quality = skip_rate < 30%
```

**Sources**:
1. User's search results (highest intent)
2. Related to searched artists
3. DJ suggestions based on search patterns

### QUEUE Algorithm
**What is QUEUE?** User's explicit intent + smart auto-queue.

```
QUEUE = Explicit Queue + Auto-Queue

Where:
- Explicit Queue = User-added tracks (sacred, never modified)
- Auto-Queue = When queue is empty, blend from HOT + DISCOVERY
```

---

## Flywheel Training

### Signal Weights
| Action | Weight | When |
|--------|--------|------|
| Queue to Vibe | +5 | User adds track to specific MixBoard mode |
| Boost | +3 | User upvotes/boosts track |
| Reaction | +2 | User reacts (emoji, love) |
| Complete | +3 | Track plays >80% |
| Skip | -2 | Track skipped <30% |

### Training Flow
```
User adds "Calm Down" to "Chill Vibes"
         │
         ▼
┌─────────────────────────────────────┐
│  centralDJ.trainVibeOnQueue(       │
│    trackId: "vyo_xxx",             │
│    mode: "chill-vibes"             │
│  )                                 │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Supabase RPC: train_track_vibe    │
│  - vibe_chill_vibes += 5           │
│  - Add "chill-vibes" to vibe_tags  │
└─────────────────────────────────────┘
         │
         ▼
Next user searching "Chill Vibes"
gets "Calm Down" ranked higher!
```

---

## Adaptive DJ Timing

The DJ doesn't run on a fixed schedule - it responds to pool state:

```typescript
// DJ Trigger Conditions
const POOL_MIN_THRESHOLD = 20;     // Below this, DJ runs immediately
const POOL_HEALTHY_THRESHOLD = 50; // Above this, DJ can wait
const DJ_MIN_INTERVAL = 60000;     // Never more than 1x/minute
const DJ_STARVING_INTERVAL = 30000; // When starving, more aggressive

async function checkDJTrigger(): Promise<boolean> {
  const poolStats = poolStore.getPoolStats();
  const timeSinceLastRun = Date.now() - lastDJRun;

  // Starving pool - run ASAP
  if (poolStats.hot < POOL_MIN_THRESHOLD && timeSinceLastRun > DJ_STARVING_INTERVAL) {
    return true;
  }

  // Healthy pool - run occasionally
  if (poolStats.hot < POOL_HEALTHY_THRESHOLD && timeSinceLastRun > DJ_MIN_INTERVAL * 5) {
    return true;
  }

  // Pool is full - wait
  return false;
}
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER ACTIONS                                     │
│  Search → Play → React → Skip → Queue → Complete                             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOCAL STORES (Zustand)                              │
│                                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ playerStore │  │reactionStore│  │ intentStore │  │mixBoardStore│         │
│  │             │  │             │  │             │  │             │         │
│  │ • queue     │  │ • loves     │  │ • searches  │  │ • sliders   │         │
│  │ • current   │  │ • skips     │  │ • intent    │  │ • mode      │         │
│  │ • history   │  │ • pulse     │  │ • patterns  │  │ • intensity │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                │                 │
│         └────────────────┴────────────────┴────────────────┘                 │
│                                 │                                             │
└─────────────────────────────────┼─────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                          ▼
         ┌─────────────────┐        ┌─────────────────┐
         │   POOL CURATOR  │        │   CENTRAL DJ    │
         │  (poolCurator)  │        │   (centralDJ)   │
         │                 │        │                 │
         │ • Bootstrap     │        │ • getByMode()   │
         │ • Expand        │        │ • trainVibe()   │
         │ • Smart queries │        │ • saveTrack()   │
         └────────┬────────┘        └────────┬────────┘
                  │                          │
                  │    ┌─────────────────┐   │
                  │    │ INTELLIGENT DJ  │   │
                  │    │ (intelligentDJ) │   │
                  │    │                 │   │
                  └───►│ • Gemini calls  │◄──┘
                       │ • Verification  │
                       │ • Pool filling  │
                       └────────┬────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TRACK POOL STORE                                     │
│                           (trackPoolStore)                                    │
│                                                                               │
│  pool: Map<string, PooledTrack>                                              │
│  ├── hot: Track[]     ← Collective heat × Your mode                         │
│  ├── discovery: Track[] ← User searches + DJ discoveries                    │
│  ├── fresh: Track[]   ← New additions                                       │
│  └── archive: Track[] ← Played tracks                                       │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          UI COMPONENTS                                        │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    VoyoPortraitPlayer                                │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │                    VoyoVerticalFeed                            │  │    │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │  │    │
│  │  │  │   HOT    │  │DISCOVERY │  │  QUEUE   │                     │  │    │
│  │  │  │   Tab    │  │   Tab    │  │   Tab    │                     │  │    │
│  │  │  └──────────┘  └──────────┘  └──────────┘                     │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │                       MixBoard                                 │  │    │
│  │  │  [Afro Heat] [Chill] [Party] [Late Night] [Workout]           │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Layer

### Backend (Fly.io / Local)
```
Base URL: https://voyo-music-api.fly.dev (or localhost:3001)

GET /search?q=query&limit=10
  → Returns: SearchResult[]

GET /stream?v=voyoId
  → Returns: { url: string, expires: number }

GET /health
  → Returns: { status: "ok" }
```

### Supabase (Central DB)
```
URL: https://anmgyxhnyhbyxzpjhxgx.supabase.co

Tables:
- voyo_tracks (verified tracks + vibe scores)
- voyo_signals (anonymous engagement)
- voyo_vibes (MixBoard mode definitions)

RPC Functions:
- get_tracks_by_mode(mode, limit) → CentralTrack[]
- get_tracks_by_vibe(afro, chill, party, night, workout, limit) → CentralTrack[]
- train_track_vibe(track_id, mode, increment) → boolean
- get_hot_tracks(limit) → CentralTrack[]
```

---

## File Structure

```
voyo-music/
├── server/
│   └── index.js                 # yt-dlp backend wrapper
│
├── src/
│   ├── App.tsx                  # Main app entry
│   │
│   ├── components/
│   │   └── voyo/
│   │       ├── VoyoPortraitPlayer.tsx  # Main player (5400+ lines)
│   │       ├── VoyoVerticalFeed.tsx    # Swipeable feed
│   │       ├── MixBoard.tsx            # Vibe sliders
│   │       └── ReactionBar.tsx         # Love/skip/share
│   │
│   ├── services/
│   │   ├── api.ts               # Backend API calls
│   │   ├── centralDJ.ts         # Supabase collective intelligence
│   │   ├── intelligentDJ.ts     # Gemini AI discovery
│   │   ├── poolCurator.ts       # Pool management
│   │   └── supabase.ts          # Supabase client
│   │
│   ├── store/
│   │   ├── playerStore.ts       # Playback, queue, current track
│   │   ├── trackPoolStore.ts    # HOT/DISCOVERY/QUEUE pools
│   │   ├── reactionStore.ts     # Loves, skips, pulse
│   │   ├── intentStore.ts       # Search/discovery intent
│   │   └── mixBoardStore.ts     # Vibe slider state
│   │
│   ├── types/
│   │   └── index.ts             # Track, PooledTrack, etc.
│   │
│   └── utils/
│       ├── voyo.ts              # VOYO ID encode/decode
│       └── thumbnail.ts         # Thumbnail URL generation
│
├── supabase/
│   └── migrations/
│       └── 001_central_dj.sql   # Central DB schema
│
└── .env                         # Supabase + API keys
```

---

## Performance Optimizations

### 1. Tiered Loading
```
Initial Load:
├── Local stores (instant)
├── Pool from localStorage (instant)
└── Background: Central DB fetch (async)

First Play:
├── Pool already has tracks (no wait)
└── DJ runs in background to refill
```

### 2. Debounced Training
```typescript
// Don't send every signal immediately
const debouncedTrain = debounce((trackId, mode) => {
  centralDJ.trainVibe({ trackId, mode, action: 'queue', weight: 5 });
}, 1000);
```

### 3. Smart Prefetch
```typescript
// When pool drops below threshold, prefetch more
useEffect(() => {
  if (pool.hot.length < 10) {
    intelligentDJ.runDJ(); // Background fill
  }
}, [pool.hot.length]);
```

---

## Security

### Anonymous User Hashing
```typescript
// Generate stable anonymous ID per device
function getUserHash(): string {
  let hash = localStorage.getItem('voyo-user-hash');
  if (!hash) {
    hash = crypto.randomUUID();
    localStorage.setItem('voyo-user-hash', hash);
  }
  return hash;
}
```

### No Personal Data in Cloud
- Only track IDs and anonymous actions
- No email, no names, no real identity
- User can clear local data anytime

---

## Future Roadmap

### Phase 1: Foundation ✅
- [x] Central DB schema
- [x] Vibe training functions
- [x] Central DJ integration
- [x] Gemini fallback

### Phase 2: Intelligence
- [ ] Real-time heat updates
- [ ] Collaborative filtering
- [ ] "Users who liked X also liked Y"
- [ ] Time-of-day optimization

### Phase 3: Social
- [ ] Share vibes with friends
- [ ] Collaborative queues
- [ ] Live listening sessions

### Phase 4: Monetization
- [ ] Premium features (offline, HQ audio)
- [ ] Artist insights dashboard
- [ ] Promoted tracks (ethical)

---

## The Difference

| Traditional Algorithms | VOYO |
|------------------------|------|
| Black box | Transparent MixBoard |
| Platform decides | You control the mix |
| Engagement addiction | Discovery & enjoyment |
| Isolated users | Collective intelligence |
| Static recommendations | Learning flywheel |

**VOYO is the algorithm you can see, touch, and control.**

---

*Last Updated: December 2024*
*Architecture Version: 2.0 - Central DJ Edition*
