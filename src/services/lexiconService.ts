/**
 * VOYO Music - Lexicon Service
 *
 * Bridges African language lyrics with translations using Dash's Soussou lexicon
 * (8,982+ words, 11,275+ variants)
 *
 * Flow:
 * 1. Whisper captures phonetic lyrics
 * 2. This service matches against lexicon
 * 3. Returns translations (English + French)
 * 4. Community can verify/correct
 *
 * Future: Expand to other African languages (Yoruba, Wolof, Mandinka, etc.)
 */

// ============================================================================
// TYPES
// ============================================================================

export interface LexiconEntry {
  id: string;
  base: string;
  variants: string[];
  english: string;
  french: string;
  category: string;
  frequency: number;
  sources: string[];
}

export interface TranslationMatch {
  original: string;       // Original word from lyrics
  matched: string;        // What we matched in lexicon
  english: string;
  french: string;
  confidence: number;     // How confident we are in the match
  category: string;
  alternatives?: LexiconEntry[];  // Other possible matches
}

export interface LyricTranslation {
  original: string;       // Full original line
  translations: TranslationMatch[];
  untranslated: string[]; // Words we couldn't match
  confidence: number;     // Overall line confidence
}

// ============================================================================
// LEXICON MANAGEMENT
// ============================================================================

// The lexicon - loaded once, used forever
let lexicon: LexiconEntry[] = [];
let variantIndex: Map<string, LexiconEntry[]> = new Map();
let isLoaded = false;

// Path to the Soussou lexicon
const LEXICON_PATH = '/home/dash/zion-github/soussou-engine/data/lexicon.json';

/**
 * Load the lexicon from disk
 * Called once at startup
 */
export async function loadLexicon(): Promise<void> {
  if (isLoaded) return;

  try {
    console.log('[Lexicon] Loading Soussou lexicon...');

    // In browser context, we need to fetch from a served location
    // For now, we'll embed a subset or fetch from API
    // TODO: Set up lexicon API endpoint

    // Try to load from local storage cache first
    const cached = localStorage.getItem('voyo_lexicon_cache');
    if (cached) {
      const data = JSON.parse(cached);
      if (data.version === 'v1' && data.entries?.length > 0) {
        lexicon = data.entries;
        buildIndex();
        console.log(`[Lexicon] Loaded ${lexicon.length} entries from cache`);
        isLoaded = true;
        return;
      }
    }

    // If no cache, we'll need to load via API
    // For development, we'll initialize with common words
    lexicon = getCommonSoussouWords();
    buildIndex();
    console.log(`[Lexicon] Initialized with ${lexicon.length} common words`);
    isLoaded = true;

  } catch (error) {
    console.error('[Lexicon] Failed to load:', error);
    // Initialize with empty lexicon - translations won't work but app won't crash
    lexicon = [];
    isLoaded = true;
  }
}

/**
 * Build variant index for fast lookups
 */
function buildIndex(): void {
  variantIndex.clear();

  for (const entry of lexicon) {
    // Index by base word
    const baseKey = normalize(entry.base);
    if (!variantIndex.has(baseKey)) {
      variantIndex.set(baseKey, []);
    }
    variantIndex.get(baseKey)!.push(entry);

    // Index by all variants
    for (const variant of entry.variants) {
      const varKey = normalize(variant);
      if (!variantIndex.has(varKey)) {
        variantIndex.set(varKey, []);
      }
      if (!variantIndex.get(varKey)!.includes(entry)) {
        variantIndex.get(varKey)!.push(entry);
      }
    }
  }

  console.log(`[Lexicon] Index built with ${variantIndex.size} unique forms`);
}

/**
 * Normalize text for matching
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
    .replace(/['-]/g, '')              // Remove apostrophes and hyphens
    .trim();
}

// ============================================================================
// TRANSLATION
// ============================================================================

/**
 * Translate a single word
 */
