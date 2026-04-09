/**
 * DAHUB CORE - Unified Social Hub
 *
 * Shared across all DASH apps:
 * - Command Center: Shows ALL activity, called "Friends"
 * - VOYO: Shows music activity + Stories/Notes/Following
 * - Other apps: Filter by their app context
 *
 * Single source of truth: Command Center's Supabase
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Users, MessageCircle, Activity, Search, Plus, X,
  Music, Tv, GraduationCap, Loader2, UserPlus, Check
} from 'lucide-react';
import { friendsAPI, messagesAPI, presenceAPI, APP_CODES, getAppDisplay, SERVICE_DISPLAY } from '../../lib/dahub/dahub-api';
import type { Friend, Conversation, AppCode, SharedAccountMember, SharedService } from '../../lib/dahub/dahub-api';
import { DirectMessageChat } from './DirectMessageChat';

// ==============================================
// TYPES
// ==============================================

export interface DahubCoreProps {
  // Required: User identity from Command Center
  userId: string;
  userName: string;
  userAvatar?: string;

  // App context: undefined = Command Center (all), 'V' = VOYO, etc.
  appContext?: AppCode;

  // Title: "Friends" for CC, "DAHUB" for VOYO
  title?: string;

  // VOYO-specific features
  showNotes?: boolean;
  showStories?: boolean;
  showFollowing?: boolean;

  // Render props for app-specific sections
  renderNotes?: () => React.ReactNode;
  renderStories?: () => React.ReactNode;
  renderFollowing?: () => React.ReactNode;
  renderProfileCard?: () => React.ReactNode;

  // Callbacks
  onOpenSettings?: () => void;
  onClose?: () => void;
}

// ==============================================
// HELPERS
// ==============================================

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getAppIcon(appCode: string | undefined, size = 12) {
  switch (appCode) {
    case 'V': return <Music size={size} className="text-purple-400" />;
    case 'E': return <GraduationCap size={size} className="text-blue-400" />;
    case 'TV': return <Tv size={size} className="text-red-400" />;
    default: return null;
  }
}

// Service icon for shared accounts (Netflix, Spotify, etc.)
function ServiceBadge({ service, size = 14 }: { service: SharedService; size?: number }) {
  // Simple text-based icons since we don't have brand icons
  const iconText: Record<string, string> = {
    netflix: 'N',
    spotify: 'S',
    prime: 'P',
    claude: 'C',
    chatgpt: 'G',
    deezer: 'D',
    youtube: 'Y',
    disney: 'D+',
    grok: 'X',
  };

  return (
    <div
      className="flex items-center justify-center rounded text-[8px] font-bold text-white"
      style={{
        width: size,
        height: size,
        background: service.service_color,
      }}
      title={`Shared ${service.service_name} account`}
    >
      {iconText[service.service_icon] || service.service_type[0]}
    </div>
  );
}

function formatActivity(activity: string | undefined, appCode: string | null, appContext?: AppCode): string {
  if (!activity) return 'Online';

  // In app-specific view, don't show "on VOYO" if we're in VOYO
  if (appContext && appCode === appContext) {
    return activity;
  }

  const app = getAppDisplay(appCode);
  return `${activity}`;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// ==============================================
// SUGGESTED FRIEND AVATAR (Dimmed + Service Badge)
// ==============================================

function SuggestedFriendAvatar({
  member,
  size = 'md',
  onClick
}: {
  member: SharedAccountMember;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}) {
  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-12 h-12',
    lg: 'w-14 h-14'
  };

  // Show the first shared service badge
  const primaryService = member.shared_services[0];

  return (
    <button
      onClick={onClick}
      className="relative flex-shrink-0"
    >
      {/* Dimmed Avatar for suggested friends */}
      <div
        className={`${sizeClasses[size]} rounded-full overflow-hidden bg-gradient-to-br from-purple-500/50 to-violet-600/50`}
        style={{ opacity: member.friend_status === 'accepted' ? 1 : 0.5 }}
      >
        {member.avatar ? (
          <img src={member.avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white font-semibold text-sm">
            {getInitials(member.name)}
          </div>
        )}
      </div>

      {/* Service Badge - Top Left for suggested friends only */}
      {member.friend_status !== 'accepted' && primaryService && (
        <div className="absolute -top-0.5 -left-0.5 border border-[#0a0a0f] rounded">
          <ServiceBadge service={primaryService} size={16} />
        </div>
      )}

      {/* Multiple services indicator */}
      {member.friend_status !== 'accepted' && member.shared_services.length > 1 && (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white/20 border border-[#0a0a0f] flex items-center justify-center">
          <span className="text-[8px] font-bold text-white">+{member.shared_services.length - 1}</span>
        </div>
      )}

      {/* Pending indicator */}
      {member.friend_status === 'pending' && (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-yellow-500 border border-[#0a0a0f] flex items-center justify-center">
          <Loader2 size={8} className="text-white" />
        </div>
      )}

      {/* Online status for accepted friends */}
      {member.friend_status === 'accepted' && member.status === 'online' && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-[#0a0a0f]" />
      )}
    </button>
  );
}

// ==============================================
// FRIEND AVATAR WITH STATUS
// ==============================================

function FriendAvatar({
  friend,
  size = 'md',
  showActivity = true,
  onClick
}: {
  friend: Friend;
  size?: 'sm' | 'md' | 'lg';
  showActivity?: boolean;
  onClick?: () => void;
}) {
  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-12 h-12',
    lg: 'w-14 h-14'
  };

  const statusSize = {
    sm: 'w-2.5 h-2.5',
    md: 'w-3 h-3',
    lg: 'w-3.5 h-3.5'
  };

  return (
    <button
      onClick={onClick}
      className="relative flex-shrink-0"
    >
      {/* Avatar */}
      <div className={`${sizeClasses[size]} rounded-full overflow-hidden bg-gradient-to-br from-purple-500 to-violet-600`}>
        {friend.avatar ? (
          <img src={friend.avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white font-semibold text-sm">
            {getInitials(friend.name)}
          </div>
        )}
      </div>

      {/* Online status */}
      {friend.status === 'online' && (
        <div className={`absolute -bottom-0.5 -right-0.5 ${statusSize[size]} rounded-full bg-green-500 border-2 border-[#0a0a0f]`} />
      )}

      {/* App badge */}
      {showActivity && friend.current_app && friend.status === 'online' && (
        <div
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-[#0a0a0f]"
          style={{ background: getAppDisplay(friend.current_app).color }}
        >
          {getAppIcon(friend.current_app, 10)}
        </div>
      )}
    </button>
  );
}

// ==============================================
// ADD FRIEND MODAL
// ==============================================

function AddFriendModal({
  userId,
  onClose,
  onAdded
}: {
  userId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ dash_id: string; name: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const results = await friendsAPI.searchUsers(searchQuery);
    setSearchResults(results.filter(r => r.dash_id !== userId));
    setIsSearching(false);
  }, [searchQuery, userId]);

  useEffect(() => {
    const timer = setTimeout(handleSearch, 300);
    return () => clearTimeout(timer);
  }, [handleSearch]);

  const handleAdd = async (friendId: string) => {
    setAddingId(friendId);
    const success = await friendsAPI.addFriend(userId, friendId);
    if (success) {
      onAdded();
      onClose();
    }
    setAddingId(null);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#1a1a24] rounded-t-3xl sm:rounded-3xl p-6 max-h-[80vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Add Friend</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10">
            <X size={20} className="text-white/60" />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by DASH ID or name..."
            className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white placeholder-white/40 focus:outline-none focus:border-purple-500/50"
            autoFocus
          />
        </div>

        {/* Results */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {isSearching ? (
            <div className="py-8 flex justify-center">
              <Loader2 size={24} className="animate-spin text-purple-400" />
            </div>
          ) : searchResults.length > 0 ? (
            searchResults.map(user => (
              <div key={user.dash_id} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-white font-semibold text-sm">
                  {getInitials(user.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{user.name}</p>
                  <p className="text-white/40 text-xs font-mono">{user.dash_id}</p>
                </div>
                <button
                  onClick={() => handleAdd(user.dash_id)}
                  disabled={addingId === user.dash_id}
                  className="px-4 py-2 rounded-full bg-purple-500 text-white text-sm font-medium disabled:opacity-50"
                >
                  {addingId === user.dash_id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    'Add'
                  )}
                </button>
              </div>
            ))
          ) : searchQuery.length >= 2 ? (
            <p className="text-center text-white/40 py-8">No users found</p>
          ) : (
            <p className="text-center text-white/40 py-8">Enter a DASH ID or name to search</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ==============================================
// FRIENDS TAB
// ==============================================

function FriendsTab({
  userId,
  friends,
  isLoading,
  appContext,
  onSelectFriend,
  onRefresh
}: {
  userId: string;
  friends: Friend[];
  isLoading: boolean;
  appContext?: AppCode;
  onSelectFriend: (friend: Friend) => void;
  onRefresh: () => void;
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [sharedMembers, setSharedMembers] = useState<SharedAccountMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [sendingRequest, setSendingRequest] = useState<string | null>(null);

  // Load shared account members
  useEffect(() => {
    const loadSharedMembers = async () => {
      setLoadingMembers(true);
      const members = await friendsAPI.getSharedAccountMembers(userId);
      setSharedMembers(members);
      setLoadingMembers(false);
    };
    loadSharedMembers();
  }, [userId]);

  // Handle sending friend request
  const handleSendRequest = async (member: SharedAccountMember) => {
    if (sendingRequest) return;
    setSendingRequest(member.dash_id);

    const success = await friendsAPI.sendFriendRequest(userId, member.dash_id);
    if (success) {
      // Update local state to show pending
      setSharedMembers(prev =>
        prev.map(m =>
          m.dash_id === member.dash_id
            ? { ...m, friend_status: 'pending' as const }
            : m
        )
      );
    }
    setSendingRequest(null);
  };

  // Separate friends and shared members
  const onlineFriends = friends.filter(f => f.status === 'online');
  const offlineFriends = friends.filter(f => f.status !== 'online');

  // Separate shared members: accepted (full) vs suggested/pending (dimmed)
  const acceptedMembers = sharedMembers.filter(m => m.friend_status === 'accepted');
  const suggestedMembers = sharedMembers.filter(m => m.friend_status !== 'accepted');

  if (isLoading && loadingMembers) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-purple-400" />
      </div>
    );
  }

  const hasAnyFriends = friends.length > 0 || acceptedMembers.length > 0;
  const hasSuggestions = suggestedMembers.length > 0;

  return (
    <div className="px-4 py-4">
      {/* Add Friend Button */}
      <button
        onClick={() => setShowAddModal(true)}
        className="w-full flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 to-violet-500/10 border border-purple-500/20 mb-4"
      >
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
          <UserPlus size={18} className="text-purple-400" />
        </div>
        <span className="text-white font-medium">Add Friend</span>
      </button>

      {!hasAnyFriends && !hasSuggestions ? (
        <div className="text-center py-12">
          <Users size={48} className="mx-auto mb-4 text-white/20" />
          <p className="text-white/40">No friends yet</p>
          <p className="text-white/30 text-sm mt-1">Add friends to see their activity</p>
        </div>
      ) : (
        <>
          {/* ===== FULL FRIENDS FIRST ===== */}

          {/* Online Friends */}
          {onlineFriends.length > 0 && (
            <div className="mb-6">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3 px-1">
                Online — {onlineFriends.length}
              </p>
              <div className="space-y-2">
                {onlineFriends.map(friend => (
                  <button
                    key={friend.dash_id}
                    onClick={() => onSelectFriend(friend)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-colors"
                  >
                    <FriendAvatar friend={friend} />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-white font-medium truncate">{friend.nickname || friend.name}</p>
                      <p className="text-white/50 text-sm truncate">
                        {formatActivity(friend.activity, friend.current_app, appContext)}
                      </p>
                    </div>
                    {friend.current_app && (
                      <div
                        className="px-2 py-1 rounded-full text-[10px] font-medium flex items-center gap-1"
                        style={{
                          background: `${getAppDisplay(friend.current_app).color}20`,
                          color: getAppDisplay(friend.current_app).color
                          }}
                      >
                        {getAppIcon(friend.current_app, 10)}
                        <span>{getAppDisplay(friend.current_app).name}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Offline Friends */}
          {offlineFriends.length > 0 && (
            <div className="mb-6">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3 px-1">
                Offline — {offlineFriends.length}
              </p>
              <div className="space-y-2">
                {offlineFriends.map(friend => (
                  <button
                    key={friend.dash_id}
                    onClick={() => onSelectFriend(friend)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-colors opacity-60"
                  >
                    <FriendAvatar friend={friend} showActivity={false} />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-white font-medium truncate">{friend.nickname || friend.name}</p>
                      <p className="text-white/40 text-xs">
                        {friend.last_seen ? `Last seen ${formatTime(friend.last_seen)}` : 'Offline'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ===== SUGGESTED FROM SHARED ACCOUNTS (DIMMED) ===== */}

          {suggestedMembers.length > 0 && (
            <div className="mt-6 pt-4 border-t border-white/[0.06]">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2 px-1">
                People from your shared accounts
              </p>
              <p className="text-white/30 text-[11px] mb-4 px-1">
                Connect with people on the same Netflix, Spotify, or Prime accounts
              </p>
              <div className="space-y-2">
                {suggestedMembers.map(member => (
                  <div
                    key={member.dash_id}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                  >
                    <SuggestedFriendAvatar member={member} />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-white/60 font-medium truncate">{member.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {member.shared_services.slice(0, 3).map((service, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{
                              background: `${service.service_color}20`,
                              color: service.service_color
                              }}
                          >
                            {service.service_name}
                          </span>
                        ))}
                        {member.shared_services.length > 3 && (
                          <span className="text-[10px] text-white/30">
                            +{member.shared_services.length - 3}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action button */}
                    {member.friend_status === 'pending' ? (
                      <div className="px-3 py-1.5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        <span>Pending</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSendRequest(member)}
                        disabled={sendingRequest === member.dash_id}
                        className="px-3 py-1.5 rounded-full bg-purple-500/20 text-purple-400 text-xs font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50"
                      >
                        {sendingRequest === member.dash_id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <span className="flex items-center gap-1">
                            <Plus size={12} />
                            Connect
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Friend Modal */}
      
        {showAddModal && (
          <AddFriendModal
            userId={userId}
            onClose={() => setShowAddModal(false)}
            onAdded={onRefresh}
          />
        )}
      
    </div>
  );
}

// ==============================================
// MESSAGES TAB
// ==============================================

function MessagesTab({
  userId,
  conversations,
  isLoading,
  onSelectConversation
}: {
  userId: string;
  conversations: Conversation[];
  isLoading: boolean;
  onSelectConversation: (conv: Conversation) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-purple-400" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <MessageCircle size={48} className="mx-auto mb-4 text-white/20" />
        <p className="text-white/40">No messages yet</p>
        <p className="text-white/30 text-sm mt-1">Start a conversation with a friend</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-2">
      {conversations.map(conv => (
        <button
          key={conv.friend_id}
          onClick={() => onSelectConversation(conv)}
          className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-colors"
        >
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-purple-500 to-violet-600">
              {conv.friend_avatar ? (
                <img src={conv.friend_avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white font-semibold">
                  {getInitials(conv.friend_name)}
                </div>
              )}
            </div>
            {conv.is_online && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-[#0a0a0f]" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center justify-between mb-0.5">
              <p className={`font-medium truncate ${conv.unread_count > 0 ? 'text-white' : 'text-white/80'}`}>
                {conv.friend_name}
              </p>
              <span className="text-white/40 text-xs flex-shrink-0 ml-2">
                {formatTime(conv.last_message_time)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {conv.sent_from && conv.sent_from !== 'CC' && (
                <span className="flex-shrink-0">{getAppIcon(conv.sent_from, 12)}</span>
              )}
              <p className={`text-sm truncate ${conv.unread_count > 0 ? 'text-white/70' : 'text-white/40'}`}>
                {conv.last_message}
              </p>
            </div>
          </div>

          {/* Unread badge */}
          {conv.unread_count > 0 && (
            <div className="w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold">{conv.unread_count}</span>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// ==============================================
// ACTIVITY TAB
// ==============================================

function ActivityTab({
  friends,
  isLoading,
  appContext,
  onSelectFriend
}: {
  friends: Friend[];
  isLoading: boolean;
  appContext?: AppCode;
  onSelectFriend: (friend: Friend) => void;
}) {
  // Filter to only show friends with activity
  const activeFriends = friends.filter(f => f.activity && f.status === 'online');

  // Further filter by app context if specified
  const filteredFriends = appContext
    ? activeFriends.filter(f => f.current_app === appContext)
    : activeFriends;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-purple-400" />
      </div>
    );
  }

  if (filteredFriends.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <Activity size={48} className="mx-auto mb-4 text-white/20" />
        <p className="text-white/40">No activity right now</p>
        <p className="text-white/30 text-sm mt-1">
          {appContext ? `None of your friends are active on ${getAppDisplay(appContext).name}` : 'Your friends are offline'}
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3">
      {filteredFriends.map(friend => (
        <button
          key={friend.dash_id}
          onClick={() => onSelectFriend(friend)}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
        >
          <FriendAvatar friend={friend} size="lg" />
          <div className="flex-1 min-w-0 text-left">
            <p className="text-white font-semibold truncate mb-1">{friend.nickname || friend.name}</p>
            <p className="text-white/60 text-sm truncate">{friend.activity}</p>
          </div>
          {friend.current_app && (
            <div
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: `${getAppDisplay(friend.current_app).color}15`,
                color: getAppDisplay(friend.current_app).color
                }}
            >
              {getAppDisplay(friend.current_app).name}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

// ==============================================
// MAIN DAHUB CORE COMPONENT
// ==============================================

export function DahubCore({
  userId,
  userName,
  userAvatar,
  appContext,
  title = appContext ? 'DAHUB' : 'Friends',
  showNotes = false,
  showStories = false,
  showFollowing = false,
  renderNotes,
  renderStories,
  renderFollowing,
  renderProfileCard,
  onOpenSettings,
  onClose
}: DahubCoreProps) {
  // State
  const [activeTab, setActiveTab] = useState<'friends' | 'activity' | 'messages'>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [activeChat, setActiveChat] = useState<{ friendId: string; friendName: string; friendAvatar?: string } | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);

    const [friendsData, conversationsData] = await Promise.all([
      friendsAPI.getFriends(userId, appContext),
      messagesAPI.getConversations(userId)
    ]);

    setFriends(friendsData);
    setConversations(conversationsData);
    setIsLoading(false);
  }, [userId, appContext]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update presence on mount
  useEffect(() => {
    presenceAPI.updatePresence(
      userId,
      'online',
      appContext || APP_CODES.COMMAND_CENTER
    );

    return () => {
      presenceAPI.updatePresence(userId, 'offline');
    };
  }, [userId, appContext]);

  // Handle friend selection (open chat)
  const handleSelectFriend = (friend: Friend) => {
    setActiveChat({
      friendId: friend.dash_id,
      friendName: friend.nickname || friend.name,
      friendAvatar: friend.avatar
    });
  };

  // Handle conversation selection
  const handleSelectConversation = (conv: Conversation) => {
    setActiveChat({
      friendId: conv.friend_id,
      friendName: conv.friend_name,
      friendAvatar: conv.friend_avatar
    });
  };

  // Calculate unread count
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  return (
    <div className="h-full bg-[#0a0a0c] flex flex-col">
      {/* Direct Message Chat */}
      
        {activeChat && (
          <DirectMessageChat
            currentUserId={userId}
            currentUserName={userName}
            friendId={activeChat.friendId}
            friendName={activeChat.friendName}
            friendAvatar={activeChat.friendAvatar}
            onClose={() => {
              setActiveChat(null);
              loadData(); // Refresh to update unread counts
              }}
          />
        )}
      

      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-2 -mr-2 rounded-full hover:bg-white/[0.08] transition-colors"
            >
              <Users size={20} className="text-white/60" />
            </button>
          )}
        </div>
      </div>

      {/* VOYO-specific: Profile Card */}
      {renderProfileCard && (
        <div className="flex-shrink-0">
          {renderProfileCard()}
        </div>
      )}

      {/* VOYO-specific: Notes */}
      {showNotes && renderNotes && (
        <div className="flex-shrink-0">
          {renderNotes()}
        </div>
      )}

      {/* VOYO-specific: Following (Artists) */}
      {showFollowing && renderFollowing && (
        <div className="flex-shrink-0">
          {renderFollowing()}
        </div>
      )}

      {/* Tabs */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/[0.06]">
        <div className="flex gap-2">
          {[
            { id: 'friends', label: 'Friends', icon: Users },
            { id: 'activity', label: 'Activity', icon: Activity },
            { id: 'messages', label: 'Messages', icon: MessageCircle, badge: totalUnread }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-black'
                  : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.1]'
              }`}
            >
              <tab.icon size={16} />
              <span>{tab.label}</span>
              {tab.badge && tab.badge > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  activeTab === tab.id ? 'bg-purple-500 text-white' : 'bg-purple-500 text-white'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'friends' && (
          <FriendsTab
            userId={userId}
            friends={friends}
            isLoading={isLoading}
            appContext={appContext}
            onSelectFriend={handleSelectFriend}
            onRefresh={loadData}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityTab
            friends={friends}
            isLoading={isLoading}
            appContext={appContext}
            onSelectFriend={handleSelectFriend}
          />
        )}
        {activeTab === 'messages' && (
          <MessagesTab
            userId={userId}
            conversations={conversations}
            isLoading={isLoading}
            onSelectConversation={handleSelectConversation}
          />
        )}
      </div>

      {/* Bottom padding for nav */}
      <div className="h-20 flex-shrink-0" />
    </div>
  );
}

export default DahubCore;
