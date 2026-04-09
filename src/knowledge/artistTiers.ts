/**
 * VOYO Artist Tier System
 *
 * Verified artist database with tiers:
 * - A: Global/Continental stars (100M+ views)
 * - B: National stars (10M-100M views)
 * - C: Regional stars (1M-10M views)
 * - D: Emerging/Underground (default)
 *
 * Built from research across 16 African countries.
 */

export type ArtistTier = 'A' | 'B' | 'C' | 'D';

interface ArtistInfo {
  tier: ArtistTier;
  name: string;
  country: string;
}

// Normalized lookup: lowercase, no special chars
const ARTIST_TIERS: Record<string, ArtistInfo> = {
  // === TIER A: GLOBAL ICONS ===
  // Nigeria
  'burna boy': { tier: 'A', name: 'Burna Boy', country: 'nigeria' },
  'wizkid': { tier: 'A', name: 'Wizkid', country: 'nigeria' },
  'davido': { tier: 'A', name: 'Davido', country: 'nigeria' },
  'rema': { tier: 'A', name: 'Rema', country: 'nigeria' },
  'asake': { tier: 'A', name: 'Asake', country: 'nigeria' },
  'tems': { tier: 'A', name: 'Tems', country: 'nigeria' },
  'ckay': { tier: 'A', name: 'CKay', country: 'nigeria' },
  'ayra starr': { tier: 'A', name: 'Ayra Starr', country: 'nigeria' },
  'fela kuti': { tier: 'A', name: 'Fela Kuti', country: 'nigeria' },
  'kizz daniel': { tier: 'A', name: 'Kizz Daniel', country: 'nigeria' },
  'omah lay': { tier: 'A', name: 'Omah Lay', country: 'nigeria' },
  'fireboy dml': { tier: 'A', name: 'Fireboy DML', country: 'nigeria' },
  'olamide': { tier: 'A', name: 'Olamide', country: 'nigeria' },
  'tiwa savage': { tier: 'A', name: 'Tiwa Savage', country: 'nigeria' },
  'yemi alade': { tier: 'A', name: 'Yemi Alade', country: 'nigeria' },
  'ruger': { tier: 'A', name: 'Ruger', country: 'nigeria' },
  'p square': { tier: 'A', name: 'P-Square', country: 'nigeria' },
  'dbanj': { tier: 'A', name: "D'banj", country: 'nigeria' },
  '2baba': { tier: 'A', name: '2Baba', country: 'nigeria' },

  // South Africa
  'black coffee': { tier: 'A', name: 'Black Coffee', country: 'south-africa' },
  'tyla': { tier: 'A', name: 'Tyla', country: 'south-africa' },
  'kabza de small': { tier: 'A', name: 'Kabza De Small', country: 'south-africa' },
  'dj maphorisa': { tier: 'A', name: 'DJ Maphorisa', country: 'south-africa' },
  'master kg': { tier: 'A', name: 'Master KG', country: 'south-africa' },
  'nasty c': { tier: 'A', name: 'Nasty C', country: 'south-africa' },
  'focalistic': { tier: 'A', name: 'Focalistic', country: 'south-africa' },
  'uncle waffles': { tier: 'A', name: 'Uncle Waffles', country: 'south-africa' },

  // Ghana
  'black sherif': { tier: 'A', name: 'Black Sherif', country: 'ghana' },
  'sarkodie': { tier: 'A', name: 'Sarkodie', country: 'ghana' },
  'stonebwoy': { tier: 'A', name: 'Stonebwoy', country: 'ghana' },
  'shatta wale': { tier: 'A', name: 'Shatta Wale', country: 'ghana' },
  'king promise': { tier: 'A', name: 'King Promise', country: 'ghana' },
  'kidi': { tier: 'A', name: 'KiDi', country: 'ghana' },
  'kuami eugene': { tier: 'A', name: 'Kuami Eugene', country: 'ghana' },

  // Tanzania
  'diamond platnumz': { tier: 'A', name: 'Diamond Platnumz', country: 'tanzania' },
  'harmonize': { tier: 'A', name: 'Harmonize', country: 'tanzania' },
  'rayvanny': { tier: 'A', name: 'Rayvanny', country: 'tanzania' },
  'zuchu': { tier: 'A', name: 'Zuchu', country: 'tanzania' },
  'ali kiba': { tier: 'A', name: 'Ali Kiba', country: 'tanzania' },

  // DRC
  'fally ipupa': { tier: 'A', name: 'Fally Ipupa', country: 'drc' },
  'koffi olomide': { tier: 'A', name: 'Koffi Olomide', country: 'drc' },
  'innossb': { tier: 'A', name: "Innoss'B", country: 'drc' },
  'gims': { tier: 'A', name: 'Gims', country: 'drc' },
  'dadju': { tier: 'A', name: 'Dadju', country: 'drc' },
  'papa wemba': { tier: 'A', name: 'Papa Wemba', country: 'drc' },

  // Guinea
  'saifond balde': { tier: 'A', name: 'Saifond Baldé', country: 'guinea' },
  'azaya': { tier: 'A', name: 'Azaya', country: 'guinea' },
  'sekouba bambino': { tier: 'A', name: 'Sékouba Bambino', country: 'guinea' },
  'mory kante': { tier: 'A', name: 'Mory Kanté', country: 'guinea' },
  'soul bangs': { tier: 'A', name: "Soul Bang's", country: 'guinea' },
  'djanii alfa': { tier: 'A', name: 'Djanii Alfa', country: 'guinea' },
  'instinct killers': { tier: 'A', name: 'Instinct Killers', country: 'guinea' },
  'straiker': { tier: 'A', name: 'Straiker', country: 'guinea' },
  'king alasko': { tier: 'A', name: 'King Alasko', country: 'guinea' },

  // Senegal
  'youssou ndour': { tier: 'A', name: "Youssou N'Dour", country: 'senegal' },
  'akon': { tier: 'A', name: 'Akon', country: 'senegal' },
  'wally seck': { tier: 'A', name: 'Wally Seck', country: 'senegal' },

  // Ivory Coast
  'dj arafat': { tier: 'A', name: 'DJ Arafat', country: 'ivory-coast' },
  'magic system': { tier: 'A', name: 'Magic System', country: 'ivory-coast' },
  'alpha blondy': { tier: 'A', name: 'Alpha Blondy', country: 'ivory-coast' },

  // Kenya
  'sauti sol': { tier: 'A', name: 'Sauti Sol', country: 'kenya' },
  'nyashinski': { tier: 'A', name: 'Nyashinski', country: 'kenya' },

  // Mali
  'salif keita': { tier: 'A', name: 'Salif Keita', country: 'mali' },
  'amadou mariam': { tier: 'A', name: 'Amadou & Mariam', country: 'mali' },

  // Ethiopia
  'teddy afro': { tier: 'A', name: 'Teddy Afro', country: 'ethiopia' },

  // === TIER B: NATIONAL STARS ===
  // Nigeria B
  'adekunle gold': { tier: 'B', name: 'Adekunle Gold', country: 'nigeria' },
  'simi': { tier: 'B', name: 'Simi', country: 'nigeria' },
  'wande coal': { tier: 'B', name: 'Wande Coal', country: 'nigeria' },
  'flavour': { tier: 'B', name: 'Flavour', country: 'nigeria' },
  'tekno': { tier: 'B', name: 'Tekno', country: 'nigeria' },
  'phyno': { tier: 'B', name: 'Phyno', country: 'nigeria' },
  'zlatan': { tier: 'B', name: 'Zlatan', country: 'nigeria' },
  'mr eazi': { tier: 'B', name: 'Mr Eazi', country: 'nigeria' },
  'joeboy': { tier: 'B', name: 'Joeboy', country: 'nigeria' },
  'bnxn': { tier: 'B', name: 'BNXN', country: 'nigeria' },
  'victony': { tier: 'B', name: 'Victony', country: 'nigeria' },
  'pheelz': { tier: 'B', name: 'Pheelz', country: 'nigeria' },
  'bella shmurda': { tier: 'B', name: 'Bella Shmurda', country: 'nigeria' },
  'seyi vibez': { tier: 'B', name: 'Seyi Vibez', country: 'nigeria' },
  'oxlade': { tier: 'B', name: 'Oxlade', country: 'nigeria' },
  'mayorkun': { tier: 'B', name: 'Mayorkun', country: 'nigeria' },
  'falz': { tier: 'B', name: 'Falz', country: 'nigeria' },
  'patoranking': { tier: 'B', name: 'Patoranking', country: 'nigeria' },
  'timaya': { tier: 'B', name: 'Timaya', country: 'nigeria' },

  // South Africa B
  'young stunna': { tier: 'B', name: 'Young Stunna', country: 'south-africa' },
  'dbn gogo': { tier: 'B', name: 'DBN Gogo', country: 'south-africa' },
  'cassper nyovest': { tier: 'B', name: 'Cassper Nyovest', country: 'south-africa' },
  'makhadzi': { tier: 'B', name: 'Makhadzi', country: 'south-africa' },
  'a reece': { tier: 'B', name: 'A-Reece', country: 'south-africa' },

  // Guinea B
  'takana zion': { tier: 'B', name: 'Takana Zion', country: 'guinea' },
  'mamady keita': { tier: 'B', name: 'Mamady Keïta', country: 'guinea' },
  'koury simple': { tier: 'B', name: 'Koury Simple', country: 'guinea' },
  'bembeya jazz': { tier: 'B', name: 'Bembeya Jazz National', country: 'guinea' },
  'mc freshh': { tier: 'B', name: 'MC Freshh', country: 'guinea' },
  'thiird': { tier: 'B', name: 'Thiird', country: 'guinea' },
  'maxim bk': { tier: 'B', name: 'Maxim BK', country: 'guinea' },
  'wada du game': { tier: 'B', name: 'Wada Du Game', country: 'guinea' },
  'hezbo rap': { tier: 'B', name: 'Hezbo Rap', country: 'guinea' },

  // Tanzania B
  'nandy': { tier: 'B', name: 'Nandy', country: 'tanzania' },
  'mbosso': { tier: 'B', name: 'Mbosso', country: 'tanzania' },
  'marioo': { tier: 'B', name: 'Marioo', country: 'tanzania' },

  // DRC B
  'ferre gola': { tier: 'B', name: 'Ferre Gola', country: 'drc' },
  'heritier watanabe': { tier: 'B', name: 'Héritier Watanabe', country: 'drc' },
  'werrason': { tier: 'B', name: 'Werrason', country: 'drc' },
  'aya nakamura': { tier: 'B', name: 'Aya Nakamura', country: 'drc' },
  'damso': { tier: 'B', name: 'Damso', country: 'drc' },

  // Ghana B
  'gyakie': { tier: 'B', name: 'Gyakie', country: 'ghana' },
  'camidoh': { tier: 'B', name: 'Camidoh', country: 'ghana' },
  'medikal': { tier: 'B', name: 'Medikal', country: 'ghana' },
  'kwesi arthur': { tier: 'B', name: 'Kwesi Arthur', country: 'ghana' },
  'r2bees': { tier: 'B', name: 'R2Bees', country: 'ghana' },
};

