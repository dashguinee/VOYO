import { memo, useEffect, useState } from 'react';

/**
 * Shared cube gesture hint with a single-shot session lifecycle.
 *
 * v901 (Dash 2026-04-29): "keep the original tap-to-close · drag-to-
 * move, just make it disappear 1 min after first session". Drops the
 * v898/v899 multi-flash schedule. Now a flat lifecycle:
 *
 *   visible (0–60s)   plain white text, steady
 *   fading  (60–61s)  1s ease-out fade
 *   dead    (61s+)    component returns null forever
 *
 * Session start is module-level so the timer survives mount/unmount
 * cycles (track changes, pause-resume).
 */

const VISIBLE_DURATION_MS = 60_000;
const FADE_DURATION_MS = 1_000;

let sessionStart: number | null = null;
const getSessionStart = () => {
  if (sessionStart === null) sessionStart = Date.now();
  return sessionStart;
};

type Phase = 'visible' | 'fading' | 'dead';

const computeInitialPhase = (): Phase => {
  const elapsed = Date.now() - getSessionStart();
  if (elapsed < VISIBLE_DURATION_MS) return 'visible';
  if (elapsed < VISIBLE_DURATION_MS + FADE_DURATION_MS) return 'fading';
  return 'dead';
};

export const CubeGestureHint = memo(({
  position = 'bottom',
  highlighted = false,
  label = 'tap to change mode · drag to move',
  onTap,
}: {
  position?: 'top' | 'bottom';
  highlighted?: boolean;
  label?: string;
  onTap?: () => void;
}) => {
  const [phase, setPhase] = useState<Phase>(computeInitialPhase);
  // True after the entrance delay so the hint fades in after cube motion settles
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 350);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase === 'dead') return;
    const start = getSessionStart();
    const elapsed = Date.now() - start;
    if (phase === 'visible') {
      const remaining = Math.max(0, VISIBLE_DURATION_MS - elapsed);
      const t = setTimeout(() => setPhase('fading'), remaining);
      return () => clearTimeout(t);
    }
    if (phase === 'fading') {
      const remaining = Math.max(0, VISIBLE_DURATION_MS + FADE_DURATION_MS - elapsed);
      const t = setTimeout(() => setPhase('dead'), remaining);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (phase === 'dead') return null;

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
        [position]: 1,
        left: 0,
        right: 0,
        textAlign: 'center',
        zIndex: 20,
        pointerEvents: onTap ? 'auto' : 'none',
        cursor: onTap ? 'pointer' : 'default',
        opacity: entered && phase === 'visible' ? 1 : 0,
        transition: entered
          ? `opacity ${FADE_DURATION_MS}ms ease-out`
          : 'opacity 400ms ease-in',
      }}
    >
      <p
        style={{
          color: highlighted ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.18)',
          fontSize: 9,
          fontWeight: 400,
          letterSpacing: '0.05em',
          textShadow: '0 1px 2px rgba(0,0,0,0.4)',
          margin: 0,
          transition: 'color 0.2s',
        }}
      >
        {label}
      </p>
    </div>
  );
});

CubeGestureHint.displayName = 'CubeGestureHint';
