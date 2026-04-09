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

import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, Heart, Music, Clock, MoreVertical, Play, ListPlus, Plus } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { useDownloadStore } from '../../store/downloadStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { usePlaylistStore } from '../../store/playlistStore';
import { getYouTubeThumbnail, TRACKS } from '../../data/tracks';
import { SmartImage } from '../ui/SmartImage';
import { Track } from '../../types';
import { getAudioStream } from '../../services/api';
import { PlaylistModal } from '../playlist/PlaylistModal';

// Base filter tabs
const BASE_FILTERS = [
  { id: 'all', label: 'All', color: 'bg-white/10' },
  { id: 'liked', label: 'Liked', color: 'bg-purple-500/20 text-purple-400' },
  { id: 'queue', label: 'Queue', color: 'bg-violet-500/20 text-violet-400' },
  { id: 'history', label: 'History', color: 'bg-white/5 text-white/40' },
  { id: 'offline', label: 'Offline', color: 'bg-purple-500/10 text-purple-300' },
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
  const [teaserState, setTeaserState] = useState<'idle' | 'playing' | 'played'>('idle');
  const teaserAudioRef = useRef<HTMLAudioElement | null>(null);
  const teaserTimeoutRef = useRef<number | null>(null);
  const hasInteractedRef = useRef(false);
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const mainIsPlaying = usePlayerStore(s => s.isPlaying);
  const addToQueue = usePlayerStore(s => s.addToQueue);

  // Detect if device has hover capability (desktop)
  const hasHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Cleanup teaser on unmount
  useEffect(() => {
    return () => {
      if (teaserAudioRef.current) {
        teaserAudioRef.current.pause();
        teaserAudioRef.current.src = '';
      }
      if (teaserTimeoutRef.current) {
        clearTimeout(teaserTimeoutRef.current);
      }
    };
  }, []);

  // Stop teaser when hovering out
  useEffect(() => {
    if (!isHovered && teaserState === 'playing') {
      stopTeaser();
    }
  }, [isHovered, teaserState]);

  const stopTeaser = () => {
    if (teaserAudioRef.current) {
      teaserAudioRef.current.pause();
      teaserAudioRef.current.currentTime = 0;
    }
    if (teaserTimeoutRef.current) {
      clearTimeout(teaserTimeoutRef.current);
    }
    setTeaserState('idle');
  };

  const startTeaser = async () => {
    // Don't start teaser if already playing or played, or if this is the current track
    if (teaserState !== 'idle' || currentTrack?.id === track.id) return;

    try {
      setTeaserState('playing');

      // Create or reuse audio element
      if (!teaserAudioRef.current) {
        teaserAudioRef.current = new Audio();
        teaserAudioRef.current.volume = 0.3; // Lower volume for preview
      }

      // Load audio stream
      const streamUrl = await getAudioStream(track.trackId);
      if (streamUrl && teaserAudioRef.current) {
        teaserAudioRef.current.src = streamUrl;
        await teaserAudioRef.current.play();

        // Stop after 30 seconds
        teaserTimeoutRef.current = setTimeout(() => {
          stopTeaser();
          setTeaserState('played');
        }, 30000);
      }
    } catch (error) {
      setTeaserState('idle');
    }
  };

  const handleClick = () => {
    // If teaser is playing and user hasn't interacted yet, stop teaser and play full
    if (teaserState === 'playing' && !hasInteractedRef.current) {
      stopTeaser();
      hasInteractedRef.current = true;
      onClick(); // Play full track
      return;
    }

    // If teaser was played (30s preview), or already interacted, play full track
    if (teaserState === 'played' || hasInteractedRef.current) {
      onClick();
      return;
    }

    // First interaction - if nothing is playing, play full track immediately
    if (!mainIsPlaying) {
      onClick();
      return;
    }

    // Something is playing - start teaser
    hasInteractedRef.current = true;
    startTeaser();
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopTeaser();
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
            <span className="text-xs text-yellow-400 font-medium">
              HD
            </span>
          )}
          {cacheQuality === 'standard' && (
            <span className="text-xs text-emerald-400 font-medium">
              Offline
            </span>
          )}
          {teaserState === 'playing' && (
            <span className="text-xs text-purple-400 font-medium">Previewing...</span>
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
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const queue = usePlayerStore(s => s.queue);
  const history = usePlayerStore(s => s.history);
  const { playlists } = usePlaylistStore();

  // Get liked tracks from preference store (persisted to localStorage)
  const { trackPreferences, setExplicitLike } = usePreferenceStore();

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

  // Get boosted tracks from download store
  const { cachedTracks, initialize: initDownloads, isInitialized } = useDownloadStore();

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

    // All other filters: use TRACKS
    return TRACKS.filter(track => {
      if (!matchesSearch(track)) return false;

      switch (activeFilter) {
        case 'liked':
          return likedTracks.has(track.id);
        default:
          return true;
      }
    });
  }, [activeFilter, searchQuery, boostedTracks, queue, history, playlists, likedTracks]);

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-4 py-4">
        <h1 className="text-2xl font-bold text-white">Your Library</h1>
      </header>

      {/* Search Bar */}
      <div className="px-4 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in library..."
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
        {filters.map((filter) => (
          <button
            key={filter.id}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeFilter === filter.id
                ? 'bg-purple-500 text-white'
                : filter.color || 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
            {/* Show count badge for queue */}
            {filter.id === 'queue' && queue.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-purple-500/30 rounded-full">
                {queue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Song Count */}
      <div className="px-4 py-2">
        <p className="text-white/40 text-sm">
          {filteredTracks.length} {
            activeFilter === 'offline' ? 'offline songs' :
            activeFilter === 'queue' ? 'in queue' :
            activeFilter === 'history' ? 'played' :
            activeFilter === 'liked' ? 'liked' :
            activeFilter.startsWith('playlist:') ? 'in playlist' :
            'songs'
          }
          {activeFilter === 'offline' && filteredTracks.length === 0 && (
            <span className="block text-xs mt-1">Play songs to build your offline library!</span>
          )}
          {activeFilter === 'queue' && filteredTracks.length === 0 && (
            <span className="block text-xs mt-1">Add tracks to your queue to see them here!</span>
          )}
          {activeFilter === 'history' && filteredTracks.length === 0 && (
            <span className="block text-xs mt-1">Your listening history will appear here</span>
          )}
        </p>
      </div>

      {/* Song List */}
      <div className="flex-1 overflow-y-auto pb-20">
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
              onAddToQueue={() => addToQueue(track)}
              onAddToPlaylist={() => setPlaylistModalTrack(track)}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-40 text-white/40">
            <Music className="w-12 h-12 mb-2" />
            <p>No songs found</p>
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
