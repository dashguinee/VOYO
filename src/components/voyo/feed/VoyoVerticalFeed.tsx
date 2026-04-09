/**
 * VOYO Vertical Feed - Music Discovery Feed
 *
 * YouTube Shorts / Stripchat style full-portrait feed
 *
 * 3 Content Types (Same Layout):
 * 1. Thumbnail + scrolling comments/punches
 * 2. Music video snippet (15-30s) + scrolling comments
 * 3. Hottest part snippet (section with most reactions)
 *
 * Layout:
 * - Full portrait screen
 * - Background: Thumbnail OR video snippet
 * - Translucent auto-scrolling comments/punches overlay
 * - Right side: Like + count, OYE, FIRE, Comments, Share
 * - Tap to show/hide full comments section
 */

import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import {
  Heart, MessageCircle, Share2, Music2, Zap, Play, Pause,
  ChevronDown, User, MapPin, Flame, Plus, X, Volume2, VolumeX,
  Bookmark, UserPlus, UserMinus, FastForward, Check
} from 'lucide-react';
import { useReactionStore, Reaction, ReactionCategory, ReactionType, TrackHotspot } from '../../../store/reactionStore';
import { usePlayerStore } from '../../../store/playerStore';
import { useAuth } from '../../../hooks/useAuth';
import { useTrackPoolStore } from '../../../store/trackPoolStore';
import { useDownloadStore } from '../../../store/downloadStore';
import { devLog } from '../../../utils/logger';
import { safeAddManyToPool } from '../../../services/trackVerifier';
import { friendsAPI } from '../../../lib/voyo-api';
import { TRACKS, pipedTrackToVoyoTrack } from '../../../data/tracks';
import { searchAlbums, getAlbumTracks } from '../../../services/piped';
import { mediaCache } from '../../../services/mediaCache';
import { feedContentService, cacheFeedContent, updateAccessTime } from '../../../services/feedContentService';
import { TRENDING_QUERIES, WEST_AFRICAN_QUERIES, CLASSICS_QUERIES } from '../../../services/poolCurator';
import { AudioVisualizer, WaveformVisualizer } from './AudioVisualizer';
import { VideoSnippet } from './VideoSnippet';
import { ContentMixer, ContentType } from './ContentMixer';
import { FloatingReactions, useFloatingReactions, useDoubleTap } from './FloatingReactions';
import { useEngagementTracker } from './FeedTransitions';
import { SmartImage } from '../../ui/SmartImage';
import { applyTreatment, getStartTime, getDuration } from '../../../services/feedAlgorithm';

// Snippet config
const ENABLE_VIDEO_SNIPPETS = true; // Toggle video snippets on/off
const DEFAULT_SEEK_PERCENT = 25; // Where to start if no hotspots

// Discovery config - unified with poolCurator's organized sections
// Combines curated queries + extra variety for infinite feed
const DISCOVERY_EXTRAS = [
  // Top Artists (more specific)
  'Burna Boy official video',
  'Wizkid official video',
  'Davido official video',
  'Tyla official video',
  'Fireboy DML official',
  'Tiwa Savage official',
  'Victony official',
  'BNXN official',
  'Ruger official',
  'Kizz Daniel official',

  // Genres & Vibes
  'Afrobeats 2025 new',
  'Amapiano hits playlist',
  'South African amapiano',
  'Afro pop hits',
  'Afrobeats party mix',
  'Amapiano dance',
  'Afro soul chill',
  'African RnB vibes',

  // Labels & Compilations
  'Mavin Records artists',
  'Starboy Entertainment',
  'Afrobeats essentials playlist',

  // Regional
  'Tanzanian bongo flava',
  'Kenyan gengetone',
  'Congolese ndombolo',
  'Afrobeats UK scene',
];

// Unified discovery: curator sections + extras (single source of truth)
const DISCOVERY_QUERIES = [
  ...TRENDING_QUERIES,
  ...WEST_AFRICAN_QUERIES,
  ...CLASSICS_QUERIES,
  ...DISCOVERY_EXTRAS,
];
const DISCOVERY_THRESHOLD = 5; // Load more when 5 tracks from end

// Snippet modes
const SNIPPET_MODES = {
  full: {
    duration: 25, // 25 seconds for full preview
    label: 'Full',
    icon: '🎵',
    description: 'Full 25s preview',
  },
  extract: {
    duration: 12, // 12 seconds for hot extract (the peak moment)
    label: 'Extract',
    icon: '🔥',
    description: 'Hot 12s extract',
  },
} as const;

type SnippetMode = keyof typeof SNIPPET_MODES;

// ============================================
// FEED MODE TYPE
// ============================================
type FeedMode = 'forYou' | 'following';

