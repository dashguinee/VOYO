# Player Components Documentation

Complete documentation of all player-related components in `/src/components/player/`.

---

## 1. PlaybackControls.tsx

**File Path:** `/src/components/player/PlaybackControls.tsx`

**Purpose:** Playback control panel with shuffle, repeat, and volume controls

### Props Interface
```typescript
interface PlaybackControlsProps {
  className?: string;
  compact?: boolean;  // true = icons only, false = icons + labels
}
```

### State
```typescript
const [showVolumeSlider, setShowVolumeSlider] = useState(false)
const [isShuffleSpinning, setIsShuffleSpinning] = useState(false)
```

### Store Subscriptions
```typescript
const {
  shuffleMode,      // boolean
  repeatMode,       // 'off' | 'all' | 'one'
  volume,           // 0-100
  toggleShuffle,
  cycleRepeat,
  setVolume,
} = usePlayerStore();
```

### Event Handlers

#### handleShuffleClick()
**Logic:**
1. If shuffle is OFF → activating:
   - Set isShuffleSpinning = true
   - Trigger 600ms spin animation
   - Clear spinning state after animation
2. Call toggleShuffle() to update store

#### cycleRepeat()
**Called directly from store**
- Cycles: off → all → one → off

#### Volume Click
**Mute/Unmute toggle:**
- If volume === 0: set to 80%
- Else: set to 0

#### Volume Slider Click
**Seek to position:**
1. Get click position relative to slider
2. Calculate percentage (0-100)
3. Call setVolume(percentage)

### Render Logic

