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
  vibeWorkout?: number | null;
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
function isWorkoutSong(ctx: TrackContext): boolean {
  return (ctx.vibeWorkout ?? 0) > 60 && (ctx.vibeChill ?? 0) < 35;
}

// ── Vibe combo detection ─────────────────────────────────────────────────────

function getVibeComboPhrase(ctx: TrackContext): string | null {
  const heat = ctx.vibeAfroHeat ?? 0;
  const party = ctx.vibeParty ?? 0;
  const chill = ctx.vibeChill ?? 0;
  const late = ctx.vibeLatenight ?? 0;
  const workout = ctx.vibeWorkout ?? 0;

  if (heat > 72 && party > 72) return rotate('combo_peak', [
    'Peak floor. That\'s it.', 'Maximum heat right now.', 'This is what we came for.', 'No ceiling from here.',
  ]);
  if (heat > 65 && late > 65) return rotate('combo_late_heat', [
    'Late night banger.', 'Hot and late.', '3am energy.', 'Night heat only.',
  ]);
  if (chill > 65 && late > 65) return rotate('combo_3am', [
    '3am soft life.', 'Late night soul.', 'Low light, high feeling.', 'Don\'t sleep on this one.',
  ]);
  if (workout > 70 && heat > 60) return rotate('combo_workout', [
    'Body moving.', 'Physical energy.', 'Movement track.', 'Pure drive right here.',
  ]);
  if (chill > 68 && heat < 30) return rotate('combo_deep_chill', [
    'Total breeze.', 'Soft landing.', 'Take a breath.', 'No rush at all.',
  ]);
  if (heat > 58 && chill > 45 && late > 50) return rotate('combo_smooth_heat', [
    'Smooth and warm.', 'Comfortable heat.', 'Warm in here.', 'Easing into it.',
  ]);
  return null;
}

// ── Time-of-day awareness ────────────────────────────────────────────────────

function getTimeOfDayHint(): string | null {
  const h = new Date().getHours();
  if (h >= 5 && h < 9)   return rotate('tod_morning',   ['Morning session.', 'Rise and vibe.', 'First track of the day.']);
  if (h >= 9 && h < 12)  return rotate('tod_midmorning',['Mid-morning energy.', 'Day is moving.', 'In motion now.']);
  if (h >= 12 && h < 15) return rotate('tod_afternoon',  ['Afternoon run.', 'Midday heat.', 'Lunch break vibes.']);
  if (h >= 15 && h < 18) return rotate('tod_lateafternoon', ['Late afternoon.', 'Day winding.', 'Golden hour incoming.']);
  if (h >= 18 && h < 21) return rotate('tod_evening',    ['Evening session.', 'Sun\'s down. Volume up.', 'Night is beginning.']);
  if (h >= 21 && h < 22) return rotate('tod_prenight',   ['Pre-night energy.', 'Getting in the mood.', 'Night about to start.']);
  if (h >= 22 || h < 2)  return rotate('tod_midnight',   ['Deep night energy.', 'The late crowd.', 'Night owls only.']);
  if (h >= 2 && h < 5)   return rotate('tod_latenight',  ['Very late. Very intentional.', '4am club.', 'The real late shift.']);
  return null;
}

// ── Genre vocabulary ─────────────────────────────────────────────────────────
// Keyed on normalized genre strings (lowercase, no spaces/hyphens).

