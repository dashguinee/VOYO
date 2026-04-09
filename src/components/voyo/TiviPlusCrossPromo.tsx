/**
 * TIVI+ Cross-Promo Section - VOYO Homepage
 *
 * Purpose: Break the "YouTube skin" illusion by showing exclusive content
 * Cross-promotes DASH WebTV (TIVI+) within the music app
 *
 * Sections:
 * 1. Featured Banner (Spider-Verse) - Hero teaser
 * 2. Trending on TIVI+ - Movie posters (distinct from music cards)
 * 3. Live TV - Billboard cards with carousel channel names (DASH WebTV style)
 *    - +32,000+ channels shown in header
 *    - Each card shows scrolling channel offerings
 *    - More channels = faster carousel animation
 * 4. BACK TO THE MUSIC divider
 * 5. All Time Classics - Portal vinyl disks (small → large → fade) with thumbnails
 * 6. West African Hits - Regular cards with static curated data (OG style)
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Play, ExternalLink, Tv, Radio, Star, Music, Globe, Wifi } from 'lucide-react';
import { TRACKS } from '../../data/tracks';
import { Track } from '../../types';
import { useTrackPoolStore } from '../../store/trackPoolStore';
import { getThumb } from '../../utils/thumbnail';
import { SmartImage } from '../ui/SmartImage';

// ============================================
// TIVI+ CONTENT DATA
// ============================================

const TIVI_PLUS_BASE = 'https://dash-webtv.vercel.app';

// Trending Movies/Shows - Real TMDB posters
const TRENDING_TIVI = [
  { id: '184534', title: 'Spider-Verse', poster: 'https://image.tmdb.org/t/p/w500/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg', rating: '8.5' },
  { id: '134971', title: 'The Dark Knight', poster: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg', rating: '8.5' },
  { id: '139211', title: 'Puss in Boots', poster: 'https://image.tmdb.org/t/p/w500/kuf6dutpsT0vSVehic3EZIqkOBt.jpg', rating: '8.6' },
  { id: '77338', title: 'Intouchables', poster: 'https://image.tmdb.org/t/p/w500/i97FM40bOMKvKIo3hjQviETE5yf.jpg', rating: '8.3' },
  { id: '134956', title: 'LOTR: Return', poster: 'https://image.tmdb.org/t/p/w500/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg', rating: '8.5' },
  { id: '101', title: 'Léon', poster: 'https://image.tmdb.org/t/p/w500/bxB2q91nKYp8JNzqE7t7TWBVupB.jpg', rating: '8.3' },
];

// Live TV Categories - Billboard style with channel offerings
// Icons: 'emoji' for simple, 'broadcast' for News (animated), 'tv' for Series
const LIVE_TV_CATEGORIES = [
  {
    id: 'sports', name: 'SPORTS', icon: '⚽', iconType: 'emoji', color: '#22c55e',
    channels: ['BeIN Sports', 'TNT Sports', 'NFL Network', 'La Liga TV', 'ESPN', 'Sky Sports', 'DAZN', 'Eurosport', 'Fox Sports', 'NBA TV'],
  },
  {
    id: 'movies', name: 'MOVIES', icon: '🎬', iconType: 'emoji', color: '#a855f7',
    channels: ['HBO', 'Cinemax', 'Showtime', 'Starz', 'AMC', 'TCM', 'Canal+', 'Sky Cinema', '57K+ titles'],
  },
  {
    id: 'series', name: 'SERIES', icon: 'tv', iconType: 'lucide', color: '#ec4899',
    channels: ['Netflix Originals', 'HBO Max', 'Apple TV+', 'Prime Video', 'Hulu', 'Disney+', '14K+ shows'],
  },
  {
    id: 'news', name: 'NEWS', icon: 'broadcast', iconType: 'broadcast', color: '#3b82f6',
    channels: ['CNN', 'BBC World', 'Al Jazeera', 'France 24', 'Sky News', 'Euronews', 'DW', 'CNBC', 'Bloomberg'],
  },
  {
    id: 'kids', name: 'KIDS', icon: '🎈', iconType: 'emoji', color: '#f472b6',
    channels: ['Cartoon Network', 'Nickelodeon', 'Disney', 'Boomerang', 'Nick Jr', 'PBS Kids', 'Baby TV'],
  },
  {
    id: 'docs', name: 'DOCS', icon: '🎥', iconType: 'emoji', color: '#06b6d4',
    channels: ['Discovery', 'Nat Geo', 'History', 'Animal Planet', 'BBC Earth', 'Vice', 'Smithsonian'],
  },
];

// Broadcast Icon Component - Animated signal waves
const BroadcastIcon = ({ color }: { color: string }) => (
  <div className="relative w-6 h-6 flex items-center justify-center">
    {/* Globe/Africa base */}
    <Globe className="w-4 h-4" style={{ color }} />
    {/* Animated broadcast waves */}
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute rounded-full border animate-ping"
          style={{
            borderColor: `${color}60`,
            width: 16,
            height: 16,
            animationDelay: `${i * 0.5}s`,
            animationDuration: '1.5s',
          }}
        />
      ))}
    </div>
  </div>
);

