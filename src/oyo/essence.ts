/**
 * OYO Essence — Consolidate conversation signals into long-term essence.
 *
 * Pulls recent conversation turns + pattern snapshots and distills them
 * into short declarative facts about the listener, stored via memory.ts.
 * Phase 1 uses cheap rule-based extraction. Phase 2 can add a Gemini
 * Flash pass at session-end for richer summaries.
 *
 * Examples of essence facts:
 *   - "User prefers afrobeats during evening hours"
 *   - "User loves Burna Boy"
 *   - "User usually wants chill music to wind down"
 */

import type { ConversationTurn, MemoryCategory } from './schema';
import { saveEssence } from './memory';

// ---------------------------------------------------------------------------
// Keyword buckets for cheap classification
// ---------------------------------------------------------------------------

const GENRE_KEYWORDS: Array<{ keys: RegExp; label: string }> = [
  { keys: /\bafrobeats?\b/i, label: 'afrobeats' },
  { keys: /\bamapiano\b/i, label: 'amapiano' },
  { keys: /\bhip[- ]?hop\b|\brap\b/i, label: 'hip-hop' },
  { keys: /\br&?b\b|\brnb\b/i, label: 'r&b' },
  { keys: /\bjazz\b/i, label: 'jazz' },
  { keys: /\bsoul\b/i, label: 'soul' },
  { keys: /\breggae\b/i, label: 'reggae' },
  { keys: /\bafrobeat\b|\bfela\b/i, label: 'afrobeat' },
  { keys: /\b(electro|house|techno|edm)\b/i, label: 'electronic' },
  { keys: /\bindie\b/i, label: 'indie' },
  { keys: /\bk[- ]?pop\b/i, label: 'k-pop' },
  { keys: /\bafropop\b|\bafro[- ]?fusion\b/i, label: 'afro-fusion' },
  { keys: /\blo[- ]?fi\b/i, label: 'lo-fi' },
  // African & Caribbean genres
  { keys: /\bkizomba\b/i, label: 'kizomba' },
  { keys: /\bzouk\b/i, label: 'zouk' },
  { keys: /\bdancehall\b/i, label: 'dancehall' },
  { keys: /\bgqom\b/i, label: 'gqom' },
  { keys: /\bafro[- ]?house\b/i, label: 'afrohouse' },
  { keys: /\bhighlife\b/i, label: 'highlife' },
  { keys: /\bmbalax\b/i, label: 'mbalax' },
  { keys: /\bbikutsi\b/i, label: 'bikutsi' },
  { keys: /\bmakossa\b/i, label: 'makossa' },
  { keys: /\bdrill\b/i, label: 'drill' },
  { keys: /\bgrime\b/i, label: 'grime' },
  { keys: /\bfunk\b/i, label: 'funk' },
  { keys: /\bsoukous\b/i, label: 'soukous' },
  { keys: /\bndombolo\b/i, label: 'ndombolo' },
  { keys: /\brumba\b/i, label: 'rumba' },
  { keys: /\bsoca\b/i, label: 'soca' },
  { keys: /\bgengetone\b/i, label: 'gengetone' },
  { keys: /\bhiplife\b/i, label: 'hiplife' },
  { keys: /\bbongo[- ]?flava\b/i, label: 'bongo-flava' },
  { keys: /\bgospel\b/i, label: 'gospel' },
  { keys: /\btrap\b/i, label: 'trap' },
];

const MOOD_KEYWORDS: Array<{ keys: RegExp; label: string }> = [
  { keys: /\b(chill|relax|mellow|wind\s+down|cozy|vibe)\b/i, label: 'chill' },
  { keys: /\b(party|turn\s+up|hype|banger|lit|vibes)\b/i, label: 'party' },
  { keys: /\b(workout|gym|run|pump|exercise|grind)\b/i, label: 'workout' },
  { keys: /\b(sad|heartbreak|cry|lonely|melancholic|blue|down)\b/i, label: 'melancholy' },
  { keys: /\b(love|romance|slow\s+jam|romantic|feelings)\b/i, label: 'romance' },
  { keys: /\b(focus|study|work|deep\s+work|concentrate|productive)\b/i, label: 'focus' },
  { keys: /\b(sleep|bedtime|wind[- ]?down|night\s+cap|sleepy)\b/i, label: 'sleep' },
  { keys: /\b(morning|wake\s+up|sunrise|early|fresh\s+start)\b/i, label: 'morning-boost' },
  { keys: /\b(late\s+night|3am|midnight|after\s+hours|2am)\b/i, label: 'late-night' },
];

