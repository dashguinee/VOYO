/**
 * VOYO Knowledge - Mood & Feeling Tags
 *
 * The taxonomy of emotions, moods, and feelings that power VOYO recommendations.
 * Brain doesn't search - it reads from pre-classified knowledge.
 */

// ============================================
// ARTIST TIER SYSTEM (Cultural Canon)
// ============================================

export type ArtistTier =
  | 'A'   // Continental/Global Icons - Burna, Wizkid, Davido, Tiwa, Fela
  | 'B'   // Regional Stars - Major influence in their region
  | 'C'   // National Artists - Known within their country
  | 'D';  // Underground/Emerging - Hidden gems, rising stars

// ============================================
// CANON LEVELS (Track Significance)
// ============================================

export type CanonLevel =
  | 'CORE'       // Essential listening - defines the genre/era (Ye by Burna Boy)
  | 'ESSENTIAL'  // Important works - strong cultural impact
  | 'DEEP_CUT'   // Fan favorites - album tracks, underrated gems
  | 'ARCHIVE'    // Historical preservation - older works, documenting evolution
  | 'ECHO';      // Hidden gems - ghosted, forgotten, suffocated by circumstance
                 // Not noise - echoes are artists who never got their shine

// ============================================
// CULTURAL TAGS (Meaning & Significance)
// ============================================

export type CulturalTag =
  // Movement markers
  | 'anthem'       // Became cultural anthem (e.g., "African Giant")
  | 'revolution'   // Political/social change music
  | 'liberation'   // Freedom, independence themes
  | 'protest'      // Direct protest music
  // Heritage markers
  | 'tradition'    // Traditional sounds preserved/fused
  | 'roots'        // Deep cultural roots
  | 'motherland'   // Africa-centric themes
  | 'pan-african'  // Unity across Africa
  // Diaspora markers
  | 'diaspora'     // Diaspora experience
  | 'migration'    // Immigration/movement stories
  | 'homecoming'   // Return to roots
  | 'bridge'       // Bridges cultures (Africa + West)
  // Street markers
  | 'street'       // Street life, hustle
  | 'ghetto'       // Hood stories
  | 'survival'     // Struggle narratives
  // Celebration markers
  | 'wedding'      // Wedding/ceremony music
  | 'festival'     // Festival anthems
  | 'celebration'  // Pure celebration
  // Spiritual markers
  | 'spiritual'    // Spiritual/religious
  | 'prayer'       // Prayer/worship
  | 'healing';     // Healing, restoration

// ============================================
// MULTI-DIMENSIONAL CANON SCORING
// (Based on Pandora Music Genome + Bourdieu research)
// ============================================

// Aesthetic Merit Tags (separate from cultural significance)
export type AestheticTag =
  | 'innovative'      // Genre-defining, pioneering sound
  | 'virtuosic'       // Technical mastery, instrumental skill
  | 'influential'     // Copied by others, started trends
  | 'production'      // Outstanding production quality
  | 'lyricism'        // Exceptional lyrical content
  | 'arrangement'     // Complex/beautiful arrangements
  | 'timeless';       // Sounds fresh regardless of era

// Content Type (what the track IS)
export type ContentType =
  | 'original'           // Original artist release
  | 'remix'              // Official/unofficial remix
  | 'live'               // Live performance (Colors, Tiny Desk, Glitch)
  | 'dj_mix'             // DJ mix/set
  | 'dj_compilation'     // DJ-curated compilation
  | 'playlist_channel'   // Playlist/compilation channel upload
  | 'cover'              // Cover version
  | 'instrumental'       // Beat/instrumental/karaoke
  | 'mashup'             // Multiple tracks combined
  | 'acoustic'           // Acoustic/unplugged version
  | 'slowed'             // Slowed + reverb version
  | 'extended';          // Extended mix

// Historical Era (for temporal context)
export type MusicalEra =
  | 'pre-independence'   // Before 1960s (colonial era music)
  | 'independence'       // 1960s-70s (African independence era)
  | 'golden-age'         // 1970s-80s (Fela, Highlife peak)
  | 'transition'         // 1990s (P-Square, early Afrobeats)
  | 'digital-dawn'       // 2000s-2010 (digital revolution begins)
  | 'streaming-era'      // 2010-2018 (Wizkid, Davido rise)
  | 'global-explosion'   // 2018-present (Grammy wins, global charts)
  | 'unknown';           // Can't determine

// The complete multi-dimensional score (inspired by Pandora's 450 genes)
export interface CanonScore {
  // DIMENSION 1: Popularity (objective - from YouTube/Spotify)
  popularity: {
    viewCount: number;
    percentile: number;        // 0-100 relative to corpus
    velocity?: number;         // growth rate (views per month)
    peakPosition?: number;     // chart position if known
  };

