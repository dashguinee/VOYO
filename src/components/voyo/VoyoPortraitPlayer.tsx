/**
 * VOYO Portrait Player - CLEAN V2 STYLE
 *
 * LAYOUT (Top to Bottom):
 * 1. TOP: History (left 2 cards) | Queue + Add (right)
 * 2. CENTER: Big artwork with title overlay
 * 3. PLAY CONTROLS: Neon purple ring
 * 4. REACTIONS: Clean pill buttons with HOLD-TO-CHARGE OYÉ MULTIPLIER
 * 5. BOTTOM: 3-column vertical grid (HOT | VOYO FEED | DISCOVERY)
 */

import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { useNavigate as useRouterNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipForward, SkipBack, Zap, Flame, Plus, Film, Settings, Heart,
  Shuffle, Repeat, Repeat1, Share2, Mic, Mic2, X, ChevronDown
} from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { useShallow } from 'zustand/shallow';
import { useIntentStore, VibeMode } from '../../store/intentStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { getThumbnailUrl, getTrackThumbnailUrl } from '../../utils/thumbnail';
import { Track, ReactionType } from '../../types';
import { SmartImage } from '../ui/SmartImage';
import { useMobilePlay } from '../../hooks/useMobilePlay';
import { BoostButton } from '../ui/BoostButton';
import { BoostSettings } from '../ui/BoostSettings';
import { haptics, getReactionHaptic } from '../../utils/haptics';
import { useReactionStore, ReactionCategory, initReactionSubscription } from '../../store/reactionStore';
import { devLog, devWarn } from '../../utils/logger';
import { pipService } from '../../services/pipService';
// TiviPlusCrossPromo moved to HomeFeed.tsx (classic homepage)
import { useAuth } from '../../hooks/useAuth';
import { getCurrentSegment, fetchLyricsSimple, type EnrichedLyrics, type LyricsGenerationProgress } from '../../services/lyricsEngine';
import { refineSegmentsWithOnsets } from '../../services/lyricsOnsetSync';
import { LyricsCanvas } from './lyrics/LyricsCanvas';
import { findLyrics } from '../../services/lyricsAgent';
// getVideoStreamUrl removed — no longer needed after LyricsAgent replaced Whisper pipeline
import { translateWord, type TranslationMatch } from '../../services/lexiconService';
import { voiceSearch, recordFromMicrophone, isConfigured as isWhisperConfigured } from '../../services/whisperService';
import { searchAlbums, getAlbumTracks } from '../../services/piped';
import { pipedTrackToVoyoTrack } from '../../data/tracks';

// FLYWHEEL: Central DJ vibe training
import {
  trainVibeOnQueue,
  trainVibeOnBoost,
  trainVibeOnReaction,
  MixBoardMode,
} from '../../services/centralDJ';

import { onSignal as oyaPlanSignal } from '../../services/oyoPlan';
import { app } from '../../services/oyo';

// OYO Island - DJ Voice Search & Chat
import { OyoIsland } from './OyoIsland';
import { VoyoLoadOrb } from './VoyoLoadOrb';

// YouTube Iframe - Unified streaming + video display
// YouTubeIframe is GLOBAL (App.tsx) - removed duplicate import

// ============================================
// ISOLATED TIME COMPONENTS - Prevents full re-renders
// These subscribe directly to currentTime/duration without
// causing parent components to re-render
// ============================================

// Time display that only re-renders when time changes
const CurrentTimeDisplay = memo(() => {
  const currentTime = usePlayerStore((state) => state.currentTime);
  return (
    <span className="text-[8px] text-white/40 font-mono tabular-nums min-w-[26px]">
      {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
    </span>
  );
});

// Progress indicator - display only, no seeking (VOYO is a music player, not video player)
/**
 * CardSeek — slim, faded variant of ProgressSlider that lives INSIDE the
 * BigCenterCard, below the artist name (Dash 2026-04-29 v790). Hairline
 * track + 4px playhead dot, all dimmed via the `visible` prop which is
 * driven by isControlsRevealed → fades in on canvas tap, out after 5s.
 * "On touch appear, fade after 5s" + smaller dot + more faded than the
 * old engine-row seek which has been retired.
 */
const CardSeek = memo(({ visible }: { visible: boolean }) => {
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  return (
    <div
      className="relative h-2 mt-1.5 transition-opacity duration-500"
      style={{ opacity: visible ? 0.62 : 0 }}
      aria-hidden
    >
      {/* Hairline track — faded, doesn't compete with title/artist */}
      <div
        className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] rounded-full"
        style={{ background: 'rgba(255,255,255,0.32)' }}
      />
      {/* Playhead dot — smaller (4px) and softer than the original 6px */}
      <div
        className="absolute w-[4px] h-[4px] rounded-full top-1/2"
        style={{
          left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
          transform: 'translate(-50%, -50%)',
          background: '#D4613E',
          boxShadow: '0 0 5px rgba(212,97,62,0.6), 0 0 10px rgba(212,97,62,0.25)',
        }}
      />
    </div>
  );
});
CardSeek.displayName = 'CardSeek';

const ProgressSlider = memo(({ isScrubbing }: { isScrubbing: boolean }) => {
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);

  return (
    <div className="flex-1 relative h-3 flex items-center">
      {/* Track hairline — last 30% fades toward the right edge so the
          bar tapers off into the background instead of ending abruptly.
          Mask-image cuts visibility, not color, so it works with any
          underlying background. */}
      <div
        className="absolute left-0 right-0 h-[1px] bg-white/20 rounded-full"
        style={{
          maskImage: 'linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)',
          WebkitMaskImage: 'linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%)',
        }}
      />
      {/* No seek input - VOYO is music, not video. You feel it, you don't scrub it. */}
      <div
        className="absolute w-[6px] h-[6px] rounded-full"
        style={{
          left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
          transform: 'translateX(-50%)',
          background: '#D4613E',
          // AUDIO-REACTIVE GLOW: the progress dot brightens with overall
          // audio energy. --voyo-energy is 0-1 from the frequency pump.
          // calc() scales the glow radius: 8px base + up to 10px from energy.
          boxShadow: isScrubbing
            ? '0 0 12px rgba(212,97,62,1.0), 0 0 24px rgba(212,97,62,0.5)'
            : '0 0 calc(8px + var(--voyo-energy, 0) * 10px) rgba(212,97,62, calc(0.6 + var(--voyo-energy, 0) * 0.35)), 0 0 16px rgba(212,97,62,0.3)',
          transition: 'box-shadow 0.25s ease-out, width 0.2s ease-out',
          }}
      />
    </div>
  );
});

// ============================================
// MIX BOARD SYSTEM - Discovery Machine Patent 🎛️
// Presets that FEED the HOT/DISCOVERY streams
// User taps = more of that flavor flows through
// Cards get color-coded neon borders from their source mode
// ============================================

// Mix Mode Definition - Each preset on the mixing board
interface MixMode {
  id: string;
  title: string;
  neon: string;      // Primary neon color
  glow: string;      // Glow rgba color
  taglines: string[];
  mood: PlaylistMood;
  textAnimation: TextAnimation;
  keywords: string[]; // Keywords to match tracks to this mode
}

// Mood-based timing configurations (research: Z4)
type PlaylistMood = 'energetic' | 'chill' | 'intense' | 'mysterious' | 'hype';
const moodTimings: Record<PlaylistMood, { taglineDwell: number; glowPulse: number; textTransition: number }> = {
  energetic: { taglineDwell: 2000, glowPulse: 1.5, textTransition: 0.2 },  // Fast, punchy
  chill: { taglineDwell: 4000, glowPulse: 3, textTransition: 0.8 },       // Slow, smooth
  intense: { taglineDwell: 2500, glowPulse: 1.8, textTransition: 0.35 },  // Powerful
  mysterious: { taglineDwell: 3500, glowPulse: 2.5, textTransition: 0.6 }, // Atmospheric
  hype: { taglineDwell: 1800, glowPulse: 1.2, textTransition: 0.15 },     // DJ Khaled energy!
};

// Text animation variants - Canva-inspired (research: Z1)
type TextAnimation = 'slideUp' | 'scaleIn' | 'bounce' | 'rotateIn' | 'typewriter';
// CSS-based text animation config (replaces framer-motion TargetAndTransition)
type AnimationConfig = Record<string, string | number>;
const textAnimationVariants: Record<TextAnimation, { initial: AnimationConfig; animate: AnimationConfig; exit: AnimationConfig }> = {
  slideUp: {
    initial: { y: 20, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit: { y: -20, opacity: 0 },
  },
  scaleIn: {
    initial: { scale: 0.5, opacity: 0 },
    animate: { scale: 1, opacity: 1 },
    exit: { scale: 1.2, opacity: 0 },
  },
  bounce: {
    initial: { y: 30, opacity: 0, scale: 0.8 },
    animate: { y: 0, opacity: 1, scale: 1 },
    exit: { y: -15, opacity: 0, scale: 0.9 },
  },
  rotateIn: {
    initial: { rotateX: 90, opacity: 0 },
    animate: { rotateX: 0, opacity: 1 },
    exit: { rotateX: -90, opacity: 0 },
  },
  typewriter: {
    initial: { opacity: 0, x: -10 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 10 },
  },
};

// DEFAULT MIX MODES - The preset mixing board
//
// Premium palette (April 2026): Afro Heat is the ONLY non-purple — vibrant
// luxury orange close to the OYÉ button bronze. Everything else lives in
// purple fades (light → mid → deep) so the page reads as one calm canvas
// with one hot moment. The Random Mix slot is repurposed as OYO DJ — the
// interactive widget that asks the brain for a curated playlist.
const DEFAULT_MIX_MODES: MixMode[] = [
  {
    id: 'afro-heat',
    title: 'Heating Up RN',
    neon: '#F4A23E',
    glow: 'rgba(244,162,62,0.5)',
    taglines: ["Asambe! 🔥", "Lagos to Accra!", "E Choke! 💥", "Fire on Fire!", "No Wahala!"],
    mood: 'energetic',
    textAnimation: 'bounce',
    keywords: ['afrobeat', 'afro', 'lagos', 'naija', 'amapiano', 'burna', 'davido', 'wizkid'],
  },
  {
    id: 'chill-vibes',
    title: 'Chill Vibes',
    neon: '#c4b5fd',
    glow: 'rgba(196,181,253,0.4)',
    taglines: ["It's Your Eazi...", "Slow Wine Time", "Easy Does It", "Float Away~", "Pon Di Ting"],
    mood: 'chill',
    textAnimation: 'slideUp',
    keywords: ['chill', 'slow', 'r&b', 'soul', 'acoustic', 'mellow', 'relax', 'smooth'],
  },
  {
    id: 'party-mode',
    title: 'Party Mode',
    neon: '#a78bfa',
    glow: 'rgba(167,139,250,0.45)',
    taglines: ["Another One! 🎉", "We The Best!", "Ku Lo Sa!", "Turn Up! 🔊", "Major Vibes Only"],
    mood: 'hype',
    textAnimation: 'scaleIn',
    keywords: ['party', 'dance', 'club', 'edm', 'dj', 'hype', 'turn up', 'banger'],
  },
  {
    id: 'late-night',
    title: 'Late Night',
    neon: '#8b5cf6',
    glow: 'rgba(139,92,246,0.5)',
    taglines: ["Midnight Moods", "After Hours...", "Vibes & Chill", "3AM Sessions", "Lost in Sound"],
    mood: 'mysterious',
    textAnimation: 'rotateIn',
    keywords: ['night', 'dark', 'moody', 'ambient', 'deep', 'late', 'vibe'],
  },
  {
    id: 'workout',
    title: 'Workout',
    neon: '#7c3aed',
    glow: 'rgba(124,58,237,0.55)',
    taglines: ["Beast Mode! 💪", "Pump It Up!", "No Pain No Gain", "Go Harder!", "Maximum Effort!"],
    mood: 'intense',
    textAnimation: 'bounce',
    keywords: ['workout', 'gym', 'fitness', 'pump', 'energy', 'power', 'beast', 'intense'],
  },
];

// Get mode color for a track (used to color-code stream cards)
// Returns color + intensity based on bar count (0-6 bars system)
const getTrackModeColor = (
  trackTitle: string,
  trackArtist: string,
  modes: MixMode[],
  modeBoosts?: Record<string, number>
): { neon: string; glow: string; intensity: number } | null => {
  const searchText = `${trackTitle} ${trackArtist}`.toLowerCase();
  for (const mode of modes) {
    for (const keyword of mode.keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        // Get bar count for this mode (default 1 if no boosts provided)
        const bars = modeBoosts ? (modeBoosts[mode.id] || 0) : 1;
        const intensity = bars / 6; // 0-1 scale (6 bars = max)

        // If mode has 0 bars, it's "starved" - no color coding
        if (bars < 1) return null;

        return {
          neon: mode.neon,
          glow: mode.glow,
          intensity
        };
      }
    }
  }
  return null; // No mode match - no color coding
};

// Community punch type - short comment + emoji that becomes billboard tagline
interface CommunityPunch {
  id: string;
  text: string;
  username: string;
  trackId: string;
  trackTitle: string;
  emoji: string;
}

const NeonBillboardCard = memo(({
  title,
  taglines,
  delay = 0,
  mood = 'energetic',
  textAnimation = 'bounce',
  palette = 'purple',
  onClick,
  onDragToQueue, // Callback when card is dragged up to queue
  onDoubleTap, // NEW: Double-tap to create reaction
  isActive = false,
  boostLevel = 0, // 0-6 bars - manual preference
  queueMultiplier = 1, // x1-x5 - queue behavior multiplier
  communityPulseCount = 0, // NEW: Live pulse from community reactions
  reactionEmoji = '🔥', // NEW: Emoji for this category
  communityPunches = [], // NEW: Community-contributed punches
  onPunchClick, // NEW: Navigate to track when punch is clicked
}: {
  title: string;
  taglines: string[];
  delay?: number;
  mood?: PlaylistMood;
  textAnimation?: TextAnimation;
  /** v840: card color language. 'purple' is the unified VOYO default;
   *  'gronze' (bronze-orange-gold) is reserved for Heating Up RN. */
  palette?: 'purple' | 'gronze';
  onClick?: () => void;
  onDragToQueue?: () => void; // "Give me this vibe NOW" - drag to add matching tracks
  onDoubleTap?: () => void; // Double-tap = reaction to community
  isActive?: boolean;
  boostLevel?: number;
  queueMultiplier?: number; // x1-x5 based on queue dominance
  communityPulseCount?: number; // Live reactions from community
  reactionEmoji?: string; // Category emoji
  communityPunches?: CommunityPunch[]; // Community-contributed taglines
  onPunchClick?: (punch: CommunityPunch) => void; // Navigate to track
}) => {
  const [currentTagline, setCurrentTagline] = useState(0);
  const [showTapBurst, setShowTapBurst] = useState(false);
  const [isDraggingToQueue, setIsDraggingToQueue] = useState(false);
  const [showQueuedFeedback, setShowQueuedFeedback] = useState(false);
  // Swipe-up-to-bucket gesture
  const neonSwipeStartRef = useRef<{ y: number } | null>(null);
  const [showReactionFeedback, setShowReactionFeedback] = useState(false); // NEW: Double-tap feedback
  const [flyingEmoji, setFlyingEmoji] = useState<string | null>(null); // NEW: Flying emoji animation
  const lastTapTimeRef = useRef(0); // NEW: For double-tap detection
  const cardRef = useRef<HTMLButtonElement>(null);
  const [isInView, setIsInView] = useState(true);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setIsInView(entry.isIntersecting), { rootMargin: '-10%' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Mix community punches with static taglines - community first!
  type TaglineItem = { type: 'static'; text: string } | { type: 'punch'; punch: CommunityPunch };
  const allTaglines: TaglineItem[] = useMemo(() => {
    const items: TaglineItem[] = [];
    // Add community punches first (they take priority)
    communityPunches.forEach(punch => {
      items.push({ type: 'punch', punch });
    });
    // Then add static taglines
    taglines.forEach(text => {
      items.push({ type: 'static', text });
    });
    return items;
  }, [communityPunches, taglines]);

  // Current item being displayed
  const currentItem = allTaglines[currentTagline % allTaglines.length];
  const isPunch = currentItem?.type === 'punch';

  // NEW: Community pulse effect - glow intensifies when others react
  const [communityGlow, setCommunityGlow] = useState(0);
  useEffect(() => {
    if (communityPulseCount > 0) {
      setCommunityGlow(1);
      const timer = setTimeout(() => setCommunityGlow(0), 2000);
      return () => clearTimeout(timer);
    }
  }, [communityPulseCount]);

  // STARVING LOGIC: 0 bars = dying, 6 bars = BLAZING
  const isStarving = boostLevel === 0;
  const barRatio = boostLevel / 6; // 0-1 scale
  const isFull = boostLevel >= 6;

  // v840 (Dash 2026-04-29 "I dont think I like the effect on the mix
  // boards card... they match Old Voyo not the New"). New language:
  //   - boost 0  : contoured / outlined card, neutral grey, transparent
  //   - boost 1+ : palette tint rises with the bar — purple by default,
  //                bronze-gold ("gronze") for Heating Up RN
  //   - boost 6  : GOLDEN. Out of shadow → glow → flow → boom golden.
  // Replaces the 5-layer neon halo per card with a single coherent
  // state-driven treatment so the whole rail reads as one rhythm
  // instead of six different colors fighting for attention.
  //
  // `neon` stays a hex string (the rest of the card concatenates
  // `${neon}40` alpha-suffix tricks for inner effects); `glow` is a
  // hex+alpha string built from the same seed. The state machine
  // chooses the seed:
  //   starving → neutral grey
  //   1-5      → palette base (purple or gronze)
  //   6        → bronze-gold accent (the "boom golden" peak)
  const purpleHex = '#a78bfa';
  const gronzeHex = '#F4A23E';
  const goldHex   = '#D4A053';
  const neutralHex = '#9a9aa8';
  const baseHex = palette === 'gronze' ? gronzeHex : purpleHex;
  const neon = isStarving ? neutralHex : (isFull ? goldHex : baseHex);
  const seedRgb = isFull ? '212,160,83' : (palette === 'gronze' ? '244,162,62' : '167,139,250');
  // glowAlpha still drives the inner-content drop-shadows
  // (corner brackets, text glow). Ring/fill alphas retired with the
  // parent box-shadow path in v841.
  const glowAlpha = isStarving ? 0 : 0.18 + barRatio * 0.30;
  const glow = `rgba(${seedRgb},${glowAlpha})`;

  // Adjust timing based on energy level - starving = slow, boosted = fast
  const baseTiming = moodTimings[mood];
  const timing = {
    ...baseTiming,
    taglineDwell: isStarving ? 8000 : baseTiming.taglineDwell / (0.5 + barRatio), // Slower when starving
    glowPulse: isStarving ? 6 : baseTiming.glowPulse / (0.5 + barRatio * 0.5), // Slower pulse
    textTransition: isStarving ? 0.8 : baseTiming.textTransition,
  };

  // Calculate glow intensity - starving = dim, boosted = BRIGHT
  const glowIntensity = isStarving ? 0.2 : (0.4 + barRatio * 0.8); // 0.2 when dead, up to 1.2 when maxed

  // Smart visibility: Only animate when in view (research: Z5)
  useEffect(() => {
    if (!isInView || allTaglines.length === 0) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const timer = setTimeout(() => {
      // CRITICAL: assign to outer-scope var so the cleanup can clear it.
      // The previous version's `return () => clearInterval(interval)` was
      // INSIDE the setTimeout callback — captured by setTimeout (which
      // returns void), not by useEffect. Result: the interval kept running
      // forever after unmount. Memory leak + always-on timer.
      interval = setInterval(() => {
        setCurrentTagline(prev => (prev + 1) % allTaglines.length);
      }, timing.taglineDwell);
    }, delay * 1000);
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [allTaglines.length, delay, timing.taglineDwell, isInView]);

  // v841: cardShadow retired. Surface treatment moved to 3 absolute
  // layers below; opacity crossfades between them based on state.
  // GPU-composited, no repaint cascade, glitch-free.

  // (Startup flicker state removed 2026-04-28 — never read, dead code.)

  return (
    <button
      ref={cardRef}
      className="flex-shrink-0 w-32 h-16 rounded-lg relative overflow-hidden group"
      onPointerDown={(e) => { neonSwipeStartRef.current = { y: e.clientY }; }}
      onPointerUp={(e) => {
        if (neonSwipeStartRef.current) {
          const dy = e.clientY - neonSwipeStartRef.current.y;
          neonSwipeStartRef.current = null;
          // Swipe up → bucket this vibe
          if (dy < -35 && onDragToQueue) {
            setIsDraggingToQueue(true);
            setShowQueuedFeedback(true);
            try { navigator.vibrate?.([15, 8, 15]); } catch {}
            onDragToQueue();
            setTimeout(() => { setIsDraggingToQueue(false); setShowQueuedFeedback(false); }, 600);
            return;
          }
        }
      }}
      onPointerCancel={() => { neonSwipeStartRef.current = null; }}
      onClick={() => {
        if (isDraggingToQueue) return; // Don't trigger tap if we just dragged

        const now = Date.now();
        const timeSinceLastTap = now - lastTapTimeRef.current;
        lastTapTimeRef.current = now;

        // DOUBLE-TAP DETECTION (< 300ms between taps)
        if (timeSinceLastTap < 300 && onDoubleTap) {
          haptics?.success?.();
          setFlyingEmoji(reactionEmoji);
          setShowReactionFeedback(true);
          setTimeout(() => {
            setFlyingEmoji(null);
            setShowReactionFeedback(false);
          }, 1500);
          onDoubleTap();
          return;
        }

        // Single tap = boost mode
        setShowTapBurst(true);
        setTimeout(() => setShowTapBurst(false), 400);
        onClick?.();
      }}
      style={{
        // v841 (Dash 2026-04-29 "glitches a bit, can do better"): the
        // parent no longer animates background + box-shadow together —
        // those are repaint-heavy and were the source of the glitch.
        // Three absolute layers below each carry a fixed treatment;
        // we crossfade between them via opacity (GPU-composited,
        // sub-frame smooth). Parent stays a quiet shell.
        background: 'rgba(8,8,12,0.96)',
        opacity: isInView ? (isActive ? 1 : 0.94) : 0.3,
        transition: 'opacity 500ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* v841 SURFACE LAYERS — pure opacity crossfade. willChange:opacity
          hints the compositor to keep these on their own GPU layer so
          repaints don't cascade. The empty layer is always at 1 (the
          baseline); boosted fades in on top with barRatio strength;
          full fades in last to cap with the golden treatment. */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.025) 0%, rgba(8,8,12,0.96) 45%, rgba(3,3,5,0.99) 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
          opacity: 1,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{
          background: `linear-gradient(135deg, rgba(${seedRgb},0.22) 0%, rgba(8,8,12,0.96) 45%, rgba(3,3,5,0.99) 100%)`,
          boxShadow: `inset 0 0 0 1px rgba(${seedRgb},0.55), 0 0 22px rgba(${seedRgb},0.32), 0 0 44px rgba(${seedRgb},0.14)`,
          opacity: isFull ? 0 : (isStarving ? 0 : 0.45 + barRatio * 0.55),
          transition: 'opacity 500ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'opacity',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(212,160,83,0.26) 0%, rgba(8,8,12,0.96) 45%, rgba(3,3,5,0.99) 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(212,160,83,0.7), 0 0 30px rgba(212,160,83,0.42), 0 0 56px rgba(212,160,83,0.18)',
          opacity: isFull ? 1 : 0,
          transition: 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'opacity',
        }}
      />

      {/* TAP BURST - Flash effect on boost tap */}
      
        {showTapBurst && (
          <div
            className="absolute inset-0 pointer-events-none z-20 rounded-lg"
            style={{
              background: `radial-gradient(circle at center, ${neon}40 0%, transparent 70%)`,
              boxShadow: `0 0 30px ${glow}, 0 0 60px ${glow}`,
              }}
          />
        )}
      

      {/* QUEUED FEEDBACK - Shows after drag-to-queue */}
      
        {showQueuedFeedback && (
          <div
            className="absolute -top-8 left-1/2 -translate-x-1/2 z-50"
          >
            <div
              className="text-[9px] font-bold px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap flex items-center gap-1"
              style={{
                background: `linear-gradient(135deg, ${neon}, ${glow})`,
                color: '#000',
                boxShadow: `0 0 12px ${glow}, 0 0 24px ${glow}`,
                }}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Bucketed!
            </div>
          </div>
        )}
      

      {/* REACTION FEEDBACK - Flying emoji on double-tap */}
      
        {flyingEmoji && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none"
          >
            <span className="text-3xl">{flyingEmoji}</span>
          </div>
        )}
      

      {/* REACTION BADGE - Shows "OYÉ!" on double-tap */}
      
        {showReactionFeedback && (
          <div
            className="absolute -top-8 left-1/2 -translate-x-1/2 z-50"
          >
            <div
              className="text-[10px] font-black px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap"
              style={{
                background: `linear-gradient(135deg, ${neon}, ${glow})`,
                color: '#000',
                boxShadow: `0 0 15px ${glow}, 0 0 30px ${glow}`,
                }}
            >
              OYÉ! 🎉
            </div>
          </div>
        )}
      

      {/* COMMUNITY PULSE - Glow intensifies when others react */}
      
        {communityGlow > 0 && (
          <div
            className="absolute inset-0 rounded-lg pointer-events-none z-30"
            style={{
              boxShadow: `0 0 40px ${neon}, 0 0 80px ${glow}`,
              border: `2px solid ${neon}`,
              }}
          />
        )}
      

      {/* Subtle inner reflection - glass feel */}
      <div
        className="absolute inset-x-0 top-0 h-1/3 pointer-events-none rounded-t-lg"
        style={{
          background: `linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%)`,
          }}
      />

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-2">
        {/* Title - dynamic treatment per mood.
            Energetic (Heating Up RN): heat shimmer effect — the text
            subtly waves like hot air rising. Other moods: static neon glow. */}
        <div
          className="text-[11px] font-black tracking-wider uppercase"
          style={{
            color: neon,
            textShadow: `
              0 0 5px ${neon},
              0 0 10px ${glow},
              0 0 20px ${glow}
            `,
            // Heat shimmer: subtle Y-axis distortion on energetic cards
            ...(mood === 'energetic' ? {
              animation: 'voyo-heat-shimmer 2s ease-in-out infinite',
              filter: `drop-shadow(0 0 8px ${glow})`,
            } : {}),
            }}
        >
          {title}
        </div>

        {/* Animated Tagline - Canva-style with mood timing + Community Punches */}
        <div className="h-4 relative overflow-hidden w-full mt-1" style={{ perspective: '100px' }}>
          
            <div
              key={currentTagline}
              className="absolute inset-0 flex items-center justify-center"
            >
              {isPunch && currentItem.type === 'punch' ? (
                // Community Punch - clickable, navigates to track
                <button
                  className="text-[8px] font-bold tracking-wide whitespace-nowrap flex items-center gap-0.5 hover:scale-105 transition-transform"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPunchClick?.(currentItem.punch);
                    }}
                  style={{
                    color: 'rgba(255,255,255,0.95)',
                    textShadow: `
                      0 0 4px ${glow},
                      0 0 8px ${glow}
                    `,
                  }}
                >
                  <span className="opacity-60">@{currentItem.punch.username.slice(0, 6)}</span>
                  <span className="mx-0.5">·</span>
                  <span>{currentItem.punch.text}</span>
                </button>
              ) : (
                // Static tagline
                <span
                  className="text-[8px] font-bold tracking-wide whitespace-nowrap"
                  style={{
                    color: 'rgba(255,255,255,0.85)',
                    textShadow: `
                      0 0 4px ${glow},
                      0 0 8px ${glow}
                    `,
                    }}
                >
                  {currentItem?.type === 'static' ? currentItem.text : ''}
                </span>
              )}
            </div>
          
        </div>
      </div>

      {/* Corner brackets - Enhanced cyberpunk style (research: Z6) */}
      {[
        { pos: 'top-0 left-0', border: 'borderTop borderLeft' },
        { pos: 'top-0 right-0', border: 'borderTop borderRight' },
        { pos: 'bottom-0 left-0', border: 'borderBottom borderLeft' },
        { pos: 'bottom-0 right-0', border: 'borderBottom borderRight' },
      ].map((corner, idx) => (
        <div
          key={idx}
          className={`absolute ${corner.pos} w-2.5 h-2.5`}
          style={{
            opacity: isStarving ? 0.2 : 0.5,
            borderTop: corner.border.includes('borderTop') ? `2px solid ${neon}` : 'none',
            borderBottom: corner.border.includes('borderBottom') ? `2px solid ${neon}` : 'none',
            borderLeft: corner.border.includes('borderLeft') ? `2px solid ${neon}` : 'none',
            borderRight: corner.border.includes('borderRight') ? `2px solid ${neon}` : 'none',
            filter: isStarving ? 'none' : `drop-shadow(0 0 ${3 * glowIntensity}px ${glow})`,
            }}
        />
      ))}

      {/* BOOST LEVEL INDICATOR - Volume Icon (0-6 bars) */}
      <div className="absolute bottom-1 right-1 flex items-end gap-[1px]">
        {[1, 2, 3, 4, 5, 6].map((barNum) => {
          const isActive = boostLevel >= barNum; // Direct bar count comparison
          return (
            <div
              key={barNum}
              className="rounded-[1px]"
              style={{
                width: '2px',
                height: `${2 + barNum * 1.5}px`, // 3.5, 5, 6.5, 8, 9.5, 11px - ascending
                background: isActive ? neon : 'rgba(255,255,255,0.12)',
                boxShadow: isActive ? `0 0 3px ${glow}` : 'none',
                opacity: isActive ? 1 : 0.2,
              }}
            />
          );
        })}
      </div>

      {/* QUEUE MULTIPLIER BADGE - x2, x3, x4, x5 when queue is dominated by this mode */}
      {queueMultiplier > 1 && (
        <div
          className="absolute top-1 left-1 px-1 py-0.5 rounded text-[7px] font-black"
          style={{
            background: `linear-gradient(135deg, ${neon}, ${glow})`,
            color: '#000',
            textShadow: '0 0 2px rgba(255,255,255,0.5)',
            boxShadow: `0 0 6px ${glow}, 0 0 12px ${glow}`,
            }}
        >
          x{queueMultiplier}
        </div>
      )}

      {/* ACTIVE INDICATOR - Pulsing dot when mode is feeding the streams */}
      {isActive && (
        <div
          className="absolute top-1 right-1 w-2 h-2 rounded-full"
          style={{
            background: neon,
            boxShadow: `0 0 6px ${neon}, 0 0 10px ${glow}`,
            }}
        />
      )}
    </button>
  );
});

