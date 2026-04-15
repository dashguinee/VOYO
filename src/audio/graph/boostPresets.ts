/**
 * Boost Presets — EQ + compressor + spatial configurations.
 *
 * Applied by setupAudioEnhancement() in AudioPlayer. Four presets:
 *   off      — no enhancement, raw audio through a unity-gain chain
 *   boosted  — warm bass + subtle air, gentle compressor
 *   calm     — softer bass, slight warmth, low-ratio compressor
 *   voyex    — professional multiband mastering + stereo widening
 *
 * Frequencies in Hz. Gain in dB. Compressor attack/release in seconds.
 */

export type BoostPreset = 'off' | 'boosted' | 'calm' | 'voyex';

export const BOOST_PRESETS = {
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
    // Professional mastering: multiband compression + stereo widening
    multiband: true,
    gain: 1.4, highPassFreq: 25, stereoWidth: 0.015,
    lowCrossover: 180,
    highCrossover: 4500,
    low:  { gain: 1.3,  threshold: -18, ratio: 5, attack: 0.01,  release: 0.15 },
    mid:  { gain: 1.1,  threshold: -12, ratio: 2, attack: 0.02,  release: 0.25 },
    high: { gain: 1.25, threshold: -15, ratio: 3, attack: 0.005, release: 0.1 },
    // Legacy defaults for the single-band code path
    bassFreq: 80, bassGain: 0, presenceFreq: 3000, presenceGain: 0,
    subBassFreq: 50, subBassGain: 0, warmthFreq: 280, warmthGain: 0,
    airFreq: 12000, airGain: 0, harmonicAmount: 8,
    compressor: { threshold: -6, knee: 10, ratio: 2, attack: 0.01, release: 0.2 }
  },
};
