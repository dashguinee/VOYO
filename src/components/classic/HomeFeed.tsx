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
import { devWarn } from '../../utils/logger';
import { Search, Play, Zap } from 'lucide-react';
import { AfricaIcon } from '../ui/AfricaIcon';
import { getThumb } from '../../utils/thumbnail';
import { SmartImage } from '../ui/SmartImage';
import { Safe } from '../ui/Safe';
import { TrackCardGestures } from '../ui/TrackCardGestures';
import { GreetingArea } from './GreetingArea';
import { VIBES, Vibe, TRACKS } from '../../data/tracks';
import { VibesReel } from './VibesReel';
import { getUserTopTracks, getPoolAwareHotTracks, getPoolAwareDiscoveryTracks, calculateBehaviorScore, recordPoolEngagement } from '../../services/personalization';
import { curateAllSections } from '../../services/poolCurator';
import type { PooledTrack } from '../../store/trackPoolStore';
import type { HistoryItem } from '../../types';
import { getInsights as getOyoInsights } from '../../services/oyoDJ';
import { usePools, app } from '../../services/oyo';
import { usePreferenceStore } from '../../store/preferenceStore';
import { usePlayerStore } from '../../store/playerStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { useDownloadStore } from '../../store/downloadStore';
import { OyeButton } from '../oye/OyeButton';
import { Track } from '../../types';
// TiviPlusCrossPromo moved to DaHub
import { SignInPrompt } from '../social/SignInPrompt';
import { StationHero, type Station } from './StationHero';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useBackGuard } from '../../hooks/useBackGuard';
import { friendsAPI, type Friend } from '../../lib/voyo-api';
import { VoyoLoadOrb } from '../voyo/VoyoLoadOrb';
import { useNavigate } from 'react-router-dom';
import { PlaylistModal } from '../playlist/PlaylistModal';
import { CardHoldActions } from '../ui/CardHoldActions';

