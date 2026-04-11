/**
 * VoyoMoments - Control vs Surrender Navigation Feed
 *
 * UP = Control (deeper in same category, deterministic)
 * DOWN = Surrender (bleed into adjacent category, organic)
 * LEFT = Memory (retrace trail with fading precision)
 * RIGHT = Drift (explore somewhere new, weighted random)
 * Tabs = Hard shift (intentional dimension change)
 *
 * Hold = position overlay | Double-tap = OYE reaction
 * Double-tap + hold = Star panel (1 star = follow)
 */

import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Heart, Flame, MessageCircle, ExternalLink, Play, Volume2, VolumeX } from 'lucide-react';
import { useMoments, CategoryAxis, NavAction, CATEGORY_PRESETS } from '../../../hooks/useMoments';
import type { Moment } from '../../../services/momentsService';
import { AnimatedArtCard } from './AnimatedArtCard';
import { DynamicVignette } from './DynamicVignette';
import { devWarn } from '../../../utils/logger';

// ============================================
// CONSTANTS & HELPERS
// ============================================

const SWIPE_THRESHOLD = 50;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 300;
const STAR_HOLD_MS = 500; // hold after double-tap to open star panel

// Control = snappy, deterministic feel (UP, LEFT)
const SPRING_CONTROL = { type: 'spring' as const, stiffness: 400, damping: 35, mass: 0.8 };
// Surrender = floaty, organic feel (DOWN, RIGHT)
const SPRING_SURRENDER = { type: 'spring' as const, stiffness: 280, damping: 25, mass: 1.0 };

function getSpring(action: NavAction) {
  if (action === 'down' || action === 'right') return SPRING_SURRENDER;
  return SPRING_CONTROL;
}

// API base for R2 feed video streaming — Edge Worker (300+ locations)
const VOYO_API = import.meta.env.VITE_API_URL || 'https://voyo-edge.dash-webtv.workers.dev';

const css = (obj: Record<string, any>) => obj as React.CSSProperties;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type SlideDir = 'up' | 'down' | 'left' | 'right' | null;

function slideVariants(dir: SlideDir, isSurrender: boolean = false) {
  const axis = dir === 'up' || dir === 'down' ? 'y' : 'x';
  const sign = dir === 'up' || dir === 'left' ? 1 : dir === 'down' || dir === 'right' ? -1 : 0;
  const hScale = dir === 'left' || dir === 'right' ? 0.92 : 1;

  // Surrender directions get subtle rotation and scale variance
  const rotateIn = isSurrender ? (Math.random() - 0.5) * 3 : 0;
  const scaleIn = isSurrender ? 0.95 + Math.random() * 0.05 : hScale;

  return {
    initial: { [axis]: `${sign * 100}%`, opacity: 0.7, scale: scaleIn, rotate: rotateIn },
    animate: { [axis]: 0, opacity: 1, scale: 1, rotate: 0 },
    exit: { [axis]: `${-sign * 100}%`, opacity: 0.5, scale: hScale, rotate: -rotateIn },
  };
}

// ============================================
// COMPACT STYLES
// ============================================

