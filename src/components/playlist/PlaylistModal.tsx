/**
 * VOYO Playlist Modal
 *
 * Add track to playlist / Create new playlist
 */

import { useState } from 'react';
import { X, Plus, Check, Music2, Globe, Lock } from 'lucide-react';
import { usePlaylistStore, Playlist } from '../../store/playlistStore';
import { useAuth } from '../../hooks/useAuth';

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
  trackTitle?: string;
}

export const PlaylistModal = ({ isOpen, onClose, trackId, trackTitle }: PlaylistModalProps) => {
  // Fine-grained selectors — avoid re-renders on unrelated playlist mutations.
  const playlists = usePlaylistStore(s => s.playlists);
  const createPlaylist = usePlaylistStore(s => s.createPlaylist);
  const addTrackToPlaylist = usePlaylistStore(s => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = usePlaylistStore(s => s.removeTrackFromPlaylist);
  const syncToCloud = usePlaylistStore(s => s.syncToCloud);
  const { isLoggedIn, dashId } = useAuth();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const handleToggleTrack = async (playlist: Playlist) => {
    const isInPlaylist = playlist.trackIds.includes(trackId);

    if (isInPlaylist) {
      removeTrackFromPlaylist(playlist.id, trackId);
    } else {
      addTrackToPlaylist(playlist.id, trackId);
    }

    // Sync to cloud if logged in
    if (isLoggedIn && dashId) {
      setTimeout(() => syncToCloud(dashId), 500);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;

    const playlist = createPlaylist(newName.trim());
    addTrackToPlaylist(playlist.id, trackId);

    // Sync to cloud if logged in
    if (isLoggedIn && dashId) {
      setTimeout(() => syncToCloud(dashId), 500);
    }

    setNewName('');
    setShowCreate(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-voyo-fade-in">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-md bg-gradient-to-b from-[#1a1a2e] to-[#0a0a0f] rounded-t-3xl sm:rounded-3xl overflow-hidden border border-white/10 animate-voyo-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-bold">Add to Playlist</h2>
            {trackTitle && (
              <p className="text-white/50 text-sm truncate max-w-[250px]">{trackTitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {/* Create New Button */}
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full p-4 rounded-xl bg-gradient-to-r from-purple-500/20 to-[#D4A053]/20 border border-purple-500/30 flex items-center gap-3 mb-4 hover:border-purple-500/50 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-purple-500/30 flex items-center justify-center">
                <Plus className="w-6 h-6 text-purple-400" />
              </div>
              <span className="text-white font-semibold">Create New Playlist</span>
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 mb-4 space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Playlist name..."
                className="w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 py-2 rounded-xl bg-white/10 text-white/70"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="flex-1 py-2 rounded-xl bg-purple-500 text-white font-semibold disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {/* Playlist List */}
          {playlists.length === 0 ? (
            <div className="text-center py-8">
              <Music2 className="w-12 h-12 text-white/20 mx-auto mb-3" />
              <p className="text-white/40">No playlists yet</p>
              <p className="text-white/20 text-sm">Create one above!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {playlists.map((playlist) => {
                const isInPlaylist = playlist.trackIds.includes(trackId);
                return (
                  <button
                    key={playlist.id}
                    onClick={() => handleToggleTrack(playlist)}
                    className={`w-full p-3 rounded-xl flex items-center gap-3 transition-colors ${
                      isInPlaylist
                        ? 'bg-purple-500/20 border border-purple-500/30'
                        : 'bg-white/5 border border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      isInPlaylist ? 'bg-purple-500' : 'bg-white/10'
                    }`}>
                      {isInPlaylist ? (
                        <Check className="w-5 h-5 text-white" />
                      ) : (
                        <Music2 className="w-5 h-5 text-white/40" />
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-white font-medium truncate">{playlist.name}</p>
                      <p className="text-white/40 text-xs">
                        {playlist.trackIds.length} tracks
                      </p>
                    </div>
                    {playlist.isPublic ? (
                      <Globe className="w-4 h-4 text-[#D4A053]" />
                    ) : (
                      <Lock className="w-4 h-4 text-white/30" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlaylistModal;
