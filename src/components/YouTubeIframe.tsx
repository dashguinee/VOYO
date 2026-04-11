/**
 * VOYO Music - Single Source of Truth YouTube Iframe
 *
 * ONE iframe that handles everything:
 * - Audio streaming (unmuted when not boosted)
 * - Video display in 3 modes:
 *   - hidden: offscreen (audio only)
 *   - portrait: overlay on BigCenterCard area (208x208 centered)
 *   - landscape: fullscreen
 *
 * NEVER unmounts - CSS positioning changes only
 */

import { useEffect, useRef, useCallback, memo, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { markTrackAsFailed } from '../services/trackVerifier';
import { devLog } from '../utils/logger';

const YT_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

function getYouTubeId(trackId: string): string {
  if (!trackId) return '';
  if (trackId.startsWith('VOYO_')) return trackId.replace('VOYO_', '');
  if (trackId.startsWith('vyo_')) {
    try {
      const encoded = trackId.substring(4);
      let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4 !== 0) base64 += '=';
      const decoded = atob(base64);
      if (decoded.length === 11 && /^[a-zA-Z0-9_-]+$/.test(decoded)) return decoded;
    } catch (e) {}
  }
  return trackId;
}

export const YouTubeIframe = memo(() => {
  const playerRef = useRef<YT.Player | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isApiLoadedRef = useRef(false);
  const currentVideoIdRef = useRef<string | null>(null);
  const initializingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const playbackSource = usePlayerStore((s) => s.playbackSource);
  const videoTarget = usePlayerStore((s) => s.videoTarget);
  const seekPosition = usePlayerStore((s) => s.seekPosition);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const queue = usePlayerStore((s) => s.queue);

  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const setBufferHealth = usePlayerStore((s) => s.setBufferHealth);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const clearSeekPosition = usePlayerStore((s) => s.clearSeekPosition);
  const setVideoTarget = usePlayerStore((s) => s.setVideoTarget);

  const youtubeId = currentTrack?.trackId ? getYouTubeId(currentTrack.trackId) : '';

  // Overlay timing state
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [showNextUp, setShowNextUp] = useState(false);
  const [showPortraitNextUp, setShowPortraitNextUp] = useState(false); // Full-cover thumbnail for portrait
  const [isDragging, setIsDragging] = useState(false);
  const upcomingTrack = queue[0]?.track || null;


  // Update overlay visibility based on playback time
  useEffect(() => {
    if (videoTarget === 'hidden') {
      setShowNowPlaying(false);
      setShowNextUp(false);
      setShowPortraitNextUp(false);
      return;
    }
    // Now Playing: first 5 seconds
    setShowNowPlaying(currentTime < 5 && currentTime > 0);
    // Next Up: 45-55% or last 20 seconds
    const timeRemaining = duration - currentTime;
    const midTrack = currentTime > 30 && duration > 60 && currentTime >= duration * 0.45 && currentTime < duration * 0.55;
    const endTrack = timeRemaining > 0 && timeRemaining < 20;
    setShowNextUp((midTrack || endTrack) && !!upcomingTrack);

    // Portrait: Full thumbnail takeover in last 8 seconds (YouTube shows at ~5s)
    // Disguised as intentional "Up Next" preview - not blocking, featuring!
    const portraitEndZone = timeRemaining > 0 && timeRemaining < 8;
    setShowPortraitNextUp(videoTarget === 'portrait' && portraitEndZone && !!upcomingTrack);
  }, [currentTime, duration, videoTarget, upcomingTrack]);

  // Load YouTube API once
  useEffect(() => {
    if (isApiLoadedRef.current || (window as any).YT?.Player) {
      isApiLoadedRef.current = true;
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    (window as any).onYouTubeIframeAPIReady = () => {
      isApiLoadedRef.current = true;
      if (youtubeId) initPlayer(youtubeId);
    };
  }, []);

  const initPlayer = useCallback((videoId: string) => {
    if (!isApiLoadedRef.current || !(window as any).YT?.Player) return;
    if (!containerRef.current) return;
    if (initializingRef.current) return;
    if (playerRef.current && currentVideoIdRef.current === videoId) return;

    initializingRef.current = true;
    currentVideoIdRef.current = videoId;

    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) {}
      playerRef.current = null;
    }

    containerRef.current.innerHTML = '';
    const ps = usePlayerStore.getState().playbackSource;
    const isBoosted = ps === 'cached' || ps === 'r2';

    playerRef.current = new (window as any).YT.Player(containerRef.current, {
      width: '100%',
      height: '100%',
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        fs: 0,
        iv_load_policy: 3,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        showinfo: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: (e: any) => {
          initializingRef.current = false;
          const store = usePlayerStore.getState();
          const psNow = store.playbackSource;
          const isBoostedNow = psNow === 'cached' || psNow === 'r2';
          const videoNeeded = store.videoTarget !== 'hidden';

          if (isBoostedNow) {
            e.target.mute();
            // DOUBLE STREAMING FIX: Don't auto-play video when boosted + hidden
            if (!videoNeeded) {
              devLog('[YouTubeIframe] Skipping video playback (boosted + hidden)');
              e.target.pauseVideo?.();
              return;
            }
          } else {
            e.target.unMute();
            e.target.setVolume(volume * 100);
          }
          const dur = e.target.getDuration?.() || 0;
          if (dur > 0) setDuration(dur);
          if (store.isPlaying) {
            e.target.playVideo();
          }
        },
        onStateChange: (e: any) => {
          if (e.data === YT_STATES.ENDED) {
            nextTrack();
          }
        },
        onError: (e: any) => {
          const errorCode = e.data;
          initializingRef.current = false;

          // YouTube iframe error codes:
          //   2   = invalid param
          //   5   = HTML5 playback error
          //   100 = video not found / removed
          //   101 = embedding disabled by uploader
          //   150 = embedding disabled (region-restricted, age-gated, private)
          //
          // PREVIOUS BEHAVIOR: blanket-skip to next track on 100/101/150.
          // That destroyed playback for any region-restricted track — user
          // loses the song they came for, even though the audio URL might
          // be perfectly valid from R2 / cache.
          //
          // NEW BEHAVIOR:
          //   100      → video genuinely gone, skip is correct
          //   101/150  → video can't EMBED but the AUDIO might still play
          //              from cached / R2 / iframe-source. If playback source
          //              is non-iframe, keep the music, hide the video, let
          //              the album-art backdrop take over gracefully.
          const store = usePlayerStore.getState();
          const audioAlive = store.playbackSource === 'cached' || store.playbackSource === 'r2';

          if (errorCode === 100) {
            // Genuinely unavailable — track gone
            console.warn('[YouTubeIframe] Video not found:', videoId);
            if (videoId) markTrackAsFailed(videoId, errorCode);
            setTimeout(() => nextTrack(), 500);
            return;
          }

          if (errorCode === 101 || errorCode === 150) {
            // Embedding blocked (region / age-gate / embedding disabled).
            // If audio is already flowing from another source, keep the music,
            // fall back to backdrop-only. Otherwise we have no choice but to skip.
            if (audioAlive) {
              devLog('[YouTubeIframe] Embed blocked — falling back to backdrop, audio continues');
              // Signal blocked state so the player auto-shows FullscreenBackground
              store.setVideoBlocked(true);
              store.setVideoTarget('hidden');
              // Do NOT mark as failed — the track is fine, it's just the embed
              return;
            }
            // Audio source is iframe itself AND iframe blocked → nothing to play
            console.warn('[YouTubeIframe] Embed blocked, no alternative source:', videoId);
            if (videoId) markTrackAsFailed(videoId, errorCode);
            setTimeout(() => nextTrack(), 500);
            return;
          }

          // Any other error: log quietly, don't spam the console
          devLog('[YouTubeIframe] Player error (ignored):', errorCode);
        },
      },
    });
  }, [volume, nextTrack, setDuration]);

  // Init player when track changes — also clear any prior videoBlocked flag
  // so each new track starts with a fresh "video is fine until proven otherwise" state.
  useEffect(() => {
    if (youtubeId) {
      usePlayerStore.getState().setVideoBlocked(false);
      if (isApiLoadedRef.current) initPlayer(youtubeId);
    }
  }, [youtubeId, initPlayer]);

  // Play/Pause sync
  // DOUBLE STREAMING FIX: When using cached/r2 audio with hidden video, pause iframe to save bandwidth
  // Only stream video when: (1) iframe is the audio source, OR (2) video is visible
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.getPlayerState) return;

    const state = player.getPlayerState();
    const isBoosted = playbackSource === 'cached' || playbackSource === 'r2';
    const videoNeeded = videoTarget !== 'hidden';

    // If we're boosted AND video is hidden, pause iframe to prevent double streaming
    if (isBoosted && !videoNeeded) {
      if (state === YT_STATES.PLAYING || state === YT_STATES.BUFFERING) {
        devLog('[YouTubeIframe] Pausing hidden video to prevent double streaming');
        player.pauseVideo?.();
      }
      return;
    }

    // Normal sync: play/pause based on isPlaying state
    if (isPlaying && state !== YT_STATES.PLAYING) {
      player.playVideo?.();
    } else if (!isPlaying && state === YT_STATES.PLAYING) {
      player.pauseVideo?.();
    }
  }, [isPlaying, playbackSource, videoTarget]);

  // Volume sync (only when not boosted/r2)
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.setVolume || playbackSource === 'cached' || playbackSource === 'r2') return;
    player.setVolume(volume * 100);
  }, [volume, playbackSource]);

  // Mute/unmute based on boost status (cached or r2 = muted for video-only sync)
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.mute) return;
    if (playbackSource === 'cached' || playbackSource === 'r2') {
      player.mute();
    } else {
      player.unMute();
      player.setVolume?.(volume * 100);
    }
  }, [playbackSource, volume]);

  // VIDEO MODE ACTIVATION: Resume video playback when user explicitly shows video
  // This handles the case: boosted audio + hidden video → user clicks video button
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.getPlayerState || !player?.playVideo) return;

    const isBoosted = playbackSource === 'cached' || playbackSource === 'r2';
    const videoShown = videoTarget !== 'hidden';

    // When video is shown while boosted, start playing the (muted) video for visual sync
    if (isBoosted && videoShown && isPlaying) {
      const state = player.getPlayerState();
      if (state !== YT_STATES.PLAYING) {
        devLog('[YouTubeIframe] Resuming video for visual sync (user requested video)');
        player.playVideo();

        // Sync position with audio
        const audioTime = usePlayerStore.getState().currentTime;
        if (audioTime > 2) {
          player.seekTo?.(audioTime, true);
        }
      }
    }
  }, [videoTarget, playbackSource, isPlaying]);

  // Seek handling
  useEffect(() => {
    if (seekPosition === null) return;
    const player = playerRef.current;
    if (player?.seekTo) {
      player.seekTo(seekPosition, true);
      clearSeekPosition();
    }
  }, [seekPosition, clearSeekPosition]);

  // Fallback sync: When boosted/r2, video should follow audio (not vice versa)
  // Only kicks in if drift exceeds threshold - YouTube rarely buffers
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !isPlaying) return;

    const DRIFT_THRESHOLD = 2; // seconds - only sync if drift is noticeable
    const CHECK_INTERVAL = 5000; // check every 5 seconds

    const syncInterval = setInterval(() => {
      const player = playerRef.current;
      if (!player?.getCurrentTime || !player?.seekTo) return;

      const videoTime = player.getCurrentTime() || 0;
      const audioTime = currentTime; // From store (audio is updating this)
      const drift = Math.abs(videoTime - audioTime);

      if (drift > DRIFT_THRESHOLD) {
        devLog(`[YouTubeIframe] Drift detected: ${drift.toFixed(1)}s - syncing video to audio`);
        player.seekTo(audioTime, true);
      }
    }, CHECK_INTERVAL);

    return () => clearInterval(syncInterval);
  }, [playbackSource, isPlaying, currentTime]);

  // Time update interval (only when streaming from iframe)
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (playbackSource !== 'iframe' || !isPlaying) return;

    intervalRef.current = setInterval(() => {
      const player = playerRef.current;
      if (!player?.getCurrentTime || !player?.getDuration) return;
      const time = player.getCurrentTime() || 0;
      const dur = player.getDuration() || 0;
      if (dur > 0) {
        setCurrentTime(time);
        setProgress((time / dur) * 100);
        setDuration(dur);
        const buffered = player.getVideoLoadedFraction?.() || 0;
        setBufferHealth(Math.round(buffered * 100), 'healthy');
      }
    }, 250);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playbackSource, isPlaying, setCurrentTime, setProgress, setDuration, setBufferHealth]);

  // Container styles based on videoTarget
  const getContainerStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      overflow: 'hidden',
      background: '#000',
      transition: 'all 0.3s ease-out',
    };

    if (videoTarget === 'landscape') {
      return {
        ...base,
        inset: 0,
        zIndex: 40,
      };
    }

    if (videoTarget === 'portrait' && isPlaying) {
      // Center over BigCenterCard area
      return {
        position: 'fixed',
        overflow: 'hidden',
        background: '#000',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '208px',
        height: '208px',
        borderRadius: '2rem',
        zIndex: 60,
        opacity: 1,
      };
    }

    // Hidden - offscreen for audio streaming
    return {
      ...base,
      bottom: '-200px',
      right: '-200px',
      width: '160px',
      height: '90px',
      zIndex: -1,
      opacity: 0,
      pointerEvents: 'none',
      transition: 'opacity 0.15s ease-out',
    };
  };

  // Video styles (zoom to hide YouTube branding)
  const getVideoStyle = (): React.CSSProperties => {
    const zoom = videoTarget === 'landscape' ? 1.2 : 2;
    return {
      width: '100%',
      height: '100%',
      transform: `scale(${zoom})`,
      transformOrigin: 'center center',
      pointerEvents: 'none',
    };
  };

  const showOverlays = videoTarget !== 'hidden' && isPlaying;

  // Portrait mode: draggable
  const isPortraitMode = videoTarget === 'portrait' && isPlaying;

  return (
    <div
      style={getContainerStyle()}
    >
      {/* Video container */}
      <div style={getVideoStyle()}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Tap to close - portrait only (uses onTap to not fire on drag) */}
      {isPortraitMode && (
        <div
          onClick={() => setVideoTarget('hidden')}
          style={{
            position: 'absolute',
            inset: 0,
            cursor: 'grab',
            zIndex: 5,
          }}
        />
      )}

      {/* Purple overlays */}
      {showOverlays && (
        <>
          {/* Gentle full-card purple tint */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 9,
              background: 'rgba(139, 92, 246, 0.04)',
            }}
          />
          {/* Top gradient */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 10,
              background: 'linear-gradient(to bottom, rgba(88,28,135,0.7) 0%, transparent 30%)',
              animation: 'fadeIn 1s ease-out',
            }}
          />
          {/* Bottom gradient */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 10,
              background: 'linear-gradient(to top, rgba(88,28,135,0.8) 0%, transparent 35%)',
              animation: 'fadeIn 1s ease-out',
            }}
          />
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}</style>
        </>
      )}

      {/* Now Playing overlay */}
      {showOverlays && showNowPlaying && currentTrack && (
        <div
          style={{
            position: 'absolute',
            top: videoTarget === 'landscape' ? 24 : 12,
            left: videoTarget === 'landscape' ? 24 : 12,
            right: videoTarget === 'landscape' ? 24 : 12,
            zIndex: 15,
            pointerEvents: 'none',
          }}
        >
          <p style={{ color: 'rgba(216,180,254,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 500, marginBottom: 2 }}>
            Now Playing
          </p>
          <p style={{ color: 'white', fontWeight: 'bold', fontSize: videoTarget === 'landscape' ? 18 : 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentTrack.title}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: videoTarget === 'landscape' ? 14 : 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentTrack.artist}
          </p>
        </div>
      )}

      {/* Next Up overlay */}
      {showOverlays && showNextUp && !showNowPlaying && upcomingTrack && (
        <div
          style={{
            position: 'absolute',
            top: videoTarget === 'landscape' ? 24 : 12,
            left: videoTarget === 'landscape' ? 24 : 12,
            right: videoTarget === 'landscape' ? 24 : 12,
            zIndex: 15,
            pointerEvents: 'none',
          }}
        >
          <p style={{ color: 'rgba(251,191,36,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 500, marginBottom: 2 }}>
            Next Up
          </p>
          <p style={{ color: 'white', fontWeight: 'bold', fontSize: videoTarget === 'landscape' ? 18 : 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {upcomingTrack.title}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: videoTarget === 'landscape' ? 14 : 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {upcomingTrack.artist}
          </p>
        </div>
      )}

      {/* Bottom track info */}
      {showOverlays && currentTrack && (
        <div
          style={{
            position: 'absolute',
            bottom: videoTarget === 'landscape' ? 80 : 12,
            left: videoTarget === 'landscape' ? 24 : 12,
            right: videoTarget === 'landscape' ? 24 : 12,
            zIndex: 15,
            pointerEvents: 'none',
          }}
        >
          <p style={{ color: 'white', fontWeight: 'bold', fontSize: videoTarget === 'landscape' ? 20 : 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentTrack.title}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: videoTarget === 'landscape' ? 16 : 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentTrack.artist}
          </p>
        </div>
      )}

      {/* Portrait: drag/tap hint */}
      {isPortraitMode && !showPortraitNextUp && (
        <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', zIndex: 15, pointerEvents: 'none' }}>
          <p style={{ color: isDragging ? 'rgba(139,92,246,0.8)' : 'rgba(255,255,255,0.4)', fontSize: 8, transition: 'color 0.2s' }}>
            {isDragging ? '📱 Rotate phone for FULL Vibes' : 'Drag to move • Tap to close'}
          </p>
        </div>
      )}

      {/* Portrait: Full "Up Next" thumbnail takeover - covers YouTube suggestions intentionally */}
      {showPortraitNextUp && upcomingTrack && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            borderRadius: '2rem',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Next track thumbnail as background */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${upcomingTrack.coverUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'brightness(0.7)',
            }}
          />
          {/* Purple gradient overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to bottom, rgba(88,28,135,0.4) 0%, rgba(88,28,135,0.8) 100%)',
            }}
          />
          {/* Content */}
          <div style={{ position: 'relative', zIndex: 5, textAlign: 'center', padding: 16 }}>
            <p style={{ color: 'rgba(251,191,36,0.9)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 600, marginBottom: 8 }}>
              Up Next
            </p>
            <p style={{ color: 'white', fontWeight: 'bold', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
              {upcomingTrack.title}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 }}>
              {upcomingTrack.artist}
            </p>
          </div>
        </div>
      )}

      {/* No X button in landscape - LandscapeVOYO controls handle navigation */}
    </div>
  );
});

YouTubeIframe.displayName = 'YouTubeIframe';
export default YouTubeIframe;
