/**
 * VOYO Music - Premium Now Playing Experience
 * Clean audio player with Voyo Feed integration
 *
 * Features:
 * - ALBUM ART BACKGROUND: Blurred cover art
 * - COMPACT CONTROLS: Bottom panel with all controls
 * - VOYO FEED BUTTON: Opens full video feed experience
 * - COMMUNITY VIBES: Collapsible comments section
 * - VOYO GRADIENT: Purple/pink design language
 *
 * The Loop: Player → Voyo Feed → Discover → Player
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { devLog } from '../../utils/logger';
import {
  ChevronDown,
  Heart,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  MessageCircle,
  ChevronUp,
  Send,
  User,
  Plus,
  X,
  Share2,
  ListMusic,
  Lightbulb,
  Video,
  Image
} from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { oyo, app } from '../../services/oyo';
import { usePreferenceStore } from '../../store/preferenceStore';
import { getTrackThumbnailUrl } from '../../utils/thumbnail';
import { useMobilePlay } from '../../hooks/useMobilePlay';
import { useBackGuard } from '../../hooks/useBackGuard';
import { PlaylistModal } from '../playlist/PlaylistModal';
import { VoyoCloseX } from '../ui/VoyoCloseX';
import { useReactionStore, Reaction, TrackStats } from '../../store/reactionStore';
import { OyeButton } from '../oye/OyeButton';
import { useAuth } from '../../hooks/useAuth';

// ============================================
// ALBUM ART BACKGROUND
// ============================================
const AlbumArtBackground = ({ coverUrl }: { coverUrl: string }) => (
  <div className="absolute inset-0 overflow-hidden">
    <img
      src={coverUrl}
      alt=""
      loading="lazy"
      decoding="async"
      aria-hidden="true"
      className="absolute w-full h-full object-cover scale-110 blur-md"
    />
    {/* Gradient overlay for depth */}
    <div className="absolute inset-0 bg-black/50" />
  </div>
);


// ============================================
// FLOATING REACTIONS
// ============================================
interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
  xOffset: number;
}

const FloatingReactions = ({ reactions }: { reactions: FloatingReaction[] }) => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
    <>
      {reactions.map((reaction) => (
        <div
          key={reaction.id}
          className="absolute text-4xl"
          style={{ left: `${reaction.x}%`, bottom: '30%' }}

        >
          <span className="drop-shadow-2xl">{reaction.emoji}</span>
        </div>
      ))}
    </>
  </div>
);

