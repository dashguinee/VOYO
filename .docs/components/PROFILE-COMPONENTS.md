# VOYO Music - Profile Components Documentation

**Last Updated**: 2025-12-19
**Component Directory**: `/home/dash/voyo-music/src/components/profile/`

---

## Overview

The profile component system provides public profile pages accessible via `voyomusic.com/username`. These pages show user profiles, live portals, and enable PIN-based authentication for full access.

---

## Component: ProfilePage

**File**: `/home/dash/voyo-music/src/components/profile/ProfilePage.tsx`

### Purpose
Public-facing profile page that serves as both a social profile and a live listening portal. Users can view public profiles, join live listening sessions, and authenticate via PIN to access their full universe.

---

### Props Interface

**Route Parameters** (from react-router):
```typescript
const { username } = useParams<{ username: string }>();
```

No direct props - component reads username from URL route parameter.

---

### Dependencies & Imports

**React & Routing**:
- `useState`, `useEffect`, `useRef` from React
- `useParams`, `useNavigate` from react-router-dom

**Animation**:
- `motion`, `AnimatePresence` from framer-motion

**Icons** (lucide-react):
- Navigation: `ArrowLeft`, `ExternalLink`
- Profile: `User`, `Edit3`, `Heart`, `Share2`, `Eye`
- Portal: `Radio`, `Play`, `Pause`, `Music2`, `Users`
- Auth: `Lock`, `Unlock`

**Store Integrations**:
- `useUniverseStore` - Auth, profile data, portal management
- `usePlayerStore` - Playback control for portal sync

**API Layer**:
- `universeAPI` - Public profile fetch and real-time updates
- Types: `PublicProfile`, `NowPlaying`

---

### State Management

#### Local UI State
```typescript
const [profile, setProfile] = useState<PublicProfile | null>(null);
const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
const [portalOpen, setPortalOpen] = useState(false);
const [showPinInput, setShowPinInput] = useState(false);
const [pin, setPin] = useState('');
const [pinError, setPinError] = useState('');
const [loadingProfile, setLoadingProfile] = useState(true);
```

#### Portal Sync State
```typescript
const [hasJoinedPortal, setHasJoinedPortal] = useState(false);
const lastTrackIdRef = useRef<string | null>(null);
```
**Purpose**: Track if viewer has joined portal and auto-sync playback when host changes tracks

---

### Store Subscriptions

**From useUniverseStore**:
- `isLoggedIn` - User authentication status
- `currentUsername` - Current user's username
- `login(username, pin)` - PIN-based authentication
- `viewUniverse(username)` - Subscribe to real-time portal updates
- `leaveUniverse()` - Unsubscribe from portal
- `viewingUniverse` - Real-time portal state (nowPlaying, portalOpen)
- `isViewingOther` - Boolean if viewing someone else's profile
- `isLoading`, `error` - Auth loading and error states

**From usePlayerStore**:
- `setCurrentTrack(track)` - Play track (for portal sync)
- `currentTrack` - Currently playing track
- `isPlaying` - Playback state

---

### Core Effects

#### Effect 1: Load Profile on Mount
```typescript
useEffect(() => {
  if (!username) return;

  const loadProfile = async () => {
    setLoadingProfile(true);
    const result = await universeAPI.getPublicProfile(username);

    if (result.profile) {
      setProfile(result.profile);
      setNowPlaying(result.nowPlaying);
      setPortalOpen(result.portalOpen);
    }

    setLoadingProfile(false);
  };

  loadProfile();

  // Subscribe to real-time updates if portal is open
  const setupRealtime = async () => {
    const result = await universeAPI.getPublicProfile(username);
    if (result.portalOpen) {
      await viewUniverse(username);
    }
  };
  setupRealtime();

  return () => {
    leaveUniverse();
  };
}, [username]);
```
**Purpose**: Fetch profile data and subscribe to portal if open

#### Effect 2: Auto-Sync Playback
```typescript
useEffect(() => {
  if (viewingUniverse) {
    setNowPlaying(viewingUniverse.nowPlaying);
    setPortalOpen(viewingUniverse.portalOpen);

    // AUTO-SYNC: If viewer has joined portal and track changes, auto-play new track
    if (hasJoinedPortal && viewingUniverse.nowPlaying) {
      const newTrackId = viewingUniverse.nowPlaying.trackId;
      if (lastTrackIdRef.current && lastTrackIdRef.current !== newTrackId) {
        // Track changed! Auto-sync to new track
        const track = {
          id: newTrackId,
          trackId: newTrackId,
          title: viewingUniverse.nowPlaying.title,
          artist: viewingUniverse.nowPlaying.artist,
          coverUrl: viewingUniverse.nowPlaying.thumbnail,
        };
        setCurrentTrack(track as any);
      }
      lastTrackIdRef.current = newTrackId;
    }
  }
}, [viewingUniverse, hasJoinedPortal, setCurrentTrack]);
```
**Purpose**: Update UI from real-time portal updates and auto-sync playback when track changes

