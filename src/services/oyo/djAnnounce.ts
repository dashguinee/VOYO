/**
 * DJ Announcements — OYO's voice.
 *
 * Not a notification system. Not a chatbot. A DJ character.
 *
 * A great DJ doesn't narrate every track. They speak when it matters —
 * a culture pivot, a hidden gem, a peak moment — and they do it with
 * economy. Three words that land harder than a paragraph.
 *
 * Each announcement carries two vibe choices: standardized intents the
 * system understands. Not free-form text input — curated options that
 * feel like a DJ asking "you want me to go harder or take it smooth?"
 *
 * The event emitter pattern lets any UI surface subscribe without
 * coupling to the playerStore. One subscriber at a time (the active
 * OYO DJ bar) — last subscribe wins.
 */

import type { DJMove, DJMoveType, Engagement } from './dj';

// ── Types ────────────────────────────────────────────────────────────────────

export type VibeIntent =
  | 'keep_energy'
  | 'boost_energy'
  | 'drop_energy'
  | 'stay_culture'
  | 'pivot_culture'
  | 'surface_hits'
  | 'go_deep';

export interface VibeChoice {
  label: string;
  intent: VibeIntent;
}

export interface DJAnnouncement {
  text: string;
  choices: [VibeChoice, VibeChoice];
  moveType: DJMoveType;
}

// ── Event emitter ────────────────────────────────────────────────────────────

type AnnouncementHandler = (ann: DJAnnouncement) => void;
let _listener: AnnouncementHandler | null = null;

export function onAnnouncement(handler: AnnouncementHandler): () => void {
  _listener = handler;
  return () => { if (_listener === handler) _listener = null; };
}

export function _emitAnnouncement(ann: DJAnnouncement): void {
  _listener?.(ann);
}

// ── Rotation counters ────────────────────────────────────────────────────────
// One counter per template bucket. Cycles through phrases without repeating,
// without randomness — deterministic within session, varied across tracks.

const _rotation: Record<string, number> = {};
function rotate(key: string, arr: string[]): string {
  _rotation[key] = ((_rotation[key] ?? -1) + 1) % arr.length;
  return arr[_rotation[key]];
}

export function resetAnnounceRotation(): void {
  Object.keys(_rotation).forEach(k => { delete _rotation[k]; });
}

// ── Cultural prefix overrides ────────────────────────────────────────────────
// Layered on top of base text when cultural tags are present.
// These are the DJ's vocabulary — they know the culture.

const CULTURAL_PREFIXES: Record<string, string[]> = {
  celebration:   ['Firebondeem —', 'Kulossaaa —'],
  festival:      ['Firebondeem —', 'Festival energy —'],
  liberation:    ['Free vibes —', 'Liberation —'],
  roots:         ['Back to the ground.', 'African roots.'],
  motherland:    ['Motherland energy.', 'Back home.'],
  healing:       ['Soul shift.', 'Medicine music.'],
  diaspora:      ['Bridging the distance.', 'Diaspora energy.'],
  'pan-african': ['Pan-African move.', 'All of us.'],
  prayer:        ['Sacred ground.', 'Soul work.'],
  anthem:        ['Anthem time.', 'We stand up.'],
  street:        ['Street certified.', 'Real talk.'],
  tradition:     ['Tradition first.', 'Roots deep.'],
};

function getCulturalIntro(tags: string[]): string {
  for (const tag of tags) {
    const opts = CULTURAL_PREFIXES[tag];
    if (opts?.length) {
      const key = `prefix_${tag}`;
      _rotation[key] = ((_rotation[key] ?? -1) + 1) % opts.length;
      return opts[_rotation[key]];
    }
  }
  return '';
}

// ── Template bank ─────────────────────────────────────────────────────────────

function bridgeAnnouncement(tags: string[]): DJAnnouncement {
  const intro = getCulturalIntro(tags);
  const bases = ['Culture shift.', 'We switching it up.', 'New territory.', 'Trust the move.'];
  const base = rotate('bridge', bases);
  return {
    text: intro ? `${intro} ${base}` : base,
    choices: [
      { label: 'Keep in this', intent: 'stay_culture' },
      { label: 'Back to heat', intent: 'pivot_culture' },
    ],
    moveType: 'bridge',
  };
}

function echoAnnouncement(): DJAnnouncement {
  const texts = [
    'Bro listen.',
    'They slept on this.',
    'This one\'s been waiting.',
    'OYO found something.',
  ];
  return {
    text: rotate('echo', texts),
    choices: [
      { label: 'More like this', intent: 'go_deep' },
      { label: 'Back to heat', intent: 'surface_hits' },
    ],
    moveType: 'echo',
  };
}

