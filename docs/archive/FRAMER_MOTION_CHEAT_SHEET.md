# Framer Motion Cheat Sheet - Quick Reference

Handy reference guide for common Framer Motion patterns and syntax.

---

## Installation

```bash
npm install framer-motion
```

## Imports

```typescript
import {
  motion,
  AnimatePresence,
  useAnimation,
  useAnimationControls,
  useAnimate,
  useMotionValue,
  useTransform,
  useViewportScroll,
  useScroll,
  useInView,
  MotionConfig,
  Variants,
} from 'framer-motion';
```

---

## Basic Motion Component

```typescript
<motion.div
  animate={{ x: 100, rotate: 180 }}
  transition={{ duration: 0.5 }}
/>
```

---

## Animation Properties

### Transform Properties (Best Performance)

```typescript
// Position
x: 100                    // px
y: 100                    // px

// Scale
scale: 1.5                // multiplier
scaleX: 1.5
scaleY: 1.5

// Rotation
rotate: 180               // degrees
rotateX: 45
rotateY: 45
rotateZ: 45

// Skew
skew: 10
skewX: 10
skewY: 10

// Perspective
perspective: 1000
transformOrigin: 'center'
```

### Style Properties

```typescript
opacity: 0.5
color: '#667eea'
backgroundColor: '#f3f4f6'
borderRadius: 12
boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
```

---

## Transition Types

### Spring (Physics-Based)

```typescript
transition={{
  type: 'spring',
  stiffness: 100,      // 0-1000, higher = faster
  damping: 10,         // 0-100, higher = less bouncy
  mass: 1,             // 0.1-10, higher = slower to accelerate
  velocity: 0,         // initial velocity
}}

// Common presets
transition={{ type: 'spring', stiffness: 400, damping: 40 }} // snappy
transition={{ type: 'spring', stiffness: 100, damping: 20 }} // soft
transition={{ type: 'spring', stiffness: 300, damping: 10 }} // bouncy
```

### Tween (Time-Based)

```typescript
transition={{
  type: 'tween',
  duration: 0.5,       // seconds
  delay: 0.1,
  ease: 'easeInOut',   // easeIn, easeOut, easeInOut, circIn, etc.
  repeat: Infinity,    // number of repeats
  repeatType: 'reverse', // 'reverse', 'loop', 'mirror'
}}
```

### Inertia (Momentum)

```typescript
transition={{
  type: 'inertia',
  velocity: 100,
  power: 0.8,          // 0-1, how quickly it decelerates
  timeConstant: 350,   // ms, how long to decelerate
}}
```

### Duration-Based Spring

```typescript
transition={{
  type: 'spring',
  duration: 0.8,
  bounce: 0.3,         // 0-1
}}
```

---

## Animation States

### Initial, Animate, Exit

```typescript
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -20 }}
  transition={{ duration: 0.5 }}
/>
```

### While Hover/Tap

```typescript
<motion.button
  whileHover={{ scale: 1.1, boxShadow: '0 10px 30px...' }}
  whileTap={{ scale: 0.95 }}
  whileFocus={{ outline: '2px solid blue' }}
  transition={{ type: 'spring', stiffness: 400 }}
/>
```

### While Drag/In View

```typescript
<motion.div
  drag
  whileDrag={{ scale: 1.2, rotate: 5 }}
  whileInView={{ opacity: 1 }}
/>
```

---

## Variants

### Simple Variants

```typescript
const variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

<motion.div
  variants={variants}
  initial="hidden"
  animate="visible"
/>
```

### Complex Variants with Transitions

```typescript
const variants = {
  hidden: {
    opacity: 0,
    y: 20,
    transition: { duration: 0.3 },
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
      delay: 0.1,
    },
  },
};
```

### Variants with Stagger

```typescript
const containerVariants = {
  visible: {
    transition: {
      staggerChildren: 0.1,        // delay between children
      delayChildren: 0.2,          // delay before first child
      staggerDirection: 1,         // 1 or -1 for reverse
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};
```

---

## Gesture Animations

### Drag

