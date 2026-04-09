# VOYO Music - Playlist Components Documentation

**Last Updated**: 2025-12-19
**Component Directory**: `/home/dash/voyo-music/src/components/playlist/`

---

## Overview

The playlist component system provides a modal interface for managing user playlists. It allows users to add tracks to existing playlists or create new ones on the fly.

---

## Component: PlaylistModal

**File**: `/home/dash/voyo-music/src/components/playlist/PlaylistModal.tsx`

### Purpose
Modal overlay for adding tracks to playlists or creating new playlists. Supports cloud sync when user is logged in.

---

### Props Interface

```typescript
interface PlaylistModalProps {
  isOpen: boolean;           // Control modal visibility
  onClose: () => void;       // Close callback
  trackId: string;           // Track ID to add
  trackTitle?: string;       // Optional track title for display
}
```

---

### Dependencies & Imports

**React & Animation**:
- `useState` from React
- `motion`, `AnimatePresence` from framer-motion

**Icons**:
- `X` - Close button
- `Plus` - Create new playlist
- `Check` - Track in playlist indicator
- `Music2` - Empty state and playlist icons
- `Globe` - Public playlist indicator
- `Lock` - Private playlist indicator

**Store Integrations**:
- `usePlaylistStore` - Playlist CRUD operations and cloud sync
- `useUniverseStore` - User auth state for cloud sync

---

### State Management

```typescript
// Local UI state
const [showCreate, setShowCreate] = useState(false);  // Toggle create playlist form
const [newName, setNewName] = useState('');          // New playlist name input
```

---

### Store Subscriptions

**From usePlaylistStore**:
- `playlists` - Array of all playlists
- `createPlaylist(name)` - Create new playlist
- `addTrackToPlaylist(playlistId, trackId)` - Add track to playlist
- `removeTrackFromPlaylist(playlistId, trackId)` - Remove track from playlist
- `syncToCloud(username)` - Sync playlists to cloud

**From useUniverseStore**:
- `isLoggedIn` - User authentication status
- `currentUsername` - Current user's username for cloud sync

---

### Event Handlers

#### handleToggleTrack
```typescript
const handleToggleTrack = async (playlist: Playlist) => {
  const isInPlaylist = playlist.trackIds.includes(trackId);

  if (isInPlaylist) {
    removeTrackFromPlaylist(playlist.id, trackId);
  } else {
    addTrackToPlaylist(playlist.id, trackId);
  }

  // Sync to cloud if logged in
  if (isLoggedIn && currentUsername) {
    setTimeout(() => syncToCloud(currentUsername), 500);
  }
}
```
**Purpose**: Toggle track in/out of playlist and sync to cloud after 500ms delay

#### handleCreate
```typescript
const handleCreate = async () => {
  if (!newName.trim()) return;

  const playlist = createPlaylist(newName.trim());
  addTrackToPlaylist(playlist.id, trackId);

  // Sync to cloud if logged in
  if (isLoggedIn && currentUsername) {
    setTimeout(() => syncToCloud(currentUsername), 500);
  }

  setNewName('');
  setShowCreate(false);
}
```
**Purpose**: Create new playlist, add track to it, sync to cloud, and reset form

---

### Render Logic

#### Modal Structure
```
AnimatePresence (conditional on isOpen)
  └─ motion.div (backdrop overlay)
       └─ motion.div (modal container)
            ├─ Header section
            │    ├─ Title + track name
            │    └─ Close button
            ├─ Content section (scrollable)
            │    ├─ Create new button / form
            │    └─ Playlist list
            └─ (no footer)
```

#### Create New Playlist Section
**Default state** (showCreate = false):
- Purple gradient button with "Create New Playlist" text
- Plus icon in circle

**Active state** (showCreate = true):
- Input field for playlist name
- Cancel and Create buttons
- Enter key triggers creation
- Create button disabled if name is empty

#### Playlist List
**Empty state** (no playlists):
- Music2 icon
- "No playlists yet" message
- "Create one above!" prompt

**With playlists**:
- Each playlist shows:
  - Checkbox icon (checked if track is in playlist)
  - Playlist name (truncated)
  - Track count
  - Public/Private indicator (Globe/Lock icon)
