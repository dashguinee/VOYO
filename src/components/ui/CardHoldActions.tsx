import { ReactNode, useRef, useState, useCallback, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Heart, Plus, Download, Zap } from 'lucide-react';
import { useBackGuard } from '../../hooks/useBackGuard';

export interface CardAction {
  id: 'like' | 'playlist' | 'oye' | 'download';
  label: string;
  icon: LucideIcon;
  onFire: () => void;
  beamColor: string;
  pillGradient: { highlight: string; core: string; edge: string };
}

export const CARD_ACTIONS: Record<
  'oye' | 'like' | 'playlist' | 'download',
  Omit<CardAction, 'onFire'>
> = {
  oye: {
    id: 'oye',
    label: 'OYÉ',
    icon: Zap,
    beamColor: '#D4A053',
    pillGradient: { highlight: 'rgba(244,217,153,0.55)', core: 'rgba(139,98,40,0.95)', edge: 'rgba(60,40,10,0.95)' },
  },
  like: {
    id: 'like',
    label: 'Like',
    icon: Heart,
    beamColor: '#f472b6',
    pillGradient: { highlight: 'rgba(244,114,182,0.45)', core: 'rgba(131,24,67,0.95)', edge: 'rgba(45,8,26,0.95)' },
  },
  playlist: {
    id: 'playlist',
    label: 'Add to Playlist',
    icon: Plus,
    beamColor: '#a78bfa',
    pillGradient: { highlight: 'rgba(167,139,250,0.45)', core: 'rgba(73,24,114,0.95)', edge: 'rgba(32,13,58,0.95)' },
  },
  download: {
    id: 'download',
    label: 'Download',
    icon: Download,
    beamColor: '#c4e0ff',
    pillGradient: { highlight: 'rgba(196,224,255,0.4)', core: 'rgba(58,84,130,0.95)', edge: 'rgba(18,28,50,0.95)' },
  },
};

export interface CardHoldActionsProps {
  children: ReactNode;
  leftAction: CardAction;
  rightAction: CardAction;
  className?: string;
}

const HOLD_MS    = 500;
const DISMISS_MS = 4000;
const SWIPE_MAX  = 72;   // px — hard cap on visual travel
const SWIPE_FIRE = 50;   // px — threshold to fire
const SPRING_MS  = 220;

function clamp(raw: number): number {
  const sign = raw < 0 ? -1 : 1;
  const abs = Math.abs(raw);
  return abs <= SWIPE_MAX ? raw : sign * (SWIPE_MAX + Math.sqrt(abs - SWIPE_MAX) * 3);
}

function ActionPill({ action, visible, side, onFire }: {
  action: CardAction; visible: boolean; side: 'left' | 'right'; onFire: () => void;
}) {
  const { highlight, core, edge } = action.pillGradient;
  const Icon = action.icon;
  return (
    <button
      aria-label={action.label}
      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onFire(); }}
      style={{
        position: 'absolute',
        top: '50%',
        ...(side === 'left' ? { left: '12%' } : { right: '12%' }),
        transform: visible ? 'translateY(-50%) scale(1)' : 'translateY(-50%) scale(0.7)',
        opacity: visible ? 1 : 0,
        transition: 'transform 180ms cubic-bezier(0.34,1.56,0.64,1), opacity 140ms ease-out',
        width: 52, height: 52, borderRadius: '50%',
        background: `radial-gradient(circle at 32% 24%, ${highlight} 0%, ${core} 44%, ${edge} 100%)`,
        boxShadow: [
          'inset 0 1px 1px rgba(255,255,255,0.18)',
          'inset 0 -2px 5px rgba(0,0,0,0.48)',
          '0 4px 14px rgba(0,0,0,0.5)',
          `0 0 0 1px ${action.beamColor}28`,
          `0 0 18px ${action.beamColor}55`,
        ].join(', '),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', outline: 'none', cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: 2,
      }}
    >
      <Icon size={20} style={{ color: 'rgba(255,255,255,0.92)', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))' }} />
    </button>
  );
}