const S = {
  container: css({ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000', overflow: 'hidden', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }),
  // Unified gradient surface from the very top through the compass arc.
  // Fades smoothly over 30% of the screen so logo + tabs + compass sit on
  // a single dark wash that blends into the video. Header opacity is
  // controlled by hasInteracted state so it glides out of the way after
  // the user engages with the first moment.
  topBar: css({
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
    paddingTop: 'env(safe-area-inset-top, 12px)',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.22) 70%, transparent 100%)',
    pointerEvents: 'auto',
    transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
  }),
  // Side shadow shapes — subtle vertical gradients on left and right edges
  // that frame the video. Soft inset-shadow effect without an actual shadow
  // (which would re-composite on every video frame). 24px wide, fades from
  // ~30% black at the very edge to transparent.
  sideShadowL: css({
    position: 'absolute', top: 0, bottom: 0, left: 0, width: 28, zIndex: 25,
    background: 'linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.18) 50%, transparent 100%)',
    pointerEvents: 'none',
  }),
  sideShadowR: css({
    position: 'absolute', top: 0, bottom: 0, right: 0, width: 28, zIndex: 25,
    background: 'linear-gradient(to left, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.18) 50%, transparent 100%)',
    pointerEvents: 'none',
  }),
  axisTabs: css({ display: 'flex', justifyContent: 'center', gap: 4, padding: '8px 16px 2px' }),
  compassArc: css({ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '4px 0 10px', overflow: 'hidden', minHeight: 44 }),
  card: css({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }),
  thumb: css({ position: 'absolute', inset: 0, objectFit: 'cover', width: '100%', height: '100%', display: 'block', margin: 0, padding: 0, borderRadius: 0 }),
  grad: css({ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.35) 40%, transparent 100%)', zIndex: 2, pointerEvents: 'none' }),
  // CREATOR BLOCK — single container positioned on the LEFT side, vertically
  // aligned with the middle of the right-side action bar. Stacks the orb +
  // name on top, with a compact glass bio card below. Bio is collapsed by
  // default (~2 lines with fade at bottom), tap to expand and scroll the rest.
  creatorBlock: css({ position: 'absolute', left: 18, bottom: 140, zIndex: 10, maxWidth: 'calc(62% - 30px)', display: 'flex', flexDirection: 'column', gap: 10, transition: 'opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1), transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)' }),
  creatorOrbWrap: css({ display: 'flex', alignItems: 'center', gap: 10 }),
  creatorOrb: css({ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(139,92,246,0.5), rgba(139,92,246,0.18))', border: '1.5px solid rgba(167,139,250,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', boxShadow: '0 6px 20px rgba(0,0,0,0.55), 0 0 14px rgba(139,92,246,0.25)', animation: 'voyo-creator-drift 6s ease-in-out infinite', flexShrink: 0 }),
  creatorOrbName: css({ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: 0.2, textShadow: '0 1px 4px rgba(0,0,0,0.7)' }),
  // BIO GLASS CARD — sits below the creator orb. Reuses the .glass-card
  // aesthetic with a tiny glossy top edge. Compact by default (~2 lines
  // visible with bottom fade), expanded on tap (full content scrollable).
  bioCard: css({
    background: 'rgba(20, 20, 30, 0.55)',
    backdropFilter: 'blur(20px) saturate(140%)',
    WebkitBackdropFilter: 'blur(20px) saturate(140%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: '10px 12px 8px',
    boxShadow: '0 8px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
  }),
  // Title — primary line in the glass card
  bioTitle: css({ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.35, marginBottom: 4, textShadow: '0 1px 3px rgba(0,0,0,0.5)' } as any),
  // Bio body — collapsed by default (~2 lines), expanded scrollable on tap
  bioBodyCollapsed: css({
    fontSize: 12,
    fontWeight: 400,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 1.5,
    maxHeight: 36, // ~2 lines
    overflow: 'hidden',
    position: 'relative',
  } as any),
  bioBodyExpanded: css({
    fontSize: 12,
    fontWeight: 400,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 1.5,
    maxHeight: 100,
    overflowY: 'auto',
    paddingRight: 4,
    position: 'relative',
  } as any),
  // Bottom fade overlay on the collapsed bio so the cut-off feels intentional
  bioFade: css({
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 18,
    background: 'linear-gradient(to top, rgba(20,20,30,0.95) 0%, transparent 100%)',
    pointerEvents: 'none',
  }),
  // Bio react row — small react button below the bio
  bioReactRow: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 8, marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }),
  bioReactBtn: css({ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)', fontSize: 11, fontWeight: 600, color: '#a78bfa', cursor: 'pointer', transition: 'all 0.2s ease', flexShrink: 0 }),
  track: css({ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 2 }),
  actBar: css({ position: 'absolute', right: 12, bottom: 160, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }),
  actBtn: css({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer' }),
  actLbl: css({ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 500 }),
  overlay: css({ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }),
  posCard: css({ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 20, padding: '28px 36px', textAlign: 'center', maxWidth: 300 }),
  posTitle: css({ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 }),
  posCats: css({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12, fontSize: 14, color: 'rgba(255,255,255,0.4)' }),
  posCur: css({ fontSize: 18, fontWeight: 700, color: '#a78bfa', padding: '4px 12px', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 8 }),
  posTime: css({ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 8 }),
  posHint: css({ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 16 }),
  loading: css({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(255,255,255,0.5)', fontSize: 14 }),
  spinner: css({ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#a78bfa' }),
  empty: css({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, textAlign: 'center' }),
  emptyH: css({ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }),
  emptyP: css({ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }),
  oyeF: css({ position: 'absolute', zIndex: 40, pointerEvents: 'none', fontSize: 28 }),
  volBadge: css({ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 20, background: 'rgba(0,0,0,0.6)', borderRadius: '50%', width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }),
};

const axisTab = (on: boolean): React.CSSProperties => ({
  padding: '4px 14px', borderRadius: 16, fontSize: 11, fontWeight: on ? 700 : 500,
  color: on ? '#fff' : 'rgba(255,255,255,0.45)',
  background: on ? 'rgba(168,85,247,0.2)' : 'transparent',
  backdropFilter: on ? 'blur(12px)' : 'none', WebkitBackdropFilter: on ? 'blur(12px)' : 'none',
  border: on ? '1px solid rgba(168,85,247,0.3)' : '1px solid transparent',
  cursor: 'pointer', transition: 'all 0.25s ease', letterSpacing: 0.8, textTransform: 'uppercase',
});

// ============================================
// COMPASS ARC — Spatial Category Navigation
// ============================================
// The arc shows 5-7 categories simultaneously with perspective depth:
// Center = current (large, bright, purple glow)
// Adjacent = smaller, dimmer, y-offset creates curve
// Far = smallest, faintest, at the horizon
//
// Rotates with content swipes, tappable for hard jumps
// Multi-select activates MIX mode (music ducks, moments from all selected)

interface CompassArcProps {
  categories: string[];
  currentIndex: number;
  displayName: (key: string) => string;
  onJumpTo: (index: number) => void;
  selectedCategories: Set<number>;
  onToggleSelect: (index: number) => void;
  navAction: NavAction;
}

const CompassArc = memo(({ categories, currentIndex, displayName, onJumpTo, selectedCategories, onToggleSelect, navAction }: CompassArcProps) => {
  // Show 7 categories: current + 3 on each side (wrapping)
  const VISIBLE = 7;
  const HALF = Math.floor(VISIBLE / 2);

  const visibleItems = [];
  for (let offset = -HALF; offset <= HALF; offset++) {
    const idx = ((currentIndex + offset) % categories.length + categories.length) % categories.length;
    visibleItems.push({ index: idx, offset, category: categories[idx] });
  }

  // Depth mapping: center=0 → edges=3
  // Creates arc shape via y-offset + scale + opacity
  const getItemStyle = (offset: number, isSelected: boolean): React.CSSProperties => {
    const absOffset = Math.abs(offset);
    const scale = 1 - absOffset * 0.12; // 1.0 → 0.88 → 0.76 → 0.64
    const opacity = absOffset === 0 ? 1 : absOffset === 1 ? 0.6 : absOffset === 2 ? 0.35 : 0.18;
    const yShift = absOffset * absOffset * 2.5; // quadratic: 0, 2.5, 10, 22.5 — creates arc
    const blur = absOffset <= 1 ? 0 : absOffset * 0.5;
    const fontSize = absOffset === 0 ? 14 : absOffset === 1 ? 12 : 10;
    const letterSpacing = absOffset === 0 ? 2 : absOffset === 1 ? 1 : 0.5;

    return {
      transform: `scale(${scale}) translateY(${yShift}px)`,
      opacity,
      filter: blur > 0 ? `blur(${blur}px)` : 'none',
      fontSize,
      fontWeight: absOffset === 0 ? 800 : absOffset === 1 ? 600 : 400,
      color: isSelected ? '#A855F7' : absOffset === 0 ? '#fff' : 'rgba(255,255,255,0.8)',
      letterSpacing,
      textTransform: 'uppercase' as const,
      padding: absOffset === 0 ? '5px 16px' : absOffset === 1 ? '3px 10px' : '2px 6px',
      borderRadius: 12,
      cursor: 'pointer',
      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      whiteSpace: 'nowrap' as const,
      flexShrink: 0,
      background: isSelected
        ? 'rgba(168,85,247,0.2)'
        : absOffset === 0
          ? 'rgba(255,255,255,0.08)'
          : 'transparent',
      border: isSelected
        ? '1px solid rgba(168,85,247,0.4)'
        : absOffset === 0
          ? '1px solid rgba(255,255,255,0.12)'
          : '1px solid transparent',
      boxShadow: absOffset === 0 && !isSelected
        ? '0 0 20px rgba(168,85,247,0.15), 0 0 40px rgba(168,85,247,0.05)'
        : isSelected
          ? '0 0 16px rgba(168,85,247,0.3)'
          : 'none',
    };
  };

  // Determine the animation direction for the arc rotation
  const direction = navAction === 'left' || navAction === 'right' ? navAction : null;

  return (
    <div style={S.compassArc}>
      <>
        {visibleItems.map(({ index, offset, category }) => {
          const isSelected = selectedCategories.has(index);
          return (
            <div
              key={`${category}-${index}`}
              style={{
                ...getItemStyle(offset, isSelected),
                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (offset === 0) {
                  onToggleSelect(index);
                } else {
                  onJumpTo(index);
                }
              }}
            >
              {displayName(category)}
            </div>
          );
        })}
      </>

      {/* MIX indicator when multi-select active */}
      {selectedCategories.size > 1 && (
        <div
          className="animate-[voyo-fade-in_0.2s_ease]"
          style={{
            position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)',
            fontSize: 8, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase',
            color: '#A855F7', opacity: 0.7,
          }}
        >
          MIX
        </div>
      )}
    </div>
  );
});
CompassArc.displayName = 'CompassArc';

// ============================================
// NEXT MOMENT PREVIEW — Corner fade ghost
// ============================================

interface NextPreviewProps {
  moment: Moment | null;
}

const NextMomentPreview = memo(({ moment }: NextPreviewProps) => {
  if (!moment || !moment.thumbnail_url) return null;

  return (
    <div
      className="animate-[voyo-fade-in_0.6s_ease]"
      style={{
        position: 'absolute',
        bottom: 120,
        right: 60,
        width: 56,
        height: 72,
        borderRadius: 10,
        overflow: 'hidden',
        opacity: 0.25,
        filter: 'blur(2px)',
        zIndex: 6,
        pointerEvents: 'none',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <img
        src={moment.thumbnail_url}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        loading="lazy"
        draggable={false}
      />
      {/* Fade edges */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 100%)',
      }} />
    </div>
  );
});
NextMomentPreview.displayName = 'NextMomentPreview';

const actIcon = (on: boolean): React.CSSProperties => ({
  width: 40, height: 40, borderRadius: '50%',
  background: on ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.1)',
  backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease',
});

// ============================================
// OYE FLOATING HEARTS
// ============================================

interface OyeFloat { id: string; x: number; y: number }

const OyeAnimations = memo(({ floats }: { floats: OyeFloat[] }) => (
  <>
    {floats.map(f => (
      <div
        key={f.id}
        style={{ ...S.oyeF, left: f.x, top: f.y, animation: 'voyo-float-up 2s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
      >
        <Heart size={28} style={{ color: '#a78bfa', fill: '#a78bfa', filter: 'drop-shadow(0 0 8px rgba(167,139,250,0.6))' }} />
      </div>
    ))}
  </>
));
OyeAnimations.displayName = 'OyeAnimations';

// ============================================
// MOMENT CARD
// ============================================

type MomentFormat = 'r2_video' | 'audio_cover' | 'thumbnail';

interface MomentCardProps {
  moment: Moment;
  isOyed: boolean;
  onOye: () => void;
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onPlayTrack?: () => void;
  onArtistTap?: (artistName: string) => void;
  widgetsVisible: boolean;
}

const MomentCard = memo(({ moment, isOyed, onOye, isActive, isMuted, onToggleMute, onPlayTrack, onArtistTap, widgetsVisible }: MomentCardProps) => {
  // Bio expand state — collapsed by default (~2 lines visible with bottom fade),
  // tap to expand and scroll the rest of the description.
  const [bioExpanded, setBioExpanded] = useState(false);
  const initial = (moment.creator_name || moment.creator_username || '?')[0].toUpperCase();
  const creator = moment.creator_name || moment.creator_username || 'Unknown';
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoAvailable, setVideoAvailable] = useState<boolean | null>(null);
  const [videoError, setVideoError] = useState(false);

  const videoUrl = `${VOYO_API}/r2/feed/${moment.source_id}`;

  // Check if video exists in R2 on mount
  useEffect(() => {
    let cancelled = false;
    setVideoAvailable(null);
    setVideoError(false);

    fetch(`${videoUrl}/check`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setVideoAvailable(data.exists === true);
      })
      .catch(() => {
        if (!cancelled) setVideoAvailable(false);
      });

    return () => { cancelled = true; };
  }, [moment.source_id, videoUrl]);

  // Resolve presentation format based on priority:
  // 1. R2 video (if available and no error)
  // 2. Audio + cover composition (if linked to a track with parent_track_id)
  // 3. Thumbnail static fallback
  const format: MomentFormat = (() => {
    if (videoAvailable === true && !videoError) return 'r2_video';
    // While R2 check is in-flight (null), don't commit to audio_cover yet —
    // show thumbnail until we know for sure there's no video
    if (videoAvailable === false && moment.parent_track_id) return 'audio_cover';
    return 'thumbnail';
  })();

  // Auto-play/pause based on active state (only for r2_video format)
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || format !== 'r2_video') return;

    if (isActive) {
      vid.currentTime = 0;
      vid.play().catch(() => {
        // Autoplay blocked - keep showing thumbnail
      });
    } else {
      vid.pause();
    }
  }, [isActive, format]);

  // Sync muted state
  useEffect(() => {
    const vid = videoRef.current;
    if (vid) vid.muted = isMuted;
  }, [isMuted]);

  const handleVideoError = useCallback(() => {
    setVideoError(true);
    devWarn(`[MomentCard] Video load failed for ${moment.source_id}, falling back`);
  }, [moment.source_id]);

  return (
    <div style={S.card}>
      {/* === FORMAT: R2 VIDEO === */}
      {format === 'r2_video' && (
        <>
          {/* Thumbnail as background fallback behind video */}
          {moment.thumbnail_url && <img src={moment.thumbnail_url} alt="" style={S.thumb} loading="eager" draggable={false} />}
          <video
            ref={videoRef}
            src={videoUrl}
            className="absolute inset-0 w-full h-full object-cover"
            muted={isMuted}
            loop
            playsInline
            preload={isActive ? 'metadata' : 'none'}
            onError={handleVideoError}
          />
        </>
      )}

      {/* === FORMAT: AUDIO + COVER COMPOSITION === */}
      {format === 'audio_cover' && (
        <>
          <AnimatedArtCard
            trackId={moment.parent_track_id!}
            thumbnail={moment.thumbnail_url || ''}
            isActive={isActive}
            isPlaying={isActive}
            displayMode="fullscreen"
          />
          <DynamicVignette
            isActive={isActive}
            isPlaying={isActive}
            intensity="medium"
            pulseEnabled={true}
          />
        </>
      )}

      {/* === FORMAT: THUMBNAIL STATIC === */}
      {format === 'thumbnail' && (
        <>
          {moment.thumbnail_url && <img src={moment.thumbnail_url} alt="" style={S.thumb} loading="eager" draggable={false} />}
        </>
      )}

      <div style={S.grad} />

      <div style={S.actBar}>
        <div style={S.actBtn} onClick={onOye}>
          <div style={actIcon(isOyed)}>
            <Heart size={20} style={{ color: isOyed ? '#a78bfa' : '#fff', fill: isOyed ? '#a78bfa' : 'none', transition: 'all 0.2s ease' }} />
          </div>
          <span style={{ ...S.actLbl, color: isOyed ? '#a78bfa' : 'rgba(255,255,255,0.6)' }}>OYE</span>
        </div>
        <div style={S.actBtn}>
          <div style={actIcon(false)}><Flame size={20} style={{ color: '#fff' }} /></div>
          <span style={S.actLbl}>{formatCount(moment.voyo_reactions || 0)}</span>
        </div>
        <div style={S.actBtn}>
          <div style={actIcon(false)}><MessageCircle size={20} style={{ color: '#fff' }} /></div>
          <span style={S.actLbl}>{formatCount(moment.comment_count || 0)}</span>
        </div>
        <div style={S.actBtn}>
          <div style={actIcon(false)}><ExternalLink size={18} style={{ color: '#fff' }} /></div>
          <span style={S.actLbl}>Share</span>
        </div>
      </div>

      {/* CREATOR BLOCK — single positioned container, stacked layout:
          orb + name on top, glass bio card below. Bio is collapsed by
          default (~2 lines with bottom fade), tap to expand and scroll. */}
      <div
        style={{
          ...S.creatorBlock,
          opacity: widgetsVisible ? 1 : 0,
          transform: widgetsVisible ? 'translateY(0)' : 'translateY(8px)',
          pointerEvents: widgetsVisible ? 'auto' : 'none',
        }}
      >
        <div style={S.creatorOrbWrap}>
          <div style={S.creatorOrb}>{initial}</div>
          <span style={S.creatorOrbName}>@{creator}</span>
        </div>

        {(moment.title || moment.description) && (
          <div
            style={S.bioCard}
            onClick={(e) => { e.stopPropagation(); setBioExpanded(p => !p); }}
          >
            {/* Glossy top highlight */}
            <div style={{
              position: 'absolute', top: 0, left: 12, right: 12, height: 1,
              background: 'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)',
              pointerEvents: 'none',
            }} />
            <div style={S.bioTitle}>{moment.title}</div>
            {moment.description && (
              <div
                style={bioExpanded ? S.bioBodyExpanded : S.bioBodyCollapsed}
                className="scrollbar-hide"
              >
                {moment.description}
                {!bioExpanded && <div style={S.bioFade} />}
              </div>
            )}
            <div style={S.bioReactRow}>
              {moment.parent_track_title && (
                <div
                  style={{ ...S.track, cursor: onPlayTrack ? 'pointer' : 'default', flex: 1, minWidth: 0 }}
                  onClick={(e) => { if (onPlayTrack) { e.stopPropagation(); onPlayTrack(); } }}
                >
                  <Play size={10} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span
                      onClick={(e) => {
                        if (onArtistTap && moment.parent_track_artist) {
                          e.stopPropagation();
                          onArtistTap(moment.parent_track_artist);
                        }
                      }}
                    >{moment.parent_track_artist}</span> · {moment.parent_track_title}
                  </span>
                </div>
              )}
              <button
                style={S.bioReactBtn}
                onClick={(e) => { e.stopPropagation(); onOye(); }}
              >
                <Heart size={11} style={{ color: '#a78bfa', fill: isOyed ? '#a78bfa' : 'none' }} />
                <span>{isOyed ? 'OYÉD' : 'OYÉ'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
MomentCard.displayName = 'MomentCard';

// ============================================
// POSITION OVERLAY
// ============================================

const PositionOverlay = memo(({ position, categories, totalInCategory, onClose, displayName }: {
  position: { categoryIndex: number; timeIndex: number };
  categories: string[];
  totalInCategory: number;
  onClose: () => void;
  displayName: (key: string) => string;
}) => {
  const cur = categories[position.categoryIndex];
  const prev = categories[(position.categoryIndex - 1 + categories.length) % categories.length];
  const next = categories[(position.categoryIndex + 1) % categories.length];

  return (
    <div style={S.overlay} className="animate-[voyo-fade-in_0.2s_ease]" onClick={onClose}>
      <div style={S.posCard} className="animate-[voyo-scale-in_0.2s_ease_0.05s_both]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div style={S.posTitle}>YOUR POSITION</div>
        <div style={S.posCats}>
          <span>{displayName(prev)}</span>
          <span style={{ opacity: 0.4 }}>{'>'}</span>
          <span style={S.posCur}>{displayName(cur)}</span>
          <span style={{ opacity: 0.4 }}>{'>'}</span>
          <span>{displayName(next)}</span>
        </div>
        <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.3)', margin: '4px 0' }}>|</div>
        <div style={S.posTime}>{totalInCategory > 0 ? `${position.timeIndex + 1} of ${totalInCategory} moments` : 'No moments yet'}</div>
        <div style={S.posHint}>Tap anywhere to close</div>
      </div>
    </div>
  );
});
PositionOverlay.displayName = 'PositionOverlay';

// ============================================
// STAR PANEL (Double-tap-hold → 1-5 stars)
// ============================================

interface StarPanelProps {
  creator: string;
  onGiveStar: (stars: number) => void;
  onClose: () => void;
}

const StarPanel = memo(({ creator, onGiveStar, onClose }: StarPanelProps) => {
  const initial = (creator || '?')[0].toUpperCase();
  return (
    <div
      style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      className="animate-[voyo-fade-in_0.2s_ease]"
      onClick={onClose}
    >
      <div
        style={{ background: 'linear-gradient(to top, rgba(10,10,15,0.98), rgba(26,26,46,0.95))', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '24px 20px 40px', textAlign: 'center' }}
        className="animate-[voyo-slide-up_0.3s_ease]"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', fontSize: 16, fontWeight: 700, color: '#fff' }}>{initial}</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>@{creator}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>Give a star to follow</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              style={{
                width: 48, height: 48, borderRadius: '50%',
                background: n === 1 ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.08)',
                border: n === 1 ? '2px solid rgba(167,139,250,0.4)' : '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, cursor: 'pointer', color: '#a78bfa',
              }}
              onClick={() => onGiveStar(n)}
            >
              {'★'.repeat(Math.min(n, 3))}{n > 3 ? <span style={{ fontSize: 10, color: 'rgba(167,139,250,0.7)' }}>+{n - 3}</span> : null}
            </button>
          ))}
        </div>
        {/* Hint: 1 star = follow */}
        <div style={{ fontSize: 10, color: 'rgba(167,139,250,0.5)', marginTop: 12 }}>1 star = follow this creator</div>
      </div>
    </div>
  );
});
StarPanel.displayName = 'StarPanel';

// Star Confirmation (first time per creator)
interface StarConfirmProps {
  creator: string;
  stars: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const StarConfirmation = memo(({ creator, stars, onConfirm, onCancel }: StarConfirmProps) => (
  <div
    style={{ position: 'absolute', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)' }}
    className="animate-[voyo-fade-in_0.2s_ease]"
    onClick={onConfirm}
  >
    <div
      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 20, padding: '28px 36px', textAlign: 'center', maxWidth: 280 }}
      className="animate-[voyo-scale-in_0.2s_ease]"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      <div style={{ fontSize: 28, marginBottom: 12 }}>{'★'.repeat(stars)}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
        Send {stars === 1 ? 'a star' : `${stars} stars`} to @{creator}?
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>
        {stars === 1 ? 'This will follow them' : 'Stars show your appreciation'}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button
          style={{ padding: '10px 24px', borderRadius: 20, background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)', color: '#000', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
          onClick={onConfirm}
        >
          Send ★
        </button>
        <button
          style={{ padding: '10px 24px', borderRadius: 20, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontWeight: 500, fontSize: 14, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); onCancel(); }}
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
));
StarConfirmation.displayName = 'StarConfirmation';

// ============================================
// MAIN COMPONENT
// ============================================

export interface MomentTrackInfo {
  id: string;
  title: string;
  artist: string;
}

export interface VoyoMomentsProps {
  onPlayFullTrack?: (track: MomentTrackInfo) => void;
  onArtistTap?: (artistName: string) => void;
}

export const VoyoMoments: React.FC<VoyoMomentsProps> = ({ onPlayFullTrack, onArtistTap }) => {
  const {
    currentMoment: hookCurrentMoment, position, categoryAxis, categories, currentCategory, displayName,
    goUp, goDown, goLeft, goRight, setCategoryAxis, jumpToCategory,
    loading, totalInCategory, navAction, recordPlay, recordOye, recordStar,
    moments, fetchMomentsForCategory, cacheKey,
  } = useMoments();

  const [showOverlay, setShowOverlay] = useState(false);
  const [oyedMoments, setOyedMoments] = useState<Set<string>>(new Set());
  const [oyeFloats, setOyeFloats] = useState<OyeFloat[]>([]);
  const [slideDir, setSlideDir] = useState<SlideDir>(null);
  const [mKey, setMKey] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [showVol, setShowVol] = useState(false);
  const [showStarPanel, setShowStarPanel] = useState(false);
  const [confirmedCreators, setConfirmedCreators] = useState<Set<string>>(new Set());
  const [pendingStar, setPendingStar] = useState<{ momentId: string; creator: string; stars: number } | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(new Set());
  const [mixIndex, setMixIndex] = useState(0);
  // Header / widget glide-out state. Three phases:
  //   'idle'        — just landed, header + widgets visible
  //   'transition'  — first scroll fired, gold word reveals (1.4s), header
  //                   stays visible during this phase as the "moments mode"
  //                   transition cue
  //   'immersive'   — header faded, only video visible. Bio card and creator
  //                   orb auto-fade after 3s of inactivity. Tap restores.
  const [uiPhase, setUiPhase] = useState<'idle' | 'transition' | 'immersive'>('idle');
  // 3-second widget visibility timer (only active in 'immersive' phase)
  const [widgetsVisible, setWidgetsVisible] = useState(true);
  const widgetFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger the transition reveal on first scroll, then enter immersive mode.
  const startTransition = useCallback(() => {
    if (uiPhase !== 'idle') return;
    setUiPhase('transition');
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      setUiPhase('immersive');
    }, 1400);
  }, [uiPhase]);

  // Restart the 3-second widget visibility timer (called on tap)
  const pingWidgets = useCallback(() => {
    setWidgetsVisible(true);
    if (widgetFadeTimer.current) clearTimeout(widgetFadeTimer.current);
    widgetFadeTimer.current = setTimeout(() => setWidgetsVisible(false), 3000);
  }, []);

  // Auto-fade widgets on entering immersive phase, and on every new moment
  useEffect(() => {
    if (uiPhase === 'immersive') {
      pingWidgets();
    }
    return () => {
      if (widgetFadeTimer.current) clearTimeout(widgetFadeTimer.current);
    };
  }, [uiPhase, pingWidgets]);

  // Restart the fade timer whenever the moment changes (user gets 3s to read
  // the new bio, then it fades for immersion).
  useEffect(() => {
    if (uiPhase === 'immersive') pingWidgets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mKey]);

  // Cleanup transition timer on unmount
  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  // Backward-compat: code below still references hasInteracted
  const hasInteracted = uiPhase === 'immersive';

  // ============================================
  // MIX MODE — multi-category blended feed
  // ============================================

  const isMixMode = selectedCategories.size > 1;

  // Fetch moments for all selected categories when in MIX mode
  useEffect(() => {
    if (!isMixMode) return;
    const cats = CATEGORY_PRESETS[categoryAxis];
    selectedCategories.forEach(idx => {
      const cat = cats[idx];
      if (cat) fetchMomentsForCategory(categoryAxis, cat);
    });
  }, [isMixMode, selectedCategories, categoryAxis, fetchMomentsForCategory]);

  // Build the mixed moments feed: merge from all selected categories, interleave, dedup
  const mixedMoments = React.useMemo(() => {
    if (!isMixMode) return [];
    const cats = CATEGORY_PRESETS[categoryAxis];
    const buckets: Moment[][] = [];
    selectedCategories.forEach(idx => {
      const cat = cats[idx];
      if (!cat) return;
      const key = cacheKey(categoryAxis, cat);
      const catMoments = moments.get(key) || [];
      if (catMoments.length > 0) buckets.push([...catMoments]);
    });
    if (buckets.length === 0) return [];

    // Round-robin interleave for fair representation, then dedup by id
    const interleaved: Moment[] = [];
    const seen = new Set<string>();
    const maxLen = Math.max(...buckets.map(b => b.length));
    for (let i = 0; i < maxLen; i++) {
      for (const bucket of buckets) {
        if (i < bucket.length && !seen.has(bucket[i].id)) {
          seen.add(bucket[i].id);
          interleaved.push(bucket[i]);
        }
      }
    }
    return interleaved;
  }, [isMixMode, selectedCategories, categoryAxis, moments, cacheKey]);

  // Reset mix index when mix changes
  useEffect(() => {
    setMixIndex(0);
  }, [isMixMode, selectedCategories.size]);

  // Derive current moment: MIX mode uses mixedMoments, otherwise hook's single-category
  const currentMoment = isMixMode
    ? (mixedMoments[mixIndex] || null)
    : hookCurrentMoment;

  const containerRef = useRef<HTMLDivElement>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const swiping = useRef(false);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Record play when moment changes
  useEffect(() => { if (currentMoment) recordPlay(currentMoment.id); }, [currentMoment?.id, recordPlay]);

  // Navigate with animation direction
  const nav = useCallback((dir: SlideDir, fn: () => void) => {
    setSlideDir(dir);
    setMKey(p => p + 1);
    fn();
  }, []);

  // MIX mode navigation wrappers — override UP/DOWN to step through mixed feed
  const mixGoUp = useCallback((velocity?: number) => {
    if (isMixMode) {
      const skip = velocity && velocity > 1.5 ? Math.min(Math.floor(velocity), 3) : 1;
      setMixIndex(prev => Math.min(prev + skip, mixedMoments.length - 1));
    } else {
      goUp(velocity);
    }
  }, [isMixMode, mixedMoments.length, goUp]);

  const mixGoDown = useCallback((velocity?: number) => {
    if (isMixMode) {
      const skip = velocity && velocity > 1.5 ? Math.min(Math.floor(velocity), 3) : 1;
      setMixIndex(prev => Math.max(prev - skip, 0));
    } else {
      goDown(velocity);
    }
  }, [isMixMode, goDown]);

  // ---- TOUCH HANDLERS ----

  const onTS = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    swiping.current = false;

    // Check if this is a second tap (potential double-tap-hold for stars)
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS && currentMoment) {
      // Second tap detected — start star hold timer
      starHoldTimer.current = setTimeout(() => {
        if (!swiping.current) {
          const creator = currentMoment.creator_username || currentMoment.creator_name || '';
          if (creator) {
            setShowStarPanel(true);
          }
        }
      }, STAR_HOLD_MS);
    }

    lpTimer.current = setTimeout(() => { if (!swiping.current) setShowOverlay(true); }, LONG_PRESS_MS);
  }, [currentMoment]);

  const onTM = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - touchStart.current.x) > 10 || Math.abs(t.clientY - touchStart.current.y) > 10) {
      swiping.current = true;
      if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
      if (starHoldTimer.current) { clearTimeout(starHoldTimer.current); starHoldTimer.current = null; }
    }
  }, []);

  const handleOye = useCallback((momentId: string, x: number, y: number) => {
    // RULE: once OYÉd, you can't un-OYÉ. Idempotent — repeated calls just
    // re-fire the float animation (like double-tapping a TikTok already-liked
    // post: visual hearts fly, but the like state stays true).
    setOyedMoments(p => {
      if (p.has(momentId)) return p; // already OYÉd, no state change
      const n = new Set(p);
      n.add(momentId);
      return n;
    });
    const nf: OyeFloat[] = Array.from({ length: 5 }, (_, i) => ({ id: `${Date.now()}-${i}`, x: x - 14 + (Math.random() - 0.5) * 40, y: y - 14 }));
    setOyeFloats(p => [...p, ...nf]);
    setTimeout(() => setOyeFloats(p => p.filter(f => !nf.find(n => n.id === f.id))), 2200);
    recordOye(momentId);
  }, [recordOye]);

  const showVolBadge = useCallback(() => {
    setIsMuted(p => !p);
    setShowVol(true);
    if (volTimer.current) clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => setShowVol(false), 800);
  }, []);

  const onTE = useCallback((e: React.TouchEvent) => {
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
    if (starHoldTimer.current) { clearTimeout(starHoldTimer.current); starHoldTimer.current = null; }
    if (showOverlay) { setShowOverlay(false); touchStart.current = null; return; }
    if (showStarPanel) { touchStart.current = null; return; }
    if (!touchStart.current) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    const duration = Date.now() - touchStart.current.time;
    touchStart.current = null;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_THRESHOLD) {
      // Calculate velocity (px/ms)
      const velocity = distance / Math.max(duration, 1);
      // First swipe — fire the transition reveal (gold word + header fade chain)
      startTransition();

      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
          nav('left', () => goRight(velocity));
        } else {
          nav('right', () => goLeft(velocity));
        }
      } else {
        if (dy < 0) {
          nav('up', () => mixGoUp(velocity));
        } else {
          nav('down', () => mixGoDown(velocity));
        }
      }
      return;
    }

    // Single tap = ping widgets back to visible (3s timer restart).
    // Double-tap = OYÉ (star/super-react). Once a user has OYÉd a moment,
    // it can't be un-OYÉd — like Dash's rule: you can't unlike a post.
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      if (tapTimer.current) { clearTimeout(tapTimer.current); tapTimer.current = null; }
      // Double-tap detected — fire OYÉ immediately
      if (currentMoment) handleOye(currentMoment.id, t.clientX, t.clientY);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
      tapTimer.current = setTimeout(() => {
        // Single tap action: bring widgets back into view + restart fade timer
        pingWidgets();
        // Mute toggle is now a side-effect of single tap (preserved behavior)
        showVolBadge();
        lastTap.current = 0;
      }, DOUBLE_TAP_MS);
    }
  }, [showOverlay, showStarPanel, currentMoment, mixGoUp, mixGoDown, goLeft, goRight, nav, handleOye, showVolBadge, pingWidgets, startTransition]);

  // ---- KEYBOARD (desktop) ----

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp': e.preventDefault(); nav('up', mixGoUp); break;
        case 'ArrowDown': e.preventDefault(); nav('down', mixGoDown); break;
        case 'ArrowLeft': e.preventDefault(); nav('right', goLeft); break;
        case 'ArrowRight': e.preventDefault(); nav('left', goRight); break;
        case ' ': e.preventDefault(); showVolBadge(); break;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mixGoUp, mixGoDown, goLeft, goRight, nav, showVolBadge]);

  // Cleanup
  useEffect(() => () => {
    if (lpTimer.current) clearTimeout(lpTimer.current);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (volTimer.current) clearTimeout(volTimer.current);
    if (starHoldTimer.current) clearTimeout(starHoldTimer.current);
  }, []);

  const isSurrender = navAction === 'down' || navAction === 'right';
  const sv = slideVariants(slideDir, isSurrender);
  const spring = getSpring(navAction);
  const isOyed = currentMoment ? oyedMoments.has(currentMoment.id) : false;

  const handleOyeBtn = useCallback(() => {
    if (!currentMoment || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    handleOye(currentMoment.id, r.width / 2, r.height / 2);
  }, [currentMoment, handleOye]);

  // Star giving flow
  const handleGiveStar = useCallback((stars: number) => {
    if (!currentMoment) return;
    const creator = currentMoment.creator_username || currentMoment.creator_name || '';
    if (!creator) return;

    // First time per creator: show confirmation
    if (!confirmedCreators.has(creator)) {
      setPendingStar({ momentId: currentMoment.id, creator, stars });
      setShowStarPanel(false);
      return;
    }

    // Already confirmed: send immediately
    recordStar(currentMoment.id, creator, stars);
    setShowStarPanel(false);
  }, [currentMoment, confirmedCreators, recordStar]);

  const handleConfirmStar = useCallback(() => {
    if (!pendingStar) return;
    recordStar(pendingStar.momentId, pendingStar.creator, pendingStar.stars);
    setConfirmedCreators(prev => { const n = new Set(prev); n.add(pendingStar.creator); return n; });
    setPendingStar(null);
  }, [pendingStar, recordStar]);

  const handleCancelStar = useCallback(() => {
    setPendingStar(null);
  }, []);

  // Compass Arc handlers
  const handleCompassJump = useCallback((index: number) => {
    setSlideDir(index > position.categoryIndex ? 'left' : 'right');
    setMKey(p => p + 1);
    jumpToCategory(index);
  }, [position.categoryIndex, jumpToCategory]);

  const handleCompassToggle = useCallback((index: number) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Clear selected categories when axis changes
  useEffect(() => {
    setSelectedCategories(new Set());
  }, [categoryAxis]);

  // Get next moment for preview (next in time axis — or next in mix feed)
  const momentsKey = `${categoryAxis}::${currentCategory}`;
  const categoryMoments = moments.get(momentsKey) || [];
  const nextMoment = isMixMode
    ? (mixedMoments[mixIndex + 1] || null)
    : (categoryMoments[position.timeIndex + 1] || null);

  // Effective total for display
  const effectiveTotalInCategory = isMixMode ? mixedMoments.length : totalInCategory;

  return (
    <div ref={containerRef} style={S.container} onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE}>
      {/* SIDE SHADOWS — frame the video with subtle vertical gradients */}
      <div style={S.sideShadowL} />
      <div style={S.sideShadowR} />

      {/* TOP BAR — unified gradient surface, glides out after first interaction.
          Tap the gradient area itself to bring it back if it's hidden. */}
      <div
        style={{
          ...S.topBar,
          opacity: hasInteracted ? 0 : 1,
          transform: hasInteracted ? 'translateY(-12px)' : 'translateY(0)',
          pointerEvents: hasInteracted ? 'none' : 'auto',
        }}
      >
        <div style={S.axisTabs}>
          {(['countries', 'vibes', 'genres'] as CategoryAxis[]).map(a => (
            <div key={a} style={axisTab(categoryAxis === a)} onClick={e => { e.stopPropagation(); setCategoryAxis(a); }}>
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </div>
          ))}
        </div>
        <CompassArc
          categories={categories}
          currentIndex={position.categoryIndex}
          displayName={displayName}
          onJumpTo={handleCompassJump}
          selectedCategories={selectedCategories}
          onToggleSelect={handleCompassToggle}
          navAction={navAction}
        />
      </div>

      {/* Tap-to-show-header strip — invisible 28px hot zone at the very top
          that re-reveals the header when tapped. */}
      {hasInteracted && (
        <div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 'calc(env(safe-area-inset-top, 12px) + 28px)',
            zIndex: 31, pointerEvents: 'auto',
          }}
          onClick={(e) => { e.stopPropagation(); setUiPhase('idle'); pingWidgets(); }}
        />
      )}

      {/* GOLD TRANSITION WORD — fires on first scroll, lives 1.4s, then fades.
          Hand-feel script (Italianno) in DASH gold/bronze. Centered above
          the compass. The cue that says "you're entering Moments". */}
      {uiPhase === 'transition' && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 12px) + 88px)',
            left: 0, right: 0, zIndex: 32,
            textAlign: 'center',
            pointerEvents: 'none',
            fontFamily: "'Italianno', cursive",
            fontSize: 56,
            lineHeight: 1,
            color: '#D4A053',
            textShadow: '0 2px 24px rgba(212,160,83,0.45), 0 1px 4px rgba(0,0,0,0.6)',
            letterSpacing: '0.04em',
            animation: 'voyo-moment-word-in 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          }}
        >
          moments
        </div>
      )}

      {/* MIX MODE BADGE -- visible when multi-category blending is active */}
      {isMixMode && (
        <div
          className="animate-[voyo-fade-in_0.25s_ease]"
          style={{
            position: 'absolute',
            top: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 35,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            borderRadius: 20,
            background: 'rgba(168,85,247,0.15)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(168,85,247,0.3)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: '#A855F7' }}>
            MIX
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
            {selectedCategories.size} categories
          </span>
          <span style={{ fontSize: 10, color: 'rgba(168,85,247,0.6)' }}>
            {mixedMoments.length > 0 ? `${mixIndex + 1}/${mixedMoments.length}` : '...'}
          </span>
        </div>
      )}

      {/* MOMENT CARD */}
      {loading && !currentMoment ? (
        <div key="load" style={S.loading} className="animate-[voyo-fade-in_0.2s_ease]">
          <div style={S.spinner} className="animate-spin" />
          <span>Loading moments...</span>
        </div>
      ) : currentMoment ? (
        <div key={`m-${currentMoment.id}-${mKey}`} style={{ position: 'absolute', inset: 0, transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          <MomentCard
            moment={currentMoment}
            isOyed={isOyed}
            onOye={handleOyeBtn}
            isActive={true}
            isMuted={isMuted}
            onToggleMute={showVolBadge}
            onPlayTrack={currentMoment.parent_track_id && onPlayFullTrack ? () => onPlayFullTrack({
              id: currentMoment.parent_track_id!,
              title: currentMoment.parent_track_title || 'Unknown',
              artist: currentMoment.parent_track_artist || 'Unknown Artist',
            }) : undefined}
            onArtistTap={onArtistTap}
            widgetsVisible={widgetsVisible}
          />
        </div>
      ) : (
        <div key="empty" style={S.empty} className="animate-[voyo-fade-in_0.2s_ease]">
          <div style={S.emptyH}>
            {isMixMode ? 'No moments in MIX' : `No moments in ${displayName(currentCategory)}`}
          </div>
          <div style={S.emptyP}>
            {isMixMode
              ? 'Selected categories have no moments yet. Try adding more categories.'
              : `Swipe left or right to explore other ${categoryAxis}.\nMoments will appear here as creators share them.`
            }
          </div>
        </div>
      )}

      {/* Next moment ghost preview */}
      {nextMoment && !showOverlay && !showStarPanel && (
        <NextMomentPreview moment={nextMoment} />
      )}

      <OyeAnimations floats={oyeFloats} />

      {showVol && (
        <div style={S.volBadge} className="animate-[voyo-scale-in_0.15s_ease]">
          {isMuted ? <VolumeX size={24} style={{ color: '#fff' }} /> : <Volume2 size={24} style={{ color: '#fff' }} />}
        </div>
      )}

      {showOverlay && (
        <PositionOverlay position={position} categories={categories} totalInCategory={effectiveTotalInCategory} onClose={() => setShowOverlay(false)} displayName={displayName} />
      )}

      {/* STAR PANEL */}
      {showStarPanel && currentMoment && (
        <StarPanel
          creator={currentMoment.creator_username || currentMoment.creator_name || 'Unknown'}
          onGiveStar={handleGiveStar}
          onClose={() => setShowStarPanel(false)}
        />
      )}

      {/* STAR CONFIRMATION (first time per creator) */}
      {pendingStar && (
        <StarConfirmation
          creator={pendingStar.creator}
          stars={pendingStar.stars}
          onConfirm={handleConfirmStar}
          onCancel={handleCancelStar}
        />
      )}
    </div>
  );
};

export default VoyoMoments;
