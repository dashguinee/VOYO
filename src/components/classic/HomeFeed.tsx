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
import { useShallow } from 'zustand/shallow';
import { devWarn } from '../../utils/logger';
import { Search, Play, Zap } from 'lucide-react';
import { AfricaIcon } from '../ui/AfricaIcon';
import { getThumb, generatePlaceholder } from '../../utils/thumbnail';
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
import { AccountMenu } from '../profile/AccountMenu';
import { BoostSettings } from '../ui/BoostSettings';
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

// OYÉ section header rotation. African capitals + diaspora-heavy
// places where the music lives. Tagged by category so the subtitle
// can pair "From {current} to {random other in same category}" —
// the journey stays coherent (Conakry → Bamako, not Conakry → Bahia).
// 'My People' is the anchor and keeps its original "From Lagos to
// Johannesburg" subtitle.
type OyeTitleType = 'anchor' | 'west_africa' | 'central_east_south' | 'caribbean' | 'north_africa' | 'diaspora' | 'indian_ocean' | 'brazil';
const OYE_TITLES: ReadonlyArray<{ name: string; type: OyeTitleType }> = [
  { name: 'My People', type: 'anchor' },
  // West Africa
  { name: 'Conakry', type: 'west_africa' },
  { name: 'Lagos', type: 'west_africa' },
  { name: 'Bamako', type: 'west_africa' },
  { name: 'Dakar', type: 'west_africa' },
  { name: 'Accra', type: 'west_africa' },
  { name: 'Abidjan', type: 'west_africa' },
  { name: 'Freetown', type: 'west_africa' },
  { name: 'My People', type: 'anchor' },
  // Central + East + Southern
  { name: 'Kinshasa', type: 'central_east_south' },
  { name: 'Yaoundé', type: 'central_east_south' },
  { name: 'Joburg', type: 'central_east_south' },
  { name: 'Nairobi', type: 'central_east_south' },
  { name: 'Addis', type: 'central_east_south' },
  { name: 'Kigali', type: 'central_east_south' },
  // Caribbean
  { name: 'Kingston', type: 'caribbean' },
  { name: 'Guadeloupe', type: 'caribbean' },
  { name: 'Port-au-Prince', type: 'caribbean' },
  { name: 'Trinidad', type: 'caribbean' },
  { name: 'Martinique', type: 'caribbean' },
  { name: 'My People', type: 'anchor' },
  // North Africa
  { name: 'Casablanca', type: 'north_africa' },
  { name: 'Algiers', type: 'north_africa' },
  { name: 'Cairo', type: 'north_africa' },
  { name: 'Tunis', type: 'north_africa' },
  // Diaspora cities
  { name: 'Brixton', type: 'diaspora' },
  { name: 'Harlem', type: 'diaspora' },
  { name: 'Brooklyn', type: 'diaspora' },
  { name: 'Paris', type: 'diaspora' },
  { name: 'Brussels', type: 'diaspora' },
  { name: 'Lisbon', type: 'diaspora' },
  { name: 'My People', type: 'anchor' },
  // Indian Ocean
  { name: 'Seychelles', type: 'indian_ocean' },
  { name: 'Mauritius', type: 'indian_ocean' },
  { name: 'Antananarivo', type: 'indian_ocean' },
  // Brazil
  { name: 'Bahia', type: 'brazil' },
  { name: 'Salvador', type: 'brazil' },
  // Americas (diaspora cities continued)
  { name: 'Atlanta', type: 'diaspora' },
  { name: 'New Orleans', type: 'diaspora' },
  { name: 'Houston', type: 'diaspora' },
  { name: 'Toronto', type: 'diaspora' },
  // Smaller West African
  { name: 'Cotonou', type: 'west_africa' },
  { name: 'Lomé', type: 'west_africa' },
  { name: 'Monrovia', type: 'west_africa' },
  { name: 'Niamey', type: 'west_africa' },
  { name: 'Ouaga', type: 'west_africa' },
  // Southern + East continued
  { name: 'Maputo', type: 'central_east_south' },
  { name: 'Luanda', type: 'central_east_south' },
  { name: 'Harare', type: 'central_east_south' },
  { name: 'Kampala', type: 'central_east_south' },
];

// Pre-compute siblings by type so the subtitle pick is O(1) per cycle.
const OYE_SIBLINGS: Record<OyeTitleType, string[]> = OYE_TITLES.reduce((acc, t) => {
  if (!acc[t.type]) acc[t.type] = [];
  if (!acc[t.type].includes(t.name)) acc[t.type].push(t.name);
  return acc;
}, {} as Record<OyeTitleType, string[]>);

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
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
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
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
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
            width: 130,
            height: 130,
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
            style={{ transform: 'scale(1.5)' }}
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

// Album-art backdrop — shown until the YT iframe is ready, then cross-
// faded out to reveal the playing video. Deliberately rendered at native
// object-cover (no scale transform) so it reads as an ALBUM COVER, not
// a "frozen zoomed video frame." When the iframe takes over, the user
// sees a clean "cover-to-music-video" transition (Apple-Music-style)
// rather than a fight between two slightly-mismatched crops of the same
// image. Plain <img> instead of SmartImage to skip the animated
// `voyo-skeleton-shimmer` overlay, which on cards still loading was
// visible as a flicker. Browser-native loading: stays transparent until
// decoded, then paints in one frame. hqdefault (480×360) is sharp enough
// at this size with no upscale; falls back to a lightweight DASH
// placeholder if YT 404s.
const ThumbWithFallback = memo(({ trackId, alt }: { trackId: string; alt: string }) => {
  const [src, setSrc] = useState(() => getThumb(trackId, 'high'));
  const triedFallback = useRef(false);
  const handleError = useCallback(() => {
    if (triedFallback.current) return;
    triedFallback.current = true;
    setSrc(generatePlaceholder(alt, 400));
  }, [alt]);
  return (
    <img
      src={src}
      alt={alt}
      onError={handleError}
      className="absolute inset-0 w-full h-full object-cover"
      loading="eager"
      decoding="async"
      draggable={false}
    />
  );
});
ThumbWithFallback.displayName = 'ThumbWithFallback';

