# VOYO Components Documentation

Complete documentation of all VOYO mode components in `/src/components/voyo/`.

---

## 1. VoyoBottomNav.tsx

**File Path:** `/src/components/voyo/navigation/VoyoBottomNav.tsx`

**Purpose:** Bottom navigation bar with 3 tabs: DAHUB | VOYO (toggle) | HOME

### Props Interface
```typescript
interface VoyoBottomNavProps {
  onDahub?: () => void;     // Callback for DAHUB button
  onHome?: () => void;      // Callback for HOME button
}
```

### State
- `voyoActiveTab` - Current active tab ('feed' | 'music') from playerStore
- `isPlaying` - Playback status from playerStore

### Store Subscriptions
- `usePlayerStore`: voyoActiveTab, setVoyoTab, isPlaying

### Event Handlers
- `handleVoyoToggle()` - Toggles between 'feed' and 'music' tabs

### Render Logic
1. **Left Button (DAHUB)**
   - Sparkles icon
   - Calls onDahub callback

2. **Center Button (VOYO Toggle)**
   - Large circular button (16x16)
   - Shows current mode: Player (Music icon) or Feed (Flame icon)
   - Background gradient: purple → pink (feed) or purple → pink (music)
   - Pulsing animation (scale 1 → 1.02 → 1, 2s infinite)
   - Label toggles: "Player" when on feed, "Feed" when on music

3. **Right Button (HOME)**
   - Home icon
   - Calls onHome callback

4. **Now Playing Indicator** (conditional)
   - Shows only when `isPlaying && voyoActiveTab !== 'music'`
   - 3 animated bars with purple gradient
   - Text: "Now Playing"

### Styling
- Glass morphism background (`.glass-nav`)
- Safe area padding (pb-safe)
- Icons: white/40 opacity, hover to white/60
- Motion effects: whileHover scale 1.05, whileTap 0.95

---

## 2. CreatorUpload.tsx

**File Path:** `/src/components/voyo/upload/CreatorUpload.tsx`

**Purpose:** Full-screen creator upload flow for posting video content to VOYO feed

### Props Interface
```typescript
interface CreatorUploadProps {
  onClose: () => void;  // Close modal callback
}
```

### State
```typescript
const [step, setStep] = useState<UploadStep>('select')  // Current upload step
const [selectedFile, setSelectedFile] = useState<File | null>(null)
const [previewUrl, setPreviewUrl] = useState<string | null>(null)
const [caption, setCaption] = useState('')
const [selectedSound, setSelectedSound] = useState<string | null>(...)
```

### Upload Steps
1. **select** - File selection screen
2. **preview** - Video preview with controls
3. **details** - Caption, sound, tags input
4. **posting** - Upload in progress

### Store Subscriptions
- `usePlayerStore`: currentTrack (for suggested sound)

### Event Handlers
- `handleFileSelect(e)` - Processes file input, creates preview URL, moves to preview step
- `handlePost()` - Simulates posting (2s delay), then closes

### Render Logic by Step

#### Step: 'select'
- Large circular upload button with dashed border
- Orbiting sparkles animation
- Quick action buttons: Upload (Video icon), Record (Camera icon)
- Currently playing suggestion card (if track is playing)
  - Shows track title/artist
  - "Use this sound?" prompt
  - Zap icon
