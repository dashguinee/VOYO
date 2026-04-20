/**
 * VOYO Music - Classic Mode: Home Feed (Spotify-Style Shelves)
 *
 * Features:
 * - Horizontal scrollable shelves (Continue Listening, Heavy Rotation, Made For You, etc.)
 * - Time-based greeting
 * - Personalized recommendations based on user preferences
 * - Mobile-first, touch-friendly design
 */

import { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { Search, Bell, Play, Zap } from 'lucide-react';
import { AfricaIcon } from '../ui/AfricaIcon';
import { getThumb } from '../../utils/thumbnail';
import { SmartImage } from '../ui/SmartImage';
import { VIBES, Vibe } from '../../data/tracks';
import { LottieIcon } from '../ui/LottieIcon';
import { getUserTopTracks, getPoolAwareHotTracks, getPoolAwareDiscoveryTracks, calculateBehaviorScore, recordPoolEngagement } from '../../services/personalization';
import { curateAllSections } from '../../services/poolCurator';
import { getInsights as getOyoInsights } from '../../services/oyoDJ';
import { usePools, app } from '../../services/oyo';
import { usePreferenceStore } from '../../store/preferenceStore';
import { usePlayerStore } from '../../store/playerStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { useReactionStore } from '../../store/reactionStore';
import { useDownloadStore } from '../../store/downloadStore';
import { Track } from '../../types';
// TiviPlusCrossPromo moved to DaHub
import { SignInPrompt } from '../social/SignInPrompt';
import { StationHero, type Station } from './StationHero';
import { supabase } from '../../lib/supabase';

// ============================================
// HELPER FUNCTIONS
// ============================================

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

// Pool-based: Get new releases from pool (sorted by when added)
const getNewReleases = (pool: Track[], limit: number = 15): Track[] => {
  return [...pool]
    .sort((a, b) => {
      const dateA = new Date(a.createdAt || '2024-01-01').getTime();
      const dateB = new Date(b.createdAt || '2024-01-01').getTime();
      return dateB - dateA;
    })
    .slice(0, limit);
};

// Pool-based: Get artists you love from pool + history
const getArtistsYouLove = (history: any[], pool: Track[], limit: number = 8): { name: string; tracks: Track[]; playCount: number }[] => {
  const artistPlays: Record<string, { tracks: Set<string>; count: number }> = {};
  history.forEach(item => {
    if (item.track?.artist) {
      const artist = item.track.artist;
      if (!artistPlays[artist]) {
        artistPlays[artist] = { tracks: new Set(), count: 0 };
      }
      artistPlays[artist].tracks.add(item.track.id);
      artistPlays[artist].count++;
    }
  });
  return Object.entries(artistPlays)
    .map(([name, data]) => ({
      name,
      playCount: data.count,
      // Get tracks from pool instead of static TRACKS
      tracks: pool.filter(t => typeof t.artist === 'string' && t.artist.toLowerCase().includes(name.toLowerCase())).slice(0, 5),
    }))
    .filter(a => a.tracks.length > 0)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, limit);
};

const getTrendingTracks = (hotPool: any[], limit: number = 15): Track[] => {
  return [...hotPool]
    .sort((a, b) => b.poolScore - a.poolScore)
    .slice(0, limit) as Track[];
};

// Section-filtered helpers (use curator tags from poolCurator)
const getWestAfricanTracks = (hotPool: any[], limit: number = 15): Track[] => {
  return [...hotPool]
    .filter((t: any) => t.tags?.includes('west-african'))
    .sort((a, b) => (b.poolScore || 0) - (a.poolScore || 0))
    .slice(0, limit) as Track[];
};

const getClassicsTracks = (hotPool: any[], limit: number = 15): Track[] => {
  return [...hotPool]
    .filter((t: any) => t.tags?.includes('classic'))
    .sort((a, b) => (b.poolScore || 0) - (a.poolScore || 0))
    .slice(0, limit) as Track[];
};

const getCuratedTrendingTracks = (hotPool: any[], limit: number = 15): Track[] => {
  return [...hotPool]
    .filter((t: any) => t.tags?.includes('trending'))
    .sort((a, b) => (b.poolScore || 0) - (a.poolScore || 0))
    .slice(0, limit) as Track[];
};

// Deterministic seeded shuffle — stable within a session, fresh across sessions.
// Uses the sessionSeed to rotate which tracks from the pool get surfaced, so
// every reload / pull-to-refresh feels alive without expensive recomputation.
const seededShuffle = <T extends Track>(tracks: T[], seed: number): T[] => {
  if (!tracks.length) return tracks;
  return [...tracks].sort((a, b) => {
    const keyA = a.trackId || a.id || '';
    const keyB = b.trackId || b.id || '';
    // Mix first two char codes with seed so single-char collisions don't
    // all land at the same hash bucket.
    const hashA = ((keyA.charCodeAt(0) || 0) * 31 + (keyA.charCodeAt(1) || 0)) * seed % 1_000_003;
    const hashB = ((keyB.charCodeAt(0) || 0) * 31 + (keyB.charCodeAt(1) || 0)) * seed % 1_000_003;
    return hashA - hashB;
  });
};

const getRecentlyPlayed = (history: any[], limit: number = 10): Track[] => {
  const seen = new Set<string>();
  const uniqueTracks: Track[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.track && !seen.has(item.track.id)) {
      seen.add(item.track.id);
      uniqueTracks.push(item.track);
      if (uniqueTracks.length >= limit) break;
    }
  }
  return uniqueTracks;
};

// ============================================
// SHELF COMPONENT
// ============================================

interface ShelfProps {
  title: string;
  onSeeAll?: () => void;
  children: React.ReactNode;
}

const Shelf = ({ title, onSeeAll, children }: ShelfProps) => {
  // Accent color per shelf title
  const accentColor = title.includes('Trending') || title.includes('Top 10')
    ? '#D4A053' // African Gold Bronze for trending/hot
    : '#8b5cf6'; // purple for everything else

  return (
    <div className="mb-10">
      <div className="flex justify-between items-center px-4 mb-5">
        <div className="flex items-center gap-2">
          <h2 className="text-white font-semibold text-base">{title}</h2>
          <div className="h-[2px] w-6 rounded-full" style={{ background: accentColor, opacity: 0.6 }} />
        </div>
        {onSeeAll && (
          <button
            className="text-sm font-medium"
            style={{ color: accentColor }}
            onClick={onSeeAll}
          >
            See all
          </button>
        )}
      </div>
      <div
        className="flex gap-4 px-4 overflow-x-auto scrollbar-hide"
        style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </div>
    </div>
  );
};

// ============================================
// SHELF WITH REFRESH COMPONENT
// ============================================

interface ShelfWithRefreshProps {
  title: string;
  /** Unused — legacy prop for compat. Refresh happens via subtle end-of-scroll sentinel. */
  onRefresh?: () => void;
  /** Unused — legacy prop for compat. */
  isRefreshing?: boolean;
  onSeeAll?: () => void;
  children: React.ReactNode;
}

const ShelfWithRefresh = ({ title, onSeeAll, children }: ShelfWithRefreshProps) => (
  <div className="mb-10">
    <div className="flex justify-between items-center px-4 mb-5">
      <h2 className="text-white font-semibold text-base">{title}</h2>
      {onSeeAll && (
        <button
          className="text-purple-400 text-sm font-medium"
          onClick={onSeeAll}
        >
          See all
        </button>
      )}
    </div>
    <div
      className="flex gap-4 px-4 overflow-x-auto scrollbar-hide"
      style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
    >
      {children}
    </div>
  </div>
);

// ============================================
// CENTER-FOCUSED CAROUSEL - For New Releases
// Center card big, sides smaller (like Landscape player selector)
// ============================================

interface CenterCarouselProps {
  tracks: Track[];
  onPlay: (track: Track) => void;
}

// Scattered VOYO text for left end - arrow pattern (clean, no dot)
const VoyoScatter = () => (
  <div className="relative w-16 h-20">
    {['VOYO', 'VOYO', 'VOYO'].map((text, i) => (
      <span
        key={i}
        className="absolute text-[8px] font-black tracking-wider"
        style={{
          background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          color: 'transparent',
          top: `${15 + i * 25}%`,
          left: `${10 + (i % 2) * 20}%`,
          transform: `rotate(${-15 + i * 15}deg)`,
        }}
      >
        {text}
      </span>
    ))}
  </div>
);

// Smooth pulsing circle while scrolling
const PulsingCircle = () => (
  <div
    className="w-4 h-4 rounded-full"
    style={{
      background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.8), rgba(124, 58, 237, 0.7))',
      boxShadow: '0 0 12px rgba(139, 92, 246, 0.4)',
    }}
  />
);