// Premium TV Icon for Series
const SeriesIcon = ({ color }: { color: string }) => (
  <div className="relative">
    <Tv className="w-5 h-5" style={{ color }} />
    <div
      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse"
      style={{ backgroundColor: color }}
    />
  </div>
);

// Total channel count for header
const TOTAL_LIVE_CHANNELS = '32,000+';

// Featured Banner
const FEATURED_BANNER = {
  title: 'Spider-Man: Across the Spider-Verse',
  subtitle: 'The Multiverse Awaits - Stream Now on TIVI+',
  backdrop: 'https://image.tmdb.org/t/p/w1280/4HodYYKEIsGOdinkGi2Ucz6X9i0.jpg',
  streamId: '184534',
};

// West African Hits - Now pulled from pool (DJ fills this)

// ============================================
// COMPONENTS
// ============================================

// Movie Poster Card - Distinct from music (taller, cleaner)
const MoviePosterCard = ({ movie, onClick }: { movie: typeof TRENDING_TIVI[0]; onClick: () => void }) => (
  <button
    className="flex-shrink-0 relative rounded-lg overflow-hidden shadow-lg"
    style={{ width: 100, height: 150 }}
    onClick={onClick}
  >
    <img src={movie.poster} alt={movie.title} className="w-full h-full object-cover" loading="lazy" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
    <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[8px] font-bold text-amber-400 flex items-center gap-0.5">
      <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
      {movie.rating}
    </div>
    <div className="absolute bottom-0 left-0 right-0 p-2">
      <p className="text-[9px] font-bold text-white truncate">{movie.title}</p>
    </div>
  </button>
);

// Live TV Billboard Card - DASH WebTV Experiences style with carousel channels
const LiveTVBox = ({ category, onClick }: { category: typeof LIVE_TV_CATEGORIES[0]; onClick: () => void }) => {
  // Create channel carousel text - more channels = faster animation
  const channelText = category.channels.join(' • ');
  const animationDuration = Math.max(8, 20 - category.channels.length); // More channels = faster

  // Render the appropriate icon based on type
  const renderIcon = () => {
    if (category.iconType === 'broadcast') {
      return <BroadcastIcon color={category.color} />;
    } else if (category.iconType === 'lucide') {
      return <SeriesIcon color={category.color} />;
    } else {
      return <span className="text-xl">{category.icon}</span>;
    }
  };

  return (
    <button
      className="flex-shrink-0 relative rounded-xl overflow-hidden transition-transform duration-250"
      style={{
        width: 150,
        height: 100,
        background: `linear-gradient(135deg, ${category.color}20 0%, ${category.color}10 50%, transparent 100%)`,
        border: `1px solid ${category.color}25`,
      }}
      onClick={onClick}
    >
      {/* Radial glow background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{ background: `radial-gradient(circle at 30% 30%, ${category.color}30 0%, transparent 60%)` }}
      />

      {/* LIVE badge - top right */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg, #FF006E 0%, #E50040 100%)' }}>
        <div
          className="w-1 h-1 rounded-full bg-white animate-pulse"
        />
        <span className="text-[6px] font-bold text-white tracking-wider">LIVE</span>
      </div>

      {/* Icon + Name - left aligned like DASH WebTV */}
      <div className="absolute top-2.5 left-3 flex items-center gap-2">
        {renderIcon()}
        <span className="text-xs font-bold text-white">{category.name}</span>
      </div>

      {/* Carousel channels - scrolling text */}
      <div className="absolute bottom-2.5 left-0 right-0 overflow-hidden">
        <div
          className="whitespace-nowrap text-[8px] text-white/60 font-medium px-3"
          style={{
            animation: `voyo-marquee ${animationDuration}s linear infinite`,
          }}
        >
          {channelText} • {channelText}
        </div>
      </div>

      {/* Status dots - DASH WebTV style */}
      <div className="absolute bottom-7 left-3 flex gap-0.5">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="w-1 h-1 rounded-full"
            style={{ background: i < 4 ? category.color : `${category.color}40` }}
          />
        ))}
      </div>
    </button>
  );
};

