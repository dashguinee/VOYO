# VOYO Music - UI Components Documentation

This document provides comprehensive documentation for all reusable UI components in the VOYO Music app.

---

## 1. InstallButton

**File:** `/home/dash/voyo-music/src/components/ui/InstallButton.tsx`

### Purpose
Subtle PWA install button that appears only when the app is installable and not yet installed.

### Props
None - uses `usePWA()` hook internally.

### Styling Patterns

#### Container
```typescript
className: "fixed bottom-24 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-md"
style: {
  background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(236,72,153,0.2) 100%)',
  border: '1px solid rgba(139,92,246,0.3)',
  boxShadow: '0 4px 20px rgba(139,92,246,0.15)',
}
```

#### Animations
- **Initial:** `{ opacity: 0, y: 20 }`
- **Animate:** `{ opacity: 1, y: 0 }`
- **Transition:** `{ duration: 0.3, delay: 2 }` (2 second delay before showing)
- **Hover:** `scale: 1.05`, enhanced shadow
- **Tap:** `scale: 0.95`

#### SVG Icons
1. **VOYO Logo** (20x20)
   - Purple to pink gradient
   - Path: "V" shape + dot

2. **Download Arrow** (14x14)
   - Purple stroke
   - Arrow down with horizontal line

#### Text
- Gradient text: Purple to pink
- `WebkitBackgroundClip: 'text'`
- `WebkitTextFillColor: 'transparent'`

### Reusability
- Self-contained, no props needed
- Uses PWA detection hook
- Can be placed anywhere with `fixed` positioning

---

## 2. OfflineIndicator

**File:** `/home/dash/voyo-music/src/components/ui/OfflineIndicator.tsx`

### Purpose
Shows network connectivity status - displays when user goes offline or comes back online.

### Props
None - uses browser `navigator.onLine` API.

### State Management
```typescript
const [isOffline, setIsOffline] = useState(!navigator.onLine);
const [showReconnected, setShowReconnected] = useState(false);
```

### Styling Patterns

#### Offline State
```typescript
className: "fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-orange-500 text-white px-4 py-2 rounded-full shadow-lg shadow-orange-500/30 flex items-center gap-2"
```
- Orange background with shadow
- Icon: `WifiOff` (14px)

#### Online State
```typescript
className: "fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-green-500 text-white px-4 py-2 rounded-full shadow-lg shadow-green-500/30 flex items-center gap-2"
```
- Green background with shadow
- Icon: `Wifi` (14px)

### Animations
- **Initial:** `{ y: -50, opacity: 0 }`
- **Animate:** `{ y: 0, opacity: 1 }`
- **Transition:** `{ type: 'spring', damping: 20 }`

### Auto-dismiss Logic
- Reconnected message shows for 3 seconds
- Uses `setTimeout` with cleanup

### Reusability
- Zero configuration
- Global component, place once in app
- Handles all network change events

---

## 3. BoostButton

**File:** `/home/dash/voyo-music/src/components/ui/BoostButton.tsx`

### Purpose
One-button solution for HD download + audio enhancement. Lightning icon glows when boosted, pulses during download.

### Props
```typescript
interface BoostButtonProps {
  variant?: 'toolbar' | 'floating' | 'mini' | 'inline';
  className?: string;
}
```

### Variants

#### 1. Toolbar (Default)
- **Size:** 44x44px circular button
- **Position:** Fits alongside Like/Settings buttons
- **Use case:** Right toolbar in player UI

#### 2. Floating
- **Size:** 48x48px standalone
- **Position:** Ergonomic thumb position
- **Use case:** Floating action button

#### 3. Mini
- **Size:** 32x32px compact
- **Use case:** Tight spaces, list items

#### 4. Inline
- **Layout:** Horizontal (icon + text)
- **Use case:** Settings, action sheets

### Boost Presets (Color Themes)

#### Boosted (Yellow)
```typescript
{
  primary: '#fbbf24',
  secondary: '#f59e0b',
  light: '#fde047',
  glow: 'rgba(251,191,36,0.6)',
  bg: 'bg-yellow-500/30',
  border: 'border-yellow-400/60',
  shadow: 'shadow-yellow-500/30',
  text: 'text-yellow-400'
}
```

#### Calm (Blue)
```typescript
{
  primary: '#3b82f6',
  secondary: '#1d4ed8',
  light: '#60a5fa',
  glow: 'rgba(59,130,246,0.6)',
  bg: 'bg-blue-500/30',
  border: 'border-blue-400/60',
  shadow: 'shadow-blue-500/30',
  text: 'text-blue-400'
}
```

