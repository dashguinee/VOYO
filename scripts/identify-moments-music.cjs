#!/usr/bin/env node

/**
 * VOYO Music Identification Pipeline
 *
 * Links voyo_moments to tracks in video_intelligence by parsing
 * moment descriptions for artist @mentions, hashtags, and song references.
 *
 * Strategy:
 *   Phase 1 - Extract artist names from descriptions (@mentions, #hashtags, text patterns)
 *   Phase 2 - Match extracted artists against video_intelligence tracks
 *   Phase 3 - Update voyo_moments with parent_track_id + metadata
 *
 * Usage:
 *   node scripts/identify-moments-music.cjs                 # Full run
 *   node scripts/identify-moments-music.cjs --dry-run       # Preview without updating
 *   node scripts/identify-moments-music.cjs --limit 50      # Process only 50 moments
 *   node scripts/identify-moments-music.cjs --verbose        # Show every match attempt
 *   node scripts/identify-moments-music.cjs --dry-run --limit 20 --verbose
 */

const { createClient } = require('@supabase/supabase-js');

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const FETCH_BATCH_SIZE = 100;
const UPDATE_BATCH_SIZE = 50;

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ─── Artist Handle Dictionary ────────────────────────────────────────────────
// Maps Instagram handles (lowercase, no @) to canonical artist names.
// This is the MOST CRITICAL piece - Instagram handles rarely match artist names.

