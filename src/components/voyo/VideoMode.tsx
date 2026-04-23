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
 * - Controls stay always visible (tap directly to play/skip/exit)
 * - Inline: Like (explicit preference) + Boost (offline cache + EQ)
 */

import { useRef, useEffect, useCallback } from 'react';
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

  // Explicit like — toggles a persisted preference flag, not a moment-reaction.
  const trackPreferences = usePreferenceStore(s => s.trackPreferences);
  const setExplicitLike = usePreferenceStore(s => s.setExplicitLike);
  const isLiked = !!(currentTrack && trackPreferences[currentTrack.id]?.explicitLike === true);
  // FIX: Derive mute state from volume instead of separate state
  const isMuted = volume === 0;
  const previousVolume = useRef(volume > 0 ? volume : 80); // Default to 80 if currently muted

  // Controls stay always visible. We removed the full-screen tap surface
  // (it was covering search buttons beneath the overlay), which means
  // there's no way to summon hidden controls back — so "auto-hide + tap
  // anywhere to reveal" is no longer safe. Keep them on: the controls are
  // quiet enough (semi-transparent circles) that they don't steal the
  // video, and the user can actually, you know, use them.

  // Toggle the explicit like on the current track (persisted).
  const handleLikeToggle = useCallback(() => {
    if (!currentTrack) return;
    setExplicitLike(currentTrack.id, !isLiked);
  }, [currentTrack, isLiked, setExplicitLike]);

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

      {/* Track Info + inline actions — tucked into one bottom-left cluster.
          Title / artist / actions all read as a single block, so the right
          rail is gone and the video frame stays clean. Actions are small
          subtle chips, not floating circles — they feel like part of the
          title card, not a control surface fighting the video for space. */}
      <div className="absolute bottom-24 left-6 right-6 flex items-end justify-between gap-4 pointer-events-none">
        <div className="min-w-0 flex-1">
          <h2 className="text-white text-2xl font-bold shadow-lg truncate">{currentTrack.title}</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-white/70 text-sm truncate">{currentTrack.artist}</p>
            <span className="text-white/25 text-xs flex-shrink-0">·</span>
            {/* LIKE — small inline chip. Pink fill when liked, faint outline
                otherwise. Toggles preferenceStore.explicitLike (persisted). */}
            <button
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 pointer-events-auto transition-colors active:scale-90"
              style={{
                background: isLiked ? 'rgba(236,72,153,0.30)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${isLiked ? 'rgba(236,72,153,0.55)' : 'rgba(255,255,255,0.10)'}`,
              }}
              onClick={(e) => { e.stopPropagation(); handleLikeToggle(); }}
              aria-label={isLiked ? 'Unlike' : 'Like'}
            >
              <Heart
                className="w-3.5 h-3.5"
                style={{
                  color: isLiked ? '#f472b6' : 'rgba(255,255,255,0.75)',
                  fill: isLiked ? '#f472b6' : 'none',
                }}
              />
            </button>
            {/* BOOST — existing mini variant (w-8 h-8) fits the inline chip row. */}
            <div className="pointer-events-auto flex-shrink-0">
              <BoostButton variant="mini" />
            </div>
          </div>
        </div>
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

      {/* Overlay Controls — always visible (see comment above on why the
          auto-hide + tap-to-reveal behaviour was removed). */}
      <div className="absolute inset-0 pointer-events-none">
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
        {/* Hint text removed — previously advertised swipe / double-tap /
            triple-tap gestures that weren't actually implemented. */}
      </div>
    </div>
  );
};

export default VideoMode;
