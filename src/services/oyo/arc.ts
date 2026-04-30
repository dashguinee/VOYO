/**
 * OYO Arc System — The emotional architecture of a session.
 *
 * A DJ doesn't play tracks. A DJ takes you somewhere.
 * Each arc is a psychological narrative — an intentional journey through
 * energy, mood, and culture that feels inevitable in retrospect.
 *
 * Time of day is the entry point. The user's engagement steers from there.
 */

// ── Arc & Phase Types ─────────────────────────────────────────────────────

export type ArcType =
  | 'morning-breeze'    // 5am-12pm: gentle entry, warmth rising
  | 'afternoon-groove'  // 12pm-6pm: steady, productive, cultural exploration
  | 'evening-rise'      // 6pm-10pm: building anticipation, social heat
  | 'late-night-soul';  // 10pm-5am: depth, intimacy, cultural gravity

export type SessionPhase =
  | 'arrival'   // First impression — set the tone, earn trust
  | 'hook'      // The anchor — something that lands, locks them in
  | 'build'     // Rising — energy, momentum, the session finding itself
  | 'peak'      // The moment — max energy, the banger(s)
  | 'flow'      // Steady state — groove maintained, variation introduced
  | 'bridge'    // Cultural crossing — era or region surprise that fits perfectly
  | 'echo';     // Hidden gem — giving shine to what was overlooked

export type VibeShift = 'hold' | 'rise' | 'drop' | 'pivot';
export type CanonDepth = 'surface' | 'mixed' | 'deep';

export interface PhaseConfig {
  energyMin: number;           // W minimum (1–5)
  energyMax: number;           // W maximum (1–5)
  hotRatio: number;            // Probability of hot over discovery (0–1)
  vibeShift: VibeShift;
  canonDepth: CanonDepth;      // How deep into the artist canon to go
  minTracks: number;
  maxTracks: number;
  culturalFocus?: string[];    // cultural_tags to lean toward
  preferredEras?: string[];    // eras to lean toward
  preferredTiers?: ('A' | 'B' | 'C' | 'D')[];
}

export interface EmotionalArc {
  type: ArcType;
  description: string;
  phases: Record<'arrival' | 'hook' | 'build' | 'peak' | 'flow', PhaseConfig>;
  bridgeEvery: number;   // Insert a cultural bridge every N tracks
  echoEvery: number;     // Surface a hidden gem every N tracks
}

// ── The Four Arcs ─────────────────────────────────────────────────────────

