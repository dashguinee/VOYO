/**
 * VOYO Music - Classic Mode: Your Library
 * Reference: Classic Mode - When clicked on profile.jpg (Middle phone)
 *
 * Features:
 * - Search within library
 * - Filter tabs: All, Liked songs, Saved songs
 * - Song list with thumbnail, title, artist, duration
 * - Tap to play, opens Classic Now Playing
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Heart, Clock, MoreVertical, Play, ListPlus, Plus, Shuffle } from 'lucide-react';
import { VoyoIcon } from '../ui/VoyoIcon';
import { usePlayerStore } from '../../store/playerStore';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { usePlaylistStore } from '../../store/playlistStore';
import { getYouTubeThumbnail, TRACKS } from '../../data/tracks';
import { SmartImage } from '../ui/SmartImage';
import { Track } from '../../types';
import { PlaylistModal } from '../playlist/PlaylistModal';
import { app } from '../../services/oyo';

// Base filter tabs — VOYO Disco DNA palette: bronze-gold for active states,
// platform purple as accent. Consistent with Search overlay tabs (v161+).
const BASE_FILTERS = [
  { id: 'all', label: 'All', color: 'bg-white/10' },
  { id: 'liked', label: 'Liked', color: '' },
  { id: 'queue', label: 'Bucket', color: '' },
  { id: 'recent', label: 'Recently Added', color: '' },
  { id: 'history', label: 'History', color: '' },
  { id: 'offline', label: 'Offline', color: '' },
];

// Song Row Component with Hover Preview
const SongRow = ({
  track,
  index,
  isLiked = false,
  cacheQuality,
  onClick,
  onLike,
  onAddToQueue,
  onAddToPlaylist
}: {
  track: Track;
  index: number;
  isLiked?: boolean;
  cacheQuality?: 'standard' | 'boosted' | null; // null = not cached
  onClick: () => void;
  onLike: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const currentTrack = usePlayerStore(s => s.currentTrack);

  // Detect if device has hover capability (desktop)
  const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Tap = play the full track immediately. (30s teaser preview removed.)
  const handleClick = () => {
    onClick();
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToQueue();
  };

  const isCurrentTrack = currentTrack?.id === track.id;

  return (
    <div
      className="relative flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors rounded-xl group"
      onMouseEnter={() => hasHover && setIsHovered(true)}
      onMouseLeave={() => hasHover && setIsHovered(false)}
    >
      {/* Thumbnail */}
      <button
        className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
        onClick={handleClick}
      >
        <SmartImage
          src={getYouTubeThumbnail(track.trackId, 'medium')}
          alt={track.title}
          className="w-full h-full object-cover"
          trackId={track.trackId}
          artist={track.artist}
          title={track.title}
        />

        {/* Hover Overlay with Play/Queue buttons - Desktop only */}
        {hasHover && (
          <>
            {isHovered && (
              <div
                className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2"
              >
                <button
                  className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center"
                  onClick={handleClick}
                >
                  <Play className="w-3 h-3 text-white fill-white ml-0.5" />
                </button>
                <button
                  className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"
                  onClick={handleAddToQueue}
                >
                  <ListPlus className="w-3 h-3 text-white" />
                </button>
              </div>
            )}
          </>
        )}
      </button>

      {/* Info */}
      <button
        className="flex-1 min-w-0 text-left"
        onClick={handleClick}
      >
        <p className={`font-medium truncate ${isCurrentTrack ? 'text-purple-400' : 'text-white'}`}>
          {track.title}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-white/50 text-sm truncate">{track.artist}</p>
          {cacheQuality === 'boosted' && (
            <span className="text-xs text-[#D4A053] font-medium">
              HD
            </span>
          )}
          {cacheQuality === 'standard' && (
            <span className="text-xs text-white/60 font-medium">
              Offline
            </span>
          )}
        </div>
      </button>

      {/* Duration */}
      <div className="flex items-center gap-1 text-white/40 text-sm">
        <Clock className="w-3 h-3" />
        <span>{track.duration || '3:45'}</span>
      </div>

      {/* Heart button: tap to like, hold to add to playlist */}
      <button
        className="p-2 relative"
        onClick={(e) => { e.stopPropagation(); onLike(); }}
        onPointerDown={(e) => {
          e.stopPropagation();
          // Start long press timer (500ms)
          const timer = setTimeout(() => {
            onAddToPlaylist();
          }, 500);
          (e.currentTarget as any).__longPressTimer = timer;
        }}
        onPointerUp={(e) => {
          clearTimeout((e.currentTarget as any).__longPressTimer);
        }}
        onPointerLeave={(e) => {
          clearTimeout((e.currentTarget as any).__longPressTimer);
        }}
      >
        <Heart
          className={`w-5 h-5 transition-colors ${isLiked ? 'text-purple-500 fill-purple-500' : 'text-white/40'}`}
        />
      </button>
    </div>
  );
};

