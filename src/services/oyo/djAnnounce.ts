/**
 * DJ Announcements — OYO's voice.
 *
 * Not a notification system. Not a chatbot. A DJ character.
 *
 * A great DJ doesn't narrate every track. They speak when it matters —
 * a culture pivot, a hidden gem, a peak moment — and they do it with
 * economy. Three words that land harder than a paragraph.
 *
 * Hype vocab (Firebondeem, Kulossaaa) is energy-gated: only fires when
 * vibe_afro_heat > 55 OR vibe_party_mode > 55. Saying "Firebondeem" on
 * an Ed Sheeran ballad is not the vibe.
 *
 * Genre vocabulary, artist callouts, and energy classification all use
 * the incoming track's raw metadata — so OYO sounds like it actually
 * knows what it's playing.
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

/** Snapshot of the incoming track's raw metadata for announcement personalization. */
export interface TrackContext {
  artist?: string | null;
  genre?: string | null;
  culturalTags?: string[] | null;
  artistTier?: string | null;
  heatScore?: number | null;
  vibeAfroHeat?: number | null;
  vibeParty?: number | null;
  vibeLatenight?: number | null;
  vibeChill?: number | null;
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

const _rotation: Record<string, number> = {};
function rotate(key: string, arr: string[]): string {
  _rotation[key] = ((_rotation[key] ?? -1) + 1) % arr.length;
  return arr[_rotation[key]];
}

export function resetAnnounceRotation(): void {
  Object.keys(_rotation).forEach(k => { delete _rotation[k]; });
}

// ── Energy classification ────────────────────────────────────────────────────

function isHypeSong(ctx: TrackContext): boolean {
  return (ctx.vibeAfroHeat ?? 0) > 55 || (ctx.vibeParty ?? 0) > 55;
}
function isChillSong(ctx: TrackContext): boolean {
  return (ctx.vibeChill ?? 0) > 55 && (ctx.vibeAfroHeat ?? 0) < 40;
}
function isLateNight(ctx: TrackContext): boolean {
  return (ctx.vibeLatenight ?? 0) > 55;
}

// ── Genre vocabulary ─────────────────────────────────────────────────────────
// Keyed on normalized genre strings (lowercase, no spaces/hyphens).

const GENRE_VOCAB: Record<string, string[]> = {
  amapiano:   ['Piano on deck.', 'Yanos drop.', 'SA in the building.', 'Log drum szn.'],
  afrobeats:  ['Lagos calling.', 'The groove don\'t lie.', 'Afro in the air.', 'Nigerian on top.'],
  afropop:    ['Afro wave.', 'The continent calling.', 'Pure afro.'],
  reggae:     ['Riddim.', 'One drop.', 'Roots rock.'],
  dancehall:  ['Bashment.', 'Dance hall lock off.'],
  reggaeton:  ['La vibra.', 'Perreo szn.'],
  afrohouse:  ['Dance floor calling.', 'Warehouse energy.', 'Deep in it.'],
  congolese:  ['Ndombolo.', 'Kinshasa on the set.', 'Rumba vibes.'],
  soukous:    ['Congo in the air.', 'Soukous time.'],
  highlife:   ['Highlife hour.', 'Ghana on it.'],
  kwaito:     ['SA deep.', 'Kwaito bounce.'],
  bongo:      ['Bongo flava.', 'Dar es Salaam in the set.'],
  hiplife:    ['Ghana hip.', 'Hiplife energy.'],
  fuji:       ['Fuji vibes.', 'Traditional road.'],
  afrojuju:   ['Juju wave.', 'Nigerian roots.'],
  // Genres now enriched via video_intelligence.primary_genre (v1065)
  kizomba:   ['Kizomba hour.', 'Luanda feeling.', 'Slow motion.', 'Angola in the air.'],
  rumba:     ['Congo rumba.', 'Kinshasa roots.', 'Rumba time.', 'The original groove.'],
  ndombolo:  ['Ndombolo wave.', 'DRC energy.', 'Kinshasa on fire.'],
  gqom:      ['Durban gqom.', 'Township sound.', 'Gqom nation.'],
  hiphop:    ['Hip-hop moves.', 'Real talk.', 'Bars up.', 'The culture.'],
  rnb:       ['R&B soul.', 'Smooth like that.', 'Feels.', 'Vibes only.'],
  gospel:    ['Spirit moving.', 'Sacred ground.', 'Praise up.', 'Soul work.'],
  mbalax:    ['Dakar calling.', 'Mbalax in the house.', 'Sénégal on the set.'],
  bikutsi:   ['Cameroon vibes.', 'Bikutsi time.', 'Yaoundé energy.'],
  makossa:   ['Makossa move.', 'Douala on it.', 'Cameroon classic.'],
  drill:     ['Drill on.', 'UK certified.', 'London vibes.'],
  grime:     ['Grime wave.', 'London on top.', 'East London.'],
  zouk:      ['Zouk flow.', 'Lusophone love.', 'Move close.'],
};

function getGenreVocab(genre: string | null | undefined): string | null {
  if (!genre) return null;
  const norm = genre.toLowerCase().replace(/[\s\-]+/g, '');
  if (GENRE_VOCAB[norm]) return rotate(`genre_${norm}`, GENRE_VOCAB[norm]);
  // Substring match for compound genres (e.g. "Congolese Rumba" → "congolese")
  for (const [key, phrases] of Object.entries(GENRE_VOCAB)) {
    if (norm.includes(key) || key.includes(norm)) {
      return rotate(`genre_${key}`, phrases);
    }
  }
  return null;
}

// ── Artist callout ───────────────────────────────────────────────────────────

function artistCallout(artist: string): string {
  return rotate('artist_callout', [
    `Oye ${artist}!`,
    `${artist} in the set.`,
    `${artist} about to say something.`,
    `${artist} don't play.`,
    `Make some noise for ${artist}!`,
  ]);
}

function unknownArtistCallout(artist: string): string {
  return rotate('artist_unknown', [
    `${artist}, for you people.`,
    `Big up ${artist}.`,
    `${artist} — the people need to know.`,
    `Make some noise for ${artist}!`,
    `${artist} on the radar.`,
  ]);
}

// ── Region callout (from incoming track's cultural_tags) ─────────────────────
const REGION_CALLOUT: Record<string, string[]> = {
  nigeria:       ['Naija in the set.', 'Lagos knows.', 'Nigeria certified.'],
  angola:        ['Angola on top.', 'Luanda vibes.', 'Angola in the building.'],
  senegal:       ['Dakar represent.', 'Sénégal in the set.', 'Senegal on the move.'],
  ghana:         ['Accra on it.', 'Ghana certified.', 'Gold Coast energy.'],
  cameroon:      ['Cameroon represent.', 'Douala on set.', 'Yaoundé energy.'],
  kenya:         ['Nairobi on top.', 'East Africa vibes.', 'Kenya in the set.'],
  'south-africa':['SA in the building.', 'Jozi certified.', 'Cape Town vibes.'],
  'dr-congo':    ['Kinshasa on fire.', 'DRC in the set.', 'Congo certified.'],
  tanzania:      ['Dar es Salaam represent.', 'Tanzania in the house.', 'Bongo land.'],
  'west-africa': ['West Africa represent.', 'The continent calling.', 'West Africa on top.'],
  diaspora:      ['Diaspora vibes.', 'Bridging the distance.', 'The diaspora showing up.'],
};

function getRegionCallout(culturalTags: string[] | null | undefined): string | null {
  if (!culturalTags?.length) return null;
  for (const tag of culturalTags) {
    const norm = tag.toLowerCase();
    if (REGION_CALLOUT[norm]) {
      return rotate(`region_${norm}`, REGION_CALLOUT[norm]);
    }
  }
  return null;
}

// ── Cultural prefix overrides ────────────────────────────────────────────────
// Split into hype-only (energy-gated) and neutral buckets.
// Hype vocab only fires when isHypeSong(ctx) — ctx required for hype bucket.

const HYPE_PREFIXES: Record<string, string[]> = {
  celebration: ['Firebondeem —', 'Kulossaaa —'],
  festival:    ['Firebondeem —', 'Festival energy —'],
  liberation:  ['E dey fire —', 'Free vibes —'],
};

const NEUTRAL_PREFIXES: Record<string, string[]> = {
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

function getCulturalIntro(tags: string[], ctx?: TrackContext): string {
  if (ctx && isHypeSong(ctx)) {
    for (const tag of tags) {
      const opts = HYPE_PREFIXES[tag];
      if (opts?.length) {
        const key = `prefix_hype_${tag}`;
        _rotation[key] = ((_rotation[key] ?? -1) + 1) % opts.length;
        return opts[_rotation[key]];
      }
    }
  }
  for (const tag of tags) {
    const opts = NEUTRAL_PREFIXES[tag];
    if (opts?.length) {
      const key = `prefix_${tag}`;
      _rotation[key] = ((_rotation[key] ?? -1) + 1) % opts.length;
      return opts[_rotation[key]];
    }
  }
  return '';
}

// ── Template bank ─────────────────────────────────────────────────────────────

// Genre-pair bridge phrases — "from X → to Y" narrative
const GENRE_BRIDGE: Partial<Record<string, string>> = {
  'afrobeats→kizomba':   'From Lagos to Luanda.',
  'kizomba→afrobeats':   'Switching lanes.',
  'afrobeats→amapiano':  'SA calling.',
  'amapiano→afrobeats':  'Back to the mainland.',
  'afrobeats→gospel':    'Spirit shift.',
  'gospel→afrobeats':    'Back to the heat.',
  'afrobeats→bongo-flava': 'East Africa in the building.',
  'kizomba→amapiano':    'Southern Africa on top.',
  'amapiano→kizomba':    'Slow it down.',
  'afrobeats→hiphop':    'Culture crossing.',
  'hiphop→afrobeats':    'Back to Africa.',
  'afrobeats→rnb':       'Feel this.',
  'rnb→afrobeats':       'Back to the groove.',
  'afrobeats→drill':     'Taking it darker.',
};

function bridgeAnnouncement(tags: string[], ctx?: TrackContext, prevGenre?: string | null): DJAnnouncement {
  let text: string | null = null;

  // Genre-pair bridge: if we know source and destination genres
  if (prevGenre && ctx?.genre && prevGenre !== ctx.genre) {
    const key = `${prevGenre}→${ctx.genre}`;
    text = GENRE_BRIDGE[key] ?? null;
  }

  if (!text) {
    const intro = getCulturalIntro(tags, ctx);
    const bases = ['Culture shift.', 'We switching it up.', 'New territory.', 'Trust the move.', 'Going somewhere else.', 'Hold on — different energy.'];
    const base = rotate('bridge', bases);
    text = intro ? `${intro} ${base}` : base;
  }

  return {
    text,
    choices: [
      { label: 'Keep in this', intent: 'stay_culture' },
      { label: 'Back to heat', intent: 'pivot_culture' },
    ],
    moveType: 'bridge',
  };
}

function echoAnnouncement(ctx?: TrackContext): DJAnnouncement {
  let text: string;
  if (ctx?.artist && (ctx.heatScore ?? 100) < 30) {
    text = rotate('echo_artist', [
      `${ctx.artist}, for you people.`,
      `${ctx.artist} goes deeper than people know.`,
      `They slept on this one.`,
      `Big up ${ctx.artist}.`,
    ]);
  } else {
    text = rotate('echo', [
      'Bro listen.',
      'They slept on this.',
      'This one\'s been waiting.',
      'OYO dug deep.',
      'Pay attention.',
      'This one hits different.',
    ]);
  }
  return {
    text,
    choices: [
      { label: 'More like this', intent: 'go_deep' },
      { label: 'Back to heat', intent: 'surface_hits' },
    ],
    moveType: 'echo',
  };
}

function hotLockedAnnouncement(tags: string[], ctx?: TrackContext): DJAnnouncement {
  let text: string;
  if (ctx?.artist && ctx.artistTier === 'A') {
    text = artistCallout(ctx.artist);
  } else if (ctx && getGenreVocab(ctx.genre)) {
    // Genre fires — optionally prepend region for extra specificity ("Naija in the set. Lagos calling.")
    const genreText = getGenreVocab(ctx.genre)!;
    const regionText = getRegionCallout(ctx.culturalTags);
    text = regionText ? `${regionText} ${genreText}` : genreText;
  } else if (ctx && isLateNight(ctx)) {
    text = rotate('late_night', ['Night shift.', '3am feeling.', 'Low light energy.', 'After dark.', 'Late night only.']);
  } else if (ctx && isChillSong(ctx)) {
    text = rotate('chill_locked', ['Soft life vibes.', 'Soul food.', 'Take it down.', 'We breathing.', 'Low and slow.']);
  } else {
    const intro = getCulturalIntro(tags, ctx);
    const base = rotate('hot_locked', ['We in the zone.', 'Full send.', 'No stops from here.', 'We locked.', 'Straight like that.', 'This don\'t miss.']);
    text = intro ? `${intro} ${base}` : base;
  }
  return {
    text,
    choices: [
      { label: 'Go harder', intent: 'boost_energy' },
      { label: 'Let it breathe', intent: 'drop_energy' },
    ],
    moveType: 'hot',
  };
}

function hotVibingAnnouncement(tags: string[], ctx?: TrackContext): DJAnnouncement {
  let text: string;
  if (ctx?.artist && ctx.artistTier === 'A') {
    text = artistCallout(ctx.artist);
  } else if (ctx && getGenreVocab(ctx.genre)) {
    text = getGenreVocab(ctx.genre)!;
  } else if (ctx && isLateNight(ctx)) {
    text = rotate('late_vibing', ['Night shift.', 'Low light energy.', 'After dark.', 'Late hours.']);
  } else if (ctx && isChillSong(ctx)) {
    text = rotate('chill_vibing', ['Soft life.', 'Soul food.', 'We breathing.', 'Easy now.']);
  } else {
    const intro = getCulturalIntro(tags, ctx);
    const base = rotate('hot_vibing', ['Riding this.', 'We cooking.', 'Hold the wave.', 'This is working.', 'Real talk.', 'Feel that.']);
    text = intro ? `${intro} ${base}` : base;
  }
  return {
    text,
    choices: [
      { label: 'Hold this', intent: 'keep_energy' },
      { label: 'Go harder', intent: 'boost_energy' },
    ],
    moveType: 'hot',
  };
}

function hotWarmingAnnouncement(): DJAnnouncement {
  return {
    text: rotate('hot_warming', ['Reading you.', 'Still reading.', 'Getting warmer.', 'Give it a sec.', 'Hold tight.']),
    choices: [
      { label: 'Easy does it', intent: 'drop_energy' },
      { label: 'Drop straight in', intent: 'boost_energy' },
    ],
    moveType: 'hot',
  };
}

function hotSearchingAnnouncement(): DJAnnouncement {
  return {
    text: rotate('hot_searching', ['Scanning the set.', 'Let\'s see what lands.', 'OYO\'s on it.', 'Hold on.', 'Digging for you.']),
    choices: [
      { label: 'Keep it familiar', intent: 'surface_hits' },
      { label: 'Surprise me', intent: 'go_deep' },
    ],
    moveType: 'hot',
  };
}

function discoveryAnnouncement(tags: string[], ctx?: TrackContext): DJAnnouncement {
  let text: string;
  if (ctx?.artist && (ctx.heatScore ?? 50) < 30) {
    // Low-heat artist — DJ introduces the unknown
    text = unknownArtistCallout(ctx.artist);
  } else if (ctx && getGenreVocab(ctx.genre)) {
    // For discovery, add region context if genre fires — "Angola in the building. Kizomba hour."
    const genreText = getGenreVocab(ctx.genre)!;
    const regionText = getRegionCallout(ctx.culturalTags);
    text = regionText ? `${regionText} ${genreText}` : genreText;
  } else {
    const intro = getCulturalIntro(tags, ctx);
    const base = rotate('discovery', ['Taking you somewhere.', 'Going left for a sec.', 'Expanding the map.', 'Trust the move.', 'Something different.', 'OYO dug deep.']);
    text = intro ? `${intro} ${base}` : base;
  }
  return {
    text,
    choices: [
      { label: 'Stay in discovery', intent: 'go_deep' },
      { label: 'Back to hits', intent: 'surface_hits' },
    ],
    moveType: 'discovery',
  };
}

function peakPhaseAnnouncement(tags: string[], ctx?: TrackContext): DJAnnouncement {
  let text: string;
  if (ctx?.artist && ctx.artistTier === 'A') {
    text = artistCallout(ctx.artist);
  } else if (ctx && getGenreVocab(ctx.genre)) {
    const genrePhrase = getGenreVocab(ctx.genre)!;
    const base = rotate('peak_hype', ['Peak hour.', 'This is the top.', 'No ceiling.', 'This is it.', 'We made it here.']);
    text = `${genrePhrase} ${base}`;
  } else if (ctx && isHypeSong(ctx)) {
    const intro = getCulturalIntro(tags, ctx);
    const base = rotate('peak_hype', ['Peak hour.', 'This is the top.', 'No ceiling.', 'This is it.', 'We made it here.']);
    text = intro ? `${intro} ${base}` : base;
  } else {
    text = rotate('peak', ['Peak hour.', 'This is the top.', 'Full arc.', 'We\'re there.', 'Right here.']);
  }
  return {
    text,
    choices: [
      { label: 'Double down', intent: 'boost_energy' },
      { label: 'Hold this', intent: 'keep_energy' },
    ],
    moveType: 'hot',
  };
}

// ── Generator ────────────────────────────────────────────────────────────────

const RATE_LOCKED  = 0.30;
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
  ctx?: TrackContext,
  prevGenre?: string | null,
): DJAnnouncement | null {
  const engagementMatch = move.thought.match(/:(searching|warming|vibing|locked)\]/);
  const engagement = (engagementMatch?.[1] ?? 'warming') as Engagement;

  if (move.type === 'bridge') return bridgeAnnouncement(culturalTags, ctx, prevGenre);
  if (move.type === 'echo')   return echoAnnouncement(ctx);
  if (move.phaseAdvanced)     return peakPhaseAnnouncement(culturalTags, ctx);

  const rate =
    engagement === 'locked'  ? RATE_LOCKED  :
    engagement === 'vibing'  ? RATE_VIBING  :
    engagement === 'warming' ? RATE_WARMING : RATE_DEFAULT;

  if (Math.random() > rate) return null;

  if (move.type === 'discovery') return discoveryAnnouncement(culturalTags, ctx);

  if (engagement === 'locked')  return hotLockedAnnouncement(culturalTags, ctx);
  if (engagement === 'vibing')  return hotVibingAnnouncement(culturalTags, ctx);
  if (engagement === 'warming') return hotWarmingAnnouncement();
  return hotSearchingAnnouncement();
}