// ============================================
// FULLSCREEN BACKGROUND LAYER - Album art with dark overlay
// Creates the "floating in space" atmosphere
// ============================================
const FullscreenBackground = memo(({ trackId }: { trackId?: string }) => {
  if (!trackId) return null;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {/* Album art - blurred and scaled up for cinematic effect */}
      
        <div
          className="absolute inset-0 animate-voyo-fade-in-slow"
          key={trackId}
        >
          <SmartImage
            src={getThumbnailUrl(trackId, 'max')}
            fallbackSrc={getThumbnailUrl(trackId, 'high')}
            alt="Background"
            className="w-full h-full object-cover blur-2xl scale-110 will-change-transform"
            trackId={trackId}
            lazy={false}
          />
        </div>
      

      {/* Dark overlay gradient - makes reactions POP */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(
            to bottom,
            rgba(2, 2, 3, 0.75) 0%,
            rgba(2, 2, 3, 0.65) 30%,
            rgba(2, 2, 3, 0.70) 60%,
            rgba(2, 2, 3, 0.85) 100%
          )`
          }}
      />

      {/* Extra vignette for depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.4) 100%)'
          }}
      />

      {/* Subtle color tint from album dominant color (approximated with purple) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.3) 0%, rgba(99, 102, 241, 0.2) 50%, rgba(219, 39, 119, 0.2) 100%)',
          mixBlendMode: 'overlay',
          }}
      />
    </div>
  );
});

// ============================================
// BACKDROP TOGGLE - Two-state with double-click/hold for library
// ============================================
const BackdropToggle = memo(({
  isEnabled,
  onToggle,
  onOpenLibrary,
}: {
  isEnabled: boolean;
  onToggle: () => void;
  onOpenLibrary: () => void;
}) => {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCount = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  const handlePressStart = () => {
    // Start hold timer - 500ms to trigger library
    holdTimer.current = setTimeout(() => {
      onOpenLibrary();
      holdTimer.current = null;
    }, 500);
  };

  const handlePressEnd = () => {
    // If hold timer is still active, it was a quick tap
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const handleClick = () => {
    clickCount.current++;

    if (clickCount.current === 1) {
      // Start timer for double-click detection
      clickTimer.current = setTimeout(() => {
        // Single click - toggle backdrop
        if (clickCount.current === 1) {
          onToggle();
        }
        clickCount.current = 0;
      }, 250);
    } else if (clickCount.current === 2) {
      // Double click - open library
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
      }
      clickCount.current = 0;
      onOpenLibrary();
    }
  };

  return (
    <button
      onClick={handleClick}
      onMouseDown={handlePressStart}
      onMouseUp={handlePressEnd}
      onMouseLeave={handlePressEnd}
      onTouchStart={handlePressStart}
      onTouchEnd={handlePressEnd}
      className="absolute left-4 top-1/2 -translate-y-1/2 z-50 group min-w-[44px] min-h-[44px]"
      aria-label={isEnabled ? 'Disable video backdrop' : 'Enable video backdrop'}
    >
      {/* Vertical pill container */}
      <div className={`
        relative w-9 h-[72px] rounded-full
        backdrop-blur-xl border transition-all duration-300
        ${isEnabled
          ? 'bg-purple-500/15 border-purple-500/30 shadow-[0_0_25px_rgba(147,51,234,0.25)]'
          : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
        }
      `}>
        {/* Toggle knob - slides between OFF and ON */}
        <div
          className={`
            absolute left-1/2 -translate-x-1/2 w-7 h-7 rounded-full
            flex items-center justify-center transition-colors duration-300
            ${isEnabled
              ? 'bg-gradient-to-br from-purple-500 to-indigo-600 shadow-[0_0_15px_rgba(147,51,234,0.7)]'
              : 'bg-white/15 border border-white/20'
            }
          `}
        >
          {/* Icon changes based on state */}
          <div
          >
            {isEnabled ? (
              <Film size={13} className="text-white" />
            ) : (
              <div className="w-3 h-0.5 bg-gray-400 rounded-full" />
            )}
          </div>
        </div>

        {/* Labels - rotated on side */}
        <div className="absolute -left-0.5 top-2 text-[5px] font-black text-gray-500/60 tracking-[0.15em] -rotate-90 origin-bottom-left uppercase">
          off
        </div>
        <div className="absolute -left-0.5 bottom-7 text-[5px] font-black text-purple-400/80 tracking-[0.15em] -rotate-90 origin-bottom-left uppercase">
          bg
        </div>
      </div>

      {/* Tooltip on hover */}
      <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="bg-black/80 backdrop-blur-sm text-white text-[9px] px-2 py-1.5 rounded-lg whitespace-nowrap border border-white/10">
          <span className="font-medium">{isEnabled ? 'Backdrop On' : 'Backdrop Off'}</span>
          <div className="text-[7px] text-gray-400 mt-0.5">Hold or 2× tap for library</div>
        </div>
      </div>
    </button>
  );
});

// ============================================
// BACKDROP LIBRARY MODAL - Choose from presets or custom
// ============================================
const BackdropLibrary = ({
  isOpen,
  onClose,
  currentBackdrop,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentBackdrop: string;
  onSelect: (backdrop: string) => void;
}) => {
  if (!isOpen) return null;

  const backdrops = [
    { id: 'album', name: 'Album Art', preview: '🎵', type: 'dynamic' },
    { id: 'gradient-purple', name: 'Purple Wave', preview: '🟣', type: 'animated' },
    { id: 'gradient-ocean', name: 'Ocean Dream', preview: '🔵', type: 'animated' },
    { id: 'gradient-sunset', name: 'Sunset Fire', preview: '🟠', type: 'animated' },
    { id: 'gradient-aurora', name: 'Aurora', preview: '🟢', type: 'animated' },
    { id: 'particles', name: 'Particle Storm', preview: '✨', type: 'animated' },
    { id: 'video', name: 'Music Video', preview: '🎬', type: 'video', locked: true },
  ];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center"
      data-no-canvas-swipe="true"
    >
      {/* Backdrop overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Library panel */}
      <div
        className="relative w-full max-w-md bg-[#111114]/95 backdrop-blur-xl border-t border-[#28282f] rounded-t-3xl p-6 pb-10"
      >
        {/* Handle */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1 bg-white/20 rounded-full" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white">Backdrop Library</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Close backdrop library"
          >
            <Plus size={16} className="text-gray-400 rotate-45" />
          </button>
        </div>

        {/* Grid of backdrops */}
        <div className="grid grid-cols-3 gap-3">
          {backdrops.map((bd) => (
            <button
              key={bd.id}
              onClick={() => !bd.locked && onSelect(bd.id)}
              className={`
                relative aspect-square rounded-2xl overflow-hidden border-2 transition-all
                ${currentBackdrop === bd.id
                  ? 'border-purple-500 shadow-[0_0_20px_rgba(147,51,234,0.4)]'
                  : 'border-white/10 hover:border-white/30'
                }
                ${bd.locked ? 'opacity-50' : ''}
              `}
            >
              {/* Preview */}
              <div
                className="absolute inset-0 flex items-center justify-center text-3xl"
                style={{
                  background: bd.id.includes('gradient')
                    ? `linear-gradient(135deg, ${
                        bd.id === 'gradient-purple' ? '#7c3aed, #5b21b6' :
                        bd.id === 'gradient-ocean' ? '#4c1d95, #6d28d9' :
                        bd.id === 'gradient-sunset' ? '#7c3aed, #4c1d95' :
                        '#6d28d9, #8b5cf6'
                      })`
                    : bd.id === 'particles' ? '#1a1a2e' :
                    bd.id === 'album' ? 'linear-gradient(135deg, #1e1b4b, #0f172a)' :
                    '#111'
                    }}
              >
                {bd.preview}
              </div>

              {/* Type badge */}
              <div className="absolute top-2 right-2">
                <span className={`
                  text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full
                  ${bd.type === 'animated' ? 'bg-violet-500/30 text-violet-300' :
                    bd.type === 'video' ? 'bg-violet-500/20 text-violet-200' :
                    'bg-purple-500/30 text-purple-300'
                  }
                `}>
                  {bd.type}
                </span>
              </div>

              {/* Lock icon */}
              {bd.locked && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <span className="text-xl">🔒</span>
                </div>
              )}

              {/* Selected checkmark */}
              {currentBackdrop === bd.id && (
                <div className="absolute bottom-2 right-2 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}

              {/* Name */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
                <span className="text-[9px] font-bold text-white">{bd.name}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Coming soon note */}
        <div className="mt-4 text-center">
          <span className="text-[10px] text-gray-500">
            Tap any backdrop to apply
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================
// MINI PLAYER TOGGLE — single unified toggle. Collapsed label to
// "Mini Player" (was dual "Video"/"Mini Player") so users aren't
// weighing two verbs at mid-tap. Always wears the purple-glow live-dot
// treatment; `isIframeAudio` drives the pulse.
//
// DIM coupled to the app's activity signal (controlsActive — derived
// from isControlsRevealed up top). While controls are revealed, the
// button is fully active; when controls hide, dim decay starts:
//   · 5s after controls hide  → enter DIMMED MODE (smaller padding +
//     softer glow + shorter contour). Structural recede, not opacity.
//   · 30s after controls hide → further fade to 80% opacity.
// Any tap / reveal resets both timers — the button breathes with the
// rest of the UI instead of running on its own mount-time clock.
// ============================================
const ExpandVideoButton = memo(({ onClick, isIframeAudio, isMiniPlayerActive, controlsActive }: { onClick: () => void; isIframeAudio: boolean; isMiniPlayerActive: boolean; controlsActive: boolean }) => {
  const [mode, setMode] = useState<'active' | 'dimmed'>('active');
  const [extraFaded, setExtraFaded] = useState(false);
  // Phase machine: 'mini' = default (purple, "Mini Player"), 'morphing'
  // = single purple pulse during text crossfade, 'takeout' = settled
  // orange ("Take Out", taps go to PiP). Triggered by isMiniPlayerActive
  // flipping true with a brief gap to let the user see the mini player
  // engage first.
  const [phase, setPhase] = useState<'mini' | 'morphing' | 'takeout'>('mini');
  useEffect(() => {
    if (controlsActive) {
      setMode('active');
      setExtraFaded(false);
      return;
    }
    const t1 = setTimeout(() => setMode('dimmed'), 5000);
    const t2 = setTimeout(() => setExtraFaded(true), 30000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [controlsActive]);

  // Mini Player → Take Out morph. 5s gap after mini engages (let user
  // enjoy the video first), 0.9s morph window (text fade + single
  // purple pulse), then settle to orange Take Out. Reverses cleanly
  // if user closes the mini player.
  useEffect(() => {
    if (!isMiniPlayerActive) {
      setPhase('mini');
      return;
    }
    const t1 = setTimeout(() => setPhase('morphing'), 5000);
    const t2 = setTimeout(() => setPhase('takeout'), 5000 + 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isMiniPlayerActive]);

  // When Take Out becomes ready (chip settles to orange), Oyo drops an
  // ambient one-liner in the Dynamic Island. Random pick from a small
  // bag, fires once per mini-player session (gated by the phase machine
  // which itself resets on isMiniPlayerActive flip).
  useEffect(() => {
    if (phase !== 'takeout') return;
    const lines = [
      "I'm ready",
      "Let's go",
      "Ready",
      "Zouu where we going snap?",
      "Pocket time",
      "Let's roll",
    ];
    const text = lines[Math.floor(Math.random() * lines.length)];
    try {
      window.pushNotification?.({
        id: `takeout-ready-${Date.now()}`,
        type: 'system',
        title: 'Oyo',
        subtitle: text,
      });
    } catch { /* never break */ }
    // v915 — dep was the boolean `phase === 'takeout'`. React lints
    // this for a reason: the effect captures `phase` from closure but
    // re-runs only on the boolean change. Worked by accident; key on
    // `phase` directly and gate inside (already done above).
  }, [phase]);

  // After Take Out settles for ~2.2s, park the chip (fade out from the
  // card spot). User has seen the morph; the bottom-right rising chip
  // takes over for subsequent invocations. Resets if mini player closes.
  const [parked, setParked] = useState(false);
  useEffect(() => {
    if (phase !== 'takeout') {
      setParked(false);
      return;
    }
    const t = setTimeout(() => setParked(true), 2200);
    return () => clearTimeout(t);
  }, [phase]);

  const isDimmed = mode === 'dimmed';
  const isTakeout = phase === 'takeout' || phase === 'morphing';
  const isOrange = phase === 'takeout';

  const handleClick = () => {
    if (phase === 'takeout') {
      // v797 (Dash 2026-04-29): Take Out reverted to system PiP — the
      // cinema rerouting from v782 was a misread on my end. PiP is the
      // canonical Take Out behavior; Cinema/VideoMode is a separate
      // experience invoked via other paths (landscape rotation etc.).
      void pipService.enter();
    } else {
      onClick();
    }
  };

  // 2026-04-28: matured palette — Mini state = neutral glass (matches the
  // reaction-bar siblings, signals "available"); Take Out state = bronze
  // (signals "ready to commit to the full experience"). Was purple → orange
  // which read as kid-style and clashed with the rest of the matured UI.
  // The phase contrast (cool → warm) still reads as a clear progression.
  const borderClass = isOrange ? 'border-[rgba(212,160,83,0.55)]' : 'border-white/15';
  const borderClassDim = isOrange ? 'border-[rgba(212,160,83,0.35)]' : 'border-white/10';

  return (
    <>
      <style>{`
        @keyframes voyo-takeout-morph-pulse {
          0%   { box-shadow: 0 0 14px rgba(255,255,255,0.18), 0 0 22px rgba(255,255,255,0.10); }
          50%  { box-shadow: 0 0 22px rgba(230,197,138,0.55), 0 0 36px rgba(212,160,83,0.30); }
          100% { box-shadow: 0 0 14px rgba(212,160,83,0.45), 0 0 24px rgba(212,160,83,0.22); }
        }
      `}</style>
      <button
        onClick={handleClick}
        className={`absolute top-3 right-3 z-30 rounded-full backdrop-blur-sm border text-white font-medium flex items-center active:scale-95 min-h-[44px] ${
          isDimmed
            ? `px-2 py-1 gap-1 text-[10px] ${borderClassDim}`
            : `px-3 py-1.5 gap-1.5 text-xs ${borderClass}`
        }`}
        style={{
          background: isOrange
            ? (isDimmed ? 'rgba(212,160,83,0.14)' : 'rgba(212,160,83,0.20)')
            : (isDimmed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.07)'),
          boxShadow:
            phase === 'morphing'
              ? undefined  // owned by the keyframe
              : isOrange
                ? (isDimmed
                    ? '0 0 8px rgba(212,160,83,0.25), 0 0 14px rgba(212,160,83,0.12)'
                    : '0 0 14px rgba(212,160,83,0.45), 0 0 24px rgba(212,160,83,0.22)')
                : (isDimmed
                    ? '0 0 6px rgba(255,255,255,0.10), 0 0 12px rgba(255,255,255,0.05)'
                    : '0 0 12px rgba(255,255,255,0.18), 0 0 22px rgba(255,255,255,0.08)'),
          animation:
            phase === 'morphing'
              ? 'voyo-takeout-morph-pulse 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards'
              : (isIframeAudio && !isDimmed && phase === 'mini'
                  ? 'voyo-iframe-pulse 1.6s ease-in-out infinite'
                  : 'none'),
          // v820 (Dash 2026-04-29 "system must self express"): hide the
          // "Mini Player" affordance during the pre-mini phase. Tap-
          // cycle on the artwork (v819) already engages video; the
          // chip was redundant noise. Show only once the chip has
          // morphed to "Take Out" — that's the PiP escalation, which
          // genuinely needs an affordance since gesture-discovery
          // doesn't reach system PiP.
          opacity: parked ? 0 : (phase === 'mini' ? 0 : (extraFaded ? 0.8 : 1)),
          pointerEvents: parked || phase === 'mini' ? 'none' : 'auto',
          transition: [
            'padding 700ms cubic-bezier(0.16, 1, 0.3, 1)',
            'background 700ms cubic-bezier(0.16, 1, 0.3, 1)',
            phase === 'morphing'
              ? 'box-shadow 0ms linear'
              : 'box-shadow 700ms cubic-bezier(0.16, 1, 0.3, 1)',
            'border-color 700ms cubic-bezier(0.16, 1, 0.3, 1)',
            'font-size 700ms cubic-bezier(0.16, 1, 0.3, 1)',
            'opacity 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
            'color 700ms cubic-bezier(0.16, 1, 0.3, 1)',
          ].join(', '),
          color: isOrange ? '#E6C58A' : '#fff',
        }}
        aria-label={isTakeout ? 'Take Out — Picture-in-Picture' : 'Open mini player'}
      >
        <span
          className={`rounded-full ${isDimmed ? 'w-1 h-1' : 'w-1.5 h-1.5'}`}
          style={{
            background: isOrange ? '#E6C58A' : 'rgba(255,255,255,0.85)',
            boxShadow: isOrange
              ? (isDimmed ? '0 0 4px rgba(212,160,83,0.65)' : '0 0 6px rgba(212,160,83,0.9)')
              : (isDimmed ? '0 0 4px rgba(255,255,255,0.5)' : '0 0 6px rgba(255,255,255,0.7)'),
            transition: 'box-shadow 900ms cubic-bezier(0.16, 1, 0.3, 1), background-color 900ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
        <Play size={isDimmed ? 10 : 12} fill="currentColor" />
        {/* Text crossfade — both labels stacked, opacity swaps. */}
        <span style={{ position: 'relative', display: 'inline-block', minWidth: isDimmed ? 56 : 64 }}>
          <span
            style={{
              position: 'absolute', inset: 0,
              opacity: isTakeout ? 0 : 1,
              transition: 'opacity 700ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >Mini Player</span>
          <span
            style={{
              position: 'absolute', inset: 0,
              opacity: isTakeout ? 1 : 0,
              transition: 'opacity 700ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >Take Out</span>
          <span style={{ visibility: 'hidden' }}>Mini Player</span>
        </span>
      </button>
    </>
  );
});

// ============================================
// BOTTOM TAKE OUT CHIP — rises from bottom-right when user scrolls
// to the mix-board area. After 5s settled, morphs into a compact 44×44
// circular pill (dot + play glyph) — still visible, still tappable, just
// less chrome. Was a 7%-opacity ghost which read as broken AND was a
// silent tap trap. Pill state replaces decay state.
// ============================================
const BottomTakeOutChip = memo(({ portalProgress }: { portalProgress: number }) => {
  const [compact, setCompact] = useState(false);
  // riseProgress: 0 below 0.2, 1 by 0.45 — rises in tandem with the
  // mix-board layer climbing into view.
  const riseProgress = Math.max(0, Math.min(1, (portalProgress - 0.2) / 0.25));
  const risen = riseProgress >= 1;

  useEffect(() => {
    if (!risen) {
      setCompact(false);
      return;
    }
    const t = setTimeout(() => setCompact(true), 5000);
    return () => clearTimeout(t);
  }, [risen]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        // v797: reverted to PiP — Take Out is the PiP gesture, full stop.
        void pipService.enter();
      }}
      aria-label="Take Out — Picture-in-Picture"
      className="rounded-full backdrop-blur-sm border flex items-center justify-center voyo-tap-scale"
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        right: 'calc(env(safe-area-inset-right, 0px) + 14px)',
        padding: compact ? 0 : '6px 12px',
        // 2026-04-28: matured to bronze (#D4A053 family) to harmonize with
        // the rest of the Take Out / Cinema palette in ExpandVideoButton.
        // Was rgba(244,162,62,...) — too saturated against the new theme.
        background: 'rgba(212,160,83,0.20)',
        border: '1.5px solid rgba(212,160,83,0.55)',
        color: '#E6C58A',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        boxShadow: compact
          ? '0 0 8px rgba(212,160,83,0.30)'
          : '0 0 14px rgba(212,160,83,0.45), 0 0 24px rgba(212,160,83,0.20)',
        minHeight: 44,
        width: compact ? 44 : 'auto',
        zIndex: 70,
        opacity: compact ? 0.82 : riseProgress,
        transform: `translateY(${(1 - riseProgress) * 36}px)`,
        pointerEvents: riseProgress > 0.5 ? 'auto' : 'none',
        transition: [
          'opacity 320ms ease',
          'transform 360ms cubic-bezier(0.16, 1, 0.3, 1)',
          'width 420ms cubic-bezier(0.16, 1, 0.3, 1)',
          'padding 420ms cubic-bezier(0.16, 1, 0.3, 1)',
          'box-shadow 320ms ease',
        ].join(', '),
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#E6C58A',
          boxShadow: '0 0 6px rgba(212,160,83,0.9)',
          marginRight: compact ? 0 : 6,
          maxWidth: compact ? 0 : 6,
          opacity: compact ? 0 : 1,
          transition: 'margin 380ms cubic-bezier(0.16, 1, 0.3, 1), max-width 380ms cubic-bezier(0.16, 1, 0.3, 1), opacity 240ms ease',
        }}
      />
      <Play size={compact ? 14 : 12} fill="currentColor" style={{ flexShrink: 0, transition: 'width 320ms ease, height 320ms ease' }} />
      <span
        style={{
          opacity: compact ? 0 : 1,
          maxWidth: compact ? 0 : 80,
          marginLeft: compact ? 0 : 6,
          overflow: 'hidden',
          transition: 'opacity 240ms ease, max-width 380ms cubic-bezier(0.16, 1, 0.3, 1), margin 380ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        Take Out
      </span>
    </button>
  );
});
BottomTakeOutChip.displayName = 'BottomTakeOutChip';

// ============================================
// RIGHT-SIDE TOOLBAR - Vertical action buttons
// ============================================
const RightToolbar = memo(({ onSettingsClick }: { onSettingsClick: () => void }) => {
  const currentTrack = usePlayerStore(state => state.currentTrack);

  // Get like state from preference store (persisted)
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);
  const isLiked = currentTrack?.trackId ? trackPreferences[currentTrack.trackId]?.explicitLike === true : false;

  // Heart pulse — flashes the toolbar button on every false→true like
  // transition, including the right-swipe Like gesture (v792, Dash
  // 2026-04-29: "light up the heart too — both work well together").
  const [heartPulse, setHeartPulse] = useState(false);
  const prevLikedRef = useRef(isLiked);
  useEffect(() => {
    if (isLiked && !prevLikedRef.current) {
      setHeartPulse(true);
      const t = setTimeout(() => setHeartPulse(false), 900);
      prevLikedRef.current = isLiked;
      return () => clearTimeout(t);
    }
    prevLikedRef.current = isLiked;
  }, [isLiked]);

  const handleLike = () => {
    if (!currentTrack?.trackId) return;
    setExplicitLike(currentTrack.trackId, !isLiked);
    haptics.success();
  };

  return (
    <div
      // Vertically centered (was top-[42%] which shifted the column up by
      // ~8% of parent — on short viewports that landed buttons inside the
      // BigCenterCard. top-1/2 is consistent across 667px-915px viewports.
      // right-edge respects safe-area-inset-right for landscape notch.
      className="absolute top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3"
      style={{ right: 'max(1.5rem, env(safe-area-inset-right, 1.5rem))' }}
    >
      {/* Like Button — purple when active. v792: pulse-fades when
          isLiked transitions to true, including from the swipe-right
          Like gesture (Dash 2026-04-29: "for swipe right instead of
          typing like, you could light up the heart too — both work
          well together"). The wall + label + heart-pulse all fire
          on the same like-stroke. */}
      <button
        onClick={handleLike}
        className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md shadow-lg transition-all duration-300 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] ${
          isLiked
            ? 'border border-purple-500/60'
            : 'border border-[#28282f] hover:border-white/20'
        }`}
        style={{
          // v881 — soft pink cross-tint into the purple. Bg gradient
          // tilts violet→rose; outer halo gains a pink companion to
          // the dominant purple bloom. Tiny shade only — purple
          // stays the primary signature.
          background: isLiked
            ? 'linear-gradient(135deg, rgba(139,92,246,0.28) 0%, rgba(244,114,182,0.18) 100%)'
            : 'rgba(28, 28, 35, 0.65)',
          boxShadow: isLiked
            ? '0 0 14px rgba(139,92,246,0.35), 0 0 22px rgba(244,114,182,0.18)'
            : undefined,
          animation: heartPulse ? 'voyo-heart-pulse 0.9s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
        }}
        aria-label={isLiked ? 'Unlike this track' : 'Like this track'}
        title={isLiked ? 'Unlike' : 'Like'}
      >
        <Heart size={16} className={isLiked ? 'text-purple-400 fill-purple-400' : 'text-white/70'} />
      </button>

      {/* Boost Button - Lightning Power */}
      <BoostButton variant="toolbar" />

      {/* Settings Button — metallic grey */}
      <button
        onClick={onSettingsClick}
        className="w-11 h-11 rounded-full backdrop-blur-md border border-[#28282f] flex items-center justify-center hover:border-white/20 shadow-lg transition-all duration-300 active:scale-95"
        style={{ background: 'rgba(28, 28, 35, 0.65)' }}
        aria-label="Audio settings"
        title="Audio settings"
      >
        <Settings size={16} className="text-white/70" />
      </button>
    </div>
  );
});

// (springs config removed 2026-04-28 — leftover from framer-motion era,
//  unused since the migration to plain CSS transitions.)

// ============================================
// VOYO BRAND TINT - Purple overlay that fades on hover
// ============================================
const VoyoBrandTint = ({ isPlayed }: { isPlayed?: boolean }) => (
  <div
    className={`absolute inset-0 pointer-events-none transition-opacity duration-300 group-hover:opacity-0 ${
      isPlayed ? 'opacity-60' : 'opacity-40'
    }`}
    style={{
      background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.4) 0%, rgba(212, 160, 83, 0.15) 100%)',
      mixBlendMode: 'overlay',
      }}
  />
);

// ============================================
// SMALL CARD (History/Queue)
// Title + artist OVERLAID on the card image (no separate text row).
// Played tracks get a deeper purple tint over the whole card. The
// first "next up" queue card gets a double-sided Apple ring glow that
// pulses occasionally to draw the eye.
// ============================================
const SmallCard = memo(({ track, onTap, isPlayed, isNextUp }: {
  track: Track;
  onTap: () => void;
  isPlayed?: boolean;
  isNextUp?: boolean;
}) => (
  <button
    className="relative flex-shrink-0 group"
    style={{ width: 78, height: 78 }}
    onClick={onTap}
  >
    {/* Apple-style double-sided ring glow on the next-up queue card.
        Two rings — outer pulsing, inner steady — to create that
        depth-on-glass effect Apple uses for "this is next." */}
    {isNextUp && (
      <>
        <div
          className="absolute pointer-events-none rounded-[18px]"
          style={{
            inset: -3,
            border: '1.5px solid rgba(212,160,83,0.55)',
            boxShadow: '0 0 14px rgba(212,160,83,0.35), inset 0 0 10px rgba(212,160,83,0.15)',
            animation: 'voyo-nextup-pulse 4.2s ease-in-out infinite',
          }}
        />
        <div
          className="absolute pointer-events-none rounded-[16px]"
          style={{
            inset: 0,
            border: '1px solid rgba(139,92,246,0.35)',
            boxShadow: 'inset 0 0 8px rgba(139,92,246,0.18)',
          }}
        />
      </>
    )}

    <div
      className="w-full h-full rounded-2xl overflow-hidden relative bg-gradient-to-br from-purple-900/30 to-violet-900/20"
      style={{ border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <SmartImage
        src={getTrackThumbnailUrl(track, 'high')}
        alt={`${track.title} by ${track.artist}`}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        trackId={track.trackId}
        artist={track.artist}
        title={track.title}
        lazy={true}
      />

      {/* PLAYED TINT — deeper purple wash over the whole card so the
          eye can immediately separate "already heard" from "queued."
          No more checkmark badge. */}
      {isPlayed && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(160deg, rgba(76,29,149,0.55) 0%, rgba(45,18,90,0.65) 60%, rgba(28,12,55,0.78) 100%)',
            mixBlendMode: 'multiply',
          }}
        />
      )}

      {/* QUEUED TINT — subtler bronze warmth on tracks waiting their
          turn. Just enough to feel "next" without competing with the
          played-tint contrast. */}
      {!isPlayed && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, transparent 55%, rgba(212,160,83,0.18) 100%)',
          }}
        />
      )}

      {/* TEXT OVERLAY — title + artist read straight on the image,
          floored over a soft dark gradient for legibility. */}
      <div
        className="absolute inset-x-0 bottom-0 px-1.5 pb-1 pt-3 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.85) 100%)',
        }}
      >
        <h4
          className={`text-[9px] font-bold truncate leading-tight ${
            isPlayed ? 'text-white/70' : 'text-white'
          }`}
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
        >
          {track.title}
        </h4>
        <p
          className="text-[8px] truncate leading-tight"
          style={{
            color: isPlayed ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.6)',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          }}
        >
          {track.artist}
        </p>
      </div>
    </div>
  </button>
));

// ============================================
// DASH PLACEHOLDER (Empty state for queue/history)
// ============================================
const DashPlaceholder = memo(({ onClick, label }: { onClick?: () => void; label: string }) => (
  <button
    onClick={onClick}
    className="w-[70px] h-[70px] rounded-2xl bg-gradient-to-br from-purple-900/30 to-violet-900/20 border border-purple-500/20 flex flex-col items-center justify-center gap-1 hover:border-purple-500/40 transition-colors"
  >
    <span className="text-[10px] font-black text-purple-400">
      DASH
    </span>
    <Plus size={14} className="text-purple-400/60" />
    <span className="text-[7px] text-gray-500 uppercase tracking-wider">{label}</span>
  </button>
));

// ============================================
// PORTAL BELT - Watch dial style infinite loop
// Cards wrap around like snake game walls
// Direction: INWARD toward VOYO (center)
// ============================================
interface PortalBeltProps {
  tracks: Track[];
  onTap: (track: Track) => void;
  onQueueAdd?: (track: Track) => void; // Track queue additions for MixBoard
  playedTrackIds: Set<string>;
  type: 'hot' | 'discovery';
  mixModes?: MixMode[]; // For color-coding cards by mode
  modeBoosts?: Record<string, number>; // Boost levels for intensity calculation
  isActive: boolean; // Controls if belt is scrolling
  onScrollOutward?: () => void; // Callback when user wants to scroll outward (reverse)
  scrollOutwardTrigger?: number; // Increment to trigger outward scroll
}

const PortalBelt = memo(({ tracks, onTap, onQueueAdd, playedTrackIds, type, mixModes, modeBoosts, isActive, scrollOutwardTrigger = 0 }: PortalBeltProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isReversed, setIsReversed] = useState(false); // For outward scroll

  // Manual scroll state
  const isDragging = useRef(false);
  const hasDraggedPastThreshold = useRef(false); // True if moved > threshold (real drag)
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DRAG_THRESHOLD = 10; // Pixels before considered a drag vs tap

  const isHot = type === 'hot';
  // INWARD direction: HOT scrolls RIGHT (+), DISCOVERY scrolls LEFT (-)
  // When reversed: opposite direction (OUTWARD from center)
  const baseSpeed = isHot ? 0.4 : -0.4;
  const speed = isReversed ? -baseSpeed * 2 : baseSpeed; // Faster when reversed

  // Handle scroll outward trigger from portal button
  useEffect(() => {
    if (scrollOutwardTrigger > 0) {
      // Reverse direction temporarily
      setIsReversed(true);
      setIsPaused(false);

      // Clear any existing timeout
      if (reverseTimeoutRef.current) clearTimeout(reverseTimeoutRef.current);

      // Return to normal after 1.5 seconds
      reverseTimeoutRef.current = setTimeout(() => {
        setIsReversed(false);
      }, 1500);
    }

    return () => {
      if (reverseTimeoutRef.current) clearTimeout(reverseTimeoutRef.current);
    };
  }, [scrollOutwardTrigger]);

  // Card dimensions
  const cardWidth = 72; // 64px + gap
  const totalWidth = tracks.length * cardWidth;

  // Auto-scroll animation - Only when isActive AND not paused
  useEffect(() => {
    if (tracks.length === 0 || !isActive) return;

    let animationId: number;
    let lastTime = 0;
    let mounted = true;

    const animate = (time: number) => {
      if (!mounted) return;

      // Battery fix: pause animation when tab is hidden
      if (document.hidden) {
        lastTime = 0; // Reset to avoid huge delta jump when tab returns
        animationId = requestAnimationFrame(animate);
        return;
      }

      try {
        if (!isPaused && lastTime) {
          const delta = time - lastTime;
          setOffset(prev => {
            let next = prev + speed * (delta / 16);
            // Wrap around (snake style)
            if (next <= -totalWidth) next += totalWidth;
            if (next >= totalWidth) next -= totalWidth;
            return next;
          });
        }
        lastTime = time;
        animationId = requestAnimationFrame(animate);
      } catch (error) {
        devWarn('[VOYO PortalBelt] Animation error:', error);
        mounted = false;
      }
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      mounted = false;
      cancelAnimationFrame(animationId);
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    };
  }, [tracks.length, isPaused, speed, totalWidth, isActive]);

  // Calculate entrance effect based on position and direction
  const getEntranceStyle = (x: number, containerWidth: number) => {
    if (isHot) {
      const entranceZone = cardWidth * 1.5;
      if (x < entranceZone) {
        const progress = Math.max(0, x / entranceZone);
        // opacity-only fade — filter: drop-shadow() in rAF caused per-frame paint
        return { opacity: 0.4 + progress * 0.6 };
      }
    } else {
      // DISCOVERY: Cards enter from RIGHT, opacity fade-in (no filter — compositor safe)
      const entranceZone = containerWidth - cardWidth * 1.5;
      if (x > entranceZone) {
        const progress = Math.max(0, (containerWidth - x) / (cardWidth * 1.5));
        return { opacity: 0.4 + progress * 0.6 };
      }
    }
    return { opacity: 1, filter: 'none' };
  };

  // Render cards with wrap-around positioning (works for both directions)
  const renderCards = () => {
    const cards: React.ReactNode[] = [];
    const containerWidth = totalWidth; // Use track count as reference

    // Render each track twice for seamless loop
    for (let loop = 0; loop < 2; loop++) {
      tracks.forEach((track, i) => {
        // Calculate base position with loop offset
        let x = i * cardWidth + offset + (loop * totalWidth);

        // Normalize to visible range
        while (x < -totalWidth) x += totalWidth * 2;
        while (x >= totalWidth * 2) x -= totalWidth * 2;

        // Only render if within visible bounds (with buffer)
        if (x >= -cardWidth && x < containerWidth + cardWidth) {
          const entranceStyle = getEntranceStyle(x, containerWidth);

          cards.push(
            <div
              key={`${track.id}-${loop}-${i}`}
              className="absolute top-0 bottom-0 flex items-center pointer-events-auto"
              style={{
                left: 0,
                transform: `translateX(${x}px) translateZ(0)`, // GPU accelerated
                width: cardWidth,
                willChange: 'transform',
                ...entranceStyle,
                transition: 'opacity 0.3s ease, filter 0.3s ease',
                }}
            >
              <StreamCard
                track={track}
                onTap={() => onTap(track)}
                onQueueAdd={onQueueAdd}
                isPlayed={playedTrackIds.has(track.id)}
                modeColor={mixModes ? getTrackModeColor(track.title, track.artist, mixModes, modeBoosts) : null}
              />
            </div>
          );
        }
      });
    }

    return cards;
  };

  // Manual scroll handlers - works when auto-scroll is paused
  const handleDragStart = (clientX: number) => {
    isDragging.current = true;
    hasDraggedPastThreshold.current = false;
    dragStartX.current = clientX;
    dragStartOffset.current = offset;
    // Don't pause yet - wait until threshold is crossed
  };

  const handleDragMove = (clientX: number) => {
    if (!isDragging.current) return;
    const delta = clientX - dragStartX.current;

    // Check if we've crossed the drag threshold
    if (!hasDraggedPastThreshold.current && Math.abs(delta) > DRAG_THRESHOLD) {
      hasDraggedPastThreshold.current = true;
      setIsPaused(true); // Now pause auto-scroll since it's a real drag
    }

    // Only move if past threshold (prevents micro-movements during tap)
    if (hasDraggedPastThreshold.current) {
      let newOffset = dragStartOffset.current + delta;

      // Wrap around for infinite scroll feel
      while (newOffset <= -totalWidth) newOffset += totalWidth;
      while (newOffset >= totalWidth) newOffset -= totalWidth;

      setOffset(newOffset);
    }
  };

  const handleDragEnd = () => {
    const wasDrag = hasDraggedPastThreshold.current;
    isDragging.current = false;
    hasDraggedPastThreshold.current = false;

    // Only keep paused if it was a real drag
    if (wasDrag) {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = setTimeout(() => setIsPaused(false), 2000);
    }
  };

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleDragMove(e.clientX);
  };

  const handleMouseUp = () => {
    handleDragEnd();
  };

  // Touch handlers - optimized for mobile belt dragging
  const handleTouchStart = (e: React.TouchEvent) => {
    // Don't prevent default here - allow tap-through for card taps
    handleDragStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Only prevent page scroll when it's a real drag (past threshold)
    if (hasDraggedPastThreshold.current) {
      e.preventDefault();
      e.stopPropagation(); // Stop cards from getting the event
    }
    handleDragMove(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    handleDragEnd();
  };

  // Prevent context menu on long press (mobile)
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 relative h-20 cursor-grab active:cursor-grabbing select-none"
      // v789: overflow-x: clip + overflow-y: visible — clips horizontally
      // for the looping belt but lets card glows bleed vertically (was
      // clipping the top halo on HOT/Discovery cards, Dash 2026-04-28).
      style={{ touchAction: 'pan-x', overflowX: 'clip', overflowY: 'visible' }}
      // PortalBelt has its own horizontal drag. Mark it so the global
      // canvas swipe (center-section swipe-to-skip) bails on pointerdown
      // and doesn't double-handle the same gesture.
      data-no-canvas-swipe="true"
      onMouseEnter={() => !isDragging.current && setIsPaused(true)}
      onMouseLeave={() => {
        if (!isDragging.current) setIsPaused(false);
        handleDragEnd();
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      // Use capture phase for touch events so belt handles drag before cards handle tap
      onTouchStartCapture={handleTouchStart}
      onTouchMoveCapture={handleTouchMove}
      onTouchEndCapture={handleTouchEnd}
      onContextMenu={handleContextMenu}
    >
      {/* Cards container - cards have pointer-events-auto for tap, belt captures drag */}
      <div className="absolute inset-0 pointer-events-none">
        {renderCards()}
      </div>
    </div>
  );
});

