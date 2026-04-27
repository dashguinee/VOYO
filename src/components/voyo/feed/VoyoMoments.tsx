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
import { Heart, Flame, MessageCircle, ExternalLink, Play, Volume2, VolumeX, X, Sparkles } from 'lucide-react';
import { useMoments, CategoryAxis, NavAction, CATEGORY_PRESETS } from '../../../hooks/useMoments';
import type { Moment } from '../../../types/moments';
import { AnimatedArtCard } from './AnimatedArtCard';
import { DynamicVignette } from './DynamicVignette';
import { devWarn } from '../../../utils/logger';
import { usePlayerStore } from '../../../store/playerStore';
import { useMessagingViewport } from '../../../hooks/useMessagingViewport';

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

const css = (obj: React.CSSProperties) => obj;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type SlideDir = 'up' | 'down' | 'left' | 'right' | null;

// Dissolve-scroll wrapper — ONE signature gesture (per "premium =
// restraint"). 600ms crossfade, 10% directional translate, no scale,
// no breath, no parallax. Outgoing fades 1→0 while drifting toward
// exit direction; incoming fades 0→1 while drifting in from entry
// direction. Apple easing — cubic-bezier(0.16, 1, 0.3, 1).
//
// Mount-time `phase: 'pre'` style sets the BEFORE values; rAF flips to
// `'post'` (the AFTER values) so the CSS transition picks up the diff.
// React's standard transition pattern; no animation library needed.
const FadeWrapper = memo(({ children, dir, role }: { children: React.ReactNode; dir: SlideDir; role: 'outgoing' | 'incoming' }) => {
  const [phase, setPhase] = useState<'pre' | 'post'>('pre');
  useEffect(() => {
    const id = requestAnimationFrame(() => setPhase('post'));
    return () => cancelAnimationFrame(id);
  }, []);

  const sign = dir === 'up' || dir === 'left' ? 1 : dir === 'down' || dir === 'right' ? -1 : 0;
  const axis = dir === 'up' || dir === 'down' ? 'Y' : 'X';
  const offsetPct = 10; // % of viewport — restrained (Dash: "more on the fade side")

  let initial: React.CSSProperties;
  let final: React.CSSProperties;
  if (role === 'outgoing') {
    // Held position → drifts further in the direction it's leaving.
    initial = { opacity: 1, transform: `translate${axis}(0%)` };
    final   = { opacity: 0, transform: `translate${axis}(${-sign * offsetPct}%)` };
  } else {
    // Comes in from the entry side → settles at center.
    initial = { opacity: 0, transform: `translate${axis}(${sign * offsetPct}%)` };
    final   = { opacity: 1, transform: `translate${axis}(0%)` };
  }

  const live = phase === 'pre' ? initial : final;
  return (
    <div
      style={{
        ...live,
        position: 'absolute', inset: 0,
        transition: 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1), transform 600ms cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
});
FadeWrapper.displayName = 'FadeWrapper';

// ============================================
// COMPACT STYLES
// ============================================

const S = {
  // Cozy-K base — instead of pure #000, a deep amber-tinted dark.
  // Color science: human comfort peaks at ~1800-2200K (firelight, sunset).
  // Pure black + neutral grey reads "screen". Amber-black reads "lit room
  // at dusk" — lower cortisol, evolution-conditioned safety signal.
  container: css({ position: 'relative', width: '100%', height: '100%', backgroundColor: '#0B0703', overflow: 'hidden', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }),
  // Fully transparent — matches Home + VOYO + Profile header language.
  // The axis tabs + CompassArc children carry their own chip-level
  // backgrounds for readability, so the bar itself no longer needs a
  // gradient veil. Video breathes all the way up to the safe-area.
  topBar: css({
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
    paddingTop: 'env(safe-area-inset-top, 12px)',
    background: 'transparent',
    pointerEvents: 'auto',
    transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
  }),
  // Side shadows — matured. One signature move (per restraint memo):
  // a 44px multi-stop gradient with a subtle cool→warm tonal shift.
  // Outer edge is deeper + cooler (#080503), pulls toward warm amber as
  // it fades — reads as light bouncing off a curved glass edge, not a
  // dark wash pasted on. z 25→28 so the edge sits cleanly above the
  // video card (zIndex 2) and content rails, but below the topBar (30).
  // No top/bottom fades, no vignettes, no blur — one gesture, refined.
  sideShadowL: css({
    position: 'absolute', top: 0, bottom: 0, left: 0, width: 44, zIndex: 28,
    background: 'linear-gradient(to right, rgba(8,5,3,0.42) 0%, rgba(14,9,5,0.22) 35%, rgba(20,12,6,0.10) 65%, transparent 100%)',
    pointerEvents: 'none',
  }),
  sideShadowR: css({
    position: 'absolute', top: 0, bottom: 0, right: 0, width: 44, zIndex: 28,
    background: 'linear-gradient(to left, rgba(8,5,3,0.42) 0%, rgba(14,9,5,0.22) 35%, rgba(20,12,6,0.10) 65%, transparent 100%)',
    pointerEvents: 'none',
  }),
  axisTabs: css({ display: 'flex', justifyContent: 'center', gap: 4, padding: '8px 16px 2px' }),
  compassArc: css({ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '4px 0 10px', overflow: 'hidden', minHeight: 44 }),
  card: css({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }),
  thumb: css({ position: 'absolute', inset: 0, objectFit: 'cover', width: '100%', height: '100%', display: 'block', margin: 0, padding: 0, borderRadius: 0 }),
  // Bottom fade — softened, warm-tinted. Was 78% black/35% black; now 55%/15%
  // with the cozy amber base. Card text still readable, video breathes.
  // Bottom fade — softened, warm-tinted, with a max-height cap so the dim
  // doesn't eat the lower HALF of every video on tall portraits (iPhone Pro
  // Max ≈ 915 tall → 55% was ~503px wash). Cap at 360px so the gradient
  // reads as a footer halo, not a curtain.
  grad: css({ position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', maxHeight: 360, background: 'linear-gradient(to top, rgba(20,12,6,0.62) 0%, rgba(20,12,6,0.22) 45%, transparent 100%)', zIndex: 2, pointerEvents: 'none' }),
  // CREATOR BLOCK — single container positioned on the LEFT side, vertically
  // aligned with the middle of the right-side action bar. Stacks the orb +
  // name on top, with a compact glass bio card below. Bio is collapsed by
  // default (~2 lines with fade at bottom), tap to expand and scroll the rest.
  // Bio max-width tightened from 62% to 56%. ActBar (right side) stacks
  // four 48px chips ≈ 184px tall and ~64px wide — 62% was overlapping on
  // <375px screens. 56% gives the bio room to breathe without intruding.
  creatorBlock: css({ position: 'absolute', left: 18, bottom: 140, zIndex: 10, maxWidth: 'calc(56% - 30px)', display: 'flex', flexDirection: 'column', gap: 10, transition: 'opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1), transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)' }),
  creatorOrbWrap: css({ display: 'flex', alignItems: 'center', gap: 10 }),
  creatorOrb: css({ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(139,92,246,0.5), rgba(139,92,246,0.18))', border: '1.5px solid rgba(167,139,250,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700, color: '#fff', boxShadow: '0 6px 20px rgba(0,0,0,0.55), 0 0 14px rgba(139,92,246,0.25)', animation: 'voyo-creator-drift 6s ease-in-out infinite', flexShrink: 0 }),
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
  bioTitle: css({ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.35, marginBottom: 4, textShadow: '0 1px 3px rgba(0,0,0,0.5)' }),
  // Bio body — collapsed by default (~2 lines), expanded scrollable on tap
  bioBodyCollapsed: css({
    fontSize: 12,
    fontWeight: 400,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 1.5,
    maxHeight: 36, // ~2 lines
    overflow: 'hidden',
    position: 'relative',
  }),
  bioBodyExpanded: css({
    fontSize: 12,
    fontWeight: 400,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 1.5,
    maxHeight: 100,
    overflowY: 'auto',
    paddingRight: 4,
    position: 'relative',
  }),
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

  // ─── COMMENTS DRAWER ─────────────────────────────────────────
  // YouTube-Live-meets-bio-bar — slide-up drawer with glass + scrolling
  // live-style comments + react buttons + input. Same glassmorphism
  // aesthetic as the bio card so it feels like one design family.
  commentsBackdrop: css({
    position: 'absolute', inset: 0, zIndex: 60,
    background: 'rgba(0,0,0,0.55)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
  }),
  commentsDrawer: css({
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 61,
    maxHeight: '70%',
    minHeight: '50%',
    background: 'rgba(15, 15, 22, 0.78)',
    backdropFilter: 'blur(28px) saturate(150%)',
    WebkitBackdropFilter: 'blur(28px) saturate(150%)',
    borderTop: '1px solid rgba(167,139,250,0.2)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    boxShadow: '0 -12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }),
  commentsHandle: css({
    width: 40, height: 4, background: 'rgba(255,255,255,0.18)',
    borderRadius: 2, margin: '10px auto 6px',
  }),
  commentsHeader: css({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 18px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  }),
  commentsTitle: css({
    fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: 0.2,
  }),
  commentsCount: css({
    fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 500,
  }),
  commentsList: css({
    flex: 1, overflowY: 'auto', padding: '12px 18px 6px',
    display: 'flex', flexDirection: 'column-reverse', gap: 14,
  }),
  commentRow: css({
    display: 'flex', alignItems: 'flex-start', gap: 10,
  }),
  commentAvatar: css({
    width: 28, height: 28, borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(139,92,246,0.4), rgba(139,92,246,0.12))',
    border: '1px solid rgba(167,139,250,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
  }),
  commentBody: css({ flex: 1, minWidth: 0 }),
  commentMeta: css({
    display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2,
  }),
  commentName: css({ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }),
  commentTime: css({ fontSize: 10, color: 'rgba(255,255,255,0.35)' }),
  commentText: css({ fontSize: 12.5, color: 'rgba(255,255,255,0.78)', lineHeight: 1.45, wordBreak: 'break-word' }),
  commentReactBtn: css({
    display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
    borderRadius: 999, background: 'rgba(167,139,250,0.1)',
    border: '1px solid rgba(167,139,250,0.18)',
    fontSize: 10, fontWeight: 600, color: '#a78bfa',
    cursor: 'pointer', flexShrink: 0,
    transition: 'all 0.2s ease',
  }),
  commentInputWrap: css({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '12px 18px',
    paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(10,10,15,0.4)',
  }),
  commentInput: css({
    // 44px height meets touch-target floor; 16px font-size prevents
    // iOS focus-zoom (research §1 #8). Visual weight matches the other
    // glass chips in the drawer — proud but not shouted.
    flex: 1, height: 44, padding: '0 14px',
    borderRadius: 22,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#fff', fontSize: 16, outline: 'none',
  }),
  commentSendBtn: css({
    width: 44, height: 44, borderRadius: '50%',
    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    border: 'none', color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    transition: 'transform 0.15s ease-out, box-shadow 0.2s ease-out',
    boxShadow: '0 4px 14px rgba(139,92,246,0.35)',
  }),
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
    // No filter:blur — Safari/iOS re-rasterizes per-frame during the 0.3s
    // axis-swap transition (research §2F). Opacity ramp already carries the
    // depth read; blur was redundant chrome on a P1 jank vector.
    const fontSize = absOffset === 0 ? 14 : absOffset === 1 ? 12 : 10;
    const letterSpacing = absOffset === 0 ? 2 : absOffset === 1 ? 1 : 0.5;

    return {
      transform: `scale(${scale}) translateY(${yShift}px)`,
      opacity,
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
              // Key by positional offset (slot), NOT (category-index). When
              // currentIndex shifts the same offset slot would otherwise carry
              // a different category — React unmounts/remounts and the slot
              // animates from mount-time = fade-from-zero on every category
              // step. Treating children as positional slots keeps the same
              // DOM node and lets the CSS transition interpolate smoothly.
              key={offset}
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
  // 48×48: above Apple (44) and Android (48) touch minimums. The visual
  // icon inside stays 20px — the extra padding is an invisible hit zone.
  width: 48, height: 48, borderRadius: '50%',
  background: on ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.1)',
  backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'all 0.2s ease, transform 0.15s ease-out',
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
  onOpenComments?: () => void;
  showOrb: boolean;
  showName: boolean;
  showTitle: boolean;
  showBioBody: boolean;
}

const MomentCard = memo(({ moment, isOyed, onOye, isActive, isMuted, onToggleMute, onPlayTrack, onArtistTap, onOpenComments, showOrb, showName, showTitle, showBioBody }: MomentCardProps) => {
  // Bio expand state — collapsed by default (~2 lines visible with bottom fade),
  // tap to expand and scroll the rest of the description.
  const [bioExpanded, setBioExpanded] = useState(false);
  const initial = (moment.creator_name || moment.creator_username || '?')[0].toUpperCase();
  const creator = moment.creator_name || moment.creator_username || 'Unknown';
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoAvailable, setVideoAvailable] = useState<boolean | null>(null);
  const [videoError, setVideoError] = useState(false);

  const videoUrl = `${VOYO_API}/r2/feed/${moment.source_id}`;

  // Check if video exists in R2 on mount. AbortController so rapid
  // swipes don't pile up in-flight /check fetches behind the active
  // moment's <video> request — was blocking the 6-conn cap and
  // delaying first-frame paint on the next moment.
  useEffect(() => {
    const ctl = new AbortController();
    setVideoAvailable(null);
    setVideoError(false);
    fetch(`${videoUrl}/check`, { signal: ctl.signal })
      .then(r => r.json())
      .then(data => setVideoAvailable(data.exists === true))
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        setVideoAvailable(false);
      });
    return () => ctl.abort();
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
  // Also pauses on background to avoid competing with main audio element
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || format !== 'r2_video') return;

    if (isActive && !document.hidden) {
      vid.currentTime = 0;
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }

    // Pause moment video when app backgrounds — prevents audio focus theft
    const onVis = () => {
      if (document.hidden && vid) vid.pause();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
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
          {moment.thumbnail_url && <img src={moment.thumbnail_url} alt="" style={S.thumb} loading="lazy" decoding="async" draggable={false} />}
          <video
            ref={videoRef}
            src={videoUrl}
            className="absolute inset-0 w-full h-full object-cover"
            muted={isMuted}
            loop
            playsInline
            // 'metadata' on all cards warms the header without streaming
            // the full clip — active flip is instant, no poster blink on first play().
            preload={isActive ? 'auto' : 'metadata'}
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
          {moment.thumbnail_url && <img src={moment.thumbnail_url} alt="" style={S.thumb} loading="lazy" decoding="async" draggable={false} />}
        </>
      )}

      <div style={S.grad} />

      <div style={S.actBar} data-no-tap-wake="true">
        {/* OYE — primary, activated state always at 100%. Ambient = 85%. */}
        <div
          style={{
            ...S.actBtn,
            opacity: isOyed ? 1 : 'var(--act-primary, 1)',
            transition: 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onClick={onOye}
        >
          <div style={actIcon(isOyed)}>
            <Heart size={20} style={{ color: isOyed ? '#a78bfa' : '#fff', fill: isOyed ? '#a78bfa' : 'none', transition: 'all 0.2s ease' }} />
          </div>
          <span style={{ ...S.actLbl, color: isOyed ? '#a78bfa' : 'rgba(255,255,255,0.6)' }}>OYE</span>
        </div>
        {/* Reactions — primary, ambient 85%. */}
        <div style={{ ...S.actBtn, opacity: 'var(--act-primary, 1)', transition: 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          <div style={actIcon(false)}><Flame size={20} style={{ color: '#fff' }} /></div>
          <span style={S.actLbl}>{formatCount(moment.voyo_reactions || 0)}</span>
        </div>
        {/* Comments — secondary, ambient 95%. */}
        <div
          style={{ ...S.actBtn, opacity: 'var(--act-secondary, 1)', transition: 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1)' }}
          onClick={(e) => { e.stopPropagation(); onOpenComments?.(); }}
        >
          <div style={actIcon(false)}><MessageCircle size={20} style={{ color: '#fff' }} /></div>
          <span style={S.actLbl}>{formatCount(moment.comment_count || 0)}</span>
        </div>
        {/* Share — secondary, ambient 95%. */}
        <div style={{ ...S.actBtn, opacity: 'var(--act-secondary, 1)', transition: 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1)' }}>
          <div style={actIcon(false)}><ExternalLink size={18} style={{ color: '#fff' }} /></div>
          <span style={S.actLbl}>Share</span>
        </div>
      </div>

      {/* CREATOR BLOCK — single positioned container, stacked layout:
          orb + name on top, glass bio card below. Staged fade choreography:
          bio body fades first (2s), then title (4s), then orb paint-out (6s).
          Name STAYS through all stages — lightweight creator credit. */}
      <div style={S.creatorBlock}>
        <div style={S.creatorOrbWrap}>
          {/* Orb — fades with paint sweep at stage 3 */}
          <div
            style={{
              opacity: showOrb ? 1 : 0,
              transform: showOrb ? 'scale(1)' : 'scale(0.92)',
              transition: 'opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1), transform 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
              animation: !showOrb ? 'voyo-paint-out 0.9s ease-out forwards' : undefined,
            }}
          >
            <div style={S.creatorOrb}>{initial}</div>
          </div>
          {/* Name — always visible. Slightly dimmer when orb is gone so it
              reads as a watermark/credit, not a label. */}
          <span
            style={{
              ...S.creatorOrbName,
              opacity: showOrb ? 1 : 0.7,
              transition: 'opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            @{creator}
          </span>
        </div>

        {(moment.title || moment.description) && showTitle && (
          <div
            data-no-tap-wake="true"
            style={{
              ...S.bioCard,
              opacity: showTitle ? 1 : 0,
              transform: showTitle ? 'translateY(0)' : 'translateY(6px)',
              transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              pointerEvents: showTitle ? 'auto' : 'none',
            }}
            onClick={(e) => { e.stopPropagation(); setBioExpanded(p => !p); }}
          >
            {/* Glossy top highlight */}
            <div style={{
              position: 'absolute', top: 0, left: 12, right: 12, height: 1,
              background: 'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)',
              pointerEvents: 'none',
            }} />
            <div style={S.bioTitle}>{moment.title}</div>
            {moment.description && showBioBody && (
              <div
                style={{
                  ...(bioExpanded ? S.bioBodyExpanded : S.bioBodyCollapsed),
                  opacity: showBioBody ? 1 : 0,
                  transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
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
// COMMENTS DRAWER — YouTube-Live-meets-bio-bar in VOYO DNA.
// Slide-up glass drawer with scrolling live comments + react buttons + input.
// Same glassmorphism family as the bio card so it feels coherent.
// Mock data for now (no backend wired) — just the surface.
// ============================================

interface CommentItem {
  id: string;
  author: string;
  text: string;
  reactions: number;
  hasReacted: boolean;
  timeAgo: string;
}

const MOCK_COMMENTS: CommentItem[] = [
  { id: '1', author: 'kenza', text: 'this hits different at 2am 🔥', reactions: 12, hasReacted: false, timeAgo: '3m' },
  { id: '2', author: 'omar', text: 'who shot this? cinematography crazy', reactions: 8, hasReacted: false, timeAgo: '7m' },
  { id: '3', author: 'sarah', text: 'OYÉ!!! I needed this today', reactions: 24, hasReacted: true, timeAgo: '12m' },
  { id: '4', author: 'aziz', text: 'add to playlist immediately', reactions: 5, hasReacted: false, timeAgo: '18m' },
  { id: '5', author: 'fatou', text: 'the vocals on this 😮‍💨', reactions: 17, hasReacted: false, timeAgo: '24m' },
];

const CommentsDrawer = memo(({ moment, onClose }: { moment: Moment; onClose: () => void }) => {
  const [comments, setComments] = useState<CommentItem[]>(MOCK_COMMENTS);
  const [draft, setDraft] = useState('');
  // Subscribe to visualViewport so the drawer shrinks when the soft keyboard
  // opens. Without this, maxHeight is computed before the keyboard arrives
  // and the input ends up partially obscured. `vh` is the effective viewport
  // height; we cap drawer height to ~70% of it (keyboard-aware).
  const { vh, keyboardOpen } = useMessagingViewport();
  const drawerStyle: React.CSSProperties = {
    ...S.commentsDrawer,
    maxHeight: vh > 0 ? Math.round(vh * 0.7) : '70%',
    minHeight: keyboardOpen ? Math.min(280, vh > 0 ? Math.round(vh * 0.6) : 280) : '50%',
  };

  const handleReact = useCallback((id: string) => {
    setComments(prev => prev.map(c =>
      c.id === id && !c.hasReacted
        ? { ...c, hasReacted: true, reactions: c.reactions + 1 }
        : c
    ));
  }, []);

  const handleSend = useCallback(() => {
    if (!draft.trim()) return;
    const newComment: CommentItem = {
      id: `local-${Date.now()}`,
      author: 'you',
      text: draft.trim(),
      reactions: 0,
      hasReacted: false,
      timeAgo: 'now',
    };
    setComments(prev => [newComment, ...prev]);
    setDraft('');
  }, [draft]);

  return (
    <>
      {/* Backdrop — tap to close */}
      <div
        style={S.commentsBackdrop}
        className="animate-[voyo-fade-in_0.25s_ease-out]"
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        style={drawerStyle}
        className="animate-voyo-spring-in-bottom"
        data-no-tap-wake="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={S.commentsHandle} />
        <div style={S.commentsHeader}>
          <span style={S.commentsTitle}>Comments</span>
          <div className="flex items-center gap-3">
            <span style={S.commentsCount}>{comments.length} live</span>
            {/* Explicit close affordance — tapping the backdrop works too
                but not all users know that. 44×44 hit zone with a small
                visual icon keeps it discoverable without shouting. */}
            <button
              onClick={onClose}
              aria-label="Close comments"
              className="flex items-center justify-center rounded-full bg-white/8 hover:bg-white/15 active:scale-90 transition-all"
              style={{ width: 36, height: 36, minWidth: 36, minHeight: 36 }}
            >
              <X size={16} style={{ color: 'rgba(255,255,255,0.75)' }} />
            </button>
          </div>
        </div>
        <div style={S.commentsList} className="scrollbar-hide">
          {comments.map((c) => (
            <div key={c.id} style={S.commentRow}>
              <div style={S.commentAvatar}>{c.author[0].toUpperCase()}</div>
              <div style={S.commentBody}>
                <div style={S.commentMeta}>
                  <span style={S.commentName}>@{c.author}</span>
                  <span style={S.commentTime}>· {c.timeAgo}</span>
                </div>
                <div style={S.commentText}>{c.text}</div>
              </div>
              <button
                style={{
                  ...S.commentReactBtn,
                  background: c.hasReacted ? 'rgba(167,139,250,0.22)' : 'rgba(167,139,250,0.1)',
                }}
                onClick={() => handleReact(c.id)}
              >
                <Heart size={9} style={{ color: '#a78bfa', fill: c.hasReacted ? '#a78bfa' : 'none' }} />
                <span>{c.reactions}</span>
              </button>
            </div>
          ))}
        </div>
        <div style={S.commentInputWrap}>
          <input
            type="text"
            placeholder="add to the moment…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            onFocus={(e) => {
              // Mobile keyboard-open ensure-visible: the drawer is fixed
              // bottom, so when the keyboard slides up it covers the input
              // unless we scroll it into view. scrollIntoView({block:'nearest'})
              // is a no-op if already visible — safe to call unconditionally.
              // Small delay lets the virtual keyboard finish animating in
              // before we measure layout.
              const el = e.currentTarget;
              setTimeout(() => {
                try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
              }, 320);
            }}
            style={S.commentInput}
            // Tailwind focus ring is the cleanest way to add pseudo-state
            // styling on top of the inline style. The inline `outline:none`
            // in S.commentInput kills the browser default, these classes
            // paint a subtle purple ring that matches the drawer accent.
            className="focus:ring-2 focus:ring-purple-400/60 focus:border-purple-400/40"
          />
          <button
            style={S.commentSendBtn}
            onClick={handleSend}
            className="active:scale-90 hover:brightness-110"
            aria-label="Send comment"
          >
            <Heart size={16} style={{ color: '#fff', fill: '#fff' }} />
          </button>
        </div>
      </div>
    </>
  );
});
CommentsDrawer.displayName = 'CommentsDrawer';

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
  // Header visibility — independent of uiPhase so we can wake it back on
  // tap without re-triggering the gold transition word reveal. The header
  // is visible when EITHER uiPhase is not 'immersive' OR headerVisible is
  // explicitly true (set by tap-to-wake).
  const [headerVisible, setHeaderVisible] = useState(true);
  const headerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Comments overlay — YouTube-Live-meets-bio-bar drawer that slides up
  // from the bottom. Shows scrolling live comments + react buttons + input.
  const [showComments, setShowComments] = useState(false);
  const handleOpenComments = useCallback(() => {
    setShowComments(true);
  }, []);
  const handleCloseComments = useCallback(() => {
    setShowComments(false);
  }, []);

  // STAGED WIDGET VISIBILITY — choreographed fade for immersion.
  //
  //   stage 0  full       = orb + name + title + bio body all visible
  //   stage 1  compact    = orb + name + title  (bio body fades out at ~2s)
  //   stage 2  minimal    = orb + name only     (title fades at ~4s)
  //   stage 3  immersive  = nothing             (orb paint-dissolves at ~6s)
  //
  // Each tap on the screen resets to stage 0 and restarts the timer.
  // Single tap → restart from stage 0 (full read).
  const [widgetStage, setWidgetStage] = useState<0 | 1 | 2 | 3>(0);
  const stageTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
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

  // Restart the staged fade — stage 0 → 1 → 2 → 3 over 6 seconds.
  // Does NOT touch the header — that's reserved for explicit taps via
  // wakeHeaderOnTap below. Scrolls + new-moment events restart the
  // staged fade but the header stays gone until the user explicitly taps.
  const pingWidgets = useCallback(() => {
    setWidgetStage(0);
    stageTimers.current.forEach(t => clearTimeout(t));
    stageTimers.current = [
      setTimeout(() => setWidgetStage(1), 2000),  // bio body fades at 2s
      setTimeout(() => setWidgetStage(2), 4000),  // title fades at 4s
      setTimeout(() => setWidgetStage(3), 6000),  // orb paint-dissolves at 6s
    ];
  }, []);

  // Tap-only header restore. Never called from scroll/swipe handlers.
  // Restores the modes widget (axis tabs + compass arc) and auto-hides
  // again after 5s. ALSO calls pingWidgets so the orb/title/bio come back
  // along with the header for a coherent reveal.
  const wakeHeaderOnTap = useCallback(() => {
    setHeaderVisible(true);
    pingWidgets();
    if (headerHideTimer.current) clearTimeout(headerHideTimer.current);
    headerHideTimer.current = setTimeout(() => setHeaderVisible(false), 5000);
  }, [pingWidgets]);

  // Auto-fade on entering immersive phase, and on every new moment
  useEffect(() => {
    if (uiPhase === 'immersive') {
      pingWidgets();
    }
    return () => {
      stageTimers.current.forEach(t => clearTimeout(t));
    };
  }, [uiPhase, pingWidgets]);

  // Restart the fade timer whenever the moment changes (user gets the full
  // read window on the new moment).
  useEffect(() => {
    if (uiPhase === 'immersive') pingWidgets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mKey]);

  // Cleanup transition timer on unmount
  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  // (O9) Unmount-only stageTimers cleanup. The per-effect cleanup above only
  // runs when [uiPhase, pingWidgets] change — it doesn't fire when pingWidgets
  // is invoked from wakeHeaderOnTap or the [mKey] effect. Without this guard,
  // a component unmounted mid-fade leaves up to 3 setTimeouts pending that
  // setState on a dead tree (React 18 swallows, but it's still real waste).
  useEffect(() => () => {
    stageTimers.current.forEach(t => clearTimeout(t));
    stageTimers.current = [];
  }, []);

  // Backward-compat: code below still references hasInteracted
  const hasInteracted = uiPhase === 'immersive';
  // Visibility flags derived from the staged fade.
  // Name STAYS — it's the lightweight creator credit/watermark that
  // persists after everything else fades. Per Dash: keep the name after
  // the animation.
  const showOrb = widgetStage < 3;
  const showName = true;
  const showTitle = widgetStage < 2;
  const showBioBody = widgetStage < 1;

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
  // Live mirror — lets deferred callbacks (starHoldTimer fires after
  // 500ms) read the *current* moment without going through closures.
  // Without this, a hold started on moment A could fire its panel after
  // a swipe to moment B and show A's creator on B's content.
  const currentMomentRef = useRef(currentMoment);
  useEffect(() => { currentMomentRef.current = currentMoment; }, [currentMoment]);

  const containerRef = useRef<HTMLDivElement>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const swiping = useRef(false);
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Record play after 1.5s dwell — rapid swipes don't inflate voyo_plays
  useEffect(() => {
    if (!currentMoment) return;
    const id = currentMoment.id;
    const t = window.setTimeout(() => recordPlay(id), 1500);
    return () => window.clearTimeout(t);
  }, [currentMoment?.id, recordPlay]);

  // Navigate with animation direction
  // Nav-fade signal — VoyoBottomNav fades to 30% (orb to 50%) when this
  // flag is true. Triggered by 5 swipes OR 3s of dwell, restored on touch
  // / long-press position modal. Cleanup on unmount so the nav doesn't
  // stay dimmed if the user leaves the feed.
  const setFeedNavDim = usePlayerStore(s => s.setFeedNavDim);
  const feedNavDim = usePlayerStore(s => s.feedNavDim);
  const swipeCountRef = useRef(0);
  const dimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armDimTimer = useCallback(() => {
    if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
    dimTimerRef.current = setTimeout(() => setFeedNavDim(true), 3000);
  }, [setFeedNavDim]);
  useEffect(() => {
    armDimTimer();
    return () => {
      if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
      setFeedNavDim(false);
    };
  }, [armDimTimer, setFeedNavDim]);
  // Long-press position modal restores the nav at the same time as the
  // header reveal — the modal IS the "let me see where I am" gesture, so
  // every chrome surface should be accessible during it. On close, the
  // dim timer arms again so the nav fades back into ambient.
  useEffect(() => {
    if (showOverlay) {
      setFeedNavDim(false);
      // (audit-2 P1) Reset the swipe counter too, otherwise next nav
      // immediately re-arms dim because counter is still ≥5. Especially
      // matters for keyboard users who never hit the touchstart path
      // that's the only other place this resets.
      swipeCountRef.current = 0;
      if (dimTimerRef.current) clearTimeout(dimTimerRef.current);
    } else {
      armDimTimer();
    }
  }, [showOverlay, setFeedNavDim, armDimTimer]);

  // Dissolve-scroll outgoing snapshot — the moment we're leaving. Held
  // for 700ms (slightly longer than the 600ms crossfade so the outgoing
  // FadeWrapper has time to finish its transition before unmount).
  const [prevMoment, setPrevMoment] = useState<Moment | null>(null);
  const [transitionDir, setTransitionDir] = useState<SlideDir>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-entry guard — re-swipe during the 700ms transition window
  // produced triple-card flicker (prev still fading while next prev
  // gets captured + animates over it). Lock until the in-flight
  // transition unmounts cleanly.
  const navLockedRef = useRef(false);

  const nav = useCallback((dir: SlideDir, fn: () => void) => {
    if (navLockedRef.current) return;
    // Capture outgoing BEFORE fn() advances the feed so prevMoment holds
    // the moment that's leaving, not the one that just arrived.
    if (currentMoment) {
      navLockedRef.current = true;
      setPrevMoment(currentMoment);
      setTransitionDir(dir);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => {
        setPrevMoment(null);
        setTransitionDir(null);
        navLockedRef.current = false;
      }, 700);
    }
    setSlideDir(dir);
    setMKey(p => p + 1);
    fn();
    // Each swipe counts toward the 5-swipe dim trigger. The dwell timer
    // is a parallel trigger — whichever fires first sticks.
    swipeCountRef.current += 1;
    if (swipeCountRef.current >= 5) setFeedNavDim(true);
  }, [currentMoment, setFeedNavDim]);

  // Cleanup any pending transition timer on unmount.
  useEffect(() => () => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
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
    // EXCLUDE action buttons + bio card from being treated as taps for the
    // wake-header / single-tap-mute logic. The user's intent on those
    // surfaces is the button itself, not "wake the modes widget".
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-tap-wake="true"]')) {
      touchStart.current = null;
      return;
    }

    // Touch wakes the nav back to full opacity + restarts the 3s dwell
    // timer + resets the 5-swipe counter. Hold-to-show-position-modal
    // pathway also clears it (showOverlay flip below).
    setFeedNavDim(false);
    swipeCountRef.current = 0;
    armDimTimer();

    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    swiping.current = false;

    // Check if this is a second tap (potential double-tap-hold for stars)
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS && currentMoment) {
      // Capture the moment id at hold-start so the panel can validate it
      // hasn't drifted by the time the timer fires (e.g. realtime feed
      // refresh during the 500ms hold). Without this, the StarPanel can
      // open for the wrong creator's content.
      const heldMomentId = currentMoment.id;
      starHoldTimer.current = setTimeout(() => {
        if (swiping.current) return;
        // Re-read the live currentMoment via a fresh closure-captured ref
        // is overkill — instead read the latest from the hook by walking
        // back through React state. Simplest valid check: ensure the
        // captured id still matches what's rendered.
        const live = currentMomentRef.current;
        if (!live || live.id !== heldMomentId) return;
        const creator = live.creator_username || live.creator_name || '';
        if (creator) setShowStarPanel(true);
      }, STAR_HOLD_MS);
    }

    lpTimer.current = setTimeout(() => { if (!swiping.current) setShowOverlay(true); }, LONG_PRESS_MS);
  }, [currentMoment, setFeedNavDim, armDimTimer]);

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
        // Single tap action: ONLY bring header + widgets back. Mute is now
        // controlled by the navbar volume slider (slide to 0 = muted) so
        // we don't conflict the screen tap with mute toggle anymore.
        wakeHeaderOnTap();
        lastTap.current = 0;
      }, DOUBLE_TAP_MS);
    }
  }, [showOverlay, showStarPanel, currentMoment, mixGoUp, mixGoDown, goLeft, goRight, nav, handleOye, wakeHeaderOnTap, startTransition]);

  // ---- KEYBOARD (desktop) ----

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp': e.preventDefault(); nav('up', mixGoUp); break;
        case 'ArrowDown': e.preventDefault(); nav('down', mixGoDown); break;
        case 'ArrowLeft': e.preventDefault(); nav('left', goLeft); break;
        case 'ArrowRight': e.preventDefault(); nav('right', goRight); break;
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
    // (audit-2 P1) headerHideTimer was missed from the original cleanup.
    // wakeHeaderOnTap schedules a 5s setHeaderVisible(false); without
    // this clear, unmounting within 5s of a wake fires setState on a
    // dead component (React 18 warning + zombie state on next mount).
    if (headerHideTimer.current) clearTimeout(headerHideTimer.current);
  }, []);

  // slideVariants + sv removed — they were leftover from a stripped
  // framer-motion impl and never wired. Dissolve-scroll (FadeWrapper)
  // handles transitions now.
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
    <div
      ref={containerRef}
      style={{
        ...S.container,
        // Action-rail ambient dim — driven by the same feedNavDim flag the
        // navbar uses, so chrome breathes together. Primary buttons (OYE +
        // reactions) drop to 85%; secondary (Comments + Share) to 95%.
        // OYE button overrides to 100% when isOyed (activated stays full).
        // Transition handled per-button so each button's opacity eases in
        // ~1s — same Apple curve as the navbar fade.
        '--act-primary':   feedNavDim ? '0.85' : '1',
        '--act-secondary': feedNavDim ? '0.95' : '1',
      } as React.CSSProperties}
      onTouchStart={onTS}
      onTouchMove={onTM}
      onTouchEnd={onTE}
    >
      {/* SIDE SHADOWS — frame the video with subtle vertical gradients */}
      <div style={S.sideShadowL} />
      <div style={S.sideShadowR} />

      {/* TOP BAR — unified gradient surface. Visible when uiPhase isn't
          immersive OR when headerVisible is true (set by tap-to-wake). */}
      <div
        style={{
          ...S.topBar,
          opacity: (!hasInteracted || headerVisible) ? 1 : 0,
          transform: (!hasInteracted || headerVisible) ? 'translateY(0)' : 'translateY(-12px)',
          pointerEvents: (!hasInteracted || headerVisible) ? 'auto' : 'none',
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
            // Anchor under the topBar+axisTabs+CompassArc, clearing the notch
            // safe-area. Magic `top:100` was colliding with the axis tabs on
            // notched devices.
            top: 'calc(env(safe-area-inset-top, 0px) + 88px)',
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
        <>
          {/* Outgoing — only mounts during the 700ms transition window.
              isActive={false} so its video pauses (audio stops doubling
              up while two cards briefly coexist). */}
          {prevMoment && transitionDir && prevMoment.id !== currentMoment.id && (
            <FadeWrapper key={`prev-${prevMoment.id}`} dir={transitionDir} role="outgoing">
              <MomentCard
                moment={prevMoment}
                isOyed={oyedMoments.has(prevMoment.id)}
                onOye={() => {}}
                isActive={false}
                isMuted={true}
                onToggleMute={() => {}}
                onArtistTap={onArtistTap}
                showOrb={false}
                showName={false}
                showTitle={false}
                showBioBody={false}
              />
            </FadeWrapper>
          )}
          {/* Incoming — keyed by moment id so each new moment runs a
              fresh enter from offset+0 opacity to 0+1 over 600ms. */}
          <FadeWrapper key={`curr-${currentMoment.id}-${mKey}`} dir={transitionDir} role="incoming">
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
              onOpenComments={handleOpenComments}
              showOrb={showOrb}
              showName={showName}
              showTitle={showTitle}
              showBioBody={showBioBody}
            />
          </FadeWrapper>

          {/* Hidden preload — keeps the next moment's <video> mounted with
              preload="metadata" so the swipe-forward play() hits a warm
              http cache instead of cold-fetching. Combined with prev (during
              the 700ms fade) + current, total <video> elements caps at 3.
              Pause not unmount — `isActive={false}` already gates play()
              inside MomentCard. position:absolute + opacity:0 keeps it in
              the layout tree (visibility:hidden would deprioritise loading
              in some browsers, defeating the warm-up). */}
          {nextMoment && nextMoment.id !== currentMoment.id && (
            <div
              key={`next-${nextMoment.id}`}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0,
                pointerEvents: 'none',
                zIndex: -1,
              }}
            >
              <MomentCard
                moment={nextMoment}
                isOyed={oyedMoments.has(nextMoment.id)}
                onOye={() => {}}
                isActive={false}
                isMuted={true}
                onToggleMute={() => {}}
                onArtistTap={onArtistTap}
                showOrb={false}
                showName={false}
                showTitle={false}
                showBioBody={false}
              />
            </div>
          )}
        </>
      ) : (
        <div key="empty" style={S.empty} className="animate-[voyo-fade-in_0.3s_ease]">
          {/* Visual anchor — purple gradient halo with sparkle icon. Makes
              the empty state feel intentional, not broken. */}
          <div
            className="flex items-center justify-center mb-4"
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(139,92,246,0.08))',
              border: '1px solid rgba(167,139,250,0.3)',
              boxShadow: '0 0 32px rgba(139,92,246,0.25), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <Sparkles size={28} style={{ color: '#c4b5fd' }} />
          </div>
          <div style={S.emptyH}>
            {isMixMode ? 'No moments in MIX' : `No moments in ${displayName(currentCategory)}`}
          </div>
          <div style={S.emptyP}>
            {isMixMode
              ? 'Selected categories have no moments yet. Try adding more categories.'
              : `Swipe sideways to explore other ${categoryAxis}.\nMoments will appear here as creators share them.`
            }
          </div>
        </div>
      )}

      {/* Next-moment ghost preview removed (2026-04-25). The 56×72 thumb
          with a white outline cheapened the corner and pre-revealed the
          next card — anticipation is part of the feed, killing it kills
          the want. Per "premium = restraint" / "warm it up, slide it in"
          philosophy: subtract before add. */}

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

      {/* COMMENTS DRAWER — slides up from bottom on comment button tap */}
      {showComments && currentMoment && (
        <CommentsDrawer moment={currentMoment} onClose={handleCloseComments} />
      )}
    </div>
  );
};

export default VoyoMoments;
