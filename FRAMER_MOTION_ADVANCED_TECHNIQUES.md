# Advanced Framer Motion Techniques & Optimization Guide

Comprehensive guide covering advanced patterns, performance optimization, and production-ready implementations.

---

## Table of Contents

1. Advanced Gesture Patterns
2. Performance Optimization Strategies
3. Shared Layout Animations
4. Scroll-Linked Animations
5. SVG Animation Techniques
6. Advanced useMotionTemplate Patterns
7. Intersection Observer Integration
8. Memory Management & Cleanup
9. Custom Timing Functions
10. Production Patterns

---

## 1. Advanced Gesture Patterns

### Drag with Momentum and Inertia

```typescript
import { motion, useMotionValue, useTransform, useVelocity } from 'framer-motion';

export const AdvancedDragGesture = () => {
  const x = useMotionValue(0);
  const xVelocity = useVelocity(x);
  const opacity = useTransform(xVelocity, [-1000, 0, 1000], [0.5, 1, 0.5]);

  return (
    <motion.div
      drag="x"
      dragElastic={0.2}
      dragTransition={{
        power: 0.3,
        restDelta: 0.001,
      }}
      x={x}
      style={{
        width: '100px',
        height: '100px',
        background: '#667eea',
        borderRadius: '8px',
        cursor: 'grab',
        opacity,
      }}
    />
  );
};
```

### Multi-Axis Drag with Constraints

```typescript
export const MultiAxisDrag = () => {
  const constraintsRef = React.useRef(null);

  return (
    <div
      ref={constraintsRef}
      style={{
        width: '400px',
        height: '400px',
        background: '#f3f4f6',
        borderRadius: '12px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <motion.div
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.15}
        whileDrag={{ scale: 1.1, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        style={{
          width: '80px',
          height: '80px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '8px',
          cursor: 'grab',
          position: 'absolute',
          top: '50%',
          left: '50%',
          x: '-50%',
          y: '-50%',
        }}
      />
    </div>
  );
};
```

### Gesture Combination: Drag + Tap + Hover

```typescript
export const GestureCombination = () => {
  const [isDragging, setIsDragging] = React.useState(false);

  return (
    <motion.button
      drag
      dragElastic={0.2}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      whileDrag={{
        scale: 1.1,
        boxShadow: '0 10px 25px rgba(102, 126, 234, 0.4)',
      }}
      whileHover={!isDragging ? { scale: 1.05, y: -4 } : {}}
      whileTap={{ scale: 0.95 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 17,
      }}
      style={{
        padding: '16px 32px',
        fontSize: '18px',
        fontWeight: 'bold',
        border: 'none',
        borderRadius: '8px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      Drag Me
    </motion.button>
  );
};
```

---

## 2. Performance Optimization Strategies

### Use `MotionConfig` for Global Settings

```typescript
import { MotionConfig } from 'framer-motion';

export const OptimizedApp = () => {
  return (
    <MotionConfig
      reducedMotion="user" // Respects prefers-reduced-motion
      transition={{
        type: 'spring',
        damping: 20,
        stiffness: 300,
        mass: 1,
      }}
    >
      <div>
        {/* All motion components inherit these settings */}
      </div>
    </MotionConfig>
  );
};
```

### Memoization & React.memo

```typescript
interface CardProps {
  title: string;
  description: string;
  index: number;
}

const AnimatedCard = React.memo(({ title, description, index }: CardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      style={{
        padding: '20px',
        background: '#f3f4f6',
        borderRadius: '8px',
      }}
    >
      <h3>{title}</h3>
      <p>{description}</p>
    </motion.div>
  );
});

// Only re-renders if props actually change
export const CardList = ({ cards }: { cards: CardProps[] }) => {
  return (
    <div>
      {cards.map((card) => (
        <AnimatedCard key={card.title} {...card} />
      ))}
    </div>
  );
};
```

### Use will-change CSS Property

```typescript
export const OptimizedAnimation = () => {
  return (
    <motion.div
      animate={{ x: [0, 100, 0] }}
      transition={{ duration: 2, repeat: Infinity }}
      style={{
        willChange: 'transform', // Hint browser for optimization
        width: '100px',
        height: '100px',
        background: '#667eea',
        borderRadius: '8px',
      }}
    />
  );
};
```

### Lazy Animation Initialization

```typescript
export const LazyAnimation = () => {
  const [shouldAnimate, setShouldAnimate] = React.useState(false);

  return (
    <div>
      <button onClick={() => setShouldAnimate(true)}>
        Start Animation
      </button>

      {shouldAnimate && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            width: '100px',
            height: '100px',
            background: '#667eea',
            borderRadius: '8px',
          }}
        />
      )}
    </div>
  );
};
```