```typescript
<motion.div
  drag                          // true for x+y, 'x' or 'y' for axis
  dragConstraints={{ left: -100, right: 100, top: -100, bottom: 100 }}
  dragConstraints={ref}         // constraint to element
  dragElastic={0.2}             // 0-1, bounce amount
  dragMomentum={true}           // inertia after drag ends
  dragTransition={{
    power: 0.3,
    restDelta: 0.001,
  }}
  onDragStart={(event, info) => {}}
  onDrag={(event, info) => {}}
  onDragEnd={(event, info) => {}}
/>
```

### Hover

```typescript
<motion.button
  whileHover={{ scale: 1.1 }}
  onHoverStart={() => {}}
  onHoverEnd={() => {}}
/>
```

### Tap

```typescript
<motion.button
  whileTap={{ scale: 0.95 }}
  onTap={() => {}}
  onTapStart={() => {}}
  onTapCancel={() => {}}
/>
```

### Focus

```typescript
<motion.input
  whileFocus={{ scale: 1.05, borderColor: '#667eea' }}
  onFocus={() => {}}
  onBlur={() => {}}
/>
```

### InView

```typescript
<motion.div
  whileInView={{ opacity: 1, y: 0 }}
  initial={{ opacity: 0, y: 50 }}
  viewport={{ once: true, amount: 0.5 }}
/>
```

---

## Motion Values & Transforms

### useMotionValue

```typescript
const x = useMotionValue(0);

<motion.div style={{ x }} />

// Update manually
x.set(100);
x.get();  // get current value
```

### useTransform

```typescript
const x = useMotionValue(0);
const opacity = useTransform(x, [0, 100], [0, 1]);
// When x: 0, opacity: 0; when x: 100, opacity: 1

<motion.div
  drag="x"
  style={{ x, opacity }}
/>
```

### useMotionTemplate

```typescript
const x = useMotionValue(0);
const background = useMotionTemplate`rgb(${x}, 0, 100)`;

<motion.div style={{ background }} />
```

### useVelocity

```typescript
const x = useMotionValue(0);
const xVelocity = useVelocity(x);

// useVelocity returns a MotionValue of the velocity
```

---

## AnimatePresence

### Exit Animations

```typescript
<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    />
  )}
</AnimatePresence>
```

### Mode Control

```typescript
<AnimatePresence mode="wait">  // wait for exit before enter
<AnimatePresence mode="sync">  // animate in/out simultaneously
<AnimatePresence mode="popLayout">  // pop layout on exit
```

### Custom & Direction

```typescript
<AnimatePresence custom={direction}>
  <motion.div
    custom={direction}
    variants={pageVariants}
    initial="initial"
    animate="animate"
    exit="exit"
  />
</AnimatePresence>
```

---

## Hooks

### useAnimation (Legacy)

```typescript
const controls = useAnimation();

// Start animation
await controls.start({ x: 100, transition: { duration: 0.5 } });

// Stop animation
controls.stop();

// Set without animation
controls.set({ x: 100 });

// Use with motion component
<motion.div animate={controls} />
```

### useAnimationControls (Preferred)

```typescript
const controls = useAnimationControls();

const playSequence = async () => {
  await controls.start({ x: 100 });
  await controls.start({ y: 100 });
  await controls.start({ rotate: 360 });
};

<motion.div animate={controls} />
```

### useAnimate (Best for Complex Sequences)

```typescript
const [scope, animate] = useAnimate();

const handleClick = async () => {
  await animate(scope.current, { x: 100 }, { duration: 0.5 });
  await animate(scope.current, { y: 100 }, { duration: 0.5 });
};

<div ref={scope}>
  <motion.div />
</div>
```

### useScroll

```typescript
const { scrollX, scrollY, scrollXProgress, scrollYProgress } = useScroll();

const { scrollYProgress } = useScroll({
  target: ref,
  offset: ['start start', 'end end'],
});

const scale = useTransform(scrollYProgress, [0, 1], [1, 2]);
<motion.div style={{ scale }} />
```

### useInView

```typescript
const ref = useRef(null);
const isInView = useInView(ref);

<motion.div
  ref={ref}
  animate={isInView ? 'visible' : 'hidden'}
/>
```

---

## MotionConfig

### Global Settings

```typescript
<MotionConfig
  reducedMotion="user"         // respect prefers-reduced-motion
  transition={{
    type: 'spring',
    damping: 20,
    stiffness: 300,
  }}
>
  {/* All motion components inherit these settings */}
</MotionConfig>
```

