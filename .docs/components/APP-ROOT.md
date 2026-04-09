# APP ROOT COMPONENT DOCUMENTATION

## File: `/src/App.tsx`

### Purpose
The root application component that orchestrates the entire VOYO Music experience. Acts as the main container and mode switcher between Classic Mode, VOYO Player, and Video Mode.

---

## APP MODES

The app supports 3 main modes:

1. **Classic Mode** (`'classic'`)
   - Spotify-style experience
   - Home Feed, Library, Now Playing
   - Standard music player interface

2. **VOYO Mode** (`'voyo'`)
   - Main player experience with DJ interaction
   - Portrait and Landscape variants (auto-detected)
   - TikTok-style vertical feed

3. **Video Mode** (`'video'`)
   - Full immersion experience
   - Floating reactions like TikTok Live
   - Video visualization

---

## KEY STATE

```typescript
const [appMode, setAppMode] = useState<AppMode>(() => {
  // Migration logic for v1.2 - defaults to 'voyo'
  const migrated = localStorage.getItem('voyo-mode-migrated-v12');
  if (!migrated) {
    localStorage.removeItem('voyo-app-mode');
    localStorage.setItem('voyo-mode-migrated-v12', 'true');
    return 'voyo';
  }
  const saved = localStorage.getItem('voyo-app-mode');
  return (saved === 'classic' || saved === 'voyo' || saved === 'video')
    ? (saved as AppMode)
    : 'voyo';
});
```

**State Variables:**
- `appMode`: Current app mode
- `bgError`: Background image fallback state
- `isSearchOpen`: Search overlay visibility
- `backgroundType`: Selected animated background
- `isBackgroundPickerOpen`: Background picker visibility
- `isProfileOpen`: Profile/Universe panel visibility
- `showSplash`: Splash screen visibility (session-based)

---

## CUSTOM HOOKS

### `useOrientation()`
Detects device orientation for responsive layout switching.

**Returns:** `boolean` - `true` if landscape, `false` if portrait

**Implementation:**
```typescript
const [isLandscape, setIsLandscape] = useState(
  typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
);

useEffect(() => {
  const handleResize = () => {
    setIsLandscape(window.innerWidth > window.innerHeight);
  };
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  // cleanup
}, []);
```

---

## DYNAMIC ISLAND COMPONENT

### Purpose
iPhone-style notification pill that displays music updates, messages, and system notifications.

### Features
- **3 Phases:** Wave (new notification) → Dark (persistent) → Fade (dismissal)
- **Interaction:** Tap to expand, swipe to navigate/dismiss
- **Reply Mode:** Text input + voice recording with transcript
- **Auto-dismiss:** After 3s in dark phase (unless expanded)

### Notification Types
```typescript
interface Notification {
  id: string;
  type: 'music' | 'message' | 'system';
  title: string;
  subtitle: string;
  read?: boolean;
  color?: string; // Custom color for friends
}
```

**Status Colors:**
- Music: Purple (`#9333ea`)
- Message: Blue (`#3b82f6`)
- System: Red (`#ef4444`)

### State Machine
```
IDLE → WAVE (3s, new notification) → DARK (3s) → FADE (0.6s) → INVISIBLE
       ↑                              ↑           ↑
       ↓ (tap)                        ↓ (tap)     |
    EXPANDED (no auto-dismiss) ←──────────────────┘
```

### Key Functions

#### `triggerNewNotification()`
- Resets state and starts wave animation
- Used for NEW notifications
- Shows liquid gradient wave effect

#### `triggerManualResurface()`
- Starts from dark phase (no wave)
- Used when user manually reopens notification

#### `handleCollapsedDrag()`
Gesture handlers when collapsed:
- **Swipe Up:** Dismiss notification
- **Swipe Left/Right:** Navigate between notifications

#### `handleExpandedDrag()`
Gesture handlers when expanded:
- **Swipe Up:** Dismiss
- **Swipe Left/Right:** Navigate with wave transition

#### Voice Recording Flow
1. Tap wavy input box
2. Countdown (3, 2, 1)
3. Recording with waveform visualization
4. Speech-to-text transcript display
5. Send button to submit

---

## INITIALIZATION SEQUENCE

### 1. Splash Screen (First Load Only)
```typescript
const [showSplash, setShowSplash] = useState(() => {
  const splashShown = sessionStorage.getItem('voyo-splash-v3');
  return !splashShown;
});
```

### 2. Mobile Audio Unlock
```typescript
useEffect(() => {
  setupMobileAudioUnlock();
}, []);
```

### 3. Network Quality Detection
```typescript
useEffect(() => {
  const { detectNetworkQuality } = usePlayerStore.getState();
  detectNetworkQuality();
}, []);
```