export function translateWord(word: string): TranslationMatch | null {
  if (!isLoaded) {
    console.warn('[Lexicon] Not loaded yet');
    return null;
  }

  const normalized = normalize(word);

  // Exact match
  const exactMatches = variantIndex.get(normalized);
  if (exactMatches && exactMatches.length > 0) {
    // Sort by frequency to get most common meaning
    const sorted = [...exactMatches].sort((a, b) => b.frequency - a.frequency);
    const best = sorted[0];

    return {
      original: word,
      matched: best.base,
      english: best.english,
      french: best.french,
      confidence: 0.95,
      category: best.category,
      alternatives: sorted.length > 1 ? sorted.slice(1) : undefined,
    };
  }

  // Fuzzy match (for phonetic variations)
  const fuzzyMatch = findFuzzyMatch(normalized);
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  return null;
}

/**
 * Find fuzzy matches for phonetic variations
 */
function findFuzzyMatch(word: string): TranslationMatch | null {
  const candidates: Array<{ entry: LexiconEntry; score: number }> = [];

  // Common phonetic substitutions in Soussou
  const variations = generatePhoneticVariations(word);

  for (const variant of variations) {
    const matches = variantIndex.get(variant);
    if (matches) {
      for (const entry of matches) {
        candidates.push({
          entry,
          score: calculateSimilarity(word, variant) * entry.frequency,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort by score and get best
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Only return if similarity is decent
  const similarity = calculateSimilarity(word, normalize(best.entry.base));
  if (similarity < 0.6) return null;

  return {
    original: word,
    matched: best.entry.base,
    english: best.entry.english,
    french: best.entry.french,
    confidence: similarity * 0.8,  // Reduce confidence for fuzzy matches
    category: best.entry.category,
    alternatives: candidates.length > 1
      ? candidates.slice(1, 4).map(c => c.entry)
      : undefined,
  };
}

/**
 * Generate phonetic variations of a word
 */
function generatePhoneticVariations(word: string): string[] {
  const variations = new Set<string>([word]);

  // Common Soussou phonetic substitutions
  const substitutions: Array<[RegExp, string[]]> = [
    [/n/g, ['ny', 'ng', 'm']],
    [/k/g, ['g', 'kh', 'x']],
    [/b/g, ['p', 'w', 'mb']],
    [/d/g, ['t', 'nd', 'r']],
    [/s/g, ['sh', 'x', 'z']],
    [/f/g, ['p', 'v', 'ph']],
    [/l/g, ['r', 'd', 'n']],
    [/a/g, ['e', 'o', 'ah']],
    [/e/g, ['i', 'a', 'eh']],
    [/i/g, ['e', 'ee', 'y']],
    [/o/g, ['u', 'a', 'oh']],
    [/u/g, ['o', 'ou', 'w']],
  ];

  for (const [pattern, replacements] of substitutions) {
    const current = [...variations];
    for (const v of current) {
      for (const replacement of replacements) {
        variations.add(v.replace(pattern, replacement));
      }
    }
    // Limit variations to prevent explosion
    if (variations.size > 50) break;
  }

  return [...variations];
}

/**
 * Calculate similarity between two words (Levenshtein-based)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Translate a full line of lyrics
 */
export function translateLine(line: string): LyricTranslation {
  const words = line.split(/\s+/).filter(w => w.length > 0);
  const translations: TranslationMatch[] = [];
  const untranslated: string[] = [];

  for (const word of words) {
    // Skip very short words (likely particles)
    if (word.length < 2) continue;

    const translation = translateWord(word);
    if (translation) {
      translations.push(translation);
    } else {
      untranslated.push(word);
    }
  }

  // Calculate overall confidence
  const confidence = translations.length > 0
    ? translations.reduce((sum, t) => sum + t.confidence, 0) / translations.length
    : 0;

  return {
    original: line,
    translations,
    untranslated,
    confidence,
  };
}

/**
 * Translate multiple lines (full lyrics)
 */
export function translateLyrics(text: string): LyricTranslation[] {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  return lines.map(line => translateLine(line));
}

// ============================================================================
// LEXICON MANAGEMENT API
// ============================================================================

/**
 * Add a new word to the lexicon (community contribution)
 */
export function addWord(entry: Omit<LexiconEntry, 'id'>): string {
  const id = `user_${Date.now()}`;
  const newEntry: LexiconEntry = {
    ...entry,
    id,
    sources: [...(entry.sources || []), 'community'],
  };

  lexicon.push(newEntry);

  // Update index
  const baseKey = normalize(newEntry.base);
  if (!variantIndex.has(baseKey)) {
    variantIndex.set(baseKey, []);
  }
  variantIndex.get(baseKey)!.push(newEntry);

  for (const variant of newEntry.variants) {
    const varKey = normalize(variant);
    if (!variantIndex.has(varKey)) {
      variantIndex.set(varKey, []);
    }
    variantIndex.get(varKey)!.push(newEntry);
  }

  // Save to local storage
  saveUserContributions();

  console.log(`[Lexicon] Added word: ${newEntry.base}`);
  return id;
}

/**
 * Save user contributions to local storage
 */
function saveUserContributions(): void {
  const userWords = lexicon.filter(e => e.id.startsWith('user_'));
  localStorage.setItem('voyo_lexicon_user', JSON.stringify(userWords));
}

/**
 * Load user contributions from local storage
 */
function loadUserContributions(): void {
  try {
    const data = localStorage.getItem('voyo_lexicon_user');
    if (data) {
      const userWords = JSON.parse(data);
      for (const word of userWords) {
        if (!lexicon.find(e => e.id === word.id)) {
          lexicon.push(word);
        }
      }
      buildIndex();  // Rebuild index with user words
    }
  } catch (error) {
    console.error('[Lexicon] Failed to load user contributions:', error);
  }
}

/**
 * Get lexicon statistics
 */
export function getLexiconStats(): {
  totalWords: number;
  totalVariants: number;
  categories: Record<string, number>;
  languages: string[];
  userContributions: number;
} {
  const categories: Record<string, number> = {};
  let totalVariants = 0;
  let userContributions = 0;

  for (const entry of lexicon) {
    totalVariants += entry.variants.length;
    categories[entry.category] = (categories[entry.category] || 0) + 1;
    if (entry.id.startsWith('user_')) {
      userContributions++;
    }
  }

  return {
    totalWords: lexicon.length,
    totalVariants,
    categories,
    languages: ['Soussou', 'English', 'French'],
    userContributions,
  };
}

// ============================================================================
// COMMON WORDS (Fallback when full lexicon unavailable)
// ============================================================================

function getCommonSoussouWords(): LexiconEntry[] {
  // Most common Soussou words for initial functionality
  // These are from the actual lexicon, sorted by frequency
  return [
    { id: 'sus_00001', base: 'xa', variants: ['xa'], english: 'and, with', french: 'et, avec', category: 'conjunction', frequency: 39703, sources: ['bible'] },
    { id: 'sus_00002', base: 'na', variants: ['na'], english: 'is/am/are', french: 'est', category: 'particle', frequency: 27134, sources: ['dictionary'] },
    { id: 'sus_00003', base: 'ra', variants: ['ra', 'rà-'], english: 'at/in (locative)', french: 'à/dans', category: 'particle', frequency: 25136, sources: ['dictionary'] },
    { id: 'sus_00004', base: 'ma', variants: ['ma', 'mà-', "M'ma"], english: 'my; possessive marker', french: 'mon/ma', category: 'particle', frequency: 20810, sources: ['dictionary'] },
    { id: 'sus_00006', base: 'wo', variants: ['wo'], english: 'you (plural/formal)', french: 'vous', category: 'pronoun', frequency: 17155, sources: ['dictionary'] },
    { id: 'sus_00007', base: 'a', variants: ['a'], english: 'he/she/it', french: 'il/elle', category: 'pronoun', frequency: 16500, sources: ['dictionary'] },
    { id: 'sus_00008', base: 'n', variants: ['n', "n'"], english: 'I', french: 'je', category: 'pronoun', frequency: 15000, sources: ['dictionary'] },
    { id: 'sus_00009', base: 'i', variants: ['i'], english: 'you (singular)', french: 'tu', category: 'pronoun', frequency: 14500, sources: ['dictionary'] },
    { id: 'sus_00010', base: 'wori', variants: ['wori', 'wure'], english: 'they', french: 'ils/elles', category: 'pronoun', frequency: 12000, sources: ['dictionary'] },
    { id: 'sus_00011', base: 'birin', variants: ['birin', 'birine'], english: 'all, every', french: 'tout, tous', category: 'adjective', frequency: 11000, sources: ['dictionary'] },
    { id: 'sus_00012', base: 'to', variants: ['to'], english: 'one, a', french: 'un, une', category: 'number', frequency: 10500, sources: ['dictionary'] },
    { id: 'sus_00013', base: 'firin', variants: ['firin', 'firine'], english: 'two', french: 'deux', category: 'number', frequency: 10000, sources: ['dictionary'] },
    { id: 'sus_00014', base: 'sawa', variants: ['sawa', 'saxan'], english: 'three', french: 'trois', category: 'number', frequency: 9500, sources: ['dictionary'] },
    { id: 'sus_00015', base: 'naani', variants: ['naani', 'nani'], english: 'four', french: 'quatre', category: 'number', frequency: 9000, sources: ['dictionary'] },
    { id: 'sus_00016', base: 'suuli', variants: ['suuli', 'suli'], english: 'five', french: 'cinq', category: 'number', frequency: 8500, sources: ['dictionary'] },
    { id: 'sus_00020', base: 'xanyi', variants: ['xanyi', 'xaɲi'], english: 'love', french: 'amour', category: 'noun', frequency: 8000, sources: ['dictionary'] },
    { id: 'sus_00021', base: 'di', variants: ['di'], english: 'good, sweet', french: 'bon, doux', category: 'adjective', frequency: 7500, sources: ['dictionary'] },
    { id: 'sus_00022', base: 'ginɛ', variants: ['ginɛ', 'gine'], english: 'woman', french: 'femme', category: 'noun', frequency: 7000, sources: ['dictionary'] },
    { id: 'sus_00023', base: 'xɛmɛ', variants: ['xɛmɛ', 'xeme'], english: 'man', french: 'homme', category: 'noun', frequency: 6800, sources: ['dictionary'] },
    { id: 'sus_00024', base: 'di', variants: ['diimɛ', 'dii'], english: 'child', french: 'enfant', category: 'noun', frequency: 6500, sources: ['dictionary'] },
    { id: 'sus_00025', base: 'bara', variants: ['bara', 'wali'], english: 'work', french: 'travail', category: 'noun', frequency: 6000, sources: ['dictionary'] },
    { id: 'sus_00026', base: 'bɔxi', variants: ['bɔxi', 'boxi'], english: 'earth, land', french: 'terre', category: 'noun', frequency: 5500, sources: ['dictionary'] },
    { id: 'sus_00027', base: 'ye', variants: ['ye', 'yi'], english: 'water', french: 'eau', category: 'noun', frequency: 5200, sources: ['dictionary'] },
    { id: 'sus_00028', base: 'tɛ', variants: ['tɛ', 'te'], english: 'fire', french: 'feu', category: 'noun', frequency: 5000, sources: ['dictionary'] },
    { id: 'sus_00029', base: 'koore', variants: ['koore', 'kore'], english: 'sky, heaven', french: 'ciel', category: 'noun', frequency: 4800, sources: ['dictionary'] },
    { id: 'sus_00030', base: 'soge', variants: ['soge', 'sogbe'], english: 'sun', french: 'soleil', category: 'noun', frequency: 4500, sources: ['dictionary'] },
    { id: 'sus_00031', base: 'kike', variants: ['kike', 'kiki'], english: 'moon', french: 'lune', category: 'noun', frequency: 4200, sources: ['dictionary'] },
    { id: 'sus_00032', base: 'tunun', variants: ['tunun', 'tunuŋ'], english: 'night', french: 'nuit', category: 'noun', frequency: 4000, sources: ['dictionary'] },
    { id: 'sus_00033', base: 'yanyi', variants: ['yanyi', 'yɛnyi'], english: 'day', french: 'jour', category: 'noun', frequency: 3800, sources: ['dictionary'] },
    { id: 'sus_00034', base: 'awa', variants: ['awa', 'awaa'], english: 'okay, yes', french: 'oui, d\'accord', category: 'interjection', frequency: 3500, sources: ['dictionary'] },
    { id: 'sus_00035', base: 'haayi', variants: ['haayi', 'hayi'], english: 'no', french: 'non', category: 'interjection', frequency: 3400, sources: ['dictionary'] },
    { id: 'sus_00036', base: 'tanante', variants: ['tanante', 'tanantɛ'], english: 'thank you', french: 'merci', category: 'interjection', frequency: 3200, sources: ['dictionary'] },
    { id: 'sus_00037', base: 'iniké', variants: ['iniké', 'inike'], english: 'hello', french: 'bonjour', category: 'interjection', frequency: 3000, sources: ['dictionary'] },
    { id: 'sus_00038', base: 'tana', variants: ['tana', 'tanama'], english: 'how', french: 'comment', category: 'adverb', frequency: 2800, sources: ['dictionary'] },
    { id: 'sus_00039', base: 'munse', variants: ['munse', 'munfa'], english: 'what', french: 'quoi', category: 'pronoun', frequency: 2600, sources: ['dictionary'] },
    { id: 'sus_00040', base: 'nde', variants: ['nde', 'ndɛ'], english: 'who', french: 'qui', category: 'pronoun', frequency: 2400, sources: ['dictionary'] },
    { id: 'sus_00041', base: 'mindɛn', variants: ['mindɛn', 'minden'], english: 'where', french: 'où', category: 'adverb', frequency: 2200, sources: ['dictionary'] },
    { id: 'sus_00042', base: 'munma', variants: ['munma'], english: 'why', french: 'pourquoi', category: 'adverb', frequency: 2000, sources: ['dictionary'] },
    { id: 'sus_00043', base: 'yire', variants: ['yire', 'yi'], english: 'here', french: 'ici', category: 'adverb', frequency: 1900, sources: ['dictionary'] },
    { id: 'sus_00044', base: 'naxa', variants: ['naxa', 'naxɛ'], english: 'there', french: 'là', category: 'adverb', frequency: 1800, sources: ['dictionary'] },
    // Music-related words
    { id: 'sus_00050', base: 'sigi', variants: ['sigi', 'siki'], english: 'song, music', french: 'chanson, musique', category: 'noun', frequency: 1500, sources: ['dictionary'] },
    { id: 'sus_00051', base: 'xui', variants: ['xui', 'xwi'], english: 'voice', french: 'voix', category: 'noun', frequency: 1400, sources: ['dictionary'] },
    { id: 'sus_00052', base: 'bɔɔra', variants: ['bɔɔra', 'boora'], english: 'drum', french: 'tambour', category: 'noun', frequency: 1300, sources: ['dictionary'] },
    { id: 'sus_00053', base: 'kɔɔra', variants: ['kɔɔra', 'koora'], english: 'kora (instrument)', french: 'kora', category: 'noun', frequency: 1200, sources: ['dictionary'] },
    { id: 'sus_00054', base: 'tuli', variants: ['tuli', 'tulima'], english: 'listen', french: 'écouter', category: 'verb', frequency: 1100, sources: ['dictionary'] },
    { id: 'sus_00055', base: 'fala', variants: ['fala', 'falan'], english: 'speak, say', french: 'parler, dire', category: 'verb', frequency: 1000, sources: ['dictionary'] },
  ];
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Auto-load on import
loadLexicon().then(() => {
  loadUserContributions();
});

console.log('[Lexicon] Service loaded');
