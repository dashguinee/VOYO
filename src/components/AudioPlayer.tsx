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

import { useEffect, useRef, useCallback, useState } from 'react';
import { Track } from '../types';
import { usePlayerStore } from '../store/playerStore';
import { devLog, devWarn } from '../utils/logger';
import { usePreferenceStore } from '../store/preferenceStore';
import { useDownloadStore } from '../store/downloadStore';
import { useTrackPoolStore } from '../store/trackPoolStore';
import { audioEngine, connectAudioChain, getAnalyser } from '../services/audioEngine';
import { haptics } from '../utils/haptics';
import { checkR2Cache } from '../services/api';
import { downloadTrack, getCachedTrackUrl } from '../services/downloadManager';

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
import { getBatteryState } from '../services/battery';
import { isBlocked } from '../services/trackBlocklist';
import {
  preloadNextTrack,
  cleanupPreloaded,
  cancelPreload,
} from '../services/preloadManager';
import { useBgEngine } from '../audio/bg/bgEngine';
import { resolveSource } from '../audio/sources/sourceResolver';
import { useMediaSession } from '../audio/playback/mediaSession';
import { useHotSwap } from '../audio/playback/hotSwap';
import { useErrorRecovery } from '../audio/recovery/errorRecovery';

export type BoostPreset = 'off' | 'boosted' | 'calm' | 'voyex';