// ============================================
// STREAM CARD (Horizontal scroll - HOT/DISCOVERY - with VOYO brand tint)
// Tap = play full track immediately. Drag = add to queue.
// ============================================
const StreamCard = memo(({ track, onTap, isPlayed, modeColor, onQueueAdd }: {
  track: Track;
  onTap: () => void;
  isPlayed?: boolean;
  modeColor?: { neon: string; glow: string; intensity: number } | null; // From MixBoard mode matching
  onQueueAdd?: (track: Track) => void; // Callback when track is added to queue (for MixBoard tracking)
}) => {
  const addToQueue = usePlayerStore(state => state.addToQueue);
  const [showQueueFeedback, setShowQueueFeedback] = useState(false);
  const [wasDragged, setWasDragged] = useState(false);
  const [isFlying, setIsFlying] = useState(false); // Card flying to queue animation

  // Timeout refs for cleanup - prevents memory leaks on rapid scrolling
  const queueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (queueTimeoutRef.current) clearTimeout(queueTimeoutRef.current);
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      if (flyTimeoutRef.current) clearTimeout(flyTimeoutRef.current);
    };
  }, []);

  // Handle tap - play the full track immediately on any device.
  const handleTap = () => {
    // If was dragging, don't trigger tap
    if (wasDragged) {
      setWasDragged(false);
      return;
    }
    onTap();
  };

  return (
    <div
      className="flex-shrink-0 flex flex-col items-center w-16 relative"
    >
      {/* Queue Feedback - Shows after card flies */}
      
        {showQueueFeedback && !isFlying && (
          <div
            className="absolute -top-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="bg-gradient-to-r from-purple-500 to-violet-600 text-white text-[8px] font-bold px-2 py-1 rounded-full shadow-lg whitespace-nowrap flex items-center gap-1">
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Bucketed
            </div>
          </div>
        )}
      

      {/* Flying trail effect - shows during flight */}
      
        {isFlying && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          >
            <div className="w-14 h-14 rounded-xl bg-gradient-to-r from-purple-500/40 to-violet-600/40 blur-md" />
          </div>
        )}
      

      <button
        className="flex flex-col items-center group w-full"
        onClick={handleTap}
      >
        <div
          className="w-14 h-14 rounded-xl overflow-hidden mb-1.5 relative shadow-md bg-gradient-to-br from-purple-900/30 to-violet-900/20"
          style={{
            border: modeColor ? `${1 + modeColor.intensity}px solid ${modeColor.neon}` : '1px solid rgba(255,255,255,0.05)',
            boxShadow: modeColor
              ? `0 0 ${4 + modeColor.intensity * 12}px ${modeColor.glow}, 0 0 ${8 + modeColor.intensity * 16}px ${modeColor.glow}, inset 0 0 ${3 + modeColor.intensity * 6}px ${modeColor.glow}`
              : '0 2px 8px rgba(0,0,0,0.3)',
              }}
        >
          <SmartImage
            src={getTrackThumbnailUrl(track, 'high')}
            alt={`${track.title} by ${track.artist}`}
            className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-110 ${
              isPlayed ? 'opacity-60' : 'opacity-90 group-hover:opacity-100'
            }`}
            trackId={track.trackId}
            artist={track.artist}
            title={track.title}
            lazy={true}
          />
          {/* VOYO Brand Tint - fades on hover */}
          <VoyoBrandTint isPlayed={isPlayed} />
          {/* Mode Color Indicator - subtle corner accent */}
          {modeColor && (
            <div
              className="absolute top-0 left-0 w-2 h-2"
              style={{
                borderTop: `2px solid ${modeColor.neon}`,
                borderLeft: `2px solid ${modeColor.neon}`,
                borderRadius: '6px 0 0 0',
                filter: `drop-shadow(0 0 3px ${modeColor.glow})`,
                }}
            />
          )}
          {/* Played checkmark overlay */}
          {isPlayed && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-purple-500/80 flex items-center justify-center shadow-lg">
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          )}
        </div>
        <h4 className={`text-[9px] font-bold truncate w-full text-center ${isPlayed ? 'text-gray-400' : 'text-white'}`}>{track.title}</h4>
        <p className="text-[7px] text-gray-500 truncate w-full text-center uppercase">{track.artist}</p>
      </button>
    </div>
  );
});
// memo comparison function for StreamCard
StreamCard.displayName = 'StreamCard';

// ============================================
// BIG CENTER CARD (NOW PLAYING - Canva-style purple fade with premium typography)
// TAP ALBUM ART FOR LYRICS VIEW | VIDEO HANDLED BY GLOBAL IFRAME
// ============================================
const BigCenterCard = memo(({ track, onExpandVideo, onShowLyrics, onLyricsArmed, hideThumb, isIframeAudio, isMiniPlayerActive = false, controlsActive = false }: {
  track: Track;
  onExpandVideo?: () => void;
  onShowLyrics?: () => void;
  /** Fired when the 350ms hold-for-lyrics timer commits — parent uses this
   *  to cancel the canvas's 400ms DJ-mode hold so both don't fire from one
   *  gesture. (Dash 2026-04-29 v826 — fix for swipe-from-artwork interfering
   *  with tap-to-mode.) */
  onLyricsArmed?: () => void;
  hideThumb?: boolean;
  isIframeAudio?: boolean;
  /** True when the floating Mini Player is up (videoTarget==='portrait').
   *  Drives the Mini Player → Take Out button morph. */
  isMiniPlayerActive?: boolean;
  /** Driven by isControlsRevealed upstream — while true, the Mini Player
   *  toggle stays fully active; when false, dim decay timers start. */
  controlsActive?: boolean;
}) => {
  // Poster purple fade (v792, Dash 2026-04-29). Resets on track change,
  // fades IN ~3s after the new track starts. Skipped in video mode
  // (hideThumb=true) since the iframe has its own visual treatment.
  const [posterPurple, setPosterPurple] = useState(false);
  useEffect(() => {
    setPosterPurple(false);
    if (hideThumb) return;
    const t = setTimeout(() => setPosterPurple(true), 3000);
    return () => clearTimeout(t);
  }, [track?.trackId, hideThumb]);

  // v879 (Dash 2026-04-29 "card tap = open lyrics, hold = pause
  // natural with volume duck to 7%, release after hold = pause").
  // The artwork now carries TWO gestures with one pointer chain:
  //   • Quick TAP (release < 80ms before duck timer fires) → lyrics
  //   • HOLD release < 350ms → un-duck (no pause; was just a "shh")
  //   • HOLD release >= 350ms → pause + un-duck
  // Volume ducks to 7% as soon as the duck timer fires (80ms after
  // pointerdown). Quick taps never trigger the duck (they release
  // before the timer). The user's previous volume is captured on
  // pointerdown and restored on release / pause.
  const cardDuckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardDownAt = useRef<number>(0);
  const cardIsDucking = useRef<boolean>(false);
  const cardPreDuckVolume = useRef<number>(100);
  const cardHoldStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    return () => {
      if (cardDuckTimer.current) clearTimeout(cardDuckTimer.current);
    };
  }, []);

  return (
  // ── PERSPECTIVE CONTAINER ─────────────────────────────────────────
  // Wraps the card in a 3D space. perspective: 1200px is deep enough
  // that the rotations look natural, not fish-eye. The card inside
  // transforms in this 3D space.
  // Sized to match the card so the morphing chip (rendered as a
  // sibling, not a child) can anchor to the same top-right corner
  // without inheriting the card's opacity:0 fade in mini-player mode.
  <div className="relative w-56 h-56 md:w-64 md:h-64" style={{ perspective: '1200px' }}>
  <div
    className="relative w-56 h-56 md:w-64 md:h-64 rounded-[2rem] z-20 group"
    style={{
      // v800 (Dash 2026-04-29): replaced overflow-hidden with clip-path
      // and isolation: isolate. iOS Safari was failing to clip the
      // rounded corners when a parent had transform: translateY (the
      // v789 hero bump wrapper) — card flashed as a hard square with
      // a white edge during scroll. clip-path is GPU-stable across
      // nested transform contexts; isolation creates a clean stacking
      // context so SmartImage's compositing doesn't bleed.
      clipPath: 'inset(0 round 2rem)',
      WebkitClipPath: 'inset(0 round 2rem)',
      isolation: 'isolate',
      // Solid dark backing — without this, any transient moment where
      // SmartImage is loading or the card transform exposes a sub-pixel
      // gap shows the page bg/whatever is behind.
      backgroundColor: '#1a1a1a',
      // ── 3D DEPTH SYSTEM (Silicon Valley 2050, not 2015 flip card) ──
      //
      // Three audio-reactive layers, all within Dash's 7% max visual
      // change threshold:
      //
      // 1. BASS SCALE: +2.5% max (subtle inhale on kicks)
      // 2. ENERGY TILT: rotateY(-1.8deg) max (left edge 2px closer)
      // 3. BASS DEPTH: translateZ(+3px) max (card pushes toward you)
      //
      // At rest (paused, bass=0, energy=0): card is perfectly flat +
      // untilted. During playback: it gains presence, tilts subtly,
      // breathes with the bass. The viewer feels it without seeing it.
      //
      // Total visual "incline" at full bass + energy: ~5-6%, under 7%.
      transformStyle: 'preserve-3d',
      transform: hideThumb
        ? 'scale(0.94) rotateY(0deg) translateZ(0px)'
        : [
            'scale(calc(1 + var(--voyo-bass, 0) * 0.025))',
            'rotateY(calc(var(--voyo-energy, 0) * -1.8deg))',
            'translateZ(calc(var(--voyo-bass, 0) * 3px))',
          ].join(' '),
      // Shadow deepens with bass — farther from surface = bigger spread.
      // The base shadow anchors it; the reactive layer adds presence.
      boxShadow: [
        '0 25px 60px -12px rgba(0,0,0,0.9)',
        '0 0 calc(40px + var(--voyo-bass, 0) * 20px) rgba(139,92,246, calc(0.12 + var(--voyo-bass, 0) * 0.12))',
        '0 0 100px rgba(139,92,246,0.08)',
      ].join(', '),
      opacity: hideThumb ? 0 : 1,
      transition: hideThumb
        ? 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out'
        : 'opacity 0.3s ease-out',
      // will-change deliberately NOT set — it forces a separate GPU layer
      // that the compositor must upload to on every CSS custom property
      // change (10fps from frequency pump). Without will-change, the
      // browser uses its own heuristics for compositing, which on modern
      // Chrome/Safari is already optimized for transform changes.
      backfaceVisibility: 'hidden',
    }}
  >
    {/* THUMBNAIL — v879. Tap = lyrics. Hold = volume duck → release
        decides pause vs un-duck. Stops propagation on pointerdown so
        the canvas swipe doesn't fight us; the card-area gesture is
        owned here exclusively. */}
    <div
      data-card-tap
      onPointerDown={(e) => {
        e.stopPropagation();
        if (cardDuckTimer.current) clearTimeout(cardDuckTimer.current);
        cardDownAt.current = Date.now();
        cardHoldStart.current = { x: e.clientX, y: e.clientY };
        cardIsDucking.current = false;
        // Capture pre-duck volume so we can restore on release.
        cardPreDuckVolume.current = usePlayerStore.getState().volume;
        // 80ms gate: faster than this and it's a tap, not a hold.
        cardDuckTimer.current = setTimeout(() => {
          cardDuckTimer.current = null;
          cardIsDucking.current = true;
          usePlayerStore.getState().setVolume(7);
          haptics.light();
        }, 80);
      }}
      onPointerMove={(e) => {
        const start = cardHoldStart.current;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        // Movement > 8px → cancel the gesture entirely. Restore
        // volume if duck already fired.
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          if (cardDuckTimer.current) {
            clearTimeout(cardDuckTimer.current);
            cardDuckTimer.current = null;
          }
          if (cardIsDucking.current) {
            usePlayerStore.getState().setVolume(cardPreDuckVolume.current);
            cardIsDucking.current = false;
          }
          cardHoldStart.current = null;
        }
      }}
      onPointerUp={() => {
        const heldFor = Date.now() - cardDownAt.current;
        if (cardDuckTimer.current) {
          // Released before the 80ms duck → it's a TAP. Open lyrics.
          // v889: card-tap reverted to Lyrics per Dash — "tap on center
          // of the card or card itself...mode change is actually for
          // Lyrics". Mode toggle moved off the card onto canvas tap.
          clearTimeout(cardDuckTimer.current);
          cardDuckTimer.current = null;
          onShowLyrics?.();
        } else if (cardIsDucking.current) {
          // Was holding; restore volume regardless. If held >=350ms,
          // commit a real PAUSE on release.
          usePlayerStore.getState().setVolume(cardPreDuckVolume.current);
          cardIsDucking.current = false;
          if (heldFor >= 350 && usePlayerStore.getState().isPlaying) {
            // Trigger pause via store (no handlePlayPause access here;
            // setIsPlaying false is the canonical pause path).
            usePlayerStore.getState().setIsPlaying(false);
            haptics.medium();
          }
        }
        cardHoldStart.current = null;
      }}
      onPointerLeave={() => {
        if (cardDuckTimer.current) { clearTimeout(cardDuckTimer.current); cardDuckTimer.current = null; }
        if (cardIsDucking.current) {
          usePlayerStore.getState().setVolume(cardPreDuckVolume.current);
          cardIsDucking.current = false;
        }
        cardHoldStart.current = null;
      }}
      onPointerCancel={() => {
        if (cardDuckTimer.current) { clearTimeout(cardDuckTimer.current); cardDuckTimer.current = null; }
        if (cardIsDucking.current) {
          usePlayerStore.getState().setVolume(cardPreDuckVolume.current);
          cardIsDucking.current = false;
        }
        cardHoldStart.current = null;
      }}
      // v826b: NO role="button" / aria-label here. didOriginateOnInteractive
      // matches [role="button"] and made handleCanvasPointerDown bail out
      // early, which is why removing stopPropagation alone didn't fix the
      // dead zone. The artwork is a multi-gesture region (tap → canvas
      // mode toggle, hold → lyrics, drag → swipe) — not a button. Aria
      // intent moves to the parent card.
      className="absolute inset-0 cursor-pointer z-10"
    >
      {/* v920b — wrap the artwork in a moment-id-keyed gentle fade-in
          so on every track change the new poster *settles* in
          (matches the v920 moments-cube DriftGapFiller pattern). The
          iframe video loads in the background regardless; if the track
          eventually auto-promotes to the floating mini, the fade
          here is irrelevant — but for the first second of every new
          track the poster lands softly. */}
      <div
        key={`art-${track.trackId}`}
        className="w-full h-full voyo-cube-poster-arrive"
      >
        <SmartImage
          src={getTrackThumbnailUrl(track, 'high')}
          alt={`${track.title} by ${track.artist}`}
          className="w-full h-full object-cover transition-all duration-700 scale-[1.3] group-hover:scale-[1.4]"
          trackId={track.trackId}
          artist={track.artist}
          title={track.title}
          lazy={false}
        />
      </div>
      {/* ── GLOSSY LIGHT SOURCE ──────────────────────────────────────
          Thin gradient from top-left (light hits the tilted surface)
          to bottom-right (shadow side). Combined with the rotateY tilt,
          this creates the depth perception. Barely visible (5-8% white)
          — you feel it more than you see it. Premium, not toy. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 30%, transparent 60%, rgba(0,0,0,0.06) 100%)',
        }}
      />
      {/* Subtle warm-purple tint (lighter than before — the glossy layer
          provides enough visual interest). */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: 'rgba(139, 92, 246, 0.09)' }}
      />
      {/* Title + Artist fade overlay — taller, stronger gradient so the
          text is legible against any poster. Was hidden before because
          the gradient was too soft (60% black at the very bottom only)
          and the text sat at z-10 inside the same wrapper as everything
          else, so the radial vignette at z-15 dimmed it further.
          Now the gradient extends 50% up the card and the text gets a
          subtle drop-shadow for the final reading bump. */}
      <div
        className="absolute left-0 right-0 bottom-0 h-1/2 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 35%, transparent 100%)',
        }}
      />
      {/* Poster purple progressive fade — bottom-up violet glow that
          fades IN ~3s after a new track starts (Dash 2026-04-29 v792:
          "poster used to have its own overlay, this purple progressive
          fade from bottom — fade in after few seconds"). Adds depth to
          the now-playing card once the user has settled in. Long
          opacity transition so it feels atmospheric, not snap-on.
          Skipped in video mode (hideThumb=true). */}
      {!hideThumb && (
        <div
          className="absolute left-0 right-0 bottom-0 h-2/3 pointer-events-none"
          style={{
            background: 'linear-gradient(to top, rgba(139,92,246,0.42) 0%, rgba(139,92,246,0.18) 35%, transparent 100%)',
            mixBlendMode: 'screen',
            opacity: posterPurple ? 1 : 0,
            transition: 'opacity 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      )}
      {/* Title + artist fade in on each new track via key-based re-mount.
          React unmounts the old div and mounts a new one, triggering the
          voyo-fade-in animation. Result: text crossfades on every track
          change instead of popping. */}
      {/* v794 (Dash 2026-04-29): position reverted to bottom-3 — Dash
          clarified the text position should NOT have been moved. Keeping
          the contrast bump (15/11 sizes + white/bronze halos) since that
          improves legibility without "moving" anything. */}
      {/* v920b — title/artist now arrives with the same 2s gentle
          curve as moments (voyo-moment-text-arrive). Was 0.4s pop. */}
      <div
        key={track.trackId}
        className="absolute bottom-3 left-3 right-3 voyo-moment-text-arrive"
      >
        <p
          className="text-white font-bold text-[15px] truncate pointer-events-none tracking-[0.005em]"
          style={{ textShadow: '0 1px 4px rgba(0,0,0,0.7), 0 0 12px rgba(255,255,255,0.22)' }}
        >
          {track.title}
        </p>
        <p
          className="text-white/85 text-[11px] truncate pointer-events-none"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7), 0 0 10px rgba(212,160,83,0.30)' }}
        >
          {track.artist}
        </p>
        {/* CardSeek — slim faded progress under the artist name. Visible
            briefly on canvas tap (driven by controlsActive prop, ties to
            isControlsRevealed → 5s auto-hide). Replaces the old engine-
            row seek. (Dash 2026-04-29 v790) */}
        <CardSeek visible={!!controlsActive} />
      </div>
      {/* Lyrics hint icon */}
      {onShowLyrics && (
        <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Mic2 size={14} className="text-white" />
        </div>
      )}
      {/* v892: "tap to go video" button retired — the cube auto-
          promotes to iframe ~800ms after playback starts, so the
          poster is just a brief loading state and never needs a
          manual entry button. Iframe still shows "tap to close". */}
    </div>

    {/* Subtle vignette for depth */}
    <div
      className="absolute inset-0 pointer-events-none opacity-40 z-15"
      style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)',
        }}
    />

    {/* ── EDGE HIGHLIGHT ─────────────────────────────────────────────
        The left border is slightly brighter than the right (the light
        source is top-left, matching the glossy gradient above). This
        sells the 3D tilt — the "forward" edge catches more light.
        The inset glow softened from 30px to 20px so it doesn't fight
        the glossy overlay. */}
    <div
      className="absolute inset-0 rounded-[2rem] pointer-events-none transition-all duration-500 z-25"
      style={{
        borderTop: '1px solid rgba(255, 255, 255, 0.12)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.10)',
        borderRight: '1px solid rgba(139, 92, 246, 0.15)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.15)',
        boxShadow: 'inset 0 0 20px rgba(139, 92, 246, 0.06)',
        }}
    />
  </div>
  {/* Mini Player → Take Out morphing chip. Sibling of the faded card so
      it stays visible after BigCenterCard fades to opacity:0 in
      mini-player mode (CSS opacity cascades to descendants). */}
  {onExpandVideo && (
    <ExpandVideoButton onClick={onExpandVideo} isIframeAudio={!!isIframeAudio} isMiniPlayerActive={isMiniPlayerActive} controlsActive={controlsActive} />
  )}
  {/* Close perspective container */}
  </div>
  );
});

// ============================================
// PLAY CONTROLS - SPINNING VINYL DISK PLAY BUTTON
// ============================================
const PlayControls = memo(({
  isPlaying,
  onToggle,
  onPrev,
  onNext,
  isScrubbing,
  onScrubStart,
  onScrubEnd,
  trackArt,
  trackId,
  scrubDirection,
  skeepLevel,
  isFirstScreen,
}: {
  isPlaying: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  isScrubbing: boolean;
  onScrubStart: (direction: 'forward' | 'backward') => void;
  onScrubEnd: () => void;
  trackArt?: string;
  trackId?: string;
  scrubDirection: 'forward' | 'backward' | null;
  skeepLevel: number; // 1=2x, 2=4x, 3=8x
  /** First-screen spin gate (Dash 2026-04-29 v834 "make it spin on
   *  the first screen only"). True when portalProgress < 0.3 in the
   *  parent — once the user scrolls into Frame, rotation stops so it
   *  doesn't distract from the feed. */
  isFirstScreen?: boolean;
}) => {
  // Convert skeepLevel to display speed
  const displaySpeed = skeepLevel === 1 ? 2 : skeepLevel === 2 ? 4 : 8;

  // v835 — spinning vinyl, retro grammar (Dash 2026-04-29 "keep it
  // spinning, pause is not really a pause, pause becomes holding the
  // disk"). The disk spins WHENEVER we're on the first screen and the
  // animation isn't explicitly paused via a hold. The traditional
  // play/pause binary no longer drives the visual rotation — only
  // the user's finger on the vinyl does. animation-play-state is
  // toggled to 'paused' during a held-pause so the disk freezes
  // mid-rotation (CSS handles the snapshot — no JS rAF needed).
  //
  // Speeds match the original 8304753 getSpinAnimation:
  //   Normal : 3s linear infinite
  //   Scrub  : 3 / displaySpeed s (1.5s @ 2x, 0.75s @ 4x, 0.375s @ 8x)
  const spinDurationS = isScrubbing ? (3 / displaySpeed) : 3;
  const shouldSpin = !!isFirstScreen;
  const spinStyle: React.CSSProperties = shouldSpin
    ? {
        animation: `spin-vinyl ${spinDurationS}s linear infinite`,
        animationPlayState: isPlaying || isScrubbing ? 'running' : 'paused',
        willChange: 'transform',
      }
    : {};

  return (
    <div className="relative flex items-center justify-center w-full mb-3 z-30">
      {/* SKEEP SPEED INDICATOR - Shows current speed level */}
      
        {isScrubbing && (
          <div
            className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-2"
          >
            {/* Animated speed badge */}
            <div
              className="px-4 py-1.5 rounded-full bg-gradient-to-r from-purple-500 to-violet-600 shadow-lg shadow-purple-500/40"
            >
              <span className="text-white font-bold text-lg tracking-wider">
                {displaySpeed}x
              </span>
            </div>
            {/* Direction-aware arrows */}
            <div
              className="flex gap-0.5"
            >
              {scrubDirection === 'backward' ? (
                <>
                  <SkipBack size={16} className="text-purple-300 -mr-2" fill="currentColor" />
                  <SkipBack size={16} className="text-purple-400" fill="currentColor" />
                </>
              ) : (
                <>
                  <SkipForward size={16} className="text-purple-400" fill="currentColor" />
                  <SkipForward size={16} className="text-purple-300 -ml-2" fill="currentColor" />
                </>
              )}
            </div>
          </div>
        )}
      

      {/* Jog back 15s — TAP. HOLD = SKEEP fast-scrub backward.
          (Dash 2026-04-28: track-prev nav lives on right-swipe; left-swipe
          is drift. These buttons are within-track scrubbing tools.)
          v788: gentle pulse + lateral trail when SKEEP active in this
          direction — visual signature for the scrub motion. */}
      <button
        className="absolute left-[20%] min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95 transition-colors transition-transform"
        style={{
          color: isScrubbing && scrubDirection === 'backward' ? '#E6C58A' : 'rgba(255,255,255,0.5)',
          animation: isScrubbing && scrubDirection === 'backward'
            ? 'voyo-skeep-pulse 0.9s ease-in-out infinite'
            : 'none',
          // Lateral trail in the scrub direction — three offset rings
          // of bronze that fade out leftward (toward the trail).
          boxShadow: isScrubbing && scrubDirection === 'backward'
            ? '-14px 0 0 -8px rgba(212,160,83,0.55), -28px 0 0 -10px rgba(212,160,83,0.32), -42px 0 0 -12px rgba(212,160,83,0.16)'
            : 'none',
          borderRadius: '50%',
        }}
        aria-label="Jog back 15 seconds"
        onClick={() => {
          haptics.light();
          onPrev();
        }}
        onMouseDown={() => onScrubStart('backward')}
        onMouseUp={onScrubEnd}
        onMouseLeave={onScrubEnd}
        onTouchStart={() => onScrubStart('backward')}
        onTouchEnd={onScrubEnd}
      >
        <SkipBack size={24} fill="currentColor" />
      </button>

      {/* SPINNING VINYL DISK PLAY BUTTON */}
      <div className="relative w-20 h-20 flex items-center justify-center">
        {/* Glow - intensifies when playing */}
        <div
          className="absolute inset-0 rounded-full blur-xl"
          style={{
            backgroundColor: isPlaying ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.15)',
            transform: isPlaying ? 'scale(1.2)' : 'scale(1)',
          }}
        />

        {/* Spinning Vinyl Disk. v867: data-disk-hold removed (vinyl-
            finger pause retired); data-canvas-passthrough kept so
            drags-from-disk don't get filtered by didOriginateOnInteractive
            (currently moot — there are no drag actions left, but the
            attribute is harmless and future-proofs). onClick stops
            propagation so a bare disk tap doesn't bubble into the
            mode-toggle on the surrounding center card. */}
        <button
          data-canvas-passthrough
          className="absolute inset-0 rounded-full overflow-hidden border-2 border-white/20 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
          aria-label="Vinyl"
          onClick={(e) => { e.stopPropagation(); }}
          style={{
            background: isPlaying || isScrubbing
              ? 'transparent'
              : 'linear-gradient(to bottom, #1a1a2e, #0f0f16)',
          }}
        >
          {/* Vinyl grooves background */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `repeating-radial-gradient(
                circle at center,
                #1a1a2e 0px,
                #1a1a2e 2px,
                #0f0f16 2px,
                #0f0f16 4px
              )`
              }}
          />

          {/* Album art — always visible when there's a track. Was previously
              gated behind (isPlaying || isScrubbing) which left the disc empty
              on first app load (user hasn't pressed play yet → looks broken).
              Vinyl background + center play/pause icon already convey play
              state visually; the art doesn't need to gate on it. */}
          {trackArt && (
            <div
              className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] rounded-full overflow-hidden"
              style={spinStyle}
            >
              <SmartImage
                src={trackArt}
                fallbackSrc={trackId ? getThumbnailUrl(trackId, 'high') : undefined}
                alt="Now playing album art"
                className="w-full h-full object-cover"
                trackId={trackId}
                lazy={false}
              />
            </div>
          )}
          

          {/* v867: disk skeep overlay removed. SKEEP now lives on
              the left/right SCREEN edges. Center hole z-10 (no
              overlay to compete with anymore). */}

          {/* Center hole (vinyl style) */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#0a0a0f] border border-white/30 z-10 flex items-center justify-center">
            {/* Play/Pause icon in center */}
            {isPlaying ? (
              <Pause size={10} className="text-white/70" />
            ) : (
              <Play size={10} className="text-white/70 ml-0.5" />
            )}
          </div>

          {/* Shine effect */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none" />
        </button>
      </div>

      {/* Jog forward 15s — TAP. HOLD = SKEEP fast-scrub forward.
          v788: gentle pulse + rightward trail when SKEEP active here. */}
      <button
        className="absolute right-[20%] min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95 transition-colors transition-transform"
        style={{
          color: isScrubbing && scrubDirection === 'forward' ? '#E6C58A' : 'rgba(255,255,255,0.5)',
          animation: isScrubbing && scrubDirection === 'forward'
            ? 'voyo-skeep-pulse 0.9s ease-in-out infinite'
            : 'none',
          boxShadow: isScrubbing && scrubDirection === 'forward'
            ? '14px 0 0 -8px rgba(212,160,83,0.55), 28px 0 0 -10px rgba(212,160,83,0.32), 42px 0 0 -12px rgba(212,160,83,0.16)'
            : 'none',
          borderRadius: '50%',
        }}
        aria-label="Jog forward 15 seconds"
        onClick={() => {
          haptics.light();
          onNext();
        }}
        onMouseDown={() => onScrubStart('forward')}
        onMouseUp={onScrubEnd}
        onMouseLeave={onScrubEnd}
        onTouchStart={() => onScrubStart('forward')}
        onTouchEnd={onScrubEnd}
      >
        <SkipForward size={24} fill="currentColor" />
      </button>
    </div>
  );
});

// ============================================
// SUGGESTION CHAIN - Glowing pills that cycle then fade to grey
// ============================================
const SUGGESTIONS = ['Shuffle', 'Run it back', 'Slow down', 'Afrobeats', 'Pump it up'];

const SuggestionChain = memo(({ onSelect }: { onSelect: (text: string) => void }) => {
  const [glowIndex, setGlowIndex] = useState(-1); // -1 = all grey, 0-4 = that pill glows
  const [cycleComplete, setCycleComplete] = useState(false);

  // Glowing chain effect: cycle through pills one by one, then settle to grey
  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      if (index < SUGGESTIONS.length) {
        setGlowIndex(index);
        index++;
      } else {
        // Chain complete - all go grey
        setGlowIndex(-1);
        setCycleComplete(true);
        clearInterval(interval);
      }
    }, 300); // 300ms per pill

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="mt-4 flex flex-wrap gap-2 justify-center"
    >
      {SUGGESTIONS.map((suggestion, index) => {
        const isGlowing = glowIndex === index;
        const isStale = cycleComplete || glowIndex > index || glowIndex === -1;

        return (
          <button
            key={suggestion}
            onClick={() => onSelect(suggestion)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${
              isGlowing
                ? 'bg-purple-600/60 border border-purple-400/60 text-white shadow-lg shadow-purple-500/30'
                : isStale
                  ? 'bg-stone-800/40 border border-stone-600/30 text-stone-400 hover:bg-stone-700/50 hover:text-stone-300'
                  : 'bg-purple-900/40 border border-purple-500/30 text-purple-200'
            }`}
          >
            {suggestion}
          </button>
        );
      })}
    </div>
  );
});

