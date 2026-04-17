/**
 * VOYO Music - Audio Player with EQ Enhancement
 *
 * FLOW (No iframe dependency - 100% VOYO controlled):
 * 1. Check IndexedDB cache (local boost) → Play instantly with EQ
 * 2. Check R2 collective cache → Play with EQ (170K+ shared tracks)
 * 3. R2 miss → Extract via Edge Worker → Cache locally + contribute to R2 → Play with EQ
 *
 * PLAYBACK SOURCES:
 * - playbackSource === 'cached' → Local IndexedDB audio with full EQ
 * - playbackSource === 'r2' → R2 collective stream with full EQ
 *
 * AUDIO ENHANCEMENT (Web Audio API):
 * - Applies to ALL audio (cached + r2)
 * - 3 presets: Boosted, Calm, VOYEX (multiband mastering)
 *
 * SMART BANDWIDTH:
 * - Preload next 3 tracks from DJ queue
 * - Quality upgrade at 50% interest (R2 low → high)
 * - User bandwidth contributes to collective R2 cache
 */

import { useEffect, useRef, useCallback } from 'react';
import { Track } from '../types';
import { usePlayerStore } from '../store/playerStore';
import { devLog, devWarn } from '../utils/logger';
import { usePreferenceStore } from '../store/preferenceStore';
import { useDownloadStore } from '../store/downloadStore';
import { useTrackPoolStore } from '../store/trackPoolStore';
import { audioEngine } from '../services/audioEngine';
import { haptics } from '../utils/haptics';

// Edge Worker for extraction + upgrade-to-R2 lookups (hot-swap path).
const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';
import { recordPoolEngagement } from '../services/personalization';
import { recordTrackInSession } from '../services/poolCurator';
import { recordPlay as djRecordPlay } from '../services/intelligentDJ';
import { onTrackPlay as oyoOnTrackPlay, onTrackComplete as oyoOnTrackComplete } from '../services/oyoDJ';
import { registerTrackPlay as viRegisterPlay } from '../services/videoIntelligence';
import { useMiniPiP } from '../hooks/useMiniPiP';
import { notifyNextUp } from '../services/oyoNotifications';
import { logPlaybackEvent, trace } from '../services/telemetry';
import { isBlocked } from '../services/trackBlocklist';
import { useBgEngine } from '../audio/bg/bgEngine';
import { useWakeLock } from '../audio/bg/useWakeLock';
import { resolveSource } from '../audio/sources/sourceResolver';
import { usePreloadTrigger } from '../audio/sources/usePreloadTrigger';
import { getPreloadedTrack } from '../services/preloadManager';
import { useFrequencyPump } from '../audio/graph/freqPump';
import { useMediaSession } from '../audio/playback/mediaSession';
import { useHotSwap } from '../audio/playback/hotSwap';
import { useErrorRecovery } from '../audio/recovery/errorRecovery';
import { playbackState } from '../audio/playback/playbackState';

import { type BoostPreset } from '../audio/graph/boostPresets';
import { useAudioChain } from '../audio/graph/useAudioChain';
export type { BoostPreset };