#### VOYEX (Purple)
```typescript
{
  primary: '#a855f7',
  secondary: '#7c3aed',
  light: '#c084fc',
  glow: 'rgba(168,85,247,0.6)',
  bg: 'bg-purple-500/30',
  border: 'border-purple-400/60',
  shadow: 'shadow-purple-500/30',
  text: 'text-purple-400'
}
```

#### Xtreme (Red)
```typescript
{
  primary: '#ef4444',
  secondary: '#dc2626',
  light: '#f87171',
  glow: 'rgba(239,68,68,0.6)',
  bg: 'bg-red-500/30',
  border: 'border-red-400/60',
  shadow: 'shadow-red-500/30',
  text: 'text-red-400'
}
```

### Sub-Components

#### LightningIcon
- SVG lightning bolt (customizable size)
- Dynamic color based on preset
- Glow effect when active
- Charging pulse animation

#### ProgressRing
- Circular progress indicator
- **Priming Phase:** 2 full spins (0-400ms each)
- **Progress Phase:** Actual download progress
- Size-responsive (default 44px)

#### CompletionBurst
- Radial explosion animation
- Duration: 800ms
- Scale: 1 → 2.2
- Opacity fade out

#### BoostSparks
- 6 particle system
- Random trajectory within 40px radius
- Staggered delays (0.1s intervals)
- Infinite loop with 1s pause

### State Logic
```typescript
const [isBoosted, setIsBoosted] = useState(false);      // Has been boosted
const [usingBoosted, setUsingBoosted] = useState(true); // Currently using boosted
```

- **Active:** `isBoosted && usingBoosted` - Lightning glows
- **Toggled:** `isBoosted && !usingBoosted` - Dimmed (using original)
- **Downloading:** Progress ring visible

### Animation Patterns

#### Hover (Toolbar)
```typescript
whileHover={{ scale: 1.15, y: -2 }}
```

#### Tap
```typescript
whileTap={{ scale: 0.9 }}
```

#### Glow Pulse (Active State)
```typescript
animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0.8, 0.5] }}
transition={{ duration: 2, repeat: Infinity }}
```

### Reusability
- 4 size variants for different contexts
- Dynamic color preset system
- Self-contained download management
- Stores integration via `usePlayerStore` and `useDownloadStore`

---

## 4. SmartImage

**File:** `/home/dash/voyo-music/src/components/ui/SmartImage.tsx`

### Purpose
Bulletproof image loading with fallback chains, skeleton loading, and caching. **NEVER shows broken images.**

### Props
```typescript
interface SmartImageProps {
  src: string;                // Primary image URL
  alt: string;                // Alt text
  className?: string;         // Custom styling
  fallbackSrc?: string;       // Explicit fallback URL
  placeholderColor?: string;  // Skeleton color (default: '#1a1a1a')
  trackId?: string;           // For YouTube thumbnail fallback chain
  lazy?: boolean;             // Enable lazy loading (default: true)
  onLoad?: () => void;        // Success callback
  onError?: () => void;       // Error callback
}
```

### Load Cascade (5-Step Fallback)

1. **Cache Check** - If `trackId` provided, check cached thumbnail
2. **Primary Source** - Try `src` prop
3. **Fallback Chain** - If `trackId`, try YouTube thumbnail qualities
4. **Explicit Fallback** - Try `fallbackSrc` prop
5. **Generated Placeholder** - Canvas-based placeholder with text

### State Management
```typescript
type LoadState = 'loading' | 'loaded' | 'error';
const [loadState, setLoadState] = useState<LoadState>('loading');
const [currentSrc, setCurrentSrc] = useState<string>('');
const [isInView, setIsInView] = useState(!lazy);
```

### Lazy Loading
- Uses `IntersectionObserver`
- `rootMargin: '50px'` - starts loading 50px before entering viewport
- Disconnects after loading

### Skeleton Animation
```typescript
// Gradient sweep effect
background: `linear-gradient(
  90deg,
  transparent 0%,
  rgba(255, 255, 255, 0.05) 50%,
  transparent 100%
)`
animate: { x: ['-100%', '100%'] }
transition: { duration: 1.5, repeat: Infinity, ease: 'linear' }
```

### Caching Integration
```typescript
getCachedThumbnail(trackId)  // Read from cache
cacheThumbnail(trackId, url) // Write to cache
```

### Optimization
- **Memoized** with `React.memo`
- **Stable refs** for callbacks to avoid re-renders
- **Previous src tracking** prevents unnecessary reloads

