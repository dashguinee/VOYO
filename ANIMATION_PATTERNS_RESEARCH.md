# Smart Animation Trigger Patterns - Research & Implementation Guide

## Executive Summary

Premium apps like Spotify and Apple Music use sophisticated animation patterns that are:
- **Visibility-aware**: Animations only trigger when elements are in viewport (Intersection Observer)
- **Performance-optimized**: GPU-accelerated transforms reduce frame drops by ~50%
- **Smart pause/resume**: Animations pause when not in view, reducing CPU/battery drain
- **Staggered timing**: Natural cascading effects using easing functions, not linear timing
- **Mobile-aware**: Tap interactions replace hover animations, animations shorter on mobile
- **Accessibility compliant**: User controls to pause/resume, respects prefers-reduced-motion

---

## 1. INTERSECTION OBSERVER - ANIMATE ONLY WHEN VISIBLE

### Why It Matters
- Scroll event listeners force expensive reflows (getBoundingClientRect() on every scroll)
- Intersection Observer is **asynchronous** and browser-optimized
- Premium apps don't animate elements you can't see
- Saves battery on mobile, reduces CPU load

### Basic Implementation Pattern

```javascript
// Create observer with 10% visibility threshold
const animationObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Element is now visible - trigger animation
        entry.target.classList.add('animate-in');
      } else {
        // Element left viewport - can reset for re-trigger
        entry.target.classList.remove('animate-in');
      }
    });
  },
  {
    threshold: 0.1, // Trigger when 10% is visible
    rootMargin: '50px', // Start animation 50px before entering viewport
  }
);

// Observe all cards
document.querySelectorAll('.music-card').forEach(card => {
  animationObserver.observe(card);
});
```

### CSS Companion Code

```css
.music-card {
  /* Initial state - invisible, translated out */
  transform: translateY(20px) scale(0.95);
  opacity: 0;
  transition: all 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.music-card.animate-in {
  /* Final state - fully visible */
  transform: translateY(0) scale(1);
  opacity: 1;
}
```

### React Hook Implementation

```typescript
// Use react-intersection-observer for cleaner integration
import { useInView } from 'react-intersection-observer';

export function MusicCard({ song }) {
  const { ref, inView } = useInView({
    threshold: 0.1,
    triggerOnce: true, // Only animate once per load
  });

  return (
    <div
      ref={ref}
      className={`music-card ${inView ? 'animate-in' : ''}`}
    >
      {song.title}
    </div>
  );
}
```

### Configuration Options

| Option | Value | Purpose |
|--------|-------|---------|
| `threshold` | 0.0 - 1.0 | Visibility % before trigger (0 = 1 pixel, 1.0 = 100%) |
| `rootMargin` | "50px" | Start animation before/after viewport edge |
| `root` | null/element | Observe relative to viewport or specific container |

---

## 2. HOVER-TRIGGERED vs AUTO-PLAY ANIMATIONS

### Pattern Decision Matrix

#### DESKTOP - Hover Triggered
```javascript
// Desktop: Hover enables interaction animation
element.addEventListener('mouseenter', () => {
  element.classList.add('animate-hover');
});

element.addEventListener('mouseleave', () => {
  element.classList.remove('animate-hover');
});
```

```css
/* Only animate on hover (not auto-play) */
.album-cover {
  transition: transform 200ms ease-out;
}

.album-cover:hover {
  transform: scale(1.05) rotateY(5deg);
  /* Optional: trigger more expensive animations */
}
```

#### MOBILE - Tap/Touch Triggered (NOT hover)
```javascript
// Mobile: Tap reveals more info, hover doesn't exist
if (isMobileDevice()) {
  card.addEventListener('touchstart', (e) => {
    if (!card.classList.contains('expanded')) {
      e.preventDefault();
      card.classList.add('expanded');
    }
  });

  // Tap outside to collapse
  document.addEventListener('touchstart', (e) => {
    if (!card.contains(e.target)) {
      card.classList.remove('expanded');
    }
  });
}
```