### Transform-Only Animations (Best Performance)

```typescript
export const PerformantAnimation = () => {
  return (
    <motion.div
      animate={{
        // Good - uses transform
        x: [0, 100, 0],
        y: [0, 100, 0],
        rotate: [0, 360, 0],
        scale: [1, 1.2, 1],
        // Avoid - causes layout recalculations
        // width: [100, 200, 100],
        // height: [100, 200, 100],
        // padding: [10, 20, 10],
      }}
      transition={{ duration: 2, repeat: Infinity }}
      style={{
        width: '100px',
        height: '100px',
        background: '#667eea',
        borderRadius: '8px',
      }}
    />
  );
};
```

---

## 3. Shared Layout Animations

### Shared Layout ID Pattern

```typescript
export const SharedLayoutAnimation = () => {
  const [activeTab, setActiveTab] = React.useState(0);

  const tabs = ['Tab 1', 'Tab 2', 'Tab 3'];

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        {tabs.map((tab, index) => (
          <motion.button
            key={index}
            onClick={() => setActiveTab(index)}
            layoutId={activeTab === index ? 'activeTab' : undefined}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '6px',
              background: activeTab === index ? '#667eea' : '#e5e7eb',
              color: activeTab === index ? 'white' : '#000',
              cursor: 'pointer',
            }}
          >
            {tab}
          </motion.button>
        ))}
      </div>

      <div style={{ minHeight: '200px' }}>
        {activeTab === 0 && <motion.div layoutId="content">Content 1</motion.div>}
        {activeTab === 1 && <motion.div layoutId="content">Content 2</motion.div>}
        {activeTab === 2 && <motion.div layoutId="content">Content 3</motion.div>}
      </div>
    </div>
  );
};
```

### Morphing Shapes

```typescript
export const MorphingShapes = () => {
  const [isMorphed, setIsMorphed] = React.useState(false);

  return (
    <div>
      <motion.svg
        width="200"
        height="200"
        viewBox="0 0 200 200"
        onClick={() => setIsMorphed(!isMorphed)}
        style={{ cursor: 'pointer' }}
      >
        <motion.path
          d={
            isMorphed
              ? 'M 100 20 L 180 50 L 140 130 L 60 130 L 20 50 Z'
              : 'M 100 20 A 80 80 0 1 1 100 180 A 80 80 0 1 1 100 20'
          }
          fill="#667eea"
          transition={{ duration: 0.5 }}
        />
      </motion.svg>
    </div>
  );
};
```

---

## 4. Scroll-Linked Animations

### useScroll for Scroll Progress

```typescript
import { useScroll, useTransform } from 'framer-motion';

export const ScrollLinkedAnimation = () => {
  const ref = React.useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.5, 1, 0.5]);

  return (
    <div ref={ref} style={{ minHeight: '300vh' }}>
      <motion.div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          x: '-50%',
          y: '-50%',
          width: '200px',
          height: '200px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '12px',
          opacity,
          scale,
        }}
      />
    </div>
  );
};
```

### Parallax Scroll Effect

```typescript
export const ParallaxScroll = () => {
  const { scrollY } = useScroll();

  const y1 = useTransform(scrollY, [0, 1000], [0, 100]);
  const y2 = useTransform(scrollY, [0, 1000], [0, 50]);
  const y3 = useTransform(scrollY, [0, 1000], [0, -50]);

  return (
    <div style={{ minHeight: '200vh' }}>
      <motion.div
        style={{
          y: y1,
          width: '100%',
          height: '400px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      />
      <motion.div
        style={{
          y: y2,
          width: '100%',
          height: '400px',
          background: 'linear-gradient(135deg, #764ba2 0%, #ef4444 100%)',
        }}
      />
      <motion.div
        style={{
          y: y3,
          width: '100%',
          height: '400px',
          background: 'linear-gradient(135deg, #10b981 0%, #667eea 100%)',
        }}
      />
    </div>
  );
};
```

---

## 5. SVG Animation Techniques

### SVG Path Animation with Stroke Dasharray

```typescript
export const SVGPathAnimation = () => {
  const pathLength = 300;

  return (
    <motion.svg width="200" height="200" viewBox="0 0 200 200">
      <motion.path
        d="M 100 20 A 80 80 0 0 1 180 100"
        stroke="#667eea"
        strokeWidth="4"
        fill="none"
        strokeDasharray={pathLength}
        initial={{ strokeDashoffset: pathLength }}
        animate={{ strokeDashoffset: 0 }}
        transition={{ duration: 2, ease: 'easeInOut' }}
      />
    </motion.svg>
  );
};
```

