/**
 * DAHUB - VOYO Social Hub
 * Premium social layer for DASH ecosystem
 * Unified design from Command Center
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TiviPlusCrossPromo } from '../voyo/TiviPlusCrossPromo';
import {
  Users, MessageCircle, X, Music, Tv, GraduationCap, Shirt, Plane,
  UserPlus, Check, Loader2, Clock, Plus, Headphones, ChevronRight,
  Search, Compass, Bell, CreditCard, BadgeCheck, Music2
} from 'lucide-react';
import {
  friendsAPI, messagesAPI, presenceAPI,
  APP_CODES, getAppDisplay,
  type Friend, type Conversation, type AppCode, type SharedAccountMember
} from '../../lib/dahub/dahub-api';
import { DirectMessageChat } from './DirectMessageChat';
import { usePlayerStore } from '../../store/playerStore';
import { getYouTubeThumbnail } from '../../data/tracks';
import { devWarn } from '../../utils/logger';

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

// Auto-detect DASH identity from multiple sources
const DASH_STORAGE_KEY = 'dash_citizen_storage';

interface DashCitizen {
  coreId: string;
  displayId: string;
  fullName: string;
  initials: string;
}

function useDashIdentity(propsUserId?: string, propsUserName?: string): { userId: string; userName: string; isGuest: boolean } {
  // 1. Props take priority (explicit override)
  if (propsUserId && propsUserName) {
    return { userId: propsUserId, userName: propsUserName, isGuest: false };
  }

  // 2. Check dash_citizen_storage (cross-app SSO)
  // Handles both nested format { state: { citizen: {...} } } and flat format { coreId: ... }
  try {
    const stored = localStorage.getItem(DASH_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);

      // Try nested format first (from dash-auth.tsx)
      const citizen = data.state?.citizen || data;

      if (citizen.coreId) {
        return {
          userId: citizen.coreId,
          userName: citizen.fullName || citizen.displayId || citizen.coreId,
          isGuest: false
        };
      }
    }
  } catch (e) {
    // localStorage not available or invalid data
  }

  // 3. Guest mode fallback
  return { userId: 'guest', userName: 'Guest', isGuest: true };
}

interface DahubProps {
  userId?: string;  // Optional - auto-detected if not provided
  userName?: string; // Optional - auto-detected if not provided
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
  onAddFriend,
  appContext
}: {
  userName: string;
  userAvatar?: string;
  coreId: string;
  totalFriends: number;
  onlineFriends: Friend[];
  onAddFriend: () => void;
  appContext?: AppCode;
}) {
  const [copied, setCopied] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [showFriendCount, setShowFriendCount] = useState(false);

  // VOYO Now Playing - only in VOYO context
  const isVoyo = appContext === 'V';
  const { currentTrack, queue } = usePlayerStore();
  const nextTrack = queue[0];

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
        className="relative flex items-center gap-4 p-5 rounded-3xl border border-white/[0.08] overflow-hidden cursor-pointer" onClick={handleCardTap}
      >
        {/* Moving gradient background */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-purple-500/[0.15] via-violet-500/[0.08] to-purple-600/[0.15]" style={{ backgroundSize: '200% 200%' }}
        />

        {/* Occasional shimmer */}
        <div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

        {/* Soft glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-400/[0.03] to-violet-400/[0.03] blur-2xl" />

        <>
          {!showLive && (
            // ID CARD VIEW - With friends count + add
            <div
              key="id-card"
              className="flex items-center gap-4 w-full z-10" >
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                {userAvatar ? (
                  <img src={userAvatar} alt="" className="w-14 h-14 rounded-full object-cover ring-2 ring-white/[0.08]" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-lg font-bold text-white ring-2 ring-white/[0.08]">
                    {getInitials(userName)}
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-[3px] border-[#0a0a0f]" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-base mb-0.5">{userName}</p>
                <button onClick={handleCopy} className="flex items-center gap-1.5 group">
                  <span className="text-white/40 text-xs font-mono">{coreId}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded transition-all ${
                    copied ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-white/30 group-hover:bg-white/10'
                  }`}>
                    {copied ? '✓' : 'Copy'}
                  </span>
                </button>
              </div>

              {/* VOYO Now Playing + Friends count + Add button */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Now Playing Cards (VOYO only) */}
                {isVoyo && (
                  <div className="flex items-center gap-1.5">
                    {currentTrack?.trackId ? (
                      <div className="relative w-11 h-11 rounded-xl overflow-hidden shadow-lg ring-1 ring-white/[0.1]">
                        <img src={getYouTubeThumbnail(currentTrack.trackId, 'medium')} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                        <div className="absolute top-1 left-1 flex gap-0.5">
                          {[...Array(3)].map((_, i) => (
                            <div
                              key={i}
                              className="w-0.5 bg-white rounded-full" />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center ring-1 ring-white/[0.1]">
                        <Music2 className="w-5 h-5 text-white/30" />
                      </div>
                    )}
                    {nextTrack?.track?.trackId && (
                      <div className="relative w-9 h-9 rounded-lg overflow-hidden opacity-40 ring-1 ring-white/[0.05]">
                        <img src={getYouTubeThumbnail(nextTrack.track.trackId, 'medium')} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                )}

                {/* Friends count (only when expanded) */}
                <>
                  {showFriendCount && (
                    <div
                      className="text-center" >
                      <p className="text-white font-bold text-lg">{totalFriends}</p>
                      <p className="text-white/30 text-[9px] font-medium uppercase tracking-wider">Friends</p>
                    </div>
                  )}
                </>

                {/* Add Friend button */}
                <button
                  onClick={(e) => { e.stopPropagation(); onAddFriend(); }}
                  className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 hover:bg-purple-500/30 transition-all"
                >
                  <UserPlus size={18} />
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
              className="flex items-center gap-4 w-full z-10" >
              {/* Aurora glow - organic movement */}
              <div
                className="absolute inset-0 opacity-30" />
              {/* Second aurora layer - green accent */}
              <div
                className="absolute inset-0 opacity-20" />

              {/* Two-sided shimmer - left to right */}
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
              {/* Two-sided shimmer - right to left (offset) */}
              <div
                className="absolute inset-0 bg-gradient-to-l from-transparent via-white/[0.06] to-transparent" />

              {/* Subtle ring from right - dimmed */}
              <div
                className="absolute rounded-full border border-white/[0.06]"
                style={{
                  right: -24,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 160,
                  height: 160,
                }} />

              {/* Orbiting avatars cluster */}
              <div className="relative flex-shrink-0" style={{ width: '72px', height: '72px' }}>
                {/* Pulsing ring */}
                <div
                  className="absolute inset-0 rounded-full border-2 border-white/20" />

                {/* Center avatar */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
                  <div className="relative">
                    <div
                      className="w-11 h-11 rounded-full overflow-hidden border-[3px] border-white shadow-xl" >
                      {onlineFriends[0]?.avatar ? (
                        <img src={onlineFriends[0].avatar} alt="" className="w-full h-full object-cover" />
                      ) : onlineCount > 0 ? (
                        <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm text-white font-bold">
                          {getInitials(onlineFriends[0]?.name || '?')}
                        </div>
                      ) : (
                        <div className="w-full h-full bg-white/10 flex items-center justify-center">
                          <Users className="w-5 h-5 text-white/30" />
                        </div>
                      )}
                    </div>
                    {onlineCount > 0 && (
                      <div
                        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </div>
                </div>

                {/* Orbiting smaller avatars */}
                {onlineFriends.slice(1, 4).map((friend, i) => {
                  const angles = [-50, 50, 180];
                  const angle = angles[i] * (Math.PI / 180);
                  const radius = 28;
                  const x = Math.cos(angle) * radius;
                  const y = Math.sin(angle) * radius;
                  return (
                    <div
                      key={friend.dash_id}
                      className="absolute w-7 h-7 rounded-full overflow-hidden border-2 border-white/90 shadow-lg"
                      style={{
                        left: '50%',
                        top: '50%',
                        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                        zIndex: 10 - i,
                      }} >
                      {friend.avatar ? (
                        <img src={friend.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[8px] text-white font-bold">
                          {getInitials(friend.name)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Live text */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <div
                    className="w-2 h-2 rounded-full bg-green-500" />
                  <h3 className="text-white font-bold text-lg leading-tight">
                    {onlineCount > 0 ? 'Oyé! We Live' : 'No One Live'}
                  </h3>
                </div>
                <p className="text-white/50 text-xs">
                  {onlineCount === 0
                    ? 'Check back soon'
                    : `${onlineCount} friend${onlineCount !== 1 ? 's' : ''} Online`
                  }
                </p>
              </div>

              {/* Action button */}
              {onlineCount > 0 && (
                <div
                  className="w-11 h-11 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center"
                >
                  <Users className="w-5 h-5 text-green-400" />
                </div>
              )}
            </div>
          )}
        </>

        {/* State indicator dots */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full transition-all ${!showLive ? 'bg-white/60' : 'bg-white/20'}`} />
          <div className={`w-1.5 h-1.5 rounded-full transition-all ${showLive ? 'bg-white/60' : 'bg-white/20'}`} />
        </div>
      </div>
    </div>
  );
}

// ==============================================
// NOTES & STORIES SECTION (Instagram-style)
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
    <div className="px-6 pt-10 pb-6">
      <div className="flex gap-4 overflow-x-auto pb-2 hide-scrollbar">
        {/* My Note */}
        <button
          onClick={onEditNote}
          className="flex flex-col items-center flex-shrink-0"
        >
          <div className="relative mb-1">
            {/* Note bubble floating above */}
            {myNote && (
              <div
                className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-xl bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-500/40 whitespace-nowrap max-w-[80px] z-10" >
                <p className="text-white text-[10px] truncate">{myNote}</p>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gradient-to-br from-purple-500/30 to-pink-500/30 rotate-45 border-r border-b border-purple-500/40" />
              </div>
            )}
            {/* Avatar circle with dashed border for "add" - BIGGER */}
            <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-2 border-dashed border-white/20 flex items-center justify-center">
              {myNote ? (
                <span className="text-2xl">{myNote.slice(0, 2)}</span>
              ) : (
                <Plus className="w-7 h-7 text-white/40" />
              )}
            </div>
          </div>
          <p className="text-white/50 text-[11px] mt-2 font-medium">Your note</p>
        </button>

        {/* Friends with notes/stories */}
        {sorted.slice(0, 10).map((friend) => {
          const isOnline = friend.status === 'online';
          const hasActivity = isOnline && friend.activity;

          return (
            <button
              key={friend.dash_id}
              onClick={() => onSelectFriend(friend)}
              className="flex flex-col items-center flex-shrink-0"
            >
              <div className="relative mb-1">
                {/* Note bubble floating above (if has activity) */}
                {hasActivity && (
                  <div
                    className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-xl bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-500/40 whitespace-nowrap max-w-[80px] z-10" >
                    <p className="text-white text-[10px] truncate">{friend.activity}</p>
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gradient-to-br from-purple-500/30 to-pink-500/30 rotate-45 border-r border-b border-purple-500/40" />
                  </div>
                )}

                {/* Avatar circle with gradient ring - BIGGER */}
                <div className={`w-[72px] h-[72px] rounded-full overflow-hidden ${
                  hasActivity
                    ? 'ring-[3px] ring-purple-500'
                    : isOnline
                      ? 'ring-[3px] ring-green-500/50'
                      : 'ring-2 ring-white/10'
                }`}>
                  {friend.avatar ? (
                    <img src={friend.avatar} alt="" className={`w-full h-full object-cover ${!isOnline ? 'opacity-50' : ''}`} />
                  ) : (
                    <div className={`w-full h-full bg-gradient-to-br from-purple-500/60 to-violet-600/60 flex items-center justify-center text-white text-lg font-semibold ${!isOnline ? 'opacity-50' : ''}`}>
                      {getInitials(friend.name)}
                    </div>
                  )}
                </div>

                {/* Online indicator */}
                {isOnline && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-green-500 border-[3px] border-[#0a0a0f]" />
                )}

                {/* App badge for activity */}
                {friend.current_app && isOnline && (
                  <div
                    className="absolute -top-0.5 -right-0.5 w-6 h-6 rounded-full flex items-center justify-center text-white shadow-lg border-2 border-[#0a0a0f]"
                    style={{ background: getAppDisplay(friend.current_app).color }}
                  >
                    {getAppIcon(friend.current_app, 12)}
                  </div>
                )}
              </div>
              <p className={`text-[11px] mt-2 truncate max-w-[72px] font-medium ${isOnline ? 'text-white/70' : 'text-white/30'}`}>
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
// FOLLOWING SECTION (Artists/Services - Command Center shows ALL)
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
  // Design language: Always 4 cards visible, centered, scrollable
  // Card: 64px, Gap: 16px → (64×4) + (16×3) = 304px + padding for rings
  return (
    <div className="px-6 pt-2 pb-6">
      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-4 text-center">Following</p>
      <div className="flex justify-center">
        <div className="w-[320px] overflow-x-auto hide-scrollbar">
          <div className="flex gap-4 py-1 px-2">
            {FOLLOWING_DATA.map(artist => (
          <button
            key={artist.id}
            className="flex-shrink-0"
          >
            <div className={`relative w-16 h-16 rounded-xl overflow-hidden ${artist.isLive ? 'ring-2 ring-red-500' : 'ring-1 ring-white/10'}`}>
              {/* Image zoomed in */}
              <img src={artist.avatar} alt="" className="w-full h-full object-cover scale-150" />

              {/* Full card overlay for cohesion */}
              <div className="absolute inset-0 bg-black/20" />

              {/* Gradient overlay at bottom for name */}
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-purple-900/40 to-transparent" />

              {/* Name overlaid at bottom */}
              <p className="absolute bottom-1 left-0 right-0 text-center text-white text-[8px] font-semibold truncate px-0.5">
                {artist.name}
              </p>

              {/* Verified badge */}
              {artist.verified && (
                <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-blue-500 flex items-center justify-center">
                  <BadgeCheck className="w-2 h-2 text-white" />
                </div>
              )}

              {/* LIVE indicator */}
              {artist.isLive && (
                <div className="absolute top-1 left-1 px-1 py-0.5 rounded bg-red-500 text-[6px] font-bold text-white">
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
    { id: 'dash', label: 'DASH', icon: Compass, color: '#8B5CF6' }
  ];

  return (
    <div className="px-6 pt-2 pb-5">
      <div className="flex gap-2 p-1.5 bg-white/[0.03] rounded-2xl border border-white/[0.04]">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm transition-all ${
                isActive
                  ? 'text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {/* Premium gradient background for active state */}
              {isActive && (
                <div
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/20 via-purple-500/30 to-pink-500/20 border border-purple-500/30" />
              )}
              <Icon size={16} className={`relative z-10 ${tab.color && isActive ? '' : ''}`} style={tab.color ? { color: isActive ? tab.color : undefined } : {}} />
              <span className="relative z-10">{tab.label}</span>
              {tab.badge && tab.badge > 0 && (
                <span className="relative z-10 min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center bg-purple-500 text-white">
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
      className="w-full flex items-center gap-4 p-3 rounded-2xl hover:bg-white/[0.03] transition-all group"
    >
      {/* Avatar - CIRCULAR */}
      <div className="relative flex-shrink-0">
        <div className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center font-semibold text-white ${
          friend.avatar ? '' : 'bg-gradient-to-br from-purple-500/60 to-violet-600/60'
        } ${!isOnline ? 'opacity-50' : ''}`}>
          {friend.avatar ? (
            <img src={friend.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            getInitials(friend.name)
          )}
        </div>

        {/* Online indicator */}
        <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0a0a0f] ${
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
        <p className={`font-semibold text-sm ${isOnline ? 'text-white' : 'text-white/50'}`}>
          {friend.nickname || friend.name}
        </p>
        <p className={`text-xs truncate ${isOnline ? 'text-white/40' : 'text-white/25'}`}>
          {isOnline && friend.activity
            ? friend.activity
            : isOnline
              ? 'Online'
              : `Last seen ${formatTimeAgo(friend.last_seen)}`
          }
        </p>
      </div>

      <ChevronRight size={18} className="text-white/20 group-hover:text-white/40 transition-colors" />
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
      className={`w-full flex items-center gap-4 p-3 rounded-2xl transition-all ${
        hasUnread ? 'bg-purple-500/[0.08]' : 'hover:bg-white/[0.03]'
      }`}
    >
      {/* Avatar - CIRCULAR */}
      <div className="relative flex-shrink-0">
        <div className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center font-semibold text-white ${
          convo.friend_avatar ? '' : 'bg-gradient-to-br from-purple-500/60 to-violet-600/60'
        }`}>
          {convo.friend_avatar ? (
            <img src={convo.friend_avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            getInitials(convo.friend_name)
          )}
        </div>
        {convo.is_online && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-[#0a0a0f]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <p className={`font-semibold text-sm truncate ${hasUnread ? 'text-white' : 'text-white/70'}`}>
            {convo.friend_name}
          </p>
          <span className="text-white/30 text-[10px] flex-shrink-0">
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
          <p className={`text-xs truncate ${hasUnread ? 'text-white/60 font-medium' : 'text-white/35'}`}>
            {convo.last_message}
          </p>
        </div>
      </div>

      {hasUnread && (
        <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/30">
          <span className="text-white text-[11px] font-bold">
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
  service_color: '#8B5CF6', // Purple
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
  // Paid services first, VOYO always visible behind them
  // Stack order: [Paid1] [Paid2] [Paid3] [VOYO] (front to back)
  const sharedServices = member.shared_services.slice(0, 3); // Max 3 paid
  const allServices = [...sharedServices, VOYO_SERVICE]; // Paid in front, VOYO behind

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.04]" >
      {/* Avatar with stacked service pile */}
      <div className="relative flex-shrink-0">
        {/* Avatar - dimmed to let services pop */}
        <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center font-semibold text-white bg-gradient-to-br from-white/10 to-white/5 opacity-50">
          {member.avatar ? (
            <img src={member.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            getInitials(member.name)
          )}
        </div>

        {/* Stacked service badges - pile effect, bottom-right, slightly faded */}
        <div className="absolute -bottom-1 -right-1 flex opacity-90">
          {/* Render in reverse so shared services on top, VOYO at back */}
          {[...allServices].reverse().map((service, reverseIdx) => {
            const idx = allServices.length - 1 - reverseIdx;
            const offset = idx * 10; // Each badge shifts right
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

      {/* Info - vertically centered */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <p className="text-white/80 font-medium text-sm truncate leading-tight">{member.name}</p>
        {sharedServices.length > 0 ? (() => {
          const primary = sharedServices[0];
          const foyerId = primary.account_id?.split('-').pop()?.toUpperCase() || '???';
          const serviceColor = getServiceColor(primary.service_name);
          return (
            <p className="text-[10px] truncate opacity-70 mt-0.5">
              <span className="font-bold" style={{ color: serviceColor }}>{primary.service_name}</span>
              <span className="text-white/50 font-mono"> - {foyerId}</span>
            </p>
          );
        })() : (
          <p className="text-[10px] opacity-70 mt-0.5">
            <span className="font-bold" style={{ color: '#8B5CF6' }}>VOYO</span>
            <span className="text-white/50"> member</span>
          </p>
        )}
      </div>

      {/* Action */}
      {member.friend_status === 'pending' ? (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock size={12} />
          <span className="text-xs font-medium">Pending</span>
        </div>
      ) : (
        <button
          onClick={onConnect}
          disabled={isConnecting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/20 transition-all disabled:opacity-50"
        >
          {isConnecting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <>
              <Plus size={12} />
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
      className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6" onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#12121a] rounded-3xl p-6 shadow-2xl border border-white/10" onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white font-bold text-lg">Add Friend</h2>
          <button onClick={onClose} className="p-2 -mr-2 rounded-xl hover:bg-white/10"><X size={20} className="text-white/60" /></button>
        </div>

        {status === 'success' ? (
          <div className="flex flex-col items-center py-8">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4" >
              <Check size={32} className="text-green-500" />
            </div>
            <p className="text-white font-semibold">Request Sent!</p>
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
              className={`w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all ${
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
      className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-xl flex items-end justify-center" onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#1a1a24] rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <button onClick={onClose} className="text-white/50 text-sm">Cancel</button>
          <p className="text-white font-semibold">New Note</p>
          <button onClick={() => { onSave(value); onClose(); }} className="text-purple-400 font-semibold text-sm">Share</button>
        </div>

        <div className="flex flex-col items-center mb-6">
          <div className="relative mb-2">
            {/* Note bubble preview */}
            <div
              className="px-4 py-2 rounded-2xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 mb-2" >
              <p className="text-white text-sm">{value || 'Your note...'}</p>
            </div>
            {/* Avatar */}
            {userAvatar ? (
              <img src={userAvatar} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-purple-500/30 mx-auto" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-xl font-bold text-white ring-2 ring-purple-500/30 mx-auto">
                {userName[0]?.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        <input
          type="text" value={value} onChange={e => setValue(e.target.value)}
          placeholder="Share a thought..."
          maxLength={60}
          className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-center placeholder-white/30 focus:outline-none focus:border-purple-500/50"
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

export function Dahub({ userId: propsUserId, userName: propsUserName, userAvatar, coreId, appContext, onClose }: DahubProps) {
  // Auto-detect user identity (props > localStorage > guest)
  const { userId, userName, isGuest } = useDashIdentity(propsUserId, propsUserName);

  const [activeTab, setActiveTab] = useState<Tab>('messages');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [sharedMembers, setSharedMembers] = useState<SharedAccountMember[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showNoteEdit, setShowNoteEdit] = useState(false);
  const [note, setNote] = useState('');
  const [activeChat, setActiveChat] = useState<{ friendId: string; friendName: string; friendAvatar?: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const isMasterView = !appContext || appContext === APP_CODES.COMMAND_CENTER;
  const onlineCount = friends.filter(f => f.status === 'online').length;
  const suggestions = sharedMembers.filter(m => m.friend_status !== 'accepted');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Promise.allSettled — if one of the four backends is down (e.g. the
      // Command Center DB that powers getSharedAccountMembers), the other
      // three still hydrate and the user lands on a working dahub. Previously
      // this was Promise.all + no try/catch, which left the page frozen on a
      // spinner forever the moment any one call threw.
      const [friendsRes, sharedRes, conversationsRes, unreadRes] = await Promise.allSettled([
        friendsAPI.getFriends(userId),
        friendsAPI.getSharedAccountMembers(userId),
        messagesAPI.getConversations(userId),
        messagesAPI.getUnreadCount(userId),
      ]);

      if (friendsRes.status === 'fulfilled') setFriends(friendsRes.value);
      else devWarn('[dahub] getFriends failed:', friendsRes.reason);

      if (sharedRes.status === 'fulfilled') setSharedMembers(sharedRes.value);
      else devWarn('[dahub] getSharedAccountMembers failed:', sharedRes.reason);

      if (conversationsRes.status === 'fulfilled') setConversations(conversationsRes.value);
      else devWarn('[dahub] getConversations failed:', conversationsRes.reason);

      if (unreadRes.status === 'fulfilled') setUnreadCount(unreadRes.value);
      else devWarn('[dahub] getUnreadCount failed:', unreadRes.reason);
    } catch (err) {
      // allSettled never throws, but defensive in case React batching surprises us.
      console.error('[dahub] loadData unexpected:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
    presenceAPI.updatePresence(userId, 'online', appContext || APP_CODES.COMMAND_CENTER);
    const unsubscribe = messagesAPI.subscribeToMessages(userId, (msg) => {
      setConversations(prev => {
        const existing = prev.find(c => c.friend_id === msg.from_id);
        if (existing) {
          return prev.map(c => c.friend_id === msg.from_id ? { ...c, last_message: msg.message, last_message_time: msg.created_at, unread_count: c.unread_count + 1 } : c);
        }
        return prev;
      });
      setUnreadCount(c => c + 1);
    });
    return () => { unsubscribe(); presenceAPI.updatePresence(userId, 'offline', appContext || APP_CODES.COMMAND_CENTER); };
  }, [userId, appContext, loadData]);

  const handleConnect = async (member: SharedAccountMember) => {
    setConnectingId(member.dash_id);
    const success = await friendsAPI.sendFriendRequest(userId, member.dash_id);
    if (success) setSharedMembers(prev => prev.map(m => m.dash_id === member.dash_id ? { ...m, friend_status: 'pending' as const } : m));
    setConnectingId(null);
  };

  return (
    <div className="h-full bg-[#0a0a0c] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 pt-4 px-6 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">DaHub</h1>
            {isMasterView && (
              <span className="px-2 py-1 rounded-lg bg-purple-500/15 border border-purple-500/20 text-purple-400 text-[10px] font-semibold uppercase tracking-wider">
                All Apps
              </span>
            )}
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2.5 rounded-xl hover:bg-white/[0.06] text-white/50" >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {isGuest ? (
        /* Guest Login Prompt */
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mb-6">
            <Users size={36} className="text-purple-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Connect with Friends</h2>
          <p className="text-white/50 text-center text-sm mb-8">
            Login with your DASH account to see friends, messages, and shared services across all apps.
          </p>
          <button
            onClick={() => {
              const returnUrl = window.location.origin;
              window.location.href = `https://hub.dasuperhub.com?returnUrl=${returnUrl}&app=V`;
            }}
            className="px-8 py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold flex items-center gap-2 shadow-lg shadow-purple-500/25"
          >
            <UserPlus size={18} />
            Login with DASH
          </button>
          <p className="text-white/30 text-xs mt-4">
            Don't have an account? You'll be able to create one.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-purple-400" />
        </div>
      ) : (
        <>
          {/* Profile Card */}
          <ProfileCard userName={userName} userAvatar={userAvatar} coreId={coreId || userId} totalFriends={friends.length} onlineFriends={friends.filter(f => f.status === 'online')} onAddFriend={() => setShowAddFriend(true)} appContext={appContext} />

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
            <>
              {activeTab === 'friends' && (
                <div key="friends" className="space-y-1">
                  {friends.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                        <Users size={28} className="text-white/20" />
                      </div>
                      <p className="text-white/50 font-medium mb-1">No friends yet</p>
                      <p className="text-white/30 text-sm">Add friends with their DASH ID</p>
                    </div>
                  ) : (
                    friends.map(friend => (
                      <FriendItem key={friend.dash_id} friend={friend} onClick={() => setActiveChat({ friendId: friend.dash_id, friendName: friend.name, friendAvatar: friend.avatar })} />
                    ))
                  )}
                </div>
              )}

              {activeTab === 'messages' && (
                <div key="messages" className="space-y-1">
                  {conversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                        <MessageCircle size={28} className="text-white/20" />
                      </div>
                      <p className="text-white/50 font-medium mb-1">No messages yet</p>
                      <p className="text-white/30 text-sm">Start a conversation with a friend</p>
                    </div>
                  ) : (
                    conversations.map(convo => (
                      <MessageItem key={convo.friend_id} convo={convo} onClick={() => setActiveChat({ friendId: convo.friend_id, friendName: convo.friend_name, friendAvatar: convo.friend_avatar })} />
                    ))
                  )}
                </div>
              )}

              {activeTab === 'dash' && (
                <div key="dash" className="space-y-6">
                  {/* Support FIRST */}
                  <div>
                    <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Support & Updates</p>
                    <div className="space-y-2">
                      {[
                        { Icon: Headphones, title: 'DASH Support', desc: 'Get help anytime', color: '#FBBF24' },
                        { Icon: Bell, title: 'Announcements', desc: 'Latest updates', color: '#8B5CF6' },
                        { Icon: CreditCard, title: 'Subscription', desc: 'Manage your plan', color: '#10B981' }
                      ].map((item, i) => (
                        <button key={i} className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition-all" >
                          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `${item.color}15` }}>
                            <item.Icon size={22} style={{ color: item.color }} />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-white/80 font-medium">{item.title}</p>
                            <p className="text-white/30 text-sm">{item.desc}</p>
                          </div>
                          <ChevronRight size={18} className="text-white/20" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* DASH Members SECOND */}
                  {suggestions.length > 0 && (
                    <div>
                      <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">DASH Members</p>
                      <div className="space-y-2">
                        {suggestions.map(member => (
                          <DashMemberItem key={member.dash_id} member={member} onConnect={() => handleConnect(member)} isConnecting={connectingId === member.dash_id} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          </div>
        </>
      )}

      {/* TIVI+ Cross-Promo (moved from HomeFeed) */}
      <TiviPlusCrossPromo />

      {/* Modals */}
      <>
        {showAddFriend && <AddFriendModal userId={userId} onClose={() => setShowAddFriend(false)} onAdded={loadData} />}
      </>
      <>
        {showNoteEdit && <NoteEditModal note={note} userAvatar={userAvatar} userName={userName} onSave={setNote} onClose={() => setShowNoteEdit(false)} />}
      </>
      <>
        {activeChat && (
          <DirectMessageChat currentUserId={userId} currentUserName={userName} friendId={activeChat.friendId} friendName={activeChat.friendName} friendAvatar={activeChat.friendAvatar} onClose={() => { setActiveChat(null); loadData(); }} />
        )}
      </>
    </div>
  );
}

export default Dahub;
