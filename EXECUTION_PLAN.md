# VOYO - Complete Execution Plan

## CONTEXT MANAGEMENT STRATEGY

### Rule 1: Each Agent Gets ONE Focused Task
- No agent works on more than 3 files at a time
- Each agent has a clear input → output contract
- Agents write findings to checkpoint files, not just memory

### Rule 2: Checkpoint Files for Handoffs
```
/home/dash/voyo-music/.checkpoints/
├── FEED_ALGORITHM.md       # Feed team outputs here
├── PWA_BACKGROUND.md       # PWA team outputs here
├── VIDEO_TREATMENT.md      # Video processing team outputs here
├── MEDIA_CONTROLS.md       # Controls team outputs here
└── INTEGRATION_NOTES.md    # Cross-team coordination
```

### Rule 3: Sequential Execution
- Don't run all teams in parallel
- Run one team → checkpoint → next team reads checkpoint
- This preserves context across the whole operation

---

## THE THREE CORE PROBLEMS

### PROBLEM 1: Feed Algorithm (How videos are treated)
**Current state**: Videos play randomly, no intelligence
**Goal**: Smart feed that knows HOW to play each video

### PROBLEM 2: PWA Background Playback
**Current state**: Music stops when app closes
**Goal**: Music continues in background like Spotify/Apple Music

### PROBLEM 3: Media Controls
**Current state**: Play/pause works, but skip/resume may not persist
**Goal**: Full media session API integration (lock screen, notifications)

---

## PROBLEM 1: INTELLIGENT FEED ALGORITHM

### Video Treatment Types (What LLM Should Decide)

| Treatment | Start Point | Duration | Use Case |
|-----------|-------------|----------|----------|
| `full_intro` | 0:00 | 30s | New releases, user discovery |
| `heat_drop` | AI-detected drop | 15-20s | Viral potential, high energy |
| `chorus_hook` | AI-detected chorus | 20s | Recognizable hits, singalongs |
| `bridge_moment` | AI-detected bridge | 15s | Emotional songs, ballads |
| `random_slice` | Random timestamp | 15s | Background/ambient content |

### How LLM Fits In

```
┌─────────────────────────────────────────────────────────────┐
│                    TRACK ENTERS POOL                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                 LLM ANALYSIS (One-time)                     │
│                                                             │
│  Input: { title, artist, duration, genre, bpm_estimate }    │
│                                                             │
│  Output: {                                                  │
│    treatment: 'heat_drop' | 'chorus_hook' | 'full_intro',   │
│    start_seconds: 45,                                       │
│    duration_seconds: 20,                                    │
│    energy_level: 'high' | 'medium' | 'chill',               │
│    skip_intro: true,                                        │
│    reason: "Amapiano track, drop at 0:45 is the hook"       │
│  }                                                          │
│                                                             │
│  Store in: track.feedMetadata (persist to Supabase)         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   FEED RENDERING                            │
│                                                             │
│  if (track.feedMetadata.treatment === 'heat_drop') {        │
│    startVideo(track.feedMetadata.start_seconds);            │
│    setDuration(track.feedMetadata.duration_seconds);        │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

### Feed Algorithm Logic

```typescript
// Feed sorting algorithm
function buildSmartFeed(tracks: Track[], userContext: UserContext) {
  return tracks
    .map(track => ({
      ...track,
      feedScore: calculateFeedScore(track, userContext)
    }))
    .sort((a, b) => b.feedScore - a.feedScore)
    .slice(0, 20); // Top 20 for feed
}

function calculateFeedScore(track: Track, ctx: UserContext) {
  let score = track.poolScore || 50;

  // Boost if matches current vibe
  if (track.detectedMode === ctx.currentMode) score += 30;

  // Boost if has good feed metadata
  if (track.feedMetadata?.treatment === 'heat_drop') score += 20;

  // Penalize if recently shown
  if (ctx.recentlyShown.includes(track.id)) score -= 50;

  // Boost if high engagement on platform
  if (track.engagement?.reactions > 10) score += 15;

  return score;
}
```

---

## PROBLEM 2: PWA BACKGROUND PLAYBACK

### Why It's Not Working

Current issue: When PWA loses focus, the audio context suspends.

### The Fix: Media Session API + Service Worker

```typescript
// In AudioPlayer.tsx or a new BackgroundAudio.ts

// 1. Register media session
if ('mediaSession' in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album || 'VOYO',
    artwork: [
      { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
    ]
  });

  // 2. Handle media controls
  navigator.mediaSession.setActionHandler('play', () => playerStore.play());
  navigator.mediaSession.setActionHandler('pause', () => playerStore.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => playerStore.prevTrack());
  navigator.mediaSession.setActionHandler('nexttrack', () => playerStore.nextTrack());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime) playerStore.seekTo(details.seekTime);
  });
}

// 3. Keep audio context alive
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Don't suspend audio context
    if (audioContext.state === 'running') {
      // Keep it running - don't call suspend()
    }
  }
});
```

### Service Worker for Background

```javascript
// In sw.js or service-worker.ts