const GENRE_VOCAB: Record<string, string[]> = {
  amapiano:   ['Piano on deck.', 'Yanos drop.', 'SA in the building.', 'Log drum szn.'],
  afrobeats:  ['Lagos calling.', 'The groove don\'t lie.', 'Afro in the air.', 'Nigerian on top.'],
  afropop:    ['Afro wave.', 'The continent calling.', 'Pure afro.'],
  afrofusion: ['Afro fusion.', 'Boundary-crossing.', 'The continent blending.'],
  afrobeat:   ['Fela\'s children.', 'Lagos roots.', 'The original Afrobeat.'],
  reggae:     ['Riddim.', 'One drop.', 'Roots rock.'],
  dancehall:  ['Bashment.', 'Dance hall lock off.', 'Yard vibes.'],
  reggaeton:  ['La vibra.', 'Perreo szn.'],
  afrohouse:  ['Dance floor calling.', 'Warehouse energy.', 'Deep in it.', 'SA club mode.'],
  congolese:  ['Ndombolo.', 'Kinshasa on the set.', 'Rumba vibes.'],
  soukous:    ['Congo in the air.', 'Soukous time.', 'Guitar-led groove.'],
  highlife:   ['Highlife hour.', 'Ghana on it.', 'Accra calling.'],
  kwaito:     ['SA deep.', 'Kwaito bounce.'],
  bongo:      ['Bongo flava.', 'Dar es Salaam in the set.'],
  bongoflava: ['Bongo flava.', 'Dar es Salaam in the set.'],
  fuji:       ['Fuji vibes.', 'Traditional road.'],
  afrojuju:   ['Juju wave.', 'Nigerian roots.'],
  kizomba:    ['Kizomba hour.', 'Luanda feeling.', 'Slow motion.', 'Angola in the air.'],
  rumba:      ['Congo rumba.', 'Kinshasa roots.', 'Rumba time.', 'The original groove.'],
  ndombolo:   ['Ndombolo wave.', 'DRC energy.', 'Kinshasa on fire.'],
  gqom:       ['Durban gqom.', 'Township sound.', 'Gqom nation.'],
  hiphop:     ['Hip-hop moves.', 'Real talk.', 'Bars up.', 'The culture.'],
  trap:       ['Trap mode.', 'Hard in it.', 'Drip season.'],
  rnb:        ['R&B soul.', 'Smooth like that.', 'Feels.', 'Vibes only.'],
  soul:       ['Soul music.', 'Feeling it.', 'Deep in the soul.'],
  jazz:       ['Jazz hour.', 'Improvising.', 'Late night jazz.'],
  gospel:     ['Spirit moving.', 'Sacred ground.', 'Praise up.', 'Soul work.'],
  mbalax:     ['Dakar calling.', 'Mbalax in the house.', 'Sénégal on the set.'],
  bikutsi:    ['Cameroon vibes.', 'Bikutsi time.', 'Yaoundé energy.'],
  makossa:    ['Makossa move.', 'Douala on it.', 'Cameroon classic.'],
  drill:      ['Drill on.', 'UK certified.', 'London vibes.'],
  grime:      ['Grime wave.', 'London on top.', 'East London.'],
  zouk:       ['Zouk flow.', 'Lusophone love.', 'Move close.'],
  hiplife:    ['Hiplife bounce.', 'Ghana on deck.', 'Accra energy.', 'Ghana hip.'],
  gengetone:  ['Nairobi in the set.', 'Gengetone wave.', 'Kenya certified.'],
  soca:       ['Soca jump.', 'Caribbean on fire.', 'Trini vibes.'],
  funk:       ['Funk in the set.', 'Groove heavy.', 'On the one.'],
  pop:        ['Pop wave.', 'Mainstream on deck.', 'Radio ready.'],
  rock:       ['Rock out.', 'Guitar up.', 'Electric in the room.'],
  classical:  ['Classical interlude.', 'Orchestral moment.', 'Timeless.'],
  electronic: ['Electronic drop.', 'Synth mode.', 'Plug in.', 'Digital heat.'],
  afrofolk:   ['Roots acoustic.', 'Folk from the motherland.', 'West African roots.'],
  // Angola / Lusophone Africa
  kuduro:     ['Kuduro hour.', 'Luanda walls shaking.', 'Angola on fire.', 'Batukadeiras energy.'],
  semba:      ['Semba time.', 'Angola roots.', 'The original kizomba.'],
  tarraxo:    ['Tarraxo wave.', 'Slow and precise.', 'Lusophone groove.'],
  // East Africa
  benga:      ['Benga on.', 'Kenya classic.', 'Lake Victoria groove.'],
  taarab:     ['Taarab moment.', 'Swahili coast.', 'East Africa gold.'],
  // North Africa
  rai:        ['Rai hour.', 'Algeria calling.', 'North Africa wave.', 'Wahrani groove.'],
  chaabi:     ['Chaabi flow.', 'Algiers on the set.', 'North African roots.'],
  gnawa:      ['Gnawa ceremony.', 'Morocco deep.', 'Spirit frequencies.'],
  // West Africa
  juju:       ['Juju wave.', 'Lagos classic.', 'Yoruba guitar.', 'King Sunny Ade roads.'],
  palmwine:   ['Palm-wine mood.', 'Old school Ghana.', 'Acoustic Africa.'],
  // Diaspora / Cross-regional
  afrosoul:   ['Afro soul.', 'The feeling runs deep.', 'Soulful Africa.'],
  // Lekompo / Singeli / Underground
  lekompo:    ['Lekompo bounce.', 'SA township.', 'Limpopo sound.'],
  singeli:    ['Singeli speed.', 'Dar es Salaam underground.', 'East Africa underground.'],
  other:      ['Something different.', 'Outside the box.', 'Unexpected.'],
};

