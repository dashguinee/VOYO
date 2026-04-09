# Z2 MISSION: Build Spotify-Style Home Feed with Shelves

## WHO YOU ARE
You are Z2, a UI architect on the VOYO Music team. You understand that the Home Feed is where users DISCOVER music when they're not sure what to play. It needs to feel like Spotify - organized, personalized, and inviting. You're building the browsing experience that makes users WANT to explore.

## THE VISION (WHY)
Current Home Feed is basic - just an artist grid. We need SHELVES like Spotify:
- Horizontal scrollable rows of content
- Each shelf serves a purpose (recent, heavy rotation, new releases, moods)
- Cards that play music or expand into playlists
- Music continues playing while browsing (background playback)

The goal: User opens Home, sees personalized shelves, taps a card, music adds to their HOT queue. They're discovering without leaving their vibe.

## THE SPOTIFY MODEL (Reference)

```
┌─────────────────────────────────────────────────┐
│ Good evening, Dash                              │
├─────────────────────────────────────────────────┤
│ Continue Listening ────────────────── See all → │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │ Art  │ │ Art  │ │ Art  │ │ Art  │  ← scroll  │
│ │ Name │ │ Name │ │ Name │ │ Name │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
├─────────────────────────────────────────────────┤
│ Your Heavy Rotation ───────────────── See all → │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │      │ │      │ │      │ │      │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
├─────────────────────────────────────────────────┤
│ Made For You ──────────────────────── See all → │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │Mix 1 │ │Mix 2 │ │Chill │ │Hype  │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
├─────────────────────────────────────────────────┤
│ Browse by Mood ────────────────────── See all → │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │HYPE  │ │CHILL │ │FEELS │ │AFRO  │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
└─────────────────────────────────────────────────┘
```

## THE CODEBASE CONTEXT

### Files You'll Work With:

1. **`src/components/classic/HomeFeed.tsx`** - REBUILD THIS
   - Currently shows basic artist grid
   - Needs to become shelf-based layout

2. **`src/components/classic/ClassicMode.tsx`** - Container
   - Manages tabs: Home, Library, Profile
   - Has MiniPlayer for background playback
   - You'll integrate your new HomeFeed here

3. **`src/services/personalization.ts`** - Data source
   - `getUserTopTracks(limit)` - For "Heavy Rotation" shelf
   - `getPersonalizedHotTracks(limit)` - For "Made For You"
   - Already built, just import and use

4. **`src/store/playerStore.ts`** - Playback control
   - `addToQueue(track)` - Add to play queue
   - `setCurrentTrack(track)` - Play immediately
   - `queue` and `history` for recent/continue listening

5. **`src/store/preferenceStore.ts`** - User data
   - `getTopArtists()` - User's favorite artists
   - `getTopMoods()` - User's preferred moods

6. **`src/data/tracks.ts`** - Track data
   - `TRACKS` - All available tracks
   - `MOOD_TUNNELS` - Mood definitions with colors/gradients
   - Filter functions: `getTracksByTags`, `getTracksByArtist`

## THE TASK (WHAT)

### Step 1: Create Shelf Component
Build a reusable `<Shelf>` component:

```typescript
interface ShelfProps {
  title: string;
  onSeeAll?: () => void;
  children: React.ReactNode;
}

const Shelf = ({ title, onSeeAll, children }: ShelfProps) => (
  <div className="mb-6">
    <div className="flex justify-between items-center px-4 mb-3">
      <h2 className="text-white font-bold text-lg">{title}</h2>
      {onSeeAll && (
        <button className="text-purple-400 text-sm">See all</button>
      )}
    </div>
    <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide">
      {children}
    </div>
  </div>
);
```

### Step 2: Create Card Components
Different card types for different content:

```typescript
// Track Card - for individual songs
const TrackCard = ({ track, onPlay }: { track: Track; onPlay: () => void }) => (
  <motion.button
    className="flex-shrink-0 w-32"
    onClick={onPlay}
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
  >
    <div className="w-32 h-32 rounded-xl overflow-hidden mb-2">
      <img src={getThumbnailUrl(track.trackId)} className="w-full h-full object-cover" />
    </div>
    <p className="text-white text-sm font-medium truncate">{track.title}</p>
    <p className="text-white/50 text-xs truncate">{track.artist}</p>
  </motion.button>
);

// Mood Card - for mood tunnels
const MoodCard = ({ mood, onSelect }: { mood: MoodTunnel; onSelect: () => void }) => (
  <motion.button
    className={`flex-shrink-0 w-28 h-28 rounded-2xl bg-gradient-to-br ${mood.gradient} flex flex-col items-center justify-center`}
    onClick={onSelect}
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
  >
    <span className="text-3xl mb-1">{mood.icon}</span>
    <span className="text-white font-bold text-sm">{mood.name}</span>
  </motion.button>
);

// Mix Card - for generated playlists
const MixCard = ({ title, tracks, gradient }: { title: string; tracks: Track[]; gradient: string }) => (
  // Similar to MoodCard but with track count
);
```