### Reusability
- Works standalone or with YouTube tracks
- Configurable fallback chains
- Automatic caching
- Lazy loading built-in
- Never breaks UI with missing images

---

## 5. BoostSettings

**File:** `/home/dash/voyo-music/src/components/ui/BoostSettings.tsx`

### Purpose
Full settings panel for Boost feature management - presets, auto-boost, download settings, storage.

### Props
```typescript
interface BoostSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}
```

### Layout Structure
```
┌─────────────────────────────┐
│ Handle (drag to dismiss)    │
├─────────────────────────────┤
│ Header (Icon + Title)       │
├─────────────────────────────┤
│ ┌─ Audio Enhancement ─────┐ │
│ │ [Warm][Calm][VOYEX][Xtr]│ │
│ └─────────────────────────┘ │
│ ┌─ Auto-Boost Toggle ─────┐ │
│ │ Download as you play [●]│ │
│ └─────────────────────────┘ │
│ ┌─ Download When ─────────┐ │
│ │ [Always][WiFi][Never]   │ │
│ └─────────────────────────┘ │
│ ┌─ OYÉ Bar Behavior ──────┐ │
│ │ [Fade][Disappear]       │ │
│ └─────────────────────────┘ │
│ ┌─ Storage Used ──────────┐ │
│ │ Progress Bar            │ │
│ │ [Clear All Tracks]      │ │
│ └─────────────────────────┘ │
│ ┌─ Recently Boosted ──────┐ │
│ │ Track list (max 5)      │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

### Audio Enhancement Presets

#### Grid Layout
```typescript
grid-cols-4 gap-1.5
```

Each preset button shows:
- **Icon** (Zap, Crown, Flame)
- **Label** (Warm, Calm, VOYEX, Xtreme)
- **Description** (Bass Boost, Relaxed, Full Exp, Max Bass)

#### Preset Details
1. **Warm (Boosted)** - Yellow gradient, bass boost, speaker protection
2. **Calm** - Blue gradient, inverted faded lightning icon, relaxed listening
3. **VOYEX** - Purple gradient, crown icon, full spectrum experience
4. **Xtreme** - Red gradient, flame icon, maximum bass with limiter

### Auto-Boost Toggle
- Animated switch (12px wide, 7px tall)
- Circle slides left/right
- Spring animation: `{ stiffness: 500, damping: 30 }`
- Shows manual boost count

### Download Settings (3 Options)
1. **Always** - Download anytime
2. **WiFi Only** - Only on WiFi networks
3. **Never** - Manual boost only

### OYÉ Bar Behavior (2 Options)
1. **Fade** - Always visible (signature)
2. **Disappear** - Hides after tap (clean look)

### Storage Management

#### Display
- Total tracks count
- Size in readable format (MB/GB)
- Progress bar (max 500MB visual)

#### Clear Confirmation Dialog
- Overlay backdrop
- Confirmation message with stats
- Two-step process (confirm → clear)
- Loading state during clearing

### Animations

#### Panel Entry
```typescript
initial={{ y: '100%' }}
animate={{ y: 0 }}
transition={{ type: 'spring', damping: 25, stiffness: 300 }}
```

#### Button Interactions
```typescript
whileHover={{ scale: 1.02 }}
whileTap={{ scale: 0.98 }}
```

### Companion Component: BoostSettingsButton
```typescript
export const BoostSettingsButton = ({ onClick }: { onClick: () => void })
```
- Compact 2px button
- Settings icon (14px)
- For use in player UI

### Reusability
- Modal overlay pattern
- Bottom sheet design
- Scrollable content area
- Self-contained state management
- Store integration for persistence

---

## 6. BoostIndicator

**File:** `/home/dash/voyo-music/src/components/ui/BoostIndicator.tsx`

### Purpose
Shows playback source quality status with color-coded badges.

### Props
None - reads from `usePlayerStore` and `useDownloadStore`.

### Playback Sources

#### 1. Cached (Boosted)
```typescript
<div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30">
  <Zap size={12} className="text-purple-400" />
  <span className="text-[10px] font-medium text-purple-300 uppercase tracking-wider">
    Boosted
  </span>
</div>
```
- **Color:** Purple/Pink gradient
- **Icon:** Lightning bolt
- **Status:** Highest quality, offline-ready

#### 2. Direct (HQ Stream)
```typescript
<div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20">
  <Wifi size={12} className="text-green-400" />
  <span className="text-[10px] font-medium text-green-300 uppercase tracking-wider">
    HQ Stream
  </span>
