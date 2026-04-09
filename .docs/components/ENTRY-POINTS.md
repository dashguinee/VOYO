# VOYO Music - Entry Points Documentation

This document provides comprehensive documentation for the application entry points and main application structure.

---

## 1. main.tsx

**File:** `/home/dash/voyo-music/src/main.tsx`

### Purpose
Application bootstrap file that initializes React, routing, and renders the root App component.

### Structure
```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ProfilePage } from './components/profile/ProfilePage'
```

### Routing Configuration
```typescript
<BrowserRouter>
  <Routes>
    {/* Main app - must be first to avoid catching as username */}
    <Route path="/" element={<App />} />
    {/* Profile pages - voyomusic.com/username */}
    <Route path="/:username" element={<ProfilePage />} />
  </Routes>
</BrowserRouter>
```

#### Route Order (Critical)
1. **Main App** (`/`) - Must be first
2. **Profile Pages** (`/:username`) - Dynamic username parameter

The order matters to prevent the dynamic route from catching the root path.

### React Rendering
```typescript
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Routes here */}
  </StrictMode>,
)
```

### Key Imports
- **React Core:** `StrictMode`, `createRoot`
- **Routing:** `BrowserRouter`, `Routes`, `Route` (React Router v6)
- **Styling:** `index.css` (Tailwind + custom styles)
- **Components:** Main `App`, `ProfilePage`

### Deployment Notes
- Uses `createRoot` (React 18+)
- StrictMode enabled for development checks
- Client-side routing with React Router
- Single-page application (SPA) architecture

---

## 2. App.tsx

**File:** `/home/dash/voyo-music/src/main.tsx`

### Purpose
Main application component that orchestrates all modes, backgrounds, player, and UI overlays.

---

## Core Architecture

### App Modes
```typescript
type AppMode = 'classic' | 'voyo' | 'video';
```

1. **Classic Mode** - Spotify-style library (Home Feed, Library, Now Playing)
2. **VOYO Mode** - Main player with DJ interaction (Portrait/Landscape)
3. **Video Mode** - Full immersion with floating reactions

### Orientation Detection
```typescript
const useOrientation = () => {
  const [isLandscape, setIsLandscape] = useState(
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return isLandscape;
};
```

**Logic:** Window width > height = landscape

---

## State Management

### App State
```typescript
const [appMode, setAppMode] = useState<AppMode>(() => {
  // One-time migration: reset to voyo player as new default (v1.2)
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

**Default:** VOYO player (v1.2+)
**Persistence:** localStorage
**Migration:** One-time reset for v1.2 users

### Background State
```typescript
const [backgroundType, setBackgroundType] = useState<BackgroundType>('glow');
const [isBackgroundPickerOpen, setIsBackgroundPickerOpen] = useState(false);
```

### UI State
```typescript
const [isSearchOpen, setIsSearchOpen] = useState(false);
const [isProfileOpen, setIsProfileOpen] = useState(false);
const [bgError, setBgError] = useState(false);  // Image loading fallback
```

### Splash Screen
```typescript
const [showSplash, setShowSplash] = useState(() => {
  // Check if splash was already shown this session (v3 = fixed design)
  const splashShown = sessionStorage.getItem('voyo-splash-v3');
  return !splashShown;
});

const handleSplashComplete = useCallback(() => {
  sessionStorage.setItem('voyo-splash-v3', 'true');
  setShowSplash(false);
}, []);
```

**Behavior:** Shows once per session
**Storage:** sessionStorage (resets on tab close)

---

## DynamicIsland Component

### Purpose
iPhone-style notification system integrated in top bar. Shows music updates, messages, and system notifications.

### Notification Interface
```typescript
interface Notification {
  id: string;
  type: 'music' | 'message' | 'system';
  title: string;
  subtitle: string;
  read?: boolean;
  color?: string;  // Custom color for friends
}
```

### Notification Types
1. **Music** (Purple dot) - New track drops, recommendations
2. **Message** (Blue dot) - Friend messages
3. **System** (Red dot) - App updates, system alerts

### States
```typescript
const [notifications, setNotifications] = useState<Notification[]>([]);
const [currentIndex, setCurrentIndex] = useState(0);
const [isExpanded, setIsExpanded] = useState(false);
const [isVisible, setIsVisible] = useState(false);
const [isFading, setIsFading] = useState(false);
const [phase, setPhase] = useState<'wave' | 'dark' | 'idle'>('idle');
```

### Phase System

#### Wave Phase (New Notifications Only)
- **Duration:** 3 seconds
- **Visual:** Multi-layer liquid gradient animation
- **Purpose:** Eye-catching entrance for new notifications

#### Dark Phase
- **Duration:** 3 seconds
- **Visual:** Dark pill, smaller size
- **Purpose:** Persistent but subtle reminder

#### Idle Phase
- **Trigger:** After fade-out
- **Visual:** Hidden
- **Purpose:** Clean state between notifications

### Notification Flow

#### New Notification
```
Wave (3s) → Dark (3s) → Fade (0.6s) → Idle
```

#### Manual Resurface
```
Dark (3s) → Fade (0.6s) → Idle
```
No wave animation (user triggered).

### Wave Animation Layers

#### Base Layer (Slow)
```typescript
<motion.div
  className="absolute inset-0"
  style={{
    background: 'linear-gradient(90deg, #7c3aed 0%, #ec4899 25%, #f0abfc 50%, #3b82f6 75%, #7c3aed 100%)',
    backgroundSize: '200% 100%',
  }}
  animate={{ backgroundPosition: ['0% 0%', '-200% 0%'] }}
  transition={{ duration: 3, ease: 'linear', repeat: Infinity }}