function hotLockedAnnouncement(tags: string[]): DJAnnouncement {
  const intro = getCulturalIntro(tags);
  const base = rotate('hot_locked', ['We in the zone.', 'Full send.', 'No stops from here.', 'We locked.']);
  return {
    text: intro ? `${intro} ${base}` : base,
    choices: [
      { label: 'Go harder', intent: 'boost_energy' },
      { label: 'Let it breathe', intent: 'drop_energy' },
    ],
    moveType: 'hot',
  };
}

function hotVibingAnnouncement(tags: string[]): DJAnnouncement {
  const intro = getCulturalIntro(tags);
  const texts = [
    'Riding this.',
    'We cooking.',
    'Hold the wave.',
    'This is working.',
  ];
  const base = rotate('hot_vibing', texts);
  return {
    text: intro ? `${intro} ${base}` : base,
    choices: [
      { label: 'Hold this', intent: 'keep_energy' },
      { label: 'Go harder', intent: 'boost_energy' },
    ],
    moveType: 'hot',
  };
}

function hotWarmingAnnouncement(): DJAnnouncement {
  const texts = [
    'Reading you.',
    'Still reading.',
    'Getting warmer.',
  ];
  return {
    text: rotate('hot_warming', texts),
    choices: [
      { label: 'Easy does it', intent: 'drop_energy' },
      { label: 'Drop straight in', intent: 'boost_energy' },
    ],
    moveType: 'hot',
  };
}

function hotSearchingAnnouncement(): DJAnnouncement {
  const texts = [
    'Finding your frequency.',
    'Let\'s see what lands.',
    'On the search.',
  ];
  return {
    text: rotate('hot_searching', texts),
    choices: [
      { label: 'Keep it familiar', intent: 'surface_hits' },
      { label: 'Surprise me', intent: 'go_deep' },
    ],
    moveType: 'hot',
  };
}

function discoveryAnnouncement(tags: string[]): DJAnnouncement {
  const intro = getCulturalIntro(tags);
  const texts = ['Taking you somewhere.', 'Going left for a sec.', 'Expanding the map.', 'Trust the move.'];
  const base = rotate('discovery', texts);
  return {
    text: intro ? `${intro} ${base}` : base,
    choices: [
      { label: 'Stay in discovery', intent: 'go_deep' },
      { label: 'Back to hits', intent: 'surface_hits' },
    ],
    moveType: 'discovery',
  };
}

function peakPhaseAnnouncement(tags: string[]): DJAnnouncement {
  const intro = getCulturalIntro(tags);
  const texts = [
    'Peak hour.',
    'Firebondeem, we\'re there.',
    'This is the top.',
    'Kulossaaa fr.',
  ];
  const base = rotate('peak', texts);
  return {
    text: intro ? `${intro} ${base}` : base,
    choices: [
      { label: 'Double down', intent: 'boost_energy' },
      { label: 'Hold this', intent: 'keep_energy' },
    ],
    moveType: 'hot',
  };
}

// ── Generator ────────────────────────────────────────────────────────────────

// Probability of a regular hot/discovery move getting an announcement.
// Kept low — OYO speaks when it matters, not on every track.
const RATE_LOCKED  = 0.30; // 1 in 3 at peak engagement
const RATE_VIBING  = 0.22;
const RATE_WARMING = 0.14;
const RATE_DEFAULT = 0.10;

/**
 * Generate an announcement for this DJ move, or null if this move
 * should be silent. Bridge and echo always speak; regular flow moves
 * speak occasionally based on engagement level.
 */
export function generateAnnouncement(
  move: DJMove & { phaseAdvanced?: boolean },
  culturalTags: string[],
): DJAnnouncement | null {
  // Extract engagement from the thought string
  const engagementMatch = move.thought.match(/:(searching|warming|vibing|locked)\]/);
  const engagement = (engagementMatch?.[1] ?? 'warming') as Engagement;

  // Bridge and echo are intentional DJ moves — always announce
  if (move.type === 'bridge') return bridgeAnnouncement(culturalTags);
  if (move.type === 'echo')   return echoAnnouncement();

  // Phase advance to peak is worth calling out
  if (move.phaseAdvanced) return peakPhaseAnnouncement(culturalTags);

  // Hot/discovery: announce based on engagement level
  const rate =
    engagement === 'locked'    ? RATE_LOCKED  :
    engagement === 'vibing'    ? RATE_VIBING  :
    engagement === 'warming'   ? RATE_WARMING : RATE_DEFAULT;

  if (Math.random() > rate) return null; // silence for most tracks

  if (move.type === 'discovery') return discoveryAnnouncement(culturalTags);

  // Hot by engagement
  if (engagement === 'locked')  return hotLockedAnnouncement(culturalTags);
  if (engagement === 'vibing')  return hotVibingAnnouncement(culturalTags);
  if (engagement === 'warming') return hotWarmingAnnouncement();
  return hotSearchingAnnouncement();
}