const ARTIST_HANDLE_MAP = {
  // ═══════════════════════════════════════════════════════════════════
  // TIER A - GLOBAL SUPERSTARS
  // ═══════════════════════════════════════════════════════════════════

  // Burna Boy
  'burnaboygram': 'Burna Boy',
  'burnaboy': 'Burna Boy',
  'buraboryficial': 'Burna Boy',

  // Wizkid
  'wizkidayo': 'Wizkid',
  'wizkidofficial': 'Wizkid',
  'wiikiid': 'Wizkid',
  'staraboryficial': 'Wizkid',

  // Davido
  'davido': 'Davido',
  'davidoofficial': 'Davido',
  'davaboryficial': 'Davido',

  // Rema
  'heisrema': 'Rema',
  'raboryficial': 'Rema',
  'raborygram': 'Rema',

  // Asake
  'asaboryficial': 'Asake',
  'asakeofficlal': 'Asake',
  'asakeofficlal': 'Asake',
  'asakemusicofficial': 'Asake',

  // Ayra Starr
  'ayrastarr': 'Ayra Starr',
  'ayrastaar': 'Ayra Starr',

  // Tems
  'temsbaby': 'Tems',
  'tems': 'Tems',

  // CKay
  'ckay_yo': 'CKay',
  'ckayofficial': 'CKay',

  // Omah Lay
  'omaboryficial': 'Omah Lay',
  'omah_lay': 'Omah Lay',

  // Fireboy DML
  'fireboydml': 'Fireboy DML',
  'fireloydml': 'Fireboy DML',
  'fireaboryficial': 'Fireboy DML',

  // Tyla
  'tyla': 'Tyla',
  'tylaofficials': 'Tyla',
  'tylaseethal': 'Tyla',

  // ═══════════════════════════════════════════════════════════════════
  // TIER A - CONTINENTAL STARS
  // ═══════════════════════════════════════════════════════════════════

  // Tiwa Savage
  'tiwasavage': 'Tiwa Savage',
  'officialtiwasavage': 'Tiwa Savage',

  // Yemi Alade
  'yaboryficial': 'Yemi Alade',
  'yemialade': 'Yemi Alade',

  // Mr Eazi
  'maboryficial': 'Mr Eazi',
  'mreazi': 'Mr Eazi',

  // Patoranking
  'patorankingfire': 'Patoranking',
  'patoranking': 'Patoranking',

  // Diamond Platnumz
  'diamondplatnumz': 'Diamond Platnumz',
  'diamondplatznumz': 'Diamond Platnumz',

  // Black Sherif
  'blacksherif_': 'Black Sherif',
  'blacksherifofficial': 'Black Sherif',

  // Sarkodie
  'saraboryficial': 'Sarkodie',
  'sarkodie': 'Sarkodie',

  // Stonebwoy
  'stonaboryficial': 'Stonebwoy',
  'stonebwoy': 'Stonebwoy',

  // Kabza De Small
  'kabzadesmallsa': 'Kabza De Small',
  'kabzadesmall_sa': 'Kabza De Small',

  // DJ Maphorisa
  'djmaphorisa': 'DJ Maphorisa',
  'djmaphorisaofficial': 'DJ Maphorisa',

  // Black Coffee
  'realblackcoffee': 'Black Coffee',
  'blackcoffee': 'Black Coffee',

  // Sauti Sol
  'sautisol': 'Sauti Sol',

  // Nasty C
  'nasty_csa': 'Nasty C',
  'nastyc': 'Nasty C',

  // ═══════════════════════════════════════════════════════════════════
  // TIER A - NIGERIAN HEAVYWEIGHTS
  // ═══════════════════════════════════════════════════════════════════

  // Olamide
  'olamide': 'Olamide',
  'olamidebadoo': 'Olamide',

  // Don Jazzy / Mavin
  'donjazzy': 'Don Jazzy',

  // Flavour
  'flavaboryficial': 'Flavour',
  'flavourabami': 'Flavour',
  '2aboryficialflavour': 'Flavour',

  // Phyno
  'phaboryficial': 'Phyno',
  'phyno': 'Phyno',

  // Zlatan
  'zlatanibiledigital': 'Zlatan',
  'zlatan_ibile': 'Zlatan',

  // Kizz Daniel
  'kaboryficial': 'Kizz Daniel',
  'kizzdaniel': 'Kizz Daniel',
  'kizzdanielofficial': 'Kizz Daniel',

  // Joeboy
  'jaboryficial': 'Joeboy',
  'joeboy': 'Joeboy',

  // Bnxn (fka Buju)
  'bnxn': 'Bnxn',
  'bnxnofficial': 'Bnxn',
  'boyspyce': 'Boy Spyce',

  // Ruger
  'rugaboryficial': 'Ruger',
  'ruaboryficial': 'Ruger',
  'ruger_official': 'Ruger',

  // Oxlade
  'oxaboryficial': 'Oxlade',
  'oxladeofficial': 'Oxlade',

  // Lojay
  'lojay': 'Lojay',

  // Victony
  'victoaboryficial': 'Victony',
  'victonyofficial': 'Victony',

  // Raboryficial
  'crayon': 'Crayon',
  'caboryficial': 'Crayon',

  // Magixx
  'magixxofficial': 'Magixx',

  // ═══════════════════════════════════════════════════════════════════
  // TIER B - EAST AFRICAN STARS
  // ═══════════════════════════════════════════════════════════════════

  // Zuchu
  'officialzuchu': 'Zuchu',
  'zaboryficial': 'Zuchu',

  // Rayvanny
  'rayvanny': 'Rayvanny',

  // Harmonize
  'harmonaboryficial': 'Harmonize',
  'harmonize_tz': 'Harmonize',

  // Ali Kiba
  'aaboryficial': 'Ali Kiba',
  'alikiba': 'Ali Kiba',

  // Juma Jux
  'juma_jux': 'Juma Jux',

  // Nadia Mukami
  'nadia_mukami': 'Nadia Mukami',
  'nadiamukami': 'Nadia Mukami',

  // Saweetie / Bien
  'baboryficial': 'Bien',
  'bien': 'Bien',

  // Otile Brown
  'otaboryficial': 'Otile Brown',
  'otilebrown': 'Otile Brown',

  // ═══════════════════════════════════════════════════════════════════
  // TIER B - SOUTH AFRICAN STARS
  // ═══════════════════════════════════════════════════════════════════

  // Young Stunna
  'youngstunna_rsa': 'Young Stunna',

  // Focalistic
  'focalistic': 'Focalistic',

  // Cassper Nyovest
  'casspernyovest': 'Cassper Nyovest',

  // Busiswa
  'busiswaah': 'Busiswa',

  // AKA (RIP)
  'akaworldwide': 'AKA',

  // Mas Musiq
  'masaboryficial': 'Mas Musiq',
  'masmusiq': 'Mas Musiq',

  // Uncle Waffles
  'unclewaffles': 'Uncle Waffles',

  // DBN Gogo
  'dbngogo': 'DBN Gogo',

  // Makhadzi
  'makaboryficial': 'Makhadzi',
  'maboryficialmakhadzi': 'Makhadzi',

  // ═══════════════════════════════════════════════════════════════════
  // TIER B - GHANAIAN STARS
  // ═══════════════════════════════════════════════════════════════════

  // Shatta Wale
  'shaboryficial': 'Shatta Wale',
  'shattawalenima': 'Shatta Wale',

  // King Promise
  'iamkingpromise': 'King Promise',
  'kingpromise': 'King Promise',

  // Kwesi Arthur
  'kwesiarthur': 'Kwesi Arthur',
  'kwaboryficial': 'Kwesi Arthur',

  // Gyakie
  'gyakie_': 'Gyakie',
  'gyakieofficial': 'Gyakie',

  // Kuami Eugene
  'kuamieuaboryficial': 'Kuami Eugene',
  'kuamieugene': 'Kuami Eugene',

  // KiDi
  'kidicenca': 'KiDi',
  'kiaboryficial': 'KiDi',

  // ═══════════════════════════════════════════════════════════════════
  // TIER B - FRANCOPHONE AFRICAN
  // ═══════════════════════════════════════════════════════════════════

  // Fally Ipupa
  'fallyipupa': 'Fally Ipupa',
  'fallyipupaofficial': 'Fally Ipupa',

  // Innoss'B
  'innaboryficial': 'Innoss\'B',
  'innossb': 'Innoss\'B',

  // Gaz Mawete
  'gazmawete': 'Gaz Mawete',

  // Dadju
  'dadju': 'Dadju',
  'dadjuofficial': 'Dadju',

  // Aya Nakamura
  'ayanakamura': 'Aya Nakamura',
  'ayaboryficial': 'Aya Nakamura',

  // MHD
  'mhdofficiel': 'MHD',
  'mhd': 'MHD',

  // Youssoupha
  'youssoupha': 'Youssoupha',

  // Ninho
  'naboryficial': 'Ninho',
  'ninhocharo': 'Ninho',

  // Gazo
  'gazoofficial': 'Gazo',
  'gazo': 'Gazo',

  // Didi B
  'didib_officiel': 'Didi B',
  'didib': 'Didi B',

  // Josey
  'joseyofficiel': 'Josey',

  // Serge Beynaud
  'sergebeynaud': 'Serge Beynaud',

  // Toofan
  'toofanofficiel': 'Toofan',
  'toofan': 'Toofan',

  // Sidiki Diabate
  'sidikidiagate': 'Sidiki Diabate',

  // ═══════════════════════════════════════════════════════════════════
  // TIER B - ANGOLAN / LUSOPHONE
  // ═══════════════════════════════════════════════════════════════════

  // C4 Pedro
  'c4pedro_official': 'C4 Pedro',
  'c4pedro': 'C4 Pedro',

  // Yuri da Cunha
  'yuridacunha': 'Yuri da Cunha',

  // Matias Damasio
  'matiasdamasio': 'Matias Damasio',

  // Nelson Freitas
  'naboryficial': 'Nelson Freitas',
  'nelsonfreitasofficial': 'Nelson Freitas',

  // Calema
  'calemaofficial': 'Calema',
  'calema': 'Calema',

  // Cleyton M (appears heavily in the data)
  'cleyton_milionario': 'Cleyton M',

  // ═══════════════════════════════════════════════════════════════════
  // TIER B - NORTH AFRICAN
  // ═══════════════════════════════════════════════════════════════════

  // Soolking
  'soolking': 'Soolking',
  'soolkingofficial': 'Soolking',

  // Saad Lamjarred
  'saadlamjarred': 'Saad Lamjarred',

  // ElGrande Toto
  'elgrandetoto': 'ElGrande Toto',

  // ═══════════════════════════════════════════════════════════════════
  // TIER C - PRODUCERS / DJs / FEATURED HEAVILY IN DATA
  // ═══════════════════════════════════════════════════════════════════

  // Mavins / Mavin Records
  'maaboryficial': 'Mavin Records',
  'mavoswago': 'Mavin Records',

  // Sarz
  'saboryficial': 'Sarz',
  'saboryficialsarz': 'Sarz',

  // P2J
  'p2j': 'P2J',

  // DJ Tunez
  'dj_tunez': 'DJ Tunez',
  'djtunez': 'DJ Tunez',

  // Ecool
  'ecoolofficial': 'Ecool',

  // DJ Spinall
  'djspinall': 'DJ Spinall',

  // Blaqbonez
  'blaqbonez': 'Blaqbonez',

  // Ladipoe
  'ladipoe': 'Ladipoe',

  // Adekunle Gold
  'adekunlegold': 'Adekunle Gold',

  // Simi
  'symplysimi': 'Simi',
  'simi': 'Simi',

  // Wande Coal
  'wandecoal': 'Wande Coal',

  // Tekno
  'aboryficialtekno': 'Tekno',
  'tekno': 'Tekno',

  // Bella Shmurda
  'bellashmurda': 'Bella Shmurda',

  // Portable
  'portaboryficial': 'Portable',
  'portablebaeby': 'Portable',

  // Spyro
  'spyaboryficial': 'Spyro',
  'spyro__official': 'Spyro',

  // Chike
  'chaboryficial': 'Chike',
  'officialchike': 'Chike',

  // Johnny Drille
  'johnnydrille': 'Johnny Drille',

  // Niniola
  'naboryficialniniola': 'Niniola',
  'officialniniola': 'Niniola',

  // DJ Neptaboryficial
  'djneptune': 'DJ Neptune',

  // Victor AD
  'victoradere': 'Victor AD',
  'victorad': 'Victor AD',

  // ═══════════════════════════════════════════════════════════════════
  // CONTENT CREATORS WHO ARE ALSO ARTISTS (from actual data)
  // ═══════════════════════════════════════════════════════════════════

  // Sunmi Agbebi (gospel)
  'sunmisola_agbebi': 'Sunmisola Agbebi',

  // Charlotte Dipanda
  'charlottedipandaofficiel': 'Charlotte Dipanda',

  // Yaw Dhope
  'yawdhopeofficial': 'Yaw Dhope',

  // Lutagh
  'lutagh': 'Lutagh',

  // Heretorul
  'heretorul': 'Heretorul',

  // Blulyt
  'blulyt__': 'Blulyt',

  // Elestee
  'elestee__': 'Elestee',

  // Doncarta
  'doncarta_official': 'Doncarta',

  // ═══════════════════════════════════════════════════════════════════
  // LEGENDS
  // ═══════════════════════════════════════════════════════════════════

  // Fela Kuti
  'felakuti': 'Fela Kuti',

  // Youssou N'Dour
  'youssounaboryficial': 'Youssou N\'Dour',
  'youssou': 'Youssou N\'Dour',

  // Angelique Kidjo
  'angelaboryficial': 'Angelique Kidjo',
  'angeliquekidjo': 'Angelique Kidjo',

  // Miriam Makeba
  'miriamaboryficial': 'Miriam Makeba',

  // Salif Keita
  'salaboryficial': 'Salif Keita',
  'salifkeita': 'Salif Keita',

  // King Sunny Ade
  'kingsaboryficial': 'King Sunny Ade',

  // Oliver De Coque
  'olivaboryficial': 'Oliver De Coque',

  // Hugh Masekela
  'hughaboryficial': 'Hugh Masekela',

  // 2Baba / 2Face
  'official2baba': '2Baba',
  '2babaidia': '2Baba',

  // D'banj
  'iamdbanj': 'D\'banj',
  'dbanj': 'D\'banj',

  // P-Square
  'paboryficial': 'P-Square',
  'psaboryficial': 'P-Square',
  'paboryficialmr': 'Mr P',
  'rudaboryficial': 'Rudeboy',
  'rudeboyphat': 'Rudeboy',
};