### SVG Text Animation

```typescript
export const SVGTextAnimation = () => {
  return (
    <motion.svg
      width="400"
      height="200"
      viewBox="0 0 400 200"
      style={{ overflow: 'visible' }}
    >
      <motion.text
        x="200"
        y="100"
        textAnchor="middle"
        fontSize="48"
        fontWeight="bold"
        fill="#667eea"
        animate={{
          letterSpacing: [0, 10, 0],
          opacity: [0.5, 1, 0.5],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      >
        Animated SVG Text
      </motion.text>
    </motion.svg>
  );
};
```

### SVG Circle Drawing

```typescript
export const CircleDrawing = () => {
  const circumference = 2 * Math.PI * 45;

  return (
    <motion.svg width="200" height="200" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="45" fill="none" stroke="#e5e7eb" strokeWidth="2" />
      <motion.circle
        cx="100"
        cy="100"
        r="45"
        fill="none"
        stroke="#667eea"
        strokeWidth="4"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: 0 }}
        transition={{ duration: 2, ease: 'easeInOut' }}
      />
    </motion.svg>
  );
};
```

---

## 6. Advanced useMotionTemplate Patterns

### Dynamic Color Interpolation

```typescript
import { useMotionTemplate } from 'framer-motion';

export const DynamicColorInterpolation = () => {
  const progress = useMotionValue(0);

  const backgroundColor = useMotionTemplate`
    rgb(
      ${useTransform(progress, [0, 1], [102, 239])},
      ${useTransform(progress, [0, 1], [126, 68])},
      ${useTransform(progress, [0, 1], [234, 68])}
    )
  `;

  React.useEffect(() => {
    const controls = new AnimationControls();
    controls.start(progress, { value: 1, duration: 2, repeat: Infinity });
  }, []);

  return (
    <motion.div
      style={{
        width: '200px',
        height: '200px',
        borderRadius: '8px',
        backgroundColor,
      }}
    />
  );
};
```

---

## 7. Intersection Observer Integration

### Animate on Scroll Into View

```typescript
import { useInView } from 'react-intersection-observer';

export const AnimateOnInView = () => {
  const { ref, inView } = useInView({
    threshold: 0.1,
    triggerOnce: true, // Animate only once
  });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 50 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
      transition={{ duration: 0.6 }}
      style={{
        padding: '40px',
        background: '#f3f4f6',
        borderRadius: '8px',
        marginTop: '100vh',
      }}
    >
      This element animates when it scrolls into view
    </motion.div>
  );
};
```

---

## 8. Memory Management & Cleanup

### Proper Cleanup in useEffect

```typescript
export const MemoryManagementExample = () => {
  const controls = useAnimationControls();

  React.useEffect(() => {
    let isMounted = true;

    const startAnimation = async () => {
      if (isMounted) {
        await controls.start({ x: 100 });
        if (isMounted) {
          await controls.start({ y: 100 });
        }
      }
    };

    startAnimation();

    return () => {
      isMounted = false;
      controls.stop();
    };
  }, [controls]);

  return (
    <motion.div
      animate={controls}
      style={{
        width: '100px',
        height: '100px',
        background: '#667eea',
        borderRadius: '8px',
      }}
    />
  );
};
```

### Clean Up Motion Values

```typescript
export const MotionValueCleanup = () => {
  const x = React.useRef(useMotionValue(0));

  React.useEffect(() => {
    return () => {
      // Destroy motion value to free resources
      x.current.destroy?.();
    };
  }, []);

  return (
    <motion.div
      style={{
        x: x.current,
        width: '100px',
        height: '100px',
        background: '#667eea',
        borderRadius: '8px',
      }}
    />
  );
};
```

---

## 9. Custom Timing Functions

### Cubic Bezier Easing

```typescript
export const CustomTimingFunctions = () => {
  return (
    <div>
      {/* Ease in cubic */}
      <motion.div
        animate={{ x: 200 }}
        transition={{ duration: 1, ease: 'easeInCubic' }}
        style={{
          width: '50px',
          height: '50px',
          background: '#667eea',
          margin: '10px 0',
        }}
      />

      {/* Custom cubic bezier */}
      <motion.div
        animate={{ x: 200 }}
        transition={{
          duration: 1,
          ease: [0.17, 0.67, 0.83, 0.67], // Custom bezier
        }}
        style={{
          width: '50px',
          height: '50px',
          background: '#764ba2',
          margin: '10px 0',
        }}
      />

      {/* Anticipate + overshoot */}
      <motion.div
        animate={{ x: 200 }}
        transition={{
          duration: 1,
          ease: 'anticipate',
        }}
        style={{
          width: '50px',
          height: '50px',
          background: '#ef4444',
          margin: '10px 0',
        }}
      />
    </div>
  );
};
```

