import { memo } from 'react';

/**
 * Shared gesture hint / mode-toggle button for cube surfaces.
 * Same component on poster, iframe mini, and full-screen video.
 *
 * v891 (Dash 2026-04-29): the bottom hint becomes the *video-mode
 * button*. Tap = toggle mode. On the iframe the iframe's own
 * drag layer already handles tap-to-close, so onTap is optional —
 * pass it where the hint needs to be the actual trigger (poster).
 */
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
}) => (
  <div
    // Stop pointerDown so the parent card's pointerDown handlers
    // (lyrics duck/pause grammar) don't compete with this button.
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
      pointerEvents: onTap ? 'auto' : 'none',
      cursor: onTap ? 'pointer' : 'default',
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
      {label}
    </p>
  </div>
));

CubeGestureHint.displayName = 'CubeGestureHint';
