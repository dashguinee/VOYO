/**
 * TrackCardGestures — global gesture layer for any track card surface.
 *
 * Wrap any card (or row) in this component and get three gestures for
 * free, consistent across Home, Library, Portrait, Search, Artist:
 *
 *   - Single tap    → runs `onTap` (the surface's normal play action)
 *   - Double tap    → OYÉ + like + boost (via `app.oyeAndBoost`)
 *   - Long press    → reveals a 30% purple shimmer overlay with
 *                     "Add to Deck" action (adds to queue)
 *
 * Intentionally NOT a button element so the surface can render its own
 * semantic structure inside. Exposes pointer events only.
 *
 * All heavy lifts (signals, preferences, boost) go through `app.*`
 * methods so the global taste graph + offline cache see a single
 * consistent intent regardless of which surface dispatched the gesture.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Zap, Heart, Sparkles } from 'lucide-react';
import type { Track } from '../../types';
import { app } from '../../services/oyo';

interface TrackCardGesturesProps {
  track: Track;
  onTap?: () => void;
  children: React.ReactNode;
  className?: string;
  /** Disable gestures (e.g. while in drag state). Default false. */
  disabled?: boolean;
}

// Tuning constants
const LONG_PRESS_MS = 520;    // hold threshold
const DOUBLE_TAP_MS = 280;    // second-tap window
const MOVE_CANCEL_PX = 10;    // finger drift = user is scrolling
const OVERLAY_AUTO_DISMISS_MS = 3600;