---

## Keyframes

### Array of Values

```typescript
animate={{
  x: [0, 100, 100, 0],         // goes through each value
  rotate: [0, 90, 180, 270],
}}

transition={{
  duration: 4,
  times: [0, 0.25, 0.75, 1],  // control timing of each keyframe
}}
```

---

## Common Patterns

### Button Hover Effect

```typescript
<motion.button
  whileHover={{ scale: 1.05, y: -4 }}
  whileTap={{ scale: 0.95 }}
  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
/>
```

### Card Flip

```typescript
const [isFlipped, setIsFlipped] = useState(false);

<motion.div
  animate={{ rotateY: isFlipped ? 180 : 0 }}
  transition={{ duration: 0.5 }}
  style={{ perspective: 1000 }}
  onClick={() => setIsFlipped(!isFlipped)}
/>
```

### Loading Spinner

```typescript
<motion.div
  animate={{ rotate: 360 }}
  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
  style={{
    width: '50px',
    height: '50px',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #667eea',
    borderRadius: '50%',
  }}
/>
```

### Staggered List

```typescript
<motion.ul variants={containerVariants} initial="hidden" animate="visible">
  {items.map((item) => (
    <motion.li key={item.id} variants={itemVariants}>
      {item.name}
    </motion.li>
  ))}
</motion.ul>
```

### Expandable Section

```typescript
const [isOpen, setIsOpen] = useState(false);

<motion.div
  animate={{ height: isOpen ? 'auto' : 0 }}
  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
  style={{ overflow: 'hidden' }}
>
  {children}
</motion.div>
```

---

## Performance Tips

```typescript
// Good - transform only
animate={{ x: 100, y: 100, rotate: 180, scale: 1.2 }}

// Bad - layout properties
animate={{ width: 200, height: 200, padding: 20 }}

// Use will-change for hint
style={{ willChange: 'transform' }}

// Memoize to prevent re-renders
export const Component = React.memo(...)

// Use MotionConfig for global settings
<MotionConfig reducedMotion="user">
```

---

## Easing Functions

```typescript
ease: 'linear'
ease: 'easeIn'
ease: 'easeOut'
ease: 'easeInOut'
ease: 'circIn'
ease: 'circOut'
ease: 'circInOut'
ease: 'backIn'
ease: 'backOut'
ease: 'backInOut'
ease: 'anticipate'
ease: [0.17, 0.67, 0.83, 0.67]  // cubic bezier
```

---

## SVG Animations

### SVG Path

```typescript
<motion.svg>
  <motion.path
    d="M100,20 L180,50 L140,130"
    animate={{ d: 'M100,20 A80,80 0 1 1 100,180' }}
    transition={{ duration: 0.5 }}
    fill="none"
    stroke="#667eea"
  />
</motion.svg>
```

### SVG Circle

```typescript
<motion.svg>
  <motion.circle
    cx="100"
    cy="100"
    r="50"
    animate={{ r: [50, 80, 50] }}
    transition={{ duration: 2, repeat: Infinity }}
  />
</motion.svg>
```

---

## TypeScript Interfaces

```typescript
interface TargetAndTransition {
  // Animation properties
  [key: string]: any;
  transition?: Transition;
}

interface VariantLabels {
  [label: string]: TargetAndTransition;
}

interface Transition {
  type?: 'spring' | 'tween' | 'inertia';
  duration?: number;
  delay?: number;
  ease?: Easing | number[];
  repeat?: number;
  repeatType?: 'loop' | 'reverse' | 'mirror';
  [key: string]: any;
}
```

---

## Debugging Tips

```typescript
// Log animation start/end
onAnimationStart={() => console.log('started')}
onAnimationComplete={() => console.log('complete')}

// Inspect motion values
<motion.div
  style={{
    x: useMotionTemplate`${x}px`,  // see value in DOM
  }}
/>

// Performance monitoring
console.time('animation');
// ... animation code
console.timeEnd('animation');
```

---

## Resources

- [Official Docs](https://www.framer.com/motion/)
- [API Reference](https://www.framer.com/motion/component/)
- [Examples](https://github.com/framer/motion/tree/main/dev)
- [Discord Community](https://discord.gg/NxFnFqn)

---

*Last Updated: 2025-12-16*
