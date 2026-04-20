/**
 * VOYO Music - Landscape Video Mode
 *
 * VIDEO-FIRST EXPERIENCE:
 * - YouTube video plays fullscreen as background
 * - UI overlay auto-hides after 3 seconds
 * - 1 tap: Show controls briefly
 * - 2 taps (double-tap): OYO DJ mode directly
 * - Back button returns to portrait
 *
 * INTERCEPTOR:
 * - Purple-bordered overlay on YouTube suggestions (right side)
 * - Click → OCR extracts video title → adds to VOYO queue
 * - User never leaves VOYO ecosystem
 */

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { SkipBack, SkipForward, Play, Pause, Plus, Volume2, Smartphone, Loader2 } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { voyoStream } from '../../services/voyoStream';
import { app } from '../../services/oyo';
import { getThumb } from '../../utils/thumbnail';
import { BoostButton } from '../ui/BoostButton';
import { getYouTubeThumbnail, TRACKS } from '../../data/tracks';
import { Track } from '../../types';
import { SmartImage } from '../ui/SmartImage';
import { DJTextInput } from './PortraitVOYO';
import {
  searchLocalCache,
  searchYouTube,
  cacheVideo,
  registerTrackPlay,
  registerTrackQueue,
  getRelatedVideos
} from '../../services/videoIntelligence';

// Timeline Card (horizontal scroll)
const TimelineCard = ({
  track,
  isCurrent,
  onClick,
}: {
  track: Track;
  isCurrent?: boolean;
  onClick: () => void;
}) => (
  <button
    className={`
      relative flex-shrink-0 rounded-xl overflow-hidden
      ${isCurrent ? 'w-32 h-24' : 'w-20 h-16 opacity-70 hover:opacity-90'}
    `}
    onClick={onClick}
  >
    <SmartImage
      src={getYouTubeThumbnail(track.trackId, 'medium')}
      alt={track.title}
      className="w-full h-full object-cover"
      trackId={track.trackId}
      lazy={true}
    />
    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
    <div className="absolute bottom-1 left-1 right-1">
      <p className="text-white font-bold text-[10px] truncate">{track.title}</p>
      <p className="text-white/60 text-[8px] truncate">{track.artist}</p>
    </div>
  </button>
);