export const TrackCardGestures = ({
  track,
  onTap,
  children,
  className,
  disabled = false,
}: TrackCardGesturesProps) => {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [doubleTapBurst, setDoubleTapBurst] = useState(false);

  const pressTimerRef = useRef<number | null>(null);
  const tapHoldTimerRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef(0);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const overlayDismissTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const clearPressTimer = () => {
    if (pressTimerRef.current != null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };
  const clearTapHold = () => {
    if (tapHoldTimerRef.current != null) {
      window.clearTimeout(tapHoldTimerRef.current);
      tapHoldTimerRef.current = null;
    }
  };

  const haptic = useCallback((ms: number) => {
    try { (navigator as Navigator & { vibrate?: (ms: number) => void }).vibrate?.(ms); } catch { /* noop */ }
  }, []);

  const openOverlay = useCallback(() => {
    haptic(25);
    setOverlayOpen(true);
    if (overlayDismissTimerRef.current != null) window.clearTimeout(overlayDismissTimerRef.current);
    overlayDismissTimerRef.current = window.setTimeout(
      () => setOverlayOpen(false),
      OVERLAY_AUTO_DISMISS_MS,
    );
  }, [haptic]);

  const closeOverlay = useCallback(() => {
    if (overlayDismissTimerRef.current != null) {
      window.clearTimeout(overlayDismissTimerRef.current);
      overlayDismissTimerRef.current = null;
    }
    setOverlayOpen(false);
  }, []);

  const fireOyeBoost = useCallback(() => {
    haptic(12);
    app.oyeAndBoost(track);
    setDoubleTapBurst(true);
    window.setTimeout(() => setDoubleTapBurst(false), 720);
  }, [track, haptic]);

  const addToDeck = useCallback(() => {
    haptic(8);
    app.addToQueue(track);
    closeOverlay();
  }, [track, closeOverlay, haptic]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressFiredRef.current = false;
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      openOverlay();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pressStartRef.current) return;
    const dx = e.clientX - pressStartRef.current.x;
    const dy = e.clientY - pressStartRef.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
      clearPressTimer();
      pressStartRef.current = null;
    }
  };

  const onPointerUp = () => {
    clearPressTimer();
    const start = pressStartRef.current;
    pressStartRef.current = null;
    if (disabled) return;

    // Long-press already fired the overlay — eat this up event.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    // User scrolled (pointerMove cleared start) — no tap action.
    if (!start) return;

    const now = Date.now();
    const sinceLast = now - lastTapTimeRef.current;

    if (sinceLast < DOUBLE_TAP_MS) {
      // Double tap — OYÉ + boost + like.
      clearTapHold();
      lastTapTimeRef.current = 0;
      fireOyeBoost();
      return;
    }

    // Tentative single tap — defer while we watch for a second tap.
    lastTapTimeRef.current = now;
    clearTapHold();
    tapHoldTimerRef.current = window.setTimeout(() => {
      tapHoldTimerRef.current = null;
      onTap?.();
    }, DOUBLE_TAP_MS + 10);
  };

  // Cleanup on unmount — any lingering timer would fire into a dead tree.
  useEffect(() => () => {
    clearPressTimer();
    clearTapHold();
    if (overlayDismissTimerRef.current != null) window.clearTimeout(overlayDismissTimerRef.current);
  }, []);

  return (
    <div
      className={className}
      // 'manipulation' lets the parent carousel receive horizontal pans for
      // scrolling while we still own tap/double-tap/long-press gestures here.
      // 'pan-y' (old value) blocked horizontal swipes on cards — users
      // couldn't scroll OYO's Picks / any other horizontal shelf.
      style={{ position: 'relative', touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { clearPressTimer(); pressStartRef.current = null; }}
      onContextMenu={(e) => { e.preventDefault(); /* stop the native long-press menu on mobile */ }}
    >
      {children}

      {/* Long-press overlay — calm space-grey shimmer (Apple-grey palette,
          not purple anymore). 30% tint over the card, glass pill action.
          Shimmer sweep still animates on top for the "activated" feel,
          but nothing screams. */}
      {overlayOpen && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 rounded-[inherit] flex items-center justify-center"
          style={{
            background: 'rgba(28, 28, 32, 0.52)',
            backdropFilter: 'blur(10px) saturate(120%)',
            WebkitBackdropFilter: 'blur(10px) saturate(120%)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 10px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
            animation: 'voyo-gesture-fade-in 180ms ease-out both',
            zIndex: 20,
          }}
        >
          {/* Shimmer sweep — white-on-grey, subtler than the purple variant. */}
          <div
            className="absolute inset-0 rounded-[inherit] pointer-events-none"
            style={{
              background:
                'linear-gradient(115deg, transparent 0%, rgba(255,255,255,0.14) 40%, rgba(255,255,255,0.05) 55%, transparent 75%)',
              animation: 'voyo-gesture-shimmer 1800ms linear infinite',
              mixBlendMode: 'screen',
            }}
          />
          <div className="flex flex-col items-center gap-2 pointer-events-auto">
            {/* Apple-grey translucent pill — Vision-OS style glass button.
                Subtle white gradient, backdrop-blur, no dominant hue. */}
            <button
              onClick={addToDeck}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold text-white/95 active:scale-95 transition-transform"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 100%)',
                backdropFilter: 'blur(14px) saturate(160%)',
                WebkitBackdropFilter: 'blur(14px) saturate(160%)',
                border: '1px solid rgba(255,255,255,0.22)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.28)',
                letterSpacing: '0.01em',
              }}
            >
              <Plus className="w-4 h-4 text-white/90" strokeWidth={2.2} />
              Add to Deck
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); closeOverlay(); }}
              className="text-[11px] font-medium text-white/55 px-3 py-1 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Double-tap OYÉ burst — brief center-scaled heart + sparkles. */}
      {doubleTapBurst && (
        <div
          className="absolute inset-0 rounded-[inherit] flex items-center justify-center pointer-events-none"
          style={{ zIndex: 21 }}
        >
          <div
            className="relative flex items-center justify-center"
            style={{
              width: 72, height: 72,
              animation: 'voyo-gesture-burst 720ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
            }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(212,160,83,0.55) 0%, rgba(212,160,83,0.18) 45%, transparent 70%)',
                filter: 'blur(6px)',
              }}
            />
            <Heart className="w-9 h-9 relative" fill="#D4A053" color="#D4A053" strokeWidth={2} />
            <Sparkles className="w-3 h-3 absolute -top-1 -right-1 text-white" />
            <Zap className="w-3 h-3 absolute bottom-0 -left-1 text-[#D4A053]" fill="#D4A053" />
          </div>
        </div>
      )}

      <style>{`
        @keyframes voyo-gesture-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes voyo-gesture-shimmer {
          from { transform: translateX(-120%); }
          to   { transform: translateX(120%); }
        }
        @keyframes voyo-gesture-burst {
          0%   { transform: scale(0.55); opacity: 0; }
          30%  { transform: scale(1.15); opacity: 1; }
          70%  { transform: scale(1);    opacity: 1; }
          100% { transform: scale(1.3);  opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default TrackCardGestures;
