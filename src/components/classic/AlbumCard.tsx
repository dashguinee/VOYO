/**
 * VOYO Music - Album Card Component
 *
 * Displays YouTube playlist albums from Piped API
 * Used in HomeFeed shelves for browsable album discovery
 */

import { useState } from 'react';
import { Play, Music2 } from 'lucide-react';
import { Album } from '../../types';

interface AlbumCardProps {
  album: Album;
  onPlay: () => void;
}

export const AlbumCard = ({ album, onPlay }: AlbumCardProps) => {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      className="flex-shrink-0 w-36 voyo-tap-scale voyo-hover-scale"
      onClick={onPlay}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative w-36 h-36 rounded-xl overflow-hidden mb-2 bg-white/5">
        {imageError ? (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600 to-pink-600">
            <Music2 className="w-12 h-12 text-white/50" />
          </div>
        ) : (
          <img
            src={album.thumbnail}
            alt={album.name}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        )}

        {/* Track count badge */}
        <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-0.5 rounded-full backdrop-blur-sm">
          <span className="text-white text-xs font-medium">{album.trackCount} tracks</span>
        </div>

        {/* Play button overlay on hover */}
        {isHovered && (
          <div
            className="absolute inset-0 bg-black/40 flex items-center justify-center animate-voyo-fade-in"
          >
            <div className="w-14 h-14 rounded-full bg-purple-500 flex items-center justify-center shadow-xl">
              <Play className="w-7 h-7 text-white ml-1" fill="white" />
            </div>
          </div>
        )}
      </div>

      <p className="text-white text-sm font-medium truncate">{album.name}</p>
      <p className="text-white/50 text-xs truncate">{album.artist}</p>
    </button>
  );
};
