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
import { pipService } from '../services/pipService';
import { haptics } from '../utils/haptics';
import { CubeGestureHint } from './voyo/CubeGestureHint';
import { ScrollText } from './ui/ScrollText';

const YT_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

// Cloudflare Workers edge for R2 audio. Mirrors voyoStream.ts. Used by
// the embed-error → R2 grace path (v829) to confirm when R2 lands so we
// don't skip a track that's seconds away from playable audio.
const R2_EDGE = 'https://voyo-edge.dash-webtv.workers.dev/audio';

// Default position of the floating portrait player, relative to screen
// center. Nudged 12px left so it stops masking the right edge of
// "Discover" in the Portrait layout — at true center, the rounded
// corner was clipping the Discover shelf visually. Drag still overrides.
// v888 (Dash 2026-04-29): mini player sized to MATCH the artwork card
// (BigCenterCard w-56 = 224) so the two surfaces feel like the same
// cube in two states, not different objects. v887 went too big.
const MINI_SIZE = 224;
const MINI_HALF = MINI_SIZE / 2;
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
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.trackId ?? null);
  const lastRef = useRef({ np: false, nu: false, pnu: false });
  // Per-track latch for the portrait Next Up overlay. Once it fires for
  // a track, we leave it on until the track changes — currentTime jitter
  // from the audio element + iframe drift sync was bouncing it across
  // the 8s threshold and re-mounting the overlay multiple times in a
  // single end zone.
  const pnuLatchedTrackRef = useRef<string | null>(null);

  useEffect(() => {
    if (videoTarget === 'hidden') {
      if (lastRef.current.np || lastRef.current.nu || lastRef.current.pnu) {
        setShowNowPlaying(false);
        setShowNextUp(false);
        setShowPortraitNextUp(false);
        lastRef.current = { np: false, nu: false, pnu: false };
      }
      pnuLatchedTrackRef.current = null;
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

    // Track change → reset the portrait-overlay latch so the next track's
    // end zone can fire fresh.
    if (pnuLatchedTrackRef.current && pnuLatchedTrackRef.current !== currentTrackId) {
      pnuLatchedTrackRef.current = null;
    }

    const portraitEndZone = timeRemaining > 0 && timeRemaining < 8;
    const portraitConditionsMet = videoTarget === 'portrait' && portraitEndZone && !!upcomingTrack && !!currentTrackId;

    let pnu: boolean;
    if (pnuLatchedTrackRef.current === currentTrackId) {
      // Already shown for this track — keep it up regardless of jitter
      // until the track ID changes (above).
      pnu = true;
    } else if (portraitConditionsMet) {
      pnu = true;
      pnuLatchedTrackRef.current = currentTrackId;
    } else {
      pnu = false;
    }

    const prev = lastRef.current;
    if (prev.np !== np) { setShowNowPlaying(np); }
    if (prev.nu !== nu) { setShowNextUp(nu); }
    if (prev.pnu !== pnu) { setShowPortraitNextUp(pnu); }
    lastRef.current = { np, nu, pnu };
  }, [currentTime, duration, videoTarget, upcomingTrack, currentTrackId, setShowNowPlaying, setShowNextUp, setShowPortraitNextUp]);

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
  // v921 — dropped 5 unused selectors: duration, setCurrentTime,
  // setProgress, setBufferHealth, clearSeekPosition. They were
  // subscribed at top-level but only referenced inside child components
  // (OverlayTimingSync owns its own subscription) or via setState
  // direct calls below. Pure subscription churn.
  const queue = usePlayerStore((s) => s.queue);

  const setDuration = usePlayerStore((s) => s.setDuration);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const setVideoTarget = usePlayerStore((s) => s.setVideoTarget);

  const youtubeId = currentTrack?.trackId ? getYouTubeId(currentTrack.trackId) : '';

  // Overlay timing state
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [showNextUp, setShowNextUp] = useState(false);
  const [showPortraitNextUp, setShowPortraitNextUp] = useState(false); // Full-cover thumbnail for portrait
  const [isDragging, setIsDragging] = useState(false);
  // Double-tap detection for lyrics
  const lastCubeTapRef = useRef<{ time: number; y: number } | null>(null);
  const cubeSingleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            // Embedding blocked (region / age-gate / embedding disabled / bot).
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
            // Audio source is iframe itself AND iframe blocked. R2 extraction
            // was already queued at p=10 via app.playTrack → ensureTrackReady,
            // and yt-dlp on the VPS doesn't see the user's bot detection — so
            // R2 will land in ~10-30s regardless of this iframe blocking.
            //
            // v829 (Dash 2026-04-29 "in those cases should still r2 extract
            // right"): the previous 500ms grace was too short. R2 typically
            // lands at 10-30s; we'd skip away from a perfectly-extractable
            // track. Now we poll R2 HEAD up to 25s. If it lands, don't skip
            // — useHotSwap moves us off iframe to R2 audio. If 25s elapses
            // without R2, give up and skip (the track is genuinely dead).
            //
            // Hide the iframe immediately so YouTube's related-video autoplay
            // (which fires even with rel=0 when the primary video can't embed)
            // doesn't show/play unrelated content while we wait for R2.
            // Cover art takes over; hot-swap re-shows video once R2 lands.
            store.setVideoBlocked(true);
            store.setVideoTarget('hidden');
            devLog('[YouTubeIframe] Embed blocked — hiding iframe, waiting for R2 (up to 25s):', videoId);
            const blockedTrackId = videoId;
            const blockedAt = Date.now();
            const R2_GRACE_MS = 25_000;
            const POLL_INTERVAL_MS = 2_000;
            const r2Wait = async () => {
              while (Date.now() - blockedAt < R2_GRACE_MS) {
                const s = usePlayerStore.getState();
                // Hot-swap won → playbackSource flipped to r2/cached. Done.
                if (s.playbackSource === 'r2' || s.playbackSource === 'cached') {
                  devLog('[YouTubeIframe] embed-blocked recovery — hot-swap won');
                  return;
                }
                // User navigated away (skipped manually, picked another track).
                // The new track owns its own lifecycle — don't pollute it.
                const liveYtId = getYouTubeId(s.currentTrack?.trackId ?? '');
                if (liveYtId !== blockedTrackId) {
                  devLog('[YouTubeIframe] embed-blocked recovery — user moved on');
                  return;
                }
                // HEAD probe R2. If hit, useHotSwap will pick it up on its
                // next 2s tick (usually within ~2-3s of R2 going live). We
                // don't need to do the swap here — just stop the skip path.
                try {
                  const res = await fetch(`${R2_EDGE}/${blockedTrackId}?q=high`, { method: 'HEAD' });
                  if (res.ok) {
                    devLog('[YouTubeIframe] embed-blocked recovery — R2 ready, hot-swap will land');
                    logPlaybackEvent({
                      event_type: 'trace',
                      track_id: blockedTrackId || 'unknown',
                      meta: {
                        subtype: 'embed_blocked_r2_recovery',
                        wait_ms: Date.now() - blockedAt,
                        error_code: errorCode,
                      },
                    });
                    return;
                  }
                } catch { /* transient — keep polling */ }
                await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
              }
              // Timeout — R2 never landed. Confirm we're still on this track,
              // mark failed, skip.
              const sNow = usePlayerStore.getState();
              if (sNow.playbackSource === 'r2' || sNow.playbackSource === 'cached') return;
              const liveYtIdNow = getYouTubeId(sNow.currentTrack?.trackId ?? '');
              if (liveYtIdNow !== blockedTrackId) return;
              if (blockedTrackId) markTrackAsFailed(blockedTrackId, errorCode);
              logPlaybackEvent({
                event_type: 'skip_auto',
                track_id: blockedTrackId || 'unknown',
                meta: {
                  reason: 'yt_error_embed_blocked',
                  error_code: errorCode,
                  r2_wait_ms: Date.now() - blockedAt,
                },
              });
              nextTrack();
            };
            void r2Wait();
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

  // Seek handling — apply seek to the YT player ONLY when the iframe is
  // the audio source OR the video is user-visible. When R2 owns audio and
  // the iframe is hidden, a YT seekTo flushes the embed's internal buffer
  // and triggers a fresh range fetch — pure waste during SKEEP at 100ms.
  // (Apr 28 2026 audit fix #1.) Clearing seekPosition is AudioPlayer's job
  // (the always-mounted source-of-truth), not ours — drop the redundant
  // clear so we only do one store write per seek instead of three.
  useEffect(() => {
    if (seekPosition === null) return;
    const iframeIsActive = playbackSource === 'iframe' || videoTarget !== 'hidden';
    if (!iframeIsActive) return;
    const player = playerRef.current;
    if (player?.seekTo) {
      player.seekTo(seekPosition, true);
    }
  }, [seekPosition, playbackSource, videoTarget]);

  // ── Iframe sync (Apr 28 2026 redesign) ────────────────────────────────
  // Replaces the 2.5s polling drift correction. Pattern: poster art covers
  // the iframe through any sync work, so the user never sees a YT load
  // spinner. We do at most TWO syncs per track lifecycle:
  //   1. ONE confident initial sync — fires after a min-poster window AND
  //      the iframe has reached canplay/PLAYING. Seeks video to audio time.
  //   2. ONE drift correction — checked once at T+8s after the initial
  //      sync confirmed. If drift exceeded threshold, poster fades back in,
  //      we re-seek, then fade out. Marked done; never re-check.
  // No interval polling. No "hectic reactive reload."
  const POSTER_MIN_MS = 3000;        // poster minimum dwell
  const DRIFT_CHECK_DELAY_MS = 3000; // single drift check, T+ this after sync
  const DRIFT_THRESHOLD_S = 1.5;
  const POSTER_FADE_MS = 600;

  // Phase machine: 'poster' = poster fully covers iframe; 'synced' = poster
  // faded out, iframe visible; 'correcting' = poster faded in for a one-shot
  // drift correction, will return to 'synced' when seek lands.
  type VideoSyncPhase = 'poster' | 'synced' | 'correcting';
  const [videoSyncPhase, setVideoSyncPhase] = useState<VideoSyncPhase>('poster');
  const driftCorrectedRef = useRef(false);

  // Reset phase + drift-corrected flag whenever the track changes.
  useEffect(() => {
    setVideoSyncPhase('poster');
    driftCorrectedRef.current = false;
  }, [currentTrack?.trackId]);

  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !isPlaying) return;
    if (videoTarget === 'hidden') return;
    if (!currentTrack) return;

    let cancelled = false;
    const minPosterDeadline = Date.now() + POSTER_MIN_MS;
    let driftTimer: ReturnType<typeof setTimeout> | null = null;

    // Single confident sync: wait for both (a) min poster dwell and (b)
    // YT player ready. Then ONE seek + ONE phase flip. Schedule the lone
    // drift check after we confirm sync.
    const tryInitialSync = () => {
      if (cancelled) return;
      if (Date.now() < minPosterDeadline) return;
      const player = playerRef.current;
      if (!player?.seekTo || !player?.getPlayerState) return;
      const state = player.getPlayerState();
      // 1=PLAYING, 3=BUFFERING — both acceptable; the seek itself will
      // settle it. Don't sync before the player has any state at all.
      if (state !== 1 && state !== 3) return;
      const audioTime = usePlayerStore.getState().currentTime;
      try { player.seekTo(audioTime, true); } catch {}
      setVideoSyncPhase('synced');
      // Schedule the SOLE drift correction.
      driftTimer = setTimeout(() => {
        if (cancelled || driftCorrectedRef.current) return;
        if (document.hidden) return;
        const p = playerRef.current;
        if (!p?.getCurrentTime || !p?.seekTo) return;
        const videoT = p.getCurrentTime() || 0;
        const audioT = usePlayerStore.getState().currentTime;
        const drift = Math.abs(videoT - audioT);
        driftCorrectedRef.current = true; // either way, never check again.
        if (drift > DRIFT_THRESHOLD_S) {
          devLog(`[YouTubeIframe] One-shot drift correction: ${drift.toFixed(2)}s`);
          setVideoSyncPhase('correcting');
          try { p.seekTo(audioT, true); } catch {}
          // Hold poster up for the YT re-buffer, then fade it out.
          setTimeout(() => { if (!cancelled) setVideoSyncPhase('synced'); }, POSTER_FADE_MS + 800);
        }
      }, DRIFT_CHECK_DELAY_MS);
    };

    // Poll ONCE every 250ms only until the initial sync lands. Stops the
    // moment we transition to 'synced'. This is the only loop in the
    // entire pipeline — bounded, brief, single-purpose.
    const probe = setInterval(() => {
      if (cancelled) return;
      if (videoSyncPhase !== 'poster') { clearInterval(probe); return; }
      tryInitialSync();
    }, 250);

    return () => {
      cancelled = true;
      clearInterval(probe);
      if (driftTimer) clearTimeout(driftTimer);
    };
  }, [playbackSource, isPlaying, videoTarget, currentTrack, videoSyncPhase]);

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
        height: '100dvh',
        maxWidth: '100dvw',
        maxHeight: '100dvh',
        zIndex: 40,
      };
    }

    if (videoTarget === 'portrait' && isPlaying) {
      // Floating mini player — draggable. portraitPos offsets from center.
      // v888: sized to MATCH BigCenterCard's mobile footprint (224px =
      // w-56). Reads as the same cube in two states (poster ↔ iframe),
      // not different objects.
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
      // v889: drag = grow. Idle the cube sits at original size
      // (matches BigCenterCard footprint). Grab + drag scales up so
      // the user gets visual confirmation they've picked it up.
      const dragScale = isDragging ? 1.18 : 1;
      const finalScale = compactScale * dragScale;
      // v893: split transform into individual `translate` + `scale`
      // properties so size always animates smoothly (grab grow, search
      // shrink, idle dim) while position stays immediate during drag.
      return {
        position: 'fixed',
        overflow: 'hidden',
        background: '#000',
        top: '50%',
        left: '50%',
        translate: `calc(-50% + ${portraitPos.x}px) calc(-50% + ${portraitPos.y}px)`,
        scale: `${finalScale}`,
        width: `${MINI_SIZE}px`,
        height: `${MINI_SIZE}px`,
        borderRadius: '2rem',
        zIndex: 60,
        opacity: 1,
        // Scale always glides; translate only glides on release (instant
        // during drag so the iframe tracks the finger).
        transition: dragStartRef.current
          ? 'scale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
          : 'translate 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), scale 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
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

  // Right-edge "portal" — drag the mini player into it to Take Out (PiP).
  // Glow ramps from 0 (iframe far) → 1 (iframe right edge ≤ 20px from
  // viewport edge). When glow ≥ 0.85 the portal is "armed" and a
  // pointerUp triggers pipService.enter() instead of the tap-to-close.
  const [portalGlow, setPortalGlow] = useState(0);
  const portalGlowRef = useRef(0);
  const PORTAL_ARM = 0.85;
  const computePortalGlow = (posX: number) => {
    const vw = window.innerWidth;
    const iframeRightEdge = vw / 2 + posX + MINI_HALF;
    const distance = vw - iframeRightEdge;
    return Math.max(0, Math.min(1, (120 - distance) / 100));
  };

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
        {/* Poster art overlay (Apr 28 2026 sync redesign).
            Sits above the iframe; covers any YT load/buffer/seek state so
            the user never sees a load spinner. Visible during 'poster'
            (initial settle) and 'correcting' (one-shot drift fix). Fades
            out only when the phase machine reaches 'synced'. */}
        {currentTrack?.coverUrl && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${currentTrack.coverUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: videoSyncPhase === 'synced' ? 0 : 1,
              transition: `opacity ${POSTER_FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
              zIndex: 4,
              pointerEvents: 'none',
              filter: 'brightness(0.92)',
            }}
          />
        )}
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
            // v915 — capture the pointer so subsequent move/up fire
            // on this layer even if the finger drags over the
            // fixed-position right-edge portal strip mid-gesture.
            // Without this, releasing on a different layer left
            // dragStartRef stuck and the cube was permanently in
            // drag-grow scale.
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
            setIsDragging(true);
          }}
          onPointerMove={(e) => {
            if (!dragStartRef.current) return;
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
              portraitDraggedRef.current = true;
            }
            const nextX = dragStartRef.current.ox + dx;
            setPortraitPos({
              x: nextX,
              y: dragStartRef.current.oy + dy,
            });
            const g = computePortalGlow(nextX);
            const prev = portalGlowRef.current;
            // Haptics on upward threshold crossings only.
            // Selection-tick when entering portal proximity, light when armed.
            if (prev < 0.3 && g >= 0.3) haptics.selection();
            if (prev < PORTAL_ARM && g >= PORTAL_ARM) haptics.light();
            portalGlowRef.current = g;
            setPortalGlow(g);
          }}
          onPointerUp={(e) => {
            dragStartRef.current = null;
            setIsDragging(false);
            // Portal armed → Take Out (PiP).
            if (portalGlowRef.current >= PORTAL_ARM) {
              haptics.success();
              void pipService.enter();
              setVideoTarget('hidden');
              setPortraitPos(DEFAULT_PORTRAIT_POS);
              portalGlowRef.current = 0;
              setPortalGlow(0);
              portraitDraggedRef.current = false;
              return;
            }
            portalGlowRef.current = 0;
            setPortalGlow(0);

            if (!portraitDraggedRef.current) {
              // Tap detected. Check for double-tap first.
              const now = Date.now();
              const last = lastCubeTapRef.current;
              const rect = e.currentTarget.getBoundingClientRect();
              const relY = e.clientY - rect.top;

              if (last && now - last.time < 300) {
                // Double-tap → open lyrics
                if (cubeSingleTapTimer.current) { clearTimeout(cubeSingleTapTimer.current); cubeSingleTapTimer.current = null; }
                lastCubeTapRef.current = null;
                usePlayerStore.getState().requestLyricsOpen();
                haptics.selection();
                return;
              }

              lastCubeTapRef.current = { time: now, y: relY };
              // Delay single-tap action to allow a double-tap to cancel it
              if (cubeSingleTapTimer.current) clearTimeout(cubeSingleTapTimer.current);
              const tapRelY = relY;
              const tapHeight = rect.height;
              cubeSingleTapTimer.current = setTimeout(() => {
                cubeSingleTapTimer.current = null;
                lastCubeTapRef.current = null;
                // Bottom 25% = close. Top 75% = pause/resume.
                if (tapRelY > tapHeight * 0.75) {
                  setVideoTarget('hidden');
                  setPortraitPos(DEFAULT_PORTRAIT_POS);
                } else {
                  usePlayerStore.getState().togglePlay();
                  haptics.light();
                }
              }, 220);
            }
          }}
          onPointerCancel={() => {
            dragStartRef.current = null;
            setIsDragging(false);
            portalGlowRef.current = 0;
            setPortalGlow(0);
          }}
        />
      )}

      {/* RIGHT-EDGE PORTAL — glowing vertical strip that brightens as the
          mini player is dragged toward it. Drop iframe into the portal to
          trigger Take Out (PiP). Fixed-positioned so it overlays the
          viewport regardless of where the iframe container lives. */}
      {isPortraitMode && (
        <>
          {/* App-side reaction — wide warm wash that bleeds far into the
              app interior (260px). Reads as the phone's right edge bezel
              "lighting up" from inside, so the app feels like it's
              acknowledging the gesture, not just showing a chrome strip. */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '260px',
              pointerEvents: 'none',
              zIndex: 64,
              opacity: portalGlow * 0.55,
              background: 'linear-gradient(to left, rgba(244,162,62,0.30) 0%, rgba(244,162,62,0.08) 50%, transparent 100%)',
              transition: 'opacity 200ms ease-out',
              willChange: 'opacity',
              mixBlendMode: 'screen',
            }}
          />
          {/* Soft outer halo — tighter gradient closer to the seam */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '120px',
              pointerEvents: 'none',
              zIndex: 65,
              opacity: portalGlow,
              background: 'linear-gradient(to left, rgba(244,162,62,0.42) 0%, rgba(244,162,62,0.16) 35%, transparent 100%)',
              transition: 'opacity 180ms ease-out',
              willChange: 'opacity',
            }}
          />
          {/* Bright vertical line — the actual portal seam */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: portalGlow >= PORTAL_ARM ? '6px' : '3px',
              pointerEvents: 'none',
              zIndex: 66,
              opacity: Math.min(1, portalGlow * 1.4),
              background: portalGlow >= PORTAL_ARM
                ? 'linear-gradient(to left, #FBBF77 0%, #F4A23E 100%)'
                : 'linear-gradient(to left, rgba(251,191,119,0.9) 0%, rgba(244,162,62,0.6) 100%)',
              boxShadow: portalGlow >= PORTAL_ARM
                ? '0 0 24px rgba(244,162,62,0.85), 0 0 48px rgba(244,162,62,0.55), -8px 0 32px rgba(244,162,62,0.45)'
                : '0 0 16px rgba(244,162,62,0.55), 0 0 28px rgba(244,162,62,0.25)',
              transition: 'width 180ms ease-out, box-shadow 180ms ease-out, background 180ms ease-out, opacity 180ms ease-out',
              willChange: 'opacity, box-shadow',
            }}
          />
          {/* "TAKE OUT" label — appears when armed, drops a hint */}
          <div
            style={{
              position: 'fixed',
              top: '50%',
              right: '20px',
              transform: `translateY(-50%) translateX(${portalGlow >= PORTAL_ARM ? '0' : '12px'})`,
              pointerEvents: 'none',
              zIndex: 67,
              opacity: portalGlow >= PORTAL_ARM ? 1 : 0,
              color: '#FBBF77',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.18em',
              textShadow: '0 0 8px rgba(244,162,62,0.85), 0 0 16px rgba(244,162,62,0.45)',
              writingMode: 'vertical-rl',
              transition: 'opacity 180ms ease-out, transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            aria-hidden="true"
          >
            TAKE OUT
          </div>
        </>
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
          <ScrollText
            text={currentTrack.title}
            style={{ color: 'white', fontWeight: 'bold', fontSize: videoTarget === 'landscape' ? 18 : 13, marginBottom: 1 }}
          />
          <ScrollText
            text={currentTrack.artist}
            style={{ color: 'rgba(255,255,255,0.7)', fontSize: videoTarget === 'landscape' ? 14 : 11 }}
            delay={5400}
          />
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
          <ScrollText
            text={upcomingTrack.title}
            style={{ color: 'white', fontWeight: 'bold', fontSize: videoTarget === 'landscape' ? 18 : 13, marginBottom: 1 }}
          />
          <ScrollText
            text={upcomingTrack.artist}
            style={{ color: 'rgba(255,255,255,0.7)', fontSize: videoTarget === 'landscape' ? 14 : 11 }}
            delay={5400}
          />
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
          <ScrollText
            text={currentTrack.title}
            style={{ color: 'white', fontWeight: 'bold', fontSize: videoTarget === 'landscape' ? 20 : 12, marginBottom: 1 }}
          />
          <ScrollText
            text={currentTrack.artist}
            style={{ color: 'rgba(255,255,255,0.7)', fontSize: videoTarget === 'landscape' ? 16 : 10 }}
            delay={5400}
          />
        </div>
      )}

      {/* Portrait cube hint = "tap to close" button. Drag layer
          handles the actual tap-to-close; hint is the visual
          indicator with its own session lifecycle (v898 silver
          metallic, scheduled flashes at 15s/45s/5min then dead). */}
      {isPortraitMode && !showPortraitNextUp && (
        <CubeGestureHint
          position="bottom"
          highlighted={isDragging}
          label="tap to close · drag to move"
        />
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
