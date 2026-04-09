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
import {
  Play, Pause, SkipForward, SkipBack, Zap, Flame, Plus, Film, Settings, Heart,
  Shuffle, Repeat, Repeat1, Share2, Mic, Mic2, X
} from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { useIntentStore, VibeMode } from '../../store/intentStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { getThumbnailUrl, getTrackThumbnailUrl } from '../../utils/imageHelpers';
import { Track, ReactionType } from '../../types';
import { SmartImage } from '../ui/SmartImage';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { unlockMobileAudio, isMobileDevice } from '../../utils/mobileAudioUnlock';
import { useMobilePlay } from '../../hooks/useMobilePlay';
import { BoostButton } from '../ui/BoostButton';
import { BoostSettings } from '../ui/BoostSettings';
import { haptics, getReactionHaptic } from '../../utils/haptics';
import { useReactionStore, ReactionCategory, initReactionSubscription } from '../../store/reactionStore';
import { devLog } from '../../utils/logger';
// TiviPlusCrossPromo moved to HomeFeed.tsx (classic homepage)
import { useAuth } from '../../hooks/useAuth';
import { generateLyrics, getCurrentSegment, type EnrichedLyrics, type LyricsGenerationProgress } from '../../services/lyricsEngine';
import { getVideoStreamUrl } from '../../services/piped';
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