// Add aliases and variations
const ALIASES: Record<string, string> = {
  'burnaboy': 'burna boy',
  'wiz kid': 'wizkid',
  'starboy': 'wizkid',
  'obo': 'davido',
  'fela': 'fela kuti',
  'diamond': 'diamond platnumz',
  'blackcoffee': 'black coffee',
  'psquare': 'p square',
  'innoss b': 'innossb',
  'youssou n dour': 'youssou ndour',
  'mory kante': 'mory kante',
  'sekouba': 'sekouba bambino',
  'bambino': 'sekouba bambino',
};

/**
 * Normalize artist name for lookup
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/['''`]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s*(official|music|vevo|records|topic)$/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get artist tier from name
 */
export function getArtistTier(artistName: string): ArtistTier {
  if (!artistName) return 'D';

  const norm = normalize(artistName);

  // Direct lookup
  if (ARTIST_TIERS[norm]) {
    return ARTIST_TIERS[norm].tier;
  }

  // Check aliases
  const aliasKey = ALIASES[norm];
  if (aliasKey && ARTIST_TIERS[aliasKey]) {
    return ARTIST_TIERS[aliasKey].tier;
  }

  // Try without spaces
  const noSpace = norm.replace(/\s/g, '');
  if (ARTIST_TIERS[noSpace]) {
    return ARTIST_TIERS[noSpace].tier;
  }

  // Try first word only (for "Artist - Topic" style)
  const firstWord = norm.split(' ')[0];
  if (firstWord.length > 3 && ARTIST_TIERS[firstWord]) {
    return ARTIST_TIERS[firstWord].tier;
  }

  return 'D';
}

