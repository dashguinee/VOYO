/**
 * DAHUB - Command Center Social Hub
 * Premium social layer for DASH ecosystem
 *
 * Ported from Hub/Command Center to voyo-music.
 * Framer Motion removed in favor of voyo CSS animations.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Users, MessageCircle, X, Music, Tv, GraduationCap, Shirt, Plane,
  UserPlus, Check, Loader2, Clock, Plus, Headphones, ChevronRight,
  Search, Zap, Bell, CreditCard, BadgeCheck
} from 'lucide-react';
import {
  friendsAPI, messagesAPI, presenceAPI,
  APP_CODES, getAppDisplay,
  type Friend, type Conversation, type AppCode, type SharedAccountMember
} from '../../lib/dahub/dahub-api';
import { DirectMessageChat } from './DirectMessageChat';

// ==============================================
// CONSTANTS & HELPERS
// ==============================================

const SERVICE_COLORS: Record<string, string> = {
  netflix: '#E50914',
  spotify: '#1DB954',
  prime: '#00A8E1',
  disney: '#113CCF',
  hbo: '#B428E6',
  apple: '#FC3C44',
  youtube: '#FF0000'
};

function getServiceColor(name: string): string {
  return SERVICE_COLORS[name.toLowerCase()] || '#8B5CF6';
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatTimeAgo(dateString?: string): string {
  if (!dateString) return 'Recently';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'Recently';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getAppIcon(appCode: string | null, size = 14) {
  const iconProps = { size, strokeWidth: 2.5 };
  switch (appCode) {
    case 'V': return <Music {...iconProps} />;
    case 'E': return <GraduationCap {...iconProps} />;
    case 'TV': return <Tv {...iconProps} />;
    case 'DF': return <Shirt {...iconProps} />;
    case 'DT': return <Plane {...iconProps} />;
    default: return <Headphones {...iconProps} />;
  }
}

// ==============================================
// TYPES
// ==============================================

interface DahubProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  coreId?: string;
  appContext?: AppCode;
  onClose?: () => void;
}

type Tab = 'friends' | 'messages' | 'dash';

// ==============================================
// PROFILE CARD
// ==============================================

function ProfileCard({
  userName,
  userAvatar,
  coreId,
  totalFriends,
  onlineFriends,
  onAddFriend
}: {
  userName: string;
  userAvatar?: string;
  coreId: string;
  totalFriends: number;
  onlineFriends: Friend[];
  onAddFriend: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showFriendCount, setShowFriendCount] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(coreId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCardTap = () => {
    if (showLive) {
      setShowLive(false);
      setShowFriendCount(false);
    } else if (showFriendCount) {
      setShowLive(true);
    } else {
      setShowFriendCount(true);
    }
  };

  const onlineCount = onlineFriends.length;

  return (
    <div className="px-6 pt-2 pb-6">
      <div
        className="relative flex items-center gap-5 p-6 rounded-3xl border border-white/[0.08] overflow-hidden cursor-pointer transition-transform active:scale-[0.98] animate-voyo-fade-in"
        onClick={handleCardTap}
      >
        {/* Premium metallic gradient background — purple to bronze */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(139,92,246,0.08) 45%, rgba(212,160,83,0.12) 100%)',
          }}
        />

        {/* Soft glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-400/[0.04] to-[#D4A053]/[0.04] blur-2xl" />

        {!showLive && (
          // ID CARD VIEW - With friends count + add
          <div
            key="id-card"
            className="flex items-center gap-5 w-full z-10 animate-voyo-fade-in"
          >
            {/* Avatar — bigger (72px) */}
            <div className="relative flex-shrink-0">
              {userAvatar ? (
                <img src={userAvatar} alt="" className="w-[72px] h-[72px] rounded-full object-cover ring-2 ring-white/[0.1]" />
              ) : (
                <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-2xl font-bold text-white ring-2 ring-white/[0.1]">
                  {getInitials(userName)}
                </div>
              )}
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-green-500 border-[3px] border-[#0a0a0f]" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-lg mb-1">{userName}</p>
              <button onClick={handleCopy} className="flex items-center gap-2 group">
                <span className="text-white/45 text-xs font-mono">{coreId}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                  copied ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/40 group-hover:bg-white/10'
                }`}>
                  {copied ? '✓' : 'Copy'}
                </span>
              </button>
            </div>

            {/* Friends count (only when expanded) + Add button */}
            <div className="flex items-center gap-4 flex-shrink-0">
              {showFriendCount && (
                <div className="text-center animate-voyo-scale-in">
                  <p className="text-white font-bold text-xl">{totalFriends}</p>
                  <p className="text-white/40 text-[10px] font-medium uppercase tracking-wider">Friends</p>
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onAddFriend(); }}
                className="w-12 h-12 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 hover:bg-purple-500/30 transition-all active:scale-95"
                aria-label="Add friend"
              >
                <UserPlus size={20} />
              </button>
            </div>

            {/* Faint tap hint */}
            {!showFriendCount && (
              <span className="absolute top-3 right-3 text-white/15 text-[9px]">tap</span>
            )}
          </div>
        )}

        {showLive && (
          // OYÉ! WE LIVE VIEW
          <div
            key="live"
            className="flex items-center gap-5 w-full z-10 animate-voyo-fade-in"
          >
            {/* Static aurora glow */}
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background: 'radial-gradient(ellipse at 40% 50%, rgba(139, 92, 246, 0.3) 0%, transparent 55%), radial-gradient(ellipse at 70% 60%, rgba(212, 160, 83, 0.25) 0%, transparent 50%)',
              }}
            />

            {/* Orbiting avatars cluster — BIGGER */}
            <div className="relative flex-shrink-0" style={{ width: '84px', height: '84px' }}>
              {/* Pulsing ring */}
              <div
                className="absolute inset-0 rounded-full border-2 border-white/15"
                style={{ animation: 'voyo-ambient-pulse 2.5s ease-in-out infinite' }}
              />

              {/* Center avatar */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                <div className="relative">
                  <div className="w-14 h-14 rounded-full overflow-hidden border-[3px] border-white shadow-xl">
                    {onlineFriends[0]?.avatar ? (
                      <img src={onlineFriends[0].avatar} alt="" className="w-full h-full object-cover" />
                    ) : onlineCount > 0 ? (
                      <div className="w-full h-full bg-gradient-to-br from-purple-500 to-[#D4A053] flex items-center justify-center text-base text-white font-bold">
                        {getInitials(onlineFriends[0]?.name || '?')}
                      </div>
                    ) : (
                      <div className="w-full h-full bg-white/10 flex items-center justify-center">
                        <Users className="w-6 h-6 text-white/30" />
                      </div>
                    )}
                  </div>
                  {onlineCount > 0 && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-white" />
                  )}
                </div>
              </div>

              {/* Orbiting smaller avatars */}
              {onlineFriends.slice(1, 4).map((friend, i) => {
                const angles = [-50, 50, 180];
                const angle = angles[i] * (Math.PI / 180);
                const radius = 32;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return (
                  <div
                    key={friend.dash_id}
                    className="absolute w-8 h-8 rounded-full overflow-hidden border-2 border-white/90 shadow-lg animate-voyo-pop-in"
                    style={{
                      left: '50%',
                      top: '50%',
                      transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                      zIndex: 10 - i,
                      animationDelay: `${i * 80}ms`,
                    }}
                  >
                    {friend.avatar ? (
                      <img src={friend.avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-purple-500 to-[#D4A053] flex items-center justify-center text-[9px] text-white font-bold">
                        {getInitials(friend.name)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Live text */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                <h3 className="text-white font-bold text-xl leading-tight">
                  {onlineCount > 0 ? 'Oyé! We Live' : 'No One Live'}
                </h3>
              </div>
              <p className="text-white/55 text-sm">
                {onlineCount === 0
                  ? 'Check back soon'
                  : `${onlineCount} friend${onlineCount !== 1 ? 's' : ''} Online`
                }
              </p>
            </div>

            {/* Action button */}
            {onlineCount > 0 && (
              <div className="w-12 h-12 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center flex-shrink-0 transition-transform active:scale-95">
                <Users className="w-5 h-5 text-green-400" />
              </div>
            )}
          </div>
        )}

        {/* State indicator dots */}
        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full transition-all ${!showLive ? 'bg-white/60' : 'bg-white/20'}`} />
          <div className={`w-1.5 h-1.5 rounded-full transition-all ${showLive ? 'bg-white/60' : 'bg-white/20'}`} />
        </div>
      </div>
    </div>
  );
}

