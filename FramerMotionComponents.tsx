/**
 * Advanced Framer Motion Components Collection
 * Premium text animations and interactive effects
 * Ready-to-use React components with TypeScript support
 */

import React from 'react';
import {
  motion,
  AnimatePresence,
  useAnimate,
  useAnimationControls,
  MotionConfig,
  Variants,
} from 'framer-motion';

// ============================================================================
// 1. TEXT REVEAL ANIMATIONS
// ============================================================================

/**
 * Character-by-character reveal with customizable delay and stagger
 */
export const CharacterReveal: React.FC<{
  text: string;
  delay?: number;
  staggerDelay?: number;
  className?: string;
}> = ({ text, delay = 0, staggerDelay = 0.05, className = '' }) => {
  const characters = text.split('');

  return (
    <span className={className}>
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
          style={{ display: 'inline-block' }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  );
};

/**
 * Word-by-word reveal with blur-in effect
 */
export const WordRevealBlur: React.FC<{
  text: string;
  delay?: number;
  staggerDelay?: number;
  className?: string;
}> = ({ text, delay = 0, staggerDelay = 0.1, className = '' }) => {
  const words = text.split(' ');

  return (
    <div className={className}>
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
          style={{ display: 'inline-block', marginRight: '8px' }}
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
};

/**
 * Typewriter effect - character appears one by one
 */
export const TypewriterEffect: React.FC<{
  text: string;
  speed?: number;
}> = ({ text, speed = 0.05 }) => {
  const characters = text.split('');

  return (
    <span>
      {characters.map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            delay: i * speed,
            duration: 0.1,
          }}
          style={{ display: 'inline-block' }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  );
};

/**
 * Bounce-in text with spring physics
 */
export const BounceInText: React.FC<{
  text: string;
  delay?: number;
  staggerDelay?: number;
}> = ({ text, delay = 0, staggerDelay = 0.08 }) => {
  const characters = text.split('');

  return (
    <span>
      {characters.map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: delay + i * staggerDelay,
            type: 'spring',
            stiffness: 400,
            damping: 15,
            mass: 1.5,
          }}
          style={{ display: 'inline-block' }}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  );
};

/**
 * Split text reveal from left and right sides
 */
export const SplitTextAnimation: React.FC<{ text: string }> = ({ text }) => {
  const midpoint = Math.ceil(text.length / 2);
  const leftText = text.substring(0, midpoint);
  const rightText = text.substring(midpoint);

  return (
    <div style={{ overflow: 'hidden' }}>
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

/**
 * Underline reveal animation for heading text
 */
export const UnderlineReveal: React.FC<{
  text: string;
  duration?: number;
  lineHeight?: number;
  lineColor?: string;
}> = ({ text, duration = 1, lineHeight = 4, lineColor = '#667eea' }) => {
  return (
    <motion.div
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {text}
      <motion.div
        initial={{ width: '0%' }}
        animate={{ width: '100%' }}
        transition={{ duration, ease: 'easeInOut' }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: `${lineHeight}px`,
          background: lineColor,
          borderRadius: `${lineHeight / 2}px`,
        }}
      />
    </motion.div>
  );
};

/**
 * Staggered line reveal - multiple lines animate in sequence
 */
export const LineRevealAnimation: React.FC<{
  lines: string[];
  staggerDelay?: number;
}> = ({ lines, staggerDelay = 0.15 }) => {
  return (
    <div>
      {lines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            delay: i * staggerDelay,
            duration: 0.6,
            ease: 'easeOut',
          }}
          style={{ overflow: 'hidden' }}
        >
          <motion.span
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{
              delay: i * staggerDelay + 0.1,
              duration: 0.6,
              ease: 'easeOut',
            }}
            style={{ display: 'inline-block' }}
          >
            {line}
          </motion.span>
        </motion.div>
      ))}
    </div>
  );
};

