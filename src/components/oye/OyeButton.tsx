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
import { usePlayerStore } from '../../store/playerStore';
import { app } from '../../services/oyo';
import { getYouTubeId } from '../../utils/voyoId';
import type { Track } from '../../types';

export type OyeButtonSize = 'sm' | 'md' | 'lg';
export type OyeVisualState = 'purple-faded' | 'bubbling' | 'gold-faded' | 'gold-filled';

const SIZE_MAP: Record<OyeButtonSize, { px: number; icon: number }> = {
  sm: { px: 28, icon: 14 },
  md: { px: 40, icon: 18 },
  lg: { px: 44, icon: 20 },
};

const STYLE_BY_STATE: Record<OyeVisualState, {
  background: string;
  border: string;
  iconColor: string;
  iconFill: string;
  boxShadow: string;
  animation: string;
  /** Faded outer ring, 1px. Present on every state except bubbling (which
   *  draws its own brighter pulsing ring) and gold-filled (already glows). */
  ring: string | 'none';
}> = {
  'purple-faded': {
    // Softer than before — feels like a resting state. Background nearly
    // transparent, border low-opacity, icon at 50%. The faded ring reads
    // as "there's something here but it's asleep."
    background: 'rgba(139, 92, 246, 0.05)',
    border: '1px solid rgba(139, 92, 246, 0.22)',
    iconColor: 'rgba(196, 181, 253, 0.50)',
    iconFill: 'none',
    boxShadow: 'none',
    animation: 'none',
    ring: '1px solid rgba(196, 181, 253, 0.15)',
  },
  'bubbling': {
    background: 'rgba(139, 92, 246, 0.25)',
    border: '1.5px solid rgba(196, 181, 253, 0.85)',
    iconColor: 'rgba(224, 211, 255, 0.95)',
    iconFill: 'none',
    boxShadow: '0 0 12px rgba(139, 92, 246, 0.55), 0 0 22px rgba(139, 92, 246, 0.28)',
    animation: 'voyo-iframe-pulse 1.6s ease-in-out infinite',
    // Brighter pulsing ring (thicker) — this is the active "cooking" signal.
    ring: '2px solid rgba(196, 181, 253, 0.45)',
  },
  'gold-faded': {
    background: 'rgba(212, 160, 83, 0.14)',
    border: '1px solid rgba(212, 160, 83, 0.45)',
    iconColor: 'rgba(212, 160, 83, 0.85)',
    iconFill: 'none',
    boxShadow: 'none',
    animation: 'none',
    // Gold-tinted faded ring, mirrors the purple-faded treatment.
    ring: '1px solid rgba(212, 160, 83, 0.18)',
  },
  'gold-filled': {
    background: 'linear-gradient(135deg, #D4A053, #C4943D)',
    border: '1px solid rgba(212, 160, 83, 0.85)',
    iconColor: '#FFFFFF',
    iconFill: '#FFFFFF',
    boxShadow: '0 2px 10px rgba(212, 160, 83, 0.50), 0 0 20px rgba(212, 160, 83, 0.25)',
    animation: 'none',
    // No outline — the glow box-shadow already reads as the "aura."
    ring: 'none',
  },
};

function computeVisualState(
  downloadStatus: 'queued' | 'downloading' | 'complete' | 'failed' | undefined,
  hasExplicitLike: boolean,
  isActiveIframe: boolean,
): OyeVisualState {
  // Gold filled = in disco AND explicitly Oye'd. BOTH required per Dash's
  // spec — "filled is in disco + liked/oyed". A track that's cached via
  // auto-play but never user-Oye'd sits in gold-faded; a track that's
  // user-Oye'd but not yet cached sits in bubbling until disco lands.
  if (downloadStatus === 'complete' && hasExplicitLike) return 'gold-filled';
  // Cooking — the pulse is the active signal that the track is being
  // worked on right now. Two sources of "cooking":
  //   a) local IndexedDB download in flight (downloadStatus)
  //   b) this IS the currently playing track AND it's on iframe, meaning
  //      R2 extraction is racing server-side (per Dash's rule "if it's
  //      iframe and playing probably means it's cooking").
  // Either qualifies regardless of whether the user has explicitly Oye'd.
  if (downloadStatus === 'downloading' || downloadStatus === 'queued') return 'bubbling';
  if (isActiveIframe) return 'bubbling';
  // In disco but no explicit Oye tap yet — e.g. auto-cached via play.
  if (downloadStatus === 'complete') return 'gold-faded';
  // Cold — "needs to Oye".
  return 'purple-faded';
}

interface OyeButtonProps {
  track: Track;
  /** 'md' default. sm for tight rows, lg for primary surfaces. */
  size?: OyeButtonSize;
  /**
   * When true, oyeCommit also arms PiP so the user can carry Oyo offline
   * after backgrounding. Defaults to true — per Dash's spec, every Oye is
   * a takeout gesture ("if you click the oye button at anytime it does
   * its action and allows takeout"). Opt-out via escape={false} for
   * contexts where PiP is already guaranteed (e.g. playlist builders
   * that don't intend to play the track immediately).
   */
  escape?: boolean;
  /** Extra className passthrough for layout. */
  className?: string;
  /** Click handler override — defaults to app.oyeCommit. */
  onClick?: (track: Track) => void;
}

export const OyeButton = memo(({ track, size = 'md', escape = true, className = '', onClick }: OyeButtonProps) => {
  // Subscribe narrowly so the button re-renders only when its own track's
  // state changes.
  //
  // CRITICAL: downloadStore keys its entries by the *decoded* YouTube id
  // (see downloadStore.boostTrack -> decodeVoyoId). If we look up with a
  // raw VOYO id (vyo_<base64>), the hit always misses and the button stays
  // stuck in purple-faded even while the track is actively downloading.
  // Normalise here — same function boostTrack uses internally.
  const download = useDownloadStore(s => s.downloads.get(getYouTubeId(track.trackId)));
  const preference = usePreferenceStore(s => s.trackPreferences[track.id]);
  // Active-iframe detection: am I the currently playing track AND is the
  // app on the iframe fallback? If yes, R2 extraction is racing in the
  // background and the button should bubble to signal "cooking." This is
  // Dash's rule — iframe + playing ⇒ cooking, even before the user Oyes.
  // Both selectors return primitives so zustand's default reference equality
  // suffices; no extra memoisation needed.
  const isCurrent = usePlayerStore(s =>
    s.currentTrack?.trackId === track.trackId || s.currentTrack?.id === track.id,
  );
  const isIframe = usePlayerStore(s => s.playbackSource === 'iframe');
  const isActiveIframe = isCurrent && isIframe;

  const state = useMemo(
    () => computeVisualState(download?.status, preference?.explicitLike === true, isActiveIframe),
    [download?.status, preference?.explicitLike, isActiveIframe],
  );

  const { px, icon } = SIZE_MAP[size];
  const style = STYLE_BY_STATE[state];
  const hasRing = style.ring !== 'none';

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
        // Outer ring per state: faded on idle/faded states, bright on
        // bubbling, absent on gold-filled (solid fill already reads as
        // anchored). Consistent offset so the ring never crowds the border.
        outline: hasRing ? style.ring : 'none',
        outlineOffset: hasRing ? '2px' : '0',
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