// Waveform Bars (landscape version)
const WaveformBars = ({ isPlaying }: { isPlaying: boolean }) => {
  const bars = 24;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex items-center gap-[2px]">
        {Array.from({ length: bars }).map((_, i) => {
          const distance = Math.abs(i - bars / 2);
          const maxHeight = 28 - distance * 1.2;

          return (
            <div
              key={i}
              className="w-[3px] rounded-full bg-white/80"
              style={{
                height: isPlaying ? maxHeight : maxHeight * 0.4,
                animation: isPlaying ? `voyo-waveform ${0.6 + (i % 5) * 0.08}s ease-in-out ${i * 0.02}s infinite` : 'none',
                transition: 'height 0.2s ease',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

// Main Play Circle (landscape)
// Triple-tap = Video Mode, Hold (500ms) = DJ Mode
const PlayCircle = ({ onTripleTap, onHold }: { onTripleTap: () => void; onHold: () => void }) => {
  // Fine-grained selectors — avoid full destructure re-renders.
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const progress = usePlayerStore(s => s.progress);
  const tapCountRef = useRef(0);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isHoldingRef = useRef(false);

  // Cleanup tap and hold timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = undefined;
      }
      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = undefined;
      }
    };
  }, []);

  const handlePointerDown = () => {
    isHoldingRef.current = false;
    holdTimeoutRef.current = setTimeout(() => {
      isHoldingRef.current = true;
      onHold();
    }, 500); // 500ms hold to trigger DJ
  };

  const handlePointerUp = () => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
    }
    // Only process tap if we didn't hold
    if (!isHoldingRef.current) {
      handleTap();
    }
    isHoldingRef.current = false;
  };

  const handleTap = () => {
    tapCountRef.current += 1;

    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      onTripleTap();
      return;
    }

    tapTimeoutRef.current = setTimeout(() => {
      if (tapCountRef.current < 3) {
        togglePlay();
      }
      tapCountRef.current = 0;
    }, 300);
  };

  return (
    <button
      className="relative w-36 h-36 rounded-full flex items-center justify-center"
      style={{
        background: 'conic-gradient(from 0deg, #8b5cf6, #D4A053, #8b5cf6)',
        padding: '3px',
        boxShadow: isPlaying
          ? '0 0 60px rgba(139, 92, 246, 0.6), 0 0 100px rgba(212, 160, 83, 0.3)'
          : '0 0 30px rgba(139, 92, 246, 0.3)',
        transition: 'box-shadow 0.3s ease',
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => holdTimeoutRef.current && clearTimeout(holdTimeoutRef.current)}
    >
      {/* Progress ring */}
      <svg className="absolute inset-0 w-full h-full -rotate-90">
        <circle cx="72" cy="72" r="68" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
        <circle
          cx="72" cy="72" r="68" fill="none" stroke="rgba(255,255,255,0.5)"
          strokeWidth="3" strokeLinecap="round" strokeDasharray={427}
          strokeDashoffset={427 - (progress / 100) * 427}
          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
        />
      </svg>

      {/* Inner circle */}
      <div className="w-full h-full rounded-full bg-[#0a0a0f] flex items-center justify-center relative overflow-hidden">
        <WaveformBars isPlaying={isPlaying} />

        {/* Play/Pause Icon */}
        <div className="relative z-10">
          {isPlaying ? (
            <div className="flex gap-1.5 animate-[voyo-scale-in_0.2s_ease]">
              <div className="w-3 h-10 bg-white rounded-sm" />
              <div className="w-3 h-10 bg-white rounded-sm" />
            </div>
          ) : (
            <div className="animate-[voyo-scale-in_0.2s_ease]">
              <Play className="w-12 h-12 text-white ml-1" fill="white" />
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

// Mini Track Card for bottom rows
const MiniCard = ({ track, onClick }: { track: Track; onClick: () => void }) => {
  const addToQueue = usePlayerStore(state => state.addToQueue);
  const [showQueueFeedback, setShowQueueFeedback] = useState(false);

  return (
    <div
      className="flex-shrink-0 w-16 relative"
    >
      {/* Queue Feedback Indicator */}
      {showQueueFeedback && (
        <div
          className="absolute -top-8 left-1/2 -translate-x-1/2 z-50 bg-purple-500 text-white text-[9px] font-bold px-3 py-1.5 rounded-full shadow-lg whitespace-nowrap animate-[voyo-scale-in_0.2s_ease]"
        >
          Added to Bucket
        </div>
      )}

      <button
        className="w-full"
        onClick={onClick}
      >
        <div className="w-16 h-16 rounded-lg overflow-hidden mb-1">
          <SmartImage
            src={getYouTubeThumbnail(track.trackId, 'medium')}
            alt={track.title}
            className="w-full h-full object-cover"
            trackId={track.trackId}
            lazy={true}
          />
        </div>
        <p className="text-white text-[9px] font-medium truncate">{track.title}</p>
      </button>
    </div>
  );
};

interface LandscapeVOYOProps {
  onVideoMode: () => void;
}

// DJ Response Messages
const DJ_RESPONSES: Record<string, string[]> = {
  'more-like-this': ["Got you fam!", "Adding similar vibes..."],
  'something-different': ["Say less!", "Switching it up..."],
  'more-energy': ["AYEEE!", "Turning UP!"],
  'chill-vibes': ["Cooling it down...", "Smooth vibes only"],
  'default': ["I hear you!", "Say less, fam!", "OYE!"],
};

// ============================================
// INTERCEPTOR - Capture YouTube Suggestions
// ============================================
interface InterceptorProps {
  onVideoExtracted: (videoId: string, title: string, artist: string) => void;
  iframeRef?: React.RefObject<HTMLIFrameElement>;
}

// Two interceptor styles that alternate randomly
type InterceptorStyle = 'floaty' | 'bold';

const YouTubeInterceptor = ({ onVideoExtracted }: InterceptorProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [successAnimation, setSuccessAnimation] = useState(false);

  // Random style - changes each time interceptor appears
  const [style, setStyle] = useState<InterceptorStyle>('floaty');

  // Non-time-dependent subscriptions. The 4Hz-changing fields
  // (currentTime, derived zone state) live in InterceptorTimeSync below.
  const currentTrack = usePlayerStore(state => state.currentTrack);

  // Zone state is updated by InterceptorTimeSync only when values change,
  // so this component re-renders ~1Hz (during countdown) or 0Hz (otherwise)
  // instead of at the full 4Hz store-write cadence.
  const [zoneState, setZoneState] = useState<{
    show: boolean;
    seconds: number;
    inSuggestionZone: boolean;
  }>({ show: false, seconds: 0, inSuggestionZone: false });

  const isInSuggestionZone = zoneState.inSuggestionZone;
  const secondsUntilEnd = zoneState.seconds;
  const showInterceptor = zoneState.show;

  // Randomize style when interceptor appears
  useEffect(() => {
    if (showInterceptor) {
      setStyle(Math.random() > 0.5 ? 'floaty' : 'bold');
    }
  }, [isInSuggestionZone]); // Only change when entering suggestion zone

  // Handle click on interceptor zone - REAL FLOW
  const handleInterceptClick = async (zone: 'top' | 'bottom') => {
    if (isProcessing || !currentTrack) return;

    setIsProcessing(true);

    try {
      // Get related videos from YouTube via our backend
      const relatedVideos = await getRelatedVideos(currentTrack.trackId, 3);

      if (relatedVideos.length === 0) {
        // Fallback: pick from our catalog
        const randomTrack = TRACKS[Math.floor(Math.random() * TRACKS.length)];
        onVideoExtracted(randomTrack.trackId, randomTrack.title, randomTrack.artist);
        setFeedback(`${randomTrack.title.slice(0, 20)}...`);
      } else {
        // Pick the first related video (or random from top 3 for variety)
        const videoIndex = zone === 'top' ? 0 : Math.min(1, relatedVideos.length - 1);
        const relatedVideo = relatedVideos[videoIndex];

        onVideoExtracted(relatedVideo.id, relatedVideo.title, relatedVideo.artist);
        setFeedback(`${relatedVideo.title.slice(0, 20)}...`);

        // Cache this discovery for collective brain
        cacheVideo({
          youtubeId: relatedVideo.id,
          title: relatedVideo.title,
          artist: relatedVideo.artist,
          durationSeconds: relatedVideo.duration,
          thumbnailUrl: relatedVideo.thumbnail,
          discoveryMethod: 'related_crawl'
        });
      }

      // Success animation
      setSuccessAnimation(true);
      setTimeout(() => {
        setSuccessAnimation(false);
        setFeedback(null);
      }, 2000);

    } catch (err) {
      console.error('[Interceptor] Error:', err);
      setFeedback('Oops! Try again');
      setTimeout(() => setFeedback(null), 2000);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      {/* Time-driven zone state sync. Subscribes to currentTime at 4Hz,
          only writes to parent state when the derived values change —
          so the parent re-renders ~1Hz during suggestion zone (countdown)
          and 0Hz otherwise. */}
      <InterceptorTimeSync onChange={setZoneState} />

      {/* INTERCEPTOR ZONES - Appear EXACTLY when YouTube shows suggestions */}
      {/* Formula: Last 15 seconds OR first 5 seconds */}
      {showInterceptor && (
        <div
          className="absolute right-0 top-0 bottom-0 w-[300px] z-15 pointer-events-none flex flex-col items-end justify-center gap-4 pr-4 animate-[voyo-slide-in-right_0.4s_ease]"
        >

          {/* ADD TO QUEUE - Two random styles */}
          {style === 'floaty' ? (
            /* STYLE A: Floaty bouncing with glow */
            <button
              className="pointer-events-auto relative overflow-hidden"
              onClick={() => handleInterceptClick('top')}
            >
              <div
                className="absolute -inset-2 rounded-2xl"
                style={{
                  boxShadow: '0 0 0 2px rgba(147, 51, 234, 0.6), 0 0 20px rgba(147, 51, 234, 0.3)',
                }}
              />
              <div className="relative bg-gradient-to-r from-purple-600 to-[#D4A053] px-8 py-4 rounded-xl border-4 border-white/30">
                {isProcessing ? (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                    <span className="text-white font-black text-base">Adding...</span>
                  </div>
                ) : successAnimation ? (
                  <div className="flex items-center gap-2 animate-[voyo-scale-in_0.2s_ease]">
                    <span className="text-white font-black text-base">Added!</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Plus className="w-6 h-6 text-white stroke-[3]" />
                    <span className="text-white font-black text-base tracking-wide">ADD TO BUCKET</span>
                  </div>
                )}
              </div>
            </button>
          ) : (
            /* STYLE B: Bold rectangle with pulse scale */
            <button
              className="pointer-events-auto relative"
              onClick={() => handleInterceptClick('top')}
            >
              {/* Rotating border effect */}
              <div
                className="absolute -inset-1 rounded-lg bg-gradient-to-r from-purple-500 via-[#D4A053] to-purple-500"
                style={{ backgroundSize: '200% 200%', animation: 'voyo-gradient-shift 3s linear infinite' }}
              />
              <div className="relative bg-black px-8 py-4 rounded-lg m-[3px]">
                {isProcessing ? (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                    <span className="text-purple-300 font-black text-base">ADDING...</span>
                  </div>
                ) : successAnimation ? (
                  <div className="flex items-center gap-2 animate-[voyo-scale-in_0.2s_ease]">
                    <span className="text-purple-400 font-black text-base">ADDED!</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Plus className="w-6 h-6 text-purple-400 stroke-[3]" />
                    <span className="text-white font-black text-base tracking-widest">+ BUCKET</span>
                  </div>
                )}
              </div>
            </button>
          )}

          {/* UP NEXT - Secondary rectangle */}
          <button
            className="pointer-events-auto relative"
            onClick={() => handleInterceptClick('bottom')}
          >
            {/* Bold border */}
            <div className="absolute -inset-1 rounded-xl border-2 border-purple-500/60" />

            <div className="relative bg-black/60 backdrop-blur-md px-6 py-3 rounded-lg border-2 border-purple-400/40">
              <div className="flex items-center gap-3">
                <SkipForward className="w-5 h-5 text-purple-300" />
                <span className="text-purple-200 font-bold text-sm tracking-wide">UP NEXT</span>
              </div>
            </div>
          </button>

          {/* Countdown indicator - shows we arrived first */}
          {isInSuggestionZone && (
            <div
              className="text-purple-400/80 text-xs font-mono mt-2 flex items-center gap-2 animate-[voyo-fade-in_0.3s_ease]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
              <span>{secondsUntilEnd}s</span>
            </div>
          )}

        </div>
      )}

      {/* Success Feedback Toast */}
      {feedback && (
        <div
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 animate-[voyo-scale-in_0.2s_ease]"
        >
          <div className="bg-gradient-to-r from-purple-600 to-[#D4A053] text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-xl flex items-center gap-2">
            <span>{feedback}</span>
          </div>
        </div>
      )}
    </>
  );
};

// InterceptorTimeSync — renders null. Subscribes to currentTime + duration
// and writes zone state to the parent only when values actually change.
// Parent (YouTubeInterceptor) ends up re-rendering ~1Hz (countdown) or
// 0Hz (outside zones) instead of at the 4Hz store-write cadence.
const InterceptorTimeSync = memo(({
  onChange,
}: {
  onChange: (s: { show: boolean; seconds: number; inSuggestionZone: boolean }) => void;
}) => {
  const currentTime = usePlayerStore(state => state.currentTime);
  const duration = usePlayerStore(state => state.duration);
  const lastRef = useRef<{ show: boolean; seconds: number; inSuggestionZone: boolean }>({
    show: false,
    seconds: 0,
    inSuggestionZone: false,
  });
  useEffect(() => {
    const VOYO_ARRIVES_EARLY = 20;
    const inSug = duration > 0 && currentTime > (duration - VOYO_ARRIVES_EARLY);
    const inStart = currentTime < 5 && currentTime > 0.5;
    const show = inSug || inStart;
    const seconds = duration > 0 ? Math.ceil(duration - currentTime) : 0;
    const prev = lastRef.current;
    if (prev.show !== show || prev.seconds !== seconds || prev.inSuggestionZone !== inSug) {
      const next = { show, seconds, inSuggestionZone: inSug };
      lastRef.current = next;
      onChange(next);
    }
  }, [currentTime, duration, onChange]);
  return null;
});
InterceptorTimeSync.displayName = 'InterceptorTimeSync';

export const LandscapeVOYO = ({ onVideoMode }: LandscapeVOYOProps) => {
  // Fine-grained selectors — huge landscape view, must avoid full re-render
  // on every progress/currentTime tick.
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const history = usePlayerStore(s => s.history);
  const queue = usePlayerStore(s => s.queue);
  const hotTracks = usePlayerStore(s => s.hotTracks);
  const discoverTracks = usePlayerStore(s => s.discoverTracks);
  const prevTrack = usePlayerStore(s => s.prevTrack);
  const playTrack = usePlayerStore(s => s.playTrack);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const addReaction = usePlayerStore(s => s.addReaction);
  const volume = usePlayerStore(s => s.volume);
  const refreshRecommendations = usePlayerStore(s => s.refreshRecommendations);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const playbackSource = usePlayerStore(s => s.playbackSource);
  const setPlaybackSource = usePlayerStore(s => s.setPlaybackSource);
  // currentTime is NOT subscribed here — it was dead weight causing the
  // whole LandscapeVOYO component to re-render at 4Hz during playback.
  // YouTubeInterceptor manages its own currentTime subscription in an
  // isolated sub-component.
  const setVideoTarget = usePlayerStore(s => s.setVideoTarget);

  // Set video target to landscape on mount, hidden on unmount
  useEffect(() => {
    setVideoTarget('landscape');
    return () => {
      setVideoTarget('hidden');
    };
  }, [setVideoTarget]);

  // UI visibility state - auto-hide after 3 seconds
  const [showOverlay, setShowOverlay] = useState(true);
  const [isDJOpen, setIsDJOpen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);

  // Build timeline with deduplication
  const seenIds = new Set<string>();
  if (currentTrack) seenIds.add(currentTrack.id);

  const pastTracks = history
    .slice(-5) // Look at more history to fill 3 unique slots
    .map(h => h.track)
    .reverse()
    .filter(t => {
      if (seenIds.has(t.id)) return false;
      seenIds.add(t.id);
      return true;
    })
    .slice(0, 3);

  const queueTracks = queue
    .slice(0, 4) // Look at more queue to fill 2 unique slots
    .map(q => q.track)
    .filter(t => {
      if (seenIds.has(t.id)) return false;
      seenIds.add(t.id);
      return true;
    })
    .slice(0, 2);

  // Fallback suggestions when no history (also deduplicated)
  const suggestTracks = hotTracks
    .filter(t => !seenIds.has(t.id))
    .slice(0, 2);

  // Auto-hide overlay after 3 seconds
  const startHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!isDJOpen) setShowOverlay(false);
    }, 3000);
  }, [isDJOpen]);

  // Handle tap on video area
  const handleVideoTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    // Double-tap detection (< 300ms)
    if (timeSinceLastTap < 300) {
      // Double-tap = Open DJ directly
      setIsDJOpen(true);
      setShowOverlay(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      // Single tap = Toggle overlay visibility
      if (showOverlay) {
        setShowOverlay(false);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      } else {
        setShowOverlay(true);
        startHideTimer();
      }
    }
  }, [showOverlay, startHideTimer]);

  // Start hide timer when overlay shown
  useEffect(() => {
    if (showOverlay && !isDJOpen) {
      startHideTimer();
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showOverlay, isDJOpen, startHideTimer]);

  // Handle DJ command
  const handleDJCommand = (command: string) => {
    setIsDJOpen(false);
    startHideTimer();

    const commandLower = command.toLowerCase();
    if (commandLower.includes('like this') || commandLower.includes('similar')) {
      // more-like-this
    } else if (commandLower.includes('different') || commandLower.includes('change')) {
      // something-different
    } else if (commandLower.includes('energy') || commandLower.includes('hype')) {
      // more-energy
    } else if (commandLower.includes('chill') || commandLower.includes('relax')) {
      // chill-vibes
    }

    refreshRecommendations();
    if (!isPlaying) togglePlay();
  };

  // Handle back to portrait
  const handleBackToPortrait = () => {
    // Rotate back by exiting fullscreen or just letting orientation change
    // For now, this is handled by the orientation hook in App.tsx
    // We could force portrait mode here if needed
  };

  return (
    <div className="fixed inset-0 overflow-hidden z-50">
      {/* Video plays via YouTubeIframe at z-40 underneath this transparent overlay */}

      {/* LAYER 2: Tap Detection Area (invisible) */}
      <div
        className="absolute inset-0 z-10"
        onClick={handleVideoTap}
      />

      {/* LAYER 2.5: YouTube Suggestion Interceptor */}
      {/* Purple-bordered zones over YouTube's "Up Next" suggestions */}
      <YouTubeInterceptor
        onVideoExtracted={(videoId, title, artist) => {
          // Find track in our catalog or create a new one
          const existingTrack = TRACKS.find(t => t.trackId === videoId);
          if (existingTrack) {
            addToQueue(existingTrack);
          } else {
            // Create ad-hoc track for videos not in our catalog
            // This is a REAL video from YouTube's related feed!
            const newTrack: Track = {
              id: `intercepted-${videoId}`,
              trackId: videoId,
              title: title,
              artist: artist || 'YouTube',
              coverUrl: getThumb(videoId),
              duration: 0,
              tags: ['afrobeats'],
              mood: 'party',
              oyeScore: 0,
              createdAt: new Date().toISOString(),
            };
            addToQueue(newTrack);
          }

          // Track queue action in Supabase (collective brain)
          registerTrackQueue(videoId);
          // Show overlay briefly with feedback
          setShowOverlay(true);
          startHideTimer();
        }}
      />

      {/* LAYER 3: UI Overlay - Auto-hides */}
      {showOverlay && !isDJOpen && (
        <div
          className="absolute inset-0 z-20 flex flex-col pointer-events-none animate-[voyo-fade-in_0.3s_ease]"
        >
            {/* Dark gradient for readability */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60" />

            {/* TOP: Timeline */}
            <div className="relative flex items-center justify-center gap-2 p-3 pointer-events-auto">
              {pastTracks.map((track, i) => (
                <TimelineCard key={`past-${i}`} track={track} onClick={() => {
                  playTrack(track);
                  startHideTimer();
                }} />
              ))}
              {pastTracks.length === 0 && suggestTracks.map((track, i) => (
                <TimelineCard key={`suggest-${i}`} track={track} onClick={() => {
                  playTrack(track);
                  startHideTimer();
                }} />
              ))}
              {currentTrack && (
                <TimelineCard track={currentTrack} isCurrent onClick={() => {}} />
              )}
              {queueTracks.map((track, i) => (
                <TimelineCard key={`queue-${i}`} track={track} onClick={() => {
                  playTrack(track);
                  startHideTimer();
                }} />
              ))}
              <button
                className="w-14 h-12 rounded-xl bg-white/10 backdrop-blur-sm border border-dashed border-white/30 flex items-center justify-center"
              >
                <Plus className="w-4 h-4 text-white/60" />
              </button>
            </div>

            {/* MIDDLE: Controls */}
            <div className="flex-1 flex items-center justify-center gap-6 pointer-events-auto">
              {/* Left Reactions */}
              <div className="flex flex-col gap-2">
                <button
                  className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-[#D4A053]/40 text-white text-sm"
                  onClick={() => { addReaction({ type: 'oyo', multiplier: 1, text: 'OYO', emoji: '🔥', x: 50, y: 50, userId: 'user' }); startHideTimer(); }}
                >
                  OYO 🔥
                </button>
                <button
                  className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-purple-500/40 text-white text-sm"
                  onClick={() => { addReaction({ type: 'oye', multiplier: 1, text: 'OYÉÉ', emoji: '💜', x: 50, y: 50, userId: 'user' }); startHideTimer(); }}
                >
                  OYÉÉ 💜
                </button>
              </div>

              {/* Skip Prev */}
              <button
                className="p-3 rounded-full bg-white/10 backdrop-blur-sm"
                onClick={() => { prevTrack(); startHideTimer(); }}
              >
                <SkipBack className="w-6 h-6 text-white" />
              </button>

              {/* Play/Pause - Center */}
              <button
                className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
                onClick={() => { togglePlay(); startHideTimer(); }}
              >
                {isPlaying ? (
                  <Pause className="w-8 h-8 text-white" fill="white" />
                ) : (
                  <Play className="w-8 h-8 text-white ml-1" fill="white" />
                )}
              </button>

              {/* Skip Next */}
              <button
                className="p-3 rounded-full bg-white/10 backdrop-blur-sm"
                onClick={() => { app.skip(); startHideTimer(); }}
              >
                <SkipForward className="w-6 h-6 text-white" />
              </button>

              {/* Right Reactions */}
              <div className="flex flex-col gap-2">
                <button
                  className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm"
                  onClick={() => { addReaction({ type: 'wazzguan', multiplier: 1, text: 'Wazzguán', emoji: '👋', x: 50, y: 50, userId: 'user' }); startHideTimer(); }}
                >
                  Wazzguán 👋
                </button>
                <button
                  className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-red-500/40 text-white text-sm"
                  onClick={() => { addReaction({ type: 'fire', multiplier: 1, text: 'Fireee', emoji: '🔥', x: 50, y: 50, userId: 'user' }); startHideTimer(); }}
                >
                  Fireee 🔥
                </button>
              </div>

              {/* Boost Toggle - Enhanced Audio with Video */}
              <div className="ml-4">
                <BoostButton variant="toolbar" />
                {playbackSource === 'cached' && (
                  <span className="block text-[10px] text-[#D4A053] text-center mt-1">HD Audio</span>
                )}
              </div>
            </div>

            {/* BOTTOM: HOT | DISCOVERY + Back Button */}
            <div className="relative flex items-center justify-center gap-4 p-3 pointer-events-auto">
              {/* HOT Section */}
              <div className="flex items-center gap-2">
                <span className="text-white/60 text-xs uppercase">HOT</span>
                {hotTracks.slice(0, 3).map((track) => (
                  <MiniCard key={track.id} track={track} onClick={() => {
                    playTrack(track);
                    startHideTimer();
                  }} />
                ))}
              </div>

              {/* DISCOVERY Section */}
              <div className="flex items-center gap-2">
                <span className="text-white/60 text-xs uppercase">DISCOVER</span>
                {discoverTracks.slice(0, 3).map((track) => (
                  <MiniCard key={track.id} track={track} onClick={() => {
                    playTrack(track);
                    startHideTimer();
                  }} />
                ))}
              </div>

              {/* Back to Portrait Button */}
              <button
                className="absolute right-3 bottom-3 px-3 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center gap-2 text-white text-xs"
                onClick={handleBackToPortrait}
              >
                <Smartphone className="w-4 h-4" />
                Portrait
              </button>
            </div>
          </div>
        )}

      {/* LAYER 4: OYO DJ Overlay - Double-tap activated */}
      {isDJOpen && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center animate-[voyo-fade-in_0.3s_ease]"
        >
          {/* Semi-transparent backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setIsDJOpen(false); startHideTimer(); }} />

          {/* DJ Input */}
          <DJTextInput
            isOpen={isDJOpen}
            onClose={() => { setIsDJOpen(false); startHideTimer(); }}
            onSubmit={handleDJCommand}
          />
        </div>
      )}

      {/* Track info - always visible at top left */}
      {currentTrack && !showOverlay && !isDJOpen && (
        <div
          className="absolute top-3 left-3 z-20 bg-black/40 backdrop-blur-sm rounded-lg px-3 py-2 animate-[voyo-fade-in_0.3s_ease_0.5s_both]"
        >
          <p className="text-white text-sm font-medium truncate max-w-[200px]">{currentTrack.title}</p>
          <p className="text-white/60 text-xs truncate">{currentTrack.artist}</p>
        </div>
      )}
    </div>
  );
};

export default LandscapeVOYO;