/>
```

#### Middle Layer (Medium)
```typescript
<motion.div
  className="absolute inset-0 opacity-60"
  style={{
    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 30%, rgba(236,72,153,0.6) 50%, rgba(255,255,255,0.4) 70%, transparent 100%)',
    backgroundSize: '150% 100%',
  }}
  animate={{ backgroundPosition: ['100% 0%', '-100% 0%'] }}
  transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity }}
/>
```

#### Top Shimmer (Fast)
```typescript
<motion.div
  className="absolute inset-0 opacity-40"
  style={{
    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.8) 55%, transparent 100%)',
    backgroundSize: '80% 100%',
  }}
  animate={{ backgroundPosition: ['-80% 0%', '180% 0%'] }}
  transition={{ duration: 1.5, ease: 'easeInOut', repeat: Infinity }}
/>
```

### Collapsed State

#### Size
- **Wave:** 190px × 30px
- **Dark:** 165px × 26px

#### Content
- Colored dot (type-based)
- Subtitle text (truncated)
- Unread count (+N)

### Expanded State

#### Size
- **Normal:** 280px width
- **Reply Mode:** 300px width
- **Sending:** 200px width (shrinks)

#### Content

##### Music Notification
```typescript
<div className="flex items-center gap-3">
  <div className="flex-1 min-w-0 text-left">
    <p className="text-xs font-semibold text-black truncate">
      {currentNotification?.title}
    </p>
    <p className="text-[10px] text-black/60 truncate">
      {currentNotification?.subtitle}
    </p>
  </div>
  <div className="flex gap-1.5">
    <button>+Queue</button>
    <button>♡</button>
  </div>
</div>
```

##### Message Notification
```typescript
<button onClick={handleReplyMode}>Reply</button>
```

##### System Notification
```typescript
<button onClick={() => handleAction('view')}>View</button>
```

### Reply Mode

#### Text Input
```typescript
<input
  type="text"
  value={replyText}
  onChange={handleInputChange}
  onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
  placeholder="Type..."
  className="flex-1 px-4 py-2 rounded-full bg-white/10 border-0 text-white text-[12px]"