### What Spotify & Apple Music Do

**Spotify approach:**
- Cards fade in on scroll (Intersection Observer)
- No auto-play animations on load
- Hover on desktop shows mini player controls
- Touch on mobile reveals playlist actions

**Apple Music approach:**
- Album art fades in as you scroll
- Hover shows "play" button overlay (desktop only)
- Animated album art on lock screen uses `MPMediaItemAnimatedArtwork` API
- Seamless loop required (no frame jumps)

### Best Practice: Detect Device Capability

```javascript
// Detect if device supports hover
const supportsHover = window.matchMedia('(hover: hover)').matches;

// Detect touch device
const isTouchDevice = () => {
  return (
    window.matchMedia('(hover: none)').matches ||
    navigator.maxTouchPoints > 0
  );
};

// Apply appropriate interaction pattern
if (supportsHover) {
  // Desktop: Hover-triggered
  card.addEventListener('mouseenter', playHoverAnimation);
} else {
  // Mobile: Tap-triggered
  card.addEventListener('touchstart', playTapAnimation);
}
```

---

## 3. STAGGERED ANIMATIONS - NATURAL CASCADING EFFECT

### Why Staggered Feels Better Than Parallel

| Pattern | Feels | Use Case |
|---------|-------|----------|
| All animate at once | Chaotic, overwhelming | ❌ Never |
| Staggered (10ms apart) | Intentional, crafted, alive | ✅ Lists, grids, card layouts |
| Staggered (200ms apart) | Too slow, attention-breaking | ❌ Only for dramatic effect |

### CSS Stagger with CSS Variables

```css
/* Parent container */
.playlist {
  --stagger-delay: 0;
  --stagger-duration: 300ms;
}

/* Each child gets incremental delay */
.playlist-item {
  --item-index: 0; /* Set via CSS or JS */
  animation: slideIn var(--stagger-duration)
    cubic-bezier(0.34, 1.56, 0.64, 1)
    calc(var(--stagger-delay) + var(--item-index) * 40ms)
    forwards;
  opacity: 0;
  transform: translateX(-20px);
}

@keyframes slideIn {
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

### HTML with Inline Stagger Index

```html
<div class="playlist">
  <div class="playlist-item" style="--item-index: 0">Song 1</div>
  <div class="playlist-item" style="--item-index: 1">Song 2</div>
  <div class="playlist-item" style="--item-index: 2">Song 3</div>
  <div class="playlist-item" style="--item-index: 3">Song 4</div>
</div>
```

### JavaScript Auto-Indexing

```javascript
document.querySelectorAll('.playlist-item').forEach((item, index) => {
  item.style.setProperty('--item-index', index);
});
```

### Framer Motion Stagger (React)

```jsx
import { motion } from 'framer-motion';

export function PlaylistCards({ songs }) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.04, // 40ms between items
        delayChildren: 0,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 100,
        damping: 12,
      },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {songs.map((song) => (
        <motion.div key={song.id} variants={itemVariants}>
          {song.title}
        </motion.div>
      ))}
    </motion.div>
  );
}
```

### Natural Timing with Easing

```javascript
// Don't use linear! Use easing functions for natural motion

// Option 1: CSS cubic-bezier
// ease-out-back: Feels alive, bouncy
transition: all 300ms cubic-bezier(0.34, 1.56, 0.64, 1);

// ease-out-quart: Smooth deceleration
transition: all 300ms cubic-bezier(0.165, 0.84, 0.44, 1);

// ease-in-out-cubic: Smooth both sides
transition: all 300ms cubic-bezier(0.645, 0.045, 0.355, 1);

