# Animation Quick Reference - Copy & Paste Patterns

## 🎯 5-Minute Setup

### Pattern 1: Fade In On Scroll
```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('fade-in');
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.card').forEach(el => observer.observe(el));
```

```css
.card {
  opacity: 0;
  transition: opacity 300ms ease-out;
}
.card.fade-in {
  opacity: 1;
}
```

---

### Pattern 2: Slide In From Left
```css
.card {
  opacity: 0;
  transform: translateX(-50px);
  transition: all 300ms ease-out;
}
.card.slide-in {
  opacity: 1;
  transform: translateX(0);
}
```

---

### Pattern 3: Scale & Fade (Growth Effect)
```css
.card {
  opacity: 0;
  transform: scale(0.9);
  transition: all 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.card.grow-in {
  opacity: 1;
  transform: scale(1);
}
```

---

### Pattern 4: Staggered List (40ms Between Items)
```javascript
document.querySelectorAll('.list-item').forEach((item, index) => {
  item.style.setProperty('--index', index);
});
```

```css
.list-item {
  animation: slideIn 300ms ease-out calc(var(--index) * 40ms) forwards;
  opacity: 0;
}

@keyframes slideIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

---

### Pattern 5: Pause Animation When Off-Screen
```javascript
const observer = new IntersectionObserver(([entry]) => {
  const state = entry.isIntersecting ? 'running' : 'paused';
  entry.target.style.animationPlayState = state;
}, { threshold: 0.1 });

document.querySelectorAll('.animated').forEach(el => observer.observe(el));
```

---

### Pattern 6: Hover Animation (Desktop Only)
```css
@media (hover: hover) {
  .card:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  }
}
```

---

### Pattern 7: Tap Animation (Mobile Only)
```javascript
const isMobile = window.matchMedia('(hover: none)').matches;

if (isMobile) {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('touchstart', () => {
      card.classList.toggle('active');
    });
  });
}
```

---

### Pattern 8: Respect User's Animation Preference
```javascript
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

if (prefersReducedMotion) {
  document.documentElement.style.setProperty('--animation-duration', '0ms');
}
```

```css
:root {
  --animation-duration: 300ms;
}

.card {
  transition: all var(--animation-duration) ease-out;
}
```

---

## 🚀 Common Patterns Library

### Bounce In
```css
@keyframes bounceIn {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
  70% {
    transform: scale(0.9);
  }
  100% {
    transform: scale(1);
  }
}