const ARCS: Record<ArcType, EmotionalArc> = {

  'morning-breeze': {
    type: 'morning-breeze',
    description: 'Gentle entry. Warmth before heat. The day opening up.',
    phases: {
      arrival: {
        energyMin: 1, energyMax: 2, hotRatio: 0.75, vibeShift: 'hold',
        canonDepth: 'surface', minTracks: 2, maxTracks: 3,
        preferredTiers: ['A', 'B'],
        culturalFocus: ['celebration', 'healing', 'prayer'],
      },
      hook: {
        energyMin: 2, energyMax: 3, hotRatio: 0.65, vibeShift: 'hold',
        canonDepth: 'surface', minTracks: 2, maxTracks: 2,
        culturalFocus: ['bridge', 'homecoming', 'roots'],
      },
      build: {
        energyMin: 2, energyMax: 4, hotRatio: 0.55, vibeShift: 'rise',
        canonDepth: 'mixed', minTracks: 3, maxTracks: 5,
      },
      peak: {
        energyMin: 3, energyMax: 4, hotRatio: 0.5, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 2, maxTracks: 3,
      },
      flow: {
        energyMin: 3, energyMax: 4, hotRatio: 0.5, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 3, maxTracks: 99,
      },
    },
    bridgeEvery: 9,
    echoEvery: 13,
  },

  'afternoon-groove': {
    type: 'afternoon-groove',
    description: 'Steady groove. The productive pocket. Cultural exploration.',
    phases: {
      arrival: {
        energyMin: 3, energyMax: 3, hotRatio: 0.70, vibeShift: 'hold',
        canonDepth: 'surface', minTracks: 2, maxTracks: 2,
        preferredTiers: ['A', 'B'],
      },
      hook: {
        energyMin: 3, energyMax: 4, hotRatio: 0.65, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 2, maxTracks: 2,
        culturalFocus: ['anthem', 'festival', 'celebration'],
      },
      build: {
        energyMin: 3, energyMax: 5, hotRatio: 0.55, vibeShift: 'rise',
        canonDepth: 'mixed', minTracks: 3, maxTracks: 5,
      },
      peak: {
        energyMin: 4, energyMax: 5, hotRatio: 0.55, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 2, maxTracks: 3,
      },
      flow: {
        energyMin: 3, energyMax: 5, hotRatio: 0.50, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 3, maxTracks: 99,
      },
    },
    bridgeEvery: 6,
    echoEvery: 9,
  },

  'evening-rise': {
    type: 'evening-rise',
    description: 'Building heat. Social energy. The night opening.',
    phases: {
      arrival: {
        energyMin: 3, energyMax: 3, hotRatio: 0.75, vibeShift: 'hold',
        canonDepth: 'surface', minTracks: 2, maxTracks: 2,
        preferredTiers: ['A', 'B'],
      },
      hook: {
        energyMin: 3, energyMax: 4, hotRatio: 0.70, vibeShift: 'rise',
        canonDepth: 'surface', minTracks: 2, maxTracks: 3,
        culturalFocus: ['celebration', 'festival', 'anthem', 'street'],
      },
      build: {
        energyMin: 4, energyMax: 5, hotRatio: 0.60, vibeShift: 'rise',
        canonDepth: 'mixed', minTracks: 3, maxTracks: 5,
      },
      peak: {
        energyMin: 5, energyMax: 5, hotRatio: 0.55, vibeShift: 'hold',
        canonDepth: 'surface', minTracks: 1, maxTracks: 2,
      },
      flow: {
        energyMin: 4, energyMax: 5, hotRatio: 0.50, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 3, maxTracks: 99,
      },
    },
    bridgeEvery: 8,
    echoEvery: 12,
  },

  'late-night-soul': {
    type: 'late-night-soul',
    description: 'Depth. Intimacy. The culture at its most real.',
    phases: {
      arrival: {
        energyMin: 3, energyMax: 4, hotRatio: 0.60, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 2, maxTracks: 2,
        culturalFocus: ['street', 'survival', 'diaspora'],
      },
      hook: {
        energyMin: 4, energyMax: 4, hotRatio: 0.50, vibeShift: 'hold',
        canonDepth: 'deep', minTracks: 2, maxTracks: 3,
        culturalFocus: ['liberation', 'roots', 'motherland', 'pan-african'],
      },
      build: {
        energyMin: 4, energyMax: 5, hotRatio: 0.40, vibeShift: 'rise',
        canonDepth: 'deep', minTracks: 3, maxTracks: 5,
      },
      peak: {
        energyMin: 5, energyMax: 5, hotRatio: 0.40, vibeShift: 'hold',
        canonDepth: 'mixed', minTracks: 1, maxTracks: 2,
      },
      flow: {
        energyMin: 3, energyMax: 4, hotRatio: 0.35, vibeShift: 'drop',
        canonDepth: 'deep', minTracks: 3, maxTracks: 99,
        culturalFocus: ['tradition', 'roots', 'healing', 'prayer'],
      },
    },
    bridgeEvery: 5,   // Late night bridges more — the culture runs deep at 2am
    echoEvery: 7,
  },
};

// ── Public API ────────────────────────────────────────────────────────────

export function selectArc(hour: number): ArcType {
  if (hour >= 5 && hour < 12) return 'morning-breeze';
  if (hour >= 12 && hour < 18) return 'afternoon-groove';
  if (hour >= 18 && hour < 22) return 'evening-rise';
  return 'late-night-soul';
}

export function getArc(type: ArcType): EmotionalArc {
  return ARCS[type];
}

export const PHASE_ORDER: SessionPhase[] = ['arrival', 'hook', 'build', 'peak', 'flow'];

// Energy → vibe column weights (W axis → V axis proxy)
// Maps a 1-5 energy level to which vibe score columns to prioritize
export const ENERGY_TO_VIBE: Record<number, { col: string; min: number }[]> = {
  5: [{ col: 'vibe_afro_heat', min: 65 }, { col: 'vibe_party_mode', min: 65 }],
  4: [{ col: 'vibe_afro_heat', min: 45 }, { col: 'vibe_party_mode', min: 45 }],
  3: [{ col: 'vibe_afro_heat', min: 30 }, { col: 'vibe_chill_vibes', min: 30 }, { col: 'vibe_party_mode', min: 30 }],
  2: [{ col: 'vibe_chill_vibes', min: 45 }, { col: 'vibe_late_night', min: 40 }],
  1: [{ col: 'vibe_chill_vibes', min: 60 }, { col: 'vibe_late_night', min: 55 }],
};