// ─── Hashtag → Artist Map ────────────────────────────────────────────────────
// Maps common hashtags (lowercase, no #) to artist names

const HASHTAG_ARTIST_MAP = {
  'burnaboy': 'Burna Boy',
  'wizkid': 'Wizkid',
  'davido': 'Davido',
  'rema': 'Rema',
  'asake': 'Asake',
  'ayrastarr': 'Ayra Starr',
  'tems': 'Tems',
  'ckay': 'CKay',
  'omahlay': 'Omah Lay',
  'fireboydml': 'Fireboy DML',
  'tyla': 'Tyla',
  'tylachallenge': 'Tyla',
  'patoranking': 'Patoranking',
  'diamondplatnumz': 'Diamond Platnumz',
  'blacksherif': 'Black Sherif',
  'sarkodie': 'Sarkodie',
  'stonebwoy': 'Stonebwoy',
  'kabzadesmall': 'Kabza De Small',
  'djmaphorisa': 'DJ Maphorisa',
  'blackcoffee': 'Black Coffee',
  'amapiano': null, // genre, not artist
  'afrobeats': null, // genre
  'olamide': 'Olamide',
  'donjazzy': 'Don Jazzy',
  'flavour': 'Flavour',
  'phyno': 'Phyno',
  'zlatan': 'Zlatan',
  'kizzdaniel': 'Kizz Daniel',
  'joeboy': 'Joeboy',
  'ruger': 'Ruger',
  'oxlade': 'Oxlade',
  'victony': 'Victony',
  'fallyipupa': 'Fally Ipupa',
  'nadiamukami': 'Nadia Mukami',
  'busiswa': 'Busiswa',
  'nastyc': 'Nasty C',
  'shattawale': 'Shatta Wale',
  'kingpromise': 'King Promise',
  'gyakie': 'Gyakie',
  'kuamieugene': 'Kuami Eugene',
  'kidi': 'KiDi',
  'c4pedro': 'C4 Pedro',
  'soolking': 'Soolking',
  'bellashmurda': 'Bella Shmurda',
  'portable': 'Portable',
  'spyro': 'Spyro',
  'chike': 'Chike',
  'bnxn': 'Bnxn',
  'tekno': 'Tekno',
  'simi': 'Simi',
  'adekunlegold': 'Adekunle Gold',
  'wandecoal': 'Wande Coal',
  '2baba': '2Baba',
  'dbanj': 'D\'banj',
  'innossb': 'Innoss\'B',
  'mhd': 'MHD',
  'ayanakamura': 'Aya Nakamura',
  'zuchu': 'Zuchu',
  'rayvanny': 'Rayvanny',
  'harmonize': 'Harmonize',
  'dadju': 'Dadju',
  'focalistic': 'Focalistic',
  'casspernyovest': 'Cassper Nyovest',
  'makhadzi': 'Makhadzi',
  'blaqbonez': 'Blaqbonez',
  'crayon': 'Crayon',
  'ladipoe': 'Ladipoe',
  'niniola': 'Niniola',
  'johnnydrille': 'Johnny Drille',
  'youngstunna': 'Young Stunna',
  'unclewaffles': 'Uncle Waffles',
};

