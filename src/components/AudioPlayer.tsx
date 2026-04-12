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

// Edge Worker for extraction (FREE - replaces Fly.io)
const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';
// VPS audio server — pre-processed audio with loudness normalization.
// Falls back to edge worker + iframe if VPS is down or overloaded.
const VPS_AUDIO_URL = 'https://stream.zionsynapse.online:8443';
import { recordPoolEngagement } from '../services/personalization';
import { recordTrackInSession } from '../services/poolCurator';
import { recordPlay as djRecordPlay } from '../services/intelligentDJ';
import { onTrackPlay as oyoOnTrackPlay, onTrackComplete as oyoOnTrackComplete } from '../services/oyoDJ';
import { registerTrackPlay as viRegisterPlay } from '../services/videoIntelligence';
import { useMiniPiP } from '../hooks/useMiniPiP';
import {
  preloadNextTrack,
  getPreloadedTrack,
  consumePreloadedAudio,
  cleanupPreloaded,
  cancelPreload,
} from '../services/preloadManager';

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
  // SILENT WAV URL for iframe background play.
  //
  // Problem: during the iframe phase (before hot-swap completes), if the
  // user locks the phone, iOS/Android suspends the YouTube iframe. Audio
  // cuts out. The hot-swap to audio element can't complete because JS is
  // throttled in background.
  //
  // Solution: reuse the MAIN audio element as a silent keeper during the
  // iframe phase. Point audioRef.current.src at a silent WAV and call
  // play() — the main element is already unlocked from any prior track
  // play (iOS audio unlock is per-element), so no separate priming needed.
  // The silent audio routes through the Web Audio chain, masterGain is
  // muted (0) so nothing is audible from the main element — the iframe
  // provides the audible sound.
  //
  // iOS sees an HTMLMediaElement playing → treats the PWA as having audio
  // focus → keeps the page alive in background → iframe continues. When
  // /stream arrives, we swap the main element's src from silent WAV to
  // the real URL and hot-swap proceeds normally.
  const silentKeeperUrlRef = useRef<string | null>(null);

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
  const hotSwapAbortRef = useRef<AbortController | null>(null);
  const hasTriggered50PercentCacheRef = useRef<boolean>(false); // 50% auto-boost trigger
  const hasTriggered85PercentCacheRef = useRef<boolean>(false); // 85% edge-stream cache trigger
  const hasTriggeredPreloadRef = useRef<boolean>(false); // 70% next-track preload trigger
  const shouldAutoResumeRef = useRef<boolean>(false); // Resume playback on refresh if position was saved
  const isEdgeStreamRef = useRef<boolean>(false); // True when playing from Edge Worker stream URL (not IndexedDB)
  const hasTriggered75PercentKeptRef = useRef<boolean>(false); // 75% permanent cache trigger
  const hasTriggered30sListenRef = useRef<boolean>(false); // 30s artist discovery listen tracking
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
  const crossfadeArmedRef = useRef(false); // prevents double-fire of DJ crossfade
  // FLOW WATCHDOG: armed when loadTrack starts, cleared when play() succeeds.
  // If it fires, it means loadTrack never reached a playing state — either
  // the stream URL was null, fetch failed silently, canplaythrough never
  // fired, or play() was rejected (autoplay block). Instead of sitting in a
  // "loaded but silent" limbo, we auto-skip to the next track so the user
  // always experiences flow. Stale guard ensures a late fire doesn't skip
  // the CURRENT playing track after recovery.
  const loadWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLoadWatchdog = () => {
    if (loadWatchdogRef.current) {
      clearTimeout(loadWatchdogRef.current);
      loadWatchdogRef.current = null;
    }
  };
  // Handles the .catch side of a loadTrack play() promise. Distinguishes
  // autoplay-block (user must tap — not a real failure) from real failures
  // (stream died, decode error — skip immediately). Either way clears the
  // watchdog so it doesn't fire redundantly.
  const handlePlayFailure = (e: Error | DOMException, label: string) => {
    devWarn(`[Playback] ${label} play failed:`, e.name);
    clearLoadWatchdog();
    if (e.name === 'NotAllowedError') {
      // Autoplay blocked. Reflect paused state so the UI shows "tap to
      // play" — don't auto-skip, the user wants THIS track.
      usePlayerStore.getState().setIsPlaying(false);
      isLoadingTrackRef.current = false;
      return;
    }
    // Real failure — advance immediately rather than waiting 8s for the
    // watchdog to skip. Flow stays uninterrupted.
    isLoadingTrackRef.current = false;
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

    // 30s LISTEN — flag iframe-sourced tracks for R2 batch download.
    if (
      !hasTriggered30sListenRef.current &&
      playbackSource === 'iframe'
    ) {
      const elapsed = (track.duration || 300) * (progress / 100);
      if (elapsed >= 30) {
        hasTriggered30sListenRef.current = true;
        devLog('🎵 [VOYO] 30s listen reached — flagging for R2 download');
        import('../lib/supabase').then(({ videoIntelligenceAPI }) => {
          videoIntelligenceAPI.flagForDownload(track.trackId);
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
    if (hasTriggeredPreloadRef.current) {
      // Already triggered for this track, skip
      return;
    }

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

    // Stagger preloads: 500ms, 5500ms, 10500ms to avoid bandwidth competition
    const staggerDelays = [500, 5500, 10500];

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

  // Background playback + AudioContext battery optimization.
  //
  // SLIMMED DOWN: was calling audio.play() directly on visibility change,
  // which competed with the audioEngine.ts visibility handler AND useMiniPiP
  // visibility handler — three handlers firing simultaneously caused the
  // "audio muffles when quitting/returning to app" symptom. Now this only
  // does the ONE thing AudioPlayer is responsible for: suspend the context
  // when hidden+paused (battery). Resume on show is handled by audioEngine.
  // Background playback continues automatically because we never pause it.
  useEffect(() => {
    const handleVisibility = () => {
      const { isPlaying: shouldPlay, playbackSource: ps } = usePlayerStore.getState();

      if (document.visibilityState === 'hidden') {
        // BATTERY: suspend context ONLY when paused + hidden.
        // Never suspend when playing — audio must continue in background.
        if (!shouldPlay && audioContextRef.current?.state === 'running') {
          audioContextRef.current.suspend().catch(() => {});
          devLog('🔋 [Battery] AudioContext suspended (paused + hidden)');
        }
        return;
      }

      // RETURNING FROM BACKGROUND — ensure audio is actually playing.
      // Some mobile browsers pause the audio element's internal scheduler
      // during background even if the AudioContext stays running. A safety
      // play() call re-kicks the scheduler. Only fires if the store says
      // we should be playing AND the audio element is paused (desync).
      if (shouldPlay && audioRef.current?.paused && (ps === 'cached' || ps === 'r2')) {
        audioRef.current.play().catch(() => {});
        devLog('🔄 [VOYO] Re-kicked audio element on foreground return');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [playbackSource]);

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

  // SILENT WAV GENERATION — once on mount.
  //
  // Creates a 2-second silent WAV blob and holds the URL in a ref. The
  // main audio element uses this as its src during iframe phase, so iOS
  // sees a continuously-playing media element and keeps the page alive
  // through screen-off. See the iframe-miss branch of loadTrack.
  useEffect(() => {
    // Build a minimal silent WAV (8kHz, 8-bit, mono, 2 seconds ≈ 16KB).
    const sampleRate = 8000;
    const durationSec = 2;
    const numSamples = sampleRate * durationSec;
    const bufSize = 44 + numSamples;
    const ab = new ArrayBuffer(bufSize);
    const dv = new DataView(ab);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    dv.setUint32(4, bufSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    dv.setUint32(16, 16, true);       // fmt chunk size
    dv.setUint16(20, 1, true);        // PCM
    dv.setUint16(22, 1, true);        // mono
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate, true); // byte rate (8-bit mono = sampleRate)
    dv.setUint16(32, 1, true);        // block align
    dv.setUint16(34, 8, true);        // bits per sample
    writeStr(36, 'data');
    dv.setUint32(40, numSamples, true);
    // 8-bit unsigned PCM uses 128 as silent midpoint — fill with 128.
    for (let i = 0; i < numSamples; i++) dv.setUint8(44 + i, 128);

    const blob = new Blob([ab], { type: 'audio/wav' });
    silentKeeperUrlRef.current = URL.createObjectURL(blob);

    return () => {
      if (silentKeeperUrlRef.current) {
        URL.revokeObjectURL(silentKeeperUrlRef.current);
        silentKeeperUrlRef.current = null;
      }
    };
  }, []);

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
      // RELAXED: was threshold=-1/ratio=20 which clamps down on almost every
      // modern track (regularly peak at -0.1 to -0.5dBFS). That constant
      // gain reduction sounds like "compression pumping" / muffling. New
      // values catch true clips (>-0.3dBFS) without squashing normal peaks.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -0.3; limiter.knee.value = 0; limiter.ratio.value = 8;
      limiter.attack.value = 0.001; limiter.release.value = 0.05;
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

  // Apply master gain: preset × spatial compensation × volume.
  // Single source of truth — called from updateBoostPreset, updateVoyexSpatial,
  // and volume effect. Ramped to avoid speaker pops on every preset/volume
  // change. The 25ms ramp is short enough to feel instant.
  const applyMasterGain = () => {
    if (!gainNodeRef.current) return;
    const target = computeMasterTarget();
    const ctx = audioContextRef.current;
    if (ctx) {
      const now = ctx.currentTime;
      const param = gainNodeRef.current.gain;
      // Textbook click-free param write: cancel any pending automation,
      // anchor at the current value, then linearly ramp to the target
      // over 25ms. linearRampToValueAtTime guarantees we hit the target
      // exactly at the specified time (setTargetAtTime never reaches it,
      // it asymptotes — this is the difference between "reduces clicks"
      // and "eliminates clicks").
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
  const armGainWatchdog = (label: string, timeoutMs: number = 6000) => {
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = setTimeout(() => {
      watchdogTimerRef.current = null;
      if (!audioRef.current || !gainNodeRef.current || !audioContextRef.current) return;
      // If the element is still paused, nothing to rescue — let the play
      // flow retry naturally when user interacts.
      if (audioRef.current.paused) return;
      // Element is playing but gain is stuck at silence → rescue.
      const param = gainNodeRef.current.gain;
      if (param.value > 0.01) return; // Already recovered on its own
      devWarn(`🩹 [VOYO] Watchdog rescue (${label}) — canplaythrough never fired, forcing fade-in`);
      const ctx = audioContextRef.current;
      const now = ctx.currentTime;
      const target = computeMasterTarget();
      param.cancelScheduledValues(now);
      param.setValueAtTime(0.0001, now);
      param.linearRampToValueAtTime(target, now + 0.2);
    }, timeoutMs);
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
    param.linearRampToValueAtTime(0.0001, now + 0.015); // 15ms fade out
    armGainWatchdog('mute-before-load');
  };

  // DJ CROSSFADE MUTE — smooth 1.5s fade-out for natural track endings.
  // Used when the track is approaching its end OR on user skip to give
  // the transition a DJ-mixed feel instead of a hard cut. The 1.5s ramp
  // overlaps with the next track's fade-in (800ms) creating a brief
  // simultaneous-play window where both tracks are audible — the
  // signature of a professional mix.
  //
  // Falls through to muteMasterGainInstantly for the final silent-swap
  // (the loadTrack effect still needs the chain at 0 before src change).
  // DJ crossfade: 600ms exponential fade-out. Short enough to not be
  // obvious during the last notes, long enough to feel mixed (not cut).
  // Was 1500ms which made the volume drop noticeable during the final
  // chorus. 600ms is the sweet spot — same timing DJs use for a quick mix.
  const crossfadeMute = () => {
    if (!gainNodeRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;
    const param = gainNodeRef.current.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.exponentialRampToValueAtTime(0.001, now + 0.6);
  };

  // Short fade-in ramp from silence → target. Called from canplaythrough
  // handlers right before audio.play() so the first audible samples of a
  // new track enter under a ramp, not a step. 80ms is long enough to bury
  // any transient click but short enough to feel instant.
  // Disarms the watchdog AND the load-in-flight guard — playback is up.
  const fadeInMasterGain = (durationMs: number = 80) => {
    disarmGainWatchdog();
    isLoadingTrackRef.current = false; // Track load done, onPause may sync again
    if (!gainNodeRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;
    const param = gainNodeRef.current.gain;
    const target = computeMasterTarget();
    param.cancelScheduledValues(now);
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(target, now + durationMs / 1000);
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
      // Fallback: no Web Audio chain - fade HTML element volume
      audioRef.current.volume = 0;
      const targetVol = usePlayerStore.getState().volume / 100;
      const startTime = performance.now();
      const step = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        if (audioRef.current) audioRef.current.volume = t * targetVol;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
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

      // Skip if same track
      if (lastTrackIdRef.current === trackId) return;

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
        // Mark the load in flight so onPause doesn't sync isPlaying=false
        // when we call pause() below. Without this guard, skipping causes
        // the next track to load but never auto-play.
        isLoadingTrackRef.current = true;
        muteMasterGainInstantly();
        audioRef.current.oncanplaythrough = null;
        audioRef.current.oncanplay = null;
        audioRef.current.onplay = null;
        // CLEAR STALE LOOP FLAG: the iframe-miss branch sets loop=true to
        // keep the silent WAV looping. If that load never reached hot-swap
        // (stream failed), the flag persists. Without this reset, the next
        // R2/cached track would loop forever on its first play.
        audioRef.current.loop = false;
        // Hold a reference so the timeout doesn't pause a future track
        const audioToFade = audioRef.current;
        await new Promise<void>(resolve => setTimeout(resolve, 18));
        // STALE GUARD: if another loadTrack started during the 25ms ramp wait,
        // don't touch the audio element — the newer load owns it now. Without
        // this guard, pausing or rewinding here can clobber a freshly-loading
        // track during rapid skips.
        if (isStale()) { devLog(`[AudioPlayer] cancelled stale load for ${trackId} after fade timeout`); return; }
        if (audioRef.current === audioToFade) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
      }

      // RESUME FIX: On initial load, if we have a saved position > 5s, auto-resume playback
      // This fixes the bug where track seeks correctly on refresh but audio doesn't play
      if (isInitialLoadRef.current && savedCurrentTime > 5) {
        shouldAutoResumeRef.current = true;
        devLog(`🔄 [VOYO] Session resume detected (position: ${savedCurrentTime.toFixed(1)}s) - will auto-play`);
      }

      lastTrackIdRef.current = trackId;
      hasRecordedPlayRef.current = false;
      trackProgressRef.current = 0;
      hasTriggered50PercentCacheRef.current = false; // Reset 50% trigger for new track
      hasTriggered85PercentCacheRef.current = false; // Reset 85% trigger for new track
      lastProgressWriteBucketRef.current = -1; // Reset throttle bucket → first frame of new track writes
      hasTriggeredPreloadRef.current = false; // Reset preload trigger for new track
      isEdgeStreamRef.current = false; // Reset edge stream flag for new track
      hasTriggered75PercentKeptRef.current = false; // Reset 75% kept trigger for new track
      hasTriggered30sListenRef.current = false; // Reset 30s listen flag for new track
      crossfadeArmedRef.current = false; // Reset crossfade trigger for new track

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
        if (isStale()) return; // newer loadTrack took over
        const store = usePlayerStore.getState();
        if (!store.isPlaying) return; // user paused, respect intent
        devWarn(`[VOYO] Load watchdog fired for ${trackId} — 8s without playback, skipping`);
        isLoadingTrackRef.current = false;
        nextTrack();
      }, 8000);

      // End previous session
      endListenSession(audioRef.current?.currentTime || 0, 0);
      startListenSession(currentTrack.id, currentTrack.duration || 0);

      // PRELOAD CHECK: Use preloaded audio if available (instant playback!)
      const preloaded = getPreloadedTrack(trackId);
      if (preloaded && preloaded.audioElement && (preloaded.source === 'cached' || preloaded.source === 'r2')) {
        devLog(`🔮 [VOYO] Using PRELOADED audio (source: ${preloaded.source})`);

        // Consume the preloaded audio element
        const preloadedAudio = consumePreloadedAudio(trackId);
        if (preloadedAudio) {
          setPlaybackSource(preloaded.source);

          const { boostProfile: profile } = usePlayerStore.getState();
          setupAudioEnhancement(profile);

          // Replace our audio ref with preloaded one? No - we need to use our own ref
          // Instead, copy the src from preloaded element
          if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
          cachedUrlRef.current = preloaded.url;

          if (audioRef.current && preloaded.url) {
            audioRef.current.volume = 1.0; // Pinned — all loudness via masterGain
            audioRef.current.src = preloaded.url;
            audioRef.current.load();

            // Since we preloaded, audio should be ready almost instantly
            audioRef.current.oncanplaythrough = () => {
              if (!audioRef.current) return;
              // STALE GUARD: the canplaythrough callback can fire LATE —
              // after the user has already skipped to the next track. If we
              // don't check, we'd start playing the stale preloaded track
              // on top of whatever the newer loadTrack wired up.
              if (isStale()) return;

              const { isPlaying: shouldPlay } = usePlayerStore.getState();
              if (shouldPlay && audioRef.current.paused) {
                audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
                // Schedule the fade-in BEFORE play() so the ramp is already
                // queued when the first sample lands. 400ms premium settle-in
                // so each fresh track eases in smoothly.
                fadeInMasterGain(200);
                audioRef.current.play().then(() => {
                  clearLoadWatchdog();
                  recordPlayEvent();
                  devLog('🔮 [VOYO] Preloaded playback started!');
                }).catch(e => handlePlayFailure(e, 'Preloaded'));
              }
              // Paused state: masterGain stays muted. When user taps play,
              // the play/pause effect's applyMasterGain() ramps it back up.
            };
          }

          // Cleanup the preloaded element
          preloadedAudio.pause();
          preloadedAudio.src = '';
          return; // Skip normal loading flow
        }
      }

      // Normal loading flow: Check cache first
      const API_BASE = 'https://voyo-edge.dash-webtv.workers.dev';
      const { url: bestUrl, cached: fromCache } = audioEngine.getBestAudioUrl(trackId, API_BASE);
      const cachedUrl = fromCache ? bestUrl : await checkCache(trackId);
      if (isStale()) { devLog(`[AudioPlayer] cancelled stale load for ${trackId} after checkCache`); return; }

      if (cachedUrl) {
        // ⚡ BOOSTED - Play from cache instantly
        devLog('🎵 [VOYO] Playing BOOSTED');
        isEdgeStreamRef.current = false;
        setPlaybackSource('cached');

        if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
        cachedUrlRef.current = cachedUrl;

        const { boostProfile: profile } = usePlayerStore.getState();
        setupAudioEnhancement(profile);

        if (audioRef.current) {
          audioRef.current.volume = 1.0; // Pinned — all loudness via masterGain
          audioRef.current.src = cachedUrl;
          audioRef.current.load();

          audioRef.current.oncanplaythrough = () => {
            if (!audioRef.current) return;
            // STALE GUARD: late-firing canplaythrough after a skip would
            // start the wrong track. Bail before touching play state.
            if (isStale()) return;

            // Restore position on initial load
            if (isInitialLoadRef.current && savedCurrentTime > 5) {
              audioRef.current.currentTime = savedCurrentTime;
              isInitialLoadRef.current = false;
            }

            // FIX: Get fresh state to avoid stale closure bug
            // The isPlaying from closure might be outdated when callback fires
            const { isPlaying: shouldPlay } = usePlayerStore.getState();

            // RESUME FIX: Also auto-play if we detected a session resume (even if isPlaying is false)
            const shouldAutoResume = shouldAutoResumeRef.current;
            if (shouldAutoResume) {
              shouldAutoResumeRef.current = false; // Only auto-resume once
            }

            if ((shouldPlay || shouldAutoResume) && audioRef.current.paused) {
              audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
              // Session resume uses the longer 1.2s fade; normal playback
              // gets a 400ms premium settle-in fade on every fresh track.
              // Both scheduled BEFORE play() so the ramp is queued when the
              // first sample lands.
              if (shouldAutoResume) {
                fadeInVolume(1200);
              } else {
                fadeInMasterGain(200);
              }
              audioRef.current.play().then(() => {
                clearLoadWatchdog();
                recordPlayEvent();
                // Update store to reflect playing state if we auto-resumed
                if (shouldAutoResume && !shouldPlay) {
                  usePlayerStore.getState().togglePlay();
                }
                devLog('🎵 [VOYO] Playback started (cached)');
              }).catch(e => handlePlayFailure(e, 'Cached'));
            }
            // Paused state: masterGain stays muted; play/pause effect will
            // ramp it up via applyMasterGain() when the user taps play.
          };
        }
      } else {
        // 📡 NOT IN LOCAL CACHE - Check R2 collective cache before iframe
        devLog('🎵 [VOYO] Not in local cache, checking R2 collective...');

        const r2Result = await checkR2Cache(trackId);
        if (isStale()) { devLog(`[AudioPlayer] cancelled stale load for ${trackId} after R2 check`); return; }

        if (r2Result.exists && r2Result.url) {
          // 🚀 R2 HIT - Play from collective cache with EQ
          const qualityInfo = r2Result.hasHigh ? 'HIGH' : 'LOW';
          devLog(`🎵 [VOYO] R2 HIT! Playing from collective cache (${qualityInfo} quality)`);
          setPlaybackSource('r2');

          // PHASE 5: Track if low quality - will upgrade at 50%
          if (!r2Result.hasHigh && r2Result.hasLow) {
            devLog('🎵 [VOYO] Low quality R2 - will upgrade at 50% interest');
            hasTriggered50PercentCacheRef.current = false; // Allow upgrade trigger
          }

          const { boostProfile: profile } = usePlayerStore.getState();
          setupAudioEnhancement(profile);

          if (audioRef.current) {
            audioRef.current.volume = 1.0; // Pinned — loudness via masterGain
            audioRef.current.src = r2Result.url;
            audioRef.current.load();

            audioRef.current.oncanplaythrough = () => {
              if (!audioRef.current) return;
              if (isStale()) return; // STALE GUARD — see cached path above

              // Restore position on initial load
              if (isInitialLoadRef.current && savedCurrentTime > 5) {
                audioRef.current.currentTime = savedCurrentTime;
                isInitialLoadRef.current = false;
              }

              const { isPlaying: shouldPlay } = usePlayerStore.getState();

              // RESUME FIX: Also auto-play if we detected a session resume (even if isPlaying is false)
              const shouldAutoResume = shouldAutoResumeRef.current;
              if (shouldAutoResume) {
                shouldAutoResumeRef.current = false; // Only auto-resume once
              }

              if ((shouldPlay || shouldAutoResume) && audioRef.current.paused) {
                audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
                if (shouldAutoResume) {
                  fadeInVolume(1200);
                } else {
                  // 400ms premium settle-in for every fresh R2 track start.
                  fadeInMasterGain(200);
                }
                audioRef.current.play().then(() => {
                  clearLoadWatchdog();
                  recordPlayEvent();
                  if (shouldAutoResume && !shouldPlay) {
                    usePlayerStore.getState().togglePlay();
                  }
                  devLog('🎵 [VOYO] Playback started (R2)');
                }).catch(e => handlePlayFailure(e, 'R2'));
              }
            };
          }
        } else {
          // 📡 R2 MISS — TRY VPS SERVER FIRST, FALL BACK TO IFRAME
          //
          // The VPS (stream.zionsynapse.online) runs yt-dlp + FFmpeg to
          // extract, normalize (EBU R128), and encode audio on the server.
          // The client gets a finished stream — zero client-side extraction,
          // better battery, instant background play. If the VPS is down or
          // overloaded, we fall back to the iframe + hot-swap pipeline
          // (the battle-tested client-side path).
          //
          // VPS audio endpoint: /voyo/audio/:trackId?quality=high|medium|low
          // Returns: audio/ogg (Opus) stream, chunked transfer encoding
          // On cache hit: 302 redirect to R2 CDN (zero VPS bandwidth)
          // On miss: stream while processing (3-8s FFmpeg startup)
          devLog('🎵 [VOYO] R2 miss — trying VPS server first...');

          let vpsHandled = false;
          try {
            const vpsResponse = await fetch(
              `${VPS_AUDIO_URL}/voyo/audio/${trackId}?quality=high`,
              { signal: AbortSignal.timeout(8000) },
            );
            if (isStale()) return;

            if (vpsResponse.ok || vpsResponse.status === 302) {
              // VPS served the audio (either stream or R2 redirect).
              // The fetch API follows redirects automatically, so
              // vpsResponse.url is the final URL (R2 CDN or VPS stream).
              devLog('🎵 [VOYO] VPS server responded — playing server-processed audio');
              vpsHandled = true;

              // Create a blob URL from the response for the audio element
              const audioBlob = await vpsResponse.blob();
              if (isStale()) return;
              const blobUrl = URL.createObjectURL(audioBlob);

              isEdgeStreamRef.current = false;
              setPlaybackSource('cached'); // Treat server audio as cached

              const { boostProfile: profile } = usePlayerStore.getState();
              setupAudioEnhancement(profile);

              if (audioRef.current) {
                if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
                cachedUrlRef.current = blobUrl;
                audioRef.current.loop = false;
                audioRef.current.volume = 1.0;
                audioRef.current.src = blobUrl;
                audioRef.current.load();

                audioRef.current.oncanplaythrough = () => {
                  if (!audioRef.current) return;
                  if (isStale()) return;

                  if (isInitialLoadRef.current && savedCurrentTime > 5) {
                    audioRef.current.currentTime = savedCurrentTime;
                    isInitialLoadRef.current = false;
                  }

                  const { isPlaying: shouldPlay } = usePlayerStore.getState();
                  const shouldAutoResume = shouldAutoResumeRef.current;
                  if (shouldAutoResume) shouldAutoResumeRef.current = false;

                  if ((shouldPlay || shouldAutoResume) && audioRef.current.paused) {
                    audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
                    if (shouldAutoResume) {
                      fadeInVolume(1200);
                    } else {
                      fadeInMasterGain(200);
                    }
                    audioRef.current.play().then(() => {
                      clearLoadWatchdog();
                      recordPlayEvent();
                      if (shouldAutoResume && !shouldPlay) {
                        usePlayerStore.getState().togglePlay();
                      }
                      devLog('🎵 [VOYO] Playback started (VPS server-processed)');
                    }).catch(e => handlePlayFailure(e, 'VPS'));
                  }
                };
              }
            }
          } catch (e) {
            devLog(`[VOYO] VPS server unavailable (${(e as Error)?.message}) — falling back to iframe pipeline`);
          }

          // If VPS handled it, we're done. Otherwise fall through to iframe.
          if (vpsHandled) return;

          // 📡 FALLBACK — IFRAME FIRST, HOT-SWAP TO AUDIO ELEMENT
          //
          // The VPS is down or overloaded. Fall back to the battle-tested
          // client-side pipeline: iframe plays instantly, /stream fetch
          // runs in parallel, hot-swap when ready.
          //
          // New flow:
          //   1. IMMEDIATELY set playbackSource='iframe'. The YouTubeIframe
          //      component is always mounted and already loading the current
          //      track's video — it auto-unMutes when playbackSource is not
          //      cached/r2, and starts playing audio via the YouTube embed.
          //      This gives INSTANT playback, no /stream wait.
          //
          //   2. In parallel, fire the /stream fetch. If it succeeds,
          //      hot-swap from iframe → audio element for background-play
          //      capability (iframes pause on mobile background; audio
          //      elements don't).
          //
          //   3. If /stream fails, stay on iframe. Foreground playback still
          //      works via the iframe audio; background play won't work for
          //      this specific track but the app keeps flowing.
          //
          //   4. Queue pre-boost (wired in playerStore.addToQueue) reduces
          //      how often we even reach this path — queued tracks get
          //      cacheTrack'd in the background so they hit the R2 path.
          devLog('🎵 [VOYO] R2 miss — starting iframe immediately, will hot-swap to audio element when stream arrives');

          // BACKGROUND-PLAY KEEPER: point the main audio element at a
          // silent WAV and play it. Web Audio chain stays muted so no
          // sound leaks from the main element — the iframe provides
          // audible sound. But iOS sees HTMLMediaElement.playing=true
          // and keeps the PWA in "has audio focus" state, which holds
          // the iframe alive when the phone screen turns off.
          //
          // The main audio element is already unlocked from any prior
          // track play (iOS unlock is per-element), so this .play() call
          // succeeds even though we're outside the user gesture scope.
          // Need Web Audio context muted first so no silent-WAV artifacts
          // leak through the chain during the src swap.
          muteMasterGainInstantly();
          isEdgeStreamRef.current = false;
          setPlaybackSource('iframe');
          // Iframe is playing now — clear the load watchdog so it doesn't
          // fire and skip the track while we try to upgrade to audio element.
          clearLoadWatchdog();
          // IMPORTANT: keep isLoadingTrackRef = TRUE throughout iframe phase.
          // Setting it to false here would let the src-swap to silent WAV
          // fire onPause → setIsPlaying(false) → iframe pauses itself.
          // fadeInMasterGain (called in the hot-swap path) will clear it
          // when the audio element actually takes over.

          // Point main audio element at silent WAV. The source node stays
          // wired through src changes (Web Audio API design). This triggers
          // onPause then canplay events — onPause is safe because the
          // natural-end/load guards handle it.
          if (audioRef.current && silentKeeperUrlRef.current) {
            try {
              audioRef.current.loop = true; // keep silence looping
              audioRef.current.src = silentKeeperUrlRef.current;
              audioRef.current.load();
              // Play on canplay (first readiness, not canplaythrough).
              // Silent WAV is tiny, will be ready almost immediately.
              const onCanPlayKeeper = () => {
                audioRef.current?.removeEventListener('canplay', onCanPlayKeeper);
                if (isStale()) return;
                // Only play if we're still in iframe phase (user didn't skip)
                const ps = usePlayerStore.getState().playbackSource;
                if (ps !== 'iframe') return;
                audioRef.current?.play().catch((e) => {
                  devWarn('[VOYO] silent keeper play failed:', e?.name);
                });
              };
              audioRef.current.addEventListener('canplay', onCanPlayKeeper, { once: true });
            } catch (e) {
              devWarn('[VOYO] failed to set silent keeper src:', e);
            }
          }

          // Parallel stream fetch for hot-swap upgrade.
          try {
            const streamResponse = await fetch(
              `${EDGE_WORKER_URL}/stream?v=${trackId}`,
              { signal: AbortSignal.timeout(5000) },
            );
            if (isStale()) { devLog(`[AudioPlayer] cancelled stale stream fetch for ${trackId}`); return; }
            const streamData = await streamResponse.json();
            if (isStale()) { devLog(`[AudioPlayer] cancelled stale stream json for ${trackId}`); return; }

            if (!streamData.url) {
              devLog('🎵 [VOYO] No stream URL — iframe stays as audio source (no background play for this track)');
              return;
            }

            devLog(`🎵 [VOYO] Got stream URL (${streamData.bitrate}bps ${streamData.mimeType}) — hot-swapping iframe → audio element`);

            const { boostProfile: profile } = usePlayerStore.getState();
            setupAudioEnhancement(profile);

            if (audioRef.current) {
              // Guard onPause during the silent-WAV → real-URL src swap.
              // Setting src fires pause first, and without this guard the
              // onPause handler would set isPlaying=false in the store.
              isLoadingTrackRef.current = true;
              audioRef.current.loop = false; // clear the silent-WAV loop flag
              audioRef.current.volume = 1.0; // Pinned — loudness via masterGain
              audioRef.current.src = streamData.url;
              audioRef.current.load();

              audioRef.current.oncanplaythrough = () => {
                if (!audioRef.current) return;
                if (isStale()) return;

                // Seek audio element to the iframe's current position so
                // the hot-swap is near-seamless. The store's currentTime is
                // synced from the iframe at 4Hz, so at worst ~250ms off.
                const iframePos = usePlayerStore.getState().currentTime;
                if (isInitialLoadRef.current && savedCurrentTime > 5) {
                  audioRef.current.currentTime = savedCurrentTime;
                  isInitialLoadRef.current = false;
                } else if (iframePos > 1) {
                  audioRef.current.currentTime = iframePos;
                }

                const { isPlaying: shouldPlay } = usePlayerStore.getState();
                if (!shouldPlay) return; // user paused during the swap, don't play

                // HOT SWAP BEGINS.
                // Flip the source flag — YouTubeIframe's own effect sees
                // playbackSource become 'cached' and mutes/pauses the iframe
                // automatically (its line ~253 effect). The audio element
                // plays via the Web Audio chain with EQ + VOYEX applied.
                isEdgeStreamRef.current = true;
                setPlaybackSource('cached');

                audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
                fadeInMasterGain(140); // slightly longer fade so the iframe→audio transition is inaudible

                audioRef.current.play().then(() => {
                  clearLoadWatchdog();
                  recordPlayEvent();
                  devLog('🎵 [VOYO] Hot-swap complete — audio element is now the source, background play enabled');
                }).catch(e => handlePlayFailure(e, 'Hot-swap'));
              };

              // Keep onplay wired but empty — cache triggers fire from the
              // 85% progress milestone + onEnded fallback.
              audioRef.current.onplay = () => {
                if (isStale()) return;
              };
            }
          } catch (streamError) {
            devWarn('[VOYO] Stream fetch failed — iframe continues as audio source (no background play for this track):', streamError);
            // Intentionally DO NOT call nextTrack(). The iframe is playing.
            // Foreground playback works. Background play doesn't, but the
            // user hears their track instead of watching it disappear.
          }
        }
      }
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
    // audio thread = audible crack on every track start. setTimeout(0)
    // yields to the next macrotask, letting the audio thread settle first.
    setTimeout(() => {
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
    }, 0);
  }, [currentTrack]);

  // === HOT-SWAP: When boost completes mid-stream (R2 → cached upgrade) ===
  // CRITICAL: Uses AbortController to prevent race conditions when track changes mid-swap
  //
  // SKIP MID-TRACK SWAP IF FAR INTO THE TRACK. The hot-swap is intentionally
  // a hard cut: pause → swap src → load → seek → play. Even with masterGain
  // muting, the audio element jump introduces a 100-300ms gap that the user
  // hears as a crack/interruption mid-song. The cache is now ready for the
  // NEXT play of this track regardless — so if we're past 35% of the song,
  // skip the swap entirely. The user gets the high-quality version starting
  // from the next play, and the current playback is uninterrupted.
  useEffect(() => {
    if (!lastBoostCompletion || !currentTrack?.trackId) return;

    const completedId = lastBoostCompletion.trackId;
    const currentId = currentTrack.trackId.replace('VOYO_', '');
    const isCurrentTrackMatch = completedId === currentId || completedId === currentTrack.trackId;

    // Hot-swap if currently streaming via R2 or Edge Worker stream AND boost is for current track
    // This upgrades from R2 (potentially low quality) or expiring stream URL to local cached (high quality)
    if (!isCurrentTrackMatch) return;
    if (playbackSource !== 'r2' && !(playbackSource === 'cached' && isEdgeStreamRef.current)) return;

    // GUARD: skip the swap if we're past 35% — not worth the audible interruption
    const currentProgress = usePlayerStore.getState().progress;
    if (currentProgress > 35) {
      devLog(`[VOYO] Hot-swap skipped — already at ${currentProgress.toFixed(0)}% (cache will be used on next play)`);
      return;
    }

    // Cancel any previous hot-swap operation to prevent race condition
    if (hotSwapAbortRef.current) {
      hotSwapAbortRef.current.abort();
      devLog('[VOYO] Cancelled previous hot-swap operation');
    }
    hotSwapAbortRef.current = new AbortController();
    const signal = hotSwapAbortRef.current.signal;
    const swapTrackId = currentTrack.trackId; // Capture at start

    devLog('🔄 [VOYO] Hot-swap: Boost complete, upgrading R2 to cached audio...');

    const performHotSwap = async () => {
      // Check if aborted before starting
      if (signal.aborted) {
        devLog('[VOYO] Hot-swap aborted before start');
        return;
      }

      const cachedUrl = await checkCache(currentTrack.trackId);

      // Check AGAIN after async operation - track may have changed
      if (signal.aborted) {
        devLog('[VOYO] Hot-swap aborted after cache check');
        return;
      }

      // Double-verify we're still on the same track (belt and suspenders)
      const storeTrackId = usePlayerStore.getState().currentTrack?.trackId;
      if (storeTrackId !== swapTrackId) {
        devLog('[VOYO] Track changed during hot-swap, aborting. Expected:', swapTrackId, 'Got:', storeTrackId);
        return;
      }

      if (!cachedUrl || !audioRef.current) return;

      // Get current position from store (iframe was tracking it)
      const currentPos = usePlayerStore.getState().currentTime;

      // IMPORTANT: Don't switch playbackSource yet - iframe keeps playing until audio is ready
      // This prevents the "stop" bug when boost completes fast

      if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
      cachedUrlRef.current = cachedUrl;

      const { boostProfile: profile } = usePlayerStore.getState();
      setupAudioEnhancement(profile);

      // FIX: Clear dangling handlers before hot-swap to prevent old callbacks interfering.
      // Also clear onplay — the edge-stream loadTrack path sets it, and if we don't
      // clear it here, it keeps firing against the new src (triggering bogus cache downloads).
      audioRef.current.oncanplaythrough = null;
      audioRef.current.oncanplay = null;
      audioRef.current.onplay = null;
      // FADE: ramp masterGain to silence BEFORE swapping src, instead of setting
      // audio.volume = 0. audio.volume at the HTML element level is a digital jump
      // that leaks into the MediaElementAudioSourceNode as a click. The gain ramp
      // is applied inside the Web Audio chain where it's click-free by design.
      // audio.volume stays pinned at 1.0 throughout (no HTML-level jumps).
      muteMasterGainInstantly();
      audioRef.current.src = cachedUrl;
      audioRef.current.load();

      audioRef.current.oncanplaythrough = () => {
        // Final check before applying - ensure we haven't been aborted
        if (signal.aborted) {
          devLog('[VOYO] Hot-swap aborted during canplaythrough');
          return;
        }
        if (!audioRef.current) return;

        // Resume from same position
        if (currentPos > 2) {
          audioRef.current.currentTime = currentPos;
        }

        // FIX: Get fresh state to avoid stale closure bug
        // The isPlaying from the outer closure could be outdated when this callback fires
        const { isPlaying: shouldPlayNow } = usePlayerStore.getState();

        // FIXED: Only switch playbackSource AFTER audio element is ready
        // This ensures iframe keeps playing until cached audio can take over seamlessly
        if (shouldPlayNow && audioRef.current.paused) {
          audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume().catch(() => {});
          // Schedule fade-in BEFORE .play() so the ramp is queued when the
          // first sample lands — click-free upgrade from stream to cached.
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            // NOW switch to cached mode - audio is playing from local cache
            isEdgeStreamRef.current = false; // No longer streaming from edge
            setPlaybackSource('cached');
            devLog('🔄 [VOYO] Hot-swap complete! Now playing boosted audio');
          }).catch((err) => {
            // Play failed - don't switch source, keep iframe playing
            devLog('[VOYO] Hot-swap play failed, keeping iframe:', err);
          });
        } else if (!shouldPlayNow) {
          // Paused state - switch source but don't play.
          // masterGain is muted; play/pause effect will ramp it up on next play.
          setPlaybackSource('cached');
          devLog('🔄 [VOYO] Hot-swap ready (paused state)');
        }
      };
    };

    performHotSwap();

    // Cleanup: abort on unmount or when dependencies change
    return () => {
      if (hotSwapAbortRef.current) {
        hotSwapAbortRef.current.abort();
      }
    };
    // CRITICAL: isPlaying and playbackSource removed from deps. Including
    // them caused the hot-swap effect to re-fire on every play/pause toggle
    // and every cdn↔r2↔cached transition — each re-fire abort+restarted any
    // pending swap, occasionally leaving the audio element in a half-loaded
    // state with masterGain muted. The actual decision logic reads these
    // via closure capture / usePlayerStore.getState() which still works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBoostCompletion, currentTrack?.trackId, checkCache, setPlaybackSource, setupAudioEnhancement]);

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
    if (isPlaying && audio.paused && audio.src && audio.readyState >= 1) {
      // CLICK-FREE PLAY:
      // 1. Ensure audio context is live
      // 2. Anchor gain at silence BEFORE .play() so first samples aren't loud
      // 3. Start playback
      // 4. Ramp gain up to target (60ms) — buries the transient
      // ALWAYS resume — iOS sometimes reports 'running' after a lock-screen
      // interruption when the context is actually 'interrupted'. resume() is
      // a no-op when already running, so calling it unconditionally is safe.
      audioContextRef.current?.resume().catch(() => {});
      if (audioEnhancedRef.current && gainNodeRef.current && audioContextRef.current) {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        const param = gainNodeRef.current.gain;
        // Anchor at near-silence so .play() doesn't hit a hot chain
        param.cancelScheduledValues(now);
        param.setValueAtTime(0.0001, now);
        audio.volume = 1.0;
        audio.play().then(() => {
          fadeInMasterGain(60); // Ramp up to target post-play
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

  // Suspend AudioContext when paused + hidden (delayed to allow quick resume)
  const suspendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Clear any pending suspend timer
    if (suspendTimerRef.current) {
      clearTimeout(suspendTimerRef.current);
      suspendTimerRef.current = null;
    }

    // Only set suspend timer when not playing
    if (!isPlaying && (playbackSource === 'cached' || playbackSource === 'r2')) {
      suspendTimerRef.current = setTimeout(() => {
        if (!usePlayerStore.getState().isPlaying && document.visibilityState === 'hidden') {
          // .suspend() returns a promise that can reject on iOS in some states.
          audioContextRef.current?.suspend().catch(() => {});
          devLog('🔋 [Battery] AudioContext suspended (paused + hidden)');
        }
        suspendTimerRef.current = null;
      }, 5000);
    }

    return () => {
      if (suspendTimerRef.current) {
        clearTimeout(suspendTimerRef.current);
        suspendTimerRef.current = null;
      }
    };
  }, [isPlaying, playbackSource]);

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

  // Media Session — registers for ANY playbackSource (cached/r2/iframe).
  //
  // CRITICAL: the iframe path needs this too. Without it, the lock screen
  // shows stale metadata (from the previous cached/r2 track) and the
  // action handlers are still wired to the old track context. Worse, if
  // the first track of the session goes iframe-miss, the lock screen is
  // blank and no hardware buttons work.
  //
  // We register whenever there's a currentTrack, regardless of source.
  // The seek handlers route based on source: for iframe, they seek the
  // YouTube player via getCurrentTime/seekTo; for cached/r2, they seek
  // the main audio element directly.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    // Multiple artwork sizes — the OS picks the right one for the lock
    // screen / notification shade / media widget depending on display
    // density. Falling back to YouTube's hqdefault if the Edge Worker
    // art endpoint is empty (both URLs work; OS tries in order).
    const edgeArt = `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${currentTrack.trackId}?quality=high`;
    const ytArt = `https://i.ytimg.com/vi/${currentTrack.trackId}/hqdefault.jpg`;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: 'VOYO Music',
      artwork: [
        // Edge worker (preferred — custom processed art)
        { src: edgeArt, sizes: '96x96',   type: 'image/jpeg' },
        { src: edgeArt, sizes: '192x192', type: 'image/jpeg' },
        { src: edgeArt, sizes: '384x384', type: 'image/jpeg' },
        { src: edgeArt, sizes: '512x512', type: 'image/jpeg' },
        // YouTube fallback — if edge worker 404s, the OS walks to this
        { src: ytArt,   sizes: '480x360', type: 'image/jpeg' },
      ],
    });

    navigator.mediaSession.setActionHandler('play', () => !usePlayerStore.getState().isPlaying && togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => usePlayerStore.getState().isPlaying && togglePlay());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
    navigator.mediaSession.setActionHandler('previoustrack', () => usePlayerStore.getState().prevTrack());

    // SEEK FORWARD / BACKWARD — used by headset hardware buttons, car
    // head units, and the lock-screen 10s skip arrows. Default offset
    // of 10s matches every major music app.
    //
    // ROUTING: during iframe phase, the main audio element is playing a
    // SILENT WAV — seeking it does nothing audible. We route iframe-phase
    // seeks through the store's currentTime, which YouTubeIframe watches
    // and translates into player.seekTo(). For cached/r2, we seek the
    // audio element directly via the click-free mute → seek → fade pattern.
    const seekOffset = (dir: 1 | -1, offset: number) => {
      const ps = usePlayerStore.getState().playbackSource;
      if (ps === 'iframe') {
        // Route through store — YouTubeIframe's seek effect picks this up.
        const curr = usePlayerStore.getState().currentTime;
        const dur = usePlayerStore.getState().duration;
        const newTime = Math.max(0, Math.min(dur || 0, curr + dir * offset));
        usePlayerStore.getState().seekTo(newTime);
        return;
      }
      if (!audioRef.current) return;
      const newTime = Math.max(0, Math.min(
        audioRef.current.duration || 0,
        audioRef.current.currentTime + dir * offset,
      ));
      muteMasterGainInstantly();
      audioRef.current.currentTime = newTime;
      setTimeout(() => fadeInMasterGain(80), 30);
    };
    navigator.mediaSession.setActionHandler('seekforward', (d) => {
      seekOffset(1, d.seekOffset || 10);
    });
    navigator.mediaSession.setActionHandler('seekbackward', (d) => {
      seekOffset(-1, d.seekOffset || 10);
    });
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (d.seekTime === undefined) return;
      const ps = usePlayerStore.getState().playbackSource;
      if (ps === 'iframe') {
        usePlayerStore.getState().seekTo(d.seekTime);
        return;
      }
      if (!audioRef.current) return;
      muteMasterGainInstantly();
      audioRef.current.currentTime = d.seekTime;
      setTimeout(() => fadeInMasterGain(80), 30);
    });

    // STOP — some OS widgets and Bluetooth controls fire this instead of
    // pause. Treat it as pause for us (we don't want to destroy the
    // audio element or clear the queue).
    try {
      navigator.mediaSession.setActionHandler('stop', () => {
        if (usePlayerStore.getState().isPlaying) togglePlay();
      });
    } catch {
      // Some browsers throw on unsupported actions — harmless.
    }

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying, playbackSource, togglePlay, nextTrack]);

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

    // ── DJ CROSSFADE TRIGGER ──────────────────────────────────────
    // When the track is within 3 seconds of ending, start the smooth
    // crossfade. The current track fades out over 1.5s (exponential
    // ramp), nextTrack fires so the new track starts loading while
    // the old one is still audible. The new track's fade-in (800ms)
    // overlaps with the tail of the old fade-out. Result: DJ-mixed
    // transition instead of hard silence cut.
    //
    // crossfadeArmedRef prevents double-firing (the trigger condition
    // is true for ~12 handleTimeUpdate ticks).
    const remaining = el.duration - el.currentTime;
    if (remaining > 0 && remaining < 1.5 && !crossfadeArmedRef.current && el.duration > 10) {
      crossfadeArmedRef.current = true;
      devLog(`[VOYO] DJ crossfade: ${remaining.toFixed(1)}s remaining — fading out`);
      crossfadeMute(); // 1.5s exponential fade-out
    }

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
  }, [playbackSource, setCurrentTime, setProgress, checkProgressMilestones]);

  const handleDurationChange = useCallback(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.duration) return;
    setDuration(audioRef.current.duration);
  }, [playbackSource, setDuration]);

  const handleEnded = useCallback(() => {
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;
    // Capture current state for the deferred work
    const track = currentTrack;
    const currentTime = audioRef.current?.currentTime || 0;
    const completionRate = trackProgressRef.current;
    // Capture whether this was an edge-stream track (for cache fallback below)
    const wasEdgeStream = isEdgeStreamRef.current;
    const cacheNotYetTriggered = !hasTriggered85PercentCacheRef.current;
    // Advance to next track IMMEDIATELY — autoplay must be instant.
    // Haptic pulse: subtle "beat" on auto-transition so the user feels
    // the track boundary physically (multimodal: hear silence gap +
    // feel the tap + see the art crossfade).
    haptics.light();
    nextTrack();
    // Defer the telemetry/learning chain + cache fallback to next macrotask.
    // Same pattern as recordPlayEvent: avoid blocking the audio thread right
    // when the next track is starting.
    if (track) {
      setTimeout(() => {
        try {
          endListenSession(currentTime, 0);
          recordPoolEngagement(track.trackId, 'complete', { completionRate });
          useTrackPoolStore.getState().recordCompletion(track.trackId, completionRate);
          oyoOnTrackComplete(track, currentTime);
          // FALLBACK: if this was an edge-stream track AND the 85% cache
          // effect didn't fire (rare — progress polling skipped over the
          // threshold), cache it now. The audio is done playing, no
          // competition, ideal moment to grab + upload to R2.
          if (wasEdgeStream && cacheNotYetTriggered && track.trackId) {
            devLog('🎵 [VOYO] handleEnded fallback cache (85% effect missed)');
            cacheTrack(
              track.trackId,
              track.title,
              track.artist,
              track.duration || 0,
              `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${track.trackId}?quality=high`
            );
          }
        } catch (e) {
          devWarn('[VOYO] handleEnded telemetry failed:', e);
        }
      }, 0);
    }
  }, [playbackSource, currentTrack, nextTrack, endListenSession, cacheTrack]);

  const handleProgress = useCallback(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.buffered.length) return;
    const health = audioEngine.getBufferHealth(audioRef.current);
    setBufferHealth(health.percentage, health.status);
  }, [playbackSource, setBufferHealth]);

  // ERROR HANDLER: Handle audio element errors with recovery (music never stops)
  // IMPROVED: Immediate cache check first (should be ready with 3s auto-cache),
  // seamless position-preserving swap, max 500ms silence target
  const handleAudioError = useCallback(async (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
    // During iframe phase, the main audio element is playing the silent
    // WAV as a background-play keeper. If that errors (rare — blob URL
    // is stable in-memory), we don't need full recovery since the iframe
    // is providing audible sound. Just re-arm the silent keeper and let
    // the hot-swap path (or next track) take over naturally.
    if (playbackSource === 'iframe') {
      devWarn('[VOYO] Silent WAV keeper errored during iframe phase — re-arming');
      if (audioRef.current && silentKeeperUrlRef.current) {
        try {
          audioRef.current.loop = true;
          audioRef.current.src = silentKeeperUrlRef.current;
          audioRef.current.load();
          // play() is not forced here — the onPause guard handles the
          // transient state, and if the user is actively on iframe the
          // element will re-attach when ready.
        } catch {}
      }
      return;
    }
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;

    const audio = e.currentTarget;
    const error = audio.error;
    const errorCodes: Record<number, string> = {
      1: 'MEDIA_ERR_ABORTED',
      2: 'MEDIA_ERR_NETWORK',
      3: 'MEDIA_ERR_DECODE',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    };

    const errorName = error ? (errorCodes[error.code] || `Unknown(${error.code})`) : 'Unknown';
    const recoveryStart = performance.now();
    console.error(`🚨 [VOYO] Audio error: ${errorName}`, error?.message);

    // Clear the load watchdog — we're now in recovery mode. If recovery
    // succeeds, we don't want the original 8s timer to fire and skip the
    // newly-recovered track. If recovery fails, the final nextTrack() call
    // will arm a fresh watchdog on the next track's loadTrack.
    clearLoadWatchdog();

    if (!currentTrack?.trackId || !error) return;

    const savedPos = usePlayerStore.getState().currentTime;

    // FIX: Clear ALL dangling handlers before recovery (including onplay which
    // the edge-stream loadTrack path sets). Also mute masterGain so the Web
    // Audio chain doesn't pop when the src is swapped out from under it.
    // audio.volume stays pinned at 1.0 — all loudness is controlled by
    // masterGain inside the chain.
    if (audioRef.current) {
      audioRef.current.oncanplaythrough = null;
      audioRef.current.oncanplay = null;
      audioRef.current.onplay = null;
      muteMasterGainInstantly();
    }

    // STALE GUARD: Capture this recovery's load attempt so a rapid skip
    // during async recovery work doesn't fire stale oncanplay callbacks
    // over a freshly-started loadTrack. If loadAttemptRef advances, we
    // bail before touching audio.src.
    const recoveryAttempt = loadAttemptRef.current;
    const recoveryIsStale = () => loadAttemptRef.current !== recoveryAttempt;

    // RECOVERY 1 (FASTEST): Check local cache IMMEDIATELY
    // With 3s auto-cache delay, cache should be ready for most tracks
    try {
      const cachedUrl = await checkCache(currentTrack.trackId);
      if (recoveryIsStale()) return;
      if (cachedUrl && audioRef.current) {
        const swapStart = performance.now();
        devLog('🔄 [VOYO] FAST RECOVERY - switching to local cache');
        if (cachedUrlRef.current) URL.revokeObjectURL(cachedUrlRef.current);
        cachedUrlRef.current = cachedUrl;
        audioRef.current.src = cachedUrl;
        audioRef.current.load();

        // Use oncanplay (not oncanplaythrough) for fastest possible resume
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null; // Clear to prevent re-trigger
          if (recoveryIsStale()) return; // late fire, newer load owns the element
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = false;
          setPlaybackSource('cached');
          // Fade-in via masterGain — click-free. audio.volume stays at 1.0.
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            const elapsed = performance.now() - recoveryStart;
            devLog(`🔄 [VOYO] Cache recovery complete in ${elapsed.toFixed(0)}ms (swap: ${(performance.now() - swapStart).toFixed(0)}ms)`);
          }).catch(() => {});
        };
        return;
      }
    } catch {}

    // RECOVERY 2: Check R2 collective cache (faster than re-extracting)
    try {
      devLog('🔄 [VOYO] Recovery 2 - checking R2 collective cache');
      const r2Result = await checkR2Cache(currentTrack.trackId);
      if (recoveryIsStale()) return;
      if (r2Result.exists && r2Result.url && audioRef.current) {
        audioRef.current.src = r2Result.url;
        audioRef.current.load();
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null;
          if (recoveryIsStale()) return;
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = false;
          setPlaybackSource('r2');
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            const elapsed = performance.now() - recoveryStart;
            devLog(`🔄 [VOYO] R2 recovery complete in ${elapsed.toFixed(0)}ms`);
          }).catch(() => {});
        };
        return;
      }
    } catch {}

    // RECOVERY 3: Re-extract stream URL from Edge Worker (last resort before skip)
    try {
      devLog('🔄 [VOYO] Recovery 3 - re-extracting stream URL');
      // Use AbortSignal.timeout for cleanliness — same baseline as api.ts.
      const streamResponse = await fetch(`${EDGE_WORKER_URL}/stream?v=${currentTrack.trackId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (recoveryIsStale()) return;
      const streamData = await streamResponse.json();
      if (recoveryIsStale()) return;
      if (streamData.url && audioRef.current) {
        audioRef.current.src = streamData.url;
        audioRef.current.load();
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null;
          if (recoveryIsStale()) return;
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = true;
          fadeInMasterGain(80);
          audioRef.current.play().then(() => {
            const elapsed = performance.now() - recoveryStart;
            devLog(`🔄 [VOYO] Stream re-extract recovery complete in ${elapsed.toFixed(0)}ms`);
          }).catch(() => {});
        };
        return;
      }
    } catch {}

    // RECOVERY 4: Skip to next track (music never stops)
    if (recoveryIsStale()) return; // a newer loadTrack is already in motion
    const elapsed = performance.now() - recoveryStart;
    devLog(`🚨 [VOYO] Cannot recover after ${elapsed.toFixed(0)}ms - skipping to next track`);
    // NOTE: Do NOT clear audio.src — it can break the MediaElementAudioSourceNode.
    // Just pause and let the next track load set a new src.
    audio.pause();
    if (cachedUrlRef.current) {
      URL.revokeObjectURL(cachedUrlRef.current);
      cachedUrlRef.current = null;
    }
    nextTrack();
  }, [playbackSource, currentTrack?.trackId, checkCache, nextTrack, setPlaybackSource]);

  // ── STALLED RECOVERY ────────────────────────────────────────────────
  // The audio element fires `stalled` and `waiting` when it can't get more
  // data — but neither triggers `onError`, so the existing recovery never
  // runs. The element just sits frozen until the user manually skips.
  // Solution: track stall state with a 4s timer. If still stalled after 4s,
  // force the same recovery flow as onError. Per-stall-event timer so a
  // brief network blip doesn't trigger recovery.
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleStalled = useCallback(() => {
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;
    if (stallTimerRef.current) return; // already armed
    devWarn('⚠️ [VOYO] Audio stalled — armed 4s recovery timer');
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null;
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      // Still stalled after 4s — synthesize an error event and run recovery.
      // We can't actually fire onError, so call handleAudioError directly
      // with a fake event-like object whose currentTarget points at the audio.
      devWarn('🚨 [VOYO] Stalled >4s — forcing recovery');
      handleAudioError({ currentTarget: audio } as React.SyntheticEvent<HTMLAudioElement, Event>);
    }, 4000);
  }, [playbackSource, handleAudioError]);
  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

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
        if (playbackSource === 'cached' || playbackSource === 'r2') {
          setBufferHealth(100, 'healthy');
        }
        usePlayerStore.getState().setIsPlaying(true);
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
      }}
      onStalled={handleStalled}
      onSuspend={() => clearStallTimer()}
      onPause={() => {
        // Sync the store to the actual audio state. No more force-resume.
        // GUARD 1: skip during a track-load pause (loadTrack pauses the
        // element to swap src). Without this, skip didn't auto-play.
        if (isLoadingTrackRef.current) return;
        // GUARD 2: skip during a natural-end pause. When a track ends,
        // the browser fires `pause` BEFORE `ended`. Without this guard,
        // the pause sets isPlaying=false → handleEnded runs nextTrack()
        // which races to set it back to true → React commit may not
        // resolve cleanly → autoplay doesn't fire. Check audio.ended
        // (which is true by the time the pause event fires on natural end).
        if (audioRef.current?.ended) return;
        usePlayerStore.getState().setIsPlaying(false);
      }}
      style={{ display: 'none' }}
    />
  );
};

export default AudioPlayer;
