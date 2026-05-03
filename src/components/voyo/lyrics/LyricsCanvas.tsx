/**
 * LyricsCanvas — the V2 lyrics surface.
 *
 * Renders a vertical rhythm of bars. The live bar sits centered; the
 * previous bars trail upward (decay/gone), the upcoming bars stack
 * downward (arriving/queued). Two-bar lookahead is built in.
 *
 * Hook detection runs once per lyrics object — repeated lines (3+) get
 * a +size, +weight bump. Active-bar weight breathes with --voyo-energy
 * (live FFT from the audio analyzer).
 *
 * Spec: outputs/SPEC-lyrics-v2-2026-04-29.md
 */

import { memo, useMemo } from 'react';
import { LyricsBar } from './LyricsBar';
import {
  computeBarStage,
  detectHooks,
  findActiveIndex,
  pickVisibleIndexes,
} from './lyricsHelpers';
import type { EnrichedLyrics } from '../../../services/lyricsEngine';
import { usePlayerStore } from '../../../store/playerStore';

export interface LyricsCanvasProps {
  lyrics: EnrichedLyrics;
  currentTime: number;
}

// Highlight the active line this many seconds before its timestamp —
// gives the eye time to land on the line before the vocalist sings it.
const LOOKAHEAD_SEC = 0.30;

export const LyricsCanvas = memo(({ lyrics, currentTime }: LyricsCanvasProps) => {
  const segments = lyrics.translated;
  const seekTo = usePlayerStore((s) => s.seekTo);

  // Hook map — computed once per lyrics object (segments identity is stable
  // across re-renders unless the track changes).
  const hookSet = useMemo(() => detectHooks(segments), [segments]);

  // Shift time forward so bars go "live" 300ms before their actual start.
  const effectiveTime = currentTime + LOOKAHEAD_SEC;

  // Active bar driven by the lookahead-shifted clock.
  const activeIndex = findActiveIndex(segments, effectiveTime);

  // Visible window — 2 above + active + 2 below. Limited render cost.
  const visibleIndexes = pickVisibleIndexes(segments.length, activeIndex);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        // Slight downward bias on the canvas — the live bar sits a touch
        // below mathematical center so the user's eye lands on it
        // naturally without craning. Matches the player's hero-bump bias.
        transform: 'translateY(8px)',
        pointerEvents: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Render each visible bar — absolutely positioned, lifecycle-driven. */}
      {visibleIndexes.map((i) => {
        const seg = segments[i];
        if (!seg) return null;
        const stage = computeBarStage(seg, effectiveTime);
        const offset = i - activeIndex;
        return (
          <div key={`${seg.startTime}-${i}`} style={{ pointerEvents: 'auto' }}>
            <LyricsBar
              text={seg.original}
              english={seg.english}
              stage={stage}
              isHook={hookSet.has(i)}
              offset={offset}
              onSeek={() => seekTo(seg.startTime)}
            />
          </div>
        );
      })}
    </div>
  );
});

LyricsCanvas.displayName = 'LyricsCanvas';
