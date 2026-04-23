/**
 * CardHoldActions — hold/swipe action wrapper for track cards.
 *
 * Interaction spec:
 *   HOLD (500ms):
 *     - haptic vibrate(30)
 *     - card scales 1.02, box-shadow depth deepens
 *     - page dims: fixed overlay opacity 0.4, NO blur
 *     - themed top-edge beam on card
 *     - two plush pills slide UP from behind card's top edge
 *     - dismiss: tap outside, 4s timeout, scroll, back gesture
 *
 *   SWIPE L/R:
 *     - card follows finger (translateX)
 *     - themed edge trail in swipe direction
 *     - ≥60% card width → action fires on pointerup
 *     - <60% → springs back (240ms ease)
 *
 * Pill visual reuses VoyoCloseX radial-gradient language verbatim.
 * Long-press pattern mirrors Library.tsx SongRow heart button (500ms timer,
 * cancel on move >5px vertical or >10px horizontal).
 * useBackGuard dismisses on back gesture.
 */

import { ReactNode, useRef, useState, useCallback, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Heart, Plus, Download, Zap } from 'lucide-react';
import { useBackGuard } from '../../hooks/useBackGuard';

// ─── Action type ──────────────────────────────────────────────────────────────

export interface CardAction {
  id: 'like' | 'playlist' | 'oye' | 'download';
  label: string;
  icon: LucideIcon;
  onFire: () => void;
  beamColor: string;
  pillGradient: { highlight: string; core: string; edge: string };
}

// ─── Pre-built action descriptors (caller adds onFire) ───────────────────────

/**
 * Shared action presets. Caller merges `onFire` before passing to the wrapper:
 *
 *   leftAction={{ ...CARD_ACTIONS.like, onFire: () => setExplicitLike(id, true) }}
 */
export const CARD_ACTIONS: Record<
  'oye' | 'like' | 'playlist' | 'download',
  Omit<CardAction, 'onFire'>