---

### Event Handlers

#### handlePinLogin
```typescript
const handlePinLogin = async () => {
  if (!username || pin.length !== 6) return;

  setPinError('');
  const success = await login(username, pin);

  if (success) {
    setShowPinInput(false);
    setPin('');
    navigate('/'); // Redirect to main app since they're now logged in
  } else {
    setPinError('Invalid PIN');
  }
}
```
**Purpose**: Authenticate user with PIN and redirect to main app

#### handleJoinPortal
```typescript
const handleJoinPortal = async () => {
  if (!nowPlaying) return;

  // Create a track object from nowPlaying
  const track = {
    id: nowPlaying.trackId,
    trackId: nowPlaying.trackId,
    title: nowPlaying.title,
    artist: nowPlaying.artist,
    coverUrl: nowPlaying.thumbnail,
  };

  // Set as current track and play
  setCurrentTrack(track as any);

  // Mark as joined - enables auto-sync for future track changes
  setHasJoinedPortal(true);
  lastTrackIdRef.current = nowPlaying.trackId;
}
```
**Purpose**: Join portal by playing current track and enabling auto-sync

---

### Render Logic

#### Page Structure
```
ProfilePage Container
  ├─ Sticky Header
  │    ├─ Back button
  │    ├─ URL display (voyomusic.com/username)
  │    └─ Spacer
  ├─ Profile Content Section
  │    ├─ Avatar & Info
  │    │    ├─ Avatar (image or gradient with initial)
  │    │    ├─ Portal indicator (if open)
  │    │    ├─ Display name
  │    │    ├─ Username (@username)
  │    │    ├─ Bio (if exists)
  │    │    └─ Action buttons (Edit Profile OR Enter PIN + Share)
  │    ├─ Now Playing / Portal Card (if portal open)
  │    │    ├─ Live indicator
  │    │    ├─ Album art with visualizer
  │    │    ├─ Track info (title, artist)
  │    │    ├─ Progress bar
  │    │    └─ Join Portal button
  │    ├─ Portal Closed Card (if portal closed)
  │    ├─ Top Tracks Section (if available)
  │    └─ Open App CTA
  ├─ PIN Input Modal (AnimatePresence)
  └─ Footer (VOYO branding)
```

#### Loading State
- Centered spinner with purple gradient border
- Rotating animation (360deg loop)

#### Not Found State
- User icon
- "Universe not found" message
- "@username hasn't claimed their universe yet"
- Call-to-action to claim username
- "Open VOYO" button

---

### Conditional Rendering

#### Own Profile Check
```typescript
const isOwnProfile = currentUsername?.toLowerCase() === username?.toLowerCase();
```

**If true**:
- Show "Edit Profile" button (navigates to main app)

**If false**:
- Show "Enter PIN" button (opens PIN modal)
- Show "Share" button

#### Portal State
**If portal open AND nowPlaying exists**:
- Show live portal card with:
  - Green pulsing "Portal Open • Live" badge
  - Album art with blur background
  - Track info and progress bar
  - Audio visualizer (3 animated bars)
  - "Join Portal • Listen Along" button (or "Synced" if joined)

**If portal closed OR no nowPlaying**:
- Show "Portal is closed" card
- Music2 icon
- "Check back later to listen along!"

#### Top Tracks
**If profile.topTracks exists and has items**:
- Render up to 5 tracks
- Each shows: rank number, Music2 icon, track ID (placeholder), heart icon

---

### Styling

**Page Background**: `bg-[#0a0a0f]` (deep black)

**Header**:
- `bg-[#0a0a0f]/80 backdrop-blur-xl` - Translucent blur effect
- `border-b border-white/5` - Subtle separator
- Sticky positioning

**Avatar**:
- Image: `w-28 h-28 rounded-full ring-4 ring-purple-500/30`
- Fallback gradient: `from-purple-500 to-pink-500` with first letter