const ARTIST_HINT = /\b(?:burna boy|wizkid|davido|rema|ayra starr|tems|tyla|asake|omah lay|ckay|fela|sampha|frank ocean|kendrick|jay[- ]?z|drake|beyonce|2pac|biggie|nas|andre 3000|outkast|sza|h\.?e\.?r\.?|solange|jorja smith|little simz|kabza de small|kelvin momo|yemi alade|2face idibia|2 face idibia|vigro deep|de mthuda|njelic|dj stokie|romeo makota|stalk ashley|lil wayne|lila ike|naaman|ernest djedje|fantan mojah|black sherif|stonebwoy|sarkodie|m\.?i abaga|asa|tiwa savage|tekno|patoranking|fireboy dml|kizz daniel|joeboy|ruger|victony|bnxn|seun kuti|afrobeats?|afro nation|dj spinall|don jazzy|reekado banks|ladipoe|phyno|falz|olamide|ycee|wande coal|p[- ]?square|dbanj|2baba|flavour|umu obiligbo|diamond platnumz|rayvanny|harmonize|zuchu|vanessa mdee|ali kiba|sauti sol|bahati|masauti|okello max|khaligraph jones|ethic entertainment|nviiri|bien aime baraza|maandy|king kaka|elani|avril|princess jully|wahu|amani|madtraxx|omondi|otile brown|jovial|denno|alikiba|jay melody|barnaba|mbosso|wolper|tanzanite|bongo|kenya|nigeria|ghana|south africa|cameroon|ivory coast|senegal|mali)\b/gi;

// Pattern to extract artist from "I love X" / "X is my fav" / "play more X"
const ARTIST_MENTION_PATTERNS = [
  /(?:i love|my favorite|i like|i'm into|obsessed with|play more)\s+([A-Z][a-zA-Z\s'.]{2,30}?)(?:\s*$|\s*[,!.]|\s+(?:is|was|are|right now|lately|vibes?|music|song|track))/gm,
  /(?:put on|drop some|more)\s+([A-Z][a-zA-Z\s'.]{2,20}?)(?:\s*$|\s*[,!.]|\s+(?:please|right|for me))/gm,
];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ExtractedFact {
  fact: string;
  category: MemoryCategory;
}

function extractFromTurn(turn: ConversationTurn): ExtractedFact[] {
  if (turn.role !== 'user') return [];
  const text = turn.content;
  const facts: ExtractedFact[] = [];

  for (const g of GENRE_KEYWORDS) {
    if (g.keys.test(text)) {
      facts.push({ fact: `User mentions interest in ${g.label}`, category: 'genre' });
    }
  }

  for (const m of MOOD_KEYWORDS) {
    if (m.keys.test(text)) {
      facts.push({ fact: `User gravitates toward ${m.label} vibes`, category: 'mood' });
    }
  }

  // Known-artist regex
  const artistMatches = text.match(ARTIST_HINT);
  const artistSet = new Set<string>();
  if (artistMatches) {
    for (const a of artistMatches) artistSet.add(a.toLowerCase());
  }
  // Free-form "I love / put on / more X" extraction
  for (const pattern of ARTIST_MENTION_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const candidate = m[1]?.trim();
      if (candidate && candidate.length > 2 && candidate.length < 40) {
        artistSet.add(candidate.toLowerCase());
      }
    }
  }
  for (const a of artistSet) {
    facts.push({ fact: `User mentioned ${a} positively`, category: 'artist' });
  }

  // Explicit love/hate statements
  if (/\bi love\b|\bmy favorite\b|\blove this\b/i.test(text)) {
    facts.push({
      fact: `User expressed love: "${text.slice(0, 120)}"`,
      category: 'preference',
    });
  }

  if (/\bi hate\b|\bnot into\b|\bcan'?t stand\b/i.test(text)) {
    facts.push({
      fact: `User disliked: "${text.slice(0, 120)}"`,
      category: 'preference',
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Public API — run after a user message to learn
// ---------------------------------------------------------------------------

export async function digest(turn: ConversationTurn): Promise<string[]> {
  const facts = extractFromTurn(turn);
  const savedTexts: string[] = [];

  for (const f of facts) {
    const mem = await saveEssence(f.fact, f.category, 'inferred');
    savedTexts.push(mem.fact);
  }

  return savedTexts;
}

/**
 * Consolidate a full session — called at end of session via resetSession().
 * Groups signals into higher-level facts.
 */
export async function consolidate(turns: ConversationTurn[]): Promise<string[]> {
  const allFacts: ExtractedFact[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      allFacts.push(...extractFromTurn(t));
    }
  }

  // Collapse duplicates
  const seen = new Set<string>();
  const unique: ExtractedFact[] = [];
  for (const f of allFacts) {
    if (!seen.has(f.fact)) {
      seen.add(f.fact);
      unique.push(f);
    }
  }

  const saved: string[] = [];
  for (const f of unique) {
    const mem = await saveEssence(f.fact, f.category, 'inferred');
    saved.push(mem.fact);
  }
  return saved;
}