// ==============================================
// NOTES & STORIES SECTION (Instagram-style)
// Bubble IS the story indicator — no extra icon overlay.
// ==============================================

function NotesStoriesSection({
  myNote,
  friends,
  onEditNote,
  onSelectFriend
}: {
  myNote: string;
  friends: Friend[];
  onEditNote: () => void;
  onSelectFriend: (friend: Friend) => void;
}) {
  // Sort: online with activity first
  const sorted = [...friends].sort((a, b) => {
    if (a.status === 'online' && b.status !== 'online') return -1;
    if (a.status !== 'online' && b.status === 'online') return 1;
    return 0;
  });

  return (
    <div className="px-6 pt-10 pb-8">
      <div className="flex gap-5 overflow-x-auto pb-2 scrollbar-hide">
        {/* My Note */}
        <button
          onClick={onEditNote}
          className="flex flex-col items-center flex-shrink-0 transition-transform active:scale-95"
        >
          <div className="relative mb-1">
            {/* Note bubble floating above */}
            {myNote && (
              <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-xl bg-gradient-to-r from-purple-500/30 to-[#D4A053]/30 border border-purple-500/40 whitespace-nowrap max-w-[90px] z-10 animate-voyo-pop-in">
                <p className="text-white text-[11px] truncate">{myNote}</p>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gradient-to-br from-purple-500/30 to-[#D4A053]/30 rotate-45 border-r border-b border-purple-500/40" />
              </div>
            )}
            {/* Avatar circle with dashed border for "add" — 80px */}
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-[#D4A053]/20 border-2 border-dashed border-white/20 flex items-center justify-center">
              {myNote ? (
                <span className="text-2xl">{myNote.slice(0, 2)}</span>
              ) : (
                <Plus className="w-8 h-8 text-white/40" />
              )}
            </div>
          </div>
          <p className="text-white/55 text-xs mt-2.5 font-medium">Your note</p>
        </button>

        {/* Friends with notes/stories */}
        {sorted.slice(0, 10).map((friend) => {
          const isOnline = friend.status === 'online';
          const hasActivity = isOnline && friend.activity;

          // Gradient ring: purple → bronze for active, green for online, muted for offline
          const ringStyle = hasActivity
            ? {
                padding: '3px',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 45%, #D4A053 100%)',
              }
            : isOnline
              ? {
                  padding: '3px',
                  background: 'linear-gradient(135deg, rgba(34,197,94,0.5) 0%, rgba(34,197,94,0.3) 100%)',
                }
              : {
                  padding: '2px',
                  background: 'rgba(255,255,255,0.08)',
                };

          return (
            <button
              key={friend.dash_id}
              onClick={() => onSelectFriend(friend)}
              className="flex flex-col items-center flex-shrink-0 transition-transform active:scale-95"
            >
              <div className="relative mb-1">
                {/* Note bubble floating above (if has activity) */}
                {hasActivity && (
                  <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-xl bg-gradient-to-r from-purple-500/30 to-[#D4A053]/30 border border-purple-500/40 whitespace-nowrap max-w-[90px] z-10 animate-voyo-pop-in">
                    <p className="text-white text-[11px] truncate">{friend.activity}</p>
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gradient-to-br from-purple-500/30 to-[#D4A053]/30 rotate-45 border-r border-b border-purple-500/40" />
                  </div>
                )}

                {/* Avatar circle with gradient ring — 80px, bubble IS the indicator */}
                <div className="rounded-full" style={ringStyle}>
                  <div className="w-[74px] h-[74px] rounded-full overflow-hidden bg-[#0a0a0f]">
                    {friend.avatar ? (
                      <img src={friend.avatar} alt="" className={`w-full h-full object-cover ${!isOnline ? 'opacity-50' : ''}`} />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br from-purple-500/60 to-violet-600/60 flex items-center justify-center text-white text-xl font-semibold ${!isOnline ? 'opacity-50' : ''}`}>
                        {getInitials(friend.name)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Online indicator — small green dot only */}
                {isOnline && (
                  <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-green-500 border-[3px] border-[#0a0a0f]" />
                )}
                {/* NOTE: removed the app-badge icon overlay per design — bubble IS the indicator */}
              </div>
              <p className={`text-xs mt-2.5 truncate max-w-[80px] font-medium ${isOnline ? 'text-white/75' : 'text-white/35'}`}>
                {friend.name.split(' ')[0]}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==============================================
// FOLLOWING SECTION (Artists/Services)
// ==============================================

const FOLLOWING_AVATARS = {
  burna: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg',
  wizkid: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg',
  rema: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg',
  tems: 'https://i.ytimg.com/vi/VDcEJE633rM/hqdefault.jpg',
};

const FOLLOWING_DATA = [
  { id: 'burna', name: 'Burna Boy', avatar: FOLLOWING_AVATARS.burna, verified: true, isLive: false },
  { id: 'wizkid', name: 'Wizkid', avatar: FOLLOWING_AVATARS.wizkid, verified: true, isLive: true },
  { id: 'rema', name: 'Rema', avatar: FOLLOWING_AVATARS.rema, verified: true, isLive: false },
  { id: 'tems', name: 'Tems', avatar: FOLLOWING_AVATARS.tems, verified: true, isLive: false },
];

function FollowingSection() {
  return (
    <div className="px-6 pt-2 pb-6">
      <p className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-4 text-center">Following</p>
      <div className="flex justify-center">
        <div className="w-[360px] overflow-x-auto scrollbar-hide">
          <div className="flex gap-4 py-1 px-2 justify-center">
            {FOLLOWING_DATA.map(artist => (
              <button
                key={artist.id}
                className="flex-shrink-0 transition-transform active:scale-95"
              >
                <div className={`relative w-20 h-20 rounded-2xl overflow-hidden ${artist.isLive ? 'ring-2 ring-red-500' : 'ring-1 ring-white/10'}`}>
                  {/* Image zoomed in */}
                  <img src={artist.avatar} alt="" className="w-full h-full object-cover scale-150" />

                  {/* Full card overlay for cohesion */}
                  <div className="absolute inset-0 bg-black/20" />

                  {/* Gradient overlay at bottom for name */}
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-purple-900/40 to-transparent" />

                  {/* Name overlaid at bottom */}
                  <p className="absolute bottom-1.5 left-0 right-0 text-center text-white text-[10px] font-semibold truncate px-1">
                    {artist.name}
                  </p>

                  {/* Verified badge */}
                  {artist.verified && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                      <BadgeCheck className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}

                  {/* LIVE indicator */}
                  {artist.isLive && (
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-red-500 text-[8px] font-bold text-white">
                      LIVE
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// TAB BAR
// ==============================================

function TabBar({
  activeTab,
  onTabChange,
  friendCount,
  unreadCount
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  friendCount: number;
  unreadCount: number;
}) {
  const tabs: { id: Tab; label: string; icon: typeof Users; badge?: number; color?: string }[] = [
    { id: 'friends', label: 'Friends', icon: Users, badge: friendCount || undefined },
    { id: 'messages', label: 'Messages', icon: MessageCircle, badge: unreadCount || undefined },
    { id: 'dash', label: 'DASH', icon: Zap, color: '#8B5CF6' }
  ];

  return (
    <div className="px-6 pt-2 pb-5">
      <div className="flex gap-2 p-2 bg-white/[0.03] rounded-2xl border border-white/[0.04]">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-sm transition-all active:scale-[0.98] min-h-[44px] ${
                isActive
                  ? 'text-white'
                  : 'text-white/45 hover:text-white/65'
              }`}
            >
              {/* Premium gradient background for active state */}
              {isActive && (
                <div
                  className="absolute inset-0 rounded-xl border border-purple-500/30"
                  style={{
                    background: 'linear-gradient(90deg, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.32) 50%, rgba(212,160,83,0.22) 100%)',
                  }}
                />
              )}
              <Icon
                size={17}
                className="relative z-10"
                style={tab.color ? { color: isActive ? tab.color : undefined } : {}}
              />
              <span className="relative z-10">{tab.label}</span>
              {tab.badge && tab.badge > 0 && (
                <span className="relative z-10 min-w-[20px] h-[20px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center bg-purple-500 text-white">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==============================================
// FRIEND ITEM
// ==============================================

function FriendItem({ friend, onClick }: { friend: Friend; onClick: () => void }) {
  const isOnline = friend.status === 'online';
  const appDisplay = getAppDisplay(friend.current_app);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-white/[0.03] transition-all group active:scale-[0.98] min-h-[72px]"
    >
      {/* Avatar — bigger (56px) */}
      <div className="relative flex-shrink-0">
        <div className={`w-14 h-14 rounded-full overflow-hidden flex items-center justify-center font-semibold text-white ${
          friend.avatar ? '' : 'bg-gradient-to-br from-purple-500/60 to-violet-600/60'
        } ${!isOnline ? 'opacity-50' : ''}`}>
          {friend.avatar ? (
            <img src={friend.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-base">{getInitials(friend.name)}</span>
          )}
        </div>

        {/* Online indicator */}
        <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-[#0a0a0f] ${
          friend.status === 'online' ? 'bg-green-500' :
          friend.status === 'away' ? 'bg-amber-500' : 'bg-white/20'
        }`} />

        {/* App badge */}
        {friend.current_app && isOnline && (
          <div
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-white shadow-lg"
            style={{ background: appDisplay.color }}
          >
            {getAppIcon(friend.current_app, 10)}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 text-left">
        <p className={`font-semibold text-[15px] ${isOnline ? 'text-white' : 'text-white/55'}`}>
          {friend.nickname || friend.name}
        </p>
        <p className={`text-sm truncate mt-0.5 ${isOnline ? 'text-white/45' : 'text-white/30'}`}>
          {isOnline && friend.activity
            ? friend.activity
            : isOnline
              ? 'Online'
              : `Last seen ${formatTimeAgo(friend.last_seen)}`
          }
        </p>
      </div>

      <ChevronRight size={20} className="text-white/20 group-hover:text-white/40 transition-colors" />
    </button>
  );
}

// ==============================================
// MESSAGE ITEM
// ==============================================

function MessageItem({ convo, onClick }: { convo: Conversation; onClick: () => void }) {
  const hasUnread = convo.unread_count > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all active:scale-[0.98] min-h-[72px] ${
        hasUnread ? 'bg-purple-500/[0.08]' : 'hover:bg-white/[0.03]'
      }`}
    >
      {/* Avatar — bigger (56px) */}
      <div className="relative flex-shrink-0">
        <div className={`w-14 h-14 rounded-full overflow-hidden flex items-center justify-center font-semibold text-white ${
          convo.friend_avatar ? '' : 'bg-gradient-to-br from-purple-500/60 to-violet-600/60'
        }`}>
          {convo.friend_avatar ? (
            <img src={convo.friend_avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-base">{getInitials(convo.friend_name)}</span>
          )}
        </div>
        {convo.is_online && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-[#0a0a0f]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className={`font-semibold text-[15px] truncate ${hasUnread ? 'text-white' : 'text-white/75'}`}>
            {convo.friend_name}
          </p>
          <span className="text-white/35 text-[11px] flex-shrink-0">
            {formatTimeAgo(convo.last_message_time)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {convo.sent_from && (
            <span
              className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: getAppDisplay(convo.sent_from).color + '25' }}
            >
              {getAppIcon(convo.sent_from, 10)}
            </span>
          )}
          <p className={`text-sm truncate ${hasUnread ? 'text-white/65 font-medium' : 'text-white/40'}`}>
            {convo.last_message}
          </p>
        </div>
      </div>

      {hasUnread && (
        <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/30">
          <span className="text-white text-xs font-bold">
            {convo.unread_count > 9 ? '9+' : convo.unread_count}
          </span>
        </div>
      )}
    </button>
  );
}

// ==============================================
// DASH MEMBER ITEM
// ==============================================

// VOYO is free for all DASH members - always show it
const VOYO_SERVICE = {
  account_id: 'voyo-free',
  service_name: 'VOYO',
  service_type: 'music',
  service_icon: 'voyo',
  service_color: '#8B5CF6',
};

function DashMemberItem({
  member,
  onConnect,
  isConnecting
}: {
  member: SharedAccountMember;
  onConnect: () => void;
  isConnecting: boolean;
}) {
  const sharedServices = member.shared_services.slice(0, 3);
  const allServices = [...sharedServices, VOYO_SERVICE];

  return (
    <div className="flex items-center gap-4 p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04] animate-voyo-fade-in">
      {/* Avatar with stacked service pile */}
      <div className="relative flex-shrink-0">
        <div className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center font-semibold text-white bg-gradient-to-br from-white/10 to-white/5 opacity-55">
          {member.avatar ? (
            <img src={member.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-base">{getInitials(member.name)}</span>
          )}
        </div>

        {/* Stacked service badges */}
        <div className="absolute -bottom-1 -right-1 flex opacity-90">
          {[...allServices].reverse().map((service, reverseIdx) => {
            const idx = allServices.length - 1 - reverseIdx;
            const offset = idx * 10;
            const isVoyo = service.account_id === 'voyo-free';
            return (
              <div
                key={service.account_id || idx}
                className="absolute w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-lg border-2 border-[#0a0a0f]"
                style={{
                  background: isVoyo ? '#8B5CF6' : getServiceColor(service.service_name),
                  right: offset,
                  zIndex: allServices.length - idx,
                }}
                title={isVoyo ? 'VOYO (Free with DASH)' : service.service_name}
              >
                {isVoyo ? 'V' : service.service_name[0]}
              </div>
            );
          })}
        </div>

        {/* Extra services indicator */}
        {member.shared_services.length > 3 && (
          <div
            className="absolute -bottom-1 w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white/80 bg-white/20 border-2 border-[#0a0a0f]"
            style={{ right: 4 * 10 + 2, zIndex: 0 }}
          >
            +{member.shared_services.length - 3}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <p className="text-white/85 font-medium text-[15px] truncate leading-tight">{member.name}</p>
        {sharedServices.length > 0 ? (() => {
          const primary = sharedServices[0];
          const foyerId = primary.account_id?.split('-').pop()?.toUpperCase() || '???';
          const serviceColor = getServiceColor(primary.service_name);
          return (
            <p className="text-[11px] truncate opacity-70 mt-1">
              <span className="font-bold" style={{ color: serviceColor }}>{primary.service_name}</span>
              <span className="text-white/50 font-mono"> - {foyerId}</span>
            </p>
          );
        })() : (
          <p className="text-[11px] opacity-70 mt-1">
            <span className="font-bold" style={{ color: '#8B5CF6' }}>VOYO</span>
            <span className="text-white/50"> member</span>
          </p>
        )}
      </div>

      {/* Action */}
      {member.friend_status === 'pending' ? (
        <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock size={13} />
          <span className="text-xs font-medium">Pending</span>
        </div>
      ) : (
        <button
          onClick={onConnect}
          disabled={isConnecting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/20 transition-all disabled:opacity-50 active:scale-95 min-h-[36px]"
        >
          {isConnecting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <>
              <Plus size={13} />
              <span className="text-xs font-medium">Connect</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ==============================================
// ADD FRIEND MODAL
// ==============================================

function AddFriendModal({ userId, onClose, onAdded }: { userId: string; onClose: () => void; onAdded: () => void }) {
  const [friendId, setFriendId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (!friendId.trim()) return;
    const id = friendId.trim().toUpperCase();
    if (id === userId) { setError("Can't add yourself"); setStatus('error'); return; }

    setStatus('loading');
    const success = await friendsAPI.addFriend(userId, id);
    if (success) {
      setStatus('success');
      setTimeout(() => { onAdded(); onClose(); }, 1000);
    } else {
      setError('User not found');
      setStatus('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-voyo-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#12121a] rounded-3xl p-7 shadow-2xl border border-white/10 animate-voyo-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white font-bold text-xl">Add Friend</h2>
          <button onClick={onClose} className="p-2.5 -mr-2 rounded-xl hover:bg-white/10 active:scale-95 transition-transform">
            <X size={22} className="text-white/60" />
          </button>
        </div>

        {status === 'success' ? (
          <div className="flex flex-col items-center py-8">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-4 animate-voyo-pop-in">
              <Check size={36} className="text-green-500" />
            </div>
            <p className="text-white font-semibold text-base">Request Sent!</p>
          </div>
        ) : (
          <>
            <div className="relative mb-6">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
              <input
                type="text" value={friendId}
                onChange={e => { setFriendId(e.target.value.toUpperCase()); setStatus('idle'); setError(''); }}
                placeholder="Enter DASH ID"
                className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 outline-none focus:border-purple-500/50 font-mono text-lg tracking-wider"
                autoFocus
              />
            </div>
            {error && <p className="text-red-400 text-sm text-center mb-4">{error}</p>}
            <button
              onClick={handleAdd}
              disabled={!friendId.trim() || status === 'loading'}
              className={`w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                !friendId.trim() || status === 'loading'
                  ? 'bg-white/10 text-white/40'
                  : 'bg-gradient-to-r from-purple-500 to-violet-600 text-white shadow-lg shadow-purple-500/30'
              }`}
            >
              {status === 'loading' ? <Loader2 size={20} className="animate-spin" /> : <><UserPlus size={20} /><span>Send Request</span></>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ==============================================
// NOTE EDIT MODAL
// ==============================================

function NoteEditModal({ note, userAvatar, userName, onSave, onClose }: { note: string; userAvatar?: string; userName: string; onSave: (note: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(note);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-xl flex items-end justify-center animate-voyo-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#1a1a24] rounded-t-3xl p-7 pb-10 animate-voyo-slide-in-bottom"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <button onClick={onClose} className="text-white/55 text-sm min-h-[44px] px-2">Cancel</button>
          <p className="text-white font-semibold text-base">New Note</p>
          <button onClick={() => { onSave(value); onClose(); }} className="text-purple-400 font-semibold text-sm min-h-[44px] px-2">Share</button>
        </div>

        <div className="flex flex-col items-center mb-6">
          <div className="relative mb-2">
            {/* Note bubble preview */}
            <div className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-500/20 to-[#D4A053]/20 border border-purple-500/30 mb-3">
              <p className="text-white text-sm">{value || 'Your note...'}</p>
            </div>
            {/* Avatar */}
            {userAvatar ? (
              <img src={userAvatar} alt="" className="w-20 h-20 rounded-full object-cover ring-2 ring-purple-500/30 mx-auto" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-2xl font-bold text-white ring-2 ring-purple-500/30 mx-auto">
                {userName[0]?.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        <input
          type="text" value={value} onChange={e => setValue(e.target.value)}
          placeholder="Share a thought..."
          maxLength={60}
          className="w-full px-4 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white text-center placeholder-white/30 focus:outline-none focus:border-purple-500/50"
          autoFocus
        />
        <p className="text-white/30 text-xs text-center mt-2">{value.length}/60</p>
      </div>
    </div>
  );
}

// ==============================================
// MAIN DAHUB COMPONENT
// ==============================================

export function Dahub({ userId, userName, userAvatar, coreId, appContext, onClose }: DahubProps) {
  const [activeTab, setActiveTab] = useState<Tab>('messages');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [sharedMembers, setSharedMembers] = useState<SharedAccountMember[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showNoteEdit, setShowNoteEdit] = useState(false);
  const [note, setNote] = useState('');
  const [showSupportMenu, setShowSupportMenu] = useState(false);
  const [activeChat, setActiveChat] = useState<{ friendId: string; friendName: string; friendAvatar?: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const isMasterView = !appContext || appContext === APP_CODES.COMMAND_CENTER;
  const onlineCount = friends.filter(f => f.status === 'online').length;
  const suggestions = sharedMembers.filter(m => m.friend_status !== 'accepted');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [friendsData, sharedData, conversationsData, unread] = await Promise.all([
      friendsAPI.getFriends(userId),
      friendsAPI.getSharedAccountMembers(userId),
      messagesAPI.getConversations(userId),
      messagesAPI.getUnreadCount(userId)
    ]);
    setFriends(friendsData);
    setSharedMembers(sharedData);
    setConversations(conversationsData);
    setUnreadCount(unread);
    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    loadData();
    let unsubscribe: (() => void) | null = null;
    try {
      presenceAPI.updatePresence(userId, 'online', appContext || APP_CODES.COMMAND_CENTER);
      unsubscribe = messagesAPI.subscribeToMessages(userId, (msg) => {
        setConversations(prev => {
          const existing = prev.find(c => c.friend_id === msg.from_id);
          if (existing) {
            return prev.map(c => c.friend_id === msg.from_id ? { ...c, last_message: msg.message, last_message_time: msg.created_at, unread_count: c.unread_count + 1 } : c);
          }
          return prev;
        });
        setUnreadCount(c => c + 1);
      });
    } catch { /* Supabase not configured or network error */ }
    return () => {
      try { unsubscribe?.(); } catch {}
      try { presenceAPI.updatePresence(userId, 'offline', appContext || APP_CODES.COMMAND_CENTER); } catch {}
    };
  }, [userId, appContext, loadData]);

  const handleConnect = async (member: SharedAccountMember) => {
    setConnectingId(member.dash_id);
    const success = await friendsAPI.sendFriendRequest(userId, member.dash_id);
    if (success) setSharedMembers(prev => prev.map(m => m.dash_id === member.dash_id ? { ...m, friend_status: 'pending' as const } : m));
    setConnectingId(null);
  };

  return (
    <div className="h-full bg-[#0a0a0f] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 pt-5 px-6 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">DaHub</h1>
            {isMasterView && (
              <span className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/20 text-purple-400 text-[10px] font-semibold uppercase tracking-wider">
                All Apps
              </span>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-3 rounded-xl hover:bg-white/[0.06] text-white/55 active:scale-95 transition-transform min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <X size={22} />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-purple-400" />
        </div>
      ) : (
        <>
          {/* Profile Card */}
          <ProfileCard
            userName={userName}
            userAvatar={userAvatar}
            coreId={coreId || userId}
            totalFriends={friends.length}
            onlineFriends={friends.filter(f => f.status === 'online')}
            onAddFriend={() => setShowAddFriend(true)}
          />

          {/* Notes & Stories */}
          <NotesStoriesSection
            myNote={note}
            friends={friends}
            onEditNote={() => setShowNoteEdit(true)}
            onSelectFriend={(friend) => setActiveChat({ friendId: friend.dash_id, friendName: friend.name, friendAvatar: friend.avatar })}
          />

          {/* Following (Services, Stars, Brands) */}
          <FollowingSection />

          {/* Tab Bar */}
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} friendCount={onlineCount} unreadCount={unreadCount} />

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {activeTab === 'friends' && (
              <div key="friends" className="space-y-1 animate-voyo-fade-in">
                {friends.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4">
                      <Users size={32} className="text-white/20" />
                    </div>
                    <p className="text-white/55 font-medium mb-1 text-base">No friends yet</p>
                    <p className="text-white/30 text-sm">Add friends with their DASH ID</p>
                  </div>
                ) : (
                  friends.map(friend => (
                    <FriendItem
                      key={friend.dash_id}
                      friend={friend}
                      onClick={() => setActiveChat({ friendId: friend.dash_id, friendName: friend.name, friendAvatar: friend.avatar })}
                    />
                  ))
                )}
              </div>
            )}

            {activeTab === 'messages' && (
              <div key="messages" className="space-y-1 animate-voyo-fade-in">
                {conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4">
                      <MessageCircle size={32} className="text-white/20" />
                    </div>
                    <p className="text-white/55 font-medium mb-1 text-base">No messages yet</p>
                    <p className="text-white/30 text-sm">Start a conversation with a friend</p>
                  </div>
                ) : (
                  conversations.map(convo => (
                    <MessageItem
                      key={convo.friend_id}
                      convo={convo}
                      onClick={() => setActiveChat({ friendId: convo.friend_id, friendName: convo.friend_name, friendAvatar: convo.friend_avatar })}
                    />
                  ))
                )}
              </div>
            )}

            {activeTab === 'dash' && (
              <div key="dash" className="space-y-8 animate-voyo-fade-in">
                {/* Support FIRST */}
                <div>
                  <p className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-4">Support & Updates</p>
                  <div className="space-y-2.5">
                    {/* DASH Support - Expandable */}
                    <button
                      onClick={() => setShowSupportMenu(!showSupportMenu)}
                      className="w-full flex items-center gap-4 p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all active:scale-[0.98] min-h-[76px]"
                    >
                      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#FBBF2415' }}>
                        <Zap size={24} style={{ color: '#FBBF24' }} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white/85 font-medium text-[15px]">DASH Support</p>
                        <p className="text-white/35 text-sm mt-0.5">Get help anytime</p>
                      </div>
                      <div
                        className="transition-transform"
                        style={{ transform: showSupportMenu ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <ChevronRight size={20} className="text-white/25" />
                      </div>
                    </button>

                    {/* Support Options - Expandable */}
                    {showSupportMenu && (
                      <div className="overflow-hidden animate-voyo-fade-in">
                        <div className="pl-4 space-y-2.5 pb-2">
                          {/* Zion DASH — AI chatbot */}
                          <button
                            onClick={() => window.dispatchEvent(new CustomEvent('dash-widget-open'))}
                            className="w-full flex items-center gap-3 p-4 rounded-xl bg-amber-500/[0.06] border border-amber-500/10 hover:bg-amber-500/10 transition-all active:scale-[0.97] min-h-[60px]"
                          >
                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/20">
                              <Zap size={17} className="text-amber-400" />
                            </div>
                            <div className="flex-1 text-left">
                              <p className="text-white/85 text-sm font-medium">Zion DASH</p>
                              <p className="text-white/35 text-xs mt-0.5">AI Assistant</p>
                            </div>
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                          </button>

                          {/* Saliou DASH — WhatsApp */}
                          <button
                            onClick={() => window.open('https://wa.me/224611361300', '_blank')}
                            className="w-full flex items-center gap-3 p-4 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/10 hover:bg-emerald-500/10 transition-all active:scale-[0.97] min-h-[60px]"
                          >
                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-emerald-500/20">
                              <span className="text-emerald-400 font-bold text-sm">S</span>
                            </div>
                            <div className="flex-1 text-left">
                              <p className="text-white/85 text-sm font-medium">Saliou DASH</p>
                              <p className="text-white/35 text-xs mt-0.5">Support Agent</p>
                            </div>
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                          </button>

                          {/* Diop DASH — Direct Message */}
                          <button
                            onClick={() => setActiveChat({ friendId: '0000', friendName: 'Diop DASH' })}
                            className="w-full flex items-center gap-3 p-4 rounded-xl bg-purple-500/[0.06] border border-purple-500/10 hover:bg-purple-500/10 transition-all active:scale-[0.97] min-h-[60px]"
                          >
                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-purple-500/20">
                              <span className="text-purple-400 font-bold text-sm">D</span>
                            </div>
                            <div className="flex-1 text-left">
                              <p className="text-white/85 text-sm font-medium">Diop DASH</p>
                              <p className="text-white/35 text-xs mt-0.5">Founder</p>
                            </div>
                            <div className="w-2 h-2 rounded-full bg-purple-400" />
                          </button>

                          {/* WhatsApp Banner Fallback */}
                          <a href="https://wa.me/224611361300" target="_blank" rel="noopener noreferrer" className="block mt-2">
                            <div className="relative rounded-xl overflow-hidden border border-white/[0.06]">
                              <img src="/landing/wa-dash-banner.webp" alt="DASH WhatsApp" className="w-full rounded-xl" />
                              <div className="absolute inset-0 rounded-xl flex items-end justify-between px-3 pb-2" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%)' }}>
                                <span className="text-[11px] text-white/65">Prefer WhatsApp?</span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#25D366', color: '#fff' }}>Message Us</span>
                              </div>
                            </div>
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Announcements */}
                    <button className="w-full flex items-center gap-4 p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all active:scale-[0.98] min-h-[76px]">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#8B5CF615' }}>
                        <Bell size={24} style={{ color: '#8B5CF6' }} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white/85 font-medium text-[15px]">Announcements</p>
                        <p className="text-white/35 text-sm mt-0.5">Latest updates</p>
                      </div>
                      <ChevronRight size={20} className="text-white/25" />
                    </button>

                    {/* Subscription */}
                    <button className="w-full flex items-center gap-4 p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all active:scale-[0.98] min-h-[76px]">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#10B98115' }}>
                        <CreditCard size={24} style={{ color: '#10B981' }} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white/85 font-medium text-[15px]">Subscription</p>
                        <p className="text-white/35 text-sm mt-0.5">Manage your plan</p>
                      </div>
                      <ChevronRight size={20} className="text-white/25" />
                    </button>
                  </div>
                </div>

                {/* DASH Members SECOND */}
                {suggestions.length > 0 && (
                  <div>
                    <p className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-4">DASH Members</p>
                    <div className="space-y-2.5">
                      {suggestions.map(member => (
                        <DashMemberItem
                          key={member.dash_id}
                          member={member}
                          onConnect={() => handleConnect(member)}
                          isConnecting={connectingId === member.dash_id}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Modals */}
      {showAddFriend && (
        <AddFriendModal userId={userId} onClose={() => setShowAddFriend(false)} onAdded={loadData} />
      )}
      {showNoteEdit && (
        <NoteEditModal note={note} userAvatar={userAvatar} userName={userName} onSave={setNote} onClose={() => setShowNoteEdit(false)} />
      )}
      {activeChat && (
        <DirectMessageChat
          currentUserId={userId}
          currentUserName={userName}
          friendId={activeChat.friendId}
          friendName={activeChat.friendName}
          friendAvatar={activeChat.friendAvatar}
          onClose={() => { setActiveChat(null); loadData(); }}
        />
      )}
    </div>
  );
}

export default Dahub;