// Audio boost presets
const BOOST_PRESETS = {
  boosted: {
    gain: 1.15, highPassFreq: 0, bassFreq: 80, bassGain: 5, presenceFreq: 3000, presenceGain: 2,
    subBassFreq: 40, subBassGain: 2, warmthFreq: 250, warmthGain: 1,
    airFreq: 10000, airGain: 1, harmonicAmount: 0, stereoWidth: 0,
    compressor: { threshold: -12, knee: 10, ratio: 4, attack: 0.003, release: 0.25 }
  },
  calm: {
    gain: 1.05, highPassFreq: 0, bassFreq: 80, bassGain: 3, presenceFreq: 3000, presenceGain: 1,
    subBassFreq: 50, subBassGain: 1, warmthFreq: 250, warmthGain: 2,
    airFreq: 8000, airGain: 2, harmonicAmount: 0, stereoWidth: 0,
    compressor: { threshold: -15, knee: 15, ratio: 3, attack: 0.005, release: 0.3 }
  },
  voyex: {
    // PROFESSIONAL MASTERING: Multiband compression + stereo widening
    multiband: true, // Enable multiband processing
    gain: 1.4, highPassFreq: 25, stereoWidth: 0.015,
    // Band crossover frequencies
    lowCrossover: 180, // Below 180Hz = bass band
    highCrossover: 4500, // Above 4.5kHz = treble band
    // Per-band settings: gain, then compressor
    low: { gain: 1.3, threshold: -18, ratio: 5, attack: 0.01, release: 0.15 }, // Heavy bass control
    mid: { gain: 1.1, threshold: -12, ratio: 2, attack: 0.02, release: 0.25 }, // Gentle, dynamic mids
    high: { gain: 1.25, threshold: -15, ratio: 3, attack: 0.005, release: 0.1 }, // Crisp highs
    // Legacy (for fallback)
    bassFreq: 80, bassGain: 0, presenceFreq: 3000, presenceGain: 0,
    subBassFreq: 50, subBassGain: 0, warmthFreq: 280, warmthGain: 0,
    airFreq: 12000, airGain: 0, harmonicAmount: 8,
    compressor: { threshold: -6, knee: 10, ratio: 2, attack: 0.01, release: 0.2 }
  },
};

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
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const presenceFilterRef = useRef<BiquadFilterNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const subBassFilterRef = useRef<BiquadFilterNode | null>(null);
  const warmthFilterRef = useRef<BiquadFilterNode | null>(null);
  const airFilterRef = useRef<BiquadFilterNode | null>(null);
  const harmonicExciterRef = useRef<WaveShaperNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const stereoDelayRef = useRef<DelayNode | null>(null);
  const stereoSplitterRef = useRef<ChannelSplitterNode | null>(null);
  const stereoMergerRef = useRef<ChannelMergerNode | null>(null);
  const highPassFilterRef = useRef<BiquadFilterNode | null>(null);
  // Multiband compression nodes (VOYEX mastering chain)
  const multibandLowFilterRef = useRef<BiquadFilterNode | null>(null);
  const multibandMidLowFilterRef = useRef<BiquadFilterNode | null>(null);
  const multibandMidHighFilterRef = useRef<BiquadFilterNode | null>(null);
  const multibandHighFilterRef = useRef<BiquadFilterNode | null>(null);
  const multibandLowCompRef = useRef<DynamicsCompressorNode | null>(null);
  const multibandMidCompRef = useRef<DynamicsCompressorNode | null>(null);
  const multibandHighCompRef = useRef<DynamicsCompressorNode | null>(null);
  const multibandLowGainRef = useRef<GainNode | null>(null);
  const multibandMidGainRef = useRef<GainNode | null>(null);
  const multibandHighGainRef = useRef<GainNode | null>(null);
  // Multiband bypass — root cause fix for muffling on non-VOYEX presets
  const multibandBypassDirectRef = useRef<GainNode | null>(null);
  const multibandBypassMbRef = useRef<GainNode | null>(null);
  // Spatial chain bypass — same root-cause fix for the spatial layer
  const spatialBypassDirectRef = useRef<GainNode | null>(null);
  const spatialBypassMainRef = useRef<GainNode | null>(null);
  const audioEnhancedRef = useRef<boolean>(false);
  const currentProfileRef = useRef<BoostPreset>('boosted');

  // VOYEX Spatial Layer refs
  const spatialEnhancedRef = useRef<boolean>(false);
  const crossfeedLeftGainRef = useRef<GainNode | null>(null);
  const crossfeedRightGainRef = useRef<GainNode | null>(null);
  const panDepthGainRef = useRef<GainNode | null>(null);
  const panDepthYGainRef = useRef<GainNode | null>(null);
  const panDepthZGainRef = useRef<GainNode | null>(null);
  const diveLowPassRef = useRef<BiquadFilterNode | null>(null);
  const haasDelayRef = useRef<DelayNode | null>(null);
  const diveReverbWetRef = useRef<GainNode | null>(null);
  const immerseReverbWetRef = useRef<GainNode | null>(null);
  const subHarmonicGainRef = useRef<GainNode | null>(null);
  const spatialInputRef = useRef<GainNode | null>(null);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
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
  const hasTriggeredPreloadRef = useRef<boolean>(false); // 70% next-track preload trigger
  // v196 fix: the boolean above is reset INSIDE the async loadTrack body
  // (line ~1779), but React runs the preload effect BEFORE loadTrack body.
  // Result: on every track change, preload effect sees the flag still true
  // from the previous track and bails — preload never fired for any track
  // after the first. Using a per-trackId dedup ref instead removes the
  // timing dependency entirely.
  const preloadedForTrackIdRef = useRef<string | null>(null);
  const shouldAutoResumeRef = useRef<boolean>(false); // Resume playback on refresh if position was saved
  const pendingAutoResumeRef = useRef<boolean>(false); // True when autoplay was blocked by browser — first user tap resumes
  const isEdgeStreamRef = useRef<boolean>(false); // True when playing from Edge Worker stream URL (not IndexedDB)
  const hasTriggered75PercentKeptRef = useRef<boolean>(false); // 75% permanent cache trigger
  const hasTriggered30sListenRef = useRef<boolean>(false); // 30s artist discovery listen tracking
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
  const predictNextTrack = usePlayerStore(s => s.predictNextTrack);
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
  // Staggered: next track immediately, track+2 after 5s, track+3 after 10s
  useEffect(() => {
    if (!currentTrack?.trackId) {
      return;
    }
    // v196: dedup by trackId instead of a reset-able boolean. The old flag
    // approach had a React-effect-order race that made preload fire only
    // for the first track of a session. trackId-based dedup has no timing
    // dependency — this effect runs once per actual track change, period.
    if (preloadedForTrackIdRef.current === currentTrack.trackId) {
      return;
    }
    preloadedForTrackIdRef.current = currentTrack.trackId;
    // Keep the old flag in sync so other paths that read it still work.
    hasTriggeredPreloadRef.current = false;

    // Gather next 2-3 tracks from queue + prediction
    const getUpcomingTracks = (): Track[] => {
      const upcoming: Track[] = [];
      const seenIds = new Set<string>();

      // First: take from queue
      for (const qi of queue) {
        if (qi.track?.trackId && !seenIds.has(qi.track.trackId)) {
          upcoming.push(qi.track);
          seenIds.add(qi.track.trackId);
          if (upcoming.length >= 3) break;
        }
      }

      // Fill remaining with predictions
      if (upcoming.length < 3) {
        const predicted = predictNextTrack();
        if (predicted?.trackId && !seenIds.has(predicted.trackId)) {
          upcoming.push(predicted);
          seenIds.add(predicted.trackId);
        }
      }

      return upcoming;
    };

    const tracksToPreload = getUpcomingTracks();
    if (tracksToPreload.length === 0) {
      devLog(`🔮 [Preload] No upcoming tracks available (queue empty, prediction empty)`);
      return;
    }

    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    // Stagger preloads: 1.5s, 6s, 12s — first preload fires after the
    // current track's decoder stabilizes. In BACKGROUND, fire first
    // preload immediately — setTimeout is throttled to 1/min, so a
    // 1.5s delay becomes 60s. The next track needs to be ready BEFORE
    // the current one ends.
    const staggerDelays = document.hidden ? [0, 2000, 5000] : [1500, 6000, 12000];

    tracksToPreload.forEach((track, index) => {
      const delay = staggerDelays[index] || staggerDelays[staggerDelays.length - 1];

      const tid = setTimeout(() => {
        // Double-check we haven't changed tracks
        const currentState = usePlayerStore.getState();
        if (currentState.currentTrack?.trackId !== currentTrack.trackId) return;

        // Only set the flag on the first preload (prevents re-triggering the whole batch)
        if (index === 0) {
          hasTriggeredPreloadRef.current = true;
        }

        devLog(`🔮 [VOYO] Preloading track ${index + 1}/${tracksToPreload.length}: ${track.title}`);

        preloadNextTrack(track.trackId, checkCache).then((result) => {
          if (result) {
            devLog(`🔮 [VOYO] ✅ Preload ${index + 1} ready: ${track.title} (source: ${result.source})`);
          }
        }).catch((err) => {
          devWarn(`🔮 [VOYO] Preload ${index + 1} failed:`, err);
        });
      }, delay);

      timeoutIds.push(tid);
    });

    return () => timeoutIds.forEach(id => clearTimeout(id));
  }, [currentTrack?.trackId, queue, checkCache, predictNextTrack]);

  // PRELOAD CLEANUP: Cancel preload when track changes (user skipped to different track)
  useEffect(() => {
    return () => {
      cancelPreload();
    };
  }, [currentTrack?.trackId]);

  // Visibility handler lives in bgEngine now (src/audio/bg/bgEngine.ts).

  // Wake lock
  useEffect(() => {
    const manageWakeLock = async () => {
      if (!isPlaying && wakeLockRef.current) {
        await wakeLockRef.current.release().catch(e => devWarn('🔒 [WakeLock] Release failed:', e.name));
        wakeLockRef.current = null;
        return;
      }
      if (isPlaying && 'wakeLock' in navigator && !wakeLockRef.current) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        } catch (e) {
          devWarn('🔒 [WakeLock] Request failed:', (e as Error).name);
        }
      }
    };
    manageWakeLock();
    return () => { wakeLockRef.current?.release().catch(e => devWarn('🔒 [WakeLock] Cleanup release failed:', e.name)); };
  }, [isPlaying]);

  // Silent WAV blob generation lives in bgEngine (src/audio/bg/bgEngine.ts).

  // ── FREQUENCY PUMP ─────────────────────────────────────────────────
  // Reads the AnalyserNode at ~20fps and writes CSS custom properties
  // to document.documentElement. All visual components read these via
  // var(--voyo-bass), var(--voyo-energy), var(--voyo-treble) in their
  // CSS — ZERO React re-renders, pure GPU-composited visual response.
  //
  // Architecture choices for PWA smoothness:
  //   • 20fps (every 3rd rAF) — not 60fps. Saves main thread budget
  //     for touch events + scroll compositing. Audio visualization
  //     looks smooth at 20fps; 60 is overkill and competes with the
  //     audio thread on weak devices.
  //   • Pre-allocated Uint8Array buffer — no GC per frame.
  //   • Visibility-gated — stops pumping when document is hidden.
  //   • Only runs when isPlaying — no work when paused.
  //
  // Values written:
  //   --voyo-bass    : 0-1 (avg of bins 0-15, ~60-250Hz)
  //   --voyo-mid     : 0-1 (avg of bins 16-80, ~250-5kHz)
  //   --voyo-treble  : 0-1 (avg of bins 81-127, ~5-20kHz)
  //   --voyo-energy  : 0-1 (RMS of all bins — overall loudness)
  const freqBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  useEffect(() => {
    if (!isPlaying) {
      // Reset to 0 when paused so visuals settle to rest state.
      const root = document.documentElement;
      root.style.setProperty('--voyo-bass', '0');
      root.style.setProperty('--voyo-mid', '0');
      root.style.setProperty('--voyo-treble', '0');
      root.style.setProperty('--voyo-energy', '0');
      return;
    }

    let frameCount = 0;
    let rafId = 0;
    let wasHidden = false;

    const pump = () => {
      rafId = requestAnimationFrame(pump);

      // Reset frame counter on visibility return so the 6-frame cadence
      // starts fresh. Without this, the counter was out of sync after
      // background → foreground transitions, causing stale/delayed
      // frequency reads on the first few frames back.
      if (document.hidden) { wasHidden = true; return; }
      if (wasHidden) { frameCount = 0; wasHidden = false; }

      // Skip 5 out of 6 frames → ~10fps on a 60fps display.
      if (++frameCount % 6 !== 0) return;

      const analyser = getAnalyser();
      if (!analyser) return;

      // Lazy-init the buffer on first pump (128 bins from fftSize=256).
      if (!freqBufferRef.current) {
        freqBufferRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      }
      const buf = freqBufferRef.current;
      analyser.getByteFrequencyData(buf);

      // Compute band averages (0-255 scale → 0-1 normalized).
      let bass = 0, mid = 0, treble = 0, total = 0;
      const len = buf.length; // 128
      for (let i = 0; i < len; i++) {
        const v = buf[i];
        total += v;
        if (i < 16) bass += v;
        else if (i < 80) mid += v;
        else treble += v;
      }
      bass = (bass / 16) / 255;
      mid = (mid / 64) / 255;
      treble = (treble / 48) / 255;
      const energy = (total / len) / 255;

      // DELTA-GATED CSS WRITES: only touch the DOM when the value has
      // changed by >5% (0.05 on the 0-1 scale). Most frames during
      // steady playback, treble/mid barely move — skipping those writes
      // saves 2-3 style recalcs per frame that were triggering GPU
      // recomposition for zero visual change.
      const root = document.documentElement;
      const DELTA = 0.05;
      const prev = {
        bass: parseFloat(root.style.getPropertyValue('--voyo-bass') || '0'),
        mid: parseFloat(root.style.getPropertyValue('--voyo-mid') || '0'),
        treble: parseFloat(root.style.getPropertyValue('--voyo-treble') || '0'),
        energy: parseFloat(root.style.getPropertyValue('--voyo-energy') || '0'),
      };
      if (Math.abs(bass - prev.bass) > DELTA) root.style.setProperty('--voyo-bass', bass.toFixed(3));
      if (Math.abs(mid - prev.mid) > DELTA) root.style.setProperty('--voyo-mid', mid.toFixed(3));
      if (Math.abs(treble - prev.treble) > DELTA) root.style.setProperty('--voyo-treble', treble.toFixed(3));
      if (Math.abs(energy - prev.energy) > DELTA) root.style.setProperty('--voyo-energy', energy.toFixed(3));
    };

    rafId = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  // Harmonic exciter curve — MEMOIZED.
  //
  // Previously regenerated 44100 samples on every preset switch. Each call
  // runs 44K trig ops (Math.abs + divisions) on the main thread — ~2-5ms
  // on mid-tier devices, worse on weak Android. Since the app only uses
  // a handful of distinct `amount` values (one per preset), we cache by
  // amount key. First call for a given amount builds and stores; every
  // subsequent call returns the cached Float32Array.
  //
  // Module-scoped ref so the cache survives component re-mounts within
  // the same page load (preset switches don't ever unmount AudioPlayer
  // but defensive is good).
  const harmonicCurveCacheRef = useRef<Map<number, Float32Array>>(new Map());
  const makeHarmonicCurve = (amount: number): Float32Array<ArrayBuffer> => {
    // Round to 0.01 precision so micro-float differences don't blow out
    // the cache (shouldn't happen, but harmless).
    const key = Math.round(amount * 100) / 100;
    const cached = harmonicCurveCacheRef.current.get(key);
    if (cached) return cached as Float32Array<ArrayBuffer>;

    const samples = 44100;
    const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + amount / 100) * x * 20 * deg) / (Math.PI + (amount / 100) * Math.abs(x));
    }
    harmonicCurveCacheRef.current.set(key, curve);
    return curve;
  };

  // Setup audio enhancement — SINGLETON via connectAudioChain()
  // CRITICAL: AudioContext and MediaElementAudioSourceNode are created ONCE.
  // The chain survives audio.src changes automatically (Web Audio API design).
  // Calling this multiple times is safe — it returns immediately if already wired.
  const setupAudioEnhancement = useCallback((preset: BoostPreset = 'boosted') => {
    if (!audioRef.current || audioEnhancedRef.current) return;

    try {
      // SINGLETON: connectAudioChain creates AudioContext + MediaElementAudioSourceNode ONCE
      const chain = connectAudioChain(audioRef.current);
      if (!chain) return;

      // If chain was already wired (shouldn't happen due to audioEnhancedRef guard, but safe)
      if (chain.alreadyWired) {
        audioEnhancedRef.current = true;
        audioContextRef.current = chain.ctx;
        return;
      }

      const ctx = chain.ctx;
      const source = chain.source;
      audioContextRef.current = ctx;
      sourceNodeRef.current = source;
      currentProfileRef.current = preset;

      // === VOYEX SPATIAL LAYER (created once, shared by all presets) ===
      const spInput = ctx.createGain(); spInput.gain.value = 1;
      spatialInputRef.current = spInput;

      const cfSplitter = ctx.createChannelSplitter(2);
      const cfMerger = ctx.createChannelMerger(2);
      const cfLD = ctx.createDelay(0.01); cfLD.delayTime.value = 0.0003;
      const cfLF = ctx.createBiquadFilter(); cfLF.type = 'lowpass'; cfLF.frequency.value = 6000;
      const cfLG = ctx.createGain(); cfLG.gain.value = 0; crossfeedLeftGainRef.current = cfLG;
      const cfRD = ctx.createDelay(0.01); cfRD.delayTime.value = 0.0003;
      const cfRF = ctx.createBiquadFilter(); cfRF.type = 'lowpass'; cfRF.frequency.value = 6000;
      const cfRG = ctx.createGain(); cfRG.gain.value = 0; crossfeedRightGainRef.current = cfRG;

      // DIVE low-pass: darkens main signal progressively (20kHz = transparent)
      const diveLP = ctx.createBiquadFilter(); diveLP.type = 'lowpass'; diveLP.frequency.value = 20000; diveLP.Q.value = 0.7;
      diveLowPassRef.current = diveLP;
      spInput.connect(diveLP);
      diveLP.connect(cfSplitter);
      cfSplitter.connect(cfMerger, 0, 0); cfSplitter.connect(cfMerger, 1, 1);
      cfSplitter.connect(cfLD, 0); cfLD.connect(cfLF); cfLF.connect(cfLG); cfLG.connect(cfMerger, 0, 1);
      cfSplitter.connect(cfRD, 1); cfRD.connect(cfRF); cfRF.connect(cfRG); cfRG.connect(cfMerger, 0, 0);

      // Organic stereo panner: 3 irrational-ratio LFOs for never-repeating movement
      const panner = ctx.createStereoPanner(); panner.pan.value = 0;
      const lfo1 = ctx.createOscillator(); lfo1.type = 'sine'; lfo1.frequency.value = 0.037;
      const lfo2 = ctx.createOscillator(); lfo2.type = 'sine'; lfo2.frequency.value = 0.071;
      const lfo3 = ctx.createOscillator(); lfo3.type = 'sine'; lfo3.frequency.value = 0.113;
      const panD = ctx.createGain(); panD.gain.value = 0; panDepthGainRef.current = panD;
      lfo1.connect(panD); lfo2.connect(panD); lfo3.connect(panD); panD.connect(panner.pan);
      lfo1.start(); lfo2.start(); lfo3.start();
      cfMerger.connect(panner);

      const hS = ctx.createChannelSplitter(2); const hM = ctx.createChannelMerger(2);
      const hD = ctx.createDelay(0.02); hD.delayTime.value = 0; haasDelayRef.current = hD;
      panner.connect(hS); hS.connect(hM, 0, 0); hS.connect(hD, 1); hD.connect(hM, 0, 1);

      // ── SPATIAL CHAIN BYPASS — root-cause fix for non-VOYEX phase smear ──
      // Same parallel-path technique as the multiband bypass. The 8-node
      // spatial route (diveLP → cfSplitter → cfMerger → panner → hS → hD →
      // hM) adds subtle phase distortion even at "transparent" settings.
      // For non-VOYEX presets, route spInput directly to destination via
      // spatialBypassDirect. For VOYEX, use spatialBypassMain (the full
      // spatial chain). Cross-fade is click-free via linearRampToValueAtTime.
      const spatialBypassDirect = ctx.createGain(); spatialBypassDirect.gain.value = 1; // default: bypass for non-VOYEX
      const spatialBypassMain = ctx.createGain(); spatialBypassMain.gain.value = 0; // default: main path muted
      spatialBypassDirectRef.current = spatialBypassDirect;
      spatialBypassMainRef.current = spatialBypassMain;
      spInput.connect(spatialBypassDirect); spatialBypassDirect.connect(ctx.destination);
      hM.connect(spatialBypassMain); spatialBypassMain.connect(ctx.destination);

      // ── HEAVY VOYEX SPATIAL NODES — DEFERRED to idle time ──
      // The convolver IRs (~352K math operations across DIVE + IMMERSE) and
      // the sub-harmonic waveshaper curve (44100 Math.tanh calls) used to
      // run synchronously here on first chain build. ~50-200ms of main
      // thread blocking right when the first track is trying to start,
      // causing the "fresh start glitch". Now deferred to requestIdleCallback
      // so they build during a free frame after first paint, NEVER blocking
      // the audio thread startup.
      //
      // These nodes are only AUDIBLE when VOYEX is active with non-zero
      // intensity. For boosted/calm/off users they're pure CPU waste, so
      // deferring them is a free win.
      //
      // The wet gain refs (diveReverbWetRef, immerseReverbWetRef,
      // subHarmonicGainRef) start as null. Any VOYEX code that touches them
      // must check for null first (the existing ramp() helper already does).
      const buildVoyexSpatialNodes = () => {
        const generateIR = (duration: number, decay: number, lpCutoff: number): AudioBuffer => {
          const len = Math.ceil(ctx.sampleRate * duration);
          const buf = ctx.createBuffer(2, len, ctx.sampleRate);
          const L = buf.getChannelData(0), R = buf.getChannelData(1);
          const erEnd = Math.ceil(ctx.sampleRate * 0.08);
          for (let er = 0; er < 12; er++) {
            const pos = Math.floor(Math.random() * erEnd);
            const amp = (1 - pos / erEnd) * 0.4;
            L[pos] += (Math.random() * 2 - 1) * amp;
            R[pos] += (Math.random() * 2 - 1) * amp;
          }
          for (let n = erEnd; n < len; n++) {
            const env = Math.exp(-decay * (n / ctx.sampleRate));
            L[n] += (Math.random() * 2 - 1) * env;
            R[n] += (Math.random() * 2 - 1) * env;
          }
          const coeff = Math.exp(-2 * Math.PI * lpCutoff / ctx.sampleRate);
          let pL = 0, pR = 0;
          for (let n = 0; n < len; n++) {
            L[n] = pL = pL * coeff + L[n] * (1 - coeff);
            R[n] = pR = pR * coeff + R[n] * (1 - coeff);
          }
          return buf;
        };

        // DIVE reverb: dark room — long tail, heavy damping, warm
        const diveConv = ctx.createConvolver();
        diveConv.buffer = generateIR(2.5, 2.0, 1800);
        const diveWet = ctx.createGain(); diveWet.gain.value = 0;
        diveReverbWetRef.current = diveWet;
        spInput.connect(diveConv); diveConv.connect(diveWet); diveWet.connect(ctx.destination);

        // IMMERSE reverb: bright space
        const immConv = ctx.createConvolver();
        immConv.buffer = generateIR(1.5, 3.5, 9000);
        const immWet = ctx.createGain(); immWet.gain.value = 0;
        immerseReverbWetRef.current = immWet;
        spInput.connect(immConv); immConv.connect(immWet); immWet.connect(ctx.destination);

        // Sub-harmonic synthesizer
        const sBP = ctx.createBiquadFilter(); sBP.type = 'bandpass'; sBP.frequency.value = 90; sBP.Q.value = 1;
        const sSh = ctx.createWaveShaper();
        const sC = new Float32Array(44100);
        for (let si = 0; si < 44100; si++) { const sx = (si * 2) / 44100 - 1; sC[si] = Math.tanh(sx * 3) * 0.8; }
        sSh.curve = sC; sSh.oversample = '2x';
        const sLP = ctx.createBiquadFilter(); sLP.type = 'lowpass'; sLP.frequency.value = 80;
        const sMx = ctx.createGain(); sMx.gain.value = 0; subHarmonicGainRef.current = sMx;
        spInput.connect(sBP); sBP.connect(sSh); sSh.connect(sLP); sLP.connect(sMx); sMx.connect(ctx.destination);

        devLog('🎛️ [VOYO] VOYEX spatial nodes built (deferred to idle)');
      };

      // Schedule the heavy build for idle time. requestIdleCallback runs
      // when the main thread is free, so it never competes with the audio
      // thread starting up the first track.
      const w = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      };
      if (typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(buildVoyexSpatialNodes, { timeout: 4000 });
      } else {
        setTimeout(buildVoyexSpatialNodes, 1500);
      }

      spatialEnhancedRef.current = true;
      // All presets route final output → spInput → spatial chain → destination

      // source already created by connectAudioChain() singleton — NEVER recreate

      // 'off' = RAW AUDIO - bypass all processing, connect directly to spatial input
      if (preset === 'off') {
        source.connect(spInput);
        audioEnhancedRef.current = true;
        devLog('🎵 [VOYO] RAW mode - EQ bypassed');
        return;
      }

      // ═══════════════════════════════════════════════════════════════
      // UNIFIED CHAIN: Always create everything. Transparent when unused.
      // source → highPass → [multiband] → [standard EQ] → stereo → master → comp → limiter → spInput
      // ═══════════════════════════════════════════════════════════════

      // High-pass filter to cut rumble
      const highPass = ctx.createBiquadFilter();
      highPass.type = 'highpass'; highPass.frequency.value = 25; highPass.Q.value = 0.7;
      highPassFilterRef.current = highPass;

      // ── MULTIBAND SECTION (24dB/octave Linkwitz-Riley crossovers) ──
      // Always created. For non-VOYEX presets, gains=1 and comp=transparent.
      const LR_Q = 0.707;
      const lowF1 = ctx.createBiquadFilter(); lowF1.type = 'lowpass'; lowF1.frequency.value = 180; lowF1.Q.value = LR_Q;
      const lowF2 = ctx.createBiquadFilter(); lowF2.type = 'lowpass'; lowF2.frequency.value = 180; lowF2.Q.value = LR_Q;
      multibandLowFilterRef.current = lowF1;
      const midHP1 = ctx.createBiquadFilter(); midHP1.type = 'highpass'; midHP1.frequency.value = 180; midHP1.Q.value = LR_Q;
      const midHP2 = ctx.createBiquadFilter(); midHP2.type = 'highpass'; midHP2.frequency.value = 180; midHP2.Q.value = LR_Q;
      const midLP1 = ctx.createBiquadFilter(); midLP1.type = 'lowpass'; midLP1.frequency.value = 4500; midLP1.Q.value = LR_Q;
      const midLP2 = ctx.createBiquadFilter(); midLP2.type = 'lowpass'; midLP2.frequency.value = 4500; midLP2.Q.value = LR_Q;
      multibandMidLowFilterRef.current = midHP1; multibandMidHighFilterRef.current = midLP1;
      const highF1 = ctx.createBiquadFilter(); highF1.type = 'highpass'; highF1.frequency.value = 4500; highF1.Q.value = LR_Q;
      const highF2 = ctx.createBiquadFilter(); highF2.type = 'highpass'; highF2.frequency.value = 4500; highF2.Q.value = LR_Q;
      multibandHighFilterRef.current = highF1;

      // Per-band gains (default transparent)
      const lowGain = ctx.createGain(); lowGain.gain.value = 1.0;
      const midGain = ctx.createGain(); midGain.gain.value = 1.0;
      const highGain = ctx.createGain(); highGain.gain.value = 1.0;
      multibandLowGainRef.current = lowGain; multibandMidGainRef.current = midGain; multibandHighGainRef.current = highGain;

      // Per-band compressors (default transparent: threshold 0, ratio 1)
      const lowComp = ctx.createDynamicsCompressor();
      lowComp.threshold.value = 0; lowComp.knee.value = 6; lowComp.ratio.value = 1; lowComp.attack.value = 0.01; lowComp.release.value = 0.15;
      multibandLowCompRef.current = lowComp;
      const midComp = ctx.createDynamicsCompressor();
      midComp.threshold.value = 0; midComp.knee.value = 10; midComp.ratio.value = 1; midComp.attack.value = 0.02; midComp.release.value = 0.25;
      multibandMidCompRef.current = midComp;
      const highComp = ctx.createDynamicsCompressor();
      highComp.threshold.value = 0; highComp.knee.value = 8; highComp.ratio.value = 1; highComp.attack.value = 0.005; highComp.release.value = 0.1;
      multibandHighCompRef.current = highComp;

      // Harmonic exciter (default: no curve = bypass) — low/mid only.
      // CRITICAL: oversample must be 'none' when curve is null. 2x adds ~2-3
      // samples of latency from the oversampling filter, which delays low+mid
      // bands vs. the high band (high bypasses harmonic via exciterBypass).
      // When they re-sum at bandMerger, the phase misalignment creates comb
      // filtering at the 4500Hz crossover — audible as "muffling".
      // Switch to '2x' dynamically when a curve is actually applied.
      const harmonic = ctx.createWaveShaper(); harmonic.oversample = 'none';
      harmonicExciterRef.current = harmonic;
      const exciterBypass = ctx.createGain(); exciterBypass.gain.value = 1.0;
      const bandMerger = ctx.createGain(); bandMerger.gain.value = 1.0;

      // ── MULTIBAND BYPASS GAINS — root-cause fix for muffling on non-VOYEX ──
      // The multiband chain (16 biquads + comps + harmonic) produces phase
      // smear at frequencies between crossovers, even when "transparent"
      // (gains=1, ratio=1). Linkwitz-Riley sums to flat AMPLITUDE but each
      // band has its own phase response — the cumulative phase distortion
      // is audible as muffling. Solution: parallel direct path with cross-
      // fadable gains. Non-VOYEX uses direct (zero phase distortion). VOYEX
      // uses multiband (mastering character). Cross-fade is click-free via
      // linearRampToValueAtTime in updateBoostPreset.
      const multibandBypassDirect = ctx.createGain(); multibandBypassDirect.gain.value = 1; // default: bypass active
      const multibandBypassMb = ctx.createGain(); multibandBypassMb.gain.value = 0; // default: multiband muted
      const multibandMix = ctx.createGain(); multibandMix.gain.value = 1;
      multibandBypassDirectRef.current = multibandBypassDirect;
      multibandBypassMbRef.current = multibandBypassMb;

      // Wire source → highPass → both paths → mix → subBass
      source.connect(highPass);
      // Direct bypass path (zero phase distortion)
      highPass.connect(multibandBypassDirect); multibandBypassDirect.connect(multibandMix);
      // Multiband path (active only when VOYEX)
      highPass.connect(lowF1); lowF1.connect(lowF2); lowF2.connect(lowGain); lowGain.connect(lowComp); lowComp.connect(harmonic);
      highPass.connect(midHP1); midHP1.connect(midHP2); midHP2.connect(midLP1); midLP1.connect(midLP2); midLP2.connect(midGain); midGain.connect(midComp); midComp.connect(harmonic);
      highPass.connect(highF1); highF1.connect(highF2); highF2.connect(highGain); highGain.connect(highComp); highComp.connect(exciterBypass);
      harmonic.connect(bandMerger); exciterBypass.connect(bandMerger);
      bandMerger.connect(multibandBypassMb); multibandBypassMb.connect(multibandMix);

      // ── STANDARD EQ SECTION (always created, neutral when VOYEX active) ──
      const subBass = ctx.createBiquadFilter(); subBass.type = 'lowshelf'; subBass.frequency.value = 50; subBass.gain.value = 0;
      subBassFilterRef.current = subBass;
      const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 80; bass.gain.value = 0;
      bassFilterRef.current = bass;
      const warmth = ctx.createBiquadFilter(); warmth.type = 'peaking'; warmth.frequency.value = 250; warmth.Q.value = 1.5; warmth.gain.value = 0;
      warmthFilterRef.current = warmth;
      const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 1; presence.gain.value = 0;
      presenceFilterRef.current = presence;
      const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 10000; air.gain.value = 0;
      airFilterRef.current = air;
      multibandMix.connect(subBass); subBass.connect(bass); bass.connect(warmth); warmth.connect(presence); presence.connect(air);

      // ── STEREO WIDENING (always created, delay=0 = transparent) ──
      const stSplitter = ctx.createChannelSplitter(2);
      const stMerger = ctx.createChannelMerger(2);
      const stDelayL = ctx.createDelay(0.1); stDelayL.delayTime.value = 0;
      const stDelayR = ctx.createDelay(0.1); stDelayR.delayTime.value = 0;
      stereoSplitterRef.current = stSplitter; stereoMergerRef.current = stMerger; stereoDelayRef.current = stDelayR;
      air.connect(stSplitter);
      stSplitter.connect(stDelayL, 0); stSplitter.connect(stDelayR, 1);
      stDelayL.connect(stMerger, 0, 0); stDelayR.connect(stMerger, 0, 1);

      // ── MASTER GAIN ──
      // Start at silence (0.0001 to avoid log/exp issues in any downstream
      // automation). First track load will schedule a fade-in on the
      // canplaythrough handler, eliminating the cold-start speaker pop.
      const masterGain = ctx.createGain(); masterGain.gain.value = 0.0001;
      gainNodeRef.current = masterGain;
      stMerger.connect(masterGain);

      // ── FINAL COMPRESSOR (for standard presets; transparent when VOYEX) ──
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = 0; comp.ratio.value = 1; comp.knee.value = 10; comp.attack.value = 0.003; comp.release.value = 0.25;
      compressorRef.current = comp;
      masterGain.connect(comp);

      // ── BRICKWALL LIMITER (always active, safety net for all presets) ──
      // TRANSPARENT: only catches true digital overs (>-0.1dBFS). Previous
      // -0.3dB threshold with ratio 8 was clamping normal peaks in modern
      // masters (which regularly sit at -0.3 to 0dBFS). That constant gain
      // reduction was the "muffle" feeling on loud tracks. Now at -0.1dB
      // with ratio 20 and instant attack — a pure safety net that only
      // fires on actual clipping, never on normal musical dynamics.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -0.1; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.0005; limiter.release.value = 0.01;
      comp.connect(limiter); limiter.connect(spInput);

      // ANALYSER TAP: connect the AnalyserNode (from audioEngine) in
      // parallel to the spatial input. It's a passive read-only tap —
      // doesn't modify gain, latency, or frequency response. The
      // frequency pump in useEffect below reads it at ~30fps and writes
      // CSS custom properties (--voyo-bass, --voyo-energy, --voyo-treble)
      // that drive visual responses: album art pulse, background brightness,
      // progress dot glow intensity.
      const analyser = getAnalyser();
      if (analyser) {
        try { spInput.connect(analyser); } catch {}
      }

      audioEnhancedRef.current = true;

      // Apply initial preset parameters. updateBoostPreset calls
      // applyMasterGain which will ramp masterGain to the preset target —
      // but we want the chain to stay silent until canplaythrough fires a
      // proper fade-in against real audio samples. Re-mute right after.
      updateBoostPreset(preset);
      if (gainNodeRef.current && audioContextRef.current) {
        const now = audioContextRef.current.currentTime;
        const p = gainNodeRef.current.gain;
        p.cancelScheduledValues(now);
        p.setValueAtTime(0.0001, now);
      }

      devLog('🎛️ [VOYO] Unified chain: multiband → EQ → stereo → master → comp → limiter → spatial');
    } catch (e) {
      devWarn('[VOYO] Audio enhancement failed:', e);
    }
  }, []);

  // Compute target master gain from current preset/spatial/volume state.
  // Pure getter — no side effects. Used by applyMasterGain and by the
  // track-load fade helpers below.
  const computeMasterTarget = () => {
    const preset = currentProfileRef.current;
    const baseGain = preset === 'off' ? 1.0 : BOOST_PRESETS[preset].gain;
    const vol = usePlayerStore.getState().volume / 100;
    let comp = 1;
    if (preset === 'voyex') {
      const { voyexSpatial } = usePlayerStore.getState();
      const si = Math.abs(voyexSpatial) / 100;
      if (voyexSpatial < 0 && si > 0) comp = 1 - si * 0.18;
      else if (voyexSpatial > 0 && si > 0) comp = 1 - si * 0.12;
    }
    return baseGain * comp * vol;
  };

  // ── BG ENGINE ────────────────────────────────────────────────────────
  // Heartbeat, visibility handler, silent WAV generation, context resume,
  // gain rescue, synthetic-ended / stuck-playback detectors — all one
  // module owned by src/audio/bg/bgEngine.ts. Returns the silent WAV blob
  // ref and the BG-transition guard ref (used by onPause).
  const { silentKeeperUrlRef, isTransitioningToBackgroundRef } = useBgEngine({
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

  // Apply master gain: preset × spatial compensation × volume.
  // Single source of truth — called from updateBoostPreset, updateVoyexSpatial,
  // and volume effect. Ramped to avoid speaker pops on every preset/volume
  // change. The 25ms ramp is short enough to feel instant.
  const applyMasterGain = () => {
    if (!gainNodeRef.current) return;
    // CRITICAL: skip during track load. loadTrack's fadeInMasterGain owns
    // the gain ramp. If we cancelScheduledValues here, we kill the fade-in
    // mid-flight → gain jumps from 0.0001 to current → speaker pop.
    // The next applyMasterGain after load completes will set it correctly.
    if (isLoadingTrackRef.current) return;
    const target = computeMasterTarget();
    const ctx = audioContextRef.current;
    if (ctx) {
      const now = ctx.currentTime;
      const param = gainNodeRef.current.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + 0.025);
    } else {
      gainNodeRef.current.gain.value = target;
    }
  };

  // ── TRACK-CHANGE FADE HELPERS ─────────────────────────────────────────
  // Replaces the old `audio.volume = 0` / `audio.volume = 1.0` mute pattern.
  // That pattern worked but was a digital jump at the media element level,
  // which leaks into the MediaElementAudioSourceNode as a click. Now all
  // loudness transitions go through masterGain inside the Web Audio chain
  // using scheduled linear ramps — pro DAW-grade click-free behaviour.
  // `audio.volume` stays pinned at 1.0 whenever the chain is wired.

  // ── GAIN-STUCK WATCHDOG ──────────────────────────────────────────────
  // CRITICAL: every track load mutes masterGain to 0.0001 and relies on
  // `canplaythrough` firing to ramp back up. If that callback hangs (slow
  // network, stalled decode, CDN stall), the element keeps playing but
  // through a silenced Web Audio chain — the "crash stopping speakers
  // muffling" symptom. The watchdog schedules a forced fade-in as a safety
  // net. Cancel it when the real canplaythrough fires. Per-load timer so
  // rapid track skips don't stack watchdogs.
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rescueGain = useCallback((label: string) => {
    if (!audioRef.current || !gainNodeRef.current || !audioContextRef.current) return;
    if (audioRef.current.paused) return;
    const param = gainNodeRef.current.gain;
    if (param.value > 0.01) return; // Already recovered
    devWarn(`🩹 [VOYO] Watchdog rescue (${label}) — forcing fade-in`);
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended' || (ctx as any).state === 'interrupted') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const target = computeMasterTarget();
    param.cancelScheduledValues(now);
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(target, now + 0.2);
  }, []);
  const armGainWatchdog = (label: string, timeoutMs: number = 6000) => {
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    // In background, setTimeout is throttled to 1/min by Chrome.
    // Use a faster rescue cycle: 2s via setTimeout (fires at ~60s worst case)
    // PLUS an immediate MessageChannel check at 3s (not throttled).
    watchdogTimerRef.current = setTimeout(() => {
      watchdogTimerRef.current = null;
      rescueGain(label);
    }, timeoutMs);
    // MessageChannel is NOT throttled in background — fires within ms.
    // Schedule a backup check at 3s using nested MessageChannel delays.
    if (document.hidden) {
      let checks = 0;
      const mc = new MessageChannel();
      mc.port1.onmessage = () => {
        checks++;
        if (checks < 300) { // 300 × 10ms = 3s
          mc.port2.postMessage(null);
        } else {
          rescueGain(`${label}-bg`);
          mc.port1.close();
        }
      };
      mc.port2.postMessage(null);
    }
  };
  const disarmGainWatchdog = () => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  };

  // Instant mute — schedule gain to near-zero immediately. Used right
  // before audio.pause() on a track swap so the old track fades silent
  // cleanly and the new track doesn't hit a hot chain at full volume.
  // Arms the watchdog: if canplaythrough never calls fadeInMasterGain, a
  // forced fade-in will kick in after 6s.
  const muteMasterGainInstantly = () => {
    if (!gainNodeRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;
    const param = gainNodeRef.current.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0.0001, now + 0.008); // 8ms fade out (352 samples, click-free)
    armGainWatchdog('mute-before-load');
  };

  // Crossfade system removed — will implement with two audio elements later.

  // Short fade-in ramp from silence → target. Called from canplaythrough
  // handlers right before audio.play() so the first audible samples of a
  // new track enter under a ramp, not a step. 80ms is long enough to bury
  // any transient click but short enough to feel instant.
  // Disarms the watchdog AND the load-in-flight guard — playback is up.
  // INSTANT PRESENCE: set gain to target BEFORE play(), not after.
  //
  // Old approach: silence → play → ramp up over 80-200ms. The first
  // samples play at low volume = soft start, track doesn't "arrive."
  //
  // New approach: the chain is already silent (muteMasterGainInstantly
  // ran during the src swap). Set gain to TARGET instantly. Then play().
  // First sample enters at full volume. Zero ramp. Zero soft start.
  // The track IS there, fully present, from the first beat.
  //
  // A tiny 10ms micro-ramp (inaudible) prevents the theoretical sample-
  // level discontinuity. At 44.1kHz, 10ms = 441 samples — enough for
  // a smooth zero-crossing. Human temporal resolution for loudness is
  // ~100ms, so 10ms is physically imperceptible.
  const fadeInMasterGain = (_durationMs: number = 80) => {
    disarmGainWatchdog();
    isLoadingTrackRef.current = false;
    if (!gainNodeRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    // Ensure context is running before scheduling. On cold start, the
    // context may still be suspended — scheduling a ramp against a frozen
    // clock puts the target time in the past. When the context finally
    // runs, the ramp is already "complete" → gain jumps instead of ramping.
    if (ctx.state === 'suspended' || (ctx as any).state === 'interrupted') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const param = gainNodeRef.current.gain;
    const target = computeMasterTarget();
    // NEAR-INSTANT PRESENCE: 3ms micro-ramp from near-silence to target.
    // 3ms = 132 samples at 44.1kHz — smooth zero-crossing, no click,
    // first beat at >95% volume. Within the latencyHint: 'playback'
    // buffer window (256+ samples ≈ 6ms).
    param.cancelScheduledValues(now);
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(target, now + 0.003);
  };

  // A4 (v194): swap src on the shared audio element SAFELY — reset loop
  // (silent-WAV bridge leaves it true; HTMLMediaElement.loop is sticky
  // across src changes, so without reset the new track loops forever and
  // 'ended' never fires). Pin volume. Conditionally load() — blob: URLs
  // skip the full decoder reset (data is already in memory), remote URLs
  // need it. Hoisted to a helper so all fast-paths (preload / cached / R2
  // / retry / hot-swap) reset loop consistently — every missed path has
  // caused a BG auto-advance regression (v171, v187).
  const swapSrcSafely = (url: string) => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = 1.0;
    el.loop = false;
    el.src = url;
    if (!url.startsWith('blob:')) el.load();
  };

  // Smooth volume fade-in for auto-resume (1.2s from silence to target)
  const fadeInVolume = useCallback((durationMs: number = 1200) => {
    if (audioContextRef.current && gainNodeRef.current) {
      const now = audioContextRef.current.currentTime;
      const preset = currentProfileRef.current;
      const baseGain = preset === 'off' ? 1.0 : BOOST_PRESETS[preset].gain;
      const vol = usePlayerStore.getState().volume / 100;
      let comp = 1;
      if (preset === 'voyex') {
        const { voyexSpatial } = usePlayerStore.getState();
        const si = Math.abs(voyexSpatial) / 100;
        if (voyexSpatial < 0 && si > 0) comp = 1 - si * 0.18;
        else if (voyexSpatial > 0 && si > 0) comp = 1 - si * 0.12;
      }
      const targetGain = baseGain * comp * vol;

      gainNodeRef.current.gain.cancelScheduledValues(now);
      gainNodeRef.current.gain.setValueAtTime(0.001, now); // Near-zero (avoid log issues)
      gainNodeRef.current.gain.linearRampToValueAtTime(targetGain, now + durationMs / 1000);

      if (audioRef.current) audioRef.current.volume = 1.0;
      devLog(`🎵 [VOYO] Fade-in: 0 → ${targetGain.toFixed(2)} over ${durationMs}ms`);
    } else if (audioRef.current) {
      // Fallback: no Web Audio chain. Was a requestAnimationFrame-driven
      // ramp — but rAF is starved in background, leaving volume stuck at 0
      // until FG return ('audio plays silent then kicks in' bug). Now we
      // just snap to target volume immediately. No ramp = tiny audible
      // click on cold start, but that beats indefinite silence in BG.
      audioRef.current.volume = usePlayerStore.getState().volume / 100;
    }
  }, []);

  // Update preset dynamically — unified chain, all refs always exist
  //
  // CRITICAL: every AudioParam write below uses the textbook click-free
  // pattern (cancelScheduledValues → setValueAtTime anchor →
  // linearRampToValueAtTime). This is a stricter upgrade from the prior
  // setTargetAtTime approach because:
  //   - setTargetAtTime is exponential and asymptotic (never reaches target)
  //   - linearRampToValueAtTime hits the target exactly at the specified time
  //   - the explicit setValueAtTime anchor at param.value prevents the param
  //     from jumping if there was pending automation
  // This is what real DAWs and pro audio software do for parameter automation.
  const updateBoostPreset = useCallback((preset: BoostPreset) => {
    if (!audioEnhancedRef.current) return;
    currentProfileRef.current = preset;

    const ctx = audioContextRef.current;
    const now = ctx ? ctx.currentTime : 0;
    const RAMP_MS = 25; // 25ms — fast enough to feel instant, slow enough to be perfectly smooth
    const RAMP_EPSILON = 0.0005; // skip reschedule if |delta| < this

    // Epsilon-guarded ramp: skip the cancelScheduledValues/setValueAtTime/
    // linearRampToValueAtTime triplet when the target is already ~equal to
    // the current value. Rapid preset switching between presets that share
    // parameter values (boosted → calm often overlaps) used to reschedule
    // identical automation curves on the audio thread — free CPU savings
    // with no behavior change.
    const ramp = (param: AudioParam | undefined | null, value: number) => {
      if (!param || !ctx) return;
      if (Math.abs(param.value - value) < RAMP_EPSILON) return; // already there
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + RAMP_MS / 1000);
    };

    const setMultibandTransparent = () => {
      ramp(multibandLowGainRef.current?.gain, 1.0);
      ramp(multibandMidGainRef.current?.gain, 1.0);
      ramp(multibandHighGainRef.current?.gain, 1.0);
      if (multibandLowCompRef.current) { ramp(multibandLowCompRef.current.threshold, 0); ramp(multibandLowCompRef.current.ratio, 1); }
      if (multibandMidCompRef.current) { ramp(multibandMidCompRef.current.threshold, 0); ramp(multibandMidCompRef.current.ratio, 1); }
      if (multibandHighCompRef.current) { ramp(multibandHighCompRef.current.threshold, 0); ramp(multibandHighCompRef.current.ratio, 1); }
    };

    // ── BYPASS the multiband entirely (root-cause muffling + CPU fix) ──
    // direct=1, multiband=0 → signal flows highPass → directGain → mix → subBass
    // ALSO disconnects the multiband + spatial chain inputs after fade so
    // they stop computing on the audio thread (Web Audio doesn't optimize
    // unused-output nodes — they keep running until disconnected).
    const useDirectPath = () => {
      ramp(multibandBypassDirectRef.current?.gain, 1);
      ramp(multibandBypassMbRef.current?.gain, 0);
      ramp(spatialBypassDirectRef.current?.gain, 1);
      ramp(spatialBypassMainRef.current?.gain, 0);
    };
    const useMultibandPath = () => {
      ramp(multibandBypassDirectRef.current?.gain, 0);
      ramp(multibandBypassMbRef.current?.gain, 1);
      ramp(spatialBypassDirectRef.current?.gain, 0);
      ramp(spatialBypassMainRef.current?.gain, 1);
    };

    const setStandardEqNeutral = () => {
      ramp(subBassFilterRef.current?.gain, 0);
      ramp(bassFilterRef.current?.gain, 0);
      ramp(warmthFilterRef.current?.gain, 0);
      ramp(presenceFilterRef.current?.gain, 0);
      ramp(airFilterRef.current?.gain, 0);
    };

    // 'off' = RAW AUDIO - everything transparent
    if (preset === 'off') {
      useDirectPath(); // Bypass multiband entirely
      setMultibandTransparent();
      setStandardEqNeutral();
      if (harmonicExciterRef.current) { harmonicExciterRef.current.curve = null; harmonicExciterRef.current.oversample = 'none'; }
      if (compressorRef.current) { ramp(compressorRef.current.threshold, 0); ramp(compressorRef.current.ratio, 1); }
      ramp(stereoDelayRef.current?.delayTime, 0);
      applyMasterGain();
      devLog('🎵 [VOYO] RAW mode - all processing bypassed');
      return;
    }

    const s = BOOST_PRESETS[preset] as any;

    if (s.multiband) {
      useMultibandPath(); // Wire multiband INTO the signal path
      // ── VOYEX: Multiband active, standard EQ neutral ──
      ramp(multibandLowGainRef.current?.gain, s.low.gain);
      ramp(multibandMidGainRef.current?.gain, s.mid.gain);
      ramp(multibandHighGainRef.current?.gain, s.high.gain);
      if (multibandLowCompRef.current) { ramp(multibandLowCompRef.current.threshold, s.low.threshold); ramp(multibandLowCompRef.current.ratio, s.low.ratio); }
      if (multibandMidCompRef.current) { ramp(multibandMidCompRef.current.threshold, s.mid.threshold); ramp(multibandMidCompRef.current.ratio, s.mid.ratio); }
      if (multibandHighCompRef.current) { ramp(multibandHighCompRef.current.threshold, s.high.threshold); ramp(multibandHighCompRef.current.ratio, s.high.ratio); }
      if (harmonicExciterRef.current) {
        const applyCurve = s.harmonicAmount > 0;
        harmonicExciterRef.current.curve = applyCurve ? makeHarmonicCurve(s.harmonicAmount) : null;
        // Only enable 2x oversampling when a curve is actually applied — prevents the
        // low/mid latency vs. high band phase drift that causes muffling on bypass.
        harmonicExciterRef.current.oversample = applyCurve ? '2x' : 'none';
      }
      setStandardEqNeutral();
      if (compressorRef.current) { ramp(compressorRef.current.threshold, 0); ramp(compressorRef.current.ratio, 1); } // Multiband handles compression
      ramp(stereoDelayRef.current?.delayTime, s.stereoWidth || 0);
    } else {
      // ── Standard presets (boosted/calm): Bypass multiband, standard EQ active ──
      useDirectPath(); // Skip multiband — root-cause muffling fix
      setMultibandTransparent();
      if (harmonicExciterRef.current) {
        const applyCurve = s.harmonicAmount > 0;
        harmonicExciterRef.current.curve = applyCurve ? makeHarmonicCurve(s.harmonicAmount) : null;
        harmonicExciterRef.current.oversample = applyCurve ? '2x' : 'none';
      }
      // Frequency changes are NOT ramped — they're center-frequency tuning,
      // not amplitude. Direct assignment is fine and avoids the brief gain
      // dip that ramp would cause on filter retuning.
      subBassFilterRef.current && (subBassFilterRef.current.frequency.value = s.subBassFreq); ramp(subBassFilterRef.current?.gain, s.subBassGain);
      bassFilterRef.current && (bassFilterRef.current.frequency.value = s.bassFreq); ramp(bassFilterRef.current?.gain, s.bassGain);
      warmthFilterRef.current && (warmthFilterRef.current.frequency.value = s.warmthFreq); ramp(warmthFilterRef.current?.gain, s.warmthGain);
      presenceFilterRef.current && (presenceFilterRef.current.frequency.value = s.presenceFreq); ramp(presenceFilterRef.current?.gain, s.presenceGain);
      airFilterRef.current && (airFilterRef.current.frequency.value = s.airFreq); ramp(airFilterRef.current?.gain, s.airGain);
      if (compressorRef.current) {
        ramp(compressorRef.current.threshold, s.compressor.threshold);
        ramp(compressorRef.current.ratio, s.compressor.ratio);
        // knee/attack/release: structural, set once via direct assign (rare change)
        compressorRef.current.knee.value = s.compressor.knee;
        compressorRef.current.attack.value = s.compressor.attack;
        compressorRef.current.release.value = s.compressor.release;
      }
      ramp(stereoDelayRef.current?.delayTime, s.stereoWidth || 0);
    }

    applyMasterGain();
    devLog(`🎵 [VOYO] Switched to ${preset.toUpperCase()}`);
  }, []);

  // VOYEX INTENSITY SLIDER — full mastering + spatial control
  // Same textbook click-free pattern as updateBoostPreset.
  const updateVoyexSpatial = useCallback((value: number) => {
    if (!spatialEnhancedRef.current) return;
    const v = Math.max(-100, Math.min(100, value));
    const i = Math.abs(v) / 100; // 0→1 intensity

    const ctx = audioContextRef.current;
    const now = ctx ? ctx.currentTime : 0;
    const RAMP_MS = 25;
    const RAMP_EPSILON = 0.0005;
    // Same epsilon guard as updateBoostPreset's ramp helper — skip reschedule
    // when value is already where it should be. VOYEX spatial slider fires
    // this helper on every ~16ms tick during user drag, so avoiding wasted
    // audio-thread scheduling adds up fast.
    const ramp = (param: AudioParam | undefined | null, value: number) => {
      if (!param || !ctx) return;
      if (Math.abs(param.value - value) < RAMP_EPSILON) return;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + RAMP_MS / 1000);
    };

    // ══════════════════════════════════════════════════════
    // LAYER 1: MULTIBAND MASTERING CHARACTER
    // ══════════════════════════════════════════════════════
    if (v < 0) {
      // DIVE mastering: massive warm bass, scooped mids, rolled highs
      ramp(multibandLowGainRef.current?.gain, 1.3 + (i * 0.35));  // 1.3 → 1.65
      ramp(multibandMidGainRef.current?.gain, 1.1 - (i * 0.05));  // 1.1 → 1.05
      ramp(multibandHighGainRef.current?.gain, 1.25 - (i * 0.3)); // 1.25 → 0.95
    } else if (v > 0) {
      // IMMERSE mastering: crystal highs, present vocals, solid bass
      ramp(multibandLowGainRef.current?.gain, 1.3);
      ramp(multibandMidGainRef.current?.gain, 1.1 + (i * 0.2));
      ramp(multibandHighGainRef.current?.gain, 1.25 + (i * 0.3));
    } else {
      ramp(multibandLowGainRef.current?.gain, 1.3);
      ramp(multibandMidGainRef.current?.gain, 1.1);
      ramp(multibandHighGainRef.current?.gain, 1.25);
    }

    // ══════════════════════════════════════════════════════
    // LAYER 2: STEREO FIELD (DIV narrows / IMM widens)
    // ══════════════════════════════════════════════════════
    if (v < 0) {
      ramp(stereoDelayRef.current?.delayTime, 0.015 - (i * 0.012)); // 15ms → 3ms
    } else if (v > 0) {
      ramp(stereoDelayRef.current?.delayTime, 0.015 + (i * 0.015)); // 15ms → 30ms
    } else {
      ramp(stereoDelayRef.current?.delayTime, 0.015);
    }

    // ══════════════════════════════════════════════════════
    // LAYER 3: SPATIAL EFFECTS
    // ══════════════════════════════════════════════════════
    if (v === 0) {
      // Center = clean VOYEX baseline, spatial bypass
      ramp(crossfeedLeftGainRef.current?.gain, 0);
      ramp(crossfeedRightGainRef.current?.gain, 0);
      ramp(panDepthGainRef.current?.gain, 0);
      ramp(haasDelayRef.current?.delayTime, 0);
      // Frequency change = no audible click on filters, can stay direct
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000);
      ramp(diveReverbWetRef.current?.gain, 0);
      ramp(immerseReverbWetRef.current?.gain, 0);
      ramp(subHarmonicGainRef.current?.gain, 0);
      applyMasterGain();
      devLog('🎛️ [VOYO] INTENSITY: CENTER (baseline)');
      return;
    }

    if (v < 0) {
      // ── DIVE: swallowed by sound ──
      ramp(crossfeedLeftGainRef.current?.gain, i * 0.45);
      ramp(crossfeedRightGainRef.current?.gain, i * 0.45);
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000 - (i * 13000));
      ramp(diveReverbWetRef.current?.gain, i * 0.38);
      ramp(immerseReverbWetRef.current?.gain, 0);
      ramp(subHarmonicGainRef.current?.gain, i * 0.25);
      ramp(panDepthGainRef.current?.gain, 0);
      ramp(haasDelayRef.current?.delayTime, 0);
      applyMasterGain();
      devLog(`🎛️ [VOYO] DIVE ${Math.round(i * 100)}%`);
    } else {
      // ── IMMERSE: music all around you ──
      // 0-80%: crisp, wide, present. 80-100%: surround opens up.
      let panDepth: number;
      let haas: number;
      if (i <= 0.8) {
        panDepth = i * 0.3125;
        haas = i * 0.003;
      } else {
        const s = (i - 0.8) / 0.2;
        panDepth = 0.25 + (s * 0.15);
        haas = 0.0024 + (s * 0.002);
      }

      ramp(panDepthGainRef.current?.gain, panDepth);
      ramp(haasDelayRef.current?.delayTime, haas);
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000);
      ramp(immerseReverbWetRef.current?.gain, i * 0.30);
      ramp(diveReverbWetRef.current?.gain, 0);
      ramp(subHarmonicGainRef.current?.gain, i * 0.15);
      ramp(crossfeedLeftGainRef.current?.gain, 0);
      ramp(crossfeedRightGainRef.current?.gain, 0);
      applyMasterGain();
      devLog(`🎛️ [VOYO] IMMERSE ${Math.round(i * 100)}%${i > 0.8 ? ' [SURROUND]' : ''}`);
    }
  }, []);

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
      if (lastTrackIdRef.current === trackId) {
        trace('load_guard', trackId, { why: 'same_track_id', bailed: true });
        return;
      }
      lastTrackIdRef.current = trackId;
      lastEndedTrackIdRef.current = null;
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
        // Clone+replace trick: removes ALL anonymous addEventListener listeners
        // (canplay handlers added with { once: true } that haven't fired yet).
        // The Web Audio source node survives because it's bound to the element
        // reference, not its event listeners.
        // NOTE: Skip this — cloning breaks MediaElementAudioSourceNode binding.
        // Instead, the stale guards (isStale()) in each handler prevent action.

        // FAST MUTE: 8ms ramp (352 samples — smooth zero-crossing, no click)
        // + 10ms wait for the ramp to drain. Total: 18ms before pause.
        // Previously 15ms ramp + 18ms wait = 33ms which added perceptible
        // silence on every skip. 18ms is below human temporal resolution.
        if (gainNodeRef.current && audioContextRef.current) {
          const ctx = audioContextRef.current;
          const now = ctx.currentTime;
          const p = gainNodeRef.current.gain;
          p.cancelScheduledValues(now);
          p.setValueAtTime(p.value, now);
          p.linearRampToValueAtTime(0.0001, now + 0.008);
        }
        armGainWatchdog('mute-before-load');
        const audioToFade = audioRef.current;
        // Wait for the 8ms gain ramp to fully drain before pausing.
        // BACKGROUND SKIP: skip the wait when hidden — setTimeout is
        // throttled to 1/min in background, turning a 10ms wait into 60s.
        // User can't hear the transition anyway, so no click risk.
        if (!document.hidden) {
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        if (isStale()) { trace('load_abandoned', trackId, { at: 'after_fade_timeout' }); devLog(`[AudioPlayer] cancelled stale load for ${trackId} after fade timeout`); return; }
        if (audioRef.current === audioToFade) {
          if (document.hidden && silentKeeperUrlRef.current) {
            // BACKGROUND BRIDGE: silent WAV holds audio focus during src swap.
            trace('silent_wav_engage', trackId, { why: 'bg_load_bridge' });
            try {
              audioRef.current.loop = true;
              audioRef.current.src = silentKeeperUrlRef.current;
              audioRef.current.play().catch(() => {});
            } catch {
              // Silent WAV failed — fall back to no-pause approach
              devWarn('[VOYO] Silent bridge failed, continuing without');
            }
          } else {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
        }
      }

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
      hasTriggeredPreloadRef.current = false; // Reset preload trigger for new track
      isEdgeStreamRef.current = false; // Reset edge stream flag for new track
      hasTriggered75PercentKeptRef.current = false; // Reset 75% kept trigger for new track
      hasTriggered30sListenRef.current = false; // Reset 30s listen flag for new track
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
      clearLoadWatchdog();
      loadWatchdogRef.current = setTimeout(() => {
        loadWatchdogRef.current = null;
        if (isStale()) return;
        const store = usePlayerStore.getState();
        if (!store.isPlaying) return;
        trace('watchdog_fire', trackId, { timer: 'fg-8s', hidden: document.hidden });
        devWarn(`[VOYO] Load watchdog fired for ${trackId} — 8s without playback, skipping`);
        { const t = usePlayerStore.getState().currentTrack; logPlaybackEvent({ event_type: 'skip_auto', track_id: trackId, track_title: t?.title, track_artist: t?.artist, error_code: 'load_watchdog', meta: { timer: 'fg-8s' } }); }
        isLoadingTrackRef.current = false;
        trace('next_call', trackId, { from: 'watchdog_fg' });
        nextTrack();
      }, 8000);
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
          if (elapsed < 5000) { mc.port2.postMessage(null); return; }
          // Time elapsed — close, re-check guards, fire.
          try { mc.port1.close(); } catch {}
          bgWatchdogPortRef.current = null;
          if (isStale() || !loadWatchdogRef.current) return;
          const store = usePlayerStore.getState();
          if (!store.isPlaying) return;
          trace('watchdog_fire', trackId, { timer: 'bg-5s', hidden: document.hidden, elapsedMs: elapsed });
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
          return;
        }
        trace('next_call', trackId, { from: 'max_retries', cascade: blocklistCascadeRef.current, hidden: document.hidden });
        nextTrack();
        navigator.mediaSession.playbackState = 'playing';
        return;
      }

      // Apply per-source state before the src swap.
      if (resolved.source === 'preload' && resolved.preloadedAudio) {
        resolved.preloadedAudio.pause();
        resolved.preloadedAudio.src = '';
      }
      isEdgeStreamRef.current = resolved.source === 'edge';
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
            try {
              audioRef.current.loop = true;
              audioRef.current.src = silentKeeperUrlRef.current!;
              audioRef.current.play().catch(() => {});
              setTimeout(() => {
                if (audioRef.current && !isStale()) {
                  audioRef.current.loop = false;
                  audioRef.current.src = resolved.url;
                  if (!resolved.isBlob) audioRef.current.load();
                }
              }, 800);
            } catch {}
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
        if (isInitialLoadRef.current && savedCurrentTime > 5) {
          audioRef.current.currentTime = savedCurrentTime;
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
            trace('play_resolved', trackId, { path });
            trace('load_complete', trackId, { path });
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
      // Same for the load watchdog — if the effect re-runs because the
      // track changed, the new loadTrack will arm its own. Don't let the
      // old one fire and skip the new track.
      clearLoadWatchdog();
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

  // Handle play/pause (only when using audio element: cached or r2)
  // Also suspend AudioContext when paused to save battery
  //
  // CRITICAL: `playbackSource` is intentionally NOT in the deps. Previously
  // this effect re-fired on every cdn↔r2↔cached transition during normal
  // playback (hot-swap, edge resolution, cache promotion) — even though
  // `isPlaying` hadn't changed. Each re-fire called audio.play() or
  // audio.pause() unprompted, which felt like "skip pause play" glitching to
  // the user. Now it only fires on actual play/pause user intent.
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;

    const audio = audioRef.current;
    if (isPlaying && audio.paused && audio.src && audio.readyState >= 2) {
      // CLICK-FREE PLAY (user tap-resume, NOT track load)
      //
      // CRITICAL: skip gain manipulation if a loadTrack is in flight.
      // loadTrack's canplaythrough handler already schedules its own
      // fade-in via fadeInMasterGain(200). If we ALSO cancel + re-anchor
      // + fade here, we get TWO competing ramps on the same AudioParam:
      // the gain jumps from wherever loadTrack's ramp was → 0.0001 (click)
      // → 60ms new ramp. That jump IS the crackling.
      //
      // This effect should ONLY manage gain on user-initiated play/pause
      // (tap the button), not on autoplay from track load.
      audioContextRef.current?.resume().catch(() => {});

      if (isLoadingTrackRef.current) {
        // loadTrack owns the gain ramp — just resume the audio element.
        // The loadTrack canplaythrough handler will fade in properly.
        audio.volume = 1.0;
        audio.play().catch(() => {});
        return;
      }

      if (audioEnhancedRef.current && gainNodeRef.current && audioContextRef.current) {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        const param = gainNodeRef.current.gain;
        // Anchor at near-silence so .play() doesn't hit a hot chain
        param.cancelScheduledValues(now);
        param.setValueAtTime(0.0001, now);
        audio.volume = 1.0;
        audio.play().then(() => {
          fadeInMasterGain(15); // Snap to target — 3ms ramp, matches track load
        }).catch(e => {
          devWarn('🎵 [Playback] Resume play failed:', e.name);
          usePlayerStore.getState().setIsPlaying(false);
        });
      } else {
        // Fallback: no Web Audio chain — ramp HTML element volume
        audio.volume = 0;
        audio.play().then(() => {
          const target = volume / 100;
          const start = performance.now();
          const step = () => {
            const t = Math.min((performance.now() - start) / 60, 1);
            if (audioRef.current) audioRef.current.volume = t * target;
            if (t < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }).catch(e => {
          devWarn('🎵 [Playback] Resume play failed:', e.name);
          usePlayerStore.getState().setIsPlaying(false);
        });
      }
    } else if (!isPlaying && !audio.paused) {
      // CLICK-FREE PAUSE:
      // 1. Ramp gain to near-silence (40ms)
      // 2. Call .pause() after the ramp completes (50ms timeout buffers)
      if (audioEnhancedRef.current && gainNodeRef.current && audioContextRef.current) {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        const param = gainNodeRef.current.gain;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(0.0001, now + 0.04);
        setTimeout(() => {
          if (audioRef.current && !audioRef.current.paused) {
            audioRef.current.pause();
          }
        }, 50);
      } else {
        // Fallback: ramp HTML element volume then pause
        const startVol = audio.volume;
        const start = performance.now();
        const step = () => {
          const t = Math.min((performance.now() - start) / 40, 1);
          if (audioRef.current) audioRef.current.volume = startVol * (1 - t);
          if (t < 1) {
            requestAnimationFrame(step);
          } else if (audioRef.current) {
            audioRef.current.pause();
          }
        };
        requestAnimationFrame(step);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Battery-suspend timer lives in bgEngine.

  // Handle volume (only when using audio element: cached or r2)
  // playbackSource omitted from deps for the same reason as the play/pause
  // effect above — it shouldn't re-apply volume on every source flip.
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;

    if (audioEnhancedRef.current && gainNodeRef.current) {
      audioRef.current.volume = 1.0;
      applyMasterGain(); // Unified: preset × spatial compensation × volume
    } else {
      audioRef.current.volume = volume / 100;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  // Handle seek (only when using audio element: cached or r2)
  useEffect(() => {
    if (seekPosition === null || (playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;
    audioRef.current.currentTime = seekPosition;
    clearSeekPosition();
  }, [seekPosition, playbackSource, clearSeekPosition]);

  // Handle playback rate (only when using audio element: cached or r2)
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;
    audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, playbackSource]);

  // Handle boost preset changes (only when using audio element: cached or r2)
  //
  // NOTE: `playbackSource` is intentionally NOT in the deps. Previously this
  // effect re-fired on every cdn↔r2↔cached transition during normal playback,
  // which produced ~30 AudioParam writes per flip. Even with the new ramping
  // helpers, the redundant re-fires were the architectural source of pops.
  // Now this only re-fires when boostProfile actually changes (the user
  // switches preset). The check inside still uses live `playbackSource` via
  // closure capture, so the guard still works, but we don't re-trigger.
  useEffect(() => {
    if ((playbackSource === 'cached' || playbackSource === 'r2') && audioEnhancedRef.current) {
      updateBoostPreset(boostProfile as BoostPreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boostProfile, updateBoostPreset]);

  // VOYEX Spatial slider: apply when slider changes or preset changes.
  // Same dep-cleanup logic — playbackSource intentionally omitted.
  useEffect(() => {
    if ((playbackSource === 'cached' || playbackSource === 'r2') && spatialEnhancedRef.current) {
      if (boostProfile === 'voyex') {
        updateVoyexSpatial(voyexSpatial);
      } else {
        updateVoyexSpatial(0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voyexSpatial, boostProfile, updateVoyexSpatial]);

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
    silentKeeperUrlRef,
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    muteMasterGainInstantly,
    fadeInMasterGain,
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
    if (document.hidden && silentKeeperUrlRef.current && audioRef.current) {
      try {
        audioRef.current.loop = true;
        audioRef.current.src = silentKeeperUrlRef.current;
        audioRef.current.play().catch(() => {});
        trace('silent_wav_engage', trackId, { why: 'pre_advance_bridge' });
      } catch {}
    }

    trace('next_call', trackId, { from: 'ended_advance', hidden: document.hidden });
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
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.buffered.length) return;
    const health = audioEngine.getBufferHealth(audioRef.current);
    setBufferHealth(health.percentage, health.status);
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
        trace('pause_accept', tid, { storeSet: false });
        usePlayerStore.getState().setIsPlaying(false);
      }}
      style={{ display: 'none' }}
    />
  );
};

export default AudioPlayer;
