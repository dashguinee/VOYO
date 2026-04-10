# Advanced Framer Motion Animation Techniques - 2025

Complete guide with React/TypeScript code snippets for premium text animations and interactive effects.

---

## Table of Contents
1. Variants for Complex Multi-Element Animations
2. AnimatePresence with Custom Transitions
3. useAnimation & useAnimate Hooks for Controlled Sequences
4. Stagger Children Animations
5. Spring Physics for Organic Movement
6. Keyframes for Complex Paths
7. Gesture-Based Animations (Drag, Tap, Hover)
8. Premium Text Animation Examples

---

## 1. Variants for Complex Multi-Element Animations

### Concept
Variants allow you to define multiple animation states that propagate through parent-child component hierarchies. This enables synchronized, orchestrated animations across multiple elements.

### Code Example: Variant Propagation

```typescript
import { motion } from 'framer-motion';
import React from 'react';

// Define animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
      when: 'beforeChildren', // Animate parent before children
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.05,
      staggerDirection: -1, // Reverse stagger order
    },
  },
};

const itemVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    rotateX: -90,
  },
  visible: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: {
      type: 'spring',
      stiffness: 100,
      damping: 12,
      duration: 0.5,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    rotateX: 90,
  },
};

export const VariantPropagationExample = () => {
  const [isVisible, setIsVisible] = React.useState(true);

  return (
    <div>
      <button onClick={() => setIsVisible(!isVisible)}>
        Toggle Animation
      </button>

      {isVisible && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              variants={itemVariants}
              style={{
                padding: '20px',
                margin: '10px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderRadius: '8px',
                color: 'white',
              }}
            >
              Item {i + 1}
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
};
```

### Advanced: Dynamic Variant Switching

```typescript
interface TextProps {
  text: string;
  state: 'idle' | 'active' | 'error';
}

const advancedVariants = {
  idle: {
    letterSpacing: '0px',
    color: '#000',
  },
  active: {
    letterSpacing: '2px',
    color: '#667eea',
    textShadow: '0 0 8px rgba(102, 126, 234, 0.5)',
  },
  error: {
    letterSpacing: '-1px',
    color: '#ef4444',
    textShadow: '0 0 8px rgba(239, 68, 68, 0.5)',
  },
};

const charVariants = {
  idle: { y: 0, opacity: 1 },
  active: {
    y: -5,
    opacity: 1,
    transition: { type: 'spring', stiffness: 200 }
  },
  error: {
    y: 5,
    opacity: 0.7,
    transition: { type: 'spring', stiffness: 200 }
  },
};

export const DynamicTextVariant: React.FC<TextProps> = ({ text, state }) => {
  return (
    <motion.div
      variants={advancedVariants}
      animate={state}
      style={{ fontSize: '32px', fontWeight: 'bold' }}
    >
      {text.split('').map((char, i) => (
        <motion.span
          key={i}
          variants={charVariants}
          animate={state}
          transition={{ delay: i * 0.05 }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </motion.div>
  );
};
```

---

## 2. AnimatePresence with Custom Transitions

### Concept
`AnimatePresence` allows components to animate out when they're removed from the React tree, solving the problem of exit animations.

### Code Example: Page Transitions

```typescript
import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';

const pageVariants = {
  initial: (direction: number) => ({
    x: direction > 0 ? 1000 : -1000,
    opacity: 0,
  }),
  animate: {
    x: 0,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
      mass: 0.8,
    },
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 1000 : -1000,
    opacity: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  }),
};

interface PageProps {
  pageIndex: number;
  direction: number;
  children: React.ReactNode;
}

const Page: React.FC<PageProps> = ({ pageIndex, direction, children }) => {
  return (
    <motion.div
      key={pageIndex}
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  );
};

export const PageTransitionExample = () => {
  const [pageIndex, setPageIndex] = React.useState(0);
  const [direction, setDirection] = React.useState(0);

  const paginate = (newDirection: number) => {
    setDirection(newDirection);
    setPageIndex(pageIndex + newDirection);
  };

  return (
    <div>
      <AnimatePresence mode="wait" custom={direction}>
        <Page pageIndex={pageIndex} direction={direction}>
          <div style={{ padding: '40px', fontSize: '32px' }}>
            Page {pageIndex}
          </div>
        </Page>
      </AnimatePresence>

      <div style={{ marginTop: '20px' }}>
        <button onClick={() => paginate(-1)}>Previous</button>
        <button onClick={() => paginate(1)}>Next</button>
      </div>
    </div>
  );
};
```