**Portal Indicator** (when open):
- Green circle with Radio icon
- Pulsing animation (scale and opacity)
- Positioned absolute on avatar

**Now Playing Card**:
- `bg-gradient-to-b from-white/[0.08] to-white/[0.02]` - Subtle gradient
- `border border-white/10`
- Album art blur background at 30% opacity
- Progress bar: Purple-pink gradient fill

**Join Button**:
- Default: `bg-gradient-to-r from-purple-500 to-pink-500`
- Joined: `bg-green-500/20 border border-green-500/30 text-green-400`
- Scale animation on hover/tap

**Top Tracks**:
- Each item: `bg-white/[0.02] hover:bg-white/[0.05]`
- Rank number: `text-white/30`

---

### Integration Points

#### With UniverseStore
1. **Auth Flow**: Login via PIN, redirect to main app
2. **Portal Subscription**: Subscribe/unsubscribe via viewUniverse/leaveUniverse
3. **Real-time Updates**: Receive portal state changes via viewingUniverse

#### With PlayerStore
1. **Portal Sync**: Set current track when joining or auto-syncing
2. **Playback Control**: Reflect playback state in UI

#### With UniverseAPI
1. **Profile Fetch**: `getPublicProfile(username)` - Get initial state
2. **Real-time**: Subscriptions via viewUniverse provide live updates

#### URL Routing
- Route: `/username` or `/:username`
- Navigate to `/` after PIN login
- Back button navigates to `/`

---

### Animation Details

**Loading Spinner**:
- Rotate 360deg continuously
- Linear easing, 1s duration, infinite repeat

**Portal Indicator**:
- Scale animation: `[1, 1.2, 1]`
- Opacity animation: `[1, 0.7, 1]`
- 2s duration, infinite repeat

**Audio Visualizer** (3 bars):
- Height animation: `[4, 12, 4]`
- 0.5s duration, infinite repeat
- Stagger: 0.1s delay per bar

**Page Entry**:
- Profile content slides up with fade
- Stagger between sections

---

### Portal Auto-Sync Mechanism

**Flow**:
1. User clicks "Join Portal • Listen Along"
2. `handleJoinPortal()` plays current track
3. `hasJoinedPortal` set to true
4. `lastTrackIdRef` stores current track ID
5. When `viewingUniverse` updates with new track:
   - Compare new track ID to `lastTrackIdRef`
   - If different, call `setCurrentTrack()` to auto-play
   - Update `lastTrackIdRef` to new track
6. User's playback stays in sync with host

**Key**: Uses ref to avoid stale closure issues in effect

---

### Helper Functions

#### formatTime
```typescript
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```
**Purpose**: Convert seconds to MM:SS format for progress display

---

### Security & Privacy

1. **PIN Validation**: 6-digit numeric only, client-side validation
2. **Public Data Only**: Profile page shows only public data
3. **Portal Opt-in**: User must explicitly open portal to broadcast
4. **No Email Required**: Username + PIN authentication model

---

### Performance Considerations

1. **Initial Load**: Single API call for profile + now playing
2. **Real-time Subscription**: Only if portal is open
3. **Cleanup**: Unsubscribe on unmount to prevent memory leaks
4. **Ref Usage**: `lastTrackIdRef` avoids re-renders

---

### Mobile Optimization

1. **Responsive Avatar**: 28 (7rem) size works on all screens
2. **Touch Targets**: Buttons are min 44px touch targets
3. **Sticky Header**: Always visible for navigation
4. **Scrollable Content**: Main content scrolls, header stays fixed

---

### Error Handling

1. **Profile Not Found**: Show "Universe not found" UI
2. **Invalid PIN**: Display error message below input
3. **Image Load Failure**: Fall back to gradient avatar
4. **API Failures**: Handled by store error state

---

### Future Enhancement Opportunities

1. **QR Code Sharing**: Generate QR for profile URL
2. **Follow System**: Follow/unfollow users
3. **Activity Feed**: Show recent listens
4. **Playlist Sharing**: Display public playlists
5. **Social Stats**: Followers, following counts
6. **Portal History**: Previous listening sessions
7. **Guest Chat**: Chat with portal host
8. **Video Sync**: Sync YouTube video playback

---

## Summary

The ProfilePage component creates a social music experience by combining public profiles with live listening portals. It enables seamless real-time synchronization between users, PIN-based authentication for privacy, and mobile-first responsive design. The auto-sync mechanism allows viewers to follow along with the host's listening session in real-time, creating a shared music experience.