// ============================================================================
// 2. GRADIENT & SHIMMER EFFECTS
// ============================================================================

/**
 * Animated gradient text with flowing effect
 */
export const GradientTextAnimation: React.FC<{
  text: string;
  duration?: number;
  gradientColors?: string[];
}> = ({ text, duration = 8, gradientColors = ['#667eea', '#764ba2', '#667eea'] }) => {
  return (
    <motion.div
      animate={{
        backgroundPosition: ['0% center', '100% center', '0% center'],
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      style={{
        background: `linear-gradient(90deg, ${gradientColors.join(', ')})`,
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

/**
 * Shimmer/shine effect across text
 */
export const ShimmerText: React.FC<{
  text: string;
  duration?: number;
}> = ({ text, duration = 3 }) => {
  return (
    <motion.div
      animate={{
        backgroundPosition: ['200% center', '-200% center'],
      }}
      transition={{
        duration,
        repeat: Infinity,
        ease: 'linear',
      }}
      style={{
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

/**
 * Floating text with 3D perspective effect
 */
export const FloatingTextAnimation: React.FC<{ text: string }> = ({ text }) => {
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
        perspective: '1000px',
        transformStyle: 'preserve-3d',
      }}
    >
      {text}
    </motion.div>
  );
};

// ============================================================================
// 3. COMPLEX CONTAINER ANIMATIONS
// ============================================================================

/**
 * Container with staggered children - animates all children in sequence
 */
export const StaggerContainer: React.FC<{
  children: React.ReactNode;
  staggerDelay?: number;
  delayChildren?: number;
  staggerDirection?: number;
  onAnimationComplete?: () => void;
}> = ({
  children,
  staggerDelay = 0.1,
  delayChildren = 0.2,
  staggerDirection = 1,
  onAnimationComplete,
}) => {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: staggerDelay,
        delayChildren,
        staggerDirection,
      },
    },
    exit: {
      opacity: 0,
      transition: {
        staggerChildren: staggerDelay * 0.5,
        staggerDirection: staggerDirection === 1 ? -1 : 1,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 100 },
    },
    exit: { opacity: 0, y: -20 },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onAnimationComplete={onAnimationComplete}
    >
      {React.Children.map(children, (child) => (
        <motion.div variants={itemVariants}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
};

/**
 * Grid layout with staggered children
 */
export const GridStagger: React.FC<{
  children: React.ReactNode;
  columns?: number;
  gap?: number;
  staggerDelay?: number;
}> = ({ children, columns = 3, gap = 20, staggerDelay = 0.1 }) => {
  const container: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: staggerDelay,
      },
    },
  };

  const item: Variants = {
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
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: `${gap}px`,
      }}
    >
      {React.Children.map(children, (child) => (
        <motion.div variants={item}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
};

// ============================================================================
// 4. GESTURE & INTERACTION ANIMATIONS
// ============================================================================

/**
 * Draggable element with constraints and physics
 */
export const DraggableElement: React.FC<{
  children: React.ReactNode;
  constraintsRef?: React.RefObject<HTMLElement>;
  onDragEnd?: (x: number, y: number) => void;
}> = ({ children, constraintsRef, onDragEnd }) => {
  const handleDragEnd = (event: any, info: any) => {
    onDragEnd?.(info.x, info.y);
  };

  return (
    <motion.div
      drag
      dragConstraints={constraintsRef}
      dragElastic={0.2}
      dragMomentum={true}
      whileDrag={{ scale: 1.1 }}
      whileHover={{ scale: 1.05 }}
      onDragEnd={handleDragEnd}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      style={{
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      {children}
    </motion.div>
  );
};

/**
 * Button with hover and tap animations
 */
export const AnimatedButton: React.FC<{
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline';
  disabled?: boolean;
  className?: string;
}> = ({ onClick, children, variant = 'primary', disabled = false, className = '' }) => {
  const baseStyles: React.CSSProperties = {
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      ...baseStyles,
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
    },
    secondary: {
      ...baseStyles,
      background: '#f3f4f6',
      color: '#1f2937',
    },
    outline: {
      ...baseStyles,
      background: 'transparent',
      border: '2px solid #667eea',
      color: '#667eea',
    },
  };

  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.05, y: -2 } : {}}
      whileTap={!disabled ? { scale: 0.95 } : {}}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 17,
      }}
      onClick={onClick}
      disabled={disabled}
      style={variantStyles[variant]}
      className={className}
    >
      {children}
    </motion.button>
  );
};

/**
 * Expandable card with spring physics
 */
export const ExpandableCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <motion.div
      animate={{ height: isExpanded ? 'auto' : 60 }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 30,
      }}
      style={{
        background: '#f3f4f6',
        borderRadius: '8px',
        overflow: 'hidden',
        padding: '16px',
      }}
    >
      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '16px',
          fontWeight: 600,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          padding: 0,
        }}
      >
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.3 }}
          style={{ display: 'inline-block', marginRight: '8px' }}
        >
          ▼
        </motion.span>
        {title}
      </motion.button>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isExpanded ? 1 : 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        style={{
          marginTop: '12px',
          fontSize: '14px',
          lineHeight: '1.6',
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
};

// ============================================================================
// 5. CONTROLLED ANIMATIONS WITH HOOKS
// ============================================================================

/**
 * Component with useAnimate hook for sequence control
 */
export const SequenceAnimationController = () => {
  const [scope, animate] = useAnimate();
  const [isPlaying, setIsPlaying] = React.useState(false);

  const handlePlaySequence = async () => {
    if (isPlaying) return;
    setIsPlaying(true);

    try {
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
    } finally {
      setIsPlaying(false);
    }
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
      <button onClick={handlePlaySequence} disabled={isPlaying}>
        {isPlaying ? 'Playing...' : 'Play Sequence'}
      </button>
    </div>
  );
};

/**
 * Component with useAnimationControls for manual animation control
 */
export const ManualAnimationControl = () => {
  const controls = useAnimationControls();

  const playAnimation = async () => {
    await controls.start({ rotate: 360, transition: { duration: 1 } });
    await controls.start({ scale: 1.2, transition: { duration: 0.5 } });
    await controls.start({ scale: 1, rotate: 0, transition: { duration: 0.5 } });
  };

  return (
    <div>
      <motion.div
        animate={controls}
        style={{
          width: '100px',
          height: '100px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '8px',
        }}
      />
      <button onClick={playAnimation}>Start</button>
      <button onClick={() => controls.stop()}>Stop</button>
    </div>
  );
};

// ============================================================================
// 6. EXIT ANIMATIONS WITH ANIMATEPRESENCE
// ============================================================================

/**
 * Toast notification with exit animation
 */
export const Toast: React.FC<{
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: (id: string) => void;
}> = ({ id, message, type = 'info', onClose }) => {
  React.useEffect(() => {
    const timer = setTimeout(() => onClose(id), 3000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  const typeColors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      style={{
        padding: '16px',
        borderRadius: '8px',
        marginBottom: '10px',
        background: typeColors[type],
        color: 'white',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      }}
    >
      {message}
    </motion.div>
  );
};

/**
 * Toast container with AnimatePresence
 */
export const ToastContainer = () => {
  const [toasts, setToasts] = React.useState<
    Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>
  >([]);

  const addToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) => {
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  return (
    <div>
      <div style={{ position: 'fixed', top: '20px', right: '20px' }}>
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              {...toast}
              onClose={removeToast}
            />
          ))}
        </AnimatePresence>
      </div>

      <div style={{ padding: '20px' }}>
        <button onClick={() => addToast('Success!', 'success')}>
          Show Success
        </button>
        <button onClick={() => addToast('Error!', 'error')}>
          Show Error
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// 7. LAYOUT & MODAL ANIMATIONS
// ============================================================================

/**
 * Modal with backdrop and spring animations
 */
export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ isOpen, onClose, title, children }) => {
  const backdropVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const modalVariants: Variants = {
    hidden: {
      opacity: 0,
      scale: 0.75,
      y: 20,
    },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 30,
      },
    },
    exit: {
      opacity: 0,
      scale: 0.75,
      y: 20,
    },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={onClose}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 40,
            }}
          />
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              x: '-50%',
              y: '-50%',
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              zIndex: 50,
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            }}
          >
            <h2 style={{ marginTop: 0 }}>{title}</h2>
            <div style={{ marginBottom: '20px' }}>
              {children}
            </div>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// ============================================================================