/>
```

#### Voice Mode

##### Countdown (3, 2, 1)
```typescript
{countdown !== null ? (
  <motion.div
    key={countdown}
    initial={{ scale: 0.5, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
  >
    <span className="text-2xl font-bold text-white">{countdown}</span>
  </motion.div>
) : ...}
```

##### Recording (Live Waveform)
```typescript
<div className="flex items-center justify-center gap-1 py-2">
  {waveformLevels.map((level, i) => (
    <motion.div
      key={i}
      className="w-1 bg-purple-400 rounded-full"
      animate={{ height: level * 24 }}
      transition={{ duration: 0.1 }}
    />
  ))}
</div>
```

Uses Web Audio API:
```typescript
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 32;
const data = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(data);
```

##### Speech Recognition
```typescript
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.onresult = (event) => {
  const result = Array.from(event.results)
    .map((r) => r[0].transcript)
    .join('');
  setTranscript(result);
};
```

### Gestures

#### Collapsed
- **Tap:** Expand
- **Swipe Up:** Dismiss
- **Swipe Left/Right:** Navigate notifications

#### Expanded
- **Tap:** Collapse (back to dark)
- **Swipe Up:** Dismiss
- **Swipe Left/Right:** Navigate with wave transition

### Demo Notifications
```typescript
// Auto-triggered on load for demonstration
setTimeout(() => {
  pushNotification({
    id: '1',
    type: 'music',
    title: 'Burna Boy',
    subtitle: 'Higher just dropped'
  });
}, 1000);

setTimeout(() => {
  pushNotification({
    id: '2',
    type: 'message',
    title: 'Aziz',
    subtitle: 'yo come check this out'
  });
}, 8000);

setTimeout(() => {
  pushNotification({
    id: '3',
    type: 'system',
    title: 'VOYO',
    subtitle: 'notification system ready'
  });
}, 15000);
```

### Global API
```typescript
window.pushNotification = (notif: Notification) => {
  setNotifications(prev => [...prev, notif]);
  setCurrentIndex(prev => prev === 0 && notifications.length === 0 ? 0 : notifications.length);
  triggerNewNotification();
};
```

Backend can call:
```typescript
window.pushNotification({
  id: '123',
  type: 'message',
  title: 'John',
  subtitle: 'Check out this track!'
});
```

---

## Mode Components

### Classic Mode
```typescript
{appMode === 'classic' && (
  <motion.div
    key="classic"
    className="relative z-10 h-full"
    initial={{ opacity: 0, x: -50 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -50 }}
  >
    <ClassicMode
      onSwitchToVOYO={handleSwitchToVOYO}
      onSearch={() => setIsSearchOpen(true)}
    />
  </motion.div>
)}
```

**Features:**
- Spotify-style interface
- Home Feed, Library, Now Playing
- Slide in from left

### VOYO Mode (Portrait/Landscape)
```typescript
{appMode === 'voyo' && (
  <motion.div
    key="voyo"
    className="relative z-10 h-full flex flex-col"
    initial={{ opacity: 0, x: 50 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 50 }}
  >
    {/* Top Bar */}
    <header className="relative flex items-center justify-between px-4 py-3 flex-shrink-0">
      {/* VOYO Logo */}
      <div className="flex items-center gap-2">
        <span className="text-2xl font-black bg-gradient-to-r from-purple-400 via-pink-500 to-purple-600 bg-clip-text text-transparent">
          VOYO
        </span>
        <span className="absolute -top-1 -right-8 text-[10px] font-bold text-yellow-400">
          OYÉ
        </span>
      </div>

      {/* Center: Dynamic Island */}
      <div className="flex-1 flex justify-center">
        <DynamicIsland />
      </div>

      {/* Right: Search + Profile */}
      <div className="flex items-center gap-2">
        <button onClick={() => setIsSearchOpen(true)}>
          <Search className="w-5 h-5 text-white/70" />
        </button>
        <button onClick={() => setIsProfileOpen(true)}>
          <User className="w-5 h-5 text-white/70" />
        </button>
      </div>
    </header>

    {/* VOYO Content */}
    <div className="flex-1 overflow-hidden">
      {isLandscape ? (
        <LandscapeVOYO onVideoMode={handleVideoModeEnter} />
      ) : (
        <PortraitVOYO
          onSearch={() => setIsSearchOpen(true)}
          onDahub={() => setVoyoTab('dahub')}
          onHome={handleSwitchToClassic}
        />
      )}
    </div>
  </motion.div>
)}
```

**Features:**
- Adaptive layout (portrait/landscape)
- Dynamic Island notifications
- Search/Profile shortcuts
- Slide in from right

### Video Mode
```typescript
{appMode === 'video' && (
  <motion.div
    key="video"
    className="relative z-10 h-full"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
  >
    <VideoMode onExit={handleVideoModeExit} />
  </motion.div>
)}
```

**Features:**
- Full-screen video
- Floating reactions
- Fade transition

---

## Background System

### Dynamic Background
```typescript
{appMode !== 'video' && appMode !== 'classic' && (
  <div className="absolute inset-0 z-0">
    {/* Blurred album art */}
    {currentTrack && (
      <motion.div
        key={currentTrack.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 }}
      >
        <img
          src={getBackgroundUrl()}
          alt=""
          className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-15 scale-110"
          onError={() => setBgError(true)}
        />
      </motion.div>
    )}

    {/* Animated background */}
    <AnimatedBackground type={backgroundType} mood="vibe" />

    {/* Gradient overlay */}
    <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0f]/80 via-[#0a0a0f]/50 to-[#0a0a0f]/90" />
  </div>
)}
```

**Layers (bottom to top):**
1. Album art (blurred, 15% opacity)
2. Animated background (glow/particles/aurora/custom)
3. Dark gradient overlay (80-90% opacity)

### Fallback Logic
```typescript
const getBackgroundUrl = () => {
  if (!currentTrack) return '';
  if (bgError) {
    return getYouTubeThumbnail(currentTrack.trackId, 'high');
  }
  return currentTrack.coverUrl;
};
```

---

## Global Overlays

### Reaction Canvas
```typescript
{appMode !== 'video' && appMode !== 'classic' && (
  <ReactionCanvas />
)}
```

**Visibility:** VOYO modes only

### Audio Player
```typescript
<AudioPlayer />
```

**Scope:** Global (always active)
**Handles:** Playback via Piped API

### Search Overlay
```typescript
<SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
```

**API:** Piped API search
**Trigger:** Search button in top bar

### Background Picker
```typescript
<BackgroundPicker
  current={backgroundType}
  onSelect={setBackgroundType}
  isOpen={isBackgroundPickerOpen}
  onClose={() => setIsBackgroundPickerOpen(false)}
/>
```

**Options:** Clean, Glow, Particles, Aurora, Custom

### Universe Panel
```typescript
<UniversePanel isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
```

**Features:** Profile, Settings, Login, Backup

### Install Button
```typescript
<InstallButton />
```

**Position:** Bottom right
**Visibility:** Only when app is installable

### Offline Indicator
```typescript
<OfflineIndicator />
```

**Position:** Top center
**Visibility:** Only when offline

---

## Lifecycle Hooks

### Mobile Audio Unlock
```typescript
useEffect(() => {
  setupMobileAudioUnlock();
}, []);
```

**Purpose:** iOS requires user interaction to enable audio
**Implementation:** First tap unlocks AudioContext

### Network Detection
```typescript
useEffect(() => {
  const { detectNetworkQuality } = usePlayerStore.getState();
  detectNetworkQuality();
}, []);
```

**Timing:** On mount
**Effect:** Detects WiFi/cellular and adjusts streaming quality

### Track Pool Maintenance
```typescript
useEffect(() => {
  startPoolMaintenance();
  console.log('[VOYO] Track pool maintenance started');
}, []);
```

**Purpose:** Dynamic track management
**Frequency:** Rescoring every 5 minutes

### Mode Persistence
```typescript
useEffect(() => {
  localStorage.setItem('voyo-app-mode', appMode);
}, [appMode]);
```

**Storage:** localStorage
**Key:** `voyo-app-mode`

---

## Debug Tools

### Intent Engine Verification
```typescript
import './utils/debugIntent';
```

**Access:** Browser console
**Purpose:** Test recommendation engine

---

## Mode Switching

### Handlers
```typescript
const handleSwitchToVOYO = () => setAppMode('voyo');
const handleSwitchToClassic = () => setAppMode('classic');
const handleVideoModeEnter = () => setAppMode('video');
const handleVideoModeExit = () => setAppMode('voyo');
```

### Flow
```
Classic ←→ VOYO ←→ Video
```

**Note:** No direct Classic ↔ Video transition

---

## Watermark
```typescript
{appMode !== 'video' && (
  <div className="fixed bottom-2 right-2 z-40 opacity-30">
    <span className="text-[8px] text-white/30">
      VOYO Music by DASUPERHUB
    </span>
  </div>
)}
```

**Visibility:** All modes except Video
**Position:** Bottom right
**Opacity:** 30%

---

## Z-Index Stack

```
0   - Background (album art + animated)
10  - Main content (modes)
20  - Dynamic Island
30  - Reaction Canvas
40  - Watermark
50  - Install Button
90  - Settings panels
100 - Offline indicator
```

---

## Animation Patterns

### Mode Transitions
```typescript
// Classic: slide from left
initial={{ opacity: 0, x: -50 }}
animate={{ opacity: 1, x: 0 }}
exit={{ opacity: 0, x: -50 }}

// VOYO: slide from right
initial={{ opacity: 0, x: 50 }}
animate={{ opacity: 1, x: 0 }}
exit={{ opacity: 0, x: 50 }}

// Video: fade
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
exit={{ opacity: 0 }}
```

### Background Fade
```typescript
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
transition={{ duration: 1 }}
```

### Button Hover
```typescript
whileHover={{ scale: 1.1 }}
whileTap={{ scale: 0.9 }}
```

---

## Performance Considerations

### Mode Persistence
Saves user preference to avoid resetting on reload.

### Session Splash
Shows splash screen only once per session (sessionStorage).

### Background Optimization
- Uses CSS animations (not JavaScript)
- Blurred album art at low opacity
- Gradient overlay reduces visual complexity

### Lazy Mode Rendering
Only renders active mode (AnimatePresence with mode="wait").

---

## Responsive Design

### Orientation Handling
- **Portrait:** PortraitVOYO (vertical scrolling, bottom nav)
- **Landscape:** LandscapeVOYO (horizontal layout, side toolbar)

### Breakpoints
Handled by orientation detection, not CSS media queries.

---

## Summary

### App.tsx Responsibilities
1. **Mode Management** - Classic, VOYO, Video
2. **Global State** - Background type, UI overlays
3. **Background Rendering** - Album art + animated layers
4. **Top Bar** - Logo, Dynamic Island, actions
5. **Global Overlays** - Search, Profile, Install, Offline
6. **Audio Player** - Always active
7. **Lifecycle** - Audio unlock, network detection, track pool
8. **Persistence** - Mode, splash screen

### Main.tsx Responsibilities
1. **React Initialization** - createRoot, StrictMode
2. **Routing** - BrowserRouter, route definitions
3. **Entry Point** - Mounts app to DOM

---

**Last Updated:** December 2024
**VOYO Music Version:** 1.2.0