// Option 2: Named values (fewer keywords to remember)
transition: all 300ms ease-out; // Default browser easing
```

### Performance: Timing Guidelines

| Duration | Use Case | Feels |
|----------|----------|-------|
| < 100ms | Micro-interactions (hover states) | Instant |
| 100-300ms | Smooth transitions, button presses | Natural |
| 300-500ms | Page section reveals | Intentional |
| > 500ms | ⚠️ Disrupts flow, feels slow | Sluggish |

**Recommended**: 200-300ms for most UI animations (Google Material Design)

---

## 4. ANIMATION LOOPS - PAUSE/RESUME INTELLIGENTLY

### Problem: Animations Keep Running Off-Screen

Default behavior:
- Video carousel animates even when hidden
- Loader spins when you're not looking
- Wasting CPU, battery, GPU

### Solution: Animation Play State Control

```javascript
const animationController = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      const element = entry.target;

      if (entry.isIntersecting) {
        // Element is visible - play animation
        element.style.animationPlayState = 'running';
      } else {
        // Element is hidden - pause animation
        element.style.animationPlayState = 'paused';
      }
    });
  },
  { threshold: 0.1 }
);

// Apply to all animated elements
document.querySelectorAll('.animated').forEach(el => {
  animationController.observe(el);
});
```

### CSS Looping Animation

```css
@keyframes slidingPlaylist {
  0% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(-20px);
  }
  100% {
    transform: translateX(0);
  }
}

.album-carousel {
  animation: slidingPlaylist 6s ease-in-out infinite;
  animation-play-state: paused; /* Start paused */
}

.album-carousel.visible {
  animation-play-state: running; /* Resume when in view */
}
```

### React Implementation with Pause Control

```jsx
import { useRef, useEffect, useState } from 'react';

export function AnimatedCarousel() {
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Resume animation when visible
          containerRef.current.style.animationPlayState = 'running';
          setIsPlaying(true);
        } else {
          // Pause when not visible
          containerRef.current.style.animationPlayState = 'paused';
          setIsPlaying(false);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Optional: Manual pause button
  const toggleAnimation = () => {
    const newState = isPlaying ? 'paused' : 'running';
    containerRef.current.style.animationPlayState = newState;
    setIsPlaying(!isPlaying);
  };

  return (
    <div ref={containerRef} className="carousel">
      {/* Content */}
      <button onClick={toggleAnimation}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
    </div>
  );
}
```

### Accessibility: Respect User Preferences

```javascript
// Check if user prefers reduced motion
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

if (prefersReducedMotion) {
  // Disable or simplify animations
  element.style.animation = 'none';
  element.style.transition = 'none';
}

// Or in CSS:
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
```

---

## 5. PERFORMANCE OPTIMIZATION - GPU ACCELERATION

### The Rule: Animate Only These Properties

✅ **GPU-Accelerated (use these)**:
- `transform: translate(x, y)` - Move elements
- `transform: scale()` - Size changes
- `transform: rotate()` - Rotation
- `opacity` - Fading

❌ **Avoid These** (forces layout recalculation):
- `top`, `left`, `right`, `bottom` - Position
- `width`, `height` - Dimensions
- `margin`, `padding` - Spacing

### Performance Impact

```javascript
// ❌ BAD: Animates 'top' property (30ms paint time per frame)
// Breaches 16ms budget for 60fps
@keyframes badAnimation {
  from { top: 0; }
  to { top: 100px; }
}

// ✅ GOOD: Animates 'transform' (2-5ms paint time)
// Stays well under 16ms budget
@keyframes goodAnimation {
  from { transform: translateY(0); }
  to { transform: translateY(100px); }
}

// Impact: 50% fewer frame drops on mobile
// Source: Chrome DevTools audit
```

### Transform Optimization Example

```css
/* WRONG */
.card {
  position: relative;
  animation: slideInBad 300ms;
}

@keyframes slideInBad {
  from {
    left: -100px;
    opacity: 0;
  }
  to {
    left: 0;
    opacity: 1;
  }
}

/* RIGHT */
.card {
  animation: slideInGood 300ms;
}