> = {
  oye: {
    id: 'oye',
    label: 'OYÉ',
    icon: Zap,
    beamColor: '#D4A053',
    pillGradient: {
      highlight: 'rgba(244,217,153,0.55)',
      core: 'rgba(139,98,40,0.95)',
      edge: 'rgba(60,40,10,0.95)',
    },
  },
  like: {
    id: 'like',
    label: 'Like',
    icon: Heart,
    beamColor: '#f472b6',
    pillGradient: {
      highlight: 'rgba(244,114,182,0.45)',
      core: 'rgba(131,24,67,0.95)',
      edge: 'rgba(45,8,26,0.95)',
    },
  },
  playlist: {
    id: 'playlist',
    label: 'Add to Playlist',
    icon: Plus,
    beamColor: '#a78bfa',
    pillGradient: {
      highlight: 'rgba(167,139,250,0.45)',
      core: 'rgba(73,24,114,0.95)',
      edge: 'rgba(32,13,58,0.95)',
    },
  },
  download: {
    id: 'download',
    label: 'Download',
    icon: Download,
    beamColor: '#c4e0ff',
    pillGradient: {
      highlight: 'rgba(196,224,255,0.4)',
      core: 'rgba(58,84,130,0.95)',
      edge: 'rgba(18,28,50,0.95)',
    },
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CardHoldActionsProps {
  children: ReactNode;
  leftAction: CardAction;
  rightAction: CardAction;
  className?: string;
}

// ─── Pill button ──────────────────────────────────────────────────────────────

/**
 * ActionPill — plush pill button.
 *
 * Visual language copied verbatim from VoyoCloseX (src/components/ui/VoyoCloseX.tsx):
 *   - radial-gradient with highlight, core, edge stops
 *   - inset velvet shadows
 *   - outer glow matching beamColor
 * The only change: color is parameterised per-action instead of fixed purple.
 */
function ActionPill({
  action,
  visible,
  side,
  onFire,
}: {
  action: CardAction;
  visible: boolean;
  side: 'left' | 'right';
  onFire: () => void;
}) {
  const { highlight, core, edge } = action.pillGradient;
  const Icon = action.icon;

  return (
    <button
      aria-label={action.label}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onFire();
      }}
      style={{
        // Dimensions
        width: 52,
        height: 52,
        borderRadius: '50%',
        // Pill gradient — radial highlight top-left, core, edge. Mirrors VoyoCloseX exactly.
        background: `radial-gradient(circle at 32% 24%, ${highlight} 0%, ${core} 44%, ${edge} 100%)`,
        // Velvet press inset shadows + outer glow — copied from VoyoCloseX
        boxShadow: [
          'inset 0 1px 1px rgba(255,255,255,0.18)',
          'inset 0 -2px 5px rgba(0,0,0,0.48)',
          '0 4px 10px rgba(0,0,0,0.35)',
          `0 0 0 1px ${action.beamColor}28`,
          `0 0 14px ${action.beamColor}50`,
        ].join(', '),
        // Slide-up transition: pills start 18px below (translateY(18px), opacity 0)
        // and slide to their resting position. ease-out 180ms — NO bounce.
        transform: visible ? 'translateY(0)' : 'translateY(18px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 180ms ease-out, opacity 180ms ease-out',
        // Layout
        position: 'absolute',
        top: -60,
        ...(side === 'left' ? { left: '15%' } : { right: '15%' }),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        // Accessibility
        border: 'none',
        outline: 'none',
        // Tap feedback
        WebkitTapHighlightColor: 'transparent',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <Icon
        size={20}
        style={{
          color: 'rgba(255,255,255,0.92)',
          filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))',
        }}
      />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const HOLD_MS = 500;
const DISMISS_MS = 4000;
const MOVE_CANCEL_Y = 10;  // vertical pixels — cancels hold (scroll protection)
const MOVE_CANCEL_X = 5;   // horizontal pixels — cancels hold (shelf scroll protection)
const SWIPE_START_X = 20;  // pixels before swipe activates
const SWIPE_THRESHOLD = 0.6; // fraction of card width
const SPRING_DURATION = 240; // ms, spring-back transition

export function CardHoldActions({
  children,
  leftAction,
  rightAction,
  className = '',
}: CardHoldActionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── State ────────────────────────────────────────────────────────────────────
  const [holdOpen, setHoldOpen] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [springing, setSpringing] = useState(false);

  // ── Refs (no re-render needed) ────────────────────────────────────────────────
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeActiveRef = useRef(false); // true once pointer moved >20px X
  const didActionRef = useRef(false);   // prevent click propagation after action

  // ── Back gesture dismiss ─────────────────────────────────────────────────────
  useBackGuard(holdOpen, () => close(), 'card-hold-actions');

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setHoldOpen(false);
    setSwipeX(0);
    swipeActiveRef.current = false;
    didActionRef.current = false;
  }, [clearTimers]);

  const armDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => close(), DISMISS_MS);
  }, [close]);

  const fireAction = useCallback((action: CardAction) => {
    didActionRef.current = true;
    action.onFire();
    // Brief spring-back before close so the card settles visually
    setSpringing(true);
    setSwipeX(0);
    setTimeout(() => {
      setSpringing(false);
      close();
    }, SPRING_DURATION);
  }, [close]);

  // ── Pointer events ────────────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only primary pointer, ignore right-click
    if (e.button !== 0 && e.pointerType !== 'touch') return;

    // If hold menu already open, close on next outside tap (handled by backdrop)
    if (holdOpen) return;

    didActionRef.current = false;
    swipeActiveRef.current = false;
    pressStartRef.current = { x: e.clientX, y: e.clientY };

    // Start hold timer — 500ms, mirror of Library.tsx SongRow heart button pattern
    holdTimerRef.current = setTimeout(() => {
      setHoldOpen(true);
      try { navigator.vibrate?.(30); } catch {}
      armDismissTimer();
    }, HOLD_MS);
  }, [holdOpen, armDismissTimer]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!pressStartRef.current) return;

    const dx = e.clientX - pressStartRef.current.x;
    const dy = e.clientY - pressStartRef.current.y;

    // Mirror Library.tsx scroll-protection: cancel hold if vertical movement or
    // horizontal movement exceeds threshold BEFORE hold fires
    if (!holdOpen && !swipeActiveRef.current) {
      if (Math.abs(dy) > MOVE_CANCEL_Y || Math.abs(dx) > MOVE_CANCEL_X) {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      }
    }

    // Swipe — ONLY after hold is open. Never on a raw touch (would fight scroll).
    if (holdOpen && Math.abs(dx) >= SWIPE_START_X && Math.abs(dy) < 30) {
      swipeActiveRef.current = true;
      setSwipeX(dx);
    }
  }, [holdOpen]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }

    const cardWidth = containerRef.current?.offsetWidth ?? 200;
    const threshold = cardWidth * SWIPE_THRESHOLD;
    const dx = swipeX;

    if (holdOpen && swipeActiveRef.current && Math.abs(dx) >= threshold) {
      // Fire action based on direction
      const action = dx < 0 ? leftAction : rightAction;
      fireAction(action);
    } else if (holdOpen && swipeActiveRef.current) {
      // Below threshold — spring back
      setSpringing(true);
      setSwipeX(0);
      setTimeout(() => setSpringing(false), SPRING_DURATION);
      swipeActiveRef.current = false;
    }

    pressStartRef.current = null;
  }, [swipeX, leftAction, rightAction, fireAction]);

  const handlePointerCancel = useCallback(() => {
    clearTimers();
    if (swipeActiveRef.current) {
      setSpringing(true);
      setSwipeX(0);
      setTimeout(() => setSpringing(false), SPRING_DURATION);
      swipeActiveRef.current = false;
    }
    pressStartRef.current = null;
  }, [clearTimers]);

  // Dismiss on scroll — listen at window level only when popover is open
  useEffect(() => {
    if (!holdOpen) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [holdOpen, close]);

  // Cleanup timers on unmount
  useEffect(() => () => clearTimers(), [clearTimers]);

  // ── Derived visual values ─────────────────────────────────────────────────────

  // Which beam color to use: when hold is open use the centered beam color,
  // when swiping use the directional action's beam color
  const activeBeamColor = holdOpen
    ? leftAction.beamColor // top edge beam when popover open; both share this
    : swipeX < 0
    ? leftAction.beamColor
    : swipeX > 0
    ? rightAction.beamColor
    : null;

  // Card transform
  const cardTransform = holdOpen
    ? 'translateX(0) scale(1.02)'
    : `translateX(${swipeX}px)`;

  const cardTransition = springing
    ? `transform ${SPRING_DURATION}ms ease`
    : holdOpen
    ? 'transform 150ms ease-out'
    : swipeActiveRef.current
    ? 'none'
    : `transform ${SPRING_DURATION}ms ease`;

  // Card box-shadow: depth deepens on hold, directional trail on swipe
  const cardBoxShadow = (() => {
    if (holdOpen && activeBeamColor) {
      // Top-edge beam: single 2px line + 20px blur. One line, no multiples.
      return [
        '0 8px 32px rgba(0,0,0,0.55)',
        `0 -2px 0 ${activeBeamColor}`,
        `0 -12px 20px ${activeBeamColor}60`,
      ].join(', ');
    }
    if (swipeActiveRef.current && activeBeamColor && Math.abs(swipeX) > 10) {
      // Edge trail: horizontal offset in swipe direction
      const dir = swipeX < 0 ? -1 : 1;
      const intensity = Math.min(1, Math.abs(swipeX) / 80);
      return `${dir * 8 * intensity}px 0 20px ${activeBeamColor}${Math.round(intensity * 0x80).toString(16).padStart(2, '0')}`;
    }
    return undefined;
  })();

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop dim — fixed overlay, opacity 0.4, NO blur (expensive + showy) */}
      {holdOpen && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 40,
            // Dismiss on tap outside
            pointerEvents: 'auto',
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            close();
          }}
        />
      )}

      {/* Card wrapper */}
      <div
        ref={containerRef}
        className={className}
        style={{ position: 'relative', zIndex: holdOpen ? 50 : undefined, touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        // Normal click passes through UNLESS an action just fired
        onClick={(e) => {
          if (didActionRef.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {/* Pills — rendered inside the card wrapper so they inherit z-index stacking.
            Positioned absolutely above the card's top edge. */}
        <ActionPill
          action={leftAction}
          visible={holdOpen}
          side="left"
          onFire={() => fireAction(leftAction)}
        />
        <ActionPill
          action={rightAction}
          visible={holdOpen}
          side="right"
          onFire={() => fireAction(rightAction)}
        />

        {/* Card surface — applies scale, swipe translate, beam shadow */}
        <div
          style={{
            transform: cardTransform,
            transition: cardTransition,
            ...(cardBoxShadow ? { boxShadow: cardBoxShadow } : {}),
            willChange: 'transform',
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}

export default CardHoldActions;
