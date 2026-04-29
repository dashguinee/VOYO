import { memo, useEffect, useRef, useState } from 'react';

/**
 * Shared cube gesture hint with session-scoped lifecycle.
 *
 * v897 (Dash 2026-04-29): "blink in silver metallic, fade out
 * gently after 15s in session over 7s, then bye bye disappears.
 * Only appears on tap with the overlays and 50% of that time."
 *
 * Phases:
 *   visible (0-15s)   — silver-metallic sheen, opacity 1
 *   fading  (15-22s)  — opacity 1 → 0 over 7s, ease-out
 *   hidden  (22s+)    — invisible by default
 *   flash   (on tap)  — when hidden, taps re-surface the hint for
 *                       1.5s. 50% rate (every other tap) so it
 *                       doesn't get noisy.
 *
 * Session start is module-level so the timer survives mount/unmount
 * cycles (track changes, mode flips). 22s starts ticking the moment
 * the first instance of this component mounts in the page life.
 */

const SHOW_DURATION_MS = 15_000;
const FADE_DURATION_MS = 7_000;
const FLASH_DURATION_MS = 1500;

let sessionStart: number | null = null;
const getSessionStart = () => {
  if (sessionStart === null) sessionStart = Date.now();
  return sessionStart;
};

type Phase = 'visible' | 'fading' | 'hidden' | 'flash';

const computeInitialPhase = (): Phase => {
  const elapsed = Date.now() - getSessionStart();
  if (elapsed < SHOW_DURATION_MS) return 'visible';
  if (elapsed < SHOW_DURATION_MS + FADE_DURATION_MS) return 'fading';
  return 'hidden';
};

export const CubeGestureHint = memo(({
  position = 'bottom',
  highlighted = false,
  label = 'tap to change mode · drag to move',
  onTap,
  flashTrigger,
}: {
  position?: 'top' | 'bottom';
  highlighted?: boolean;
  label?: string;
  onTap?: () => void;
  /** Counter — increment from the parent on user interactions
   *  (e.g., iframe pointerdown) to give a 50% chance of re-flashing
   *  the hint after it's faded out. Ignored while still in
   *  visible/fading phase. */
  flashTrigger?: number;
}) => {
  const [phase, setPhase] = useState<Phase>(computeInitialPhase);
  const flashCountRef = useRef(0);

  // Initial timeline — visible → fading → hidden, anchored to session start.
  useEffect(() => {
    const start = getSessionStart();
    const elapsed = Date.now() - start;
    if (phase === 'visible') {
      const remaining = Math.max(0, SHOW_DURATION_MS - elapsed);
      const t = setTimeout(() => setPhase('fading'), remaining);
      return () => clearTimeout(t);
    }
    if (phase === 'fading') {
      const remaining = Math.max(0, SHOW_DURATION_MS + FADE_DURATION_MS - elapsed);
      const t = setTimeout(() => setPhase('hidden'), remaining);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // Flash on tap, 50% rate, only after the initial fade-out is done.
  useEffect(() => {
    if (flashTrigger === undefined) return;
    if (phase !== 'hidden') return;
    flashCountRef.current += 1;
    // Every other tap fires (50%). 1, 3, 5… are skipped; 2, 4, 6 flash.
    if (flashCountRef.current % 2 !== 0) return;
    setPhase('flash');
    const t = setTimeout(() => setPhase('hidden'), FLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, [flashTrigger]);

  const opacity =
    phase === 'visible' ? 1 :
    phase === 'flash'   ? 0.85 :
    phase === 'fading'  ? 0 :
    0;

  const transition =
    phase === 'fading' ? `opacity ${FADE_DURATION_MS}ms ease-out` :
    phase === 'flash'  ? 'opacity 280ms ease-out' :
    'opacity 600ms ease-out';

  // Silver metallic — animated sheen sweeps across the text. Highlighted
  // (drag-active) gets a subtle violet tint inside the gradient.
  const sheenGradient = highlighted
    ? 'linear-gradient(120deg, #b8a4ff 0%, #ffffff 50%, #b8a4ff 100%)'
    : 'linear-gradient(120deg, #b8b8b8 0%, #ffffff 50%, #b8b8b8 100%)';

  return (
    <div
      onPointerDown={(e) => { if (onTap) e.stopPropagation(); }}
      onClick={(e) => {
        if (!onTap) return;
        e.stopPropagation();
        onTap();
      }}
      style={{
        position: 'absolute',
        [position]: 8,
        left: 0,
        right: 0,
        textAlign: 'center',
        zIndex: 20,
        pointerEvents: onTap && opacity > 0 ? 'auto' : 'none',
        cursor: onTap ? 'pointer' : 'default',
        opacity,
        transition,
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.04em',
          margin: 0,
          background: sheenGradient,
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'transparent',
          animation: 'voyo-cube-hint-sheen 2.6s ease-in-out infinite',
          // Soft drop-shadow on the BACKGROUND layer (not text) since
          // text fill is transparent. Filter applies to the gradient.
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
        }}
      >
        {label}
      </p>
      <style>{`
        @keyframes voyo-cube-hint-sheen {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
      `}</style>
    </div>
  );
});

CubeGestureHint.displayName = 'CubeGestureHint';