// AfricanVibesVideoCard — v712 (1-mount, thumbnail-masked bootstrap).
//
// Only the active card (idx === activeIdx) mounts a YT iframe. 800ms
// grace before unmount so quick scroll-back doesn't trigger a reboot.
// Cards 0..N-1 except the active one show only their matching-crop
// thumbnail — no iframe, no YT JS, no decoder.
//
// On scroll-to-new-active:
//   · Old active iframe unmounts after 800ms (or stays if user came
//     back).
//   · New active mounts a fresh iframe → YT bootstraps (~500-1500ms)
//     → ready-gate listens for `infoDelivery` playerState=1 (PLAYING)
//     → cross-fade thumbnail OUT, iframe IN.
//   · During bootstrap, the user sees the matching-crop thumbnail
//     (scale(3) maxres) which reads as a still video frame.
//
// Previous 3-mount window pre-warmed neighbors for instant transitions
// but ran 3 simultaneous YT engines + 3 large composited textures even
// when the user was only looking at one card — measurable paint pressure
// on mid-tier Android during scroll. The 1-mount + matching-crop
// thumbnail trades that for a brief masked bootstrap on each flip.
//
// activeIdx is computed at parent level via a single IntersectionObserver
// across all card refs, with hysteresis to prevent flicker between
// adjacent cards mid-scroll.
const AfricanVibesVideoCard = memo(({
  track,
  idx,
  activeIdx,
  sectionInView,
  containerRef,
  wasSeenBefore,
  markSeen,
  registerRef,
  onTrackPlay,
}: {
  track: Track;
  idx: number;
  activeIdx: number;
  /** Carousel-level visibility — the OYÉ Africa section is in viewport. */
  sectionInView: boolean;
  /** Carousel scroll container — used as IO root for the per-card
   *  play-zone (mount) and visibility (play/pause) observers below. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** True if the parent has seen this trackId fully ready before in
   *  this session — drives the scroll-back fast path (skip anticipation). */
  wasSeenBefore: boolean;
  /** Tells the parent this card has reached the painted-video state so
   *  future remounts (scroll-back) can skip the 1s anticipation. */
  markSeen: (trackId: string) => void;
  /** Parent's ref-collector — card registers itself on mount so the
   *  rail-level observer can compute the most-centered active card. */
  registerRef: (idx: number, el: HTMLButtonElement | null) => void;
  onTrackPlay: (track: Track) => void;
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);
  // Lifecycle state — see header comment.
  const [isInPlayZone, setIsInPlayZone] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  // Distinct from isVisible: ratio ≥ 0.95. Drives the 1s anticipation
  // gate below.
  const [isFullyVisible, setIsFullyVisible] = useState(false);
  // Sticky-true after the card has been continuously fully-visible
  // (ratio ≥ 0.95) AND iframe-ready for 1s. The 1s wait is the
  // anticipation buffer: the card has to settle in view AND have a
  // playing video before we commit to painting it. Fast scrolls don't
  // satisfy the timer, so cards passing through quickly stay as static
  // covers (no flicker). Once true, sticky for the rest of this mount.
  const [hasBeenFullyVisible, setHasBeenFullyVisible] = useState(false);
  // Register with parent on mount so it can observe + pick activeIdx.
  useEffect(() => {
    registerRef(idx, cardRef.current);
    return () => registerRef(idx, null);
  }, [idx, registerRef]);

  // Active = the centered card, drives bronze glow only.
  const isActive = sectionInView && idx === activeIdx;
  const [isReady, setIsReady] = useState(false);

  // Decode VOYO ID to real YouTube ID
  const youtubeId = useMemo(() => decodeVoyoId(track.trackId), [track.trackId]);

  const embedUrl = useMemo(() => {
    const params = new URLSearchParams({
      autoplay: '1',
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
      // YT single-video loop requires BOTH loop=1 AND playlist=<id>
      // (the playlist param needs to reference the same video id).
      // Without playlist, loop=1 is silently ignored and the video ends.
      loop: '1',
      playlist: youtubeId,
    });
    return `https://www.youtube.com/embed/${youtubeId}?${params.toString()}`;
  }, [youtubeId]);

  // ── Play zone (mount gate) ─────────────────────────────────────────
  // Viewport + 100px buffer ≈ 1 card-width. The off-screen "warming
  // slot" — when a card is roughly 1 card-width away from view, its
  // iframe mounts and starts bootstrapping. By the time it scrolls
  // into the rightmost-visible position, it's been bootstrapping for
  // a beat already.
  useEffect(() => {
    const card = cardRef.current;
    const root = containerRef.current;
    if (!card || !root) return;
    const obs = new IntersectionObserver(
      ([entry]) => setIsInPlayZone(entry.isIntersecting),
      { root, rootMargin: '0px 100px 0px 100px' }
    );
    obs.observe(card);
    return () => obs.disconnect();
  }, [containerRef]);

  // ── Visibility + fully-visible (drives buffer/dim states) ──────────
  // Multi-threshold IO. isVisible drives the 90% dim. isFullyVisible
  // (ratio ≥ 0.95) feeds the 1s anticipation gate below.
  useEffect(() => {
    const card = cardRef.current;
    const root = containerRef.current;
    if (!card || !root) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
        setIsFullyVisible(entry.intersectionRatio >= 0.95);
      },
      { root, threshold: [0, 0.5, 0.95, 1] }
    );
    obs.observe(card);
    return () => obs.disconnect();
  }, [containerRef]);

  // ── 1s anticipation gate ───────────────────────────────────────────
  // Flat 1s for every card, every time. v726 tried adaptive durations
  // (0ms snap for revisits / 500ms initial-load priming / 1000ms
  // scroll) — Dash flagged it as less smooth than v725's flat 1s. The
  // deep reason: smoothness on a peer-rail comes from RHYTHM, not from
  // optimizing individual moments. With three different timings, cards
  // visible at the same moment came alive at different beats. The
  // user's eye picks up on cadence mismatches even when each card in
  // isolation is faster. One tempo, every card, every time.
  //
  // wasSeenBefore + markSeen plumbing is kept (parent's seenTracksRef
  // is still threaded through) for potential future use, but not read
  // by the timer — every card pays the 1s anticipation regardless.
  useEffect(() => {
    if (hasBeenFullyVisible) return;
    if (!isFullyVisible || !isReady) return;
    const t = setTimeout(() => setHasBeenFullyVisible(true), 1000);
    return () => clearTimeout(t);
  }, [isFullyVisible, isReady, hasBeenFullyVisible]);

  // Persist "seen" status at the carousel level — kept for potential
  // future use even though the anticipation gate above ignores it now.
  useEffect(() => {
    if (hasBeenFullyVisible) markSeen(track.trackId);
  }, [hasBeenFullyVisible, track.trackId, markSeen]);

  // ── Mount lifecycle: tight focus, 300ms grace ──────────────────────
  // Mount when in play zone (strictly visible + 50px buffer). Unmount
  // on leaving with 300ms grace — just enough to absorb scroll inertia
  // bounce. Beyond that, off-screen cards drop their iframe entirely.
  const [shouldMountIframe, setShouldMountIframe] = useState(false);
  useEffect(() => {
    if (isInPlayZone) {
      setShouldMountIframe(true);
      return;
    }
    const t = setTimeout(() => setShouldMountIframe(false), 300);
    return () => clearTimeout(t);
  }, [isInPlayZone]);

  // Reset load + ready + fully-visible flags on unmount so the next
  // mount cycle starts clean (cover-first, then snap to video once the
  // card has been fully visible AND iframe is ready).
  useEffect(() => {
    if (!shouldMountIframe) {
      setIsLoaded(false);
      setIsReady(false);
      setHasBeenFullyVisible(false);
    }
  }, [shouldMountIframe]);

  // ── Subscribe to YT player events ──────────────────────────────────
  // Some YT versions don't broadcast `infoDelivery` without an explicit
  // `listening` postMessage. Sent after iframe `onLoad` fires.
  useEffect(() => {
    if (!iframeRef.current || !isLoaded) return;
    iframeRef.current.contentWindow?.postMessage(
      `{"event":"listening","id":"${track.trackId}"}`, '*'
    );
  }, [isLoaded, track.trackId]);

  // ── PLAYING-state listener: flips isReady (drives cover→video) ─────
  // YT broadcasts `infoDelivery` with playerState=1 (PLAYING) once a
  // frame is being decoded. Sticky once flipped — re-entering the
  // viewport doesn't replay the swap. 800ms fallback timer if YT goes
  // silent.
  useEffect(() => {
    if (!isLoaded || isReady) return;
    const targetWindow = iframeRef.current?.contentWindow;
    let armed = true;
    const onMsg = (ev: MessageEvent) => {
      if (!armed) return;
      if (ev.source !== targetWindow) return;
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (data?.event === 'infoDelivery' && data.info?.playerState === 1) {
          armed = false;
          setIsReady(true);
        }
      } catch { /* not a YT message */ }
    };
    window.addEventListener('message', onMsg);
    const fallback = window.setTimeout(() => {
      if (armed) { armed = false; setIsReady(true); }
    }, 500);
    return () => {
      armed = false;
      window.removeEventListener('message', onMsg);
      window.clearTimeout(fallback);
    };
  }, [isLoaded, isReady]);

  // ── One-shot playVideo on iframe load ──────────────────────────────
  // Just play once when iframe loads. No pauseVideo on visibility flips
  // — pausing made YT show its paused-state UI (the play/pause button)
  // when the user scrolled back. Once mounted, cards play forever until
  // the 5s grace runs out and they unmount entirely.
  useEffect(() => {
    if (!iframeRef.current || !isLoaded) return;
    iframeRef.current.contentWindow?.postMessage(
      `{"event":"command","func":"playVideo","args":""}`, '*'
    );
  }, [isLoaded]);

  return (
    <button
      ref={cardRef}
      className="flex-shrink-0 relative rounded-xl"
      style={{
        width: 'clamp(86px, 25vw, 110px)',
        aspectRatio: '95 / 142',
        // Off-viewport cards dim to 90%. In-viewport cards stay at 100%.
        // No transition — clean snap, no animation across multiple cards
        // during scroll (which used to read as flicker).
        opacity: isVisible ? 1 : 0.9,
      }}
      onClick={() => onTrackPlay(track)}
    >
      {/* Bronze glow — only on the active (centered) card. No opacity
          transition; mount/unmount is the visual change. Animations
          across multiple cards were a flicker source. */}
      {isActive && (
        <div
          className="absolute -inset-1 rounded-xl pointer-events-none"
          style={{
            background: idx === 0
              ? 'linear-gradient(135deg, rgba(212, 160, 83, 0.4) 0%, rgba(212, 160, 83, 0.15) 20%, transparent 50%)'
              : 'linear-gradient(135deg, rgba(212, 160, 83, 0.2) 0%, rgba(212, 160, 83, 0.08) 15%, transparent 40%)',
            filter: 'blur(8px)',
          }}
        />
      )}

      <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
        {/* Album cover — always rendered as the base layer. When the
            iframe's video starts playing (isReady from YT PLAYING
            postMessage), the iframe paints on top and visually replaces
            the cover. No crossfade: just clean snap. */}
        <ThumbWithFallback
          trackId={track.trackId}
          alt={track.title}
        />

        {/* Video iframe — mounts when the card enters the play zone
            (off-screen warming slot). Opacity stays 0 (not display:none
            — that would unload the iframe in some browsers) until BOTH:
              · isReady (YT broadcast PLAYING) AND
              · hasBeenFullyVisible (card has been fully in viewport at
                least once).
            That second gate creates the buffer effect: while the card
            is at the rightmost-visible position (just entered, partially
            visible), the cover stays. Once it shifts inward to full
            visibility, snap to video — and stay video for the rest of
            this mount, even when scrolling back out the right side. */}
        {shouldMountIframe && (
          <div
            className="absolute inset-0"
            style={{
              opacity: (isReady && hasBeenFullyVisible) ? 1 : 0,
            }}
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
          <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-purple-600/45 text-white/90"
                style={{ fontFamily: 'Arial Black, sans-serif', fontWeight: 900, letterSpacing: '0.07em', textShadow: '0 0 6px rgba(167,139,250,0.9), 0 0 14px rgba(139,92,246,0.55)' }}>
            {track.tags?.[0] || 'Afrobeats'}
          </span>
        </div>

        {/* Track info */}
        <div className="absolute bottom-0 left-0 right-0 p-1.5 z-20">
          <p className="text-white text-[11px] font-bold truncate">{track.title}</p>
          <p className="text-white/60 text-[10px] truncate">{track.artist}</p>
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-[10px] font-bold text-[#D4A053]">
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
  const [isInView, setIsInView] = useState(false);
  const [sentinelState, setSentinelState] = useState<EndSentinelState>('hidden');
  const lastWatchedRef = useRef<Track | null>(null);
  // activeIdx — computed via a single IntersectionObserver across all
  // card refs (most-intersecting wins, with hysteresis to prevent
  // flicker mid-scroll between two adjacent cards). Drives bronze glow.
  const [activeIdx, setActiveIdx] = useState(0);
  const cardRefsMap = useRef<Map<number, HTMLButtonElement>>(new Map());
  const ratiosRef = useRef<Map<number, number>>(new Map());
  const cardObserverRef = useRef<IntersectionObserver | null>(null);
  // Set of track IDs that have ever been fully-ready in this session.
  // Cards that come back from a seen track skip the 1s anticipation
  // gate and snap to video the instant their iframe is ready (~1s vs
  // ~2s for fresh cards). Makes the rail feel like cards remember
  // they've been seen — no double-wait on revisit.
  const seenTracksRef = useRef<Set<string>>(new Set());
  const markTrackSeen = useCallback((trackId: string) => {
    seenTracksRef.current.add(trackId);
  }, []);

  // Card-registration callback — each card calls on mount/unmount so
  // the rail's observer can track all current card elements.
  const registerCardRef = useCallback((idx: number, el: HTMLButtonElement | null) => {
    const map = cardRefsMap.current;
    const obs = cardObserverRef.current;
    const prev = map.get(idx);
    if (prev && prev !== el && obs) obs.unobserve(prev);
    if (el) {
      map.set(idx, el);
      obs?.observe(el);
    } else {
      map.delete(idx);
      ratiosRef.current.delete(idx);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        let updated = false;
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          // Find which idx this target represents (linear scan, n=12 max).
          for (const [idx, el] of cardRefsMap.current) {
            if (el === target) {
              ratiosRef.current.set(idx, entry.intersectionRatio);
              updated = true;
              break;
            }
          }
        });
        if (!updated) return;
        // Pick idx with highest visibility. Hysteresis: 5% gap before
        // flipping, so adjacent cards mid-scroll don't ping-pong activeIdx.
        let bestIdx = -1;
        let bestRatio = 0;
        ratiosRef.current.forEach((ratio, idx) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIdx = idx;
          }
        });
        if (bestIdx < 0 || bestRatio < 0.3) return;
        setActiveIdx((prev) => {
          if (prev === bestIdx) return prev;
          const prevRatio = ratiosRef.current.get(prev) ?? 0;
          if (bestRatio - prevRatio < 0.05) return prev; // hysteresis
          return bestIdx;
        });
      },
      {
        root: containerRef.current,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );
    cardObserverRef.current = obs;
    cardRefsMap.current.forEach((el) => obs.observe(el));
    return () => {
      obs.disconnect();
      cardObserverRef.current = null;
    };
  }, []);

  // lastWatched — first track is the default opener; if a card has been
  // tapped, that wins.
  useEffect(() => {
    if (tracks[0]) lastWatchedRef.current = tracks[0];
  }, [tracks]);

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
      onScroll={handleScroll}
    >
      {tracks.slice(0, 12).map((track, idx) => (
        <AfricanVibesVideoCard
          key={track.id}
          track={track}
          idx={idx}
          activeIdx={activeIdx}
          sectionInView={isInView}
          containerRef={containerRef}
          wasSeenBefore={seenTracksRef.current.has(track.trackId)}
          markSeen={markTrackSeen}
          registerRef={registerCardRef}
          onTrackPlay={(t) => { lastWatchedRef.current = t; onTrackPlay(t); }}
        />
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
          // Anchor above the bottom nav (~76px) plus the home-indicator
          // safe area. Replaces the old `bottom: 20%` magic which fought
          // both the nav and the system home indicator on tall phones.
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
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
              className="flex-1 bg-transparent text-white placeholder:text-white/30 focus:outline-none"
              // 16px floor prevents iOS zoom-on-focus.
              style={{ fontSize: 16 }}
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
                // Reserve width so Satoshi system fallback (≈25% wider during
                // Italianno FOUT on Android Chrome) doesn't push the close
                // button off-row before the swap settles.
                minWidth: '8rem',
                display: 'inline-block',
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
            className="rounded-full bg-white/10 flex items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
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
// TOP 10 SECTION — self-contained sub-component
// All countdown state/refs/effects live here so HomeFeed is NOT
// re-rendered every 2.4s during the auto-scroll countdown.
// ============================================

// Stable module-level style for Top10's vinyl artwork. Was inline at the
// SmartImage call site → new object reference every render → SmartImage's
// React.memo defeated → re-render cascaded into the IMG element → during
// box-shadow animation on the parent, the browser briefly invalidated
// the composited layer. Hoisting kills the re-render at the source.
const TOP10_ART_STYLE = { transform: 'scale(1.3)', objectPosition: 'center 35%' as const } as const;

interface Top10SectionProps {
  tracks: Track[];
  onTrackPlay: (track: Track, opts?: { openFull?: boolean }) => void;
}

const Top10Section = memo(({ tracks, onTrackPlay }: Top10SectionProps) => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [countdownActive, setCountdownActive] = useState(false);
  const countdownActiveRef = useRef(false); // sync guard — state update is async
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [isVisible, setIsVisible] = useState(false); // pauses decorative CSS animations off-screen
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [subtitleKey, setSubtitleKey] = useState(0);
  const scrollCooldownRef = useRef(false);
  const prevScrollRef = useRef<{ left: number; time: number } | null>(null);
  const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local-only horizontal scroll: center the target card inside the carousel
  // using scrollTo on the inner container. Previously used scrollIntoView,
  // which walks up through every ancestor scroller and pulls the outer feed
  // with it — produced a "drag-back" feel every time the countdown advanced.
  const centerCardInCarousel = useCallback((idx: number) => {
    const carousel = carouselRef.current;
    const card = cardRefs.current[idx];
    if (!carousel || !card) return;
    const left = card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2;
    carousel.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, []);

  // IntersectionObserver — tracks visibility for (a) gating the 4s dwell
  // countdown, (b) pausing the 22s header drift + bg pulse CSS animations
  // when off-screen (saves GPU/CPU across the feed, kills the reload-like
  // jank seen while scrolling away from and back to this section).
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let fired = false;
    let mounted = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!mounted) return;
        setIsVisible(entry.isIntersecting);
        if (entry.isIntersecting && !fired) {
          dwellTimerRef.current = setTimeout(() => {
            fired = true;
            countdownActiveRef.current = true;
            setCountdownActive(true);
            let currentIdx = 8;
            setActiveIdx(currentIdx);
            centerCardInCarousel(currentIdx);
            const interval = setInterval(() => {
              currentIdx -= 1;
              if (currentIdx < 0) { clearInterval(interval); return; }
              setActiveIdx(currentIdx);
              centerCardInCarousel(currentIdx);
            }, 2400);
            countdownIntervalRef.current = interval;
          }, 4000);
        } else if (!entry.isIntersecting) {
          if (dwellTimerRef.current) { clearTimeout(dwellTimerRef.current); dwellTimerRef.current = null; }
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => {
      mounted = false;
      observer.disconnect();
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [centerCardInCarousel]);

  // Subtitle flash — fires only on fast manual scroll of the carousel
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (countdownActive || countdownActiveRef.current) return;
    const now = Date.now();
    const currentLeft = e.currentTarget.scrollLeft;
    const prev = prevScrollRef.current;
    prevScrollRef.current = { left: currentLeft, time: now };
    if (!prev || scrollCooldownRef.current) return;
    const dt = now - prev.time;
    const dx = Math.abs(currentLeft - prev.left);
    if (dt > 0 && dt < 150 && dx > 80) {
      scrollCooldownRef.current = true;
      if (subtitleTimerRef.current) clearTimeout(subtitleTimerRef.current);
      subtitleTimerRef.current = setTimeout(() => {
        setSubtitleKey(k => k + 1);
        setTimeout(() => { scrollCooldownRef.current = false; }, 4200);
      }, 280);
    }
  }, [countdownActive]);

  return (
    <div ref={sectionRef} className={`mb-8 py-8 relative ${isVisible ? '' : 'top10-paused'}`} style={{ background: 'linear-gradient(180deg, rgba(6,6,9,1) 0%, rgba(139,92,246,0.08) 15%, rgba(139,92,246,0.06) 50%, rgba(139,92,246,0.12) 85%, rgba(6,6,9,0.95) 100%)' }}>
      <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-[#060609] to-transparent pointer-events-none z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none z-10" style={{ background: 'linear-gradient(to bottom, transparent, rgba(139,92,246,0.15))' }} />
      <div className="absolute inset-0 pointer-events-none top10-bg-glow" aria-hidden style={{ zIndex: 0 }} />
      <div className="relative px-4 mb-6" style={{ zIndex: 1 }}>
        <div className="overflow-hidden flex items-center gap-2">
          <h2 className="top10-header-scroll text-white font-semibold text-base whitespace-nowrap inline-block">VOYO Top 10</h2>
          {/* Live dot — single continuous slow breath. Always cycling
              (no countdown gating), so the dot never "kicks on/off" —
              just keeps tide-breathing whether the cards rotate or not.
              Asymmetric keyframe: faster gentle inhale (~30% of cycle),
              long slow exhale back to deep low (~70% of cycle). 7s
              cycle, range 0.12 → 0.68. Reads as living atmosphere. */}
          <span
            aria-hidden="true"
            className="inline-block rounded-full"
            style={{
              width: 6,
              height: 6,
              background: '#F4A23E',
              boxShadow: '0 0 6px rgba(244,162,62,0.45), 0 0 12px rgba(244,162,62,0.18)',
              animation: 'voyo-top10-live-breath 7s cubic-bezier(0.4, 0, 0.4, 1) infinite',
            }}
          />
        </div>
        <p
          key={subtitleKey}
          className={`text-[9px] tracking-widest uppercase mt-1${subtitleKey > 0 ? ' top10-subtitle-flash' : ''}`}
          style={{ fontFamily: 'Satoshi, system-ui, sans-serif', fontWeight: 700, opacity: subtitleKey > 0 ? undefined : 0 }}
        >
          This Week · VOYO Certified
        </p>
      </div>
      <style>{`
        /* Simplified — was -43% horizontal slide which read as performative
           "trying hard". Now a gentle ±8% breath, color subtly warms +
           cools. Premium = restraint. */
        @keyframes top10-header-drift {
          0%, 100%  { transform: translateX(0);    color: #fff; }
          50%       { transform: translateX(-8%);  color: rgba(220,167,75,0.92); }
        }
        .top10-header-scroll {
          animation: top10-header-drift 14s ease-in-out infinite;
        }
        /* Simplified — was 0.3↔1.0 opacity swing (dramatic). Now 0.55↔0.82,
           reads as ambient atmosphere instead of a pulsing strobe. */
        @keyframes top10-bg-pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.82; }
        }
        .top10-bg-glow {
          background: radial-gradient(ellipse 90% 70% at 50% 50%, rgba(139,92,246,0.2) 0%, rgba(139,92,246,0.07) 50%, transparent 80%);
          animation: top10-bg-pulse 14s ease-in-out infinite;
          /* will-change dropped — modern browsers GPU-promote opacity
             animations heuristically. Explicit pin kept the layer alive
             even when section was off-screen. */
        }
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
        /* Live dot — asymmetric breath cycle. Inhale is short and gentle
           (~30% of cycle, opacity rises from deep 0.12 to soft peak 0.68),
           exhale is long and slow (~70% of cycle, drifts back down to deep
           low). The deep low dwell at the bookends gives the cycle a clear
           rhythm — present then receding then present again, never a
           constant blink. Tuned per Dash: "smoother and deeper, cyclical". */
        @keyframes voyo-top10-live-breath {
          0%   { opacity: 0.12; }
          30%  { opacity: 0.68; }
          100% { opacity: 0.12; }
        }
        @keyframes top10-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .top10-scroll-title {
          display: inline-block;
          animation: top10-marquee 10s linear infinite;
          /* Promote to its own layer only while the marquee is mounted
             (class is conditionally applied based on overflow). Avoids
             scroll-jank on Android mid-tier from translating a non-
             promoted layer. */
          will-change: transform;
        }
        /* When Top 10 is off-screen, freeze all its decorative CSS
           animations. 22s infinite loops running across the whole feed
           while you scroll around were triggering GPU/layout jank that
           looked like reloads/glitches in neighboring sections. */
        .top10-paused .top10-header-scroll,
        .top10-paused .top10-bg-glow,
        .top10-paused .top10-scroll-title,
        .top10-paused .top10-subtitle-flash {
          animation-play-state: paused !important;
        }
      `}</style>
      <div
        ref={carouselRef}
        className="flex gap-6 px-4 overflow-x-auto scrollbar-hide"
        style={{ scrollSnapType: countdownActive ? 'none' : 'x proximity', overscrollBehaviorX: 'contain', paddingBottom: '60px', position: 'relative', zIndex: 1 }}
        onScroll={handleScroll}
      >
        {tracks.map((track, index) => {
          const maxChars = 12;
          const titleNeedsScroll = track.title.length > maxChars;
          const artistNeedsScroll = track.artist.length > maxChars;
          const isPodium = index < 3;
          const numberFill = index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : 'transparent';
          const numberStroke = index === 0 ? '#B8860B' : index === 1 ? '#808080' : index === 2 ? '#8B4513' : '#9D4EDD';
          const strokeWidth = isPodium ? '2px' : '3px';
          const numberGlow = index === 0 ? '0 0 30px rgba(255, 215, 0, 0.5)' : index === 1 ? '0 0 20px rgba(192, 192, 192, 0.4)' : index === 2 ? '0 0 20px rgba(205, 127, 50, 0.4)' : '0 0 25px rgba(157, 78, 221, 0.5), 3px 3px 0 rgba(0,0,0,0.6)';
          const isActive = countdownActive && activeIdx === index;
          return (
            <button
              key={track.id}
              ref={(el) => { cardRefs.current[index] = el; }}
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
                  // Static baseline glow only — the active-state energy is
                  // carried by the radial-blur halo + box-shadow on the disc.
                  // Animated text-shadow is never composited and was paying
                  // a per-frame paint cost on Android mid-tier.
                  textShadow: numberGlow,
                  fontFamily: 'Arial Black, sans-serif',
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
                    style={TOP10_ART_STYLE}
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
  );
});

// ============================================
// MEMO'D SHELF COMPONENTS
// Each shelf takes stable props (memoized arrays + stable callbacks) so
// HomeFeed's 30+ pieces of state churn stop cascading. A shelf only
// re-renders when its own prop slice actually changes.
// ============================================

interface KeepTheEnergyShelfProps {
  tracks: Track[];
  boostedIds: Set<string>;
  onPlay: (track: Track) => void;
  onPlaylist: (track: Track) => void;
}

const KeepTheEnergyShelf = memo(({ tracks, boostedIds, onPlay, onPlaylist }: KeepTheEnergyShelfProps) => (
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
      {tracks.map((track, i) => (
        <CardHoldActions key={track.id} track={track} onPlaylist={() => onPlaylist(track)}>
          <WideTrackCard track={track} onPlay={onPlay} showBoostBadge isBoosted={boostedIds.has(track.trackId)} breathIdx={i} />
        </CardHoldActions>
      ))}
    </div>
  </div>
));
KeepTheEnergyShelf.displayName = 'KeepTheEnergyShelf';

interface NextVoyageShelfProps {
  tracks: Track[];
  onPlay: (track: Track) => void;
  onPlaylist: (track: Track) => void;
}

// END-OF-RAIL DWELL: after the user scrolls to the final marker and it
// sits in view for 10s, the message fades out while the rail rubber-bands
// back — the "release pause" gesture from premium iOS apps, where a held
// element dissolves after you let go. Two orchestrated moves:
//   · scrollLeft eases back by the marker's width (700ms, material easing)
//   · marker opacity + max-width both fall to 0 (500ms, starts 200ms in)
// The offset gives a soft mask instead of a cliff.
const END_DWELL_MS = 10000;
const END_COLLAPSE_MS = 700;

const NextVoyageShelf = memo(({ tracks, onPlay, onPlaylist }: NextVoyageShelfProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state if the track set changes (new voyage = new chance
  // to see the message).
  useEffect(() => { setDismissed(false); }, [tracks]);

  useEffect(() => {
    if (dismissed) return;
    const el = endRef.current;
    if (!el) return;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    const obs = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (dwellTimer) return;
        dwellTimer = setTimeout(() => {
          // Rubber-band: start the scroll-back first, then collapse the
          // marker mid-ease so the two transitions chain into one smooth
          // release instead of a visible cliff.
          const container = scrollRef.current;
          const width = el.offsetWidth;
          if (container) {
            container.scrollTo({
              left: Math.max(0, container.scrollLeft - width),
              behavior: 'smooth',
            });
          }
          setTimeout(() => setDismissed(true), 200);
        }, END_DWELL_MS);
      } else {
        if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
      }
    }, { threshold: [0, 0.6, 0.9] });
    obs.observe(el);
    return () => {
      obs.disconnect();
      if (dwellTimer) clearTimeout(dwellTimer);
    };
  }, [dismissed]);

  return (
    <div className="mb-10">
      <div className="flex justify-between items-center px-4 mb-5">
        <h2 className="text-white font-semibold text-base">Next Voyage</h2>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-4 px-4 overflow-x-auto scrollbar-hide"
        style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
      >
        {tracks.map((track) => (
          <CardHoldActions key={track.id} track={track} onPlaylist={() => onPlaylist(track)}>
            <TrackCard track={track} onPlay={onPlay} />
          </CardHoldActions>
        ))}
        {/* End-of-rail marker — Apple-style two-line sign-off. Appears after
            the last card; dwells 10s in view then rubber-bands the rail
            back and masks itself off. */}
        <div
          ref={endRef}
          aria-hidden={dismissed}
          style={{
            flexShrink: 0,
            maxWidth: dismissed ? 0 : 180,
            opacity: dismissed ? 0 : 1,
            transition: `max-width ${END_COLLAPSE_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity 500ms ease-out`,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // Collapse the height with the width so a dismissed marker
            // doesn't leave an invisible 140px box blocking horizontal swipe.
            minHeight: dismissed ? 0 : 140,
          }}
        >
          <div className="text-center px-4 select-none pointer-events-none">
            <p
              className="leading-none"
              style={{
                fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
                fontStyle: 'italic',
                fontSize: 20,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.92)',
                letterSpacing: '-0.01em',
              }}
            >
              That&rsquo;s All
            </p>
            <p
              className="leading-none mt-1.5"
              style={{
                fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
                fontStyle: 'italic',
                fontSize: 14,
                fontWeight: 400,
                color: 'rgba(255,255,255,0.42)',
                letterSpacing: '-0.005em',
              }}
            >
              For Now
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});
NextVoyageShelf.displayName = 'NextVoyageShelf';

interface ArtistRadarShelfProps {
  artists: Array<{ name: string; tracks: Track[]; playCount: number }>;
  onPlay: (track: Track) => void;
}

const ArtistRadarShelf = memo(({ artists, onPlay }: ArtistRadarShelfProps) => (
  <div className="mb-10">
    <div className="px-4 mb-5">
      <h2 className="text-white font-semibold text-base">Your Artist Radar</h2>
    </div>
    <div className="flex gap-6 px-4 overflow-x-auto scrollbar-hide">
      {artists.map((artist) => (
        <ArtistCard key={artist.name} artist={artist} onPlay={onPlay} />
      ))}
    </div>
  </div>
));
ArtistRadarShelf.displayName = 'ArtistRadarShelf';

// ============================================
// HOME FEED COMPONENT
// ============================================

interface HomeFeedProps {
  onTrackPlay: (track: Track, options?: { openFull?: boolean }) => void;
  onSearch: () => void;
  onNavVisibilityChange?: (visible: boolean) => void;
  onSwitchToVOYO?: () => void;
}

export const HomeFeed = ({ onTrackPlay, onSearch, onNavVisibilityChange, onSwitchToVOYO }: HomeFeedProps) => {
  // Battery fix: fine-grained selectors
  // useShallow prevents memos from recalculating when array contents are the
  // same but the reference changed (e.g. Zustand spread on every play event).
  const history = usePlayerStore(useShallow(s => s.history));
  const hotTracks = usePlayerStore(useShallow(s => s.hotTracks));
  const discoverTracks = usePlayerStore(useShallow(s => s.discoverTracks));
  const refreshRecommendations = usePlayerStore(s => s.refreshRecommendations);
  const hotPool = useTrackPoolStore(useShallow(s => s.hotPool));
  const cachedTracks = useDownloadStore(useShallow(s => s.cachedTracks));
  // Set of boosted track IDs — OYE badge only shows on actually cached tracks
  const boostedIds = useMemo(() => new Set(cachedTracks.map(t => t.id)), [cachedTracks]);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<Track | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // OYÉ section header rotation. Stays as "OYÉ My People" (index 0)
  // for the first 5 minutes of the session — that's the user's
  // settling-in window. After that, every 40s the suffix shifts
  // through capitals + diaspora cities. Pauses while tab is hidden.
  const [oyeTitleIndex, setOyeTitleIndex] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let interval: ReturnType<typeof setInterval> | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let started = false;
    const start = () => {
      if (interval || !started) return;
      interval = setInterval(() => {
        setOyeTitleIndex(i => (i + 1) % OYE_TITLES.length);
      }, 40_000);
    };
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    startTimer = setTimeout(() => {
      started = true;
      if (!document.hidden) start();
    }, 5 * 60_000);
    const onVis = () => { document.hidden ? stop() : start(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (startTimer) clearTimeout(startTimer);
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, []);
  const oyeTitle = OYE_TITLES[oyeTitleIndex];
  const oyeTitleSuffix = oyeTitle.name;
  // Subtitle: "From {current} to {random sibling of same type}".
  // Anchor ('My People') keeps the original "From Lagos to Johannesburg".
  // useMemo picks a fresh sibling on each index change so the journey
  // varies but never lands on the same destination as the source.
  const oyeSubtitle = useMemo(() => {
    if (oyeTitle.type === 'anchor') return 'From Lagos to Johannesburg';
    const siblings = OYE_SIBLINGS[oyeTitle.type].filter(s => s !== oyeTitle.name);
    if (siblings.length === 0) return `From ${oyeTitle.name}`;
    const to = siblings[Math.floor(Math.random() * siblings.length)];
    return `From ${oyeTitle.name} to ${to}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oyeTitleIndex]);
  const [boostSettingsOpen, setBoostSettingsOpen] = useState(false);
  // Session seed drives shelf rotation — every reload / pull-to-refresh gets
  // a fresh number, so shelves surface different tracks from the big pool
  // without losing stability WITHIN a single session.
  const [sessionSeed] = useState(() => Date.now());

  // Stations — curator-led vibe hubs, shown as a horizontal snap-scroll rail
  // above the shelves. Rail animates parallax on scroll when >1 station.
  // stationsLoading gates a skeleton rail while the query is in flight so
  // users on slow networks see continuity instead of a ghost gap that
  // jolts into content 2-3s later.
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  // STATIONS + VIBES DISABLED 2026-04-26 — both relaunching as weekend
  // moments. Code paths intact (Supabase fetch + hero cards for Stations,
  // VibesReel for Vibes); just held back from default Home rendering.
  // Re-enable: flip the corresponding _LIVE constant to true.
  // Per-shelf testing override:
  //   ?stations=1 | localStorage 'voyo-stations-on'='1' → stations on
  //   ?vibes=1    | localStorage 'voyo-vibes-on'='1'    → vibes on
  const STATIONS_LIVE = false;
  const VIBES_LIVE = false;
  const stationsEnabled = useMemo(() => {
    if (STATIONS_LIVE) return true;
    if (typeof window === 'undefined') return false;
    try {
      if (new URLSearchParams(window.location.search).has('stations')) return true;
      if (localStorage.getItem('voyo-stations-on') === '1') return true;
    } catch { /* private mode — fall through */ }
    return false;
  }, []);
  const vibesEnabled = useMemo(() => {
    if (VIBES_LIVE) return true;
    if (typeof window === 'undefined') return false;
    try {
      if (new URLSearchParams(window.location.search).has('vibes')) return true;
      if (localStorage.getItem('voyo-vibes-on') === '1') return true;
    } catch { /* private mode — fall through */ }
    return false;
  }, []);
  useEffect(() => {
    if (!stationsEnabled) { setStationsLoading(false); return; }
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
  }, [stationsEnabled]);

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

    // Pure ring system — no aura pointer. Rings only.
    // Sail ripple: trail rings on move, sonar pulse on hold, burst on lift.
    let lastRingX = 0, lastRingY = 0, lastRingTime = 0;
    let holdX = 0, holdY = 0;
    let touching = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let holdInterval: ReturnType<typeof setInterval> | null = null;
    const ringTimers: ReturnType<typeof setTimeout>[] = [];

    const color = () => {
      const frac = scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight);
      return frac < 0.3 ? 'rgba(212,160,83,' : 'rgba(139,92,246,';
    };

    const spawnRing = (x: number, y: number, kind: 'tap' | 'trail' | 'burst' | 'hold') => {
      const c = color();
      const wrap = document.createElement('div');
      Object.assign(wrap.style, {
        position: 'fixed', left: `${x}px`, top: `${y}px`,
        width: '8px', height: '8px', marginLeft: '-4px', marginTop: '-4px',
        borderRadius: '50%', pointerEvents: 'none',
      });
      const inner = document.createElement('div');
      // Durations tuned for natural water: slightly longer = more breath
      const [anim, dur] =
        kind === 'tap'   ? ['voyo-ring-tap',   640]  :
        kind === 'trail' ? ['voyo-ring-trail',  560]  :
        kind === 'hold'  ? ['voyo-ring-hold',  2000]  :
                           ['voyo-ring-burst',  800];
      const alpha =
        kind === 'trail' ? '0.16)' :
        kind === 'tap'   ? '0.22)' :
        kind === 'hold'  ? '0.18)' :
                           '0.24)';
      Object.assign(inner.style, {
        width: '100%', height: '100%', borderRadius: '50%',
        border: `1px solid ${c}${alpha}`,
        animation: `${anim} ${dur}ms cubic-bezier(0,0.35,0.25,1) forwards`,
        willChange: 'transform, opacity',
      });
      wrap.appendChild(inner);
      host.appendChild(wrap);
      ringTimers.push(setTimeout(() => wrap.remove(), dur + 20));
    };

    const cancelHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
    };

    const startHoldPulse = () => {
      spawnRing(holdX, holdY, 'hold');
      holdInterval = setInterval(() => spawnRing(holdX, holdY, 'hold'), 900);
    };

    const onTouchStart = (e: TouchEvent) => {
      const tgt = e.target as HTMLElement;
      // Skip ripple inside form fields only. The data-no-ripple
      // suppression on vibes/stations was reverted in v619 — once we
      // landed contain:paint + the VoyoLiveCard 4Hz cascade fix, the
      // perceived "glitch on rails" turned out to be the cascade, not
      // the ripples. Ripples are part of the home rhythm; they belong
      // everywhere on the feed canvas.
      if (tgt.closest('input,select,textarea,[contenteditable="true"]')) return;
      const t = e.touches[0];
      holdX = t.clientX; holdY = t.clientY;
      lastRingX = t.clientX; lastRingY = t.clientY; lastRingTime = Date.now();
      touching = true;
      cancelHold();
      spawnRing(t.clientX, t.clientY, 'tap');
      holdTimer = setTimeout(startHoldPulse, 220);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touching) return;
      const t = e.touches[0];
      holdX = t.clientX; holdY = t.clientY;
      // Any movement resets the hold timer — keeps hold tied to stillness
      cancelHold();
      holdTimer = setTimeout(startHoldPulse, 220);
      // Sail ripple — denser trail for fluid feel
      const dx = t.clientX - lastRingX, dy = t.clientY - lastRingY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const now = Date.now();
      if (dist > 18 && now - lastRingTime > 35) {
        spawnRing(t.clientX, t.clientY, 'trail');
        lastRingX = t.clientX; lastRingY = t.clientY; lastRingTime = now;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!touching) return;
      touching = false;
      cancelHold();
      spawnRing(e.changedTouches[0].clientX, e.changedTouches[0].clientY, 'burst');
    };

    scroll.addEventListener('touchstart', onTouchStart, { passive: true });
    scroll.addEventListener('touchmove', onTouchMove, { passive: true });
    scroll.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      touching = false;
      cancelHold();
      scroll.removeEventListener('touchstart', onTouchStart);
      scroll.removeEventListener('touchmove', onTouchMove);
      scroll.removeEventListener('touchend', onTouchEnd);
      ringTimers.forEach(clearTimeout);
    };
  }, []);

  // Audio-reactive ambient glow — reads CSS vars written by freqPump (10fps),
  // drives a soft radial pulse behind the feed. Zero React re-renders.
  // (audit-3) Subscribe to isPlaying so the rAF starts/stops at the
  // playing transition instead of running forever and early-returning
  // 60×/sec when paused. Mirrors freqPump's pattern. Cost when paused
  // = 0 frames; previous version burned 60 wakeups/sec into the
  // early-return path.
  const isPlayingForGlow = usePlayerStore(s => s.isPlaying);
  useEffect(() => {
    const glow = audioGlowRef.current;
    if (!glow) return;
    if (!isPlayingForGlow) {
      if (glow.style.opacity !== '0') glow.style.opacity = '0';
      return;
    }
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
  }, [isPlayingForGlow]);

  // Track scroll position for gesture overscroll detection. Throttled
  // via rAF so the layout-forcing reads (scrollTop/scrollHeight/clientHeight)
  // happen at most once per frame instead of on every scroll event
  // (60+/sec during fast scroll). Reading these properties forces the
  // browser to flush pending layout — was a hot source of scroll jank.
  const scrollRafRef = useRef<number | null>(null);
  const handleFeedScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = feedScrollRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      feedAtTopRef.current = scrollTop < 8;
      feedAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 8;
    });
  }, []);
  // Cleanup any pending rAF on unmount.
  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
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
    // Top overscroll (pull-down at top) → portal back to VOYO player
    if (feedAtTopRef.current && overscrollYRef.current < -52) {
      onSwitchToVOYO?.();
    }
    overscrollYRef.current = 0;
  }, [onSwitchToVOYO]);

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
  // Sliced views — stable references for memo'd shelf components. Without
  // these, `.slice(0,12)` inline at the JSX site would create a fresh array
  // every render and break the shelf's React.memo compare.
  const recentlyPlayed12 = useMemo(() => recentlyPlayed.slice(0, 12), [recentlyPlayed]);
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
    () => pools.discovery.slice(0, 25),
    [pools.discovery],
  );
  // Top-21 sliced view for the Next Voyage shelf — stable ref for memo.
  // 21 cards give the rail enough depth to feel immersive before the
  // "That's All / For Now" sign-off lands.
  const discoverMoreTracks21 = useMemo(() => discoverMoreTracks.slice(0, 21), [discoverMoreTracks]);

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
  // Stable 10-card slice so Top10Section's memo holds across HomeFeed
  // re-renders. Without this, `trending.slice(0, 10)` inline at the JSX
  // returned a new array reference every render → memo defeated → all 10
  // Top10 cards re-rendered → the brief artwork "reload" Dash flagged
  // (memo defeat ripples down through SmartImage's inline style props).
  const trendingTop10 = useMemo(() => trending.slice(0, 10), [trending]);

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
    {/* Ripple host — fixed viewport layer, receives imperatively added ripple divs.
        zIndex 5 sits above feed content (z 0-1) but below sticky header (z-10),
        bottom nav (z-50), AccountMenu (z-56), and DynamicIsland chrome. */}
    <div ref={rippleHostRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5 }} aria-hidden>
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
          0%   { transform: scale(0); opacity: 0.22; }
          100% { transform: scale(28); opacity: 0; }
        }
        @keyframes voyo-ring-trail {
          0%   { transform: scale(0); opacity: 0.16; }
          100% { transform: scale(24); opacity: 0; }
        }
        @keyframes voyo-ring-burst {
          0%   { transform: scale(0); opacity: 0.24; }
          100% { transform: scale(36); opacity: 0; }
        }
        @keyframes voyo-ring-hold {
          0%   { transform: scale(0); opacity: 0.18; }
          100% { transform: scale(54); opacity: 0; }
        }
      `}</style>
    </div>
    {/* Loop fade overlay — above ripple host (6 > 5) but below sticky header (z-10),
        bottom nav (z-50), AccountMenu (z-56), and DynamicIsland chrome so the loop
        transition never veils navigation. */}
    <div ref={loopFadeOverlayRef} style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 6,
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
      {/* Header — fully transparent, floats over the continuous canvas.
          The "D" profile button opens the AccountMenu (profile / settings /
          sign out). Dahub stays reachable via the bottom nav. */}
      <header
        className="flex items-center justify-between px-4 py-3 sticky top-0 bg-transparent z-10"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <button
          className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white font-bold active:scale-95 transition-transform"
          onClick={() => setAccountMenuOpen(true)}
          aria-label="Account menu"
        >
          D
        </button>
        <div className="flex items-center gap-2">
          <button
            aria-label="Search"
            className="rounded-full bg-white/10 hover:bg-white/20 inline-flex items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
            onClick={onSearch}
          >
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
          Extracted to memo'd shelf so HomeFeed state churn (scroll, vibes,
          classics, etc.) doesn't cascade-rerender these 12 cards. */}
      {hasHistory && (
        <KeepTheEnergyShelf
          tracks={recentlyPlayed12}
          boostedIds={boostedIds}
          onPlay={playTrack}
          onPlaylist={setPlaylistModalTrack}
        />
      )}

      {/* ═══ CLASSICS — always visible, one fixed position after history/SignIn ═══ */}
      <Safe name="Classics">
        {classicsTracks.length > 0 && (
          <div
            className="mb-10 pt-12 pb-12 relative overflow-hidden"
            style={{
              background: 'radial-gradient(ellipse 120% 80% at 30% 0%, rgba(212,160,83,0.18) 0%, rgba(212,160,83,0.07) 45%, transparent 75%)',
              // contain:paint scopes the disc-drift, disc-spin, glow-pulse
              // and subtitle shimmer animations to this section. Their
              // paint cascades can no longer leak into the Vibes /
              // Stations rails below. pt/pb-12 (was -10) gives the
              // selected-disc 56px outer-glow room to render without
              // clipping at the section edges.
              contain: 'paint',
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
                /* will-change removed — disks live in a horizontal scroll
                   that's often half off-screen; pinned GPU layers were
                   keeping ~10 disks composited even when invisible. */
              }
              @keyframes classics-disk-spin {
                from { transform: rotate(0deg); }
                to   { transform: rotate(360deg); }
              }
              .classics-disk-spin {
                animation: classics-disk-spin 3.6s linear infinite;
                /* will-change removed — same off-screen reason as drift. */
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
                0%   { background-position: 60% center; }
                22%  { background-position: 0% center; }
                100% { background-position: 0% center; }
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

            {/* Gold hairline top — wider inset on tablet+ to avoid the
                disconnected-slash look on >768px viewports. */}
            <div className="absolute top-0 left-8 right-8 md:left-12 md:right-12 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,83,0.4), rgba(230,184,101,0.75), rgba(212,160,83,0.4), transparent)' }} />
            {/* Gold hairline bottom */}
            <div className="absolute bottom-0 left-8 right-8 md:left-12 md:right-12 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,83,0.25), rgba(230,184,101,0.5), rgba(212,160,83,0.25), transparent)' }} />

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
                {/* Two layered effects fuse the header into the shelf:
                    · background stack — repeating 1px warm-white striation
                      (rgba(255,250,235,0.04) every 4px at 98°) painted BEHIND
                      the gold gradient inside the text-clip. Clipped to the
                      glyphs so it reads as brushed-gold grain, not as a box.
                    · filter stack — two additional drop-shadows. The 24px
                      warm-ivory halo traces the letter shape (not a
                      rectangle) at 18% alpha; the 38px bloom extends it at
                      8%. Because drop-shadow uses alpha, the shadow is
                      exactly the text outline — the glow reads as part of
                      the gold itself, not a layer sitting behind it. */}
                <h2
                  className="leading-none"
                  style={{
                    fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
                    fontStyle: 'italic',
                    fontSize: 24,
                    fontWeight: 400,
                    background: [
                      'repeating-linear-gradient(98deg, rgba(255,250,235,0.04) 0 1px, transparent 1px 4px),',
                      'linear-gradient(100deg, #F4D999 0%, #E6B865 40%, #C4943D 100%)',
                    ].join(' '),
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: [
                      'drop-shadow(0 1px 4px rgba(0,0,0,0.6))',
                      'drop-shadow(0 0 14px rgba(212,160,83,0.2))',
                      'drop-shadow(0 0 24px rgba(255,248,232,0.18))',
                      'drop-shadow(0 0 38px rgba(255,248,232,0.08))',
                    ].join(' '),
                    opacity: 0.93,
                  }}
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
                    opacity: 0.93,
                  }}
                >
                  {'African Bangers · '}<b style={{ fontWeight: 800 }}>VOYO Certified</b>
                </p>
              </div>
            </div>

            {/* Disk carousel */}
            <div className="relative">
              {/* RR Roof fades — scintillent white ↔ gold bronze */}
              {/* Side fades narrowed (52→32) so the first/last disk's
                  initials and title don't get partially veiled on iPhone SE. */}
              <div className="absolute top-0 bottom-0 left-0 pointer-events-none rr-fade-shimmer" style={{ width: 32, background: 'linear-gradient(to right, rgba(255,251,240,0.18) 0%, rgba(230,184,101,0.10) 50%, transparent 100%)', zIndex: 2 }} />
              <div className="absolute top-0 bottom-0 right-0 pointer-events-none rr-fade-shimmer" style={{ width: 32, background: 'linear-gradient(to left, rgba(255,251,240,0.18) 0%, rgba(230,184,101,0.10) 50%, transparent 100%)', zIndex: 2, animationDelay: '2.5s' }} />
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
                          {/* Drop the scale(1.3) zoom — at 38px the YouTube
                              thumbnail aliases on high-DPI screens. The 'high'
                              quality + native fit reads sharper. */}
                          <SmartImage src={getThumb(track.trackId, 'high')} alt={track.title} className="w-full h-full object-cover" trackId={track.trackId} artist={track.artist} title={track.title} />
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
          purple Open VOYO morph. Header stays clean, CTA earns the scroll.
          contain:paint scopes the AfricanVibesVideoCard iframe loads + the
          carousel's bronze breath animations to this section. */}
      <div className="mt-5 mb-10" style={{ contain: 'paint' }}>
        <div className="px-4 mb-5 flex items-center gap-3">
          <AfricaIcon size={36} />
          <div className="flex-1">
            <h2
              className="text-white text-[22px] leading-none"
              style={{ fontWeight: 800, letterSpacing: '-0.01em' }}
            >
              OYÉ{' '}
              {/* Suffix crossfades on each rotation — `key` change
                  remounts the span so the fade-in animation re-runs.
                  Subtle: 600ms ease-out, no scale/translate. */}
              <span
                key={oyeTitleSuffix}
                style={{
                  display: 'inline-block',
                  animation: 'voyo-oye-suffix-fade 600ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {oyeTitleSuffix}
              </span>
            </h2>
            <p
              key={oyeSubtitle}
              className="text-[9px] font-medium tracking-wider uppercase mt-1.5"
              style={{
                background: 'linear-gradient(90deg, #D4A053 0%, #C4943D 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                opacity: 0.85,
                animation: 'voyo-oye-suffix-fade 700ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {oyeSubtitle}
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
                // textShadow removed — paired with WebkitTextStroke on a
                // transparent fill it produced a ghosted second outline on
                // Safari 14. The stroke alone reads correctly everywhere.
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
          last click + time-of-session context. Memo'd shelf — HomeFeed
          churn doesn't bleed into the 12-card map. */}
      {hasDiscoverMore && (
        <NextVoyageShelf
          tracks={discoverMoreTracks21}
          onPlay={playTrackFull}
          onPlaylist={setPlaylistModalTrack}
        />
      )}


      {/* Top 10 on VOYO — state/countdown fully isolated in Top10Section.
          contain:paint scopes the countdown's text-shadow + box-shadow
          animations to this section so they can't cascade into Vibes/
          Stations below during the countdown sequence. */}
      {hasTrending && (
        <div style={{ contain: 'paint' }}>
          <Top10Section tracks={trendingTop10} onTrackPlay={onTrackPlay} />
        </div>
      )}

      {/* Vibes reel — disabled 2026-04-26 (relaunching with stations as
          weekend special). Re-enable via VIBES_LIVE=true OR ?vibes=1. */}
      {vibesEnabled && (
        <div className="mb-12" style={{ contain: 'paint' }}>
          <div className="px-4 mb-1.5">
            <h2 className="text-white font-semibold text-base">Vibes</h2>
          </div>
          <Safe name="VibesReel"><VibesReel vibes={vibes} onOpenVibe={handleVibeSelect} /></Safe>
        </div>
      )}

      {/* Stations rail — DJ-curated vibes (deeper commitment than Vibes buttons).
          Horizontal snap-scroll. Cards autoplay muted; 7s dwell fades audio in
          (iOS shows "Tap to hear"); tap commits to deck + R2 audio.
          Skeleton row renders while the query is in flight to kill the
          "ghost-then-jolt" layout shift on slow networks. */}
      {!stationsEnabled ? null : stationsLoading && stations.length === 0 ? (
        <div className="mb-12 -mx-1" aria-busy="true" aria-label="Loading stations">
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
          {/* mb-12 matches Vibes + OYO's Picks bookend rhythm — stations no
              longer feels cramped against neighbours.
              snap-proximity (was snap-mandatory) follows the gesture
              intent — soft drag stays where you let go, hard flick still
              snaps. Mandatory was forcing every micro-scroll to commit.
              contain:paint scopes paint cascades — see Vibes section above. */}
          <div className="mb-12 -mx-1" style={{ contain: 'paint' }}>
            <div className="flex gap-3 overflow-x-auto snap-x snap-proximity scrollbar-hide px-4 pb-2">
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

      {/* Your Artist Radar — personal-history shelf, lives at the bottom
          as a closing beat. Memo'd — only rerenders when artistsYouLove or
          playTrack identity actually changes. */}
      {hasArtists && (
        <ArtistRadarShelf artists={artistsYouLove} onPlay={playTrack} />
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

      {/* Account menu — anchored under the header D button. Hosts profile
          navigation + settings + sign-in/out. */}
      <AccountMenu
        isOpen={accountMenuOpen}
        onClose={() => setAccountMenuOpen(false)}
        onOpenSettings={() => setBoostSettingsOpen(true)}
      />

      {/* Boost settings — opened from AccountMenu's "Settings" row. Same
          modal VoyoPortraitPlayer uses; single source of settings truth. */}
      <BoostSettings
        isOpen={boostSettingsOpen}
        onClose={() => setBoostSettingsOpen(false)}
      />
    </div>
    </>
  );
};

export default HomeFeed;