// ============================================
// REACTION SYSTEM V3 - Ghosted Row with OYÉ Gateway
// ============================================
// Flow: All buttons visible but ghosted → Tap OYÉ → All light up
// OYÉ is slightly more prominent (the leader/invitation)

const ReactionBar = memo(({
  onReaction,
  isRevealed,
  onRevealChange,
  activateChatTrigger = 0,
}: {
  onReaction: (type: ReactionType, emoji: string, text: string, multiplier: number) => void;
  isRevealed: boolean;
  onRevealChange: (revealed: boolean) => void;
  activateChatTrigger?: number;
}) => {
  const [isActive, setIsActive] = useState(false); // false = ghosted, true = lit
  const [charging, setCharging] = useState<string | null>(null);
  const [chargeStart, setChargeStart] = useState<number>(0);
  const [currentMultiplier, setCurrentMultiplier] = useState<number>(1);

  // WAZZGUÁN CHAT MODE - Patent-worthy feature
  const [isChatMode, setIsChatMode] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatResponse, setChatResponse] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const prevTriggerRef = useRef(activateChatTrigger);

  // VOICE INPUT STATE - Type | Hold to speak | Mic for sing/hum
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceCountdown, setVoiceCountdown] = useState<number | null>(null);
  const [waveformLevels, setWaveformLevels] = useState<number[]>([0.3, 0.3, 0.3, 0.3, 0.3]);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Three nested countdown timers (3→2→1→startVoiceRecording) inside
  // handleMicHoldStart. Tracked together so handleMicHoldEnd / unmount
  // can cancel ALL of them, not just the outer 400ms holdTimer. Without
  // this, releasing or unmounting mid-countdown still fired
  // startVoiceRecording() at 3000ms, leaking MediaStream + MediaRecorder
  // + AudioContext + SpeechRecognition + perpetual rAF on a dead
  // component. (audit-2 P0-PUI-2)
  const micCountdownTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  // Start voice recording for DJ commands
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Setup audio context for waveform visualization
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 32;

      // Animate waveform bars — capped to ~15Hz (every 4th rAF frame)
      // so we're not firing setState 60×/sec for 5 visual bars. Eyes
      // can't perceive >24Hz on bar oscillation; 15Hz reads as alive,
      // saves ~75% of the React reconciliation cost during recording.
      // Pre-allocate the Uint8Array once instead of per-tick GC churn.
      const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
      let frameMod = 0;
      const updateWaveform = () => {
        if (analyserRef.current && (frameMod++ & 3) === 0) {
          analyserRef.current.getByteFrequencyData(buf);
          const levels = Array.from(buf.slice(0, 5)).map(v => Math.max(0.2, v / 255));
          setWaveformLevels(levels);
        }
        animationRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();

      // Setup speech recognition for live transcript
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.onresult = (event: any) => {
          const result = Array.from(event.results)
            .map((r: any) => r[0].transcript)
            .join('');
          setVoiceTranscript(result);
        };
        recognitionRef.current.start();
      }

      // Setup media recorder
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.start();

      setIsRecording(true);
    } catch (err) {
      devWarn('Mic access denied:', err);
      setIsVoiceMode(false);
      setVoiceCountdown(null);
      setChatResponse('Mic access denied');
    }
  };

  // Stop voice recording
  const stopVoiceRecording = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (audioContextRef.current) audioContextRef.current.close();
    if (recognitionRef.current) recognitionRef.current.stop();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setWaveformLevels([0.3, 0.3, 0.3, 0.3, 0.3]);
  };

  // Handle hold-to-speak: Hold mic to start voice command
  const handleMicHoldStart = () => {
    if (isProcessing) return;

    // Start hold timer - 400ms to trigger voice mode
    holdTimerRef.current = setTimeout(() => {
      setIsVoiceMode(true);
      setVoiceTranscript('');
      setVoiceCountdown(3);
      haptics.medium();

      // Countdown 3-2-1 — track each timer so release/unmount can
      // cancel them. (audit-2 P0-PUI-2)
      micCountdownTimersRef.current.push(setTimeout(() => setVoiceCountdown(2), 1000));
      micCountdownTimersRef.current.push(setTimeout(() => setVoiceCountdown(1), 2000));
      micCountdownTimersRef.current.push(setTimeout(() => {
        setVoiceCountdown(null);
        startVoiceRecording();
      }, 3000));
    }, 400);
  };

  // Cancel all in-flight mic countdown timers. Called from
  // handleMicHoldEnd AND from the unmount cleanup below.
  const cancelMicCountdown = useCallback(() => {
    for (const t of micCountdownTimersRef.current) clearTimeout(t);
    micCountdownTimersRef.current = [];
  }, []);

  // (audit-2 P0-PUI-2) Unmount cleanup for the voice surface — cancel
  // any pending countdowns AND release active mic/recorder/context if
  // recording was already in flight. Runs once on unmount.
  useEffect(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    for (const t of micCountdownTimersRef.current) clearTimeout(t);
    micCountdownTimersRef.current = [];
    try { stopVoiceRecording(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle hold release - submit voice command
  const handleMicHoldEnd = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    // Cancel any pending countdown timers — without this, releasing
    // mid-countdown still fired startVoiceRecording at 3000ms.
    cancelMicCountdown();

    // If was recording, stop and submit
    if (isRecording) {
      stopVoiceRecording();
      setIsRecording(false);

      // Submit the transcript as DJ command
      if (voiceTranscript.trim()) {
        handleChatSubmitWithText(voiceTranscript);
      }
      setVoiceTranscript('');
      setIsVoiceMode(false);
    }
  };

  // Handle mic tap - Shazam sing/hum feature
  const handleMicTap = async () => {
    if (isProcessing || isVoiceMode || isRecording) return;

    if (!isWhisperConfigured()) {
      setChatResponse('Voice search not configured');
      return;
    }

    setIsProcessing(true);
    setChatResponse('🎤 Listening... sing or hum!');
    haptics.medium();

    try {
      // Record for 8 seconds
      const audioBlob = await recordFromMicrophone(8000);
      setChatResponse('🔄 Processing...');

      // Voice search with Whisper
      const result = await voiceSearch(audioBlob);

      // Search for the song
      const searchResults = await searchAlbums(result.query);
      if (searchResults.length > 0) {
        const match = searchResults[0];

        // Get playable tracks and play
        try {
          const tracks = await getAlbumTracks(match.id);
          if (tracks.length > 0) {
            const voyoTrack = pipedTrackToVoyoTrack(tracks[0], match.thumbnail);
            app.playTrack(voyoTrack, 'search');
            setChatResponse(`🔥 Playing "${match.name}" by ${match.artist}`);
          } else {
            setChatResponse(`Found "${match.name}" - search to play!`);
          }
        } catch {
          setChatResponse(`Found "${match.name}" by ${match.artist}`);
        }
      } else {
        setChatResponse(`Couldn't find that one. Try again!`);
      }
    } catch (error) {
      devWarn('Voice search error:', error);
      setChatResponse('Voice search failed');
    } finally {
      setIsProcessing(false);
    }
  };

  // Access store for DJ commands
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const currentTrack = usePlayerStore(s => s.currentTrack);

  // DOUBLE TAP → Straight to Wazzguan chat
  useEffect(() => {
    // Only activate on actual changes (not initial mount)
    if (activateChatTrigger > prevTriggerRef.current) {
      prevTriggerRef.current = activateChatTrigger;
      // Small delay to ensure parent state updates have propagated
      requestAnimationFrame(() => {
        // Activate chat directly - wake up and open
        setIsActive(true);
        setIsChatMode(true);
        setChatResponse(null);
        // Focus input after animation completes
        setTimeout(() => chatInputRef.current?.focus(), 400);
      });
    }
  }, [activateChatTrigger]);

  // Auto-hide after inactivity (when revealed but not interacting)
  useEffect(() => {
    if (!isRevealed || isChatMode) return;

    const timeout = setTimeout(() => {
      if (!isChatMode && !charging) {
        setIsActive(false);
        onRevealChange(false); // Hide buttons after timeout
      }
    }, 6000); // Hide after 6s of no interaction

    return () => clearTimeout(timeout);
  }, [isRevealed, isActive, charging, isChatMode, onRevealChange]);

  // Handle Wazzguán tap → opens chat mode
  const handleWazzguanTap = () => {
    if (!isActive) return;
    setIsChatMode(true);
    setChatResponse(null);
    // Focus input after animation
    setTimeout(() => chatInputRef.current?.focus(), 300);
  };

  // Handle chat submission - DJ commands & song requests
  const handleChatSubmitWithText = async (text: string) => {
    if (!text.trim() || isProcessing) return;

    setIsProcessing(true);
    const input = text.trim().toLowerCase();
    setChatInput('');

    // Simple pattern matching for DJ commands (can be enhanced with actual AI later)
    // DJ CONTROLS - Shuffle, Run it back, Slow down
    if (input.includes('shuffle')) {
      setChatResponse('🔀 Shuffling the vibes...');
      const { toggleShuffle } = usePlayerStore.getState();
      toggleShuffle();
      setTimeout(() => setIsChatMode(false), 1500);
    } else if (input.includes('run it back') || input.includes('again') || input.includes('replay') || input.includes('repeat')) {
      setChatResponse('🔁 Running it back!');
      const { seekTo } = usePlayerStore.getState();
      seekTo(0);
      setTimeout(() => setIsChatMode(false), 1500);
    } else if (input.includes('add') || input.includes('play') || input.includes('queue')) {
      const songMatch = input.replace(/^(add|play|queue)\s*/i, '').trim();
      if (songMatch) {
        setChatResponse(`🎵 Adding "${songMatch}" to bucket...`);
        setTimeout(() => {
          setChatResponse(`✓ "${songMatch}" bucketed up next!`);
          setTimeout(() => setIsChatMode(false), 2000);
        }, 1000);
      } else {
        setChatResponse('🎧 What song should I add?');
      }
    } else if (input.includes('slow') || input.includes('chill') || input.includes('wine')) {
      setChatResponse('🌙 Got it, winding down the vibe...');
      setTimeout(() => setIsChatMode(false), 2000);
    } else if (input.includes('up') || input.includes('hype') || input.includes('energy')) {
      setChatResponse('🔥 Let\'s bring up the energy!');
      setTimeout(() => setIsChatMode(false), 2000);
    } else if (input.includes('afro') || input.includes('caribbean') || input.includes('latin')) {
      const genre = input.match(/(afro|caribbean|latin|dancehall|reggae)/i)?.[0] || 'vibes';
      setChatResponse(`🌍 Adding more ${genre} to the mix!`);
      setTimeout(() => setIsChatMode(false), 2000);
    } else if (input.includes('more like this') || input.includes('similar')) {
      setChatResponse(`🎯 Finding more like "${currentTrack?.title || 'this track'}"...`);
      setTimeout(() => setIsChatMode(false), 2000);
    } else {
      setChatResponse(`🎧 "${text}" - I hear you!`);
      setTimeout(() => setIsChatMode(false), 2000);
    }

    setIsProcessing(false);
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim() || isProcessing) return;
    handleChatSubmitWithText(chatInput);
  };

  // Close chat mode
  const handleChatClose = () => {
    setIsChatMode(false);
    setChatInput('');
    setChatResponse(null);
  };

  // Track which button just flashed (for sleep mode single-tap feedback)
  const [flashingButton, setFlashingButton] = useState<string | null>(null);
  // (legacy: Wazzguán prime/2-tap state was removed in the 2026-04-28
  // chat-polish pass — single-tap now opens the chat directly.)

  // All reactions in a row - OYÉ is the gateway (defined early for use in handlers)
  // REFINED PREMIUM COLORS - sophisticated, muted, elegant (not "kid style")
  const reactions = [
    { type: 'oyo', emoji: '👋', text: 'OYO', icon: Zap, gradient: 'from-purple-700/70 to-violet-900/60' },
    { type: 'oye', emoji: '🎉', text: 'OYÉ', icon: Zap, gradient: 'from-[#D4A053]/70 to-[#C4943D]/60', isGateway: true },
    { type: 'wazzguan', emoji: '🤙', text: 'Wazzguán', icon: null, gradient: 'from-stone-600/50 to-stone-700/40', isChat: true },
    { type: 'fire', emoji: '🔥', text: 'Fireee', icon: Flame, gradient: 'from-[#D4A053]/70 to-[#C4943D]/60' },
  ];

  const handlePressStart = (type: string) => {
    // === WAZZGUÁN FLOW ===
    // Single-tap opens chat regardless of sleep/active state. Was a 2-tap
    // prime → tap dance which read as "broken" (first tap did nothing
    // visible) — Dash 2026-04-28 chat-polish pass. Wazzguán = chat, one
    // gesture, every time. Active wake still happens via OYÉ.
    if (type === 'wazzguan') {
      handleWazzguanTap();
      return;
    }

    // === OYÉ FLOW (Gateway) ===
    if (type === 'oye') {
      if (!isActive) {
        // Sleep mode: elegant wake-up of all buttons
        setIsActive(true);
        // Flash Wazzguán to draw attention (grey → orange → back)
        setFlashingButton('wazzguan');
        setTimeout(() => setFlashingButton(null), 800);
        haptics.medium();
        return;
      }
      // Active mode: start charging for reaction
      setCharging(type);
      setChargeStart(Date.now());
      setCurrentMultiplier(1);
      return;
    }

    // === OTHER BUTTONS (OYO, Fire) ===
    if (!isActive) {
      // Sleep mode: flash, show emoji, go back to sleep
      setFlashingButton(type);
      haptics.light();
      // Trigger a quick reaction (emoji on canvas)
      const reactionData = reactions.find(r => r.type === type);
      if (reactionData) {
        onReaction(type as ReactionType, reactionData.emoji, reactionData.text, 1);
      }
      setTimeout(() => setFlashingButton(null), 400);
      return;
    }

    // Active mode: start charging
    setCharging(type);
    setChargeStart(Date.now());
    setCurrentMultiplier(1);
  };

  const handlePressEnd = (type: ReactionType, emoji: string, text: string) => {
    if (!charging) return;

    const holdDuration = Date.now() - chargeStart;
    let multiplier = 1;

    if (holdDuration < 200) multiplier = 1;
    else if (holdDuration < 500) multiplier = 2;
    else if (holdDuration < 1000) multiplier = 5;
    else multiplier = 10;

    getReactionHaptic(multiplier)();
    // OYÉ is the gateway — wake + charge but no floating confetti
    // (Dash 2026-04-28: "remove the confettis on oye"). The multiplier
    // badge during hold is already enough feedback; the 🎉 emoji floating
    // up was the kid-style we matured everywhere else.
    if (type !== 'oye') {
      onReaction(type, emoji, text, multiplier);
    }
    setCharging(null);
    setCurrentMultiplier(1);
  };

  // Update multiplier display while holding
  useEffect(() => {
    if (!charging) return;

    const interval = setInterval(() => {
      const holdDuration = Date.now() - chargeStart;
      let multiplier = 1;
      if (holdDuration >= 1000) multiplier = 10;
      else if (holdDuration >= 500) multiplier = 5;
      else if (holdDuration >= 200) multiplier = 2;
      setCurrentMultiplier(multiplier);
    }, 150); // Battery fix: 150ms is plenty for visual feedback (was 50ms = 20fps)

    return () => clearInterval(interval);
  }, [charging, chargeStart]);

  const isCharging = (type: string) => charging === type;
  // (getScale + getSpreadX removed 2026-04-28 — both unused after the
  //  spread-on-chat layout was simplified to "hide all buttons.")

  // Check if button is currently flashing (sleep mode tap feedback)
  const isFlashing = (type: string) => flashingButton === type;

  return (
    <div className="relative z-30 flex flex-col items-center mb-4">
      {/* Main reaction row - buttons spread when chat opens */}
      {/* min-h-[44px] when chat active to prevent collapse (absolute chat bar doesn't take space) */}
      <div className={`relative flex items-center justify-center gap-2 w-full ${isChatMode ? 'min-h-[44px]' : ''}`}>
        {reactions.map((r) => {
          const isGateway = r.isGateway;
          const isChat = r.isChat;
          const buttonFlashing = isFlashing(r.type);
          const isLit = isActive || buttonFlashing;

          // Hide ALL reaction buttons when chat is open - completely clean
          if (isChatMode) return null;

          // Buttons are always visible (signature) but more ghosted when not revealed.
          const isFadeGhosted = !isRevealed;

          // Fire flicker animation (only used when not in chat mode)
          const isFireSpread = false;

          // Mature palette (2026-04-28 Dash): one accent (bronze #D4A053)
          // reserved for the OYÉ gateway only, all other buttons share a
          // single neutral-glass scale (sleep → lit). No per-reaction
          // gradients, no bright purple, no kid-style. Restraint = premium.
          //
          // v884 (2026-04-29): OYÉ filled gets a touch of metal — vertical
          // bronze gradient + top sheen + slight forward lean. Texture
          // dialed below the home hero-play disk; just enough for "made
          // of something."
          const sizeCls = isGateway
            ? 'min-h-[44px] h-11 px-6 text-sm z-10'
            : 'min-h-[38px] h-[38px] px-4 text-xs';
          const palette = isGateway
            ? (isLit
                ? 'border border-[rgba(212,160,83,0.50)] text-[#F0D29A]'
                : 'bg-[rgba(212,160,83,0.08)] border border-[rgba(212,160,83,0.22)] text-[#D4A053]/70')
            : (isLit
                ? 'bg-white/[0.07] border border-white/15 text-white/85'
                : 'bg-white/[0.03] border border-white/[0.08] text-white/45');

          // Vertical bronze gradient for filled OYÉ — top catches a hint
          // of light, bottom sits in shadow. Keeps the surface readable
          // as bronze (not flat) without going full brushed-metal.
          const gatewayLitBg = isGateway && isLit
            ? 'linear-gradient(180deg, rgba(232,193,128,0.32) 0%, rgba(212,160,83,0.22) 45%, rgba(154,114,52,0.26) 100%)'
            : undefined;

          return (
            <button
              key={r.type}
              className={`
                relative rounded-full font-medium flex items-center gap-1.5
                backdrop-blur-sm transition-all duration-300
                ${sizeCls}
                ${palette}
              `}
              style={{
                opacity: isFireSpread
                  ? 0.3
                  : isFadeGhosted
                    ? (isGateway ? 0.35 : 0.25)
                    : (isChatMode ? 0.6 : (isLit ? 1 : (isGateway ? 0.9 : 0.5))),
                // Filled OYÉ: vertical bronze fill (replaces the flat
                // tinted bg). Other buttons keep their tailwind bg.
                background: gatewayLitBg,
                // Stack three signals on filled OYÉ:
                //  1. soft bronze halo (signature glow)
                //  2. inset 1px ring (defines the metal edge)
                //  3. inset top sheen (1px specular highlight, gives the
                //     "lit from above" feel without going glossy)
                //  + outer drop-shadow so the pill *floats* a touch.
                boxShadow: isGateway && isLit
                  ? [
                      '0 0 16px rgba(212,160,83,0.24)',
                      '0 2px 8px rgba(0,0,0,0.32)',
                      'inset 0 1px 0 0 rgba(255,228,178,0.32)',
                      'inset 0 -1px 0 0 rgba(60,38,12,0.30)',
                      'inset 0 0 0 1px rgba(212,160,83,0.22)',
                    ].join(', ')
                  : undefined,
                // Tiny forward lean: rises 1.5px and scales just past 1
                // when filled. Not a bounce — just "leaning in."
                transform: isGateway && isLit
                  ? 'translateY(-1.5px) scale(1.025)'
                  : undefined,
                // Subtle text emboss on the filled label so the bronze
                // letters read as carved into the surface.
                textShadow: isGateway && isLit
                  ? '0 1px 0 rgba(80,52,16,0.55), 0 0 6px rgba(212,160,83,0.18)'
                  : undefined,
              }}
              onMouseDown={() => handlePressStart(r.type)}
              onMouseUp={() => handlePressEnd(r.type as ReactionType, r.emoji, r.text)}
              onMouseLeave={() => { if (charging === r.type) handlePressEnd(r.type as ReactionType, r.emoji, r.text); }}
              onTouchStart={() => handlePressStart(r.type)}
              onTouchEnd={() => handlePressEnd(r.type as ReactionType, r.emoji, r.text)}
            >
              {r.icon && <r.icon size={isGateway ? 14 : 11} fill="currentColor" />}
              <span>{r.text}</span>

              {/* Chat indicator on Wazzguán — bronze dot, restrained. */}
              {isChat && isActive && !isChatMode && (
                <span
                  className="w-1 h-1 rounded-full"
                  style={{ background: '#D4A053', boxShadow: '0 0 4px rgba(212,160,83,0.55)' }}
                  aria-hidden
                />
              )}

              {/* Multiplier display */}
              {isCharging(r.type) && currentMultiplier > 1 && (
                <span
                  className="absolute -top-8 left-1/2 -translate-x-1/2 text-[#D4A053] font-bold text-lg drop-shadow-lg"
                >
                  {currentMultiplier}x
                </span>
              )}

              {/* Gateway resting outline — bronze (was purple), matches the
                  one-accent rule. Only renders when bar is dormant; once
                  OYÉ wakes the row, the halo (above) takes over. */}
              {isGateway && !isActive && !isChatMode && (
                <div
                  className="absolute inset-0 rounded-full border pointer-events-none"
                  style={{ borderColor: 'rgba(212,160,83,0.32)' }}
                />
              )}
            </button>
          );
        })}

        {/* Chat input - appears in center when Wazzguán tapped */}
        {/* Type | Hold to speak | Tap mic for sing/hum */}
        
          {isChatMode && (
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 backdrop-blur-xl rounded-full px-3 py-1.5"
              style={{
                background: 'rgba(15,15,22,0.62)',
                border: '1px solid rgba(212,160,83,0.18)',
                boxShadow: '0 4px 18px rgba(0,0,0,0.45), 0 0 22px rgba(212,160,83,0.06)',
              }}
            >
              {/* Voice countdown */}
              {voiceCountdown !== null ? (
                <div
                  className="flex-1 flex items-center justify-center"
                  key={voiceCountdown}
                >
                  <span className="text-lg font-bold text-white">{voiceCountdown}</span>
                </div>
              ) : isRecording ? (
                /* Recording with waveform — bronze on-theme */
                <div className="flex-1 flex items-center justify-center gap-1">
                  {waveformLevels.map((level, i) => (
                    <div
                      key={i}
                      className="w-1 rounded-full"
                      style={{ background: '#D4A053' }}
                    />
                  ))}
                  {voiceTranscript && (
                    <span className="text-[10px] text-white/50 ml-2 truncate max-w-[80px]">{voiceTranscript}</span>
                  )}
                </div>
              ) : (
                /* Normal text input */
                <input
                  ref={chatInputRef}
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
                  placeholder="Tell the DJ..."
                  className="flex-1 bg-transparent text-white text-xs placeholder:text-stone-400 outline-none min-w-0"
                  disabled={isProcessing || isVoiceMode}
                />
              )}

              {/* Mic button — bronze gradient when idle, red when recording */}
              <button
                onPointerDown={handleMicHoldStart}
                onPointerUp={handleMicHoldEnd}
                onPointerLeave={handleMicHoldEnd}
                onClick={!isVoiceMode && !isRecording ? handleMicTap : undefined}
                className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
                style={{
                  background: isRecording
                    ? 'rgba(239,68,68,0.8)'
                    : 'linear-gradient(135deg, #D4A053, #B8862E)',
                  boxShadow: isRecording
                    ? '0 0 14px rgba(239,68,68,0.4)'
                    : '0 0 14px rgba(212,160,83,0.22)',
                }}
                aria-label={isRecording ? 'Stop recording' : 'Voice input'}
                disabled={isProcessing && !isRecording}
              >
                {isProcessing && !isRecording ? (
                  <div
                    className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full"
                  />
                ) : (
                  <Mic size={12} className="text-white" />
                )}
              </button>

              {/* Close button */}
              <button
                onClick={handleChatClose}
                className="min-w-[44px] min-h-[44px] rounded-full bg-white/10 flex items-center justify-center text-white/60 text-xs flex-shrink-0 active:scale-95 transition-transform"
                aria-label="Close chat"
              >
                ×
              </button>
            </div>
          )}
        
      </div>

      {/* DJ Response - below the buttons */}
      
        {isChatMode && chatResponse && (
          <div
            className="mt-3 px-4 py-2 rounded-2xl bg-black/50 backdrop-blur-sm border border-white/10 text-white/90 text-xs text-center max-w-[240px]"
          >
            {chatResponse}
          </div>
        )}
      

      {/* Quick suggestions - Glowing chain effect, then stale grey */}
      
        {isChatMode && !chatResponse && (
          <SuggestionChain onSelect={handleChatSubmitWithText} />
        )}
      
    </div>
  );
});

// (FullscreenVideoPlayer stub removed 2026-04-28 — was a static SmartImage
//  placeholder reachable only by dead code. Cinema lives in VideoMode.tsx
//  and is reached via landscape rotation; Take Out keeps its original
//  PiP behavior, do not reroute it.)

// ============================================
// WORD TRANSLATION POPUP - Shows when tapping a word
// ============================================
interface WordPopupProps {
  word: string;
  translation: TranslationMatch | null;
  position: { x: number; y: number };
  onClose: () => void;
}

const WordTranslationPopup = memo(({ word, translation, position, onClose }: WordPopupProps) => {
  return (
    <div
      className="fixed z-[200]"
      style={{
        left: Math.min(position.x, window.innerWidth - 200),
        top: Math.min(position.y + 20, window.innerHeight - 150),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="bg-black/95 border border-purple-500/50 rounded-xl p-4 shadow-2xl min-w-[180px] backdrop-blur-xl"
        style={{ boxShadow: '0 10px 40px rgba(139,92,246,0.3)' }}
      >
        {/* Original word */}
        <p className="text-white font-bold text-lg mb-2">{word}</p>

        {translation ? (
          <>
            {/* Matched form */}
            {translation.matched !== word.toLowerCase() && (
              <p className="text-purple-300 text-xs mb-2">
                (matched: {translation.matched})
              </p>
            )}

            {/* English */}
            <div className="mb-2">
              <span className="text-xs text-white/40">🇬🇧 English</span>
              <p className="text-white text-sm">{translation.english}</p>
            </div>

            {/* French */}
            <div className="mb-2">
              <span className="text-xs text-white/40">🇫🇷 French</span>
              <p className="text-white text-sm">{translation.french}</p>
            </div>

            {/* Category & confidence */}
            <div className="flex justify-between items-center text-xs text-white/30 mt-3 pt-2 border-t border-white/10">
              <span className="bg-purple-500/20 px-2 py-0.5 rounded">{translation.category}</span>
              <span>{(translation.confidence * 100).toFixed(0)}% match</span>
            </div>

            {/* Alternatives */}
            {translation.alternatives && translation.alternatives.length > 0 && (
              <div className="mt-3 pt-2 border-t border-white/10">
                <p className="text-xs text-white/40 mb-1">Also could mean:</p>
                {translation.alternatives.slice(0, 2).map((alt, i) => (
                  <p key={i} className="text-xs text-white/60">• {alt.english}</p>
                ))}
              </div>
            )}
          </>
        ) : (
          <div>
            <p className="text-white/60 text-sm mb-3">No translation found</p>
            <p className="text-xs text-white/30">
              This word isn't in our lexicon yet.
              Help by suggesting a translation!
            </p>
          </div>
        )}

        {/* Close hint */}
        <p className="text-center text-white/20 text-xs mt-3">tap anywhere to close</p>
      </div>
    </div>
  );
});
WordTranslationPopup.displayName = 'WordTranslationPopup';

// ============================================
// COMMUNITY EDIT MODAL - For suggesting lyrics corrections
// ============================================
interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalText: string;
  segmentIndex: number;
  trackId: string;
  username: string;
  onSave: (correctedText: string) => void;
}

const CommunityEditModal = memo(({ isOpen, onClose, originalText, segmentIndex, trackId, username, onSave }: EditModalProps) => {
  const [correctedText, setCorrectedText] = useState(originalText);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCorrectedText(originalText);
    setSaved(false);
  }, [originalText, isOpen]);

  const handleSave = async () => {
    if (correctedText === originalText || !correctedText.trim()) return;

    setIsSaving(true);
    try {
      // Save to localStorage immediately for local experience
      const key = `voyo_lyrics_edit_${trackId}_${segmentIndex}`;
      localStorage.setItem(key, JSON.stringify({
        original: originalText,
        corrected: correctedText,
        by: username,
        at: Date.now(),
      }));

      onSave(correctedText);
      setSaved(true);
      haptics.success();

      // Auto-close after success
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      devWarn('[CommunityEdit] Failed to save:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-b from-[#1a1a2e] to-[#0a0a15] rounded-2xl p-6 w-full max-w-md border border-purple-500/30"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-white font-bold text-lg mb-2 flex items-center gap-2">
          <span>✏️</span> Polish Lyrics
        </h3>
        <p className="text-white/50 text-xs mb-4">
          Help improve this transcription for the community
        </p>

        {/* Original text */}
        <div className="mb-4">
          <label className="text-white/40 text-xs mb-1 block">Original (Whisper AI)</label>
          <p className="text-white/60 text-sm bg-white/5 rounded-lg p-3 italic">
            {originalText}
          </p>
        </div>

        {/* Corrected text input */}
        <div className="mb-4">
          <label className="text-white/40 text-xs mb-1 block">Your Correction</label>
          <textarea
            value={correctedText}
            onChange={(e) => setCorrectedText(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-lg p-3 text-white text-sm resize-none focus:outline-none focus:border-purple-500/50"
            rows={3}
            placeholder="Type the correct lyrics..."
          />
        </div>

        {/* User attribution */}
        <p className="text-white/30 text-xs mb-4">
          Contributing as: <span className="text-purple-400">{username || 'Anonymous'}</span>
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || correctedText === originalText || saved}
            className={`flex-1 py-3 rounded-xl text-white text-sm font-medium transition-all ${
              saved
                ? 'bg-purple-500'
                : isSaving
                ? 'bg-purple-500/50'
                : correctedText !== originalText
                ? 'bg-gradient-to-r from-purple-500 to-violet-600'
                : 'bg-white/10 opacity-50'
            }`}
          >
            {saved ? '✓ Saved!' : isSaving ? 'Saving...' : 'Save Correction'}
          </button>
        </div>
      </div>
    </div>
  );
});
CommunityEditModal.displayName = 'CommunityEditModal';

// ============================================
// LYRICS ACTION BUTTONS - Export, Share, Edit
// ============================================
interface LyricsActionsProps {
  lyrics: EnrichedLyrics;
  track: Track;
  onEditRequest: () => void;
}

const LyricsActionButtons = memo(({ lyrics, track, onEditRequest }: LyricsActionsProps) => {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  // Copy lyrics to clipboard
  const handleCopy = useCallback(async () => {
    const fullLyrics = lyrics.translated
      .map(seg => `${seg.original}${seg.english ? ` (${seg.english})` : ''}`)
      .join('\n');

    const text = `🎵 ${track.title} - ${track.artist}\n\n${fullLyrics}\n\n— Lyrics by VOYO`;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      haptics.success();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      devWarn('Failed to copy');
    }
  }, [lyrics, track]);

  // Share lyrics
  const handleShare = useCallback(async () => {
    const fullLyrics = lyrics.translated
      .map(seg => seg.original)
      .join('\n');

    const shareData = {
      title: `${track.title} - ${track.artist}`,
      text: `🎵 ${track.title} by ${track.artist}\n\n${fullLyrics.slice(0, 200)}...\n\n— Listen on VOYO`,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShared(true);
        haptics.success();
        setTimeout(() => setShared(false), 2000);
      } else {
        // Fallback to copy
        handleCopy();
      }
    } catch {
      // User cancelled share
    }
  }, [lyrics, track, handleCopy]);

  return (
    <div className="flex justify-center gap-3 mt-4">
      {/* Copy button */}
      <button
        className={`px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 min-h-[44px] active:scale-95 transition-transform ${
          copied
            ? 'bg-purple-500 text-white'
            : 'bg-white/10 text-white/70 hover:bg-white/20'
        }`}
        aria-label="Copy lyrics"
        onClick={handleCopy}
      >
        {copied ? '✓ Copied!' : '📋 Copy'}
      </button>

      {/* Share button */}
      <button
        className={`px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 min-h-[44px] active:scale-95 transition-transform ${
          shared
            ? 'bg-purple-500 text-white'
            : 'bg-white/10 text-white/70 hover:bg-white/20'
        }`}
        aria-label="Share lyrics"
        onClick={handleShare}
      >
        <Share2 size={14} />
        {shared ? 'Shared!' : 'Share'}
      </button>

      {/* Edit button */}
      <button
        className="px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 min-h-[44px] active:scale-95 transition-transform"
        aria-label="Edit lyrics"
        onClick={onEditRequest}
      >
        ✏️ Polish
      </button>
    </div>
  );
});
LyricsActionButtons.displayName = 'LyricsActionButtons';

