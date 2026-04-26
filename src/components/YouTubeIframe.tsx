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

import { useEffect, useRef, useCallback, memo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { iframeBridge } from '../player/iframeBridge';
import { markTrackAsFailed } from '../services/trackVerifier';
import { logPlaybackEvent } from '../services/telemetry';
import { devLog } from '../utils/logger';

const YT_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

// Default position of the floating portrait player, relative to screen
// center. Nudged 12px left so it stops masking the right edge of
// "Discover" in the Portrait layout — at true center, the rounded
// corner was clipping the Discover shelf visually. Drag still overrides.
const DEFAULT_PORTRAIT_POS = { x: -12, y: 0 };

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

// OverlayTimingSync — renders null. Subscribes to currentTime at 4Hz,
// computes overlay visibility states, writes to parent ONLY on zone
// transitions. Prevents the entire YouTubeIframe tree from re-rendering
// at the store-write cadence.
const OverlayTimingSync = memo(({
  videoTarget,
  upcomingTrack,
  setShowNowPlaying,
  setShowNextUp,
  setShowPortraitNextUp,
}: {
  videoTarget: string;
  upcomingTrack: any;
  setShowNowPlaying: Dispatch<SetStateAction<boolean>>;
  setShowNextUp: Dispatch<SetStateAction<boolean>>;
  setShowPortraitNextUp: Dispatch<SetStateAction<boolean>>;
}) => {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const lastRef = useRef({ np: false, nu: false, pnu: false });

  useEffect(() => {
    if (videoTarget === 'hidden') {
      if (lastRef.current.np || lastRef.current.nu || lastRef.current.pnu) {
        setShowNowPlaying(false);
        setShowNextUp(false);
        setShowPortraitNextUp(false);
        lastRef.current = { np: false, nu: false, pnu: false };
      }
      return;
    }
    // > 1s avoids the frame where currentTime ticks from 0 → 0.x right at
    // the track boundary, which produced a 1-frame flash overlapping the
    // outgoing "Next Up" card and the incoming "Vibing right" badge.
    const np = currentTime >= 1 && currentTime < 5;
    const timeRemaining = duration - currentTime;
    const midTrack = currentTime > 30 && duration > 60 && currentTime >= duration * 0.45 && currentTime < duration * 0.55;
    const endTrack = timeRemaining > 0 && timeRemaining < 20;
    const nu = (midTrack || endTrack) && !!upcomingTrack;
    const portraitEndZone = timeRemaining > 0 && timeRemaining < 8;
    const pnu = videoTarget === 'portrait' && portraitEndZone && !!upcomingTrack;

    const prev = lastRef.current;
    if (prev.np !== np) { setShowNowPlaying(np); }
    if (prev.nu !== nu) { setShowNextUp(nu); }
    if (prev.pnu !== pnu) { setShowPortraitNextUp(pnu); }
    lastRef.current = { np, nu, pnu };
  }, [currentTime, duration, videoTarget, upcomingTrack, setShowNowPlaying, setShowNextUp, setShowPortraitNextUp]);

  return null;
});
OverlayTimingSync.displayName = 'OverlayTimingSync';

export const YouTubeIframe = memo(() => {
  const playerRef = useRef<YT.Player | null>(null);
  // mountRef is the STABLE parent. YT.Player(target) REPLACES `target` with
  // an iframe element — if we hand it our React-controlled ref directly, the
  // ref ends up pointing at the iframe (or an orphaned div) and the next
  // re-init attaches a player to a dead node. Each init now creates a fresh
  // child div inside mountRef and feeds THAT to YT.Player, so the parent
  // mount point is invariant across destroy/init cycles.
  const mountRef = useRef<HTMLDivElement>(null);
  const isApiLoadedRef = useRef(false);
  const currentVideoIdRef = useRef<string | null>(null);
  // Pending videoId when initPlayer is called while a previous init is in
  // flight (initializingRef.current === true). Without this, a rapid track
  // skip A→B left initPlayer(B) silently no-op, currentVideoIdRef stuck at
  // A, and the on-screen player stuck on track A while audio played track B.
  // (audit-2 P0-IF-1) On A's onReady/onError we drain pendingVideoIdRef
  // and re-call initPlayer for B.
  const pendingVideoIdRef = useRef<string | null>(null);
  const initializingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initPlayerRef = useRef<((id: string) => void) | null>(null);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const playbackSource = usePlayerStore((s) => s.playbackSource);
  const videoTarget = usePlayerStore((s) => s.videoTarget);
  const playerCompact = usePlayerStore((s) => s.playerCompact);
  const seekPosition = usePlayerStore((s) => s.seekPosition);
  // currentTime/duration not subscribed here — OverlayTimingSync (render-null sub-component)
  // computes overlay zones and writes only on zone transitions (~1-2x per track, not 4Hz).
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
  // Landscape fades auto-mute after a short dwell: the purple top/bottom
  // gradients fade heavy-then-light so the "just entered" moment is
  // framed, but after ~3s the video breathes — fade heights shrink and
  // opacity eases so the content owns the screen.
  const [landscapeFadeMuted, setLandscapeFadeMuted] = useState(false);
  useEffect(() => {
    if (videoTarget !== 'landscape') {
      setLandscapeFadeMuted(false);
      return;
    }
    const t = setTimeout(() => setLandscapeFadeMuted(true), 3200);
    return () => clearTimeout(t);
  }, [videoTarget]);
  const upcomingTrack = queue[0]?.track || null;


  // Overlay visibility is driven by OverlayTimingSync (renders null,
  // subscribes to currentTime, writes to state only on zone transitions).
  // See the <OverlayTimingSync> in the render tree below.

  // Load YouTube API once — deferred until first user gesture.
  // Loading www-widgetapi.js immediately on mount causes:
  //   1. AudioContext warning (YouTube's API creates audio infrastructure before gesture)
  //   2. postMessage SecurityError (iframe navigates to about:blank before YouTube URL)
  // After any user interaction the gesture requirement is satisfied, so defer is safe.
  useEffect(() => {
    const loadApi = () => {
      if (isApiLoadedRef.current || window.YT?.Player) {
        isApiLoadedRef.current = true;
        return;
      }
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => {
        isApiLoadedRef.current = true;
        const store = usePlayerStore.getState();
        const trackId = store.currentTrack?.trackId;
        // Don't create player if VPS is active and video isn't needed —
        // would immediately enter the polling loop we're trying to avoid.
        const isBoosted = store.playbackSource === 'cached' || store.playbackSource === 'r2';
        if (trackId && !(isBoosted && store.videoTarget === 'hidden')) {
          initPlayerRef.current?.(getYouTubeId(trackId));
        }
      };
    };

    // If API already present (e.g. hot reload), mark loaded immediately
    if (window.YT?.Player) { isApiLoadedRef.current = true; return; }

    const onGesture = () => {
      document.removeEventListener('click', onGesture);
      document.removeEventListener('touchstart', onGesture);
      loadApi();
    };
    document.addEventListener('click', onGesture, { passive: true });
    document.addEventListener('touchstart', onGesture, { passive: true });
    return () => {
      document.removeEventListener('click', onGesture);
      document.removeEventListener('touchstart', onGesture);
    };
  }, []);

  // Destroy the YouTube player when VPS is active and video is hidden.
  // Previously we only muted+paused it, which left it in YouTube's internal
  // polling registry. www-widgetapi.js setInterval kept sending postMessage to
  // the muted iframe — when the origin didn't match it threw SecurityError and
  // YouTube's state machine fired spurious PAUSED events, causing playback to
  // stutter. Destroying removes the player from the registry entirely.
  useEffect(() => {
    const isBoosted = playbackSource === 'cached' || playbackSource === 'r2';
    if (isBoosted && videoTarget === 'hidden' && playerRef.current) {
      try { playerRef.current.destroy(); } catch {}
      playerRef.current = null;
      iframeBridge.register(null);
      currentVideoIdRef.current = null;
      // (audit-2 P0-IF-2) Drain initializingRef. If destroy fires WHILE
      // a `new YT.Player()` is in flight (onReady not yet called), the
      // ref would stay true forever and brick every subsequent init for
      // the rest of the session. Clear it here so the next initPlayer
      // call can proceed.
      initializingRef.current = false;
      pendingVideoIdRef.current = null;
      if (mountRef.current) mountRef.current.innerHTML = '';
    }
  }, [playbackSource, videoTarget]);

  const initPlayer = useCallback((videoId: string) => {
    if (!isApiLoadedRef.current || !window.YT?.Player) return;
    if (!mountRef.current) return;
    if (initializingRef.current) {
      // Don't drop the request — record the latest desired videoId so
      // onReady/onError can drain it once the in-flight init settles.
      // (audit-2 P0-IF-1)
      pendingVideoIdRef.current = videoId;
      return;
    }
    if (playerRef.current && currentVideoIdRef.current === videoId) return;

    initializingRef.current = true;
    currentVideoIdRef.current = videoId;

    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) {}
      playerRef.current = null;
      iframeBridge.register(null);
    }

    // Fresh target div per init. YT.Player swaps this element for an
    // iframe; mountRef stays the stable parent across re-inits.
    mountRef.current.innerHTML = '';
    const target = document.createElement('div');
    target.style.cssText = 'width:100%;height:100%;';
    mountRef.current.appendChild(target);

    const ps = usePlayerStore.getState().playbackSource;
    const isBoosted = ps === 'cached' || ps === 'r2';

    playerRef.current = new window.YT.Player(target, {
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
          // Drain any pending init request that arrived while we were
          // racing. If the user skipped A→B before A's onReady fired,
          // pendingVideoIdRef holds B; recurse so B gets its own player.
          // (audit-2 P0-IF-1)
          const pendingId = pendingVideoIdRef.current;
          if (pendingId && pendingId !== videoId) {
            pendingVideoIdRef.current = null;
            // Tear down A immediately — we're about to build B's player.
            try { e.target?.destroy?.(); } catch {}
            playerRef.current = null;
            iframeBridge.register(null);
            currentVideoIdRef.current = null;
            initPlayerRef.current?.(pendingId);
            return;
          }
          pendingVideoIdRef.current = null;
          // Defensive: YT can fire onReady against a player we already
          // destroyed in the destroy effect (rare but observed). Skip
          // bridge registration if our local ref doesn't agree this is
          // the live player. (audit-2 P0-IF-2 follow-up)
          if (!playerRef.current || !e?.target?.getPlayerState) return;
          // Register the player on the bridge so AudioPlayer can read
          // iframe currentTime + fade volume during the iframe→R2 hot-swap.
          iframeBridge.register(e.target);
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
            // OYO never stops. The only question is who fires the advance.
            //
            // If playbackSource is 'iframe' the iframe IS the audio source, so
            // its ENDED is authoritative — advance immediately.
            //
            // If playbackSource is 'r2'/'cached' the audio element owns
            // playback and its own 'ended' event (AudioPlayer.handleEnded)
            // normally fires the advance. But that event can misfire — blocked
            // autoplay, iOS BG throttle, short/incomplete R2 stream, stalled
            // element. Previous guard simply ignored ENDED in this case,
            // producing the "app stops after one song" stall whenever audio's
            // 'ended' didn't reach us.
            //
            // New behaviour: watchdog. 3s after iframe ENDED, if currentTrack
            // hasn't changed AND the audio element is actually finished (near
            // its duration or paused), force nextTrack. If audio was still
            // playing healthily past the iframe's end — R2 file slightly
            // longer than the iframe video — the watchdog leaves it alone so
            // the user hears the full track.
            // iframe is video-only: audio element always owns advancement.
            // Watchdog: 3s after iframe ENDED, if audio hasn't advanced,
            // force nextTrack as a safety net (R2 file ended but no event).
            const store = usePlayerStore.getState();
            const trackAtEnd = store.currentTrack?.trackId ?? null;
            // Snapshot audio state at the moment iframe ENDED fires. The
            // watchdog only force-advances if audio has meaningfully
            // progressed PAST this snapshot (i.e. it actually played to
            // its own end) — a brand-new near-end audio element freshly
            // hot-swapped in at 97% will otherwise trigger a false
            // positive on the currentTime/duration > 0.98 guard and skip
            // the user past a track they were about to finish.
            const audioElAtEnd = document.querySelector('audio');
            const currentTimeAtIframeEnd = audioElAtEnd?.currentTime ?? 0;
            const durationAtIframeEnd = audioElAtEnd?.duration ?? 0;
            const MIN_AUDIO_ADVANCE_S = 2;
            setTimeout(() => {
              const now = usePlayerStore.getState().currentTrack?.trackId ?? null;
              if (!now || now !== trackAtEnd) return; // audio already advanced
              const audioEl = document.querySelector('audio');
              // Paused / ended / no element => audio is truly done: force advance.
              const audioHalted = !audioEl || audioEl.paused || audioEl.ended;
              // Otherwise only fire if the audio element has played meaningfully
              // past where it was at iframe-end AND is near its own end. This
              // distinguishes "played to its end naturally" (advance by >=2s
              // since the snapshot) from "started near end due to a
              // position-matched hotswap" (little-to-no advance).
              const advanced = audioEl
                ? (audioEl.currentTime - currentTimeAtIframeEnd) >= MIN_AUDIO_ADVANCE_S
                : false;
              const nearEnd = !!audioEl && audioEl.duration > 0
                && audioEl.currentTime / audioEl.duration > 0.98;
              const audioFinished = audioHalted || (advanced && nearEnd);
              if (audioFinished) {
                devLog('[YouTubeIframe] ENDED watchdog — audio did not advance, forcing nextTrack');
                logPlaybackEvent({
                  event_type: 'skip_auto',
                  track_id: trackAtEnd,
                  meta: {
                    reason: 'iframe_ended_watchdog_fired',
                    audio_paused: audioEl?.paused ?? null,
                    audio_ended: audioEl?.ended ?? null,
                    audio_duration: audioEl?.duration ?? null,
                    audio_current: audioEl?.currentTime ?? null,
                    current_at_iframe_end: currentTimeAtIframeEnd,
                    duration_at_iframe_end: durationAtIframeEnd,
                    advanced_s: audioEl
                      ? audioEl.currentTime - currentTimeAtIframeEnd
                      : null,
                  },
                });
                nextTrack();
              } else {
                // Benign stale ENDED (e.g. iframe ran out while hot-swap
                // left audio starting near-end). Log so telemetry can
                // measure how often we prevent the false positive.
                logPlaybackEvent({
                  event_type: 'trace',
                  track_id: trackAtEnd,
                  meta: {
                    subtype: 'iframe_ended_watchdog_suppressed',
                    audio_paused: audioEl?.paused ?? null,
                    audio_current: audioEl?.currentTime ?? null,
                    current_at_iframe_end: currentTimeAtIframeEnd,
                    advanced_s: audioEl
                      ? audioEl.currentTime - currentTimeAtIframeEnd
                      : null,
                  },
                });
              }
            }, 3000);
          }
        },
        onError: (e: any) => {
          const errorCode = e.data;
          initializingRef.current = false;
          // Drain pending init same as onReady — on error the in-flight
          // player is dead, but a track-skip B may be queued. (audit-2 P0-IF-1)
          const pendingId = pendingVideoIdRef.current;
          if (pendingId && pendingId !== videoId) {
            pendingVideoIdRef.current = null;
            try { e.target?.destroy?.(); } catch {}
            playerRef.current = null;
            iframeBridge.register(null);
            currentVideoIdRef.current = null;
            initPlayerRef.current?.(pendingId);
            return;
          }
          pendingVideoIdRef.current = null;

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
            devLog('[YouTubeIframe] Video not found:', videoId);
            if (videoId) markTrackAsFailed(videoId, errorCode);
            // Re-check on fire: if the hot-swap completed during this
            // 500ms window, don't skip away from a working track. Also
            // check that we're STILL on this track — user may have
            // manually skipped to another iframe-as-audio track during
            // the 500ms; without the trackId guard we'd nextTrack() the
            // newly-landed track. (audit-2 P1-IF-4)
            setTimeout(() => {
              const store = usePlayerStore.getState();
              const ps = store.playbackSource;
              if (ps === 'cached' || ps === 'r2') {
                devLog('[YouTubeIframe] 100 recovery skipped — hot-swap won');
                return;
              }
              const liveYtId = getYouTubeId(store.currentTrack?.trackId ?? '');
              if (liveYtId !== videoId) {
                devLog('[YouTubeIframe] 100 recovery skipped — user navigated away');
                return;
              }
              logPlaybackEvent({
                event_type: 'skip_auto',
                track_id: videoId || 'unknown',
                meta: { reason: 'yt_error_100', error_code: errorCode },
              });
              nextTrack();
            }, 500);
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
            devLog('[YouTubeIframe] Embed blocked, no alternative source:', videoId);
            if (videoId) markTrackAsFailed(videoId, errorCode);
            // Same re-check as the 100 path: hot-swap may have won the
            // race during the 500ms delay. Don't skip a newly-ready
            // track. Also trackId guard so a manual skip during the
            // 500ms can't get the wrong track skipped. (audit-2 P1-IF-4)
            setTimeout(() => {
              const store = usePlayerStore.getState();
              const ps = store.playbackSource;
              if (ps === 'cached' || ps === 'r2') {
                devLog('[YouTubeIframe] embed-blocked recovery skipped — hot-swap won');
                return;
              }
              const liveYtId = getYouTubeId(store.currentTrack?.trackId ?? '');
              if (liveYtId !== videoId) {
                devLog('[YouTubeIframe] embed-blocked recovery skipped — user navigated away');
                return;
              }
              logPlaybackEvent({
                event_type: 'skip_auto',
                track_id: videoId || 'unknown',
                meta: { reason: 'yt_error_embed_blocked', error_code: errorCode },
              });
              nextTrack();
            }, 500);
            return;
          }

          // Any other error: log quietly, don't spam the console
          devLog('[YouTubeIframe] Player error (ignored):', errorCode);
        },
      },
    });
  }, [volume, nextTrack, setDuration]);

  // Keep initPlayerRef current so the deferred API-load callback can always
  // call the latest initPlayer without creating a stale-closure dependency.
  useEffect(() => { initPlayerRef.current = initPlayer; }, [initPlayer]);

  // Init player when track changes — when video is visible OR when iframe
  // IS the audio source. Iframe-as-audio engages whenever R2 isn't ready
  // yet (warming-pill path, search/feed taps on uncached tracks); the
  // iframe stays hidden visually but carries audio until useHotSwap
  // migrates to R2.
  useEffect(() => {
    if (!youtubeId) return;
    usePlayerStore.getState().setVideoBlocked(false);
    const needsAudio = playbackSource === 'iframe';
    if (videoTarget === 'hidden' && !needsAudio) return;
    if (isApiLoadedRef.current) initPlayer(youtubeId);
  }, [youtubeId, videoTarget, playbackSource, initPlayer]);

  // On-demand player creation: user opened video mode OR iframe became audio source.
  useEffect(() => {
    if (!youtubeId || playerRef.current || !isApiLoadedRef.current) return;
    const needsAudio = playbackSource === 'iframe';
    if (videoTarget === 'hidden' && !needsAudio) return;
    initPlayer(youtubeId);
  }, [videoTarget, playbackSource, youtubeId, initPlayer]);

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
    // (audit-3) Gate on videoTarget — when hidden the iframe has no
    // visible video to drift-correct. The previous version mounted
    // this 1.5s interval for every R2 track regardless of whether the
    // video was on screen, burning ~40 seekTo polls/min for nothing
    // on the dominant pure-audio flow.
    if (videoTarget === 'hidden') return;

    // Loosened 2026-04-26: was 1.5s/0.6s. Each correction is a YT
    // seekTo() which causes a visible re-buffer "load" — the YT iframe
    // API has no smoother sync mechanism (setPlaybackRate only takes
    // discrete 0.25 steps, useless for fractional convergence). So the
    // best we can do is correct LESS often. 0.6s threshold caught almost
    // every drift; 1.5s only catches actually-noticeable offsets. Music
    // videos rarely lip-sync-critical so the tradeoff is worth it.
    const DRIFT_THRESHOLD = 1.5;
    const CHECK_INTERVAL = 2500;

    // CRITICAL: read currentTime via getState() inside the callback, NOT
    // from the closure. The previous version had `currentTime` in the dep
    // array, which made this useEffect re-run on every audio tick (5-10Hz).
    // Each re-run cleared and recreated the interval — meaning the 5s
    // drift check almost never actually fired (it was reset before reaching
    // its trigger time). Plus the constant create/clear churn was wasted
    // CPU on the main thread.
    const syncInterval = setInterval(() => {
      // Battery: skip drift work when tab is hidden — iframe is frozen
      // there anyway, and the seek() call would queue up against a stale
      // player. Mirrors the time-update interval guard below.
      if (document.hidden) return;
      const player = playerRef.current;
      if (!player?.getCurrentTime || !player?.seekTo) return;

      const videoTime = player.getCurrentTime() || 0;
      const audioTime = usePlayerStore.getState().currentTime;
      const drift = Math.abs(videoTime - audioTime);

      if (drift > DRIFT_THRESHOLD) {
        devLog(`[YouTubeIframe] Drift detected: ${drift.toFixed(1)}s - syncing video to audio`);
        player.seekTo(audioTime, true);
      }
    }, CHECK_INTERVAL);

    return () => clearInterval(syncInterval);
  }, [playbackSource, isPlaying, videoTarget]);

  // Time update interval (only when streaming from iframe).
  //
  // BATCHED: was 4 separate set() calls (setCurrentTime, setProgress,
  // setDuration, setBufferHealth) = 4 Zustand state changes per 250ms
  // tick = 16 subscriber notifications per second. Each notification
  // triggers OverlayTimingSync + any progress subscriber to recompute.
  //
  // Now: single usePlayerStore.setState() call with all 4 values in one
  // atomic snapshot. Zustand commits once, subscribers see one update.
  // 16 notifications/sec → 4 notifications/sec. ~6ms/sec saved.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (playbackSource !== 'iframe' || !isPlaying) return;

    intervalRef.current = setInterval(() => {
      // GUARD: Don't update store when backgrounded — iframe is frozen,
      // getCurrentTime() returns stale/0 data that corrupts the position.
      if (document.hidden) return;
      const player = playerRef.current;
      if (!player?.getCurrentTime || !player?.getDuration) return;
      const time = player.getCurrentTime() || 0;
      const dur = player.getDuration() || 0;
      if (dur > 0 && time > 0) {
        // Single atomic state update — all 4 values in one set() call.
        usePlayerStore.setState({
          currentTime: time,
          progress: (time / dur) * 100,
          duration: dur,
          bufferHealth: Math.round((player.getVideoLoadedFraction?.() || 0) * 100),
        });
      }
    }, 250);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playbackSource, isPlaying]);

  // Container styles based on videoTarget
  const getContainerStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      overflow: 'hidden',
      background: '#000',
      transition: 'all 0.3s ease-out',
    };

    if (videoTarget === 'landscape') {
      // `inset: 0` alone leaves gaps on mobile Safari + Android Chrome
      // when the PWA chrome / address bar reflow. Explicit viewport units
      // with `dvh` (dynamic viewport) fallback to `vh` pin the container
      // to the true mobile viewport — no black bars, no partial fit.
      return {
        ...base,
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        maxWidth: '100dvw',
        maxHeight: '100dvh',
        zIndex: 40,
      };
    }

    if (videoTarget === 'portrait' && isPlaying) {
      // Floating mini player — draggable. portraitPos offsets from center.
      // Sized to nest under BigCenterCard (w-56 h-56 = 224×224 on mobile)
      // — 216px is 8px shy, so the video sits "inside" the card footprint
      // and reads as a living version of the counterpart art, not an
      // overlay cover.
      //
      // Beam effect: boxShadow layers make the video feel lifted out of
      // the page. Shadow is rendered OUTSIDE the overflow:hidden clip so
      // it can extend freely. Four layers, stacked:
      //   1. Anchoring dark shadow — grounds the element, reads as weight
      //   2. Inner edge ring — sharp hairline for silhouette
      //   3. Purple halo (60px, brand wash) — "light from within"
      //   4. Extended bloom (140px) — the spatial beam, very faint
      //   5. Upward cast (cool-ivory, 40px at -12y) — the video lighting
      //      the space above itself, subtle but what completes "floating"
      // Compact mode (Search open, etc.) shrinks the player by ~15% via
      // transform scale — GPU-accelerated, no layout thrash, no iframe
      // remount. 0.82 × 216 ≈ 177, which is the "back to original 208,
      // minus 15%" footprint Dash called for. Scale lives on the same
      // transform as translate/drag so the existing spring transition
      // interpolates size change + position change together.
      const compactScale = playerCompact ? 0.82 : 1;
      return {
        position: 'fixed',
        overflow: 'hidden',
        background: '#000',
        top: '50%',
        left: '50%',
        transform: `translate(calc(-50% + ${portraitPos.x}px), calc(-50% + ${portraitPos.y}px)) scale(${compactScale})`,
        width: '216px',
        height: '216px',
        borderRadius: '2rem',
        zIndex: 60,
        opacity: 1,
        transition: dragStartRef.current ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        boxShadow: [
          '0 14px 48px rgba(0,0,0,0.65)',
          '0 0 0 1px rgba(255,255,255,0.08)',
          '0 0 60px rgba(139,92,246,0.32)',
          '0 0 140px rgba(139,92,246,0.14)',
          '0 -12px 40px rgba(199,168,255,0.10)',
        ].join(', '),
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

  // Video styles (zoom to hide YouTube branding). Landscape was 1.2 —
  // not aggressive enough to clip the bottom-right YT logo and the
  // top-right "Watch on YouTube" pill on modern embeds. 1.55 pushes
  // both off-screen while keeping ~65% of the centred frame visible.
  const getVideoStyle = (): React.CSSProperties => {
    const zoom = videoTarget === 'landscape' ? 1.55 : 2;
    return {
      width: '100%',
      height: '100%',
      transform: `scale(${zoom})`,
      transformOrigin: 'center center',
      pointerEvents: 'none',
    };
  };

  const showOverlays = videoTarget !== 'hidden' && isPlaying;

  // Portrait mode: draggable floating mini player
  const isPortraitMode = videoTarget === 'portrait' && isPlaying;
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [portraitPos, setPortraitPos] = useState(DEFAULT_PORTRAIT_POS);
  const portraitDraggedRef = useRef(false);

  return (
    <div
      style={getContainerStyle()}
    >
      {/* OVERLAY TIMING SYNC — renders null. Subscribes to currentTime at
          4Hz, computes overlay zones (Now Playing, Next Up, portrait end),
          writes to parent state ONLY on zone transitions. Prevents the
          entire YouTubeIframe from re-rendering at 4Hz. */}
      <OverlayTimingSync
        videoTarget={videoTarget}
        upcomingTrack={upcomingTrack}
        setShowNowPlaying={setShowNowPlaying}
        setShowNextUp={setShowNextUp}
        setShowPortraitNextUp={setShowPortraitNextUp}
      />

      {/* Video container — mountRef hosts the YT.Player iframe. The
          inner div is keyed on youtubeId so React unmounts + remounts
          it cleanly on every track change. That guarantees:
            - mountRef.current always points to a freshly-attached div
              (never an orphaned reference from a prior YT.Player swap)
            - any iframe YouTube injected for the previous video is
              physically removed from the DOM by React, not just
              destroyed via the API (which could leave stale frames)
          Fixes the "216×216 floating container shows but video stays
          black" symptom that recurred after track changes. */}
      <div style={getVideoStyle()}>
        <div
          key={youtubeId || 'voyo-iframe-empty'}
          ref={mountRef}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Take Out is now wired on the BigCenterCard's ExpandVideoButton
          (it morphs from "Mini Player" → "Take Out" once the mini is up
          + a brief gap). Floating-iframe button removed to avoid two
          competing entry points. */}

      {/* Portrait drag + tap layer. Drag to move the floating player.
          Tap (no drag) to close. */}
      {isPortraitMode && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            cursor: dragStartRef.current ? 'grabbing' : 'grab',
            zIndex: 5,
            touchAction: 'none', // we handle ALL touch on this layer
          }}
          onPointerDown={(e) => {
            portraitDraggedRef.current = false;
            dragStartRef.current = {
              x: e.clientX,
              y: e.clientY,
              ox: portraitPos.x,
              oy: portraitPos.y,
            };
            setIsDragging(true);
          }}
          onPointerMove={(e) => {
            if (!dragStartRef.current) return;
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
              portraitDraggedRef.current = true;
            }
            setPortraitPos({
              x: dragStartRef.current.ox + dx,
              y: dragStartRef.current.oy + dy,
            });
          }}
          onPointerUp={() => {
            dragStartRef.current = null;
            setIsDragging(false);
            // If no meaningful drag happened, it's a tap → close
            if (!portraitDraggedRef.current) {
              setVideoTarget('hidden');
              setPortraitPos(DEFAULT_PORTRAIT_POS); // reset for next open
            }
          }}
          onPointerCancel={() => {
            dragStartRef.current = null;
            setIsDragging(false);
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
          {/* Top gradient — in landscape, shrinks from 30%→14% after 3.2s
              dwell so the video breathes and owns the screen. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 10,
              background: videoTarget === 'landscape' && landscapeFadeMuted
                ? 'linear-gradient(to bottom, rgba(88,28,135,0.45) 0%, transparent 14%)'
                : 'linear-gradient(to bottom, rgba(88,28,135,0.7) 0%, transparent 30%)',
              transition: 'background 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
              animation: 'fadeIn 1s ease-out',
            }}
          />
          {/* Bottom gradient — same dwell treatment, shrinks 35%→17%. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 10,
              background: videoTarget === 'landscape' && landscapeFadeMuted
                ? 'linear-gradient(to top, rgba(88,28,135,0.5) 0%, transparent 17%)'
                : 'linear-gradient(to top, rgba(88,28,135,0.8) 0%, transparent 35%)',
              transition: 'background 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
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
