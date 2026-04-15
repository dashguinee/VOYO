/**
 * Audio Chain — the entire Web Audio graph + EQ/preset/spatial + gain
 * helpers, packaged into one hook.
 *
 * WHAT LIVES HERE:
 *   - AudioContext + MediaElementAudioSourceNode (via audioEngine singleton)
 *   - Full VOYO processing chain: high-pass → multiband splitter → per-band
 *     (EQ/comp/gain) → harmonic exciter → band merger → standard EQ
 *     (subBass/bass/warmth/presence/air) → stereo widen → master gain →
 *     final compressor → brickwall limiter → spatial layer (crossfeed,
 *     pan, Haas, dive/immerse reverb, sub-harmonic synth) → destination
 *   - 40+ node refs, all module-private
 *   - Preset switcher (off / boosted / calm / voyex)
 *   - Spatial slider (DIVE ↔ IMMERSE, -100 to +100)
 *   - Gain helpers: computeMasterTarget, applyMasterGain, muteMasterGainInstantly,
 *     fadeInMasterGain
 *   - Gain watchdog (rescues stuck-muted chain if canplaythrough hangs)
 *   - All internal change effects: volume, preset, spatial
 *   - Play/pause click-free fade effect (not loadTrack's fade — the user
 *     tap-play/pause one)
 *
 * WHAT IT EXPOSES TO AudioPlayer:
 *   - audioContextRef + gainNodeRef (needed by bgEngine for ctx.state reads
 *     and gain rescue)
 *   - setupAudioEnhancement (called from loadTrack canplay paths)
 *   - muteMasterGainInstantly + fadeInMasterGain (called from mediaSession
 *     seek, hotSwap, errorRecovery)
 *   - computeMasterTarget (called by bgEngine.gain_rescue)
 *   - armGainWatchdog + disarmGainWatchdog (called by loadTrack mute path)
 *
 * WHY IT'S ONE HOOK: the 40+ refs are tightly interconnected at setup time
 * (source → filter → filter → gain → comp → ... → destination). Moving
 * them individually would require passing dozens of refs through every
 * function. Encapsulating them in a hook lets each consumer call what it
 * needs without knowing the graph topology.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { connectAudioChain, getAnalyser } from '../../services/audioEngine';
import { usePlayerStore } from '../../store/playerStore';
import { devLog, devWarn } from '../../utils/logger';
import { BOOST_PRESETS, type BoostPreset } from './boostPresets';

export interface AudioChainApi {
  // Core refs exposed so bgEngine + other modules can read (but not write).
  audioContextRef: RefObject<AudioContext | null>;
  gainNodeRef: RefObject<GainNode | null>;

  // Control surface:
  setupAudioEnhancement: (preset?: BoostPreset) => void;
  computeMasterTarget: () => number;
  applyMasterGain: () => void;
  muteMasterGainInstantly: () => void;
  fadeInMasterGain: (durationMs?: number) => void;
  armGainWatchdog: (label: string, timeoutMs?: number) => void;
  disarmGainWatchdog: () => void;
}

interface UseAudioChainParams {
  audioRef: RefObject<HTMLAudioElement | null>;
  isLoadingTrackRef: RefObject<boolean>;
  volume: number;
  boostProfile: BoostPreset;
  voyexSpatial: number;
  isPlaying: boolean;
  playbackSource: string | null;
}

export function useAudioChain(params: UseAudioChainParams): AudioChainApi {
  const { audioRef, isLoadingTrackRef, volume, boostProfile, voyexSpatial, isPlaying, playbackSource } = params;

  // ── CHAIN REFS ───────────────────────────────────────────────────────
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
  const highPassFilterRef = useRef<BiquadFilterNode | null>(null);

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
  const multibandBypassDirectRef = useRef<GainNode | null>(null);
  const multibandBypassMbRef = useRef<GainNode | null>(null);

  const spatialBypassDirectRef = useRef<GainNode | null>(null);
  const spatialBypassMainRef = useRef<GainNode | null>(null);
  const spatialInputRef = useRef<GainNode | null>(null);
  const crossfeedLeftGainRef = useRef<GainNode | null>(null);
  const crossfeedRightGainRef = useRef<GainNode | null>(null);
  const panDepthGainRef = useRef<GainNode | null>(null);
  const diveLowPassRef = useRef<BiquadFilterNode | null>(null);
  const haasDelayRef = useRef<DelayNode | null>(null);
  const diveReverbWetRef = useRef<GainNode | null>(null);
  const immerseReverbWetRef = useRef<GainNode | null>(null);
  const subHarmonicGainRef = useRef<GainNode | null>(null);

  const audioEnhancedRef = useRef<boolean>(false);
  const spatialEnhancedRef = useRef<boolean>(false);
  const currentProfileRef = useRef<BoostPreset>('boosted');

  // Gain watchdog — setTimeout for FG, MC for BG. Both must be cancelable
  // (orphaned MCs accumulate across track loads otherwise).
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogMcRef = useRef<MessageChannel | null>(null);

  // Harmonic-curve cache — 44100-sample waveshaper curves are expensive to
  // regenerate. Cache by amount (rounded to 0.01) so preset switches reuse.
  const harmonicCurveCacheRef = useRef<Map<number, Float32Array>>(new Map());
  const makeHarmonicCurve = (amount: number): Float32Array<ArrayBuffer> => {
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

  // ── COMPUTE MASTER TARGET ────────────────────────────────────────────
  // Pure getter: preset gain × spatial compensation × volume. Used by
  // applyMasterGain and the track-load fade helpers.
  const computeMasterTarget = useCallback(() => {
    const preset = currentProfileRef.current;
    const baseGain = preset === 'off' ? 1.0 : BOOST_PRESETS[preset].gain;
    const vol = usePlayerStore.getState().volume / 100;
    let comp = 1;
    if (preset === 'voyex') {
      const { voyexSpatial: vs } = usePlayerStore.getState();
      const si = Math.abs(vs) / 100;
      if (vs < 0 && si > 0) comp = 1 - si * 0.18;
      else if (vs > 0 && si > 0) comp = 1 - si * 0.12;
    }
    return baseGain * comp * vol;
  }, []);

  // ── APPLY MASTER GAIN ────────────────────────────────────────────────
  // Called from preset/spatial/volume effects. 25ms ramp — felt-instant.
  const applyMasterGain = useCallback(() => {
    if (!gainNodeRef.current) return;
    // Skip during track load: loadTrack's fadeInMasterGain owns the ramp.
    // Fighting with it here produces a speaker pop on every track change.
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
  }, [computeMasterTarget, isLoadingTrackRef]);

  // ── GAIN WATCHDOG ────────────────────────────────────────────────────
  // If canplaythrough hangs, masterGain stays muted at 0.0001 while audio
  // plays — the "muffled" symptom. Watchdog force-fades after 6s.
  const rescueGain = useCallback((label: string) => {
    if (!audioRef.current || !gainNodeRef.current || !audioContextRef.current) return;
    if (audioRef.current.paused) return;
    const param = gainNodeRef.current.gain;
    if (param.value > 0.01) return;
    devWarn(`🩹 [AudioChain] watchdog rescue (${label})`);
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended' || (ctx as any).state === 'interrupted') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const target = computeMasterTarget();
    param.cancelScheduledValues(now);
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(target, now + 0.2);
  }, [audioRef, computeMasterTarget]);

  const armGainWatchdog = useCallback((label: string, timeoutMs: number = 6000) => {
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    if (watchdogMcRef.current) {
      try { watchdogMcRef.current.port1.close(); } catch {}
      watchdogMcRef.current = null;
    }
    watchdogTimerRef.current = setTimeout(() => {
      watchdogTimerRef.current = null;
      rescueGain(label);
    }, timeoutMs);
    // BG: setTimeout throttled 1/min. MC-based backup at 3s (wall-clock
    // via Date.now() — iteration-count was the v188 cascade bug).
    if (document.hidden) {
      const startMs = Date.now();
      const mc = new MessageChannel();
      watchdogMcRef.current = mc;
      mc.port1.onmessage = () => {
        if (watchdogMcRef.current !== mc) { try { mc.port1.close(); } catch {} return; }
        if (Date.now() - startMs < 3000) { mc.port2.postMessage(null); return; }
        try { mc.port1.close(); } catch {}
        watchdogMcRef.current = null;
        rescueGain(`${label}-bg`);
      };
      mc.port2.postMessage(null);
    }
  }, [rescueGain]);

  const disarmGainWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    if (watchdogMcRef.current) {
      try { watchdogMcRef.current.port1.close(); } catch {}
      watchdogMcRef.current = null;
    }
  }, []);

  // ── MUTE & FADE-IN HELPERS ───────────────────────────────────────────
  // 8ms fade-out before a src swap — click-free via Web Audio gain ramp
  // (not audio.volume which is a digital jump that leaks as a click).
  const muteMasterGainInstantly = useCallback(() => {
    if (!gainNodeRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const now = ctx.currentTime;
    const param = gainNodeRef.current.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(0.0001, now + 0.008);
    armGainWatchdog('mute-before-load');
  }, [armGainWatchdog]);

  // 3ms micro-ramp from near-silence to target. Called after .play() on a
  // fresh track. Context.resume() first — on cold start the context may
  // still be suspended, and scheduling a ramp against a frozen clock puts
  // the end time in the past (ramp "completes" instantly = gain jump).
  const fadeInMasterGain = useCallback((_durationMs: number = 80) => {
    disarmGainWatchdog();
    isLoadingTrackRef.current = false;
    if (!gainNodeRef.current || !audioContextRef.current) return;
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended' || (ctx as any).state === 'interrupted') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const param = gainNodeRef.current.gain;
    const target = computeMasterTarget();
    param.cancelScheduledValues(now);
    param.setValueAtTime(0.0001, now);
    param.linearRampToValueAtTime(target, now + 0.003);
  }, [computeMasterTarget, disarmGainWatchdog, isLoadingTrackRef]);

  // ── UPDATE BOOST PRESET ──────────────────────────────────────────────
  // Click-free switch: cancelScheduledValues → setValueAtTime anchor →
  // linearRampToValueAtTime. Multiband vs direct-path crossfade.
  const updateBoostPreset = useCallback((preset: BoostPreset) => {
    if (!audioEnhancedRef.current) return;
    currentProfileRef.current = preset;

    const ctx = audioContextRef.current;
    const now = ctx ? ctx.currentTime : 0;
    const RAMP_MS = 25;
    const RAMP_EPSILON = 0.0005;
    const ramp = (param: AudioParam | undefined | null, value: number) => {
      if (!param || !ctx) return;
      if (Math.abs(param.value - value) < RAMP_EPSILON) return;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + RAMP_MS / 1000);
    };

    const setMultibandTransparent = () => {
      ramp(multibandLowGainRef.current?.gain, 1.0);
      ramp(multibandMidGainRef.current?.gain, 1.0);
      ramp(multibandHighGainRef.current?.gain, 1.0);
      if (multibandLowCompRef.current)  { ramp(multibandLowCompRef.current.threshold,  0); ramp(multibandLowCompRef.current.ratio,  1); }
      if (multibandMidCompRef.current)  { ramp(multibandMidCompRef.current.threshold,  0); ramp(multibandMidCompRef.current.ratio,  1); }
      if (multibandHighCompRef.current) { ramp(multibandHighCompRef.current.threshold, 0); ramp(multibandHighCompRef.current.ratio, 1); }
    };
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

    if (preset === 'off') {
      useDirectPath();
      setMultibandTransparent();
      setStandardEqNeutral();
      if (harmonicExciterRef.current) { harmonicExciterRef.current.curve = null; harmonicExciterRef.current.oversample = 'none'; }
      if (compressorRef.current) { ramp(compressorRef.current.threshold, 0); ramp(compressorRef.current.ratio, 1); }
      ramp(stereoDelayRef.current?.delayTime, 0);
      applyMasterGain();
      return;
    }

    const s = BOOST_PRESETS[preset] as any;

    if (s.multiband) {
      useMultibandPath();
      ramp(multibandLowGainRef.current?.gain, s.low.gain);
      ramp(multibandMidGainRef.current?.gain, s.mid.gain);
      ramp(multibandHighGainRef.current?.gain, s.high.gain);
      if (multibandLowCompRef.current)  { ramp(multibandLowCompRef.current.threshold,  s.low.threshold);  ramp(multibandLowCompRef.current.ratio,  s.low.ratio); }
      if (multibandMidCompRef.current)  { ramp(multibandMidCompRef.current.threshold,  s.mid.threshold);  ramp(multibandMidCompRef.current.ratio,  s.mid.ratio); }
      if (multibandHighCompRef.current) { ramp(multibandHighCompRef.current.threshold, s.high.threshold); ramp(multibandHighCompRef.current.ratio, s.high.ratio); }
      if (harmonicExciterRef.current) {
        const applyCurve = s.harmonicAmount > 0;
        harmonicExciterRef.current.curve = applyCurve ? makeHarmonicCurve(s.harmonicAmount) : null;
        harmonicExciterRef.current.oversample = applyCurve ? '2x' : 'none';
      }
      setStandardEqNeutral();
      if (compressorRef.current) { ramp(compressorRef.current.threshold, 0); ramp(compressorRef.current.ratio, 1); }
      ramp(stereoDelayRef.current?.delayTime, s.stereoWidth || 0);
    } else {
      useDirectPath();
      setMultibandTransparent();
      if (harmonicExciterRef.current) {
        const applyCurve = s.harmonicAmount > 0;
        harmonicExciterRef.current.curve = applyCurve ? makeHarmonicCurve(s.harmonicAmount) : null;
        harmonicExciterRef.current.oversample = applyCurve ? '2x' : 'none';
      }
      subBassFilterRef.current && (subBassFilterRef.current.frequency.value = s.subBassFreq); ramp(subBassFilterRef.current?.gain, s.subBassGain);
      bassFilterRef.current && (bassFilterRef.current.frequency.value = s.bassFreq); ramp(bassFilterRef.current?.gain, s.bassGain);
      warmthFilterRef.current && (warmthFilterRef.current.frequency.value = s.warmthFreq); ramp(warmthFilterRef.current?.gain, s.warmthGain);
      presenceFilterRef.current && (presenceFilterRef.current.frequency.value = s.presenceFreq); ramp(presenceFilterRef.current?.gain, s.presenceGain);
      airFilterRef.current && (airFilterRef.current.frequency.value = s.airFreq); ramp(airFilterRef.current?.gain, s.airGain);
      if (compressorRef.current) {
        ramp(compressorRef.current.threshold, s.compressor.threshold);
        ramp(compressorRef.current.ratio, s.compressor.ratio);
        compressorRef.current.knee.value = s.compressor.knee;
        compressorRef.current.attack.value = s.compressor.attack;
        compressorRef.current.release.value = s.compressor.release;
      }
      ramp(stereoDelayRef.current?.delayTime, s.stereoWidth || 0);
    }

    applyMasterGain();
    devLog(`🎵 [AudioChain] preset → ${preset}`);
  }, [applyMasterGain]);

  // ── UPDATE VOYEX SPATIAL ────────────────────────────────────────────
  // Slider -100..+100: DIVE (negative) ↔ IMMERSE (positive). 3 layers:
  // multiband mastering character, stereo field width, spatial effects.
  const updateVoyexSpatial = useCallback((value: number) => {
    if (!spatialEnhancedRef.current) return;
    const v = Math.max(-100, Math.min(100, value));
    const i = Math.abs(v) / 100;

    const ctx = audioContextRef.current;
    const now = ctx ? ctx.currentTime : 0;
    const RAMP_MS = 25;
    const RAMP_EPSILON = 0.0005;
    const ramp = (param: AudioParam | undefined | null, value: number) => {
      if (!param || !ctx) return;
      if (Math.abs(param.value - value) < RAMP_EPSILON) return;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + RAMP_MS / 1000);
    };

    // Layer 1: multiband mastering character
    if (v < 0) {
      ramp(multibandLowGainRef.current?.gain,  1.3 + (i * 0.35));
      ramp(multibandMidGainRef.current?.gain,  1.1 - (i * 0.05));
      ramp(multibandHighGainRef.current?.gain, 1.25 - (i * 0.3));
    } else if (v > 0) {
      ramp(multibandLowGainRef.current?.gain,  1.3);
      ramp(multibandMidGainRef.current?.gain,  1.1 + (i * 0.2));
      ramp(multibandHighGainRef.current?.gain, 1.25 + (i * 0.3));
    } else {
      ramp(multibandLowGainRef.current?.gain,  1.3);
      ramp(multibandMidGainRef.current?.gain,  1.1);
      ramp(multibandHighGainRef.current?.gain, 1.25);
    }

    // Layer 2: stereo field
    if (v < 0)      ramp(stereoDelayRef.current?.delayTime, 0.015 - (i * 0.012));
    else if (v > 0) ramp(stereoDelayRef.current?.delayTime, 0.015 + (i * 0.015));
    else            ramp(stereoDelayRef.current?.delayTime, 0.015);

    // Layer 3: spatial effects
    if (v === 0) {
      ramp(crossfeedLeftGainRef.current?.gain, 0);
      ramp(crossfeedRightGainRef.current?.gain, 0);
      ramp(panDepthGainRef.current?.gain, 0);
      ramp(haasDelayRef.current?.delayTime, 0);
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000);
      ramp(diveReverbWetRef.current?.gain, 0);
      ramp(immerseReverbWetRef.current?.gain, 0);
      ramp(subHarmonicGainRef.current?.gain, 0);
      applyMasterGain();
      return;
    }

    if (v < 0) {
      // DIVE
      ramp(crossfeedLeftGainRef.current?.gain, i * 0.45);
      ramp(crossfeedRightGainRef.current?.gain, i * 0.45);
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000 - (i * 13000));
      ramp(diveReverbWetRef.current?.gain, i * 0.38);
      ramp(immerseReverbWetRef.current?.gain, 0);
      ramp(subHarmonicGainRef.current?.gain, i * 0.25);
      ramp(panDepthGainRef.current?.gain, 0);
      ramp(haasDelayRef.current?.delayTime, 0);
      applyMasterGain();
    } else {
      // IMMERSE
      let panDepth: number, haas: number;
      if (i <= 0.8) { panDepth = i * 0.3125; haas = i * 0.003; }
      else          { const s = (i - 0.8) / 0.2; panDepth = 0.25 + (s * 0.15); haas = 0.0024 + (s * 0.002); }
      ramp(panDepthGainRef.current?.gain, panDepth);
      ramp(haasDelayRef.current?.delayTime, haas);
      diveLowPassRef.current && (diveLowPassRef.current.frequency.value = 20000);
      ramp(immerseReverbWetRef.current?.gain, i * 0.30);
      ramp(diveReverbWetRef.current?.gain, 0);
      ramp(subHarmonicGainRef.current?.gain, i * 0.15);
      ramp(crossfeedLeftGainRef.current?.gain, 0);
      ramp(crossfeedRightGainRef.current?.gain, 0);
      applyMasterGain();
    }
  }, [applyMasterGain]);

  // ── SETUP AUDIO ENHANCEMENT ──────────────────────────────────────────
  // Builds the full chain on first call. Singleton via connectAudioChain.
  // Safe to call multiple times — audioEnhancedRef guards re-entry.
  const setupAudioEnhancement = useCallback((preset: BoostPreset = 'boosted') => {
    if (!audioRef.current || audioEnhancedRef.current) return;
    try {
      const chain = connectAudioChain(audioRef.current);
      if (!chain) return;
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

      // Spatial layer (created once, shared by all presets).
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

      const diveLP = ctx.createBiquadFilter(); diveLP.type = 'lowpass'; diveLP.frequency.value = 20000; diveLP.Q.value = 0.7;
      diveLowPassRef.current = diveLP;
      spInput.connect(diveLP);
      diveLP.connect(cfSplitter);
      cfSplitter.connect(cfMerger, 0, 0); cfSplitter.connect(cfMerger, 1, 1);
      cfSplitter.connect(cfLD, 0); cfLD.connect(cfLF); cfLF.connect(cfLG); cfLG.connect(cfMerger, 0, 1);
      cfSplitter.connect(cfRD, 1); cfRD.connect(cfRF); cfRF.connect(cfRG); cfRG.connect(cfMerger, 0, 0);

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

      // Spatial bypass (parallel direct path; phase-distortion fix)
      const spatialBypassDirect = ctx.createGain(); spatialBypassDirect.gain.value = 1;
      const spatialBypassMain = ctx.createGain(); spatialBypassMain.gain.value = 0;
      spatialBypassDirectRef.current = spatialBypassDirect;
      spatialBypassMainRef.current = spatialBypassMain;
      spInput.connect(spatialBypassDirect); spatialBypassDirect.connect(ctx.destination);
      hM.connect(spatialBypassMain); spatialBypassMain.connect(ctx.destination);

      // Heavy VOYEX spatial nodes — deferred to idle. ~352K math ops +
      // 44100 Math.tanh calls would block the audio thread for 50-200ms
      // right at first-track startup ("fresh start glitch"). Building
      // during requestIdleCallback lets the first track come up clean.
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
        const diveConv = ctx.createConvolver();
        diveConv.buffer = generateIR(2.5, 2.0, 1800);
        const diveWet = ctx.createGain(); diveWet.gain.value = 0;
        diveReverbWetRef.current = diveWet;
        spInput.connect(diveConv); diveConv.connect(diveWet); diveWet.connect(ctx.destination);

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
      };
      const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
      if (typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(buildVoyexSpatialNodes, { timeout: 4000 });
      } else {
        setTimeout(buildVoyexSpatialNodes, 1500);
      }

      spatialEnhancedRef.current = true;

      if (preset === 'off') {
        source.connect(spInput);
        audioEnhancedRef.current = true;
        return;
      }

      // Main chain: source → highPass → [multiband | direct] → standard EQ →
      // stereo widen → master → comp → limiter → spatial → destination.
      const highPass = ctx.createBiquadFilter();
      highPass.type = 'highpass'; highPass.frequency.value = 25; highPass.Q.value = 0.7;
      highPassFilterRef.current = highPass;

      const LR_Q = 0.707;
      const lowF1 = ctx.createBiquadFilter(); lowF1.type = 'lowpass';  lowF1.frequency.value = 180;  lowF1.Q.value = LR_Q;
      const lowF2 = ctx.createBiquadFilter(); lowF2.type = 'lowpass';  lowF2.frequency.value = 180;  lowF2.Q.value = LR_Q;
      multibandLowFilterRef.current = lowF1;
      const midHP1 = ctx.createBiquadFilter(); midHP1.type = 'highpass'; midHP1.frequency.value = 180;  midHP1.Q.value = LR_Q;
      const midHP2 = ctx.createBiquadFilter(); midHP2.type = 'highpass'; midHP2.frequency.value = 180;  midHP2.Q.value = LR_Q;
      const midLP1 = ctx.createBiquadFilter(); midLP1.type = 'lowpass';  midLP1.frequency.value = 4500; midLP1.Q.value = LR_Q;
      const midLP2 = ctx.createBiquadFilter(); midLP2.type = 'lowpass';  midLP2.frequency.value = 4500; midLP2.Q.value = LR_Q;
      multibandMidLowFilterRef.current = midHP1; multibandMidHighFilterRef.current = midLP1;
      const highF1 = ctx.createBiquadFilter(); highF1.type = 'highpass'; highF1.frequency.value = 4500; highF1.Q.value = LR_Q;
      const highF2 = ctx.createBiquadFilter(); highF2.type = 'highpass'; highF2.frequency.value = 4500; highF2.Q.value = LR_Q;
      multibandHighFilterRef.current = highF1;

      const lowGain = ctx.createGain();  lowGain.gain.value = 1.0;
      const midGain = ctx.createGain();  midGain.gain.value = 1.0;
      const highGain = ctx.createGain(); highGain.gain.value = 1.0;
      multibandLowGainRef.current = lowGain; multibandMidGainRef.current = midGain; multibandHighGainRef.current = highGain;

      const lowComp = ctx.createDynamicsCompressor();
      lowComp.threshold.value = 0; lowComp.knee.value = 6; lowComp.ratio.value = 1; lowComp.attack.value = 0.01; lowComp.release.value = 0.15;
      multibandLowCompRef.current = lowComp;
      const midComp = ctx.createDynamicsCompressor();
      midComp.threshold.value = 0; midComp.knee.value = 10; midComp.ratio.value = 1; midComp.attack.value = 0.02; midComp.release.value = 0.25;
      multibandMidCompRef.current = midComp;
      const highComp = ctx.createDynamicsCompressor();
      highComp.threshold.value = 0; highComp.knee.value = 8; highComp.ratio.value = 1; highComp.attack.value = 0.005; highComp.release.value = 0.1;
      multibandHighCompRef.current = highComp;

      const harmonic = ctx.createWaveShaper(); harmonic.oversample = 'none';
      harmonicExciterRef.current = harmonic;
      const exciterBypass = ctx.createGain(); exciterBypass.gain.value = 1.0;
      const bandMerger = ctx.createGain(); bandMerger.gain.value = 1.0;

      const multibandBypassDirect = ctx.createGain(); multibandBypassDirect.gain.value = 1;
      const multibandBypassMb = ctx.createGain();     multibandBypassMb.gain.value = 0;
      const multibandMix = ctx.createGain();          multibandMix.gain.value = 1;
      multibandBypassDirectRef.current = multibandBypassDirect;
      multibandBypassMbRef.current = multibandBypassMb;

      source.connect(highPass);
      highPass.connect(multibandBypassDirect); multibandBypassDirect.connect(multibandMix);
      highPass.connect(lowF1); lowF1.connect(lowF2); lowF2.connect(lowGain); lowGain.connect(lowComp); lowComp.connect(harmonic);
      highPass.connect(midHP1); midHP1.connect(midHP2); midHP2.connect(midLP1); midLP1.connect(midLP2); midLP2.connect(midGain); midGain.connect(midComp); midComp.connect(harmonic);
      highPass.connect(highF1); highF1.connect(highF2); highF2.connect(highGain); highGain.connect(highComp); highComp.connect(exciterBypass);
      harmonic.connect(bandMerger); exciterBypass.connect(bandMerger);
      bandMerger.connect(multibandBypassMb); multibandBypassMb.connect(multibandMix);

      const subBass = ctx.createBiquadFilter(); subBass.type = 'lowshelf';  subBass.frequency.value = 50;  subBass.gain.value = 0; subBassFilterRef.current = subBass;
      const bass    = ctx.createBiquadFilter(); bass.type = 'lowshelf';     bass.frequency.value = 80;     bass.gain.value = 0;    bassFilterRef.current = bass;
      const warmth  = ctx.createBiquadFilter(); warmth.type = 'peaking';    warmth.frequency.value = 250;  warmth.Q.value = 1.5; warmth.gain.value = 0; warmthFilterRef.current = warmth;
      const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 1; presence.gain.value = 0; presenceFilterRef.current = presence;
      const air     = ctx.createBiquadFilter(); air.type = 'highshelf';     air.frequency.value = 10000;  air.gain.value = 0; airFilterRef.current = air;
      multibandMix.connect(subBass); subBass.connect(bass); bass.connect(warmth); warmth.connect(presence); presence.connect(air);

      const stSplitter = ctx.createChannelSplitter(2);
      const stMerger = ctx.createChannelMerger(2);
      const stDelayL = ctx.createDelay(0.1); stDelayL.delayTime.value = 0;
      const stDelayR = ctx.createDelay(0.1); stDelayR.delayTime.value = 0;
      stereoDelayRef.current = stDelayR;
      air.connect(stSplitter);
      stSplitter.connect(stDelayL, 0); stSplitter.connect(stDelayR, 1);
      stDelayL.connect(stMerger, 0, 0); stDelayR.connect(stMerger, 0, 1);

      const masterGain = ctx.createGain(); masterGain.gain.value = 0.0001;
      gainNodeRef.current = masterGain;
      stMerger.connect(masterGain);

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = 0; comp.ratio.value = 1; comp.knee.value = 10; comp.attack.value = 0.003; comp.release.value = 0.25;
      compressorRef.current = comp;
      masterGain.connect(comp);

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -0.1; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.0005; limiter.release.value = 0.01;
      comp.connect(limiter); limiter.connect(spInput);

      const analyser = getAnalyser();
      if (analyser) { try { spInput.connect(analyser); } catch {} }

      audioEnhancedRef.current = true;

      // Apply initial preset. updateBoostPreset calls applyMasterGain which
      // ramps to target — but we want silence until canplaythrough. Re-mute.
      updateBoostPreset(preset);
      if (gainNodeRef.current && audioContextRef.current) {
        const now = audioContextRef.current.currentTime;
        const p = gainNodeRef.current.gain;
        p.cancelScheduledValues(now);
        p.setValueAtTime(0.0001, now);
      }

      devLog('🎛️ [AudioChain] chain built: source → mb/direct → EQ → stereo → master → comp → limiter → spatial');
    } catch (e) {
      devWarn('[AudioChain] setup failed:', e);
    }
  }, [audioRef, updateBoostPreset]);

  // ── EFFECTS: volume / preset / spatial change ────────────────────────
  // Volume effect — applies new master target via 25ms ramp.
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;
    if (audioEnhancedRef.current && gainNodeRef.current) {
      audioRef.current.volume = 1.0;
      applyMasterGain();
    } else {
      audioRef.current.volume = volume / 100;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  // Preset change — apply via updateBoostPreset.
  useEffect(() => {
    if ((playbackSource === 'cached' || playbackSource === 'r2') && audioEnhancedRef.current) {
      updateBoostPreset(boostProfile as BoostPreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boostProfile, updateBoostPreset]);

  // Spatial slider — only meaningful on VOYEX; otherwise neutralized.
  useEffect(() => {
    if ((playbackSource === 'cached' || playbackSource === 'r2') && spatialEnhancedRef.current) {
      if (boostProfile === 'voyex') updateVoyexSpatial(voyexSpatial);
      else updateVoyexSpatial(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voyexSpatial, boostProfile, updateVoyexSpatial]);

  // ── PLAY/PAUSE CLICK-FREE FADE ───────────────────────────────────────
  // User-initiated play/pause only (tap the button). loadTrack's canplay
  // handler owns its own fade-in — we defer to it via isLoadingTrackRef.
  // Rapid toggle needs RAF cancellation (otherwise two ramps compete and
  // volume glitches).
  const playPauseRafRef = useRef<number | null>(null);
  useEffect(() => {
    if ((playbackSource !== 'cached' && playbackSource !== 'r2') || !audioRef.current) return;

    // Cancel any in-flight HTML-volume ramp from a previous toggle.
    if (playPauseRafRef.current != null) {
      cancelAnimationFrame(playPauseRafRef.current);
      playPauseRafRef.current = null;
    }

    const audio = audioRef.current;
    if (isPlaying && audio.paused && audio.src && audio.readyState >= 2) {
      audioContextRef.current?.resume().catch(() => {});

      if (isLoadingTrackRef.current) {
        // loadTrack owns the ramp; just resume the element.
        audio.volume = 1.0;
        audio.play().catch(() => {});
        return;
      }

      if (audioEnhancedRef.current && gainNodeRef.current && audioContextRef.current) {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        const param = gainNodeRef.current.gain;
        param.cancelScheduledValues(now);
        param.setValueAtTime(0.0001, now);
        audio.volume = 1.0;
        audio.play().then(() => {
          fadeInMasterGain(15);
        }).catch(e => {
          devWarn('[AudioChain] resume failed:', e.name);
          usePlayerStore.getState().setIsPlaying(false);
        });
      } else {
        // No chain — HTML volume fallback.
        audio.volume = 0;
        audio.play().then(() => {
          const target = volume / 100;
          const start = performance.now();
          const step = () => {
            const t = Math.min((performance.now() - start) / 60, 1);
            if (audioRef.current) audioRef.current.volume = t * target;
            if (t < 1) playPauseRafRef.current = requestAnimationFrame(step);
            else playPauseRafRef.current = null;
          };
          playPauseRafRef.current = requestAnimationFrame(step);
        }).catch(e => {
          devWarn('[AudioChain] resume failed:', e.name);
          usePlayerStore.getState().setIsPlaying(false);
        });
      }
    } else if (!isPlaying && !audio.paused) {
      // Click-free pause: 40ms gain ramp → 50ms settle → audio.pause().
      if (audioEnhancedRef.current && gainNodeRef.current && audioContextRef.current) {
        const ctx = audioContextRef.current;
        const now = ctx.currentTime;
        const param = gainNodeRef.current.gain;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(0.0001, now + 0.04);
        setTimeout(() => {
          if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
        }, 50);
      } else {
        const startVol = audio.volume;
        const start = performance.now();
        const step = () => {
          const t = Math.min((performance.now() - start) / 40, 1);
          if (audioRef.current) audioRef.current.volume = startVol * (1 - t);
          if (t < 1) {
            playPauseRafRef.current = requestAnimationFrame(step);
          } else {
            playPauseRafRef.current = null;
            if (audioRef.current) audioRef.current.pause();
          }
        };
        playPauseRafRef.current = requestAnimationFrame(step);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  return {
    audioContextRef,
    gainNodeRef,
    setupAudioEnhancement,
    computeMasterTarget,
    applyMasterGain,
    muteMasterGainInstantly,
    fadeInMasterGain,
    armGainWatchdog,
    disarmGainWatchdog,
  };
}