#### 1. Shuffle Button
**Features:**
- Icon: Shuffle from lucide-react
- Color: Purple (#a855f7) when active, Gray (#6b7280) when off
- Drop shadow when active
- Spin animation when activating (600ms roulette spin)
- Label: "Shuffle" (if not compact)
- Touch target: 44x44px minimum

**Animation:**
```css
@keyframes spin-roulette {
  0%: rotate(0deg) scale(1)
  50%: rotate(180deg) scale(1.2)
  100%: rotate(360deg) scale(1)
}
```

#### 2. Repeat Button
**Features:**
- Icon: Repeat or Repeat1 (based on mode)
- Color: Purple when active (all/one), Gray when off
- Drop shadow when active
- Label: "Repeat" + mode (if not compact)
- Title attribute shows current mode

#### 3. Volume Control
**Structure:**
- Volume icon button (mute toggle)
- Volume slider (shows on hover or always if not compact)
- Volume percentage label (if not compact)

**Volume Icon:**
- VolumeX if volume === 0
- Volume2 otherwise

**Volume Slider:**
- Width: 80px
- Height: 4px
- Background: rgba(255,255,255,0.1)
- Fill: Purple → Pink gradient
- Handle: 12px white circle

**Interactions:**
- Mouse enter/leave: show/hide slider
- Click on slider: seek to position
- Slider always visible if not compact

### Styling

#### Container
**When compact:**
- Transparent background
- No padding
- Minimal spacing

**When not compact:**
- Background: rgba(255,255,255,0.05)
- Padding: 8px 12px
- Border-radius: 12px

#### Button States
- Default: Gray (#6b7280)
- Active: Purple (#a855f7)
- Active glow: drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))
- Size: 20px icons
- Gap: 16px between buttons

### Accessibility
- All buttons have title attributes
- Touch targets meet 44px minimum
- Keyboard accessible (native button elements)
- Volume slider clickable (not just draggable)

### Performance Notes
- Custom CSS animation injected once
- Animation triggered by state change, not continuous
- Volume slider only rendered when needed (in compact mode)

---

## 2. TunnelDrawer.tsx

**File Path:** `/src/components/player/TunnelDrawer.tsx`

**Purpose:** Queue management drawer visualizing Past → NOW → Future musical journey

### Props Interface
```typescript
interface TunnelDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSearch?: () => void;
}
```

### State
```typescript
const [queueItems, setQueueItems] = useState(queue)
const [playlistTrack, setPlaylistTrack] = useState<Track | null>(null)
```

### Store Subscriptions
```typescript
const {
  queue,            // Array of QueueItem
  history,          // Array of HistoryItem
  currentTrack,
  removeFromQueue,
  reorderQueue,
  setCurrentTrack,
  clearQueue,
} = usePlayerStore();
```

### Effects

#### Sync Queue Items
```typescript
React.useEffect(() => {
  setQueueItems(queue);
}, [queue]);
```
Keeps local state synchronized with store

### Event Handlers

#### handleReorder(newOrder)
**Logic:**
1. Update local state immediately (optimistic update)
2. For each item in new order:
   - Find old index in store queue
   - If index changed: call reorderQueue(oldIndex, newIndex)

#### handleSwipeRemove(index, info)
**Gesture detection:**
- If horizontal offset > 100px: removeFromQueue(index)

#### handleReplayTrack(track)
**Replay from history:**
- setCurrentTrack(track)
- Immediately starts playing

### Computed Values

#### recentHistory
```typescript
const recentHistory = history.slice(-5).reverse();
```
Last 5 played tracks, most recent first

#### totalTracks
```typescript
const totalTracks = recentHistory.length + (currentTrack ? 1 : 0) + queue.length;
```

### Render Sections

#### 1. Backdrop
- Black/60 with backdrop blur
- Click to close
- z-40

#### 2. Drawer Container
**Properties:**
- Fixed bottom position, z-50
- Height: 85vh
- Rounded top: 2rem
- Background: #0a0a0f/95 with backdrop blur
- Border top: white/10
- Draggable vertically

**Drag Behavior:**
- Elastic: 0.2
- Constraints: top 0, bottom 0
- Close if dragged down > 200px

#### 3. Drag Handle
- Centered horizontal bar
- 12x1.5 rounded pill
- White/20 color

#### 4. Header Section
**Content:**
- Title: "THE TUNNEL" (gradient purple → pink)
- Subtitle: "[X] tracks in your journey"
- Close button (X icon)

#### 5. History Section
**Conditional:** Only if recentHistory.length > 0

**Header:** "Recently Played"

**Track Items:**
- Horizontal layout
- 12x12 thumbnail (rounded)
- Title (truncated)
- Artist (truncated)
- Duration (right aligned)
- Opacity: 60% → 100% on hover
- Click to replay

#### 6. Now Playing Section
**Conditional:** Only if currentTrack exists

**Header:** "Now Playing"

**Card Features:**
- Gradient background: purple/20 → pink/20
- Border: 2px purple/50
- Pulsing glow animation (shadow cycles)
- 20x20 thumbnail with overlay gradient
- Title (bold, lg)
- Artist
- Mood badge + duration

#### 7. Queue Section
**Conditional:** Only if queue.length > 0

**Header:**
- "Up Next ([X])"
- Clear button (Trash icon, red text)

**Queue Items (Reorderable):**
- Reorder.Group from Framer Motion
- Vertical axis
- Each item:
  - Drag handle (GripVertical icon)
  - 12x12 thumbnail
  - Title + Artist (truncated)
  - Duration
  - Heart button (hold 500ms for playlist modal)
  - Swipeable horizontally to remove

**Interactions:**
- Drag vertically: reorder
- Drag horizontally > 100px: remove
- Hold heart: open playlist modal
- Tap heart: like (currently no-op)

#### 8. Empty Queue State
**Conditional:** Only if queue.length === 0

**Content:**
- Music2 icon (16x16)
- "Your queue is empty"
- "Add tracks to keep the vibes going"

#### 9. Footer
**Fixed at bottom:**
- "Add More Tracks" button
- Full width, gradient purple → pink
- Plus icon
- Calls onOpenSearch

#### 10. Playlist Modal
**Conditional:** When playlistTrack is set

**Component:** PlaylistModal
- Allows adding track to playlists
- Closes with setPlaylistTrack(null)

### Helper Functions

#### formatDuration(seconds)
```typescript
const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```

### Styling Details

#### Glass Morphism
- Background: #0a0a0f/95
- Backdrop blur: xl
- Border: white/10

#### Track Cards
- Background: white/5
- Hover: white/10
- Rounded: xl (0.75rem)
- Padding: 12px
- Transition: colors

#### Now Playing Glow
```typescript
animate={{
  boxShadow: [
    '0 0 20px rgba(168, 85, 247, 0.3)',
    '0 0 40px rgba(236, 72, 153, 0.4)',
    '0 0 20px rgba(168, 85, 247, 0.3)',
  ],
}}
transition={{ duration: 2, repeat: Infinity }}
```

### Gesture System

#### Vertical Drag (Drawer)
- dragConstraints: { top: 0, bottom: 0 }
- dragElastic: 0.2
- onDragEnd: close if offset.y > 200

#### Vertical Drag (Queue Item)
- Reorder.Item from Framer Motion
- Auto-reordering on drag

#### Horizontal Drag (Queue Item)
- dragConstraints: { left: 0, right: 0 }
- onDragEnd: remove if offset.x > 100

### Performance Optimizations
- Local state (queueItems) prevents unnecessary store updates
- Lazy rendering (sections only render if data exists)
- Optimistic updates (UI responds immediately)

---

## 3. EnergyWave.tsx

**File Path:** `/src/components/player/EnergyWave.tsx`

**Purpose:** Animated waveform progress bar replacing traditional seekbar

### Props Interface
```typescript
interface EnergyWaveProps {
  className?: string;
}
```

### State
```typescript
const [hoveredBar, setHoveredBar] = useState<number | null>(null)
const containerRef = useRef<HTMLDivElement>(null)
const { isMobile, prefersReducedMotion } = useMediaQueries()
```

### Store Subscriptions
```typescript
const { progress, currentTime, duration, seekTo, currentTrack } = usePlayerStore();
```

### Constants

#### BAR_COUNT
- **Mobile:** 20 bars (performance optimization)
- **Desktop:** 40 bars (smoother visualization)

### Wave Generation Algorithm

#### generateWavePattern(trackId, barCount)
**Purpose:** Generate consistent wave pattern from track ID

**Logic:**
1. Create seed from trackId character codes
2. Use Linear Congruential Generator (LCG) for pseudo-random
3. For each bar:
   - Generate base wave: `sin((i / barCount) * π * 3) * 0.3 + 0.5`
   - Add random variation: `normalized * 0.4`
   - Clamp height: 0.2 to 1.0
4. Return array of heights

**Benefits:**
- Same track = same pattern (consistent)
- Different tracks = different patterns (variety)
- Smooth wave transitions (sine base)

### Media Queries Hook

#### useMediaQueries()
**Returns:** `{ isMobile, prefersReducedMotion }`

**Detection:**
- **isMobile:** width < 768 OR touch support
- **prefersReducedMotion:** CSS media query

**Effects:**
- Listen to window resize
- Listen to prefers-reduced-motion changes
- Cleanup on unmount

### Event Handlers

#### handleSeek(e)
**Click-to-seek:**
1. Get click X position relative to container
2. Calculate percentage across width
3. Convert to time: `(percentage / 100) * duration`
4. Call seekTo(newTime)

#### onMouseMove
**Hover effect:**
- Calculate hovered bar index from mouse X
- Update hoveredBar state

#### onMouseLeave
**Clear hover:**
- Set hoveredBar to null

### Computed Values

#### wavePattern
```typescript
const wavePattern = useMemo(() => {
  if (!currentTrack) return Array(BAR_COUNT).fill(0.5);
  return generateWavePattern(currentTrack.id, BAR_COUNT);
}, [currentTrack?.id]);
```
Only recomputes when track changes

#### currentBarIndex
```typescript
const currentBarIndex = Math.floor((progress / 100) * BAR_COUNT);
```

### Render Structure

#### 1. Time Display
**Top row:**
- Current time (purple, bold)
- Duration (gray)
- Font: mono, 10px

#### 2. Wave Container
**Properties:**
- Height: 48px (h-12)
- Flexbox with gaps: 2px
- Items align to bottom (items-end)
- Cursor: pointer
- Padding: 8px horizontal

**Mouse Events:**
- onClick: seek
- onMouseMove: update hover
- onMouseLeave: clear hover

#### 3. Wave Bars (Individual)
**For each bar in pattern:**

**Sizing:**
- flex: 1 (equal width)
- height: `${height * 100}%` (relative to container)
- minHeight: 20%

**States:**
- `isPlayed`: index ≤ currentBarIndex
- `isCurrent`: index === currentBarIndex
- `isHovered`: index === hoveredBar

**Bar Layers:**
1. **Background Layer**
   - Gradient: purple → pink (played) or gray (unplayed)
   - Rounded top
   - Brightness: 150% if current, 125% if hovered
   - Pulse animation if played (CSS)

2. **Glow Layer** (if current)
   - Gradient: yellow → white
   - Pulse animation

3. **Shimmer Layer** (if played, desktop only)
   - Gradient: transparent → white/30 → transparent
   - Vertical slide animation

4. **Hover Layer** (if hovered, not played, desktop)
   - Gradient: purple/50 → pink/50
   - Fade in animation

**Entrance Animation:**
```typescript
initial={{ scaleY: 0 }}
animate={{ scaleY: 1 }}
transition={{ duration: 0.3, delay: index * 0.01 }}
```
Staggered scale-up effect

#### 4. Progress Percentage
**Bottom row:**
- Text: "[X]% energy"
- Font: mono, 8px
- Color: gray

### CSS Animations

#### animate-wave-pulse
**Applied to played bars:**
- Subtle pulsing effect
- Delay: `${index * 50}ms` (staggered)
- Skipped if prefersReducedMotion

#### animate-glow-pulse
**Applied to current bar:**
- Bright glow pulse
- Rapid pulsing
- Skipped if prefersReducedMotion

#### animate-shimmer
**Applied to played bars (desktop only):**
- Vertical shimmer effect
- Delay: `${index * 100}ms`
- Not rendered on mobile

### Mobile Optimizations

#### 1. Reduced Bar Count
- 20 bars vs 40 bars
- Smoother performance on mobile devices

#### 2. CSS Animations Over Framer Motion
- Infinite loops use CSS instead of Framer Motion
- GPU acceleration with `will-change: transform`
- Transform: `translateZ(0)` for hardware acceleration

#### 3. Disabled Shimmer on Mobile
- Shimmer layer not rendered if isMobile
- Reduces animation overhead

#### 4. Respects Reduced Motion
- All animations disabled if user prefers reduced motion
- Static bars for accessibility

### Helper Functions

#### formatTime(seconds)
```typescript
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
```

### Styling Details

#### Colors
- **Played:** Purple (#a855f7) → Pink (#ec4899)
- **Unplayed:** Gray (#6b7280) → Gray (#4b5563)
- **Current:** Yellow (#facc15) → White
- **Hover:** Purple/50 → Pink/50

#### Gradients
- `bg-gradient-to-t` (bottom to top)
- Smooth color transitions

#### Border Radius
- `rounded-t-full` (fully rounded top)

### Accessibility
- Click-to-seek (not drag-only)
- Respects prefers-reduced-motion
- Clear visual feedback (hover, current)
- Time display for screen readers

### Performance Notes
- Memoized wave pattern (only recalculates on track change)
- GPU acceleration hints (will-change, translateZ)
- Conditional rendering (mobile vs desktop features)
- CSS animations preferred over JS for infinite loops
- Staggered entrance animations (prevents jank)

---

## Summary Statistics

### Total Player Components: 3

1. **PlaybackControls** - Shuffle, repeat, volume (199 lines)
2. **TunnelDrawer** - Queue management (343 lines)
3. **EnergyWave** - Waveform progress bar (214 lines)

### Key Features by Component

#### PlaybackControls
- Shuffle with roulette animation
- Repeat mode cycling (off → all → one)
- Volume slider with mute toggle
- Compact mode support

#### TunnelDrawer
- History section (last 5 tracks)
- Now playing highlight
- Reorderable queue
- Swipe to remove
- Drag to reorder
- Hold heart for playlist modal
- Empty state handling

#### EnergyWave
- Consistent wave patterns per track
- Mobile optimizations (20 bars)
- Desktop enhancements (40 bars, shimmer)
- Accessibility (reduced motion)
- Click-to-seek
- Hover effects
- Multi-layer bar visualization

### Common Patterns

#### Performance Optimizations
- Memoization (useMemo, React.memo)
- Selective subscriptions to stores
- CSS animations over JS
- GPU acceleration hints
- Conditional rendering by device

#### Gesture Detection
- Drag (vertical, horizontal)
- Swipe (threshold-based)
- Hold (timeout-based)
- Click/Tap

#### State Management
- Zustand store subscriptions
- Local state for UI-only changes
- Optimistic updates
- Sync effects

#### Accessibility
- Touch target sizes (44px minimum)
- Keyboard support (native buttons)
- Reduced motion respect
- Clear visual feedback

#### Visual Effects
- Framer Motion animations
- Glass morphism (backdrop blur)
- Gradient backgrounds
- Glow effects (box-shadow)
- Pulsing animations

### Technologies Used
- **Framer Motion** - Animations, gestures, reordering
- **Lucide React** - Icons
- **Zustand** - State management
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility styling
- **CSS Animations** - Performance-optimized loops

### Integration Points
- All components subscribe to `usePlayerStore`
- TunnelDrawer opens PlaylistModal
- EnergyWave respects mobile device detection
- PlaybackControls respects compact mode prop
