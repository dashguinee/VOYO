# Animation Implementation Guide for VOYO Music

## Quick Start: Smart Animations in 3 Steps

### Step 1: Install Dependencies
```bash
npm install react-intersection-observer framer-motion
```

### Step 2: Create Animation Hook
```typescript
// src/hooks/useSmartAnimation.ts
import { useInView } from 'react-intersection-observer';
import { useEffect, useState } from 'react';

interface UseSmartAnimationProps {
  triggerOnce?: boolean;
  threshold?: number;
  rootMargin?: string;
}

export function useSmartAnimation({
  triggerOnce = true,
  threshold = 0.1,
  rootMargin = '50px',
}: UseSmartAnimationProps = {}) {
  const { ref, inView } = useInView({
    threshold,
    rootMargin,
    triggerOnce,
  });

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(query.matches);

    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return {
    ref,
    inView,
    prefersReducedMotion,
  };
}
```

### Step 3: Use in Your Components
```jsx
import { useSmartAnimation } from '@/hooks/useSmartAnimation';

export function MusicCard({ song, index }) {
  const { ref, inView, prefersReducedMotion } = useSmartAnimation();

  return (
    <div
      ref={ref}
      className={`music-card ${inView ? 'animate-in' : ''}`}
      style={{
        '--item-index': index,
        animation: prefersReducedMotion ? 'none' : undefined,
      } as React.CSSProperties}
    >
      {/* Card content */}
    </div>
  );
}
```

---

## Component Library: Ready-to-Use Patterns

### 1. Smart Music Card Component

**File:** `src/components/SmartMusicCard.tsx`

```typescript
import React, { useEffect, useRef } from 'react';
import { useSmartAnimation } from '@/hooks/useSmartAnimation';
import styles from './SmartMusicCard.module.css';

interface Song {
  id: string;
  title: string;
  artist: string;
  cover: string;
  duration: string;
}

interface SmartMusicCardProps {
  song: Song;
  index: number;
  onPlay?: (songId: string) => void;
  onMore?: (songId: string) => void;
}

export const SmartMusicCard: React.FC<SmartMusicCardProps> = ({
  song,
  index,
  onPlay,
  onMore,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const { ref, inView, prefersReducedMotion } = useSmartAnimation({
    threshold: 0.1,
    rootMargin: '50px',
  });

  useEffect(() => {
    if (!cardRef.current) return;

    // Set CSS variable for stagger index
    cardRef.current.style.setProperty('--item-index', String(index));

    // Pause animation when not in view (save battery)
    if (prefersReducedMotion) {
      cardRef.current.style.animation = 'none';
    } else {
      cardRef.current.style.animationPlayState = inView ? 'running' : 'paused';
    }
  }, [inView, index, prefersReducedMotion]);

  return (
    <div
      ref={(element) => {
        ref(element);
        cardRef.current = element;
      }}
      className={`${styles.card} ${inView ? styles.animateIn : ''}`}
      role="article"
      aria-label={`${song.title} by ${song.artist}`}
    >
      <div className={styles.imageContainer}>
        <img
          src={song.cover}
          alt={`${song.title} cover`}
          loading="lazy"
          className={styles.image}
        />
        <div className={styles.overlay}></div>
      </div>

      <div className={styles.content}>
        <div className={styles.info}>
          <h3 className={styles.title}>{song.title}</h3>
          <p className={styles.artist}>{song.artist}</p>
          <span className={styles.duration}>{song.duration}</span>
        </div>

        <div className={styles.controls}>
          <button
            className={styles.playBtn}
            onClick={() => onPlay?.(song.id)}
            aria-label={`Play ${song.title}`}
          >
            ▶
          </button>
          <button
            className={styles.moreBtn}
            onClick={() => onMore?.(song.id)}
            aria-label={`More options for ${song.title}`}
          >
            ⋯
          </button>
        </div>
      </div>
    </div>
  );
};
```

**CSS Module:** `src/components/SmartMusicCard.module.css`

