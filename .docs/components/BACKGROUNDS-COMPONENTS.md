# VOYO Music - Background Components Documentation

This document provides comprehensive documentation for all background and visual effects components in the VOYO Music app.

---

## Overview

**File:** `/home/dash/voyo-music/src/components/backgrounds/AnimatedBackgrounds.tsx`

The backgrounds system provides ambient visual experiences that adapt to the music. All backgrounds are mobile-optimized using pure CSS animations with GPU acceleration for smooth 60fps performance.

---

## Background Types

```typescript
export type BackgroundType = 'glow' | 'particles' | 'aurora' | 'none' | 'custom';
export type CustomAnimation = 'none' | 'zoom' | 'pan';
```

---

## 1. ReactionCanvas

### Purpose
Shows emoji reactions when users tap reaction buttons. Reactions float up from tap position and fade out.

### Component Structure
```typescript
export const ReactionCanvas = () => {
  const { reactions } = usePlayerStore();
  // ...
}
```

### Reaction Object
```typescript
interface Reaction {
  id: string;
  type: 'oyo' | 'oye' | 'fire' | 'wazzguan';
  emoji?: string;        // Custom emoji (overrides type default)
  x?: number;           // Horizontal position (0-100%)
  multiplier?: number;  // Combo multiplier
}
```

### Positioning Logic
```typescript
// Use stored x position or derive stable position from ID
const xPos = reaction.x || 50;
const xOffset = getStableOffset(reaction.id);

// Stable offset based on ID hash (prevents jitter)
const getStableOffset = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return ((hash % 100) - 50) * 1.2; // Range: -60 to 60
};
```

### Animation Pattern
```typescript
initial={{ y: 0, opacity: 1, scale: 0.5 }}
animate={{
  y: -250,                      // Float up 250px
  opacity: [1, 1, 0.8, 0],     // Fade out at end
  scale: [0.5, 1.3, 1],        // Grow then normalize
  x: xOffset,                   // Drift horizontally
}}
transition={{
  duration: 2.5,
  ease: 'easeOut',
}}
```

### Emoji Mapping
```typescript
reaction.emoji || (
  reaction.type === 'oyo' ? '👋' :
  reaction.type === 'oye' ? '🎉' :
  reaction.type === 'fire' ? '🔥' :
  reaction.type === 'wazzguan' ? '🤙' :
  '✨'
)
```

### Multiplier Display
```typescript
{reaction.multiplier > 1 && (
  <span className="text-lg ml-1 text-yellow-400 font-bold">
    x{reaction.multiplier}
  </span>
)}
```