  // DIMENSION 2: Cultural Significance (LLM + human knowledge)
  culturalSignificance: {
    historical: number;        // 0-5: pioneer status, movement-defining
    social: number;            // 0-5: protest, liberation, unity impact
    diasporic: number;         // 0-5: bridges Africa and diaspora
    preservational: number;    // 0-5: documents endangered traditions
    overall: number;           // 0-5: combined cultural score
  };

  // DIMENSION 3: Aesthetic Merit (LLM analysis)
  aestheticMerit: {
    innovation: number;        // 0-5: genre-defining, pioneering
    craft: number;             // 0-5: virtuosity, production quality
    influence: number;         // 0-5: copied by others
    overall: number;           // 0-5: combined aesthetic score
  };

  // DIMENSION 4: Accessibility (Bourdieu-inspired)
  accessibility: {
    mainstream: number;        // 0-5: requires no cultural knowledge
    specialist: number;        // 0-5: rewards cultural competence
    educational: number;       // 0-5: teaches about culture
  };

  // DIMENSION 5: Temporal Context
  temporal: {
    releaseYear?: number;
    era: MusicalEra;
    timelessness: number;      // 0-5: still relevant today
  };

  // Computed from dimensions
  finalTier: ArtistTier;
  finalCanonLevel: CanonLevel;
  confidence: number;          // 0-1: how confident is this classification
  classifiedBy: 'pattern' | 'llm' | 'hybrid' | 'human';
  classifiedAt: number;        // timestamp
}

// Simplified score for tracks without full analysis
export interface QuickScore {
  tier: ArtistTier;
  canonLevel: CanonLevel;
  contentType: ContentType;
  confidence: number;
  viewCount?: number;
  culturalTags: CulturalTag[];
  aestheticTags: AestheticTag[];
}

// ============================================
// PRIMARY MOOD CATEGORIES
// ============================================

export type PrimaryMood =
  | 'energetic'    // High energy, makes you move
  | 'chill'        // Relaxed, laid back
  | 'romantic'     // Love songs, sensual
  | 'party'        // Club bangers, celebrations
  | 'spiritual'    // Gospel, worship, reflective
  | 'melancholic'  // Sad, heartbreak, longing
  | 'triumphant'   // Victory, success, motivation
  | 'nostalgic'    // Throwback vibes, memories
  | 'sensual'      // Slow wine, intimate
  | 'aggressive'   // Hard-hitting, intense
  | 'peaceful'     // Calm, meditation, ambient
  | 'playful';     // Fun, carefree, lighthearted

// ============================================
// FEELING TAGS (Granular emotions)
// ============================================

export type FeelingTag =
  // Energy feelings
  | 'hype' | 'lit' | 'fire' | 'turnt' | 'wild'
  // Chill feelings
  | 'mellow' | 'smooth' | 'easy' | 'floating' | 'dreamy'
  // Love feelings
  | 'in-love' | 'heartbreak' | 'longing' | 'desire' | 'devotion'
  // Party feelings
  | 'celebration' | 'dancing' | 'vibing' | 'euphoric' | 'ecstatic'
  // Spiritual feelings
  | 'grateful' | 'blessed' | 'worship' | 'hope' | 'faith'
  // Sad feelings
  | 'pain' | 'tears' | 'loss' | 'missing' | 'regret'
  // Power feelings
  | 'confident' | 'boss' | 'winner' | 'unstoppable' | 'legendary'
  // Memory feelings
  | 'throwback' | 'memories' | 'old-school' | 'classic' | 'timeless'
  // Intimate feelings
  | 'sexy' | 'seductive' | 'intimate' | 'slow-wine' | 'bedroom'
  // Intensity feelings
  | 'raw' | 'gritty' | 'street' | 'hardcore' | 'real';

// ============================================
// ENERGY LEVELS
// ============================================

export type EnergyLevel = 1 | 2 | 3 | 4 | 5;
// 1 = Very calm (meditation, ambient)
// 2 = Relaxed (chill, acoustic)
// 3 = Moderate (mid-tempo, easy listening)
// 4 = High (upbeat, danceable)
// 5 = Maximum (bangers, club anthems)

// ============================================
// AFRICAN MUSIC REGIONS
// ============================================

