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
  { keys: /\belectro|house|techno|edm\b/i, label: 'electronic' },
  { keys: /\bindie\b/i, label: 'indie' },
  { keys: /\bk[- ]?pop\b/i, label: 'k-pop' },
  { keys: /\bafropop\b|\bafro[- ]?fusion\b/i, label: 'afro-fusion' },
  { keys: /\blo[- ]?fi\b/i, label: 'lo-fi' },
];

const MOOD_KEYWORDS: Array<{ keys: RegExp; label: string }> = [
  { keys: /\bchill|relax|mellow|wind down|cozy\b/i, label: 'chill' },
  { keys: /\bparty|turn up|hype|banger\b/i, label: 'party' },
  { keys: /\bworkout|gym|run|pump\b/i, label: 'workout' },
  { keys: /\bsad|heartbreak|cry|lonely|melancholic\b/i, label: 'melancholy' },
  { keys: /\blove|romance|slow jam\b/i, label: 'romance' },
  { keys: /\bfocus|study|work|deep work\b/i, label: 'focus' },
  { keys: /\bsleep|bedtime|wind[- ]?down\b/i, label: 'sleep' },
  { keys: /\bmorning|wake up\b/i, label: 'morning-boost' },
  { keys: /\blate night|3am|midnight\b/i, label: 'late-night' },
];

const ARTIST_HINT = /\b(?:burna boy|wizkid|davido|rema|ayra starr|tems|tyla|asake|omah lay|ckay|fela|sampha|frank ocean|kendrick|jay[- ]?z|drake|beyonce|2pac|biggie|nas|andre 3000|outkast|sza|h\.?e\.?r\.?|solange|jorja smith|little simz)\b/gi;

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

  const artistMatches = text.match(ARTIST_HINT);
  if (artistMatches) {
    const unique = [...new Set(artistMatches.map((a) => a.toLowerCase()))];
    for (const a of unique) {
      facts.push({ fact: `User mentioned ${a} positively`, category: 'artist' });
    }
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