@keyframes slideInGood {
  from {
    transform: translateX(-100px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

### Using Will-Change (Use Sparingly)

```css
/* Hint to browser to optimize this element */
.animated-card {
  will-change: transform, opacity;
  animation: slideIn 300ms;
}

/* ⚠️ Remove will-change after animation ends! */
.animated-card.done {
  will-change: auto;
}
```

JavaScript to manage `will-change`:

```javascript
const card = document.querySelector('.animated-card');

card.addEventListener('animationstart', () => {
  card.style.willChange = 'transform, opacity';
});

card.addEventListener('animationend', () => {
  card.style.willChange = 'auto';
});
```

### Frame Rate Monitoring

```javascript
// Monitor FPS to detect jank
let lastTime = Date.now();
let frameCount = 0;

function checkFrameRate() {
  frameCount++;
  const now = Date.now();

  if (now >= lastTime + 1000) {
    const fps = frameCount;
    console.log(`FPS: ${fps}`);

    if (fps < 50) {
      console.warn('⚠️ Performance issue detected!');
      // Reduce animation complexity
      document.body.classList.add('reduce-animations');
    }

    frameCount = 0;
    lastTime = now;
  }

  requestAnimationFrame(checkFrameRate);
}

requestAnimationFrame(checkFrameRate);
```

---

## 6. MOBILE OPTIMIZATION - TOUCH & INTERACTION PATTERNS

### Detection: Hover Support

```javascript
// Detect if device supports hover (desktop)
const supportsHover = window.matchMedia('(hover: hover)').matches;
const isTouchOnly = window.matchMedia('(hover: none)').matches;

if (supportsHover) {
  // Desktop: Show on hover
  card.addEventListener('mouseenter', showControls);
} else if (isTouchOnly) {
  // Mobile: Replace hover with tap
  card.addEventListener('touchstart', showControls);
}
```

### Animation Duration Guidelines

| Device | Duration | Reason |
|--------|----------|--------|
| Desktop | 200-300ms | Users expect snappy response |
| Mobile | 100-200ms | Slower devices need shorter animations |
| Low-end | < 100ms | Avoid jank on budget phones |

```css
@media (max-width: 768px) {
  /* Mobile: Faster animations */
  .card {
    transition: all 150ms ease-out;
  }
}

@media (min-width: 769px) {
  /* Desktop: Slightly longer OK */
  .card {
    transition: all 250ms ease-out;
  }
}
```

### Disable Hover States on Touch

```css
/* Only show hover states on devices that support hover */
@media (hover: hover) {
  .card:hover {
    transform: scale(1.05);
    box-shadow: 0 10px 20px rgba(0,0,0,0.2);
  }
}

@media (hover: none) {
  /* Mobile: No hover, use tap instead */
  .card.active {
    transform: scale(1.05);
    box-shadow: 0 10px 20px rgba(0,0,0,0.2);
  }
}
```

### Reduce Animations on Low-Power Devices

```javascript
// Detect low-power mode (iOS/Android)
if (navigator.deviceMemory < 4) {
  // Low memory device - reduce animations
  document.body.classList.add('low-power-mode');
}

// Or check battery
if (navigator.getBattery) {
  navigator.getBattery().then((battery) => {
    if (!battery.charging && battery.level < 0.2) {
      document.body.classList.add('battery-saver');
    }
  });
}
```

### Touch Interaction Pattern

```jsx
export function TouchOptimizedCard({ song }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleTouchStart = (e) => {
    if (isExpanded) {
      e.preventDefault();
      setIsExpanded(false);
    } else {
      setIsExpanded(true);
    }
  };

  return (
    <div
      className={`card ${isExpanded ? 'expanded' : ''}`}
      onTouchStart={handleTouchStart}
    >
      <img src={song.cover} alt={song.title} />

      {isExpanded && (
        <div className="expanded-info">
          <p>{song.artist}</p>
          <p>{song.duration}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 7. PREMIUM APP PATTERNS - SPOTIFY & APPLE MUSIC

### Spotify Wrapped Animations (2025)

**Pattern:**
1. Elements fade in as you scroll
2. Cards stagger in with 40ms delay between each
3. Animations use spring physics for natural motion
4. No auto-play - only animate when you're looking
5. Interactive game-like progression (not passive)

**Implementation:**
```javascript
// Spotify-like: Cards animate in staggered, smooth sequence
const cards = document.querySelectorAll('.wrap-card');

cards.forEach((card, index) => {
  card.style.animation = `fadeInScale 400ms cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 40}ms forwards`;
  card.style.opacity = '0';
});

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.9) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
```

### Apple Music Lock Screen Animated Album Art

**Pattern:**
- Seamless loop required (last frame → first frame smoothly)
- One frame off is acceptable (minimal jump)
- Uses native `MPMediaItemAnimatedArtwork` API on iOS 26+
- Loops continuously while music plays

**Implementation:**
```javascript
// Ensure animation loops seamlessly
@keyframes seamlessLoop {
  0% {
    /* First frame */
    opacity: 1;
    transform: scale(1);
  }
  99% {
    /* Almost end - prepare for loop */
    opacity: 1;
    transform: scale(1.02);
  }
  100% {
    /* Return to start seamlessly */
    opacity: 1;
    transform: scale(1);
  }
}

.animated-album-art {
  animation: seamlessLoop 6s linear infinite;
}
```

**Key Point:** Linear timing (not ease-out) for loops so the end matches the beginning perfectly.

### Card Animations in Music Apps

| App | Pattern | Timing | Trigger |
|-----|---------|--------|---------|
| Spotify | Fade + scale | 300-400ms | On scroll into view |
| Apple Music | Subtle fade | 200ms | On scroll into view |
| Both | Staggered children | 40ms between | Grid layout |
| Both | Pause when off-screen | N/A | Visibility-based |

---

## 8. WHEN TO ACTIVATE ANIMATIONS - THE SMART DECISION TREE

### Animation State Decision Logic

```
Is element in viewport?
├─ YES: Is it a critical interaction?
│  ├─ YES: Play immediately
│  └─ NO: Wait for hover/tap
└─ NO: Keep paused (save resources)

Is user on mobile?
├─ YES: Tap-triggered, shorter duration
└─ NO: Hover-triggered, standard duration

Is battery low? (< 20%)
├─ YES: Simplify animations
└─ NO: Full animation complexity

Is prefers-reduced-motion enabled?
├─ YES: Disable or instant
└─ NO: Play normally
```

### Complete Decision Implementation

```javascript
class SmartAnimationController {
  constructor(element) {
    this.element = element;
    this.isVisible = false;
    this.isMobile = window.matchMedia('(hover: none)').matches;
    this.prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    this.init();
  }

  init() {
    // Always respect reduced motion preference
    if (this.prefersReducedMotion) {
      this.element.style.animation = 'none';
      return;
    }

    // Setup visibility observer
    this.observeVisibility();

    // Setup interaction based on device
    this.isMobile ? this.setupTouchInteraction() : this.setupHoverInteraction();
  }

  observeVisibility() {
    const observer = new IntersectionObserver(
      ([entry]) => {
        this.isVisible = entry.isIntersecting;
        this.updateAnimationState();
      },
      { threshold: 0.1 }
    );
    observer.observe(this.element);
  }

  updateAnimationState() {
    if (this.isVisible && !this.prefersReducedMotion) {
      this.element.style.animationPlayState = 'running';
    } else {
      this.element.style.animationPlayState = 'paused';
    }
  }

  setupHoverInteraction() {
    this.element.addEventListener('mouseenter', () => {
      if (this.isVisible) {
        this.element.classList.add('hover-active');
      }
    });
    this.element.addEventListener('mouseleave', () => {
      this.element.classList.remove('hover-active');
    });
  }

  setupTouchInteraction() {
    this.element.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.element.classList.toggle('touch-active');
    });
  }
}