const CenterFocusedCarousel = ({ tracks, onPlay }: CenterCarouselProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [centerIndex, setCenterIndex] = useState(1);
  const [scrollState, setScrollState] = useState<'left-end' | 'scrolling' | 'right-end'>('scrolling');

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const { scrollLeft, scrollWidth, clientWidth } = container;
    const cardWidth = 140;
    const newIndex = Math.round(scrollLeft / cardWidth);
    setCenterIndex(Math.min(Math.max(newIndex + 1, 0), tracks.length - 1));

    // Determine scroll position state
    const maxScroll = scrollWidth - clientWidth;
    if (scrollLeft < 50) {
      setScrollState('left-end');
    } else if (scrollLeft > maxScroll - 50) {
      setScrollState('right-end');
    } else {
      setScrollState('scrolling');
    }
  };

  return (
    <div className="relative">
      {/* LEFT END: Scattered VOYO text */}
      
        {scrollState === 'left-end' && (
          <div
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 pointer-events-none"
          >
            <VoyoScatter />
          </div>
        )}
      

      {/* WHILE SCROLLING: Smooth pulsing circle */}
      
        {scrollState === 'scrolling' && (
          <div
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none"
          >
            <PulsingCircle />
          </div>
        )}
      

      {/* RIGHT END: "New drops coming soon" */}
      
        {scrollState === 'right-end' && (
          <div
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none"
          >
            <p
              className="text-[10px] text-purple-400/60 font-medium whitespace-nowrap"
            >
              Discover more
            </p>
          </div>
        )}
      
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide py-2"
        style={{
          scrollSnapType: 'x mandatory',
          paddingLeft: 'calc(50% - 70px)', // Center first card
          paddingRight: 'calc(50% - 70px)',
        }}
        onScroll={handleScroll}
      >
        {tracks.map((track, index) => {
          const isCenter = index === centerIndex;
          const distance = Math.abs(index - centerIndex);
          const scale = isCenter ? 1 : Math.max(0.75, 1 - distance * 0.15);
          const opacity = isCenter ? 1 : Math.max(0.5, 1 - distance * 0.25);

          return (
            <button
              key={track.id}
              className="flex-shrink-0"
              onClick={() => onPlay(track)}
              style={{
                scrollSnapAlign: 'center',
                width: 130,
                transform: `scale(${scale})`,
                opacity,
              }}
            >
              <div
                className="relative rounded-xl overflow-hidden mb-2 bg-white/5"
                style={{
                  width: 130,
                  height: 130,
                  boxShadow: isCenter ? '0 8px 30px rgba(139, 92, 246, 0.3)' : '0 4px 15px rgba(0,0,0,0.3)',
                }}
              >
                <SmartImage
                  src={getThumb(track.trackId)}
                  alt={track.title}
                  className="w-full h-full object-cover"
                  trackId={track.trackId}
                  artist={track.artist}
                  title={track.title}
                />
                {/* Center card: glass play button + glow ring — premium, doesn't cover art */}
                {isCenter && (
                  <>
                    <div className="absolute bottom-2 right-2">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md"
                        style={{
                          background: 'rgba(139, 92, 246, 0.45)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)',
                        }}
                      >
                        <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
                      </div>
                    </div>
                    <div className="absolute inset-0 rounded-xl ring-2 ring-purple-500/50 pointer-events-none" />
                  </>
                )}
              </div>
              <p className={`text-sm font-medium truncate ${isCenter ? 'text-white' : 'text-white/60'}`}>
                {track.title}
              </p>
              <p className={`text-xs truncate ${isCenter ? 'text-white/70' : 'text-white/40'}`}>
                {track.artist}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ============================================
// TRACK CARD COMPONENT
// ============================================

interface TrackCardProps {
  track: Track;
  onPlay: () => void;
  /** Show the bronze OYÉ boost badge */
  showBoostBadge?: boolean;
  /** Track is actually cached/boosted — full opacity. False = faded + smaller */
  isBoosted?: boolean;
}

const TrackCard = memo(({ track, onPlay, showBoostBadge = false }: TrackCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [oyeActive, setOyeActive] = useState(false);
  const createReaction = useReactionStore(s => s.createReaction);
  const boostTrack = useDownloadStore(s => s.boostTrack);
  const addToQueue = usePlayerStore(s => s.addToQueue);

  // ── HOLD-TO-PREFERENCE + SWIPE-UP-TO-BUCKET GESTURE ─────────────
  // Hold 400ms → card enters preference mode. Two shimmers appear:
  // left (grey = "not interested") and right (golden = "interested").
  // Slide the card on its own axis to commit. Release right → auto-
  // queue. Release left → skip signal. Release center → cancel.
  //
  // SWIPE UP (no hold required): quick flick upward → add to bucket.
  // iPod-smooth — the card lifts, shrinks, and fades as it flies up.
  const [prefMode, setPrefMode] = useState(false);
  const [prefDx, setPrefDx] = useState(0);
  const [bucketFly, setBucketFly] = useState(false); // Card flying to bucket animation
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefStartRef = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const didPrefRef = useRef(false);
  const swipeAxisRef = useRef<'x' | 'y' | null>(null); // Lock to first significant axis

  const PREF_THRESHOLD = 35; // px to commit (horizontal)
  const BUCKET_THRESHOLD = 40; // px to commit (vertical swipe up)

  const handlePrefDown = (e: React.PointerEvent) => {
    didPrefRef.current = false;
    swipeAxisRef.current = null;
    prefStartRef.current = { x: e.clientX, y: e.clientY };
    holdTimerRef.current = setTimeout(() => {
      setPrefMode(true);
      didPrefRef.current = true;
      try { navigator.vibrate?.(15); } catch {}
    }, 400);
  };

  const handlePrefMove = (e: React.PointerEvent) => {
    if (!prefStartRef.current) return;
    const dx = e.clientX - prefStartRef.current.x;
    const dy = e.clientY - prefStartRef.current.y;

    // Lock axis on first significant movement (>8px)
    if (!swipeAxisRef.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      swipeAxisRef.current = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      // Vertical swipe detected early — cancel hold timer (no pref mode)
      if (swipeAxisRef.current === 'y' && holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    }

    if (prefMode && swipeAxisRef.current !== 'y') {
      setPrefDx(Math.max(-60, Math.min(60, dx))); // clamp horizontal
    }
  };

  const handlePrefUp = (e: React.PointerEvent) => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }

    // ── SWIPE-UP-TO-BUCKET (no hold needed) ──
    if (prefStartRef.current && swipeAxisRef.current === 'y') {
      const dy = e.clientY - prefStartRef.current.y;
      if (dy < -BUCKET_THRESHOLD) {
        // Swiped up past threshold → bucket it!
        didPrefRef.current = true;
        addToQueue(track, 0); // Next up
        try { navigator.vibrate?.([15, 8, 15]); } catch {}
        // Fly animation
        setBucketFly(true);
        setTimeout(() => setBucketFly(false), 500);
        prefStartRef.current = null;
        swipeAxisRef.current = null;
        return;
      }
    }

    if (!prefMode) { prefStartRef.current = null; swipeAxisRef.current = null; return; }

    if (prefDx > PREF_THRESHOLD) {
      // ── INTERESTED: golden flash → auto-queue ──
      const position = Math.random() < 0.6 ? 0 : undefined;
      addToQueue(track, position);
      try { navigator.vibrate?.([20, 10, 20]); } catch {}

      // Quick golden flash
      if (cardRef.current) {
        cardRef.current.style.transition = 'box-shadow 0.3s ease-out';
        cardRef.current.style.boxShadow = '0 0 20px rgba(212,160,83,0.6), inset 0 0 30px rgba(212,160,83,0.15)';
        setTimeout(() => {
          if (cardRef.current) { cardRef.current.style.boxShadow = ''; cardRef.current.style.transition = ''; }
        }, 500);
      }
    } else if (prefDx < -PREF_THRESHOLD) {
      // ── NOT INTERESTED: grey fade → skip signal ──
      recordPoolEngagement(track.id || track.trackId, 'skip');
      try { navigator.vibrate?.(10); } catch {}
    }
    // Reset
    setPrefMode(false);
    setPrefDx(0);
    prefStartRef.current = null;
    swipeAxisRef.current = null;
  };

  const handleOye = (e: React.MouseEvent) => {
    e.stopPropagation();
    createReaction({
      username: 'dash',
      trackId: track.trackId,
      trackTitle: track.title,
      trackArtist: track.artist,
      trackThumbnail: getThumb(track.trackId),
      category: 'afro-heat',
      reactionType: 'oye',
    });
    boostTrack(track.trackId, track.title, track.artist, track.duration || 180, getThumb(track.trackId));
    setOyeActive(true);
    setTimeout(() => setOyeActive(false), 600);
  };

  return (
    <button
      className="flex-shrink-0 w-32 relative group"
      onClick={(e) => { if (didPrefRef.current) { didPrefRef.current = false; return; } onPlay(); }}
      style={{ scrollSnapAlign: 'start' }}
      onPointerDown={handlePrefDown}
      onPointerMove={handlePrefMove}
      onPointerUp={handlePrefUp}
      onPointerCancel={() => { setPrefMode(false); setPrefDx(0); swipeAxisRef.current = null; prefStartRef.current = null; if (holdTimerRef.current) clearTimeout(holdTimerRef.current); }}
    >
      <div
        ref={cardRef}
        className="relative w-32 h-32 rounded-xl overflow-hidden mb-2 bg-[#1c1c22] border border-[#28282f]/50 group-active:border-white/15 transition-colors"
        style={{
          // Card slides on its own axis during preference mode,
          // or flies up + shrinks when swiped to bucket
          transform: bucketFly
            ? 'translateY(-80px) scale(0.7)'
            : prefMode ? `translateX(${prefDx}px) rotate(${prefDx / 8}deg)` : 'none',
          opacity: bucketFly ? 0 : 1,
          transition: bucketFly
            ? 'transform 0.4s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.35s ease-out'
            : prefMode ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <SmartImage
          src={getThumb(track.trackId)}
          alt={track.title}
          className="w-full h-full object-cover"
          trackId={track.trackId}
          artist={track.artist}
          title={track.title}
        />
        {/* Normal state: subtle tint */}
        {!prefMode && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.02) 100%)',
            }}
          />
        )}
        {/* PREFERENCE MODE: dual shimmer gradients.
            Left shimmer = grey (not interested), fades in as user slides left.
            Right shimmer = golden bronze (interested), fades in as user slides right.
            Both overlays are always present; opacity is driven by prefDx. */}
        {prefMode && (
          <>
            {/* Grey "skip" shimmer — left side */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(to right, rgba(120,125,135,0.35), transparent 60%)',
                opacity: Math.max(0, -prefDx / 60),
                transition: 'opacity 0.1s ease-out',
              }}
            />
            {/* Golden "interested" shimmer — right side */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(to left, rgba(212,160,83,0.40), transparent 60%)',
                opacity: Math.max(0, prefDx / 60),
                transition: 'opacity 0.1s ease-out',
              }}
            />
            {/* Center divider glow when neutral */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: 'inset 0 0 20px rgba(255,255,255,0.08)',
                opacity: 1 - Math.abs(prefDx) / 60,
              }}
            />
          </>
        )}
        {/* BUCKET FLY: purple flash overlay during swipe-up animation */}
        {bucketFly && (
          <div
            className="absolute inset-0 pointer-events-none flex items-center justify-center"
            style={{
              background: 'linear-gradient(to top, rgba(139,92,246,0.5), rgba(139,92,246,0.2))',
            }}
          >
            <span className="text-white text-[10px] font-bold tracking-wider">BUCKETED</span>
          </div>
        )}
        {isHovered && !prefMode && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-6 h-6 text-white ml-1" fill="white" />
            </div>
          </div>
        )}
        {showBoostBadge && !prefMode && (
          <button
            className="absolute top-2 right-2 z-10"
            onClick={handleOye}
            aria-label="OYÉ this track"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #D4A053, #C4943D)',
                boxShadow: oyeActive ? '0 0 15px rgba(212, 160, 83, 0.6)' : '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              <Zap className="w-4 h-4 text-white" style={{ fill: 'white' }} />
            </div>
          </button>
        )}
      </div>
      <p className="text-white text-sm font-medium truncate">{track.title}</p>
      <p className="text-white/50 text-[11px] truncate">{track.artist}</p>
    </button>
  );
});
TrackCard.displayName = 'TrackCard';