function getGenreVocab(genre: string | null | undefined): string | null {
  if (!genre) return null;
  const norm = genre.toLowerCase().replace(/[\s\-&]+/g, '');
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
    `${artist} doesn't miss.`,
    `Make some noise for ${artist}!`,
    `This is ${artist} doing what ${artist} does.`,
    `${artist} — watch this.`,
  ]);
}

function unknownArtistCallout(artist: string): string {
  return rotate('artist_unknown', [
    `${artist}, for you people.`,
    `Big up ${artist}.`,
    `${artist} — the people need to know.`,
    `Make some noise for ${artist}!`,
    `${artist} on the radar now.`,
    `${artist} — this one's going somewhere.`,
    `${artist} is doing something real.`,
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
  'east-africa': ['East Africa in the building.', 'East side represent.', 'East Africa on top.'],
  'central-africa': ['Central Africa calling.', 'Heart of Africa.', 'Congo Basin energy.'],
  'north-africa': ['North Africa in the set.', 'Maghreb vibes.', 'North Africa certified.'],
  algeria:        ['Algeria in the set.', 'Algiers vibes.', 'North Africa representing.'],
  morocco:        ['Morocco in the set.', 'Marrakech energy.', 'The Maghreb is here.'],
  caribbean:     ['Caribbean fire.', 'Island energy.', 'Tropic vibes.'],
  jamaica:       ['Jamaica in the set.', 'Yard vibes.', 'Kingston calling.'],
  uk:            ['UK certified.', 'London in the building.', 'UK in the set.'],
  mzansi:        ['Mzansi certified.', 'SA in the building.', 'South Africa on top.'],
  'lusophone-africa': ['Lusophone Africa in the set.', 'Portuguese Africa vibes.', 'Luanda / Maputo energy.'],
  usa:           ['USA vibes.', 'American sound.', 'Stateside energy.'],
  spiritual:     ['Spirit moving.', 'Sacred energy.', 'Soul work.'],
  latin:         ['Latin heat.', 'Caribbean fire.', 'Perreo energy.'],
};

// Genre → primary region — fallback when cultural_tags are absent/junk
const GENRE_REGION: Record<string, string> = {
  afrobeats:    'nigeria',
  afrobeat:     'nigeria',
  afropop:      'west-africa',
  afrofusion:   'west-africa',
  fuji:         'nigeria',
  afrojuju:     'nigeria',
  amapiano:     'south-africa',
  gqom:         'south-africa',
  kwaito:       'south-africa',
  afrohouse:    'south-africa',
  'afro-house': 'south-africa',
  kizomba:      'angola',
  zouk:         'angola',
  'bongo-flava':'tanzania',
  mbalax:       'senegal',
  highlife:     'ghana',
  hiplife:      'ghana',
  bikutsi:      'cameroon',
  makossa:      'cameroon',
  soukous:      'dr-congo',
  congolese:    'dr-congo',
  ndombolo:     'dr-congo',
  rumba:        'dr-congo',
  gengetone:    'kenya',
  gospel:       'spiritual',
  hiphop:       'diaspora',
  'hip-hop':    'diaspora',
  trap:         'diaspora',
  rnb:          'diaspora',
  'r&b':        'diaspora',
  soul:         'diaspora',
  jazz:         'diaspora',
  drill:        'uk',
  grime:        'uk',
  dancehall:    'jamaica',
  reggae:       'jamaica',
  reggaeton:    'caribbean',
  soca:         'caribbean',
  afrofolk:     'west-africa',
  // New catalog genres
  kuduro:       'angola',
  semba:        'angola',
  tarraxo:      'angola',
  benga:        'kenya',
  taarab:       'east-africa',
  juju:         'nigeria',
  palmwine:     'ghana',
  rai:          'algeria',
  chaabi:       'algeria',
  gnawa:        'north-africa',
  afrosoul:     'diaspora',
  lekompo:      'south-africa',
  singeli:      'tanzania',
};

function getRegionCallout(culturalTags: string[] | null | undefined, genre?: string | null): string | null {
  // Try cultural_tags first (most specific)
  if (culturalTags?.length) {
    for (const tag of culturalTags) {
      const norm = tag.toLowerCase();
      if (REGION_CALLOUT[norm]) {
        return rotate(`region_${norm}`, REGION_CALLOUT[norm]);
      }
    }
  }
  // Fallback: derive region from primary_genre
  if (genre) {
    const region = GENRE_REGION[genre.toLowerCase()];
    if (region && REGION_CALLOUT[region]) {
      return rotate(`region_${region}`, REGION_CALLOUT[region]);
    }
  }
  return null;
}

// ── Cultural prefix overrides ────────────────────────────────────────────────
// Split into hype-only (energy-gated) and neutral buckets.
// Hype vocab only fires when isHypeSong(ctx) — ctx required for hype bucket.

const HYPE_PREFIXES: Record<string, string[]> = {
  // Thematic
  celebration: ['Firebondeem —', 'Kulossaaa —', 'We celebrating —'],
  festival:    ['Firebondeem —', 'Festival energy —', 'The whole block is out —'],
  liberation:  ['E dey fire —', 'Free vibes —', 'Liberation mode —'],
  revolution:  ['E dey fire —', 'The people speak —'],
  anthem:      ['Kulossaaa —', 'This one hits different —'],
  // Geographic hype (fires from recentCulturalTags when energy is high)
  nigeria:            ['Naija turning up —', 'Lagos on ten —', 'Firebondeem —'],
  naija:              ['Naija on fire —', 'Lagos turning up —'],
  angola:             ['Angola stepping up —', 'Luanda energy —'],
  'west-africa':      ['The continent is LIT —', 'West Africa on ten —'],
  diaspora:           ['Diaspora turning up —', 'E dey fire —'],
  'south-africa':     ['SA stepping up —', 'Mzansi energy —'],
  mzansi:             ['Mzansi turning up —', 'SA on ten —'],
};

const NEUTRAL_PREFIXES: Record<string, string[]> = {
  // Thematic (legacy — kept for edge cases)
  roots:         ['Back to the ground.', 'African roots.', 'Grounded.'],
  motherland:    ['Motherland energy.', 'Back home.', 'From the source.'],
  healing:       ['Soul shift.', 'Medicine music.', 'Let this land.'],
  'pan-african': ['Pan-African move.', 'All of us.', 'The continent in one track.'],
  prayer:        ['Sacred ground.', 'Soul work.', 'Spirit first.'],
  anthem:        ['Anthem time.', 'We stand up.', 'Everyone knows this one.'],
  street:        ['Street certified.', 'Real talk.', 'From the ground up.'],
  tradition:     ['Tradition first.', 'Roots deep.', 'The ancestors knew.'],
  protest:       ['The people speak.', 'Real voices.', 'Truth in the music.'],
  survival:      ['Built from the struggle.', 'Resilience.', 'They made it through.'],
  migration:     ['Moving stories.', 'The journey in sound.', 'Wherever home is.'],
  homecoming:    ['Coming back.', 'Full circle.', 'Home sounds like this.'],
  wedding:       ['Celebration mode.', 'For the love.', 'Joy in this one.'],
  bridge:        ['Two worlds meeting.', 'The link.', 'Culture crossing.'],
  ghetto:        ['From the ground up.', 'Real streets.', 'They know.'],
  // Geographic — matches real cultural_tags from video_intelligence DB
  nigeria:             ['Nigeria wave.', 'Naija run.', 'Lagos keeps going.'],
  naija:               ['Naija wave.', 'Lagos keeps going.'],
  angola:              ['Angola run.', 'Luanda sound.', 'Lusophone wave.'],
  'west-africa':       ['West Africa wave.', 'Continental sound.', 'The continent on top.'],
  diaspora:            ['Bridging the distance.', 'Diaspora energy.', 'Two worlds, one sound.'],
  'lusophone-africa':  ['Lusophone sound.', 'Portuguese Africa wave.'],
  algeria:             ['Maghreb wave.', 'North Africa run.'],
  'north-africa':      ['North Africa wave.', 'Maghreb in the mix.'],
  ghana:               ['Ghana wave.', 'Accra sound.'],
  senegal:             ['Dakar sound.', 'Sénégal wave.'],
  kenya:               ['East Africa sound.', 'Nairobi wave.'],
  'east-africa':       ['East side wave.', 'East Africa run.'],
  'south-africa':      ['SA sound.', 'Jozi wave.'],
  mzansi:              ['Mzansi wave.', 'SA sound.'],
  spiritual:           ['Spirit moving.', 'Sacred ground.', 'Soul work.'],
  uk:                  ['UK wave.', 'London sound.'],
  usa:                 ['Stateside sound.', 'American wave.'],
  // Additional geographic coverage
  morocco:             ['Morocco wave.', 'Marrakech energy.', 'Maghreb sound.'],
  tanzania:            ['Dar es Salaam wave.', 'Tanzania run.', 'Bongo sound.'],
  cameroon:            ['Cameroon wave.', 'Douala sound.', 'Yaoundé run.'],
  'ivory-coast':       ['Abidjan wave.', 'Côte d\'Ivoire sound.', 'Abidjan energy.'],
  ethiopia:            ['Addis wave.', 'Ethiopia run.', 'Habesha sound.'],
  uganda:              ['Kampala wave.', 'Uganda sound.'],
  'dr-congo':          ['Kinshasa wave.', 'DRC sound.', 'Congo run.'],
  'central-africa':    ['Central Africa wave.', 'Heart of the continent.'],
  'cape-verde':        ['Cabo Verde wave.', 'Atlantic African sound.'],
  guinea:              ['Conakry wave.', 'Guinea energy.'],
  mali:                ['Bamako sound.', 'Mali wave.', 'Sahel music.'],
  caribbean:           ['Caribbean wave.', 'Island sound.'],
  jamaica:             ['Jamaica wave.', 'Kingston sound.'],
  latin:               ['Latin wave.', 'Diaspora groove.'],
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
  'afrobeats→gqom':      'SA calling loud.',
  'gqom→afrobeats':      'Back to Lagos.',
  'amapiano→gqom':       'Township takeover.',
  'gqom→amapiano':       'Piano hour.',
  'afrobeats→congolese': 'Congo roots.',
  'congolese→afrobeats': 'Back to the mainland.',
  'afrobeats→mbalax':    'Dakar in the mix.',
  'afrobeats→gengetone': 'East Africa showing up.',
  'gengetone→afrobeats': 'Back west.',
  'hiphop→rnb':          'Smooth mode.',
  'rnb→hiphop':          'Bars up.',
  'hiphop→drill':        'UK switch.',
  'drill→afrobeats':     'Back to the roots.',
  'kizomba→zouk':        'Lusophone deep.',
  'zouk→kizomba':         'Angola calling.',
  'dancehall→afrobeats':  'Linking the diaspora.',
  'afrobeats→dancehall':  'Island energy.',
  'amapiano→afropop':     'SA meets West Africa.',
  'afropop→amapiano':     'Piano incoming.',
  'reggae→afrobeats':     'Linking the diaspora.',
  'afrobeats→highlife':   'Ghana on it.',
  'highlife→afrobeats':   'Nigerian wave.',
  'afrobeats→pop':        'Crossing over.',
  'pop→afrobeats':        'Back to the culture.',
  'rnb→pop':              'Mainstream mode.',
  'pop→rnb':              'Soul in it.',
  'hiphop→pop':           'Radio check.',
  'pop→hiphop':           'Real rap.',
  'afrobeats→electronic': 'Electronic wave.',
  'electronic→afrobeats': 'Back to the roots.',
  'dancehall→reggae':     'Roots and culture.',
  'reggae→dancehall':     'Dance floor calling.',
  'soukous→ndombolo':     'Congo keeps going.',
  'ndombolo→soukous':     'Vintage Congo.',
  'amapiano→afrohouse':   'SA warehouse.',
  'afrohouse→amapiano':   'Log drum calling.',
  'hiphop→trap':          'Drip incoming.',
  'trap→hiphop':          'Classic era.',
  'gospel→rnb':           'From sacred to soul.',
  'rnb→gospel':           'Spirit in it.',
  // New genre bridges — kwaito, soca, hiplife, fuji, afrofolk, bikutsi
  'afrobeats→kwaito':     'SA deep.',
  'kwaito→afrobeats':     'Back to Lagos.',
  'amapiano→kwaito':      'Township roots.',
  'kwaito→amapiano':      'Piano wave.',
  'afrobeats→soca':       'Caribbean fire.',
  'soca→afrobeats':       'Back to the mainland.',
  'dancehall→soca':       'Island takeover.',
  'soca→dancehall':       'Bashment mode.',
  'afrobeats→hiplife':    'Accra on deck.',
  'hiplife→afrobeats':    'West Africa united.',
  'highlife→hiplife':     'Ghana evolves.',
  'hiplife→highlife':     'Ghana roots.',
  'afrobeats→fuji':       'Yoruba heartland.',
  'fuji→afrobeats':       'Back to the wave.',
  'afrobeats→reggaeton':  'Perreo time.',
  'reggaeton→afrobeats':  'Back to Africa.',
  'afrobeats→afrofolk':   'Roots and acoustic.',
  'afrofolk→afrobeats':   'Back to the heat.',
  'bikutsi→afrobeats':    'Cameroon to Nigeria.',
  'afrobeats→bikutsi':    'Douala energy.',
  // Afropop transitions
  'afropop→afrobeats':    'Heat rising.',
  'afropop→highlife':     'Ghana roots.',
  'afropop→gospel':       'Spirit calling.',
  'gospel→afropop':       'Back in the groove.',
  'afropop→hiphop':       'Bars incoming.',
  'hiphop→afropop':       'Mainland vibes.',
  'afropop→rnb':          'Feeling something.',
  'rnb→afropop':          'Back to the continent.',
  'afropop→kizomba':      'Slowing it way down.',
  'kizomba→afropop':      'Opening it back up.',
  'gospel→hiphop':        'Faith to the streets.',
  'hiphop→gospel':        'Roots calling.',
  // Rumba / Soukous / Congolese family
  'afrobeats→rumba':      'Kinshasa calling.',
  'rumba→afrobeats':      'West Africa rising.',
  'afrobeats→soukous':    'Congo guitar mode.',
  'soukous→afrobeats':    'Back to the wave.',
  'afrobeats→ndombolo':   'Ndombolo time.',
  'ndombolo→afrobeats':   'Back to Lagos.',
  'rumba→soukous':        'Congo evolves.',
  'soukous→rumba':        'Roots calling.',
  // Makossa / Mbalax
  'makossa→afrobeats':    'West Africa united.',
  'afrobeats→makossa':    'Cameroon calling.',
  'mbalax→afrobeats':     'Dakar to Lagos.',
  // Soul / R&B family
  'afrobeats→soul':       'Deep and smooth.',
  'soul→afrobeats':       'Back to the heat.',
  'soul→rnb':             'Silky transition.',
  'rnb→soul':             'Going deeper.',
  // Compass genre adjacency completions (hiphop + bongo-flava pairs)
  'bongo-flava→afrobeats':   'West Africa calling.',
  'kizomba→bongo-flava':     'East Africa next.',
  'bongo-flava→kizomba':     'Slow it all the way down.',
  'hiphop→amapiano':         'SA wave incoming.',
  'amapiano→hiphop':         'Bars incoming.',
  'gospel→bongo-flava':      'East Africa spirit.',
  'bongo-flava→gospel':      'Spirit calling.',
  // Angola family
  'kizomba→kuduro':          'Luanda keeps going.',
  'kuduro→kizomba':          'Slow it down Angola style.',
  'semba→kizomba':           'The evolution.',
  'kizomba→semba':           'Back to the roots.',
  'afrobeats→kuduro':        'Angola incoming.',
  'kuduro→afrobeats':        'Back to the mainland.',
  // East Africa completions
  'afrobeats→taarab':        'Swahili coast calling.',
  'taarab→afrobeats':        'Back to the heat.',
  'afrobeats→benga':         'Kenya classic incoming.',
  'benga→afrobeats':         'West Africa respond.',
  'bongo-flava→benga':       'East Africa moves.',
  'benga→bongo-flava':       'Tanzania next.',
  'singeli→bongo-flava':     'From underground to mainstream.',
  'bongo-flava→singeli':     'Going underground.',
  // North Africa
  'afrobeats→rai':           'North Africa calling.',
  'rai→afrobeats':           'Back south.',
  'rai→chaabi':              'Algeria roots.',
  'chaabi→rai':              'Modern Algerian wave.',
  'afrobeats→gnawa':         'Morocco spiritual.',
  'gnawa→afrobeats':         'Back to the wave.',
  // West Africa specifics
  'afrobeats→juju':          'Yoruba heartland.',
  'juju→afrobeats':          'Back to the new wave.',
  'highlife→palmwine':       'Ghana going back.',
  'palmwine→highlife':       'Ghana evolves.',
  'afrobeats→palmwine':      'Acoustic Africa.',
  // SA deep
  'amapiano→lekompo':        'SA township deep.',
  'lekompo→amapiano':        'Piano wave calling.',
  'gqom→lekompo':            'SA underground.',
  'kwaito→lekompo':          'Township evolution.',
  // Diaspora connections
  'afrobeats→afrosoul':      'Soul crossing over.',
  'afrosoul→afrobeats':      'Back to the heat.',
  'rnb→afrosoul':            'African soul.',
  'afrosoul→rnb':            'Smooth like that.',
  // Lekompo/Singeli
  'singeli→afrobeats':       'East meets West.',
  'afrobeats→singeli':       'Underground East Africa.',
};

function normalizeGenreKey(g: string): string {
  return g.toLowerCase().replace(/[\s\-&]+/g, '');
}

function bridgeAnnouncement(tags: string[], ctx?: TrackContext, prevGenre?: string | null): DJAnnouncement {
  let text: string | null = null;

  // Genre-pair bridge: if we know source and destination genres
  if (prevGenre && ctx?.genre && prevGenre !== ctx.genre) {
    // Try exact key first, then normalized (strips &, -, spaces)
    const exactKey = `${prevGenre}→${ctx.genre}`;
    const normKey = `${normalizeGenreKey(prevGenre)}→${normalizeGenreKey(ctx.genre)}`;
    text = GENRE_BRIDGE[exactKey] ?? GENRE_BRIDGE[normKey] ?? null;
  }

  if (!text) {
    // Bridge intro uses the DESTINATION tags (ctx.culturalTags), not the user's
    // recent history — we want "Angola run." not "Nigeria wave." when pivoting to Angola.
    const destTags = (ctx?.culturalTags?.length ? ctx.culturalTags : null) ?? tags;
    const intro = getCulturalIntro(destTags, ctx);
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
  const isUnderground = ctx?.artistTier === 'D' || ctx?.artistTier === 'C' || (ctx?.heatScore ?? 100) < 30;
  const isBigName = ctx?.artistTier === 'A';

  if (ctx?.artist && isBigName) {
    // A-tier appearing in echo = unexpected deep cut
    text = rotate('echo_big', [
      `${ctx.artist} — the deeper side.`,
      `Even ${ctx.artist} has cuts people miss.`,
      `${ctx.artist}, but make it rare.`,
    ]);
  } else if (ctx?.artist && ctx.artistTier === 'B') {
    text = rotate('echo_b_tier', [
      `${ctx.artist} — the other side.`,
      `${ctx.artist} goes deeper than people check.`,
      `${ctx.artist}, but make it rare.`,
    ]);
  } else if (ctx?.artist && isUnderground) {
    // D/C tier or low heat = underground discovery
    text = rotate('echo_artist', [
      `${ctx.artist}, for you people.`,
      `${ctx.artist} goes deeper than people know.`,
      `Big up ${ctx.artist}.`,
      `${ctx.artist} — on the radar now.`,
      `${ctx.artist}, they slept.`,
    ]);
  } else if (ctx?.genre && getGenreVocab(ctx.genre)) {
    // Known genre but hidden gem
    const genrePhrase = getGenreVocab(ctx.genre)!;
    text = rotate('echo_genre', [
      `${genrePhrase} But deep.`,
      `Hidden ${ctx.genre} — OYO found it.`,
      `They slept on this one. ${genrePhrase}`,
    ]);
  } else {
    text = rotate('echo', [
      'Bro listen.',
      'They slept on this.',
      'This one\'s been waiting.',
      'OYO dug deep.',
      'Pay attention.',
      'This one hits different.',
      'Off the radar.',
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
  const comboPhrase = ctx ? getVibeComboPhrase(ctx) : null;
  if (comboPhrase && Math.random() > 0.4) {
    // Optionally prepend region for specificity
    const regionText = getRegionCallout(ctx?.culturalTags, ctx?.genre);
    text = regionText ? `${regionText} ${comboPhrase}` : comboPhrase;
    return {
      text,
      choices: [
        { label: 'Go harder', intent: 'boost_energy' },
        { label: 'Let it breathe', intent: 'drop_energy' },
      ],
      moveType: 'hot',
    };
  }
  if (ctx?.artist && ctx.artistTier === 'A') {
    text = artistCallout(ctx.artist);
  } else if (ctx && getGenreVocab(ctx.genre)) {
    // Genre fires — optionally prepend region for extra specificity ("Naija in the set. Lagos calling.")
    const genreText = getGenreVocab(ctx.genre)!;
    const regionText = getRegionCallout(ctx.culturalTags, ctx.genre);
    text = regionText ? `${regionText} ${genreText}` : genreText;
  } else if (ctx && isWorkoutSong(ctx)) {
    text = rotate('workout_locked', ['Lock in.', 'Movement track.', 'Energy up.', 'Pure drive.', 'Body moving.']);
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
  const comboPhrase = ctx ? getVibeComboPhrase(ctx) : null;
  if (comboPhrase && Math.random() > 0.5) {
    const regionText = getRegionCallout(ctx?.culturalTags, ctx?.genre);
    text = regionText ? `${regionText} ${comboPhrase}` : comboPhrase;
    return {
      text,
      choices: [
        { label: 'Hold this', intent: 'keep_energy' },
        { label: 'Go harder', intent: 'boost_energy' },
      ],
      moveType: 'hot',
    };
  }
  if (ctx?.artist && ctx.artistTier === 'A') {
    text = artistCallout(ctx.artist);
  } else if (ctx && getGenreVocab(ctx.genre)) {
    const genreText = getGenreVocab(ctx.genre)!;
    const regionText = getRegionCallout(ctx.culturalTags, ctx.genre);
    text = regionText ? `${regionText} ${genreText}` : genreText;
  } else if (ctx && isWorkoutSong(ctx)) {
    text = rotate('workout_vibing', ['Keep the energy up.', 'Movement mode.', 'Drive.', 'Don\'t stop.']);
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
  // Use time-of-day hint sparingly as a session opener — only fires occasionally
  const todHint = Math.random() < 0.35 ? getTimeOfDayHint() : null;
  const base = rotate('hot_warming', ['Reading you.', 'Still reading.', 'Getting warmer.', 'Give it a sec.', 'Hold tight.']);
  return {
    text: todHint ? `${todHint} ${base}` : base,
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
  const isNiche = ctx?.artistTier === 'D' || ctx?.artistTier === 'C' || (ctx?.heatScore ?? 50) < 30;

  if (ctx?.artist && isNiche) {
    // Underground or low-profile artist — DJ introduces them
    text = unknownArtistCallout(ctx.artist);
  } else if (ctx?.artist && ctx.artistTier === 'B') {
    text = rotate('discovery_b_tier', [
      `${ctx.artist} doesn't miss.`,
      `${ctx.artist} — certified.`,
      `${ctx.artist} holding it down.`,
      `${ctx.artist} on the come-up.`,
    ]);
  } else if (ctx?.artist && ctx.artistTier === 'A') {
    // Big name in discovery — unexpected angle
    text = rotate('discovery_big', [
      `${ctx.artist}, but from another angle.`,
      `${ctx.artist} in the discovery stream — that's OYO for you.`,
      `Even ${ctx.artist} has songs that deserve more.`,
    ]);
  } else if (ctx && getGenreVocab(ctx.genre)) {
    // Region + genre combo — most specific discovery callout
    const genreText = getGenreVocab(ctx.genre)!;
    const regionText = getRegionCallout(ctx.culturalTags, ctx.genre);
    text = regionText ? `${regionText} ${genreText}` : genreText;
  } else {
    // For discovery, prefer the track's own cultural tags (destination) over user history.
    const destTags = (ctx?.culturalTags?.length ? ctx.culturalTags : null) ?? tags;
    const intro = getCulturalIntro(destTags, ctx);
    const base = rotate('discovery', ['Taking you somewhere.', 'Going left for a sec.', 'Expanding the map.', 'Trust the move.', 'Something different.', 'OYO dug deep.', 'Wide world of music.']);
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
