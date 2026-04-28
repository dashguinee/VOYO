/**
 * LyricsBar — single bar (lyric line) with full lifecycle choreography.
 *
 * Stages: queued → arriving → live → decay → gone.
 * Each stage drives transform, opacity, weight, scale.
 *
 * Active bar gets the bronze hairline + soft glow + breathing weight
 * tied to --voyo-energy (live FFT energy from AudioPlayer's analyzer).
 *
 * Hooks (lines that repeat 3+ times) get a +size bump — the chorus
 * lifts itself.
 *
 * Spec: outputs/SPEC-lyrics-v2-2026-04-29.md
 */

import { memo } from 'react';
import type { BarStage } from './lyricsHelpers';

export interface LyricsBarProps {
  text: string;
  english?: string;
  stage: BarStage;
  isHook: boolean;
  /** Distance from the live bar — 0 if this IS live, ±1, ±2... */
  offset: number;
  onSeek?: () => void;
}

export const LyricsBar = memo(({
  text,
  english,
  stage,
  isHook,
  offset,
  onSeek,
}: LyricsBarProps) => {
  // ── Position: center is the live bar; positive offsets sit below
  //    (queued / arriving), negative offsets sit above (decay / gone).
  //    Each step out is ~58px in screen space (matches the hero-bump
  //    rhythm of the player). The active bar is a touch larger so the
  //    visual center isn't perfectly geometric — it sits ~6px lower
  //    than mid for read-comfort.
  const yPx = offset * 58 + (offset === 0 ? 0 : (offset > 0 ? 4 : -4));

  // ── Per-stage visual properties
  const isLive = stage === 'live';
  const isArriving = stage === 'arriving';
  const isDecay = stage === 'decay';
  const isQueued = stage === 'queued';
  const isGone = stage === 'gone';

  // Opacity decays with distance from live + by stage
  const baseOpacity = (() => {
    if (isGone) return 0;
    if (isLive) return 1;
    if (isArriving) return 0.85;
    if (isDecay) return 0.55;
    if (isQueued) {
      // Far queued bars dim more — only the immediate next is bright.
      const dist = Math.abs(offset);
      if (dist === 1) return 0.45;
      if (dist === 2) return 0.22;
      return 0.0;
    }
    return 0;
  })();

  // Scale: live is full, others shrink slightly. Hooks get +size when live.
  const scale = (() => {
    if (isLive) return isHook ? 1.10 : 1.04;
    if (isArriving) return 0.96;
    if (isDecay) return 0.94;
    return 0.92;
  })();

  // Font weight by stage. Live bars also TWEEN with --voyo-energy via inline calc.
  const baseWeight = (() => {
    if (isLive) return isHook ? 700 : 600;
    if (isArriving) return 500;
    return 400;
  })();

  // Font size — live bars are visibly larger; hooks grow further.
  const baseSize = (() => {
    if (isLive) return isHook ? 30 : 24;
    if (isArriving) return 19;
    if (isDecay) return 18;
    return 17;
  })();

  // ── Active-bar styles (the moment the bar drops): bronze hairline +
  //    soft outer glow + screen blend, weight breathes with audio energy.
  const liveStyle = isLive ? {
    background: 'rgba(15,15,22,0.55)',
    border: '1px solid rgba(212,160,83,0.42)',
    boxShadow: '0 0 28px rgba(212,160,83,0.22), 0 4px 22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)',
    backdropFilter: 'blur(14px) saturate(140%)',
    WebkitBackdropFilter: 'blur(14px) saturate(140%)',
    borderRadius: 22,
    padding: '10px 18px',
    // Variable-weight breathing: live bars tween 0..160 weight via --voyo-energy.
    // calc() expression resolves at paint time per CSS frame.
    fontWeight: `calc(${baseWeight} + var(--voyo-energy, 0) * 160)`,
  } : {
    fontWeight: baseWeight,
    background: 'transparent',
    padding: '4px 12px',
    border: '1px solid transparent',
    borderRadius: 22,
  };

  const handleClick = () => { if (onSeek) onSeek(); };

  return (
    <div
      onClick={handleClick}
      role="button"
      aria-label={isLive ? `Now: ${text}` : `Seek to: ${text}`}
      style={{
        position: 'absolute',
        left: 0, right: 0,
        top: '50%',
        // Compose the centering offset (-50%) with the per-bar y offset.
        // Spring on the transform so the live bar 'lands' instead of snaps.
        transform: `translate(0, calc(-50% + ${yPx}px)) scale(${scale})`,
        opacity: baseOpacity,
        transition: [
          'transform 360ms cubic-bezier(0.16, 1, 0.3, 1.4)',
          'opacity 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        ].join(', '),
        textAlign: 'center',
        pointerEvents: isGone ? 'none' : 'auto',
        cursor: isLive || isQueued || isArriving || isDecay ? 'pointer' : 'default',
      }}
    >
      <div style={liveStyle}>
        <p
          style={{
            color: isLive ? '#FFFFFF' : isHook ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.62)',
            fontSize: baseSize,
            lineHeight: 1.32,
            letterSpacing: isLive ? '0.01em' : '0.005em',
            margin: 0,
            // Active bar gets a soft white halo + bronze hint behind it.
            textShadow: isLive
              ? '0 0 14px rgba(255,255,255,0.28), 0 0 26px rgba(212,160,83,0.18)'
              : 'none',
            transition: 'font-size 240ms cubic-bezier(0.16, 1, 0.3, 1.4), color 220ms ease',
          }}
        >
          {text}
        </p>
        {/* English crib — only on the live bar, dim, italic, smaller */}
        {isLive && english && (
          <p
            style={{
              color: 'rgba(230,197,138,0.62)',
              fontSize: 12,
              fontStyle: 'italic',
              fontFamily: "'Fraunces', 'Satoshi', system-ui, serif",
              letterSpacing: '0.01em',
              margin: '4px 0 0 0',
            }}
          >
            {english}
          </p>
        )}
      </div>
    </div>
  );
});

LyricsBar.displayName = 'LyricsBar';
