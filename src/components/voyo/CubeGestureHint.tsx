import { memo, useEffect, useState } from 'react';

/**
 * Shared cube gesture hint with session-scoped lifecycle.
 *
 * v898 (Dash 2026-04-29): "after 15s flash then disappear, again
 * at 45s and 5min, then gone forever". Replaces v897's slow 7s
 * fade with discrete blink-flashes at three timestamps. Hint
 * position nudged a touch lower on the cube.
 *
 * Phases:
 *   visible  (0–15s)   — silver-metallic sheen, opacity 1
 *   flashing (1.5s ea) — keyframe blink: 0 → 1 → 0.4 → 1 → 0
 *   hidden   (between) — invisible
 *   dead     (5min+)   — gone forever for the rest of the session
 *
 * Schedule: flashes fire at 15s, 45s, 5min. After the 5min flash
 * the hint is permanently dead. Session start is module-level so
 * the timeline survives mount/unmount cycles.
 */

const SCHEDULE_MS = [15_000, 45_000, 300_000] as const; // 15s, 45s, 5min
const FLASH_DURATION_MS = 1500;

let sessionStart: number | null = null;
const getSessionStart = () => {
  if (sessionStart === null) sessionStart = Date.now();
  return sessionStart;
};

type Phase = 'visible' | 'flashing' | 'hidden' | 'dead';

const computeInitialPhase = (): Phase => {
  const elapsed = Date.now() - getSessionStart();
  if (elapsed < SCHEDULE_MS[0]) return 'visible';
  // Past last flash + its window → dead.
  const lastFlashEnd = SCHEDULE_MS[SCHEDULE_MS.length - 1] + FLASH_DURATION_MS;
  if (elapsed > lastFlashEnd) return 'dead';
  // Inside a flash window? (rare on remount mid-flash)
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
  // Bump on every flash trigger so the CSS animation re-fires (keyed on
  // a `--flash-key` custom property forces a fresh animation cycle even
  // if the same phase value reappears).
  const [flashKey, setFlashKey] = useState(0);

  // Schedule remaining flashes against session start. Runs once.
  useEffect(() => {
    const elapsed = Date.now() - getSessionStart();
    const timers: ReturnType<typeof setTimeout>[] = [];

    SCHEDULE_MS.forEach((flashAt, i) => {
      const isLast = i === SCHEDULE_MS.length - 1;
      // Skip flashes whose window is already past.
      if (flashAt + FLASH_DURATION_MS <= elapsed) return;

      const startDelay = Math.max(0, flashAt - elapsed);
      timers.push(setTimeout(() => {
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

  // Silver metallic gradient — same as v897.
  const sheenGradient = highlighted
    ? 'linear-gradient(120deg, #b8a4ff 0%, #ffffff 50%, #b8a4ff 100%)'
    : 'linear-gradient(120deg, #b8b8b8 0%, #ffffff 50%, #b8b8b8 100%)';

  // Opacity strategy:
  //   - visible  → 1 (steady)
  //   - hidden   → 0 (steady)
  //   - flashing → CSS animation owns it (forwards keeps end-state)
  const inlineOpacity =
    phase === 'visible' ? 1 :
    phase === 'hidden'  ? 0 :
    undefined; // flashing — let the animation set it

  // Compose animations: sheen always runs (when not invisible); flash
  // layers on top during 'flashing' phase. Different properties so
  // they don't fight (sheen → background-position; flash → opacity).
  const animations = [
    'voyo-cube-hint-sheen 2.6s ease-in-out infinite',
    phase === 'flashing'
      ? `voyo-cube-hint-flash ${FLASH_DURATION_MS}ms ease-out forwards`
      : null,
  ].filter(Boolean).join(', ');

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
        // v898: 4px lower than v897 (was 8). Sits a touch closer to
        // the cube edge per Dash.
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
        // Re-mount the animation host on every flash so the keyframe
        // restarts cleanly (same-name same-element animation re-triggers
        // are fragile across browsers).
        key={`hint-${flashKey}`}
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
          animation: animations,
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
        @keyframes voyo-cube-hint-flash {
          0%   { opacity: 0; }
          12%  { opacity: 1; }
          32%  { opacity: 0.35; }
          52%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
});

CubeGestureHint.displayName = 'CubeGestureHint';