// ============================================
// PROGRESS BAR COMPONENT WITH HEATMAP
// ============================================
const ProgressBar = ({ isActive, trackId, onSeekToHotspot }: {
  isActive: boolean;
  trackId: string;
  onSeekToHotspot?: (position: number) => void;
}) => {
  const progress = usePlayerStore((state) => state.progress);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);
  const getHotspots = useReactionStore((state) => state.getHotspots);

  const hotspots = useMemo(() => getHotspots(trackId), [getHotspots, trackId]);

  // Find the hottest spot (highest intensity)
  const hottestSpot = useMemo(() => {
    if (hotspots.length === 0) return null;
    return hotspots.reduce((a, b) => a.intensity > b.intensity ? a : b);
  }, [hotspots]);

  if (!isActive) return null;

  // Get color for hotspot based on dominant reaction type
  const getHotspotColor = (type: string, intensity: number) => {
    const alpha = Math.max(0.3, intensity);
    switch (type) {
      case 'fire': return `rgba(212, 160, 83, ${alpha})`; // Bronze
      case 'like': return `rgba(139, 92, 246, ${alpha})`; // Purple
      case 'oye':
      default: return `rgba(212, 160, 83, ${alpha})`; // Bronze
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30">
      {/* Progress bar with heatmap - no visible track, just the progress */}
      <div className="relative h-1.5 bg-transparent">
        {/* Hotspot markers */}
        {hotspots.map((hotspot, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 rounded-full"
            style={{
              left: `${hotspot.position - 3}%`,
              width: '6%',
              background: getHotspotColor(hotspot.dominantType, hotspot.intensity),
              filter: hotspot.intensity > 0.7 ? 'blur(1px)' : 'none',
            }}
          />
        ))}
        {/* Progress overlay — purple to bronze gradient */}
        <div
          className="absolute top-0 bottom-0 left-0"
          style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #8b5cf6 0%, #a78bfa 40%, #D4A053 100%)' }}
        />
        {/* Hotspot glow indicators */}
        {hotspots.filter(h => h.intensity > 0.5).map((hotspot, i) => (
          <div
            key={`glow-${i}`}
            className="absolute -top-1 w-2 h-2 rounded-full"
            style={{
              left: `${hotspot.position}%`,
              background: getHotspotColor(hotspot.dominantType, 1),
              boxShadow: `0 0 6px ${getHotspotColor(hotspot.dominantType, 1)}`,
            }}
          />
        ))}
      </div>
      {/* Time display */}
      <div className="absolute bottom-2 left-4 text-white/60 text-[10px] font-mono">
        {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
        {' / '}
        {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
      </div>
      {/* Hotspot count indicator + Skip to hot button */}
      {hotspots.length > 0 && (
        <div className="absolute bottom-2 right-4 flex items-center gap-2">
          {hottestSpot && onSeekToHotspot && (
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/20 text-white text-[10px] font-bold backdrop-blur-sm min-h-[44px] min-w-[44px] active:scale-95 transition-transform"
              aria-label="Skip to hot part"
              onClick={() => onSeekToHotspot(hottestSpot.position)}
            >
              <Flame className="w-3 h-3" style={{ fill: 'white' }} />
              <span>HOT</span>
            </button>
          )}
          <div className="flex items-center gap-1 text-white/60 text-[10px]">
            <Flame className="w-3 h-3 text-white/60" />
            <span>{hotspots.length} hot {hotspots.length === 1 ? 'spot' : 'spots'}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// REACTION CONFIG
// ============================================
const REACTION_CONFIG = {
  like: { icon: Heart, color: '#8b5cf6', activeColor: '#8b5cf6', label: 'Like' },
  oye: { icon: Zap, color: '#D4A053', activeColor: '#D4A053', label: 'OYÉ' },
  fire: { icon: Flame, color: '#D4A053', activeColor: '#D4A053', label: 'Fire' },
};

// ============================================
// AUTO-SCROLLING COMMENTS OVERLAY
// ============================================
interface ScrollingComment {
  id: string;
  text: string;
  username: string;
  isPunch: boolean; // Has 📍 distinction
  timestamp: number;
}

const ScrollingCommentsOverlay = ({
  comments,
  isVisible,
}: {
  comments: ScrollingComment[];
  isVisible: boolean;
}) => {
  const [displayedComments, setDisplayedComments] = useState<ScrollingComment[]>([]);
  const indexRef = useRef(0);

  // Add comments one by one with delay
  useEffect(() => {
    if (!isVisible || comments.length === 0) return;

    const interval = setInterval(() => {
      if (indexRef.current < comments.length) {
        setDisplayedComments(prev => [...prev.slice(-8), comments[indexRef.current]]);
        indexRef.current++;
      } else {
        indexRef.current = 0; // Loop
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [comments, isVisible]);

  // Reset when visibility changes
  useEffect(() => {
    if (!isVisible) {
      setDisplayedComments([]);
      indexRef.current = 0;
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="absolute bottom-32 left-0 right-20 px-4 pointer-events-none">
      <>
        {displayedComments.map((comment) => (
          <div
            key={comment.id}
            className={`mb-2 px-3 py-2 rounded-2xl backdrop-blur-md max-w-[85%] animate-voyo-slide-up ${
              comment.isPunch
                ? 'bg-purple-500/30 border-l-2 border-purple-500'
                : 'bg-black/40'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-[10px] font-bold ${comment.isPunch ? 'text-purple-300' : 'text-purple-400'}`}>
                @{comment.username}
              </span>
              {comment.isPunch && (
                <span className="text-[8px] px-1 rounded bg-purple-500/40 text-purple-200">📍</span>
              )}
            </div>
            <p className="text-white/90 text-sm">{comment.text}</p>
          </div>
        ))}
      </>
    </div>
  );
};

// ============================================
// FULL COMMENTS SHEET
// ============================================
const CommentsSheet = ({
  isOpen,
  onClose,
  reactions,
  trackTitle,
  onAddComment,
}: {
  isOpen: boolean;
  onClose: () => void;
  reactions: Reaction[];
  trackTitle: string;
  onAddComment: (text: string) => void;
}) => {
  const [commentText, setCommentText] = useState('');

  const handleSubmit = () => {
    if (commentText.trim()) {
      onAddComment(commentText.trim());
      setCommentText('');
    }
  };

  const commentsWithText = reactions.filter(r => r.comment);

  return (
    <>
      {isOpen && (
        <div
          className="absolute inset-0 z-50 animate-voyo-fade-in"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />

          {/* Sheet */}
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-3xl max-h-[70vh] flex flex-col animate-voyo-spring-in-bottom border-t border-[#28282f]"
            style={{ background: 'rgba(17, 17, 20, 0.95)', backdropFilter: 'blur(20px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div>
                <h3 className="text-white font-bold">Comments</h3>
                <p className="text-white/50 text-xs truncate max-w-[200px]">{trackTitle}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95 transition-transform"
                aria-label="Close comments"
              >
                <X className="w-5 h-5 text-white/70" />
              </button>
            </div>

            {/* Comments List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {commentsWithText.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-white/40">
                  <MessageCircle className="w-10 h-10 mb-2" />
                  <p className="text-sm">No comments yet</p>
                  <p className="text-xs">Be the first to comment!</p>
                </div>
              ) : (
                commentsWithText.map((reaction) => {
                  const isPunch = reaction.emoji === '📍';
                  return (
                    <div
                      key={reaction.id}
                      className={`flex gap-3 ${isPunch ? 'bg-purple-500/10 -mx-2 px-2 py-2 rounded-lg border-l-2 border-purple-500' : ''}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isPunch
                          ? 'bg-gradient-to-br from-purple-500 to-violet-600'
                          : 'bg-gradient-to-br from-purple-500 to-violet-600'
                      }`}>
                        <User className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${isPunch ? 'text-purple-300' : 'text-purple-400'}`}>
                            @{reaction.username}
                          </span>
                          {isPunch && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-purple-500/30 text-purple-300 font-bold">
                              📍 PUNCH
                            </span>
                          )}
                        </div>
                        <p className="text-white/80 text-sm mt-0.5">{reaction.comment}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Comment Input */}
            <div className="p-4 border-t border-white/10 flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Add a comment..."
                className="flex-1 bg-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
              <button
                onClick={handleSubmit}
                className="px-4 py-2.5 rounded-full bg-gradient-to-r from-purple-500 to-violet-600 text-white text-sm font-bold min-h-[44px] active:scale-95 transition-transform"
                aria-label="Post comment"
              >
                Post
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================
// FEED CARD - Full Portrait YouTube Shorts Style
// ============================================
interface FeedCardProps {
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  trackThumbnail?: string;
  reactions: Reaction[];
  nativeOyeScore?: number; // Track's base OYE score from library
  hottestPosition?: number; // 0-100 percentage of hottest part
  snippetDuration: number; // How long the snippet plays (12s for extract, 25s for full)
  snippetMode: SnippetMode; // 'extract' or 'full'
  isActive: boolean;
  isPlaying: boolean;
  isThisTrack: boolean; // Is this card's track the current track?
  shouldPreload?: boolean; // Should preload video (for next 2 cards)
  isFollowingArtist?: boolean; // Is current user following this artist?
  onPlay: () => void;
  onTogglePlay: () => void;
  onReact: (type: ReactionType) => void;
  onAddComment: (text: string) => void;
  onAddToLibrary?: () => void; // OYÉ = add to library + boost
  onAddToPlaylist?: () => void; // + button
  onGoToPlayer?: () => void; // Navigate to full music player
  onShare?: () => void; // Share track
  onSeekToHotspot?: (position: number) => void; // Seek to hot part
  onFollowArtist?: () => void; // Follow/unfollow artist
  onSnippetEnd?: () => void; // Called when snippet duration ends (for auto-advance)
  onDoubleTapReaction?: () => void; // Double-tap = reaction storm
}

const FeedCard = memo(({
  trackId,
  trackTitle,
  trackArtist,
  trackThumbnail,
  reactions,
  nativeOyeScore = 0,
  hottestPosition,
  snippetDuration,
  snippetMode,
  isActive,
  isPlaying,
  isThisTrack,
  shouldPreload = false,
  isFollowingArtist = false,
  onPlay,
  onTogglePlay,
  onReact,
  onAddComment,
  onAddToLibrary,
  onAddToPlaylist,
  onGoToPlayer,
  onShare,
  onSeekToHotspot,
  onFollowArtist,
  onSnippetEnd,
  onDoubleTapReaction,
}: FeedCardProps) => {
  const [showComments, setShowComments] = useState(false);
  const [userReactions, setUserReactions] = useState<Set<ReactionType>>(new Set());
  const [snippetStarted, setSnippetStarted] = useState(false);
  const [showHeartBurst, setShowHeartBurst] = useState(false);
  const snippetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Floating reactions hook
  const { addReaction: addFloatingReaction, triggerStorm } = useFloatingReactions();

  // Double-tap handler for reaction storm
  const handleDoubleTap = useDoubleTap(
    () => {
      // Double tap = OYÉ storm (love this track!)
      triggerStorm('oye', 15);
      setShowHeartBurst(true);
      setTimeout(() => setShowHeartBurst(false), 500);
      onReact('oye');
      onDoubleTapReaction?.();
      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(50);
    },
    () => {
      // Single tap = toggle play
      if (isThisTrack) {
        onTogglePlay();
      } else {
        onPlay();
      }
    },
    300
  );

  // Auto-play snippet when card becomes active
  // SIMPLE & CLEAN: VideoSnippet handles video + audio natively
  // No AudioPlayer involvement - just let YouTube iframe auto-play
  useEffect(() => {
    if (isActive) {
      // Seek to hottest part after iframe has time to load
      setTimeout(() => {
        const seekPosition = hottestPosition ?? DEFAULT_SEEK_PERCENT;
        onSeekToHotspot?.(seekPosition);
        setSnippetStarted(true);
      }, 300);
    }

    // Reset snippet state when card becomes inactive
    if (!isActive) {
      setSnippetStarted(false);
      if (snippetTimerRef.current) {
        clearTimeout(snippetTimerRef.current);
        snippetTimerRef.current = null;
      }
    }
  }, [isActive, onSeekToHotspot, hottestPosition]);

  // Auto-advance timer - trigger after snippetDuration seconds
  // SIMPLE & CLEAN: Timer based on isActive + snippetStarted only (no playerStore dependency)
  useEffect(() => {
    if (isActive && snippetStarted && onSnippetEnd) {
      snippetTimerRef.current = setTimeout(() => {
        devLog(`[Feed] ${snippetMode === 'extract' ? 'Hot extract' : 'Snippet'} ended for ${trackTitle}, auto-advancing...`);
        onSnippetEnd();
      }, snippetDuration * 1000);

      return () => {
        if (snippetTimerRef.current) {
          clearTimeout(snippetTimerRef.current);
        }
      };
    }
  }, [isActive, snippetStarted, onSnippetEnd, trackTitle, snippetDuration, snippetMode]);

  // Count reactions
  const reactionCounts = useMemo(() => {
    const counts = { like: 0, oye: 0, fire: 0, comments: 0, punches: 0 };
    reactions.forEach(r => {
      if (r.reaction_type === 'like') counts.like++;
      else if (r.reaction_type === 'oye') counts.oye++;
      else if (r.reaction_type === 'fire') counts.fire++;
      if (r.comment) {
        counts.comments++;
        if (r.emoji === '📍') counts.punches++;
      }
    });
    return counts;
  }, [reactions]);

  // Convert reactions to scrolling comments
  const scrollingComments = useMemo((): ScrollingComment[] => {
    return reactions
      .filter(r => r.comment)
      .map(r => ({
        id: r.id,
        text: r.comment || '',
        username: r.username,
        isPunch: r.emoji === '📍',
        timestamp: new Date(r.created_at).getTime(),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [reactions]);

  // Handle reaction tap
  const handleReaction = (type: ReactionType) => {
    const newReactions = new Set(userReactions);
    if (newReactions.has(type)) {
      newReactions.delete(type);
    } else {
      newReactions.add(type);
      onReact(type);
    }
    setUserReactions(newReactions);
  };

  // Format count
  const formatCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div className="relative w-full h-full bg-black">
      {/* Background - Dynamic Content (Video, Animated Art, TikTok, etc.) */}
      <div className="absolute inset-0">
        {/* ContentMixer chooses the best visual for this track */}
        <ContentMixer
          trackId={trackId}
          trackTitle={trackTitle}
          trackArtist={trackArtist}
          thumbnail={trackThumbnail}
          isActive={isActive}
          isPlaying={isPlaying}
          isThisTrack={isThisTrack}
          shouldPreload={shouldPreload}
          forceContentType={ENABLE_VIDEO_SNIPPETS ? undefined : 'animated_art'}
        />

        {/* Full height fade - blends hero into canvas */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent pointer-events-none" />

        {/* Audio Visualizer - shows when playing (over video or thumbnail) */}
        <AudioVisualizer
          isPlaying={isPlaying && isThisTrack}
          intensity={0.8}
          barCount={24}
          position="bottom"
          color="rgba(168, 85, 247, 0.7)"
        />

        {/* Waveform effect overlay */}
        <WaveformVisualizer
          isPlaying={isPlaying && isThisTrack}
          color="rgba(236, 72, 153, 0.4)"
        />

        {/* Playing indicator pulse */}
        {isPlaying && isThisTrack && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(168,85,247,0.3) 0%, transparent 70%)',
              animation: 'voyo-glow-breathe 2s ease-in-out infinite',
            }}
          />
        )}

      </div>

      {/* Tap to play/pause OR Double-tap for reaction storm - invisible overlay */}
      <button
        className="absolute inset-0 z-10"
        onClick={handleDoubleTap}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      />

      {/* Heart burst animation on double-tap */}
      <>
        {showHeartBurst && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none animate-voyo-fade-in"
          >
            <div
              className="flex items-center justify-center animate-voyo-pop-in"
            >
              <Zap
                className="w-24 h-24"
                style={{
                  color: '#D4A053',
                  fill: '#D4A053',
                  filter: 'drop-shadow(0 0 20px rgba(212, 160, 83, 0.6)) drop-shadow(0 0 40px rgba(212, 160, 83, 0.3))',
                }}
              />
            </div>
          </div>
        )}
      </>

      {/* Progress Bar with Heatmap + Hot Part Seek */}
      <ProgressBar
        isActive={isActive && isThisTrack}
        trackId={trackId}
        onSeekToHotspot={onSeekToHotspot}
      />

      {/* Scrolling Comments Overlay */}
      <ScrollingCommentsOverlay
        comments={scrollingComments}
        isVisible={isActive && !showComments}
      />

      {/* Track Info - Bottom Left (Clean) */}
      <div className="absolute bottom-28 left-4 right-24 z-20">
        {/* OYÉ Badge - Orange gradient fade */}
        {(() => {
          const totalOye = nativeOyeScore + reactionCounts.oye;
          if (totalOye < 100) return null;
          return (
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 mb-3 rounded-full"
              style={{
                background: 'linear-gradient(90deg, rgba(212,160,83,0.9) 0%, rgba(196,148,61,0.7) 50%, rgba(212,160,83,0.3) 100%)',
              }}
            >
              <Zap className="w-3 h-3 text-white" style={{ fill: 'white' }} />
              <span className="text-white text-[10px] font-bold tracking-wide">{formatCount(totalOye)} OYÉ</span>
            </div>
          );
        })()}

        {/* Track Title + Artist */}
        <h3 className="text-white text-base font-semibold line-clamp-2 leading-tight">
          {trackTitle}
        </h3>
        <p className="text-white/50 text-xs mt-0.5">{trackArtist}</p>

        {/* Profile + Follow - smaller, centered to name */}
        {onFollowArtist && (
          <button
            className="relative mt-4 min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95 transition-transform"
            aria-label={isFollowingArtist ? `Unfollow ${trackArtist}` : `Follow ${trackArtist}`}
            onClick={(e) => {
              e.stopPropagation();
              onFollowArtist();
            }}
          >
            <div
              className={`w-7 h-7 rounded-full overflow-hidden border ${
                isFollowingArtist ? 'border-purple-500' : 'border-white/40'
              }`}
            >
              <SmartImage
                src={trackThumbnail || `https://ui-avatars.com/api/?name=${trackArtist}&background=8b5cf6&color=fff`}
                alt={trackArtist}
                trackId={trackId}
                className="w-full h-full object-cover"
                lazy={false}
              />
            </div>
            <div
              className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full flex items-center justify-center bg-purple-500`}
            >
              {isFollowingArtist ? (
                <Check className="w-2 h-2 text-white" />
              ) : (
                <Plus className="w-2 h-2 text-white" />
              )}
            </div>
          </button>
        )}
      </div>

      {/* Right Side Actions - Clean & Functional */}
      <div className="absolute right-4 bottom-32 z-20 flex flex-col items-center gap-5">
        {/* OYE Button - Main Action — African Gold Bronze */}
        <button
          className="flex flex-col items-center active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] rounded-full"
          aria-label="OYE this track"
          onClick={() => {
            handleReaction('oye');
            addFloatingReaction('oye');
            onAddToLibrary?.();
            if (navigator.vibrate) navigator.vibrate(30);
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
            style={{
              background: 'linear-gradient(135deg, #D4A053, #C4943D)',
              boxShadow: userReactions.has('oye')
                ? '0 0 18px rgba(212, 160, 83, 0.6), 0 0 40px rgba(212, 160, 83, 0.2)'
                : '0 4px 15px rgba(0,0,0,0.3)',
            }}
          >
            <Zap className="w-7 h-7 text-white" style={{ fill: 'white' }} />
          </div>
          <span className={`text-[11px] font-bold mt-1.5 transition-colors ${
            userReactions.has('oye') ? 'text-[#D4A053]' : 'text-[#D4A053]'
          }`}>OYE</span>
        </button>

        {/* Like Button (Heart) — purple when active */}
        <button
          className="flex flex-col items-center min-w-[44px] min-h-[44px] active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] rounded-full"
          aria-label="Like this track"
          onClick={() => {
            handleReaction('like');
            addFloatingReaction('like');
            if (navigator.vibrate) navigator.vibrate(20);
          }}
        >
          <div>
            <Heart
              className={`w-8 h-8 transition-colors ${
                userReactions.has('like') ? 'text-purple-400' : 'text-white/40'
              }`}
              style={userReactions.has('like') ? { fill: '#8b5cf6' } : {}}
            />
          </div>
          <span className={`text-[11px] font-medium mt-1 ${
            userReactions.has('like') ? 'text-purple-400' : 'text-white/40'
          }`}>{reactionCounts.like || ''}</span>
        </button>

        {/* Fire Button — bronze when active */}
        <button
          className="flex flex-col items-center min-w-[44px] min-h-[44px] active:scale-95 transition-transform"
          aria-label="Fire reaction"
          onClick={() => {
            handleReaction('fire');
            addFloatingReaction('fire');
            if (navigator.vibrate) navigator.vibrate(20);
          }}
        >
          <div>
            <Flame
              className={`w-8 h-8 transition-colors ${
                userReactions.has('fire') ? 'text-[#D4A053]' : 'text-white/40'
              }`}
              style={userReactions.has('fire') ? { color: '#D4A053', fill: '#D4A053' } : {}}
            />
          </div>
          <span className={`text-[11px] font-medium mt-1 ${
            userReactions.has('fire') ? 'text-[#D4A053]' : 'text-white/40'
          }`}>{reactionCounts.fire || ''}</span>
        </button>

        {/* Comments */}
        <button
          className="flex flex-col items-center min-w-[44px] min-h-[44px] active:scale-95 transition-transform"
          aria-label="Comments"
          onClick={() => setShowComments(true)}
        >
          <MessageCircle className="w-8 h-8 text-white/40" />
          <span className="text-white/40 text-[11px] font-medium mt-1">{reactionCounts.comments || ''}</span>
        </button>

        {/* Add to Playlist */}
        <button
          className="flex flex-col items-center min-w-[44px] min-h-[44px] active:scale-95 transition-transform"
          aria-label="Add to playlist"
          onClick={() => onAddToPlaylist?.()}
        >
          <Plus className="w-8 h-8 text-white/40" />
        </button>

        {/* Share */}
        <button
          className="flex flex-col items-center min-w-[44px] min-h-[44px] active:scale-90 transition-transform"
          aria-label="Share"
          onClick={onShare}
        >
          <Share2 className="w-8 h-8 text-white/40" />
        </button>
      </div>

      {/* Comments Sheet */}
      <CommentsSheet
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        reactions={reactions}
        trackTitle={trackTitle}
        onAddComment={onAddComment}
      />
    </div>
  );
});

// ============================================
// MAIN FEED COMPONENT
// ============================================
interface VoyoVerticalFeedProps {
  isActive: boolean;
  onGoToPlayer?: () => void; // Navigate to Music player tab
}

export const VoyoVerticalFeed = ({ isActive, onGoToPlayer }: VoyoVerticalFeedProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedMode, setFeedMode] = useState<FeedMode>('forYou');
  const [snippetMode, setSnippetMode] = useState<SnippetMode>('extract'); // Default to hot extracts
  const [followingList, setFollowingList] = useState<Set<string>>(new Set());
  const [isLoadingFollows, setIsLoadingFollows] = useState(false);
  const [showContinueButton, setShowContinueButton] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Discovery state - infinite scroll
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryIndex, setDiscoveryIndex] = useState(0);
  const discoveredIdsRef = useRef<Set<string>>(new Set());
  const discoveryQueueRef = useRef<Promise<void> | null>(null); // Prevent concurrent discoveries

  // Get current snippet config
  const snippetConfig = SNIPPET_MODES[snippetMode];

  const { recentReactions, fetchRecentReactions, subscribeToReactions, isSubscribed, createReaction, computeHotspots, getCategoryScore, getTopCategories, getHotspots } = useReactionStore();
  const { setCurrentTrack, addToQueue, currentTrack, isPlaying, togglePlay, progress, duration, seekTo, volume, setVolume } = usePlayerStore();
  const { dashId } = useAuth();
  const { hotPool, recordReaction } = useTrackPoolStore();
  const { boostTrack } = useDownloadStore();

  // Fetch reactions on mount
  useEffect(() => {
    if (isActive) {
      fetchRecentReactions(100);
      if (!isSubscribed) {
        subscribeToReactions();
      }
    }
  }, [isActive, fetchRecentReactions, subscribeToReactions, isSubscribed]);

  // Fetch following list on mount - stored locally for artist follows
  useEffect(() => {
    const loadFollowing = async () => {
      if (!dashId) return;
      setIsLoadingFollows(true);
      try {
        // Artist follows are stored locally (not same as friend follows in Command Center)
        const stored = localStorage.getItem(`voyo_artist_follows_${dashId}`);
        if (stored) {
          setFollowingList(new Set(JSON.parse(stored)));
        }
      } catch (e) {
        console.error('[Feed] Failed to load following:', e);
      }
      setIsLoadingFollows(false);
    };
    loadFollowing();
  }, [dashId]);

  // Engagement tracking - show ContinuePlayingButton after 6s of playback
  const playTimeRef = useRef(0);
  const engagementTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Reset when track changes
    playTimeRef.current = 0;
    setShowContinueButton(false);

    if (isActive && isPlaying && currentTrack) {
      // Start tracking play time
      engagementTimerRef.current = setInterval(() => {
        playTimeRef.current += 1;
        // Show button after 6 seconds of engagement
        if (playTimeRef.current >= 6 && !showContinueButton) {
          setShowContinueButton(true);
          devLog('[Feed] User engaged! Showing Continue Playing button');
        }
      }, 1000);
    }

    return () => {
      if (engagementTimerRef.current) {
        clearInterval(engagementTimerRef.current);
      }
    };
  }, [isActive, isPlaying, currentTrack?.id, currentIndex]);

  // Also show Continue button on any reaction (instant engagement)
  const markEngaged = useCallback(() => {
    if (!showContinueButton) {
      setShowContinueButton(true);
      devLog('[Feed] Reaction detected! Showing Continue Playing button');
    }
  }, [showContinueButton]);

  // Handle follow/unfollow artist (stored locally per user)
  const handleFollowArtist = useCallback((artistUsername: string) => {
    if (!dashId) return;
    const normalizedArtist = artistUsername.toLowerCase().replace(/\s+/g, '_');
    const isFollowing = followingList.has(normalizedArtist);

    // Update state
    const newFollowing = new Set(followingList);
    if (isFollowing) {
      newFollowing.delete(normalizedArtist);
    } else {
      newFollowing.add(normalizedArtist);
    }
    setFollowingList(newFollowing);

    // Persist to localStorage (artist follows are local, not in Command Center)
    try {
      localStorage.setItem(`voyo_artist_follows_${dashId}`, JSON.stringify([...newFollowing]));
    } catch (e) {
      // Revert on error
      setFollowingList(followingList);
      console.error('[Feed] Follow action failed:', e);
    }
  }, [dashId, followingList]);

  // Handle seek to hotspot
  const handleSeekToHotspot = useCallback((position: number) => {
    // position is 0-100 percentage
    const targetTime = (position / 100) * duration;
    seekTo(targetTime);
    devLog(`[Feed] Seeking to hotspot at ${position}% (${targetTime}s)`);
  }, [duration, seekTo]);

  // 🔥 INFINITE SCROLL - Discover more tracks when near end
  const discoverMoreTracks = useCallback(async (): Promise<void> => {
    // Prevent concurrent discoveries
    if (isDiscovering || discoveryQueueRef.current) return;

    const discoveryPromise: Promise<void> = (async (): Promise<void> => {
      setIsDiscovering(true);

    // Smart query selection: cycle through but with some randomization for variety
    const baseIndex = discoveryIndex % DISCOVERY_QUERIES.length;
    const randomOffset = Math.floor(Math.random() * 3); // Add 0-2 random offset
    const queryIndex = (baseIndex + randomOffset) % DISCOVERY_QUERIES.length;
    const query = DISCOVERY_QUERIES[queryIndex];

    devLog(`[Feed] 🔍 Discovering more tracks: "${query}" (query ${queryIndex + 1}/${DISCOVERY_QUERIES.length})`);

    try {
      // Search for playlists/albums matching query (get 5 for more options)
      const albums = await searchAlbums(query, 5);

      if (albums.length === 0) {
        devLog('[Feed] No albums found, trying next query...');
        setDiscoveryIndex(prev => prev + 1);
        setIsDiscovering(false);
        discoveryQueueRef.current = null;
        // Let the effect trigger retry on next scroll
        return;
      }

      // Try multiple albums to get enough tracks
      let totalAdded = 0;
      for (const album of albums) {
        if (totalAdded >= 15) break; // Got enough

        const pipedTracks = await getAlbumTracks(album.id);
        if (pipedTracks.length === 0) continue;

        // Filter out already discovered tracks
        const newTracks = pipedTracks.filter(pt => !discoveredIdsRef.current.has(pt.videoId));
        if (newTracks.length === 0) continue;

        // Convert to VOYO tracks and add to pool (up to 15 per album)
        const voyoTracks = newTracks.slice(0, 15).map(pt => {
          discoveredIdsRef.current.add(pt.videoId);
          return pipedTrackToVoyoTrack(pt, album.name);
        });

        // GATE: Validate each track before adding to pool
        const added = await safeAddManyToPool(voyoTracks, 'related');
        totalAdded += added;
        devLog(`[Feed] ✅ Added ${added}/${voyoTracks.length} validated tracks from "${album.name}"`);
      }

      if (totalAdded === 0) {
        devLog('[Feed] No new tracks found, trying next query...');
        setDiscoveryIndex(prev => prev + 1);
        setIsDiscovering(false);
        discoveryQueueRef.current = null;
        // Let the effect trigger retry on next scroll
        return;
      }

      devLog(`[Feed] 🎉 Total: ${totalAdded} new tracks added to pool`);

      // Move to next query for variety
      setDiscoveryIndex(prev => prev + 1);
    } catch (error) {
      console.error('[Feed] Discovery failed:', error);
      setDiscoveryIndex(prev => prev + 1);
    }

    setIsDiscovering(false);
    discoveryQueueRef.current = null;
    })();

    discoveryQueueRef.current = discoveryPromise;
    return discoveryPromise;
  }, [isDiscovering, discoveryIndex]);

  // Build feed from ALL tracks, boosted by reactions + For You algorithm
  const trackGroups = useMemo(() => {
    // Start with reaction data indexed by track
    const reactionsByTrack = new Map<string, {
      reactions: Reaction[];
      hotScore: number;
      categoryBoost: number;
      dominantCategory: string;
    }>();

    recentReactions.forEach(reaction => {
      const existing = reactionsByTrack.get(reaction.track_id);
      if (existing) {
        existing.reactions.push(reaction);
        existing.hotScore = existing.reactions.length;
        const categoryScore = getCategoryScore(reaction.category);
        if (categoryScore > existing.categoryBoost) {
          existing.categoryBoost = categoryScore;
          existing.dominantCategory = reaction.category;
        }
      } else {
        reactionsByTrack.set(reaction.track_id, {
          reactions: [reaction],
          hotScore: 1,
          categoryBoost: getCategoryScore(reaction.category),
          dominantCategory: reaction.category,
        });
      }
    });

    // Build feed from POOL (dynamic) — seed tracks only when pool is thin (<5 tracks)
    // Pool contains tracks user has searched/played, TRACKS is fallback for new users
    const poolTracks = hotPool.length > 0 ? hotPool : [];

    // Only mix in seed tracks if pool has fewer than 5 tracks
    const allTracks = poolTracks.length >= 5
      ? [...poolTracks].sort((a, b) => (b.poolScore || 0) - (a.poolScore || 0))
      : poolTracks.length > 0
        ? [...poolTracks.sort((a, b) => (b.poolScore || 0) - (a.poolScore || 0)), ...TRACKS.filter(t => !poolTracks.some(p => (p.trackId || p.id) === (t.trackId || t.id)))]
        : [...TRACKS];

    // Track all IDs globally to prevent duplicates across entire feed
    const allTrackIds = new Set<string>();

    const feedItems = allTracks.reduce<Array<any>>((items, track) => {
      // IMPORTANT: Use trackId (YouTube ID) first, not internal id
      const trackId = track.trackId || track.id || '';

      // Skip duplicates globally
      if (allTrackIds.has(trackId)) return items;
      allTrackIds.add(trackId);

      const reactionData = reactionsByTrack.get(trackId);
      const poolScore = 'poolScore' in track ? (track as any).poolScore : 0;

      // Get hotspots for this track
      const hotspots = getHotspots(trackId);
      const hottestSpot = hotspots.length > 0
        ? hotspots.reduce((a, b) => a.intensity > b.intensity ? a : b)
        : null;

      // Apply intelligent feed treatment (start time, duration)
      const treatedTrack = applyTreatment(track, hotspots);
      const startSeconds = getStartTime(treatedTrack);
      const durationSeconds = getDuration(treatedTrack);

      // Convert start seconds to percentage for backward compatibility
      const trackDuration = track.duration || 180;
      const hottestPosition = hottestSpot?.position || (startSeconds / trackDuration) * 100;

      // Debug logging disabled - was causing spam

      items.push({
        trackId,
        trackTitle: track.title,
        trackArtist: track.artist,
        // Use cached thumbnail URL from mediaCache if available
        trackThumbnail: track.coverUrl || mediaCache.getThumbnailUrl(trackId),
        reactions: reactionData?.reactions || [],
        nativeOyeScore: track.oyeScore || 0,
        hotScore: reactionData?.hotScore || 0,
        categoryBoost: reactionData?.categoryBoost || 50,
        dominantCategory: reactionData?.dominantCategory || 'afro-heat',
        poolScore, // Include pool score for sorting
        hottestPosition, // Position of hottest part (0-100) - now from feed algorithm
        feedStartSeconds: startSeconds, // NEW: Absolute start time
        feedDuration: durationSeconds, // NEW: How long to play
        feedTreatment: treatedTrack.feedMetadata?.treatment, // NEW: Treatment type
        feedReason: treatedTrack.feedMetadata?.reason, // NEW: Why this treatment
      });

      return items;
    }, []);

    // Filter by feed mode
    const filteredItems = feedMode === 'following'
      ? feedItems.filter(item => {
          // Check if artist is in following list
          const artistHandle = item.trackArtist.toLowerCase().replace(/\s+/g, '_');
          return followingList.has(artistHandle);
        })
      : feedItems;

    // Sort by FOR YOU score: pool score + reactions + category preference
    return filteredItems.sort((a, b) => {
      // Primary: Pool score (user behavior learned from search/play)
      const aPoolBoost = (a.poolScore || 0) / 10; // 0-10 from pool
      const bPoolBoost = (b.poolScore || 0) / 10;

      // Secondary: Has reactions vs doesn't
      const aHasReactions = a.hotScore > 0 ? 5 : 0;
      const bHasReactions = b.hotScore > 0 ? 5 : 0;

      // Tertiary: Category preference + hotness
      const aReactionScore = (a.categoryBoost / 100) * a.hotScore + a.hotScore;
      const bReactionScore = (b.categoryBoost / 100) * b.hotScore + b.hotScore;

      // Combined score
      const aScore = aPoolBoost + aHasReactions + aReactionScore;
      const bScore = bPoolBoost + bHasReactions + bReactionScore;

      if (bScore !== aScore) return bScore - aScore;

      // Quaternary: Stable sort by trackId for equal scores
      return a.trackId.localeCompare(b.trackId);
    });
  }, [recentReactions, getCategoryScore, hotPool, feedMode, followingList, getHotspots]);

  // 🔄 INFINITE SCROLL - Trigger discovery when near end of feed
  useEffect(() => {
    if (!isActive) return;

    const tracksRemaining = trackGroups.length - currentIndex;
    if (tracksRemaining <= DISCOVERY_THRESHOLD && !isDiscovering && trackGroups.length > 0) {
      devLog(`[Feed] Only ${tracksRemaining} tracks left, discovering more...`);
      discoverMoreTracks();
    }
  }, [currentIndex, trackGroups.length, isActive, isDiscovering, discoverMoreTracks]);

  // Cache feed content when tracks are built - batch cache for efficiency
  useEffect(() => {
    if (!isActive || trackGroups.length === 0) return;

    // Cache upcoming tracks (current + next 5)
    const upcomingTracks = trackGroups.slice(currentIndex, currentIndex + 6);

    // Batch cache feed content
    const contentToCache = upcomingTracks.map(group => ({
      track_id: group.trackId,
      title: group.trackTitle,
      artist: group.trackArtist,
      thumbnail_url: group.trackThumbnail || mediaCache.getThumbnailUrl(group.trackId),
      duration: null, // Duration comes from player
      source: 'youtube' as const,
    }));

    // Cache in background (non-blocking)
    feedContentService.cacheBatch(contentToCache).then(cached => {
      if (cached > 0) {
        devLog(`[FeedContent] Cached ${cached} tracks for feed`);
      }
    });

    // Pre-cache thumbnail URLs for upcoming cards using getBatch
    const trackIds = upcomingTracks.map(t => t.trackId);
    feedContentService.getBatch(trackIds).then(batchResult => {
      // The batch fetch populates the local cache for quick thumbnail access
      if (batchResult.size > 0) {
        devLog(`[FeedContent] Pre-fetched ${batchResult.size} cached thumbnails`);
      }
    });
  }, [currentIndex, isActive, trackGroups]);

  // 🔥 SMART MEDIA CACHING - Pre-cache next 3 tracks, keep last 5 in memory
  useEffect(() => {
    if (!isActive || trackGroups.length === 0) return;

    // Get all track IDs for cache management
    const trackIds = trackGroups.map(g => g.trackId);

    // Pre-cache upcoming tracks (audio + thumbnails)
    mediaCache.precacheAhead(trackIds, currentIndex, {
      audio: true,
      thumbnail: true,
      video: false, // Video iframes load on-demand
    });

    // Log cache stats periodically
    if (currentIndex % 5 === 0) {
      const stats = mediaCache.getStats();
      devLog(`[MediaCache] Stats: ${stats.totalItems} items, ${(stats.hitRate * 100).toFixed(1)}% hit rate`);
    }
  }, [currentIndex, isActive, trackGroups]);

  // Auto-advance to next card (called when snippet ends)
  const handleSnippetEnd = useCallback(() => {
    if (!containerRef.current) return;

    const nextIndex = currentIndex + 1;
    if (nextIndex < trackGroups.length) {
      // Scroll to next card
      const itemHeight = containerRef.current.clientHeight;
      containerRef.current.scrollTo({
        top: nextIndex * itemHeight,
        behavior: 'smooth',
      });
      setCurrentIndex(nextIndex);
      devLog(`[Feed] Auto-advancing to card ${nextIndex + 1}/${trackGroups.length}`);
    } else {
      // At end of feed - could loop or stop
      devLog('[Feed] Reached end of feed');
    }
  }, [currentIndex, trackGroups.length]);

  // Handle scroll snap - debounced to prevent jank
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = () => {
    if (!containerRef.current) return;

    // Debounce scroll events
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
    }

    scrollDebounceRef.current = setTimeout(() => {
      if (!containerRef.current) return;
      const scrollTop = containerRef.current.scrollTop;
      const itemHeight = containerRef.current.clientHeight;
      const newIndex = Math.round(scrollTop / itemHeight);
      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < trackGroups.length) {
        setCurrentIndex(newIndex);
      }
    }, 50); // 50ms debounce
  };

  // Track engagement when card becomes active - update access time for caching
  useEffect(() => {
    if (!isActive || trackGroups.length === 0) return;

    const activeTrack = trackGroups[currentIndex];
    if (activeTrack?.trackId) {
      // Update access time for engagement tracking
      updateAccessTime(activeTrack.trackId);
    }
  }, [currentIndex, isActive, trackGroups]);

  // Handle play - SIMPLE & CLEAN: Just update track state
  // VideoSnippet handles video + audio (native YouTube, no AudioPlayer)
  const handlePlay = useCallback((trackId: string, trackTitle: string, trackArtist: string) => {
    // Check pool first (dynamic tracks from search/play)
    const poolTrack = hotPool.find(t => t.id === trackId || t.trackId === trackId);
    if (poolTrack) {
      setCurrentTrack(poolTrack);
      return;
    }

    // Check seed tracks
    const seedTrack = TRACKS.find(t => t.id === trackId || t.trackId === trackId);
    if (seedTrack) {
      setCurrentTrack(seedTrack);
      return;
    }

    // Fallback: create minimal track object
    setCurrentTrack({
      id: trackId,
      trackId: trackId,
      title: trackTitle,
      artist: trackArtist,
      coverUrl: `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${trackId}?quality=high`,
      duration: 0,
      tags: [],
      oyeScore: 0,
      createdAt: new Date().toISOString(),
    });
    // NO togglePlay() - VideoSnippet handles audio natively
  }, [setCurrentTrack, hotPool]);

  // Handle reaction - with track position for hotspot detection
  const handleReact = useCallback((trackId: string, trackTitle: string, trackArtist: string, type: ReactionType) => {
    // Get current playback position for hotspot tracking
    const trackPosition = currentTrack?.id === trackId || currentTrack?.trackId === trackId
      ? Math.round(progress) // 0-100 percentage
      : undefined;

    createReaction({
      username: dashId || 'anonymous',
      trackId,
      trackTitle,
      trackArtist,
      trackThumbnail: `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${trackId}?quality=high`,
      category: 'afro-heat', // Default category
      reactionType: type,
      trackPosition, // Where in the song the reaction happened
    });

    devLog(`[Feed] Reaction ${type} at position ${trackPosition}% on ${trackTitle}`);
  }, [createReaction, currentTrack, progress, dashId]);

  // Handle add comment - with track position
  const handleAddComment = useCallback((trackId: string, trackTitle: string, trackArtist: string, text: string) => {
    const trackPosition = currentTrack?.id === trackId || currentTrack?.trackId === trackId
      ? Math.round(progress)
      : undefined;

    createReaction({
      username: dashId || 'anonymous',
      trackId,
      trackTitle,
      trackArtist,
      trackThumbnail: `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${trackId}?quality=high`,
      category: 'afro-heat',
      emoji: text.length <= 30 ? '📍' : '💬', // Punch if short
      comment: text,
      trackPosition,
    });
  }, [createReaction, currentTrack, progress, dashId]);

  // Handle share - use Web Share API if available
  const handleShare = useCallback((trackId: string, trackTitle: string, trackArtist: string) => {
    const shareData = {
      title: trackTitle,
      text: `🎵 ${trackTitle} by ${trackArtist} on VOYO Music`,
      url: `https://voyomusic.com/?track=${trackId}`,
    };

    if (navigator.share) {
      navigator.share(shareData).catch(() => {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(shareData.url);
      });
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(shareData.url);
    }
  }, []);

  if (!isActive) return null;

  // Empty state - different for Following vs For You
  if (trackGroups.length === 0) {
    const isFollowingEmpty = feedMode === 'following';
    return (
      <div
        className="absolute inset-0 bg-black flex flex-col items-center justify-center px-8"
      >
        {/* Tab buttons still visible */}
        <div className="absolute top-4 left-0 right-0 z-30">
          <div className="flex items-center justify-center gap-6">
            <button
              className={`text-base font-semibold transition-all ${
                feedMode === 'following' ? 'text-white font-bold border-b-2 border-white pb-0.5' : 'text-white/50'
              }`}
              onClick={() => setFeedMode('following')}
            >
              Following
            </button>
            <button
              className={`text-base font-semibold transition-all ${
                feedMode === 'forYou' ? 'text-white font-bold border-b-2 border-white pb-0.5' : 'text-white/50'
              }`}
              onClick={() => setFeedMode('forYou')}
            >
              For You
            </button>
          </div>
        </div>

        <div className="w-24 h-24 rounded-full bg-purple-500/20 flex items-center justify-center mb-4">
          {isFollowingEmpty ? (
            <UserPlus className="w-12 h-12 text-purple-400" />
          ) : (
            <Zap className="w-12 h-12 text-purple-400" />
          )}
        </div>
        <h3 className="text-white font-bold text-xl mb-2">
          {isFollowingEmpty ? 'No Artists Followed' : 'No Vibes Yet'}
        </h3>
        <p className="text-white/50 text-sm text-center mb-4">
          {isFollowingEmpty
            ? 'Follow artists to see their tracks in your Following feed!'
            : 'Start playing music and react to fill your feed with community vibes!'}
        </p>
        {isFollowingEmpty && (
          <button
            className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-violet-600 text-white font-bold"
            onClick={() => setFeedMode('forYou')}
          >
            Discover Artists
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 bg-transparent"
    >
      {/* Floating Reactions Layer - TikTok Live style bubbles */}
      <FloatingReactions isActive={isActive} />

      {/* Snap Scroll Container */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-scroll snap-y snap-mandatory scrollbar-hide"
        onScroll={handleScroll}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {/* Preload next 2-3 cards for smooth scrolling */}
        {trackGroups.map((group, index) => {
          const isThisTrack = currentTrack?.trackId === group.trackId || currentTrack?.id === group.trackId;
          const cardIsActive = isActive && index === currentIndex;
          const isNextCard = index === currentIndex + 1 || index === currentIndex + 2; // Preload next 2
          const artistHandle = group.trackArtist.toLowerCase().replace(/\s+/g, '_');
          return (
            <div key={group.trackId} className="h-full w-full snap-start snap-always">
              <FeedCard
                trackId={group.trackId}
                trackTitle={group.trackTitle}
                trackArtist={group.trackArtist}
                trackThumbnail={group.trackThumbnail}
                reactions={group.reactions}
                nativeOyeScore={group.nativeOyeScore}
                hottestPosition={group.hottestPosition}
                snippetDuration={snippetConfig.duration}
                snippetMode={snippetMode}
                isActive={cardIsActive}
                isPlaying={isPlaying && isThisTrack}
                isThisTrack={isThisTrack}
                shouldPreload={isNextCard}
                isFollowingArtist={followingList.has(artistHandle)}
                onPlay={() => handlePlay(group.trackId, group.trackTitle, group.trackArtist)}
                onTogglePlay={togglePlay}
                onReact={(type) => handleReact(group.trackId, group.trackTitle, group.trackArtist, type)}
                onAddComment={(text) => handleAddComment(group.trackId, group.trackTitle, group.trackArtist, text)}
                onAddToLibrary={() => {
                  // OYÉ = Add to library (queue) + boost for offline + record reaction
                  const poolTrack = hotPool.find(t => t.id === group.trackId || t.trackId === group.trackId);
                  const seedTrack = TRACKS.find(t => t.id === group.trackId || t.trackId === group.trackId);
                  const track = poolTrack || seedTrack;
                  if (track) {
                    addToQueue(track);
                    // Also record reaction for the OYÉ
                    handleReact(group.trackId, group.trackTitle, group.trackArtist, 'oye');
                    // Record reaction in pool for scoring
                    recordReaction(group.trackId);
                    // BOOST: Download track for offline playback
                    boostTrack(
                      group.trackId,
                      group.trackTitle,
                      group.trackArtist,
                      track.duration || 180,
                      group.trackThumbnail || ''
                    );
                  }
                }}
                onAddToPlaylist={() => {
                  // + button = Add to queue
                  const poolTrack = hotPool.find(t => t.id === group.trackId || t.trackId === group.trackId);
                  const seedTrack = TRACKS.find(t => t.id === group.trackId || t.trackId === group.trackId);
                  const track = poolTrack || seedTrack;
                  if (track) addToQueue(track);
                }}
                onShare={() => handleShare(group.trackId, group.trackTitle, group.trackArtist)}
                onSeekToHotspot={handleSeekToHotspot}
                onFollowArtist={() => handleFollowArtist(group.trackArtist)}
                onSnippetEnd={handleSnippetEnd}
                onDoubleTapReaction={() => {
                  // Double-tap also adds to library + boosts
                  const poolTrack = hotPool.find(t => t.id === group.trackId || t.trackId === group.trackId);
                  const seedTrack = TRACKS.find(t => t.id === group.trackId || t.trackId === group.trackId);
                  const track = poolTrack || seedTrack;
                  if (track) {
                    addToQueue(track);
                    recordReaction(group.trackId);
                    // BOOST: Download track for offline playback
                    boostTrack(
                      group.trackId,
                      group.trackTitle,
                      group.trackArtist,
                      track.duration || 180,
                      group.trackThumbnail || ''
                    );
                  }
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Top Navigation - Following | For You */}
      <div className="absolute top-4 left-0 right-0 z-30">
        <div className="flex items-center justify-center gap-6">
          <button
            className={`text-base font-semibold transition-all ${
              feedMode === 'following'
                ? 'text-white font-bold border-b-2 border-white pb-0.5'
                : 'text-white/50'
            }`}
            onClick={() => {
              setFeedMode('following');
              setCurrentIndex(0);
            }}
          >
            Following
            {followingList.size > 0 && (
              <span className="ml-1 text-xs text-purple-400">({followingList.size})</span>
            )}
          </button>
          <button
            className={`text-base font-semibold transition-all ${
              feedMode === 'forYou'
                ? 'text-white font-bold border-b-2 border-white pb-0.5'
                : 'text-white/50'
            }`}
            onClick={() => {
              setFeedMode('forYou');
              setCurrentIndex(0);
            }}
          >
            For You
          </button>
        </div>
        {/* Mute button */}
        <div className="absolute right-4 top-0">
          <button
            className="active:scale-90 transition-transform min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={volume > 0 ? 'Mute' : 'Unmute'}
            onClick={() => setVolume(volume > 0 ? 0 : 80)}
          >
            {volume > 0 ? (
              <Volume2 className="w-5 h-5 text-white/70" />
            ) : (
              <VolumeX className="w-5 h-5 text-white/70" />
            )}
          </button>
        </div>
      </div>

      {/* Scroll indicator - subtle, no animation */}
      {trackGroups.length > 1 && currentIndex < trackGroups.length - 1 && !isDiscovering && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <ChevronDown className="w-5 h-5 text-white/30" />
        </div>
      )}

      {/* Discovery loading indicator */}
      {isDiscovering && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/80 backdrop-blur-sm"
        >
          <div
            className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white"
          />
          <span className="text-white text-xs font-medium">Discovering...</span>
        </div>
      )}

      {/* ContinuePlayingButton removed - VOYO nav button handles "Keep Playing" prompt */}
    </div>
  );
};

export default VoyoVerticalFeed;