// ============================================
// HELPER FUNCTIONS
// ============================================

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
const getArtistsYouLove = (history: HistoryItem[], pool: Track[], limit: number = 8): { name: string; tracks: Track[]; playCount: number }[] => {
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

const getTrendingTracks = (hotPool: PooledTrack[], limit: number = 15): Track[] => {
  return [...hotPool]
    .sort((a, b) => b.poolScore - a.poolScore)
    .slice(0, limit) as Track[];
};

// Section-filtered helpers (use curator tags from poolCurator)
const getWestAfricanTracks = (hotPool: PooledTrack[], limit: number = 15): Track[] => {
  return [...hotPool]
    .filter(t => t.tags?.includes('west-african'))
    .sort((a, b) => (b.poolScore || 0) - (a.poolScore || 0))
    .slice(0, limit) as Track[];
};

const getClassicsTracks = (hotPool: PooledTrack[], limit: number = 15): Track[] => {
  return [...hotPool]
    .filter(t => t.tags?.includes('classic'))
    .sort((a, b) => (b.poolScore || 0) - (a.poolScore || 0))
    .slice(0, limit) as Track[];
};

const getCuratedTrendingTracks = (hotPool: PooledTrack[], limit: number = 15): Track[] => {
  return [...hotPool]
    .filter(t => t.tags?.includes('trending'))
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

const getRecentlyPlayed = (history: HistoryItem[], limit: number = 10): Track[] => {
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
  // Right-end "Discover more" pill turns into a tappable affordance
  // when this callback is provided. Leaves the pill non-interactive
  // if the callsite doesn't wire it (backwards-compatible).
  onDiscover?: () => void;
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

const CARD_W = 130;
const CARD_GAP = 12;

const CenterFocusedCarousel = ({ tracks, onPlay, onDiscover }: CenterCarouselProps) => {
  // Defensive: empty or malformed tracks → render nothing, never crash.
  // Memoised so array identity is stable across renders that don't touch
  // the source, avoiding downstream re-renders.
  const safeTracks = useMemo(
    () => (Array.isArray(tracks) ? tracks.filter(t => t && t.id) : []),
    [tracks],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [centerIndex, setCenterIndex] = useState(0);
  const [scrollState, setScrollState] = useState<'left-end' | 'scrolling' | 'right-end'>('left-end');
  // rAF-throttle + cached last-values so we only fire setState when the
  // computed bucket actually changed. Previously firing at ~60fps during
  // scroll = re-render storm on the entire carousel.
  const scrollRafRef = useRef<number | null>(null);
  const lastIndexRef = useRef(0);
  const lastStateRef = useRef<'left-end' | 'scrolling' | 'right-end'>('left-end');

  const handleScroll = () => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = scrollRef.current;
      if (!container) return;
      const { scrollLeft, scrollWidth, clientWidth } = container;
      const step = CARD_W + CARD_GAP;
      const maxIndex = Math.max(0, safeTracks.length - 1);
      const newIndex = Math.min(Math.max(Math.round(scrollLeft / step), 0), maxIndex);
      if (newIndex !== lastIndexRef.current) {
        lastIndexRef.current = newIndex;
        setCenterIndex(newIndex);
      }
      const maxScroll = scrollWidth - clientWidth;
      const nextState: 'left-end' | 'scrolling' | 'right-end' =
        scrollLeft < 40 ? 'left-end'
          : scrollLeft > maxScroll - 40 ? 'right-end'
          : 'scrolling';
      if (nextState !== lastStateRef.current) {
        lastStateRef.current = nextState;
        setScrollState(nextState);
      }
    });
  };
  useEffect(() => () => {
    if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

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
            className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 ${onDiscover ? 'pointer-events-auto' : 'pointer-events-none'}`}
          >
            {/* Glass pill — Giraf's Activity-page duration-pill recipe
                retuned to VOYO's purple accent. Tappable when the parent
                wires onDiscover (opens the search overlay on OYO's Picks
                so the user has somewhere to go after hitting the rail's
                right-end), otherwise stays a passive visual cue. */}
            {onDiscover ? (
              <button
                type="button"
                onClick={onDiscover}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-wide whitespace-nowrap voyo-tap-scale voyo-hover-scale"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(196,181,253,0.20)',
                  color: 'rgba(196,181,253,0.92)',
                  backdropFilter: 'blur(10px) saturate(130%)',
                  WebkitBackdropFilter: 'blur(10px) saturate(130%)',
                  boxShadow: '0 6px 18px -6px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
                aria-label="Discover more — open search"
              >
                Discover more
                <span aria-hidden="true" className="opacity-70">→</span>
              </button>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-wide whitespace-nowrap"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(196,181,253,0.20)',
                  color: 'rgba(196,181,253,0.92)',
                  backdropFilter: 'blur(10px) saturate(130%)',
                  WebkitBackdropFilter: 'blur(10px) saturate(130%)',
                  boxShadow: '0 6px 18px -6px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
              >
                Discover more
                <span aria-hidden="true" className="opacity-70">→</span>
              </span>
            )}
          </div>
        )}
      
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide py-2"
        style={{
          // proximity (not mandatory) — browser can assist snap without
          // fighting the user's horizontal swipe. Combined with snap-
          // align on the DIRECT flex child below, this is what finally
          // lets OYO's Picks scroll on iOS/Android.
          scrollSnapType: 'x proximity',
          paddingLeft: `calc(50% - ${CARD_W / 2}px)`, // center first card
          paddingRight: `calc(50% - ${CARD_W / 2}px)`,
          WebkitOverflowScrolling: 'touch',
        }}
        onScroll={handleScroll}
      >
        {safeTracks.map((track, index) => {
          const isCenter = index === centerIndex;
          const distance = Math.abs(index - centerIndex);
          const scale = isCenter ? 1 : Math.max(0.75, 1 - distance * 0.15);
          const opacity = isCenter ? 1 : Math.max(0.5, 1 - distance * 0.25);

          return (
            <div
              key={track.id}
              className="flex-shrink-0"
              style={{
                // Snap-align + width BELONG on the direct flex child of
                // the scroll container. On the nested div, Safari/iOS
                // silently ignored snap points.
                scrollSnapAlign: 'center',
                width: CARD_W,
                transform: `scale(${scale})`,
                opacity,
                transition: 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 260ms ease',
                transformOrigin: 'center',
              }}
            >
              <TrackCardGestures
                track={track}
                onTap={() => onPlay(track)}
                className="cursor-pointer"
              >
                <div
                  className="relative rounded-xl overflow-hidden mb-2 bg-white/5"
                  style={{
                    width: CARD_W,
                    height: CARD_W,
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
              </TrackCardGestures>
            </div>
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
  // Takes the track so the parent can pass a single stable callback shared
  // across every card instance. Passing `() => onTrackPlay(track)` inline
  // created a fresh function ref per render, invalidating the memo and
  // re-rendering every card on every HomeFeed state update.
  onPlay: (track: Track) => void;
  /** Show the bronze OYÉ boost badge */
  showBoostBadge?: boolean;
  /** Track is actually cached/boosted — full opacity. False = faded + smaller */
  isBoosted?: boolean;
}

const TrackCard = memo(({ track, onPlay, showBoostBadge = false }: TrackCardProps) => {
  const [isHovered, setIsHovered] = useState(false);

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
  const [bucketFly, setBucketFly] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefStartRef = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const didPrefRef = useRef(false);
  const swipeAxisRef = useRef<'x' | 'y' | null>(null);

  const PREF_THRESHOLD = 35;
  const BUCKET_THRESHOLD = 40;

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

    if (!swipeAxisRef.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      swipeAxisRef.current = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      // Horizontal drift detected before the hold timer — user is scrolling
      // the shelf, not interacting with the card. Cancel the hold so we
      // don't enter pref mode mid-scroll (this was the remaining "can't
      // scroll" culprit on Your Next Voyage + Classics).
      if (swipeAxisRef.current === 'x' && holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      // Vertical swipe — also cancels hold; handled below in pointerup.
      if (swipeAxisRef.current === 'y' && holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    }

    if (prefMode && swipeAxisRef.current !== 'y') {
      setPrefDx(Math.max(-60, Math.min(60, dx)));
    }
  };

  const handlePrefUp = (e: React.PointerEvent) => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }

    if (prefStartRef.current && swipeAxisRef.current === 'y') {
      const dy = e.clientY - prefStartRef.current.y;
      if (dy < -BUCKET_THRESHOLD) {
        didPrefRef.current = true;
        app.oyeCommit(track, { position: 0 });
        try { navigator.vibrate?.([15, 8, 15]); } catch {}
        setBucketFly(true);
        setTimeout(() => setBucketFly(false), 500);
        prefStartRef.current = null;
        swipeAxisRef.current = null;
        return;
      }
    }

    if (!prefMode) { prefStartRef.current = null; swipeAxisRef.current = null; return; }

    if (prefDx > PREF_THRESHOLD) {
      const position = Math.random() < 0.6 ? 0 : undefined;
      app.oyeCommit(track, { position });
      try { navigator.vibrate?.([20, 10, 20]); } catch {}

      if (cardRef.current) {
        cardRef.current.style.transition = 'box-shadow 0.3s ease-out';
        cardRef.current.style.boxShadow = '0 0 20px rgba(212,160,83,0.6), inset 0 0 30px rgba(212,160,83,0.15)';
        setTimeout(() => {
          if (cardRef.current) { cardRef.current.style.boxShadow = ''; cardRef.current.style.transition = ''; }
        }, 500);
      }
    } else if (prefDx < -PREF_THRESHOLD) {
      recordPoolEngagement(track.id || track.trackId, 'skip');
      try { navigator.vibrate?.(10); } catch {}
    }
    setPrefMode(false);
    setPrefDx(0);
    prefStartRef.current = null;
    swipeAxisRef.current = null;
  };

  return (
    <button
      className="flex-shrink-0 w-36 relative group"
      onClick={() => { if (didPrefRef.current) { didPrefRef.current = false; return; } onPlay(track); }}
      style={{ scrollSnapAlign: 'start' }}
      onPointerDown={handlePrefDown}
      onPointerMove={handlePrefMove}
      onPointerUp={handlePrefUp}
      onPointerCancel={() => { setPrefMode(false); setPrefDx(0); swipeAxisRef.current = null; prefStartRef.current = null; if (holdTimerRef.current) clearTimeout(holdTimerRef.current); }}
    >
      <div
        ref={cardRef}
        className="relative w-36 h-36 rounded-xl overflow-hidden mb-2 bg-[#1c1c22] border border-[#28282f]/50 group-active:border-white/15 transition-colors"
        style={{
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
        {!prefMode && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(139,92,246,0.02) 100%)' }}
          />
        )}
        {prefMode && (
          <>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(to right, rgba(120,125,135,0.35), transparent 60%)',
                opacity: Math.max(0, -prefDx / 60),
                transition: 'opacity 0.1s ease-out',
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(to left, rgba(212,160,83,0.40), transparent 60%)',
                opacity: Math.max(0, prefDx / 60),
                transition: 'opacity 0.1s ease-out',
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: 'inset 0 0 20px rgba(255,255,255,0.08)',
                opacity: 1 - Math.abs(prefDx) / 60,
              }}
            />
          </>
        )}
        {bucketFly && (
          <div
            className="absolute inset-0 pointer-events-none flex items-center justify-center"
            style={{ background: 'linear-gradient(to top, rgba(139,92,246,0.5), rgba(139,92,246,0.2))' }}
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
          <div className="absolute top-2 right-2 z-10">
            <OyeButton track={track} size="sm" />
          </div>
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

const CARD_BREATH_DELAYS = ['0s','3s','6s','2s','5s','1s','4s','7s','2.5s','4.5s','1.5s','6.5s'];
const WideTrackCard = memo(({ track, onPlay, showBoostBadge = false, breathIdx = 0 }: TrackCardProps & { breathIdx?: number }) => {
  const [isHovered, setIsHovered] = useState(false);
  const thumbnailUrl = getThumb(track.trackId, 'high');

  return (
    <div
      className="flex-shrink-0 cursor-pointer group"
      onClick={() => onPlay(track)}
      style={{ scrollSnapAlign: 'start', width: '200px' }}
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
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(139,92,246,0.04) 45%, transparent 70%)',
            animation: `card-purple-breath 9s ease-in-out ${CARD_BREATH_DELAYS[breathIdx % CARD_BREATH_DELAYS.length]} infinite`,
          }}
          aria-hidden
        />
        <style>{`@keyframes card-purple-breath{0%,100%{opacity:.55}50%{opacity:1}}`}</style>
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
        {/* Unified Oye badge — state visuals (purple/bubbling/gold-faded/
            gold-filled) are driven by downloadStore + preferenceStore, so
            the old isBoosted opacity+size toggle is handled automatically. */}
        {showBoostBadge && (
          <div className="absolute top-2 right-2 z-10">
            <OyeButton track={track} size="sm" />
          </div>
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
// CLASSICS DISK CARD — zoomed-disc treatment
// A breather in the feed: pure artwork, no labels. Circular crop so the
// cover reads like a zoomed-in vinyl label. 90% opacity keeps it
// effortless — there but not shouting.
// ============================================
const ClassicsDiskCard = memo(({ track, index, isSelected, onPlay }: {
  track: Track;
  index: number;
  isSelected?: boolean;
  onPlay: (track: Track) => void;
}) => {
  const thumbnailUrl = getThumb(track.trackId, 'high');
  const driftDuration = 6 + (index % 4) * 0.9;
  const driftDelay = (index % 6) * 0.55;
  return (
    <button
      className="flex-shrink-0 flex flex-col items-center gap-2 transition-transform duration-150"
      style={{ scrollSnapAlign: 'start', transform: isSelected ? 'scale(1.08)' : 'scale(1)', transition: 'transform 0.35s cubic-bezier(0.16,1,0.3,1)' }}
      onClick={() => onPlay(track)}
      aria-label={`Play ${track.title} by ${track.artist}`}
    >
      {/* Outer glow ring — only on selected */}
      <div className="relative" style={{ padding: isSelected ? 6 : 0, transition: 'padding 0.35s ease' }}>
        {isSelected && (
          <div
            className="absolute inset-0 rounded-full pointer-events-none classics-disk-glow-ring"
            style={{ boxShadow: '0 0 0 3px rgba(212,160,83,0.9), 0 0 28px rgba(212,160,83,0.6), 0 0 56px rgba(212,160,83,0.3)' }}
          />
        )}
        {/* Disk */}
        <div
          className={`relative rounded-full overflow-hidden ${isSelected ? 'classics-disk-spin' : 'classics-disk-drift'}`}
          style={{
            width: 120,
            height: 120,
            ['--drift-dur' as string]: `${driftDuration}s`,
            ['--drift-delay' as string]: `${driftDelay}s`,
            boxShadow: isSelected
              ? '0 0 0 2.5px rgba(212,160,83,0.9), 0 0 0 5px rgba(212,160,83,0.25), 0 12px 36px rgba(0,0,0,0.8), inset 0 0 24px rgba(0,0,0,0.4)'
              : '0 0 0 2px rgba(212,160,83,0.45), 0 0 0 4px rgba(212,160,83,0.12), 0 10px 28px rgba(0,0,0,0.65), inset 0 0 24px rgba(0,0,0,0.4)',
          }}
        >
          <SmartImage
            src={thumbnailUrl}
            alt={track.title}
            className="w-full h-full object-cover"
            trackId={track.trackId}
            artist={track.artist}
            title={track.title}
            style={{ transform: 'scale(1.45)' }}
          />
          {/* Vinyl grooves */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle at 50% 50%, transparent 28%, rgba(0,0,0,0.18) 30%, transparent 32%, rgba(0,0,0,0.10) 46%, transparent 48%, rgba(0,0,0,0.08) 62%, transparent 64%)' }}
          />
          {/* Sepia wash */}
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{ background: 'rgba(160,100,20,0.12)', mixBlendMode: 'multiply' }} />
          {/* Gold light burst on selected */}
          {isSelected && (
            <div
              className="absolute inset-0 rounded-full pointer-events-none classics-disk-lightburst"
              style={{ background: 'radial-gradient(circle at 38% 32%, rgba(255,210,100,0.28) 0%, transparent 60%)' }}
            />
          )}
          {/* Center spindle */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{ width: 10, height: 10, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle, #D4A053 0%, #8B5E1A 100%)', boxShadow: isSelected ? '0 0 8px rgba(212,160,83,1), 0 0 16px rgba(212,160,83,0.6)' : '0 0 4px rgba(212,160,83,0.6)' }}
          />
        </div>
      </div>
      {/* Label */}
      <div className="text-center w-[120px]">
        <p className="text-[10px] font-semibold leading-tight truncate" style={{ color: isSelected ? 'rgba(244,217,153,1)' : 'rgba(255,255,255,0.8)', fontFamily: 'Satoshi, system-ui, sans-serif', transition: 'color 0.3s' }}>
          {track.title}
        </p>
        <p className="text-[10px] leading-tight truncate mt-0.5" style={{ color: 'rgba(212,160,83,0.7)', fontFamily: 'Satoshi, system-ui, sans-serif' }}>
          {track.artist}
        </p>
      </div>
    </button>
  );
});
ClassicsDiskCard.displayName = 'ClassicsDiskCard';

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
  onTrackPlay: (track: Track) => void;
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

  // Lazy-mount the iframe itself — off-active cards show only the
  // thumbnail. Was mounting 10+ YouTube player instances in parallel
  // across the rail; now at most 1 (active) + 1 (recently-active
  // lingering briefly) decode video at a time. Big battery + memory
  // win on long carousels. Unmount delayed 800ms on inactive so a
  // quick scroll-through doesn't thrash mount/unmount.
  const [shouldMountIframe, setShouldMountIframe] = useState(isActive);
  useEffect(() => {
    if (isActive) {
      setShouldMountIframe(true);
      return;
    }
    const t = setTimeout(() => setShouldMountIframe(false), 800);
    return () => clearTimeout(t);
  }, [isActive]);

  // Previews are always muted — audio only through AudioPlayer

  return (
    <button
      className="flex-shrink-0 relative rounded-xl"
      style={{ width: '95px', height: '142px' }}
      onClick={() => onTrackPlay(track)}
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

        {/* Video iframe — mounted only when the card is active (or was
            recently). Static thumbnail fills the visual the rest of
            the time. */}
        {shouldMountIframe && (
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
        )}

        {/* Purple overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'linear-gradient(180deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.08) 40%, rgba(0,0,0,0.75) 100%)',
          }}
        />

        {/* Genre pill */}
        <div className="absolute top-1.5 left-1.5 z-20">
          <span className="px-1.5 py-0.5 rounded text-[6px] uppercase bg-purple-600/45 text-white/90"
                style={{ fontFamily: 'Arial Black, sans-serif', fontWeight: 900, letterSpacing: '0.07em', textShadow: '0 0 6px rgba(167,139,250,0.9), 0 0 14px rgba(139,92,246,0.55)' }}>
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
            onTrackPlay={onTrackPlay}
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
// FRIEND SEARCH PILL — tap "Vibes on Vibes"
// ============================================

// Inline getInitials — same logic as Dahub.tsx:42 (no import needed, same file scope)
function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

interface FriendSearchPillProps {
  open: boolean;
  friends: Friend[];
  loading: boolean;
  onClose: () => void;
  onFriendTap: (dashId: string) => void;
}

const FriendSearchPill = ({ open, friends, loading, onClose, onFriendTap }: FriendSearchPillProps) => {
  useBackGuard(open, onClose, 'friend-search-pill');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 120ms — no library
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 120);
    return () => clearTimeout(t);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      setQuery('');
      setDebouncedQuery('');
    }
  }, [open]);

  const filtered = debouncedQuery
    ? friends.filter(
        f =>
          f.name.toLowerCase().includes(debouncedQuery) ||
          f.dash_id.toLowerCase().includes(debouncedQuery)
      )
    : friends;

  const handleInvite = () => {
    const text = encodeURIComponent('Come vibe with me on VOYO Music 🎵 voyomusic.com');
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop — tap outside to dismiss */}
      <div
        className="fixed inset-0 z-[55]"
        onClick={onClose}
        aria-label="Close friend search"
      />

      {/* Pill */}
      <div
        className="fixed z-[56] left-4 right-4 rounded-[28px] overflow-hidden"
        style={{
          bottom: '20%',
          maxWidth: 380,
          margin: '0 auto',
          background: 'rgba(20, 20, 28, 0.72)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          // Center horizontally within left:16px right:16px
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 32px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input row — same tokens as SearchOverlayV2 */}
        <div className="px-4 pt-4 pb-2 flex-shrink-0">
          <div
            className="flex items-center gap-2.5 px-3.5 rounded-full"
            style={{
              height: 44,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            <Search className="w-4 h-4 text-white/40 flex-shrink-0" strokeWidth={2} />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search friends"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-white placeholder:text-white/30 focus:outline-none text-[15px]"
            />
          </div>
        </div>

        {/* Scrollable friend list */}
        <div className="overflow-y-auto flex-1 px-4 pb-4 scrollbar-hide">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <VoyoLoadOrb size={40} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
              <p className="text-white/40 text-sm">
                {friends.length === 0
                  ? 'No friends yet. Invite someone!'
                  : 'No match found'}
              </p>
              {friends.length === 0 && (
                <button
                  onClick={handleInvite}
                  className="px-5 py-2.5 rounded-full text-sm font-medium text-white"
                  style={{
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.4) 0%, rgba(139,92,246,0.2) 100%)',
                    border: '1px solid rgba(139,92,246,0.3)',
                  }}
                >
                  Invite via WhatsApp
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1 pt-1">
              {filtered.map((friend) => (
                <button
                  key={friend.dash_id}
                  className="flex items-center gap-3 w-full px-2 py-2.5 rounded-2xl text-left active:bg-white/10 transition-colors"
                  onClick={() => {
                    onFriendTap(friend.dash_id);
                    onClose();
                  }}
                >
                  {/* 36px avatar — image or gradient initials (Dahub pattern lines 287-293) */}
                  <div
                    className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold overflow-hidden"
                    style={
                      friend.avatar
                        ? undefined
                        : {
                            background:
                              'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                          }
                    }
                  >
                    {friend.avatar ? (
                      <img
                        src={friend.avatar}
                        alt={friend.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      getInitials(friend.name)
                    )}
                  </div>

                  {/* Name + Dash ID */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate leading-snug">
                      {friend.nickname || friend.name}
                    </p>
                    <p className="text-white/40 text-xs truncate leading-snug">
                      {friend.dash_id}
                    </p>
                  </div>

                  {/* Chevron */}
                  <span className="text-white/20 text-xs flex-shrink-0">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// ============================================
// VIBES ON VIBES — LIVE FRIENDS SHEET
// ============================================

interface VibesLiveFriendsSheetProps {
  friends: Friend[];
  loading: boolean;
  onClose: () => void;
  onFriendTap: (dashId: string) => void;
}

const VibesLiveFriendsSheet = ({ friends, loading, onClose, onFriendTap }: VibesLiveFriendsSheetProps) => {
  useBackGuard(true, onClose, 'vibes-live-friends');

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // WhatsApp share invite CTA
  const handleInvite = () => {
    const text = encodeURIComponent('Come vibe with me on VOYO Music 🎵 voyomusic.com');
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdropClick}
    >
      <div
        className="w-full rounded-t-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(22,18,36,0.98) 0%, rgba(12,10,20,0.99) 100%)',
          boxShadow: '0 -4px 40px rgba(0,0,0,0.6), 0 -1px 0 rgba(255,255,255,0.07)',
          paddingBottom: 'max(28px, calc(env(safe-area-inset-bottom, 0px) + 20px))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sheet handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="px-6 pt-3 pb-4 flex items-center justify-between">
          <div>
            <h3
              className="leading-none"
              style={{
                fontFamily: "'Italianno', cursive",
                fontSize: '2rem',
                fontWeight: 400,
                background: 'linear-gradient(135deg, #FFF3D6 0%, #F4D999 15%, #E6B865 35%, #D4A053 55%, #C4943D 75%, #8B6228 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Vibing Now
            </h3>
            <p className="text-white/40 text-xs mt-0.5">Friends on VOYO right now</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"
            aria-label="Close"
          >
            <span className="text-white/60 text-sm leading-none">&times;</span>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-2 min-h-[120px]">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <VoyoLoadOrb size={48} />
            </div>
          ) : friends.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <p className="text-white/40 text-sm mb-4">No friends vibing right now</p>
              <button
                onClick={handleInvite}
                className="px-5 py-2.5 rounded-full text-sm font-medium text-white"
                style={{
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.4) 0%, rgba(139,92,246,0.2) 100%)',
                  border: '1px solid rgba(139,92,246,0.3)',
                }}
              >
                Invite friends via WhatsApp
              </button>
            </div>
          ) : (
            <div className="flex gap-5 overflow-x-auto scrollbar-hide pb-2">
              {friends.map((friend) => (
                <button
                  key={friend.dash_id}
                  className="flex-shrink-0 flex flex-col items-center gap-2"
                  onClick={() => {
                    onFriendTap(friend.dash_id);
                    onClose();
                  }}
                >
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-base relative"
                    style={{
                      background: friend.avatar
                        ? undefined
                        : 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                      boxShadow: '0 0 0 2px rgba(212,160,83,0.5)',
                    }}
                  >
                    {friend.avatar ? (
                      <img
                        src={friend.avatar}
                        alt={friend.name}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <span>{friend.name.charAt(0).toUpperCase()}</span>
                    )}
                    {/* Live dot */}
                    <span
                      className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full border-2 border-[#0c0a14]"
                      style={{ background: '#22c55e' }}
                    />
                  </div>
                  <span className="text-white/70 text-xs text-center max-w-[56px] truncate">
                    {friend.nickname || friend.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

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
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<Track | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Session seed drives shelf rotation — every reload / pull-to-refresh gets
  // a fresh number, so shelves surface different tracks from the big pool
  // without losing stability WITHIN a single session.
  const [sessionSeed, setSessionSeed] = useState(() => Date.now());

  // Stations — curator-led vibe hubs, shown as a horizontal snap-scroll rail
  // above the shelves. Rail animates parallax on scroll when >1 station.
  // stationsLoading gates a skeleton rail while the query is in flight so
  // users on slow networks see continuity instead of a ghost gap that
  // jolts into content 2-3s later.
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setStationsLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('voyo_stations')
        .select('*')
        .eq('is_featured', true)
        .not('hero_r2_key', 'is', null)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      if (data) setStations(data as Station[]);
      setStationsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Vibes on Vibes — live friend presence ──────────────────────────────────
  const { isLoggedIn, dashId } = useAuth();
  const navigate = useNavigate();
  const [liveFriends, setLiveFriends] = useState<Friend[]>([]);
  const [allFriends, setAllFriends] = useState<Friend[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [vibesSheetOpen, setVibesSheetOpen] = useState(false);
  const [vibesFriendsLoading, setVibesFriendsLoading] = useState(false);
  const [showSearchPill, setShowSearchPill] = useState(false);
  const [searchPillLoading, setSearchPillLoading] = useState(false);
  const vibesHeaderRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressMoved = useRef(false);
  const longPressFired = useRef(false);

  // Random shimmer cycle duration per session — 18-28s so the gap never feels mechanical
  const shimmerDuration = useRef(`${(18 + Math.random() * 10).toFixed(1)}s`);

  // Classics disk timeline — center-focused scroll
  const [diskCenterIndex, setDiskCenterIndex] = useState(0);
  const diskScrollRef = useRef<HTMLDivElement>(null);
  const diskRafRef = useRef<number | null>(null);
  const diskCenterRef = useRef(0);
  const [selectedClassic, setSelectedClassic] = useState<Track | null>(null);

  // Top 10 countdown — IntersectionObserver dwell 4s → auto-scroll from #9 → #1
  const top10SectionRef = useRef<HTMLDivElement>(null);
  const top10CardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [top10CountdownActive, setTop10CountdownActive] = useState(false);
  const top10CountdownActiveRef = useRef(false); // sync guard — state update is async
  const [top10ActiveIdx, setTop10ActiveIdx] = useState<number | null>(null);
  const top10DwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const top10CountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const el = top10SectionRef.current;
    if (!el) return;
    let fired = false;
    let mounted = true; // guard against state updates after unmount
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!mounted) return;
        if (entry.isIntersecting && !fired) {
          top10DwellTimerRef.current = setTimeout(() => {
            fired = true;
            top10CountdownActiveRef.current = true; // sync — blocks subtitle before re-render
            setTop10CountdownActive(true);
            let currentIdx = 8;
            setTop10ActiveIdx(currentIdx);
            top10CardRefs.current[currentIdx]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            const interval = setInterval(() => {
              currentIdx -= 1;
              if (currentIdx < 0) { clearInterval(interval); return; }
              setTop10ActiveIdx(currentIdx);
              top10CardRefs.current[currentIdx]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }, 2400);
            top10CountdownIntervalRef.current = interval;
          }, 4000);
        } else if (!entry.isIntersecting) {
          if (top10DwellTimerRef.current) { clearTimeout(top10DwellTimerRef.current); top10DwellTimerRef.current = null; }
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => {
      mounted = false;
      observer.disconnect();
      if (top10DwellTimerRef.current) clearTimeout(top10DwellTimerRef.current);
      if (top10CountdownIntervalRef.current) clearInterval(top10CountdownIntervalRef.current);
    };
  }, []);

  // Subtitle flash — fires only on fast manual scroll of the Top 10 carousel
  const [top10SubtitleKey, setTop10SubtitleKey] = useState(0);
  const top10ScrollCooldownRef = useRef(false);
  const top10PrevScrollRef = useRef<{ left: number; time: number } | null>(null);
  const top10SubtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTop10Scroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (top10CountdownActive || top10CountdownActiveRef.current) return;
    const now = Date.now();
    const currentLeft = e.currentTarget.scrollLeft;
    const prev = top10PrevScrollRef.current;
    top10PrevScrollRef.current = { left: currentLeft, time: now };
    if (!prev || top10ScrollCooldownRef.current) return;
    const dt = now - prev.time;
    const dx = Math.abs(currentLeft - prev.left);
    // Fast scroll threshold: >80px moved in <150ms
    if (dt > 0 && dt < 150 && dx > 80) {
      top10ScrollCooldownRef.current = true;
      if (top10SubtitleTimerRef.current) clearTimeout(top10SubtitleTimerRef.current);
      top10SubtitleTimerRef.current = setTimeout(() => {
        setTop10SubtitleKey(k => k + 1);
        setTimeout(() => { top10ScrollCooldownRef.current = false; }, 4200);
      }, 280);
    }
  }, [top10CountdownActive]);

  // ── Infinite loop scroll + ambient water ripple + audio reactive glow ───
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const rippleHostRef = useRef<HTMLDivElement>(null);
  const audioGlowRef = useRef<HTMLDivElement>(null);
  const loopingRef = useRef(false);
  const loopFadeOverlayRef = useRef<HTMLDivElement>(null);
  const loopTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const overscrollYRef = useRef(0);
  const touchStartFeedYRef = useRef(0);
  const touchStartFeedXRef = useRef(0);
  const feedAtBottomRef = useRef(false);
  const feedAtTopRef = useRef(false);

  // Water ripple — Avatar-style fluid contact aura + trail rings
  useEffect(() => {
    const scroll = feedScrollRef.current;
    const host = rippleHostRef.current;
    if (!scroll || !host) return;

    const AURA = 26;
    let auraEl: HTMLDivElement | null = null;
    let rafId = 0;
    let curX = 0, curY = 0, targetX = 0, targetY = 0;
    let lastRingX = 0, lastRingY = 0, lastRingTime = 0;
    let touching = false;
    const ringTimers: ReturnType<typeof setTimeout>[] = [];

    const color = () => {
      const frac = scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight);
      return frac < 0.3 ? 'rgba(212,160,83,' : 'rgba(139,92,246,';
    };

    const spawnRing = (x: number, y: number, kind: 'tap' | 'trail' | 'burst') => {
      const c = color();
      const wrap = document.createElement('div');
      Object.assign(wrap.style, {
        position: 'fixed', left: `${x}px`, top: `${y}px`,
        width: '6px', height: '6px', marginLeft: '-3px', marginTop: '-3px',
        borderRadius: '50%', pointerEvents: 'none',
      });
      const inner = document.createElement('div');
      const [anim, dur] =
        kind === 'tap'   ? ['voyo-ring-tap',   500] :
        kind === 'trail' ? ['voyo-ring-trail', 520] :
                           ['voyo-ring-burst', 700];
      const alpha = kind === 'trail' ? '0.28)' : kind === 'tap' ? '0.32)' : '0.44)';
      Object.assign(inner.style, {
        width: '100%', height: '100%', borderRadius: '50%',
        border: `1px solid ${c}${alpha}`,
        boxShadow: `0 0 ${kind === 'burst' ? 10 : 5}px ${c}${kind === 'burst' ? '0.1)' : '0.06)'})`,
        animation: `${anim} ${dur}ms cubic-bezier(0.2,0.65,0.35,1) forwards`,
        willChange: 'transform, opacity',
      });
      wrap.appendChild(inner);
      host.appendChild(wrap);
      ringTimers.push(setTimeout(() => wrap.remove(), dur + 20));
    };

    const tick = () => {
      if (!touching) return;
      curX += (targetX - curX) * 0.26;
      curY += (targetY - curY) * 0.26;
      if (auraEl) auraEl.style.transform = `translate(${curX - AURA / 2}px, ${curY - AURA / 2}px)`;
      rafId = requestAnimationFrame(tick);
    };

    const onTouchStart = (e: TouchEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('button,a,input,select,[role="button"]')) return;
      const t = e.touches[0];
      curX = targetX = t.clientX;
      curY = targetY = t.clientY;
      lastRingX = t.clientX; lastRingY = t.clientY; lastRingTime = Date.now();
      touching = true;
      // Cancel any lingering aura from a previous rapid tap before creating a new one
      if (auraEl) { auraEl.remove(); auraEl = null; }
      cancelAnimationFrame(rafId);
      spawnRing(t.clientX, t.clientY, 'tap');
      const c = color();
      auraEl = document.createElement('div');
      Object.assign(auraEl.style, {
        position: 'fixed', left: '0', top: '0',
        width: `${AURA}px`, height: `${AURA}px`, borderRadius: '50%',
        transform: `translate(${curX - AURA / 2}px, ${curY - AURA / 2}px)`,
        border: `1.5px solid ${c}0.6)`,
        boxShadow: `0 0 14px ${c}0.3), 0 0 6px ${c}0.18) inset`,
        pointerEvents: 'none', opacity: '1', willChange: 'transform',
        transition: 'opacity 0.15s ease',
      });
      host.appendChild(auraEl);
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touching) return;
      const t = e.touches[0];
      targetX = t.clientX; targetY = t.clientY;
      const dx = t.clientX - lastRingX, dy = t.clientY - lastRingY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const now = Date.now();
      if (dist > 22 && now - lastRingTime > 45) {
        spawnRing(t.clientX, t.clientY, 'trail');
        lastRingX = t.clientX; lastRingY = t.clientY; lastRingTime = now;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touching) return;
      touching = false;
      cancelAnimationFrame(rafId);
      const t = e.changedTouches[0];
      spawnRing(t.clientX, t.clientY, 'burst');
      if (auraEl) {
        auraEl.style.opacity = '0';
        const el = auraEl; auraEl = null;
        setTimeout(() => el.remove(), 170);
      }
    };

    scroll.addEventListener('touchstart', onTouchStart, { passive: true });
    scroll.addEventListener('touchmove', onTouchMove, { passive: true });
    scroll.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      touching = false;
      scroll.removeEventListener('touchstart', onTouchStart);
      scroll.removeEventListener('touchmove', onTouchMove);
      scroll.removeEventListener('touchend', onTouchEnd);
      cancelAnimationFrame(rafId);
      if (auraEl) { auraEl.remove(); auraEl = null; }
      ringTimers.forEach(clearTimeout);
    };
  }, []);

  // Audio-reactive ambient glow — reads CSS vars written by freqPump (10fps),
  // drives a soft radial pulse behind the feed. Zero React re-renders.
  useEffect(() => {
    const glow = audioGlowRef.current;
    if (!glow) return;
    let rafId = 0;
    let frame = 0;
    const pump = () => {
      rafId = requestAnimationFrame(pump);
      if (++frame % 6 !== 0) return; // ~10fps, matches freqPump cadence
      const root = document.documentElement;
      const bass = parseFloat(root.style.getPropertyValue('--voyo-bass') || '0');
      const energy = parseFloat(root.style.getPropertyValue('--voyo-energy') || '0');
      glow.style.opacity = Math.min(energy * 0.2, 0.13).toFixed(3);
      glow.style.transform = `translateX(-50%) scale(${(1 + bass * 0.5).toFixed(3)})`;
    };
    rafId = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Track scroll position for gesture overscroll detection
  const handleFeedScroll = useCallback(() => {
    const el = feedScrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    feedAtTopRef.current = scrollTop < 8;
    feedAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 8;
  }, []);

  // Overscroll gesture — detect push-past-bottom / push-past-top
  const onFeedTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    touchStartFeedYRef.current = e.touches[0].clientY;
    touchStartFeedXRef.current = e.touches[0].clientX;
    overscrollYRef.current = 0;
  }, []);

  const onFeedTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const dy = touchStartFeedYRef.current - e.touches[0].clientY;
    const dx = Math.abs(touchStartFeedXRef.current - e.touches[0].clientX);
    const absdy = Math.abs(dy);
    // Skip if gesture is more horizontal than vertical (carousel swipe) or too small.
    // Prevents diagonal swipes on Top 10/Vibes carousels from triggering the loop.
    if (absdy < 14 || dx > absdy * 0.7) return;
    if (feedAtBottomRef.current && dy > 0) overscrollYRef.current = dy;
    if (feedAtTopRef.current && dy < 0) overscrollYRef.current = dy;
  }, []);

  const onFeedTouchEnd = useCallback(() => {
    if (loopingRef.current) return;
    // Bottom overscroll → loop feed back to top
    if (feedAtBottomRef.current && overscrollYRef.current > 52) {
      loopingRef.current = true;
      const overlay = loopFadeOverlayRef.current;
      if (overlay) overlay.style.opacity = '1';
      const t1 = setTimeout(() => {
        if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
        const t2 = setTimeout(() => {
          if (overlay) overlay.style.opacity = '0';
          loopingRef.current = false;
        }, 90);
        loopTimersRef.current.push(t2);
      }, 280);
      loopTimersRef.current.push(t1);
    }
    // Top overscroll (up gesture) — portal back (wired externally via onSwitchToVOYO when coming from player)
    overscrollYRef.current = 0;
  }, []);

  // Poll live friend count every 30s while mounted
  useEffect(() => {
    if (!isLoggedIn || !dashId) return;
    let cancelled = false;

    const fetchOnlineFriends = async () => {
      try {
        const friends = await friendsAPI.getFriends(dashId);
        if (cancelled) return;
        const online = friends.filter(f => f.status === 'online');
        setAllFriends(friends);
        setLiveFriends(online);
        setLiveCount(online.length);
      } catch { /* silent — presence is decorative */ }
    };

    fetchOnlineFriends();
    const interval = setInterval(fetchOnlineFriends, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLoggedIn, dashId]);

  // Long-press handler for "Vibes on Vibes" header block
  const handleVibesPointerDown = useCallback((e: React.PointerEvent) => {
    longPressMoved.current = false;
    longPressFired.current = false;
    longPressTimerRef.current = setTimeout(() => {
      if (longPressMoved.current) return;
      longPressFired.current = true;
      setVibesSheetOpen(true);
    }, 500);
  }, []);

  const handleVibesPointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleVibesPointerMove = useCallback((e: React.PointerEvent) => {
    if (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5) {
      longPressMoved.current = true;
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  // Open sheet — also fetch fresh friends list
  const openVibesSheet = useCallback(async () => {
    setVibesSheetOpen(true);
    if (!isLoggedIn || !dashId) return;
    setVibesFriendsLoading(true);
    try {
      const friends = await friendsAPI.getFriends(dashId);
      const online = friends.filter(f => f.status === 'online');
      setAllFriends(friends);
      setLiveFriends(online);
      setLiveCount(online.length);
    } catch { /* silent */ }
    finally { setVibesFriendsLoading(false); }
  }, [isLoggedIn, dashId]);

  // Open search pill — reuse allFriends already fetched; re-query only if empty
  const openSearchPill = useCallback(async () => {
    // Guard: if long-press just fired, don't also open the pill
    if (longPressFired.current) { longPressFired.current = false; return; }
    setShowSearchPill(true);
    if (!isLoggedIn || !dashId) return;
    if (allFriends.length > 0) return; // already have data — no refetch
    setSearchPillLoading(true);
    try {
      const friends = await friendsAPI.getFriends(dashId);
      setAllFriends(friends);
      const online = friends.filter(f => f.status === 'online');
      setLiveFriends(online);
      setLiveCount(online.length);
    } catch { /* silent */ }
    finally { setSearchPillLoading(false); }
  }, [isLoggedIn, dashId, allFriends.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      loopTimersRef.current.forEach(clearTimeout);
    };
  }, []);
  // ───────────────────────────────────────────────────────────────────────────

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

  // Stable callbacks for memo'd card children. Every card receives ONE of
  // these refs regardless of the track it renders — the card itself passes
  // its own track back. Without this, inline `() => onTrackPlay(track)`
  // closures invalidated every card's memo on every HomeFeed render.
  const playTrack = useCallback(
    (track: Track) => onTrackPlay(track),
    [onTrackPlay],
  );
  const playTrackFull = useCallback(
    (track: Track) => onTrackPlay(track, { openFull: true }),
    [onTrackPlay],
  );

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
  // Defensive: missing track fields + getOyoInsights storage corruption
  // can't crash the shelf — returns [] on any error so Safe isn't needed
  // for correctness, only for the render tree below.
  const oyosPicks = useMemo(() => {
    try {
      const hot = Array.isArray(pools.hot) ? pools.hot : [];
      if (hot.length === 0) return [];
      let favs = new Set<string>();
      try {
        const insights = getOyoInsights();
        if (insights?.favoriteArtists) {
          favs = new Set(insights.favoriteArtists
            .filter((a): a is string => typeof a === 'string')
            .map(a => a.toLowerCase()));
        }
      } catch { /* insights may be unavailable on first run */ }
      const dedup = Array.isArray(discoverMoreTracks) ? discoverMoreTracks : [];
      const usedIds = new Set(dedup.map(t => t?.id).filter(Boolean));
      const filtered = hot.filter(t => t?.id && !usedIds.has(t.id));
      return [
        ...filtered.filter(t => favs.has((t.artist ?? '').toLowerCase())),
        ...filtered.filter(t => !favs.has((t.artist ?? '').toLowerCase())),
      ].slice(0, 15);
    } catch (e) {
      devWarn('[HomeFeed] oyosPicks failed:', e);
      return [];
    }
  }, [pools.hot, discoverMoreTracks]);

  // African Vibes: West African tags + user's afro-heat preference weighting.
  // Empty pool / any failure → empty shelf, no crash.
  const africanVibes = useMemo(() => {
    try {
      const pool = Array.isArray(hotPool) ? hotPool : [];
      if (pool.length === 0) return [];
      const curated = getWestAfricanTracks(pool, 60);
      if (curated.length >= 5) {
        const scored = curated.map(track => ({
          track,
          score: calculateBehaviorScore(track, trackPreferences)
        }));
        scored.sort((a, b) => b.score - a.score);
        const topBand = scored.map(s => s.track).slice(0, 30);
        return seededShuffle(topBand, sessionSeed).slice(0, 15);
      }
      const afroPool = pool.filter(t =>
        t?.detectedMode === 'afro-heat' || t?.tags?.some((tag: string) =>
          ['afrobeats', 'afro', 'african', 'lagos', 'naija'].includes(tag.toLowerCase())
        )
      );
      if (afroPool.length >= 5) {
        return seededShuffle(afroPool as Track[], sessionSeed).slice(0, 15);
      }
      const fallback = getPoolAwareHotTracks(45) || [];
      return seededShuffle(fallback, sessionSeed).slice(0, 15);
    } catch (e) {
      devWarn('[HomeFeed] africanVibes failed:', e);
      return [];
    }
  }, [hotPool, trackPreferences, sessionSeed]);

  const classicsTracks = useMemo(() => {
    try {
      const pool = Array.isArray(hotPool) ? hotPool : [];
      const curated = getClassicsTracks(pool, 45);

      // Seed fallback — hand-vetted all-time classics from the static TRACKS
      // data, sorted by oyeScore. Guarantees the shelf is never empty on
      // cold boot before curateAllSections has finished its searches.
      const seedClassics = [...TRACKS]
        .filter(t => (t.oyeScore || 0) >= 10_000_000)
        .sort((a, b) => (b.oyeScore || 0) - (a.oyeScore || 0));

      const seen = new Set(curated.map(t => t.trackId));
      const merged: Track[] = [...curated];
      for (const t of seedClassics) {
        if (merged.length >= 15) break;
        if (!seen.has(t.trackId)) merged.push(t);
      }
      if (merged.length < 5) return [];
      return seededShuffle(merged, sessionSeed).slice(0, 12);
    } catch (e) {
      devWarn('[HomeFeed] classicsTracks failed:', e);
      return [];
    }
  }, [hotPool, sessionSeed]);

  // Top 10 on VOYO: Trending tracks, excluding what's in other shelves.
  const trending = useMemo(() => {
    try {
      const pool = Array.isArray(hotPool) ? hotPool : [];
      const usedIds = new Set([
        ...oyosPicks.map(t => t?.id).filter(Boolean),
        ...discoverMoreTracks.map(t => t?.id).filter(Boolean),
        ...africanVibes.map(t => t?.id).filter(Boolean),
      ]);
      const curated = getCuratedTrendingTracks(pool, 50);
      const available = curated.filter(t => t?.id && !usedIds.has(t.id));
      if (available.length >= 5) {
        return seededShuffle(available, sessionSeed).slice(0, 10);
      }
      const fallback = getTrendingTracks(pool, 50).filter(t => t?.id && !usedIds.has(t.id));
      return seededShuffle(fallback, sessionSeed).slice(0, 10);
    } catch (e) {
      devWarn('[HomeFeed] trending failed:', e);
      return [];
    }
  }, [hotPool, oyosPicks, discoverMoreTracks, africanVibes, sessionSeed]);

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
    <>
    {/* Ripple host — fixed viewport layer, receives imperatively added ripple divs */}
    <div ref={rippleHostRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 500 }} aria-hidden>
      {/* Audio reactive ambient glow — radial pulse breathing with the music */}
      <div ref={audioGlowRef} style={{
        position: 'fixed', bottom: '-80px', left: '50%',
        transform: 'translateX(-50%) scale(1)',
        width: '440px', height: '440px', borderRadius: '50%',
        background: 'radial-gradient(circle at 50% 55%, rgba(212,160,83,0.95) 0%, rgba(139,92,246,0.4) 28%, transparent 60%)',
        opacity: '0', pointerEvents: 'none',
        willChange: 'transform, opacity',
        transition: 'opacity 0.55s ease, transform 0.45s ease',
      }} />
      <style>{`
        @keyframes voyo-ring-tap {
          0%   { transform: scale(0); opacity: 0.6; }
          60%  { opacity: 0.16; }
          100% { transform: scale(22); opacity: 0; }
        }
        @keyframes voyo-ring-trail {
          0%   { transform: scale(0); opacity: 0.5; }
          60%  { opacity: 0.12; }
          100% { transform: scale(20); opacity: 0; }
        }
        @keyframes voyo-ring-burst {
          0%   { transform: scale(0); opacity: 0.75; }
          50%  { opacity: 0.3; }
          100% { transform: scale(32); opacity: 0; }
        }
      `}</style>
    </div>
    {/* Loop fade overlay — above ripple host (501 > 500) so ripples don't bleed through */}
    <div ref={loopFadeOverlayRef} style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 501,
      background: 'rgba(6,6,9,0.92)',
      opacity: 0,
      transition: 'opacity 0.28s ease',
    }} aria-hidden />
    <div
      ref={feedScrollRef}
      className="flex flex-col h-full overflow-y-auto pb-52 scrollbar-hide"
      style={{ overscrollBehavior: 'none', touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' as never }}
      onScroll={handleFeedScroll}
      onTouchStart={onFeedTouchStart}
      onTouchMove={onFeedTouchMove}
      onTouchEnd={onFeedTouchEnd}
    >
      {/* Header — fully transparent, floats over the continuous canvas (April 2026) */}
      <header className="flex items-center justify-between px-4 py-3 sticky top-0 bg-transparent z-10">
        <button
          className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white font-bold"
          onClick={onDahub}
        >
          D
        </button>
        <div className="flex items-center gap-2">
          <button aria-label="Search" className="p-2 rounded-full bg-white/10 hover:bg-white/20" onClick={onSearch}>
            <Search className="w-5 h-5 text-white/70" />
          </button>
          {/* Bell removed — no classic-Home notifications pipeline. Push
              notifications surface via PushBell in the VOYO header. */}
        </div>
      </header>


      {/* Top-of-feed narrative slot — flashy GreetingBanner on session
          open, then eases into an ambient LiveStatusBar that tells the
          tale of what's happening in the app right now. */}
      <Safe name="GreetingArea"><GreetingArea /></Safe>

      {/* VoyoLiveCard - "Vibes on Vibes" → Opens VOYO Player */}
      <Safe name="SignInPrompt"><SignInPrompt onSwitchToVOYO={onSwitchToVOYO} /></Safe>

      {/* Back in the Mood — subtle brand atmosphere behind the cards.
          Single element, two stacked gradients:
            · radial purple breath across the whole section (brand wash)
            · horizontal pillar fade — the portrait player's top/bottom
              vignette language rotated 90° and dialled way down (player
              is ~80% alpha, these pillars peak at ~10%)
          Cards scroll past from behind; you feel it more than see it. */}
      {hasHistory && (
        <div className="relative mb-10">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `
                radial-gradient(ellipse 80% 72% at 50% 55%, rgba(139,92,246,0.055) 0%, rgba(139,92,246,0.015) 55%, transparent 88%),
                linear-gradient(to right, rgba(139,92,246,0.10) 0%, rgba(139,92,246,0.02) 14%, transparent 30%, transparent 70%, rgba(139,92,246,0.02) 86%, rgba(139,92,246,0.10) 100%)
              `,
            }}
            aria-hidden
          />
          <div className="relative flex justify-between items-center px-4 mb-5">
            <h2 className="text-white font-semibold text-base">Keep the energy</h2>
          </div>
          <div
            className="relative flex gap-4 px-4 overflow-x-auto scrollbar-hide"
            style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
          >
            {recentlyPlayed.slice(0, 12).map((track, i) => (
              <CardHoldActions key={track.id} track={track} onPlaylist={() => setPlaylistModalTrack(track)}>
                <WideTrackCard track={track} onPlay={playTrack} showBoostBadge isBoosted={boostedIds.has(track.trackId)} breathIdx={i} />
              </CardHoldActions>
            ))}
          </div>
        </div>
      )}

      {/* ═══ CLASSICS — always visible, one fixed position after history/SignIn ═══ */}
      <Safe name="Classics">
        {classicsTracks.length > 0 && (
          <div
            className="mb-10 pt-10 pb-10 relative overflow-hidden"
            style={{
              background: 'radial-gradient(ellipse 120% 80% at 30% 0%, rgba(212,160,83,0.18) 0%, rgba(212,160,83,0.07) 45%, transparent 75%)',
            }}
          >
            <style>{`
              @keyframes classics-disk-drift {
                0%, 100% { transform: translateY(0px); }
                50%      { transform: translateY(-6px); }
              }
              .classics-disk-drift {
                animation: classics-disk-drift var(--drift-dur, 7s) ease-in-out infinite;
                animation-delay: var(--drift-delay, 0s);
                will-change: transform;
              }
              @keyframes classics-disk-spin {
                from { transform: rotate(0deg); }
                to   { transform: rotate(360deg); }
              }
              .classics-disk-spin {
                animation: classics-disk-spin 3.6s linear infinite;
                will-change: transform;
              }
              @keyframes classics-disk-glow-pulse {
                0%, 100% { opacity: 1; }
                50%       { opacity: 0.65; }
              }
              .classics-disk-glow-ring {
                animation: classics-disk-glow-pulse 2.2s ease-in-out infinite;
              }
              @keyframes classics-disk-lightburst-anim {
                0%, 100% { opacity: 0.28; }
                50%       { opacity: 0.58; }
              }
              .classics-disk-lightburst {
                animation: classics-disk-lightburst-anim 1.7s ease-in-out infinite;
              }
              @keyframes classics-drift-in {
                from { opacity: 0; transform: translateY(20px); }
                to   { opacity: 1; transform: translateY(0); }
              }
              .classics-drift-in {
                animation: classics-drift-in 0.55s cubic-bezier(0.16,1,0.3,1) both;
              }
              @keyframes rr-shimmer {
                0%, 100% { opacity: 0.75; }
                50%       { opacity: 1; }
              }
              .rr-fade-shimmer {
                animation: rr-shimmer 5s ease-in-out infinite;
              }
              @keyframes classics-subtitle-shimmer {
                0%   { background-position: 60% center; filter: none; }
                22%  { background-position: 0% center;  filter: none; }
                31%  { background-position: 0% center;  filter: drop-shadow(0 0 5px rgba(255,210,80,0.48)) drop-shadow(0 0 11px rgba(212,160,83,0.28)); }
                46%  { background-position: 0% center;  filter: none; }
                100% { background-position: 0% center;  filter: none; }
              }
              .classics-subtitle-shimmer {
                animation-name: classics-subtitle-shimmer;
                animation-timing-function: ease-in-out;
                animation-iteration-count: infinite;
                animation-fill-mode: both;
              }
              @media (prefers-reduced-motion: reduce) {
                .classics-disk-drift, .classics-disk-spin, .classics-disk-glow-ring,
                .classics-disk-lightburst, .rr-fade-shimmer, .classics-subtitle-shimmer { animation: none; }
              }
            `}</style>

            {/* Gold hairline top */}
            <div className="absolute top-0 left-8 right-8 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,83,0.4), rgba(230,184,101,0.75), rgba(212,160,83,0.4), transparent)' }} />
            {/* Gold hairline bottom */}
            <div className="absolute bottom-0 left-8 right-8 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,83,0.25), rgba(230,184,101,0.5), rgba(212,160,83,0.25), transparent)' }} />

            {/* Header */}
            <div className="px-5 mb-6 flex items-center gap-3">
              <div
                className="flex-shrink-0 relative rounded-full"
                style={{ width: 36, height: 36, background: 'radial-gradient(circle at 50% 50%, #2a1a08 0%, #0d0804 100%)', boxShadow: '0 0 0 1.5px rgba(212,160,83,0.55), 0 4px 14px rgba(0,0,0,0.65)' }}
              >
                <div className="absolute rounded-full" style={{ width: 11, height: 11, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'radial-gradient(circle, #D4A053 0%, #8B5E1A 100%)' }} />
                <div className="absolute inset-0 rounded-full" style={{ border: '1px solid rgba(212,160,83,0.18)', margin: 5 }} />
                <div className="absolute inset-0 rounded-full" style={{ border: '1px solid rgba(212,160,83,0.08)', margin: 9 }} />
              </div>
              <div>
                <h2
                  className="leading-none"
                  style={{ fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 24, fontWeight: 400, background: 'linear-gradient(100deg, #F4D999 0%, #E6B865 40%, #C4943D 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.6)) drop-shadow(0 0 14px rgba(212,160,83,0.2))' }}
                >
                  All-Time Classics
                </h2>
                <p
                  className="text-[10px] tracking-widest uppercase mt-1 classics-subtitle-shimmer"
                  style={{
                    fontFamily: 'Satoshi, system-ui, sans-serif',
                    fontWeight: 700,
                    animationDuration: shimmerDuration.current,
                    background: [
                      'linear-gradient(90deg,',
                      'rgba(175,125,42,0.68) 0%,',      /* AB — dim bronze */
                      'rgba(192,144,56,0.72) 10%,',
                      'rgba(202,157,66,0.76) 19%,',     /* AB/VC boundary */
                      'rgba(218,170,76,0.88) 26%,',     /* VC — picks up */
                      'rgba(230,185,100,0.93) 33%,',    /* VC right edge at rest — brightest */
                      'rgba(205,158,64,0.80) 42%,',     /* pre-glint */
                      'rgba(255,238,145,1.00) 49%,',    /* GLINT peak */
                      'rgba(232,188,106,0.90) 54%,',
                      'rgba(200,152,60,0.78) 65%,',
                      'rgba(192,144,56,0.74) 100%',
                      ')',
                    ].join(' '),
                    backgroundSize: '300% 100%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {'African Bangers · '}<b style={{ fontWeight: 800 }}>VOYO Certified</b>
                </p>
              </div>
            </div>

            {/* Disk carousel */}
            <div className="relative">
              {/* RR Roof fades — scintillent white ↔ gold bronze */}
              <div className="absolute top-0 bottom-0 left-0 pointer-events-none rr-fade-shimmer" style={{ width: 52, background: 'linear-gradient(to right, rgba(255,251,240,0.18) 0%, rgba(230,184,101,0.10) 50%, transparent 100%)', zIndex: 2 }} />
              <div className="absolute top-0 bottom-0 right-0 pointer-events-none rr-fade-shimmer" style={{ width: 52, background: 'linear-gradient(to left, rgba(255,251,240,0.18) 0%, rgba(230,184,101,0.10) 50%, transparent 100%)', zIndex: 2, animationDelay: '2.5s' }} />
              <div
                className="flex gap-5 px-5 overflow-x-auto scrollbar-hide"
                style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch', maskImage: 'linear-gradient(to right, transparent 0, black 6%, black 94%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 6%, black 94%, transparent 100%)' }}
              >
                {classicsTracks.map((track, index) => (
                  <ClassicsDiskCard
                    key={track.id}
                    track={track}
                    index={index}
                    isSelected={selectedClassic?.id === track.id}
                    onPlay={(t) => { setSelectedClassic(prev => prev?.id === t.id ? null : t); playTrackFull(t); }}
                  />
                ))}
              </div>
            </div>

            {/* Selected disc collection — drifts in below */}
            {selectedClassic && (() => {
              const related = classicsTracks.filter(t => t.artist === selectedClassic.artist && t.id !== selectedClassic.id).slice(0, 8);
              if (related.length === 0) return null;
              return (
                <div className="mt-5 px-5 classics-drift-in">
                  <p className="text-[9px] font-semibold tracking-widest uppercase mb-3" style={{ color: 'rgba(212,160,83,0.6)', fontFamily: 'Satoshi, system-ui, sans-serif' }}>
                    More from {selectedClassic.artist}
                  </p>
                  <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1" style={{ scrollSnapType: 'x proximity' }}>
                    {related.map((track, i) => (
                      <button
                        key={track.id}
                        className="flex-shrink-0 flex items-center gap-2.5 rounded-xl px-2.5 py-2 classics-drift-in"
                        style={{ scrollSnapAlign: 'start', background: 'rgba(212,160,83,0.07)', border: '1px solid rgba(212,160,83,0.18)', animationDelay: `${i * 0.065}s` }}
                        onClick={() => { setSelectedClassic(track); playTrackFull(track); }}
                        aria-label={`Play ${track.title}`}
                      >
                        <div className="relative flex-shrink-0 rounded-full overflow-hidden" style={{ width: 38, height: 38, boxShadow: '0 0 0 1.5px rgba(212,160,83,0.4)' }}>
                          <SmartImage src={getThumb(track.trackId, 'high')} alt={track.title} className="w-full h-full object-cover" trackId={track.trackId} artist={track.artist} title={track.title} style={{ transform: 'scale(1.3)' }} />
                        </div>
                        <div className="text-left" style={{ maxWidth: 88 }}>
                          <p className="text-[11px] font-semibold leading-tight truncate" style={{ color: 'rgba(255,255,255,0.9)', fontFamily: 'Satoshi, system-ui, sans-serif' }}>{track.title}</p>
                          <p className="text-[9px] leading-tight truncate mt-0.5" style={{ color: 'rgba(212,160,83,0.62)', fontFamily: 'Satoshi, system-ui, sans-serif' }}>{track.artist}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Safe>

      {/* 🌍 African Vibes - cultural pillar, holds its ground.
          Watch More moved OFF the header (Apr 2026): it now only appears at the
          end of the carousel after scrolling, with a golden-beam reveal and a
          purple Open VOYO morph. Header stays clean, CTA earns the scroll. */}
      <div className="mt-5 mb-10">
        <div className="px-4 mb-5 flex items-center gap-3">
          <AfricaIcon size={36} />
          <div className="flex-1">
            <h2
              className="text-white text-[22px] leading-none"
              style={{ fontWeight: 800, letterSpacing: '-0.01em' }}
            >
              OYÉ Africa
            </h2>
            <p
              className="text-[9px] font-medium tracking-wider uppercase mt-1.5"
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
            onTrackPlay={playTrackFull}
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

      {/* Next Voyage — state-aware discovery. Pool re-ranks around the
          last click + time-of-session context (sessionSeed + OYO behavior
          rerank). Name carries VOYO DNA (voyage = VOYO root) while "next"
          keeps it relative-to-now. */}
      {hasDiscoverMore && (
        <ShelfWithRefresh title="Next Voyage" onRefresh={handleRefresh} isRefreshing={isRefreshing}>
          {discoverMoreTracks.slice(0, 12).map((track) => (
            <CardHoldActions key={track.id} track={track} onPlaylist={() => setPlaylistModalTrack(track)}>
              <TrackCard track={track} onPlay={playTrackFull} />
            </CardHoldActions>
          ))}
        </ShelfWithRefresh>
      )}


      {/* Top 10 on VOYO */}
      {hasTrending && (
        <div ref={top10SectionRef} className="mb-8 py-8 relative" style={{ background: 'linear-gradient(180deg, rgba(6,6,9,1) 0%, rgba(139,92,246,0.08) 15%, rgba(139,92,246,0.06) 50%, rgba(139,92,246,0.12) 85%, rgba(6,6,9,0.95) 100%)' }}>
          {/* Top edge fade */}
          <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-[#060609] to-transparent pointer-events-none z-10" />
          {/* Bottom edge fade — purple-tinted */}
          <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none z-10" style={{ background: 'linear-gradient(to bottom, transparent, rgba(139,92,246,0.15))' }} />
          {/* BG glow — breathes in sync with the header drift (same 17s cycle) */}
          <div className="absolute inset-0 pointer-events-none top10-bg-glow" aria-hidden style={{ zIndex: 0 }} />
          <div className="relative px-4 mb-6" style={{ zIndex: 1 }}>
            <div className="overflow-hidden">
              <h2 className="top10-header-scroll text-white font-semibold text-base whitespace-nowrap inline-block">VOYO Top 10</h2>
            </div>
            <p
              key={top10SubtitleKey}
              className={`text-[9px] tracking-widest uppercase mt-1${top10SubtitleKey > 0 ? ' top10-subtitle-flash' : ''}`}
              style={{ fontFamily: 'Satoshi, system-ui, sans-serif', fontWeight: 700, opacity: top10SubtitleKey > 0 ? undefined : 0 }}
            >
              This Week · VOYO Certified
            </p>
          </div>
          <style>{`
            /* Header — compositor-only: only transform + color animate */
            @keyframes top10-header-drift {
              0%        { transform: translateX(0);    color: #fff; }
              8%        { transform: translateX(0);    color: #fff; }
              34%       { transform: translateX(-43%); color: rgba(220,167,75,0.95); }
              64%       { transform: translateX(-43%); color: rgba(220,167,75,0.95); }
              92%       { transform: translateX(0);    color: #fff; }
              96%, 100% { transform: translateX(0);    color: #fff; }
            }
            .top10-header-scroll {
              animation: top10-header-drift 22s ease-in-out infinite;
              will-change: transform;
            }
            /* BG glow — opacity-only = compositor thread */
            @keyframes top10-bg-pulse {
              0%, 7%    { opacity: 0.3; }
              34%, 64%  { opacity: 1; }
              93%, 100% { opacity: 0.3; }
            }
            .top10-bg-glow {
              background: radial-gradient(ellipse 90% 70% at 50% 50%, rgba(139,92,246,0.2) 0%, rgba(139,92,246,0.07) 50%, transparent 80%);
              animation: top10-bg-pulse 22s ease-in-out infinite;
              will-change: opacity;
            }
            /* Subtitle — soft reveal on fast scroll */
            @keyframes top10-subtitle-flash {
              0%   { opacity: 0; transform: translateY(4px); }
              22%  { opacity: 0.7; transform: translateY(0); }
              60%  { opacity: 0.55; }
              100% { opacity: 0; }
            }
            .top10-subtitle-flash {
              animation: top10-subtitle-flash 4.2s ease forwards;
              color: rgba(212,160,83,0.75);
            }
            @keyframes top10-marquee {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .top10-scroll-title {
              display: inline-block;
              animation: top10-marquee 10s linear infinite;
            }
          `}</style>
          <div className="flex gap-6 px-4 overflow-x-auto scrollbar-hide" style={{ scrollSnapType: top10CountdownActive ? 'none' : 'x proximity', overscrollBehaviorX: 'contain', paddingBottom: '60px', position: 'relative', zIndex: 1 }} onScroll={handleTop10Scroll}>
            {trending.slice(0, 10).map((track, index) => {
              const maxChars = 12;
              const titleNeedsScroll = track.title.length > maxChars;
              const artistNeedsScroll = track.artist.length > maxChars;
              const isPodium = index < 3;
              const numberFill = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : 'transparent';
              const numberStroke = index === 0 ? '#B8860B' : index === 1 ? '#808080' : index === 2 ? '#8B4513' : '#9D4EDD';
              const strokeWidth = isPodium ? '2px' : '3px';
              const numberGlow = index === 0 ? '0 0 30px rgba(255, 215, 0, 0.5)' : index === 1 ? '0 0 20px rgba(192, 192, 192, 0.4)' : index === 2 ? '0 0 20px rgba(205, 127, 50, 0.4)' : '0 0 25px rgba(157, 78, 221, 0.5), 3px 3px 0 rgba(0,0,0,0.6)';

              const isActive = top10CountdownActive && top10ActiveIdx === index;
              return (
                <button
                  key={track.id}
                  ref={(el) => { top10CardRefs.current[index] = el; }}
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
                      textShadow: isActive
                        ? index === 0
                          ? '0 0 60px rgba(255,215,0,0.9), 0 0 100px rgba(255,215,0,0.5)'
                          : index === 1
                            ? '0 0 50px rgba(230,230,200,0.9), 0 0 80px rgba(255,215,0,0.45)'
                            : '0 0 50px rgba(139,92,246,0.9), 0 0 80px rgba(157,78,221,0.5)'
                        : numberGlow,
                      fontFamily: 'Arial Black, sans-serif',
                      transition: 'text-shadow 0.8s ease-in-out',
                    }}
                  >
                    {index + 1}
                  </div>
                  <div className="relative" style={{ zIndex: 2 }}>
                    <div className="absolute -inset-2 rounded-full" style={{
                      opacity: isActive ? 0.85 : 0.35,
                      background: index === 0
                        ? 'radial-gradient(circle, rgba(255,215,0,0.85) 0%, rgba(212,160,83,0.4) 40%, transparent 70%)'
                        : index === 1
                          ? 'radial-gradient(circle, rgba(230,230,205,0.75) 0%, rgba(255,215,0,0.38) 40%, transparent 70%)'
                          : 'radial-gradient(circle, rgba(139,92,246,0.85) 0%, rgba(157,78,221,0.42) 40%, transparent 70%)',
                      filter: 'blur(12px)',
                      transition: 'opacity 0.8s ease-in-out',
                      willChange: 'opacity',
                    }} />
                    <div className="relative rounded-full overflow-hidden" style={{
                      width: '85px',
                      height: '85px',
                      boxShadow: isActive
                        ? index === 0
                          ? '0 4px 18px rgba(0,0,0,0.5), 0 0 44px rgba(255,215,0,0.8), 0 0 80px rgba(255,215,0,0.38)'
                          : index === 1
                            ? '0 4px 18px rgba(0,0,0,0.5), 0 0 40px rgba(220,220,200,0.75), 0 0 72px rgba(255,215,0,0.35)'
                            : '0 4px 18px rgba(0,0,0,0.5), 0 0 36px rgba(139,92,246,0.8), 0 0 64px rgba(139,92,246,0.4)'
                        : '0 4px 18px rgba(0,0,0,0.45), 0 0 16px rgba(157,78,221,0.18)',
                      transition: 'box-shadow 0.8s ease-in-out',
                      willChange: 'box-shadow',
                    }}>
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
                      <p className={`whitespace-nowrap ${artistNeedsScroll ? 'top10-scroll-title' : ''}`}
                         style={{ animationDelay: '1.4s', fontSize: '9px', color: 'rgba(255,255,255,0.45)', letterSpacing: '0.02em' }}>
                        {artistNeedsScroll ? <>{track.artist}<span className="mx-3">·</span>{track.artist}<span className="mx-3">·</span></> : track.artist}
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

      {/* Vibes reel — one horizontal scroll interleaving AI vibe-covers
          with real track cards pulled from the hot-pool for that vibe.
          Tap AI card → open the vibe (playFromVibe); tap track card →
          play that exact track. Lightweight: 5 thumbs per vibe, all
          R2-cached so playback is instant on tap. */}
      <div className="mb-12">
        <div className="px-4 mb-1.5">
          <h2 className="text-white font-semibold text-base">Vibes</h2>
        </div>
        <Safe name="VibesReel"><VibesReel vibes={vibes} onOpenVibe={handleVibeSelect} /></Safe>
      </div>

      {/* Stations rail — DJ-curated vibes (deeper commitment than Vibes buttons).
          Horizontal snap-scroll. Cards autoplay muted; 7s dwell fades audio in
          (iOS shows "Tap to hear"); tap commits to deck + R2 audio.
          Skeleton row renders while the query is in flight to kill the
          "ghost-then-jolt" layout shift on slow networks. */}
      {stationsLoading && stations.length === 0 ? (
        <div className="mb-8 -mx-1" aria-busy="true" aria-label="Loading stations">
          <div className="flex gap-3 overflow-hidden scrollbar-hide px-4 pb-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="snap-center flex-shrink-0 w-[82vw] max-w-[420px] rounded-2xl"
                style={{
                  aspectRatio: '4 / 5',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  animation: 'voyo-skeleton-pulse 1.8s ease-in-out infinite',
                }}
              />
            ))}
          </div>
          <style>{`
            @keyframes voyo-skeleton-pulse {
              0%, 100% { opacity: 0.55; }
              50%      { opacity: 0.85; }
            }
          `}</style>
        </div>
      ) : stations.length > 0 && (
        <Safe name="StationsRail">
          <div className="mb-8 -mx-1">
            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 pb-2">
              {stations.map((station) => (
                <Safe name={`Station:${station.id}`} key={station.id}>
                  <div className="snap-center flex-shrink-0 w-[82vw] max-w-[420px]">
                    <StationHero station={station} />
                  </div>
                </Safe>
              ))}
            </div>
          </div>
        </Safe>
      )}

      {/* TIVI+ moved to DaHub */}

      {/* OYO's Picks — OYO-curated surface, the app's voice in the feed.
          Only renders when we actually have tracks — an empty header with
          no carousel below is worse than the shelf being absent. */}
      {oyosPicks.length > 0 && (
        <div className="mb-12">
          <div className="px-4 mb-5 flex items-center gap-2">
            <h2 className="text-white font-semibold text-base">OYO's Picks</h2>
            <div className="h-[2px] w-6 rounded-full" style={{ background: '#8b5cf6', opacity: 0.6 }} />
          </div>
          <Safe name="OyosPicks"><CenterFocusedCarousel tracks={oyosPicks} onPlay={playTrack} onDiscover={onSearch} /></Safe>
        </div>
      )}

      {/* Your Artist Radar — personal-history shelf, lives at the bottom as
          a closing beat. Not the first thing users see; the discovery /
          communal shelves lead, this is the quieter personal reveal. */}
      {hasArtists && (
        <div className="mb-10">
          <div className="px-4 mb-5">
            <h2 className="text-white font-semibold text-base">Your Artist Radar</h2>
          </div>
          <div className="flex gap-6 px-4 overflow-x-auto scrollbar-hide">
            {artistsYouLove.map((artist) => (
              <ArtistCard key={artist.name} artist={artist} onPlay={playTrack} />
            ))}
          </div>
        </div>
      )}

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

      {/* Vibes on Vibes — Live Friends Sheet (portal-like, renders on top) */}
      {vibesSheetOpen && (
        <VibesLiveFriendsSheet
          friends={liveFriends}
          loading={vibesFriendsLoading}
          onClose={() => setVibesSheetOpen(false)}
          onFriendTap={(friendDashId) => navigate(`/${friendDashId}`)}
        />
      )}

      {/* Friend Search Pill — tap "Vibes on Vibes" heading */}
      <FriendSearchPill
        open={showSearchPill}
        friends={allFriends}
        loading={searchPillLoading}
        onClose={() => setShowSearchPill(false)}
        onFriendTap={(friendDashId) => navigate(`/${friendDashId}`)}
      />

      {/* Playlist modal — opened by CardHoldActions on WideTrackCard */}
      {playlistModalTrack && (
        <PlaylistModal
          isOpen={!!playlistModalTrack}
          onClose={() => setPlaylistModalTrack(null)}
          trackId={playlistModalTrack.trackId}
          trackTitle={playlistModalTrack.title}
        />
      )}
    </div>
    </>
  );
};

export default HomeFeed;