</div>
```
- **Color:** Green
- **Icon:** WiFi
- **Status:** High quality stream

#### 3. IFrame (Standard)
```typescript
<div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
  <Download size={12} className="text-amber-400" />
  <span className="text-[10px] font-medium text-amber-300 uppercase tracking-wider">
    Standard
  </span>
</div>
```
- **Color:** Amber/Yellow
- **Icon:** Download
- **Status:** Standard quality (being boosted in background)

### Download Progress
When track is actively downloading:
```typescript
<Download size={12} className="text-amber-400 animate-pulse" />
<span>Boosting {downloadProgress}%</span>
```

### Animations
```typescript
key={playbackSource}
initial={{ opacity: 0, scale: 0.8 }}
animate={{ opacity: 1, scale: 1 }}
exit={{ opacity: 0, scale: 0.8 }}
```

### Compact Variant
```typescript
export const BoostIndicatorCompact = () => { ... }
```
- Icon only (no text)
- 14px size
- Tooltip on hover
- For minimal UI spaces

### Reusability
- Two variants (full, compact)
- Zero props (reads global state)
- Auto-updates on playback source change
- Shows live download progress

---

## Summary Table

| Component | File | Purpose | Variants | Key Features |
|-----------|------|---------|----------|--------------|
| **InstallButton** | `InstallButton.tsx` | PWA install prompt | 1 | Auto-shows when installable, 2s delay, gradient design |
| **OfflineIndicator** | `OfflineIndicator.tsx` | Network status | 2 (offline/online) | Auto-detect, spring animation, 3s dismiss |
| **BoostButton** | `BoostButton.tsx` | HD download + enhance | 4 (toolbar/floating/mini/inline) | 4 color presets, progress ring, sparks animation |
| **SmartImage** | `SmartImage.tsx` | Bulletproof images | 1 | 5-step fallback, lazy load, skeleton, caching |
| **BoostSettings** | `BoostSettings.tsx` | Boost management | 1 + button | 4 presets, auto-boost, storage, OYÉ bar behavior |
| **BoostIndicator** | `BoostIndicator.tsx` | Playback quality | 2 (full/compact) | 3 sources, live progress, color-coded |

---

## Common Styling Patterns

### Backdrop Blur
```typescript
className="backdrop-blur-md"  // Most UI overlays
className="backdrop-blur-xl"  // Settings panels
```

### Glass Morphism
```typescript
bg-black/50          // Semi-transparent dark
border-white/10      // Subtle border
shadow-lg            // Elevated shadow
```

### Gradient Backgrounds
```typescript
// Purple to Pink (brand colors)
background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(236,72,153,0.2) 100%)'

// Multi-color (boost presets)
from-purple-500/20 to-pink-500/20
```

### Text Gradients
```typescript
background: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
WebkitBackgroundClip: 'text',
WebkitTextFillColor: 'transparent'
```

### Rounded Corners
```typescript
rounded-full     // Pills, buttons
rounded-xl       // Cards, inputs
rounded-2xl      // Panels, modals
rounded-3xl      // Bottom sheets
```

### Z-Index Layers
```typescript
z-10    // Main content
z-20    // Floating elements
z-40    // Watermark
z-50    // Install button
z-[90]  // Settings panel
z-[100] // Offline indicator
```

---

## Animation Guidelines

### Framer Motion Conventions

#### Standard Entry/Exit
```typescript
initial={{ opacity: 0, scale: 0.8 }}
animate={{ opacity: 1, scale: 1 }}
exit={{ opacity: 0, scale: 0.8 }}
```

#### Button Interactions
```typescript
whileHover={{ scale: 1.05 }}
whileTap={{ scale: 0.95 }}
```

#### Spring Animations
```typescript
transition={{ type: 'spring', damping: 25, stiffness: 300 }}
```

#### Stagger Children
```typescript
transition={{ staggerChildren: 0.1 }}
```

---

## Store Integration

### usePlayerStore
```typescript
const { currentTrack, playbackSource, boostProfile, oyeBarBehavior } = usePlayerStore();
```

### useDownloadStore
```typescript
const {
  boostTrack,
  getDownloadStatus,
  downloads,
  isTrackBoosted,
  cachedTracks,
  cacheSize
} = useDownloadStore();
```

### usePWA
```typescript
const { isInstallable, isInstalled, install } = usePWA();
```

---

**Last Updated:** December 2024
**VOYO Music Version:** 1.2.0
