# VOYO Preference Engine - Build Prompt

## Context
VOYO Music is a music streaming app at `/home/dash/voyo-music`. It currently has:
- Working audio playback via yt-dlp backend
- Seed tracks in `src/data/tracks.ts`
- Player store in `src/store/playerStore.ts` (Zustand)
- Track type in `src/types/index.ts`

## Your Mission
Build a **localStorage-first preference engine** that makes HOT and DISCOVERY personalized without requiring an account.

## What to Build

### 1. Preference Store (`src/store/preferenceStore.ts`)
Create a Zustand store with localStorage persistence that tracks:

```typescript
interface PreferenceState {
  // Listen History (last 100 tracks)
  listenHistory: ListenEvent[];

  // Engagement Signals
  reactions: ReactionEvent[];      // OYO/OYÉÉ clicks
  skips: SkipEvent[];              // Tracks skipped < 30 seconds
  completions: string[];           // Tracks played > 80%

  // Derived Preferences (computed)
  favoriteArtists: string[];       // Top 5 by play count
  favoriteMoods: string[];         // Top 3 moods
  favoriteTags: string[];          // Top 5 tags

  // Session Patterns
  sessionTimes: SessionTime[];     // When they listen

  // Actions
  recordListen: (track: Track, duration: number) => void;
  recordReaction: (trackId: string, type: string) => void;
  recordSkip: (trackId: string, playedSeconds: number) => void;
  computePreferences: () => void;
  getPersonalizedScore: (track: Track) => number;
}

interface ListenEvent {
  trackId: string;
  artist: string;
  mood: string;
  tags: string[];
  timestamp: number;
  duration: number;      // How long they listened
  totalDuration: number; // Track's full length
}

interface ReactionEvent {
  trackId: string;
  type: 'oyo' | 'oye' | 'fire' | 'wazzguan';
  timestamp: number;
}

interface SkipEvent {
  trackId: string;
  playedSeconds: number;
  timestamp: number;
}

interface SessionTime {
  hour: number;  // 0-23
  mood: string;  // What mood they played at this hour
}
```

### 2. Personalization Algorithm (`src/services/personalization.ts`)

```typescript
// Score a track based on user preferences (0-100)
function getPersonalizedScore(track: Track, prefs: PreferenceState): number {
  let score = 0;

  // +40: Favorite artist match
  if (prefs.favoriteArtists.includes(track.artist)) score += 40;

  // +25: Mood match
  if (prefs.favoriteMoods.includes(track.mood)) score += 25;

  // +5 per matching tag (max 20)
  const tagMatches = track.tags.filter(t => prefs.favoriteTags.includes(t));
  score += Math.min(tagMatches.length * 5, 20);

  // +15: Time-appropriate mood
  const hour = new Date().getHours();
  const hourMood = getTypicalMoodForHour(hour, prefs.sessionTimes);
  if (track.mood === hourMood) score += 15;

  // -30: Recently skipped artist
  const recentSkips = prefs.skips.filter(s => s.timestamp > Date.now() - 86400000);
  // ... check if this artist was skipped

  // +10: High OYE score (popular)
  if (track.oyeScore > 100000000) score += 10;

  return Math.min(score, 100);
}

// Get personalized HOT tracks
function getPersonalizedHot(allTracks: Track[], prefs: PreferenceState): Track[] {
  return allTracks
    .map(t => ({ track: t, score: getPersonalizedScore(t, prefs) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.track);
}

// Get personalized DISCOVERY (new stuff matching taste)
function getPersonalizedDiscovery(
  allTracks: Track[],
  prefs: PreferenceState,
  excludeIds: string[]
): Track[] {
  // Filter out already-played tracks
  const unplayed = allTracks.filter(t => !excludeIds.includes(t.id));

  // Score and sort
  return unplayed
    .map(t => ({ track: t, score: getPersonalizedScore(t, prefs) }))
    .filter(x => x.score > 20) // Must have some relevance
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.track);
}
```

### 3. Integration Points

**In playerStore.ts:**
- When track plays > 80%, call `preferenceStore.recordListen()`
- When track skipped < 30s, call `preferenceStore.recordSkip()`
- Update `hotTracks` and `discoverTracks` to use personalization

**In AudioPlayer.tsx:**
- Track playback duration
- Detect skip vs completion

**In ReactionBar (wherever reactions are):**
- Call `preferenceStore.recordReaction()` on click

### 4. Data Thresholds

```typescript
const THRESHOLDS = {
  MIN_LISTENS_FOR_PERSONALIZATION: 5,  // Need 5 listens before personalizing
  COMPLETION_THRESHOLD: 0.8,            // 80% = completed
  SKIP_THRESHOLD: 30,                   // < 30 seconds = skip
  HISTORY_LIMIT: 100,                   // Keep last 100 listens
  PREFERENCE_REFRESH_INTERVAL: 10,      // Recompute every 10 listens
};
```

### 5. Cold Start (New User)

When `listenHistory.length < MIN_LISTENS_FOR_PERSONALIZATION`:
- HOT = Most popular by oyeScore (current behavior)
- DISCOVERY = Random selection with genre diversity
- Show subtle prompt: "Play more to personalize your feed"

## File Structure
```
src/
├── store/
│   ├── playerStore.ts      (MODIFY - integrate preferences)
│   └── preferenceStore.ts  (CREATE)
├── services/
│   └── personalization.ts  (CREATE)
└── hooks/
    └── usePreferences.ts   (CREATE - optional helper hook)
```

## Important Notes
- Use Zustand's `persist` middleware for localStorage
- Keep it lightweight - preferences should load instantly
- Don't break existing functionality
- Test with the existing seed tracks
- Add console logs for debugging: `[Prefs]` prefix

## Verification
After building, verify:
1. Listen to a track fully → appears in listenHistory
2. Skip a track → appears in skips
3. After 5 listens → HOT/DISCOVERY change based on patterns
4. Refresh page → preferences persist
5. Clear localStorage → cold start behavior

## DO NOT
- Create any UI components (we'll add those later)
- Add account/auth features
- Break existing playback
- Over-engineer - keep it simple and working
