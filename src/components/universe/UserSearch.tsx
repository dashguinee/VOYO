/**
 * VOYO User Search
 *
 * Search for other users by DASH ID
 */

import { useState, useEffect } from 'react';
import { Search, User, Radio, X } from 'lucide-react';
import { profileAPI, formatVoyoId } from '../../lib/voyo-api';

interface SearchResult {
  dashId: string;
  displayName: string;
  avatarUrl: string | null;
  portalOpen: boolean;
}

interface UserSearchProps {
  onSelectUser: (dashId: string) => void;
  onClose?: () => void;
}

export const UserSearch = ({ onSelectUser, onClose }: UserSearchProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const users = await profileAPI.search(query);
      // Map to SearchResult format
      setResults(users.map(u => ({
        dashId: u.dash_id,
        displayName: (u.preferences?.display_name as string) || formatVoyoId(u.dash_id),
        avatarUrl: (u.preferences?.avatar_url as string) || null,
        portalOpen: u.portal_open,
      })));
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold">Find Users</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10"
          >
            <X className="w-4 h-4 text-white/70" />
          </button>
        )}
      </div>

      {/* Search Input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          placeholder="Search by DASH ID..."
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-500/50"
          autoFocus
        />
      </div>

      {/* Results */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {isSearching && (
          <div className="text-center py-4">
            <div className="inline-block w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isSearching && query.length >= 2 && results.length === 0 && (
          <div className="text-center py-6 text-white/40">
            <User className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p>No users found</p>
          </div>
        )}

        {!isSearching && query.length < 2 && (
          <div className="text-center py-6 text-white/30 text-sm">
            Type at least 2 characters to search
          </div>
        )}

        
          {results.map((user, index) => (
            <button
              key={user.dashId}
              className="w-full p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-3 transition-colors"
              onClick={() => onSelectUser(user.dashId)}
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center overflow-hidden">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white font-bold text-lg">
                    {user.displayName[0]?.toUpperCase() || 'V'}
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 text-left min-w-0">
                <p className="text-white font-medium truncate">{user.displayName}</p>
                <p className="text-white/40 text-sm">V{user.dashId}</p>
              </div>

              {/* Portal Status */}
              {user.portalOpen && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-500/20 border border-purple-500/30">
                  <Radio className="w-3 h-3 text-purple-400" />
                  <span className="text-purple-400 text-xs font-medium">LIVE</span>
                </div>
              )}
            </button>
          ))}
        
      </div>
    </div>
  );
};

export default UserSearch;
