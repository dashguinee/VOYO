/**
 * OyeButton — the unified commit gesture, same everywhere.
 *
 * Every surface that shows a track (search result, feed card, library row,
 * mini-player, player top-right) renders this component and only this
 * component for the Oye affordance. One component, one action, four visual
 * states. Dash's "narralogy": purple = on its way / cooking, gold = arrived
 * / committed. The color morph when cooking completes (purple → gold) is
 * the visual payoff that tells the user "the track is yours now."
 *
 * State derivation (no new storage — both sources already exist):
 *   • downloadStore.downloads.get(trackId)?.status === 'downloading'
 *       → "bubbling" (purple with animated ring)
 *   • downloadStore.downloads.get(trackId)?.status === 'complete'
 *     AND preferenceStore.trackPreferences[trackId]?.explicitLike !== true
 *       → "gold faded" (in disco, not yet Oye'd)
 *   • preferenceStore.trackPreferences[trackId]?.explicitLike === true
 *       → "gold filled" (Oye'd)
 *   • otherwise
 *       → "purple faded" (cold, not in disco, not Oye'd)
 *
 * Tap semantics: fires app.oyeCommit(track, { escape }). The escape flag
 * arms PiP using the live user-gesture chain — use it on the mini-player
 * + player button, skip it on feed/search cards (nothing to escape from).
 */

import { memo, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { app } from '../../services/oyo';
import type { Track } from '../../types';

export type OyeButtonSize = 'sm' | 'md' | 'lg';
export type OyeVisualState = 'purple-faded' | 'bubbling' | 'gold-faded' | 'gold-filled';

const SIZE_MAP: Record<OyeButtonSize, { px: number; icon: number; ring: number }> = {
  sm: { px: 28, icon: 14, ring: 2 },
  md: { px: 40, icon: 18, ring: 2 },
  lg: { px: 44, icon: 20, ring: 3 },
};

const STYLE_BY_STATE: Record<OyeVisualState, {
  background: string;
  border: string;
  iconColor: string;
  iconFill: string;
  boxShadow: string;
  animation: string;
}> = {
  'purple-faded': {
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(139, 92, 246, 0.35)',
    iconColor: 'rgba(196, 181, 253, 0.65)',
    iconFill: 'none',
    boxShadow: 'none',
    animation: 'none',
  },
  'bubbling': {
    background: 'rgba(139, 92, 246, 0.25)',
    border: '1.5px solid rgba(196, 181, 253, 0.85)',
    iconColor: 'rgba(224, 211, 255, 0.95)',
    iconFill: 'none',
    boxShadow: '0 0 12px rgba(139, 92, 246, 0.55), 0 0 22px rgba(139, 92, 246, 0.28)',
    animation: 'voyo-iframe-pulse 1.6s ease-in-out infinite',
  },
  'gold-faded': {
    background: 'rgba(212, 160, 83, 0.16)',
    border: '1px solid rgba(212, 160, 83, 0.50)',
    iconColor: 'rgba(212, 160, 83, 0.85)',
    iconFill: 'none',
    boxShadow: '0 0 8px rgba(212, 160, 83, 0.20)',
    animation: 'none',
  },
  'gold-filled': {
    background: 'linear-gradient(135deg, #D4A053, #C4943D)',
    border: '1px solid rgba(212, 160, 83, 0.85)',
    iconColor: '#FFFFFF',
    iconFill: '#FFFFFF',
    boxShadow: '0 2px 10px rgba(212, 160, 83, 0.50), 0 0 20px rgba(212, 160, 83, 0.25)',
    animation: 'none',
  },
};

function computeVisualState(
  downloadStatus: 'queued' | 'downloading' | 'complete' | 'failed' | undefined,
  hasExplicitLike: boolean,
): OyeVisualState {
  // Gold filled = in disco AND explicitly Oye'd. BOTH required per Dash's
  // spec — "filled is in disco + liked/oyed". A track that's cached via
  // auto-play but never user-Oye'd sits in gold-faded; a track that's
  // user-Oye'd but not yet cached sits in bubbling until disco lands.
  if (downloadStatus === 'complete' && hasExplicitLike) return 'gold-filled';
  // Cooking takes precedence over the faded states — the pulse is the
  // active signal that matters most while extraction is in flight, even
  // if the user already tapped Oye.
  if (downloadStatus === 'downloading' || downloadStatus === 'queued') return 'bubbling';
  // In disco but no explicit Oye tap yet — e.g. auto-cached via play.
  if (downloadStatus === 'complete') return 'gold-faded';
  // Cold — "needs to Oye".
  return 'purple-faded';
}

interface OyeButtonProps {
  track: Track;
  /** 'md' default. sm for tight rows, lg for primary surfaces. */
  size?: OyeButtonSize;
  /** When true, oyeCommit also arms PiP (mini-player + player contexts). */
  escape?: boolean;
  /** Extra className passthrough for layout. */
  className?: string;
  /** Click handler override — defaults to app.oyeCommit. */
  onClick?: (track: Track) => void;
}

export const OyeButton = memo(({ track, size = 'md', escape = false, className = '', onClick }: OyeButtonProps) => {
  // Subscribe narrowly so the button re-renders only when its own track's
  // state changes. Keying on trackId means track objects with the same id
  // still share state across surfaces.
  const download = useDownloadStore(s => s.downloads.get(track.trackId));
  const preference = usePreferenceStore(s => s.trackPreferences[track.id]);

  const state = useMemo(
    () => computeVisualState(download?.status, preference?.explicitLike === true),
    [download?.status, preference?.explicitLike],
  );

  const { px, icon, ring } = SIZE_MAP[size];
  const style = STYLE_BY_STATE[state];

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick(track);
      return;
    }
    app.oyeCommit(track, { escape });
  };

  // ARIA label rotates with state so screen readers surface the right context.
  const ariaLabel =
    state === 'gold-filled' ? 'Oye\'d — already committed'
    : state === 'bubbling' ? 'Cooking — will finish soon'
    : state === 'gold-faded' ? 'Oye this track'
    : 'Oye — warm it up and carry Oyo offline';

  return (
    <button
      onClick={handleClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`flex items-center justify-center rounded-full active:scale-95 transition-all ${className}`}
      style={{
        width: px,
        height: px,
        background: style.background,
        border: style.border,
        boxShadow: style.boxShadow,
        animation: style.animation,
        // Bubbling state: add a second ring for the "pulse ring" treatment
        outline: state === 'bubbling' ? `${ring}px solid rgba(196, 181, 253, 0.35)` : 'none',
        outlineOffset: state === 'bubbling' ? '1px' : '0',
      }}
    >
      <Zap
        size={icon}
        style={{
          color: style.iconColor,
          fill: style.iconFill,
        }}
      />
    </button>
  );
});

OyeButton.displayName = 'OyeButton';
