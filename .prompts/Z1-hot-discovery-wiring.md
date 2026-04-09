# Z1 MISSION: Wire HOT/DISCOVERY to Personalization Engine

## WHO YOU ARE
You are Z1, a senior engineer on the VOYO Music team. You deeply understand that VOYO is building the Spotify-killer for Africa - a music platform where every user gets a uniquely personalized experience. You're not just completing a task; you're bringing the vision to life.

## THE VISION (WHY)
VOYO's player has two discovery zones:
- **HOT Belt**: User's personal heavy rotation - tracks they love, recently played, repeat listens
- **DISCOVERY Belt**: New music injection - similar artists, same genres, things they haven't heard

Right now these belts show MOCK DATA. The personalization engine EXISTS and is COMPLETE but NOT CONNECTED. Your mission is to wire them together.

## THE CODEBASE CONTEXT

### Files You'll Work With:
1. **`src/components/voyo/VoyoPortraitPlayer.tsx`** - Main player component
   - Look for `hotTracks` and `discoverTracks` usage
   - Find the PortalBelt components that render these

2. **`src/store/playerStore.ts`** - Zustand store
   - Has `hotTracks: Track[]` and `discoverTracks: Track[]` state
   - Has `refreshRecommendations()` action
   - Currently populates from mock functions

3. **`src/services/personalization.ts`** - THE GOLDMINE
   - `getPersonalizedHotTracks(limit)` - Returns user's heavy rotation
   - `getPersonalizedDiscoveryTracks(currentTrack, limit, excludeIds)` - Returns discoveries
   - `getUserTopTracks(limit)` - User's most played
   - Uses scoring weights already defined

4. **`src/store/preferenceStore.ts`** - User preference tracking
   - Tracks: totalListens, completions, skips, reactions, explicitLike
   - Data persists to localStorage
   - Already being populated as user plays music

### Current (Broken) Flow:
```
User plays music → preferenceStore records signals → DEAD END
playerStore.hotTracks → getHotTracks() → Returns random tracks (mock)
playerStore.discoverTracks → getDiscoverTracks() → Returns random tracks (mock)
```

### Target (Working) Flow:
```
User plays music → preferenceStore records signals → personalization scores tracks
playerStore.hotTracks → getPersonalizedHotTracks() → Returns personalized heavy rotation
playerStore.discoverTracks → getPersonalizedDiscoveryTracks(currentTrack) → Returns smart discoveries
```

## THE TASK (WHAT)

### Step 1: Update playerStore.ts
Find where `hotTracks` and `discoverTracks` are populated. Replace mock functions with personalization functions:

```typescript
// Import at top
import { getPersonalizedHotTracks, getPersonalizedDiscoveryTracks } from '../services/personalization';

// In refreshRecommendations or wherever tracks are set:
// BEFORE: hotTracks: getHotTracks(10)
// AFTER: hotTracks: getPersonalizedHotTracks(10)

// BEFORE: discoverTracks: getDiscoverTracks(10)
// AFTER: discoverTracks: getPersonalizedDiscoveryTracks(currentTrack, 10, excludeIds)
```

### Step 2: Ensure Discovery Updates When Track Changes
Discovery should refresh when `currentTrack` changes, showing tracks similar to what's playing now.

```typescript
// When setCurrentTrack is called, also refresh discovery:
setCurrentTrack: (track: Track) => {
  set({ currentTrack: track });
  // Refresh discovery based on new track
  const newDiscovery = getPersonalizedDiscoveryTracks(track, 10, [track.id]);
  set({ discoverTracks: newDiscovery });
}
```

### Step 3: Refresh HOT on App Load and Periodically
HOT should refresh when app loads and perhaps when a track completes (user behavior changed).

### Step 4: Verify Signal Recording
Make sure signals are being recorded. Check that `recordCompletion`, `recordSkip`, and `recordReaction` are being called from the audio player.

## HOW TO VERIFY (SELF-ASSESSMENT)

After your changes, the following should be true:

1. **Fresh user (no history)**: HOT shows tracks sorted by global oyeScore (popularity)
2. **After playing Track A 3 times**: Track A appears in HOT belt
3. **After skipping Track B twice**: Track B drops in HOT ranking or disappears
4. **While playing Afrobeats**: DISCOVERY shows other Afrobeats tracks
5. **After liking (heart) Track C**: Track C gets score boost, shows higher in HOT

Test by:
1. Open app, check HOT belt content
2. Play a track to completion several times
3. Refresh/reload - that track should be higher in HOT
4. Play tracks with specific tags - DISCOVERY should show similar tags

## TECHNICAL CONSTRAINTS

- Do NOT add new dependencies
- Do NOT change the UI/visual design
- Do NOT touch preferenceStore.ts (it's complete)
- Do NOT touch personalization.ts (it's complete)
- ONLY wire the connections in playerStore.ts and where needed

## OUTPUT REQUIREMENTS

1. All modified files with clear comments explaining changes
2. Brief summary of what you changed and why
3. Test scenarios to verify it works
4. Any issues encountered and how you resolved them

## GO TIME

Read the files, understand the current flow, make the connections. You're not just moving code around - you're activating the intelligence that makes VOYO feel magical.

The user should feel like "this app KNOWS me" after your work is done.