export type AfricanRegion =
  | 'west-africa'      // Nigeria, Ghana, Senegal, etc.
  | 'east-africa'      // Kenya, Tanzania, Uganda, etc.
  | 'south-africa'     // SA, Zimbabwe, Botswana, etc.
  | 'north-africa'     // Morocco, Egypt, Algeria, etc.
  | 'central-africa'   // Congo, Cameroon, etc.
  | 'francophone'      // French-speaking Africa
  | 'lusophone'        // Portuguese-speaking (Angola, Mozambique)
  | 'diaspora';        // African diaspora worldwide

// ============================================
// AFRICAN GENRES
// ============================================

export type AfricanGenre =
  // Nigerian
  | 'afrobeats' | 'afropop' | 'afro-fusion' | 'alte' | 'fuji' | 'juju'
  // Ghanaian
  | 'highlife' | 'hiplife' | 'azonto' | 'ghana-gospel'
  // South African
  | 'amapiano' | 'gqom' | 'kwaito' | 'maskandi' | 'sa-house'
  // East African
  | 'bongo-flava' | 'gengetone' | 'benga' | 'taarab'
  // Francophone
  | 'coupe-decale' | 'ndombolo' | 'makossa' | 'mbalax' | 'zouk'
  // Other
  | 'afro-house' | 'afro-soul' | 'afro-rnb' | 'african-gospel'
  | 'rumba' | 'soukous' | 'kuduro' | 'kizomba' | 'semba';

// ============================================
// VIBE COMBINATIONS (Common mood patterns)
// ============================================

export interface VibeProfile {
  primary: PrimaryMood;
  feelings: FeelingTag[];
  energy: EnergyLevel;
  region?: AfricanRegion;
  genre?: AfricanGenre;
}

// Pre-defined vibe profiles for quick matching
export const VIBE_PROFILES: Record<string, VibeProfile> = {
  'afro-heat': {
    primary: 'energetic',
    feelings: ['fire', 'lit', 'turnt', 'dancing'],
    energy: 5,
    genre: 'afrobeats'
  },
  'chill-vibes': {
    primary: 'chill',
    feelings: ['mellow', 'smooth', 'floating', 'easy'],
    energy: 2,
  },
  'love-songs': {
    primary: 'romantic',
    feelings: ['in-love', 'devotion', 'desire'],
    energy: 3,
  },
  'party-mode': {
    primary: 'party',
    feelings: ['celebration', 'euphoric', 'vibing', 'dancing'],
    energy: 5,
  },
  'worship': {
    primary: 'spiritual',
    feelings: ['grateful', 'blessed', 'worship', 'hope'],
    energy: 3,
  },
  'amapiano-groove': {
    primary: 'party',
    feelings: ['vibing', 'dancing', 'smooth'],
    energy: 4,
    genre: 'amapiano',
    region: 'south-africa'
  },
  'slow-wine': {
    primary: 'sensual',
    feelings: ['sexy', 'intimate', 'slow-wine'],
    energy: 2,
  },
  'street-anthems': {
    primary: 'aggressive',
    feelings: ['raw', 'street', 'real', 'boss'],
    energy: 4,
  },
  'throwback-jams': {
    primary: 'nostalgic',
    feelings: ['throwback', 'memories', 'classic', 'timeless'],
    energy: 3,
  },
  'motivation': {
    primary: 'triumphant',
    feelings: ['winner', 'unstoppable', 'confident', 'boss'],
    energy: 4,
  }
};

// ============================================
// MOOD DETECTION KEYWORDS
// ============================================

// Keywords that indicate specific moods (for classification)
export const MOOD_KEYWORDS: Record<PrimaryMood, string[]> = {
  energetic: ['fire', 'banger', 'hit', 'jam', 'vibe', 'energy', 'hype', 'lit', 'turn up', 'go crazy'],
  chill: ['chill', 'relax', 'mellow', 'smooth', 'easy', 'laid back', 'vibes', 'calm', 'peace'],
  romantic: ['love', 'baby', 'heart', 'forever', 'you', 'mine', 'together', 'darling', 'sweetheart'],
  party: ['party', 'dance', 'club', 'celebration', 'tonight', 'let\'s go', 'hands up', 'move'],
  spiritual: ['god', 'lord', 'jesus', 'praise', 'worship', 'blessed', 'hallelujah', 'amen', 'grace'],
  melancholic: ['sad', 'pain', 'cry', 'tears', 'hurt', 'broken', 'alone', 'miss', 'gone'],
  triumphant: ['win', 'champion', 'victory', 'success', 'king', 'queen', 'boss', 'legend', 'great'],
  nostalgic: ['remember', 'back', 'old', 'days', 'memories', 'time', 'classic', 'throwback'],
  sensual: ['body', 'touch', 'skin', 'close', 'slow', 'wine', 'waist', 'hold', 'night'],
  aggressive: ['street', 'real', 'hard', 'raw', 'gangsta', 'hustle', 'grind', 'savage'],
  peaceful: ['peace', 'quiet', 'still', 'rest', 'tranquil', 'serene', 'gentle', 'soft'],
  playful: ['fun', 'play', 'laugh', 'crazy', 'silly', 'enjoy', 'happy', 'joy', 'smile']
};