// Time Tunnel Vinyl Carousel - Infinite scroll through time
// Right = present (big), Left = past (small), loads more classics as you scroll
const TimeTunnelCarousel = ({ initialTracks, allTracks, onPlay }: {
  initialTracks: Track[];
  allTracks: Track[];
  onPlay: (track: Track) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cardPositions, setCardPositions] = useState<number[]>([]);
  const [loadedTracks, setLoadedTracks] = useState<Track[]>(initialTracks);
  const [loadIndex, setLoadIndex] = useState(initialTracks.length);
  const rafRef = useRef<number>(0);

  // Update card positions - throttled with RAF for smooth 60fps
  const updatePositions = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;

      const positions: number[] = [];
      const cards = container.querySelectorAll('[data-vinyl-card]');
      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const cardCenter = cardRect.left + cardRect.width / 2 - containerRect.left;
        const progress = Math.max(0, Math.min(1, cardCenter / containerWidth));
        positions.push(progress);
      });
      setCardPositions(positions);

      // Check for infinite scroll
      const { scrollLeft, scrollWidth, clientWidth } = container;
      if (scrollLeft + clientWidth > scrollWidth * 0.75 && loadIndex < allTracks.length) {
        const nextBatch = allTracks.slice(loadIndex, loadIndex + 5);
        if (nextBatch.length > 0) {
          setLoadedTracks(prev => [...prev, ...nextBatch]);
          setLoadIndex(prev => prev + 5);
        }
      }
    });
  }, [loadIndex, allTracks]);

  useEffect(() => {
    updatePositions();
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', updatePositions, { passive: true });
      window.addEventListener('resize', updatePositions);
      return () => {
        container.removeEventListener('scroll', updatePositions);
        window.removeEventListener('resize', updatePositions);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }
  }, [updatePositions]);

  return (
    <div
      ref={containerRef}
      className="flex items-end gap-1 overflow-x-auto scrollbar-hide"
      style={{ paddingLeft: 16, paddingRight: 16 }}
    >
      {loadedTracks.map((track, index) => (
        <VinylCard
          key={track.id}
          track={track}
          progress={cardPositions[index] ?? index / Math.max(1, loadedTracks.length - 1)}
          onClick={() => onPlay(track)}
        />
      ))}
      {/* Loading indicator */}
      {loadIndex < allTracks.length && (
        <div className="flex-shrink-0 flex items-center justify-center w-10 h-20 opacity-20">
          <span className="text-xs text-white/40">•••</span>
        </div>
      )}
    </div>
  );
};