```css
.card {
  /* Initial state - hidden, translated */
  opacity: 0;
  transform: translateY(20px) scale(0.95);

  /* Staggered animation timing */
  animation: slideInScale 300ms cubic-bezier(0.34, 1.56, 0.64, 1)
    calc(var(--item-index, 0) * 40ms) forwards;

  /* Start paused, resume when visible */
  animation-play-state: paused;

  /* Visual styling */
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: transform 150ms ease-out, box-shadow 150ms ease-out;
  display: flex;
  flex-direction: column;
}

.animateIn {
  animation-play-state: running;
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

.imageContainer {
  position: relative;
  width: 100%;
  padding-top: 100%; /* 1:1 aspect ratio */
  overflow: hidden;
  background: linear-gradient(135deg, #0f3460 0%, #16213e 100%);
}

.image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 300ms ease-out;
}

.overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0);
  transition: background 200ms ease-out;
}

/* Desktop: Hover effect */
@media (hover: hover) {
  .card:hover {
    transform: scale(1.05);
    box-shadow: 0 12px 30px rgba(233, 69, 96, 0.3);
  }

  .card:hover .image {
    transform: scale(1.08);
  }

  .card:hover .overlay {
    background: rgba(233, 69, 96, 0.1);
  }
}

/* Mobile: Tap effect (no hover) */
@media (hover: none) {
  .card.active {
    transform: scale(1.05);
    box-shadow: 0 12px 30px rgba(233, 69, 96, 0.3);
  }

  .card.active .image {
    transform: scale(1.08);
  }

  .card.active .overlay {
    background: rgba(233, 69, 96, 0.1);
  }
}

.content {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.title {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artist {
  font-size: 13px;
  color: #a0a0a0;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.duration {
  font-size: 12px;
  color: #606060;
  margin-top: 4px;
}

.controls {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  opacity: 0;
  transition: opacity 200ms ease-out;
}

@media (hover: hover) {
  .card:hover .controls {
    opacity: 1;
  }
}

@media (hover: none) {
  .card.active .controls {
    opacity: 1;
  }
}

.playBtn,
.moreBtn {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 150ms ease-out;
  background: rgba(233, 69, 96, 0.2);
  color: #e94560;
  font-weight: 600;
}

.playBtn:active,
.moreBtn:active {
  transform: scale(0.95);
  background: rgba(233, 69, 96, 0.4);
}

/* Respect accessibility preferences */
@media (prefers-reduced-motion: reduce) {
  .card {
    animation: none;
    transition: none;
  }

  .image,
  .overlay,
  .controls {
    transition: none;
  }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .card {
    animation-duration: 250ms;
  }

  .title {
    font-size: 14px;
  }

  .artist {
    font-size: 12px;
  }
}
```

---

### 2. Playlist Grid with Stagger Animation

**File:** `src/components/PlaylistGrid.tsx`

```typescript
import React, { useMemo } from 'react';
import { SmartMusicCard } from './SmartMusicCard';
import styles from './PlaylistGrid.module.css';

interface Song {
  id: string;
  title: string;
  artist: string;
  cover: string;
  duration: string;
}

interface PlaylistGridProps {
  songs: Song[];
  columns?: number;
  gap?: string;
  onPlaySong?: (songId: string) => void;
  onMoreOptions?: (songId: string) => void;
}

export const PlaylistGrid: React.FC<PlaylistGridProps> = ({
  songs,
  columns = 3,
  gap = '16px',
  onPlaySong,
  onMoreOptions,
}) => {
  // Memoize to avoid re-renders
  const memoizedSongs = useMemo(() => songs, [songs]);

  return (
    <div
      className={styles.grid}
      style={{
        '--columns': columns,
        '--gap': gap,
      } as React.CSSProperties}
    >
      {memoizedSongs.map((song, index) => (
        <SmartMusicCard
          key={song.id}
          song={song}
          index={index}
          onPlay={onPlaySong}
          onMore={onMoreOptions}
        />
      ))}
    </div>
  );
};
```

**CSS Module:** `src/components/PlaylistGrid.module.css`

```css
.grid {
  display: grid;
  grid-template-columns: repeat(var(--columns, 3), 1fr);
  gap: var(--gap, 16px);
  width: 100%;
  padding: 24px;
}

/* Tablet: 2 columns */
@media (max-width: 1024px) {
  .grid {
    --columns: 2;
  }
}

/* Mobile: 1 column */
@media (max-width: 640px) {
  .grid {
    --columns: 1;
    --gap: 12px;
    padding: 16px;
  }
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .grid {
    animation: none;
  }
}
```

---

### 3. Animated Carousel Component

**File:** `src/components/AnimatedCarousel.tsx`

```typescript
import React, { useEffect, useRef, useState } from 'react';
import styles from './AnimatedCarousel.module.css';

interface CarouselItem {
  id: string;
  title: string;
  image: string;
}

interface AnimatedCarouselProps {
  items: CarouselItem[];
  autoPlay?: boolean;
  autoPlayInterval?: number;
}

export const AnimatedCarousel: React.FC<AnimatedCarouselProps> = ({
  items,
  autoPlay = true,
  autoPlayInterval = 5000,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoPlay || !isPlaying || items.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, autoPlayInterval);

    return () => clearInterval(interval);
  }, [autoPlay, isPlaying, autoPlayInterval, items.length]);

  // Pause animation when not visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPlaying(entry.isIntersecting);
      },
      { threshold: 0.5 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % items.length);
  };

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className={styles.carouselContainer}>
      <div
        className={styles.track}
        style={{
          transform: `translateX(-${currentIndex * 100}%)`,
        }}
      >
        {items.map((item) => (
          <div key={item.id} className={styles.slide}>
            <img src={item.image} alt={item.title} />
            <h3>{item.title}</h3>
          </div>
        ))}
      </div>

      {/* Controls */}
      <button
        className={styles.control}
        onClick={handlePrevious}
        aria-label="Previous slide"
      >
        ←
      </button>
      <button
        className={styles.control}
        onClick={handleNext}
        aria-label="Next slide"
      >
        →
      </button>

      {/* Play/Pause button */}
      <button
        className={styles.playPause}
        onClick={() => setIsPlaying(!isPlaying)}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Indicators */}
      <div className={styles.indicators}>
        {items.map((_, index) => (
          <button
            key={index}
            className={`${styles.indicator} ${
              index === currentIndex ? styles.active : ''
            }`}
            onClick={() => setCurrentIndex(index)}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
};
```