// Keep the audio stream alive
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Audio requests get special handling
  if (url.pathname.includes('/audio') || url.hostname.includes('piped')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          // Cache audio for offline
          const clone = response.clone();
          caches.open('voyo-audio-v1').then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        });
      })
    );
  }
});
```

### manifest.json Requirements

```json
{
  "name": "VOYO",
  "short_name": "VOYO",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "start_url": "/",
  "scope": "/",
  "icons": [...],
  "categories": ["music", "entertainment"],
  "shortcuts": [
    {
      "name": "Now Playing",
      "url": "/?view=player",
      "icons": [...]
    }
  ]
}
```

---

## PROBLEM 3: MEDIA CONTROLS

### Full Implementation Checklist

| Control | Status | Fix Location |
|---------|--------|--------------|
| Play/Pause | Works | - |
| Skip Next | Check | playerStore.nextTrack() |
| Skip Previous | Check | playerStore.prevTrack() |
| Seek | Check | playerStore.seekTo() |
| Lock Screen Art | Missing | MediaSession metadata |
| Lock Screen Controls | Missing | MediaSession handlers |
| Notification Controls | Missing | MediaSession handlers |
| Background Resume | Broken | visibilitychange handler |

### Integration Points

```
AudioPlayer.tsx
├── useEffect for MediaSession registration
├── Update metadata on track change
└── Keep audioContext alive on visibility change

playerStore.ts
├── play() → mediaSession.playbackState = 'playing'
├── pause() → mediaSession.playbackState = 'paused'
├── nextTrack() → update metadata
└── prevTrack() → update metadata
```

---

## TEAM DEPLOYMENT (Context-Managed)

### PHASE 1: Research & Checkpoint (1 Agent)

**Agent: RESEARCHER**
```
Task: Analyze current audio/video handling in VOYO

Read these files and create checkpoint:
- /src/components/AudioPlayer.tsx
- /src/services/pipedService.ts
- /src/store/playerStore.ts
- /public/manifest.json
- /public/sw.js (if exists)

Output to: /.checkpoints/CURRENT_STATE.md
- How audio is currently fetched
- How video is separated from audio
- What MediaSession code exists
- What Service Worker does
```

### PHASE 2: Feed Algorithm (1-2 Agents)

**Agent: FEED_ARCHITECT**
```
Read: /.checkpoints/CURRENT_STATE.md

Task: Design the feed treatment system

Files to modify:
- /src/services/feedAlgorithm.ts (new)
- /src/types/index.ts (add FeedMetadata type)

Output to: /.checkpoints/FEED_ALGORITHM.md
```

**Agent: LLM_INTEGRATION**
```
Read: /.checkpoints/FEED_ALGORITHM.md

Task: Add LLM analysis for track treatment

Files to modify:
- /src/services/intelligentDJ.ts (add analyzeFeedTreatment)
- /src/services/feedAlgorithm.ts (integrate LLM output)

Output to: /.checkpoints/LLM_FEED.md
```

### PHASE 3: Background Playback (1 Agent)

**Agent: PWA_AUDIO**
```
Read: /.checkpoints/CURRENT_STATE.md

Task: Fix background playback

Files to modify:
- /src/components/AudioPlayer.tsx
- /public/sw.js
- /public/manifest.json

Test: Close app, music should continue
Output to: /.checkpoints/PWA_BACKGROUND.md
```

### PHASE 4: Media Controls (1 Agent)

**Agent: MEDIA_SESSION**
```
Read: /.checkpoints/PWA_BACKGROUND.md

Task: Full MediaSession API integration

Files to modify:
- /src/components/AudioPlayer.tsx
- /src/store/playerStore.ts

Test: Lock screen shows controls, skip works
Output to: /.checkpoints/MEDIA_CONTROLS.md
```

### PHASE 5: Integration (1 Agent)

**Agent: INTEGRATOR**
```
Read all checkpoints

Task: Verify everything works together

Test cases:
1. Feed shows videos with correct treatment
2. Tap video → audio plays
3. Close app → audio continues
4. Lock screen → controls work
5. Skip → next track plays with correct treatment

Output to: /.checkpoints/FINAL_REPORT.md
```

---

## EXECUTION COMMANDS

### Step 1: Create Checkpoint Directory
```bash
mkdir -p /home/dash/voyo-music/.checkpoints
```

### Step 2: Run Researcher Agent
```
Launch agent with RESEARCHER prompt above
Wait for /.checkpoints/CURRENT_STATE.md
```

### Step 3: Run Feed Agents (Sequential)
```
Launch FEED_ARCHITECT
Wait for checkpoint
Launch LLM_INTEGRATION
Wait for checkpoint
```

### Step 4: Run PWA Agent
```
Launch PWA_AUDIO
Wait for checkpoint
```

### Step 5: Run Media Session Agent
```
Launch MEDIA_SESSION
Wait for checkpoint
```

### Step 6: Run Integrator
```
Launch INTEGRATOR
Get FINAL_REPORT.md
```

---

## SUCCESS CRITERIA

1. **Feed**: Each video plays from intelligent start point
2. **Background**: Music continues when app minimized
3. **Controls**: Lock screen shows play/pause/skip
4. **Resume**: Returning to app shows correct state
5. **Skip**: Next/prev work from everywhere

---

## READY TO EXECUTE

Say "start phase 1" and I will:
1. Create checkpoint directory
2. Launch researcher agent
3. Wait for checkpoint
4. Proceed to next phase