- Hidden file input (video/*)

#### Step: 'preview'
- Full-height video player with controls
- autoPlay, loop, muted
- "Next" button at bottom (gradient purple → pink)

#### Step: 'details'
- **Caption textarea**
  - Placeholder: "Describe your vibe... #OYE #AfricanVibes"
  - Character counter (300 max)
- **Sound selection button**
  - Shows selectedSound or "Add sound"
  - Music2 icon
- **Tag suggestions**
  - Predefined tags: #OYE, #AfricanVibes, #Dance, #Music, #Culture
  - Hoverable pill buttons
- **Post button**
  - Full width, gradient background
  - Zap icon + "Post to VOYO"

#### Step: 'posting'
- Centered success screen
- Pulsing checkmark circle (scale 1 → 1.1 → 1)
- "Posting..." text
- "Sharing your vibe with the world"

### Styling
- Full-screen absolute overlay (z-50)
- Background: #0a0a0f
- Header: flex justify-between, X button, title "Create VOYO"
- Animations: slide up from bottom on entry

---

## 3. VoyoVerticalFeed.tsx

**File Path:** `/src/components/voyo/feed/VoyoVerticalFeed.tsx`

**Purpose:** TikTok/YouTube Shorts style vertical feed with music discovery and reactions

### Props Interface
```typescript
interface VoyoVerticalFeedProps {
  isActive: boolean;        // Feed is visible
  onGoToPlayer?: () => void; // Navigate to music player
}
```

### State
```typescript
const [currentIndex, setCurrentIndex] = useState(0)  // Current card in view
const containerRef = useRef<HTMLDivElement>(null)
```

### Store Subscriptions
- `useReactionStore`: recentReactions, fetchRecentReactions, subscribeToReactions, createReaction, computeHotspots, getCategoryScore
- `usePlayerStore`: setCurrentTrack, addToQueue, currentTrack, isPlaying, togglePlay, progress
- `useUniverseStore`: currentUsername

### Effects
1. **Fetch reactions on mount**
   - `fetchRecentReactions(100)` when isActive
   - Subscribe to real-time reactions if not subscribed

2. **Scroll handler**
   - Calculates current card index from scroll position
   - Uses snap scrolling (scrollTop / itemHeight)

### Feed Building Algorithm
```typescript
const trackGroups = useMemo(() => {
  // 1. Index reactions by track
  // 2. Calculate hotScore (reaction count)
  // 3. Calculate categoryBoost (user preference alignment)
  // 4. Include ALL tracks from TRACKS array
  // 5. Sort by FOR YOU score:
  //    - Has reactions: +10 boost
  //    - Category preference * reaction count
  //    - Random shuffle for equal scores
})
```

### Child Components

#### **ProgressBar**
**Props:** `isActive: boolean, trackId: string`

**Features:**
- Displays progress as horizontal bar at bottom
- Heatmap visualization of reaction hotspots
- Hotspot markers with intensity-based colors
- Pulsing glow indicators for high-intensity hotspots
- Time display (current/total)
- Hotspot count indicator

**Hotspot Colors:**
- 'fire': Orange (249, 115, 22)
- 'like': Pink (236, 72, 153)
- 'oye': Yellow (251, 191, 36)

#### **ScrollingCommentsOverlay**
**Props:** `comments: ScrollingComment[], isVisible: boolean`

**Features:**
- Auto-scrolling comment overlays (TikTok Live style)
- Adds comments one by one (2s interval)
- Shows last 8 comments
- Distinguishes "punches" (📍) with pink background
- Username @handle display
- Animations: fade in from left, fade out upward

#### **CommentsSheet**
**Props:** `isOpen, onClose, reactions, trackTitle, onAddComment`

**Features:**
- Bottom sheet modal (70vh max height)
- Full comments list with scrolling
- Punch indicator badge
- Comment input with "Post" button
- Enter key submits

#### **FeedCard**
**Props:** 20+ props including trackId, trackTitle, reactions, onPlay, onReact, etc.

**Features:**
1. **Background Layer**
   - Track thumbnail or gradient fallback
   - Dark gradient overlays for text readability

2. **Tap-to-play overlay**
   - Invisible button covering entire card
   - Plays/pauses track

3. **Progress bar with heatmap** (when active)

4. **Scrolling comments** (when active and comments sheet closed)

5. **Track Info (bottom left)**
   - OYÉ badge (if score ≥ 100)
   - Artist handle (@username)
   - Track title (line-clamp-2)
   - Song info with Music2 icon

6. **Right Side Actions**
   - **OYÉ Button** (large, circular)
     - Orange gradient background
     - Zap icon (filled)
     - Adds to library + boosts
   - **Comments** (MessageCircle icon)
     - Shows comment count
   - **Add to Playlist** (Plus icon)
   - **Share** (Share2 icon)

7. **Auto-play logic**
   - When card becomes active and not playing, auto-play

### Event Handlers
- `handleScroll()` - Updates currentIndex based on scroll position
- `handlePlay(trackId, trackTitle, trackArtist)` - Finds track in TRACKS and sets as current
- `handleReact(trackId, ..., type)` - Creates reaction with track position for hotspot
- `handleAddComment(trackId, ..., text)` - Creates reaction with comment

### Render Logic
1. **Empty State** (no tracks)
   - Purple circle with Zap icon
   - "No Vibes Yet" message

2. **Snap Scroll Container**
   - `overflow-y-scroll snap-y snap-mandatory`
   - Each card: `h-full w-full snap-start snap-always`
   - Preloads next 2 thumbnails

3. **Top Navigation**
   - "Following" | "For You" tabs
   - Mute button (top right)

4. **Scroll Indicator** (bottom center)
   - ChevronDown icon
   - Only shows if more cards available

### Styling
- Black background
- Full screen absolute positioning
- Hidden scrollbar (scrollbar-hide)

---

## 4. PortraitVOYO.tsx

**File Path:** `/src/components/voyo/PortraitVOYO.tsx`

**Purpose:** Main orchestrator for portrait VOYO mode, manages tab switching between Music, Feed, Creator, and DAHUB

### Props Interface
```typescript
interface PortraitVOYOProps {
  onSearch?: () => void;
  onDahub?: () => void;
  onHome?: () => void;
}
```

### State
```typescript
const [djMode, setDjMode] = useState<DJMode>('idle')  // 'idle' | 'listening' | 'responding'
const [djResponse, setDjResponse] = useState<string | null>(null)
const [isTextInputOpen, setIsTextInputOpen] = useState(false)
const originalVolumeRef = useRef(volume)
```

### Store Subscriptions
- `usePlayerStore`: isPlaying, togglePlay, refreshRecommendations, setVolume, volume, voyoActiveTab, setVoyoTab

### Effects
1. **Volume fading for DJ mode**
   - When DJ active: reduce volume to 30% (min 10)
   - When DJ idle: restore original volume

### DJ System

#### DJ Modes
- `idle` - Normal playback
- `listening` - Waiting for voice/text input
- `responding` - Processing and responding

#### DJ Responses
```typescript
const DJ_RESPONSES: Record<string, string[]> = {
  'more-like-this': ["Got you fam!", "Adding similar vibes..."],
  'something-different': ["Say less!", "Switching it up..."],
  'more-energy': ["AYEEE!", "Turning UP!"],
  'chill-vibes': ["Cooling it down...", "Smooth vibes only"],
  'default': ["I hear you!", "Say less, fam!", "OYE!"],
}
```

### Event Handlers
- `handleListenMode()` - Toggle voice listen mode, pause/play music
- `handleTextMode()` - Open text input modal
- `handleDJCommand(command)` - Process DJ command, apply refresh, show response
- `handleCloseTextInput()` - Close text input and reset DJ mode

### Layer System (z-index stacking)

#### Layer 1 (z-0): MUSIC MODE - VoyoPortraitPlayer
- Visible when `voyoActiveTab === 'music'`
- Scale 1 / opacity 1 when active
- Scale 0.95 / opacity 0 / blur when inactive
- Transition: 0.4s cubic-bezier

#### Layer 2 (z-10): FEED MODE - VoyoVerticalFeed
- Slide-in overlay from right
- x: 0 when active, x: 100% when inactive
- Transition: 0.5s cubic-bezier

#### Layer 3 (z-20): CREATOR MODE - CreatorUpload
- AnimatePresence wrapper
- Shows when `voyoActiveTab === 'upload'`
- Full screen modal

#### Layer 4 (z-20): DAHUB MODE - Hub
- Slide-in from left
- x: 0 when active, x: -100% when inactive
- Scrollable content

#### Layer 5 (z-50): BOTTOM NAVIGATION - VoyoBottomNav
- Always visible on top
- Fixed at bottom

### DJTextInput Component
**Exported component for landscape mode**

**Props:** `isOpen, onClose, onSubmit`

**Features:**
- Fixed overlay with blur backdrop
- Slides up from bottom
- Quick prompt buttons (4 suggestions)
- Text input field
- Submit on Enter key
- Send button with Send icon

---

## 5. VideoMode.tsx

**File Path:** `/src/components/voyo/VideoMode.tsx`

**Purpose:** Full-screen immersive video mode with floating reactions (TikTok Live style)

### Props Interface
```typescript
interface VideoModeProps {
  onExit: () => void;
}
```

### State
```typescript
const [showControls, setShowControls] = useState(true)
const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([])
const [isMuted, setIsMuted] = useState(false)
const previousVolume = useRef(volume)
const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
const tapCountRef = useRef(0)
const tapTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
const lastTapTime = useRef(0)
```

### Floating Reaction System

#### FloatingReaction Interface
```typescript
interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;          // 70-95% (right side)
  startY: number;     // 10-30% (bottom)
  yOffset: number;    // Random offset for variation
  xOffset: number;    // Horizontal drift
  duration: number;   // 3-5 seconds
}
```

#### Reaction Emojis
`['❤️', '🔥', '👍', '👏', '✨', '💜', '🎵', '⚡']`

### Store Subscriptions
- `usePlayerStore`: currentTrack, isPlaying, togglePlay, nextTrack, prevTrack, progress, volume, setVolume

### Effects
1. **Auto-hide controls** (3s timeout)
2. **Reaction cleanup** on animation complete

### Event Handlers
- `addReaction(emoji?)` - Add single floating reaction
- `triggerReactionStorm()` - Add 10-20 reactions rapidly (100ms intervals)
- `handleTap()` - Multi-tap detection:
  - 1 tap: Show controls
  - 2 taps (< 300ms): Reaction storm
  - 3 taps: Exit video mode
- `handleDragEnd(event, info)` - Swipe detection:
  - Swipe up (< -100px): Next track
  - Swipe down (> 100px): Previous track
- `handleMuteToggle()` - Toggle mute, save/restore previous volume

### Render Logic

#### Background Layer
- Album art (full cover)
- Animated gradient overlay (moving background-position)
- Dark gradient for text readability

#### Floating Reactions
- AnimatePresence wrapper
- Individual FloatingReactionEmoji components
- Animate: opacity [1,1,0], y: -300, scale: [0.5,1.2,1,0.8]

#### Track Info (always visible)
- Bottom left
- Track title (2xl, bold)
- Artist (lg, white/70)

#### Progress Bar (always visible)
- Bottom position
- White/20 background, white fill
- Height based on progress percentage

#### Reaction Buttons (right side, always visible)
- 4 buttons: ❤️, 🔥, 👏, ✨
- Circular (12x12)
- Black/30 background with backdrop-blur
- Click adds single reaction
- Stop propagation to prevent tap detection

#### Overlay Controls (fade in/out)
- **Exit Button** (top right)
  - X icon
  - Black/50 background with blur

- **Volume Button** (top left)
  - Volume2 or VolumeX icon
  - Toggle mute on click

- **Center Controls**
  - Previous (SkipBack, filled)
  - Play/Pause (large white circle, 20x20)
  - Next (SkipForward, filled)
  - All with black/30 blur background

- **Hint Text** (bottom center)
  - Instructions for gestures
  - Text: "Swipe up/down: Next/Prev • Double-tap: Reactions • Triple-tap: Exit"

---

## 6. LandscapeVOYO.tsx

**File Path:** `/src/components/voyo/LandscapeVOYO.tsx`

**Purpose:** Landscape mode player with timeline, play circle, reactions, and discovery streams

### Props Interface
```typescript
interface LandscapeVOYOProps {
  onVideoMode: () => void;  // Trigger video mode
}
```

### State
```typescript
const [isDJOpen, setIsDJOpen] = useState(false)
```

### Store Subscriptions
- `usePlayerStore`: currentTrack, history, queue, hotTracks, discoverTracks, nextTrack, prevTrack, setCurrentTrack, addReaction, volume, refreshRecommendations, isPlaying, togglePlay

### Child Components

#### **TimelineCard**
**Props:** `track, isCurrent?, onClick`

**Features:**
- Larger when current (32x24 vs 20x16)
- Rounded thumbnail with gradient overlay
- Title and artist at bottom
- Motion: scale 1.05 on hover (non-current)

#### **WaveformBars**
**Props:** `isPlaying`

**Features:**
- 24 vertical bars in center
- Height based on distance from center
- Animated when playing: heights cycle [0.3, 1, 0.5, 0.8, 0.3]
- Staggered delays (i * 0.02)
- White/80 color, 3px width, rounded

#### **PlayCircle**
**Props:** `onTripleTap, onHold`

**Features:**
- Large circular button (36x36)
- Conic gradient border (purple → pink)
- Progress ring (SVG circle, stroke-dashoffset)
- Inner waveform visualization
- Play/Pause icon overlay
- **Triple-tap** detection: triggers onTripleTap (video mode)
- **Hold** detection (500ms): triggers onHold (DJ mode)
- Pulsing glow when playing

#### **MiniCard**
**Props:** `track, onClick`

**Features:**
- Small card (16x16 thumbnail)
- Draggable horizontally
- **Drag right > 100px**: adds to queue
- Shows "Added to Queue" feedback (floating badge)
- Title below thumbnail (9px font)

### Layout Structure

#### TOP: Timeline (horizontal)
- Past tracks (last 3 from history)
- Current track (larger, centered)
- Queue tracks (next 2)
- Add button (dashed border, Plus icon)
- Volume indicator (right side)

#### MIDDLE: Play Circle & Controls
- **Left Reactions**
  - OYO 🔥 (yellow/orange gradient)
  - OYÉÉ 💜 (purple/pink gradient)

- **Skip Prev Button**
  - SkipBack icon
  - White/5 background

- **Play Circle** (center)
  - Triple-tap for video mode
  - Hold for DJ mode

- **Skip Next Button**
  - SkipForward icon

- **Right Reactions**
  - Wazzguán 👋 (cyan/blue gradient)
  - Fireee 🔥 (red/orange gradient)

#### BOTTOM: HOT | VOYO FEED | DISCOVERY
- **HOT Section** (left)
  - Label: "HOT"
  - 4 mini cards from hotTracks

- **VOYO FEED Button** (center)
  - 20x20 rounded square
  - Purple/pink gradient background
  - "VOYO" / "FEED" text

- **DISCOVERY Section** (right)
  - Label: "DISCOVERY"
  - 4 mini cards from discoverTracks

#### BOTTOM: Hint Text
- Center aligned
- "Triple-tap for Video Mode | Hold for DJ"

### Event Handlers
- `handleDJCommand(command)` - Process DJ text input, refresh recommendations
- `handleHoldForDJ()` - Pause music, open DJ text input

### DJ Integration
- Uses `DJTextInput` component from PortraitVOYO
- Same command processing logic
- Pauses playback when DJ opens

---

## 7. VoyoPortraitPlayer.tsx

**File Path:** `/src/components/voyo/VoyoPortraitPlayer.tsx`

**Purpose:** Main portrait player with mix board system, backdrop, reactions, and discovery streams

### Props Interface
```typescript
interface VoyoPortraitPlayerProps {
  onVoyoFeed?: () => void;
  djMode?: boolean;
  onToggleDJMode?: () => void;
  onSearch?: () => void;
}
```

*Note: This file is extremely large (1500+ lines). I read the first 1000 lines. Key sections documented:*

### State (partial list)
- Mix mode preferences
- Current taglines
- Backdrop settings
- Scrubbing state
- Boost settings visibility
- Reaction multiplier state

### Store Subscriptions
- `usePlayerStore`: Full player state
- `useIntentStore`: Vibe mode preferences
- `usePreferenceStore`: Track preferences
- `useReactionStore`: Reactions and categories
- `useUniverseStore`: Username

### Key Systems

#### **Mix Board System** - Discovery Machine Patent
**Purpose:** Preset mixing board that feeds HOT/DISCOVERY streams

**MixMode Interface:**
```typescript
interface MixMode {
  id: string;
  title: string;
  neon: string;        // Primary color (#ef4444)
  glow: string;        // Glow rgba
  taglines: string[];  // Billboard messages
  mood: PlaylistMood;  // Timing config
  textAnimation: TextAnimation;
  keywords: string[];  // Track matching
}
```

**Default Mix Modes:**
1. **Afro Heat** (Red, energetic, bounce)
2. **Chill Vibes** (Blue, chill, slideUp)
3. **Party Mode** (Pink, hype, scaleIn)
4. **Late Night** (Purple, mysterious, rotateIn)
5. **Workout** (Orange, intense, bounce)

**Mood Timings:**
- energetic: 2s tagline, 1.5s pulse
- chill: 4s tagline, 3s pulse
- intense: 2.5s tagline, 1.8s pulse
- mysterious: 3.5s tagline, 2.5s pulse
- hype: 1.8s tagline, 1.2s pulse

**Boost Level System (0-6 bars):**
- 0 bars: Mode is "starving" (grayscale, dim)
- 1-6 bars: Intensity increases
- Affects glow brightness, animation speed, tagline speed

#### **Isolated Time Components** (Performance Optimization)
- `CurrentTimeDisplay` - Only re-renders on time change
- `ProgressSlider` - Only re-renders on time/duration change
- Prevents parent component re-renders

#### **NeonBillboardCard Component**
**Purpose:** Mix mode preset cards with community punches

**Features:**
- 5-layer neon glow system
- Starving logic (0 bars = dying animation)
- Community punch integration (short comments become taglines)
- Double-tap to react
- Drag up to queue matching tracks
- Volume icon boost indicator (0-6 bars)
- Queue multiplier badge (x2-x5)
- Active indicator dot
- Scanline CRT effect
- Corner brackets (cyberpunk style)

**Interactions:**
- Single tap: Boost mode preference
- Double-tap: Add community reaction
- Drag up: Queue tracks matching this mode

#### **FullscreenBackground Component**
**Purpose:** Cinematic album art background

**Features:**
- Album art blurred and scaled (blur-2xl, scale-110)
- Dark gradient overlay
- Vignette effect
- Color tint overlay (purple gradient, overlay blend)

#### **BackdropToggle Component**
**Purpose:** Two-state toggle for background

**Features:**
- Vertical pill (9x72)
- Sliding knob animation (Film icon vs line)
- Hold 500ms or double-click: Open backdrop library
- Tooltip on hover

#### **BackdropLibrary Component**
**Purpose:** Modal to select background presets

**Backdrops:**
- Album Art (dynamic)
- Purple Wave (animated)
- Ocean Dream (animated)
- Sunset Fire (animated)
- Aurora (animated)
- Particle Storm (animated)
- Music Video (locked)

---

## 8. VoyoSplash.tsx

**File Path:** `/src/components/voyo/VoyoSplash.tsx`

**Purpose:** Premium splash screen with water drop animation and data preloading

### Props Interface
```typescript
interface VoyoSplashProps {
  onComplete: () => void;
  minDuration?: number;  // Default: 2800ms
}
```

### State
```typescript
const [phase, setPhase] = useState<'intro' | 'drop' | 'impact' | 'expand' | 'done'>('intro')
const [isDataReady, setIsDataReady] = useState(false)
const [isAnimationDone, setIsAnimationDone] = useState(false)
const hasCompletedRef = useRef(false)
```

### Store Subscriptions
- `useDownloadStore`: initDownloads
- `usePreferenceStore`: preferenceStore (touch to initialize)

### Effects

#### 1. Data Preloading
```typescript
useEffect(() => {
  // 1. Initialize IndexedDB
  await initDownloads()

  // 2. Preload first 3 track thumbnails
  const thumbnailPromises = TRACKS.slice(0, 3).map(preloadImage)
  await Promise.race([
    Promise.all(thumbnailPromises),
    timeout(1500)  // Max 1.5s wait
  ])

  // 3. Initialize preference store
  setIsDataReady(true)
})
```

#### 2. Animation Timeline
- 500ms: intro → drop
- 1200ms: drop → impact
- 2000ms: impact → expand
- minDuration: isAnimationDone = true

#### 3. Completion Gate
- Waits for BOTH isAnimationDone AND isDataReady
- Prevents premature completion

### Animation Phases

#### Phase: 'intro'
- VOYO logo fades in
- Ambient particles float
- Central glow pulses

#### Phase: 'drop'
- Water drop falls from top (y: 0 → 120)
- Drop scales down (1.2 → 0.7)
- Drop body: rounded shape with shine highlight

#### Phase: 'impact'
- 8 splash particles scatter in circle
- 4 expanding ripple rings
- Impact glow expands
- All fade out over 1s

#### Phase: 'expand'
- Central glow expands (scale 1 → 1.8)
- VOYO logo scales to 1.1
- Particles freeze

#### Phase: 'done'
- Fade out entire splash (0.6s)
- Calls onComplete

### Render Elements

1. **Background**
   - Linear gradient: dark purple tones
   - Ambient particles (20 floating dots)
   - Central glow (purple → pink radial gradient)

2. **VOYO Logo**
   - Text: "VOYO" (6xl, font-black)
   - Gradient: purple → pink → purple
   - Text shadow: multi-layer neon glow
   - Subtitle: "Music" (appears after intro)

3. **Water Drop** (intro/drop phases)
   - Rounded teardrop shape
   - Purple → pink gradient
   - Box shadow: glow + inset highlights
   - Orbiting sparkles

4. **Impact Effects** (impact/expand phases)
   - Splash particles (8 directions)
   - Expanding rings (4 concentric)
   - Impact glow (horizontal blur)

5. **Loading Status**
   - 3 animated dots
   - Color: purple (loading) or green (ready)
   - Text: "Loading tracks..." or "Ready"

6. **Bottom Brand**
   - "by DASUPERHUB"
   - Purple/30 opacity

### Styling Techniques
- Backdrop blur
- Radial gradients
- Drop shadows with multiple layers
- Motion animation for particles
- CSS box-shadow for neon effects

---

## Summary Statistics

### Total VOYO Components: 8

1. **VoyoBottomNav** - Navigation (129 lines)
2. **CreatorUpload** - Content creation (289 lines)
3. **VoyoVerticalFeed** - Discovery feed (812 lines)
4. **PortraitVOYO** - Main orchestrator (309 lines)
5. **VideoMode** - Immersive mode (375 lines)
6. **LandscapeVOYO** - Landscape player (482 lines)
7. **VoyoPortraitPlayer** - Portrait player (1500+ lines, partial read)
8. **VoyoSplash** - Splash screen (385 lines)

### Key Technologies Used
- **Framer Motion** - Animations and gestures
- **Zustand** - State management (player, reactions, universe, preferences)
- **Lucide React** - Icons
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility styling

### Common Patterns
- **Memoization** - React.memo for performance
- **Store subscriptions** - Selective re-renders
- **Motion presets** - Reusable spring configs
- **Glass morphism** - Backdrop blur + transparency
- **Neon effects** - Multi-layer box shadows
- **Gesture detection** - Tap, hold, drag, swipe
- **Auto-play logic** - Card visibility triggers
- **Reaction system** - Community-driven content