.card {
  animation: bounceIn 400ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
```

### Flip In (Y-axis)
```css
@keyframes flipInY {
  from {
    transform: perspective(400px) rotateY(90deg);
    opacity: 0;
  }
  to {
    transform: perspective(400px) rotateY(0deg);
    opacity: 1;
  }
}

.card {
  animation: flipInY 500ms ease-out;
}
```

### Shake (Error/Alert)
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
  20%, 40%, 60%, 80% { transform: translateX(5px); }
}

.error {
  animation: shake 400ms ease-in-out;
}
```

### Pulse (Breathing)
```css
@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.02);
  }
}

.loading {
  animation: pulse 1s ease-in-out infinite;
}
```

### Rotate Loader
```css
@keyframes spin {
  to { transform: rotate(360deg); }
}

.loader {
  animation: spin 1s linear infinite;
}
```

### Typewriter Effect
```css
@keyframes typing {
  from { width: 0; }
  to { width: 100%; }
}

.typewriter {
  display: inline-block;
  overflow: hidden;
  white-space: nowrap;
  animation: typing 2s steps(40, end);
}
```

---

## ⏱️ Duration Guidelines

| Use Case | Duration | Why |
|----------|----------|-----|
| Button press | 100-150ms | Fast feedback |
| Hover reveal | 200ms | Quick but smooth |
| Page transition | 300ms | Noticeable but not slow |
| Modal appear | 300-400ms | Gives focus |
| Stagger item (each) | 40ms gap | Natural cascade |
| Scroll animation | 300ms | Smooth entry |
| Auto-play loop | 6000-10000ms | Enough time to read |

**Golden rule**: Keep animations under 300ms unless intentional drama.

---

## 🎨 Easing Functions (Copy These)

```css
/* Ease Out (natural deceleration) - MOST COMMON */
cubic-bezier(0.25, 0.46, 0.45, 0.94)

/* Ease In Out (slow start and end) */
cubic-bezier(0.42, 0, 0.58, 1)

/* Ease Out Back (bouncy) */
cubic-bezier(0.34, 1.56, 0.64, 1)

/* Ease Out Cubic (smooth) */
cubic-bezier(0.215, 0.61, 0.355, 1)

/* Ease In Cubic (slow start) */
cubic-bezier(0.55, 0.055, 0.675, 0.19)

/* Linear (for continuous loops only) */
linear
```

**Quick rule:**
- **UI interactions**: Use ease-out
- **Loops**: Use linear
- **Entrance**: Use ease-out-back for bounce

---

## 📱 Mobile vs Desktop

### For Desktop (hover support)
```css
@media (hover: hover) {
  .card:hover {
    /* Hover animation */
  }
}
```

### For Mobile (touch only, no hover)
```css
@media (hover: none) {
  .card.active {
    /* Tap animation */
  }
}
```

### Detect Device in JS
```javascript
const isMobile = window.matchMedia('(hover: none)').matches;
const isDesktop = window.matchMedia('(hover: hover)').matches;
```

---

## 🔴 Performance Red Flags

### ❌ DON'T DO THIS:
```css
/* Animated width causes layout recalculation every frame */
@keyframes bad {
  from { width: 0; }
  to { width: 100%; }
}

/* Animated top/left forces reflow */
@keyframes worse {
  from { left: 0; }
  to { left: 100px; }
}

/* Too many simultaneous animations */
.items {
  animation: complex-calc 10000ms;
}
```

### ✅ DO THIS INSTEAD:
```css
/* Use transform instead */
@keyframes good {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* Use translateX/Y */
@keyframes better {
  from { transform: translateX(0); }
  to { transform: translateX(100px); }
}

/* Stagger animations to distribute load */
.item-1 { animation: move 400ms 0ms; }
.item-2 { animation: move 400ms 40ms; }
.item-3 { animation: move 400ms 80ms; }
```

---

## 🧪 Testing Animation Performance

### Check FPS in DevTools
```javascript
// Paste in console to monitor FPS
(function() {
  let frame = 0;
  let start = performance.now();

  function tick(now) {
    frame++;
    if (now >= start + 1000) {
      console.log(`FPS: ${frame}`);
      frame = 0;
      start = now;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
```

**Target: 60 FPS or higher**
**Acceptable: 50+ FPS**
**Problem: Below 45 FPS**

### Use Chrome DevTools Performance Tab
1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record
4. Interact with animations
5. Click Stop
6. Look for:
   - Frame rate (should be flat at 60)
   - Yellow/red frames = jank (avoid)
   - Long task warnings = reduce animation complexity

---

## 🎬 Accessibility Compliance

### Always Include This
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
```

### Or Conditional Class
```javascript
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.body.classList.add('no-animations');
}
```

```css
body.no-animations * {
  animation: none !important;
  transition: none !important;
}
```

### Test This
```javascript
// Enable reduced motion simulation in DevTools
// Rendering > Emulate CSS media feature prefers-reduced-motion
```

---

## 📝 Code Snippets to Copy

### Scroll Animation Trigger (Vanilla JS)
```javascript
const animateOnScroll = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('animate');
    }
  });
}, { threshold: 0.1, rootMargin: '50px' });

document.querySelectorAll('[data-animate]').forEach(el => {
  animateOnScroll.observe(el);
});
```

### Stagger Index Generator
```javascript
document.querySelectorAll('.list-item').forEach((item, idx) => {
  item.style.setProperty('--index', idx);
});
```

### Pause/Resume with Intersection
```javascript
new IntersectionObserver(([e]) => {
  e.target.style.animationPlayState = e.isIntersecting ? 'running' : 'paused';
}, { threshold: 0.5 }).observe(document.querySelector('.carousel'));
```

### Detect Device
```javascript
const config = {
  isMobile: window.matchMedia('(hover: none)').matches,
  prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  isRetina: window.devicePixelRatio > 1,
};
```

---

## 🚀 Ready-to-Use CSS Classes

```css
/* Fade in */
.fade-in {
  animation: fadeIn 300ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Slide up */
.slide-up {
  animation: slideUp 300ms ease-out;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Slide in from left */
.slide-left {
  animation: slideLeft 300ms ease-out;
}

@keyframes slideLeft {
  from { transform: translateX(-50px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* Zoom in */
.zoom-in {
  animation: zoomIn 300ms ease-out;
}

@keyframes zoomIn {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* Bounce */
.bounce-in {
  animation: bounceIn 400ms cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

@keyframes bounceIn {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}
```

---

## 💡 Pro Tips

1. **Stagger small, not big**: 20-60ms between items feels natural; 200ms+ feels slow
2. **Hover doesn't exist on mobile**: Always provide tap alternative
3. **Pause animations off-screen**: Saves 30-50% battery on long lists
4. **Use cubic-bezier(0.34, 1.56, 0.64, 1) for life**: That's the "bounce" easing that makes everything feel premium
5. **Test on actual devices**: Emulation ≠ reality (always test iPhone/Android)
6. **Shorter on mobile**: 200ms on desktop → 150ms on mobile
7. **Transform > Position**: Always use `transform: translateX()` not `left:`
8. **Respect the budget**: 16ms per frame (60fps). If animation takes longer, it jank
9. **Animations are art, not magic**: If it doesn't feel good, tune the timing
10. **Always include `prefers-reduced-motion`**: Accessibility isn't optional