### Advanced: Custom Exit Transitions

```typescript
interface ToastProps {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  onRemove: (id: string) => void;
}

const toastVariants = {
  initial: (type: string) => ({
    opacity: 0,
    y: type === 'success' ? -50 : 50,
    scale: 0.8,
  }),
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 40,
    },
  },
  exit: (type: string) => ({
    opacity: 0,
    y: type === 'success' ? 100 : -100,
    scale: 0.5,
    transition: {
      duration: 0.3,
    },
  }),
};

const Toast: React.FC<ToastProps> = ({ id, message, type, onRemove }) => {
  React.useEffect(() => {
    const timer = setTimeout(() => onRemove(id), 3000);
    return () => clearTimeout(timer);
  }, [id, onRemove]);

  return (
    <motion.div
      custom={type}
      variants={toastVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{
        padding: '16px',
        borderRadius: '8px',
        marginBottom: '10px',
        background: type === 'success' ? '#10b981' : '#ef4444',
        color: 'white',
      }}
    >
      {message}
    </motion.div>
  );
};

export const ToastContainer = () => {
  const [toasts, setToasts] = React.useState<ToastProps[]>([]);

  const addToast = (message: string, type: ToastProps['type']) => {
    const id = Math.random().toString();
    setToasts([...toasts, { id, message, type, onRemove: removeToast }]);
  };

  const removeToast = (id: string) => {
    setToasts(toasts.filter(toast => toast.id !== id));
  };

  return (
    <div>
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </AnimatePresence>

      <button onClick={() => addToast('Success!', 'success')}>
        Show Success
      </button>
      <button onClick={() => addToast('Error!', 'error')}>
        Show Error
      </button>
    </div>
  );
};
```

---

## 3. useAnimation & useAnimate Hooks for Controlled Sequences

### useAnimate Hook (Recommended - 2025)

```typescript
import { useAnimate } from 'framer-motion';
import React from 'react';

export const SequenceAnimation = () => {
  const [scope, animate] = useAnimate();

  const handleSequence = async () => {
    // Animate sequence: duration in seconds
    await animate(
      scope.current,
      { x: 100, backgroundColor: '#667eea' },
      { duration: 0.5 }
    );

    await animate(
      scope.current,
      { y: 100, rotate: 180 },
      { duration: 0.5 }
    );

    await animate(
      scope.current,
      { x: 0, y: 0, rotate: 0, backgroundColor: '#764ba2' },
      { duration: 0.5 }
    );
  };

  return (
    <div>
      <div
        ref={scope}
        style={{
          width: '100px',
          height: '100px',
          background: '#667eea',
          borderRadius: '8px',
        }}
      />
      <button onClick={handleSequence}>Start Sequence</button>
    </div>
  );
};
```

### Complex Sequence with Multiple Elements

```typescript
export const ComplexSequence = () => {
  const [scope, animate] = useAnimate();

  const handleAnimateAll = async () => {
    const items = scope.current.querySelectorAll('.item');

    // Stagger animation across multiple elements
    items.forEach((item, index) => {
      animate(
        item,
        { y: [0, -20, 0], opacity: [0, 1, 1] },
        { duration: 0.6, delay: index * 0.1 }
      );
    });
  };

  return (
    <div ref={scope}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="item"
          style={{
            width: '80px',
            height: '80px',
            background: '#667eea',
            margin: '10px',
            borderRadius: '4px',
          }}
        />
      ))}
      <button onClick={handleAnimateAll}>Animate All</button>
    </div>
  );
};
```

