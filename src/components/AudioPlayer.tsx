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
import { audioEngine, connectAudioChain } from '../services/audioEngine';
import { checkR2Cache } from '../services/api';
import { downloadTrack, getCachedTrackUrl } from '../services/downloadManager';

// Edge Worker for extraction (FREE - replaces Fly.io)
const EDGE_WORKER_URL = 'https://voyo-edge.dash-webtv.workers.dev';
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
  const previousTrackRef = useRef<Track | null>(null);
  const hasRecordedPlayRef = useRef<boolean>(false);
  const trackProgressRef = useRef<number>(0);
  const isInitialLoadRef = useRef<boolean>(true);
  const backgroundBoostingRef = useRef<string | null>(null);
  const hotSwapAbortRef = useRef<AbortController | null>(null);
  const hasTriggered50PercentCacheRef = useRef<boolean>(false); // 50% auto-boost trigger
  const hasTriggeredPreloadRef = useRef<boolean>(false); // 70% next-track preload trigger
  const shouldAutoResumeRef = useRef<boolean>(false); // Resume playback on refresh if position was saved
  const isEdgeStreamRef = useRef<boolean>(false); // True when playing from Edge Worker stream URL (not IndexedDB)
  const hasTriggered75PercentKeptRef = useRef<boolean>(false); // 75% permanent cache trigger
  const hasTriggered30sListenRef = useRef<boolean>(false); // 30s artist discovery listen tracking

  // Store state
  const {
    currentTrack, isPlaying, volume, seekPosition, playbackRate, boostProfile, voyexSpatial,
    currentTime: savedCurrentTime, playbackSource, progress, queue,
    setCurrentTime, setDuration, setProgress, clearSeekPosition, togglePlay,
    nextTrack, predictNextTrack, setBufferHealth, setPlaybackSource,
  } = usePlayerStore();

  const { startListenSession, endListenSession } = usePreferenceStore();
  const { initialize: initDownloads, checkCache, cacheTrack, lastBoostCompletion, autoBoostEnabled, downloadSetting } = useDownloadStore();

  // Mini-PiP for background playback
  useMiniPiP();

  // Initialize downloads
  useEffect(() => {
    initDownloads();
  }, [initDownloads]);

  // 50% AUTO-BOOST: Trigger quality upgrade when user shows genuine interest
  // Works for: r2 low quality (upgrade to high)
  useEffect(() => {
    // Only trigger at 50% for r2 (for quality upgrade from low to high)
    if (playbackSource !== 'r2') return;
    if (hasTriggered50PercentCacheRef.current) return;
    if (progress < 50) return;
    if (!currentTrack?.trackId) return;

    // Check network preference (always | wifi-only | ask | never)
    if (downloadSetting === 'never') {
      devLog('🎵 [VOYO] 50% reached but download setting is "never"');
      return;
    }

    if (downloadSetting === 'wifi-only') {
      // Use Network Information API to detect wifi vs cellular
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      const isWifi = !connection || connection.type === 'wifi' || connection.type === 'ethernet' || !connection.effectiveType?.includes('2g');
      if (!isWifi) {
        devLog('🎵 [VOYO] 50% reached but wifi-only setting blocks caching on mobile data');
        return;
      }
    }

    // 'always' and 'ask' both allow caching (ask prompts for manual boost, auto-cache is silent)

    // Mark as triggered to prevent duplicate calls
    hasTriggered50PercentCacheRef.current = true;

    const API_BASE = 'https://voyo-edge.dash-webtv.workers.dev';
    devLog('🎵 [VOYO] 50% reached! Upgrading R2 low quality to HIGH (genuine interest)');

    // Start background cache
    backgroundBoostingRef.current = currentTrack.trackId;
    cacheTrack(
      currentTrack.trackId,
      currentTrack.title,
      currentTrack.artist,
      currentTrack.duration || 0,
      `${API_BASE}/cdn/art/${currentTrack.trackId}?quality=high`
    ).finally(() => {
      backgroundBoostingRef.current = null;
    });
  }, [progress, playbackSource, currentTrack, cacheTrack, downloadSetting]);

  // 75% KEPT: Mark track as permanent cache when user shows strong interest
  useEffect(() => {
    if (hasTriggered75PercentKeptRef.current) return;
    if (progress < 75) return;
    if (!currentTrack?.trackId) return;
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;

    hasTriggered75PercentKeptRef.current = true;

    import('../services/downloadManager').then(({ markTrackAsKept }) => {
      const normalizedId = currentTrack.trackId.replace('VOYO_', '');
      markTrackAsKept(normalizedId);
      devLog('🎵 [VOYO] 75% reached - track marked as KEPT (permanent)');
    });
  }, [progress, currentTrack?.trackId, playbackSource]);

  // 30s LISTEN: Flag track for R2 download when user listens > 30 seconds
  // This powers the demand-driven acquisition pipeline:
  // User discovers via YouTube → listens 30s → flagged → batch script downloads to R2
  useEffect(() => {
    if (hasTriggered30sListenRef.current) return;
    if (!currentTrack?.trackId) return;
    const elapsed = (currentTrack.duration || 300) * (progress / 100);
    if (elapsed < 30) return;
    if (playbackSource !== 'iframe') return; // Only flag iframe-sourced tracks (not yet in R2)

    hasTriggered30sListenRef.current = true;
    devLog('🎵 [VOYO] 30s listen reached — flagging for R2 download');

    // Flag in video_intelligence for batch download
    import('../lib/supabase').then(({ videoIntelligenceAPI }) => {
      videoIntelligenceAPI.flagForDownload(currentTrack.trackId);
    });
  }, [progress, currentTrack?.trackId, currentTrack?.duration, playbackSource]);

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

  // Background playback + AudioContext battery optimization
  useEffect(() => {
    const handleVisibility = () => {
      const { isPlaying: shouldPlay } = usePlayerStore.getState();

      if (document.visibilityState === 'hidden') {
        // Tab hidden - if playing, keep AudioContext running for background playback
        if (shouldPlay && audioRef.current && (playbackSource === 'cached' || playbackSource === 'r2')) {
          if (audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume();
          }
          audioRef.current.play().catch(e => devWarn('🎵 [Playback] Background resume failed:', e.name));
        }
        // If NOT playing and tab hidden, suspend AudioContext to save battery
        else if (!shouldPlay && audioContextRef.current?.state === 'running') {
          audioContextRef.current.suspend();
          devLog('🔋 [Battery] AudioContext suspended (tab hidden, not playing)');
        }
      } else {
        // Tab visible - resume AudioContext if it was suspended
        if (audioContextRef.current?.state === 'suspended' && shouldPlay) {
          audioContextRef.current.resume();
          devLog('🔋 [Battery] AudioContext resumed (tab visible)');
        }
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

  // Harmonic exciter curve
  const makeHarmonicCurve = (amount: number): Float32Array<ArrayBuffer> => {
    const samples = 44100;
    const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>;
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + amount / 100) * x * 20 * deg) / (Math.PI + (amount / 100) * Math.abs(x));
    }
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
      hM.connect(ctx.destination);

      // ── CONVOLVER REVERB — two real impulse responses (dark + bright) ──
      // Replaces metallic 3-delay-line feedback reverb with natural room sound
      const generateIR = (duration: number, decay: number, lpCutoff: number): AudioBuffer => {
        const len = Math.ceil(ctx.sampleRate * duration);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        const L = buf.getChannelData(0), R = buf.getChannelData(1);
        // Early reflections — discrete taps in first 80ms for room shape
        const erEnd = Math.ceil(ctx.sampleRate * 0.08);
        for (let er = 0; er < 12; er++) {
          const pos = Math.floor(Math.random() * erEnd);
          const amp = (1 - pos / erEnd) * 0.4;
          L[pos] += (Math.random() * 2 - 1) * amp;
          R[pos] += (Math.random() * 2 - 1) * amp;
        }
        // Late reverb — exponentially decaying noise (diffuse tail)
        for (let n = erEnd; n < len; n++) {
          const env = Math.exp(-decay * (n / ctx.sampleRate));
          L[n] += (Math.random() * 2 - 1) * env;
          R[n] += (Math.random() * 2 - 1) * env;
        }
        // Frequency shaping — one-pole lowpass for dark/bright character
        const coeff = Math.exp(-2 * Math.PI * lpCutoff / ctx.sampleRate);
        let pL = 0, pR = 0;
        for (let n = 0; n < len; n++) {
          L[n] = pL = pL * coeff + L[n] * (1 - coeff);
          R[n] = pR = pR * coeff + R[n] * (1 - coeff);
        }
        return buf;
      };

      // DIVE reverb: dark room — long tail, heavy damping, warm and enveloping
      const diveConv = ctx.createConvolver();
      diveConv.buffer = generateIR(2.5, 2.0, 1800);
      const diveWet = ctx.createGain(); diveWet.gain.value = 0;
      diveReverbWetRef.current = diveWet;
      spInput.connect(diveConv); diveConv.connect(diveWet); diveWet.connect(ctx.destination);

      // IMMERSE reverb: bright space — tight, airy, expansive
      const immConv = ctx.createConvolver();
      immConv.buffer = generateIR(1.5, 3.5, 9000);
      const immWet = ctx.createGain(); immWet.gain.value = 0;
      immerseReverbWetRef.current = immWet;
      spInput.connect(immConv); immConv.connect(immWet); immWet.connect(ctx.destination);

      const sBP = ctx.createBiquadFilter(); sBP.type = 'bandpass'; sBP.frequency.value = 90; sBP.Q.value = 1;
      const sSh = ctx.createWaveShaper();
      const sC = new Float32Array(44100);
      for (let si = 0; si < 44100; si++) { const sx = (si * 2) / 44100 - 1; sC[si] = Math.tanh(sx * 3) * 0.8; }
      sSh.curve = sC; sSh.oversample = '2x';
      const sLP = ctx.createBiquadFilter(); sLP.type = 'lowpass'; sLP.frequency.value = 80;
      const sMx = ctx.createGain(); sMx.gain.value = 0; subHarmonicGainRef.current = sMx;
      spInput.connect(sBP); sBP.connect(sSh); sSh.connect(sLP); sLP.connect(sMx); sMx.connect(ctx.destination);

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

      // Harmonic exciter (default: no curve = bypass) — low/mid only
      const harmonic = ctx.createWaveShaper(); harmonic.oversample = '2x';
      harmonicExciterRef.current = harmonic;
      const exciterBypass = ctx.createGain(); exciterBypass.gain.value = 1.0;
      const bandMerger = ctx.createGain(); bandMerger.gain.value = 1.0;

      // Wire multiband
      source.connect(highPass);
      highPass.connect(lowF1); lowF1.connect(lowF2); lowF2.connect(lowGain); lowGain.connect(lowComp); lowComp.connect(harmonic);
      highPass.connect(midHP1); midHP1.connect(midHP2); midHP2.connect(midLP1); midLP1.connect(midLP2); midLP2.connect(midGain); midGain.connect(midComp); midComp.connect(harmonic);
      highPass.connect(highF1); highF1.connect(highF2); highF2.connect(highGain); highGain.connect(highComp); highComp.connect(exciterBypass);
      harmonic.connect(bandMerger); exciterBypass.connect(bandMerger);

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
      bandMerger.connect(subBass); subBass.connect(bass); bass.connect(warmth); warmth.connect(presence); presence.connect(air);

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
      const masterGain = ctx.createGain(); masterGain.gain.value = 1.0;
      gainNodeRef.current = masterGain;
      stMerger.connect(masterGain);

      // ── FINAL COMPRESSOR (for standard presets; transparent when VOYEX) ──
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = 0; comp.ratio.value = 1; comp.knee.value = 10; comp.attack.value = 0.003; comp.release.value = 0.25;
      compressorRef.current = comp;
      masterGain.connect(comp);

      // ── BRICKWALL LIMITER (always active, safety net for all presets) ──
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.001; limiter.release.value = 0.05;
      comp.connect(limiter); limiter.connect(spInput);

      audioEnhancedRef.current = true;

      // Apply initial preset parameters
      updateBoostPreset(preset);

      devLog('🎛️ [VOYO] Unified chain: multiband → EQ → stereo → master → comp → limiter → spatial');
    } catch (e) {
      devWarn('[VOYO] Audio enhancement failed:', e);
    }
  }, []);

  // Compute master gain: preset × spatial compensation × volume
  // Single source of truth — called from updateBoostPreset, updateVoyexSpatial, and volume effect
  const applyMasterGain = () => {
    if (!gainNodeRef.current) return;
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
    gainNodeRef.current.gain.value = baseGain * comp * vol;
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
  const updateBoostPreset = useCallback((preset: BoostPreset) => {
    if (!audioEnhancedRef.current) return;
    currentProfileRef.current = preset;

    const setMultibandTransparent = () => {
      multibandLowGainRef.current && (multibandLowGainRef.current.gain.value = 1.0);
      multibandMidGainRef.current && (multibandMidGainRef.current.gain.value = 1.0);
      multibandHighGainRef.current && (multibandHighGainRef.current.gain.value = 1.0);
      if (multibandLowCompRef.current) { multibandLowCompRef.current.threshold.value = 0; multibandLowCompRef.current.ratio.value = 1; }
      if (multibandMidCompRef.current) { multibandMidCompRef.current.threshold.value = 0; multibandMidCompRef.current.ratio.value = 1; }
      if (multibandHighCompRef.current) { multibandHighCompRef.current.threshold.value = 0; multibandHighCompRef.current.ratio.value = 1; }
    };

    const setStandardEqNeutral = () => {
      subBassFilterRef.current && (subBassFilterRef.current.gain.value = 0);
      bassFilterRef.current && (bassFilterRef.current.gain.value = 0);
      warmthFilterRef.current && (warmthFilterRef.current.gain.value = 0);
      presenceFilterRef.current && (presenceFilterRef.current.gain.value = 0);
      airFilterRef.current && (airFilterRef.current.gain.value = 0);
    };

    // 'off' = RAW AUDIO - everything transparent
    if (preset === 'off') {
      setMultibandTransparent();
      setStandardEqNeutral();
      harmonicExciterRef.current && (harmonicExciterRef.current.curve = null);
      if (compressorRef.current) { compressorRef.current.threshold.value = 0; compressorRef.current.ratio.value = 1; }
      stereoDelayRef.current && (stereoDelayRef.current.delayTime.value = 0);
      applyMasterGain();
      devLog('🎵 [VOYO] RAW mode - all processing bypassed');
      return;
    }

    const s = BOOST_PRESETS[preset] as any;

    if (s.multiband) {
      // ── VOYEX: Multiband active, standard EQ neutral ──
      multibandLowGainRef.current && (multibandLowGainRef.current.gain.value = s.low.gain);
      multibandMidGainRef.current && (multibandMidGainRef.current.gain.value = s.mid.gain);
      multibandHighGainRef.current && (multibandHighGainRef.current.gain.value = s.high.gain);
      if (multibandLowCompRef.current) { multibandLowCompRef.current.threshold.value = s.low.threshold; multibandLowCompRef.current.ratio.value = s.low.ratio; }
      if (multibandMidCompRef.current) { multibandMidCompRef.current.threshold.value = s.mid.threshold; multibandMidCompRef.current.ratio.value = s.mid.ratio; }
      if (multibandHighCompRef.current) { multibandHighCompRef.current.threshold.value = s.high.threshold; multibandHighCompRef.current.ratio.value = s.high.ratio; }
      if (harmonicExciterRef.current) { harmonicExciterRef.current.curve = s.harmonicAmount > 0 ? makeHarmonicCurve(s.harmonicAmount) : null; }
      setStandardEqNeutral();
      if (compressorRef.current) { compressorRef.current.threshold.value = 0; compressorRef.current.ratio.value = 1; } // Multiband handles compression
      stereoDelayRef.current && (stereoDelayRef.current.delayTime.value = s.stereoWidth || 0);
    } else {
      // ── Standard presets: Multiband transparent, standard EQ active ──
      setMultibandTransparent();
      harmonicExciterRef.current && (harmonicExciterRef.current.curve = s.harmonicAmount > 0 ? makeHarmonicCurve(s.harmonicAmount) : null);
      subBassFilterRef.current && (subBassFilterRef.current.frequency.value = s.subBassFreq); subBassFilterRef.current && (subBassFilterRef.current.gain.value = s.subBassGain);
      bassFilterRef.current && (bassFilterRef.current.frequency.value = s.bassFreq); bassFilterRef.current && (bassFilterRef.current.gain.value = s.bassGain);
      warmthFilterRef.current && (warmthFilterRef.current.frequency.value = s.warmthFreq); warmthFilterRef.current && (warmthFilterRef.current.gain.value = s.warmthGain);
      presenceFilterRef.current && (presenceFilterRef.current.frequency.value = s.presenceFreq); presenceFilterRef.current && (presenceFilterRef.current.gain.value = s.presenceGain);
      airFilterRef.current && (airFilterRef.current.frequency.value = s.airFreq); airFilterRef.current && (airFilterRef.current.gain.value = s.airGain);
      if (compressorRef.current) {
        compressorRef.current.threshold.value = s.compressor.threshold; compressorRef.current.ratio.value = s.compressor.ratio;
        compressorRef.current.knee.value = s.compressor.knee; compressorRef.current.attack.value = s.compressor.attack; compressorRef.current.release.value = s.compressor.release;
      }
      stereoDelayRef.current && (stereoDelayRef.current.delayTime.value = s.stereoWidth || 0);
    }

    applyMasterGain();
    devLog(`🎵 [VOYO] Switched to ${preset.toUpperCase()}`);
  }, []);

  // VOYEX INTENSITY SLIDER — full mastering + spatial control
  // Center = clean VOYEX baseline. Extremes = full experience.
  // No caps. No protection. The slider IS the user's control.
  const updateVoyexSpatial = useCallback((value: number) => {
    if (!spatialEnhancedRef.current) return;
    const v = Math.max(-100, Math.min(100, value));
    const i = Math.abs(v) / 100; // 0→1 intensity

    // ══════════════════════════════════════════════════════
    // LAYER 1: MULTIBAND MASTERING CHARACTER
    // The actual music changes tone — not just the room
    // ══════════════════════════════════════════════════════
    if (multibandLowGainRef.current && multibandMidGainRef.current && multibandHighGainRef.current) {
      if (v < 0) {
        // DIVE mastering: massive warm bass, scooped mids, rolled highs
        multibandLowGainRef.current.gain.value = 1.3 + (i * 0.35);  // 1.3 → 1.65
        multibandMidGainRef.current.gain.value = 1.1 - (i * 0.05);  // 1.1 → 1.05 (slight scoop)
        multibandHighGainRef.current.gain.value = 1.25 - (i * 0.3); // 1.25 → 0.95
      } else if (v > 0) {
        // IMMERSE mastering: crystal highs, present vocals, solid bass
        multibandLowGainRef.current.gain.value = 1.3;                // anchor
        multibandMidGainRef.current.gain.value = 1.1 + (i * 0.2);   // 1.1 → 1.3
        multibandHighGainRef.current.gain.value = 1.25 + (i * 0.3); // 1.25 → 1.55
      } else {
        multibandLowGainRef.current.gain.value = 1.3;
        multibandMidGainRef.current.gain.value = 1.1;
        multibandHighGainRef.current.gain.value = 1.25;
      }
    }

    // ══════════════════════════════════════════════════════
    // LAYER 2: STEREO FIELD
    // DIV narrows (intimate), IMM widens (open)
    // ══════════════════════════════════════════════════════
    if (stereoDelayRef.current) {
      if (v < 0) {
        stereoDelayRef.current.delayTime.value = 0.015 - (i * 0.012); // 15ms → 3ms (intimate)
      } else if (v > 0) {
        stereoDelayRef.current.delayTime.value = 0.015 + (i * 0.015); // 15ms → 30ms (wide open)
      } else {
        stereoDelayRef.current.delayTime.value = 0.015; // VOYEX default
      }
    }

    // ══════════════════════════════════════════════════════
    // LAYER 3: SPATIAL EFFECTS
    // ══════════════════════════════════════════════════════
    if (v === 0) {
      // Center = clean VOYEX baseline, spatial bypass
      crossfeedLeftGainRef.current && (crossfeedLeftGainRef.current.gain.value = 0);
      crossfeedRightGainRef.current && (crossfeedRightGainRef.current.gain.value = 0);
      panDepthGainRef.current && (panDepthGainRef.current.gain.value = 0);
      haasDelayRef.current && (haasDelayRef.current.delayTime.value = 0);
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000);
      diveReverbWetRef.current && (diveReverbWetRef.current.gain.value = 0);
      immerseReverbWetRef.current && (immerseReverbWetRef.current.gain.value = 0);
      subHarmonicGainRef.current && (subHarmonicGainRef.current.gain.value = 0);
      applyMasterGain(); // Restore baseline with volume
      devLog('🎛️ [VOYO] INTENSITY: CENTER (baseline)');
      return;
    }

    if (v < 0) {
      // ── DIVE: swallowed by sound ──
      // Full crossfeed blend, dark lush reverb, physical sub-bass, warm rolloff
      crossfeedLeftGainRef.current && (crossfeedLeftGainRef.current.gain.value = i * 0.45);
      crossfeedRightGainRef.current && (crossfeedRightGainRef.current.gain.value = i * 0.45);
      // Low-pass: 20kHz → 7kHz (warm dark, vocals still clear)
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000 - (i * 13000));
      // Dark convolver reverb (natural room, not metallic)
      diveReverbWetRef.current && (diveReverbWetRef.current.gain.value = i * 0.38);
      immerseReverbWetRef.current && (immerseReverbWetRef.current.gain.value = 0);
      // Physical sub-bass weight
      subHarmonicGainRef.current && (subHarmonicGainRef.current.gain.value = i * 0.25);
      // IMMERSE spatial off
      panDepthGainRef.current && (panDepthGainRef.current.gain.value = 0);
      haasDelayRef.current && (haasDelayRef.current.delayTime.value = 0);
      applyMasterGain(); // Factors in compensation + volume
      devLog(`🎛️ [VOYO] DIVE ${Math.round(i * 100)}%`);
    } else {
      // ── IMMERSE: music all around you ──
      // 0-80%: crisp, wide, present. 80-100%: surround opens up.
      // Continuous curve — no discontinuity, no clicks.

      let panDepth: number;
      let haas: number;
      if (i <= 0.8) {
        panDepth = i * 0.3125;            // 0 → 0.25 (gentle movement from ~30%)
        haas = i * 0.003;                 // 0 → 2.4ms
      } else {
        // Surround zone — smooth ramp, same value at boundary
        const s = (i - 0.8) / 0.2;       // 0→1 in last 20%
        panDepth = 0.25 + (s * 0.15);     // 0.25 → 0.40
        haas = 0.0024 + (s * 0.002);      // 2.4ms → 4.4ms
      }

      panDepthGainRef.current && (panDepthGainRef.current.gain.value = panDepth);
      haasDelayRef.current && (haasDelayRef.current.delayTime.value = haas);
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000);
      // Bright convolver reverb (airy, expansive)
      immerseReverbWetRef.current && (immerseReverbWetRef.current.gain.value = i * 0.30);
      diveReverbWetRef.current && (diveReverbWetRef.current.gain.value = 0);
      // Bass presence
      subHarmonicGainRef.current && (subHarmonicGainRef.current.gain.value = i * 0.15);
      // DIVE off
      crossfeedLeftGainRef.current && (crossfeedLeftGainRef.current.gain.value = 0);
      crossfeedRightGainRef.current && (crossfeedRightGainRef.current.gain.value = 0);
      applyMasterGain(); // Factors in compensation + volume
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

      // STOP old audio immediately before loading new track
      // NOTE: Do NOT set src = '' — this can break MediaElementAudioSourceNode in some browsers.
      // The source node stays wired through src changes automatically (Web Audio API design).
      // FIX: Clear dangling event handlers from previous loadTrack calls to prevent
      // old callbacks from firing and interfering with the new track load.
      if (audioRef.current) {
        audioRef.current.oncanplaythrough = null;
        audioRef.current.oncanplay = null;
        audioRef.current.onplay = null;
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
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
      hasTriggeredPreloadRef.current = false; // Reset preload trigger for new track
      isEdgeStreamRef.current = false; // Reset edge stream flag for new track
      hasTriggered75PercentKeptRef.current = false; // Reset 75% kept trigger for new track
      hasTriggered30sListenRef.current = false; // Reset 30s listen flag for new track

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
            audioRef.current.volume = 0;
            audioRef.current.src = preloaded.url;
            audioRef.current.load();

            // Since we preloaded, audio should be ready almost instantly
            audioRef.current.oncanplaythrough = () => {
              if (!audioRef.current) return;

              const { isPlaying: shouldPlay } = usePlayerStore.getState();
              if (shouldPlay && audioRef.current.paused) {
                audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume();
                audioRef.current.play().then(() => {
                  audioRef.current!.volume = 1.0;
                  recordPlayEvent();
                  devLog('🔮 [VOYO] Preloaded playback started!');
                }).catch(e => devWarn('🎵 [Playback] Preloaded play failed:', e.name));
              } else {
                // FIX: Restore volume even when paused so play/pause effect doesn't play silence
                audioRef.current.volume = 1.0;
              }
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
          audioRef.current.volume = 0;
          audioRef.current.src = cachedUrl;
          audioRef.current.load();

          audioRef.current.oncanplaythrough = () => {
            if (!audioRef.current) return;

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
              audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume();
              audioRef.current.play().then(() => {
                if (shouldAutoResume) {
                  fadeInVolume(1200); // Smooth fade-in on session resume
                } else {
                  audioRef.current!.volume = 1.0;
                }
                recordPlayEvent();
                // Update store to reflect playing state if we auto-resumed
                if (shouldAutoResume && !shouldPlay) {
                  usePlayerStore.getState().togglePlay();
                }
                devLog('🎵 [VOYO] Playback started (cached)');
              }).catch(e => devWarn('🎵 [Playback] Cached play failed:', e.name));
            } else {
              // FIX: Restore volume even when paused so play/pause effect doesn't play silence
              audioRef.current.volume = 1.0;
            }
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
            audioRef.current.volume = 0;
            audioRef.current.src = r2Result.url;
            audioRef.current.load();

            audioRef.current.oncanplaythrough = () => {
              if (!audioRef.current) return;

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
                audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume();
                audioRef.current.play().then(() => {
                  if (shouldAutoResume) {
                    fadeInVolume(1200); // Smooth fade-in on session resume
                  } else {
                    audioRef.current!.volume = 1.0;
                  }
                  recordPlayEvent();
                  // Update store to reflect playing state if we auto-resumed
                  if (shouldAutoResume && !shouldPlay) {
                    usePlayerStore.getState().togglePlay();
                  }
                  devLog('🎵 [VOYO] Playback started (R2)');
                }).catch(e => devWarn('🎵 [Playback] R2 play failed:', e.name));
              } else {
                // FIX: Restore volume even when paused so play/pause effect doesn't play silence
                audioRef.current.volume = 1.0;
              }
            };
          }
        } else {
          // 📡 R2 MISS - Get direct YouTube URL, stream via browser
          // Browser fetches from YouTube CDN directly (no CORS issues with audio element)
          devLog('🎵 [VOYO] R2 miss, getting stream URL...');

          try {
            // Get the direct YouTube audio URL from our worker.
            // Use AbortSignal.timeout so a slow Edge Worker doesn't hang forever
            // (the same fix we made in preloadManager.ts in v0.2.x).
            const streamResponse = await fetch(
              `${EDGE_WORKER_URL}/stream?v=${trackId}`,
              { signal: AbortSignal.timeout(5000) },
            );
            if (isStale()) { devLog(`[AudioPlayer] cancelled stale load for ${trackId} after stream fetch`); return; }
            const streamData = await streamResponse.json();
            if (isStale()) { devLog(`[AudioPlayer] cancelled stale load for ${trackId} after stream json`); return; }

            if (!streamData.url) {
              console.error('🚨 [VOYO] No stream URL available');
              return;
            }

            devLog(`🎵 [VOYO] Got stream URL (${streamData.bitrate}bps ${streamData.mimeType})`);
            isEdgeStreamRef.current = true; // Mark as streaming (not from IndexedDB)
            setPlaybackSource('cached'); // Treat as cached for EQ purposes

            const { boostProfile: profile } = usePlayerStore.getState();
            setupAudioEnhancement(profile);

            if (audioRef.current) {
              audioRef.current.volume = 0;
              audioRef.current.src = streamData.url; // Browser fetches directly from YouTube CDN
              audioRef.current.load();

              audioRef.current.oncanplaythrough = () => {
                if (!audioRef.current) return;

                if (isInitialLoadRef.current && savedCurrentTime > 5) {
                  audioRef.current.currentTime = savedCurrentTime;
                  isInitialLoadRef.current = false;
                }

                const { isPlaying: shouldPlay } = usePlayerStore.getState();
                const shouldAutoResume = shouldAutoResumeRef.current;
                if (shouldAutoResume) {
                  shouldAutoResumeRef.current = false;
                }

                if ((shouldPlay || shouldAutoResume) && audioRef.current.paused) {
                  audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume();
                  audioRef.current.play().then(() => {
                    if (shouldAutoResume) {
                      fadeInVolume(1200); // Smooth fade-in on session resume
                    } else {
                      audioRef.current!.volume = 1.0;
                    }
                    recordPlayEvent();
                    if (shouldAutoResume && !shouldPlay) {
                      usePlayerStore.getState().togglePlay();
                    }
                    devLog('🎵 [VOYO] Playback started (YouTube direct stream)');
                  }).catch(e => devWarn('🎵 [Playback] Stream play failed:', e.name));
                } else {
                  // FIX: Restore volume even when paused so play/pause effect doesn't play silence
                  audioRef.current.volume = 1.0;
                }
              };

              // BACKGROUND: Download to cache ASAP after playback starts (non-blocking)
              // 3s delay = start caching almost immediately so local fallback is ready fast
              // This prevents stream URL expiration from causing skips/stuttering
              audioRef.current.onplay = () => {
                setTimeout(() => {
                  const currentState = usePlayerStore.getState();
                  if (currentState.currentTrack?.trackId === trackId && currentState.isPlaying) {
                    devLog('🎵 [VOYO] Starting aggressive background cache for streaming track');
                    cacheTrack(
                      trackId,
                      currentTrack.title,
                      currentTrack.artist,
                      currentTrack.duration || 0,
                      `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${trackId}?quality=high`
                    );
                  }
                }, 3000);
              };
            }
          } catch (streamError) {
            console.error('🚨 [VOYO] Stream error:', streamError);
          }
        }
      }
    };

    loadTrack();

    return () => {
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
    recordPoolEngagement(currentTrack.trackId, 'play');
    useTrackPoolStore.getState().recordPlay(currentTrack.trackId);
    recordTrackInSession(currentTrack, 0, false, false);
    djRecordPlay(currentTrack, false, false);
    oyoOnTrackPlay(currentTrack, previousTrackRef.current || undefined);
    viRegisterPlay(currentTrack.trackId, currentTrack.title, currentTrack.artist, 'user_play');
    previousTrackRef.current = currentTrack;
    devLog(`[VOYO] Recorded play: ${currentTrack.title}`);
  }, [currentTrack]);

  // === HOT-SWAP: When boost completes mid-stream (R2 → cached upgrade) ===
  // CRITICAL: Uses AbortController to prevent race conditions when track changes mid-swap
  useEffect(() => {
    if (!lastBoostCompletion || !currentTrack?.trackId) return;

    const completedId = lastBoostCompletion.trackId;
    const currentId = currentTrack.trackId.replace('VOYO_', '');
    const isCurrentTrackMatch = completedId === currentId || completedId === currentTrack.trackId;

    // Hot-swap if currently streaming via R2 or Edge Worker stream AND boost is for current track
    // This upgrades from R2 (potentially low quality) or expiring stream URL to local cached (high quality)
    if (!isCurrentTrackMatch) return;
    if (playbackSource !== 'r2' && !(playbackSource === 'cached' && isEdgeStreamRef.current)) return;

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

      // FIX: Clear dangling handlers before hot-swap to prevent old callbacks interfering
      audioRef.current.oncanplaythrough = null;
      audioRef.current.oncanplay = null;
      audioRef.current.volume = 0;
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
          audioContextRef.current?.state === 'suspended' && audioContextRef.current.resume();
          audioRef.current.play().then(() => {
            // NOW switch to cached mode - audio is playing from local cache
            isEdgeStreamRef.current = false; // No longer streaming from edge
            setPlaybackSource('cached');
            audioRef.current!.volume = 1.0;
            devLog('🔄 [VOYO] Hot-swap complete! Now playing boosted audio');
          }).catch((err) => {
            // Play failed - don't switch source, keep iframe playing
            devLog('[VOYO] Hot-swap play failed, keeping iframe:', err);
          });
        } else if (!shouldPlayNow) {
          // Paused state - switch source but don't play
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
  }, [lastBoostCompletion, currentTrack?.trackId, playbackSource, isPlaying, checkCache, setPlaybackSource, setupAudioEnhancement]);

  // Handle play/pause (only when using audio element: cached or r2)
  // Also suspend AudioContext when paused to save battery
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;

    const audio = audioRef.current;
    if (isPlaying && audio.paused && audio.src && audio.readyState >= 1) {
      // FIX: Restore volume before playing — it may be stuck at 0 from the loading phase
      // (loadTrack sets volume=0 during load, and if shouldPlay was false when oncanplaythrough fired,
      // volume was never restored. Now we fix it here when user presses play.)
      if (audioEnhancedRef.current && gainNodeRef.current) {
        audio.volume = 1.0; // Web Audio chain controls actual volume via gainNode
        applyMasterGain();
      } else {
        audio.volume = volume / 100;
      }
      // Resume AudioContext if suspended, then play
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      audio.play().catch(e => devWarn('🎵 [Playback] Resume play failed:', e.name));
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying, playbackSource]);

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
          audioContextRef.current?.suspend();
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
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;

    if (audioEnhancedRef.current && gainNodeRef.current) {
      audioRef.current.volume = 1.0;
      applyMasterGain(); // Unified: preset × spatial compensation × volume
    } else {
      audioRef.current.volume = volume / 100;
    }
  }, [volume, playbackSource]);

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
  useEffect(() => {
    if ((playbackSource === 'cached' || playbackSource === 'r2') && audioEnhancedRef.current) {
      updateBoostPreset(boostProfile as BoostPreset);
    }
  }, [boostProfile, playbackSource, updateBoostPreset]);

  // VOYEX Spatial slider: apply when slider changes or preset changes
  useEffect(() => {
    if ((playbackSource === 'cached' || playbackSource === 'r2') && spatialEnhancedRef.current) {
      if (boostProfile === 'voyex') {
        updateVoyexSpatial(voyexSpatial);
      } else {
        // Not VOYEX - mute spatial (true bypass)
        updateVoyexSpatial(0);
      }
    }
  }, [voyexSpatial, boostProfile, playbackSource, updateVoyexSpatial]);

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
            // FIX: Clear dangling handlers before emergency swap
            audioRef.current.oncanplaythrough = null;
            audioRef.current.oncanplay = null;
            audioRef.current.src = cachedUrl;
            audioRef.current.load();
            audioRef.current.oncanplaythrough = () => {
              if (!audioRef.current) return;
              if (savedPos > 2) audioRef.current.currentTime = savedPos;
              isEdgeStreamRef.current = false;
              setPlaybackSource('cached');
              audioRef.current.volume = 1.0; // FIX: Ensure volume is restored
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

  // Media Session (only when using audio element: cached or r2)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack || (playbackSource !== 'cached' && playbackSource !== 'r2')) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: 'VOYO Music',
      artwork: [{ src: `https://voyo-edge.dash-webtv.workers.dev/cdn/art/${currentTrack.trackId}?quality=high`, sizes: '512x512', type: 'image/jpeg' }]
    });

    navigator.mediaSession.setActionHandler('play', () => !usePlayerStore.getState().isPlaying && togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => usePlayerStore.getState().isPlaying && togglePlay());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
    navigator.mediaSession.setActionHandler('previoustrack', () => usePlayerStore.getState().prevTrack());
    navigator.mediaSession.setActionHandler('seekto', (d) => d.seekTime !== undefined && audioRef.current && (audioRef.current.currentTime = d.seekTime));

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying, playbackSource, togglePlay, nextTrack]);

  // Audio element handlers (only active when using audio element: cached or r2)
  const handleTimeUpdate = useCallback(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.duration) return;
    const el = audioRef.current;
    const progress = (el.currentTime / el.duration) * 100;
    setCurrentTime(el.currentTime);
    setProgress(progress);
    trackProgressRef.current = progress;

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setPositionState({
          duration: el.duration, playbackRate: el.playbackRate, position: el.currentTime
        });
      } catch (e) {}
    }
  }, [playbackSource, setCurrentTime, setProgress]);

  const handleDurationChange = useCallback(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.duration) return;
    setDuration(audioRef.current.duration);
  }, [playbackSource, setDuration]);

  const handleEnded = useCallback(() => {
    if (playbackSource !== 'cached' && playbackSource !== 'r2') return;
    if (currentTrack) {
      endListenSession(audioRef.current?.currentTime || 0, 0);
      recordPoolEngagement(currentTrack.trackId, 'complete', { completionRate: trackProgressRef.current });
      useTrackPoolStore.getState().recordCompletion(currentTrack.trackId, trackProgressRef.current);
      oyoOnTrackComplete(currentTrack, audioRef.current?.currentTime || 0);
    }
    nextTrack();
  }, [playbackSource, currentTrack, nextTrack, endListenSession]);

  const handleProgress = useCallback(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current?.buffered.length) return;
    const health = audioEngine.getBufferHealth(audioRef.current);
    setBufferHealth(health.percentage, health.status);
  }, [playbackSource, setBufferHealth]);

  // ERROR HANDLER: Handle audio element errors with recovery (music never stops)
  // IMPROVED: Immediate cache check first (should be ready with 3s auto-cache),
  // seamless position-preserving swap, max 500ms silence target
  const handleAudioError = useCallback(async (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
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

    if (!currentTrack?.trackId || !error) return;

    const savedPos = usePlayerStore.getState().currentTime;

    // FIX: Clear dangling handlers before recovery to prevent old callbacks interfering
    if (audioRef.current) {
      audioRef.current.oncanplaythrough = null;
      audioRef.current.oncanplay = null;
    }

    // RECOVERY 1 (FASTEST): Check local cache IMMEDIATELY
    // With 3s auto-cache delay, cache should be ready for most tracks
    try {
      const cachedUrl = await checkCache(currentTrack.trackId);
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
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = false;
          setPlaybackSource('cached');
          audioRef.current.volume = 1.0; // FIX: Ensure volume is restored during recovery
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
      if (r2Result.exists && r2Result.url && audioRef.current) {
        audioRef.current.src = r2Result.url;
        audioRef.current.load();
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null;
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = false;
          setPlaybackSource('r2');
          audioRef.current.volume = 1.0; // FIX: Ensure volume is restored during recovery
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
      // Use AbortController with 5s timeout to keep recovery fast
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const streamResponse = await fetch(`${EDGE_WORKER_URL}/stream?v=${currentTrack.trackId}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const streamData = await streamResponse.json();
      if (streamData.url && audioRef.current) {
        audioRef.current.src = streamData.url;
        audioRef.current.load();
        audioRef.current.oncanplay = () => {
          if (!audioRef.current) return;
          audioRef.current.oncanplay = null;
          if (savedPos > 2) audioRef.current.currentTime = savedPos;
          isEdgeStreamRef.current = true;
          audioRef.current.volume = 1.0; // FIX: Ensure volume is restored during recovery
          audioRef.current.play().then(() => {
            const elapsed = performance.now() - recoveryStart;
            devLog(`🔄 [VOYO] Stream re-extract recovery complete in ${elapsed.toFixed(0)}ms`);
          }).catch(() => {});
        };
        return;
      }
    } catch {}

    // RECOVERY 4: Skip to next track (music never stops)
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

  return (
    <audio
      ref={audioRef}
      crossOrigin="anonymous"
      preload="auto"
      playsInline
      onTimeUpdate={handleTimeUpdate}
      onDurationChange={handleDurationChange}
      onEnded={handleEnded}
      onProgress={handleProgress}
      onError={handleAudioError}
      onPlaying={() => (playbackSource === 'cached' || playbackSource === 'r2') && setBufferHealth(100, 'healthy')}
      onWaiting={() => (playbackSource === 'cached' || playbackSource === 'r2') && setBufferHealth(50, 'warning')}
      onPause={() => {
        if (playbackSource !== 'cached' && playbackSource !== 'r2') return;
        const { isPlaying: shouldPlay } = usePlayerStore.getState();
        const audio = audioRef.current;
        if (!audio) return;
        // Don't resume if track ended (prevents brief replay before next track)
        const hasEnded = audio.duration > 0 && audio.currentTime >= audio.duration - 0.5;
        if (hasEnded) return;
        // Resume if should be playing (handles interruptions)
        if (shouldPlay && audio.src && audio.readyState >= 1) {
          // FIX: Ensure volume is restored before resuming (may be stuck at 0 from loading phase)
          if (audio.volume === 0) audio.volume = 1.0;
          audio.play().catch(e => devWarn('🎵 [Playback] Pause handler resume failed:', e.name));
        }
      }}
      style={{ display: 'none' }}
    />
  );
};

export default AudioPlayer;