export function CardHoldActions({ children, leftAction, rightAction, className = '' }: CardHoldActionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [holdOpen, setHoldOpen]   = useState(false);
  const [swipeX, setSwipeX]       = useState(0);
  const [springing, setSpringing] = useState(false);

  const holdTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef   = useRef<{ x: number; y: number } | null>(null);
  const swipeActiveRef  = useRef(false);
  const didActionRef    = useRef(false);
  const holdOpenRef     = useRef(false); // mirror for use inside passive listeners

  useEffect(() => { holdOpenRef.current = holdOpen; }, [holdOpen]);

  useBackGuard(holdOpen, () => close(), 'card-hold-actions');

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current)    { clearTimeout(holdTimerRef.current);    holdTimerRef.current    = null; }
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setHoldOpen(false);
    holdOpenRef.current = false;
    setSwipeX(0);
    swipeActiveRef.current = false;
    didActionRef.current   = false;
  }, [clearTimers]);

  const armDismiss = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(close, DISMISS_MS);
  }, [close]);

  const fireAction = useCallback((action: CardAction) => {
    didActionRef.current = true;
    action.onFire();
    setSpringing(true);
    setSwipeX(0);
    setTimeout(() => { setSpringing(false); close(); }, SPRING_MS);
  }, [close]);

  // ── Pointer down — start hold timer + attach passive doc listener for cancel ──
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (holdOpen) return;

    didActionRef.current  = false;
    swipeActiveRef.current = false;
    pressStartRef.current  = { x: e.clientX, y: e.clientY };

    holdTimerRef.current = setTimeout(() => {
      setHoldOpen(true);
      holdOpenRef.current = true;
      try { navigator.vibrate?.(30); } catch {}
      armDismiss();
    }, HOLD_MS);

    // Passive doc-level listener cancels hold if user scrolls before 500ms.
    // Passive = zero scroll jank. Detaches itself after first meaningful move.
    const start = { x: e.clientX, y: e.clientY };
    const onDocMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dy) > 8 || Math.abs(dx) > 8) {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
        document.removeEventListener('pointermove', onDocMove);
      }
    };
    document.addEventListener('pointermove', onDocMove, { passive: true });

    // Cleanup the doc listener once the pointer is released/cancelled
    const cleanup = () => {
      document.removeEventListener('pointermove', onDocMove);
      document.removeEventListener('pointerup',     cleanup);
      document.removeEventListener('pointercancel', cleanup);
    };
    document.addEventListener('pointerup',     cleanup, { once: true });
    document.addEventListener('pointercancel', cleanup, { once: true });
  }, [holdOpen, armDismiss]);

  // ── Post-hold swipe — passive native listener attached only when hold is open ──
  useEffect(() => {
    if (!holdOpen) return;
    const el = containerRef.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      if (!pressStartRef.current) return;
      const dx = e.clientX - pressStartRef.current.x;
      const dy = e.clientY - pressStartRef.current.y;
      if (Math.abs(dx) >= 16 && Math.abs(dy) < 30) {
        swipeActiveRef.current = true;
        setSwipeX(clamp(dx));
      }
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    return () => el.removeEventListener('pointermove', onMove);
  }, [holdOpen]);

  const handlePointerUp = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (holdOpen && swipeActiveRef.current && Math.abs(swipeX) >= SWIPE_FIRE) {
      fireAction(swipeX < 0 ? leftAction : rightAction);
    } else if (holdOpen && swipeActiveRef.current) {
      setSpringing(true); setSwipeX(0);
      setTimeout(() => setSpringing(false), SPRING_MS);
      swipeActiveRef.current = false;
    }
    pressStartRef.current = null;
  }, [holdOpen, swipeX, leftAction, rightAction, fireAction]);

  const handlePointerCancel = useCallback(() => {
    clearTimers();
    setSpringing(true); setSwipeX(0);
    setTimeout(() => setSpringing(false), SPRING_MS);
    swipeActiveRef.current = false;
    pressStartRef.current  = null;
  }, [clearTimers]);

  // Dismiss on scroll (only when hold is open)
  useEffect(() => {
    if (!holdOpen) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [holdOpen, close]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // ── Visual derived values ──
  const beamColor = holdOpen
    ? leftAction.beamColor
    : swipeX < 0 ? leftAction.beamColor
    : swipeX > 0 ? rightAction.beamColor
    : null;

  const cardTransform = holdOpen
    ? 'translateX(0) scale(1.02)'
    : `translateX(${swipeX}px)`;

  const cardTransition = springing
    ? `transform ${SPRING_MS}ms ease`
    : holdOpen ? 'transform 150ms ease-out'
    : swipeActiveRef.current ? 'none'
    : `transform ${SPRING_MS}ms ease`;

  const cardShadow = (() => {
    if (holdOpen && beamColor) return [
      '0 8px 32px rgba(0,0,0,0.55)',
      `0 -2px 0 ${beamColor}`,
      `0 -12px 20px ${beamColor}60`,
    ].join(', ');
    if (swipeActiveRef.current && beamColor && Math.abs(swipeX) > 10) {
      const dir = swipeX < 0 ? -1 : 1;
      const i = Math.min(1, Math.abs(swipeX) / 60);
      return `${dir * 6 * i}px 0 18px ${beamColor}${Math.round(i * 0x80).toString(16).padStart(2, '0')}`;
    }
    return undefined;
  })();

  return (
    <>
      {holdOpen && (
        <div
          aria-hidden
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40, pointerEvents: 'auto' }}
          onPointerDown={(e) => { e.stopPropagation(); close(); }}
        />
      )}

      <div
        ref={containerRef}
        className={className}
        style={{ position: 'relative', zIndex: holdOpen ? 50 : undefined, touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={(e) => { if (didActionRef.current) { e.stopPropagation(); e.preventDefault(); } }}
      >
        {/* Pills rendered over the card — inside bounds so no overflow clipping */}
        <ActionPill action={leftAction}  visible={holdOpen} side="left"  onFire={() => fireAction(leftAction)}  />
        <ActionPill action={rightAction} visible={holdOpen} side="right" onFire={() => fireAction(rightAction)} />

        <div style={{
          transform: cardTransform,
          transition: cardTransition,
          ...(cardShadow ? { boxShadow: cardShadow } : {}),
          willChange: 'transform',
        }}>
          {children}
        </div>
      </div>
    </>
  );
}

export default CardHoldActions;