### useAnimationControls (Legacy but Still Powerful)

```typescript
import { motion, useAnimationControls } from 'framer-motion';

export const ControlledAnimation = () => {
  const controls = useAnimationControls();

  const playSequence = async () => {
    await controls.start({ rotate: 180, transition: { duration: 0.5 } });
    await controls.start({ scale: 1.2, transition: { duration: 0.3 } });
    await controls.start({ rotate: 0, scale: 1, transition: { duration: 0.5 } });
  };

  return (
    <div>
      <motion.div
        animate={controls}
        style={{
          width: '100px',
          height: '100px',
          background: '#667eea',
          borderRadius: '8px',
        }}
      />
      <button onClick={playSequence}>Play Sequence</button>
    </div>
  );
};
```

---

## 4. Stagger Children Animations

### Basic Stagger

```typescript
const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.3,
    },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 100 },
  },
};

export const BasicStagger = () => {
  return (
    <motion.ul
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {['Item 1', 'Item 2', 'Item 3', 'Item 4'].map((item) => (
        <motion.li key={item} variants={staggerItem}>
          {item}
        </motion.li>
      ))}
    </motion.ul>
  );
};
```

### Advanced: Reverse Stagger with Direction Control

```typescript
const reverseStaggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      staggerDirection: -1, // Reverse order (last animates first)
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.1,
      staggerDirection: 1, // Forward on exit
    },
  },
};

export const ReverseStagger = () => {
  const [show, setShow] = React.useState(true);

  return (
    <div>
      <button onClick={() => setShow(!show)}>Toggle</button>
      <AnimatePresence>
        {show && (
          <motion.div
            variants={reverseStaggerContainer}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <motion.div
                key={i}
                variants={staggerItem}
                style={{
                  padding: '20px',
                  margin: '10px',
                  background: '#667eea',
                  color: 'white',
                  borderRadius: '8px',
                }}
              >
                Item {i + 1}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
```

### Grid Stagger (2D Pattern)

```typescript
export const GridStagger = () => {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, scale: 0 },
    show: {
      opacity: 1,
      scale: 1,
      transition: {
        type: 'spring',
        stiffness: 260,
        damping: 20,
      },
    },
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '20px',
      }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <motion.div
          key={i}
          variants={item}
          style={{
            width: '100px',
            height: '100px',
            background: `hsl(${i * 40}, 70%, 60%)`,
            borderRadius: '8px',
          }}
        />
      ))}
    </motion.div>
  );
};
```

---

## 5. Spring Physics for Organic Movement

### Spring Physics Properties

```typescript
// Spring configurations
const softSpring = {
  type: 'spring',
  stiffness: 100,
  damping: 20,
  mass: 1,
};

const snappySpring = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
  mass: 0.5,
};

const bounceSpring = {
  type: 'spring',
  stiffness: 400,
  damping: 10,
  mass: 1.5,
};

export const SpringPhysicsDemo = () => {
  return (
    <div>
      <motion.div
        drag
        dragElastic={0.2}
        dragTransition={{ power: 0.3, restDelta: 0.001 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        transition={snappySpring}
        style={{
          width: '100px',
          height: '100px',
          background: '#667eea',
          borderRadius: '8px',
          cursor: 'grab',
          margin: '50px',
        }}
      />
    </div>
  );
};
```

### Gesture with Spring Physics

```typescript
export const GestureSpringAnimation = () => {
  return (
    <motion.button
      whileHover={{
        scale: 1.05,
        boxShadow: '0 10px 25px rgba(102, 126, 234, 0.3)',
      }}
      whileTap={{
        scale: 0.95,
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 17,
      }}
      style={{
        padding: '12px 24px',
        fontSize: '16px',
        border: 'none',
        borderRadius: '8px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        cursor: 'pointer',
      }}
    >
      Spring Button
    </motion.button>
  );
};
```

### Duration-Based Spring (Easer to Control)