// ============================================
// WIDE TRACK CARD - 16:9 for Continue Listening
// ============================================

const WideTrackCard = memo(({ track, onPlay, showBoostBadge = false, isBoosted = false }: TrackCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [oyeActive, setOyeActive] = useState(false);
  const createReaction = useReactionStore(s => s.createReaction);
  const boostTrack = useDownloadStore(s => s.boostTrack);
  const thumbnailUrl = getThumb(track.trackId, 'high');

  const handleOye = (e: React.MouseEvent) => {
    e.stopPropagation();
    createReaction({
      username: 'dash',
      trackId: track.trackId,
      trackTitle: track.title,
      trackArtist: track.artist,
      trackThumbnail: getThumb(track.trackId),
      category: 'afro-heat',
      reactionType: 'oye',
    });
    boostTrack(track.trackId, track.title, track.artist, track.duration || 180, getThumb(track.trackId));
    setOyeActive(true);
    setTimeout(() => setOyeActive(false), 600);
  };

  return (
    <div
      className="flex-shrink-0 cursor-pointer group"
      onClick={onPlay}
      style={{ scrollSnapAlign: 'start', width: '180px' }}
    >
      <div className="relative w-full rounded-xl overflow-hidden mb-2 bg-[#1c1c22] border border-[#28282f]/50 group-active:border-[#8b5cf6]/30 transition-colors" style={{ aspectRatio: '16/9' }}>
        <SmartImage
          src={thumbnailUrl}
          alt={track.title}
          className="w-full h-full object-cover"
          trackId={track.trackId}
          artist={track.artist}
          title={track.title}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {isHovered && (
          <div
            className="absolute inset-0 bg-black/30 flex items-center justify-center"
          >
            <div className="w-10 h-10 rounded-full bg-purple-500/90 flex items-center justify-center">
              <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
            </div>
          </div>
        )}
        {/* OYE Button - Top Right — full when boosted, faded+smaller when not */}
        {showBoostBadge && (
          <button
            className="absolute top-2 right-2 z-10"
            onClick={handleOye}
          >
            <div
              className={`${isBoosted ? 'w-7 h-7' : 'w-5.5 h-5.5'} rounded-full flex items-center justify-center`}
              style={{
                width: isBoosted ? 28 : 22,
                height: isBoosted ? 28 : 22,
                background: 'linear-gradient(135deg, #D4A053, #C4943D)',
                opacity: isBoosted ? 1 : 0.45,
                boxShadow: oyeActive ? '0 0 15px rgba(212, 160, 83, 0.6)' : isBoosted ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              <Zap className={isBoosted ? 'w-4 h-4' : 'w-3 h-3'} style={{ color: 'white', fill: 'white' }} />
            </div>
          </button>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-white text-xs font-semibold truncate drop-shadow-lg">{track.title}</p>
        </div>
      </div>
      <p className="text-white/60 text-[11px] truncate">{track.artist}</p>
    </div>
  );
});
WideTrackCard.displayName = 'WideTrackCard';

// ============================================
// ARTIST CARD COMPONENT
// ============================================

interface ArtistCardProps {
  artist: { name: string; tracks: Track[]; playCount: number };
  onPlay: (track: Track) => void;
}

const ArtistCard = memo(({ artist, onPlay }: ArtistCardProps) => {
  const firstTrack = artist.tracks[0];

  return (
    <button
      className="flex-shrink-0 w-28"
      onClick={() => firstTrack && onPlay(firstTrack)}
      style={{ scrollSnapAlign: 'start' }}
    >
      <div className="relative w-20 h-20 rounded-full overflow-hidden mb-3 bg-white/5 mx-auto shadow-lg shadow-black/30">
        {firstTrack && (
          <SmartImage
            src={getThumb(firstTrack.trackId)}
            alt={artist.name}
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 35%', transform: 'scale(1.4)' }}
            trackId={firstTrack.trackId}
            artist={artist.name}
            title={firstTrack.title}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-purple-500/80 text-[8px] text-white font-medium">
          {artist.playCount}
        </div>
      </div>
      <p className="text-white text-xs font-medium truncate text-center">{artist.name}</p>
      <p className="text-white/40 text-[10px] truncate text-center">{artist.tracks.length} tracks</p>
    </button>
  );
});
ArtistCard.displayName = 'ArtistCard';

// ============================================
// AFRICAN VIBES VIDEO CARD - With golden glow & video
// ============================================

// Decode VOYO ID to YouTube ID
const decodeVoyoId = (trackId: string): string => {
  if (!trackId.startsWith('vyo_')) return trackId;
  const encoded = trackId.substring(4);
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) base64 += '=';
  try {
    return atob(base64);
  } catch {
    return trackId;
  }
};

const AfricanVibesVideoCard = memo(({
  track,
  idx,
  isActive,
  onTrackPlay
}: {
  track: Track;
  idx: number;
  isActive: boolean;
  onTrackPlay: () => void;
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Decode VOYO ID to real YouTube ID
  const youtubeId = useMemo(() => decodeVoyoId(track.trackId), [track.trackId]);

  const embedUrl = useMemo(() => {
    const params = new URLSearchParams({
      autoplay: '0',
      mute: '1',
      controls: '0',
      disablekb: '1',
      fs: '0',
      iv_load_policy: '3',
      modestbranding: '1',
      playsinline: '1',
      rel: '0',
      showinfo: '0',
      enablejsapi: '1',
      origin: window.location.origin,
    });
    return `https://www.youtube.com/embed/${youtubeId}?${params.toString()}`;
  }, [youtubeId]);

  useEffect(() => {
    if (!iframeRef.current || !isLoaded) return;
    const cmd = isActive ? 'playVideo' : 'pauseVideo';
    iframeRef.current.contentWindow?.postMessage(
      `{"event":"command","func":"${cmd}","args":""}`, '*'
    );
  }, [isActive, isLoaded]);

  // NOTE: Previews are always muted - audio only through AudioPlayer
  // Removed unmute logic to ensure single audio source

  return (
    <button
      className="flex-shrink-0 relative rounded-xl"
      style={{ width: '95px', height: '142px' }}
      onClick={onTrackPlay}
    >
      {/* Bronze glow - stronger for hero (idx 0) */}
      <div
        className="absolute -inset-1 rounded-xl pointer-events-none"
        style={{
          background: idx === 0
            ? 'linear-gradient(135deg, rgba(212, 160, 83, 0.4) 0%, rgba(212, 160, 83, 0.15) 20%, transparent 50%)'
            : 'linear-gradient(135deg, rgba(212, 160, 83, 0.2) 0%, rgba(212, 160, 83, 0.08) 15%, transparent 40%)',
          filter: 'blur(8px)',
        }}
      />

      <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
        {/* Thumbnail - SmartImage with fallback chain */}
        <SmartImage
          src={getThumb(track.trackId, 'high')}
          trackId={track.trackId}
          alt={track.title}
          artist={track.artist}
          title={track.title}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scale(1.8)' }}
          lazy={false}
        />

        {/* Video iframe */}
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{ opacity: isActive && isLoaded ? 1 : 0 }}
        >
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="pointer-events-none"
            style={{
              border: 'none',
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '300%',
              height: '300%',
            }}
            allow="accelerometer; autoplay; encrypted-media"
            onLoad={() => setIsLoaded(true)}
          />
        </div>

        {/* Purple overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'linear-gradient(180deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.08) 40%, rgba(0,0,0,0.75) 100%)',
          }}
        />

        {/* Genre pill */}
        <div className="absolute top-1.5 left-1.5 z-20">
          <span className="px-1.5 py-0.5 rounded text-[6px] font-bold uppercase bg-purple-600/50 text-white/80">
            {track.tags?.[0] || 'Afrobeats'}
          </span>
        </div>

        {/* Sound toggle removed - previews always muted, audio through AudioPlayer */}

        {/* Blinking recording dot */}
        {isActive && isLoaded && (
          <div
            className="absolute top-7 right-2 z-20 w-1.5 h-1.5 rounded-full bg-red-500"
          />
        )}

        {/* Track info */}
        <div className="absolute bottom-0 left-0 right-0 p-1.5 z-20">
          <p className="text-white text-[9px] font-bold truncate">{track.title}</p>
          <p className="text-white/60 text-[7px] truncate">{track.artist}</p>
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-[6px] font-bold text-[#D4A053]">
              {track.oyeScore ? (track.oyeScore / 1000).toFixed(0) + 'K OYE' : ''}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
});

// ============================================
// AFRICAN VIBES CAROUSEL
// ============================================

// END-SCROLL SENTINEL states:
// - 'hidden'  : not yet scrolled to the end, nothing rendered
// - 'cta'     : scrolled to end, shows golden "Watch More" button
// - 'loading' : user tapped — golden beam sweep welcomes the next video
// - 'loaded'  : new video preview + purple "Open VOYO" button
type EndSentinelState = 'hidden' | 'cta' | 'loading' | 'loaded';

const AfricanVibesCarousel = ({
  tracks,
  onTrackPlay,
  onOpenVoyo,
}: {
  tracks: Track[];
  onTrackPlay: (track: Track) => void;
  onOpenVoyo: (track: Track | null) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [isInView, setIsInView] = useState(false);
  const [sentinelState, setSentinelState] = useState<EndSentinelState>('hidden');
  const lastWatchedRef = useRef<Track | null>(null);

  // Track what the user was last looking at so Open VOYO can pick up there.
  useEffect(() => {
    if (tracks[activeIdx]) lastWatchedRef.current = tracks[activeIdx];
  }, [activeIdx, tracks]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.5 }
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // End-of-scroll detector — reveal the sentinel once the user has scrolled
  // past the last real card. Threshold of 48px = "almost at the end", which
  // feels natural (the CTA is already coming into view as you approach).
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 48;
    if (atEnd && sentinelState === 'hidden') {
      setSentinelState('cta');
    }
  }, [sentinelState]);

  // The "new video" the beam welcomes after Watch More: pick something the
  // user hasn't seen yet from the tail of the pool, fall back to the first
  // track if the pool is small.
  const nextVideo: Track | null = useMemo(() => {
    if (tracks.length > 12) return tracks[12];
    return tracks[0] || null;
  }, [tracks]);

  const handleWatchMore = useCallback(() => {
    setSentinelState('loading');
    // Golden beam sweep duration: 900ms feels premium, not rushed.
    setTimeout(() => setSentinelState('loaded'), 900);
  }, []);

  const handleOpenVoyo = useCallback(() => {
    onOpenVoyo(lastWatchedRef.current);
  }, [onOpenVoyo]);

  return (
    <div
      ref={containerRef}
      className="flex gap-4 overflow-x-auto scrollbar-hide py-3 pr-4"
      style={{ paddingLeft: '28px' }}
      onMouseLeave={() => setActiveIdx(0)}
      onScroll={handleScroll}
    >
      {tracks.slice(0, 12).map((track, idx) => (
        <div key={track.id} onMouseEnter={() => setActiveIdx(idx)}>
          <AfricanVibesVideoCard
            track={track}
            idx={idx}
            isActive={isInView && activeIdx === idx}
            onTrackPlay={() => onTrackPlay(track)}
          />
        </div>
      ))}

      {/* END-SCROLL SENTINEL — only visible after the user reaches the end */}
      {sentinelState !== 'hidden' && (
        <AfricanVibesEndSentinel
          state={sentinelState}
          nextVideo={nextVideo}
          onWatchMore={handleWatchMore}
          onOpenVoyo={handleOpenVoyo}
        />
      )}
    </div>
  );
};

// ============================================
// END-SCROLL SENTINEL — Watch More → golden beam → Open VOYO morph
// ============================================
const AfricanVibesEndSentinel = memo(({
  state,
  nextVideo,
  onWatchMore,
  onOpenVoyo,
}: {
  state: EndSentinelState;
  nextVideo: Track | null;
  onWatchMore: () => void;
  onOpenVoyo: () => void;
}) => {
  return (
    <div
      className="flex-shrink-0 relative rounded-xl overflow-hidden"
      style={{ width: '95px', height: '142px' }}
    >
      {/* Bronze ambient glow — matches the rest of the African Vibes cards */}
      <div
        className="absolute -inset-1 rounded-xl pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, rgba(212, 160, 83, 0.35) 0%, rgba(212, 160, 83, 0.12) 30%, transparent 60%)',
          filter: 'blur(8px)',
        }}
      />

      {/* STATE: 'cta' — golden "Watch More" button */}
      {state === 'cta' && (
        <button
          onClick={onWatchMore}
          className="relative w-full h-full rounded-xl overflow-hidden flex flex-col items-center justify-center"
          style={{
            background:
              'linear-gradient(180deg, rgba(212,160,83,0.18) 0%, rgba(196,148,61,0.10) 50%, rgba(10,10,12,0.95) 100%)',
            border: '1px solid rgba(212,160,83,0.35)',
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
            style={{
              background:
                'linear-gradient(135deg, #D4A053 0%, #C4943D 100%)',
              boxShadow: '0 0 16px rgba(212,160,83,0.5)',
            }}
          >
            <span className="text-black text-lg font-black">→</span>
          </div>
          <span className="text-[8px] font-bold uppercase tracking-wider text-[#D4A053]">
            Watch More
          </span>
          <span className="text-[7px] text-white/50 mt-0.5">from the continent</span>
        </button>
      )}

      {/* STATE: 'loading' — golden beam sweep welcomes the next video */}
      {state === 'loading' && (
        <div
          className="relative w-full h-full rounded-xl overflow-hidden"
          style={{ background: 'rgba(10,10,12,0.95)' }}
        >
          {/* Ambient bronze backdrop */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(135deg, rgba(212,160,83,0.15) 0%, rgba(10,10,12,0) 60%)',
            }}
          />
          {/* Golden beam sweep — traverses the tile diagonally */}
          <div
            className="absolute inset-0 golden-beam-sweep"
            style={{
              background:
                'linear-gradient(110deg, transparent 20%, rgba(212,160,83,0.15) 35%, rgba(244,204,130,0.9) 48%, rgba(255,230,170,1) 50%, rgba(244,204,130,0.9) 52%, rgba(212,160,83,0.15) 65%, transparent 80%)',
              backgroundSize: '220% 100%',
              mixBlendMode: 'screen',
            }}
          />
          {/* Subtle "loading" label */}
          <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
            <span className="text-[8px] font-semibold uppercase tracking-wider text-[#D4A053]/80">
              Loading...
            </span>
          </div>
        </div>
      )}

      {/* STATE: 'loaded' — new video thumbnail + purple Open VOYO CTA */}
      {state === 'loaded' && nextVideo && (
        <div
          className="relative w-full h-full rounded-xl overflow-hidden"
          style={{ background: 'rgba(10,10,12,0.95)' }}
        >
          <SmartImage
            src={getThumb(nextVideo.trackId, 'medium')}
            trackId={nextVideo.trackId}
            alt={nextVideo.title}
            artist={nextVideo.artist}
            title={nextVideo.title}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: 'scale(1.6)' }}
            lazy={false}
          />
          {/* Purple wash — signature VOYO brand */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgba(139,92,246,0.25) 0%, rgba(10,10,12,0.55) 55%, rgba(10,10,12,0.95) 100%)',
            }}
          />
          {/* Title */}
          <div className="absolute top-1.5 left-1.5 right-1.5 z-10">
            <p className="text-white text-[9px] font-bold truncate drop-shadow-sm">
              {nextVideo.title}
            </p>
          </div>
          {/* Open VOYO soft-premium button */}
          <button
            onClick={onOpenVoyo}
            className="absolute bottom-2 left-2 right-2 z-10 rounded-full py-1.5 flex items-center justify-center gap-1"
            style={{
              background:
                'linear-gradient(135deg, rgba(167,139,250,0.95) 0%, rgba(139,92,246,0.95) 50%, rgba(124,58,237,0.95) 100%)',
              boxShadow:
                '0 4px 12px rgba(139,92,246,0.4), inset 0 1px 0 rgba(255,255,255,0.25)',
              border: '1px solid rgba(196,181,253,0.4)',
            }}
          >
            <span className="text-white text-[8px] font-bold uppercase tracking-wider">
              Open VOYO
            </span>
            <span className="text-white text-[9px]">→</span>
          </button>
        </div>
      )}
    </div>
  );
});

// ============================================
// VIBE CARD COMPONENT
// ============================================

interface VibeCardProps {
  vibe: Vibe;
  onSelect: () => void;
}

// Premium vibe card (April 2026): Heating Up RN is the only card that
// keeps a lottie (fire) and the luxury bronze shade. Every other card
// drops its icon for a big, fat, deep-purple-on-purple title that reads
// as embossed artwork — matching shades, low contrast, premium.
const VibeCard = memo(({ vibe, onSelect }: VibeCardProps) => {
  const isHero = vibe.id === 'afro-heat';
  const cardRef = useRef<HTMLDivElement>(null);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number }[]>([]);

  // Darker shade of the vibe color for the embossed title. For the hero
  // card we go deeper into the bronze; for the purple cards we drop into
  // a near-black violet so the title reads as "faded dark bold fat".
  const titleShade = isHero ? '#7a3a00' : '#1a0f2e';
  const titleGlow = isHero ? 'rgba(244,162,62,0.35)' : 'rgba(0,0,0,0.35)';

  // Hero card: tap spawns small fire sparks at touch position
  const handleTouch = useCallback((e: React.PointerEvent) => {
    if (!isHero || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();
    setSparks(prev => [...prev.slice(-4), { id, x, y }]); // max 5 at once
    setTimeout(() => setSparks(prev => prev.filter(s => s.id !== id)), 700);
  }, [isHero]);

  return (
    <button
      className="flex-shrink-0 relative group"
      onClick={onSelect}
      style={{ width: '120px' }}
    >
      <div
        className="absolute -inset-[3px] rounded-[24px]"
        style={{
          background: `conic-gradient(from 0deg, ${vibe.color}, ${vibe.color}44, ${vibe.color})`,
          filter: 'blur(8px)',
          opacity: isHero ? 1 : 0.55,
        }}
      />
      <div
        ref={cardRef}
        className="relative rounded-[22px] overflow-hidden"
        onPointerDown={handleTouch}
        style={{
          aspectRatio: '0.9',
          background: `linear-gradient(135deg, ${vibe.color} 0%, ${vibe.color}dd 50%, ${vibe.color}bb 100%)`,
          boxShadow: `0 6px 24px ${vibe.color}50`,
        }}
      >
        {/* Subtle grain */}
        <div className="absolute inset-0 opacity-[0.15]" style={{
          backgroundImage: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.6) 0.5px, transparent 1px)`,
          backgroundSize: '6px 6px',
        }} />
        {/* Soft top-left highlight */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(130deg, rgba(255,255,255,0.3) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.15) 100%)',
        }} />

        {/* Embossed big title — hero card: clean canvas (no title), others keep it */}
        {!isHero && (
          <div
            className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none select-none"
          >
            <h3
              className="font-black text-center leading-[0.85] tracking-tight"
              style={{
                fontSize: vibe.name.length > 8 ? '22px' : '28px',
                color: titleShade,
                textShadow: `0 1px 0 ${titleGlow}, 0 2px 8px rgba(0,0,0,0.25)`,
                opacity: 0.55,
                letterSpacing: '-0.02em',
              }}
            >
              {vibe.name}
            </h3>
          </div>
        )}

        {/* Hero: scattered small fires — ambient, not heavy */}
        {isHero && (
          <>
            <div className="absolute top-2 right-2 pointer-events-none" style={{ fontSize: 18, animation: 'voyo-lottie-pulse 2s ease-in-out infinite' }}>🔥</div>
            <div className="absolute bottom-6 left-2.5 pointer-events-none" style={{ fontSize: 12, opacity: 0.6, animation: 'voyo-lottie-pulse 2.5s ease-in-out infinite 0.4s' }}>🔥</div>
            <div className="absolute top-1/3 left-1/2 pointer-events-none" style={{ fontSize: 10, opacity: 0.35, animation: 'voyo-lottie-pulse 3s ease-in-out infinite 0.8s' }}>🔥</div>
          </>
        )}

        {/* Touch sparks — small fires bloom at tap position and fade out */}
        {sparks.map(s => (
          <span
            key={s.id}
            className="absolute pointer-events-none"
            style={{
              left: s.x - 8,
              top: s.y - 8,
              fontSize: 16,
              animation: 'voyo-fire-spark 0.7s ease-out forwards',
            }}
          >🔥</span>
        ))}

        {/* Description at the bottom, muted */}
        <div className="absolute left-0 right-0 bottom-2 text-center px-2">
          <p className="text-white/75 text-[9px] font-medium drop-shadow-sm">{vibe.description}</p>
        </div>

        {/* Bottom highlight line */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{
          background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.5) 50%, transparent 95%)',
        }} />
      </div>
    </button>
  );
});

// ============================================
// HOME FEED COMPONENT
// ============================================

interface HomeFeedProps {
  onTrackPlay: (track: Track, options?: { openFull?: boolean }) => void;
  onSearch: () => void;
  onDahub: () => void;
  onNavVisibilityChange?: (visible: boolean) => void;
  onSwitchToVOYO?: () => void;
}

export const HomeFeed = ({ onTrackPlay, onSearch, onDahub, onNavVisibilityChange, onSwitchToVOYO }: HomeFeedProps) => {
  // Battery fix: fine-grained selectors
  const history = usePlayerStore(s => s.history);
  const hotTracks = usePlayerStore(s => s.hotTracks);
  const discoverTracks = usePlayerStore(s => s.discoverTracks);
  const refreshRecommendations = usePlayerStore(s => s.refreshRecommendations);
  const hotPool = useTrackPoolStore(s => s.hotPool);
  const cachedTracks = useDownloadStore(s => s.cachedTracks);
  // Set of boosted track IDs — OYE badge only shows on actually cached tracks
  const boostedIds = useMemo(() => new Set(cachedTracks.map(t => t.id)), [cachedTracks]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNotificationHint, setShowNotificationHint] = useState(false);
  // Session seed drives shelf rotation — every reload / pull-to-refresh gets
  // a fresh number, so shelves surface different tracks from the big pool
  // without losing stability WITHIN a single session.
  const [sessionSeed, setSessionSeed] = useState(() => Date.now());

  // Stations — curator-led vibe hubs, shown as a horizontal snap-scroll rail
  // above the shelves. Rail animates parallax on scroll when >1 station.
  const [stations, setStations] = useState<Station[]>([]);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('voyo_stations')
        .select('*')
        .eq('is_featured', true)
        .not('hero_r2_key', 'is', null)
        .order('sort_order', { ascending: true });
      if (!cancelled && data) setStations(data as Station[]);
    })();
    return () => { cancelled = true; };
  }, []);

  // Ref for TIVI+ immersive section (nav hides when in view)
  const tiviBreakRef = useRef<HTMLDivElement>(null);

  // Track when TIVI+ "Take a Break" section is in view
  useEffect(() => {
    if (!onNavVisibilityChange) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const isInView = entries[0]?.isIntersecting ?? false;
        onNavVisibilityChange(!isInView); // Hide nav when TIVI+ banner is in view
      },
      { threshold: 0, rootMargin: '0px 0px -300px 0px' } // Trigger extra early
    );

    if (tiviBreakRef.current) observer.observe(tiviBreakRef.current);

    return () => observer.disconnect();
  }, [onNavVisibilityChange]);

  useEffect(() => {
    refreshRecommendations();
  }, [hotPool.length, refreshRecommendations]);

  // Session prewarm: fill pool trending/west-african/classics sections on Home mount.
  // These feed the freshness tier in Hot and the Discovery pool.
  // Portrait player is warm by the time user taps play — same pool, shared session.
  useEffect(() => {
    curateAllSections().catch(() => {});
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    refreshRecommendations();
    // Bump the session seed so every shelf re-shuffles its pick from the pool.
    setSessionSeed(Date.now());
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleNotificationClick = () => {
    setShowNotificationHint(true);
    setTimeout(() => setShowNotificationHint(false), 2500);
  };

  // Data from existing DJ/Curator systems (pool-based)
  const recentlyPlayed = useMemo(() => getRecentlyPlayed(history, 15), [history]);
  const heavyRotation = useMemo(() => getUserTopTracks(15), [history]);
  const artistsYouLove = useMemo(() => getArtistsYouLove(history, hotPool, 8), [history, hotPool]);
  const vibes = VIBES;

  // Get user preferences for personalized scoring (still used by tag-rows)
  const trackPreferences = usePreferenceStore((state) => state.trackPreferences);

  // Unified pools — hot + discovery, fetched once via oyo facade. Each
  // already behavior-reranked + session-shuffled inside the pool loader.
  const pools = usePools(sessionSeed);

  // Keep Expanding Horizons = top slice of the discovery stream.
  // (Was 25 lines of inline fallbacks; now the pool does the lifting.)
  const discoverMoreTracks = useMemo(
    () => pools.discovery.slice(0, 15),
    [pools.discovery],
  );

  // OYO's Picks = hot stream with favorite-artist bubble + de-dup vs the
  // row above. Compact because pools.hot already did the behavior rerank.
  const oyosPicks = useMemo(() => {
    const favs = new Set(
      getOyoInsights().favoriteArtists.map(a => a.toLowerCase()),
    );
    const usedIds = new Set(discoverMoreTracks.map(t => t.id));
    const filtered = pools.hot.filter(t => !usedIds.has(t.id));
    // Favorite-artist tracks float to top, rest hold their existing order.
    return [
      ...filtered.filter(t => favs.has((t.artist ?? '').toLowerCase())),
      ...filtered.filter(t => !favs.has((t.artist ?? '').toLowerCase())),
    ].slice(0, 15);
  }, [pools.hot, discoverMoreTracks]);

  // African Vibes: West African tags + user's afro-heat preference weighting
  const africanVibes = useMemo(() => {
    // Pull a WIDER candidate pool (60) from the curator tag so the shelf can
    // rotate through more of the West African catalogue across sessions.
    const curated = getWestAfricanTracks(hotPool, 60);
    if (curated.length >= 5) {
      // Score by user's engagement with these tracks
      const scored = curated.map(track => ({
        track,
        score: calculateBehaviorScore(track, trackPreferences)
      }));
      scored.sort((a, b) => b.score - a.score);
      // Top 30 by behavior, then seed-shuffle for fresh rotation every reload.
      const topBand = scored.map(s => s.track).slice(0, 30);
      return seededShuffle(topBand, sessionSeed).slice(0, 15);
    }
    // Fallback: Get tracks user has engaged with that have afro vibes
    const afroPool = hotPool.filter((t: any) =>
      t.detectedMode === 'afro-heat' || t.tags?.some((tag: string) =>
        ['afrobeats', 'afro', 'african', 'lagos', 'naija'].includes(tag.toLowerCase())
      )
    );
    if (afroPool.length >= 5) {
      return seededShuffle(afroPool as Track[], sessionSeed).slice(0, 15);
    }
    return seededShuffle(getPoolAwareHotTracks(45), sessionSeed).slice(0, 15);
  }, [hotPool, trackPreferences, sessionSeed]);

  // REMOVED: westAfricanTracks alias - africanVibes is now distinct

  const classicsTracks = useMemo(() => {
    // Pull a wider heritage slate (45) then seed-shuffle so the classics shelf
    // rotates through different oldies every reload instead of the same 15.
    const curated = getClassicsTracks(hotPool, 45);
    if (curated.length < 5) return [];
    return seededShuffle(curated, sessionSeed).slice(0, 15);
  }, [hotPool, sessionSeed]);

  // Top 10 on VOYO: Trending tracks, excluding what's in other shelves.
  const trending = useMemo(() => {
    const usedIds = new Set([
      ...oyosPicks.map(t => t.id),
      ...discoverMoreTracks.map(t => t.id),
      ...africanVibes.map(t => t.id),
    ]);
    const curated = getCuratedTrendingTracks(hotPool, 50);
    const available = curated.filter(t => !usedIds.has(t.id));
    if (available.length >= 5) {
      return seededShuffle(available, sessionSeed).slice(0, 10);
    }
    const fallback = getTrendingTracks(hotPool, 50).filter(t => !usedIds.has(t.id));
    return seededShuffle(fallback, sessionSeed).slice(0, 10);
  }, [hotPool, oyosPicks, discoverMoreTracks, africanVibes, sessionSeed]);

  const greeting = getGreeting();

  const handleVibeSelect = (vibe: Vibe) => {
    // Central orchestrator picks the pool, plays the top, enqueues the rest.
    // Falls back to generic hot tracks if that vibe's slice is empty.
    app.playFromVibe(vibe.id);
    // If playFromVibe found nothing, fall back so the user isn't stranded.
    const still = usePlayerStore.getState().currentTrack;
    if (!still || still.trackId !== usePlayerStore.getState().currentTrack?.trackId) {
      const fallback = getPoolAwareHotTracks(10);
      if (fallback.length > 0) app.playTrack(fallback[0], 'vibe');
    }
  };

  const hasHistory = recentlyPlayed.length > 0;
  const hasPreferences = heavyRotation.length > 0;
  const hasArtists = artistsYouLove.length > 0;
  const hasTrending = trending.length > 0;
  const hasDiscoverMore = discoverMoreTracks.length > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-52 scrollbar-hide">
      {/* Header — fully transparent, floats over the continuous canvas (April 2026) */}
      <header className="flex items-center justify-between px-4 py-3 sticky top-0 bg-transparent z-10">
        <button
          className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white font-bold"
          onClick={onDahub}
        >
          D
        </button>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-full bg-white/10 hover:bg-white/20" onClick={onSearch}>
            <Search className="w-5 h-5 text-white/70" />
          </button>
          <button className="p-2 rounded-full bg-white/10 hover:bg-white/20 relative" onClick={handleNotificationClick}>
            <Bell className="w-5 h-5 text-white/70" />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
          </button>
        </div>
      </header>

      {/* Notification Hint Popup */}
      
        {showNotificationHint && (
          <div
            className="fixed top-20 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.95) 0%, rgba(236, 72, 153, 0.95) 100%)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 32px rgba(168, 85, 247, 0.4)',
            }}
          >
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-white" />
              <p className="text-white text-sm font-medium">No new notifications</p>
            </div>
          </div>
        )}
      

      {/* Greeting */}
      <div className="px-4 pt-4 pb-6">
        <h1 className="text-2xl font-bold text-white">{greeting}, Dash</h1>
      </div>

      {/* Stations rail — curator-led hubs anchored by a DJ mix.
          Horizontal snap-scroll. Cards autoplay muted portrait; 7s dwell
          fades audio in (iOS = tap cue); tap commits to deck + R2 audio. */}
      {stations.length > 0 && (
        <div className="mb-8 -mx-1">
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 pb-2">
            {stations.map((station) => (
              <div
                key={station.id}
                className="snap-center flex-shrink-0 w-[82vw] max-w-[420px]"
              >
                <StationHero station={station} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VoyoLiveCard - "Vibes on Vibes" → Opens VOYO Player */}
      <SignInPrompt onSwitchToVOYO={onSwitchToVOYO} />

      {/* Back in the Mood — always show OYE badge, brighter if boosted */}
      {hasHistory && (
        <ShelfWithRefresh title="Back in the Mood" onRefresh={handleRefresh} isRefreshing={isRefreshing}>
          {recentlyPlayed.slice(0, 12).map((track) => (
            <WideTrackCard key={track.id} track={track} onPlay={() => onTrackPlay(track)} showBoostBadge isBoosted={boostedIds.has(track.trackId)} />
          ))}
        </ShelfWithRefresh>
      )}

      {/* Heavy Rotation - circles, only first one rotates gently */}
      {hasPreferences && (
        <div className="mb-10">
          <div className="px-4 mb-4">
            <h2 className="text-white font-semibold text-base">Heavy Rotation</h2>
          </div>
          <div className="flex gap-5 px-4 overflow-x-auto scrollbar-hide">
            {heavyRotation.slice(0, 12).map((track, index) => {
              const isFirst = index === 0;
              return (
                <button
                  key={track.id}
                  className="flex-shrink-0 w-32"
                  onClick={() => onTrackPlay(track)}
                >
                  <div
                    className="relative w-32 h-32 rounded-full overflow-hidden mb-2 bg-white/5 mx-auto shadow-lg shadow-black/40"
                  >
                    <SmartImage
                      src={getThumb(track.trackId, 'high')}
                      trackId={track.trackId}
                      alt={track.title}
                      artist={track.artist}
                      title={track.title}
                      className="w-full h-full object-cover"
                      style={{ objectPosition: 'center 35%', transform: 'scale(1.3)' }}
                      lazy={false}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                  </div>
                  <p className="text-white text-sm font-medium truncate text-center mt-1">{track.title.split('|')[0].trim()}</p>
                  <p className="text-white/50 text-xs truncate text-center">{track.artist}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 🌍 African Vibes - cultural pillar, holds its ground.
          Watch More moved OFF the header (Apr 2026): it now only appears at the
          end of the carousel after scrolling, with a golden-beam reveal and a
          purple Open VOYO morph. Header stays clean, CTA earns the scroll. */}
      <div className="mb-6">
        <div className="px-4 mb-5 flex items-center gap-3">
          <AfricaIcon size={32} />
          <div className="flex-1">
            <h2 className="text-white font-semibold text-base">OYÉ Africa</h2>
            <p
              className="text-[9px] font-medium tracking-wider uppercase"
              style={{
                background: 'linear-gradient(90deg, #D4A053 0%, #C4943D 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                opacity: 0.85,
              }}
            >
              From Lagos to Johannesburg
            </p>
          </div>
        </div>
        <div className="relative">
          {/* TRENDING - Contour style */}
          <div className="absolute left-1 top-0 bottom-0 flex items-center pointer-events-none" style={{ width: '24px' }}>
            <span
              className="text-[9px] font-black tracking-wider"
              style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                letterSpacing: '0.15em',
                color: 'transparent',
                WebkitTextStroke: '0.5px rgba(212, 160, 83, 0.7)',
                textShadow: '0 0 8px rgba(212, 160, 83, 0.15)',
              }}
            >
              TRENDING
            </span>
          </div>
          <AfricanVibesCarousel
            tracks={africanVibes.slice(0, 15)}
            onTrackPlay={(track) => onTrackPlay(track, { openFull: true })}
            onOpenVoyo={(lastWatched) => {
              // Stash the last-watched video ID so VoyoMoments can pick
              // up on it (future hook-in; for now we just switch tabs).
              if (lastWatched?.trackId) {
                try {
                  sessionStorage.setItem('voyo-moments-start-video', lastWatched.trackId);
                } catch {}
              }
              usePlayerStore.getState().setVoyoTab('feed');
              onSwitchToVOYO?.();
            }}
          />
        </div>
      </div>

      {/* Your Artist Radar — individuality with breathing room */}
      {hasArtists && (
        <div className="mb-10">
          <div className="px-4 mb-5">
            <h2 className="text-white font-semibold text-base">Your Artist Radar</h2>
          </div>
          <div className="flex gap-6 px-4 overflow-x-auto scrollbar-hide">
            {artistsYouLove.map((artist) => (
              <ArtistCard key={artist.name} artist={artist} onPlay={onTrackPlay} />
            ))}
          </div>
        </div>
      )}

      {/* Keep Expanding Horizons — LLM curated expansion beyond comfort zone */}
      {hasDiscoverMore && (
        <ShelfWithRefresh title="Keep Expanding Horizons" onRefresh={handleRefresh} isRefreshing={isRefreshing}>
          {discoverMoreTracks.slice(0, 12).map((track) => (
            <TrackCard key={track.id} track={track} onPlay={() => onTrackPlay(track, { openFull: true })} />
          ))}
        </ShelfWithRefresh>
      )}

      {/* Classics - Timeless African music (from poolCurator) → COMMUNAL */}
      {classicsTracks.length > 0 && (
        <div
          className="mb-10 pt-14 pb-10 relative overflow-hidden"
          style={{
            background:
              'radial-gradient(ellipse 120% 80% at 30% 0%, rgba(212,160,83,0.16) 0%, rgba(212,160,83,0.06) 40%, transparent 75%)',
          }}
        >
          {/* Top thin gold foil line */}
          <div
            className="absolute top-0 left-8 right-8 h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(212,160,83,0.4), rgba(230,184,101,0.75), rgba(212,160,83,0.4), transparent)',
            }}
          />
          {/* Bottom thin gold foil line */}
          <div
            className="absolute bottom-0 left-8 right-8 h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(212,160,83,0.25), rgba(230,184,101,0.5), rgba(212,160,83,0.25), transparent)',
            }}
          />

          {/* Vertical contour label — mirrors African Vibes "TRENDING" style */}
          <div
            className="absolute right-1 top-16 bottom-16 flex items-center pointer-events-none"
            style={{ width: '22px' }}
          >
            <span
              className="text-[8px] font-black tracking-[0.3em]"
              style={{
                writingMode: 'vertical-rl',
                color: 'transparent',
                WebkitTextStroke: '0.5px rgba(212, 160, 83, 0.65)',
                textShadow: '0 0 8px rgba(212, 160, 83, 0.15)',
              }}
            >
              TIMELESS
            </span>
          </div>

          {/* Header — proper premium hierarchy: eyebrow → script → flourish → subtitle */}
          <div className="px-6 mb-8 relative">
            {/* Eyebrow label */}
            <div
              className="text-[9px] font-bold tracking-[0.3em] uppercase mb-1"
              style={{ color: 'rgba(212, 160, 83, 0.75)' }}
            >
              Collection
            </div>

            {/* Italianno script — the heart */}
            <h2
              className="leading-none"
              style={{
                fontFamily: "'Italianno', cursive",
                fontSize: 'clamp(72px, 22vw, 96px)',
                fontWeight: 400,
                margin: '0 0 4px 0',
                background:
                  'linear-gradient(135deg, #FFF3D6 0%, #F4D999 15%, #E6B865 35%, #D4A053 55%, #C4943D 75%, #8B6228 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter:
                  'drop-shadow(0 2px 6px rgba(0,0,0,0.7)) drop-shadow(0 0 24px rgba(212,160,83,0.3))',
                letterSpacing: '0.005em',
              }}
            >
              Classics
            </h2>

            {/* Signature flourish — longer, curved feel */}
            <div className="flex items-center gap-2 ml-1">
              <div
                className="h-[1px]"
                style={{
                  width: '120px',
                  background:
                    'linear-gradient(90deg, rgba(230,184,101,1) 0%, rgba(212,160,83,0.7) 40%, rgba(212,160,83,0.2) 80%, transparent)',
                }}
              />
              <div
                className="w-1 h-1 rounded-full"
                style={{ background: '#D4A053', boxShadow: '0 0 6px rgba(212,160,83,0.7)' }}
              />
            </div>

            {/* Subtitle — below, breathing */}
            <p className="text-[10px] font-medium tracking-[0.25em] uppercase text-white/35 mt-3 ml-1">
              Timeless African Sounds
            </p>
          </div>

          <div className="flex gap-4 px-4 overflow-x-auto scrollbar-hide">
            {classicsTracks.slice(0, 12).map((track) => (
              <TrackCard key={track.id} track={track} onPlay={() => onTrackPlay(track, { openFull: true })} />
            ))}
          </div>
        </div>
      )}

      {/* Top 10 on VOYO */}
      {hasTrending && (
        <div className="mb-8 py-8 relative" style={{ background: 'linear-gradient(180deg, rgba(6,6,9,1) 0%, rgba(139,92,246,0.08) 15%, rgba(139,92,246,0.06) 50%, rgba(139,92,246,0.12) 85%, rgba(6,6,9,0.95) 100%)' }}>
          {/* Top edge fade */}
          <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-[#060609] to-transparent pointer-events-none z-10" />
          {/* Bottom edge fade — purple-tinted */}
          <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none z-10" style={{ background: 'linear-gradient(to bottom, transparent, rgba(139,92,246,0.15))' }} />
          <div className="px-4 mb-6">
            <h2 className="text-white font-semibold text-base">Top 10 on VOYO</h2>
          </div>
          <style>{`
            @keyframes top10-marquee {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .top10-scroll-title {
              display: inline-block;
              animation: top10-marquee 6s linear infinite;
            }
          `}</style>
          <div className="flex gap-6 px-4 overflow-x-auto scrollbar-hide" style={{ scrollSnapType: 'x proximity', paddingBottom: '60px' }}>
            {trending.slice(0, 10).map((track, index) => {
              const maxChars = 12;
              const titleNeedsScroll = track.title.length > maxChars;
              const artistNeedsScroll = track.artist.length > maxChars;
              const isPodium = index < 3;
              const numberFill = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : 'transparent';
              const numberStroke = index === 0 ? '#B8860B' : index === 1 ? '#808080' : index === 2 ? '#8B4513' : '#9D4EDD';
              const strokeWidth = isPodium ? '2px' : '3px';
              const numberGlow = index === 0 ? '0 0 30px rgba(255, 215, 0, 0.5)' : index === 1 ? '0 0 20px rgba(192, 192, 192, 0.4)' : index === 2 ? '0 0 20px rgba(205, 127, 50, 0.4)' : '0 0 25px rgba(157, 78, 221, 0.5), 3px 3px 0 rgba(0,0,0,0.6)';

              return (
                <button
                  key={track.id}
                  className="flex-shrink-0 flex items-end relative"
                  onClick={() => onTrackPlay(track, { openFull: true })}
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <div
                    className="font-black select-none self-center"
                    style={{
                      fontSize: index < 9 ? '5.5rem' : '4.5rem',
                      lineHeight: '1',
                      marginRight: '-22px',
                      zIndex: 1,
                      color: numberFill,
                      WebkitTextStroke: `${strokeWidth} ${numberStroke}`,
                      textShadow: numberGlow,
                      fontFamily: 'Arial Black, sans-serif',
                    }}
                  >
                    {index + 1}
                  </div>
                  <div className="relative" style={{ zIndex: 2 }}>
                    <div className="absolute -inset-2 rounded-full opacity-40" style={{
                      background: 'radial-gradient(circle, rgba(157,78,221,0.5) 0%, transparent 70%)',
                      filter: 'blur(8px)',
                    }} />
                    <div className="relative rounded-full overflow-hidden" style={{ width: '85px', height: '85px', boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 20px rgba(157,78,221,0.2)' }}>
                      <SmartImage
                        src={getThumb(track.trackId)}
                        alt={track.title}
                        className="w-full h-full object-cover"
                        style={{ transform: 'scale(1.3)', objectPosition: 'center 35%' }}
                        trackId={track.trackId}
                        artist={track.artist}
                        title={track.title}
                      />
                      <div className="absolute inset-0 rounded-full" style={{
                        background: 'radial-gradient(circle, transparent 28%, rgba(0,0,0,0.3) 48%, transparent 52%, rgba(0,0,0,0.2) 100%)',
                        boxShadow: 'inset 0 0 15px rgba(0,0,0,0.5)',
                      }} />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0a0a0c]" style={{ width: '10px', height: '10px', boxShadow: '0 0 5px rgba(0,0,0,0.8)' }} />
                    </div>
                  </div>
                  <div className="absolute text-center" style={{ width: '110px', left: '50%', transform: 'translateX(-50%)', bottom: '-52px' }}>
                    <div className="overflow-hidden mx-auto" style={{ width: '100px' }}>
                      <p className={`text-white text-[10px] font-semibold whitespace-nowrap ${titleNeedsScroll ? 'top10-scroll-title' : ''}`}>
                        {titleNeedsScroll ? <>{track.title}<span className="mx-3">•</span>{track.title}<span className="mx-3">•</span></> : track.title}
                      </p>
                    </div>
                    <div className="overflow-hidden mx-auto" style={{ width: '100px' }}>
                      <p className={`text-white/50 text-[9px] whitespace-nowrap ${artistNeedsScroll ? 'top10-scroll-title' : ''}`} style={{ animationDelay: '1s' }}>
                        {artistNeedsScroll ? <>{track.artist}<span className="mx-3">•</span>{track.artist}<span className="mx-3">•</span></> : track.artist}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-0.5 mt-0.5">
                      {index < 3 ? (
                        <>
                          <Zap className="w-2.5 h-2.5" style={{ color: '#D4A053', fill: '#D4A053', filter: 'drop-shadow(0 0 3px rgba(212,160,83,0.5))' }} />
                          <span className="text-[8px] font-bold" style={{ color: '#D4A053' }}>
                            {track.oyeScore ? (track.oyeScore / 1000).toFixed(0) + 'K' : Math.round((10 - index) * 1.2) + 'K'}
                          </span>
                        </>
                      ) : (
                        <span className="text-[8px] font-bold" style={{ color: '#D4A053' }}>
                          OYE {track.oyeScore ? (track.oyeScore / 1000).toFixed(0) + 'K' : Math.round((10 - index) * 1.2) + 'K'}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Vibes - choices, not playlist */}
      <div className="mb-12">
        <div className="px-4 mb-1.5">
          <h2 className="text-white font-semibold text-base">Vibes</h2>
        </div>
        <div className="flex gap-4 px-4 overflow-x-auto scrollbar-hide py-4">
          {vibes.map((vibe) => (
            <VibeCard key={vibe.id} vibe={vibe} onSelect={() => handleVibeSelect(vibe)} />
          ))}
        </div>
      </div>

      {/* TIVI+ moved to DaHub */}

      {/* OYO's Picks — OYO-curated surface, the app's voice in the feed */}
      <div className="mb-12">
        <div className="px-4 mb-5 flex items-center gap-2">
          <h2 className="text-white font-semibold text-base">OYO's Picks</h2>
          <div className="h-[2px] w-6 rounded-full" style={{ background: '#8b5cf6', opacity: 0.6 }} />
        </div>
        <CenterFocusedCarousel tracks={oyosPicks} onPlay={(track) => onTrackPlay(track)} />
      </div>

      {/* Empty State */}
      {!hasHistory && !hasPreferences && (
        <div className="px-4 py-8 text-center">
          <p className="text-white/50 text-sm mb-4">Start listening to build your personalized collection</p>
          <button
            className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-violet-600 text-white font-bold"
            onClick={() => {
              // Pool-aware: Use dynamic pool
              const poolTracks = hotPool.length > 0 ? hotPool : getPoolAwareHotTracks(15);
              const randomTrack = poolTracks[0];
              if (randomTrack) onTrackPlay(randomTrack);
            }}
          >
            Discover Music
          </button>
        </div>
      )}
    </div>
  );
};

export default HomeFeed;