// Usage
document.querySelectorAll('.music-card').forEach(card => {
  new SmartAnimationController(card);
});
```

---

## 9. COMPLETE EXAMPLE - MUSIC CARD WITH ALL PATTERNS

```jsx
import React, { useEffect, useRef } from 'react';

export function PremiumMusicCard({ song, index }) {
  const cardRef = useRef(null);

  useEffect(() => {
    // Check for accessibility preference
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (prefersReducedMotion) {
      cardRef.current.style.animation = 'none';
      return;
    }

    // Visibility observer - pause when off-screen
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          cardRef.current.style.animationPlayState = 'running';
        } else {
          cardRef.current.style.animationPlayState = 'paused';
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    visibilityObserver.observe(cardRef.current);

    // Set stagger index for CSS variable
    cardRef.current.style.setProperty('--item-index', index);

    return () => visibilityObserver.disconnect();
  }, [index]);

  return (
    <div
      ref={cardRef}
      className="music-card premium"
      style={{
        '--item-index': index,
      } as React.CSSProperties}
    >
      <div className="card-image">
        <img src={song.cover} alt={song.title} />
      </div>

      <div className="card-info">
        <h3>{song.title}</h3>
        <p>{song.artist}</p>
      </div>

      <div className="card-controls">
        <button className="play-btn">▶</button>
        <button className="more-btn">⋯</button>
      </div>
    </div>
  );
}