// 8. PAGE TRANSITION EXAMPLE
// ============================================================================

/**
 * Page component with directional transition
 */
export const TransitionPage: React.FC<{
  pageIndex: number;
  direction: number;
  children: React.ReactNode;
}> = ({ pageIndex, direction, children }) => {
  const pageVariants: Variants = {
    initial: (dir: number) => ({
      x: dir > 0 ? 1000 : -1000,
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
    exit: (dir: number) => ({
      x: dir < 0 ? 1000 : -1000,
      opacity: 0,
    }),
  };

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

/**
 * Page navigation with transitions
 */
export const PageNavigationExample = () => {
  const [pageIndex, setPageIndex] = React.useState(0);
  const [direction, setDirection] = React.useState(0);

  const pages = ['Page 1', 'Page 2', 'Page 3', 'Page 4'];

  const paginate = (newDirection: number) => {
    const newIndex = pageIndex + newDirection;
    if (newIndex >= 0 && newIndex < pages.length) {
      setDirection(newDirection);
      setPageIndex(newIndex);
    }
  };

  return (
    <div>
      <AnimatePresence mode="wait" custom={direction}>
        <TransitionPage pageIndex={pageIndex} direction={direction}>
          <div style={{ padding: '40px', fontSize: '32px' }}>
            {pages[pageIndex]}
          </div>
        </TransitionPage>
      </AnimatePresence>

      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <button onClick={() => paginate(-1)} disabled={pageIndex === 0}>
          Previous
        </button>
        <span style={{ margin: '0 10px' }}>
          {pageIndex + 1} / {pages.length}
        </span>
        <button
          onClick={() => paginate(1)}
          disabled={pageIndex === pages.length - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// 9. UTILITY HOOK: useAnimationController
// ============================================================================

/**
 * Custom hook for managing complex animation sequences
 */
export const useAnimationSequence = () => {
  const controls = useAnimationControls();
  const [isPlaying, setIsPlaying] = React.useState(false);

  const createSequence = React.useCallback(
    (
      steps: Array<{
        target: Record<string, any>;
        duration?: number;
        delay?: number;
        transition?: any;
      }>
    ) => {
      return async () => {
        if (isPlaying) return;
        setIsPlaying(true);

        try {
          for (const step of steps) {
            await controls.start({
              ...step.target,
              transition: step.transition || {
                duration: step.duration || 0.5,
                delay: step.delay || 0,
              },
            });
          }
        } finally {
          setIsPlaying(false);
        }
      };
    },
    [controls, isPlaying]
  );

  return { controls, isPlaying, createSequence };
};

export default {
  CharacterReveal,
  WordRevealBlur,
  TypewriterEffect,
  BounceInText,
  SplitTextAnimation,
  UnderlineReveal,
  LineRevealAnimation,
  GradientTextAnimation,
  ShimmerText,
  FloatingTextAnimation,
  StaggerContainer,
  GridStagger,
  DraggableElement,
  AnimatedButton,
  ExpandableCard,
  SequenceAnimationController,
  ManualAnimationControl,
  Toast,
  ToastContainer,
  Modal,
  TransitionPage,
  PageNavigationExample,
  useAnimationSequence,
};