- Clicking toggles track in/out of playlist
- Selected playlists have purple background

---

### Styling

**Modal Container**:
- `bg-gradient-to-b from-[#1a1a2e] to-[#0a0a0f]` - Dark gradient background
- `rounded-t-3xl sm:rounded-3xl` - Rounded top on mobile, all sides on desktop
- `border border-white/10` - Subtle border

**Header**:
- `border-b border-white/10` - Bottom border separator
- Close button: `bg-white/5 hover:bg-white/10` - Translucent with hover effect

**Create Button**:
- `bg-gradient-to-r from-purple-500/20 to-pink-500/20` - Purple-pink gradient
- `border border-purple-500/30` - Purple border
- Hover increases border opacity to 50%

**Playlist Items**:
- Selected: `bg-purple-500/20 border border-purple-500/30`
- Unselected: `bg-white/5 border border-white/10 hover:bg-white/10`
- Checkbox icon changes from white/10 to purple-500 when selected

**Content Area**:
- `max-h-[60vh] overflow-y-auto` - Scrollable with max height

---

### Integration Points

#### With PlaylistStore
1. **Read**: `playlists` array for display
2. **Create**: `createPlaylist()` for new playlists
3. **Update**: `addTrackToPlaylist()` and `removeTrackFromPlaylist()` for track management
4. **Sync**: `syncToCloud()` after mutations

#### With UniverseStore
1. **Auth Check**: `isLoggedIn` to determine if cloud sync should happen
2. **User Identity**: `currentUsername` for sync target

#### Parent Component Integration
**Usage pattern**:
```typescript
const [showPlaylistModal, setShowPlaylistModal] = useState(false);

<PlaylistModal
  isOpen={showPlaylistModal}
  onClose={() => setShowPlaylistModal(false)}
  trackId={currentTrack.trackId}
  trackTitle={currentTrack.title}
/>
```

---

### Animation Details

**Modal Entry/Exit**:
- Backdrop: Fade in/out
- Modal: Slide up from bottom + fade (mobile-first)
- Initial: `y: 100, opacity: 0`
- Animate: `y: 0, opacity: 1`
- Exit: `y: 100, opacity: 0`

**Stagger Animation**: None (modal is single element)

---

### Key Features

1. **Inline Playlist Creation**: Create playlists without leaving the modal
2. **Toggle Track Membership**: Single click to add/remove from playlist
3. **Cloud Sync**: Automatic sync to Supabase when logged in
4. **Visual Feedback**: Check icons and color changes show playlist membership
5. **Privacy Indicators**: Globe/Lock icons show public/private status
6. **Mobile Optimized**: Bottom sheet on mobile, centered modal on desktop

---

### Performance Considerations

1. **Debounced Cloud Sync**: 500ms delay prevents excessive API calls
2. **Local State First**: Updates Zustand store immediately, then syncs
3. **Conditional Sync**: Only syncs if user is logged in
4. **Efficient Rendering**: Map over playlists array, key by playlist.id

---

### Error Handling

1. **Empty Name Validation**: Create button disabled if name is empty
2. **Trim Whitespace**: Name is trimmed before creation
3. **Missing Track Title**: Falls back to not showing track name in header

---

### Cloud Sync Flow

```
User Action (add/remove/create)
  ↓
Update Local Zustand Store (instant UI update)
  ↓
Check if logged in
  ↓ (yes)
Wait 500ms
  ↓
syncToCloud(username)
  ↓
Supabase API call to save playlists
```

---

### Future Enhancement Opportunities

1. **Drag to Reorder**: Allow dragging tracks within playlists
2. **Batch Operations**: Add multiple tracks at once
3. **Playlist Cover Art**: Display playlist thumbnail
4. **Sharing**: Share playlist URLs
5. **Collaborative Playlists**: Multi-user editing
6. **Playlist Metadata**: Description, tags, mood

---

## Summary

The PlaylistModal component provides a clean, mobile-first interface for playlist management with instant local updates and cloud sync. It integrates seamlessly with the Zustand store architecture and supports both anonymous (local-only) and authenticated (cloud-synced) workflows.
