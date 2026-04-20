/**
 * VOYO Music - Video Mode (Full Immersion)
 *
 * Uses the global YouTubeIframe (videoTarget='landscape') for the actual
 * video layer — so hot-swap + R2 audio-sync + lifecycle is all centralised.
 * This component only renders controls + real actions (Like, Boost) on top.
 * Falls back to an album-art backdrop ONLY when the embed is blocked
 * (region / age-gate / embedding-disabled), in which case the R2 audio
 * keeps playing.
 *
 * Features:
 * - Full-screen iframe video (global, never remounts)
 * - Overlay controls fade after ~3 seconds
 * - Right rail: Like (explicit preference) + Boost (offline cache + EQ)
 * - Swipe up/down for next/prev
 * - Triple-tap to exit
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Volume2, VolumeX, Heart } from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { getYouTubeThumbnail } from '../../data/tracks';
import { BoostButton } from '../ui/BoostButton';

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
  const videoBlocked = usePlayerStore(s => s.videoBlocked);
  const setVideoTarget = usePlayerStore(s => s.setVideoTarget);

  // Promote the global YouTubeIframe into landscape (full-screen) on mount,
  // restore to hidden on unmount. Audio is driven by AudioPlayer regardless
  // of this flag — this controls visual layer only, so exit is seamless.
  useEffect(() => {
    setVideoTarget('landscape');
    return () => { setVideoTarget('hidden'); };
  }, [setVideoTarget]);

  const [showControls, setShowControls] = useState(true);
  // Explicit like — toggles a persisted preference flag, not a moment-reaction.
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);
  const isLiked = !!(currentTrack && trackPreferences[currentTrack.id]?.explicitLike === true);
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

  // Toggle the explicit like on the current track (persisted).
  const handleLikeToggle = useCallback(() => {
    if (!currentTrack) return;
    setExplicitLike(currentTrack.id, !isLiked);
  }, [currentTrack, isLiked, setExplicitLike]);

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
      // `pointer-events: none` on the root so only the actual control
      // buttons below capture taps. The rest of the inset-0 area — tap
      // surface, gradient, track info, progress bar — are decorative /
      // passive and must NOT absorb touches: underlying buttons (search
      // tabs, scroll, inputs) stay fully interactive through the overlay.
      className="fixed inset-0 z-50 pointer-events-none"
      style={{ background: 'transparent' }}
    >
      {/* Video-blocked fallback (album-art backdrop) — only renders when
          the YouTube embed is blocked. Passive visual, no pointer events. */}
      {videoBlocked && (
        <div className="absolute inset-0 pointer-events-none">
          <img
            src={getYouTubeThumbnail(currentTrack.trackId, 'high')}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(45deg, rgba(139,92,246,0.25), rgba(212,160,83,0.20), rgba(139,92,246,0.15))',
            }}
          />
        </div>
      )}

      {/* Readability gradient — decorative only, passes through touches. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.55) 100%)',
        }}
      />

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

      {/* Right rail — real functional actions only. Like (persistent
          preference) + Boost (offline cache + EQ engage). pointer-events-auto
          on each so the root's 'none' doesn't swallow these taps. */}
      <div className="absolute right-4 bottom-32 flex flex-col gap-3">
        {/* LIKE — toggles explicitLike on preferenceStore. Persisted, shows
            in Library's liked filter, feeds behavior rerank. */}
        <button
          className="w-12 h-12 rounded-full backdrop-blur-sm flex items-center justify-center pointer-events-auto transition-colors"
          style={{
            background: isLiked ? 'rgba(236,72,153,0.35)' : 'rgba(0,0,0,0.35)',
            border: `1px solid ${isLiked ? 'rgba(236,72,153,0.7)' : 'rgba(255,255,255,0.1)'}`,
            boxShadow: isLiked ? '0 0 16px -4px rgba(236,72,153,0.5)' : 'none',
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleLikeToggle();
          }}
          aria-label={isLiked ? 'Unlike' : 'Like'}
        >
          <Heart
            className="w-5 h-5"
            style={{
              color: isLiked ? '#f472b6' : 'rgba(255,255,255,0.85)',
              fill: isLiked ? '#f472b6' : 'none',
            }}
          />
        </button>

        {/* BOOST — download to local cache (offline) + engage EQ profile.
            Uses the existing floating variant so visuals match the rest of
            the app (priming ring, completion burst, sparks). */}
        <div className="pointer-events-auto">
          <BoostButton variant="floating" />
        </div>
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

            {/* Center Controls — wrapper is pointer-events-none (covers inset-0
                for layout, NOT for hit-testing), each button re-enables auto
                so only the visible circles capture taps. Rest of the center
                area stays transparent to underlying search controls. */}
            <div className="absolute inset-0 flex items-center justify-center gap-8 pointer-events-none">
              {/* Previous */}
              <button
                className="p-4 rounded-full bg-black/30 backdrop-blur-sm pointer-events-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  prevTrack();
                  }}
              >
                <SkipBack className="w-8 h-8 text-white" fill="white" />
              </button>

              {/* Play/Pause */}
              <button
                className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center pointer-events-auto"
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
                className="p-4 rounded-full bg-black/30 backdrop-blur-sm pointer-events-auto"
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