### Styling
```typescript
className="absolute inset-0 overflow-hidden pointer-events-none z-30"
```
- **Position:** Full screen overlay
- **Z-index:** 30 (above backgrounds, below UI)
- **Pointer Events:** None (doesn't block interactions)

---

## 2. AmbientGlow

### Purpose
Clean, cinematic ambient glow effect. Two-layer radial gradient system with breathing animation.

### Mobile Optimization
Uses pure CSS animations instead of Framer Motion for better performance on mobile devices.

### Layer 1: Center Glow (Purple)
```typescript
<div
  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100%] h-[100%] rounded-full animate-ambient-breathe"
  style={{
    background: 'radial-gradient(ellipse at center, rgba(147, 51, 234, 0.12) 0%, transparent 60%)',
    willChange: 'transform, opacity',
  }}
/>
```
- **Color:** Purple (#9333ea)
- **Opacity:** 12%
- **Gradient:** Radial, 60% spread
- **Animation:** `animate-ambient-breathe` (CSS keyframe)

### Layer 2: Secondary Glow (Pink)
```typescript
<div
  className="absolute top-1/3 right-1/4 w-[60%] h-[60%] rounded-full animate-ambient-secondary"
  style={{
    background: 'radial-gradient(ellipse at center, rgba(219, 39, 119, 0.08) 0%, transparent 50%)',
    willChange: 'transform',
    animation: 'ambient-secondary 8s ease-in-out infinite',
  }}
/>
```
- **Color:** Pink (#db2777)
- **Opacity:** 8%
- **Gradient:** Radial, 50% spread
- **Animation:** 8s duration, different timing from Layer 1

### Performance
- `willChange` for GPU acceleration
- CSS animations (no JavaScript overhead)
- Blur-free (no expensive filters)

---

## 3. ParticleField

### Purpose
Floating particles that drift upward in random paths, creating a dreamy atmosphere.

### Particle Generation
```typescript
const particles = Array.from({ length: 25 }, (_, i) => {
  const left = Math.random() * 100;           // Random horizontal: 0-100%
  const size = 2 + Math.random() * 2;         // Size: 2-4px
  const duration = 8 + Math.random() * 8;     // Duration: 8-16s
  const delay = Math.random() * 8;            // Delay: 0-8s
  const xDrift = (Math.random() - 0.5) * 100; // Drift: -50 to 50px

  // Random color from palette
  const colors = [
    'rgba(147, 51, 234, 0.6)',   // Purple
    'rgba(168, 85, 247, 0.6)',   // Light purple
    'rgba(219, 39, 119, 0.6)',   // Pink
    'rgba(236, 72, 153, 0.6)',   // Light pink
    'rgba(192, 132, 252, 0.5)',  // Violet
  ];
  const color = colors[Math.floor(Math.random() * colors.length)];

  return { id: i, left, size, duration, delay, xDrift, color };
});
```

### CSS Animation (Keyframe)
```css
@keyframes particle-float {
  0% {
    transform: translateY(0) translateX(0);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  90% {
    opacity: 1;
  }
  100% {
    transform: translateY(-100vh) translateX(var(--x-drift));
    opacity: 0;
  }
}
```

### Particle Rendering
```typescript
<div
  className="absolute rounded-full"
  style={{
    left: particle.left,
    bottom: '-10px',
    width: particle.size,
    height: particle.size,
    backgroundColor: particle.color,
    boxShadow: `0 0 ${parseInt(particle.size) * 2}px ${particle.color}`,
    animation: `particle-float ${particle.duration} linear ${particle.delay} infinite`,
    willChange: 'transform, opacity',
    '--x-drift': particle.xDrift,
  }}
/>
```

### Performance
- 25 particles (balanced visual/performance)
- Pure CSS animation
- GPU-accelerated transforms
- Staggered delays for natural flow

---

## 4. AuroraEffect

### Purpose
Dreamy Northern Lights effect with 4 overlapping color layers that wave and shimmer.

### Layer Structure
```
Layer 4 (Bottom) - Purple Curtain
Layer 3 (Top)    - Teal Accent
Layer 2 (Full)   - Pink to Blue
Layer 1 (Full)   - Purple to Teal
Shimmer (Full)   - White Overlay
```

### Layer 1: Purple to Teal
```typescript
<div
  className="absolute inset-0"
  style={{
    background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.15) 0%, rgba(20, 184, 166, 0.1) 50%, transparent 100%)',
    filter: 'blur(60px)',
    transform: 'translateY(0%) scale(1.2)',
    animation: 'aurora-wave-1 12s ease-in-out infinite',
    willChange: 'transform, opacity',
  }}
/>
```
- **Duration:** 12s
- **Blur:** 60px
- **Motion:** Translate + rotate + scale

### Layer 2: Pink to Blue
```typescript
<div
  className="absolute inset-0"
  style={{
    background: 'linear-gradient(225deg, rgba(236, 72, 153, 0.12) 0%, rgba(59, 130, 246, 0.08) 50%, transparent 100%)',
    filter: 'blur(70px)',
    transform: 'translateY(0%) scale(1.1)',
    animation: 'aurora-wave-2 15s ease-in-out infinite',
    animationDelay: '2s',
    willChange: 'transform, opacity',
  }}
/>
```
- **Duration:** 15s
- **Blur:** 70px
- **Delay:** 2s (out of phase with Layer 1)

### Layer 3: Teal Accent (Top 70%)
```typescript
<div
  className="absolute top-0 left-0 right-0 h-[70%]"
  style={{
    background: 'linear-gradient(180deg, rgba(20, 184, 166, 0.1) 0%, rgba(168, 85, 247, 0.08) 60%, transparent 100%)',
    filter: 'blur(80px)',
    transform: 'translateX(0%)',
    animation: 'aurora-wave-3 18s ease-in-out infinite',
    animationDelay: '4s',
    willChange: 'transform, opacity',
  }}
/>
```
- **Duration:** 18s
- **Blur:** 80px
- **Delay:** 4s

### Layer 4: Purple Curtain (Bottom 60%)
```typescript
<div
  className="absolute bottom-0 left-0 right-0 h-[60%]"
  style={{
    background: 'linear-gradient(0deg, rgba(139, 92, 246, 0.12) 0%, rgba(236, 72, 153, 0.06) 50%, transparent 100%)',
    filter: 'blur(90px)',
    transform: 'translateX(0%)',
    animation: 'aurora-wave-4 20s ease-in-out infinite',
    animationDelay: '6s',
    willChange: 'transform, opacity',
  }}
/>
```
- **Duration:** 20s
- **Blur:** 90px
- **Delay:** 6s

### Shimmer Overlay
```typescript
<div
  className="absolute inset-0"
  style={{
    background: 'radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0.03) 0%, transparent 60%)',
    animation: 'aurora-shimmer 8s ease-in-out infinite',
    willChange: 'opacity',
  }}
/>
```
- **Duration:** 8s
- **Effect:** Subtle white glow pulsing

### CSS Keyframes

#### Wave 1
```css
@keyframes aurora-wave-1 {
  0%, 100% {
    transform: translateY(0%) translateX(0%) scale(1.2) rotate(0deg);
    opacity: 1;
  }
  25% {
    transform: translateY(-8%) translateX(5%) scale(1.25) rotate(1deg);
    opacity: 0.9;
  }
  50% {
    transform: translateY(-5%) translateX(-3%) scale(1.15) rotate(-1deg);
    opacity: 1;
  }
  75% {
    transform: translateY(-10%) translateX(3%) scale(1.22) rotate(0.5deg);
    opacity: 0.95;
  }
}
```

#### Wave 2, 3, 4
Similar patterns with different percentages and timings.

#### Shimmer
```css
@keyframes aurora-shimmer {
  0%, 100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.7;
  }
}
```

### Performance
- Pure CSS animations
- Multiple blur layers (may be heavy on low-end devices)
- Staggered delays for complex motion
- `willChange` hints for GPU

---

## 5. CustomBackdrop

### Purpose
User-uploaded image as background with customizable blur, brightness, and animation.

### LocalStorage Keys
```typescript
const STORAGE_KEYS = {
  IMAGE: 'voyo_custom_backdrop',
  BLUR: 'voyo_custom_blur',
  ANIMATION: 'voyo_custom_animation',
  BRIGHTNESS: 'voyo_custom_brightness',
};
```

### State Management
```typescript
const [imageData, setImageData] = useState<string | null>(null);     // Base64 image
const [blur, setBlur] = useState<number>(10);                        // 0-20px
const [animation, setAnimation] = useState<CustomAnimation>('none'); // none/zoom/pan
const [brightness, setBrightness] = useState<number>(0.5);           // 0-1
```

### Animation Classes

#### Zoom
```typescript
animation: 'animate-backdrop-zoom'
```
- Slow zoom in/out effect

#### Pan
```typescript
animation: 'animate-backdrop-pan'
```
- Horizontal panning motion

#### None
```typescript
animation: ''
```
- Static image

### Rendering
```typescript
<div
  className={`absolute inset-0 bg-cover bg-center ${getAnimationStyle()}`}
  style={{
    backgroundImage: `url(${imageData})`,
    filter: `blur(${blur}px) brightness(${brightness})`,
    willChange: animation !== 'none' ? 'transform' : 'auto',
  }}
/>
```

### Overlay
```typescript
<div className="absolute inset-0 bg-black/40" />
```
- 40% black overlay to maintain text readability

### Fallback
If no image uploaded, falls back to `AmbientGlow`.

---

## 6. CustomBackdropSettings

### Purpose
Modal panel for configuring custom backdrop - upload image, adjust blur/brightness, choose animation.

### Props
```typescript
interface CustomBackdropSettingsProps {
  onClose: () => void;
}
```

### Layout Structure
```
┌───────────────────────────────┐
│ Handle (drag indicator)       │
├───────────────────────────────┤
│ Custom Backdrop               │
├───────────────────────────────┤
│ [Preview Window]              │
├───────────────────────────────┤
│ Background Image              │
│ [Upload Image] [Remove]       │
├───────────────────────────────┤
│ Blur: 10px                    │
│ ─────●─────────               │
├───────────────────────────────┤
│ Brightness: 50%               │
│ ─────●─────────               │
├───────────────────────────────┤
│ Animation                     │
│ [None] [Zoom] [Pan]           │
├───────────────────────────────┤
│ [Done]                        │
└───────────────────────────────┘
```

### Image Upload
```typescript
const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target?.result as string;
    setImageData(base64);
    localStorage.setItem(STORAGE_KEYS.IMAGE, base64);
  };
  reader.readAsDataURL(file);
};
```

### Preview Window
```typescript
<div className="mb-6 relative rounded-2xl overflow-hidden h-40 border border-white/10">
  <div
    className="absolute inset-0 bg-cover bg-center"
    style={{
      backgroundImage: `url(${imageData})`,
      filter: `blur(${blur}px) brightness(${brightness})`,
    }}
  />
  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
    <span className="text-white/80 text-sm">Preview</span>
  </div>
</div>
```

### Blur Control
```typescript
<input
  type="range"
  min="0"
  max="20"
  value={blur}
  onChange={(e) => handleBlurChange(Number(e.target.value))}
  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer slider-thumb"
/>
```
- Range: 0-20px
- Saved to localStorage on change

### Brightness Control
```typescript
<input
  type="range"
  min="0"
  max="1"
  step="0.05"
  value={brightness}
  onChange={(e) => handleBrightnessChange(Number(e.target.value))}
  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer slider-thumb"
/>
```
- Range: 0-100%
- Step: 5%
- Saved to localStorage on change

### Animation Buttons
```typescript
{(['none', 'zoom', 'pan'] as CustomAnimation[]).map((anim) => (
  <button
    key={anim}
    onClick={() => handleAnimationChange(anim)}
    className={`flex-1 px-4 py-3 rounded-xl font-medium transition-colors capitalize ${
      animation === anim
        ? 'bg-purple-500/30 border border-purple-500/50 text-purple-300'
        : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
    }`}
  >
    {anim}
  </button>
))}
```

### Remove Image
```typescript
const handleRemoveImage = () => {
  setImageData(null);
  localStorage.removeItem(STORAGE_KEYS.IMAGE);
};
```

### Panel Animation
```typescript
initial={{ y: '100%' }}
animate={{ y: 0 }}
exit={{ y: '100%' }}
transition={{ type: 'spring', damping: 25, stiffness: 300 }}
```

---

## 7. BackgroundPicker

### Purpose
Modal selector for choosing background type. Shows when user wants to change background vibe.

### Props
```typescript
interface BackgroundPickerProps {
  current: BackgroundType;
  onSelect: (type: BackgroundType) => void;
  isOpen: boolean;
  onClose: () => void;
}
```

### Background Options
```typescript
const options: { type: BackgroundType; label: string; icon: string }[] = [
  { type: 'none', label: 'Clean', icon: '🌑' },
  { type: 'glow', label: 'Glow', icon: '💜' },
  { type: 'particles', label: 'Particles', icon: '✨' },
  { type: 'aurora', label: 'Aurora', icon: '🌌' },
  { type: 'custom', label: 'Custom', icon: '🖼️' },
];
```

### Layout
```
┌─────────────────────┐
│ Handle              │
├─────────────────────┤
│ Background          │
├─────────────────────┤
│ 🌑      💜          │
│ Clean   Glow        │
│                     │
│ ✨      🌌          │
│ Particles Aurora    │
│                     │
│ 🖼️                  │
│ Custom              │
└─────────────────────┘
```

### Grid Layout
```typescript
<div className="grid grid-cols-2 gap-4">
  {options.map(option => (
    <motion.button
      key={option.type}
      className={`flex flex-col items-center gap-2 p-4 rounded-2xl transition-colors ${
        current === option.type
          ? 'bg-purple-500/30 border border-purple-500/50'
          : 'bg-white/5 border border-white/10 hover:bg-white/10'
      }`}
      onClick={() => handleSelect(option.type)}
      whileTap={{ scale: 0.95 }}
    >
      <span className="text-3xl">{option.icon}</span>
      <span className="text-sm text-white/70 font-medium">{option.label}</span>
    </motion.button>
  ))}
</div>
```

### Custom Background Flow
```typescript
const handleSelect = (type: BackgroundType) => {
  if (type === 'custom') {
    // Show custom settings instead of closing
    setShowCustomSettings(true);
    onSelect(type);
  } else {
    onSelect(type);
    onClose();
  }
};
```

When "Custom" is selected, `BackgroundPicker` transitions to `CustomBackdropSettings`.

### Panel Animation
```typescript
initial={{ y: '100%' }}
animate={{ y: 0 }}
exit={{ y: '100%' }}
transition={{ type: 'spring', damping: 25, stiffness: 300 }}
```

---

## 8. AnimatedBackground (Main Export)

### Purpose
Wrapper component that renders the selected background type.

### Props
```typescript
interface AnimatedBackgroundProps {
  type: BackgroundType;
  mood?: 'chill' | 'hype' | 'vibe' | 'focus';  // Reserved for future use
}
```

### Switch Logic
```typescript
export const AnimatedBackground = ({ type }: AnimatedBackgroundProps) => {
  switch (type) {
    case 'glow':
      return <AmbientGlow />;
    case 'particles':
      return <ParticleField />;
    case 'aurora':
      return <AuroraEffect />;
    case 'custom':
      return <CustomBackdrop />;
    case 'none':
    default:
      return null;
  }
};
```

### Usage in App
```typescript
<AnimatedBackground type={backgroundType} mood="vibe" />
```

---

## Performance Considerations

### Mobile Optimization Strategy
All backgrounds use **pure CSS animations** instead of JavaScript-based Framer Motion for core animation loops:

#### Benefits
1. **GPU Acceleration** - Browser handles animation on GPU thread
2. **No JavaScript Overhead** - Animations run independently of React re-renders
3. **Smooth 60fps** - CSS animations are optimized by browser engines
4. **Battery Efficient** - Less CPU usage

#### `willChange` Hints
```typescript
willChange: 'transform, opacity'  // Tell browser to optimize these properties
```

### Blur Performance
Aurora effect uses **multiple blur layers** (60-90px), which can be expensive:
- Consider reducing blur on low-end devices
- Future: Add performance detection and auto-adjust

### Particle Count
ParticleField uses **25 particles** - balanced for visual appeal vs. performance:
- More particles = richer effect but slower
- Fewer particles = faster but less immersive

### Image Optimization
CustomBackdrop stores **Base64 images** in localStorage:
- Consider file size limits (typically 5-10MB)
- Compress images before upload
- Future: Add automatic compression

---

## CSS Keyframes Reference

### Ambient Breathe (not shown in code, assumed)
```css
@keyframes ambient-breathe {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.1); opacity: 0.7; }
}
```

### Ambient Secondary
```css
@keyframes ambient-secondary {
  0%, 100% { transform: translateX(0%); }
  50% { transform: translateX(10%); }
}
```

### Particle Float
```css
@keyframes particle-float {
  0% { transform: translateY(0) translateX(0); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateY(-100vh) translateX(var(--x-drift)); opacity: 0; }
}
```

### Aurora Waves (1-4)
Each wave has unique transform pattern with translate, scale, and rotate.

### Backdrop Zoom (assumed)
```css
@keyframes backdrop-zoom {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}
```

### Backdrop Pan (assumed)
```css
@keyframes backdrop-pan {
  0%, 100% { transform: translateX(0%); }
  50% { transform: translateX(-5%); }
}
```

---

## Summary Table

| Component | Purpose | Performance | Customizable | Storage |
|-----------|---------|-------------|--------------|---------|
| **ReactionCanvas** | Emoji reactions | JavaScript (Framer) | Emoji, position | None |
| **AmbientGlow** | Cinematic glow | CSS (optimal) | No | None |
| **ParticleField** | Floating particles | CSS (optimal) | No | None |
| **AuroraEffect** | Northern Lights | CSS (heavy blur) | No | None |
| **CustomBackdrop** | User image | CSS animation | Yes | localStorage (Base64) |
| **CustomBackdropSettings** | Image config | N/A (UI only) | N/A | localStorage |
| **BackgroundPicker** | Type selector | N/A (UI only) | N/A | None |
| **AnimatedBackground** | Wrapper | Depends on type | N/A | None |

---

## Integration Example

### App.tsx Usage
```typescript
const [backgroundType, setBackgroundType] = useState<BackgroundType>('glow');
const [isBackgroundPickerOpen, setIsBackgroundPickerOpen] = useState(false);

// Render
<>
  {/* Background layer */}
  <AnimatedBackground type={backgroundType} mood="vibe" />

  {/* Reactions layer */}
  <ReactionCanvas />

  {/* Settings UI */}
  <BackgroundPicker
    current={backgroundType}
    onSelect={setBackgroundType}
    isOpen={isBackgroundPickerOpen}
    onClose={() => setIsBackgroundPickerOpen(false)}
  />
</>
```

---

## Future Enhancements

### Mood-Based Colors
Currently `mood` prop is unused. Future implementation:
```typescript
const getMoodColors = (mood: 'chill' | 'hype' | 'vibe' | 'focus') => {
  switch (mood) {
    case 'chill': return ['#60a5fa', '#a78bfa'];  // Blue/Purple
    case 'hype': return ['#f43f5e', '#fb923c'];   // Red/Orange
    case 'vibe': return ['#a855f7', '#ec4899'];   // Purple/Pink (current)
    case 'focus': return ['#10b981', '#14b8a6'];  // Green/Teal
  }
};
```

### Performance Detection
Auto-adjust quality based on device:
```typescript
const detectPerformance = () => {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency < 4;
  return isMobile || isLowEnd ? 'low' : 'high';
};

// Use simpler effects on low-end devices
if (detectPerformance() === 'low') {
  return <AmbientGlow />;  // Simplest effect
}
```

### Audio Reactivity
Sync background animations with audio:
```typescript
const audioLevel = useAudioLevel();  // Hook for audio analysis

// Adjust particle speed or glow intensity
<ParticleField speed={1 + audioLevel} />
```

---

**Last Updated:** December 2024
**VOYO Music Version:** 1.2.0