/**
 * Get full artist info
 */
export function getArtistInfo(artistName: string): ArtistInfo | null {
  if (!artistName) return null;

  const norm = normalize(artistName);

  if (ARTIST_TIERS[norm]) {
    return ARTIST_TIERS[norm];
  }

  const aliasKey = ALIASES[norm];
  if (aliasKey && ARTIST_TIERS[aliasKey]) {
    return ARTIST_TIERS[aliasKey];
  }

  return null;
}

/**
 * Get canon level from tier
 */
export function getCanonLevel(tier: ArtistTier): 'ESSENTIAL' | 'DEEP_CUT' | 'ECHO' {
  switch (tier) {
    case 'A': return 'ESSENTIAL';
    case 'B': return 'DEEP_CUT';
    default: return 'ECHO';
  }
}

/**
 * Get all verified artists
 */
export function getAllVerifiedArtists(): Array<{ name: string; tier: ArtistTier; country: string }> {
  const seen = new Set<string>();
  const artists: Array<{ name: string; tier: ArtistTier; country: string }> = [];

  for (const info of Object.values(ARTIST_TIERS)) {
    if (!seen.has(info.name)) {
      seen.add(info.name);
      artists.push({ name: info.name, tier: info.tier, country: info.country });
    }
  }

  return artists.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
    return a.name.localeCompare(b.name);
  });
}

// Stats
const stats = getAllVerifiedArtists().reduce(
  (acc, a) => {
    acc[a.tier]++;
    return acc;
  },
  { A: 0, B: 0, C: 0, D: 0 } as Record<ArtistTier, number>
);

console.log(`[ArtistTiers] Loaded: A=${stats.A}, B=${stats.B}, C=${stats.C}`);
