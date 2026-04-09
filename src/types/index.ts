// VOYO Music Device - Core Types

// Mood Types
export type MoodType =
  | 'afro'
  | 'feed'
  | 'rnb'
  | 'hype'
  | 'chill'
  | 'heartbreak'
  | 'dance'
  | 'street'
  | 'party'
  | 'worship'
  | 'focus'
  | 'gym';

// Mood Tunnel Interface
export interface MoodTunnel {
  id: MoodType;
  name: string;
  icon: string;
  color: string;
  gradient: string;
}

// Track Interface
export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  trackId: string;
  coverUrl: string;
  duration: number;
  tags: string[];
  mood?: MoodType;
  region?: string;
  oyeScore: number;
  createdAt: string;
}

// Playlist Interface
export interface Playlist {
  id: string;
  title: string;
  coverUrl: string;
  trackIds: string[];
  type: 'CURATED' | 'ALGO' | 'USER';
  mood?: MoodType;
  createdAt: string;
}

// Album Interface (YouTube playlists via Piped)
export interface Album {
  id: string;           // Playlist ID from YouTube
  name: string;         // Album name
  artist: string;       // Artist name
  thumbnail: string;    // Album artwork
  trackCount: number;   // Number of tracks
  tracks?: Track[];     // Loaded lazily when playing
  source: 'piped' | 'local';
}

// View Mode
export type ViewMode = 'card' | 'lyrics' | 'video' | 'feed';

// Player State
export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  volume: number;
  viewMode: ViewMode;
}

// Queue Item
export interface QueueItem {
  track: Track;
  addedAt: string;
  source: 'auto' | 'manual' | 'roulette' | 'ai';
}

// History Item
export interface HistoryItem {
  track: Track;
  playedAt: string;
  duration: number;
  oyeReactions: number;
}

// Recommendation Zone
export type RecommendationZone = 'hot' | 'ai' | 'discover';

// Recommendation
export interface Recommendation {
  track: Track;
  zone: RecommendationZone;
  reason?: string;
  score: number;
}

// Reaction Types
export type ReactionType =
  | 'oyo'
  | 'oye'
  | 'wazzguan'
  | 'yoooo'
  | 'mad_oh'
  | 'eyyy'
  | 'fire'
  | 'we_move'
  | 'custom';

// Reaction Interface
export interface Reaction {
  id: string;
  type: ReactionType;
  text: string;
  emoji?: string;
  x: number;
  y: number;
  multiplier: number;
  userId: string;
  createdAt: string;
}

// OYE Score
export interface OyeScore {
  total: number;
  reactions: number;
  storms: number;
  peak: number;
}

// User
export interface User {
  id: string;
  displayName: string;
  avatarUrl?: string;
  country?: string;
  oyoLevel: number;
  oyeScore: number;
  likedTracks: string[];
  playlists: string[];
  createdAt: string;
}

// VOYO Clip
export interface VoyoClip {
  id: string;
  trackId: string;
  userId: string;
  videoUrl: string;
  thumbnailUrl: string;
  caption?: string;
  tags: string[];
  oyeScore: number;
  viewCount: number;
  createdAt: string;
}

// Session Types
export type SessionType =
  | 'private_showcase'
  | 'oyo_circle'
  | 'choir_mode'
  | 'street_festival'
  | 'voyo_concert'
  | 'oye_arena';

// Live Session
export interface LiveSession {
  id: string;
  artistId: string;
  oyeGoal: number;
  currentOye: number;
  sessionType: SessionType;
  scheduledAt?: string;
  isLive: boolean;
  rsvpCount: number;
  highlightClipIds: string[];
}

// =============================================
// VOYO SUPERAPP TYPES (Genesis Blueprint v1.0)
// =============================================

// VOYO Tab Navigation
export type VoyoTab = 'music' | 'feed' | 'upload' | 'dahub';

// Feed Item (TikTok-style content)
export interface FeedItem {
  id: string;
  user: string;
  userAvatar?: string;
  caption: string;
  likes: string;
  oyes: string;
  videoUrl: string;
  thumbnailUrl?: string;
  songId?: string;
  songTitle?: string;
  songArtist?: string;
  tags?: string[];
  createdAt: string;
}

// DJ Mode States
export type DJMode = 'idle' | 'listening' | 'thinking' | 'responding';

// =============================================
// VOYO ACCOUNTS - WhatsApp Auth System
// voyomusic.com/username
// =============================================

// Subscription Status
export type SubscriptionStatus =
  | 'active'      // Paid up, full access
  | 'trial'       // New user, 7 day trial
  | 'overdue'     // Payment pending, grace period
  | 'banned'      // Blocked for non-payment (friends see this!)
  | 'vip';        // Lifetime/special access

// Account Verification State
export type VerificationState =
  | 'idle'
  | 'sending_pin'
  | 'waiting_pin'
  | 'verifying'
  | 'verified'
  | 'error';

// VOYO Account (the user profile page)
export interface VOYOAccount {
  id: string;
  username: string;           // voyomusic.com/[username]
  whatsapp: string;           // +224XXXXXXXXX
  pin: string;                // 6-digit PIN (hashed in production)
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  subscription: SubscriptionStatus;
  banReason?: string;         // "Payment overdue since Dec 1"
  subscriptionEnds?: string;  // ISO date

  // Social
  friendIds: string[];
  friendRequestIds: string[];

  // Music Stats
  nowPlaying?: {
    trackId: string;
    title: string;
    artist: string;
    thumbnail: string;
    startedAt: string;
  };
  totalListeningHours: number;
  totalOyeGiven: number;
  totalOyeReceived: number;

  // Stories
  stories: VOYOStory[];

  createdAt: string;
  lastSeenAt: string;
}

// VOYO Story (friend stories in DAHUB)
export interface VOYOStory {
  id: string;
  userId: string;
  type: 'now_playing' | 'image' | 'video' | 'text';
  content: {
    // For now_playing
    trackId?: string;
    title?: string;
    artist?: string;
    thumbnail?: string;
    // For media
    url?: string;
    // For text
    text?: string;
    backgroundColor?: string;
  };
  viewerIds: string[];
  reactions: {
    emoji: string;
    userId: string;
    timestamp: string;
  }[];
  expiresAt: string;  // 24h from creation
  createdAt: string;
}

// Friend with story status (for DAHUB)
export interface FriendWithStory {
  account: VOYOAccount;
  hasUnviewedStory: boolean;
  latestStoryTime?: string;
  unreadMessageCount: number;
}
