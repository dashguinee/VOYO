/**
 * VOYO Music - DAHUB
 * Snapchat + WhatsApp hybrid social hub
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Settings, Plus, X, Play, Pause, Volume2,
  Send, Heart, ChevronRight, BadgeCheck, Music2, User, UserPlus, Search, Check, Loader2,
  Home, Library as LibraryIcon
} from 'lucide-react';
import { UniversePanel } from '../universe/UniversePanel';
import { usePlayerStore } from '../../store/playerStore';
import { useAuth } from '../../hooks/useAuth';
import { getYouTubeThumbnail } from '../../data/tracks';
import { DirectMessageChat } from '../chat/DirectMessageChat';
import { friendsAPI, messagesAPI, profileAPI } from '../../lib/voyo-api';
import { isConfigured as isSupabaseConfigured } from '../../lib/voyo-api';
import type { Conversation } from '../../lib/voyo-api';

// Helper to format time ago
function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// Premium avatar images
// TODO: Replace dash with actual profile photo when available
const AVATARS = {
  dash: '/dash-profile.jpg', // Your profile - add image to public folder
  aziz: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face',
  kenza: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face',
  omar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face',
  sarah: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face',
  youssef: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face',
};

// Story preview thumbnails
const STORY_PREVIEWS = {
  aziz: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&h=600&fit=crop',
  kenza: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&h=600&fit=crop',
  sarah: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=400&h=600&fit=crop',
  omar: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=600&fit=crop',
};

// Artist avatars - use their track thumbnails (already verified working)
const CELEBRITY_AVATARS = {
  burna: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg', // Last Last (REAL)
  wizkid: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg', // Essence
  rema: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg', // Calm Down
  tems: 'https://i.ytimg.com/vi/VDcEJE633rM/hqdefault.jpg', // Free Mind
  davido: 'https://i.ytimg.com/vi/iL3IEkCs-NA/hqdefault.jpg', // Fall
};

// Celebrities/Artists the user follows
const celebrities = [
  {
    id: 'burna',
    name: 'Burna Boy',
    avatar: CELEBRITY_AVATARS.burna,
    verified: true,
    latestRelease: { title: 'Last Last', thumbnail: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg' },
    isLive: false,
  },
  {
    id: 'wizkid',
    name: 'Wizkid',
    avatar: CELEBRITY_AVATARS.wizkid,
    verified: true,
    latestRelease: { title: 'Essence', thumbnail: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg' },
    isLive: true,
  },
  {
    id: 'rema',
    name: 'Rema',
    avatar: CELEBRITY_AVATARS.rema,
    verified: true,
    latestRelease: { title: 'Calm Down', thumbnail: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg' },
    isLive: false,
  },
  {
    id: 'tems',
    name: 'Tems',
    avatar: CELEBRITY_AVATARS.tems,
    verified: true,
    latestRelease: { title: 'Free Mind', thumbnail: 'https://i.ytimg.com/vi/VDcEJE633rM/hqdefault.jpg' },
    isLive: false,
  },
];

// Notes are now driven by real friend data from Command Center + voyo_profiles
// Each friend's nowPlaying becomes their auto-note (♪ track title)

// Friends data
// nowPlaying includes trackId for playback - tapping opens VOYO player with that track
const friends = [
  {
    id: 'aziz',
    name: 'Aziz',
    avatar: AVATARS.aziz,
    hasStory: true,
    isOnline: true,
    storyPreview: STORY_PREVIEWS.aziz,
    nowPlaying: { trackId: '421w1j87fEM', title: 'Last Last', artist: 'Burna Boy', thumbnail: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg' },
  },
  {
    id: 'kenza',
    name: 'Kenza',
    avatar: AVATARS.kenza,
    hasStory: true,
    isOnline: true,
    storyPreview: STORY_PREVIEWS.kenza,
    nowPlaying: { trackId: 'jipQpjUA_o8', title: 'Essence', artist: 'Wizkid', thumbnail: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg' },
  },
  {
    id: 'omar',
    name: 'Omar',
    avatar: AVATARS.omar,
    hasStory: false,
    isOnline: false,
    storyPreview: STORY_PREVIEWS.omar,
    nowPlaying: null,
  },
  {
    id: 'sarah',
    name: 'Sarah',
    avatar: AVATARS.sarah,
    hasStory: true,
    isOnline: true,
    storyPreview: STORY_PREVIEWS.sarah,
    nowPlaying: { trackId: 'WcIcVapfqXw', title: 'Calm Down', artist: 'Rema', thumbnail: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg' },
  },
  {
    id: 'youssef',
    name: 'Youssef',
    avatar: AVATARS.youssef,
    hasStory: false,
    isOnline: true,
    storyPreview: null,
    nowPlaying: null,
  },
];

// Friend stories content
const friendStories: Record<string, {
  content: { type: 'image' | 'now_playing'; url?: string; track?: { title: string; artist: string; thumbnail: string } }[]
}> = {
  'aziz': {
    content: [
      { type: 'now_playing', track: { title: 'Last Last', artist: 'Burna Boy', thumbnail: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg' } },
      { type: 'image', url: STORY_PREVIEWS.aziz },
    ]
  },
  'kenza': {
    content: [
      { type: 'now_playing', track: { title: 'Essence', artist: 'Wizkid ft. Tems', thumbnail: 'https://i.ytimg.com/vi/jipQpjUA_o8/hqdefault.jpg' } },
      { type: 'image', url: STORY_PREVIEWS.kenza },
    ]
  },
  'sarah': {
    content: [
      { type: 'now_playing', track: { title: 'Calm Down', artist: 'Rema', thumbnail: 'https://i.ytimg.com/vi/WcIcVapfqXw/hqdefault.jpg' } },
      { type: 'image', url: STORY_PREVIEWS.sarah },
    ]
  },
};

// Chat messages with Snapchat-style status
type MessageStatus = 'new_image' | 'new_video' | 'new_voice' | 'received' | 'opened' | 'delivered' | 'sent' | 'new_dm';
interface Message {
  id: string;
  friendId: string;
  friendName: string;
  friendAvatar: string;
  isOnline: boolean;
  status: MessageStatus;
  statusText: string;
  time: string;
  isNew: boolean;
  unreadCount?: number;
}

const messages: Message[] = [
  { id: '1', friendId: 'oyodj', friendName: 'Oyo DJ', friendAvatar: 'https://i.ytimg.com/vi/421w1j87fEM/hqdefault.jpg', isOnline: true, status: 'new_dm', statusText: 'New Message', time: 'now', isNew: true, unreadCount: 1 },
  { id: '2', friendId: 'dash', friendName: 'Dash', friendAvatar: AVATARS.dash, isOnline: true, status: 'new_dm', statusText: 'New Message', time: '2m', isNew: true, unreadCount: 3 },
  { id: '3', friendId: 'aziz', friendName: 'Aziz', friendAvatar: AVATARS.aziz, isOnline: true, status: 'new_image', statusText: 'New Image', time: '5m', isNew: true, unreadCount: 2 },
  { id: '4', friendId: 'omar', friendName: 'Omar', friendAvatar: AVATARS.omar, isOnline: false, status: 'new_voice', statusText: 'New Voice Note', time: '1h', isNew: true, unreadCount: 1 },
  { id: '5', friendId: 'kenza', friendName: 'Kenza', friendAvatar: AVATARS.kenza, isOnline: true, status: 'received', statusText: 'Received', time: '3h', isNew: false },
  { id: '6', friendId: 'sarah', friendName: 'Sarah', friendAvatar: AVATARS.sarah, isOnline: true, status: 'opened', statusText: 'Opened', time: '5h', isNew: false },
];

// Status colors like Snapchat
const statusColors: Record<MessageStatus, string> = {
  new_dm: '#a855f7', // Purple for DMs
  new_image: '#9333ea', // Purple for images
  new_video: '#9333ea', // Purple for video
  new_voice: '#3b82f6', // Blue for voice
  received: '#9333ea',
  opened: '#6b7280',
  delivered: '#6b7280',
  sent: '#6b7280',
};

// ============================================
// STORY VIEWER
// ============================================
interface StoryViewerProps {
  friend: typeof friends[0];
  onClose: () => void;
}

const StoryViewer = ({ friend, onClose }: StoryViewerProps) => {
  const story = friendStories[friend.id];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');


  const content = story?.content || [];
  const currentContent = content[currentIndex];
  const DURATION = 5000;

  useEffect(() => {
    if (isPaused || showReply || !content.length) return;
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          if (currentIndex < content.length - 1) {
            setCurrentIndex(i => i + 1);
            return 0;
          }
          onClose();
          return 100;
        }
        return p + (100 / (DURATION / 100));
      });
    }, 100); // Battery fix: 100ms (10fps) is smooth enough for a progress bar (was 50ms)
    return () => clearInterval(interval);
  }, [currentIndex, content.length, isPaused, showReply, onClose]);

  useEffect(() => { setProgress(0); }, [currentIndex]);

  const handleTap = (e: React.MouseEvent) => {
    if (showReply) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.3 && currentIndex > 0) setCurrentIndex(i => i - 1);
    else if (x > rect.width * 0.7 && currentIndex < content.length - 1) setCurrentIndex(i => i + 1);
  };

  const handleDragEnd = (_: unknown, info: { offset: { x: number; y: number } }) => {
    if (info.offset.y > 100) onClose();
  };

  if (!content.length) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black"
    >
      <div
        className="h-full w-full"
        style={{  }}
        onPointerDown={() => setIsPaused(true)}
        onPointerUp={() => setIsPaused(false)}
        onClick={handleTap}
      >
        {/* Progress bars */}
        <div className="absolute top-0 inset-x-0 z-30 flex gap-1 p-3 pt-12">
          {content.map((_, i) => (
            <div key={i} className="flex-1 h-[2px] bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white" style={{ width: i < currentIndex ? '100%' : i === currentIndex ? `${progress}%` : '0%' }} />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-16 inset-x-0 z-30 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <img src={friend.avatar} alt="" className="w-10 h-10 rounded-full object-cover ring-2 ring-white/20" />
            <div>
              <p className="text-white font-semibold text-sm">{friend.name}</p>
              <p className="text-white/60 text-xs">{currentContent?.type === 'now_playing' ? 'Now Playing' : 'Story'}</p>
            </div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2">
            <X className="w-6 h-6 text-white" />
          </button>
        </div>

        {/* Pause indicator */}
        
          {isPaused && !showReply && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <div className="w-20 h-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                <Pause className="w-10 h-10 text-white" />
              </div>
            </div>
          )}
        

        {/* Content */}
        
          <div key={currentIndex} className="absolute inset-0">
            {currentContent?.type === 'now_playing' && currentContent.track ? (
              <div className="h-full flex flex-col items-center justify-center p-8 bg-gradient-to-b from-black via-[#0a0a0f] to-black">
                <div className="relative mb-10">
                  <div className="absolute inset-0 blur-3xl bg-purple-500/30 scale-150" />
                  <img src={currentContent.track.thumbnail} alt="" className="relative w-56 h-56 rounded-2xl object-cover shadow-2xl" />
                  <div className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-black/60 backdrop-blur flex items-center justify-center">
                    <Volume2 className="w-5 h-5 text-white" />
                  </div>
                </div>
                <div className="flex items-end gap-1 mb-6 h-8">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="w-1 bg-white/80 rounded-full" style={{ height: 8 }} />
                  ))}
                </div>
                <h2 className="text-2xl font-bold text-white text-center mb-1">{currentContent.track.title}</h2>
                <p className="text-white/60 mb-8">{currentContent.track.artist}</p>
                <div className="flex gap-4">
                  <button className="px-8 py-3 rounded-full bg-white text-black font-semibold flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Play className="w-5 h-5" /> Play
                  </button>
                  <button className="px-6 py-3 rounded-full bg-white/10 text-white font-medium" onClick={(e) => e.stopPropagation()}>
                    + Queue
                  </button>
                </div>
              </div>
            ) : currentContent?.url ? (
              <img src={currentContent.url} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
        

        {/* Reply bar */}
        <div className="absolute bottom-0 inset-x-0 z-30 p-4 pb-8">
          {showReply ? (
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl rounded-full p-2" onClick={(e) => e.stopPropagation()}>
              <input type="text" className="flex-1 bg-transparent text-white px-4 py-2 outline-none" placeholder={`Reply to ${friend.name}...`} value={replyText} onChange={(e) => setReplyText(e.target.value)} autoFocus />
              <button className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                <Send className="w-5 h-5 text-black" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button className="flex-1 py-3 rounded-full bg-white/10 backdrop-blur-sm text-white/80 text-sm" onClick={(e) => { e.stopPropagation(); setShowReply(true); }}>
                Send a message...
              </button>
              <button className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <Heart className="w-6 h-6 text-white" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================
// MAIN HUB
// ============================================
interface HubProps {
  onOpenProfile?: () => void;
  onSwitchToVOYO?: () => void;
  // Self-contained navigation - DaHub always uses same nav regardless of parent
  onHome?: () => void;
  onVoyoFeed?: () => void;
  onLibrary?: () => void;
}

export const Hub = ({ onOpenProfile, onSwitchToVOYO, onHome, onVoyoFeed, onLibrary }: HubProps) => {
  const [selectedFriend, setSelectedFriend] = useState<typeof friends[0] | null>(null);
  const [myNote, setMyNote] = useState('');
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [messageTab, setMessageTab] = useState<'all' | 'unread' | 'stories'>('all');
  const [isUniverseOpen, setIsUniverseOpen] = useState(false);
  const [activeChat, setActiveChat] = useState<{
    username: string;
    displayName: string;
    avatar: string | null;
  } | null>(null);

  // Add Friend modal state
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [addFriendId, setAddFriendId] = useState('');
  const [addFriendNickname, setAddFriendNickname] = useState('');
  const [addFriendStatus, setAddFriendStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [addFriendError, setAddFriendError] = useState('');

  // Connect to real player state
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const queue = usePlayerStore(s => s.queue);

  // Get current logged in user (DASH ID from Command Center)
  const { dashId, displayName } = useAuth();
  const myNowPlaying = currentTrack ? { title: currentTrack.title, artist: currentTrack.artist } : null;

  // Real data state
  const [realFriends, setRealFriends] = useState<Array<{
    id: string;
    name: string;
    avatar: string;
    isOnline: boolean;
    nowPlaying: { title: string; artist: string } | null;
    portalOpen: boolean;
  }>>([]);
  const [realConversations, setRealConversations] = useState<Conversation[]>([]);
  const [isLoadingReal, setIsLoadingReal] = useState(true);

  // Load real friends (from Command Center) and conversations
  const loadRealData = useCallback(async () => {
    if (!dashId || !isSupabaseConfigured) {
      setIsLoadingReal(false);
      return;
    }

    try {
      // Load VOYO friends from Command Center (filtered to VOYO users)
      const voyoFriends = await friendsAPI.getVoyoFriends(dashId);

      // Map friends to display format
      const friendProfiles = await Promise.all(
        voyoFriends.map(async (friend) => {
          // Get their VOYO profile for now_playing
          const profile = await profileAPI.getProfile(friend.dash_id);
          return {
            id: friend.dash_id,
            name: friend.name || `V${friend.dash_id}`,
            avatar: friend.avatar || '',
            isOnline: profile?.portal_open || false,
            nowPlaying: profile?.now_playing ? {
              title: profile.now_playing.title,
              artist: profile.now_playing.artist
            } : null,
            portalOpen: profile?.portal_open || false,
          };
        })
      );
      setRealFriends(friendProfiles);

      // Load DM conversations
      const convos = await messagesAPI.getConversations(dashId);
      setRealConversations(convos);
    } catch (err) {
      console.error('[VOYO] Failed to load real data:', err);
    }
    setIsLoadingReal(false);
  }, [dashId]);

  // Initial data load
  useEffect(() => {
    loadRealData();
  }, [loadRealData]);

  // Handle adding a friend
  const handleAddFriend = async () => {
    if (!dashId || !addFriendId.trim()) return;

    const friendId = addFriendId.trim().toUpperCase();

    // Can't add yourself
    if (friendId === dashId) {
      setAddFriendError("Can't add yourself!");
      setAddFriendStatus('error');
      return;
    }

    setAddFriendStatus('loading');
    setAddFriendError('');

    try {
      const success = await friendsAPI.addFriend(
        dashId,
        friendId,
        addFriendNickname.trim() || undefined
      );

      if (success) {
        setAddFriendStatus('success');
        // Reset after 1.5s and close
        setTimeout(() => {
          setShowAddFriend(false);
          setAddFriendId('');
          setAddFriendNickname('');
          setAddFriendStatus('idle');
          // Reload friends list
          loadRealData();
        }, 1500);
      } else {
        setAddFriendError('Could not add friend. They may already be your friend.');
        setAddFriendStatus('error');
      }
    } catch (err) {
      setAddFriendError('Something went wrong');
      setAddFriendStatus('error');
    }
  };

  const nextTrack = queue[0] || null;

  // Auto-fill note with what I'm listening to if empty
  const displayNote = myNote || (myNowPlaying ? `♪ ${myNowPlaying.title}` : '');
  const isAutoNote = !myNote && myNowPlaying;

  // Merge real friends with mock friends for display
  // Real friends from Command Center take priority
  const displayFriends = realFriends.length > 0
    ? realFriends.map(rf => ({
        id: rf.id,
        name: rf.name,
        avatar: rf.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(rf.name)}&background=8b5cf6&color=fff`,
        hasStory: false, // Real friends don't have stories yet
        isOnline: rf.isOnline,
        storyPreview: null,
        nowPlaying: rf.nowPlaying ? {
          trackId: (rf.nowPlaying as any).trackId || '', // Include trackId for playback
          title: rf.nowPlaying.title,
          artist: rf.nowPlaying.artist,
          thumbnail: (rf.nowPlaying as any).thumbnail || '' // Would need to fetch from track data
        } : null,
      }))
    : friends;

  // Filter messages by tab
  const unreadCount = messages.filter(m => m.isNew).length;
  const storiesCount = displayFriends.filter(f => f.hasStory).length;
  // Merge real conversations with mock messages for display
  const displayMessages = realConversations.length > 0
    ? realConversations.map((c) => ({
        id: c.username,
        friendId: c.username,
        friendName: c.displayName,
        friendAvatar: c.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.displayName)}&background=8b5cf6&color=fff`,
        isOnline: false, // Would need real-time presence
        status: c.unreadCount > 0 ? 'new_dm' as MessageStatus : 'received' as MessageStatus,
        statusText: c.unreadCount > 0 ? 'New Message' : 'Received',
        time: getTimeAgo(new Date(c.lastMessageTime).getTime()),
        isNew: c.unreadCount > 0,
        unreadCount: c.unreadCount,
      }))
    : messages;

  const filteredMessages = messageTab === 'unread'
    ? displayMessages.filter(m => m.isNew)
    : messageTab === 'stories'
      ? []
      : displayMessages;

  return (
    <div className="h-full bg-[#0a0a0c] overflow-y-auto pb-24">
      {/* Story Viewer */}
      
        {selectedFriend && <StoryViewer friend={selectedFriend} onClose={() => setSelectedFriend(null)} />}
      

      {/* Direct Message Chat */}
      
        {activeChat && dashId && (
          <DirectMessageChat
            currentUser={dashId}
            otherUser={activeChat.username}
            otherUserDisplayName={activeChat.displayName}
            otherUserAvatar={activeChat.avatar}
            onBack={() => setActiveChat(null)}
          />
        )}
      

      {/* Universe Panel */}
      <UniversePanel isOpen={isUniverseOpen} onClose={() => setIsUniverseOpen(false)} />

      {/* Header */}
      <div className="sticky top-0 z-20 bg-transparent">
        <div className="flex items-center justify-between px-6 py-5">
          <h1 className="text-xl font-bold text-white tracking-tight">DAHUB</h1>
          {/* Settings Button */}
          <button
            onClick={() => setIsUniverseOpen(true)}
            className="p-2 -mr-2 rounded-full hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors"
          >
            <Settings className="w-5 h-5 text-white/60" />
          </button>
        </div>
      </div>

      {/* My Profile + Now Playing Preview */}
      <div className="px-6 pt-5 pb-4">
        <div
          className="relative flex items-center gap-4 p-5 rounded-3xl bg-gradient-to-br from-purple-500/[0.12] via-fuchsia-500/[0.08] to-pink-500/[0.12] border border-white/[0.08] overflow-hidden cursor-pointer"
          onClick={() => setIsUniverseOpen(true)}
        >
          {/* Subtle glow effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-purple-400/[0.03] to-pink-400/[0.03] blur-2xl" />

          {/* Profile - Left */}
          <div className="relative flex-shrink-0 z-10">
            <div className="relative">
              <img src={AVATARS.dash} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-white/[0.08]" />
              <div className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-green-500 border-[3px] border-[#0a0a0f] shadow-lg" />
            </div>
          </div>

          <div className="flex-1 min-w-0 z-10">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-white font-semibold text-base">Dash</p>
              <ChevronRight className="w-4 h-4 text-white/40" />
            </div>
            <p className="text-white/50 text-sm font-medium">Tap for account & stats</p>
          </div>

          {/* Timeline Preview - Right */}
          <div className="flex items-center gap-2 z-10">
            {/* Current Track */}
            {currentTrack?.trackId ? (
              <div className="relative w-14 h-14 rounded-xl overflow-hidden shadow-lg ring-1 ring-white/[0.1]">
                <img src={getYouTubeThumbnail(currentTrack.trackId, 'medium')} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                <div className="absolute top-1.5 left-1.5 flex gap-0.5">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="w-0.5 bg-white rounded-full shadow-sm"
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center ring-1 ring-white/[0.1]">
                <Music2 className="w-6 h-6 text-white/30" />
              </div>
            )}
            {/* Next in Queue */}
            {nextTrack?.track?.trackId ? (
              <div className="relative w-11 h-11 rounded-lg overflow-hidden opacity-50 ring-1 ring-white/[0.05]">
                <img src={getYouTubeThumbnail(nextTrack.track.trackId, 'medium')} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-11 h-11 rounded-lg bg-white/5 opacity-50 ring-1 ring-white/[0.05]" />
            )}
            {/* Add Friend Button */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                setShowAddFriend(true);
              }}
              className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center ml-3 cursor-pointer active:scale-95 transition-transform"
            >
              <UserPlus className="w-3.5 h-3.5 text-white/60" />
            </div>
          </div>
        </div>
      </div>

      {/* Note Editor Modal */}
      
        {isEditingNote && (
          <div
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-xl flex items-end justify-center"
            onClick={() => setIsEditingNote(false)}
          >
            <div
              className="w-full max-w-md bg-[#1a1a24] rounded-t-3xl p-6 pb-10"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <button onClick={() => setIsEditingNote(false)} className="text-white/50 text-sm">Cancel</button>
                <p className="text-white font-semibold">New Note</p>
                <button
                  onClick={() => {
                    setMyNote(noteInput);
                    setIsEditingNote(false);
                  }}
                  className="text-purple-400 font-semibold text-sm"
                >
                  Share
                </button>
              </div>

              {/* Preview */}
              <div className="flex flex-col items-center mb-6">
                <div className="relative mb-2">
                  {/* Note bubble preview */}
                  <div
                    className="px-4 py-2 rounded-2xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 mb-2"
                  >
                    <p className="text-white text-sm">
                      {noteInput || (myNowPlaying ? `♪ ${myNowPlaying.title}` : 'Your note...')}
                    </p>
                  </div>
                  <div className="w-3 h-3 rotate-45 bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-r border-b border-purple-500/30 mx-auto -mt-2" />
                </div>
                <img src={AVATARS.dash} alt="" className="w-16 h-16 rounded-full object-cover ring-2 ring-purple-500/50" />
                <p className="text-white/50 text-xs mt-2">Your note • 24h</p>
              </div>

              {/* Input */}
              <div className="relative">
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value.slice(0, 60))}
                  placeholder={myNowPlaying ? `♪ ${myNowPlaying.title} (auto)` : "What's on your mind?"}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 outline-none focus:border-purple-500/50 transition-colors"
                  autoFocus
                  maxLength={60}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 text-xs">
                  {noteInput.length}/60
                </span>
              </div>

              {/* Music auto-fill hint */}
              {myNowPlaying && !noteInput && (
                <div className="flex items-center gap-2 mt-3 px-2">
                  <Music2 className="w-3.5 h-3.5 text-purple-400" />
                  <p className="text-white/40 text-xs">Leave empty to share what you're listening to</p>
                </div>
              )}
            </div>
          </div>
        )}
      

      {/* Add Friend Modal */}
      
        {showAddFriend && (
          <div
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6"
            onClick={() => {
              if (addFriendStatus !== 'loading') {
                setShowAddFriend(false);
                setAddFriendId('');
                setAddFriendNickname('');
                setAddFriendStatus('idle');
                setAddFriendError('');
              }
            }}
          >
            <div
              className="w-full max-w-sm bg-[#1a1a24] rounded-3xl p-6 shadow-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-white font-bold text-lg">Add Friend</h2>
                <button
                  onClick={() => {
                    if (addFriendStatus !== 'loading') {
                      setShowAddFriend(false);
                      setAddFriendId('');
                      setAddFriendNickname('');
                      setAddFriendStatus('idle');
                      setAddFriendError('');
                    }
                  }}
                  className="p-2 -mr-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white/60" />
                </button>
              </div>

              {/* Success State */}
              {addFriendStatus === 'success' ? (
                <div className="flex flex-col items-center py-8">
                  <div
                    className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mb-4"
                  >
                    <Check className="w-8 h-8 text-purple-500" />
                  </div>
                  <p className="text-white font-semibold text-lg">Friend Added!</p>
                  <p className="text-white/50 text-sm mt-1">{addFriendId} is now your friend</p>
                </div>
              ) : (
                <>
                  {/* DASH ID Input */}
                  <div className="mb-4">
                    <label className="text-white/60 text-xs font-medium uppercase tracking-wider mb-2 block">
                      DASH ID
                    </label>
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                      <input
                        type="text"
                        value={addFriendId}
                        onChange={(e) => {
                          setAddFriendId(e.target.value.toUpperCase());
                          setAddFriendStatus('idle');
                          setAddFriendError('');
                        }}
                        placeholder="e.g. 002MD"
                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 outline-none focus:border-purple-500/50 transition-colors font-mono"
                        autoFocus
                        disabled={addFriendStatus === 'loading'}
                      />
                    </div>
                  </div>

                  {/* Nickname Input (Optional) */}
                  <div className="mb-6">
                    <label className="text-white/60 text-xs font-medium uppercase tracking-wider mb-2 block">
                      Nickname <span className="text-white/30">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={addFriendNickname}
                      onChange={(e) => setAddFriendNickname(e.target.value)}
                      placeholder="e.g. Mama"
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 outline-none focus:border-purple-500/50 transition-colors"
                      disabled={addFriendStatus === 'loading'}
                    />
                  </div>

                  {/* Error Message */}
                  {addFriendError && (
                    <p
                      className="text-red-400 text-sm text-center mb-4"
                    >
                      {addFriendError}
                    </p>
                  )}

                  {/* Add Button */}
                  <button
                    onClick={handleAddFriend}
                    disabled={!addFriendId.trim() || addFriendStatus === 'loading'}
                    className={`w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                      !addFriendId.trim() || addFriendStatus === 'loading'
                        ? 'bg-white/10 text-white/40 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg hover:shadow-purple-500/25'
                    }`}
                  >
                    {addFriendStatus === 'loading' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        Add Friend
                      </>
                    )}
                  </button>

                  {/* Help text */}
                  <p className="text-white/30 text-xs text-center mt-4">
                    Ask your friend for their DASH ID
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      

      {/* Notes - Instagram Style (Clean Gray Bubbles) */}
      <div className="py-3">
        <div className="flex gap-4 overflow-x-auto pb-3 px-6 scrollbar-hide">
          {/* Your Note */}
          <button
            className="flex flex-col items-center flex-shrink-0"
            onClick={() => {
              setNoteInput(myNote);
              setIsEditingNote(true);
            }}
          >
            {/* Note bubble */}
            <div className="mb-2 min-h-[32px] flex items-end justify-center">
              {displayNote ? (
                <div className="relative">
                  <div className="px-4 py-2 rounded-2xl bg-[#2a2a2a] shadow-lg">
                    <p className="text-white text-[11px] font-medium max-w-[76px] truncate leading-tight">{displayNote}</p>
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 bg-[#2a2a2a]" />
                </div>
              ) : (
                <div className="relative">
                  <div className="px-4 py-2 rounded-2xl border-[1.5px] border-dashed border-white/[0.25] bg-white/[0.02]">
                    <Plus className="w-3.5 h-3.5 text-white/50" />
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 border-r-[1.5px] border-b-[1.5px] border-dashed border-white/[0.25] bg-[#0a0a0c]" />
                </div>
              )}
            </div>
            {/* Avatar */}
            <div className="relative">
              <div className={`absolute -inset-[2.5px] rounded-full ${displayNote ? 'bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500' : 'border-[1.5px] border-dashed border-white/[0.35]'}`} />
              <img src={AVATARS.dash} alt="" className="relative w-[60px] h-[60px] rounded-full object-cover ring-[3px] ring-[#0a0a0f]" />
            </div>
            <span className="text-white/60 text-[10px] font-medium mt-2 tracking-wide">Your note</span>
          </button>

          {/* Friends - nowPlaying shows as their note */}
          {displayFriends.map((friend) => {
            // Real data: nowPlaying from voyo_profiles becomes their note
            const friendDisplayNote = friend.nowPlaying ? `♪ ${friend.nowPlaying.title}` : null;
            const hasPlayableTrack = friend.nowPlaying?.trackId;

            return (
              <button
                key={friend.id}
                className="flex flex-col items-center flex-shrink-0"
                onClick={() => {
                  // If friend has a playable track, play it and switch to VOYO
                  if (hasPlayableTrack && friend.nowPlaying) {
                    const track = {
                      id: friend.nowPlaying.trackId,
                      trackId: friend.nowPlaying.trackId,
                      title: friend.nowPlaying.title,
                      artist: friend.nowPlaying.artist,
                      coverUrl: friend.nowPlaying.thumbnail || `https://i.ytimg.com/vi/${friend.nowPlaying.trackId}/hqdefault.jpg`,
                    };
                    usePlayerStore.getState().playTrack(track as any);
                    onSwitchToVOYO?.();
                    return;
                  }
                  // Otherwise open chat with this friend
                  setActiveChat({
                    username: friend.id,
                    displayName: friend.name,
                    avatar: friend.avatar,
                  });
                }}
              >
                {/* Note bubble */}
                <div className="mb-2 min-h-[32px] flex items-end justify-center">
                  {friendDisplayNote && (
                    <div className="relative">
                      <div className="px-4 py-2 rounded-2xl bg-[#2a2a2a] shadow-lg">
                        <p className="text-white text-[11px] font-medium max-w-[76px] truncate leading-tight">{friendDisplayNote}</p>
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 bg-[#2a2a2a]" />
                    </div>
                  )}
                </div>
                {/* Avatar */}
                <div className="relative">
                  {/* Green ring if listening (has nowPlaying) */}
                  {friend.nowPlaying && (
                    <div className="absolute -inset-[2.5px] rounded-full bg-gradient-to-br from-purple-400 to-violet-500" />
                  )}
                  <img
                    src={friend.avatar}
                    alt=""
                    className={`relative w-[60px] h-[60px] rounded-full object-cover ring-[3px] ring-[#0a0a0f] ${!friend.nowPlaying && !friend.isOnline ? 'opacity-40' : ''}`}
                  />
                  {friend.isOnline && (
                    <div className="absolute bottom-0.5 right-0.5 w-[14px] h-[14px] rounded-full bg-green-500 border-[3px] border-[#0a0a0f] shadow-sm" />
                  )}
                </div>
                <span className={`text-[10px] font-medium mt-2 tracking-wide ${friend.nowPlaying || friend.isOnline ? 'text-white/70' : 'text-white/40'}`}>{friend.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Following - Artists */}
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest">Following</p>
          <button
            className="flex items-center gap-1 text-white/40 text-xs font-medium hover:text-white/60 transition-colors"
          >
            See all <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-hide">
          {celebrities.map((celeb) => (
            <button
              key={celeb.id}
              className="flex-shrink-0 relative w-[120px] h-[160px] rounded-3xl overflow-hidden shadow-xl"
            >
              {/* Background */}
              <img
                src={celeb.latestRelease.thumbnail}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-black/20" />

              {/* Green ring for verified artists */}
              <div className="absolute top-3 left-3">
                <div className="relative">
                  <div className="absolute -inset-[2.5px] rounded-full bg-gradient-to-br from-purple-400 to-violet-500 shadow-lg" />
                  <img src={celeb.avatar} alt="" className="relative w-9 h-9 rounded-full object-cover ring-2 ring-black/50" />
                </div>
              </div>

              {/* Verified badge or Live */}
              <div className="absolute top-3 right-3">
                {celeb.isLive ? (
                  <div className="px-2 py-0.5 rounded-md bg-red-500 shadow-lg">
                    <p className="text-white text-[9px] font-bold tracking-wide">LIVE</p>
                  </div>
                ) : celeb.verified && (
                  <BadgeCheck className="w-4.5 h-4.5 text-purple-400 drop-shadow-lg" />
                )}
              </div>

              {/* Name at bottom */}
              <div className="absolute bottom-3 left-3 right-3">
                <p className="text-white text-sm font-semibold truncate mb-0.5 drop-shadow-lg">{celeb.name}</p>
                <p className="text-white/70 text-[11px] font-medium truncate">{celeb.latestRelease.title}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Activity - Mixed board style with tabs */}
      <div className="px-6 py-5">
        {/* Tabs */}
        <div className="flex items-center gap-2 mb-5 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setMessageTab('all')}
            className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
              messageTab === 'all'
                ? 'bg-white text-black shadow-lg'
                : 'bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setMessageTab('unread')}
            className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
              messageTab === 'unread'
                ? 'bg-white text-black shadow-lg'
                : 'bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80'
            }`}
          >
            Unread
            {unreadCount > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                messageTab === 'unread' ? 'bg-purple-500 text-white' : 'bg-purple-500 text-white'
              }`}>
                {unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setMessageTab('stories')}
            className={`px-5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
              messageTab === 'stories'
                ? 'bg-white text-black shadow-lg'
                : 'bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80'
            }`}
          >
            Stories
            {storiesCount > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                messageTab === 'stories' ? 'bg-purple-500 text-white' : 'bg-purple-500 text-white'
              }`}>
                {storiesCount}
              </span>
            )}
          </button>
        </div>

        {/* Activity List */}
        <div className="space-y-2">
          {messageTab === 'stories' ? (
            /* Stories Tab - Only mock friends have stories */
            friends.filter(f => f.hasStory).map((friend) => (
              <button
                key={friend.id}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] active:bg-white/[0.06] transition-colors"
                onClick={() => setSelectedFriend(friend)}
              >
                <div className="relative flex-shrink-0">
                  <div className="absolute -inset-[2.5px] rounded-full bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500" />
                  <img src={friend.avatar} alt="" className="relative w-13 h-13 rounded-full object-cover ring-[3px] ring-[#0a0a0f]" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-white text-sm font-semibold mb-0.5">{friend.name}</p>
                  <p className="text-white/60 text-xs font-medium">Tap to view story</p>
                </div>
              </button>
            ))
          ) : (
            <>
              {/* Friends listening - Mixed board (album art + avatar) */}
              {displayFriends.filter(f => f.nowPlaying).map((friend) => {
                const msg = messages.find(m => m.friendId === friend.id);
                if (messageTab === 'unread' && !msg?.isNew) return null;
                return (
                  <button
                    key={friend.id}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] active:bg-white/[0.06] transition-colors"
                    onClick={() => {
                      // Play track and go to VOYO Player
                      if (friend.nowPlaying?.trackId) {
                        const track = {
                          id: friend.nowPlaying.trackId,
                          trackId: friend.nowPlaying.trackId,
                          title: friend.nowPlaying.title,
                          artist: friend.nowPlaying.artist,
                          coverUrl: friend.nowPlaying.thumbnail || `https://i.ytimg.com/vi/${friend.nowPlaying.trackId}/hqdefault.jpg`,
                        };
                        usePlayerStore.getState().playTrack(track as any);
                        onSwitchToVOYO?.();
                      }
                    }}
                  >
                    {/* Album art + avatar overlay */}
                    <div className="relative flex-shrink-0">
                      <img src={friend.nowPlaying?.thumbnail || friend.avatar} alt="" className="w-13 h-13 rounded-xl object-cover shadow-md ring-1 ring-white/[0.05]" />
                      <img src={friend.avatar} alt="" className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full object-cover ring-[3px] ring-[#0a0a0f] shadow-lg" />
                    </div>
                    {/* Info */}
                    <div className="flex-1 text-left min-w-0 pr-2">
                      <p className="text-white text-sm font-semibold truncate mb-0.5">{friend.name}</p>
                      <p className="text-white/60 text-xs font-medium truncate">{friend.nowPlaying?.title} • {friend.nowPlaying?.artist}</p>
                    </div>
                    {/* Status */}
                    {msg?.isNew ? (
                      <div className="flex flex-col items-end flex-shrink-0 min-w-[76px]">
                        <p className="text-xs font-semibold mb-0.5" style={{ color: statusColors[msg.status] }}>
                          {msg.statusText}
                        </p>
                        <span className="text-white/40 text-[10px] font-medium">{msg.time}</span>
                      </div>
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0 shadow-sm" />
                    )}
                  </button>
                );
              })}

              {/* Messages from friends not listening */}
              {filteredMessages.filter(m => !friends.find(f => f.id === m.friendId && f.nowPlaying)).map((msg) => (
                <button
                  key={msg.id}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-white/[0.03] active:bg-white/[0.04] transition-colors"
                  onClick={() => setActiveChat({
                    username: msg.friendId,
                    displayName: msg.friendName,
                    avatar: msg.friendAvatar,
                  })}
                >
                  {/* Circle avatar */}
                  <div className="relative flex-shrink-0">
                    <img src={msg.friendAvatar} alt="" className="w-13 h-13 rounded-full object-cover ring-1 ring-white/[0.05]" />
                    {msg.isOnline && (
                      <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-green-500 border-[3px] border-[#0a0a0f] shadow-sm" />
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex-1 text-left min-w-0 pr-2">
                    <p className={`text-sm font-semibold mb-0.5 ${msg.isNew ? 'text-white' : 'text-white/60'}`}>
                      {msg.friendName}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-sm flex-shrink-0 shadow-sm" style={{ backgroundColor: msg.isNew ? statusColors[msg.status] : '#4b5563' }} />
                      <p className="text-xs font-medium truncate" style={{ color: msg.isNew ? statusColors[msg.status] : '#6b7280' }}>
                        {msg.statusText}
                      </p>
                      <span className="text-white/40 text-xs font-medium flex-shrink-0">• {msg.time}</span>
                    </div>
                  </div>
                  {msg.isNew && (
                    <div className="w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0 shadow-sm" />
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Empty state */}
        {messageTab === 'unread' && filteredMessages.length === 0 && displayFriends.filter(f => f.nowPlaying).every(f => !messages.find(m => m.friendId === f.id)?.isNew) && (
          <div className="py-12 text-center">
            <p className="text-white/40 text-sm font-medium">No unread activity</p>
          </div>
        )}
      </div>

      {/* Self-contained Bottom Navigation — Tivi+ glass pattern */}
      {(onHome || onVoyoFeed || onLibrary) && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-50 px-3 pt-2 pointer-events-none"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
        >
          <div
            className="pointer-events-auto max-w-md mx-auto h-[62px] rounded-2xl flex items-center justify-around px-2"
            style={{
              background: 'rgba(10, 10, 15, 0.65)',
              backdropFilter: 'blur(16px) saturate(150%)',
              WebkitBackdropFilter: 'blur(16px) saturate(150%)',
              border: '1px solid rgba(139, 92, 246, 0.08)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5), 0 0 20px rgba(139,92,246,0.04)',
            }}
          >
            {/* LEFT: Home */}
            <button
              className="relative flex items-center justify-center flex-1 h-full active:scale-95 transition-transform duration-75"
              onClick={onHome}
            >
              <Home style={{ width: 20, height: 20, color: 'rgba(255,255,255,0.4)', strokeWidth: 1.8 }} />
            </button>

            {/* CENTER: VOYO ORB — consistent across all nav surfaces */}
            <button
              className="relative flex items-center justify-center active:scale-95 transition-transform duration-75"
              onClick={onVoyoFeed}
              style={{ flex: '0 0 auto' }}
            >
              <div
                className="relative w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #6d28d9 100%)',
                  boxShadow: '0 0 20px rgba(139, 92, 246, 0.35), 0 4px 16px rgba(0,0,0,0.4)',
                }}
              >
                <span className="font-black text-sm text-white tracking-tight">VOYO</span>
              </div>
            </button>

            {/* RIGHT: Library */}
            <button
              className="relative flex items-center justify-center flex-1 h-full active:scale-95 transition-transform duration-75"
              onClick={onLibrary}
            >
              <LibraryIcon style={{ width: 20, height: 20, color: 'rgba(255,255,255,0.4)', strokeWidth: 1.8 }} />
            </button>
          </div>
        </nav>
      )}

      <div className="h-24" />
    </div>
  );
};

export default Hub;