### Step 3: Build the Shelves

```typescript
export const HomeFeed = ({ onTrackPlay, onSearch }: HomeFeedProps) => {
  const { queue, history } = usePlayerStore();
  const { trackPreferences } = usePreferenceStore();

  // Data for shelves
  const recentlyPlayed = history.slice(0, 10).map(h => /* get track */);
  const heavyRotation = getUserTopTracks(10);
  const madeForYou = getPersonalizedHotTracks(10);
  const moods = MOOD_TUNNELS;

  // Time-based greeting
  const greeting = getGreeting(); // "Good morning" / "Good afternoon" / "Good evening"

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-32">
      {/* Header */}
      <Header greeting={greeting} onSearch={onSearch} />

      {/* Continue Listening (if has history) */}
      {recentlyPlayed.length > 0 && (
        <Shelf title="Continue Listening">
          {recentlyPlayed.map(track => (
            <TrackCard key={track.id} track={track} onPlay={() => onTrackPlay(track)} />
          ))}
        </Shelf>
      )}

      {/* Heavy Rotation (if has preferences) */}
      {heavyRotation.length > 0 && (
        <Shelf title="Your Heavy Rotation">
          {heavyRotation.map(track => (
            <TrackCard key={track.id} track={track} onPlay={() => onTrackPlay(track)} />
          ))}
        </Shelf>
      )}

      {/* Made For You */}
      <Shelf title="Made For You">
        {madeForYou.map(track => (
          <TrackCard key={track.id} track={track} onPlay={() => onTrackPlay(track)} />
        ))}
      </Shelf>

      {/* Browse by Mood */}
      <Shelf title="Browse by Mood">
        {moods.map(mood => (
          <MoodCard key={mood.id} mood={mood} onSelect={() => handleMoodSelect(mood)} />
        ))}
      </Shelf>

      {/* New Releases (tracks sorted by createdAt) */}
      <Shelf title="New Releases">
        {getNewReleases(10).map(track => (
          <TrackCard key={track.id} track={track} onPlay={() => onTrackPlay(track)} />
        ))}
      </Shelf>
    </div>
  );
};
```

### Step 4: Wire to ClassicMode
Make sure the HomeFeed receives proper callbacks and integrates with the MiniPlayer.

### Step 5: Add Empty States
When user is new (no history, no preferences), show:
- "Start listening to build your collection"
- Popular tracks / trending
- Mood tunnels as entry point

## HOW TO VERIFY (SELF-ASSESSMENT)

1. **New user experience**: Opens app, sees Made For You, Browse by Mood, New Releases
2. **Returning user**: Sees Continue Listening, Heavy Rotation with their actual plays
3. **Scroll behavior**: Each shelf scrolls horizontally independently
4. **Tap behavior**: Tapping a card plays the track, MiniPlayer appears
5. **Background playback**: Can browse while music plays
6. **Visual polish**: Cards have hover effects, smooth animations

## TECHNICAL CONSTRAINTS

- Use existing Tailwind classes (check what's already used in codebase)
- Use Framer Motion for animations (already installed)
- Use Lucide icons (already installed)
- Maintain mobile-first responsive design
- Keep components in HomeFeed.tsx or create a new file in same folder

## DESIGN GUIDELINES

- Background: `bg-[#0a0a0f]` (VOYO dark)
- Cards: Rounded corners `rounded-xl` or `rounded-2xl`
- Text: White for titles, `white/50` or `white/70` for subtitles
- Accents: Purple gradient `from-purple-500 to-pink-500`
- Spacing: `gap-3` between cards, `mb-6` between shelves
- Touch targets: Minimum 44px for mobile

## OUTPUT REQUIREMENTS

1. Complete `HomeFeed.tsx` rewrite with shelf system
2. Any helper components you create
3. Summary of data flow (where each shelf gets its data)
4. Test scenarios for new vs returning user
5. Screenshots or descriptions of the expected result

## GO TIME

You're building the front door to VOYO Music. When users open the app, they should immediately feel like it knows them. The shelves should invite exploration while the MiniPlayer keeps the music flowing.

Make it feel like home.
