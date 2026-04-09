/**
 * VOYO Music - Video Mode (Full Immersion)
 * Reference: Livre reactiosn example.jpg for floating reactions
 *
 * Features:
 * - Full screen video/visualizer
 * - Overlay controls fade after 2 seconds
 * - Floating reactions (hearts, fire, thumbs up) rise like TikTok Live
 * - Swipe up/down for next/prev
 * - Double-tap for reaction storm
 * - Triple-tap to exit
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Volume2, VolumeX } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { getYouTubeThumbnail } from '../../data/tracks';

// Floating Reaction Component
interface FloatingReaction {
  id: number;
  emoji: string;
  startY: number;
  yOffset: number;  // Pre-computed random offset
  xOffset: number;  // Pre-computed random offset
}

const FloatingReactionEmoji = ({ emoji, startY, xOffset, onComplete }: {
  emoji: string;
  startY: number;
  yOffset: number;
  xOffset: number;
  onComplete: () => void;
}) => {
  // Auto-remove after animation
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className="fixed text-3xl pointer-events-none z-50"
      style={{ left: `${xOffset}%`, bottom: `${startY}%` }}
    >
      {emoji}
    </div>
  );
};

// Reaction storm emojis
const REACTION_EMOJIS = ['❤️', '🔥', '👍', '👏', '✨', '💜', '🎵', '⚡'];

interface VideoModeProps {
  onExit: () => void;
}

export const VideoMode = ({ onExit }: VideoModeProps) => {
  // Battery fix: fine-grained selectors
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const nextTrack = usePlayerStore(s => s.nextTrack);
  const prevTrack = usePlayerStore(s => s.prevTrack);
  const progress = usePlayerStore(s => s.progress);
  const volume = usePlayerStore(s => s.volume);
  const setVolume = usePlayerStore(s => s.setVolume);

  const [showControls, setShowControls] = useState(true);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  // FIX: Derive mute state from volume instead of separate state
  const isMuted = volume === 0;
  const previousVolume = useRef(volume > 0 ? volume : 80); // Default to 80 if currently muted
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tapCountRef = useRef(0);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTapTime = useRef(0);

  // Auto-hide controls
  useEffect(() => {
    if (showControls) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls]);

  // Cleanup tap timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = undefined;
      }
    };
  }, []);

  // Add a single floating reaction
  const addReaction = useCallback((emoji?: string) => {
    const newReaction: FloatingReaction = {
      id: Date.now() + Math.random(),
      emoji: emoji || REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)],
      startY: 10 + Math.random() * 20,
      // Pre-compute random values for animation at creation time
      yOffset: Math.random() * 200,
      xOffset: (Math.random() - 0.5) * 100,
    };
    setFloatingReactions(prev => [...prev, newReaction]);
  }, []);

  // Trigger reaction storm (double-tap)
  const triggerReactionStorm = useCallback(() => {
    // Add 10-20 reactions in quick succession
    const count = 10 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i++) {
      setTimeout(() => addReaction(), i * 100);
    }
  }, [addReaction]);

  // Remove completed reaction
  const removeReaction = useCallback((id: number) => {
    setFloatingReactions(prev => prev.filter(r => r.id !== id));
  }, []);

  // Handle tap (single: show controls, double: reaction storm, triple: exit)
  const handleTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTime.current;
    lastTapTime.current = now;

    if (timeSinceLastTap < 300) {
      tapCountRef.current += 1;
    } else {
      tapCountRef.current = 1;
    }

    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
    }

    tapTimeoutRef.current = setTimeout(() => {
      if (tapCountRef.current >= 3) {
        onExit();
      } else if (tapCountRef.current === 2) {
        triggerReactionStorm();
      } else {
        setShowControls(true);
      }
      tapCountRef.current = 0;
    }, 300);
  }, [onExit, triggerReactionStorm]);

  // Handle swipe
  const handleDragEnd = useCallback((event: any, info: { offset: { x: number; y: number } }) => {
    const threshold = 100;
    if (info.offset.y < -threshold) {
      nextTrack();
    } else if (info.offset.y > threshold) {
      prevTrack();
    }
  }, [nextTrack, prevTrack]);

  // Toggle mute - FIX: Update ref before toggling
  const handleMuteToggle = useCallback(() => {
    if (isMuted) {
      // Unmuting: restore previous volume
      setVolume(previousVolume.current);
    } else {
      // Muting: save current volume first
      if (volume > 0) {
        previousVolume.current = volume;
      }
      setVolume(0);
    }
  }, [isMuted, volume, setVolume]);

  if (!currentTrack) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black"
    >
      {/* Video/Visualizer Background */}
      <div
        className="absolute inset-0"
        onClick={handleTap}
      >
        {/* Album art as background with blur effect */}
        <img
          src={getYouTubeThumbnail(currentTrack.trackId, 'high')}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Animated gradient overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(45deg, rgba(168,85,247,0.3), rgba(236,72,153,0.3), rgba(59,130,246,0.3))',
            backgroundSize: '200% 200%',
            }}
        />
        {/* Dark gradient for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
      </div>

      {/* Floating Reactions */}
      
        {floatingReactions.map((reaction) => (
          <FloatingReactionEmoji
            key={reaction.id}
            emoji={reaction.emoji}
            startY={reaction.startY}
            yOffset={reaction.yOffset}
            xOffset={reaction.xOffset}
            onComplete={() => removeReaction(reaction.id)}
          />
        ))}
      

      {/* Track Info (always visible) */}
      <div
        className="absolute bottom-24 left-6"
      >
        <h2 className="text-white text-2xl font-bold shadow-lg">{currentTrack.title}</h2>
        <p className="text-white/70 text-lg">{currentTrack.artist}</p>
      </div>

      {/* Progress Bar (always visible) */}
      <div className="absolute bottom-16 left-6 right-6">
        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Reaction Buttons (right side, always visible) */}
      <div className="absolute right-4 bottom-32 flex flex-col gap-3">
        {['❤️', '🔥', '👏', '✨'].map((emoji) => (
          <button
            key={emoji}
            className="w-12 h-12 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-xl"
            onClick={(e) => {
              e.stopPropagation();
              addReaction(emoji);
              }}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Overlay Controls (fade in/out) */}
      
        {showControls && (
          <div
            className="absolute inset-0 pointer-events-none"
          >
            {/* Exit Button */}
            <button
              className="absolute top-4 right-4 p-3 rounded-full bg-black/50 backdrop-blur-sm pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                onExit();
                }}
            >
              <X className="w-6 h-6 text-white" />
            </button>

            {/* Volume Control */}
            <button
              className="absolute top-4 left-4 p-3 rounded-full bg-black/50 backdrop-blur-sm pointer-events-auto"
              onClick={(e) => {
                e.stopPropagation();
                handleMuteToggle();
                }}
            >
              {isMuted ? (
                <VolumeX className="w-6 h-6 text-white" />
              ) : (
                <Volume2 className="w-6 h-6 text-white" />
              )}
            </button>

            {/* Center Controls */}
            <div className="absolute inset-0 flex items-center justify-center gap-8 pointer-events-auto">
              {/* Previous */}
              <button
                className="p-4 rounded-full bg-black/30 backdrop-blur-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  prevTrack();
                  }}
              >
                <SkipBack className="w-8 h-8 text-white" fill="white" />
              </button>

              {/* Play/Pause */}
              <button
                className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                  }}
              >
                {isPlaying ? (
                  <Pause className="w-10 h-10 text-black" fill="black" />
                ) : (
                  <Play className="w-10 h-10 text-black ml-1" fill="black" />
                )}
              </button>

              {/* Next */}
              <button
                className="p-4 rounded-full bg-black/30 backdrop-blur-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  nextTrack();
                  }}
              >
                <SkipForward className="w-8 h-8 text-white" fill="white" />
              </button>
            </div>

            {/* Hint Text */}
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <p className="text-white/50 text-xs">
                Swipe up/down: Next/Prev • Double-tap: Reactions • Triple-tap: Exit
              </p>
            </div>
          </div>
        )}
      
    </div>
  );
};

export default VideoMode;