// ============================================
// COMMUNITY VIBES PANEL (Replaces Explore)
// ============================================
const CommunityVibesPanel = ({
  isExpanded,
  onToggle,
  reactions,
  onAddComment,
  trackStats,
  dashId,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  reactions: Reaction[];
  onAddComment: (text: string) => void;
  trackStats: TrackStats | null;
  dashId: string | null;
}) => {
  const [commentText, setCommentText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSubmit = () => {
    if (commentText.trim()) {
      onAddComment(commentText.trim());
      setCommentText('');
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  // Fallback comments
  const fallbackComments = [
    { user: 'burna_fan', text: 'This track is FIRE 🔥🔥🔥', time: '2m' },
    { user: 'afrovibes', text: 'OYÉ OYÉ OYÉ!!! ⚡', time: '5m' },
    { user: 'dashfam', text: 'On repeat all day 🔂', time: '12m' },
    { user: 'music_lover', text: 'Best afrobeats this year 💜', time: '1h' },
  ];

  return (
    <div
      className="bg-black/90 backdrop-blur-xl rounded-t-3xl border-t border-white/10"
    >
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-5 py-4"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-[#D4A053] flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className="text-white font-bold text-sm">Community Vibes</p>
            <p className="text-white/50 text-xs">
              {trackStats?.total_reactions || reactions.length || 0} vibing now
            </p>
          </div>
        </div>
        <div
        >
          <ChevronUp className="w-5 h-5 text-white/50" />
        </div>
      </button>

      {/* Expanded Content */}
      <>
        {isExpanded && (
          <div
            className="px-5 pb-4"
          >
            {/* Comments List */}
            <div ref={scrollRef} className="space-y-3 max-h-[180px] overflow-y-auto scrollbar-hide mb-4">
              {reactions.length > 0 ? (
                reactions.slice(-10).map((reaction) => (
                  <div key={reaction.id} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-400 text-xs font-bold">@{reaction.username}</span>
                        <span className="text-white/30 text-[10px]">{timeAgo(reaction.created_at)}</span>
                      </div>
                      <p className="text-white/80 text-sm">
                        {reaction.emoji} {reaction.comment || 'sent a vibe'}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                fallbackComments.map((comment, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-400 text-xs font-bold">@{comment.user}</span>
                        <span className="text-white/30 text-[10px]">{comment.time}</span>
                      </div>
                      <p className="text-white/80 text-sm">{comment.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Drop a vibe..."
                className="flex-1 bg-white/10 rounded-full px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
              <button
                className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-[#D4A053] flex items-center justify-center"
                onClick={handleSubmit}
              >
                <Send className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        )}
      </>
    </div>
  );
};

// ============================================
// MAIN NOW PLAYING COMPONENT
// ============================================
interface NowPlayingProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NowPlaying = ({ isOpen, onClose }: NowPlayingProps) => {
  // Back-gesture coverage — system back / browser back / Android back closes
  // the modal instead of exiting the app. Matches PlaylistModal /
  // DiscoExplainer / SearchOverlayV2 pattern.
  useBackGuard(isOpen, onClose, 'now-playing');

  // Fine-grained selectors — avoid re-rendering on unrelated store changes
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const progress = usePlayerStore(s => s.progress);
  const duration = usePlayerStore(s => s.duration);
  const oyePrewarm = usePlayerStore(s => s.oyePrewarm);
  const setOyePrewarm = usePlayerStore(s => s.setOyePrewarm);
  const nextTrack = usePlayerStore(s => s.nextTrack);
  const prevTrack = usePlayerStore(s => s.prevTrack);
  const seekTo = usePlayerStore(s => s.seekTo);
  const queue = usePlayerStore(s => s.queue);
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue);
  const videoTarget = usePlayerStore(s => s.videoTarget);
  const setVideoTarget = usePlayerStore(s => s.setVideoTarget);

  // Get current track position for hotspot detection
  const trackPosition = Math.round(progress); // 0-100 percentage
  const { handlePlayPause } = useMobilePlay();

  // Only subscribe to the specific preference field we actually read
  const explicitLike = usePreferenceStore(
    s => (currentTrack ? s.trackPreferences[currentTrack.trackId]?.explicitLike : undefined)
  );
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);
  const isLiked = explicitLike === true;

  const createReaction = useReactionStore(s => s.createReaction);
  const fetchTrackReactions = useReactionStore(s => s.fetchTrackReactions);
  const fetchTrackStats = useReactionStore(s => s.fetchTrackStats);
  const trackReactions = useReactionStore(s => s.trackReactions);
  const statsMap = useReactionStore(s => s.trackStats);
  const { dashId } = useAuth();

  // State
  // Shuffle + repeat wire directly to the playerStore — ClassicMode +
  // VoyoPortraitPlayer already use this pattern. Prior bug: NowPlaying
  // kept its own `useState` copies, so taps here updated icon color but
  // the store's shuffleMode / repeatMode stayed at their defaults →
  // nextTrack() never saw the user's intent. Observed in production as
  // "repeat button does nothing" + "background loops same song because
  // repeat-off can't be enabled from this surface".
  const shuffleMode    = usePlayerStore(s => s.shuffleMode);
  const repeatMode     = usePlayerStore(s => s.repeatMode);
  const toggleShuffle  = usePlayerStore(s => s.toggleShuffle);
  const cycleRepeat    = usePlayerStore(s => s.cycleRepeat);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [isVibesExpanded, setIsVibesExpanded] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  // Video mode now uses global videoTarget from playerStore (no local state)

  // Reactions data
  const currentTrackId = currentTrack?.id || '';
  const realReactions = trackReactions.get(currentTrackId) || [];
  const currentTrackStats = statsMap.get(currentTrackId) || null;

  // Fetch reactions
  useEffect(() => {
    if (currentTrack && isOpen) {
      fetchTrackReactions(currentTrack.id);
      fetchTrackStats(currentTrack.id);
    }
  }, [currentTrack?.id, isOpen, fetchTrackReactions, fetchTrackStats]);

  // Reset videoTarget to hidden when NowPlaying closes
  useEffect(() => {
    if (!isOpen && videoTarget === 'portrait') {
      setVideoTarget('hidden');
    }
  }, [isOpen, videoTarget, setVideoTarget]);

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentTime = (progress / 100) * duration;

  // Handle floating reaction
  const spawnReaction = useCallback((emoji: string) => {
    const id = Date.now() + Math.random();
    const x = 20 + Math.random() * 60;
    const xOffset = (Math.random() - 0.5) * 100;

    setFloatingReactions(prev => [...prev, { id, emoji, x, xOffset }]);
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id));
    }, 3000);
  }, []);

  // Handle comment
  const handleAddComment = useCallback(async (text: string) => {
    if (!currentTrack) return;
    spawnReaction('🔥');
    await createReaction({
      username: dashId || 'anonymous',
      trackId: currentTrack.id,
      trackTitle: currentTrack.title,
      trackArtist: currentTrack.artist,
      trackThumbnail: currentTrack.coverUrl,
      category: 'afro-heat',
      emoji: '💬',
      reactionType: 'oye',
      comment: text,
      trackPosition, // Include position for hotspot detection
    });
  }, [currentTrack, dashId, createReaction, spawnReaction, trackPosition]);

  // Auto-spawn ambient reactions — only while NowPlaying is open, playing,
  // AND the tab is visible. In BG we were burning setInterval + state
  // updates on invisible floating emojis; now the whole interval stops
  // when the tab hides and resumes when it's back.
  useEffect(() => {
    if (!isPlaying || !isOpen) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval != null) return;
      interval = setInterval(() => {
        const emojis = ['🔥', '⚡', '💜', '🎵', '✨'];
        spawnReaction(emojis[Math.floor(Math.random() * emojis.length)]);
      }, 4000 + Math.random() * 3000);
    };
    const stop = () => {
      if (interval != null) { clearInterval(interval); interval = null; }
    };
    if (!document.hidden) start();
    const onVis = () => { document.hidden ? stop() : start(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [isPlaying, isOpen, spawnReaction]);

  // Handle Share button
  const handleShare = useCallback(async () => {
    if (!currentTrack) return;

    const shareData = {
      title: currentTrack.title,
      text: `Check out "${currentTrack.title}" by ${currentTrack.artist} on VOYO Music`,
      url: window.location.href,
    };

    try {
      // Try Web Share API first
      if (navigator.share) {
        await navigator.share(shareData);
        spawnReaction('🔗');
      } else {
        // Fallback to clipboard
        const shareText = `${shareData.text}\n${shareData.url}`;
        await navigator.clipboard.writeText(shareText);
        setShareToast(true);
        spawnReaction('📋');
        setTimeout(() => setShareToast(false), 2000);
      }
    } catch (error) {
      // User cancelled or error occurred
      devLog('Share cancelled or failed:', error);
    }
  }, [currentTrack, spawnReaction]);

  // Handle Queue button
  const handleQueue = useCallback(() => {
    setShowQueue(!showQueue);
    spawnReaction('🎵');
  }, [showQueue, spawnReaction]);

  if (!currentTrack) return null;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black flex flex-col"
        >
          {/* BACKGROUND - Album Art (Video uses global YouTubeIframe via videoTarget) */}
          {videoTarget !== 'portrait' && (
            <AlbumArtBackground coverUrl={getTrackThumbnailUrl(currentTrack, 'max')} />
          )}
          {/* When videoTarget === 'portrait', the global YouTubeIframe renders here */}

          {/* VIDEO TOGGLE - Left side vertical toggle */}
          <div
            className="absolute left-3 top-1/2 -translate-y-1/2 z-40"
          >
            <button
              className={`flex flex-col items-center gap-2 px-2 py-3 rounded-full backdrop-blur-xl border transition-all duration-300 ${
                videoTarget === 'portrait'
                  ? 'bg-purple-500/30 border-purple-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/20'
              }`}
              onClick={() => setVideoTarget(videoTarget === 'portrait' ? 'hidden' : 'portrait')}
            >
              {videoTarget === 'portrait' ? (
                <Image className="w-4 h-4 text-white" />
              ) : (
                <Video className="w-4 h-4 text-white" />
              )}
              <span
                className="text-[9px] text-white/80 font-medium"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {videoTarget === 'portrait' ? 'ART' : 'VIDEO'}
              </span>
            </button>
          </div>

          {/* GRADIENT OVERLAYS - Black Contour Style */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-transparent z-10 pointer-events-none" />

          {/* FLOATING REACTIONS */}
          <FloatingReactions reactions={floatingReactions} />

          {/* MAIN CONTENT */}
          <div className="relative z-30 flex flex-col h-full">
            {/* TOP BAR */}
            <div className="flex items-center justify-between px-4 py-4">
              <button
                className="p-2"
                onClick={onClose}
              >
                <ChevronDown className="w-7 h-7 text-white" />
              </button>
              <div className="text-center">
                <p className="text-white/50 text-xs uppercase tracking-wider">Playing from playlist</p>
                <p className="text-white text-sm font-medium">{currentTrack.album || 'Your Library'}</p>
              </div>
              <div className="w-11" /> {/* Spacer */}
            </div>

            {/* SPACER - Push content to bottom */}
            <div className="flex-1" />


            {/* TRACK INFO ROW */}
            <div className="flex items-center gap-4 px-4 mb-3">
              {/* Album Art */}
              <div className="w-14 h-14 rounded-lg overflow-hidden shadow-xl ring-1 ring-white/10">
                <img
                  src={getTrackThumbnailUrl(currentTrack, 'medium')}
                  alt={currentTrack.title}
                  decoding="async"
                  fetchPriority="high"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Title & Artist */}
              <div className="flex-1 min-w-0">
                <h2 className="text-white font-bold text-lg truncate">{currentTrack.title}</h2>
                <p className="text-white/60 text-sm truncate">{currentTrack.artist}</p>
              </div>

              {/* Action Buttons */}
              {/* LIKE — Heart icon reflects isLiked (pink fill when liked,
                  faint outline otherwise). Prior bug: rendered <X />, users
                  mistook it for "close" and silently corrupted their like
                  graph tapping to dismiss. Pattern mirrors VideoMode.tsx. */}
              <button
                className="p-2"
                onClick={() => currentTrack && setExplicitLike(currentTrack.trackId, !isLiked)}
                aria-label={isLiked ? 'Unlike' : 'Like'}
              >
                <Heart
                  className="w-6 h-6"
                  style={{
                    color: isLiked ? '#f472b6' : 'rgba(255,255,255,0.6)',
                    fill: isLiked ? '#f472b6' : 'none',
                  }}
                />
              </button>
              <button
                className="p-2"
                onClick={() => setShowPlaylistModal(true)}
              >
                <Plus className="w-6 h-6 text-white" strokeWidth={2.5} />
              </button>
            </div>

            {/* PROGRESS BAR */}
            <div className="px-4 mb-2">
              <div
                className="relative h-1 bg-white/20 rounded-full cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = ((e.clientX - rect.left) / rect.width) * 100;
                  seekTo((percent / 100) * duration);
                }}
              >
                <div
                  className="absolute left-0 top-0 h-full bg-white rounded-full"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg"
                  style={{ left: `${progress}%`, marginLeft: '-6px' }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-white/50">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* MAIN CONTROLS */}
            <div className="flex items-center justify-between px-6 py-4">
              <button
                className={shuffleMode ? 'text-purple-400' : 'text-white/60'}
                onClick={toggleShuffle}
                aria-label={shuffleMode ? 'Disable shuffle' : 'Enable shuffle'}
              >
                <Shuffle className="w-6 h-6" />
              </button>

              <button
                className="text-white"
                onClick={prevTrack}
              >
                <SkipBack className="w-8 h-8" fill="white" />
              </button>

              <button
                className="w-16 h-16 rounded-full bg-white flex items-center justify-center"
                onClick={handlePlayPause}
              >
                {isPlaying ? (
                  <Pause className="w-8 h-8 text-black" fill="black" />
                ) : (
                  <Play className="w-8 h-8 text-black ml-1" fill="black" />
                )}
              </button>

              <button
                className="text-white"
                onClick={nextTrack}
              >
                <SkipForward className="w-8 h-8" fill="white" />
              </button>

              <button
                className={repeatMode !== 'off' ? 'text-purple-400' : 'text-white/60'}
                onClick={cycleRepeat}
                aria-label={
                  repeatMode === 'off'
                    ? 'Enable repeat'
                    : repeatMode === 'one'
                      ? 'Repeat one — click to disable'
                      : 'Repeat all — click for repeat one'
                }
              >
                <Repeat className="w-6 h-6" />
              </button>
            </div>

            {/* SECONDARY CONTROLS */}
            <div className="flex items-center justify-between px-6 py-2">
              {/* OYÉ Button — unified four-state visual. Replaces the prior
                  purple pill so state (purple faded → bubbling → gold faded
                  → gold filled) is legible here the same way it is on every
                  card, mini-player, and search row. */}
              {currentTrack && <OyeButton track={currentTrack} size="lg" />}

              {/* OYÉ Lightning Bulb — predictive pre-warm toggle. Glows when on
                  (workers warm N+1/N+2 ahead), dim when off (reactive only). */}
              <button
                onClick={() => setOyePrewarm(!oyePrewarm)}
                aria-label={oyePrewarm ? 'OYÉ bulb on — pre-warming' : 'OYÉ bulb off — reactive'}
                title={oyePrewarm ? 'Bulb ON — next tracks pre-loading' : 'Bulb OFF — load on demand'}
                className="flex items-center justify-center w-10 h-10 rounded-full transition-all"
                style={{
                  background: oyePrewarm ? 'rgba(253,224,71,0.15)' : 'rgba(255,255,255,0.05)',
                  border: oyePrewarm ? '1px solid rgba(253,224,71,0.5)' : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: oyePrewarm ? '0 0 12px rgba(253,224,71,0.35)' : 'none',
                }}
              >
                <Lightbulb
                  className="w-4 h-4 transition-all"
                  style={{
                    color: oyePrewarm ? '#fde047' : 'rgba(255,255,255,0.45)',
                    fill:  oyePrewarm ? 'rgba(253,224,71,0.35)' : 'none',
                  }}
                />
              </button>

              {/* Right buttons */}
              <div className="flex items-center gap-4">
                <button
                  className="text-white/60 hover:text-white"
                  onClick={handleShare}
                >
                  <Share2 className="w-5 h-5" />
                </button>
                <button
                  className={showQueue ? 'text-purple-400' : 'text-white/60 hover:text-white'}
                  onClick={handleQueue}
                >
                  <ListMusic className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* COMMUNITY VIBES PANEL */}
            <CommunityVibesPanel
              isExpanded={isVibesExpanded}
              onToggle={() => setIsVibesExpanded(!isVibesExpanded)}
              reactions={realReactions}
              onAddComment={handleAddComment}
              trackStats={currentTrackStats}
              dashId={dashId}
            />
          </div>

          {/* QUEUE PANEL */}
          <>
            {showQueue && (
              <div
                className="absolute inset-0 bg-black/95 backdrop-blur-xl z-40 flex flex-col"
              >
                {/* Queue Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-[#D4A053] flex items-center justify-center">
                      <ListMusic className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-white font-bold text-base">Up Next</p>
                      <p className="text-white/50 text-xs">{queue.length} tracks in bucket</p>
                    </div>
                  </div>
                  <VoyoCloseX onClose={() => setShowQueue(false)} size="md" />
                </div>

                {/* Queue List */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                  {queue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                      <ListMusic className="w-16 h-16 text-white/20 mb-4" />
                      <p className="text-white/50 text-lg font-medium mb-2">Bucket is empty</p>
                      <p className="text-white/30 text-sm">Add tracks to fill your bucket</p>
                    </div>
                  ) : (
                    queue.map((item, index) => (
                      <div
                        key={item.track.id + index}
                        className="flex items-center gap-3 bg-white/5 rounded-lg p-3 hover:bg-white/10 transition-colors"
                      >
                        {/* Track Number */}
                        <span className="text-white/40 text-sm font-bold w-6 text-center">
                          {index + 1}
                        </span>

                        {/* Album Art */}
                        <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0">
                          <img
                            src={getTrackThumbnailUrl(item.track, 'default')}
                            alt={item.track.title}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        </div>

                        {/* Track Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">
                            {item.track.title}
                          </p>
                          <p className="text-white/50 text-xs truncate">
                            {item.track.artist}
                          </p>
                        </div>

                        {/* Remove Button */}
                        <button
                          className="p-2 text-white/40 hover:text-red-400"
                          onClick={() => removeFromQueue(index)}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>

          {/* SHARE TOAST */}
          <>
            {shareToast && (
              <div
                className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-white/10 backdrop-blur-xl rounded-full px-6 py-3 flex items-center gap-2"
              >
                <Share2 className="w-4 h-4 text-white" />
                <span className="text-white text-sm font-medium">Copied to clipboard</span>
              </div>
            )}
          </>

          {/* Playlist Modal */}
          <PlaylistModal
            isOpen={showPlaylistModal}
            onClose={() => setShowPlaylistModal(false)}
            trackId={currentTrack.trackId}
            trackTitle={currentTrack.title}
          />
        </div>
      )}
    </>
  );
};

export default NowPlaying;