// ============================================
// HELPER FUNCTIONS
// ============================================

export function detectMoodFromText(text: string): PrimaryMood[] {
  const lowerText = text.toLowerCase();
  const detectedMoods: PrimaryMood[] = [];

  for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
    const matches = keywords.filter(kw => lowerText.includes(kw));
    if (matches.length >= 2) {
      detectedMoods.push(mood as PrimaryMood);
    }
  }

  return detectedMoods.length > 0 ? detectedMoods : ['energetic']; // Default
}

export function estimateEnergy(title: string, genre?: AfricanGenre): EnergyLevel {
  const lowerTitle = title.toLowerCase();

  // High energy indicators
  if (['banger', 'fire', 'lit', 'turn up', 'party'].some(w => lowerTitle.includes(w))) {
    return 5;
  }

  // Genre-based defaults
  if (genre) {
    const highEnergy: AfricanGenre[] = ['gqom', 'gengetone', 'coupe-decale'];
    const medHighEnergy: AfricanGenre[] = ['afrobeats', 'amapiano', 'ndombolo'];
    const medEnergy: AfricanGenre[] = ['highlife', 'bongo-flava', 'mbalax'];
    const lowEnergy: AfricanGenre[] = ['afro-soul', 'afro-rnb', 'kizomba'];

    if (highEnergy.includes(genre)) return 5;
    if (medHighEnergy.includes(genre)) return 4;
    if (medEnergy.includes(genre)) return 3;
    if (lowEnergy.includes(genre)) return 2;
  }

  // Low energy indicators
  if (['chill', 'slow', 'acoustic', 'ballad', 'love'].some(w => lowerTitle.includes(w))) {
    return 2;
  }

  return 3; // Default moderate
}

export function getCompatibleMoods(mood: PrimaryMood): PrimaryMood[] {
  const compatibility: Record<PrimaryMood, PrimaryMood[]> = {
    energetic: ['party', 'triumphant', 'playful'],
    chill: ['peaceful', 'romantic', 'nostalgic'],
    romantic: ['sensual', 'chill', 'melancholic'],
    party: ['energetic', 'playful', 'triumphant'],
    spiritual: ['peaceful', 'triumphant', 'nostalgic'],
    melancholic: ['romantic', 'nostalgic', 'peaceful'],
    triumphant: ['energetic', 'party', 'aggressive'],
    nostalgic: ['chill', 'melancholic', 'peaceful'],
    sensual: ['romantic', 'chill', 'party'],
    aggressive: ['energetic', 'triumphant', 'party'],
    peaceful: ['chill', 'spiritual', 'nostalgic'],
    playful: ['energetic', 'party', 'chill']
  };

  return compatibility[mood] || [];
}

// ============================================
// CULTURAL TAG KEYWORDS (Canon System)
// ============================================

export const CULTURAL_TAG_KEYWORDS: Record<CulturalTag, string[]> = {
  // Movement markers
  anthem: ['anthem', 'national', 'independence', 'unity', 'movement', 'stand up', 'rise'],
  revolution: ['revolution', 'change', 'fight', 'power', 'system', 'struggle', 'movement'],
  liberation: ['freedom', 'free', 'liberation', 'independent', 'break chains', 'emancipation'],
  protest: ['protest', 'injustice', 'police', 'government', 'corruption', 'oppression'],
  // Heritage markers
  tradition: ['traditional', 'heritage', 'ancestors', 'elders', 'culture', 'roots'],
  roots: ['roots', 'origin', 'motherland', 'home', 'village', 'homeland'],
  motherland: ['africa', 'mama africa', 'motherland', 'continent', 'home'],
  'pan-african': ['pan-african', 'united', 'one africa', 'unity', 'together'],
  // Diaspora markers
  diaspora: ['diaspora', 'abroad', 'immigrant', 'overseas', 'foreign', 'away'],
  migration: ['migrate', 'journey', 'leaving', 'travel', 'crossing', 'border'],
  homecoming: ['return', 'home', 'coming back', 'welcome', 'finally'],
  bridge: ['bridge', 'connect', 'fusion', 'blend', 'together', 'unite'],
  // Street markers
  street: ['street', 'hood', 'block', 'corner', 'trap', 'ghetto'],
  ghetto: ['ghetto', 'slum', 'struggle', 'poverty', 'survive', 'hustle'],
  survival: ['survive', 'struggle', 'make it', 'overcome', 'fight', 'strong'],
  // Celebration markers
  wedding: ['wedding', 'marriage', 'bride', 'ceremony', 'celebration', 'forever'],
  festival: ['festival', 'party', 'carnival', 'celebration', 'dance', 'crowd'],
  celebration: ['celebrate', 'joy', 'happy', 'party', 'dance', 'blessed'],
  // Spiritual markers
  spiritual: ['spirit', 'soul', 'divine', 'god', 'faith', 'believe'],
  prayer: ['prayer', 'pray', 'lord', 'god', 'worship', 'devotion'],
  healing: ['heal', 'restoration', 'peace', 'calm', 'recover', 'strength']
};

