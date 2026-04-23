/**
 * CardHoldActions — single-action hold overlay.
 *
 * Hold 500ms → card flashes + haptic → one pill rises.
 * Which pill depends on track state (reads preferenceStore):
 *   - Not liked yet  → Like (heart)
 *   - Liked, not OYÉ → OYÉ (zap)
 *   - OYÉd           → + (add to playlist)
 *
 * Tap pill → fires action → closes.
 * Tap outside / 4s timeout → closes.
 * No swipe. No horizontal gesture capture. Scroll is untouched.
 */

import { ReactNode, useRef, useState, useCallback, useEffect } from 'react';
import { Heart, Zap, Plus } from 'lucide-react';
import { useBackGuard } from '../../hooks/useBackGuard';
import { usePreferenceStore } from '../../store/preferenceStore';
import { app } from '../../services/oyo';
import { Track } from '../../types';

export interface CardHoldActionsProps {
  track: Track;
  children: ReactNode;
  onPlaylist?: () => void;
  className?: string;
}

const HOLD_MS    = 500;
const DISMISS_MS = 4000;
const FLASH_MS   = 120; // brief scale pulse when hold fires

// Keep CARD_ACTIONS + CardAction exported so existing callers don't break
export type CardAction = { id: string; label: string; onFire: () => void };
export const CARD_ACTIONS = {} as Record<string, Omit<CardAction, 'onFire'>>;

export function CardHoldActions({ track, children, onPlaylist, className = '' }: CardHoldActionsProps) {
  const pref           = usePreferenceStore(s => s.trackPreferences[track.id]);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);

  const isOyed  = (pref?.reactions ?? 0) > 0;
  const isLiked = pref?.explicitLike === true;

  // Determine the single action to offer
  const pill = isOyed
    ? { label: 'Playlist', Icon: Plus,  color: '#a78bfa', gradient: 'radial-gradient(circle at 32% 24%, rgba(167,139,250,0.45) 0%, rgba(73,24,114,0.95) 44%, rgba(32,13,58,0.95) 100%)', glow: '#a78bfa',  onFire: () => onPlaylist?.() }
    : isLiked
    ? { label: 'OYÉ',      Icon: Zap,   color: '#D4A053', gradient: 'radial-gradient(circle at 32% 24%, rgba(244,217,153,0.55) 0%, rgba(139,98,40,0.95) 44%, rgba(60,40,10,0.95) 100%)',   glow: '#D4A053',  onFire: () => app.oyeCommit(track, {}) }
    : { label: 'Like',     Icon: Heart, color: '#8b5cf6', gradient: 'radial-gradient(circle at 32% 24%, rgba(139,92,246,0.45) 0%, rgba(76,29,149,0.95) 44%, rgba(20,10,48,0.95) 100%)',  glow: '#8b5cf6',  onFire: () => setExplicitLike(track.id, true) };

  const [holdOpen, setHoldOpen] = useState(false);
  const [flashing, setFlashing] = useState(false);

  const holdTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef   = useRef<{ x: number; y: number } | null>(null);
  const didFireRef      = useRef(false);

  useBackGuard(holdOpen, () => close(), 'card-hold-actions');

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current)    { clearTimeout(holdTimerRef.current);    holdTimerRef.current    = null; }
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setHoldOpen(false);
    setFlashing(false);
    didFireRef.current = false;
  }, [clearTimers]);

  const firePill = useCallback(() => {
    didFireRef.current = true;
    pill.onFire();
    close();
  }, [pill, close]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    if (holdOpen) return;
    didFireRef.current = false;
    pressStartRef.current = { x: e.clientX, y: e.clientY };

    holdTimerRef.current = setTimeout(() => {
      setFlashing(true);
      setTimeout(() => setFlashing(false), FLASH_MS);
      setHoldOpen(true);
      try { navigator.vibrate?.(30); } catch {}
      dismissTimerRef.current = setTimeout(close, DISMISS_MS);
    }, HOLD_MS);

    // Cancel hold if user moves (passive — no scroll blocking)
    const start = { x: e.clientX, y: e.clientY };
    const onDocMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
        document.removeEventListener('pointermove', onDocMove);
      }
    };
    document.addEventListener('pointermove', onDocMove, { passive: true });
    const cleanup = () => {
      document.removeEventListener('pointermove', onDocMove);
      document.removeEventListener('pointerup',     cleanup);
      document.removeEventListener('pointercancel', cleanup);
    };
    document.addEventListener('pointerup',     cleanup, { once: true });
    document.addEventListener('pointercancel', cleanup, { once: true });
  }, [holdOpen, close]);

  const handlePointerUp = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    pressStartRef.current = null;
  }, []);

  // Dismiss on scroll
  useEffect(() => {
    if (!holdOpen) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [holdOpen, close]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const cardStyle: React.CSSProperties = {
    transform: holdOpen ? 'scale(1.02)' : flashing ? 'scale(1.04)' : 'scale(1)',
    transition: flashing ? `transform ${FLASH_MS}ms ease-out` : holdOpen ? 'transform 150ms ease-out' : 'transform 200ms ease',
    ...(holdOpen ? {
      boxShadow: [
        '0 8px 32px rgba(0,0,0,0.55)',
        `0 -2px 0 ${pill.color}`,
        `0 -10px 18px ${pill.color}55`,
      ].join(', '),
    } : {}),
    willChange: 'transform',
  };

  return (
    <>
      {holdOpen && (
        <div
          aria-hidden
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.38)', zIndex: 40, pointerEvents: 'auto' }}
          onPointerDown={(e) => { e.stopPropagation(); close(); }}
        />
      )}

      <div
        className={className}
        style={{ position: 'relative', zIndex: holdOpen ? 50 : undefined, touchAction: 'pan-x pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => { if (didFireRef.current) { e.stopPropagation(); e.preventDefault(); } }}
      >
        {/* Single pill — centered, slides up from card center */}
        {holdOpen && (
          <button
            aria-label={pill.label}
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); firePill(); }}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 56, height: 56, borderRadius: '50%',
              background: pill.gradient,
              boxShadow: [
                'inset 0 1px 1px rgba(255,255,255,0.18)',
                'inset 0 -2px 5px rgba(0,0,0,0.45)',
                '0 6px 18px rgba(0,0,0,0.5)',
                `0 0 0 1px ${pill.glow}28`,
                `0 0 20px ${pill.glow}55`,
              ].join(', '),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', outline: 'none', cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              zIndex: 2,
              animation: 'cha-pill-in 180ms cubic-bezier(0.34,1.56,0.64,1) forwards',
            }}
          >
            <pill.Icon size={22} style={{ color: 'rgba(255,255,255,0.93)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }} />
            <style>{`
              @keyframes cha-pill-in {
                from { opacity: 0; transform: translate(-50%,-50%) scale(0.6); }
                to   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
              }
            `}</style>
          </button>
        )}

        <div style={cardStyle}>{children}</div>
      </div>
    </>
  );
}

export default CardHoldActions;