**CSS Module:** `src/components/AnimatedCarousel.module.css`

```css
.carouselContainer {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 12px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}

.track {
  display: flex;
  transition: transform 500ms cubic-bezier(0.4, 0.0, 0.2, 1);
  width: 100%;
}

.slide {
  flex: 0 0 100%;
  min-width: 100%;
  position: relative;
  overflow: hidden;
}

.slide img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.slide h3 {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  margin: 0;
  padding: 20px;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  color: white;
  font-size: 20px;
  font-weight: 600;
}

.control {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 18px;
  transition: background 200ms ease-out;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.control:hover {
  background: rgba(0, 0, 0, 0.8);
}

.control:nth-of-type(1) {
  left: 16px;
}

.control:nth-of-type(2) {
  right: 16px;
}

.playPause {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(233, 69, 96, 0.8);
  color: white;
  cursor: pointer;
  font-size: 16px;
  transition: background 200ms ease-out;
  z-index: 3;
}

.playPause:hover {
  background: rgba(233, 69, 96, 1);
}

.indicators {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 2;
}

.indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: background 200ms ease-out;
}

.indicator.active {
  background: rgba(233, 69, 96, 1);
  width: 24px;
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .track {
    transition: none;
  }
}
```

---

## Integration Checklist

### ✅ Step 1: Add to Your Layout
```jsx
import { PlaylistGrid } from '@/components/PlaylistGrid';

export default function PlaylistPage({ songs }) {
  return (
    <div className="playlist-page">
      <h1>My Playlist</h1>
      <PlaylistGrid
        songs={songs}
        columns={3}
        onPlaySong={(songId) => console.log('Playing:', songId)}
        onMoreOptions={(songId) => console.log('More options:', songId)}
      />
    </div>
  );
}
```

### ✅ Step 2: Verify Mobile Responsiveness
```bash
# Test on actual mobile device or use DevTools
chrome://inspect/#devices
```

### ✅ Step 3: Test Accessibility
```bash
# Check for animation preference
# Settings > Accessibility > Display > Reduce motion (macOS)
# Settings > Accessibility > Display > Remove animations (Windows)
```

### ✅ Step 4: Performance Monitor
```javascript
// Check FPS in DevTools Console
let frameCount = 0;
let lastTime = Date.now();

function checkFPS() {
  frameCount++;
  const now = Date.now();
  if (now >= lastTime + 1000) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    lastTime = now;
  }
  requestAnimationFrame(checkFPS);
}

requestAnimationFrame(checkFPS);
```

---

## Troubleshooting

### Issue: Animations too slow
**Solution:** Reduce duration from 300ms to 200ms
```css
animation-duration: 200ms;
```

### Issue: Cards jump/stutter
**Solution:** Use GPU-accelerated properties only
```css
/* ❌ Bad */
animation: moveCard;
@keyframes moveCard {
  from { left: 0; }
  to { left: 100px; }
}

/* ✅ Good */
animation: moveCard;
@keyframes moveCard {
  from { transform: translateX(0); }
  to { transform: translateX(100px); }
}
```

### Issue: Animations don't pause when off-screen
**Solution:** Ensure Intersection Observer is connected
```javascript
// Check in DevTools
const observer = new IntersectionObserver(console.log);
observer.observe(element);
// Should see isIntersecting: true/false
```

### Issue: Mobile animations too jerky
**Solution:** Reduce stagger delay and animation duration
```css
/* Mobile override */
@media (max-width: 768px) {
  animation-duration: 150ms;
  animation-delay: calc(var(--item-index) * 20ms);
}
```

---

## Performance Targets

| Metric | Target | Tool |
|--------|--------|------|
| FPS | 60+ FPS | Chrome DevTools Performance tab |
| First Paint | < 1s | Lighthouse |
| Interactive | < 2s | Lighthouse |
| Animation FPS | 60+ FPS | DevTools Performance Monitor |

Run performance audit:
```bash
npm run build
npx lighthouse https://your-site.com --view
```

---

## Next Steps

1. **Implement SmartMusicCard** in your playlist pages
2. **Test on mobile device** - Use Chrome DevTools device emulation
3. **Monitor FPS** - Check Performance tab during animations
4. **Gather user feedback** - Does animation feel natural?
5. **Optimize further** - Profile with DevTools Profiler if needed