interface LibraryProps {
  onTrackClick: (track: Track) => void;
}

export const Library = ({ onTrackClick }: LibraryProps) => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [playlistModalTrack, setPlaylistModalTrack] = useState<Track | null>(null);
  const queue = usePlayerStore(s => s.queue);
  const history = usePlayerStore(s => s.history);
  const playlists = usePlaylistStore(s => s.playlists);

  // Get liked tracks from preference store (persisted to localStorage)
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);

  // Scroll-driven UX (matches Search overlay): "My Disco" header fades on
  // scroll past 15% so the user owns the screen with results, search bar
  // slides to bottom (thumb zone) past 45% so refining stays one-handed.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollPct, setScrollPct] = useState(0);
  // rAF + 2% bins — same pattern as search. Previously fired setState at
  // ~60fps, forcing search-bar position recalcs + header-opacity re-renders
  // every frame during scroll.
  const scrollRafRef = useRef<number | null>(null);
  const scrollPctRef = useRef(0);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollContainerRef.current;
      if (!el) return;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      const raw = Math.min(1, Math.max(0, el.scrollTop / max));
      const binned = Math.round(raw * 50) / 50;
      if (Math.abs(binned - scrollPctRef.current) < 0.0001) return;
      scrollPctRef.current = binned;
      setScrollPct(binned);
    });
  }, []);
  useEffect(() => () => {
    if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
  }, []);
  const headerOpacity = Math.max(0, 1 - Math.max(0, (scrollPct - 0.15)) / 0.10);
  const searchAtBottom = scrollPct >= 0.45;

  // Build dynamic filter tabs: base + playlists
  const filters = useMemo(() => {
    const playlistFilters = playlists.map(p => ({
      id: `playlist:${p.id}`,
      label: p.name,
      color: 'bg-purple-500/10 text-purple-300',
    }));
    return [...BASE_FILTERS, ...playlistFilters];
  }, [playlists]);

  // Compute liked tracks set from preferences
  const likedTracks = useMemo(() => {
    const liked = new Set<string>();
    Object.entries(trackPreferences).forEach(([trackId, pref]) => {
      if (pref.explicitLike === true) {
        liked.add(trackId);
      }
    });
    return liked;
  }, [trackPreferences]);

  // Get boosted tracks from download store (fine-grained selectors)
  const cachedTracks = useDownloadStore(s => s.cachedTracks);
  const initDownloads = useDownloadStore(s => s.initialize);
  const isInitialized = useDownloadStore(s => s.isInitialized);

  // Initialize download store on mount
  useEffect(() => {
    if (!isInitialized) {
      initDownloads();
    }
  }, [initDownloads, isInitialized]);

  // Convert cached tracks to Track format for display
  const boostedTracks: Track[] = cachedTracks.map(cached => ({
    id: cached.id,
    trackId: cached.id,
    title: cached.title,
    artist: cached.artist,
    coverUrl: getYouTubeThumbnail(cached.id, 'high'),
    tags: [],
    oyeScore: 0,
    duration: 0,
    createdAt: new Date().toISOString(),
  }));

  // Create maps for quick lookup of cached tracks and their quality
  const cachedTrackIds = new Set(cachedTracks.map(t => t.id));
  const trackQualityMap = new Map(cachedTracks.map(t => [t.id, t.quality]));

  // Filter tracks based on active filter and search
  const filteredTracks = useMemo(() => {
    const matchesSearch = (track: Track) =>
      !searchQuery ||
      track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      track.artist.toLowerCase().includes(searchQuery.toLowerCase());

    // Offline filter: cached tracks only
    if (activeFilter === 'offline') {
      return boostedTracks.filter(matchesSearch);
    }

    // Queue filter: show current queue
    if (activeFilter === 'queue') {
      return queue
        .map(q => q.track)
        .filter(matchesSearch);
    }

    // History filter: show history (reversed, most recent first)
    if (activeFilter === 'history') {
      return [...history]
        .reverse()
        .map(h => h.track)
        .filter(matchesSearch);
    }

    // Playlist filter: show tracks in specific playlist
    if (activeFilter.startsWith('playlist:')) {
      const playlistId = activeFilter.replace('playlist:', '');
      const playlist = playlists.find(p => p.id === playlistId);
      if (!playlist) return [];

      return playlist.trackIds
        .map(trackId => TRACKS.find(t => t.trackId === trackId || t.id === trackId))
        .filter((t): t is Track => t !== undefined && matchesSearch(t));
    }

    // LIKED — Smart Mix (anti-burial). Other apps sort liked songs chronologically
    // by like-date, which buries old favorites. We use a tiered surface:
    //   Tier 0 (top): liked but never played → highest priority to surface
    //   Tier 1: liked but not played in 30+ days → re-discovery
    //   Tier 2: liked, played 7-30 days ago → still fresh-ish
    //   Tier 3: played in last 7 days → recent enough
    // Within each tier, deterministic daily shuffle so order rotates per day
    // without thrashing within a session.
    if (activeFilter === 'liked') {
      const liked = TRACKS.filter(t => likedTracks.has(t.id) && matchesSearch(t));
      if (liked.length === 0) return [];
      const now = Date.now();
      const day7 = 7 * 24 * 60 * 60 * 1000;
      const day30 = 30 * 24 * 60 * 60 * 1000;
      const dayKey = Math.floor(now / 86400000);
      const seedHash = (s: string) => { let h = dayKey * 9301; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; };
      const tierFor = (t: Track): number => {
        const lp = trackPreferences[t.id]?.lastPlayedAt;
        if (!lp) return 0;
        const age = now - new Date(lp).getTime();
        if (age > day30) return 1;
        if (age > day7) return 2;
        return 3;
      };
      return liked
        .map(t => ({ t, tier: tierFor(t), shuffle: seedHash(t.id) }))
        .sort((a, b) => a.tier - b.tier || a.shuffle - b.shuffle)
        .map(x => x.t);
    }

    // RECENTLY ADDED — sorted by lastPlayedAt desc (the closest signal we have
    // for "I touched this recently"). Top 50 to keep it browsable.
    if (activeFilter === 'recent') {
      return TRACKS
        .map(t => ({ t, when: trackPreferences[t.id]?.lastPlayedAt }))
        .filter(x => x.when && matchesSearch(x.t))
        .sort((a, b) => new Date(b.when!).getTime() - new Date(a.when!).getTime())
        .slice(0, 50)
        .map(x => x.t);
    }

    // All other filters: use TRACKS
    return TRACKS.filter(track => {
      if (!matchesSearch(track)) return false;
      return true;
    });
  }, [activeFilter, searchQuery, boostedTracks, queue, history, playlists, likedTracks, trackPreferences]);

  const handleTrackClick = (track: Track) => {
    // Use onTrackClick which goes through PlaybackOrchestrator
    // No need for manual setCurrentTrack/togglePlay - orchestrator handles it
    onTrackClick(track);
  };

  const handleLike = (trackId: string) => {
    // Toggle like - persisted to localStorage via preferenceStore
    const currentlyLiked = likedTracks.has(trackId);
    setExplicitLike(trackId, !currentlyLiked);
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Header — "My Disco" fades on scroll past 15% (chrome retreats so the
          user owns the screen with results). */}
      <header
        className="px-4 pt-5 pb-2"
        style={{ opacity: headerOpacity, transition: 'opacity 220ms ease' }}
      >
        <h1
          className="text-3xl font-display font-bold tracking-tight"
          style={{ color: 'rgba(232, 208, 158, 0.96)', textShadow: '0 0 18px rgba(212,175,110,0.20)', letterSpacing: '-0.01em' }}
        >
          My Disco
        </h1>
        <p className="text-white/35 text-[12px] mt-1 tracking-wide">your sound, your selection</p>
      </header>

      {/* Search bar + filter tabs — block slides from top to bottom (thumb zone)
          past 45% scroll. Position: absolute so the slide doesn't reflow the
          song list. The list adds padding-top/bottom to compensate. */}
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0,
          top: searchAtBottom ? 'auto' : 88,    // below the My Disco header (~88px)
          bottom: searchAtBottom ? 'max(76px, env(safe-area-inset-bottom, 16px))' : 'auto',
          zIndex: 10,
          transition: 'top 320ms cubic-bezier(0.4, 0, 0.2, 1), bottom 320ms cubic-bezier(0.4, 0, 0.2, 1)',
          background: searchAtBottom
            ? 'linear-gradient(180deg, rgba(11,7,3,0) 0%, rgba(11,7,3,0.65) 35%, rgba(11,7,3,0.92) 100%)'
            : 'transparent',
          paddingTop: searchAtBottom ? 16 : 0,
          paddingBottom: searchAtBottom ? 6 : 0,
        }}
      >
        {/* Search Bar — bronze focus ring (was purple) */}
        <div className="px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in your disco..."
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none transition-colors"
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(212,175,110,0.45)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = ''; }}
            />
          </div>
        </div>

      {/* Filter Tabs — bronze-gold for active state, consistent with Search */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
        {filters.map((filter) => {
          const isActive = activeFilter === filter.id;
          const isPlaylist = filter.id.startsWith('playlist:');
          return (
            <button
              key={filter.id}
              className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all"
              style={
                isActive
                  ? {
                      background: 'rgba(212, 175, 110, 0.14)',
                      color: 'rgba(232, 208, 158, 0.97)',
                      border: '1px solid rgba(212, 175, 110, 0.32)',
                      boxShadow: '0 0 14px -6px rgba(212,175,110,0.45)',
                    }
                  : isPlaylist
                  ? {
                      background: 'rgba(139, 92, 246, 0.08)',
                      color: 'rgba(196, 181, 253, 0.85)',
                      border: '1px solid rgba(139, 92, 246, 0.18)',
                    }
                  : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)', border: '1px solid transparent' }
              }
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
              {filter.id === 'queue' && queue.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full"
                      style={{ background: isActive ? 'rgba(20,12,6,0.35)' : 'rgba(212,175,110,0.18)', color: 'rgba(232,208,158,0.95)' }}>
                  {queue.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      </div>{/* end of slide-block (search bar + filters) */}

      {/* Smart Mix banner — only shown on the Liked tab. Calls out the
          anti-burial algorithm so users understand why old favorites surface.
          Metallic shuffle icon (champagne tone) + sparkles tag. */}
      {activeFilter === 'liked' && filteredTracks.length > 0 && (
        <div className="px-4 pb-2">
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(212,175,110,0.12) 0%, rgba(232,208,158,0.06) 50%, rgba(139,92,246,0.08) 100%)',
              border: '1px solid rgba(212,175,110,0.22)',
              boxShadow: 'inset 0 0 18px rgba(212,175,110,0.05)',
            }}
          >
            <VoyoIcon name="sparkle-smart" size={32} glow />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-semibold tracking-wide" style={{ color: 'rgba(232,208,158,0.97)' }}>Smart Mix</span>
                <Shuffle className="w-3 h-3" style={{ color: 'rgba(212,175,110,0.65)' }} />
              </div>
              <p className="text-[10px] text-white/40 leading-tight">surfaces forgotten favorites — old likes don't get buried</p>
            </div>
          </div>
        </div>
      )}

      {/* Song Count */}
      <div className="px-4 py-2">
        <p className="text-white/40 text-sm">
          {filteredTracks.length} {
            activeFilter === 'offline' ? 'offline songs' :
            activeFilter === 'queue' ? 'in bucket' :
            activeFilter === 'history' ? 'played' :
            activeFilter === 'liked' ? 'liked · shuffled smart' :
            activeFilter === 'recent' ? 'recently played' :
            activeFilter.startsWith('playlist:') ? 'in playlist' :
            'songs'
          }
          {activeFilter === 'offline' && filteredTracks.length === 0 && (
            <span className="block text-xs mt-1">Play songs to build your offline library!</span>
          )}
          {activeFilter === 'queue' && filteredTracks.length === 0 && (
            <span className="block text-xs mt-1">Add tracks to your bucket to see them here!</span>
          )}
          {activeFilter === 'history' && filteredTracks.length === 0 && (
            <span className="block text-xs mt-1">Your listening history will appear here</span>
          )}
          {activeFilter === 'recent' && filteredTracks.length === 0 && (
            <span className="block text-xs mt-1">Tracks you've played recently will appear here</span>
          )}
        </p>
      </div>

      {/* Song List — the scroll surface that drives header fade + bar slide.
          Top padding reserves space for the absolutely-positioned search-bar
          block (when at top: ~200px for header+bar+tabs; when at bottom: just
          the smart-mix banner if visible). */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
        style={{
          paddingTop: searchAtBottom ? 8 : 200,
          paddingBottom: searchAtBottom
            ? 'calc(180px + max(76px, env(safe-area-inset-bottom, 16px)))'
            : 80,
          transition: 'padding-top 320ms ease, padding-bottom 320ms ease',
        }}
      >
        {filteredTracks.length > 0 ? (
          filteredTracks.map((track, index) => (
            <SongRow
              key={track.id}
              track={track}
              index={index}
              isLiked={likedTracks.has(track.id)}
              cacheQuality={trackQualityMap.get(track.trackId) || null}
              onClick={() => handleTrackClick(track)}
              onLike={() => handleLike(track.id)}
              onAddToQueue={() => app.oyeCommit(track)}
              onAddToPlaylist={() => setPlaylistModalTrack(track)}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-white/40">
            <VoyoIcon name="vinyl-disc" size={72} glow style={{ opacity: 0.55, marginBottom: 12 }} />
            <p className="text-sm">No songs here yet</p>
          </div>
        )}
      </div>

      {/* Playlist Modal */}
      {playlistModalTrack && (
        <PlaylistModal
          isOpen={!!playlistModalTrack}
          onClose={() => setPlaylistModalTrack(null)}
          trackId={playlistModalTrack.trackId}
          trackTitle={playlistModalTrack.title}
        />
      )}
    </div>
  );
};

export default Library;