// ============================================
// TAPPABLE WORD - Individual word that can be tapped
// ============================================
interface TappableWordProps {
  word: string;
  isCurrent: boolean;
  onTap: (word: string, position: { x: number; y: number }) => void;
}

const TappableWord = memo(({ word, isCurrent, onTap }: TappableWordProps) => {
  const handleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    onTap(word, { x: rect.left, y: rect.bottom });
  }, [word, onTap]);

  return (
    <span
      className={`cursor-pointer inline-block mx-0.5 px-1 rounded transition-all ${
        isCurrent ? 'hover:bg-purple-500/40' : 'hover:bg-white/20'
      }`}
      onClick={handleTap}
    >
      {word}
    </span>
  );
});
TappableWord.displayName = 'TappableWord';

// ============================================
// LYRICS OVERLAY - Full screen lyrics view with word tap
// ============================================
interface LyricsOverlayProps {
  track: Track;
  isOpen: boolean;
  onClose: () => void;
  currentTime: number;
}

const LyricsOverlay = memo(({ track, isOpen, onClose, currentTime }: LyricsOverlayProps) => {
  const [lyrics, setLyrics] = useState<EnrichedLyrics | null>(null);
  const [progress, setProgress] = useState<LyricsGenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Word tap state
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [wordTranslation, setWordTranslation] = useState<TranslationMatch | null>(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editSegmentIndex, setEditSegmentIndex] = useState(0);
  const [editOriginalText, setEditOriginalText] = useState('');

  // Get username from universe store
  const { dashId } = useAuth();
  const username = dashId || 'Anonymous';

  // Handle word tap
  const handleWordTap = useCallback((word: string, position: { x: number; y: number }) => {
    // Clean word (remove punctuation)
    const cleanWord = word.replace(/[.,!?;:'"]/g, '');
    if (cleanWord.length < 2) return; // Skip tiny words

    const translation = translateWord(cleanWord);
    setSelectedWord(word);
    setWordTranslation(translation);
    setPopupPosition(position);

    // Haptic feedback
    haptics.light();
  }, []);

  // Close popup
  const closePopup = useCallback(() => {
    setSelectedWord(null);
    setWordTranslation(null);
  }, []);

  // Open edit modal for current segment
  const handleEditRequest = useCallback(() => {
    if (!lyrics) return;
    const currentIdx = lyrics.translated.findIndex(
      seg => getCurrentSegment(lyrics, currentTime)?.startTime === seg.startTime
    );
    if (currentIdx >= 0) {
      setEditSegmentIndex(currentIdx);
      setEditOriginalText(lyrics.translated[currentIdx].original);
      setShowEditModal(true);
    }
  }, [lyrics, currentTime]);

  // Save edited lyrics
  const handleEditSave = useCallback((correctedText: string) => {
    if (!lyrics) return;
    // Update local state immediately
    const updated = { ...lyrics };
    updated.translated = [...updated.translated];
    updated.translated[editSegmentIndex] = {
      ...updated.translated[editSegmentIndex],
      original: correctedText,
    };
    setLyrics(updated);
  }, [lyrics, editSegmentIndex]);

  // Load lyrics when overlay opens
  useEffect(() => {
    if (!isOpen || !track) return;

    const loadLyrics = async () => {
      try {
        setError(null);
        setProgress({ stage: 'fetching', progress: 10, message: 'Finding lyrics...' });

        // TIER 1: LRCLIB — free, public, ~3M synced tracks, no API key.
        // Covers every major Western + French rap + Afrobeats hit we tested
        // (Damso, Ninho, Wizkid, Central Cee all had SYNCED lyrics). Returns
        // in ~200-500ms. Progress callback keeps the UI state in sync.
        const lrcResult = await fetchLyricsSimple(track, (p) => setProgress(p));
        if (lrcResult.enriched) {
          setLyrics(lrcResult.enriched);
          setProgress({ stage: 'complete', progress: 100, message: 'Found! (LRCLIB)' });
          setTimeout(() => setProgress(null), 1000);
          // v814 (Lyrics V2 Phase 3): defer onset-sync refinement to idle
          // time. Snaps each LRCLIB timestamp to the nearest detected
          // audio onset within ±150ms — brings raw drift from ~200-300ms
          // down to ~50ms, the felt difference between "off" and "locked."
          // Falls back to original segments on any failure (network,
          // decode, no-onsets), so the bar canvas always renders.
          const audioUrl = `https://voyo-edge.dash-webtv.workers.dev/audio/${track.trackId}?q=high`;
          const enriched = lrcResult.enriched;
          const refine = () => {
            void refineSegmentsWithOnsets(track.trackId, audioUrl, enriched.translated)
              .then((refined) => {
                // Only commit if the user hasn't navigated away.
                setLyrics((cur) =>
                  cur && cur.trackId === enriched.trackId
                    ? { ...cur, translated: refined }
                    : cur,
                );
              });
          };
          if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(refine, { timeout: 4000 });
          } else {
            setTimeout(refine, 1200);
          }
          return;
        }

        // TIER 2: LyricsAgent — Supabase cache → Gemini. For LRCLIB misses
        // (mostly older African catalogue, Soussou/Wolof/Lingala). Slower,
        // but catches what LRCLIB doesn't.
        setProgress({ stage: 'fetching', progress: 60, message: 'Searching deeper...' });
        const agentResult = await findLyrics(
          track.trackId,
          track.title,
          track.artist,
          track.duration,
        );
        if (agentResult.lyrics) {
          setLyrics(agentResult.lyrics);
          setProgress({ stage: 'complete', progress: 100, message: `Found! (${agentResult.source})` });
          setTimeout(() => setProgress(null), 1000);
          return;
        }

        setError('No lyrics found for this track');
        setProgress(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lyrics');
        setProgress(null);
      }
    };

    loadLyrics();
  }, [isOpen, track]);

  // Get current segment based on playback time
  const currentSegment = lyrics ? getCurrentSegment(lyrics, currentTime) : null;

  // Apple-Music-style karaoke reveal — fraction of the current segment
  // that has elapsed. Drives a linear-gradient mask on the active line so
  // it "fills in" bright white from left to right as the line plays.
  // Clamped 0-1 with a tiny easing band so the wipe reads as smooth,
  // not a hard cursor.
  const segmentProgress = (() => {
    if (!currentSegment) return 0;
    const end = currentSegment.endTime ?? (currentSegment.startTime + 4);
    const span = Math.max(0.1, end - currentSegment.startTime);
    return Math.max(0, Math.min(1, (currentTime - currentSegment.startTime) / span));
  })();

  // Render words as tappable spans
  const renderTappableText = useCallback((text: string, isCurrent: boolean) => {
    const words = text.split(/(\s+)/); // Split but keep spaces
    return words.map((word, i) => {
      if (/^\s+$/.test(word)) return <span key={i}>{word}</span>;
      return (
        <TappableWord
          key={i}
          word={word}
          isCurrent={isCurrent}
          onTap={handleWordTap}
        />
      );
    });
  }, [handleWordTap]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] backdrop-blur-xl animate-voyo-fade-in"
      style={{ background: 'rgba(17, 17, 20, 0.92)' }}
      onClick={closePopup}
    >
      {/* v812 (Dash 2026-04-29 "no header on lyrics, use that space"):
          track-info header removed; the lyrics get the full top of the
          screen. Tap-anywhere closes (onClick on the outer div above —
          closePopup falls through to onClose if no popup is open).
          A tiny close × stays top-right behind safe-area-top for the
          accessibility win + explicit dismiss. */}
      <button
        onClick={onClose}
        aria-label="Close lyrics"
        className="absolute z-10 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
        style={{
          top: 'max(12px, calc(env(safe-area-inset-top, 0px) + 8px))',
          right: 'max(12px, calc(env(safe-area-inset-right, 0px) + 8px))',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span className="text-white/70 text-lg leading-none">×</span>
      </button>

      {/* Main lyrics area — reclaims the old header space. pt now just
          covers safe-area-top + a small breathing margin instead of the
          ~80px reserved for the title/artist row. */}
      <div
        className="absolute inset-0 pb-8 px-6 flex flex-col items-center justify-center overflow-y-auto"
        style={{ paddingTop: 'max(28px, calc(env(safe-area-inset-top, 0px) + 16px))' }}
      >
        {/* Loading state */}
        {progress && (
          <div className="text-center">
            <VoyoLoadOrb size={72} className="mx-auto mb-4" />
            <p className="text-white/80 text-sm">{progress.message}</p>
            <p className="text-white/40 text-xs mt-1">{progress.progress}%</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="text-center">
            <p className="text-yellow-400 text-sm mb-2">🔍 {error}</p>
            <p className="text-white/40 text-xs">Not found in LRCLIB (3M+ songs)</p>
          </div>
        )}

        {/* v813 — Lyrics V2 surface (Dash 2026-04-29 "I want excellence
            immersion fun"). Pill choreography + typography sync via
            LyricsCanvas. The old gradient card + scroll-list + karaoke
            wipe are replaced by the bar-pill rhythm: queued → arriving
            → live → decay → gone, with active-bar weight breathing on
            --voyo-energy and hook detection lifting the chorus.
            Spec: outputs/SPEC-lyrics-v2-2026-04-29.md (Phases 1+2). */}
        {lyrics && !progress && (
          <>
            <LyricsCanvas lyrics={lyrics} currentTime={currentTime} />
            {/* Bottom chrome — slim metadata + actions, doesn't compete
                with the bars. Floats anchored to the canvas bottom. */}
            <div
              className="absolute left-0 right-0 flex flex-col items-center gap-3 pointer-events-none"
              style={{
                bottom: 'max(20px, calc(env(safe-area-inset-bottom, 0px) + 12px))',
              }}
            >
              <div
                className="flex items-center gap-3 text-[10px] tracking-[0.12em] uppercase"
                style={{ color: 'rgba(230,197,138,0.42)' }}
              >
                <span>{lyrics.language}</span>
                <span style={{ color: 'rgba(230,197,138,0.20)' }}>·</span>
                <span>{lyrics.translated.length} bars</span>
                {lyrics.phonetic.polishedBy?.length ? (
                  <>
                    <span style={{ color: 'rgba(230,197,138,0.20)' }}>·</span>
                    <span>polished</span>
                  </>
                ) : null}
              </div>
              <div className="pointer-events-auto">
                <LyricsActionButtons
                  lyrics={lyrics}
                  track={track}
                  onEditRequest={handleEditRequest}
                />
              </div>
            </div>
          </>
        )}

        {/* No lyrics yet */}
        {!lyrics && !progress && !error && (
          <div className="text-center">
            <p className="text-white/60">Tap to generate lyrics</p>
          </div>
        )}
      </div>

      {/* Word Translation Popup */}
      
        {selectedWord && (
          <WordTranslationPopup
            word={selectedWord}
            translation={wordTranslation}
            position={popupPosition}
            onClose={closePopup}
          />
        )}
      

      {/* Community Edit Modal */}
      
        {showEditModal && (
          <CommunityEditModal
            isOpen={showEditModal}
            onClose={() => setShowEditModal(false)}
            originalText={editOriginalText}
            segmentIndex={editSegmentIndex}
            trackId={track.trackId}
            username={username}
            onSave={handleEditSave}
          />
        )}
      
    </div>
  );
});
LyricsOverlay.displayName = 'LyricsOverlay';

// ============================================
// MAIN COMPONENT - Clean V2 Style (matching screenshot)
// ============================================
export const VoyoPortraitPlayer = ({
  onVoyoFeed,
  onSearch,
}: {
  onVoyoFeed: () => void;
  djMode?: boolean;
  onToggleDJMode?: () => void;
  onSearch?: () => void;
}) => {
  // Battery fix: fine-grained selectors — prevents re-render cascade from progress/duration ticks
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const videoTarget = usePlayerStore(s => s.videoTarget);
  const setVideoTarget = usePlayerStore(s => s.setVideoTarget);

  // v890 (Dash 2026-04-29): on pause, always go back to poster.
  // Locks "ON PAUSE we show the classic poster mode static" — without
  // this the mini iframe vanishes (isPortraitMode gates on isPlaying)
  // but videoTarget stays 'portrait', so play-resume snaps it back
  // visibly. Resetting on pause keeps the surface coherent + resolves
  // the tap-mode-toggle ↔ pause conflict.
  useEffect(() => {
    if (!isPlaying && videoTarget === 'portrait') {
      setVideoTarget('hidden');
    }
  }, [isPlaying, videoTarget, setVideoTarget]);

  // v892 (Dash 2026-04-29): auto-promote to iframe ~800ms after a
  // track starts playing. The cube becomes the video as soon as it's
  // ready → always draggable, unified surface, only "tap to close"
  // matters. Re-fires on track change + play-resume cycles. User-
  // initiated close stays closed until the next isPlaying transition.
  useEffect(() => {
    if (!isPlaying) return;
    const t = setTimeout(() => {
      const s = usePlayerStore.getState();
      if (s.isPlaying && s.videoTarget === 'hidden') {
        setVideoTarget('portrait');
      }
    }, 800);
    return () => clearTimeout(t);
  }, [isPlaying, currentTrack?.trackId, setVideoTarget]);

  // Community-layer 5-rail needs Heart state at this scope (RightToolbar has
  // its own copy inside its memo). Subscribing here gives the rail direct
  // read+write without prop-drilling through the huge Layer C body.
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);
  // Subscribe to playbackSource so the Mini Player button can pulse when
  // audio is flowing through the iframe (between track-start and hot-swap).
  const playbackSource = usePlayerStore(s => s.playbackSource);
  const videoBlocked = usePlayerStore(s => s.videoBlocked);
  // useShallow on array selectors — playerStore mutates these via spread
  // (`set({ queue: [...state.queue, item] })`), so default === comparison
  // returns false on every set even when contents are unchanged. Shallow
  // element-wise compare prevents redundant re-renders of this 6k-line
  // always-mounted player.
  const queue = usePlayerStore(useShallow(s => s.queue));
  const history = usePlayerStore(useShallow(s => s.history));
  const hotTracks = usePlayerStore(useShallow(s => s.hotTracks));
  const discoverTracks = usePlayerStore(useShallow(s => s.discoverTracks));
  const refreshRecommendations = usePlayerStore(s => s.refreshRecommendations);
  const prevTrack = usePlayerStore(s => s.prevTrack);
  // All in-player taps go through app.playTrack → registers with lanes at p=10.
  const playTrack = useCallback((track: Track) => app.playTrack(track, 'queue'), []);
  const addReaction = usePlayerStore(s => s.addReaction);
  // useShallow on reactions[] — playerStore.addReaction does
  // `set({ reactions: [...state.reactions, newReaction] })` which breaks
  // default === on every realtime broadcast (reactions are pushed across
  // users). Without useShallow this 6k-line always-mounted component
  // re-renders on EVERY reaction insert across the user base. The block
  // comment 8 lines above this line literally explains the same pattern
  // for queue/history/hotTracks — this selector got missed. (audit-2 P0-PUI-3)
  const reactions = usePlayerStore(useShallow(s => s.reactions));
  const seekTo = usePlayerStore(s => s.seekTo);
  const jammingWith = usePlayerStore(s => s.jammingWith);
  const endJam = usePlayerStore(s => s.endJam);
  const navigateToProfile = useRouterNavigate();
  const playbackRate = usePlayerStore(s => s.playbackRate);
  const isSkeeping = usePlayerStore(s => s.isSkeeping);
  const setPlaybackRate = usePlayerStore(s => s.setPlaybackRate);
  const stopSkeep = usePlayerStore(s => s.stopSkeep);
  // v804: read playerCompact (set true when SearchOverlay is open).
  // Used to gate canvas pointer/tap handlers so search-time touches
  // don't leak through to player gestures (Dash 2026-04-29
  // "tap to pause leak, gesture conflicts").
  const playerCompact = usePlayerStore(s => s.playerCompact);
  const shuffleMode = usePlayerStore(s => s.shuffleMode);
  const repeatMode = usePlayerStore(s => s.repeatMode);
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle);
  const cycleRepeat = usePlayerStore(s => s.cycleRepeat);

  // MOBILE FIX: Use direct play handler
  const { handlePlayPause } = useMobilePlay();

  // ====== REACTION SYSTEM - Community Spine ======
  // Fine-grained selectors — broad destructure caused re-render when any
  // reaction field changed (very noisy, realtime socket).
  const createReaction = useReactionStore(s => s.createReaction);
  // categoryPulse is a Record<string, {count, ts}> — store spreads on every
  // realtime pulse (`{...state.categoryPulse, [cat]: {...}}`), so default
  // === fires on every reaction even if our category didn't change. Shallow
  // compare keys + values prevents 5 MixBoard columns re-rendering on
  // unrelated category pulses.
  const categoryPulse = useReactionStore(useShallow(s => s.categoryPulse));
  const subscribeToReactions = useReactionStore(s => s.subscribeToReactions);
  const isSubscribed = useReactionStore(s => s.isSubscribed);
  // recentReactions is the realtime feed array — sliced+spread on every
  // insert. Shallow compare so getCommunityPunches() upstream doesn't
  // recompute on unchanged content.
  const recentReactions = useReactionStore(useShallow(s => s.recentReactions));
  const fetchRecentReactions = useReactionStore(s => s.fetchRecentReactions);
  const { dashId, isLoggedIn } = useAuth();

  // Subscribe to realtime reactions on mount
  useEffect(() => {
    if (!isSubscribed) {
      initReactionSubscription();
    }
  }, [isSubscribed]);

  // Fetch recent reactions for punches
  useEffect(() => {
    fetchRecentReactions(50);
  }, [fetchRecentReactions]);

  // ====== SIGNAL SYSTEM - Double-tap billboard = add comment to song + category ======
  const [signalInputOpen, setSignalInputOpen] = useState(false);
  const [signalCategory, setSignalCategory] = useState<ReactionCategory | null>(null);
  const [signalText, setSignalText] = useState('');

  // ====== LYRICS OVERLAY - Tap album art to show lyrics ======
  const [showLyricsOverlay, setShowLyricsOverlay] = useState(false);

  // Handle double-tap on MixBoard column = open Signal input
  const handleModeReaction = useCallback((category: ReactionCategory) => {
    if (!currentTrack) return;

    // Open Signal input for this category
    setSignalCategory(category);
    setSignalInputOpen(true);
    setSignalText('');

    // FLYWHEEL: Train vibe when user reacts with a category
    // (ReactionCategory already excludes random-mixer, so all reactions train vibes)
    const trackId = currentTrack.trackId || currentTrack.id;
    trainVibeOnReaction(trackId, category as MixBoardMode).catch(() => {});

    devLog(`[Signal] Opening input for ${category} on ${currentTrack.title}`);
  }, [currentTrack]);

  // Submit Signal (billboard contribution)
  const handleSignalSubmit = useCallback(async () => {
    if (!currentTrack || !signalCategory || !signalText.trim()) {
      setSignalInputOpen(false);
      return;
    }

    const text = signalText.trim();
    const isShort = text.length <= 30;
    const isSignal = isShort; // Billboard contribution = just SHORT (punchy!)

    // Get current progress for hotspot tracking
    const { progress } = usePlayerStore.getState();
    const trackPosition = Math.round(progress);

    await createReaction({
      username: dashId || 'anonymous',
      trackId: currentTrack.id,
      trackTitle: currentTrack.title,
      trackArtist: currentTrack.artist,
      trackThumbnail: currentTrack.coverUrl,
      category: signalCategory,
      emoji: isSignal ? '📍' : '💬', // Pink signal icon for billboard contributions
      reactionType: isSignal ? 'oye' : 'oye',
      comment: text,
      trackPosition, // Where in the song the signal was sent
    });

    devLog(`[Signal] ${isSignal ? '📍 SIGNAL' : '💬 Comment'}: "${text}" on ${signalCategory} at ${trackPosition}%`);

    setSignalInputOpen(false);
    setSignalText('');
    setSignalCategory(null);
  }, [currentTrack, signalCategory, signalText, dashId, createReaction]);

  // Get community punches for each category (short + has emoji)
  const getCommunityPunches = useCallback((category: ReactionCategory): CommunityPunch[] => {
    // Just SHORT = billboard punch (punchy vibes!)
    const isShort = (text: string) => text.length <= 30;

    return recentReactions
      .filter(r => r.category === category && r.comment && isShort(r.comment))
      .slice(0, 5) // Max 5 punches per category
      .map(r => ({
        id: r.id,
        text: r.comment || '',
        username: r.username,
        trackId: r.track_id,
        trackTitle: r.track_title,
        emoji: r.emoji,
      }));
  }, [recentReactions]);

  // Punches for each category
  const afroHeatPunches = useMemo(() => getCommunityPunches('afro-heat'), [getCommunityPunches]);
  const chillVibesPunches = useMemo(() => getCommunityPunches('chill-vibes'), [getCommunityPunches]);
  const partyModePunches = useMemo(() => getCommunityPunches('party-mode'), [getCommunityPunches]);
  const lateNightPunches = useMemo(() => getCommunityPunches('late-night'), [getCommunityPunches]);
  const workoutPunches = useMemo(() => getCommunityPunches('workout'), [getCommunityPunches]);

  // Handle punch click - navigate to track's expand view
  const handlePunchClick = useCallback((punch: CommunityPunch) => {
    devLog(`[Punch] Navigate to track: ${punch.trackTitle} (${punch.trackId})`);

    // Find the track in HOT or DISCOVERY feeds
    const allTracks = [...hotTracks, ...discoverTracks];
    const foundTrack = allTracks.find(t => t.id === punch.trackId || t.trackId === punch.trackId);

    if (foundTrack) {
      // Play the track - this will also update NowPlaying
      playTrack(foundTrack);
    } else {
      // Track not in current feeds - trigger search with the track title
      // This opens the search overlay with the track as query
      devLog(`[Punch] Track not in feeds, would search for: ${punch.trackTitle}`);
      // For now, just log - full search integration would require onSearch callback
    }
  }, [hotTracks, discoverTracks, playTrack]);

  // Backdrop state
  const [backdropEnabled, setBackdropEnabled] = useState(false); // v796: back to OFF default — Dash "lol why am I in fullscreen". Toggle still lives in Studio settings.
  const [currentBackdrop, setCurrentBackdrop] = useState('album'); // 'album', 'gradient-purple', etc.
  const [isBackdropLibraryOpen, setIsBackdropLibraryOpen] = useState(false);
  // (legacy: isFullscreenVideo state for the stub player was removed
  //  2026-04-28. Cinema = landscape VideoMode. Take Out = PiP, untouched.)
  // State for boost settings panel
  const [isBoostSettingsOpen, setIsBoostSettingsOpen] = useState(false);

  // PORTAL BELT toggle state - tap HOT/DISCOVERY to activate scrolling
  const [isHotBeltActive, setIsHotBeltActive] = useState(false);
  const [isDiscoveryBeltActive, setIsDiscoveryBeltActive] = useState(false);

  // ====== MIX BOARD STATE - Discovery Machine Patent 🎛️ ======
  // DUAL BAR SYSTEM:
  // 1. Manual bars = what you tap (baseline, protected)
  // 2. Queue bonus = based on what you're actually adding to queue (up to 5 extra)
  // Display = manual + queue_bonus (capped at 6)
  const MAX_BARS = 6;      // Max any single mode can display
  // (QUEUE_BONUS = 5 removed 2026-04-28 — never referenced.)

  // Manual bars - user taps to set preferences (zero-sum)
  const [manualBars, setManualBars] = useState<Record<string, number>>({
    'afro-heat': 1,      // Start equal - everyone gets 1 bar
    'chill-vibes': 1,
    'party-mode': 1,
    'late-night': 1,
    'workout': 1,
    'random-mixer': 1,
  });

  // Queue composition - tracks how many tracks from each mode are in queue
  const [queueComposition, setQueueComposition] = useState<Record<string, number>>({
    'afro-heat': 0,
    'chill-vibes': 0,
    'party-mode': 0,
    'late-night': 0,
    'workout': 0,
    'random-mixer': 0,
  });

  // modeBoosts = manual bars (for display)
  // queueMultiplier = x2, x3, x4, x5 badge based on queue proportion
  const modeBoosts = manualBars; // Bars show manual preference directly

  // Calculate queue multiplier per mode (x2-x5 based on queue dominance)
  const queueMultipliers = useMemo(() => {
    const totalQueued = Object.values(queueComposition).reduce((sum, n) => sum + n, 0);
    const multipliers: Record<string, number> = {};

    Object.keys(manualBars).forEach(modeId => {
      if (totalQueued === 0) {
        multipliers[modeId] = 1; // No queue yet
        return;
      }
      const queueProportion = (queueComposition[modeId] || 0) / totalQueued;
      // 0-20% = x1 (no badge), 20-40% = x2, 40-60% = x3, 60-80% = x4, 80-100% = x5
      if (queueProportion >= 0.8) multipliers[modeId] = 5;
      else if (queueProportion >= 0.6) multipliers[modeId] = 4;
      else if (queueProportion >= 0.4) multipliers[modeId] = 3;
      else if (queueProportion >= 0.2) multipliers[modeId] = 2;
      else multipliers[modeId] = 1;
    });

    return multipliers;
  }, [manualBars, queueComposition]);

  // Detect which mode a track belongs to (returns mode id or 'random-mixer' as fallback)
  const detectTrackMode = useCallback((track: Track): string => {
    const searchText = `${track.title} ${track.artist}`.toLowerCase();
    for (const mode of DEFAULT_MIX_MODES) {
      for (const keyword of mode.keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          return mode.id;
        }
      }
    }
    return 'random-mixer'; // Fallback - unmatched tracks go to random
  }, []);

  // Track when something is added to queue
  const trackQueueAddition = useCallback((track: Track) => {
    const modeId = detectTrackMode(track);
    setQueueComposition(prev => ({
      ...prev,
      [modeId]: (prev[modeId] || 0) + 1
    }));

    // FLYWHEEL: Train this track's vibe when added to queue
    if (modeId !== 'random-mixer') {
      const trackId = track.trackId || track.id;
      trainVibeOnQueue(trackId, modeId as MixBoardMode).catch(() => {});
    }
  }, [detectTrackMode]);

  // Handle mode tap - adds 1 manual bar to tapped mode, steals from others
  // Zero-sum: total MANUAL bars always = 6
  // (TOTAL_MANUAL_BARS const removed 2026-04-28 — never referenced.)
  const handleModeBoost = useCallback((modeId: string) => {
    setManualBars(prev => {
      const currentBars = prev[modeId] || 0;

      // Already maxed manual? Can't add more manually
      if (currentBars >= MAX_BARS) {
        haptics?.impact?.();
        return prev;
      }

      const newBars: Record<string, number> = { ...prev };

      // Add 1 manual bar to tapped mode
      newBars[modeId] = currentBars + 1;

      // Find modes that have manual bars to steal from (excluding tapped mode)
      const otherModes = Object.keys(prev).filter(k => k !== modeId && prev[k] > 0);

      if (otherModes.length > 0) {
        // Steal 1 bar from the mode with the MOST manual bars (take from the rich)
        const richestMode = otherModes.reduce((richest, mode) =>
          (prev[mode] > prev[richest]) ? mode : richest
        , otherModes[0]);

        newBars[richestMode] = Math.max(0, prev[richestMode] - 1);
      }

      // Haptic feedback based on dominance
      haptics?.impact?.();

      return newBars;
    });

    // FLYWHEEL: Train current track's vibe when user boosts a mode
    const track = usePlayerStore.getState().currentTrack;
    if (track && modeId !== 'random-mixer') {
      const trackId = track.trackId || track.id;
      trainVibeOnBoost(trackId, modeId as MixBoardMode).catch(() => {});
    }
  }, []);

  // Handle MixBoard card drag-to-queue - "Give me this vibe NOW!"
  // Finds up to 3 matching tracks from HOT/DISCOVERY and adds them to queue
  const handleModeToQueue = useCallback((modeId: string) => {
    const mode = DEFAULT_MIX_MODES.find(m => m.id === modeId);
    if (!mode) return;

    // Combine hot and discovery tracks
    const allTracks = [...hotTracks, ...discoverTracks];

    // Find tracks matching this mode's keywords
    const matchingTracks = allTracks.filter(track => {
      const searchText = `${track.title} ${track.artist}`.toLowerCase();
      return mode.keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
    });

    // Add up to 3 matching tracks to queue (or random if no matches)
    const tracksToAdd = matchingTracks.length > 0
      ? matchingTracks.slice(0, 3)
      : allTracks.slice(0, 3); // Fallback to first 3 if no keyword matches

    tracksToAdd.forEach(track => {
      app.oyeCommit(track);
      trackQueueAddition(track);
    });

    // Also boost this mode manually (user explicitly wants this vibe)
    handleModeBoost(modeId);
  }, [hotTracks, discoverTracks, trackQueueAddition, handleModeBoost]);

  // (xRandomizerSpin state removed 2026-04-28 — never read.)

  // ============================================
  // INTENT ENGINE SYNC - Wire MixBoard to HOT/DISCOVERY
  // ============================================

  // Get Intent Store actions
  const intentSetManualBars = useIntentStore(state => state.setManualBars);
  const intentRecordDragToQueue = useIntentStore(state => state.recordDragToQueue);
  const intentRecordTrackQueued = useIntentStore(state => state.recordTrackQueued);
  const intentStartSession = useIntentStore(state => state.startSession);

  // Start intent session on mount
  useEffect(() => {
    intentStartSession();
  }, [intentStartSession]);

  // Sync manual bars to Intent Store when they change
  useEffect(() => {
    Object.entries(manualBars).forEach(([modeId, bars]) => {
      intentSetManualBars(modeId as VibeMode, bars);
    });
  }, [manualBars, intentSetManualBars]);

  // INTENT → REFRESH TRIGGER
  // When MixBoard changes significantly, refresh HOT/DISCOVERY recommendations
  // Debounced to avoid excessive refreshes during rapid tapping
  const lastRefreshRef = useRef<number>(0);
  const prevBarsRef = useRef<Record<string, number>>(manualBars);

  useEffect(() => {
    // Check if bars changed significantly (any mode changed by 2+ bars)
    const prevBars = prevBarsRef.current;
    let significantChange = false;

    Object.keys(manualBars).forEach((modeId) => {
      const diff = Math.abs((manualBars[modeId] || 0) - (prevBars[modeId] || 0));
      if (diff >= 2) {
        significantChange = true;
      }
    });

    // Also trigger on first significant boost (any mode going from 1 to 3+)
    const anyHighBoost = Object.values(manualBars).some((bars) => bars >= 3);
    const wasLowBoost = Object.values(prevBars).every((bars) => bars <= 2);
    if (anyHighBoost && wasLowBoost) {
      significantChange = true;
    }

    // Debounce: only refresh every 2 seconds max
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;

    if (significantChange && timeSinceLastRefresh > 2000) {
      devLog('[VOYO Intent] Significant MixBoard change detected, refreshing recommendations...');
      refreshRecommendations();
      lastRefreshRef.current = now;
    }

    prevBarsRef.current = { ...manualBars };
  }, [manualBars, refreshRecommendations]);

  // Enhanced drag-to-queue that also records intent
  const handleModeToQueueWithIntent = useCallback((modeId: string) => {
    // Record drag-to-queue intent (strongest signal!)
    intentRecordDragToQueue(modeId as VibeMode);

    // Call existing handler
    handleModeToQueue(modeId);

    // Drag-to-queue is the STRONGEST intent signal - trigger immediate refresh
    // (User explicitly said "give me this vibe NOW")
    setTimeout(() => {
      devLog('[VOYO Intent] Drag-to-queue detected, refreshing recommendations...');
      refreshRecommendations();
    }, 500); // Small delay to let queue update first
  }, [handleModeToQueue, intentRecordDragToQueue, refreshRecommendations]);

  // (trackQueueAdditionWithIntent removed 2026-04-28 — fully wired but
  //  never invoked. The intent recording happens inside handleModeBoost
  //  for now; resurrect from git history if a queue-driven intent
  //  pipeline returns.)

  // Check if a mode is "active" (has at least 1 bar)
  const isModeActive = useCallback((modeId: string) => {
    return (modeBoosts[modeId] || 0) >= 1;
  }, [modeBoosts]);

  // Calculate "Your Vibes" color - weighted average of boosted mode colors
  const getVibesColor = useCallback(() => {
    const modeColors: Record<string, { r: number; g: number; b: number }> = {
      'afro-heat': { r: 181, g: 74, b: 46 },      // Rust ember (deep, premium)
      'chill-vibes': { r: 59, g: 130, b: 246 },   // Blue
      'party-mode': { r: 167, g: 139, b: 250 },   // Purple-light
      'late-night': { r: 139, g: 92, b: 246 },    // Purple
      'workout': { r: 124, g: 58, b: 237 },       // Purple-dark
      'random-mixer': { r: 139, g: 92, b: 246 },  // Purple (brand)
    };

    let totalWeight = 0;
    let r = 0, g = 0, b = 0;

    Object.entries(modeBoosts).forEach(([modeId, boost]) => {
      const color = modeColors[modeId];
      if (color && boost > 0) {
        r += color.r * boost;
        g += color.g * boost;
        b += color.b * boost;
        totalWeight += boost;
      }
    });

    if (totalWeight === 0) return { color: '#a855f7', glow: 'rgba(168,85,247,0.5)' };

    const avgR = Math.round(r / totalWeight);
    const avgG = Math.round(g / totalWeight);
    const avgB = Math.round(b / totalWeight);

    return {
      color: `rgb(${avgR},${avgG},${avgB})`,
      glow: `rgba(${avgR},${avgG},${avgB},0.5)`
    };
  }, [modeBoosts]);

  const vibesColor = getVibesColor();

  // ===== CAROUSEL SIDE-SHIFT — paired carousel "active side" mechanic =====
  // When the user starts interacting with one side of a paired carousel
  // (history/queue OR HOT/DISCOVERY), that side smoothly expands to ~65%
  // of the row and the inactive side compresses to ~35%. This is also
  // how the "scroll lock" requirement is satisfied — the inactive side
  // is too small to grab, so only one rail scrolls at a time.
  // After ~3.5s of idle the row balances back to 50/50.
  const [topRowActive, setTopRowActive] = useState<'history' | 'queue' | null>(null);
  const topRowIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activateTopRow = useCallback((side: 'history' | 'queue') => {
    setTopRowActive(side);
    if (topRowIdleTimer.current) clearTimeout(topRowIdleTimer.current);
    topRowIdleTimer.current = setTimeout(() => setTopRowActive(null), 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (topRowIdleTimer.current) clearTimeout(topRowIdleTimer.current);
    };
  }, []);

  // PORTAL SCROLL — the layered scroll model.
  //
  // Three layers stack inside the player:
  //   A) ANCHOR (top history/queue bubbles + center hero) — sticky, always
  //      visible, never moves
  //   B) MUSIC SHELF (HOT/DISCOVERY rail + MIX BOARD) — fades out as the
  //      user scrolls down
  //   C) AMBIENT CANVAS (vibes cards + OYO dock) — fades in as Layer B
  //      fades out, becomes the dominant surface at deep scroll
  //
  // Reverse scroll = simple fade back. Fast upward scroll = wheel-spin
  // reset (snaps the canvas closed and returns to home). Fast scroll
  // detection compares dy/dt against a velocity threshold.
  const [portalProgress, setPortalProgress] = useState(0); // 0 = home, 1 = full canvas

  // PiP / Take Out mode tracking. While in PiP, drop a "Next up: X" Oyo
  // pill every 5 song changes — ambient reminder for the user when they
  // come back to the app, without spamming per-track overlays.
  // enterpictureinpicture/leavepictureinpicture bubble from the video
  // element to document, so document is the right global listening point.
  const isPipActiveRef = useRef(false);
  const pipSongCountRef = useRef(0);
  useEffect(() => {
    const onEnter = () => { isPipActiveRef.current = true; pipSongCountRef.current = 0; };
    const onLeave = () => { isPipActiveRef.current = false; pipSongCountRef.current = 0; };
    document.addEventListener('enterpictureinpicture', onEnter);
    document.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      document.removeEventListener('enterpictureinpicture', onEnter);
      document.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, []);

  // Per-track-change tick: while PiP is the active mode, every 5th song
  // change drops a Dynamic Island pill with the next track. Reads
  // upcomingTrack from the live queue at fire time so the message
  // reflects the queue as it stands, not a stale closure capture.
  const currentTrackIdForPip = currentTrack?.trackId ?? null;
  useEffect(() => {
    if (!currentTrackIdForPip || !isPipActiveRef.current) return;
    pipSongCountRef.current += 1;
    if (pipSongCountRef.current % 5 !== 0) return;
    const next = usePlayerStore.getState().queue[0]?.track;
    if (!next?.title) return;
    try {
      window.pushNotification?.({
        id: `pip-nextup-${Date.now()}`,
        type: 'music',
        title: next.artist || 'Up next',
        subtitle: next.title,
      });
    } catch { /* never break */ }
  }, [currentTrackIdForPip]);
  const lastScrollY = useRef(0);
  const lastScrollAt = useRef(0);
  const wheelResetting = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // First-session scrollbar teaching cue (Dash 2026-04-28). On the very
  // first session we let the native scrollbar render so the user sees
  // there's content below the fold; after they've actually scrolled past
  // the fade range once, we persist a flag and suppress the scrollbar
  // forever after. Subtle pedagogy — the bar is only ever present when
  // the user genuinely needs the hint.
  const [scrollTaught, setScrollTaught] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return window.localStorage.getItem('voyo-scroll-taught') === '1'; }
    catch { return true; }
  });
  // rAF throttle: scroll events fire much faster than 60Hz on touch devices.
  // Coalescing setPortalProgress() to once per animation frame eliminates
  // 60+ React re-render cascades per second of scrolling — which was the
  // root cause of "audio muffles when scrolling" (audio thread starvation
  // from main thread render storms).
  const scrollRafRef = useRef<number | null>(null);
  // Latest portalProgress accessible inside the rAF callback without
  // re-creating the handler on every change.
  const portalProgressRef = useRef(portalProgress);
  portalProgressRef.current = portalProgress;

  const handleHeaderScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return; // coalesce to one update per frame
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;
      const currentY = container.scrollTop;
      const now = performance.now();

      // Velocity-based wheel-spin reset: if the user is scrolling UP fast
      // (>1.4px/ms) AND we're already deep in the canvas, snap back home
      // in a one-shot ~600ms morph instead of incremental fade.
      const dy = currentY - lastScrollY.current;
      const dt = now - lastScrollAt.current || 16;
      const velocity = dy / dt;
      if (
        !wheelResetting.current &&
        velocity < -1.4 && // fast upward
        portalProgressRef.current > 0.35 // already past the threshold
      ) {
        wheelResetting.current = true;
        setPortalProgress(0);
        container.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => { wheelResetting.current = false; }, 700);
      } else if (!wheelResetting.current) {
        const FADE_RANGE = 360;
        const next = Math.max(0, Math.min(1, currentY / FADE_RANGE));
        setPortalProgress(next);
        // First-session scroll teach: once the user reaches half-fade,
        // they've discovered the scroll. Mark taught and persist; from
        // here on the bar stays hidden in subsequent sessions.
        if (!scrollTaught && next > 0.5) {
          setScrollTaught(true);
          try { window.localStorage.setItem('voyo-scroll-taught', '1'); } catch { /* private mode */ }
        }
      }

      lastScrollY.current = currentY;
      lastScrollAt.current = now;
    });
  }, [setPortalProgress]);

  // CLEAN STATE: Two levels of reveal
  // TAP: Quick controls only (shuffle, repeat, share)
  // HOLD or DOUBLE TAP: Full DJ Mode (reactions + chat)
  const [isControlsRevealed, setIsControlsRevealed] = useState(false); // Level 1: Quick controls
  const [isReactionsRevealed, setIsReactionsRevealed] = useState(false); // Level 2: Full DJ
  const [activateChatTrigger, setActivateChatTrigger] = useState(0); // Increment to trigger chat
  const [showDJWakeMessage, setShowDJWakeMessage] = useState(false); // Tutorial toast
  const [djWakeMessageText, setDjWakeMessageText] = useState(''); // Dynamic message content
  const [showOyoIsland, setShowOyoIsland] = useState(false); // OYO DJ Island - tap to show
  // Session-start teach in the divider/cube area (Dash 2026-04-29 v791).
  // Phase 1 (0-5s): pause icon — teach "tap to pause".
  // Phase 2 (5-10s): chevron-down — teach "scroll for more".
  // Phase 3: gone. Once-per-session via sessionStorage so it doesn't nag.
  const [teachStep, setTeachStep] = useState<'pause' | 'scroll' | 'done'>(() => {
    if (typeof window === 'undefined') return 'done';
    try { return window.sessionStorage.getItem('voyo-teach-shown') === '1' ? 'done' : 'pause'; }
    catch { return 'done'; }
  });
  useEffect(() => {
    if (teachStep === 'done') return;
    if (teachStep === 'pause') {
      const t = setTimeout(() => setTeachStep('scroll'), 5000);
      return () => clearTimeout(t);
    }
    if (teachStep === 'scroll') {
      const t = setTimeout(() => {
        setTeachStep('done');
        try { window.sessionStorage.setItem('voyo-teach-shown', '1'); } catch { /* private mode */ }
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [teachStep]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);
  const didHoldRef = useRef(false);
  const djWakeCountRef = useRef(0); // Track how many times DJ mode was activated
  // v874 (Dash 2026-04-29 "bring the swipe motions back, just refine
  // the text and positionings"). Swipe vocabulary returns:
  //   LEFT  + quick = SKIP        (slow drift from this vibe)
  //   LEFT  + hold  = LESS        (taste-negative skip)
  //   RIGHT + quick = LOVED       (stamp + flourish, no skip)
  //   RIGHT + hold  = DISCOVER    (refresh discover pool + play)
  // 200ms drift gate selects "hold" variant; quick swipes default.
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipeFiredRef = useRef(false);
  const hasCrossedThresholdRef = useRef(false);
  const cardWrapRef = useRef<HTMLDivElement>(null);
  const holdSwipeReadyRef = useRef(false);
  const holdSwipeReadyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Side-walls — light up on swipe to teach the gesture grammar.
  const wallLikeRef     = useRef<HTMLDivElement>(null);
  const wallDiscoverRef = useRef<HTMLDivElement>(null);
  const wallSkipRef     = useRef<HTMLDivElement>(null);
  const wallLessRef     = useRef<HTMLDivElement>(null);
  // v875 GESTURE LABEL — Take Out style. Pill rides INSIDE the active
  // glow zone, NOT centered.
  // v877 (Dash 2026-04-29 "I like this first 3 times, then like"):
  // RIGHT-quick label evolves with familiarity. First 3 lifetime
  // commits show "I like this" (the full sentence reads tentative,
  // first-time-ish); after that it shortens to "like" (familiar
  // shorthand). Counter persisted in localStorage so the
  // progression carries across sessions.
  const LIKE_COUNT_KEY = 'voyo-like-count-v1';
  const likeCountRef = useRef<number>(
    (() => {
      try { return parseInt(localStorage.getItem(LIKE_COUNT_KEY) || '0', 10) || 0; }
      catch { return 0; }
    })()
  );
  const swipeLabelRef = useRef<HTMLDivElement>(null);
  const setSwipeLabel = (text: string, color: string, alpha: number, dx = 0, accent?: string) => {
    const el = swipeLabelRef.current;
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    // v881 — optional ACCENT halo (cross-tone). For LIKE we mix in
    // a soft purple so the pill reads unisex, not gendered pink.
    if (accent) {
      el.style.textShadow = `0 0 10px ${color}, 0 0 16px ${color}, 0 0 22px ${accent}`;
      el.style.boxShadow = `0 0 22px ${color}33, 0 0 30px ${accent}28, 0 4px 16px rgba(0,0,0,0.45)`;
    } else {
      el.style.textShadow = `0 0 10px ${color}, 0 0 18px ${color}`;
      el.style.boxShadow = `0 0 22px ${color}33, 0 4px 16px rgba(0,0,0,0.45)`;
    }
    el.style.opacity = String(alpha);
    const scale = 0.9 + alpha * 0.14;
    const ty = 6 - alpha * 6;
    // Take-Out style: label rides INTO the active wall side. Big
    // horizontal shift puts it inside the glow zone (~16% from
    // viewport edge). Magnitude scales with eased alpha so it
    // emerges with the wall, not slammed in pre-commit.
    const sideShift = (window.innerWidth ? window.innerWidth : 360) * 0.34;
    const tx = dx === 0 ? 0 : (dx > 0 ? sideShift : -sideShift) * alpha;
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };
  const clearSwipeLabel = () => {
    const el = swipeLabelRef.current;
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translate(0, 6px) scale(0.9)';
    el.style.boxShadow = '0 0 0 rgba(0,0,0,0)';
  };
  const setSideWallGlow = (dx: number) => {
    const COMMIT = 120;
    const norm = Math.min(1, Math.abs(dx) / COMMIT);
    const eased = norm * norm * (3 - 2 * norm);
    const set = (ref: React.RefObject<HTMLDivElement | null>, opacity: number) => {
      if (ref.current) ref.current.style.opacity = String(opacity);
    };
    set(wallLikeRef, 0); set(wallDiscoverRef, 0);
    set(wallSkipRef, 0); set(wallLessRef, 0);

    const isHold = holdSwipeReadyRef.current;
    if (dx > 0) {
      if (isHold) { set(wallDiscoverRef, eased); setSwipeLabel('Discover', '#E6C58A', eased, dx); }
      else        {
        set(wallLikeRef, eased);
        // v877 — label evolves with familiarity. First 3 lifetime
        // likes read full ("I like this"); 4th onwards just "like".
        // v881 — soft purple accent halo cross-bleeds into the
        // pink, unisex feel.
        const likeLabel = likeCountRef.current < 3 ? 'I like this' : 'like';
        setSwipeLabel(likeLabel, '#F472B6', eased, dx, '#a78bfa');
      }
    } else if (dx < 0) {
      // v875 — Drift = LEFT quick (was "Skip", indigo glow now).
      // Less of this = LEFT hold (silver glow). Per Dash: "skip is
      // drift, signal to redirect the flow; indigo for drift, silver
      // for less". The wallSkipRef and wallLessRef render colors
      // were swapped in JSX accordingly — refs kept their names so
      // the rest of the chain doesn't churn.
      if (isHold) { set(wallLessRef, eased);     setSwipeLabel('Less of this', '#E8EEF7', eased, dx); }
      else        { set(wallSkipRef, eased);     setSwipeLabel('Drift', '#5B7FBE', eased, dx); }
    } else {
      clearSwipeLabel();
    }
  };
  const clearSideWallGlow = () => {
    [wallLikeRef, wallDiscoverRef, wallSkipRef, wallLessRef].forEach(r => {
      if (r.current) r.current.style.opacity = '0';
    });
    clearSwipeLabel();
  };

  // Card transform — follows finger 1:1 while dragging, springs back
  // on release-without-commit.
  const applyCardTransform = (dx: number, dragging: boolean) => {
    const el = cardWrapRef.current;
    if (!el) return;
    const tilt = Math.max(-14, Math.min(14, dx / 18));
    const opacity = Math.max(0.55, 1 - Math.min(0.45, Math.abs(dx) / 600));
    el.style.transition = dragging ? 'none' : 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out';
    el.style.transform = `translateX(${dx}px) rotate(${tilt}deg)`;
    el.style.opacity = String(opacity);
    el.style.willChange = dragging ? 'transform, opacity' : 'auto';
  };

  // Commit a swipe action.
  type SwipeAction = 'skip' | 'less' | 'like' | 'discover';
  const launchCardWithAction = (dx: number, action: SwipeAction) => {
    const el = cardWrapRef.current;
    const dir = dx > 0 ? 1 : -1;

    if (action === 'like') {
      app.like();
      // v877: increment lifetime like counter. After 3 the label
      // shortens from "I like this" to "like" on subsequent
      // gestures (handled in setSwipeLabel via likeCountRef).
      likeCountRef.current += 1;
      try { localStorage.setItem(LIKE_COUNT_KEY, String(likeCountRef.current)); }
      catch { /* private mode / quota */ }
      if (el) {
        el.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease-out';
        el.style.transform = `translateX(${dx * 0.3}px) rotate(${dir * 4}deg) scale(1.04)`;
        el.style.opacity = '1';
        setTimeout(() => {
          if (!el) return;
          el.style.transition = 'transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)';
          el.style.transform = 'translateX(0) rotate(0deg) scale(1)';
        }, 180);
      }
      return;
    }

    if (el) {
      el.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.24s ease-out';
      el.style.transform = `translateX(${dir * window.innerWidth}px) rotate(${dir * 28}deg)`;
      el.style.opacity = '0';
    }
    setTimeout(() => {
      if (action === 'less')          app.less();
      else if (action === 'discover') app.drift();
      else                             app.skip();
      setTimeout(() => {
        const el2 = cardWrapRef.current;
        if (!el2) return;
        el2.style.transition = 'none';
        el2.style.transform = 'translateX(0) rotate(0deg)';
        el2.style.opacity = '1';
        el2.offsetHeight;
        el2.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out';
      }, 40);
    }, 200);
  };

  // Skeep + scrub bridge refs, declared earlier in source than the
  // scrub callbacks (TDZ workaround).
  const diskSkeepActiveRef = useRef(false);
  const handleScrubStartRef = useRef<((dir: 'forward' | 'backward') => void) | null>(null);
  const handleScrubEndRef = useRef<(() => void) | null>(null);

  // v880 — CUBE DOCK fully retired. Per Dash: "remove cube dock,
  // don't even import". The OYO chat path collapses to the single
  // ReactionBar chat (under the OYE bar). Future "presence"
  // surface = full-screen overlay triggered by holding the VOYO
  // button in the bottom navbar — separate build.
  // Stub handlers kept (callers downstream still reference these
  // names) but they're no-ops now; the JSX render is gone too.
  const handleCubePointerDown = useCallback(() => { /* retired */ }, []);
  const handleCubePointerUpOrLeave = useCallback(() => { /* retired */ }, []);

  // Quick controls - now using store (shuffleMode, repeatMode, toggleShuffle, cycleRepeat)

  // v876 (Dash 2026-04-29 "make sure they are shown once only, with
  // various delays like a slight reaction gap"). DJ wake pills:
  //   - EACH MESSAGE shows AT MOST ONCE per session (after the
  //     fourth DJ wake, silence — the user has discovered the
  //     gesture, no more chatter)
  //   - VARIABLE DELAY per message so the response feels reactive
  //     rather than mechanical. The pause is the "system reading
  //     your gesture" beat.
  const DJ_WAKE_MESSAGES: Array<{ text: string; delay: number }> = [
    { text: "Fiouuuh ✌🏾",       delay:  90 }, // quick exclaim
    { text: "Let's gooo ✌🏾",    delay: 130 }, // energetic
    { text: "Now Peace ✌🏾",     delay: 180 }, // settled
    { text: "DJ Mode Active ✌🏾", delay: 230 }, // deliberate
  ];
  const shownDJMessagesRef = useRef<Set<number>>(new Set());

  // Single tap counter for tutorial hint
  const singleTapCountRef = useRef(0);
  const hasShownHintRef = useRef(false);

  const showDJWakeToast = useCallback(() => {
    // Find the next unshown message. If all four are spent, no
    // toast — the user has earned silence.
    let pick = -1;
    for (let i = 0; i < DJ_WAKE_MESSAGES.length; i++) {
      if (!shownDJMessagesRef.current.has(i)) { pick = i; break; }
    }
    if (pick === -1) {
      djWakeCountRef.current++;
      singleTapCountRef.current = 0;
      hasShownHintRef.current = true;
      return;
    }
    shownDJMessagesRef.current.add(pick);
    const { text, delay } = DJ_WAKE_MESSAGES[pick];
    djWakeCountRef.current++;
    singleTapCountRef.current = 0;
    hasShownHintRef.current = true;
    // Reaction gap then show.
    setTimeout(() => {
      setDjWakeMessageText(text);
      setShowDJWakeMessage(true);
      setTimeout(() => setShowDJWakeMessage(false), 1500);
    }, delay);
  }, []);

  // (showTutorialHint removed 2026-04-28 — never invoked. The
  //  hasShownHintRef + djWake flow handles discoverability sufficiently.)

  // ============================================
  // MEMOIZED CALLBACKS - Prevent re-renders on tap
  // ============================================
  const handleOpenBoostSettings = useCallback(() => {
    setIsBoostSettingsOpen(true);
  }, []);

  const handleToggleHotBelt = useCallback(() => {
    setIsHotBeltActive(prev => !prev);
  }, []);

  const handleToggleDiscoveryBelt = useCallback(() => {
    setIsDiscoveryBeltActive(prev => !prev);
  }, []);

  // (handleExpandVideo deleted 2026-04-28 — fell into the removed stub
  //  fullscreen path. Cinema lives in VideoMode via landscape; Take Out
  //  is PiP, wired directly inside ExpandVideoButton + BottomTakeOutChip.)

  // Did the pointer/tap originate on an actual interactive element
  // (button, input, link, custom ARIA role)? If so, the canvas tap/hold
  // gesture must ignore it — otherwise tapping play/pause/skip etc.
  // would also toggle controls reveal and open OyoIsland. Expanded
  // selector to catch ARIA-styled interactive divs (switch/tab/menuitem
  // etc.) that aren't <button> but function as buttons.
  const didOriginateOnInteractive = (e: { target: EventTarget | null }) => {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (typeof t.closest !== 'function') return false;
    // v833 — explicit canvas passthrough escape hatch. Surfaces marked
    // with data-canvas-passthrough opt INTO the canvas swipe even
    // though they're <button>. The artwork uses no role="button" for
    // the same reason; the pause vinyl needs the attr because it IS
    // a real button (single-tap toggles play). Drag from anywhere on
    // the canvas — including the pause disk — should drive the card.
    if (t.closest('[data-canvas-passthrough]')) return false;
    return !!t.closest(
      'button, [role="button"], input, textarea, a, label, select, ' +
      '[role="link"], [role="menuitem"], [role="menuitemradio"], ' +
      '[role="switch"], [role="tab"], [role="checkbox"], [role="radio"], ' +
      '[role="slider"]'
    );
  };

  // Handle tap/hold/double-tap + GLOBAL SWIPE-TO-SKIP.
  //
  // The center section is one big gesture zone:
  //   • Tap  → toggle controls / OYO island
  //   • Double-tap → Wazzguan direct input
  //   • Hold (400ms) → DJ mode
  //   • Horizontal swipe → next/prev track (GLOBAL — anywhere on the view)
  //
  // Interactive children (buttons, inputs, scrollable rails) are excluded
  // via didOriginateOnInteractive so they keep their own event handling.
  // v867 (Dash 2026-04-29 "move x2/x8 motion to hold right/left side
  // of screen, remove hold-pause and slide-right-to-skip nonsense").
  // Simplified gesture grammar:
  //   • Tap BigCenterCard       → toggle mode (poster ↔ video)
  //   • Hold LEFT screen edge   → SKEEP backward (handleScrubStart)
  //   • Hold RIGHT screen edge  → SKEEP forward
  //   • Hold center 400ms       → DJ mode reveal (kept)
  //
  // RIPPED:
  //   • Swipe vocabulary (skip/less/like/discover) — gone
  //   • Card drag transform — gone
  //   • Vinyl-finger pause (v835 disk-hold) — gone
  //   • Disk-skeep zone (v836) — moved to screen edges
  //   • Drift-arm 200ms gate — gone with the swipe vocabulary
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (didOriginateOnInteractive(e)) return;
    if (usePlayerStore.getState().playerCompact) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[data-no-canvas-swipe]')) return;

    didHoldRef.current = false;
    swipeFiredRef.current = false;
    hasCrossedThresholdRef.current = false;
    holdSwipeReadyRef.current = false;
    swipeStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };

    // 200ms drift gate — if the user holds still 200ms before swiping,
    // it commits the "hold" variant on release (LESS / DISCOVER).
    if (holdSwipeReadyTimer.current) clearTimeout(holdSwipeReadyTimer.current);
    holdSwipeReadyTimer.current = setTimeout(() => {
      holdSwipeReadyRef.current = true;
      holdSwipeReadyTimer.current = null;
      haptics.light();
    }, 200);

    // Reset card wrapper for clean takeover.
    const el = cardWrapRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = 'translateX(0px) rotate(0deg)';
      el.style.opacity = '1';
    }

    // DJ-mode hold (400ms).
    holdTimerRef.current = setTimeout(() => {
      didHoldRef.current = true;
      setIsControlsRevealed(true);
      setIsReactionsRevealed(true);
      showDJWakeToast();
      haptics.medium();
    }, 400);

    // SCREEN-EDGE SKEEP — kept from v867.
    const skeepZone = target?.closest?.('[data-screen-skeep]') as HTMLElement | null;
    if (skeepZone) {
      const direction = (skeepZone.getAttribute('data-screen-skeep') as 'forward' | 'backward') || 'backward';
      handleScrubStartRef.current?.(direction);
      diskSkeepActiveRef.current = true;
    }
  }, [showDJWakeToast]);

  // v874 POINTER MOVE — swipe vocabulary restored. Drives card
  // translation, side-wall glow, label pill, threshold haptic.
  const COMMIT_THRESHOLD = 120;
  const HORIZONTAL_BIAS = 1.4;
  const handleCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    const start = swipeStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    // Vertical-dominant: skip card drag, kill hold timers.
    if (Math.abs(dy) > Math.abs(dx) * HORIZONTAL_BIAS && Math.abs(dy) > 20) {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      if (diskSkeepActiveRef.current) {
        handleScrubEndRef.current?.();
        diskSkeepActiveRef.current = false;
      }
      return;
    }

    // Horizontal drag — cancel hold timers, mark swipe.
    if (Math.abs(dx) > 8) {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      if (holdSwipeReadyTimer.current) {
        clearTimeout(holdSwipeReadyTimer.current);
        holdSwipeReadyTimer.current = null;
      }
      if (diskSkeepActiveRef.current) {
        handleScrubEndRef.current?.();
        diskSkeepActiveRef.current = false;
      }
      swipeFiredRef.current = true;
    }

    // Card follows finger 1:1 + side-wall light + pill label.
    applyCardTransform(dx, true);
    setSideWallGlow(dx);

    // Haptic on commit-threshold cross.
    const crossed = Math.abs(dx) >= COMMIT_THRESHOLD;
    if (crossed && !hasCrossedThresholdRef.current) {
      hasCrossedThresholdRef.current = true;
      haptics.light();
    }
  }, []);

  // v874 POINTER UP — commits swipe action if past threshold/velocity,
  // springs card back otherwise. Releases skeep if engaged.
  const handleCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (diskSkeepActiveRef.current) {
      handleScrubEndRef.current?.();
      diskSkeepActiveRef.current = false;
    }

    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;

    const dx = e.clientX - start.x;
    const elapsed = Date.now() - start.t;
    const velocity = Math.abs(dx) / Math.max(1, elapsed);
    const shouldCommit = Math.abs(dx) > COMMIT_THRESHOLD || (velocity > 0.6 && Math.abs(dx) > 40);

    const isLeft = dx < 0;
    const isHold = holdSwipeReadyRef.current;

    if (shouldCommit) {
      haptics.medium();
      let action: 'skip' | 'less' | 'like' | 'discover';
      if (isLeft && isHold)        action = 'less';
      else if (isLeft)             action = 'skip';
      else if (!isLeft && isHold)  action = 'discover';
      else                         action = 'like';
      launchCardWithAction(dx, action);
      setTimeout(clearSideWallGlow, 240);
    } else {
      applyCardTransform(0, false);
      clearSideWallGlow();
    }

    if (holdSwipeReadyTimer.current) {
      clearTimeout(holdSwipeReadyTimer.current);
      holdSwipeReadyTimer.current = null;
    }
    holdSwipeReadyRef.current = false;
  }, []);

  // Dedicated pointer-CANCEL handler. Distinct from pointer-UP because
  // cancel means "the gesture was interrupted" — finger left viewport,
  // app backgrounded, OS cancelled the touch. We should NEVER commit a
  // skip on cancel; always spring back to center cleanly. Using the
  // pointer-up logic here would read the last known position and could
  // fire an accidental skip if the user's finger happened to be past
  // threshold at the moment of cancellation.
  // v874 POINTER CANCEL — forget the gesture, spring card back, kill walls.
  const handleCanvasPointerCancel = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    swipeStartRef.current = null;
    swipeFiredRef.current = false;
    hasCrossedThresholdRef.current = false;
    applyCardTransform(0, false);
    clearSideWallGlow();
    if (holdSwipeReadyTimer.current) {
      clearTimeout(holdSwipeReadyTimer.current);
      holdSwipeReadyTimer.current = null;
    }
    holdSwipeReadyRef.current = false;
    if (diskSkeepActiveRef.current) {
      handleScrubEndRef.current?.();
      diskSkeepActiveRef.current = false;
    }
  }, []);

  // v879 — canvas tap simplified.
  //   • Tap on the CARD (data-card-tap) — handled by the artwork
  //     itself (lyrics open). The artwork stops propagation on
  //     pointerdown so this canvas handler shouldn't see card taps,
  //     but the closest() check is a belt-and-suspenders.
  //   • Single tap elsewhere → reveal controls/widgets (overlay).
  //   • Double-tap anywhere → open the chat (the ReactionBar one).
  // Mode toggle (poster ↔ video) RETIRED — was tied to single tap
  // before; now tap is the universal "wake widgets" gesture.
  const handleCanvasTap = useCallback((e: React.MouseEvent) => {
    if (usePlayerStore.getState().playerCompact) return;
    if (didOriginateOnInteractive(e)) return;
    // Drag fired: eat trailing click.
    if (swipeFiredRef.current) {
      swipeFiredRef.current = false;
      e.stopPropagation();
      return;
    }
    // DJ-mode hold fired: don't fire tap on top.
    if (didHoldRef.current) {
      didHoldRef.current = false;
      return;
    }
    // Card-zone tap is owned by the card's own pointer handlers
    // (lyrics open). Don't double-handle here.
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[data-card-tap]')) return;

    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;
    const isDoubleTap = timeSinceLastTap < 300;

    if (isDoubleTap) {
      // Double-tap anywhere → open the chat (under the OYE bar).
      setIsControlsRevealed(true);
      setIsReactionsRevealed(true);
      setActivateChatTrigger(prev => prev + 1);
      haptics.medium();
      return;
    }

    // Single tap when reactions are open → close them.
    if (isReactionsRevealed) {
      setIsReactionsRevealed(false);
      setIsControlsRevealed(false);
      setShowOyoIsland(false);
      return;
    }

    // v891: canvas single-tap reverted to wake-overlay (was toggling
    // mode in v889). Mode toggle now lives on the bottom button at
    // the cube edge — see CubeGestureHint on BigCenterCard / iframe.
    const wasHidden = !isControlsRevealed;
    setIsControlsRevealed(prev => !prev);
    if (wasHidden) {
      setShowOyoIsland(true);
      haptics.light();
    } else {
      setShowOyoIsland(false);
    }
  }, [isControlsRevealed, isReactionsRevealed]);

  // AUTO-HIDE controls + OyoIsland after 3s - encourages double-tap discovery
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Auto-hide when controls are revealed but not in full DJ mode
    // Quick fade encourages users to discover double-tap for full mode
    if (isControlsRevealed && !isReactionsRevealed) {
      controlsHideTimerRef.current = setTimeout(() => {
        setIsControlsRevealed(false);
        setShowOyoIsland(false); // Also hide OyoIsland
      }, 5000); // v790: 5s (was 3s) — matches the new card-seek fade window
    }
    return () => {
      if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current);
    };
  }, [isControlsRevealed, isReactionsRevealed]);

  // AUTO-HIDE reactions after timeout - returns to correct state based on OYE setting
  // Disappear mode: returns to State 0 (clean, no bar)
  // Fade mode: returns to ghosted bar (not fully bright)
  useEffect(() => {
    if (isReactionsRevealed) {
      const reactionsTimer = setTimeout(() => {
        setIsReactionsRevealed(false);
        setIsControlsRevealed(false);
        setShowOyoIsland(false);
      }, 4000); // 4 seconds then return to default state
      return () => clearTimeout(reactionsTimer);
    }
  }, [isReactionsRevealed]);

  // PORTAL SCROLL CONTROLS - tap red/blue portal to scroll outward (reverse direction)
  const [hotScrollTrigger, setHotScrollTrigger] = useState(0);
  const [discoveryScrollTrigger, setDiscoveryScrollTrigger] = useState(0);

  // PORTAL GLOW - lights up when scrolling outward (from VOYO to portal)
  const [hotPortalGlow, setHotPortalGlow] = useState(false);
  const [discoveryPortalGlow, setDiscoveryPortalGlow] = useState(false);


  // SKEEP STATE - Custom seek-based fast-forward/rewind (nostalgic CD player ch-ch-ch effect)
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubDirection, setScrubDirection] = useState<'forward' | 'backward' | null>(null);
  const [skeepLevel, setSkeepLevel] = useState(1); // 1=2x, 2=4x, 3=8x (for display)
  const skeepHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skeepSeekInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const skeepEscalateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasSkeeping = useRef(false); // Track if we just finished skeeping (to prevent skip on release)
  const wasSkeepingClearedAt = useRef(0); // Timestamp when SKEEP ended — safety belt against rAF starvation in background
  const skeepLevelRef = useRef(1);
  const skeepTargetTime = useRef(0); // Track target position ourselves (store updates too slowly)
  const wasPlayingBeforeSkeep = useRef(false); // Remember if we need to resume after SKEEP

  // Jump distances for seek-based SKEEP
  // BIGGER jumps for real impact - YouTube is PAUSED during seek mode
  // Level 1 (2x): 0.3s every 100ms = 3s/sec = ~3x (backward only, forward uses native)
  // Level 2 (4x): 0.6s every 100ms = 6s/sec = ~6x
  // Level 3 (8x): 1.2s every 100ms = 12s/sec = ~12x (feels like real fast-forward!)
  const getJumpDistance = (level: number, isBackward: boolean) => {
    if (isBackward) {
      if (level === 1) return 0.4;  // 2x feel
      if (level === 2) return 0.8;  // 4x feel
      return 1.5;                    // 8x feel
    }
    // Forward: level 1 uses native 2x, levels 2-3 use seek
    if (level === 2) return 0.8;    // 4x feel
    return 1.5;                      // 8x feel
  };

  // Handle SKEEP start (after 200ms hold to differentiate from tap)
  const handleScrubStart = useCallback((direction: 'forward' | 'backward') => {
    devLog('🎵 SKEEP: handleScrubStart called', direction);
    // Set a timer - if held for 200ms, start SKEEP mode
    skeepHoldTimer.current = setTimeout(() => {
      devLog('🎵 SKEEP: 200ms passed, starting SKEEP mode', direction);
      setIsScrubbing(true);
      setScrubDirection(direction);
      setSkeepLevel(1);
      skeepLevelRef.current = 1;
      haptics.medium();

      const isBackward = direction === 'backward';

      // HYBRID SKEEP:
      // - Forward Level 1: Native playbackRate=2 (smooth chipmunk)
      // - Forward Level 2+: Seek-based (ch-ch-ch)
      // - Backward: Always seek-based (no native reverse playback)

      if (!isBackward) {
        // Forward: start with native 2x
        devLog('🎵 SKEEP: Setting native playbackRate to 2');
        setPlaybackRate(2);
      }

      // Start seek interval for backward OR when we escalate past 2x
      const startSeekMode = () => {
        if (skeepSeekInterval.current) return; // Already running
        devLog('🎵 SKEEP: Starting seek mode');

        // PAUSE playback so YouTube doesn't fight our seeks!
        const { isPlaying } = usePlayerStore.getState();
        wasPlayingBeforeSkeep.current = isPlaying;
        if (isPlaying) {
          devLog('🎵 SKEEP: Pausing playback for clean seeks');
          handlePlayPause(); // Pause
        }

        // Initialize target time from current position
        const { currentTime, duration: dur } = usePlayerStore.getState();
        skeepTargetTime.current = currentTime;
        devLog('🎵 SKEEP: Initialized target time to', currentTime.toFixed(1));

        skeepSeekInterval.current = setInterval(() => {
          const { duration: dur } = usePlayerStore.getState();
          const jump = getJumpDistance(skeepLevelRef.current, isBackward);

          // Update OUR target time (don't read from store - it's too slow to update)
          skeepTargetTime.current = isBackward
            ? Math.max(skeepTargetTime.current - jump, 0)
            : Math.min(skeepTargetTime.current + jump, dur - 0.5);

          devLog('🎵 SKEEP: Seeking to', skeepTargetTime.current.toFixed(1), 'jump:', jump);
          seekTo(skeepTargetTime.current);
          haptics.light();
        }, 100); // Faster interval (100ms) for smoother seeking
      };

      // Backward starts seek immediately
      if (isBackward) {
        startSeekMode();
      }

      // Escalate every 800ms: level 1 → 2 → 3 (max)
      const escalate = () => {
        if (skeepLevelRef.current < 3) {
          skeepLevelRef.current += 1;
          setSkeepLevel(skeepLevelRef.current);
          haptics.heavy();

          // Forward: switch from native to seek at level 2
          if (!isBackward && skeepLevelRef.current === 2) {
            setPlaybackRate(1); // Reset native speed
            startSeekMode(); // Start seek-based
          }

          skeepEscalateTimer.current = setTimeout(escalate, 800);
        }
      };
      skeepEscalateTimer.current = setTimeout(escalate, 800);
    }, 200);
  }, [seekTo, setPlaybackRate, handlePlayPause]);

  // Handle SKEEP end
  const handleScrubEnd = useCallback(() => {
    // Clear hold timer
    if (skeepHoldTimer.current) {
      clearTimeout(skeepHoldTimer.current);
      skeepHoldTimer.current = null;
    }

    // Clear seek interval
    if (skeepSeekInterval.current) {
      clearInterval(skeepSeekInterval.current);
      skeepSeekInterval.current = null;
    }

    // Clear escalation timer
    if (skeepEscalateTimer.current) {
      clearTimeout(skeepEscalateTimer.current);
      skeepEscalateTimer.current = null;
    }

    // Return to normal playback
    if (isScrubbing) {
      wasSkeeping.current = true; // Flag to prevent skip on click
      setPlaybackRate(1); // Reset native playback speed
      setIsScrubbing(false);
      setScrubDirection(null);
      setSkeepLevel(1);
      skeepLevelRef.current = 1;

      // Resume playback if it was playing before SKEEP
      if (wasPlayingBeforeSkeep.current) {
        devLog('🎵 SKEEP: Resuming playback');
        setTimeout(() => {
          const { isPlaying } = usePlayerStore.getState();
          if (!isPlaying) handlePlayPause(); // Resume
        }, 50); // Small delay to let seek settle
      }
      wasPlayingBeforeSkeep.current = false;

      // Clear the flag after the bubbled click would have fired.
      // Originally rAF only — but rAF is starved in background tabs, so the
      // flag could get stuck `true` forever once the user backgrounded mid-
      // SKEEP, silently blocking every future manual skip. Belt-and-braces:
      // both rAF (fast for foreground) and setTimeout (always fires).
      // Plus we stamp the moment SKEEP ended so handleNextTrack can apply a
      // hard 250ms upper bound regardless of which clearer fired.
      wasSkeepingClearedAt.current = Date.now();
      const clear = () => { wasSkeeping.current = false; };
      requestAnimationFrame(clear);
      setTimeout(clear, 80);
    }
  }, [isScrubbing, setPlaybackRate, handlePlayPause]);

  // v836: keep the disk-skeep refs pointed at the latest handlers
  // so handleCanvasPointerDown (declared earlier in source order)
  // can fire skeep without TDZ issues.
  useEffect(() => {
    handleScrubStartRef.current = handleScrubStart;
    handleScrubEndRef.current = handleScrubEnd;
  }, [handleScrubStart, handleScrubEnd]);

  // Safe next track - blocks only if SKEEP truly just ended (≤250ms window).
  const handleNextTrack = useCallback(() => {
    if (wasSkeeping.current && Date.now() - wasSkeepingClearedAt.current < 250) return;
    wasSkeeping.current = false;
    // Central orchestrator — app.skip fires OYO skip signal with position
    // then delegates to playerStore.nextTrack, which runs the full signal
    // fanout and advance.
    app.skip();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // v915 — skeepEscalateTimer is a setTimeout; was clearInterval
      // (works in browsers but semantic debt). Aligned to clearTimeout.
      if (skeepEscalateTimer.current) clearTimeout(skeepEscalateTimer.current);
      if (skeepHoldTimer.current) clearTimeout(skeepHoldTimer.current);
      // (audit-2 P0-PUI-1) skeepSeekInterval was missed from this
      // cleanup. The 100ms seekTo() interval kept scrubbing whatever
      // track the next-mounted player loaded after this player
      // unmounted (rotate device, Suspense fallback, etc).
      if (skeepSeekInterval.current) clearInterval(skeepSeekInterval.current);
    };
  }, []);

  // Get actual history tracks (these are "played")
  const historyTracks = history.slice(-2).map(h => h.track).reverse();

  // Get actual queue tracks (FIX 1: Show more queue items for better UX)
  const queueTracks = queue.slice(0, 3).map(q => q.track);

  // Track IDs that have been played (for overlay)
  const playedTrackIds = new Set(history.map(h => h.track.id));

  // Handle reaction with store integration
  const handleReaction = (type: ReactionType, emoji: string, text: string, multiplier: number) => {
    addReaction({
      type,
      text,
      emoji,
      multiplier,
      userId: 'user-1',
    } as any);
    oyaPlanSignal('reaction', currentTrack?.artist ?? '');
  };

  // (30s teaser preview removed — tap on a stream card now plays the
  // full track immediately on every device.)

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleHeaderScroll}
      className={`relative w-full h-full bg-[#020203] text-white font-sans flex flex-col overflow-x-hidden overflow-y-auto ${scrollTaught ? 'scrollbar-hide' : ''}`}
      // FULL-SCREEN SWIPE SURFACE (Dash 2026-04-28: "the whole screen but
      // a precise swipe"). Pointer handlers live on the outermost
      // container so horizontal next/drift gestures can be initiated
      // from anywhere — not just the BigCenterCard. touchAction: pan-y
      // lets the browser handle vertical scroll natively while leaving
      // horizontal motion to JS pointermove. Interactive children
      // (buttons, inputs, horizontal rails) are filtered via
      // didOriginateOnInteractive + the data-no-canvas-swipe attribute
      // inside handleCanvasPointerDown — the precise-gesture filter.
      style={{ touchAction: 'pan-y', overscrollBehavior: 'none' }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerCancel}
    >

      {/* v874 — Side-walls of light, four variants (one per gesture).
          Each side carries its own color so the user learns the grammar:
            RIGHT pink     = LOVED (quick)
            RIGHT bronze   = DISCOVER (hold)
            LEFT  silver   = SKIP (quick)
            LEFT  indigo   = LESS (hold)
          mix-blend-mode: screen for atmospheric "wall of light" feel.
          z 60 — above the canvas content, below modals. */}
      <div
        ref={wallLikeRef}
        aria-hidden
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '40vw', maxWidth: 320,
          pointerEvents: 'none', opacity: 0,
          background: 'linear-gradient(to left, rgba(244,114,182,0.42) 0%, rgba(244,114,182,0.18) 35%, rgba(244,114,182,0) 100%)',
          mixBlendMode: 'screen',
          transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 60,
        }}
      />
      <div
        ref={wallDiscoverRef}
        aria-hidden
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '40vw', maxWidth: 320,
          pointerEvents: 'none', opacity: 0,
          background: 'linear-gradient(to left, rgba(230,197,138,0.42) 0%, rgba(230,197,138,0.18) 35%, rgba(230,197,138,0) 100%)',
          mixBlendMode: 'screen',
          transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 60,
        }}
      />
      {/* v875 — color swap: wallSkipRef now renders the INDIGO glow
          for DRIFT (was silver), wallLessRef renders SILVER for LESS
          (was indigo). Indigo = signal of redirection; silver =
          neutral move-on. */}
      <div
        ref={wallSkipRef}
        aria-hidden
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: '40vw', maxWidth: 320,
          pointerEvents: 'none', opacity: 0,
          background: 'linear-gradient(to right, rgba(91,127,190,0.55) 0%, rgba(91,127,190,0.22) 35%, rgba(91,127,190,0) 100%)',
          mixBlendMode: 'screen',
          transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 60,
        }}
      />
      <div
        ref={wallLessRef}
        aria-hidden
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: '40vw', maxWidth: 320,
          pointerEvents: 'none', opacity: 0,
          background: 'linear-gradient(to right, rgba(232,238,247,0.40) 0%, rgba(232,238,247,0.16) 35%, rgba(232,238,247,0) 100%)',
          mixBlendMode: 'screen',
          transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 60,
        }}
      />

      {/* v874 GESTURE PILL — refined. Repositioned from old bottom 22%
          to TOP region (above the BigCenterCard, in the natural
          eye-line). Drifts counter-swipe so it stays visible while
          the finger pulls the wall side. Glass language preserved. */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0, right: 0,
          top: 'calc(env(safe-area-inset-top, 0px) + 14%)',
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 65,
        }}
      >
        <div
          ref={swipeLabelRef}
          aria-hidden
          style={{
            background: 'rgba(15,15,22,0.62)',
            backdropFilter: 'blur(20px) saturate(150%)',
            WebkitBackdropFilter: 'blur(20px) saturate(150%)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 999,
            padding: '7px 18px',
            fontFamily: "'Fraunces', 'Satoshi', system-ui, serif",
            fontStyle: 'italic',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '0.05em',
            opacity: 0,
            transform: 'translate(0, 4px) scale(0.92)',
            transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), transform 320ms cubic-bezier(0.16, 1, 0.3, 1), color 200ms ease, box-shadow 220ms ease',
            textShadow: '0 0 10px currentColor, 0 0 18px currentColor',
            boxShadow: '0 0 0 rgba(0,0,0,0)',
            whiteSpace: 'nowrap',
          }}
        />
      </div>

      {/* SCREEN-EDGE SKEEP zones (kept from v867). 22% width with
          safe-area insets so topBar / navbar stay tappable. */}
      <div
        data-screen-skeep="backward"
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          top: 'calc(env(safe-area-inset-top, 0px) + 88px)',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)',
          width: '22%', maxWidth: 120,
          pointerEvents: 'auto', zIndex: 12,
        }}
      />
      <div
        data-screen-skeep="forward"
        aria-hidden
        style={{
          position: 'fixed',
          right: 0,
          top: 'calc(env(safe-area-inset-top, 0px) + 88px)',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)',
          width: '22%', maxWidth: 120,
          pointerEvents: 'auto', zIndex: 12,
        }}
      />

      {/* FULLSCREEN BACKGROUND - Album art with dark overlay for floating effect.
          Auto-shows when videoBlocked (region-restricted embeds → graceful fallback). */}
      {(backdropEnabled || videoBlocked) && (
        <FullscreenBackground trackId={currentTrack?.trackId} />
      )}

      {/* (v795 Dash 2026-04-29: BackdropToggle removed from the main
          surface. Backdrop is now ON by default; toggle lives in Settings
          → Studio so the player itself stays uncluttered.) */}

      {/* BACKDROP LIBRARY MODAL */}
      
        {isBackdropLibraryOpen && (
          <BackdropLibrary
            isOpen={isBackdropLibraryOpen}
            onClose={() => setIsBackdropLibraryOpen(false)}
            currentBackdrop={currentBackdrop}
            onSelect={(bd) => {
              setCurrentBackdrop(bd);
              setBackdropEnabled(true);
              setIsBackdropLibraryOpen(false);
              }}
          />
        )}
      


      {/* OYO ISLAND - DJ Voice Search & Chat (tap screen to show) */}
      <div data-no-canvas-swipe="true">
        <OyoIsland
          visible={showOyoIsland}
          onHide={() => setShowOyoIsland(false)}
          onActivity={() => {
            // Reset controls auto-hide timer when interacting with OYO
            if (controlsHideTimerRef.current) {
              clearTimeout(controlsHideTimerRef.current);
              controlsHideTimerRef.current = setTimeout(() => {
                setIsControlsRevealed(false);
                setShowOyoIsland(false);
              }, 5000); // Extended timeout when interacting
            }
            }}
        />
      </div>

      {/* (Fullscreen video render block removed 2026-04-28 — was a dead
          stub. Cinema lives in components/voyo/VideoMode.tsx, reached via
          landscape rotation. Take Out remains PiP, do not reroute.) */}


      {/* ╔═════════════════════════════════════════════════════════════╗
          ║ ANCHOR LAYER (A) — top bubbles + center hero, always fixed  ║
          ║ Position: sticky at top:0 of the scroll container.          ║
          ║ Height = viewport minus the music shelf (Layer B) so Layer  ║
          ║ B is visible AT REST in the bottom slice of the screen, and ║
          ║ the anchor stays put as user scrolls deeper into Layer C.   ║
          ║                                                             ║
          ║ v763+: reservation tracks Layer B's actual min-h state      ║
          ║ (line ~5620). Was a flat 264px which broke on iPhone SE     ║
          ║ when cubeDockOpen pushed Layer B to 480px+28 translate —    ║
          ║ Anchor stayed too tall, hero was cropped under Layer B.     ║
          ╚═════════════════════════════════════════════════════════════╝ */}
      <div
        className="sticky top-0 z-20 flex flex-col flex-shrink-0"
        style={{
          // v790: Anchor reservation reduced by 32px so the Frame
          // (HOT/Discovery + Mix Board) drops down a touch — engine vinyl
          // peeks above Frame at rest. Layer B's min-h reduced in lockstep
          // so the bottom edge stays put.
          // v791: another 6px tiny drop — Dash "drop it down a tiny bit,
          // just artist name slightly covered". Was 476/356/232.
          // v792: 4px more — "tiny bit lower more". Was 466/346/222.
          // v805 (Dash 2026-04-29): pixel offsets converted to clamp(min,
          // vh-based, max) so the layout breathes correctly across
          // iPhone SE → Pro Max → iPad portrait → PWA standalone (no
          // browser chrome = full device height). On compact viewports
          // the min kicks in (frame doesn't shrink past usability); on
          // tall viewports the max caps it (frame doesn't dominate).
          // Locked baseline values from v803 sit near the middle of each
          // clamp band.
          height: `calc(100% - clamp(280px, 36dvh, 340px))`,
        }}
      >

      {/* JAM CHIP — shown when visitor is locked to a host's verse.
          Fades with portalProgress (matches the bubbles row at line ~5227)
          so the chip doesn't sit on top of Layer C content during scroll. */}
      {jammingWith && (
        <div
          className="absolute top-0 left-0 right-0 z-30 flex justify-center"
          style={{
            paddingTop: 'calc(max(0.5rem, env(safe-area-inset-top)) + 8px)',
            opacity: Math.max(0, 1 - Math.max(0, (portalProgress - 0.55) / 0.35)),
            pointerEvents: portalProgress > 0.7 ? 'none' : 'auto',
            transition: 'opacity 0.2s ease-out',
          }}
        >
          <div
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold"
            style={{
              background: 'radial-gradient(ellipse at top, rgba(168,85,247,0.28) 0%, rgba(212,160,83,0.14) 60%, rgba(0,0,0,0.55) 100%)',
              border: '1px solid rgba(168,85,247,0.35)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <span>🎧</span>
            <button
              onClick={() => navigateToProfile(`/${jammingWith.dashId}`)}
              className="text-purple-300 hover:text-white transition-colors"
            >
              Jamming {jammingWith.name}'s verse
            </button>
            <span className="text-white/30">•</span>
            <button
              onClick={() => endJam()}
              className="text-white/50 hover:text-white transition-colors"
            >
              Leave
            </button>
          </div>
        </div>
      )}

      {/* --- TOP SECTION (History/Queue) --- Part of the anchor.
           Visible in step 1 of the portal scroll. In step 2 (canvas
           reveal), the bubbles fade out so only the central OYO player
           and the canvas remain. Carousel side-shift on each rail.
           When committing to mini-player (videoTarget==='portrait'),
           the top row dissolves entirely — the floating mini chip and
           the queue cards otherwise pile onto the same vertical band,
           and the warm-it-up philosophy says: when the user goes video,
           the queue gets out of the way. */}
      <div
        className="px-3 flex items-start gap-3 z-20 h-[14%]"
        style={{
          paddingTop: 'max(calc(env(safe-area-inset-top, 0px) + 4px), 36px)',
          opacity: videoTarget === 'portrait'
            ? 0
            : Math.max(0, 1 - Math.max(0, (portalProgress - 0.55) / 0.35)),
          transform: videoTarget === 'portrait'
            ? 'translateY(-12px)'
            : `translateY(${Math.max(0, (portalProgress - 0.55) / 0.35) * -16}px)`,
          pointerEvents: (videoTarget === 'portrait' || portalProgress > 0.7) ? 'none' : 'auto',
          transition: 'opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1), transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >

        {/* Left: History (scrollable). Width shifts based on active side.
            v789: overflow-x clipped (carousel needs horizontal containment)
            but overflow-y visible — was clipping next-up bronze halo on
            small cards (Dash 2026-04-28). */}
        <div
          className="relative"
          style={{
            flexBasis: topRowActive === 'history' ? '68%' : topRowActive === 'queue' ? '30%' : '49%',
            transition: 'flex-basis 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
            overflowX: 'clip',
            overflowY: 'visible',
          }}
          data-no-canvas-swipe="true"
          onPointerDown={() => activateTopRow('history')}
          onTouchStart={() => activateTopRow('history')}
        >
          <div
            className="flex gap-3 overflow-x-auto scrollbar-hide"
            style={{
              // Proximity (not mandatory) — matches HomeFeed rails so
              // small horizontal gestures let the user peek at the next
              // item without forced snap.
              scrollSnapType: 'x proximity',
              pointerEvents: topRowActive === 'queue' ? 'none' : 'auto',
            }}
            onScroll={() => activateTopRow('history')}
          >
            {historyTracks.length > 0 ? (
              historyTracks.slice(0, 10).map((track, i) => (
                <div key={track.id} style={{ scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <SmallCard track={track} onTap={() => playTrack(track)} isPlayed={true} />
                </div>
              ))
            ) : (
              // Empty state - show DASH placeholders
              <>
                <DashPlaceholder onClick={onSearch} label="history" />
                <DashPlaceholder onClick={onSearch} label="history" />
              </>
            )}
          </div>
        </div>

        {/* Right: Queue + Add (scrollable, reversed). Side-shift mirror.
            v789: same overflow fix as History — vertical overflow visible
            so the next-up halo isn't clipped at the top. */}
        <div
          className="relative"
          style={{
            flexBasis: topRowActive === 'queue' ? '68%' : topRowActive === 'history' ? '30%' : '49%',
            transition: 'flex-basis 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
            overflowX: 'clip',
            overflowY: 'visible',
          }}
          onPointerDown={() => activateTopRow('queue')}
          onTouchStart={() => activateTopRow('queue')}
        >
          <div
            className="flex gap-3 overflow-x-auto scrollbar-hide flex-row-reverse"
            style={{
              scrollSnapType: 'x proximity',
              pointerEvents: topRowActive === 'history' ? 'none' : 'auto',
            }}
            onScroll={() => activateTopRow('queue')}
          >
            {/* Add button always visible at end. Was bg-white/5 + border
                white/5 — nearly invisible on dark canvas. Bumped border to
                purple/20 so empty-queue users can see the affordance. */}
            <button
              onClick={onSearch}
              className="flex-shrink-0 w-[70px] h-[70px] rounded-2xl bg-white/10 border border-purple-500/20 flex items-center justify-center hover:bg-white/15 transition-colors"
              style={{ scrollSnapAlign: 'start' }}
            >
              <Plus size={24} className="text-gray-400" />
            </button>

            {queueTracks.length > 0 ? (
              queueTracks.slice(0, 10).map((track, i) => (
                <div key={track.id} style={{ scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <SmallCard track={track} onTap={() => playTrack(track)} isPlayed={playedTrackIds.has(track.id)} isNextUp={i === 0} />
                </div>
              ))
            ) : (
              // Empty queue - show DASH placeholder
              <DashPlaceholder onClick={onSearch} label="bucket" />
            )}
          </div>
        </div>
      </div>

      {/* --- CENTER SECTION (Hero + Engine) --- */}
      {/* TAP: Quick controls | HOLD/DOUBLE TAP: Full DJ Mode */}
      <div
        className="flex flex-col items-center justify-end relative z-10 flex-1 pt-12"
        style={{
          // pan-y: browser handles vertical scroll (portal reveal), JS handles
          // horizontal (card drag). The pointer handlers LIVE HERE on the center
          // section, not on the outer container (which has 'manipulation').
          // (Was translateY(28px) — pushed artwork below visual center on
          // short viewports like iPhone SE. justify-end already places the
          // hero at the bottom of Layer A; the extra 28 served no purpose
          // on tall viewports either.)
          touchAction: 'pan-y',
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerCancel}
        onClick={handleCanvasTap}
      >

        {/* RIGHT-SIDE TOOLBAR - Always visible */}
        <RightToolbar onSettingsClick={handleOpenBoostSettings} />

        {/* 1. Main Artwork with Expand Video Button + GLOBAL DRAG WRAPPER.
            cardWrapRef receives direct style mutations on pointermove (no
            re-render). Dragging from anywhere on the app surface drives
            this transform via handleCanvasPointerMove → applyCardTransform.

            v789: outer translateY shifts the hero ~36px lower in its
            frame — half the retracted Mini Player chip height (44px / 2)
            + ~75% of the same as a "decided" extra. Top row stays put,
            the artwork sits a touch deeper which feels less compacted.
            The inner cardWrapRef keeps its swipe transform (translateX
            during drag), so vertical and horizontal positioning compose
            cleanly. (Dash 2026-04-28)
            v792: bumped 36 → 42 — Dash "a tiny bit lower more, same
            for pause button". The pause button (engine vinyl below) is
            also nudged via the engine wrapper a few lines down.
            v802: 42 → 36 (card lifts back up 6px) paired with Frame +6.
            v803: 36 → 32 (another −4) paired with Frame +4 = 20px total
            artist breathing room — Dash "20 is the sweet spot". */}
        <div style={{ transform: 'translateY(32px)' }}>
        <div
          ref={cardWrapRef}
          className="relative"
          style={{
            // Initial state — handlers overwrite when dragging.
            transform: 'translateX(0) rotate(0deg)',
            transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out',
          }}
        >
          {currentTrack ? (
            <BigCenterCard
              track={currentTrack}
              // Stage 1: tap = expand to mini player (floating iframe).
              // Stage 2: 5s after mini engages the chip morphs to
              // "Take Out" — tapping Take Out enters system PiP via
              // pipService directly. Don't reroute this flow.
              onExpandVideo={() => setVideoTarget('portrait')}
              // v892: cube auto-promotes to iframe ~800ms after play
              // starts (see useEffect above). No manual entry button.
              onShowLyrics={() => setShowLyricsOverlay(true)}
              // v826: when lyrics arms, cancel the canvas DJ-mode 400ms
              // hold + mark the gesture as a hold so the trailing click
              // doesn't toggle video mode. didHoldRef.current = true
              // tells handleCanvasTap to skip; clearing holdTimerRef
              // stops DJ mode wake from firing 50ms later.
              onLyricsArmed={() => {
                if (holdTimerRef.current) {
                  clearTimeout(holdTimerRef.current);
                  holdTimerRef.current = null;
                }
                didHoldRef.current = true;
              }}
              hideThumb={videoTarget === 'portrait'}
              isIframeAudio={playbackSource === 'iframe'}
              isMiniPlayerActive={videoTarget === 'portrait'}
              controlsActive={isControlsRevealed}
            />
          ) : (
            <div className="w-48 h-48 rounded-[2rem] bg-black/30 border border-white/5 flex items-center justify-center">
              <Play size={32} className="text-white/20" />
            </div>
          )}

          {/* LEFT QUICK CONTROLS - ")" arc: center reaches IN toward card.
              Always mounted (conditional isControlsRevealed now controls
              opacity/transform via CSS) so the reveal/hide animates instead
              of popping. pointer-events flips off when hidden so dead
              buttons don't steal taps. */}
          <div
            className="absolute top-1/2 -left-14 flex flex-col gap-4"
            style={{
              transform: isControlsRevealed
                ? 'translateY(-50%) scale(1)'
                : 'translateY(-50%) scale(0.85) translateX(-6px)',
              opacity: isControlsRevealed ? 1 : 0,
              pointerEvents: isControlsRevealed ? 'auto' : 'none',
              transition: 'opacity 0.28s ease-out, transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            aria-hidden={!isControlsRevealed}
          >
            {isControlsRevealed && (
              <>
                {/* Shuffle - Top of ")", slightly OUT */}
                <button
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors -translate-x-[2px] ${
                    shuffleMode
                      ? 'bg-fuchsia-500/30 border border-fuchsia-500/50 text-fuchsia-400'
                      : 'bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300/70 hover:bg-fuchsia-500/30'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleShuffle();
                    haptics.light();
                  }}
                  title={shuffleMode ? 'Shuffle On' : 'Shuffle Off'}
                >
                  <Shuffle size={16} />
                </button>

                {/* Repeat - Middle of ")", reaches IN closest to card */}
                <button
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors translate-x-[6px] ${
                    repeatMode === 'one'
                      ? 'bg-purple-500/30 border border-purple-500/50 text-purple-400'
                      : repeatMode === 'all'
                      ? 'bg-violet-500/30 border border-violet-500/50 text-violet-400'
                      : 'bg-purple-500/20 border border-purple-500/30 text-purple-300/70 hover:bg-purple-500/30'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    cycleRepeat();
                    haptics.light();
                  }}
                  title={repeatMode === 'one' ? 'Repeat One' : repeatMode === 'all' ? 'Repeat All' : 'Repeat Off'}
                >
                  {repeatMode === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
                </button>

                {/* Share - Bottom of ")", slightly OUT */}
                <button
                  className="w-9 h-9 rounded-full bg-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center text-fuchsia-300/70 hover:bg-fuchsia-500/30 transition-colors -translate-x-[2px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentTrack && navigator.share) {
                      navigator.share({
                        title: currentTrack.title,
                        text: `Listen to ${currentTrack.title} by ${currentTrack.artist} on VOYO`,
                        url: window.location.href,
                      }).catch(() => {});
                    }
                    haptics.light();
                  }}
                  title="Share"
                >
                  <Share2 size={16} />
                </button>
              </>
            )}
          </div>

        </div>
        </div>{/* /translateY wrapper (v789 hero bump) */}

        {/* FLOATING REACTIONS OVERLAY — OYÉ filtered out (gateway, not
            celebration; Dash 2026-04-28 "remove the confettis on oye"). */}
        <div className="absolute inset-0 pointer-events-none">

            {reactions.filter(r => r.type !== 'oye').map(reaction => (
              <div
                key={reaction.id}
                className="absolute"
                style={{ left: `${reaction.x}%`, bottom: '30%' }}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl">{reaction.emoji}</span>
                  {reaction.multiplier > 1 && (
                    <span className={`font-bold ${reaction.multiplier >= 10 ? 'text-2xl text-[#D4A053]' : 'text-lg text-[#D4A053]'}`}>
                      {reaction.multiplier}x{reaction.multiplier >= 10 ? '!!!' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}

        </div>

        {/* (Old MINIMAL PROGRESS row removed 2026-04-29 v790 — the seek
            now lives inside the BigCenterCard below the artist name as
            CardSeek. Auto-fades after 5s, faded baseline. Frees up the
            engine row for cleaner play/pause + jog buttons.) */}

        {/* 2. THE ENGINE (Play Control) — SPINNING VINYL DISK + JOG.
            v868 (Dash 2026-04-29 "keep on first screen only as art
            depth, do not show on second screen all together instead
            of no spin only"). Inverted gating: engine is FIRST-SCREEN
            ART. As soon as the user scrolls into Frame (portal >= 0.4),
            the whole engine FADES OUT, not just the spin. On Anchor
            it's the music's heartbeat; on Canvas it's just clutter.
            v792 translateY(12px) preserved. */}
        <div
          style={{
            // Hard hide on second screen (portal >= 0.4). On Anchor,
            // honour the existing controls-revealed gate so the disk
            // appears with engine-row taps as before.
            opacity: portalProgress >= 0.4
              ? 0
              : Math.max(isControlsRevealed ? 1 : 0, Math.min(1, Math.max(0, (0.4 - portalProgress) / 0.2))),
            pointerEvents: portalProgress >= 0.4 ? 'none' : (isControlsRevealed ? 'auto' : 'none'),
            transition: 'opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1), transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
            // v870 — Dash: lower engine a tiny bit more, raise reactions
            // by the same amount. 24px → 36px (engine drops 12 deeper).
            // The reaction bar wrapper below picks up translateY(-12px)
            // to mirror. Net: disk slips deeper into the HOT/Discover
            // slot; reactions + chat pull up toward where the disk
            // used to peek.
            transform: 'translateY(36px)',
          }}
        >
          <PlayControls
            isPlaying={isPlaying}
            // v834: the disk only spins on first screen — once the user
            // scrolls into Frame (HOT/Discover/Mix Board), rotation stops.
            // 0.3 matches the engine opacity ramp threshold above so the
            // visual effect ends together with the engine row's reveal.
            isFirstScreen={portalProgress < 0.3}
            // v835: tap-to-pause is dead. The disk button's onClick is
            // a no-op (stopPropagation only). Pause now lives on
            // hold-the-disk, handled at the canvas pointer level. The
            // onToggle prop stays for type compatibility but is unused
            // inside PlayControls now.
            onToggle={handlePlayPause}
            // Dash 2026-04-28: prev/next track nav lives on swipe now.
            // The engine buttons repurposed to JOG ±15s within the
            // current track. Hold still triggers SKEEP fast-scrub
            // (existing onScrubStart/End below), so the buttons read
            // as scrubbing tools, not navigation.
            onPrev={() => seekTo(Math.max(0, (usePlayerStore.getState().currentTime ?? 0) - 15))}
            onNext={() => seekTo((usePlayerStore.getState().currentTime ?? 0) + 15)}
            isScrubbing={isScrubbing}
            onScrubStart={handleScrubStart}
            onScrubEnd={handleScrubEnd}
            trackArt={currentTrack ? getTrackThumbnailUrl(currentTrack, 'max') : undefined}
            trackId={currentTrack?.trackId}
            scrubDirection={scrubDirection}
            skeepLevel={skeepLevel}
          />
        </div>

        {/* 3. OYÉ REACTIONS — only renders when visible.
            v870: translateY(-12px) mirrors the engine's +12 drop so
            the reactions + chat input rise toward where the disk
            used to peek. Equal-and-opposite move keeps the visual
            tension intact while compressing the gap. */}
        <div
          className="mt-3 min-h-[60px] flex items-center justify-center"
          style={{ transform: 'translateY(-12px)' }}
        >
          <ReactionBar
            onReaction={handleReaction}
            isRevealed={isControlsRevealed || isReactionsRevealed}
            onRevealChange={setIsReactionsRevealed}
            activateChatTrigger={activateChatTrigger}
          />
        </div>

        {/* DJ Wake Toast - "Now Peace ✌🏾".
            Was popping in/out with zero animation. Now fades + scale-pops
            on mount via the global voyo-fade-in keyframe, and fades out
            when showDJWakeMessage flips false. */}
        {showDJWakeMessage && (
          <div
            className="fixed inset-0 flex items-center justify-center pointer-events-none z-50 animate-[voyo-fade-in_0.3s_ease-out]"
          >
            <div
              className="px-6 py-3 rounded-full bg-black/60 backdrop-blur-xl border border-white/10"
              style={{
                animation: 'voyo-toast-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 0 24px rgba(139,92,246,0.18)',
              }}
            >
              <span className="text-white text-lg font-medium tracking-wide">
                {djWakeMessageText}
              </span>
            </div>
          </div>
        )}
        

      </div>

      {/* ╔═════════════════════════════════════════════════════════════╗
          ║ END OF ANCHOR LAYER — top + center wrapped above            ║
          ╚═════════════════════════════════════════════════════════════╝ */}
      </div>

      {/* ╔═════════════════════════════════════════════════════════════╗
          ║ LAYER B — MUSIC SHELF (HOT/DISCOVERY + MIX BOARD)            ║
          ║ Fades + slides up as portalProgress climbs. By progress=0.6  ║
          ║ it's mostly gone, by 1.0 it's fully out of the way.          ║
          ╚═════════════════════════════════════════════════════════════╝ */}

      {/* --- BOTTOM SECTION: DASHBOARD / MIX BOARD ---
          The "music control surface". Slightly concave Surface-Pro feel —
          elliptical top curve + inset shadow + a thin rim highlight giving
          the impression that the HOT/DISCOVERY rail is recessed into a
          shallow lensed dish, not stacked on a flat panel.
          When the cube dock is open, the min-height grows so the chat
          space slides in without pushing the rail offscreen. */}
      <div
        className="flex-shrink-0 w-full relative z-40 flex flex-col pt-3 pb-7 transition-[min-height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] min-h-[clamp(252px,33dvh,312px)]"
        style={{
          // Two-step Layer B fade.
          // Step 1 (portal 0 → 0.55): mild fade to ~60%, soft blur,
          //   user is "approaching" but Layer B is still readable.
          // Step 2 (portal 0.55 → 1.0): full fade out, Layer C takes
          //   over the same physical slot. Faded Layer B stays as a
          //   ghost behind Layer C for that immersive depth.
          opacity: portalProgress < 0.55
            ? 1 - portalProgress * 0.7  // step 1: 1.0 → 0.6
            : Math.max(0, 0.6 - (portalProgress - 0.55) * 1.5), // step 2: 0.6 → 0
          // Filter:blur dropped (was blur(${portalProgress * 8}px)) —
          // mobile Safari briefly re-rasterized this layer during the
          // ramp, flashing a white intermediate frame. Opacity carries
          // the fade alone now; adequate visual recede without the
          // compositor cost.
          // Gate at 0.4 (was 0.55) to match perceptual fade — by 0.4
          // Layer B is already ~72% opacity but visually receding;
          // taps would route THROUGH a dim layer otherwise.
          pointerEvents: portalProgress > 0.4 ? 'none' : 'auto',
          transform: `translateY(${portalProgress * -10}px) translateZ(0)`,
          transition: 'opacity 0.18s ease-out, transform 0.18s ease-out',
          background: 'linear-gradient(180deg, rgba(15,15,22,0.92) 0%, rgba(8,8,10,0.97) 28%, rgba(8,8,10,0.99) 100%)',
          // Elliptical top curve — wider in the middle than the corners
          // (the cube sits at the deepest part of the shallow dish).
          borderTopLeftRadius: '36px 28px',
          borderTopRightRadius: '36px 28px',
          // Concave depth: inset top shadow gives the recessed feel,
          // inset bottom highlight bounces a hint of light back up.
          boxShadow: [
            '0 -20px 60px -10px rgba(0,0,0,1)',
            'inset 0 14px 40px -14px rgba(0,0,0,0.85)',
            'inset 0 1px 0 rgba(255,255,255,0.06)',
            'inset 0 -1px 0 rgba(139,92,246,0.04)',
          ].join(', '),
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {/* Rim highlight — a thin gradient running along the curved top edge
            that catches "light" and sells the projected-on-glass feel. */}
        <div
          className="absolute top-0 left-0 right-0 h-px pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(212,160,83,0.18) 30%, rgba(139,92,246,0.22) 50%, rgba(212,160,83,0.18) 70%, transparent 100%)',
            borderTopLeftRadius: '36px',
            borderTopRightRadius: '36px',
          }}
        />

        {/* v880 — cube dock JSX retired entirely. The OYO chat path
            collapses to the single ReactionBar chat (under the OYE
            bar). Future "presence" surface will live as a fullscreen
            overlay triggered by holding the VOYO button in the
            bottom navbar — that build is its own session. */}

        {/* Stream Labels — HOT/Discover row.
            v873 (Dash 2026-04-29): disk-slot light reverted entirely.
            v869's bronze line + v872's two-layer atmospheric shade
            both removed. Row is back to the v868 baseline — labels
            only, no ambient slot. */}
        <div className="flex justify-between px-6 mb-1">
          {/* HOT Label — deep rust ember (mature, aged, premium) */}
          <button
            onClick={handleToggleHotBelt}
            className="flex items-center gap-1.5 px-2 py-1 rounded relative overflow-hidden"
            style={{
              background: 'rgba(181,74,46,0.10)',
              boxShadow: isHotBeltActive
                ? '0 0 15px rgba(181,74,46,0.4), inset 0 0 10px rgba(181,74,46,0.2)'
                : '0 0 8px rgba(181,74,46,0.2)'
                }}
          >
            <div>
              <Flame size={12} style={{ color: '#B54A2E' }} />
            </div>
            <span
              className="text-[11px] font-black tracking-[0.15em] uppercase"
              style={{ color: '#C86B3F' }}
            >
              HOT
            </span>
            {isHotBeltActive && (
              <span
                className="text-[6px] font-bold ml-0.5"
                style={{ color: '#D8825A' }}
              >
                ●
              </span>
            )}
          </button>

          {/* DISCOVERY Label — African Gold Bronze */}
          <button
            onClick={handleToggleDiscoveryBelt}
            className="flex items-center gap-1.5 px-2 py-1 rounded relative overflow-hidden"
            style={{
              background: 'rgba(212,160,83,0.1)',
              boxShadow: isDiscoveryBeltActive
                ? '0 0 15px rgba(212,160,83,0.4), inset 0 0 10px rgba(212,160,83,0.2)'
                : '0 0 8px rgba(212,160,83,0.2)'
                }}
          >
            {/* DISCOVER glyph + GPU-promoted halo. Was a text-shadow
                (paints every transition tick of the parent box-shadow).
                Replaced with a sibling div blur-glow on its own
                composite layer (translate3d) so the parent's
                isDiscoveryBeltActive box-shadow toggle no longer
                invalidates the text paint cache. */}
            <span
              className="relative text-[11px] font-black tracking-[0.15em] uppercase"
              style={{ color: '#D4A053' }}
            >
              <span
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'radial-gradient(ellipse at center, rgba(212,160,83,0.55) 0%, rgba(212,160,83,0) 70%)',
                  transform: 'translate3d(0,0,0)',
                  filter: 'blur(6px)',
                }}
              />
              <span style={{ position: 'relative' }}>DISCOVER</span>
            </span>
            {isDiscoveryBeltActive && (
              <span
                className="text-[6px] font-bold ml-0.5"
                style={{ color: '#E6B865' }}
              >
                ●
              </span>
            )}
          </button>
        </div>

        {/* Horizontal Scroll Deck - Two Separate Zones with side-shift.
            Same active-side mechanic as the top history/queue row: when
            HOT is active it expands to ~62%, DISCOVERY contracts. Idle
            returns to balance. Uses the existing isHotBeltActive /
            isDiscoveryBeltActive state. */}
        <div className="flex items-center relative h-24">

          {/* ========== HOT ZONE (Left side) ========== */}
          <div
            className="flex items-center relative h-full"
            style={{
              flexBasis: isHotBeltActive && !isDiscoveryBeltActive
                ? '62%'
                : isDiscoveryBeltActive && !isHotBeltActive
                ? '36%'
                : '49%',
              flexGrow: 0,
              flexShrink: 0,
              transition: 'flex-basis 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Rust Portal Line (left edge of HOT zone) — deep ember, premium.
                Hit area was 20×80 (w-5 h-20) — below the 44px floor.
                Bumped to w-11 (44px) with the visible line + glow + arrow
                kept inside an inner 20-wide wrapper so the visual rhythm
                is unchanged. */}
            <button
              onClick={() => {
                setHotScrollTrigger(prev => prev + 1);
                setIsHotBeltActive(true);
                setHotPortalGlow(true);
                setTimeout(() => setHotPortalGlow(false), 800);
                }}
              className="flex-shrink-0 w-11 h-20 relative z-20 touch-manipulation flex items-center justify-center"
              aria-label="Scroll HOT belt outward"
            >
              <div className="relative w-5 h-full">
                {/* Portal line — deep rust gradient */}
                <div
                  className="h-full w-1.5 mx-auto rounded-full"
                  style={{
                    background: hotPortalGlow
                      ? 'linear-gradient(180deg, #D8825A, #B54A2E, #D8825A)'
                      : 'linear-gradient(180deg, rgba(181,74,46,0.3), rgb(181,74,46), rgba(181,74,46,0.3))',
                    boxShadow: hotPortalGlow ? '0 0 30px #B54A2E' : '0 0 10px #B54A2E',
                  }}
                />
                {/* Ambient glow - always visible */}
                <div
                  className={`absolute inset-0 blur-lg transition-opacity duration-300 ${hotPortalGlow ? 'opacity-100' : 'opacity-40'}`}
                  style={{ background: '#B54A2E' }}
                />
                {/* Pulse ring on glow */}
                  {hotPortalGlow && (
                    <div
                      className="absolute inset-0 rounded-full border-2"
                      style={{ borderColor: '#D8825A' }}
                    />
                  )}

                {/* Arrow hint */}
                <div
                  className="absolute inset-0 flex items-center justify-center text-xs"
                >
                  ‹
                </div>
              </div>
            </button>

            {/* HOT Cards Belt (loops within this zone) */}
            <PortalBelt
              tracks={hotTracks.slice(0, 8)}
              onTap={playTrack}
              onQueueAdd={trackQueueAddition}
              playedTrackIds={playedTrackIds}
              type="hot"
              mixModes={DEFAULT_MIX_MODES}
              modeBoosts={modeBoosts}
              isActive={isHotBeltActive}
              scrollOutwardTrigger={hotScrollTrigger}
            />
          </div>

          {/* ========== VOYO FEED DIVIDER - Enhanced Portal Effects ========== */}
          <div className="flex-shrink-0 px-1 relative z-30">
            {/* Left fade - covers track overflow with dark gradient */}
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-16 h-28 -translate-x-12 pointer-events-none"
              style={{ background: 'linear-gradient(to right, #08080a 0%, #08080a 30%, transparent 100%)' }}
            />
            {/* Left glow — rust ember (HOT side) */}
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-20 -translate-x-8 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at right, rgba(181,74,46,0.5) 0%, transparent 70%)' }}
            />
            {/* Right fade - covers track overflow with dark gradient */}
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 w-16 h-28 translate-x-12 pointer-events-none"
              style={{ background: 'linear-gradient(to left, #08080a 0%, #08080a 30%, transparent 100%)' }}
            />
            {/* Right glow — bronze (DISCOVERY side) */}
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-20 translate-x-8 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at left, rgba(212,160,83,0.5) 0%, transparent 70%)' }}
            />

            {/* VOYO Portal Button (the CUBE) - tap = onVoyoFeed, hold = OYO chat dock.
                When held / open, it morphs into the animated orb form
                (toy-orb effects: gradient ring, halo, pulse). */}
            <button
              onClick={() => {
                if (didHoldRef.current) { didHoldRef.current = false; return; }
                onVoyoFeed();
              }}
              className="relative w-14 h-14 rounded-full flex flex-col items-center justify-center"
              style={{
                background: 'radial-gradient(circle at center, #1a1a2e 0%, #0f0f16 100%)',
                // v880 — cubeDockOpen / cubeHolding visual states retired.
                // Belt-active state retained.
                boxShadow: (isHotBeltActive || isDiscoveryBeltActive)
                  ? '-8px 0 25px rgba(181,74,46,0.5), 8px 0 25px rgba(212,160,83,0.5), 0 0 20px rgba(139,92,246,0.3), inset 0 0 20px rgba(139,92,246,0)'
                  : '-8px 0 25px rgba(181,74,46,0), 8px 0 25px rgba(212,160,83,0), 0 0 12px rgba(139,92,246,0.15), inset 0 0 20px rgba(139,92,246,0)',
                transition: 'box-shadow 0.4s ease',
              }}
              aria-label="VOYO — tap for feed"
            >
              {/* Stale: VOYO brand gradient ring — purple + bronze (no pink) */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background: 'linear-gradient(#0f0f16, #0f0f16) padding-box, linear-gradient(135deg, rgba(139,92,246,0.3), rgba(212,160,83,0.2), rgba(139,92,246,0.3)) border-box',
                  border: '1.5px solid transparent',
                  }}
              />

              {/* Active: Outer ring — rust → purple → bronze (static).
                  Restraint: no rotation animation; the gradient itself
                  carries the meaning. */}
                {(isHotBeltActive || isDiscoveryBeltActive) && (
                  <div
                    className="absolute inset-[-4px] rounded-full border-2 border-transparent pointer-events-none"
                    style={{
                      background: 'linear-gradient(90deg, rgba(181,74,46,0.6), transparent, rgba(212,160,83,0.6)) padding-box, linear-gradient(90deg, #B54A2E, #8b5cf6, #D4A053) border-box',
                      }}
                  />
                )}
              

              {/* Active: Inner glow - very smooth and subtle */}
              
                {(isHotBeltActive || isDiscoveryBeltActive) && (
                  <div
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle at center, rgba(147,51,234,0.2) 0%, transparent 70%)' }}
                  />
                )}
              

              {/* VOYO text - gradient on stale, white on active.
                  Hidden during the session-start teach so the Pause /
                  Scroll-down icon owns the cube center for ~10s. */}
              {teachStep === 'done' && ((isHotBeltActive || isDiscoveryBeltActive) ? (
                <span className="text-[9px] font-bold text-white tracking-widest relative z-10">VOYO</span>
              ) : (
                <span
                  className="text-[8px] font-bold tracking-widest relative z-10"
                  style={{
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.8), rgba(236,72,153,0.7))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    }}
                >
                  VOYO
                </span>
              ))}

              {/* Session-start teach overlay (v791, Dash 2026-04-29).
                  Phase 1 (0-5s): Pause icon — "tap to pause".
                  Phase 2 (5-10s): ChevronDown — "scroll for more".
                  Translucent bubble over the cube; pointer-events:none so
                  the cube remains tappable. Pulse-fade animation makes
                  it noticeable but not nagging. Once-per-session. */}
              {teachStep !== 'done' && (
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-full flex items-center justify-center pointer-events-none z-20"
                  style={{
                    background: 'rgba(15,15,22,0.55)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.20)',
                    boxShadow: '0 0 18px rgba(255,255,255,0.18)',
                    animation: 'voyo-teach-pulse 1.6s ease-in-out infinite',
                  }}
                >
                  {teachStep === 'pause' ? (
                    <Pause size={20} className="text-white/90" fill="currentColor" />
                  ) : (
                    <ChevronDown
                      size={22}
                      className="text-white/90"
                      style={{ animation: 'voyo-bounce-down 1.4s ease-in-out infinite' }}
                    />
                  )}
                </div>
              )}
            </button>
          </div>

          {/* ========== DISCOVERY ZONE (Right side) — side-shift mirror ========== */}
          <div
            className="flex items-center relative h-full"
            style={{
              flexBasis: isDiscoveryBeltActive && !isHotBeltActive
                ? '62%'
                : isHotBeltActive && !isDiscoveryBeltActive
                ? '36%'
                : '49%',
              flexGrow: 0,
              flexShrink: 0,
              transition: 'flex-basis 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* DISCOVERY Cards Belt (loops within this zone) */}
            <PortalBelt
              tracks={discoverTracks.slice(0, 8)}
              onTap={playTrack}
              onQueueAdd={trackQueueAddition}
              playedTrackIds={playedTrackIds}
              type="discovery"
              mixModes={DEFAULT_MIX_MODES}
              modeBoosts={modeBoosts}
              isActive={isDiscoveryBeltActive}
              scrollOutwardTrigger={discoveryScrollTrigger}
            />

            {/* Bronze Portal Line (right edge of DISCOVERY zone) - CLICKABLE SCROLL CONTROL.
                Hit area was 20×80 (w-5 h-20) — below the 44px floor.
                Bumped to w-11 (44px) with the visible line + glow + arrow
                kept inside an inner 20-wide wrapper so the visual rhythm
                is unchanged. */}
            <button
              onClick={() => {
                setDiscoveryScrollTrigger(prev => prev + 1);
                setIsDiscoveryBeltActive(true);
                // Trigger glow effect
                setDiscoveryPortalGlow(true);
                setTimeout(() => setDiscoveryPortalGlow(false), 800);
                }}
              className="flex-shrink-0 w-11 h-20 relative z-20 touch-manipulation flex items-center justify-center"
              aria-label="Scroll DISCOVERY belt outward"
            >
              <div className="relative w-5 h-full">
                {/* Portal line — African Gold Bronze */}
                <div
                  className="h-full w-1.5 mx-auto rounded-full"
                  style={{
                    background: discoveryPortalGlow
                      ? 'linear-gradient(180deg, #E6B865, #D4A053, #E6B865)'
                      : 'linear-gradient(180deg, rgba(212,160,83,0.3), rgb(212,160,83), rgba(212,160,83,0.3))',
                    boxShadow: discoveryPortalGlow ? '0 0 30px #D4A053' : '0 0 10px #D4A053',
                  }}
                />
                {/* Ambient glow - always visible */}
                <div className={`absolute inset-0 blur-lg transition-opacity duration-300 ${discoveryPortalGlow ? 'opacity-100' : 'opacity-40'}`} style={{ background: '#D4A053' }} />
                {/* Pulse ring on glow */}

                  {discoveryPortalGlow && (
                    <div
                      className="absolute inset-0 rounded-full border-2"
                      style={{ borderColor: '#E6B865' }}
                    />
                  )}

                {/* Arrow hint */}
                <div
                  className="absolute inset-0 flex items-center justify-center text-xs"
                >
                  ›
                </div>
              </div>
            </button>
          </div>

        </div>

        {/* MIX BOARD — v811 polish (Dash 2026-04-29 "polish mix board,
            its immature"). Section header gets premium Fraunces italic
            for "Your Vibes", a bronze hairline below to anchor the
            row, and a bronze "See all" instead of the kid-purple hover. */}
        <div className="mt-4 px-4">
          <div className="flex items-center justify-between mb-1.5">
            {/* Section Title */}
            <div className="flex items-baseline gap-2">
              <span
                className="text-[10px] font-black tracking-[0.18em] uppercase"
                style={{ color: 'rgba(230,197,138,0.62)' }}
              >
                Mix Board
              </span>
              <span style={{ color: 'rgba(230,197,138,0.20)' }}>·</span>
              {/* v842 (Dash 2026-04-29 "fade your vibes text by 10%"):
                  drop bronze alpha 0.62 → 0.56 (-10% relative). Keeps
                  the hierarchy from sitting flush with the Mix Board
                  cap; recedes a touch into supporting role. */}
              <span
                style={{
                  fontFamily: "'Fraunces', 'Satoshi', system-ui, serif",
                  fontStyle: 'italic',
                  fontWeight: 500,
                  fontSize: 13,
                  letterSpacing: '0.005em',
                  color: 'rgba(230,197,138,0.56)',
                }}
              >
                Your Vibes
              </span>
            </div>
            {/* "See all" — bronze, italic, restrained. */}
            <button
              className="text-[10px] italic transition-colors"
              style={{
                fontFamily: "'Fraunces', 'Satoshi', system-ui, serif",
                color: 'rgba(212,160,83,0.55)',
              }}
            >
              See all →
            </button>
          </div>
          {/* Bronze hairline — anchors the section header to the cards */}
          <div
            className="mb-3"
            style={{
              height: 1,
              background: 'linear-gradient(90deg, rgba(212,160,83,0.22) 0%, rgba(212,160,83,0.05) 65%, transparent 100%)',
            }}
          />
          <div className="overflow-x-auto no-scrollbar flex gap-3 pb-1 -mb-2">
            {/* ====== MIX BOARD PRESETS - Tap to boost, Double-tap to react, Click punch to discover ====== */}
            {/* Heating Up RN - ENERGETIC mood (only non-purple, luxury bronze-orange) */}
            <NeonBillboardCard
              title="Heating Up RN"
              taglines={["Asambe! 🔥", "Lagos to Accra!", "E Choke! 💥", "Fire on Fire!", "No Wahala!"]}
              palette="gronze"
              delay={0}
              mood="energetic"
              textAnimation="bounce"
              onClick={() => handleModeBoost('afro-heat')}
              onDragToQueue={() => handleModeToQueueWithIntent('afro-heat')}
              onDoubleTap={() => handleModeReaction('afro-heat')}
              isActive={isModeActive('afro-heat')}
              boostLevel={modeBoosts['afro-heat'] || 0}
              queueMultiplier={queueMultipliers['afro-heat'] || 1}
              communityPulseCount={categoryPulse['afro-heat']?.count || 0}
              reactionEmoji="🔥"
              communityPunches={afroHeatPunches}
              onPunchClick={handlePunchClick}
            />
            {/* Chill Vibes - CHILL mood (light purple fade) */}
            <NeonBillboardCard
              title="Chill Vibes"
              taglines={["It's Your Eazi...", "Slow Wine Time", "Easy Does It", "Float Away~", "Pon Di Ting"]}
              delay={1}
              mood="chill"
              textAnimation="slideUp"
              onClick={() => handleModeBoost('chill-vibes')}
              onDragToQueue={() => handleModeToQueueWithIntent('chill-vibes')}
              onDoubleTap={() => handleModeReaction('chill-vibes')}
              isActive={isModeActive('chill-vibes')}
              boostLevel={modeBoosts['chill-vibes'] || 0}
              queueMultiplier={queueMultipliers['chill-vibes'] || 1}
              communityPulseCount={categoryPulse['chill-vibes']?.count || 0}
              reactionEmoji="🌙"
              communityPunches={chillVibesPunches}
              onPunchClick={handlePunchClick}
            />
            {/* Party Mode - HYPE mood (mid purple fade) */}
            <NeonBillboardCard
              title="Party Mode"
              taglines={["Another One! 🎉", "We The Best!", "Ku Lo Sa!", "Turn Up! 🔊", "Major Vibes Only"]}
              delay={2}
              mood="hype"
              textAnimation="scaleIn"
              onClick={() => handleModeBoost('party-mode')}
              onDragToQueue={() => handleModeToQueueWithIntent('party-mode')}
              onDoubleTap={() => handleModeReaction('party-mode')}
              isActive={isModeActive('party-mode')}
              boostLevel={modeBoosts['party-mode'] || 0}
              queueMultiplier={queueMultipliers['party-mode'] || 1}
              communityPulseCount={categoryPulse['party-mode']?.count || 0}
              reactionEmoji="🎉"
              communityPunches={partyModePunches}
              onPunchClick={handlePunchClick}
            />
            {/* Late Night - MYSTERIOUS mood */}
            <NeonBillboardCard
              title="Late Night"
              taglines={["Midnight Moods", "After Hours...", "Vibes & Chill", "3AM Sessions", "Lost in Sound"]}
              delay={3}
              mood="mysterious"
              textAnimation="rotateIn"
              onClick={() => handleModeBoost('late-night')}
              onDragToQueue={() => handleModeToQueueWithIntent('late-night')}
              onDoubleTap={() => handleModeReaction('late-night')}
              isActive={isModeActive('late-night')}
              boostLevel={modeBoosts['late-night'] || 0}
              queueMultiplier={queueMultipliers['late-night'] || 1}
              communityPulseCount={categoryPulse['late-night']?.count || 0}
              reactionEmoji="✨"
              communityPunches={lateNightPunches}
              onPunchClick={handlePunchClick}
            />
            {/* Workout - INTENSE mood (deep purple fade) */}
            <NeonBillboardCard
              title="Workout"
              taglines={["Beast Mode! 💪", "Pump It Up!", "No Pain No Gain", "Go Harder!", "Maximum Effort!"]}
              delay={4}
              mood="intense"
              textAnimation="bounce"
              onClick={() => handleModeBoost('workout')}
              onDragToQueue={() => handleModeToQueueWithIntent('workout')}
              onDoubleTap={() => handleModeReaction('workout')}
              isActive={isModeActive('workout')}
              boostLevel={modeBoosts['workout'] || 0}
              queueMultiplier={queueMultipliers['workout'] || 1}
              communityPulseCount={categoryPulse['workout']?.count || 0}
              reactionEmoji="💪"
              communityPunches={workoutPunches}
              onPunchClick={handlePunchClick}
            />

            {/* OYO DJ - The interactive curation widget. Tap to wake OYO Island
                and ask the brain for a curated playlist. Distinct deep-violet
                shade keeps it visually different from the 4 purple presets. */}
            <NeonBillboardCard
              title="Ask OYO DJ"
              taglines={["What's the vibe?", "Spin me something...", "Curate for me 🔮", "Read the room", "Build my playlist"]}
              delay={5}
              mood="mysterious"
              textAnimation="scaleIn"
              onClick={() => {
                handleModeBoost('random-mixer');
                setShowOyoIsland(true);
              }}
              onDragToQueue={() => handleModeToQueueWithIntent('random-mixer')}
              isActive={isModeActive('random-mixer')}
              boostLevel={modeBoosts['random-mixer'] || 0}
              queueMultiplier={queueMultipliers['random-mixer'] || 1}
            />

            {/* Add New - Enhanced neon style with pulsing border */}
            <button
              onClick={onSearch}
              className="flex-shrink-0 w-28 h-16 rounded-lg relative overflow-hidden group"
              style={{
                background: 'linear-gradient(135deg, rgba(8,8,12,0.98) 0%, rgba(3,3,5,0.99) 100%)',
                }}
            >
              {/* Pulsing dashed border */}
              <div
                className="absolute inset-0 rounded-lg"
                style={{
                  boxShadow: 'inset 0 0 0 1px rgba(139,92,246,0.3)',
                }}
              />
              <div
                className="absolute inset-0 rounded-lg border border-dashed border-purple-500/40 group-hover:border-purple-500/60 transition-colors"
              />
              <div className="relative z-10 h-full flex flex-col items-center justify-center gap-1">
                <div
                >
                  <Plus size={14} className="text-purple-400/80 group-hover:text-purple-400 transition-colors" />
                </div>
                <span
                  className="text-[9px] font-bold tracking-wide"
                  style={{
                    color: 'rgba(168,85,247,0.8)',
                    textShadow: '0 0 8px rgba(168,85,247,0.4)',
                    }}
                >
                  Create
                </span>
              </div>
              {/* Corner accents - matching style */}
              {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
                <div
                  key={i}
                  className={`absolute ${pos} w-2 h-2 opacity-50`}
                  style={{
                    borderTop: pos.includes('top') ? '1px dashed rgba(168,85,247,0.5)' : 'none',
                    borderBottom: pos.includes('bottom') ? '1px dashed rgba(168,85,247,0.5)' : 'none',
                    borderLeft: pos.includes('left') ? '1px dashed rgba(168,85,247,0.5)' : 'none',
                    borderRight: pos.includes('right') ? '1px dashed rgba(168,85,247,0.5)' : 'none',
                    }}
                />
              ))}
            </button>
          </div>
        </div>

        {/* TIVI+ Cross-Promo moved to HomeFeed.tsx (classic homepage) */}

      </div>

      {/* ╔═════════════════════════════════════════════════════════════╗
          ║ PORTAL VEIL — dark overlay that peaks mid-transition        ║
          ║ Clone of HomeFeed's loop-fade overlay (lines ~2527). Makes  ║
          ║ the scroll-down feel like a port (player → community),     ║
          ║ not a gradual fade. Opacity peaks around portalProgress     ║
          ║ 0.5 and clears again by 0.7 as Layer C fades in.            ║
          ╚═════════════════════════════════════════════════════════════╝ */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 49,
          background: 'rgba(6,6,9,0.95)',
          opacity: Math.max(0, 0.92 - Math.abs(portalProgress - 0.5) * 3.8),
          transition: 'opacity 0.12s linear',
        }}
      />

      {/* Scroll runway — settle room for the player surface to breathe.
          Was 1200px when Layer C lived here; now 480px since Layer C is
          gone. Just enough so OYO can scroll into a clean settled state
          past the music shelves. */}
      <div className="flex-shrink-0 w-full" style={{ height: '480px' }} />

      {/* BOOST SETTINGS PANEL — also hosts the Backdrop toggle (v795). */}
      <div data-no-canvas-swipe="true">
        <BoostSettings
          isOpen={isBoostSettingsOpen}
          onClose={() => setIsBoostSettingsOpen(false)}
          backdropEnabled={backdropEnabled}
          onToggleBackdrop={() => setBackdropEnabled(!backdropEnabled)}
        />
      </div>

      {/* SIGNAL INPUT MODAL - Double-tap billboard opens this */}
      {signalInputOpen && signalCategory && currentTrack && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          data-no-canvas-swipe="true"
        >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSignalInputOpen(false)}
            />

            {/* Signal Input Card */}
            <div
              className="relative w-full max-w-md mx-4 mb-8 rounded-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(20,20,30,0.98) 0%, rgba(10,10,15,0.99) 100%)',
                boxShadow: `0 0 40px rgba(139,92,246,0.3), 0 0 80px rgba(139,92,246,0.2)`,
                border: '1px solid rgba(139,92,246,0.3)',
                }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📍</span>
                  <span className="text-white/90 text-sm font-bold">Add Signal</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: signalCategory === 'afro-heat' ? 'rgba(181,74,46,0.2)' :
                                 signalCategory === 'chill-vibes' ? 'rgba(167,139,250,0.2)' :
                                 signalCategory === 'party-mode' ? 'rgba(212,160,83,0.2)' :
                                 signalCategory === 'late-night' ? 'rgba(139,92,246,0.2)' :
                                 'rgba(124,58,237,0.2)',
                      color: signalCategory === 'afro-heat' ? '#C86B3F' :
                             signalCategory === 'chill-vibes' ? '#a78bfa' :
                             signalCategory === 'party-mode' ? '#D4A053' :
                             signalCategory === 'late-night' ? '#8b5cf6' :
                             '#a78bfa',
                             }}
                  >
                    {signalCategory.replace('-', ' ')}
                  </span>
                </div>
                <button
                  className="text-white/50 hover:text-white/80 text-lg"
                  onClick={() => setSignalInputOpen(false)}
                >
                  ✕
                </button>
              </div>

              {/* Track Info */}
              <div className="flex items-center gap-3 px-4 py-3 bg-white/5">
                <img
                  src={getTrackThumbnailUrl(currentTrack, 'high')}
                  alt={currentTrack.title}
                  className="w-12 h-12 rounded-lg object-cover"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{currentTrack.title}</p>
                  <p className="text-white/50 text-xs truncate">{currentTrack.artist}</p>
                </div>
              </div>

              {/* Input */}
              <div className="p-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={signalText}
                    onChange={(e) => setSignalText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSignalSubmit()}
                    placeholder="Add your vibe... (short + punchy = billboard)"
                    className="flex-1 bg-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    autoFocus
                    maxLength={60}
                  />
                  <button
                    className="w-12 h-12 rounded-xl bg-gradient-to-r from-purple-500 to-violet-600 flex items-center justify-center"
                    onClick={handleSignalSubmit}
                  >
                    <span className="text-white text-lg">📍</span>
                  </button>
                </div>
                <p className="text-white/30 text-[10px] mt-2 text-center">
                  {signalText.length <= 30 && signalText.trim().length > 0
                    ? 'This will appear on the billboard!'
                    : 'Tip: Keep it short & punchy (≤30 chars) for billboard'}
                </p>
              </div>
            </div>
          </div>
        )}
      

      {/* (BottomTakeOutChip removed v806 per Dash 2026-04-29 — the
          rising bottom-right chip felt redundant with the morphed
          ExpandVideoButton on the BigCenterCard which already does the
          same job. PiP is reachable via the chip on the artwork; the
          BottomTakeOutChip component itself stays in this file in case
          we want to bring it back, just not rendered.) */}


      {/* LYRICS OVERLAY - Tap album art to show */}
      {showLyricsOverlay && currentTrack && (
        // Wrap in data-no-canvas-swipe so the full-screen drag handler
        // doesn't treat taps/drags inside the lyrics overlay as card
        // gestures. The overlay has its own scroll + tap-to-close.
        <div data-no-canvas-swipe="true">
          <LyricsOverlay
            track={currentTrack}
            isOpen={showLyricsOverlay}
            onClose={() => setShowLyricsOverlay(false)}
            currentTime={usePlayerStore.getState().currentTime}
          />
        </div>
      )}
      

    </div>
  );
};

export default VoyoPortraitPlayer;