// OYO Island - DJ Voice Search & Chat
import { OyoIsland } from './OyoIsland';

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
const ProgressSlider = memo(({ isScrubbing }: { isScrubbing: boolean }) => {
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);

  return (
    <div className="flex-1 relative h-3 flex items-center">
      <div className="absolute left-0 right-0 h-[1px] bg-white/15 rounded-full" />
      {/* No seek input - VOYO is music, not video. You feel it, you don't scrub it. */}
      <div
        className="absolute w-[5px] h-[5px] rounded-full bg-red-500/90"
        style={{
          left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
          transform: 'translateX(-50%)',
          boxShadow: isScrubbing ? '0 0 10px rgba(239,68,68,0.9)' : '0 0 4px rgba(239,68,68,0.4)',
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
export interface MixMode {
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
const DEFAULT_MIX_MODES: MixMode[] = [
  {
    id: 'afro-heat',
    title: 'Afro Heat',
    neon: '#ef4444',
    glow: 'rgba(239,68,68,0.5)',
    taglines: ["Asambe! 🔥", "Lagos to Accra!", "E Choke! 💥", "Fire on Fire!", "No Wahala!"],
    mood: 'energetic',
    textAnimation: 'bounce',
    keywords: ['afrobeat', 'afro', 'lagos', 'naija', 'amapiano', 'burna', 'davido', 'wizkid'],
  },
  {
    id: 'chill-vibes',
    title: 'Chill Vibes',
    neon: '#3b82f6',
    glow: 'rgba(59,130,246,0.5)',
    taglines: ["It's Your Eazi...", "Slow Wine Time", "Easy Does It", "Float Away~", "Pon Di Ting"],
    mood: 'chill',
    textAnimation: 'slideUp',
    keywords: ['chill', 'slow', 'r&b', 'soul', 'acoustic', 'mellow', 'relax', 'smooth'],
  },
  {
    id: 'party-mode',
    title: 'Party Mode',
    neon: '#a78bfa',
    glow: 'rgba(167,139,250,0.5)',
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
    glow: 'rgba(124,58,237,0.5)',
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
  neon,
  glow,
  delay = 0,
  mood = 'energetic',
  textAnimation = 'bounce',
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
  neon: string;
  glow: string;
  delay?: number;
  mood?: PlaylistMood;
  textAnimation?: TextAnimation;
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

  // Adjust timing based on energy level - starving = slow, boosted = fast
  const baseTiming = moodTimings[mood];
  const timing = {
    ...baseTiming,
    taglineDwell: isStarving ? 8000 : baseTiming.taglineDwell / (0.5 + barRatio), // Slower when starving
    glowPulse: isStarving ? 6 : baseTiming.glowPulse / (0.5 + barRatio * 0.5), // Slower pulse
    textTransition: isStarving ? 0.8 : baseTiming.textTransition,
  };

  const animVariant = textAnimationVariants[textAnimation];

  // Calculate glow intensity - starving = dim, boosted = BRIGHT
  const glowIntensity = isStarving ? 0.2 : (0.4 + barRatio * 0.8); // 0.2 when dead, up to 1.2 when maxed

  // Smart visibility: Only animate when in view (research: Z5)
  useEffect(() => {
    if (!isInView || allTaglines.length === 0) return;

    const timer = setTimeout(() => {
      const interval = setInterval(() => {
        setCurrentTagline(prev => (prev + 1) % allTaglines.length);
      }, timing.taglineDwell);
      return () => clearInterval(interval);
    }, delay * 1000);
    return () => clearTimeout(timer);
  }, [allTaglines.length, delay, timing.taglineDwell, isInView]);

  // 5-Layer Neon Glow System (research: Z2, Z10)
  // Layer 1: White-hot core (tight)
  // Layer 2: Inner bloom (color)
  // Layer 3: Mid bloom (softer color)
  // Layer 4: Outer bloom (ambient)
  // Layer 5: Inward glow (inset)
  const createNeonGlow = (intensity: number) => {
    const i = intensity;
    return `
      inset 0 0 ${4 * i}px ${glow},
      inset 0 0 0 ${1.5 * i}px ${neon},
      0 0 ${5 * i}px rgba(255,255,255,0.3),
      0 0 ${10 * i}px ${glow},
      0 0 ${20 * i}px ${glow},
      0 0 ${35 * i}px ${glow}
    `.trim();
  };

  // Startup flicker effect (research: NEON_RESEARCH.md)
  const [hasStartupFlicker, setHasStartupFlicker] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setHasStartupFlicker(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      ref={cardRef}
      className="flex-shrink-0 w-32 h-16 rounded-lg relative overflow-hidden group"
      onClick={() => {
        if (isDraggingToQueue) return; // Don't trigger tap if we just dragged

        const now = Date.now();
        const timeSinceLastTap = now - lastTapTimeRef.current;
        lastTapTimeRef.current = now;

        // DOUBLE-TAP DETECTION (< 300ms between taps)
        if (timeSinceLastTap < 300 && onDoubleTap) {
          // Double-tap = REACT to community!
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
        background: 'linear-gradient(135deg, rgba(8,8,12,0.98) 0%, rgba(3,3,5,0.99) 100%)',
        opacity: isInView ? (isStarving ? 0.5 : 1) : 0.3,
        filter: isStarving ? 'grayscale(60%) brightness(0.6)' : 'grayscale(0%) brightness(1)',
      }}
    >
      {/* 5-Layer Neon Glow - Intensity based on bars (research: Z2, Z10) */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none"
        style={{
          boxShadow: createNeonGlow(isStarving ? glowIntensity * 0.3 : glowIntensity),
        }}
      />

      {/* Scanline effect - subtle CRT feel */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 4px)`,
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
              Vibe Queued!
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
        {/* Title - with enhanced neon text glow */}
        <div
          className="text-[11px] font-black tracking-wider uppercase"
          style={{
            color: neon,
            textShadow: `
              0 0 5px ${neon},
              0 0 10px ${glow},
              0 0 20px ${glow},
              0 0 30px ${glow}
            `
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
            src={getThumbnailUrl(trackId, 'high')}
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

  // FIX: Cleanup timers on unmount to prevent race conditions
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
      className="absolute left-4 top-1/2 -translate-y-1/2 z-50 group"
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
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
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
// EXPAND BUTTON - Opens fullscreen video mode
// ============================================
const ExpandVideoButton = memo(({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="absolute top-3 right-3 z-30 px-3 py-1.5 rounded-full backdrop-blur-sm border border-[#28282f] text-white text-xs font-medium flex items-center gap-1.5 hover:border-purple-500/40 transition-all"
    style={{ background: 'rgba(28, 28, 35, 0.65)' }}
  >
    <Play size={12} fill="currentColor" />
    <span>Video</span>
  </button>
));

// ============================================
// RIGHT-SIDE TOOLBAR - Vertical action buttons
// ============================================
const RightToolbar = memo(({ onSettingsClick }: { onSettingsClick: () => void }) => {
  const currentTrack = usePlayerStore(state => state.currentTrack);

  // Get like state from preference store (persisted)
  const { trackPreferences, setExplicitLike } = usePreferenceStore();
  const isLiked = currentTrack?.trackId ? trackPreferences[currentTrack.trackId]?.explicitLike === true : false;

  const handleLike = () => {
    if (!currentTrack?.trackId) return;
    setExplicitLike(currentTrack.trackId, !isLiked);
    haptics.success();
  };

  return (
    <div
      className="absolute right-6 top-[42%] -translate-y-1/2 z-50 flex flex-col gap-3"
    >
      {/* Like Button — pamplo pink when active */}
      <button
        onClick={handleLike}
        className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md shadow-lg transition-all duration-300 ${
          isLiked
            ? 'border border-[#ec4899]/60'
            : 'border border-[#28282f] hover:border-white/20'
        }`}
        style={{
          background: isLiked ? 'rgba(236, 72, 153, 0.25)' : 'rgba(28, 28, 35, 0.65)',
        }}
        title={isLiked ? 'Unlike' : 'Like'}
      >
        <Heart size={16} className={isLiked ? 'text-[#ec4899] fill-[#ec4899]' : 'text-white/70'} />
        {isLiked && (
          <div
            className="absolute inset-0 rounded-full blur-md -z-10"
            style={{ background: 'rgba(236, 72, 153, 0.2)' }}
          />
        )}
      </button>

      {/* Boost Button - Lightning Power */}
      <BoostButton variant="toolbar" />

      {/* Settings Button — metallic grey */}
      <button
        onClick={onSettingsClick}
        className="w-11 h-11 rounded-full backdrop-blur-md border border-[#28282f] flex items-center justify-center hover:border-white/20 shadow-lg transition-all duration-300"
        style={{ background: 'rgba(28, 28, 35, 0.65)' }}
        title="Audio settings"
      >
        <Settings size={16} className="text-white/70" />
      </button>
    </div>
  );
});

// Spring configs - OPTIMIZED for smooth, fluid motion
const springs = {
  gentle: { type: 'spring' as const, stiffness: 150, damping: 20 },      // Smoother gentle transitions
  snappy: { type: 'spring' as const, stiffness: 300, damping: 25 },      // Less aggressive snappy
  smooth: { type: 'spring' as const, stiffness: 180, damping: 22 },      // General purpose smooth
  ultraSmooth: { type: 'spring' as const, stiffness: 120, damping: 18 }, // Ultra fluid for large elements
};

// ============================================
// VOYO BRAND TINT - Purple overlay that fades on hover
// ============================================
const VoyoBrandTint = ({ isPlayed }: { isPlayed?: boolean }) => (
  <div
    className={`absolute inset-0 pointer-events-none transition-opacity duration-300 group-hover:opacity-0 ${
      isPlayed ? 'opacity-60' : 'opacity-40'
    }`}
    style={{
      background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.4) 0%, rgba(219, 39, 119, 0.3) 100%)',
      mixBlendMode: 'overlay',
      }}
  />
);

// ============================================
// SMALL CARD (History/Queue - with VOYO brand tint)
// ============================================
const SmallCard = memo(({ track, onTap, isPlayed }: { track: Track; onTap: () => void; isPlayed?: boolean }) => (
  <button
    className="flex flex-col gap-2 w-[70px] flex-shrink-0 group"
    onClick={onTap}
  >
    <div className="w-[70px] h-[70px] rounded-2xl overflow-hidden relative border border-white/5 bg-gradient-to-br from-purple-900/30 to-pink-900/20">
      <SmartImage
        src={getTrackThumbnailUrl(track, 'medium')}
        alt={track.title}
        className={`w-full h-full object-cover transition-all duration-300 ${
          isPlayed ? 'opacity-60' : 'opacity-90 group-hover:opacity-100 group-hover:scale-105'
        }`}
        trackId={track.trackId}
        artist={track.artist}
        title={track.title}
        lazy={true}
      />
      {/* VOYO Brand Tint - fades on hover */}
      <VoyoBrandTint isPlayed={isPlayed} />
      {/* Played checkmark overlay */}
      {isPlayed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 rounded-full bg-purple-500/80 flex items-center justify-center shadow-lg">
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
      )}
    </div>
    <div className="text-left">
      <h4 className={`text-[10px] font-bold truncate leading-tight ${isPlayed ? 'text-gray-400' : 'text-white'}`}>{track.title}</h4>
      <p className="text-[9px] text-gray-500 truncate">{track.artist}</p>
    </div>
  </button>
));

// ============================================
// DASH PLACEHOLDER (Empty state for queue/history)
// ============================================
const DashPlaceholder = memo(({ onClick, label }: { onClick?: () => void; label: string }) => (
  <button
    onClick={onClick}
    className="w-[70px] h-[70px] rounded-2xl bg-gradient-to-br from-purple-900/30 to-pink-900/20 border border-purple-500/20 flex flex-col items-center justify-center gap-1 hover:border-purple-500/40 transition-colors"
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
  onTeaser?: (track: Track) => void;
  onQueueAdd?: (track: Track) => void; // Track queue additions for MixBoard
  playedTrackIds: Set<string>;
  type: 'hot' | 'discovery';
  mixModes?: MixMode[]; // For color-coding cards by mode
  modeBoosts?: Record<string, number>; // Boost levels for intensity calculation
  isActive: boolean; // Controls if belt is scrolling
  onScrollOutward?: () => void; // Callback when user wants to scroll outward (reverse)
  scrollOutwardTrigger?: number; // Increment to trigger outward scroll
}

const PortalBelt = memo(({ tracks, onTap, onTeaser, onQueueAdd, playedTrackIds, type, mixModes, modeBoosts, isActive, scrollOutwardTrigger = 0 }: PortalBeltProps) => {
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
        // FIX: Graceful error handling for animation loop
        console.error('[VOYO PortalBelt] Animation error:', error);
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
      // HOT: Cards enter from LEFT (x near 0), add red glow fade-in
      const entranceZone = cardWidth * 1.5;
      if (x < entranceZone) {
        const progress = Math.max(0, x / entranceZone);
        return {
          opacity: 0.4 + progress * 0.6,
          filter: `drop-shadow(0 0 ${(1 - progress) * 8}px rgba(239, 68, 68, 0.6))`,
        };
      }
    } else {
      // DISCOVERY: Cards enter from RIGHT, add blue glow fade-in
      const entranceZone = containerWidth - cardWidth * 1.5;
      if (x > entranceZone) {
        const progress = Math.max(0, (containerWidth - x) / (cardWidth * 1.5));
        return {
          opacity: 0.4 + progress * 0.6,
          filter: `drop-shadow(0 0 ${(1 - progress) * 8}px rgba(59, 130, 246, 0.6))`,
        };
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
                onTeaser={onTeaser}
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
      className="flex-1 relative h-20 overflow-hidden cursor-grab active:cursor-grabbing select-none"
      style={{ touchAction: 'pan-x' }} // Allow horizontal drag, prevent vertical scroll
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
// Now with MOBILE TAP-TO-TEASER (30s preview) + DRAG-TO-QUEUE
// ============================================
const StreamCard = memo(({ track, onTap, isPlayed, onTeaser, modeColor, onQueueAdd }: {
  track: Track;
  onTap: () => void;
  isPlayed?: boolean;
  onTeaser?: (track: Track) => void;
  modeColor?: { neon: string; glow: string; intensity: number } | null; // From MixBoard mode matching
  onQueueAdd?: (track: Track) => void; // Callback when track is added to queue (for MixBoard tracking)
}) => {
  const addToQueue = usePlayerStore(state => state.addToQueue);
  const [showQueueFeedback, setShowQueueFeedback] = useState(false);
  const [showTeaserFeedback, setShowTeaserFeedback] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [wasDragged, setWasDragged] = useState(false);
  const [isFlying, setIsFlying] = useState(false); // Card flying to queue animation

  // Timeout refs for cleanup - prevents memory leaks on rapid scrolling
  const teaserTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect touch device
  useEffect(() => {
    const checkTouch = () => {
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    checkTouch();
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (teaserTimeoutRef.current) clearTimeout(teaserTimeoutRef.current);
      if (queueTimeoutRef.current) clearTimeout(queueTimeoutRef.current);
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      if (flyTimeoutRef.current) clearTimeout(flyTimeoutRef.current);
    };
  }, []);

  // Handle tap - on mobile plays teaser, on desktop plays full
  const handleTap = () => {
    // If was dragging, don't trigger tap
    if (wasDragged) {
      setWasDragged(false);
      return;
    }

    // On mobile: tap = teaser preview (30s)
    if (isTouchDevice && onTeaser) {
      onTeaser(track);
      setShowTeaserFeedback(true);
      if (teaserTimeoutRef.current) clearTimeout(teaserTimeoutRef.current);
      teaserTimeoutRef.current = setTimeout(() => setShowTeaserFeedback(false), 2000);
    } else {
      // On desktop: click = full play
      onTap();
    }
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
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[8px] font-bold px-2 py-1 rounded-full shadow-lg whitespace-nowrap flex items-center gap-1">
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Queued
            </div>
          </div>
        )}
      

      {/* Flying trail effect - shows during flight */}
      
        {isFlying && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          >
            <div className="w-14 h-14 rounded-xl bg-gradient-to-r from-purple-500/40 to-pink-500/40 blur-md" />
          </div>
        )}
      

      {/* Teaser Feedback Indicator */}
      
        {showTeaserFeedback && (
          <div
            className="absolute -top-8 left-1/2 -translate-x-1/2 z-50 bg-purple-500 text-white text-[9px] font-bold px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap flex items-center gap-1"
          >
            <Play size={10} fill="white" /> 30s Preview
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
            src={getTrackThumbnailUrl(track, 'medium')}
            alt={track.title}
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
          {/* Mobile hint indicator */}
          {isTouchDevice && (
            <div className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full bg-purple-500/80 flex items-center justify-center">
              <Play size={6} fill="white" className="text-white" />
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
const BigCenterCard = memo(({ track, onExpandVideo, onShowLyrics, hideThumb }: {
  track: Track;
  onExpandVideo?: () => void;
  onShowLyrics?: () => void;
  hideThumb?: boolean;
}) => {
  return (
  <div
    className="relative w-52 h-52 md:w-60 md:h-60 rounded-[2rem] overflow-hidden z-20 group"
    style={{
      boxShadow: '0 25px 60px -12px rgba(0,0,0,0.9), 0 0 50px rgba(139,92,246,0.2), 0 0 100px rgba(139,92,246,0.1)',
      transform: hideThumb ? 'scale(0.94)' : 'scale(1)',
      opacity: hideThumb ? 0 : 1,
    }}
  >
    {/* THUMBNAIL */}
    <div
      onClick={onShowLyrics}
      className="absolute inset-0 cursor-pointer z-10"
      role="button"
      aria-label="Show lyrics"
    >
      <SmartImage
        src={getTrackThumbnailUrl(track, 'high')}
        alt={track.title}
        className="w-full h-full object-cover transition-transform duration-700 scale-110 group-hover:scale-125"
        trackId={track.trackId}
        artist={track.artist}
        title={track.title}
        lazy={false}
      />
      {/* Light purple overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)' }}
      />
      {/* Title + Artist overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
      <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
        <p className="text-white font-bold text-[11px] truncate">{track.title}</p>
        <p className="text-white/50 text-[9px] truncate">{track.artist}</p>
      </div>
      {/* Lyrics hint icon */}
      {onShowLyrics && (
        <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-sm rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Mic2 size={14} className="text-white" />
        </div>
      )}
    </div>

    {/* Subtle vignette for depth */}
    <div
      className="absolute inset-0 pointer-events-none opacity-40 z-15"
      style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)',
        }}
    />

    {/* Video mode button */}
    {onExpandVideo && (
      <ExpandVideoButton onClick={onExpandVideo} />
    )}

    {/* Glowing border accent */}
    <div
      className="absolute inset-0 rounded-[2rem] pointer-events-none transition-all duration-500 z-25"
      style={{
        border: '1px solid rgba(139, 92, 246, 0.3)',
        boxShadow: 'inset 0 0 30px rgba(139, 92, 246, 0.1)',
        }}
    />
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
  scrubDirection,
  skeepLevel,
}: {
  isPlaying: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  isScrubbing: boolean;
  onScrubStart: (direction: 'forward' | 'backward') => void;
  onScrubEnd: () => void;
  trackArt?: string;
  scrubDirection: 'forward' | 'backward' | null;
  skeepLevel: number; // 1=2x, 2=4x, 3=8x
}) => {
  // Convert skeepLevel to display speed
  const displaySpeed = skeepLevel === 1 ? 2 : skeepLevel === 2 ? 4 : 8;

  // Calculate spin animation based on state - SKEEP makes it spin FAST
  const getSpinAnimation = () => {
    if (isScrubbing) {
      // SKEEP mode: spin speed based on skeepLevel
      const spinDuration = 3 / displaySpeed;
      return {
        rotate: [0, 360],
        transition: { duration: spinDuration, repeat: Infinity, ease: 'linear' as const }
      };
    }
    if (isPlaying) {
      // Normal playback: slow vinyl spin
      return {
        rotate: [0, 360],
        transition: { duration: 3, repeat: Infinity, ease: 'linear' as const }
      };
    }
    return { rotate: 0 };
  };

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
      

      {/* Prev - HOLD TO REWIND */}
      <button
        className="absolute left-[20%] text-white/50 hover:text-white transition-colors"
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

        {/* Spinning Vinyl Disk */}
        <button
          className="absolute inset-0 rounded-full overflow-hidden border-2 border-white/20 shadow-lg"
          onClick={() => {
            haptics.medium();
            onToggle();
            }}
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

          {/* Album art - only visible when playing/scrubbing */}
          
            {(isPlaying || isScrubbing) && trackArt && (
              <div
                className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] rounded-full overflow-hidden"
              >
                <SmartImage
                  src={trackArt}
                  alt="Now Playing"
                  className="w-full h-full object-cover"
                  lazy={false}
                />
              </div>
            )}
          

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

      {/* Next - HOLD TO FAST FORWARD */}
      <button
        className="absolute right-[20%] text-white/50 hover:text-white transition-colors"
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
  oyeBarBehavior = 'fade',
  activateChatTrigger = 0,
}: {
  onReaction: (type: ReactionType, emoji: string, text: string, multiplier: number) => void;
  isRevealed: boolean;
  onRevealChange: (revealed: boolean) => void;
  oyeBarBehavior?: 'fade' | 'disappear';
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

      // Animate waveform bars
      const updateWaveform = () => {
        if (analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const levels = Array.from(data.slice(0, 5)).map(v => Math.max(0.2, v / 255));
          setWaveformLevels(levels);
        }
        animationRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();

      // Setup speech recognition for live transcript
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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
      console.error('Mic access denied:', err);
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

      // Countdown 3-2-1
      setTimeout(() => setVoiceCountdown(2), 1000);
      setTimeout(() => setVoiceCountdown(1), 2000);
      setTimeout(() => {
        setVoiceCountdown(null);
        startVoiceRecording();
      }, 3000);
    }, 400);
  };

  // Handle hold release - submit voice command
  const handleMicHoldEnd = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

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
            usePlayerStore.getState().playTrack(voyoTrack);
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
      console.error('Voice search error:', error);
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
        setChatResponse(`🎵 Adding "${songMatch}" to queue...`);
        setTimeout(() => {
          setChatResponse(`✓ "${songMatch}" queued up next!`);
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
  // Track if Wazzguán was primed (tapped once in sleep mode) - use ref to avoid stale closure
  const [wazzguanPrimed, setWazzguanPrimed] = useState(false);
  const wazzguanPrimedRef = useRef(false);

  // All reactions in a row - OYÉ is the gateway (defined early for use in handlers)
  // REFINED PREMIUM COLORS - sophisticated, muted, elegant (not "kid style")
  const reactions = [
    { type: 'oyo', emoji: '👋', text: 'OYO', icon: Zap, gradient: 'from-purple-700/70 to-violet-900/60' },
    { type: 'oye', emoji: '🎉', text: 'OYÉ', icon: Zap, gradient: 'from-orange-600/70 to-yellow-700/60', isGateway: true },
    { type: 'wazzguan', emoji: '🤙', text: 'Wazzguán', icon: null, gradient: 'from-stone-600/50 to-stone-700/40', isChat: true },
    { type: 'fire', emoji: '🔥', text: 'Fireee', icon: Flame, gradient: 'from-orange-700/70 to-red-900/60' },
  ];

  const handlePressStart = (type: string) => {
    // === WAZZGUÁN FLOW ===
    if (type === 'wazzguan') {
      if (isActive) {
        // Active mode: direct open chat
        handleWazzguanTap();
        return;
      } else if (wazzguanPrimedRef.current) {
        // Sleep mode + primed: open chat
        handleWazzguanTap();
        wazzguanPrimedRef.current = false;
        setWazzguanPrimed(false);
        return;
      } else {
        // Sleep mode + not primed: prime it (flash and wait for second tap)
        setFlashingButton('wazzguan');
        wazzguanPrimedRef.current = true;
        setWazzguanPrimed(true);
        haptics.light();
        setTimeout(() => setFlashingButton(null), 400);
        // Auto-unprime after 3 seconds
        setTimeout(() => {
          wazzguanPrimedRef.current = false;
          setWazzguanPrimed(false);
        }, 3000);
        return;
      }
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
    onReaction(type, emoji, text, multiplier);
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
  const getScale = (type: string) => isCharging(type) ? 1 + (currentMultiplier - 1) * 0.05 : 1;

  // Position offsets - all buttons hidden when chat opens, so no spread needed
  const getSpreadX = (_type: string) => 0;

  // Check if button is currently flashing (sleep mode tap feedback)
  const isFlashing = (type: string) => flashingButton === type || (type === 'wazzguan' && wazzguanPrimed);

  // DISAPPEAR MODE: Return nothing when not revealed - State 0 (big card, no bar)
  // Double-tap reveals it, then auto-hides back to State 0
  if (oyeBarBehavior === 'disappear' && !isRevealed) {
    return null;
  }

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

          // VISIBILITY LOGIC based on oyeBarBehavior:
          // 'fade' mode: ALWAYS visible (signature), just more ghosted when not revealed
          // 'disappear' mode: Only show when revealed
          if (oyeBarBehavior === 'disappear' && !isRevealed) return null;

          // In fade mode, buttons are always visible but more transparent when not revealed
          const isFadeGhosted = oyeBarBehavior === 'fade' && !isRevealed;

          // Fire flicker animation (only used when not in chat mode)
          const isFireSpread = false;

          return (
            <button
              key={r.type}
              className={`
                relative rounded-full font-bold flex items-center gap-1.5
                backdrop-blur-sm transition-colors duration-300
                ${isGateway
                  ? 'min-h-[44px] h-11 px-6 text-sm z-10'
                  : 'min-h-[38px] h-[38px] px-4 text-xs'
                }
                ${isGateway
                  ? (isLit
                    ? 'bg-gradient-to-r from-purple-700/70 to-fuchsia-900/60 border border-purple-400/30 text-white shadow-lg shadow-purple-900/30'
                    : 'bg-purple-950/50 border border-purple-600/30 text-purple-300/80')
                  : isChat
                    ? (buttonFlashing
                      ? 'bg-gradient-to-r from-amber-500/70 to-orange-500/60 border border-amber-400/40 text-white shadow-lg shadow-orange-500/30'
                      : isLit
                        ? 'bg-gradient-to-r from-stone-600/50 to-stone-700/40 border border-stone-400/20 text-white shadow-lg'
                        : 'bg-stone-900/30 border border-stone-600/20 text-stone-300/50')
                    : (isLit
                      ? `bg-gradient-to-r ${r.gradient} border border-white/20 text-white shadow-lg`
                      : 'bg-white/5 border border-white/10 text-white/50')
                }
              `}
              style={{
                opacity: isFireSpread
                  ? 0.3
                  : isFadeGhosted
                    ? (isGateway ? 0.35 : 0.25)
                    : (isChatMode ? 0.6 : (isLit ? 1 : (isGateway ? 0.9 : 0.5))),
              }}
              onMouseDown={() => handlePressStart(r.type)}
              onMouseUp={() => handlePressEnd(r.type as ReactionType, r.emoji, r.text)}
              onMouseLeave={() => { if (charging === r.type) handlePressEnd(r.type as ReactionType, r.emoji, r.text); }}
              onTouchStart={() => handlePressStart(r.type)}
              onTouchEnd={() => handlePressEnd(r.type as ReactionType, r.emoji, r.text)}
            >
              {r.icon && <r.icon size={isGateway ? 14 : 11} fill="currentColor" />}
              <span>{r.text}</span>

              {/* Chat indicator on Wazzguán */}
              {isChat && isActive && !isChatMode && (
                <span className="text-[10px]">?</span>
              )}

              {/* Multiplier display */}
              {isCharging(r.type) && currentMultiplier > 1 && (
                <span
                  className="absolute -top-8 left-1/2 -translate-x-1/2 text-yellow-400 font-bold text-lg drop-shadow-lg"
                >
                  {currentMultiplier}x
                </span>
              )}

              {/* Gateway pulse indicator */}
              {isGateway && !isActive && !isChatMode && (
                <div
                  className="absolute inset-0 rounded-full border-2 border-purple-400/50"
                />
              )}
            </button>
          );
        })}

        {/* Chat input - appears in center when Wazzguán tapped */}
        {/* Type | Hold to speak | Tap mic for sing/hum */}
        
          {isChatMode && (
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 bg-gradient-to-r from-stone-800/50 to-stone-900/40 backdrop-blur-xl rounded-full border border-stone-500/20 px-3 py-1.5 shadow-lg shadow-black/30"
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
                /* Recording with waveform */
                <div className="flex-1 flex items-center justify-center gap-1">
                  {waveformLevels.map((level, i) => (
                    <div
                      key={i}
                      className="w-1 bg-purple-400 rounded-full"
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

              {/* Mic button - Tap for sing/hum, Hold for voice command */}
              <button
                onPointerDown={handleMicHoldStart}
                onPointerUp={handleMicHoldEnd}
                onPointerLeave={handleMicHoldEnd}
                onClick={!isVoiceMode && !isRecording ? handleMicTap : undefined}
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isRecording ? 'bg-red-500/80' : 'bg-purple-600/60'
                }`}
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
                className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-xs flex-shrink-0"
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

// ============================================
// FULLSCREEN VIDEO PLAYER - Takes over screen for video watching
// ============================================
const FullscreenVideoPlayer = ({
  track,
  isPlaying,
  onClose,
  onTogglePlay,
}: {
  track: Track;
  isPlaying: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
}) => (
  <div
    className="fixed inset-0 z-[100] bg-black flex flex-col"
  >
    {/* Video Container - YouTube iframe would go here */}
    <div className="flex-1 relative bg-black flex items-center justify-center">
      {/* Placeholder - in production this would be a YouTube embed */}
      <div className="relative w-full h-full max-w-4xl mx-auto">
        <SmartImage
          src={getTrackThumbnailUrl(track, 'high')}
          alt={track.title}
          className="w-full h-full object-contain"
          trackId={track.trackId}
          artist={track.artist}
          title={track.title}
          lazy={false}
        />
        {/* Play overlay */}
        <button
          onClick={onTogglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
        >
          <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            {isPlaying ? (
              <Pause size={32} className="text-white" />
            ) : (
              <Play size={32} className="text-white ml-1" />
            )}
          </div>
        </button>
      </div>
    </div>

    {/* Bottom Bar - Track info and close */}
    <div className="bg-black/90 backdrop-blur-xl border-t border-white/10 p-4">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-lg truncate">{track.title}</h2>
          <p className="text-purple-300 text-sm truncate">{track.artist}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-4 px-6 py-2 rounded-full bg-white/10 border border-white/20 text-white text-sm font-bold hover:bg-white/20 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  </div>
);

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
      console.error('[CommunityEdit] Failed to save:', err);
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
      console.error('Failed to copy');
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
        className={`px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 ${
          copied
            ? 'bg-purple-500 text-white'
            : 'bg-white/10 text-white/70 hover:bg-white/20'
        }`}
        onClick={handleCopy}
      >
        {copied ? '✓ Copied!' : '📋 Copy'}
      </button>

      {/* Share button */}
      <button
        className={`px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 ${
          shared
            ? 'bg-purple-500 text-white'
            : 'bg-white/10 text-white/70 hover:bg-white/20'
        }`}
        onClick={handleShare}
      >
        <Share2 size={14} />
        {shared ? 'Shared!' : 'Share'}
      </button>

      {/* Edit button */}
      <button
        className="px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30"
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
        setProgress({ stage: 'fetching', progress: 0, message: 'Loading...' });

        // Get audio URL for Whisper
        const audioUrl = await getVideoStreamUrl(track.trackId);
        if (!audioUrl) {
          throw new Error('Could not get audio stream');
        }

        const result = await generateLyrics(track, audioUrl, setProgress);
        setLyrics(result);
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
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
      >
        <span className="text-white text-xl">×</span>
      </button>

      {/* Track info header */}
      <div className="absolute top-4 left-4 right-16">
        <h2 className="text-white font-bold text-lg truncate">{track.title}</h2>
        <p className="text-white/60 text-sm">{track.artist}</p>
      </div>

      {/* Main lyrics area */}
      <div className="absolute inset-0 pt-20 pb-8 px-6 flex flex-col items-center justify-center overflow-y-auto">
        {/* Loading state */}
        {progress && (
          <div className="text-center">
            <div
              className="w-16 h-16 rounded-full border-4 border-purple-500/30 border-t-purple-500 mx-auto mb-4 animate-spin"
            />
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

        {/* Lyrics display */}
        {lyrics && !progress && (
          <div className="w-full max-w-md space-y-6">
            {/* Stats bar */}
            <div className="flex justify-center gap-4 text-xs text-white/40">
              <span>🌍 {lyrics.language}</span>
              <span>📊 {lyrics.translationCoverage.toFixed(0)}% translated</span>
              <span className={lyrics.phonetic.polishedBy?.length ? 'text-purple-400' : ''}>
                {lyrics.phonetic.polishedBy?.length ? '✓ Polished' : '○ Raw'}
              </span>
            </div>

            {/* Tap hint */}
            <p className="text-center text-purple-400/60 text-xs">
              💡 Tap any word for translation
            </p>

            {/* Current segment highlight */}
            {currentSegment && (
              <div
                key={currentSegment.startTime}
                className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-2xl p-6 border border-purple-500/30 animate-voyo-scale-in"
              >
                <p className="text-white text-2xl font-bold text-center mb-3">
                  {renderTappableText(currentSegment.original, true)}
                </p>
                {currentSegment.phonetic !== currentSegment.original && (
                  <p className="text-purple-300 text-sm text-center italic mb-2">
                    {currentSegment.phonetic}
                  </p>
                )}
                {currentSegment.english && (
                  <p className="text-white/70 text-center">
                    🇬🇧 {currentSegment.english}
                  </p>
                )}
                {currentSegment.french && (
                  <p className="text-white/60 text-sm text-center mt-1">
                    🇫🇷 {currentSegment.french}
                  </p>
                )}
              </div>
            )}

            {/* All segments */}
            <div className="space-y-4 max-h-[50vh] overflow-y-auto">
              {lyrics.translated.map((segment, i) => {
                const isCurrent = currentSegment?.startTime === segment.startTime;
                return (
                  <div
                    key={i}
                    className={`p-4 rounded-xl transition-all ${
                      isCurrent
                        ? 'bg-purple-500/30 border border-purple-500/50'
                        : 'bg-white/5'
                    }`}
                  >
                    <p className={`text-white ${isCurrent ? 'text-lg font-semibold' : 'text-sm'}`}>
                      {renderTappableText(segment.original, isCurrent)}
                    </p>
                    {segment.english && (
                      <p className="text-white/50 text-xs mt-1">{segment.english}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Translation coverage info */}
            {lyrics.translationCoverage < 50 && (
              <p className="text-center text-white/30 text-xs">
                🌍 Words from Soussou lexicon (8,982+ words)
              </p>
            )}

            {/* Action Buttons - Copy, Share, Edit */}
            <LyricsActionButtons
              lyrics={lyrics}
              track={track}
              onEditRequest={handleEditRequest}
            />
          </div>
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
  const queue = usePlayerStore(s => s.queue);
  const history = usePlayerStore(s => s.history);
  const hotTracks = usePlayerStore(s => s.hotTracks);
  const discoverTracks = usePlayerStore(s => s.discoverTracks);
  const refreshRecommendations = usePlayerStore(s => s.refreshRecommendations);
  const nextTrack = usePlayerStore(s => s.nextTrack);
  const prevTrack = usePlayerStore(s => s.prevTrack);
  const playTrack = usePlayerStore(s => s.playTrack);
  const addReaction = usePlayerStore(s => s.addReaction);
  const reactions = usePlayerStore(s => s.reactions);
  const seekTo = usePlayerStore(s => s.seekTo);
  const playbackRate = usePlayerStore(s => s.playbackRate);
  const isSkeeping = usePlayerStore(s => s.isSkeeping);
  const setPlaybackRate = usePlayerStore(s => s.setPlaybackRate);
  const stopSkeep = usePlayerStore(s => s.stopSkeep);
  const oyeBarBehavior = usePlayerStore(s => s.oyeBarBehavior);
  const shuffleMode = usePlayerStore(s => s.shuffleMode);
  const repeatMode = usePlayerStore(s => s.repeatMode);
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle);
  const cycleRepeat = usePlayerStore(s => s.cycleRepeat);

  // MOBILE FIX: Use direct play handler
  const { handlePlayPause } = useMobilePlay();

  // ====== REACTION SYSTEM - Community Spine ======
  const {
    createReaction,
    categoryPulse,
    subscribeToReactions,
    isSubscribed,
    recentReactions,
    fetchRecentReactions
  } = useReactionStore();
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
  const [backdropEnabled, setBackdropEnabled] = useState(false); // OFF by default for smoothness
  const [currentBackdrop, setCurrentBackdrop] = useState('album'); // 'album', 'gradient-purple', etc.
  const [isBackdropLibraryOpen, setIsBackdropLibraryOpen] = useState(false);
  // State for fullscreen video mode
  const [isFullscreenVideo, setIsFullscreenVideo] = useState(false);
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
  const QUEUE_BONUS = 5;   // Max bonus bars from queue behavior

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

  // Access queue actions from player store
  const addToQueue = usePlayerStore(state => state.addToQueue);

  // Handle mode tap - adds 1 manual bar to tapped mode, steals from others
  // Zero-sum: total MANUAL bars always = 6
  const TOTAL_MANUAL_BARS = 6;
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
      addToQueue(track);
      trackQueueAddition(track);
    });

    // Also boost this mode manually (user explicitly wants this vibe)
    handleModeBoost(modeId);
  }, [hotTracks, discoverTracks, addToQueue, trackQueueAddition, handleModeBoost]);

  // Random Mixer spin animation state
  const [xRandomizerSpin, setXRandomizerSpin] = useState(false);

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

  // Enhanced queue addition that also records intent
  const trackQueueAdditionWithIntent = useCallback((track: Track) => {
    const modeId = detectTrackMode(track);
    intentRecordTrackQueued(modeId as VibeMode);
    trackQueueAddition(track);
  }, [detectTrackMode, trackQueueAddition, intentRecordTrackQueued]);

  // Check if a mode is "active" (has at least 1 bar)
  const isModeActive = useCallback((modeId: string) => {
    return (modeBoosts[modeId] || 0) >= 1;
  }, [modeBoosts]);

  // Calculate "Your Vibes" color - weighted average of boosted mode colors
  const getVibesColor = useCallback(() => {
    const modeColors: Record<string, { r: number; g: number; b: number }> = {
      'afro-heat': { r: 239, g: 68, b: 68 },      // Red
      'chill-vibes': { r: 59, g: 130, b: 246 },   // Blue
      'party-mode': { r: 236, g: 72, b: 153 },    // Pink
      'late-night': { r: 139, g: 92, b: 246 },    // Purple
      'workout': { r: 249, g: 115, b: 22 },       // Orange
      'random-mixer': { r: 168, g: 85, b: 247 },  // Gradient purple (mix of all)
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

  // CLEAN STATE: Two levels of reveal
  // TAP: Quick controls only (shuffle, repeat, share)
  // HOLD or DOUBLE TAP: Full DJ Mode (reactions + chat)
  const [isControlsRevealed, setIsControlsRevealed] = useState(false); // Level 1: Quick controls
  const [isReactionsRevealed, setIsReactionsRevealed] = useState(false); // Level 2: Full DJ
  const [activateChatTrigger, setActivateChatTrigger] = useState(0); // Increment to trigger chat
  const [showDJWakeMessage, setShowDJWakeMessage] = useState(false); // Tutorial toast
  const [djWakeMessageText, setDjWakeMessageText] = useState(''); // Dynamic message content
  const [showOyoIsland, setShowOyoIsland] = useState(false); // OYO DJ Island - tap to show
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);
  const didHoldRef = useRef(false);
  const djWakeCountRef = useRef(0); // Track how many times DJ mode was activated

  // Quick controls - now using store (shuffleMode, repeatMode, toggleShuffle, cycleRepeat)

  // Tutorial messages for DJ wake - rotates through different messages
  const DJ_WAKE_MESSAGES = [
    "Fiouuuh ✌🏾",
    "Now Peace ✌🏾",
    "DJ Mode Active ✌🏾",
    "Let's gooo ✌🏾",
  ];

  // Single tap counter for tutorial hint
  const singleTapCountRef = useRef(0);
  const hasShownHintRef = useRef(false);

  const showDJWakeToast = useCallback(() => {
    const messageIndex = djWakeCountRef.current % DJ_WAKE_MESSAGES.length;
    setDjWakeMessageText(DJ_WAKE_MESSAGES[messageIndex]);
    setShowDJWakeMessage(true);
    djWakeCountRef.current++;
    singleTapCountRef.current = 0; // Reset single tap counter
    hasShownHintRef.current = true; // User has discovered DJ mode
    setTimeout(() => setShowDJWakeMessage(false), 1500);
  }, []);

  // Show tutorial hint after 3 single taps
  const showTutorialHint = useCallback(() => {
    if (hasShownHintRef.current) return; // Already discovered DJ mode
    setDjWakeMessageText("Don't forget, double tap to wake DJ ✌🏾");
    setShowDJWakeMessage(true);
    setTimeout(() => setShowDJWakeMessage(false), 2000);
  }, []);

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

  const handleExpandVideo = useCallback(() => {
    setIsFullscreenVideo(true);
  }, []);

  // Handle tap/hold/double-tap
  const handleCanvasPointerDown = useCallback(() => {
    didHoldRef.current = false;
    // Start hold timer (400ms to trigger DJ mode)
    holdTimerRef.current = setTimeout(() => {
      didHoldRef.current = true;
      setIsControlsRevealed(true);
      setIsReactionsRevealed(true);
      showDJWakeToast();
      haptics.medium();
    }, 400);
  }, [showDJWakeToast]);

  const handleCanvasPointerUp = useCallback(() => {
    // Cancel hold timer
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const handleCanvasTap = useCallback(() => {
    // Skip if this was a hold
    if (didHoldRef.current) {
      didHoldRef.current = false;
      return;
    }

    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    // DOUBLE-TAP (under 300ms) → Wazzguan direct input (chat widget in reactions bar)
    const isDoubleTap = timeSinceLastTap < 300;

    if (isDoubleTap) {
      // Double-tap opens Wazzguan direct input
      setIsControlsRevealed(true);
      setIsReactionsRevealed(true);
      setActivateChatTrigger(prev => prev + 1);
      haptics.medium();
      return;
    }

    // Single tap → Toggle OYO Island DJ widget + controls
    // OYO Island handles chat/voice internally - tap OYO for chat, tap mic for voice search
    if (!isReactionsRevealed) {
      const wasHidden = !isControlsRevealed;
      setIsControlsRevealed(prev => !prev);

      // Show OYO Island when revealing controls
      if (wasHidden) {
        setShowOyoIsland(true);
        haptics.light();
      } else {
        // Hiding controls also hides OYO Island
        setShowOyoIsland(false);
      }
    }
  }, [isControlsRevealed, isReactionsRevealed, showDJWakeToast]);

  // AUTO-HIDE controls + OyoIsland after 3s - encourages double-tap discovery
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Auto-hide when controls are revealed but not in full DJ mode
    // Quick fade encourages users to discover double-tap for full mode
    if (isControlsRevealed && !isReactionsRevealed) {
      controlsHideTimerRef.current = setTimeout(() => {
        setIsControlsRevealed(false);
        setShowOyoIsland(false); // Also hide OyoIsland
      }, 3000); // Hide after 3 seconds
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

      // Clear the flag after a short delay (after onClick would have fired)
      // OPTIMIZED: 50ms instead of 100ms for faster skip response
      setTimeout(() => { wasSkeeping.current = false; }, 50);
    }
  }, [isScrubbing, setPlaybackRate, handlePlayPause]);

  // Safe next track - doesn't skip if we were just skeeping
  const handleNextTrack = useCallback(() => {
    if (wasSkeeping.current) return; // Block skip after SKEEP
    nextTrack();
  }, [nextTrack]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (skeepEscalateTimer.current) clearInterval(skeepEscalateTimer.current);
      if (skeepHoldTimer.current) clearTimeout(skeepHoldTimer.current);
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
      userId: 'user-1', // Default user
    } as any);
  };

  // ============================================
  // MOBILE TEASER PREVIEW (30 seconds at 30% volume)
  // ============================================
  const [teaserTrack, setTeaserTrack] = useState<Track | null>(null);
  const [isTeaserPlaying, setIsTeaserPlaying] = useState(false);
  const teaserAudioRef = useRef<HTMLAudioElement | null>(null);
  const teaserTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle teaser playback for mobile tap
  const handleTeaser = useCallback((track: Track) => {
    // Stop any existing teaser
    if (teaserAudioRef.current) {
      teaserAudioRef.current.pause();
      teaserAudioRef.current = null;
    }
    if (teaserTimeoutRef.current) {
      clearTimeout(teaserTimeoutRef.current);
    }

    // Create audio element for teaser preview
    // Note: In production, this would use the actual audio source
    // For now, we'll set the current track and auto-stop after 30s
    setTeaserTrack(track);
    setIsTeaserPlaying(true);
    playTrack(track);

    // Auto-stop after 30 seconds
    teaserTimeoutRef.current = setTimeout(() => {
      setIsTeaserPlaying(false);
      setTeaserTrack(null);
      // Don't auto-pause - let user decide
    }, 30000);
  }, [playTrack]);

  // Cleanup teaser on unmount
  useEffect(() => {
    return () => {
      if (teaserTimeoutRef.current) clearTimeout(teaserTimeoutRef.current);
      if (teaserAudioRef.current) teaserAudioRef.current.pause();
    };
  }, []);

  return (
    <div
      className={`relative w-full h-full bg-[#020203] text-white font-sans flex flex-col ${
        oyeBarBehavior === 'fade' ? 'overflow-y-auto' : 'overflow-hidden'
      }`}
    >

      {/* FULLSCREEN BACKGROUND - Album art with dark overlay for floating effect */}
      {backdropEnabled && (
        <FullscreenBackground trackId={currentTrack?.trackId} />
      )}

      {/* BACKDROP TOGGLE - Sleek vertical toggle on left side */}
      <BackdropToggle
        isEnabled={backdropEnabled}
        onToggle={() => setBackdropEnabled(!backdropEnabled)}
        onOpenLibrary={() => setIsBackdropLibraryOpen(true)}
      />

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
      

      {/* Noise texture overlay */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay pointer-events-none z-[1]" />

      {/* OYO ISLAND - DJ Voice Search & Chat (tap screen to show) */}
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

      {/* TEASER PREVIEW INDICATOR - Shows when 30s preview is active */}
      
        {isTeaserPlaying && teaserTrack && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/90 backdrop-blur-sm border border-purple-400/50 shadow-lg"
          >
            <div
              className="w-2 h-2 rounded-full bg-white"
            />
            <span className="text-white text-xs font-bold">30s Preview</span>
            <button
              className="ml-1 p-1 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              onClick={() => {
                setIsTeaserPlaying(false);
                setTeaserTrack(null);
                if (teaserTimeoutRef.current) {
                  clearTimeout(teaserTimeoutRef.current);
                }
                }}
            >
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
      

      {/* FULLSCREEN VIDEO PLAYER - Shows when expand button clicked */}
      
        {isFullscreenVideo && currentTrack && (
          <FullscreenVideoPlayer
            track={currentTrack}
            isPlaying={isPlaying}
            onClose={() => setIsFullscreenVideo(false)}
            onTogglePlay={handlePlayPause}
          />
        )}
      

      {/* --- TOP SECTION (History/Queue) --- */}
      <div className="px-6 flex justify-between items-start z-20 h-[18%]" style={{ paddingTop: 'max(2rem, env(safe-area-inset-top))' }}>

        {/* Left: History (scrollable) */}
        <div className="relative max-w-[48%]">
          {/* Scroll fade indicator - right edge */}
          {historyTracks.length > 2 && (
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#0a0a0f] to-transparent pointer-events-none z-10" />
          )}

          <div
            className="flex gap-3 overflow-x-auto scrollbar-hide"
            style={{ scrollSnapType: 'x mandatory' }}
          >
            {historyTracks.length > 0 ? (
              historyTracks.slice(0, 10).map((track, i) => (
                <div key={track.id + i} style={{ scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <SmallCard
                    track={track}
                    onTap={() => playTrack(track)}
                    isPlayed={true}
                  />
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

        {/* Right: Queue + Add (scrollable, reversed) */}
        <div className="relative max-w-[48%]">
          {/* Scroll fade indicator - left edge */}
          {queueTracks.length > 1 && (
            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#0a0a0f] to-transparent pointer-events-none z-10" />
          )}

          <div
            className="flex gap-3 overflow-x-auto scrollbar-hide flex-row-reverse"
            style={{ scrollSnapType: 'x mandatory' }}
          >
            {/* Add button always visible at end */}
            <button
              onClick={onSearch}
              className="flex-shrink-0 w-[70px] h-[70px] rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
              style={{ scrollSnapAlign: 'start' }}
            >
              <Plus size={24} className="text-gray-500" />
            </button>

            {queueTracks.length > 0 ? (
              queueTracks.slice(0, 10).map((track, i) => (
                <div key={track.id + i} style={{ scrollSnapAlign: 'start', flexShrink: 0 }}>
                  <SmallCard
                    track={track}
                    onTap={() => playTrack(track)}
                    isPlayed={playedTrackIds.has(track.id)}
                  />
                </div>
              ))
            ) : (
              // Empty queue - show DASH placeholder
              <DashPlaceholder onClick={onSearch} label="queue" />
            )}
          </div>
        </div>
      </div>

      {/* --- CENTER SECTION (Hero + Engine) --- */}
      {/* TAP: Quick controls | HOLD/DOUBLE TAP: Full DJ Mode */}
      <div
        className={`flex flex-col items-center justify-end relative z-10 flex-1 ${
          oyeBarBehavior === 'fade' ? 'pt-7' : 'pt-5'
        }`}
        onPointerDown={handleCanvasPointerDown}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        onClick={handleCanvasTap}
      >

        {/* RIGHT-SIDE TOOLBAR - Always visible */}
        <RightToolbar onSettingsClick={handleOpenBoostSettings} />

        {/* 1. Main Artwork with Expand Video Button */}
        <div className="relative">
          {currentTrack ? (
            <BigCenterCard
              track={currentTrack}
              onExpandVideo={() => setVideoTarget('portrait')}
              onShowLyrics={() => setShowLyricsOverlay(true)}
              hideThumb={videoTarget === 'portrait'}
            />
          ) : (
            <div className="w-48 h-48 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center">
              <Play size={32} className="text-white/20" />
            </div>
          )}

          {/* LEFT QUICK CONTROLS - ")" arc: center reaches IN toward card */}
          
            {isControlsRevealed && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -left-14 flex flex-col gap-4"
              >
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
              </div>
            )}
          

        </div>

        {/* FLOATING REACTIONS OVERLAY */}
        <div className="absolute inset-0 pointer-events-none">
          
            {reactions.map(reaction => (
              <div
                key={reaction.id}
                className="absolute"
                style={{ left: `${reaction.x}%`, bottom: '30%' }}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl">{reaction.emoji}</span>
                  {reaction.multiplier > 1 && (
                    <span className={`font-bold ${reaction.multiplier >= 10 ? 'text-2xl text-yellow-300' : 'text-lg text-yellow-400'}`}>
                      {reaction.multiplier}x{reaction.multiplier >= 10 ? '!!!' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          
        </div>

        {/* MINIMAL PROGRESS - Fades when idle, only current time + red dot */}
        {/* Uses isolated components to prevent full re-renders */}
        <div
          className="w-full max-w-[180px] mt-2 mb-4 px-2 z-30"
        >
          <div className="flex items-center gap-2">
            {/* Current Time only - isolated component */}
            <CurrentTimeDisplay />
            {/* Progress slider - isolated component */}
            <ProgressSlider isScrubbing={isScrubbing} />
          </div>
        </div>

        {/* 2. THE ENGINE (Play Control) - SPINNING VINYL DISK + HOLD TO SKEEP */}
        <PlayControls
          isPlaying={isPlaying}
          onToggle={handlePlayPause}
          onPrev={prevTrack}
          onNext={handleNextTrack}
          isScrubbing={isScrubbing}
          onScrubStart={handleScrubStart}
          onScrubEnd={handleScrubEnd}
          trackArt={currentTrack ? getTrackThumbnailUrl(currentTrack, 'medium') : undefined}
          scrubDirection={scrubDirection}
          skeepLevel={skeepLevel}
        />

        {/* 3. OYÉ REACTIONS - Only takes space when visible */}
        {/* Disappear mode + not revealed = no wrapper, no space (State 0) */}
        {(oyeBarBehavior === 'fade' || isControlsRevealed || isReactionsRevealed) && (
          <div className="mt-3 min-h-[60px] flex items-center justify-center">
            <ReactionBar
            onReaction={handleReaction}
            isRevealed={isControlsRevealed || isReactionsRevealed}
            onRevealChange={setIsReactionsRevealed}
            oyeBarBehavior={oyeBarBehavior}
            activateChatTrigger={activateChatTrigger}
          />
          </div>
        )}

        {/* DJ Wake Toast - "Now Peace ✌🏾" */}
        
          {showDJWakeMessage && (
            <div
              className="fixed inset-0 flex items-center justify-center pointer-events-none z-50"
            >
              <div
                className="px-6 py-3 rounded-full bg-black/60 backdrop-blur-xl border border-white/10"
              >
                <span className="text-white text-lg font-medium tracking-wide">
                  {djWakeMessageText}
                </span>
              </div>
            </div>
          )}
        

      </div>

      {/* --- BOTTOM SECTION: DASHBOARD / MIX BOARD --- */}
      {/* Fade mode: min-h for scroll | Disappear mode: auto-fit (State 0) */}
      <div
        className={`flex-shrink-0 w-full bg-[#08080a]/95 backdrop-blur-2xl rounded-t-[2.5rem] border-t border-white/5 relative z-40 flex flex-col pt-2 pb-6 shadow-[0_-20px_60px_-10px_rgba(0,0,0,1)] ${
          oyeBarBehavior === 'fade' ? 'min-h-[325px]' : ''
        }`}
      >

        {/* Stream Labels - Enhanced Neon Style with Glow */}
        <div className="flex justify-between px-6 mb-3">
          {/* HOT Label - Red Neon */}
          <button
            onClick={handleToggleHotBelt}
            className="flex items-center gap-1.5 px-2 py-1 rounded relative overflow-hidden"
            style={{
              background: 'rgba(239,68,68,0.1)',
              boxShadow: isHotBeltActive
                ? '0 0 15px rgba(239,68,68,0.4), inset 0 0 10px rgba(239,68,68,0.2)'
                : '0 0 8px rgba(239,68,68,0.2)'
                }}
          >
            <div
            >
              <Flame size={12} className="text-rose-500" />
            </div>
            <span
              className="text-[11px] font-black tracking-[0.15em] uppercase"
              style={{
                color: '#ef4444',
                }}
            >
              HOT
            </span>
            {isHotBeltActive && (
              <span
                className="text-[6px] font-bold ml-0.5"
                style={{ color: '#fca5a5' }}
              >
                ●
              </span>
            )}
          </button>

          {/* DISCOVERY Label - Cyan Neon */}
          <button
            onClick={handleToggleDiscoveryBelt}
            className="flex items-center gap-1.5 px-2 py-1 rounded relative overflow-hidden"
            style={{
              background: 'rgba(6,182,212,0.1)',
              boxShadow: isDiscoveryBeltActive
                ? '0 0 15px rgba(6,182,212,0.4), inset 0 0 10px rgba(6,182,212,0.2)'
                : '0 0 8px rgba(6,182,212,0.2)'
                }}
          >
            <span
              className="text-[11px] font-black tracking-[0.15em] uppercase"
              style={{
                color: '#06b6d4',
                textShadow: '0 0 8px rgba(6,182,212,0.8), 0 0 16px rgba(6,182,212,0.5)'
                }}
            >
              DISCOVER
            </span>
            {isDiscoveryBeltActive && (
              <span
                className="text-[6px] font-bold ml-0.5"
                style={{ color: '#67e8f9' }}
              >
                ●
              </span>
            )}
          </button>
        </div>

        {/* Horizontal Scroll Deck - Two Separate Zones */}
        <div className="flex items-center relative h-24">

          {/* ========== HOT ZONE (Left side) ========== */}
          <div className="flex-1 flex items-center relative h-full">
            {/* Red Portal Line (left edge of HOT zone) - CLICKABLE SCROLL CONTROL */}
            <button
              onClick={() => {
                setHotScrollTrigger(prev => prev + 1);
                setIsHotBeltActive(true);
                // Trigger glow effect
                setHotPortalGlow(true);
                setTimeout(() => setHotPortalGlow(false), 800);
                }}
              className="flex-shrink-0 w-5 h-20 relative z-20 ml-1 touch-manipulation"
              aria-label="Scroll HOT belt outward"
            >
              {/* Portal line */}
              <div
                className="h-full w-1.5 mx-auto rounded-full"
                style={{
                  background: hotPortalGlow
                    ? 'linear-gradient(180deg, #ff6b6b, #ff4444, #ff6b6b)'
                    : 'linear-gradient(180deg, rgba(239,68,68,0.3), rgb(239,68,68), rgba(239,68,68,0.3))',
                  boxShadow: hotPortalGlow ? '0 0 30px #ff4444' : '0 0 10px #ff4444',
                }}
              />
              {/* Ambient glow - always visible */}
              <div className={`absolute inset-0 bg-red-500 blur-lg transition-opacity duration-300 ${hotPortalGlow ? 'opacity-100' : 'opacity-40'}`} />
              {/* Pulse ring on glow */}
              
                {hotPortalGlow && (
                  <div
                    className="absolute inset-0 rounded-full border-2 border-red-400"
                  />
                )}
              
              {/* Arrow hint */}
              <div
                className="absolute inset-0 flex items-center justify-center text-xs"
              >
                ‹
              </div>
            </button>

            {/* HOT Cards Belt (loops within this zone) */}
            <PortalBelt
              tracks={hotTracks.slice(0, 8)}
              onTap={playTrack}
              onTeaser={handleTeaser}
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
            {/* Left glow (red) - always visible, breathing when active */}
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-20 -translate-x-8 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at right, rgba(239,68,68,0.5) 0%, transparent 70%)' }}
            />
            {/* Right fade - covers track overflow with dark gradient */}
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 w-16 h-28 translate-x-12 pointer-events-none"
              style={{ background: 'linear-gradient(to left, #08080a 0%, #08080a 30%, transparent 100%)' }}
            />
            {/* Right glow (blue) - always visible, breathing when active */}
            <div
              className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-20 translate-x-8 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at left, rgba(59,130,246,0.5) 0%, transparent 70%)' }}
            />

            {/* VOYO Portal Button - Premium stale, enhanced active */}
            <button
              onClick={onVoyoFeed}
              className="relative w-14 h-14 rounded-full flex flex-col items-center justify-center"
              style={{
                background: 'radial-gradient(circle at center, #1a1a2e 0%, #0f0f16 100%)',
                boxShadow: (isHotBeltActive || isDiscoveryBeltActive)
                  ? '-8px 0 25px rgba(239,68,68,0.5), 8px 0 25px rgba(59,130,246,0.5), 0 0 20px rgba(147,51,234,0.3)'
                  : '0 0 12px rgba(139,92,246,0.15)',
              }}
            >
              {/* Stale: Subtle VOYO brand gradient ring */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background: 'linear-gradient(#0f0f16, #0f0f16) padding-box, linear-gradient(135deg, rgba(139,92,246,0.3), rgba(236,72,153,0.2), rgba(139,92,246,0.3)) border-box',
                  border: '1.5px solid transparent',
                  }}
              />

              {/* Active: Outer rotating ring */}
              
                {(isHotBeltActive || isDiscoveryBeltActive) && (
                  <div
                    className="absolute inset-[-4px] rounded-full border-2 border-transparent pointer-events-none"
                    style={{
                      background: 'linear-gradient(90deg, rgba(239,68,68,0.6), transparent, rgba(59,130,246,0.6)) padding-box, linear-gradient(90deg, #ef4444, #8b5cf6, #3b82f6) border-box',
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
              

              {/* VOYO text - gradient on stale, white on active */}
              {(isHotBeltActive || isDiscoveryBeltActive) ? (
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
              )}
            </button>
          </div>

          {/* ========== DISCOVERY ZONE (Right side) ========== */}
          <div className="flex-1 flex items-center relative h-full">
            {/* DISCOVERY Cards Belt (loops within this zone) */}
            <PortalBelt
              tracks={discoverTracks.slice(0, 8)}
              onTap={playTrack}
              onTeaser={handleTeaser}
              onQueueAdd={trackQueueAddition}
              playedTrackIds={playedTrackIds}
              type="discovery"
              mixModes={DEFAULT_MIX_MODES}
              modeBoosts={modeBoosts}
              isActive={isDiscoveryBeltActive}
              scrollOutwardTrigger={discoveryScrollTrigger}
            />

            {/* Blue Portal Line (right edge of DISCOVERY zone) - CLICKABLE SCROLL CONTROL */}
            <button
              onClick={() => {
                setDiscoveryScrollTrigger(prev => prev + 1);
                setIsDiscoveryBeltActive(true);
                // Trigger glow effect
                setDiscoveryPortalGlow(true);
                setTimeout(() => setDiscoveryPortalGlow(false), 800);
                }}
              className="flex-shrink-0 w-5 h-20 relative z-20 mr-1 touch-manipulation"
              aria-label="Scroll DISCOVERY belt outward"
            >
              {/* Portal line */}
              <div
                className="h-full w-1.5 mx-auto rounded-full"
                style={{
                  background: discoveryPortalGlow
                    ? 'linear-gradient(180deg, #60a5fa, #3b82f6, #60a5fa)'
                    : 'linear-gradient(180deg, rgba(59,130,246,0.3), rgb(59,130,246), rgba(59,130,246,0.3))',
                  boxShadow: discoveryPortalGlow ? '0 0 30px #3b82f6' : '0 0 10px #3b82f6',
                }}
              />
              {/* Ambient glow - always visible */}
              <div className={`absolute inset-0 bg-blue-500 blur-lg transition-opacity duration-300 ${discoveryPortalGlow ? 'opacity-100' : 'opacity-40'}`} />
              {/* Pulse ring on glow */}
              
                {discoveryPortalGlow && (
                  <div
                    className="absolute inset-0 rounded-full border-2 border-blue-400"
                  />
                )}
              
              {/* Arrow hint */}
              <div
                className="absolute inset-0 flex items-center justify-center text-xs"
              >
                ›
              </div>
            </button>
          </div>

        </div>

        {/* PLAYLIST RECOMMENDATION BAR - NEON BILLBOARD 2050 */}
        <div className="mt-4 px-4">
          <div className="flex items-center justify-between mb-3">
            {/* Section Title - MIX BOARD + Your Vibes */}
            <div
              className="flex items-center gap-2"
            >
              <span
                className="text-[10px] font-black tracking-[0.15em] uppercase text-white/60"
              >
                MIX BOARD
              </span>
              <span className="text-white/30">•</span>
              {/* "Your Vibes" - Italic, dynamic color from boosted modes with pulse */}
              <span
                className="text-[11px] font-medium italic"
                style={{
                  color: vibesColor.color,
                  textShadow: `0 0 8px ${vibesColor.glow}, 0 0 16px ${vibesColor.glow}`,
                }}
              >
                Your Vibes
              </span>
            </div>
            {/* "See All" with hover effect */}
            <button
              className="text-[8px] text-gray-500 hover:text-purple-400 transition-colors"
            >
              See all →
            </button>
          </div>
          <div className="overflow-x-auto no-scrollbar flex gap-3 pb-1 -mb-2">
            {/* ====== MIX BOARD PRESETS - Tap to boost, Double-tap to react, Click punch to discover ====== */}
            {/* Afro Heat - ENERGETIC mood */}
            <NeonBillboardCard
              title="Afro Heat"
              taglines={["Asambe! 🔥", "Lagos to Accra!", "E Choke! 💥", "Fire on Fire!", "No Wahala!"]}
              neon="#ef4444"
              glow="rgba(239,68,68,0.5)"
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
            {/* Chill Vibes - CHILL mood */}
            <NeonBillboardCard
              title="Chill Vibes"
              taglines={["It's Your Eazi...", "Slow Wine Time", "Easy Does It", "Float Away~", "Pon Di Ting"]}
              neon="#3b82f6"
              glow="rgba(59,130,246,0.5)"
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
            {/* Party Mode - HYPE mood */}
            <NeonBillboardCard
              title="Party Mode"
              taglines={["Another One! 🎉", "We The Best!", "Ku Lo Sa!", "Turn Up! 🔊", "Major Vibes Only"]}
              neon="#ec4899"
              glow="rgba(236,72,153,0.5)"
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
              neon="#8b5cf6"
              glow="rgba(139,92,246,0.5)"
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
            {/* Workout - INTENSE mood */}
            <NeonBillboardCard
              title="Workout"
              taglines={["Beast Mode! 💪", "Pump It Up!", "No Pain No Gain", "Go Harder!", "Maximum Effort!"]}
              neon="#f97316"
              glow="rgba(249,115,22,0.5)"
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

            {/* RANDOM MIXER - Spotify-style discovery recommendations */}
            <NeonBillboardCard
              title="Random Mix"
              taglines={["Surprise Me! 🎲", "Discovery Mode", "Mix It Up!", "Fresh Finds 🔮", "Vibe Check!"]}
              neon="#a855f7"
              glow="rgba(168,85,247,0.5)"
              delay={5}
              mood="mysterious"
              textAnimation="scaleIn"
              onClick={() => handleModeBoost('random-mixer')}
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

      {/* BOOST SETTINGS PANEL */}
      <BoostSettings
        isOpen={isBoostSettingsOpen}
        onClose={() => setIsBoostSettingsOpen(false)}
      />

      {/* SIGNAL INPUT MODAL - Double-tap billboard opens this */}
      
        {signalInputOpen && signalCategory && currentTrack && (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center"
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
                boxShadow: `0 0 40px rgba(236,72,153,0.3), 0 0 80px rgba(168,85,247,0.2)`,
                border: '1px solid rgba(236,72,153,0.3)',
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
                      background: signalCategory === 'afro-heat' ? 'rgba(239,68,68,0.2)' :
                                 signalCategory === 'chill-vibes' ? 'rgba(59,130,246,0.2)' :
                                 signalCategory === 'party-mode' ? 'rgba(236,72,153,0.2)' :
                                 signalCategory === 'late-night' ? 'rgba(139,92,246,0.2)' :
                                 'rgba(249,115,22,0.2)',
                      color: signalCategory === 'afro-heat' ? '#ef4444' :
                             signalCategory === 'chill-vibes' ? '#3b82f6' :
                             signalCategory === 'party-mode' ? '#ec4899' :
                             signalCategory === 'late-night' ? '#8b5cf6' :
                             '#f97316',
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
                  src={getTrackThumbnailUrl(currentTrack, 'medium')}
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
      

      {/* LYRICS OVERLAY - Tap album art to show */}
      
        {showLyricsOverlay && currentTrack && (
          <LyricsOverlay
            track={currentTrack}
            isOpen={showLyricsOverlay}
            onClose={() => setShowLyricsOverlay(false)}
            currentTime={usePlayerStore.getState().currentTime}
          />
        )}
      

    </div>
  );
};

export default VoyoPortraitPlayer;
