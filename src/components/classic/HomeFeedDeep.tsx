/**
 * HomeFeedDeep — the second surface of Home.
 *
 * Everything below the Vibes seam: Stations rail, OYO's Picks, Your
 * Artist Radar, Empty State. Completely isolated from HomeFeed —
 * subscribes to its own stores, computes its own derived state,
 * fetches its own remote data (stations).
 *
 * Loaded via React.lazy from HomeFeed once the user scrolls within
 * one viewport of the seam — Stations no longer mounts on first paint,
 * which was the dominant cold-load glitch source. The morphy fade-in
 * is applied at the parent (HomeFeed) Suspense boundary.
 *
 * Props are deliberately minimal: only the navigation callbacks. All
 * the data plumbing is internal so the parent doesn't churn re-renders
 * into this surface.
 */

import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { useShallow } from 'zustand/shallow';
import { Play } from 'lucide-react';
import { devWarn } from '../../utils/logger';
import { getThumb } from '../../utils/thumbnail';
import { SmartImage } from '../ui/SmartImage';
import { Safe } from '../ui/Safe';
import { TrackCardGestures } from '../ui/TrackCardGestures';
import { StationHero, type Station } from './StationHero';
import { supabase } from '../../lib/supabase';
import { usePlayerStore } from '../../store/playerStore';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { usePools } from '../../services/oyo';
import { getInsights as getOyoInsights } from '../../services/oyoDJ';
import { getPoolAwareHotTracks } from '../../services/personalization';
import type { HistoryItem } from '../../types';
import type { Track } from '../../types';

// ============================================
// LOCAL HELPERS — moved from HomeFeed
// ============================================

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
      tracks: pool.filter(t => typeof t.artist === 'string' && t.artist.toLowerCase().includes(name.toLowerCase())).slice(0, 5),
    }))
    .filter(a => a.tracks.length > 0)
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, limit);
};

// ============================================
// CENTER-FOCUSED CAROUSEL — used by OYO's Picks
// ============================================

interface CenterCarouselProps {
  tracks: Track[];
  onPlay: (track: Track) => void;
  onDiscover?: () => void;
}

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
  const safeTracks = useMemo(
    () => (Array.isArray(tracks) ? tracks.filter(t => t && t.id) : []),
    [tracks],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [centerIndex, setCenterIndex] = useState(0);
  const [scrollState, setScrollState] = useState<'left-end' | 'scrolling' | 'right-end'>('left-end');
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
      {scrollState === 'left-end' && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <VoyoScatter />
        </div>
      )}

      {scrollState === 'scrolling' && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <PulsingCircle />
        </div>
      )}

      {scrollState === 'right-end' && (
        <div className={`absolute right-4 top-1/2 -translate-y-1/2 z-10 ${onDiscover ? 'pointer-events-auto' : 'pointer-events-none'}`}>
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
          scrollSnapType: 'x proximity',
          paddingLeft: `calc(50% - ${CARD_W / 2}px)`,
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
// ARTIST CARD + RADAR SHELF
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
// HomeFeedDeep — the second surface
// ============================================

interface HomeFeedDeepProps {
  onSearch: () => void;
  onTrackPlay: (track: Track, options?: { openFull?: boolean }) => void;
}

export const HomeFeedDeep = ({ onSearch, onTrackPlay }: HomeFeedDeepProps) => {
  // Stable session seed — own copy so we don't depend on parent.
  const [sessionSeed] = useState(() => Date.now());

  // Store subscriptions — narrow selectors to keep this surface decoupled.
  const history = usePlayerStore(useShallow(s => s.history));
  const playTrack = usePlayerStore(s => s.playTrack);
  const trackPreferences = usePreferenceStore(state => state.trackPreferences);
  const hotPool = useTrackPoolStore(useShallow(s => s.hotPool));
  const pools = usePools(sessionSeed);

  // Stations — own fetch, own state, own loading.
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const stationsEnabled = useMemo(() => {
    if (typeof window === 'undefined') return true;
    try {
      if (new URLSearchParams(window.location.search).has('nostations')) return false;
      if (localStorage.getItem('voyo-stations-off') === '1') return false;
    } catch { /* private mode — fall through */ }
    return true;
  }, []);
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

  // Derived values — owned here, not parent.
  const artistsYouLove = useMemo(
    () => getArtistsYouLove(history, hotPool, 8),
    [history, hotPool],
  );
  const discoverMoreTracks = useMemo(
    () => pools.discovery.slice(0, 25),
    [pools.discovery],
  );
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
      devWarn('[HomeFeedDeep] oyosPicks failed:', e);
      return [];
    }
  }, [pools.hot, discoverMoreTracks]);

  const recentlyPlayed = useMemo(() => {
    const m = new Map<string, Track>();
    for (const item of history) if (item.track?.id && !m.has(item.track.id)) m.set(item.track.id, item.track);
    return Array.from(m.values());
  }, [history]);

  const hasArtists = artistsYouLove.length > 0;
  const hasHistory = recentlyPlayed.length > 0;
  const hasPreferences = Object.keys(trackPreferences).length > 0;

  return (
    <>
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

      {/* OYO's Picks — OYO-curated surface, the app's voice in the feed. */}
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
          as a closing beat. */}
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
              const poolTracks = hotPool.length > 0 ? hotPool : getPoolAwareHotTracks(15);
              const randomTrack = poolTracks[0];
              if (randomTrack) onTrackPlay(randomTrack);
            }}
          >
            Discover Music
          </button>
        </div>
      )}
    </>
  );
};

export default HomeFeedDeep;