// ─── Patterns for DC (Dance Credit) - SKIP THESE ────────────────────────────
// These patterns indicate a choreography credit, NOT the music artist

const DC_PATTERNS = [
  /\bDC\s*[:;]?\s*@/i,
  /\bDC\s+@/i,
  /\bDC\s+W\//i,
  /\b#dc\b/i,
  /\bdance\s*credit\s*[:;]?\s*@/i,
  /\bchoreo(?:graphy|grapher)?\s*[:;]?\s*@/i,
  /\bchoreographer\s*[:;]?\s*@/i,
];

// ─── Music Credit Patterns ───────────────────────────────────────────────────
// These patterns indicate the NEXT @mention is the music artist

const MUSIC_CREDIT_PATTERNS = [
  /[🎵🎶🎤🎸🎹♩♪♫♬]\s*(?:by\s+)?@([\w.]+)/gi,
  /[🎵🎶🎤🎸🎹♩♪♫♬]\s*[:;]?\s*@([\w.]+)/gi,
  /\bsong\s*[:;]?\s*@([\w.]+)/gi,
  /\bmusic\s*[:;]?\s*@([\w.]+)/gi,
  /\btrack\s*[:;]?\s*@([\w.]+)/gi,
  /[🎵🎶]\s*@([\w.]+)\s*[-–]\s*(.+?)(?:\n|#|@|$)/gi, // 🎵 @artist - Song Name
  /[🎵🎶]\s*(.+?)\s+(?:by|par)\s+@([\w.]+)/gi, // 🎵 Song Name by @artist
];

// ─── Song Name Extraction Patterns ──────────────────────────────────────────

const SONG_NAME_PATTERNS = [
  /[🎵🎶]\s*@[\w.]+\s*[-–]\s*(.+?)(?:\n|#|@|$)/i,    // 🎵 @artist - Song Name
  /[🎵🎶]\s*(.+?)\s+by\s+@[\w.]+/i,                    // 🎵 Song Name by @artist
  /\bsong\s*[:;]\s*(.+?)(?:\n|#|@|$)/i,                 // Song: Something
  /"([^"]+)"\s*(?:by|par|de)\s/i,                        // "Song Name" by
  /[🎶🎵]\s*[:;]?\s*(?:[\w\s]+)\s+by\s+@[\w.]+\s*[-–]\s*(.+?)(?:\n|#|@|$)/i,
];

// ─── Description Parser ─────────────────────────────────────────────────────

/**
 * Parse a moment's description and extract music artist + song info.
 *
 * Returns: {
 *   artists: [{ name, confidence, method, handle? }],
 *   songName: string | null,
 *   dcMentions: string[]   // dance credit handles (excluded from artists)
 * }
 */
function parseDescription(description, vibeTagsArr) {
  if (!description) return { artists: [], songName: null, dcMentions: [] };

  const result = {
    artists: [],
    songName: null,
    dcMentions: [],
  };

  const desc = description;
  const descLower = desc.toLowerCase();
  const seenArtists = new Set(); // dedup

  // ── Step 1: Identify DC (Dance Credit) mentions to EXCLUDE ──

  // Find all lines/segments that are DC credits
  const dcHandles = new Set();
  for (const pat of DC_PATTERNS) {
    pat.lastIndex = 0;
    const match = pat.exec(desc);
    if (match) {
      // Find @mentions near this DC marker
      const startPos = match.index;
      const segment = desc.substring(startPos, Math.min(startPos + 100, desc.length));
      const handles = segment.match(/@([\w.]+)/g);
      if (handles) {
        for (const h of handles) {
          dcHandles.add(h.substring(1).toLowerCase());
        }
      }
    }
  }
  result.dcMentions = [...dcHandles];

  // ── Step 2: Extract music-credited @mentions (highest confidence) ──

  for (const pat of MUSIC_CREDIT_PATTERNS) {
    pat.lastIndex = 0;
    let match;
    while ((match = pat.exec(desc)) !== null) {
      // The pattern captures the handle
      const handle = (match[1] || '').toLowerCase().replace(/^@/, '');
      if (!handle || dcHandles.has(handle)) continue;

      const artistName = ARTIST_HANDLE_MAP[handle];
      if (artistName && !seenArtists.has(artistName)) {
        seenArtists.add(artistName);
        result.artists.push({
          name: artistName,
          confidence: 0.85,
          method: 'music_credit_mention',
          handle,
        });
      }
    }
  }

  // ── Step 3: Extract all @mentions and check against dictionary ──

  const allMentions = desc.match(/@([\w.]+)/g) || [];
  for (const rawHandle of allMentions) {
    const handle = rawHandle.substring(1).toLowerCase();
    if (dcHandles.has(handle)) continue;

    const artistName = ARTIST_HANDLE_MAP[handle];
    if (artistName && !seenArtists.has(artistName)) {
      seenArtists.add(artistName);
      result.artists.push({
        name: artistName,
        confidence: 0.6,
        method: 'at_mention',
        handle,
      });
    }
  }

  // ── Step 4: Extract artist names from hashtags ──

  const vibeTags = vibeTagsArr || [];
  const hashtagTexts = vibeTags.map(t => t.replace(/^#/, '').toLowerCase());

  // Also extract hashtags directly from description
  const descHashtags = (desc.match(/#([\w\u00C0-\u024F]+)/g) || [])
    .map(t => t.substring(1).toLowerCase());

  const allHashtags = [...new Set([...hashtagTexts, ...descHashtags])];

  for (const tag of allHashtags) {
    const artistName = HASHTAG_ARTIST_MAP[tag];
    if (artistName && !seenArtists.has(artistName)) {
      seenArtists.add(artistName);
      result.artists.push({
        name: artistName,
        confidence: 0.4,
        method: 'hashtag',
        handle: '#' + tag,
      });
    }
  }

  // ── Step 5: Text-based artist name detection ──
  // Search for known artist names directly in the text (case insensitive)

  const TEXT_ARTIST_NAMES = [
    'Burna Boy', 'Wizkid', 'Davido', 'Rema', 'Asake', 'Ayra Starr',
    'Tems', 'CKay', 'Omah Lay', 'Fireboy DML', 'Tyla', 'Patoranking',
    'Diamond Platnumz', 'Black Sherif', 'Sarkodie', 'Stonebwoy',
    'Kabza De Small', 'DJ Maphorisa', 'Black Coffee', 'Olamide',
    'Don Jazzy', 'Flavour', 'Phyno', 'Zlatan', 'Kizz Daniel',
    'Fally Ipupa', 'Aya Nakamura', 'Innoss\'B',
    'Zuchu', 'Rayvanny', 'Harmonize', 'Ali Kiba',
    'Focalistic', 'Cassper Nyovest', 'Nasty C',
    'Shatta Wale', 'King Promise', 'Gyakie',
    'Nadia Mukami', 'C4 Pedro', 'Soolking',
    'Angelique Kidjo', 'Youssou N\'Dour', 'Fela Kuti',
    '2Baba', 'D\'banj', 'P-Square', 'Rudeboy', 'Mr P',
    'Bella Shmurda', 'Portable', 'Victony', 'Bnxn',
    'Blaqbonez', 'Ladipoe', 'Adekunle Gold', 'Simi',
    'Wande Coal', 'Tekno',
  ];

  for (const name of TEXT_ARTIST_NAMES) {
    if (seenArtists.has(name)) continue;
    // Use word-boundary matching to avoid false positives
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'i');
    if (regex.test(desc)) {
      seenArtists.add(name);
      result.artists.push({
        name,
        confidence: 0.5,
        method: 'text_match',
      });
    }
  }

  // ── Step 6: Extract song name ──

  for (const pat of SONG_NAME_PATTERNS) {
    pat.lastIndex = 0;
    const match = pat.exec(desc);
    if (match) {
      const songName = (match[1] || '').trim();
      if (songName && songName.length > 1 && songName.length < 80) {
        result.songName = songName;
        break;
      }
    }
  }

  // Also try: "SONG_NAME by @artist" pattern in 🎶 lines
  if (!result.songName) {
    const byMatch = desc.match(/[🎶🎵]\s*[:;]?\s*(?:(.+?)\s+(?:by|BY|By|par)\s+@[\w.]+)/);
    if (byMatch && byMatch[1]) {
      const candidate = byMatch[1].trim();
      if (candidate.length > 1 && candidate.length < 80) {
        result.songName = candidate;
      }
    }
  }

  // Try quoted song names
  if (!result.songName) {
    const quoteMatch = desc.match(/"([^"]{2,60})"/);
    if (quoteMatch) {
      result.songName = quoteMatch[1].trim();
    }
  }

  return result;
}

// ─── Track Matcher (On-Demand with Cache) ────────────────────────────────────

/**
 * On-demand artist track cache.
 * Instead of loading 300K+ tracks upfront (which times out), we query
 * video_intelligence only for the specific artists we encounter.
 * Each artist is queried once and cached for the session.
 */
class ArtistTrackCache {
  constructor(supabase) {
    this.supabase = supabase;
    this.cache = new Map(); // normalized artist name -> track[] | null
    this.queryCount = 0;
  }

  async getTracksForArtist(artistName) {
    const normalized = normalizeArtistName(artistName);
    if (this.cache.has(normalized)) {
      return this.cache.get(normalized);
    }

    // Query the database for this artist
    this.queryCount++;
    const tracks = await this._queryArtist(artistName);
    this.cache.set(normalized, tracks);
    return tracks;
  }

  async _queryArtist(artistName) {
    // Strategy: Try exact artist match first, then partial, then title search.
    // This avoids "Flavour" matching "Flavour Trip" when "Flavour" exists.

    // 1. Exact match on artist field
    const { data: exact, error: exactErr } = await this.supabase
      .from('video_intelligence')
      .select('youtube_id, title, artist, view_count')
      .eq('artist', artistName)
      .limit(50);

    if (!exactErr && exact && exact.length > 0) {
      return exact;
    }

    // 2. Case-insensitive exact match
    const { data: iexact, error: iexactErr } = await this.supabase
      .from('video_intelligence')
      .select('youtube_id, title, artist, view_count')
      .ilike('artist', artistName)
      .limit(50);

    if (!iexactErr && iexact && iexact.length > 0) {
      return iexact;
    }

    // 3. Partial match (artist name contained in field)
    const { data: partial, error: partialErr } = await this.supabase
      .from('video_intelligence')
      .select('youtube_id, title, artist, view_count')
      .ilike('artist', `%${artistName}%`)
      .limit(50);

    if (!partialErr && partial && partial.length > 0) {
      // Filter to prefer closer matches (artist field that starts with or closely matches)
      const artistLower = artistName.toLowerCase();
      const filtered = partial.filter(t => {
        const a = (t.artist || '').toLowerCase();
        return a === artistLower || a.startsWith(artistLower) || a.endsWith(artistLower);
      });
      return filtered.length > 0 ? filtered : partial;
    }

    // 4. Search in title field (e.g. "Burna Boy - Last Last")
    const { data: titleData, error: titleErr } = await this.supabase
      .from('video_intelligence')
      .select('youtube_id, title, artist, view_count')
      .ilike('title', `${artistName} -%`)
      .limit(20);

    if (!titleErr && titleData && titleData.length > 0) {
      return titleData;
    }

    return null;
  }

  getStats() {
    let cached = 0;
    let found = 0;
    for (const [, tracks] of this.cache) {
      cached++;
      if (tracks && tracks.length > 0) found++;
    }
    return { cached, found, queries: this.queryCount };
  }
}

function normalizeArtistName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s*[\(\[].*?[\)\]]/g, '')  // Remove parenthetical (feat. X)
    .replace(/[''`]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the best matching track for an artist name.
 * Returns: { youtube_id, title, artist, matchType } or null
 */
async function findBestTrack(artistName, songName, trackCache) {
  const tracks = await trackCache.getTracksForArtist(artistName);
  if (!tracks || tracks.length === 0) return null;

  // If we have a song name, try to match it
  if (songName) {
    const songLower = songName.toLowerCase();
    const songWords = songLower.split(/\s+/).filter(w => w.length > 2);

    // Exact title match
    for (const track of tracks) {
      const titleLower = (track.title || '').toLowerCase();
      if (titleLower.includes(songLower)) {
        return { ...track, matchType: 'exact_song_match' };
      }
    }

    // Word overlap match
    let bestTrack = null;
    let bestOverlap = 0;
    for (const track of tracks) {
      const titleLower = (track.title || '').toLowerCase();
      let overlap = 0;
      for (const word of songWords) {
        if (titleLower.includes(word)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestTrack = track;
      }
    }
    if (bestTrack && bestOverlap >= 1) {
      return { ...bestTrack, matchType: 'song_word_match' };
    }
  }

  // No song match - return the track with highest view count (most popular)
  const sorted = [...tracks].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  return { ...sorted[0], matchType: 'artist_popular' };
}

// ─── Batch Updater ───────────────────────────────────────────────────────────

async function updateMoment(supabase, sourceId, updates) {
  const { error } = await supabase
    .from('voyo_moments')
    .update(updates)
    .eq('source_id', sourceId);

  if (error) {
    throw new Error(`Update failed for ${sourceId}: ${error.message}`);
  }
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     VOYO MUSIC IDENTIFICATION PIPELINE                      ║');
  console.log('║     Linking moments to tracks via description parsing       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (DRY_RUN) console.log('  [MODE] DRY RUN - no database updates');
  if (LIMIT < Infinity) console.log(`  [MODE] LIMIT = ${LIMIT} moments`);
  if (VERBOSE) console.log('  [MODE] VERBOSE logging enabled');
  console.log('');

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── Phase 0: Initialize on-demand track cache ──
  console.log('  ═══ PHASE 0: Initializing Track Cache (on-demand) ═══');
  const trackCache = new ArtistTrackCache(supabase);
  console.log('  [CACHE] Ready - will query video_intelligence per artist as needed');
  console.log('');

  // ── Phase 1 & 2: Fetch moments and process ──
  console.log('  ═══ PHASE 1+2: Parsing Descriptions & Matching Tracks ═══');

  const stats = {
    total: 0,
    withDescription: 0,
    artistExtracted: 0,
    trackMatched: 0,
    updated: 0,
    updateErrors: 0,
    noDescription: 0,
    noArtistFound: 0,
    artistNotInDb: 0,
    confidence: { high: 0, medium: 0, low: 0 },
    methods: {},
    matchedArtists: {},
    unmatchedArtists: {},
  };

  let remaining = LIMIT;
  let batchNum = 0;

  // In live mode, matched moments get parent_track_id set and drop out of
  // the IS NULL query. Unmatched ones stay. So we need to advance offset
  // by the number of unmatched moments (those that remain NULL after processing).
  let liveOffset = 0;

  while (remaining > 0) {
    const batchSize = Math.min(FETCH_BATCH_SIZE, remaining);
    batchNum++;

    const { data: moments, error } = await supabase
      .from('voyo_moments')
      .select('source_id, description, creator_username, title, vibe_tags')
      .is('parent_track_id', null)
      .range(liveOffset, liveOffset + batchSize - 1);

    if (error) {
      console.error('  [ERROR] Fetching moments:', error.message);
      break;
    }

    if (!moments || moments.length === 0) break;

    stats.total += moments.length;
    remaining -= moments.length;

    // Process each moment
    const updates = []; // { sourceId, updateData }

    for (const moment of moments) {
      // Skip moments without descriptions
      if (!moment.description || moment.description.trim().length === 0) {
        stats.noDescription++;
        continue;
      }

      stats.withDescription++;

      // Phase 1: Parse description
      const parsed = parseDescription(moment.description, moment.vibe_tags);

      // Also check if creator_username itself is a known artist
      if (moment.creator_username) {
        const creatorHandle = moment.creator_username.toLowerCase();
        const creatorArtist = ARTIST_HANDLE_MAP[creatorHandle];
        if (creatorArtist) {
          const alreadyFound = parsed.artists.some(a => a.name === creatorArtist);
          if (!alreadyFound) {
            parsed.artists.push({
              name: creatorArtist,
              confidence: 0.35,
              method: 'creator_is_artist',
              handle: creatorHandle,
            });
          }
        }
      }

      if (VERBOSE && parsed.artists.length > 0) {
        console.log(`    [PARSE] @${moment.creator_username}: ${parsed.artists.map(a => a.name).join(', ')} | song: ${parsed.songName || 'N/A'}`);
      }

      if (parsed.artists.length === 0) {
        stats.noArtistFound++;
        continue;
      }

      stats.artistExtracted++;

      // Phase 2: Match against database (async - queries on demand)
      let bestMatch = null;
      let bestArtist = null;

      for (const artist of parsed.artists) {
        const track = await findBestTrack(artist.name, parsed.songName, trackCache);
        if (track) {
          // Pick the match with highest confidence
          if (!bestMatch || artist.confidence > bestArtist.confidence) {
            bestMatch = track;
            bestArtist = artist;
          }
        }
      }

      if (!bestMatch) {
        stats.artistNotInDb++;
        for (const a of parsed.artists) {
          stats.unmatchedArtists[a.name] = (stats.unmatchedArtists[a.name] || 0) + 1;
        }
        if (VERBOSE) {
          console.log(`    [MISS] Artists not in DB: ${parsed.artists.map(a => a.name).join(', ')}`);
        }
        continue;
      }

      stats.trackMatched++;

      // Calculate final confidence
      let confidence = bestArtist.confidence;
      if (bestMatch.matchType === 'exact_song_match') {
        confidence = Math.min(0.95, confidence + 0.1);
      } else if (bestMatch.matchType === 'song_word_match') {
        confidence = Math.min(0.85, confidence + 0.05);
      }

      // Track stats
      if (confidence >= 0.7) stats.confidence.high++;
      else if (confidence >= 0.5) stats.confidence.medium++;
      else stats.confidence.low++;

      const method = bestArtist.method;
      stats.methods[method] = (stats.methods[method] || 0) + 1;
      stats.matchedArtists[bestArtist.name] = (stats.matchedArtists[bestArtist.name] || 0) + 1;

      updates.push({
        sourceId: moment.source_id,
        updateData: {
          parent_track_id: bestMatch.youtube_id,
          parent_track_title: bestMatch.title,
          parent_track_artist: bestMatch.artist,
          track_match_confidence: confidence,
          track_match_method: 'description_parse',
        },
      });

      if (VERBOSE) {
        console.log(`    [MATCH] @${moment.creator_username} -> ${bestMatch.artist} - ${(bestMatch.title || '').substring(0, 40)} (${(confidence * 100).toFixed(0)}% via ${method})`);
      }
    }

    // Phase 3: Apply updates
    if (updates.length > 0 && !DRY_RUN) {
      for (const upd of updates) {
        try {
          await updateMoment(supabase, upd.sourceId, upd.updateData);
          stats.updated++;
        } catch (err) {
          stats.updateErrors++;
          if (VERBOSE) {
            console.error(`    [ERR] ${upd.sourceId}: ${err.message}`);
          }
        }
      }
    } else if (DRY_RUN) {
      stats.updated += updates.length;
    }

    // In live mode: matched moments get parent_track_id set and disappear from
    // the IS NULL query. Unmatched ones stay. So offset advances by
    // (batch_size - number_of_successful_updates).
    const successfulUpdates = DRY_RUN ? 0 : updates.length - stats.updateErrors;
    const unmatchedInBatch = moments.length - successfulUpdates;
    liveOffset += unmatchedInBatch;

    // Progress
    const cacheStats = trackCache.getStats();
    console.log(`  [BATCH ${batchNum}] ${stats.total} processed | ${stats.trackMatched} matched | ${stats.updated} ${DRY_RUN ? 'would update' : 'updated'} | cache: ${cacheStats.found}/${cacheStats.cached} artists found (${cacheStats.queries} queries)`);
  }

  // ─── Final Report ──────────────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    PIPELINE RESULTS                         ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total moments scanned:     ${String(stats.total).padStart(6)}                       ║`);
  console.log(`║  With descriptions:         ${String(stats.withDescription).padStart(6)}                       ║`);
  console.log(`║  No description:            ${String(stats.noDescription).padStart(6)}                       ║`);
  console.log(`║  Artist extracted:          ${String(stats.artistExtracted).padStart(6)}                       ║`);
  console.log(`║  No artist found:           ${String(stats.noArtistFound).padStart(6)}                       ║`);
  console.log(`║  Track matched:             ${String(stats.trackMatched).padStart(6)}                       ║`);
  console.log(`║  Artist not in DB:          ${String(stats.artistNotInDb).padStart(6)}                       ║`);
  console.log(`║  ${DRY_RUN ? 'Would update' : 'Updated OK'}:            ${String(stats.updated).padStart(6)}                       ║`);
  console.log(`║  Update errors:             ${String(stats.updateErrors).padStart(6)}                       ║`);
  console.log(`║  Time elapsed:          ${elapsed.padStart(7)}s                      ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Confidence distribution
  console.log('');
  console.log('  Confidence Distribution:');
  const confTotal = stats.confidence.high + stats.confidence.medium + stats.confidence.low;
  if (confTotal > 0) {
    const highBar = barChart(stats.confidence.high, confTotal, 25);
    const medBar = barChart(stats.confidence.medium, confTotal, 25);
    const lowBar = barChart(stats.confidence.low, confTotal, 25);
    console.log(`    HIGH   (>=0.7)  ${highBar} ${stats.confidence.high} (${pct(stats.confidence.high, confTotal)})`);
    console.log(`    MEDIUM (0.5-0.7) ${medBar} ${stats.confidence.medium} (${pct(stats.confidence.medium, confTotal)})`);
    console.log(`    LOW    (<0.5)   ${lowBar} ${stats.confidence.low} (${pct(stats.confidence.low, confTotal)})`);
  } else {
    console.log('    No matches to show confidence for.');
  }

  // Match method distribution
  console.log('');
  console.log('  Match Method Distribution:');
  const sortedMethods = Object.entries(stats.methods).sort((a, b) => b[1] - a[1]);
  for (const [method, count] of sortedMethods) {
    const bar = barChart(count, confTotal, 25);
    console.log(`    ${method.padEnd(22)} ${bar} ${count} (${pct(count, confTotal)})`);
  }

  // Top matched artists
  console.log('');
  console.log('  Top 25 Matched Artists:');
  const sortedArtists = Object.entries(stats.matchedArtists).sort((a, b) => b[1] - a[1]);
  for (const [artist, count] of sortedArtists.slice(0, 25)) {
    const bar = barChart(count, sortedArtists[0][1], 20);
    console.log(`    ${artist.padEnd(20)} ${bar} ${count}`);
  }

  // Cache stats
  const cacheStats = trackCache.getStats();
  console.log('');
  console.log('  Track Cache Stats:');
  console.log(`    Artists queried:    ${cacheStats.cached}`);
  console.log(`    Artists found in DB: ${cacheStats.found}`);
  console.log(`    DB queries made:    ${cacheStats.queries}`);

  // Top unmatched artists (artists found in descriptions but not in video_intelligence)
  if (Object.keys(stats.unmatchedArtists).length > 0) {
    console.log('');
    console.log('  Top Unmatched Artists (not in video_intelligence):');
    const sortedUnmatched = Object.entries(stats.unmatchedArtists).sort((a, b) => b[1] - a[1]);
    for (const [artist, count] of sortedUnmatched.slice(0, 15)) {
      console.log(`    ${artist.padEnd(20)} ${count} moments`);
    }
  }

  // Unmatched summary
  if (stats.noArtistFound > 0) {
    console.log('');
    console.log(`  ${stats.noArtistFound} moments had descriptions but no recognizable artist.`);
    console.log(`  ${stats.artistNotInDb} moments had a recognized artist but no track in the database.`);
  }

  console.log('');
  console.log('  Done.');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function barChart(value, total, width) {
  if (total === 0) return ' '.repeat(width);
  const filled = Math.round((value / total) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function pct(value, total) {
  if (total === 0) return '0%';
  return (value / total * 100).toFixed(1) + '%';
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
