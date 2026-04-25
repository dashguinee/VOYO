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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { usePlayerStore } from '../../store/playerStore';
import { useR2KnownStore } from '../../store/r2KnownStore';
import { useWarmingStore } from '../../store/warmingStore';
import { app } from '../../services/oyo';
import { getYouTubeId } from '../../utils/voyoId';
import type { Track } from '../../types';

export type OyeButtonSize = 'sm' | 'md' | 'lg';
export type OyeVisualState = 'grey-faded' | 'bubbling' | 'gold-faded' | 'gold-filled';

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
  'grey-faded': {
    // Neutral grey glass — the "not in your disco" state. Chromatic-
    // free on purpose: the ONLY gold in the narralogy is disco presence,
    // so a cold track has to read as absent-of-gold, not a different
    // colour of Oye. White alpha over dark glass = quiet, inactive,
    // obviously tappable without shouting.
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    iconColor: 'rgba(255, 255, 255, 0.40)',
    iconFill: 'none',
    boxShadow: 'none',
    animation: 'none',
    ring: '1px solid rgba(255, 255, 255, 0.08)',
  },
  'bubbling': {
    background: 'rgba(139, 92, 246, 0.25)',
    border: '1.5px solid rgba(196, 181, 253, 0.85)',
    iconColor: 'rgba(224, 211, 255, 0.95)',
    iconFill: 'none',
    boxShadow: '0 0 12px rgba(139, 92, 246, 0.55), 0 0 22px rgba(139, 92, 246, 0.28)',
    // Combined scale + glow pulse so the button breathes visibly, not just
    // glows. Paired with the rotating lightning-ring overlay rendered below
    // (state === 'bubbling' branch in JSX) for the full "cooking" effect.
    animation: 'voyo-oye-bubble 1.6s ease-in-out infinite',
    // outline here is intentionally 'none' — the bubbling state draws its
    // own brighter, rotating conic-gradient ring as a separate element so
    // we can animate rotation independently of the button's scale pulse.
    ring: 'none',
  },
  'gold-faded': {
    // Same glass base as grey-faded — the gold accent only lives on the
    // border + icon + ring, so the dark translucent surface stays
    // consistent across states. Narralogy: cold idle → bubbling → glass
    // arrives in gold → tap fills it.
    background: 'rgba(28, 28, 35, 0.55)',
    border: '1px solid rgba(212, 160, 83, 0.45)',
    iconColor: 'rgba(212, 160, 83, 0.85)',
    iconFill: 'none',
    boxShadow: '0 0 6px rgba(212, 160, 83, 0.18)',
    animation: 'none',
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

/**
 * Shared state derivation — exported so BoostButton (the Oye variant with
 * EQ superpower on Portrait / Landscape / VideoMode toolbars) uses the
 * exact same narralogy. One source of truth for "what state is this track
 * in" across every Oye affordance in the app.
 *
 * Oye ⊂ Like ⊂ Committed. In boost-mode contexts, turning EQ on ALSO
 * counts as committed (the user actively chose to engage), so gold-filled
 * lights up when (in disco) AND (liked OR EQ-on). In default contexts,
 * only explicitLike counts — isEqOnBoost is ignored.
 */
export function computeOyeState(
  downloadStatus: 'queued' | 'downloading' | 'complete' | 'failed' | undefined,
  hasExplicitLike: boolean,
  isActiveIframe: boolean,
  isEqOnBoost = false,
  isInR2 = false,
  isWarming = false,
): OyeVisualState {
  const isCommitted = hasExplicitLike || isEqOnBoost;
  // "In your Disco" = can play instantly. Two equivalent sources:
  //   a) local IndexedDB download complete
  //   b) known present in R2 (from r2KnownStore — populated by probe,
  //      hotswap success, or bulk video_intelligence query)
  // Either one means the Oye button can honestly show gold.
  const inDisco = downloadStatus === 'complete' || isInR2;

  // Gold filled = in disco AND committed.
  if (inDisco && isCommitted) return 'gold-filled';
  // Cooking — purple lightning pulse. Sources of "cooking":
  //   a) local IndexedDB download in flight (downloadStatus)
  //   b) this IS the currently playing track AND it's on iframe, meaning
  //      R2 extraction is racing server-side
  //   c) warmingStore says we just queued it from a non-R2 surface
  //      (e.g. search tap) — Dash's "keep the lightning pulsing until
  //      song is in R2" — purple stays lit alongside the orange "being
  //      added" contour on the surface that initiated it.
  // All three suppressed when inDisco (R2 already has it) — the button
  // settles to gold-faded once cooking finishes.
  if (downloadStatus === 'downloading' || downloadStatus === 'queued') return 'bubbling';
  if (isActiveIframe && !inDisco) return 'bubbling';
  if (isWarming && !inDisco) return 'bubbling';
  // In disco but no explicit commitment yet — e.g. auto-cached via play.
  if (inDisco) return 'gold-faded';
  // Cold — "needs to Oye".
  return 'grey-faded';
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
  // stuck in grey-faded even while the track is actively downloading.
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
  // Know-about-R2: populated by r2Probe (HEAD success), gateToR2 (bulk
  // video_intelligence query), and the hotswap poll tick. Lets the
  // button flip to gold-faded / gold-filled the moment R2 is proven
  // ready, rather than waiting for a local IndexedDB download to
  // complete. Selector returns primitive boolean so zustand's default
  // equality is sufficient.
  const isInR2 = useR2KnownStore(s => s.known.has(getYouTubeId(track.trackId)));
  // Warming subscription — when a non-R2 search/feed tap queues a track,
  // it lands in warmingStore. Pulse stays lit until R2 confirms (the
  // computeOyeState branch suppresses warming → bubbling once inDisco).
  const isWarming = useWarmingStore(s => s.warming.has(getYouTubeId(track.trackId)));

  const state = useMemo(
    () => computeOyeState(download?.status, preference?.explicitLike === true, isActiveIframe, false, isInR2, isWarming),
    [download?.status, preference?.explicitLike, isActiveIframe, isInR2, isWarming],
  );

  const { px, icon } = SIZE_MAP[size];
  const style = STYLE_BY_STATE[state];
  const hasRing = style.ring !== 'none';

  // Charging phase — the bright lightning ring right after a tap. Phase 1
  // of the 3-phase choreography (ring → bubble → glow). Sync with REAL
  // pipeline events so the visual never lies:
  //
  //   • Latch opens on tap
  //   • Latch closes when (a) real download status flips to
  //     downloading/queued/complete OR (b) 600ms fallback fires — whichever
  //     comes first. 300ms minimum so the user always sees a charge flash
  //     even when the pipeline is instant (e.g. boostTrack short-circuits
  //     on already-cached track).
  //   • Bubble (phase 2) only plays once latch is closed, never concurrent.
  //
  // Effect: charge always reflects a real handoff, never a hardcoded timer.
  const [isCharging, setIsCharging] = useState(false);
  const chargeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chargeStartRef = useRef<number>(0);
  const CHARGE_MIN_MS = 300;
  const CHARGE_MAX_MS = 600;

  useEffect(() => () => {
    if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
  }, []);

  // Close the charge latch as soon as real status moves (respecting the
  // 300ms minimum so we never flash below the perceptual threshold).
  useEffect(() => {
    if (!isCharging) return;
    const advanced =
      download?.status === 'downloading' ||
      download?.status === 'queued' ||
      download?.status === 'complete';
    if (!advanced) return;
    const elapsed = Date.now() - chargeStartRef.current;
    if (elapsed >= CHARGE_MIN_MS) {
      setIsCharging(false);
      if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
    } else {
      // Too soon — schedule the close at the 300ms mark.
      if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
      chargeTimerRef.current = setTimeout(() => setIsCharging(false), CHARGE_MIN_MS - elapsed);
    }
  }, [isCharging, download?.status]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCharging(true);
    chargeStartRef.current = Date.now();
    if (chargeTimerRef.current) clearTimeout(chargeTimerRef.current);
    chargeTimerRef.current = setTimeout(() => setIsCharging(false), CHARGE_MAX_MS);
    if (onClick) {
      onClick(track);
      return;
    }
    app.oyeCommit(track, { escape });
  }, [track, escape, onClick]);

  // ARIA label rotates with state so screen readers surface the right context.
  const ariaLabel =
    state === 'gold-filled' ? 'Oye\'d — already committed'
    : state === 'bubbling' ? 'Cooking — will finish soon'
    : state === 'gold-faded' ? 'Oye this track'
    : 'Oye — not in your disco yet, tap to cook';

  // Sequential "ring → bubble" choreography (never overlap):
  //
  //   Phase 1 — IDLE at rest:
  //     State is grey-faded or gold-faded, not charging. Ring spins
  //     slowly + faintly in the state's accent color (purple or gold).
  //     Low-key ambient electricity.
  //
  //   Phase 2 — CHARGE on tap (~600ms):
  //     Ring opacity jumps, rotation accelerates. No bubble yet. Gives
  //     instant tap feedback and "buys time" for the pipeline to start.
  //     Timer in handleClick flips isCharging off after 600ms.
  //
  //   Phase 3 — BUBBLE while cooking:
  //     Ring drops out. Button itself runs voyo-oye-bubble (scale +
  //     glow pulse). Single focal animation — no competing motion.
  //
  //   Phase 4 — GOLD-FILLED (arrived):
  //     No ring, no bubble. Solid gold gradient + soft glow box-shadow
  //     reads as anchored.
  //
  // The isCharging latch sits ON TOP of state so the bubble animation
  // only runs when cooking AND not in the brief charge window. This is
  // what Dash meant by "smooth non cringe sequence, buys time."
  const isBubblingState = state === 'bubbling';
  const showRing = state !== 'gold-filled' && (!isBubblingState || isCharging);
  const runBubble = isBubblingState && !isCharging;
  // Ring accent tracks the state's dominant colour so the lightning arc
  // matches the button's identity at rest. Gold in disco, white for cold
  // (no purple hint in the cold state — the Oye button is never "purple
  // at rest" anymore), purple reserved for the charge/bubble phase.
  const isGoldAccent = state === 'gold-faded';
  const isGreyAccent = state === 'grey-faded' && !isCharging;
  const ringAccent = isGoldAccent ? 'rgba(212,160,83,0.85)'
    : isGreyAccent ? 'rgba(255,255,255,0.55)'
    : 'rgba(196,181,253,0.85)';
  const ringFaint  = isGoldAccent ? 'rgba(212,160,83,0.15)'
    : isGreyAccent ? 'rgba(255,255,255,0.10)'
    : 'rgba(196,181,253,0.12)';
  const ringDuration = isCharging ? '0.5s' : '4.5s';
  const ringOpacity  = isCharging ? 0.95 : 0.55;
  // Ring thickness scales with button size so the conic segments stay
  // proportional across sm/md/lg.
  const ringInset = Math.max(2, Math.round(px * 0.06));

  // Final animation choice for the button itself — only run bubble when
  // we're ACTUALLY in phase 3 (not during the charge latch).
  const buttonAnimation = runBubble ? style.animation : 'none';

  return (
    <span
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: px, height: px }}
    >
      {showRing && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            // Conic-gradient creates 4 lightning-like arcs with transparent
            // gaps so it reads as "electricity arcing" rather than a solid
            // ring. mask-image carves out the centre so only the outer
            // band renders.
            background: `conic-gradient(from 0deg, ${ringFaint} 0deg, ${ringAccent} 20deg, ${ringFaint} 50deg, ${ringAccent} 110deg, ${ringFaint} 140deg, ${ringAccent} 200deg, ${ringFaint} 230deg, ${ringAccent} 290deg, ${ringFaint} 320deg)`,
            WebkitMask: `radial-gradient(circle, transparent calc(50% - ${ringInset + 1}px), black calc(50% - ${ringInset}px), black 50%, transparent calc(50% + 1px))`,
            mask:       `radial-gradient(circle, transparent calc(50% - ${ringInset + 1}px), black calc(50% - ${ringInset}px), black 50%, transparent calc(50% + 1px))`,
            opacity: ringOpacity,
            animation: `voyo-oye-ring-spin ${ringDuration} linear infinite`,
            // Opacity + duration changes use transitions so the idle→charge
            // handoff doesn't snap. 200ms is fast enough to feel immediate
            // on tap, slow enough to not flicker.
            transition: 'opacity 200ms ease, filter 200ms ease',
            filter: isCharging ? 'blur(0.4px) saturate(1.3)' : 'blur(0.6px)',
          }}
        />
      )}

      <button
        onClick={handleClick}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="relative flex items-center justify-center rounded-full backdrop-blur-md active:scale-95"
        style={{
          width: px,
          height: px,
          background: style.background,
          border: style.border,
          boxShadow: style.boxShadow,
          animation: buttonAnimation,
          // Explicit transition list — "transition-all" doesn't handle
          // gradient backgrounds cleanly, but border + shadow + color
          // transitions DO morph, giving phase 2 → phase 3 a smooth
          // handoff even though the gradient itself will snap.
          transition: 'background-color 280ms ease, border 280ms ease, box-shadow 280ms ease',
          // Outer halo only on faded states AND only when the rotating
          // ring isn't competing for the same real estate. Suppressed
          // during bubble phase (bubble owns the motion) and during
          // charge phase (ring owns it).
          outline: hasRing && !isCharging && !runBubble ? style.ring : 'none',
          outlineOffset: hasRing && !isCharging && !runBubble ? '2px' : '0',
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
    </span>
  );
});

OyeButton.displayName = 'OyeButton';
