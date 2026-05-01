/**
 * CubeGestureHint — three-phase onboarding hint for the portrait cube.
 *
 * Phase 0  (show ×2): "tap to close · drag to move"  — white, 8s each, auto-fade
 * Phase 1  (show ×1): "drag to move"                 — neon-purple pulse, dismissed
 *                      when the user actually drags (highlighted becomes true)
 * Phase 2  (show ×1): "Now drag right for Takeout"   — white, 7s auto-fade
 * Phase 3+ : nothing
 *
 * Phases are persisted in localStorage so the sequence survives page reloads.
 * The 350ms entrance delay lets the cube's entrance motion settle before the
 * hint fades in.
 */

import { memo, useEffect, useState, useRef } from 'react';

const PHASE_KEY = 'voyo-cube-hint-phase-v2';

// How many times to show each phase before advancing
const PHASE_SHOWS: Record<number, number> = { 0: 2, 1: 1, 2: 1 };
// Auto-fade duration per phase (ms). Phase 1 is drag-dismissed, so longer timeout is fine.
const PHASE_DURATION: Record<number, number> = { 0: 8000, 1: 12000, 2: 7000 };
const FADE_MS = 700;
const ENTRANCE_DELAY_MS = 350;

type VisState = 'hidden' | 'entering' | 'visible' | 'fading';

const readState = (): { phase: number; shows: number } => {
  try {
    const raw = localStorage.getItem(PHASE_KEY);
    if (!raw) return { phase: 0, shows: 0 };
    return JSON.parse(raw) as { phase: number; shows: number };
  } catch { return { phase: 0, shows: 0 }; }
};

const writeState = (s: { phase: number; shows: number }) => {
  try { localStorage.setItem(PHASE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
};

export const CubeGestureHint = memo(({
  highlighted = false,
}: {
  highlighted?: boolean;
  // Legacy props accepted but unused — callers don't need updating
  position?: 'top' | 'bottom';
  label?: string;
  onTap?: () => void;
}) => {
  const [state] = useState(readState);
  const [vis, setVis] = useState<VisState>('hidden');
  // Track whether we've advanced off the last show of the current phase
  const phaseDoneRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] };

  // Advance to next phase (persist + hard-reload hint)
  const advance = () => {
    const s = readState();
    const needed = PHASE_SHOWS[s.phase] ?? 1;
    const nextShows = s.shows + 1;
    if (nextShows >= needed) {
      writeState({ phase: s.phase + 1, shows: 0 });
    } else {
      writeState({ phase: s.phase, shows: nextShows });
    }
  };

  const dismiss = () => {
    if (phaseDoneRef.current) return;
    phaseDoneRef.current = true;
    clearTimers();
    setVis('fading');
    const t = setTimeout(() => { setVis('hidden'); advance(); }, FADE_MS);
    timers.current.push(t);
  };

  useEffect(() => {
    clearTimers();
    phaseDoneRef.current = false;

    const { phase, shows } = readState();
    if (phase >= 3) return; // done with all phases

    // Entrance: delay then fade in
    setVis('hidden');
    const t0 = setTimeout(() => setVis('entering'), 10);
    const t1 = setTimeout(() => setVis('visible'), ENTRANCE_DELAY_MS);
    timers.current.push(t0, t1);

    // Auto-dismiss after PHASE_DURATION
    const needed = PHASE_SHOWS[phase] ?? 1;
    const remaining = PHASE_DURATION[phase] ?? 8000;
    const t2 = setTimeout(dismiss, ENTRANCE_DELAY_MS + remaining);
    timers.current.push(t2);

    return clearTimers;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 1: dismiss when user drags (highlighted becomes true)
  const highlightedRef = useRef(false);
  useEffect(() => {
    const { phase } = readState();
    if (phase !== 1) return;
    if (highlighted && !highlightedRef.current) {
      highlightedRef.current = true;
      dismiss();
    }
    if (!highlighted) highlightedRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted]);

  const { phase } = state;
  if (phase >= 3 || vis === 'hidden') return null;

  const opacity = vis === 'visible' ? 1 : 0;

  const label =
    phase === 0 ? 'tap to close · drag to move' :
    phase === 1 ? 'drag to move' :
                  'drag right for Takeout';

  const isPurplePulse = phase === 1;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 1,
        left: 0,
        right: 0,
        textAlign: 'center',
        zIndex: 20,
        pointerEvents: 'none',
        opacity,
        transition: `opacity ${vis === 'entering' ? ENTRANCE_DELAY_MS : FADE_MS}ms ease-${vis === 'entering' ? 'in' : 'out'}`,
      }}
    >
      <p
        style={{
          color: isPurplePulse ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.18)',
          fontSize: 9,
          fontWeight: 400,
          letterSpacing: '0.05em',
          margin: 0,
          animation: isPurplePulse ? 'voyo-cube-hint-pulse 1.6s ease-in-out infinite' : 'none',
        }}
      >
        {label}
      </p>
      {isPurplePulse && (
        <style>{`
          @keyframes voyo-cube-hint-pulse {
            0%, 100% { text-shadow: 0 0 6px rgba(139,92,246,0.4), 0 0 12px rgba(139,92,246,0.2); }
            50%       { text-shadow: 0 0 14px rgba(167,139,250,1), 0 0 26px rgba(139,92,246,0.7), 0 0 40px rgba(139,92,246,0.35); }
          }
        `}</style>
      )}
    </div>
  );
});

CubeGestureHint.displayName = 'CubeGestureHint';