export const AudioPlayer = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cachedUrlRef = useRef<string | null>(null);
  // Refs bgEngine reads/writes — hoisted so useBgEngine(...) gets them early.
  // runEndedAdvanceRef starts as a noop and gets its real value populated by
  // a useEffect below once runEndedAdvance is defined.
  const lastEndedTrackIdRef = useRef<string | null>(null);
  const syntheticEndedBypassRef = useRef(false);
  const proactivelyAdvancedForTrackIdRef = useRef<string | null>(null);
  const runEndedAdvanceRef = useRef<() => void>(() => {});

  // Web Audio API refs
  // Web Audio chain + EQ + gain helpers live in useAudioChain (see below).

  const lastTrackIdRef = useRef<string | null>(null);
  const blocklistCascadeRef = useRef(0); // how many consecutive blocked tracks we've skipped — circuit breaker
  const lastPlaySuccessIdRef = useRef<string | null>(null); // dedup play_success telemetry per trackId
  // Monotonic counter — incremented on every loadTrack invocation. Used as a
  // cancellation token: each in-flight loadTrack captures `myAttempt` at the
  // top and bails out at every await boundary if a newer load has started.
  // Without this, a slow R2/Edge fetch for an old track can finish AFTER the
  // user has skipped to a new one and clobber `audioRef.current.src` with a
  // stale URL — symptom: wrong track plays after rapid skips.
  const loadAttemptRef = useRef<number>(0);
  // Set true while loadTrack is mid-flight (during the audio.pause() that
  // precedes the src swap). The onPause handler reads this and SKIPS the
  // store sync — otherwise track-load pauses would clobber isPlaying to
  // false, and the post-canplaythrough auto-play check would fail.
  // Result: skipping no longer auto-plays the next track without this guard.
  const isLoadingTrackRef = useRef<boolean>(false);
  const previousTrackRef = useRef<Track | null>(null);
  const hasRecordedPlayRef = useRef<boolean>(false);
  const trackProgressRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);
  const backgroundBoostingRef = useRef<string | null>(null);
  const hasTriggered50PercentCacheRef = useRef<boolean>(false); // 50% auto-boost trigger
  const hasTriggered85PercentCacheRef = useRef<boolean>(false); // 85% edge-stream cache trigger
  const shouldAutoResumeRef = useRef<boolean>(false); // Resume playback on refresh if position was saved
  const pendingAutoResumeRef = useRef<boolean>(false); // True when autoplay was blocked by browser — first user tap resumes
  const isEdgeStreamRef = useRef<boolean>(false); // True when playing from Edge Worker stream URL (not IndexedDB)
  const hasTriggered75PercentKeptRef = useRef<boolean>(false); // 75% permanent cache trigger
  const hasTriggeredContextNotifRef = useRef<boolean>(false); // OYO track context notification (10s)
  // BACKGROUND GUARD: On some mobile browsers, the `pause` event fires BEFORE
  // `visibilitychange`. If onPause sets isPlaying=false during this window,
  // the return-from-background re-kick sees isPlaying=false and doesn't play.
  // This ref is set TRUE synchronously in a capturing visibilitychange listener
  // (fires before pagehide/freeze), so onPause can check it.
  // isTransitioningToBackgroundRef was hoisted to bgEngine. Local alias
  // is populated after useBgEngine() call below.
  // Throttle guards for handleTimeUpdate → setCurrentTime/setProgress writes.
  // Browser fires ontimeupdate at 4Hz (Chrome) up to 66Hz (Safari). Each
  // store write re-renders 9 subscribing components (OyoIsland, NowPlaying,
  // LandscapeVOYO, VideoMode, VoyoPortraitPlayer x2, ClassicMode, AudioPlayer,
  // ...). At 10Hz that's 90 component re-renders/sec during playback, all on
  // the main thread competing with the audio thread. Throttle the store
  // writes to 4Hz (250ms buckets) — smooth enough for progress bars, but
  // 16× lighter on Safari. trackProgressRef.current still updates every
  // fire so milestone checks (50/75/85%) stay accurate.
  const lastProgressWriteBucketRef = useRef<number>(-1);
  const lastMediaSessionWriteRef = useRef<number>(0);
  // Crossfade refs removed — true crossfade needs two audio elements.
  // Will implement properly later. For now: clean gapless transitions.
  // FLOW WATCHDOG: armed when loadTrack starts, cleared when play() succeeds.
  // If it fires, it means loadTrack never reached a playing state — either
  // the stream URL was null, fetch failed silently, canplaythrough never
  // fired, or play() was rejected (autoplay block). Instead of sitting in a
  // "loaded but silent" limbo, we auto-skip to the next track so the user
  // always experiences flow. Stale guard ensures a late fire doesn't skip
  // the CURRENT playing track after recovery.
  const loadWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v214 adaptive-watchdog (task #62): holds the fire callback + isStale
  // captured inside loadTrack's closure so audio-element 'progress' /
  // 'loadedmetadata' events can re-arm the timer from outside loadTrack.
  // When bytes are flowing, each progress event restarts the 8s countdown
  // — only TRUE silence (no bytes for 8s straight) fires the skip.
  const loadWatchdogFireFnRef = useRef<(() => void) | null>(null);
  // BG watchdog uses MessageChannel (setTimeout is throttled 1/min in BG).
  // Hold the active port so we can cancel on clearLoadWatchdog or on a
  // new loadTrack — without this, the MC tick loop is uncancellable and
  // each fresh loadTrack arms yet another one, causing cascades.
  const bgWatchdogPortRef = useRef<MessagePort | null>(null);
  const clearLoadWatchdog = () => {
    if (loadWatchdogRef.current) {
      clearTimeout(loadWatchdogRef.current);
      loadWatchdogRef.current = null;
    }
    if (bgWatchdogPortRef.current) {
      try { bgWatchdogPortRef.current.close(); } catch {}
      bgWatchdogPortRef.current = null;
    }
    loadWatchdogFireFnRef.current = null;
  };
  // Re-arm the FG watchdog with an 8s "got-progress" countdown. Called from
  // the audio element's onProgress / onLoadedMetadata handlers when bytes
  // are actively flowing — distinguishes "slow-but-alive" from "dead."
  const bumpLoadWatchdog = () => {
    if (!loadWatchdogFireFnRef.current || !loadWatchdogRef.current) return;
    if (document.hidden) return; // BG watchdog is MC-based, handled separately
    clearTimeout(loadWatchdogRef.current);
    loadWatchdogRef.current = setTimeout(loadWatchdogFireFnRef.current, 8000);
  };
  // Handles the .catch side of a loadTrack play() promise. Distinguishes
  // autoplay-block (user must tap — not a real failure) from real failures
  // (stream died, decode error — skip immediately). Either way clears the
  // watchdog so it doesn't fire redundantly.
  const handlePlayFailure = (e: Error | DOMException, label: string) => {
    trace('play_failure', usePlayerStore.getState().currentTrack?.trackId, { label, err: e.name, hidden: document.hidden, msg: e.message?.slice(0, 80) });
    devWarn(`[Playback] ${label} play failed:`, e.name);
    clearLoadWatchdog();
    const track = usePlayerStore.getState().currentTrack;
    if (track?.trackId) {
      logPlaybackEvent({
        event_type: 'play_fail',
        track_id: track.trackId,
        track_title: track.title,
        track_artist: track.artist,
        error_code: e.name === 'NotAllowedError' ? 'not_allowed' : e.name === 'AbortError' ? 'aborted' : 'unknown',
        meta: { label, errorMessage: e.message },
      });
      // GLOBAL SIGNAL: persist fail to video_intelligence — auto-blocklists at 3 fails
      import('../lib/supabase').then(({ supabase }) => {
        void (supabase?.rpc('record_signal', { p_youtube_id: track.trackId, p_action: 'fail' }) as unknown as Promise<unknown>)?.catch(() => {});
      });
    }
    if (e.name === 'NotAllowedError') {
      // Autoplay blocked by browser (no user gesture). Set pending flag
      // so the FIRST user tap anywhere on the app resumes playback.
      // The track is already loaded + seeked to position — one tap = instant resume.
      usePlayerStore.getState().setIsPlaying(false);
      isLoadingTrackRef.current = false;
      pendingAutoResumeRef.current = true;

      // Install a one-time gesture listener on document to resume.
      // Fires on the first touch/click, then removes itself.
      const resumeOnGesture = () => {
        if (!pendingAutoResumeRef.current) return;
        pendingAutoResumeRef.current = false;
        document.removeEventListener('touchstart', resumeOnGesture);
        document.removeEventListener('click', resumeOnGesture);
        // The user just tapped — we have gesture authority. Resume.
        if (audioRef.current && audioRef.current.paused && audioRef.current.src) {
          audioContextRef.current?.resume().catch(() => {});
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            usePlayerStore.getState().setIsPlaying(true);
            devLog('🎵 [VOYO] Auto-resume on first gesture after reload');
          }).catch(() => {});
        }
      };
      document.addEventListener('touchstart', resumeOnGesture, { once: true, passive: true });
      document.addEventListener('click', resumeOnGesture, { once: true });
      devLog('[VOYO] Autoplay blocked — waiting for first user gesture to resume');
      return;
    }
    // Real failure handling — distinguish AbortError (benign, src-swap mid-flight)
    // from actual failures.
    isLoadingTrackRef.current = false;
    if (e.name === 'AbortError') {
      // AbortError = the audio element was interrupted (rapid skip, src swap,
      // hot-swap mid-flight). Benign — the new load already started and will
      // call its own play(). Do nothing here.
      devLog(`[VOYO] play() aborted (${label}) — new load in flight, ignoring`);
      return;
    }
    // Real failure. SKIP regardless of BG/FG — user prefers the next track
    // over indefinite silence. The earlier comment "let the retry loop handle it"
    // was wrong: retry loop only runs in the R2/VPS miss path, NOT in play()
    // rejection handling. Without skip, BG plays got stuck silently — which
    // looked exactly like 'background skip not working' from the user's side.
    devWarn(`[VOYO] play() failed (${label}, hidden=${document.hidden}, ${e.name}) — advancing`);
    trace('next_call', usePlayerStore.getState().currentTrack?.trackId, { from: 'handlePlayFailure', label, err: e.name, hidden: document.hidden });
    nextTrack();
  };

  // Store state — fine-grained selectors so AudioPlayer only re-renders when
  // fields it actually uses change. A broad destructure would cause a
  // re-render on every setProgress/setCurrentTime tick (5-10Hz during
  // playback), which is catastrophic for a 1900-line component with 40+
  // useEffects.
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const volume = usePlayerStore(s => s.volume);
  const seekPosition = usePlayerStore(s => s.seekPosition);
  const playbackRate = usePlayerStore(s => s.playbackRate);
  const boostProfile = usePlayerStore(s => s.boostProfile);
  const voyexSpatial = usePlayerStore(s => s.voyexSpatial);
  // SESSION-RESUME ONLY: read the persisted currentTime ONCE at mount.
  // Previously subscribed as usePlayerStore(s => s.currentTime) — but that
  // field is updated 4× per second by handleTimeUpdate during playback, so
  // AudioPlayer was re-rendering 4Hz JUST to read a value that's only used
  // on initial load. Capture in a ref at mount and never re-read.
  const savedCurrentTimeRef = useRef<number>(
    typeof window !== 'undefined' ? usePlayerStore.getState().currentTime : 0
  );
  const savedCurrentTime = savedCurrentTimeRef.current;
  const playbackSource = usePlayerStore(s => s.playbackSource);
  // NOTE: AudioPlayer deliberately does NOT subscribe to `progress`. The
  // milestone checks (50/75/85% and 30s listen) are triggered from inside
  // handleTimeUpdate using trackProgressRef.current — firing at the 4Hz
  // bucket rate without re-rendering the component. Re-rendering AudioPlayer
  // at 4Hz during playback was causing it to rebuild ~40 effect closures
  // and re-attach JSX event handlers 4× per second, consuming main-thread
  // CPU that the audio thread needed. Now AudioPlayer re-renders ONLY on
  // real state changes (track switch, play/pause, preset change).
  const queue = usePlayerStore(s => s.queue);
  const setCurrentTime = usePlayerStore(s => s.setCurrentTime);
  const setDuration = usePlayerStore(s => s.setDuration);
  const setProgress = usePlayerStore(s => s.setProgress);
  const clearSeekPosition = usePlayerStore(s => s.clearSeekPosition);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const nextTrack = usePlayerStore(s => s.nextTrack);
  const predictUpcoming = usePlayerStore(s => s.predictUpcoming);
  const setBufferHealth = usePlayerStore(s => s.setBufferHealth);
  const setPlaybackSource = usePlayerStore(s => s.setPlaybackSource);

  const startListenSession = usePreferenceStore(s => s.startListenSession);
  const endListenSession = usePreferenceStore(s => s.endListenSession);

  const initDownloads = useDownloadStore(s => s.initialize);
  const checkCache = useDownloadStore(s => s.checkCache);
  const cacheTrack = useDownloadStore(s => s.cacheTrack);
  const lastBoostCompletion = useDownloadStore(s => s.lastBoostCompletion);
  const autoBoostEnabled = useDownloadStore(s => s.autoBoostEnabled);
  const downloadSetting = useDownloadStore(s => s.downloadSetting);

  // Mini-PiP for background playback
  useMiniPiP();

  // Initialize downloads
  useEffect(() => {
    initDownloads();
  }, [initDownloads]);

  // MILESTONE CHECKS — called from handleTimeUpdate at 4Hz bucket rate.
  //
  // Previously 4 separate useEffects subscribed to `progress` and fired
  // every render. Moving the checks here means AudioPlayer no longer needs
  // to subscribe to `progress` → zero re-renders during steady playback.
  // Each check is O(1) refs + early returns, so calling all 4 from every
  // 250ms bucket is cheap.
  //
  // All four triggers already use refs (hasTriggeredNNPercent*) for
  // idempotency, so we can't double-fire. State reads go through
  // usePlayerStore.getState() / useDownloadStore.getState() to avoid
  // stale closure on long-lived callback.
  const checkProgressMilestones = useCallback((progress: number) => {
    const track = currentTrack;
    if (!track?.trackId) return;

    // 50% R2 QUALITY UPGRADE — low-quality R2 track, upgrade to high when
    // user shows genuine interest. Deferred 5s + buffer-health check so
    // the upgrade download doesn't compete with the streaming audio.
    if (
      playbackSource === 'r2' &&
      !hasTriggered50PercentCacheRef.current &&
      progress >= 50 &&
      downloadSetting !== 'never'
    ) {
      // Check wifi-only gate
      let allowed = true;
      if (downloadSetting === 'wifi-only') {
        const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
        allowed = !connection || connection.type === 'wifi' || connection.type === 'ethernet' || !connection.effectiveType?.includes('2g');
      }
      if (allowed) {
        hasTriggered50PercentCacheRef.current = true;
        const API_BASE = 'https://voyo-edge.dash-webtv.workers.dev';
        const trackId = track.trackId;
        const trackTitle = track.title;
        const trackArtist = track.artist;
        const trackDuration = track.duration || 0;
        setTimeout(() => {
          const state = usePlayerStore.getState();
          if (state.currentTrack?.trackId !== trackId) return;
          if (state.bufferHealth < 60) return;
          devLog('🎵 [VOYO] 50% deferred boost firing — buffer healthy, no skip');
          backgroundBoostingRef.current = trackId;
          cacheTrack(trackId, trackTitle, trackArtist, trackDuration, `${API_BASE}/cdn/art/${trackId}?quality=high`)
            .finally(() => { backgroundBoostingRef.current = null; });
        }, 5000);
      }
    }

    // 85% EDGE-STREAM CACHE — non-R2 track (playing from YouTube CDN via
    // Edge Worker). Cache + upload to R2 for the NEXT play. By 85% the
    // audio element buffer is full, so the download runs uncontested.
    if (
      !hasTriggered85PercentCacheRef.current &&
      isEdgeStreamRef.current &&
      progress >= 85 &&
      downloadSetting !== 'never'
    ) {
      hasTriggered85PercentCacheRef.current = true;
      devLog('🎵 [VOYO] 85% reached on edge stream — caching + uploading to R2 (post-buffer)');
      cacheTrack(
        track.trackId,
        track.title,
        track.artist,
        track.duration || 0,
        `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${track.trackId}?quality=high`
      );
    }

    // 75% KEPT — mark as permanent cache when user shows strong interest.
    if (
      !hasTriggered75PercentKeptRef.current &&
      progress >= 75 &&
      (playbackSource === 'cached' || playbackSource === 'r2')
    ) {
      hasTriggered75PercentKeptRef.current = true;
      import('../services/downloadManager').then(({ markTrackAsKept }) => {
        const normalizedId = track.trackId.replace('VOYO_', '');
        markTrackAsKept(normalizedId);
        devLog('🎵 [VOYO] 75% reached - track marked as KEPT (permanent)');
      });
    }

    // (30s-listen flag-for-R2 block was iframe-only; playbackSource === 'iframe'
    // never fires since VOYO went 100% audio-element. Block deleted.)
    // OYO CONTEXT: ~10s into a track from a favorite artist → ambient notification.
    // "This is a special one" — conversational, non-intrusive.
    if (!hasTriggeredContextNotifRef.current) {
      const elapsed = (track.duration || 300) * (progress / 100);
      if (elapsed >= 10) {
        hasTriggeredContextNotifRef.current = true;
        // Check if this is a "special" track (favorite artist or high reactions)
        import('../services/oyoDJ').then(({ getInsights }) => {
          const insights = getInsights();
          const isFavArtist = insights.favoriteArtists?.includes(track.artist);
          if (isFavArtist) {
            import('../services/oyoNotifications').then(({ notifyTrackContext }) => {
              notifyTrackContext(`${track.artist} — this is a special one`);
            });
          }
        });
      }
    }
  }, [currentTrack, playbackSource, downloadSetting, cacheTrack]);

  // PRELOAD: Start preloading next 2-3 tracks IMMEDIATELY when track starts (like Spotify)
  // Major platforms don't wait - they start buffering upcoming tracks right away
  // Preload trigger + cleanup live in one module.
  usePreloadTrigger({ currentTrack, queue, checkCache, predictUpcoming });

  useWakeLock(isPlaying);

  // Silent WAV blob generation lives in bgEngine (src/audio/bg/bgEngine.ts).

  // Frequency pump (CSS custom property writer for visualizations).
  useFrequencyPump(isPlaying);

  // ── AUDIO CHAIN ──────────────────────────────────────────────────────
  // Web Audio graph + EQ presets + gain helpers + play/pause fade. The
  // entire chain (40+ nodes, 4 presets, 3 spatial layers, 2 watchdogs)
  // lives in src/audio/graph/useAudioChain.ts. AudioPlayer just receives
  // the control surface functions and a couple of refs for bgEngine.
  const {
    audioContextRef,
    gainNodeRef,
    setupAudioEnhancement,
    computeMasterTarget,
    muteMasterGainInstantly,
    fadeInMasterGain,
    armGainWatchdog,
    disarmGainWatchdog,
  } = useAudioChain({
    audioRef,
    isLoadingTrackRef,
    volume,
    boostProfile: boostProfile as BoostPreset,
    voyexSpatial,
    isPlaying,
    playbackSource,
  });

  // ── BG ENGINE ────────────────────────────────────────────────────────
  // All BG strategy — visibility handler, heartbeat, ctx resume, silent
  // WAV generation, synthetic-ended + stuck-playback detectors, gain
  // rescue. Reads audio chain refs; returns silent WAV blob + transition
  // guard for other modules to reference.
  const { silentKeeperUrlRef, isTransitioningToBackgroundRef, engageSilentWav } = useBgEngine({
    audioRef,
    audioContextRef,
    gainNodeRef,
    isLoadingTrackRef,
    isPlaying,
    playbackSource,
    computeMasterTarget,
    runEndedAdvanceRef,
    syntheticEndedBypassRef,
    lastEndedTrackIdRef,
  });

  // Swap src on the shared element safely — reset loop (silent-WAV bridge
  // leaves it true; HTMLMediaElement.loop is sticky per spec), pin volume,
  // conditionally call load() (blobs don'''t need it; remote URLs do).
  // Every fast-path + hot-swap + recovery uses this, preventing the
  // loop-stuck-on-new-track regression class (v171, v187).
  const swapSrcSafely = (url: string) => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = 1.0;
    el.loop = false;
    el.src = url;
    if (!url.startsWith('blob:')) el.load();
  };


  // === MAIN TRACK LOADING LOGIC ===
  useEffect(() => {
    // Capture this load attempt's id at the top. If a newer loadTrack starts
    // while we're awaiting (rapid skips), `loadAttemptRef.current` advances
    // and our local `myAttempt` becomes stale — `isStale()` returns true and
    // we bail before clobbering audio.src with the wrong URL.
    const myAttempt = ++loadAttemptRef.current;
    const isStale = () => loadAttemptRef.current !== myAttempt;

    const loadTrack = async () => {
      if (!currentTrack?.trackId) return;

      const trackId = currentTrack.trackId;

      // RACE-FREE GUARD: claim the trackId SYNCHRONOUSLY before any await.
      // The previous version checked the ref here but set it 100+ lines later,
      // after a 10ms setTimeout await. During that window, concurrent loadTrack
      // calls (from rapid effect re-runs) could all pass the guard, leading to
      // 3-5x duplicate play_start events per track and audio fight-for-control.
      // Setting the ref now makes the guard atomic with the lock.
      trace('load_enter', trackId, { hidden: document.hidden, isPlaying: usePlayerStore.getState().isPlaying, prevId: lastTrackIdRef.current });
      playbackState.transition('loading', trackId, 'load_enter');
      if (lastTrackIdRef.current === trackId) {
        trace('load_guard', trackId, { why: 'same_track_id', bailed: true });
        return;
      }
      lastTrackIdRef.current = trackId;
      lastEndedTrackIdRef.current = null;
      lastEndedSrcRef.current = null; // defensive: previous track's src won't dedup-false-trigger new track's ended
      lastPlaySuccessIdRef.current = null;

      // COLLECTIVE FAILURE MEMORY — check if this track has failed ≥3 times
      // across any user in the last 7 days. If so, skip immediately instead
      // of wasting 20s on a retry loop that will fail again.
      //
      // CASCADE GUARD (2026-04-14): if many blocked tracks land in a row
      // (rare but observed when blocklist refresh is stale and discover
      // pool is dense with dead IDs), break the chain after 5 consecutive
      // skips. Telemetry confirmed dozens of play_starts/sec when this ran
      // unbounded. Counter resets ONLY when a non-blocked track arrives.
      if (isBlocked(trackId)) {
        if (blocklistCascadeRef.current >= 5) {
          trace('cascade_brake', trackId, { why: 'cascade_ge_5', source: 'blocklist' });
          devWarn(`[VOYO] Blocklist cascade depth >= 5, stopping skip chain on ${trackId}`);
          usePlayerStore.getState().setIsPlaying(false);
          playbackState.transition('paused', trackId, 'cascade_brake_blocklist');
          return;
        }
        blocklistCascadeRef.current++;
        trace('blocklist_skip', trackId, { cascade: blocklistCascadeRef.current, hidden: document.hidden });
        devWarn(`[VOYO] Track ${trackId} on blocklist — skip (cascade ${blocklistCascadeRef.current}/5)`);
        logPlaybackEvent({
          event_type: 'skip_auto',
          track_id: trackId,
          track_title: currentTrack.title,
          track_artist: currentTrack.artist,
          error_code: 'max_retries',
          meta: { source: 'blocklist', cascade: blocklistCascadeRef.current },
        });
        trace('next_call', trackId, { from: 'blocklist', cascade: blocklistCascadeRef.current, hidden: document.hidden });
        nextTrack();
        return;
      }
      // Reached a non-blocked track — reset cascade counter.
      blocklistCascadeRef.current = 0;

      // Peek preload cache now (synchronous) so the fade-duration decision
      // is available both inside the audio block and after resolveSource.
      const isWarm = !document.hidden && !!getPreloadedTrack(trackId)?.audioElement;

      // STOP old audio immediately before loading new track.
      // NOTE: Do NOT set src = '' — this can break MediaElementAudioSourceNode in some browsers.
      // The source node stays wired through src changes automatically (Web Audio API design).
      // FIX: Clear dangling event handlers from previous loadTrack calls to prevent
      // old callbacks from firing and interfering with the new track load.
      // FADE: Ramp masterGain to silence (15ms) BEFORE pause so the outgoing
      // track fades out cleanly and the chain is silent while the new src
      // decodes. Prevents the speaker pop on every track skip.
      // NOTE: The ramp is scheduled on the AudioContext clock, so we must
      // wait for it to complete (~20ms) before calling .pause(). Otherwise
      // the pause cuts playback mid-ramp → audible click.
      if (audioRef.current) {
        isLoadingTrackRef.current = true;
        audioRef.current.oncanplaythrough = null;
        audioRef.current.oncanplay = null;
        audioRef.current.onplay = null;
        audioRef.current.loop = false;

        // isWarm hoisted above — warm = preload cache hit (0ms swap),
        // cold = VPS extraction path (fade to ~25% while extraction runs so
        // there is NO silence gap — old track stays audible until resolved).
        const fadeDurationSec = isWarm ? 0.008 : 1.5;
        const waitMs = isWarm ? 10 : 0; // cold path: don't await — resolveSource runs during the fade
        // Cold: target 25% (–12 dB) so the outgoing track remains audible
        // during VPS extraction (~10–15 s). pauseOutgoing() will snap to 0
        // the moment the next source resolves.
        const fadeTargetGain = isWarm ? 0.0001 : 0.25;

        if (gainNodeRef.current && audioContextRef.current) {
          const ctx = audioContextRef.current;
          const now = ctx.currentTime;
          const p = gainNodeRef.current.gain;
          p.cancelScheduledValues(now);
          p.setValueAtTime(p.value, now);
          p.linearRampToValueAtTime(fadeTargetGain, now + fadeDurationSec);
        }
        armGainWatchdog('mute-before-load');
        const audioToFade = audioRef.current;

        if (isWarm && !document.hidden) {
          // Warm: wait for the 8ms ramp to drain before pausing.
          await new Promise<void>(resolve => setTimeout(resolve, waitMs));
          if (isStale()) { trace('load_abandoned', trackId, { at: 'after_fade_timeout' }); devLog(`[AudioPlayer] cancelled stale load for ${trackId} after fade timeout`); return; }
          if (audioRef.current === audioToFade) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
        } else if (document.hidden) {
          // Background: engage silent wav immediately (same as before).
          if (audioRef.current === audioToFade && silentKeeperUrlRef.current) {
            engageSilentWav('bg_load_bridge', trackId);
          } else if (audioRef.current === audioToFade) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
        }
        // Cold foreground: audio keeps playing (fading) — resolveSource runs
        // in parallel below. pauseOutgoing() called after resolve returns.
      }

      // Helper: snap gain to silence + pause outgoing audio synchronously.
      // Called after resolveSource returns on the cold foreground path.
      // 2ms DC-block ramp prevents a speaker pop (gain may be at 0.25).
      // Pause is SYNCHRONOUS — no setTimeout. The prior 90ms async pause was
      // firing on the NEW track mid-buffer, occasionally halting it before
      // canplay. Since swapSrcSafely runs immediately after, the old element
      // is already stopping (src change resets HTMLMediaElement per spec).
      const pauseOutgoing = () => {
        if (!audioRef.current) return;
        if (gainNodeRef.current && audioContextRef.current) {
          const ctx = audioContextRef.current;
          const now = ctx.currentTime;
          const p = gainNodeRef.current.gain;
          p.cancelScheduledValues(now);
          p.setValueAtTime(p.value, now);
          p.linearRampToValueAtTime(0.0001, now + 0.002); // 2ms DC-block
        }
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      };

      // RESUME FIX: On initial load, always auto-resume playback.
      // Previously gated on `savedCurrentTime > 5`, which meant tracks with
      // position 0-5s (just started, or persist hadn't fired yet) never auto-
      // played — isPlaying is always false on reload, so the first track sat
      // silent until the user manually tapped play. Now we always set the flag;
      // position restore is still gated at > 5s in the canplay handlers.
      if (isInitialLoadRef.current) {
        shouldAutoResumeRef.current = true;
        devLog(`🔄 [VOYO] Session resume detected (position: ${savedCurrentTime.toFixed(1)}s) - will auto-play`);
      }

      // lastTrackIdRef.current already set at the top of loadTrack for race-free guarding
      hasRecordedPlayRef.current = false;
      trackProgressRef.current = 0;
      // Reset store position immediately so hot-swap and error recovery don't
      // read the PREVIOUS track's position and seek to it on the new track.
      usePlayerStore.getState().setCurrentTime(0);
      usePlayerStore.getState().setProgress(0);
      // Log play_start with track metadata for every loadTrack
      logPlaybackEvent({
        event_type: 'play_start',
        track_id: trackId,
        track_title: currentTrack?.title,
        track_artist: currentTrack?.artist,
      });
      hasTriggered50PercentCacheRef.current = false; // Reset 50% trigger for new track
      hasTriggered85PercentCacheRef.current = false; // Reset 85% trigger for new track
      lastProgressWriteBucketRef.current = -1; // Reset throttle bucket → first frame of new track writes
      isEdgeStreamRef.current = false; // Reset edge stream flag for new track
      hasTriggered75PercentKeptRef.current = false; // Reset 75% kept trigger for new track
      hasTriggeredContextNotifRef.current = false; // Reset OYO context notification for new track
      // crossfade refs removed — clean gapless transitions only

      // ── FLOW WATCHDOG ─────────────────────────────────────────────────
      // Arm an 8s timer. If play() doesn't clear it, loadTrack is stuck —
      // auto-skip to next track so the user always has flow.
      //
      // Why 8s: ~3s for stream fetch, ~2s for decoder init + first buffer,
      // plus safety margin for slow connections. Longer than most recovery
      // paths take, shorter than the user's patience for "why is nothing
      // playing".
      //
      // We do NOT mark the track as permanently failed. A watchdog timeout
      // could be a transient network blip — the track itself is probably
      // fine. Just advance; if the user lands on the same track later and
      // it's genuinely broken, the watchdog will skip it again.
      //
      // Stale guard ensures a late fire from a superseded loadTrack doesn't
      // skip the current playing track. Pause guard respects user intent.
      // v214 — bumped FG watchdog 8s → 12s. v215 → 20s. Cold-path extraction on the
      // VPS takes 5–7s with parallel edge+yt-dlp (proxy v2.1). Adding a
      // few seconds of headroom absorbs PoToken-cold and network-hiccup
      // cases that used to prematurely skip a healthy-but-slow load.
      clearLoadWatchdog();
      const fireWatchdog = () => {
        loadWatchdogRef.current = null;
        loadWatchdogFireFnRef.current = null;
        if (isStale()) return;
        const store = usePlayerStore.getState();
        if (!store.isPlaying) return;
        trace('watchdog_fire', trackId, { timer: 'fg-20s', hidden: document.hidden });
        devWarn(`[VOYO] Load watchdog fired for ${trackId} — 20s no-progress, skipping`);
        { const t = usePlayerStore.getState().currentTrack; logPlaybackEvent({ event_type: 'skip_auto', track_id: trackId, track_title: t?.title, track_artist: t?.artist, error_code: 'load_watchdog', meta: { timer: 'fg-12s' } }); }
        isLoadingTrackRef.current = false;
        trace('next_call', trackId, { from: 'watchdog_fg' });
        nextTrack();
      };
      loadWatchdogFireFnRef.current = fireWatchdog;
      loadWatchdogRef.current = setTimeout(fireWatchdog, 20000);
      // BACKGROUND: setTimeout is throttled to 1/min. MessageChannel is NOT
      // throttled, so we use it as a polling pump — but we MUST gate on a
      // wall-clock elapsed time. The old `ticks < 500` was iteration-only
      // and in an idle BG tab burned through all 500 iterations in
      // microseconds → watchdog fired at t=0 → next_call from=watchdog_bg →
      // new loadTrack armed a fresh MC → cascade. Telemetry showed 196
      // watchdog_fires in 50s, median load→fire delta = 0ms.
      // Fix: check Date.now() elapsed >= 5000ms before firing, and store
      // the port in bgWatchdogPortRef so clearLoadWatchdog / new loadTrack
      // can cancel it.
      if (document.hidden) {
        // Cancel any previous BG watchdog (paranoia — clearLoadWatchdog
        // also runs above, but re-entry is possible).
        if (bgWatchdogPortRef.current) {
          try { bgWatchdogPortRef.current.close(); } catch {}
          bgWatchdogPortRef.current = null;
        }
        const startMs = Date.now();
        const mc = new MessageChannel();
        bgWatchdogPortRef.current = mc.port1;
        mc.port1.onmessage = () => {
          // If a newer load took over (or clearLoadWatchdog ran), our port
          // ref no longer points to this MC — abort quietly.
          if (bgWatchdogPortRef.current !== mc.port1) {
            try { mc.port1.close(); } catch {}
            return;
          }
          const elapsed = Date.now() - startMs;
          // v214 — bumped BG watchdog 5s → 8s; v215 → 25s to cover cold VPS extraction (yt-dlp ~10s + dedup ~1s).
          if (elapsed < 25000) { mc.port2.postMessage(null); return; }
          // Time elapsed — close, re-check guards, fire.
          try { mc.port1.close(); } catch {}
          bgWatchdogPortRef.current = null;
          if (isStale() || !loadWatchdogRef.current) return;
          const store = usePlayerStore.getState();
          if (!store.isPlaying) return;
          trace('watchdog_fire', trackId, { timer: 'bg-25s', hidden: document.hidden, elapsedMs: elapsed });
          devWarn(`[VOYO] Load watchdog (bg) fired for ${trackId} — ${elapsed}ms, skipping`);
          clearLoadWatchdog();
          isLoadingTrackRef.current = false;
          trace('next_call', trackId, { from: 'watchdog_bg' });
          nextTrack();
        };
        mc.port2.postMessage(null);
      }

      // End previous session
      endListenSession(audioRef.current?.currentTime || 0, 0);
      startListenSession(currentTrack.id, currentTrack.duration || 0);

      // Resolve the track to a playable URL. sourceResolver tries preload
      // → IDB → R2 → VPS+edge race with 3 retries. Returns null if every
      // path exhausted — we then run the cascade brake.
      const resolved = await resolveSource({
        trackId,
        isStale,
        checkLocalCache: checkCache,
        trackTitle: currentTrack.title,
        trackArtist: currentTrack.artist,
      });

      if (isStale()) return;

      if (!resolved) {
        // Cold-path fade was running during resolveSource — cancel it now so
        // the outgoing audio doesn't keep fading after the skip fires.
        if (!isWarm && !document.hidden) pauseOutgoing();
        // Every path exhausted. markBlocked already set by sourceResolver.
        // Run the cascade brake: after 5 consecutive extraction failures,
        // force-pause so the user can intervene rather than sit in silence.
        blocklistCascadeRef.current++;
        const failedTrack = usePlayerStore.getState().currentTrack;
        logPlaybackEvent({
          event_type: 'skip_auto',
          track_id: trackId,
          track_title: failedTrack?.title,
          track_artist: failedTrack?.artist,
          error_code: 'max_retries',
          meta: { cascade: blocklistCascadeRef.current },
        });
        isLoadingTrackRef.current = false;
        if (blocklistCascadeRef.current >= 5) {
          trace('cascade_brake', trackId, { source: 'max_retries' });
          devWarn(`[VOYO] Extraction cascade ≥5 — force pause`);
          usePlayerStore.getState().setIsPlaying(false);
          playbackState.transition('paused', trackId, 'cascade_brake_max_retries');
          return;
        }
        trace('next_call', trackId, { from: 'max_retries', cascade: blocklistCascadeRef.current, hidden: document.hidden });
        nextTrack();
        navigator.mediaSession.playbackState = 'playing';
        return;
      }

      // Cold-path: audio was still playing during resolveSource — stop it now
      // before the src swap. Gain ramp is already at/near 0 from the 3s fade.
      if (!isWarm && !document.hidden) pauseOutgoing();

      // Apply per-source state before the src swap.
      if (resolved.source === 'preload' && resolved.preloadedAudio) {
        resolved.preloadedAudio.pause();
        resolved.preloadedAudio.src = '';
      }
      isEdgeStreamRef.current = resolved.source === 'edge' || resolved.source === 'vps';
      setPlaybackSource(
        (resolved.source === 'preload' || resolved.source === 'cached') ? 'cached' : 'r2'
      );
      if (resolved.isBlob) {
        if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
        cachedUrlRef.current = resolved.url;
      } else {
        cachedUrlRef.current = null;
      }
      if (resolved.r2LowQuality) {
        hasTriggered50PercentCacheRef.current = false; // Allow 50% upgrade trigger
      }

      const { boostProfile: profile } = usePlayerStore.getState();
      setupAudioEnhancement(profile);

      if (!audioRef.current) return;
      swapSrcSafely(resolved.url);

      // Session-keeper: network sources (vps/edge/r2-stream) can have
      // multi-second buffer gaps. If canplay doesn't fire within 3s, revert
      // to silent WAV to hold audio focus, then re-try the real URL.
      // Blob sources (preload/cached) are instant — keeper never fires.
      let keeperTimer: ReturnType<typeof setTimeout> | null = null;
      if (!resolved.isBlob && document.hidden && silentKeeperUrlRef.current) {
        keeperTimer = setTimeout(() => {
          keeperTimer = null;
          if (!audioRef.current || isStale()) return;
          if (audioRef.current.readyState < 2) {
            // Buffer gap >3s: engage silent WAV to hold focus, then re-try
            // the real URL after 800ms. Uses engageSilentWav for consistent
            // loop + trace + state lifecycle.
            engageSilentWav('buffer_gap_keeper', trackId);
            setTimeout(() => {
              if (audioRef.current && !isStale()) {
                audioRef.current.loop = false;
                audioRef.current.src = resolved.url;
                if (!resolved.isBlob) audioRef.current.load();
              }
            }, 800);
          }
        }, 3000);
      }

      // Unified canplay → fade → play() flow. Every source type goes here.
      const path = resolved.source;
      trace('canplay_await', trackId, { path, hidden: document.hidden });
      const canplayHandler = () => {
        trace('canplay_fire', trackId, { path, hidden: document.hidden, readyState: audioRef.current?.readyState });
        if (!audioRef.current) return;
        audioRef.current.removeEventListener('canplay', canplayHandler);
        audioRef.current.oncanplaythrough = null;
        if (keeperTimer) { clearTimeout(keeperTimer); keeperTimer = null; }
        if (isStale()) return;

        // Restore position on initial (reload) load.
        if (isInitialLoadRef.current) {
          if (savedCurrentTime > 5) {
            audioRef.current.currentTime = savedCurrentTime;
          }
          isInitialLoadRef.current = false;
        }

        const { isPlaying: shouldPlay } = usePlayerStore.getState();
        const shouldAutoResume = shouldAutoResumeRef.current;
        if (shouldAutoResume) shouldAutoResumeRef.current = false;

        if ((shouldPlay || shouldAutoResume) && (audioRef.current.paused || document.hidden)) {
          audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
          fadeInMasterGain(shouldAutoResume ? 200 : 80);
          trace('play_call', trackId, { path, hidden: document.hidden });
          audioRef.current.play().then(() => {
            clearLoadWatchdog();
            recordPlayEvent();
            if (shouldAutoResume && !shouldPlay) {
              usePlayerStore.getState().setIsPlaying(true);
            }
            // Clear the load guard once audio is actually playing. Without
            // this, every user pause during the rest of the track was
            // silently dropped by onPause (`why: 'loading'`) — the ref was
            // only cleared by the NEXT loadTrack's cleanup, far too late.
            isLoadingTrackRef.current = false;
            trace('play_resolved', trackId, { path });
            trace('load_complete', trackId, { path });
            playbackState.transition('playing', trackId, `load_complete_${path}`);
          }).catch(e => {
            trace('play_rejected', trackId, { path, err: e.name, msg: e.message?.slice(0, 80) });
            handlePlayFailure(e, path);
          });
        }
      };
      audioRef.current.addEventListener('canplay', canplayHandler, { once: true });
    };

    loadTrack();

    return () => {
      // Disarm any pending watchdog from the previous load so it doesn't
      // fire against the new track's in-flight load.
      disarmGainWatchdog();
      clearLoadWatchdog();
      // Stall timer from previous track — might still be armed if we
      // transitioned during a stall. Clear it so recoverNow doesn't fire
      // a late recovery on the new track.
      clearStallTimer();
      // Clear loading guard so a stalled/failed load doesn't leave the
      // onPause handler permanently muted. The next loadTrack will set it
      // again at the start of its own pause cycle.
      isLoadingTrackRef.current = false;
      if (cachedUrlRef.current) {
        URL.revokeObjectURL(cachedUrlRef.current);
        cachedUrlRef.current = null;
      }
    };
  }, [currentTrack?.trackId]);

  // Helper: Record play event
  const recordPlayEvent = useCallback(() => {
    if (hasRecordedPlayRef.current || !currentTrack) return;
    hasRecordedPlayRef.current = true;
    // Capture refs locally so the deferred call doesn't read a newer track
    const track = currentTrack;
    const prev = previousTrackRef.current;
    previousTrackRef.current = currentTrack;
    // Defer the 6 services to the next macrotask. Each one does sync work
    // (poolStore O(n) map, oyoDJ saveProfile = JSON.stringify + localStorage
    // setItem, etc.) that totals 20-100ms of main thread blocking. Running
    // synchronously inside the audio.play() promise resolution starves the
    // Defer ALL telemetry to idle. Was setTimeout(0) which fires as a
    // macrotask that competes with audio buffer refills. The 6 service
    // calls total 5-20ms of synchronous work (Zustand set, O(n) pool
    // iteration, oyoDJ profile stringify, Supabase async). At 256-sample
    // buffers (~5.8ms), this is guaranteed to underrun.
    // requestIdleCallback runs when the browser has free time — NEVER
    // during audio buffer processing.
    const doRecord = () => {
      try {
        recordPoolEngagement(track.trackId, 'play');
        useTrackPoolStore.getState().recordPlay(track.trackId);
        recordTrackInSession(track, 0, false, false);
        djRecordPlay(track, false, false);
        oyoOnTrackPlay(track, prev || undefined);
        viRegisterPlay(track.trackId, track.title, track.artist, 'user_play');
        devLog(`[VOYO] Recorded play: ${track.title}`);
        // GLOBAL SIGNAL: persist play to video_intelligence for recommender learning
        import('../lib/supabase').then(({ supabase }) => {
          void (supabase?.rpc('record_signal', { p_youtube_id: track.trackId, p_action: 'play' }) as unknown as Promise<unknown>)?.catch(() => {});
        });
      } catch (e) {
        devWarn('[VOYO] recordPlayEvent failed:', e);
      }
    };
    const wr = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
    if (typeof wr.requestIdleCallback === 'function') {
      wr.requestIdleCallback(doRecord, { timeout: 3000 });
    } else {
      setTimeout(doRecord, 100);
    }
  }, [currentTrack]);

  // Hot-swap (mid-track R2 → cached upgrade when boost completes).
  useHotSwap({
    audioRef,
    audioContextRef,
    cachedUrlRef,
    isEdgeStreamRef,
    lastBoostCompletion,
    currentTrack,
    playbackSource,
    checkCache,
    setPlaybackSource,
    setupAudioEnhancement,
    muteMasterGainInstantly,
    fadeInMasterGain,
  });

  // Play/pause fade, volume, boost preset, VOYEX spatial — all internal
  // effects of useAudioChain. Battery-suspend timer lives in bgEngine.

  // Seek — direct element operation, stays in the host.
  useEffect(() => {
    if (seekPosition === null || (playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;
    audioRef.current.currentTime = seekPosition;
    clearSeekPosition();
  }, [seekPosition, playbackSource, clearSeekPosition]);

  // Playback rate — direct element operation, stays in the host.
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;
    audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, playbackSource]);

  // BUFFER HEALTH MONITORING: Active monitoring every 2s during playback
  // Emergency (<3s buffer): immediately try local cache fallback
  // Warning (<8s buffer): start pre-fetching more aggressively
  useEffect(() => {
    if (!audioRef.current || !isPlaying) return;
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;

    const cleanup = audioEngine.startBufferMonitoring(
      audioRef.current,
      // EMERGENCY: buffer < 3 seconds
      async (health) => {
        if (!currentTrack?.trackId || !audioRef.current) return;
        devWarn(`🚨 [VOYO] Buffer EMERGENCY: ${health.current.toFixed(1)}s remaining`);
        setBufferHealth(health.percentage, 'emergency');

        // If streaming from edge (not local cache), try to swap to local cache immediately
        if (isEdgeStreamRef.current) {
          const cachedUrl = await checkCache(currentTrack.trackId);
          if (cachedUrl && audioRef.current) {
            const savedPos = audioRef.current.currentTime;
            devLog('🔄 [VOYO] Emergency cache swap - switching to local cache');
            if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
            cachedUrlRef.current = cachedUrl;
            // FIX: Clear ALL dangling handlers before emergency swap —
            // onplay in particular can leak from the edge-stream path.
            audioRef.current.oncanplaythrough = null;
            audioRef.current.oncanplay = null;
            audioRef.current.onplay = null;
            // FADE: ramp masterGain to silence before src swap to avoid pop.
            // audio.volume stays at 1.0; loudness is governed by the Web Audio chain.
            muteMasterGainInstantly();
            audioRef.current.src = cachedUrl;
            audioRef.current.load();
            audioRef.current.oncanplaythrough = () => {
              if (!audioRef.current) return;
              if (savedPos > 2) audioRef.current.currentTime = savedPos;
              isEdgeStreamRef.current = false;
              setPlaybackSource('cached');
              // Queue the fade-in BEFORE play() so first samples land under ramp.
              fadeInMasterGain(80);
              audioRef.current.play().catch(() => {});
              devLog('🔄 [VOYO] Emergency cache swap complete');
            };
          }
        }
      },
      // WARNING: buffer < 8 seconds
      (health) => {
        devWarn(`⚠️ [VOYO] Buffer WARNING: ${health.current.toFixed(1)}s remaining`);
        setBufferHealth(health.percentage, 'warning');

        // Trigger aggressive pre-caching of current track if not already cached
        if (isEdgeStreamRef.current && currentTrack?.trackId) {
          const trackId = currentTrack.trackId;
          cacheTrack(
            trackId,
            currentTrack.title,
            currentTrack.artist,
            currentTrack.duration || 0,
            `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${trackId}?quality=high`
          ).catch(() => {});
        }
      }
    );

    return cleanup;
  }, [isPlaying, playbackSource, currentTrack?.trackId, checkCache, setBufferHealth, setPlaybackSource, cacheTrack]);

  // MediaSession (OS lock screen + hardware buttons) lives in its own module.
  useMediaSession({
    audioRef,
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    muteMasterGainInstantly,
    fadeInMasterGain,
    engageSilentWav,
  });

  // Heartbeat (MC-based 4s loop with all BG detectors) lives in bgEngine.

  // Audio element handlers (only active when using audio element: cached or r2)
  //
  // THROTTLED STORE WRITES: ontimeupdate fires 4-66Hz (Safari is worst).
  // 9 components subscribe to currentTime/progress — every write re-renders
  // all of them. At Safari's 66Hz that's ~600 component re-renders/second
  // during playback, consuming main thread CPU that the audio thread needs.
  //
  // Throttle:
  //   - Store writes → 4Hz (every 250ms). Quarter-second buckets are smooth
  //     enough for progress bars but 16× lighter on Safari.
  //   - trackProgressRef.current → EVERY fire. Milestone checks (50/75/85%,
  //     preload, auto-cache) read from the ref so they're still precise.
  //   - mediaSession.setPositionState → 1Hz. Native bridge calls are slow,
  //     1s resolution is plenty for the OS/lockscreen display.
  const handleTimeUpdate = useCallback(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.duration) return;

    // BACKGROUND KEEP-ALIVE: Chrome may suspend AudioContext for battery
    // during long background sessions. The audio element still fires
    // timeupdate (based on its internal clock), but the Web Audio chain
    // is frozen → silence. Resume if needed. Fires at 4Hz, the check
    // is a single property read → negligible cost.
    if (document.hidden && audioContextRef.current &&
        (audioContextRef.current.state === 'suspended' || (audioContextRef.current as any).state === 'interrupted')) {
      audioContextRef.current.resume().catch(() => {});
    }

    const el = audioRef.current;
    const progress = (el.currentTime / el.duration) * 100;
    // Always update the ref — zero cost, no re-render, keeps milestone
    // checks accurate even if store is throttled.
    trackProgressRef.current = progress;

    // 4Hz bucket throttle for store writes. floor(currentTime * 4) changes
    // every 250ms, so we write at most 4× per second regardless of how
    // often the event fires.
    const bucket = Math.floor(el.currentTime * 4);
    if (bucket !== lastProgressWriteBucketRef.current) {
      lastProgressWriteBucketRef.current = bucket;
      setCurrentTime(el.currentTime);
      setProgress(progress);
      // Milestone checks also run at 4Hz — same bucket rate. AudioPlayer
      // no longer re-renders on progress change, so these have to fire
      // from inside the callback, not a useEffect.
      checkProgressMilestones(progress);
    }

    // Crossfade trigger removed — will implement with two audio elements.
    // Tracks end naturally via handleEnded → nextTrack → loadTrack → play.

    // 1Hz throttle for mediaSession — native bridge is expensive on iOS.
    if ('mediaSession' in navigator) {
      const now = performance.now();
      if (now - lastMediaSessionWriteRef.current >= 1000) {
        lastMediaSessionWriteRef.current = now;
        try {
          navigator.mediaSession.setPositionState({
            duration: el.duration, playbackRate: el.playbackRate, position: el.currentTime
          });
        } catch (e) {}
      }
    }

    // v197 PROACTIVE TRANSITION (The Answer):
    // At duration - 0.5s, transition NOW instead of waiting for `ended`.
    // The `ended` event is unreliable in BG (Chrome drops it), and waiting
    // for it creates a paused window where the OS revokes audio focus.
    // Proactively advancing keeps the element continuously playing:
    //   real track (last 0.5s) → silent WAV bridge → next track's blob
    // With v196 preload working, the next track is already a blob in
    // IndexedDB — src swap is instant, local, network-free, BG-safe.
    const state = usePlayerStore.getState();
    const trackId = state.currentTrack?.trackId;
    if (
      trackId &&
      proactivelyAdvancedForTrackIdRef.current !== trackId &&
      state.isPlaying &&
      el.duration - el.currentTime <= 0.5 &&
      el.duration > 1.0 && // avoid firing on <1s silent WAV during load
      el.src !== silentKeeperUrlRef.current // don't proactively advance during bridge
    ) {
      proactivelyAdvancedForTrackIdRef.current = trackId;
      trace('proactive_advance', trackId, {
        currentTime: el.currentTime,
        duration: el.duration,
        remaining: el.duration - el.currentTime,
        hidden: document.hidden,
      });
      // Reuse synthetic-bypass so runEndedAdvance accepts the call despite
      // audio.ended === false. Same pattern as v189 synthetic-ended.
      syntheticEndedBypassRef.current = true;
      runEndedAdvanceRef.current();
    }
  }, [playbackSource, setCurrentTime, setProgress, checkProgressMilestones]);

  const handleDurationChange = useCallback(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.duration) return;
    setDuration(audioRef.current.duration);
  }, [playbackSource, setDuration]);

  // Shared ended-event body used by BOTH the React onEnded JSX handler and
  // the native addEventListener('ended') below. Whichever fires first sets
  // the dedup ref and runs the work; the other sees the match and early-
  // returns. Having both registered keeps background Android Chrome
  // reliable (native listener can stutter under heavy throttle, React's
  // synthetic events have their own scheduling).
  //
  // Was split into handleEnded + a duplicate body inside onEndedDirect —
  // ~50 lines of near-identical logic. Consolidated here.
  const runEndedAdvance = useCallback(() => {
    const state = usePlayerStore.getState();
    const trackId = state.currentTrack?.trackId;
    const audioEnded = audioRef.current?.ended === true;
    const synthetic = syntheticEndedBypassRef.current;
    syntheticEndedBypassRef.current = false; // consume flag
    const currentSrc = audioRef.current?.currentSrc || '';
    trace('ended_fire', trackId || '-', { hidden: document.hidden, prevEndedRef: lastEndedTrackIdRef.current, audioEnded, synthetic, srcTail: currentSrc.slice(-40) });

    // CASCADE GUARD (v193): if the audio element's src hasn't changed since
    // the last ended event we processed, this is a duplicate — the native
    // 'ended' and React synthetic onEnded both firing for the same end-of-
    // stream. Without this, each pair advances twice, skipping every other
    // track. Synthetic bypass path skips this (it's explicitly a new attempt
    // to advance the same track we couldn't end normally).
    if (!synthetic && currentSrc && lastEndedSrcRef.current === currentSrc) {
      trace('ended_dedup', trackId || '-', { why: 'same_src_cascade', srcTail: currentSrc.slice(-40) });
      return;
    }
    // STALE-EVENT GUARD: if the audio element is NOT currently in ended
    // state, this event is stale — fired for a previous source that we've
    // already advanced past. Was burning the queue: native onEndedDirect
    // fires → advances → loadTrack resets the dedup ref → React's late
    // synthetic onEnded fires → finds null ref → advances AGAIN, skipping
    // every other track. Visible in trace as ended_fire/next_call pairs
    // for back-to-back trackIds with no play_resolved between.
    //
    // SYNTHETIC BYPASS: in deep BG, Android Chrome sometimes doesn't set
    // audio.ended=true even when currentTime passes duration — the element
    // just sits silently paused. Heartbeat detects that pattern and sets
    // syntheticEndedBypassRef so we advance anyway. Without this bypass,
    // every track that "ends" in deep BG gets stuck.
    if (!audioEnded && !synthetic) {
      trace('ended_dedup', trackId || '-', { why: 'audio_not_ended_stale' });
      return;
    }
    if (!trackId || lastEndedTrackIdRef.current === trackId) {
      trace('ended_dedup', trackId || '-', { why: 'ref_already_set' });
      return;
    }
    lastEndedTrackIdRef.current = trackId;
    // Latch the src we're advancing FROM — next ended event on the same
    // src is a duplicate. Cleared naturally when audio.currentSrc changes
    // (loadTrack assigns a new src → currentSrc differs → next ended
    // passes the guard).
    if (currentSrc) lastEndedSrcRef.current = currentSrc;

    const { playbackSource: ps, isPlaying: playing, currentTrack: track } = state;
    if (ps !== 'cached' && ps !== 'r2') { trace('ended_bail', trackId, { why: `src_${ps}` }); return; }
    if (!playing) { trace('ended_bail', trackId, { why: 'not_playing' }); return; }

    // Capture state BEFORE nextTrack advances the store
    const currentTime = audioRef.current?.currentTime || 0;
    const completionRate = trackProgressRef.current;
    const wasEdgeStream = isEdgeStreamRef.current;
    const cacheNotYetTriggered = !hasTriggered85PercentCacheRef.current;

    devLog('🔄 [VOYO] Track ended — advancing to next');
    haptics.light();

    // CRITICAL BG GAP CLOSURE: engage the silent WAV RIGHT NOW, BEFORE
    // nextTrack() schedules a React re-render + useEffect + loadTrack.
    // In BG, that chain can take 100-500ms. During that gap, audio.ended
    // is true → element has no active source → Android releases audio
    // focus → fresh play() on the new src fails because there's no
    // session to receive it → user perceives 'BG next just silently
    // doesn't play.'
    //
    // By setting src=silentWAV synchronously here, the audio element goes
    // right back into an active playing state (audio.ended becomes false
    // the moment src is set). Focus is maintained continuously across
    // the entire transition. When loadTrack eventually runs for the new
    // track, it swaps the silent WAV for the real source on an audio
    // element that never lost focus.
    if (document.hidden) engageSilentWav('pre_advance_bridge', trackId);

    trace('next_call', trackId, { from: 'ended_advance', hidden: document.hidden });
    playbackState.transition('advancing', trackId, synthetic ? 'synthetic_ended' : 'natural_ended');
    nextTrack();

    // Keep OS notification alive through the load gap with a position reset
    // + fresh metadata (critical in background).
    navigator.mediaSession.playbackState = 'playing';
    try { navigator.mediaSession.setPositionState({ duration: 0, position: 0, playbackRate: 1 }); } catch {}
    const next = usePlayerStore.getState().currentTrack;
    if (next) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: next.title,
        artist: next.artist,
        album: 'VOYO Music',
        artwork: [
          { src: `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${next.trackId}?quality=high`, sizes: '512x512', type: 'image/jpeg' },
          { src: `https://i.ytimg.com/vi/${next.trackId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
        ],
      });
      notifyNextUp(next.title, next.artist);
    }

    // Telemetry / pool / OYO learning for the PREVIOUS track — deferred.
    if (track) {
      setTimeout(() => {
        try {
          endListenSession(currentTime, 0);
          recordPoolEngagement(track.trackId, 'complete', { completionRate });
          useTrackPoolStore.getState().recordCompletion(track.trackId, completionRate);
          oyoOnTrackComplete(track, currentTime);
          if (wasEdgeStream && cacheNotYetTriggered && track.trackId) {
            devLog('🎵 [VOYO] fallback cache (85% effect missed)');
            cacheTrack(
              track.trackId, track.title, track.artist, track.duration || 0,
              `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${track.trackId}?quality=high`
            );
          }
        } catch (e) {
          devWarn('[VOYO] ended-advance telemetry failed:', e);
        }
      }, 0);
    }
  }, [nextTrack, endListenSession, cacheTrack]);

  // Populate the hoisted runEndedAdvanceRef once runEndedAdvance is defined.
  useEffect(() => { runEndedAdvanceRef.current = runEndedAdvance; }, [runEndedAdvance]);

  const handleEnded = runEndedAdvance; // React onEnded safety-belt handler

  // Src-based cascade dedup (v193). Unlike trackId, audio.currentSrc only
  // changes when loadTrack actually swaps the src — which happens AFTER
  // the React synthetic ended + native ended race window. Two rapid ended
  // events see the same currentSrc; the second bails.
  const lastEndedSrcRef = useRef<string | null>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    // Native ended listener — whichever of (React onEnded) or (this) fires
    // first wins via the lastEndedTrackIdRef dedup. Shared body lives in
    // runEndedAdvance so there's no drift.
    el.addEventListener('ended', runEndedAdvance);
    return () => el.removeEventListener('ended', runEndedAdvance);
  }, [runEndedAdvance]);

  const handleProgress = useCallback(() => {
    // v214 adaptive watchdog — bytes are flowing, extend the countdown.
    // Fires here first, before the buffer-health branch, so we also
    // bump the watchdog even during the early pre-canplay phase when
    // buffered.length may still be 0.
    bumpLoadWatchdog();
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.buffered.length) return;
    const health = audioEngine.getBufferHealth(audioRef.current);
    setBufferHealth(health.percentage, health.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackSource, setBufferHealth]);

  // ERROR HANDLER: Handle audio element errors with recovery (music never stops)
  // IMPROVED: Immediate cache check first (should be ready with 3s auto-cache),
  // seamless position-preserving swap, max 500ms silence target
  // Error recovery (audio_error + stall) lives in its own module.
  const { handleAudioError, handleStalled, clearStallTimer } = useErrorRecovery({
    audioRef,
    cachedUrlRef,
    isEdgeStreamRef,
    loadAttemptRef,
    playbackSource,
    currentTrack,
    checkCache,
    clearLoadWatchdog,
    nextTrack,
    setPlaybackSource,
    muteMasterGainInstantly,
    fadeInMasterGain,
  });

  return (
    <audio
      ref={(el) => {
        audioRef.current = el;
        // Disable pitch-preserving resampler — saves significant CPU on
        // weak devices. Pitch preservation only matters when playbackRate
        // is changed; we don't expose that as a user feature.
        if (el && 'preservesPitch' in el) {
          (el as any).preservesPitch = false;
        }
      }}
      crossOrigin="anonymous"
      preload="auto"
      playsInline
      onTimeUpdate={handleTimeUpdate}
      onDurationChange={handleDurationChange}
      // RESTORED as background safety belt. The `lastEndedTrackIdRef` dedup
      // (inside both handleEnded and onEndedDirect) guarantees only ONE of
      // the two fires per ended event — whichever wins the race sets the ref,
      // the other early-returns. Native listeners can be flaky in heavily-
      // throttled background tabs; React's synthetic event scheduling acts
      // as a fallback when native misses. handleEnded's telemetry side
      // effects re-fire safely (idempotent operations on the same trackId).
      onEnded={handleEnded}
      onProgress={handleProgress}
      onError={handleAudioError}
      // ── SOURCE OF TRUTH SYNC ────────────────────────────────────────
      // The audio element is the source of truth for play/pause state.
      // Whatever it's actually doing, the store mirrors it. The button UI
      // reads from the store, so it always matches what the speakers are
      // doing — no more "shows playing but no sound" lies.
      //
      // Previously the onPause handler tried to FORCE-RESUME if the store
      // said `isPlaying: true`, which created a fight (store says play,
      // audio is paused, handler resumes, autoplay-blocked, audio paused
      // again, repeat). That's gone. The audio element gets to be the
      // truth; the store is the reflection.
      onPlay={() => {
        // GUARD ORDER FIX (A5): the silent-WAV detection MUST run before
        // setIsPlaying(true) — otherwise the bridge's auto-play flips the
        // store back to playing immediately after a user paused, leaving
        // store and audio element fighting. Bridge plays should be invisible
        // to the store (the previous src/isPlaying state remains the truth).
        const src = audioRef.current?.src;
        if (src && silentKeeperUrlRef.current && src === silentKeeperUrlRef.current) return;

        if (playbackSource === 'cached' || playbackSource === 'r2') {
          setBufferHealth(100, 'healthy');
        }
        usePlayerStore.getState().setIsPlaying(true);
        // Keep the state machine in sync with the audio element. Without
        // this, a paused→play resume (user tap on an already-loaded track)
        // leaves the state machine in 'paused' while audio plays — which
        // desyncs subsequent transition guards. load_complete_* covers the
        // loading→playing case; this covers paused→playing + any other
        // legitimate resume path.
        {
          const tid = usePlayerStore.getState().currentTrack?.trackId;
          const cur = playbackState.get().state;
          if (cur !== 'playing' && cur !== 'loading' && cur !== 'bridge') {
            playbackState.transition('playing', tid ?? null, 'onPlay_resume');
          }
        }
        // Only log play_success when a real source is bound.
        if (playbackSource !== 'cached' && playbackSource !== 'r2') return;
        // Dedup play_success per trackId — even if play() fires twice on
        // the same load (rare race between visibility re-kick + canplay),
        // telemetry stays clean. Reset is in loadTrack.
        const cTrack = usePlayerStore.getState().currentTrack;
        if (cTrack?.trackId && lastPlaySuccessIdRef.current === cTrack.trackId) return;
        if (cTrack?.trackId) lastPlaySuccessIdRef.current = cTrack.trackId;
        // Reset cascade counter on ANY successful play — if user resumed
        // after a force-pause, the cascade is healed; if next-track succeeded,
        // we shouldn't carry the counter into a healthy run. Without this,
        // a stale 5-cascade from earlier could force-pause the next failing
        // track immediately even though playback recovered (A4 finding).
        blocklistCascadeRef.current = 0;
        const track = usePlayerStore.getState().currentTrack;
        if (track?.trackId) {
          logPlaybackEvent({
            event_type: 'play_success',
            track_id: track.trackId,
            track_title: track.title,
            track_artist: track.artist,
            source: playbackSource === 'cached' ? 'cache' : playbackSource,
          });
        }
      }}
      onPlaying={() => {
        clearStallTimer();
        (playbackSource === 'cached' || playbackSource === 'r2') && setBufferHealth(100, 'healthy');
      }}
      onLoadedMetadata={() => {
        // v214 adaptive watchdog — metadata parsed, stream is alive.
        bumpLoadWatchdog();
      }}
      onWaiting={() => {
        // 'waiting' fires on EVERY brief rebuffer (RTT spike, slow CDN,
        // buffer dip). It's noisy. We only update buffer health here —
        // recovery is reserved for the more definitive 'stalled' event.
        (playbackSource === 'cached' || playbackSource === 'r2') && setBufferHealth(50, 'warning');
        // Trace only in BG — FG noise is not useful. In BG the 'waiting'
        // event is a critical signal (Chrome may drop focus during a long
        // wait) so we want visibility even though it's chatty.
        if (document.hidden) {
          const el = audioRef.current;
          const bufEnd = el?.buffered.length ? el.buffered.end(el.buffered.length - 1) : null;
          trace('waiting', usePlayerStore.getState().currentTrack?.trackId, {
            position: el?.currentTime,
            readyState: el?.readyState,
            bufferedAhead: bufEnd != null && el ? (bufEnd - el.currentTime) : null,
          });
        }
      }}
      onStalled={handleStalled}
      onSuspend={() => clearStallTimer()}
      onPause={() => {
        const tid = usePlayerStore.getState().currentTrack?.trackId;
        if (isLoadingTrackRef.current) { trace('pause_guard', tid, { why: 'loading' }); return; }
        if (audioRef.current?.ended) { trace('pause_guard', tid, { why: 'ended' }); return; }
        if (document.hidden || isTransitioningToBackgroundRef.current) { trace('pause_guard', tid, { why: 'bg_transition', hidden: document.hidden }); return; }
        usePlayerStore.getState().setIsPlaying(false);
        playbackState.transition('paused', tid ?? null, 'user_pause');
        trace('pause_accept', tid, { storeSet: true, prevState: playbackState.get().prev });
      }}
      style={{ display: 'none' }}
    />
  );
};

export default AudioPlayer;