---

## 10. Production Patterns

### Animation State Machine

```typescript
type AnimationState = 'idle' | 'loading' | 'success' | 'error';

export const AnimationStateMachine = () => {
  const [state, setState] = React.useState<AnimationState>('idle');
  const controls = useAnimationControls();

  const stateVariants = {
    idle: { opacity: 1, scale: 1 },
    loading: { opacity: 0.7, scale: 1.1 },
    success: { opacity: 1, scale: 1, backgroundColor: '#10b981' },
    error: { opacity: 1, scale: 1, backgroundColor: '#ef4444' },
  };

  const handleSubmit = async () => {
    setState('loading');
    await controls.start(stateVariants.loading);

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setState('success');
      await controls.start(stateVariants.success);
    } catch (error) {
      setState('error');
      await controls.start(stateVariants.error);
    }
  };

  return (
    <div>
      <motion.div
        animate={controls}
        variants={stateVariants}
        initial="idle"
        style={{
          width: '100px',
          height: '100px',
          background: '#667eea',
          borderRadius: '8px',
          margin: '20px 0',
        }}
      />
      <button onClick={handleSubmit}>
        {state === 'idle' ? 'Submit' : state}
      </button>
    </div>
  );
};
```

### Responsive Animations

```typescript
import { useMediaQuery } from 'react-responsive';

export const ResponsiveAnimation = () => {
  const isMobile = useMediaQuery({ maxWidth: 768 });

  return (
    <motion.div
      animate={{
        x: isMobile ? 50 : 200,
        y: isMobile ? 30 : 100,
      }}
      transition={{
        type: 'spring',
        stiffness: isMobile ? 200 : 300,
        damping: 20,
      }}
      style={{
        width: isMobile ? '50px' : '100px',
        height: isMobile ? '50px' : '100px',
        background: '#667eea',
        borderRadius: '8px',
      }}
    />
  );
};
```

### Error Boundary with Animation

```typescript
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class AnimatedErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            padding: '20px',
            background: '#fee2e2',
            borderRadius: '8px',
            border: '1px solid #fecaca',
          }}
        >
          <p style={{ color: '#991b1b', fontWeight: 'bold' }}>
            Something went wrong
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              background: '#991b1b',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </motion.div>
      );
    }

    return this.props.children;
  }
}
```

---

## Performance Benchmarking

### Measuring Animation Performance

```typescript
export const PerformanceBenchmark = () => {
  const startTime = React.useRef(0);

  return (
    <motion.div
      onAnimationStart={() => {
        startTime.current = performance.now();
      }}
      onAnimationComplete={() => {
        const duration = performance.now() - startTime.current;
        console.log(`Animation took ${duration.toFixed(2)}ms`);
      }}
      animate={{ x: 100, y: 100, rotate: 360 }}
      transition={{ duration: 1 }}
      style={{
        width: '100px',
        height: '100px',
        background: '#667eea',
        borderRadius: '8px',
      }}
    />
  );
};
```

---

## Best Practices Checklist

- [ ] Use `transform` properties (x, y, scale, rotate) instead of layout properties
- [ ] Memoize animated components with `React.memo`
- [ ] Use `MotionConfig` for global settings
- [ ] Respect `prefers-reduced-motion` via `reducedMotion="user"`
- [ ] Clean up animation controls in `useEffect` cleanup function
- [ ] Use `will-change` CSS property for performance hints
- [ ] Lazy load animations when possible
- [ ] Test animations on lower-end devices
- [ ] Use `AnimatePresence` for exit animations
- [ ] Avoid animating too many properties simultaneously
- [ ] Use spring physics for interactive animations
- [ ] Use easing curves for predictable animations
- [ ] Monitor performance with DevTools
- [ ] Use `layoutId` for shared layout animations
- [ ] Implement proper error boundaries

---

## Resources

- [Framer Motion Official Documentation](https://www.framer.com/motion/)
- [React Performance Optimization Guide](https://react.dev/reference/react/useMemo)
- [Web Animation Performance](https://web.dev/animations-guide/)
- [CSS Transforms Performance](https://csstriggers.com/)

---

*Last Updated: 2025-12-16*