```typescript
const durationSpring = {
  type: 'spring',
  duration: 0.8,
  bounce: 0.25,
};

export const DurationSpringAnimation = () => {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Toggle</button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={durationSpring}
            style={{
              background: '#667eea',
              color: 'white',
              padding: '20px',
              borderRadius: '8px',
              marginTop: '20px',
              overflow: 'hidden',
            }}
          >
            This content slides in with duration-based spring physics!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
```

---

## 6. Keyframes for Complex Paths

### Simple Keyframe Animation

```typescript
export const KeyframeAnimation = () => {
  return (
    <motion.div
      animate={{
        x: [0, 100, 100, 0],
        y: [0, 0, 100, 100],
        rotate: [0, 90, 180, 270],
        backgroundColor: ['#667eea', '#764ba2', '#ef4444', '#10b981'],
      }}
      transition={{
        duration: 3,
        ease: 'easeInOut',
        repeat: Infinity,
      }}
      style={{
        width: '80px',
        height: '80px',
        borderRadius: '8px',
      }}
    />
  );
};
```

### SVG Path Animation (Morphing Shapes)

```typescript
export const SVGPathAnimation = () => {
  return (
    <motion.svg
      width="200"
      height="200"
      viewBox="0 0 200 200"
      style={{ overflow: 'visible' }}
    >
      <motion.circle
        cx="100"
        cy="100"
        r="50"
        fill="none"
        stroke="#667eea"
        strokeWidth="2"
        animate={{
          r: [50, 80, 50],
          opacity: [1, 0.5, 1],
          strokeDasharray: [0, 314, 0],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </motion.svg>
  );
};
```

### Complex Path with Multiple Keyframes

```typescript
export const ComplexKeyframeAnimation = () => {
  return (
    <motion.div
      animate={{
        x: [0, 150, 150, -150, 0],
        y: [0, -100, 100, 0, -100],
        scale: [1, 1.2, 0.8, 1.1, 1],
        rotate: [0, 45, -45, 90, 0],
        borderRadius: ['0%', '50%', '0%', '50%', '0%'],
      }}
      transition={{
        duration: 5,
        times: [0, 0.25, 0.5, 0.75, 1],
        ease: ['easeInOut', 'easeInOut', 'easeInOut', 'easeInOut'],
        repeat: Infinity,
      }}
      style={{
        width: '80px',
        height: '80px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        position: 'absolute',
      }}
    />
  );
};
```

---

## 7. Gesture-Based Animations (Drag, Tap, Hover)

### Drag Animations with Constraints