// Single Vinyl Card - uses CSS transforms for smooth scaling (no layout thrashing)
const VinylCard = ({ track, progress, onClick }: { track: Track; progress: number; onClick: () => void }) => {
  // Use getThumb for proper VOYO ID decoding + fallback
  const thumbnailUrl = track.coverUrl || getThumb(track.trackId, 'high');

  // Scale and opacity based on viewport position
  const scale = 0.4 + progress * 0.6; // 0.4 → 1.0
  const opacity = 0.3 + progress * 0.7; // 0.3 → 1.0

  // Fixed base size - use CSS transform for scaling (GPU accelerated, no reflow)
  const baseSize = 85;

  // Ultra smooth spin
  const rotationDuration = 30 + progress * 40; // 30s → 70s

  return (
    <div
      data-vinyl-card
      className="flex-shrink-0 flex flex-col items-center"
      style={{
        width: baseSize + 15,
        willChange: 'transform, opacity',
      }}
    >
      <button
        className="relative flex flex-col items-center origin-bottom"
        style={{
          transform: `scale(${scale})`,
          opacity,
          willChange: 'transform, opacity',
        }}
        onClick={onClick}
      >
        {/* Vinyl disk - fixed size, scaled by parent */}
        <div
          className="relative rounded-full"
          style={{
            width: baseSize,
            height: baseSize,
            background: 'conic-gradient(from 0deg, #1a1a1a, #252525, #1a1a1a, #252525, #1a1a1a)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 0 15px rgba(0,0,0,0.4)',
            animation: `spin ${rotationDuration}s linear infinite reverse`,
          }}
        >
          {/* Vinyl grooves */}
          <div className="absolute rounded-full border border-white/10" style={{ inset: 7 }} />
          <div className="absolute rounded-full border border-white/5" style={{ inset: 14 }} />
          <div className="absolute rounded-full border border-white/5" style={{ inset: 21 }} />
          {/* Center thumbnail - SmartImage with self-healing */}
          <div
            className="absolute rounded-full overflow-hidden"
            style={{
              inset: 24,
              boxShadow: 'inset 0 0 8px rgba(0,0,0,0.7)',
            }}
          >
            <SmartImage
              src={thumbnailUrl}
              trackId={track.trackId}
              alt={track.title}
              artist={track.artist}
              title={track.title}
              className="w-full h-full object-cover"
              style={{
                filter: `sepia(${0.2 - progress * 0.15}) brightness(${0.7 + progress * 0.3})`,
              }}
              lazy={false}
            />
            {/* Center hole */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-black border border-white/20" />
            </div>
          </div>
          {/* Shine */}
          <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 40%)' }} />
        </div>
        {/* Title */}
        <div className="mt-2 text-center w-full">
          <p
            className="text-[10px] font-bold truncate"
            style={{ color: `rgba(255, 250, 240, ${0.5 + progress * 0.5})` }}
          >
            {track.title}
          </p>
          <p
            className="text-[8px] truncate"
            style={{ color: `rgba(255, 250, 240, ${0.3 + progress * 0.3})` }}
          >
            {track.artist}
          </p>
        </div>
      </button>
    </div>
  );
};

// West African Hit Card - Pool-fed: uses Track from DJ
const WestAfricanCard = ({ track, onClick }: { track: Track; onClick: () => void }) => {
  return (
    <button
      className="flex-shrink-0"
      onClick={onClick}
    >
      <div className="relative w-28 h-28 rounded-xl overflow-hidden bg-white/5">
        <SmartImage
          src={getThumb(track.trackId, 'high')}
          trackId={track.trackId}
          alt={track.title}
          artist={track.artist}
          title={track.title}
          className="w-full h-full object-cover"
          lazy={false}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        {/* Song name with shadow/glow behind */}
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p
            className="text-[11px] font-bold text-white truncate"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.7)' }}
          >
            {track.title}
          </p>
        </div>
      </div>
    </button>
  );
};

// Section Header - Consistent hierarchy with breathing room
const SectionHeader = ({ icon: Icon, title, color, onSeeAll }: { icon: React.ElementType; title: string; color: string; onSeeAll?: () => void }) => (
  <div className="flex items-center justify-between mb-5 px-4">
    <div className="flex items-center gap-2.5">
      <div className="p-1.5 rounded-lg" style={{ background: color }}>
        <Icon className="w-3.5 h-3.5 text-white" />
      </div>
      <span className="text-sm font-semibold text-white">{title}</span>
    </div>
    {onSeeAll && (
      <button onClick={onSeeAll} className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white/70 transition-colors">
        <span>Open TIVI+</span>
        <ExternalLink className="w-2.5 h-2.5" />
      </button>
    )}
  </div>
);