// Styling
const styles = `
.music-card.premium {
  /* Initial state */
  opacity: 0;
  transform: translateY(20px) scale(0.95);

  /* Staggered animation with CSS variable */
  animation: slideInScale 300ms cubic-bezier(0.34, 1.56, 0.64, 1)
    calc(var(--item-index, 0) * 40ms) forwards;

  animation-play-state: paused; /* Start paused */

  /* Mobile optimization */
  transition: transform 150ms ease-out, opacity 150ms ease-out;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}

@keyframes slideInScale {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Desktop: Hover effect */
@media (hover: hover) {
  .music-card.premium:hover {
    transform: scale(1.05);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  }
}

/* Mobile: Tap effect */
@media (hover: none) {
  .music-card.premium.touch-active {
    transform: scale(1.05);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  }
}

/* Respect reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  .music-card.premium {
    animation: none;
    transition: none;
  }
}
`;
```

---

## Key Takeaways for VOYO Music

### 1. **Intersection Observer First**
```javascript
// Don't animate off-screen elements
const animateOnScroll = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1 });
```

### 2. **GPU-Accelerated Only**
```css
/* Use only transform and opacity */
@keyframes cardEnter {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

### 3. **Stagger with 40ms Spacing**
```javascript
/* Natural cascading, not overwhelming */
animation-delay: calc(var(--index) * 40ms);
```

### 4. **Pause When Not Visible**
```javascript
/* Save battery, reduce CPU */
animationPlayState = entry.isIntersecting ? 'running' : 'paused';
```

### 5. **Mobile-First Interaction**
```javascript
/* Tap on mobile, hover on desktop */
if (isTouchDevice) setupTap();
else setupHover();
```

### 6. **Respect Accessibility**
```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none; transition: none; }
}
```

---

## Sources

- [Intersection Observer API - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [React Intersection Observer - A Practical Guide](https://www.builder.io/blog/react-intersection-observer)
- [Creating Staggered Animations with Framer Motion | Medium](https://medium.com/@onifkay/creating-staggered-animations-with-framer-motion-0e7dc90eae33)
- [Best Practices for Performance Optimization in Web Animations](https://blog.pixelfreestudio.com/best-practices-for-performance-optimization-in-web-animations/)
- [Spotify Wrapped 2025: Global trends, top artists and insights](https://www.lawyer-monthly.com/2025/12/spotify-wrapped-2025-global-listening-trends/)
- [Understanding Success Criterion 2.2.2: Pause, Stop, Hide | WAI | W3C](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html)
- [Motion Art on Apple – Symphonic Help Desk](https://support.symdistro.com/hc/en-us/articles/32428977235213-Motion-Art-on-Apple)
- [Trigger animations with Intersection Observer API - Liquid Light](https://www.liquidlight.co.uk/blog/trigger-animations-with-intersection-observer-api/)