### 4. Track Pool Maintenance
```typescript
useEffect(() => {
  startPoolMaintenance();
  console.log('[VOYO] Track pool maintenance started');
}, []);
```

---

## LAYOUT STRUCTURE

```
App
├── VoyoSplash (session-first-load only)
├── Dynamic Background Layer
│   ├── Blurred Album Art (current track)
│   ├── AnimatedBackground (user-selected)
│   └── Gradient Overlay
├── ReactionCanvas (floating reactions)
├── Main Content (AnimatePresence mode="wait")
│   ├── ClassicMode (appMode === 'classic')
│   ├── VideoMode (appMode === 'video')
│   └── VOYO Mode (appMode === 'voyo')
│       ├── Top Bar (logo, Dynamic Island, search, profile)
│       ├── Content (landscape ? LandscapeVOYO : PortraitVOYO)
│       └── VOYO Watermark
├── AudioPlayer (handles actual playback)
├── SearchOverlay (isOpen)
├── BackgroundPicker (isOpen)
├── UniversePanel (profile/settings, isOpen)
├── InstallButton (PWA)
└── OfflineIndicator
```

---

## MODE SWITCHING

### Classic → VOYO
```typescript
const handleSwitchToVOYO = () => setAppMode('voyo');
```

### VOYO → Classic
```typescript
const handleSwitchToClassic = () => setAppMode('classic');
```

### VOYO → Video Mode
```typescript
const handleVideoModeEnter = () => setAppMode('video');
const handleVideoModeExit = () => setAppMode('voyo');
```

---

## BACKGROUND SYSTEM

### Image Fallback Chain
```typescript
const getBackgroundUrl = () => {
  if (!currentTrack) return '';
  if (bgError) {
    return getYouTubeThumbnail(currentTrack.trackId, 'high');
  }
  return currentTrack.coverUrl;
};
```

### Animated Background Types
- `glow`: Clean ambient glow (default)
- `particles`: Floating particles
- `waves`: Wave motion
- `stars`: Starfield
- `gradient`: Animated gradient

---

## PERSISTENCE

### App Mode
```typescript
useEffect(() => {
  localStorage.setItem('voyo-app-mode', appMode);
}, [appMode]);
```

### Splash Screen
```typescript
const handleSplashComplete = useCallback(() => {
  sessionStorage.setItem('voyo-splash-v3', 'true');
  setShowSplash(false);
}, []);
```

---

## GLOBAL WINDOW FUNCTIONS

### `window.pushNotification(notif: Notification)`
Exposed globally to trigger Dynamic Island notifications:
```typescript
(window as any).pushNotification = (notif: Notification) => {
  setNotifications(prev => [...prev, notif]);
  setCurrentIndex(prev => prev === 0 && notifications.length === 0 ? 0 : notifications.length);
  triggerNewNotification();
};
```

---

## ANIMATION VARIANTS

### Mode Transitions
```typescript
// Classic Mode entry/exit
initial={{ opacity: 0, x: -50 }}
animate={{ opacity: 1, x: 0 }}
exit={{ opacity: 0, x: -50 }}

// Video Mode fade
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
exit={{ opacity: 0 }}

// VOYO Mode slide
initial={{ opacity: 0, x: 50 }}
animate={{ opacity: 1, x: 0 }}
exit={{ opacity: 0, x: 50 }}
```

---

## DEBUG TOOLS

### Intent Engine Verification
```typescript
import './utils/debugIntent';
```
Available in browser console for testing intent detection system.

---

## KEY DEPENDENCIES

**Internal:**
- `usePlayerStore`: Player state management
- `setupMobileAudioUnlock`: iOS audio fix
- `startPoolMaintenance`: Track pool system
- `getYouTubeThumbnail`: Thumbnail utilities

**External:**
- `framer-motion`: Animations
- `lucide-react`: Icons

---

## PERFORMANCE OPTIMIZATIONS

1. **Lazy Loading:** Components loaded on-demand via AnimatePresence
2. **Session Storage:** Splash screen shown once per session
3. **Local Storage:** App mode persisted across sessions
4. **Background Preloading:** Track thumbnails preloaded during splash
5. **Network Detection:** Auto-adjusts quality based on connection

---

## MOBILE CONSIDERATIONS

- **Audio Unlock:** Required for iOS Safari audio playback
- **Orientation Handling:** Auto-switches between portrait/landscape layouts
- **Touch Gestures:** Swipe navigation in Video Mode
- **Safe Areas:** Bottom navigation respects notch/home indicator

---

## NOTES

- **Migration System:** One-time migration logic ensures smooth version updates
- **Error Boundaries:** Background image failures gracefully fallback to YouTube thumbnails
- **Accessibility:** All interactive elements have proper ARIA labels
- **PWA Ready:** InstallButton and OfflineIndicator support progressive web app features