// ============================================
// MAIN COMPONENT
// ============================================

interface TiviPlusCrossPromoProps {
  immersiveRef?: React.RefObject<HTMLDivElement | null>;
}

export const TiviPlusCrossPromo = ({ immersiveRef }: TiviPlusCrossPromoProps) => {
  // Section reveal ref for shimmer animation
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsInView(true); observer.disconnect(); } },
      { rootMargin: '-100px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Banner interaction state
  const [bannerPrompt, setBannerPrompt] = useState<'idle' | 'watch' | 'open'>('idle');
  const [ctaState, setCtaState] = useState<'default' | 'watch' | 'open'>('default');

  // Pool-fed: DJ fills sections from the pool
  const { hotPool } = useTrackPoolStore();

  // West African Hits - from pool (all tracks are African by default)
  const westAfricanHits = useMemo(() => {
    // First try tagged tracks
    const tagged = hotPool.filter(t =>
      t.tags?.includes('west-african') ||
      t.detectedMode === 'afro-heat' ||
      t.tags?.some(tag => typeof tag === 'string' && ['afrobeats', 'naija', 'nigerian', 'ghana'].includes(tag.toLowerCase()))
    );
    // Fallback: just use pool tracks (VOYO is African music focused)
    return (tagged.length >= 6 ? tagged : hotPool).slice(0, 12);
  }, [hotPool]);

  // All Time Classics - high oyeScore tracks from pool
  const classicsTracks = useMemo(() => {
    // First try tagged tracks
    const tagged = hotPool.filter(t =>
      t.tags?.includes('classic') ||
      t.tags?.some(tag => typeof tag === 'string' && ['classic', 'legend', 'throwback', '90s', '2000s'].includes(tag.toLowerCase()))
    );
    // Fallback: use highest oyeScore tracks as "classics"
    const fallback = [...hotPool].sort((a, b) => (b.oyeScore || 0) - (a.oyeScore || 0));
    return (tagged.length >= 6 ? tagged : fallback).slice(0, 20);
  }, [hotPool]);

  // ALL classics for infinite scroll - from pool
  const allClassicsTracks = useMemo(() => {
    // Use classicsTracks which already has fallback logic
    if (classicsTracks.length > 0) return classicsTracks;
    // Final fallback to static
    return TRACKS.filter(t => !t.tags?.includes('mix')).sort((a, b) => b.oyeScore - a.oyeScore);
  }, [classicsTracks]);

  // Initial tracks to show (first 8)
  const initialClassicsTracks = useMemo(() => {
    return allClassicsTracks.slice(0, 8);
  }, [allClassicsTracks]);

  // Banner click handler - show prompts then redirect
  const handleBannerClick = () => {
    if (bannerPrompt === 'idle') {
      setBannerPrompt('watch');
      setCtaState('watch');
      // After 2s, show "Open TIVI+"
      setTimeout(() => {
        setBannerPrompt('open');
        setCtaState('open');
        // After another 1.5s, actually open
        setTimeout(() => {
          window.open(`${TIVI_PLUS_BASE}/watch/${FEATURED_BANNER.streamId}`, '_blank');
          // Reset states
          setBannerPrompt('idle');
          setCtaState('default');
        }, 1500);
      }, 2000);
    }
  };

  const handleMovieClick = (movieId: string) => {
    window.open(`${TIVI_PLUS_BASE}/watch/${movieId}`, '_blank');
  };

  const handleLiveTVClick = (categoryId: string) => {
    window.open(`${TIVI_PLUS_BASE}/live?category=${categoryId}`, '_blank');
  };

  const handleMusicClick = (track: Track) => {
    window.dispatchEvent(new CustomEvent('voyo:playTrack', {
      detail: {
        youtubeId: track.trackId,
        title: track.title,
        artist: track.artist,
        thumbnail: track.coverUrl || getThumb(track.trackId, 'high'),
      }
    }));
  };

  return (
    <div ref={sectionRef} className="relative mt-12 pt-8 pb-4">
      {/* ========== SHIMMER OVERLAY CONTAINER (overflow-hidden for animation) ========== */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Golden corner fades */}
        <div
          className="absolute top-0 left-0 w-48 h-48"
          style={{
            background: 'radial-gradient(ellipse at top left, rgba(251, 191, 36, 0.08) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute top-0 right-0 w-48 h-48"
          style={{
            background: 'radial-gradient(ellipse at top right, rgba(251, 191, 36, 0.08) 0%, transparent 70%)',
          }}
        />

        {/* Cinematic golden shimmer on reveal */}
        {isInView && (
          <div className="absolute inset-0 z-10 animate-[voyo-fade-in_0.3s_ease]">
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(251, 191, 36, 0.15) 20%, rgba(255, 215, 0, 0.25) 50%, rgba(251, 191, 36, 0.15) 80%, transparent 100%)',
                animation: 'voyo-shimmer 1.2s ease forwards',
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.08) 40%, rgba(255, 255, 255, 0.12) 50%, rgba(255, 255, 255, 0.08) 60%, transparent 100%)',
                animation: 'voyo-shimmer 1.2s ease 0.1s forwards',
              }}
            />
          </div>
        )}
      </div>

      {/* ========== TIVI+ SECTION CONTENT ========== */}

      {/* Immersive section wrapper - nav hides when this is in view */}
      <div ref={immersiveRef}>
      {/* Section Divider - Take a Break */}
      <div className="relative z-20 flex items-center gap-3 mb-10 px-4">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20"
        >
          <Tv className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[9px] font-bold text-amber-300/90 tracking-wider">TAKE A BREAK ON TIVI+</span>
        </div>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
      </div>

      {/* Featured Banner - Interactive with prompts */}
      <button
        className="relative z-20 w-[calc(100%-32px)] mx-4 h-36 rounded-2xl overflow-hidden mb-10 group"
        onClick={handleBannerClick}
      >
        <img src={FEATURED_BANNER.backdrop} alt={FEATURED_BANNER.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
        <div className="absolute top-3 left-3 px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded text-[8px] font-bold text-black">
          TIVI+ EXCLUSIVE
        </div>
        <div className="absolute bottom-3 left-3 right-14">
          <h3 className="text-lg font-black text-white mb-0.5">{FEATURED_BANNER.title}</h3>
          <p className="text-[10px] text-amber-300 font-medium">{FEATURED_BANNER.subtitle}</p>
        </div>

        {/* Orange Play Button with CTA state */}
        <div
          className="absolute right-3 bottom-3 flex items-center gap-2"
        >
          {/* CTA Text - appears on interaction */}
          {ctaState !== 'default' && (
            <div
              className="px-3 py-1.5 rounded-full backdrop-blur-sm animate-[voyo-fade-in_0.3s_ease]"
              style={{
                background: ctaState === 'watch'
                  ? 'linear-gradient(135deg, rgba(251, 146, 60, 0.9), rgba(234, 88, 12, 0.9))'
                  : 'rgba(0, 0, 0, 0.6)',
                boxShadow: ctaState === 'watch' ? '0 0 20px rgba(251, 146, 60, 0.5)' : 'none',
              }}
            >
              <span className="text-[10px] font-bold text-white whitespace-nowrap">
                {ctaState === 'watch' ? 'Watch on TIVI+' : 'Open TIVI+'}
              </span>
            </div>
          )}

          {/* Play Button */}
          <div
            className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg"
            style={{
              boxShadow: bannerPrompt !== 'idle'
                ? '0 0 25px rgba(251, 146, 60, 0.6)'
                : '0 4px 12px rgba(0, 0, 0, 0.3)',
            }}
          >
            <Play className="w-5 h-5 text-black fill-black ml-0.5" />
          </div>
        </div>

        {/* Center Prompt Overlay */}
        {bannerPrompt !== 'idle' && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[voyo-fade-in_0.3s_ease]"
          >
            <div
              className="px-6 py-3 rounded-xl animate-[voyo-scale-in_0.3s_ease]"
              style={{
                background: bannerPrompt === 'watch'
                  ? 'linear-gradient(135deg, rgba(251, 146, 60, 0.95), rgba(234, 88, 12, 0.95))'
                  : 'linear-gradient(135deg, rgba(168, 85, 247, 0.95), rgba(139, 92, 246, 0.95))',
                boxShadow: bannerPrompt === 'watch'
                  ? '0 0 40px rgba(251, 146, 60, 0.5)'
                  : '0 0 40px rgba(168, 85, 247, 0.5)',
              }}
            >
              <div className="flex items-center gap-2">
                {bannerPrompt === 'watch' ? (
                  <Play className="w-5 h-5 text-white fill-white" />
                ) : (
                  <ExternalLink className="w-5 h-5 text-white" />
                )}
                <span className="text-white font-bold text-sm">
                  {bannerPrompt === 'watch' ? 'Watch on TIVI+' : 'Open TIVI+'}
                </span>
              </div>
            </div>
          </div>
        )}
      </button>
      </div>{/* Close immersive wrapper */}

      {/* Trending on TIVI+ */}
      <div className="mb-10">
        <SectionHeader icon={Tv} title="Trending on TIVI+" color="linear-gradient(135deg, #f59e0b, #ea580c)" onSeeAll={() => window.open(TIVI_PLUS_BASE, '_blank')} />
        <div className="flex gap-4 overflow-x-auto scrollbar-hide px-4">
          {TRENDING_TIVI.map(movie => (
            <MoviePosterCard key={movie.id} movie={movie} onClick={() => handleMovieClick(movie.id)} />
          ))}
        </div>
      </div>

      {/* Live TV - Billboard Cards */}
      <div className="mb-20">
        <div className="flex items-center justify-between mb-5 px-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg" style={{ background: 'linear-gradient(135deg, #8b5cf6, #a855f7)' }}>
              <Radio className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-white">Live TV</span>
            <span className="text-[10px] text-purple-400 font-medium ml-1">+{TOTAL_LIVE_CHANNELS} channels</span>
          </div>
          <button onClick={() => window.open(`${TIVI_PLUS_BASE}/live`, '_blank')} className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white/70 transition-colors">
            <span>Open TIVI+</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex gap-4 overflow-x-auto scrollbar-hide px-4">
          {LIVE_TV_CATEGORIES.map(category => (
            <LiveTVBox key={category.id} category={category} onClick={() => handleLiveTVClick(category.id)} />
          ))}
        </div>
      </div>

      {/* ========== BACK TO MUSIC SECTION ========== */}

      {/* Section Divider - Back to Music */}
      <div className="flex items-center gap-3 mb-10 px-4">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20"
        >
          <Music className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[9px] font-bold text-purple-300/90 tracking-wider">BACK TO THE MUSIC</span>
        </div>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
      </div>

      {/* All Time Classics - Time Tunnel (scroll through time) */}
      <div className="mb-12">
        <div className="flex items-center gap-2 mb-5 px-4">
          <span className="text-lg">💿</span>
          <span className="text-sm font-semibold text-white">All Time Classics</span>
          <span className="text-[10px] text-white/50 ml-auto">← past | present →</span>
        </div>
        <TimeTunnelCarousel
          initialTracks={initialClassicsTracks}
          allTracks={allClassicsTracks}
          onPlay={handleMusicClick}
        />
        <p className="text-[10px] text-white/30 mt-4 px-4 italic">Scroll through time — timeless African hits</p>
      </div>

      {/* West African Hits - Pool-fed by DJ */}
      {westAfricanHits.length > 0 && (
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-5 px-4">
            <span className="text-lg">🌍</span>
            <span className="text-sm font-semibold text-white">West African Hits</span>
          </div>
          <div className="flex gap-4 overflow-x-auto scrollbar-hide px-4">
            {westAfricanHits.map((track) => (
              <WestAfricanCard
                key={track.id}
                track={track}
                onClick={() => handleMusicClick(track)}
              />
            ))}
          </div>
          <p className="text-[10px] text-white/30 mt-4 px-4 italic">From Guinea to Senegal — your local favorites</p>
        </div>
      )}

      {/* Bottom spacer for visual breathing */}
      <div className="h-8" />
    </div>
  );
};

export default TiviPlusCrossPromo;