// ============================================
// TIER A ARTISTS (Global Icons)
// ============================================

export const TIER_A_ARTISTS: string[] = [
  // Nigerian Icons
  'burna boy', 'wizkid', 'davido', 'tiwa savage', 'fela kuti', 'rema',
  'tems', 'ckay', 'ayra starr', 'asake', 'fireboy dml', 'olamide',
  // South African Icons
  'black coffee', 'master kg', 'dj maphorisa', 'kabza de small', 'miriam makeba',
  // Ghanaian Icons
  'sarkodie', 'stonebwoy', 'shatta wale', 'black sherif',
  // East African Icons
  'diamond platnumz', 'sauti sol', 'harmonize', 'rayvanny',
  // Diaspora Icons (who push African sound)
  'drake', 'beyonce', 'rihanna', 'chris brown', // when featuring African artists
  // Legends
  'femi kuti', 'angelique kidjo', 'youssou ndour', 'salif keita', 'king sunny ade'
];

// ============================================
// CANON CLASSIFICATION HELPERS
// ============================================

export function detectCulturalTags(text: string): CulturalTag[] {
  const lowerText = text.toLowerCase();
  const detectedTags: CulturalTag[] = [];

  for (const [tag, keywords] of Object.entries(CULTURAL_TAG_KEYWORDS)) {
    const matches = keywords.filter(kw => lowerText.includes(kw));
    if (matches.length >= 1) {
      detectedTags.push(tag as CulturalTag);
    }
  }

  return detectedTags;
}

export function estimateArtistTier(artistName: string, metrics?: {
  monthlyListeners?: number;
  spotifyFollowers?: number;
  youtubeViews?: number;
  grammyNominations?: number;
}): ArtistTier {
  const normalizedName = artistName.toLowerCase();

  // Tier A: Global icons
  if (TIER_A_ARTISTS.includes(normalizedName)) {
    return 'A';
  }

  // If we have metrics, use them
  if (metrics) {
    if (metrics.grammyNominations && metrics.grammyNominations > 0) return 'A';
    if (metrics.monthlyListeners && metrics.monthlyListeners > 10_000_000) return 'A';
    if (metrics.monthlyListeners && metrics.monthlyListeners > 1_000_000) return 'B';
    if (metrics.monthlyListeners && metrics.monthlyListeners > 100_000) return 'C';
  }

  // Default to D (underground/emerging) - most artists start here
  return 'D';
}

export function estimateCanonLevel(track: {
  artistTier?: ArtistTier;
  viewCount?: number;
  releaseYear?: number;
  isClassic?: boolean;
  isTrending?: boolean;
}): CanonLevel {
  // Classics from Tier A artists are CORE
  if (track.isClassic && track.artistTier === 'A') {
    return 'CORE';
  }

  // High view counts from major artists
  if (track.viewCount && track.viewCount > 100_000_000 && track.artistTier === 'A') {
    return 'CORE';
  }

  // Trending from known artists
  if (track.isTrending && (track.artistTier === 'A' || track.artistTier === 'B')) {
    return 'ESSENTIAL';
  }

  // Older tracks (before 2015) with decent plays
  if (track.releaseYear && track.releaseYear < 2015) {
    if (track.viewCount && track.viewCount > 1_000_000) {
      return 'ARCHIVE';
    }
    return 'ECHO'; // Old tracks with few views are echoes - hidden gems
  }

  // Underground artists
  if (track.artistTier === 'D') {
    return 'ECHO'; // Underground = echo (deserving of recognition)
  }

  // Regional/National artists
  if (track.artistTier === 'C') {
    return 'DEEP_CUT';
  }

  // Default
  return 'ESSENTIAL';
}
