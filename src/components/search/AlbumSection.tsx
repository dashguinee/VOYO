/**
 * VOYO Music - Album Section Component
 * Shows album search results with browsing capability
 */

import { useState, useCallback, useEffect } from 'react';
import { devWarn } from '../../utils/logger';
import { Disc3, Play, ChevronLeft } from 'lucide-react';
import { VinylLoader } from '../ui/VinylLoader';
import { PipedPlaylist, PipedTrack, searchAlbums, getAlbumTracks } from '../../services/piped';
import { pipedTrackToVoyoTrack } from '../../data/tracks';
import { usePlayerStore } from '../../store/playerStore';
import { app } from '../../services/oyo';
import { Track } from '../../types';
import { useBackGuard } from '../../hooks/useBackGuard';
import { formatTime as formatDuration } from '../../utils/format';

interface AlbumSectionProps {
  query: string;
  isVisible: boolean;
}

export const AlbumSection = ({ query, isVisible }: AlbumSectionProps) => {
  const [albums, setAlbums] = useState<PipedPlaylist[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<PipedPlaylist | null>(null);
  const [albumTracks, setAlbumTracks] = useState<PipedTrack[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);

  const addToQueue = usePlayerStore(s => s.addToQueue);

  // Back gesture peels the album detail view back to the grid instead
  // of closing the parent search overlay.
  useBackGuard(!!selectedAlbum, () => setSelectedAlbum(null), 'album-detail');

  // Search for albums when query changes
  const handleSearch = useCallback(async () => {
    if (!query || query.trim().length < 3) {
      setAlbums([]);
      return;
    }

    setIsLoading(true);
    try {
      const results = await searchAlbums(query, 8);
      setAlbums(results);
    } catch (error) {
      devWarn('Album search failed:', error);
      setAlbums([]);
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  // Trigger search when query changes
  useEffect(() => {
    if (isVisible && query) {
      handleSearch();
    }
  }, [query, isVisible, handleSearch]);

  // Load album tracks
  const handleAlbumClick = useCallback(async (album: PipedPlaylist) => {
    setSelectedAlbum(album);
    setIsLoadingTracks(true);
    try {
      const tracks = await getAlbumTracks(album.id);
      setAlbumTracks(tracks);
    } catch (error) {
      devWarn('Failed to load album tracks:', error);
      setAlbumTracks([]);
    } finally {
      setIsLoadingTracks(false);
    }
  }, []);

  // Play entire album
  const handlePlayAlbum = useCallback(async () => {
    if (albumTracks.length === 0 || !selectedAlbum) return;

    const voyoTracks = albumTracks.map(track =>
      pipedTrackToVoyoTrack(track, selectedAlbum.name)
    );

    // Play first track (registers with lanes via app.playTrack), queue rest
    app.playTrack(voyoTracks[0], 'search');
    if (voyoTracks.length > 1) {
      voyoTracks.slice(1).forEach(track => app.addToQueue(track));
    }
  }, [albumTracks, selectedAlbum, addToQueue]);

  // Play individual track
  const handleTrackClick = useCallback((track: PipedTrack) => {
    const voyoTrack = pipedTrackToVoyoTrack(track, selectedAlbum?.name);
    app.playTrack(voyoTrack, 'search');
  }, [selectedAlbum]);

  // Add track to queue
  const handleAddToQueue = useCallback((track: PipedTrack, e: React.MouseEvent) => {
    e.stopPropagation();
    const voyoTrack = pipedTrackToVoyoTrack(track, selectedAlbum?.name);
    addToQueue(voyoTrack);
  }, [selectedAlbum, addToQueue]);

  if (!isVisible) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Disc3 className="w-4 h-4 text-purple-400" />
        <h3 className="text-white/80 text-sm font-semibold">Albums</h3>
      </div>

      {/* Loading state — seamless vinyl, no attention-grabbing spin */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <VinylLoader size={24} />
        </div>
      )}

      {/* Album Browser View */}
      
        {selectedAlbum ? (
          // Album Detail View
          <div
            key="album-detail"
            className="space-y-3"
          >
            {/* Back button */}
            <button
              onClick={() => setSelectedAlbum(null)}
              className="flex items-center gap-2 text-white/60 hover:text-white/90 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="text-xs">Back to albums</span>
            </button>

            {/* Album Header */}
            <div
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(168,85,247,0.1) 100%)',
                border: '1px solid rgba(139,92,246,0.2)',
                }}
            >
              <img
                src={selectedAlbum.thumbnail}
                alt={selectedAlbum.name}
                className="w-16 h-16 rounded-lg object-cover"
              />
              <div className="flex-1 min-w-0">
                <h4 className="text-white/90 font-semibold text-sm truncate">
                  {selectedAlbum.name}
                </h4>
                <p className="text-white/50 text-xs truncate">{selectedAlbum.artist}</p>
                <p className="text-white/30 text-[10px] mt-0.5">
                  {selectedAlbum.trackCount} tracks
                </p>
              </div>
              <button
                className="p-3 rounded-full bg-purple-500 hover:bg-purple-600 transition-colors"
                onClick={handlePlayAlbum}
                disabled={isLoadingTracks || albumTracks.length === 0}
              >
                <Play className="w-5 h-5 text-white" fill="white" />
              </button>
            </div>

            {/* Track List */}
            <div className="space-y-1">
              {isLoadingTracks ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2 rounded-lg animate-pulse"
                      style={{ background: 'rgba(255,255,255,0.03)' }}
                    >
                      <div className="w-8 h-8 rounded bg-white/5" />
                      <div className="flex-1">
                        <div className="h-3 w-3/4 bg-white/5 rounded mb-1" />
                        <div className="h-2 w-1/2 bg-white/5 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                albumTracks.map((track, index) => (
                  <div
                    key={track.videoId}
                    className="flex items-center gap-3 p-2 rounded-lg cursor-pointer group"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                    onClick={() => handleTrackClick(track)}
                  >
                    {/* Track number */}
                    <div className="w-8 flex items-center justify-center">
                      <span className="text-white/40 text-xs group-hover:hidden">
                        {index + 1}
                      </span>
                      <Play className="w-4 h-4 text-purple-400 hidden group-hover:block" />
                    </div>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <h5 className="text-white/80 text-xs truncate">{track.title}</h5>
                      <p className="text-white/40 text-[10px] truncate">{track.artist}</p>
                    </div>

                    {/* Duration */}
                    <span className="text-white/30 text-[10px]">
                      {formatDuration(track.duration)}
                    </span>

                    {/* Add to queue button */}
                    <button
                      className="p-1.5 rounded-full opacity-0 group-hover:opacity-100"
                      style={{
                        background: 'rgba(139,92,246,0.3)',
                        border: '1px solid rgba(139,92,246,0.3)',
                      }}
                      onClick={(e) => handleAddToQueue(track, e)}
                    >
                      <Play className="w-3 h-3 text-purple-400" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          // Album Grid View
          <div
            key="album-grid"
            className="grid grid-cols-2 gap-2"
          >
            {!isLoading && albums.length === 0 && query.length >= 3 && (
              <div className="col-span-2 text-center py-4">
                <p className="text-white/40 text-xs">No albums found</p>
              </div>
            )}

            {albums.map((album, index) => (
              <div
                key={album.id}
                className="relative cursor-pointer group"
                onClick={() => handleAlbumClick(album)}
              >
                <div
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    }}
                >
                  {/* Album Art */}
                  <div className="aspect-square relative">
                    <img
                      src={album.thumbnail}
                      alt={album.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {/* Hover overlay */}
                    <div
                      className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <div className="flex flex-col items-center">
                        <Play className="w-8 h-8 text-white mb-1" fill="white" />
                        <span className="text-white/80 text-[10px]">
                          {album.trackCount} tracks
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Album Info */}
                  <div className="p-2">
                    <h4 className="text-white/80 text-xs font-medium truncate">
                      {album.name}
                    </h4>
                    <p className="text-white/40 text-[10px] truncate">{album.artist}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      
    </div>
  );
};

export default AlbumSection;
