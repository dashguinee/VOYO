import { memo } from 'react';

/**
 * Shared gesture hint for cube surfaces (poster artwork + iframe mini).
 * Same component on both = same grammar = visual confirmation that the
 * two surfaces are wired together as one cube in two states.
 *
 * v888 (Dash 2026-04-29): "make sure all the cubes have it so I am
 * sure you are connecting the same thing".
 */
export const CubeGestureHint = memo(({
  position = 'bottom',
  highlighted = false,
}: {
  position?: 'top' | 'bottom';
  highlighted?: boolean;
}) => (
  <div
    style={{
      position: 'absolute',
      [position]: 8,
      left: 0,
      right: 0,
      textAlign: 'center',
      zIndex: 15,
      pointerEvents: 'none',
    }}
  >
    <p
      style={{
        color: highlighted
          ? 'rgba(139,92,246,0.85)'
          : 'rgba(255,255,255,0.55)',
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.04em',
        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        transition: 'color 0.2s',
        margin: 0,
      }}
    >
      tap to change mode · drag to move
    </p>
  </div>
));

CubeGestureHint.displayName = 'CubeGestureHint';
