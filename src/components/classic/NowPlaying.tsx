/**
 * VOYO Music — NowPlaying (Expanded MiniPlayer canvas)
 *
 * Opened by double-tapping the MiniPlayer in Classic Home. This is the
 * "expanded MiniPlayer" — same chrome at the bottom (so controls never
 * relocate), surrounded by a vibes canvas:
 *
 *   - Backdrop: blurred album art + drifting bokeh of related tracks
 *   - Floating ambient reactions
 *   - Track title (auto-positioned: slides up when comments expand)
 *   - Up Next strip (3 next tracks, hidden when comments expand)
 *   - Comments overlay (transparent, VOYO Moments style, with expand button)
 *   - MiniPlayer chrome at bottom (imported, identical to Home)
 *
 * v934 redesign: stripped Shuffle / Repeat / SkipBack / SkipForward / big
 * Play-Pause / oyePrewarm Lightbulb / inline progress bar / Heart / Plus
 * — all duplicated either in the MiniPlayer chrome (controls + OYÉ +
 * Plus + seek) or in VOYO Portrait. NowPlaying is now a vibes/community
 * surface around the music, not another control panel.
 *
 * Double-tap on the MiniPlayer here → switches to VOYO Portrait. Each
 * tap-deeper goes one layer further into the experience:
 *   ClassicMode (mini)  →  NowPlaying (canvas)  →  VOYO (portrait)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { devLog } from '../../utils/logger';
import {
  ChevronDown,
  MessageCircle,
  Maximize2,
  Minimize2,
  Send,
  User,
  X,
  Share2,
  ListMusic,
  Video,
  Image as ImageIcon,
} from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { useShallow } from 'zustand/shallow';
import { getTrackThumbnailUrl } from '../../utils/thumbnail';
import { getYouTubeThumbnail } from '../../data/tracks';
import { useBackGuard } from '../../hooks/useBackGuard';
import { VoyoCloseX } from '../ui/VoyoCloseX';
import { useReactionStore, Reaction, TrackStats } from '../../store/reactionStore';
import { useAuth } from '../../hooks/useAuth';
import { Track } from '../../types';
import { MiniPlayer } from './MiniPlayer';

// ============================================
// ALBUM ART BACKGROUND (blurred cover, dark gradient)
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
    <div className="absolute inset-0 bg-black/55" />
  </div>
);

// ============================================
// BOKEH LAYER — related tracks drifting as soft depth elements
// ============================================
const BOKEH_POSITIONS: Array<React.CSSProperties & { delay: string }> = [
  { top: '14%',  left: '12%',  width: 56, height: 56, delay: '0s' },
  { top: '24%',  right: '10%', width: 44, height: 44, delay: '2.4s' },
  { top: '40%',  left: '72%',  width: 48, height: 48, delay: '4.8s' },
  { top: '52%',  left: '8%',   width: 38, height: 38, delay: '1.2s' },
  { top: '34%',  left: '40%',  width: 32, height: 32, delay: '3.2s' },
];

const BokehLayer = ({ tracks }: { tracks: Track[] }) => {
  if (!tracks.length) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden>
      {tracks.slice(0, 5).map((t, i) => {
        const { delay, ...pos } = BOKEH_POSITIONS[i];
        return (
          <img
            key={t.trackId}
            src={getYouTubeThumbnail(t.trackId, 'medium')}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute rounded-full object-cover"
            style={{
              ...pos,
              opacity: 0.22,
              filter: 'blur(1.5px) saturate(1.15)',
              animation: 'voyo-bokeh-drift 11s ease-in-out infinite',
              animationDelay: delay,
              willChange: 'transform, opacity',
            }}
          />
        );
      })}
      <style>{`
        @keyframes voyo-bokeh-drift {
          0%, 100% { transform: translate(0, 0) scale(1);    opacity: 0.18; }
          50%      { transform: translate(10px, -14px) scale(1.05); opacity: 0.32; }
        }
      `}</style>
    </div>
  );
};

// ============================================
// FLOATING REACTIONS — auto-spawned ambient emojis
// ============================================
interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
  xOffset: number;
}

const FloatingReactions = ({ reactions }: { reactions: FloatingReaction[] }) => (
  <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
    {reactions.map((reaction) => (
      <div
        key={reaction.id}
        className="absolute text-4xl"
        style={{ left: `${reaction.x}%`, bottom: '30%' }}
      >
        <span className="drop-shadow-2xl">{reaction.emoji}</span>
      </div>
    ))}
  </div>
);

// ============================================
// TITLE BLOCK — auto-positioned (slides up when comments expand)
// ============================================
const TitleBlock = ({ track, compact }: { track: Track; compact: boolean }) => (
  <div
    className="px-6 text-center"
    style={{
      transform: compact ? 'translateY(-12px) scale(0.94)' : 'translateY(0) scale(1)',
      transition: 'transform 380ms cubic-bezier(0.16, 1, 0.3, 1)',
    }}
  >
    <h1 className="text-white text-2xl font-bold tracking-tight leading-tight truncate">
      {track.title}
    </h1>
    <p className="text-white/60 text-base mt-1 truncate">{track.artist}</p>
  </div>
);

// ============================================
// UP NEXT STRIP — peek of the next 3 tracks
// ============================================
const UpNextStrip = ({ tracks }: { tracks: Track[] }) => {
  if (!tracks.length) return null;
  return (
    <div className="px-4 mb-2">
      <p className="text-white/40 text-[10px] uppercase tracking-[0.16em] mb-1.5 px-1">Up Next</p>
      <div className="flex items-center gap-1.5">
        {tracks.slice(0, 3).map((t) => (
          <div
            key={t.trackId}
            className="flex items-center gap-2 bg-white/[0.06] rounded-xl p-1.5 pr-2.5 backdrop-blur-sm flex-1 min-w-0 border border-white/5"
          >
            <img
              src={getYouTubeThumbnail(t.trackId, 'medium')}
              alt={t.title}
              loading="lazy"
              decoding="async"
              className="w-7 h-7 rounded-md object-cover flex-shrink-0"
            />
            <p className="text-white/75 text-[11px] truncate min-w-0">{t.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// COMMENTS OVERLAY — transparent, VOYO Moments style, with expand
// ============================================
const CommentsOverlay = ({
  expanded,
  onToggleExpand,
  reactions,
  trackStats,
  onAddComment,
  dashId,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  reactions: Reaction[];
  trackStats: TrackStats | null;
  onAddComment: (text: string) => void;
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

  const fallbackComments = [
    { user: 'burna_fan', text: 'This track is FIRE 🔥🔥🔥', time: '2m' },
    { user: 'afrovibes', text: 'OYÉ OYÉ OYÉ!!! ⚡', time: '5m' },
    { user: 'dashfam', text: 'On repeat all day 🔂', time: '12m' },
    { user: 'music_lover', text: 'Best afrobeats this year 💜', time: '1h' },
  ];

  // Variable height: collapsed peek vs expanded VOYO-Moments-style
  const heightClass = expanded ? 'h-[58vh]' : 'h-[26vh]';

  return (
    <div
      className={`mx-3 rounded-2xl overflow-hidden relative transition-all duration-[380ms] ease-out border border-white/[0.07] ${heightClass}`}
      style={{
        background: 'rgba(10, 10, 14, 0.42)',
        backdropFilter: 'blur(22px) saturate(140%)',
        WebkitBackdropFilter: 'blur(22px) saturate(140%)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-[#D4A053] flex items-center justify-center">
            <MessageCircle className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-white font-semibold text-[13px] leading-tight">Vibes</p>
            <p className="text-white/45 text-[10px] leading-tight">
              {trackStats?.total_reactions || reactions.length || 0} vibing
            </p>
          </div>
        </div>
        <button
          className="p-1.5 rounded-full hover:bg-white/5 active:scale-95 transition"
          onClick={onToggleExpand}
          aria-label={expanded ? 'Collapse comments' : 'Expand comments'}
        >
          {expanded ? (
            <Minimize2 className="w-4 h-4 text-white/70" />
          ) : (
            <Maximize2 className="w-4 h-4 text-white/70" />
          )}
        </button>
      </div>

      {/* Top fade gradient — VOYO Moments signature */}
      <div className="absolute top-[44px] left-0 right-0 h-4 bg-gradient-to-b from-[rgba(10,10,14,0.5)] to-transparent z-10 pointer-events-none" />

      {/* Comments scroll */}
      <div ref={scrollRef} className="overflow-y-auto scrollbar-hide px-4 py-3 space-y-3" style={{ height: 'calc(100% - 44px - 56px)' }}>
        {(reactions.length > 0 ? reactions.slice(-30) : fallbackComments).map((c, i) => {
          const isReal = 'username' in c;
          return (
            <div key={isReal ? (c as Reaction).id : i} className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center flex-shrink-0">
                <User className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-purple-300 text-[11px] font-bold">
                    @{isReal ? (c as Reaction).username : (c as { user: string }).user}
                  </span>
                  <span className="text-white/30 text-[9px]">
                    {isReal ? timeAgo((c as Reaction).created_at) : (c as { time: string }).time}
                  </span>
                </div>
                <p className="text-white/85 text-[13px] leading-snug">
                  {isReal
                    ? `${(c as Reaction).emoji} ${(c as Reaction).comment || 'sent a vibe'}`
                    : (c as { text: string }).text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom fade gradient */}
      <div className="absolute bottom-[56px] left-0 right-0 h-4 bg-gradient-to-t from-[rgba(10,10,14,0.5)] to-transparent z-10 pointer-events-none" />

      {/* Input */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 flex gap-2 bg-[rgba(10,10,14,0.55)] border-t border-white/[0.05]">
        <input
          type="text"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder={dashId ? 'Drop a vibe…' : 'Sign in to drop a vibe'}
          disabled={!dashId}
          className="flex-1 bg-white/[0.07] rounded-full px-3.5 py-2 text-[13px] text-white placeholder-white/35 focus:outline-none focus:ring-1 focus:ring-purple-500/40 disabled:opacity-50"
        />
        <button
          className="w-9 h-9 rounded-full bg-gradient-to-r from-purple-500 to-[#D4A053] flex items-center justify-center active:scale-95 transition disabled:opacity-40"
          onClick={handleSubmit}
          disabled={!dashId || !commentText.trim()}
          aria-label="Send"
        >
          <Send className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );
};

// ============================================
// MAIN
// ============================================
interface NowPlayingProps {
  isOpen: boolean;
  onClose: () => void;
  /** Double-tap on the MiniPlayer here → goes to VOYO Portrait. */
  onSwitchToVoyo?: () => void;
}

export const NowPlaying = ({ isOpen, onClose, onSwitchToVoyo }: NowPlayingProps) => {
  useBackGuard(isOpen, onClose, 'now-playing');

  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const queue = usePlayerStore(useShallow(s => s.queue));
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue);
  const videoTarget = usePlayerStore(s => s.videoTarget);
  const setVideoTarget = usePlayerStore(s => s.setVideoTarget);
  const predictUpcoming = usePlayerStore(s => s.predictUpcoming);

  // trackPosition is only used in handleAddComment — snapshot read via getState()
  // instead of a reactive subscription to avoid 4Hz re-renders of this 640-line
  // component every time progress ticks during playback.

  const createReaction = useReactionStore(s => s.createReaction);
  const fetchTrackReactions = useReactionStore(s => s.fetchTrackReactions);
  const fetchTrackStats = useReactionStore(s => s.fetchTrackStats);
  const trackReactions = useReactionStore(useShallow(s => s.trackReactions));
  const statsMap = useReactionStore(useShallow(s => s.trackStats));
  const { dashId } = useAuth();

  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(false);

  // Predicted next tracks — used for both the bokeh layer and Up Next strip.
  // Derived from playerStore so it stays fresh as the queue / hot pool updates.
  // Track-id keyed memo would be tighter but for 5 items the cost is trivial.
  const upcoming = currentTrack ? predictUpcoming(8) : [];
  const bokehTracks = upcoming.slice(0, 5);
  const upNextTracks = upcoming.slice(0, 3);

  const currentTrackId = currentTrack?.id || '';
  const realReactions = trackReactions.get(currentTrackId) || [];
  const currentTrackStats = statsMap.get(currentTrackId) || null;

  // Fetch reactions when opened
  useEffect(() => {
    if (currentTrack && isOpen) {
      fetchTrackReactions(currentTrack.id);
      fetchTrackStats(currentTrack.id);
    }
  }, [currentTrack?.id, isOpen, fetchTrackReactions, fetchTrackStats]);

  // Reset videoTarget when closing
  useEffect(() => {
    if (!isOpen && videoTarget === 'portrait') setVideoTarget('hidden');
  }, [isOpen, videoTarget, setVideoTarget]);

  // Spawn floating reaction
  const spawnReaction = useCallback((emoji: string) => {
    const id = Date.now() + Math.random();
    const x = 20 + Math.random() * 60;
    const xOffset = (Math.random() - 0.5) * 100;
    setFloatingReactions(prev => [...prev, { id, emoji, x, xOffset }]);
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id));
    }, 3000);
  }, []);

  const handleAddComment = useCallback(async (text: string) => {
    if (!currentTrack) return;
    spawnReaction('🔥');
    // Snapshot read — position is only needed at the moment the comment is
    // submitted, not reactively. Keeps NowPlaying off the 4Hz render loop.
    const trackPosition = Math.round(usePlayerStore.getState().progress);
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
      trackPosition,
    });
  }, [currentTrack, dashId, createReaction, spawnReaction]);

  // Auto-spawn ambient reactions while playing + visible
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

  const handleShare = useCallback(async () => {
    if (!currentTrack) return;
    const shareData = {
      title: currentTrack.title,
      text: `Check out "${currentTrack.title}" by ${currentTrack.artist} on VOYO Music`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        spawnReaction('🔗');
      } else {
        await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
        setShareToast(true);
        spawnReaction('📋');
        setTimeout(() => setShareToast(false), 2000);
      }
    } catch (error) {
      devLog('Share cancelled or failed:', error);
    }
  }, [currentTrack, spawnReaction]);

  // Double-tap on MiniPlayer here = go to VOYO. If onSwitchToVoyo wasn't
  // wired, fall back to closing the surface so we don't trap the user.
  const handleMiniPlayerDoubleTap = useCallback(() => {
    onClose();
    if (onSwitchToVoyo) onSwitchToVoyo();
  }, [onClose, onSwitchToVoyo]);

  if (!currentTrack) return null;
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Backdrop: blurred album art (when not in video mode) */}
      {videoTarget !== 'portrait' && (
        <AlbumArtBackground coverUrl={getTrackThumbnailUrl(currentTrack, 'max')} />
      )}

      {/* Drifting bokeh of related tracks */}
      <BokehLayer tracks={bokehTracks} />

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-transparent z-10 pointer-events-none" />

      {/* Floating ambient reactions */}
      <FloatingReactions reactions={floatingReactions} />

      {/* VIDEO TOGGLE — left side vertical (kept) */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-40">
        <button
          className={`flex flex-col items-center gap-2 px-2 py-3 rounded-full backdrop-blur-xl border transition-all duration-300 ${
            videoTarget === 'portrait'
              ? 'bg-purple-500/30 border-purple-400/50'
              : 'bg-black/40 border-white/10 hover:border-white/20'
          }`}
          onClick={() => setVideoTarget(videoTarget === 'portrait' ? 'hidden' : 'portrait')}
          aria-label={videoTarget === 'portrait' ? 'Show album art' : 'Show video'}
        >
          {videoTarget === 'portrait' ? (
            <ImageIcon className="w-4 h-4 text-white" />
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

      {/* MAIN CONTENT */}
      <div className="relative z-30 flex flex-col h-full">
        {/* TOP CHROME */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <button
            className="p-2 -ml-2 active:scale-95 transition"
            onClick={onClose}
            aria-label="Close"
          >
            <ChevronDown className="w-7 h-7 text-white" />
          </button>
          <div className="text-center">
            <p className="text-white/50 text-[10px] uppercase tracking-[0.18em]">Playing from</p>
            <p className="text-white/90 text-[13px] font-medium">{currentTrack.album || 'Your Library'}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="p-2 active:scale-95 transition"
              onClick={handleShare}
              aria-label="Share"
            >
              <Share2 className="w-5 h-5 text-white/70" />
            </button>
            <button
              className={`p-2 active:scale-95 transition ${showQueue ? 'text-purple-400' : 'text-white/70'}`}
              onClick={() => setShowQueue(true)}
              aria-label="Queue"
            >
              <ListMusic className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* SPACER + TITLE */}
        <div className="flex-1 flex items-center justify-center">
          <TitleBlock track={currentTrack} compact={commentsExpanded} />
        </div>

        {/* COMMENTS OVERLAY — variable height, transparent VOYO Moments style */}
        <CommentsOverlay
          expanded={commentsExpanded}
          onToggleExpand={() => setCommentsExpanded(prev => !prev)}
          reactions={realReactions}
          trackStats={currentTrackStats}
          onAddComment={handleAddComment}
          dashId={dashId}
        />

        {/* UP NEXT — hidden when comments expand to give them room */}
        {!commentsExpanded && (
          <div className="mt-3">
            <UpNextStrip tracks={upNextTracks} />
          </div>
        )}

        {/* MINIPLAYER CHROME at bottom — same component as Home, double-tap → VOYO */}
        <div className="px-3 pt-2 pb-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <MiniPlayer variant="inline" onOpenFull={handleMiniPlayerDoubleTap} />
        </div>
      </div>

      {/* QUEUE PANEL */}
      {showQueue && (
        <div className="absolute inset-0 bg-black/95 backdrop-blur-xl z-40 flex flex-col">
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
                  <span className="text-white/40 text-sm font-bold w-6 text-center">
                    {index + 1}
                  </span>
                  <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0">
                    <img
                      src={getTrackThumbnailUrl(item.track, 'default')}
                      alt={item.track.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{item.track.title}</p>
                    <p className="text-white/50 text-xs truncate">{item.track.artist}</p>
                  </div>
                  <button
                    className="p-2 text-white/40 hover:text-red-400"
                    onClick={() => removeFromQueue(index)}
                    aria-label="Remove"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SHARE TOAST */}
      {shareToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-white/10 backdrop-blur-xl rounded-full px-6 py-3 flex items-center gap-2">
          <Share2 className="w-4 h-4 text-white" />
          <span className="text-white text-sm font-medium">Copied to clipboard</span>
        </div>
      )}
    </div>
  );
};