```typescript
export const DragAnimation = () => {
  return (
    <div
      style={{
        width: '300px',
        height: '300px',
        background: '#f3f4f6',
        borderRadius: '12px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <motion.div
        drag
        dragConstraints={{ left: -100, right: 100, top: -100, bottom: 100 }}
        dragElastic={0.2}
        dragMomentum={true}
        whileDrag={{ scale: 1.1, shadow: '0 10px 30px rgba(0,0,0,0.3)' }}
        whileHover={{ scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        style={{
          width: '80px',
          height: '80px',
          background: '#667eea',
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

### Hover with Tap Effects

```typescript
export const HoverTapAnimation = () => {
  return (
    <motion.button
      whileHover={{
        scale: 1.08,
        y: -4,
        boxShadow: '0 20px 40px rgba(102, 126, 234, 0.4)',
      }}
      whileTap={{
        scale: 0.92,
        y: 0,
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 17,
      }}
      style={{
        padding: '16px 32px',
        fontSize: '18px',
        fontWeight: 600,
        border: 'none',
        borderRadius: '12px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        cursor: 'pointer',
        boxShadow: '0 10px 20px rgba(102, 126, 234, 0.2)',
      }}
    >
      Hover & Tap Me
    </motion.button>
  );
};
```

### Pan Gesture with Callbacks

```typescript
export const PanGestureAnimation = () => {
  const [isDragging, setIsDragging] = React.useState(false);

  return (
    <motion.div
      drag
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      dragElastic={0.15}
      whileDrag={{
        scale: 1.15,
        opacity: 0.8,
        filter: 'blur(1px)',
      }}
      animate={{
        scale: isDragging ? 1.15 : 1,
        opacity: 1,
      }}
      style={{
        width: '100px',
        height: '100px',
        background: '#667eea',
        borderRadius: '8px',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    />
  );
};
```

### Drag to Sort List

```typescript
interface DragListItem {
  id: string;
  label: string;
}

export const DragSortList: React.FC<{ items: DragListItem[] }> = ({ items: initialItems }) => {
  const [items, setItems] = React.useState(initialItems);

  return (
    <div>
      {items.map((item, index) => (
        <motion.div
          key={item.id}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.2}
          whileDrag={{
            scale: 1.05,
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            zIndex: 10,
          }}
          layoutId={item.id}
          style={{
            padding: '16px',
            margin: '8px 0',
            background: '#f3f4f6',
            borderRadius: '8px',
            cursor: 'grab',
          }}
        >
          {item.label}
        </motion.div>
      ))}
    </div>
  );
};
```

---

## 8. Premium Text Animations

### Character-by-Character Reveal

```typescript
interface RevealTextProps {
  text: string;
  delay?: number;
  staggerDelay?: number;
}

export const CharacterReveal: React.FC<RevealTextProps> = ({
  text,
  delay = 0,
  staggerDelay = 0.05,
}) => {
  const characters = text.split('');

  return (
    <motion.span
      initial="hidden"
      animate="visible"
      style={{
        display: 'inline-block',
      }}
    >
      {characters.map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: delay + i * staggerDelay,
            duration: 0.5,
            ease: 'easeOut',
          }}
          style={{
            display: 'inline-block',
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </motion.span>
  );
};
```

### Word-by-Word Reveal with Blur

```typescript
export const WordRevealBlur: React.FC<RevealTextProps> = ({
  text,
  delay = 0,
  staggerDelay = 0.1,
}) => {
  const words = text.split(' ');

  return (
    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{
            delay: delay + i * staggerDelay,
            duration: 0.6,
            ease: 'easeOut',
          }}
          style={{
            display: 'inline-block',
            marginRight: '8px',
          }}
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
};
```

### Gradient Text Animation

```typescript
export const GradientTextAnimation = ({ text }: { text: string }) => {
  return (
    <motion.div
      animate={{
        backgroundPosition: ['0% center', '100% center', '0% center'],
      }}
      transition={{
        duration: 8,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      style={{
        fontSize: '48px',
        fontWeight: 'bold',
        background: 'linear-gradient(90deg, #667eea, #764ba2, #667eea)',
        backgroundSize: '200% 200%',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}
    >
      {text}
    </motion.div>
  );
};
```

### Floating Text with Perspective

```typescript
export const FloatingTextAnimation = ({ text }: { text: string }) => {
  return (
    <motion.div
      animate={{
        y: [0, -20, 0],
        rotateX: [0, 5, 0],
        rotateY: [0, -5, 0],
      }}
      transition={{
        duration: 4,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      style={{
        fontSize: '36px',
        fontWeight: 'bold',
        perspective: '1000px',
        transformStyle: 'preserve-3d',
      }}
    >
      {text}
    </motion.div>
  );
};
```

### Typewriter Effect

```typescript
export const TypewriterEffect = ({ text }: { text: string }) => {
  const characters = text.split('');

  return (
    <span>
      {characters.map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            delay: i * 0.05,
            duration: 0.1,
          }}
          style={{
            display: 'inline-block',
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  );
};
```

### Shimmer/Shine Effect

```typescript
export const ShimmerText = ({ text }: { text: string }) => {
  return (
    <motion.div
      animate={{
        backgroundPosition: ['200% center', '-200% center'],
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: 'linear',
      }}
      style={{
        fontSize: '32px',
        fontWeight: 'bold',
        background: `
          linear-gradient(
            90deg,
            #667eea 0%,
            #764ba2 25%,
            #667eea 50%,
            #764ba2 75%,
            #667eea 100%
          )
        `,
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}
    >
      {text}
    </motion.div>
  );
};
```

### Bounce in Text

```typescript
export const BounceInText = ({
  text,
  delay = 0,
}: {
  text: string;
  delay?: number;
}) => {
  const characters = text.split('');

  return (
    <span>
      {characters.map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: delay + i * 0.08,
            type: 'spring',
            stiffness: 400,
            damping: 15,
            mass: 1.5,
          }}
          style={{
            display: 'inline-block',
            fontSize: '28px',
            fontWeight: 'bold',
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  );
};
```

### Split Text Animation (Reveal Left/Right)

```typescript
export const SplitTextAnimation = ({ text }: { text: string }) => {
  const midpoint = Math.ceil(text.length / 2);
  const leftText = text.substring(0, midpoint);
  const rightText = text.substring(midpoint);

  return (
    <div style={{ fontSize: '32px', fontWeight: 'bold', overflow: 'hidden' }}>
      <motion.span
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        style={{ display: 'inline-block' }}
      >
        {leftText}
      </motion.span>
      <motion.span
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        style={{ display: 'inline-block' }}
      >
        {rightText}
      </motion.span>
    </div>
  );
};
```

### Underline Reveal Animation

```typescript
export const UnderlineReveal = ({ text }: { text: string }) => {
  return (
    <motion.div
      style={{
        fontSize: '32px',
        fontWeight: 'bold',
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {text}
      <motion.div
        initial={{ width: '0%' }}
        animate={{ width: '100%' }}
        transition={{ duration: 1, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: '4px',
          background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '2px',
        }}
      />
    </motion.div>
  );
};
```

### Advanced: Staggered Line Reveal

```typescript
export const LineRevealAnimation = ({ lines }: { lines: string[] }) => {
  return (
    <div style={{ fontSize: '24px', lineHeight: '1.8' }}>
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            delay: i * 0.15,
            duration: 0.6,
            ease: 'easeOut',
          }}
          style={{
            overflow: 'hidden',
          }}
        >
          <motion.span
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{
              delay: i * 0.15 + 0.1,
              duration: 0.6,
              ease: 'easeOut',
            }}
            style={{
              display: 'inline-block',
            }}
          >
            {line}
          </motion.span>
        </motion.div>
      ))}
    </div>
  );
};
```

---

## Installation & Setup

```bash
npm install framer-motion
# or
yarn add framer-motion
```

### TypeScript Configuration

Ensure your `tsconfig.json` includes DOM types:

```json
{
  "compilerOptions": {
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  }
}
```

---

## Performance Tips

1. **Use `MotionConfig` for global settings**:
```typescript
import { MotionConfig } from 'framer-motion';

<MotionConfig reducedMotion="user">
  <YourComponent />
</MotionConfig>
```

2. **Memoize components with animations**:
```typescript
export const MemoizedAnimatedComponent = React.memo(YourComponent);
```

3. **Use `will-change` CSS sparingly**:
```typescript
style={{ willChange: 'transform, opacity' }}
```

4. **Prefer `transform` over layout properties** for animations

5. **Use `layoutId` for shared layout animations** to reduce re-renders

---

## Browser Support

Framer Motion supports all modern browsers:
- Chrome/Edge: v90+
- Firefox: v88+
- Safari: v14+

---

## Sources
- [Mastering Framer Motion: Advanced Animation Techniques for 2025](https://www.luxisdesign.io/blog/mastering-framer-motion-advanced-animation-techniques-for-2025)
- [Advanced animation patterns with Framer Motion - The Blog of Maxime Heckel](https://blog.maximeheckel.com/posts/advanced-animation-patterns-with-framer-motion/)
- [React animation — Transforms, keyframes & transitions | Motion](https://motion.dev/docs/react-animation)
- [AnimatePresence — React exit animations | Motion](https://www.framer.com/motion/animate-presence/)
- [React gesture animations — hover, drag, press | Motion](https://www.framer.com/motion/gestures/)
- [useAnimate — Manual React animation controls | Motion](https://motion.dev/docs/react-use-animate)
- [Framer Motion React Animations | Refine](https://refine.dev/blog/framer-motion/)
