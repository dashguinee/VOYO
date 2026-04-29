import { memo, useEffect, useRef, useState } from 'react';

/**
 * Shared cube gesture hint with session-scoped lifecycle.
 *
 * v899 (Dash 2026-04-29): "keep og normal text just flash it then
 * fade flash gently 3 times". Reverted to plain white text from
 * v897/v898 silver-metallic. Three scheduled gentle fade-flashes.
 *
 * Phases:
 *   visible    (0–15s)         steady white, opacity 1
 *   flashing-* (1.2s each)     gentle CSS keyframe pulse
 *   hidden     (between)       invisible
 *   dead       (after 3rd)     gone forever (returns null)
 *
 * Two keyframes:
 *   - voyo-flash-out   first flash transitions FROM visible (opacity 1)
 *                       so it eases down with a soft dip-and-fade.
 *   - voyo-flash-pulse subsequent flashes transition FROM hidden
 *                       (opacity 0) — fade up, hold, fade out.
 */

const SCHEDULE_MS = [15_000, 45_000, 300_000] as const; // 15s, 45s, 5min
const FLASH_DURATION_MS = 1200;

let sessionStart: number | null = null;
const getSessionStart = () => {
  if (sessionStart === null) sessionStart = Date.now();
  return sessionStart;
};

type Phase = 'visible' | 'flashing' | 'hidden' | 'dead';

const computeInitialPhase = (): Phase => {
  const elapsed = Date.now() - getSessionStart();
  if (elapsed < SCHEDULE_MS[0]) return 'visible';
  const lastFlashEnd = SCHEDULE_MS[SCHEDULE_MS.length - 1] + FLASH_DURATION_MS;
  if (elapsed > lastFlashEnd) return 'dead';
  for (const t of SCHEDULE_MS) {
    if (elapsed >= t && elapsed < t + FLASH_DURATION_MS) return 'flashing';
  }
  return 'hidden';
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
  const [flashKey, setFlashKey] = useState(0);
  const flashIndexRef = useRef(0); // 0 = first flash (from visible), 1+ = re-flash

  useEffect(() => {
    const elapsed = Date.now() - getSessionStart();
    const timers: ReturnType<typeof setTimeout>[] = [];

    SCHEDULE_MS.forEach((flashAt, i) => {
      const isLast = i === SCHEDULE_MS.length - 1;
      if (flashAt + FLASH_DURATION_MS <= elapsed) return;

      const startDelay = Math.max(0, flashAt - elapsed);
      timers.push(setTimeout(() => {
        flashIndexRef.current = i;
        setPhase('flashing');
        setFlashKey(k => k + 1);
        timers.push(setTimeout(() => {
          setPhase(isLast ? 'dead' : 'hidden');
        }, FLASH_DURATION_MS));
      }, startDelay));
    });

    return () => { timers.forEach(t => clearTimeout(t)); };
  }, []);

  if (phase === 'dead') return null;

  const inlineOpacity =
    phase === 'visible' ? 1 :
    phase === 'hidden'  ? 0 :
    undefined; // flashing — animation owns it

  // First flash (i=0) eases out from visible; later ones pulse from hidden.
  const flashAnim =
    phase === 'flashing'
      ? (flashIndexRef.current === 0
          ? `voyo-flash-out ${FLASH_DURATION_MS}ms ease-in-out forwards`
          : `voyo-flash-pulse ${FLASH_DURATION_MS}ms ease-in-out forwards`)
      : null;

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
        // v898: bottom-4 (was 8). Sits a touch closer to the cube edge.
        [position]: 4,
        left: 0,
        right: 0,
        textAlign: 'center',
        zIndex: 20,
        pointerEvents: onTap && phase !== 'hidden' ? 'auto' : 'none',
        cursor: onTap ? 'pointer' : 'default',
        ...(inlineOpacity !== undefined ? { opacity: inlineOpacity } : {}),
      }}
    >
      <p
        key={`hint-${flashKey}`}
        style={{
          color: highlighted ? 'rgba(139,92,246,0.85)' : 'rgba(255,255,255,0.55)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.04em',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
          margin: 0,
          transition: 'color 0.2s',
          ...(flashAnim ? { animation: flashAnim } : {}),
        }}
      >
        {label}
      </p>
      <style>{`
        @keyframes voyo-flash-out {
          0%   { opacity: 1; }
          25%  { opacity: 0.45; }
          50%  { opacity: 0.85; }
          75%  { opacity: 0.30; }
          100% { opacity: 0; }
        }
        @keyframes voyo-flash-pulse {
          0%   { opacity: 0; }
          25%  { opacity: 0.85; }
          50%  { opacity: 0.40; }
          75%  { opacity: 0.85; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
});

CubeGestureHint.displayName = 'CubeGestureHint';
