/**
 * OYO Soussou — Guinea-specific language weaving.
 *
 * Core Soussou phrases and a weaver helper that returns a random, contextual
 * Soussou expression when the user is detected to be in Guinea. Ported from
 * Guinius's soussou.ts + soussou-dictionary.ts — only the inline core vocab
 * needed for conversational weaving. The full 90K-entry dictionary is not
 * needed for Phase 1 (music chat, not language teaching).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SoussouPhrase {
  soussou: string;
  french: string;
  english: string;
  category: 'greeting' | 'encouragement' | 'vibe' | 'daily' | 'connection';
}

// ---------------------------------------------------------------------------
// Core phrases — warm, music-scene friendly
// ---------------------------------------------------------------------------

export const SOUSSOU_GREETINGS: SoussouPhrase[] = [
  { soussou: 'Anadi?', french: 'Quoi de neuf ?', english: "What's up?", category: 'greeting' },
  { soussou: 'Tanàmoufègnê?', french: 'Comment ça va ?', english: 'How are you?', category: 'greeting' },
  { soussou: 'I kena', french: 'Bienvenue', english: 'Welcome', category: 'greeting' },
  { soussou: 'Tanante', french: 'Merci', english: 'Thank you', category: 'greeting' },
  { soussou: 'N bara', french: "C'est bien", english: "That's good", category: 'greeting' },
  { soussou: 'Wo sa', french: 'Bonsoir', english: 'Good evening', category: 'greeting' },
  { soussou: 'Kira kirin', french: 'Bonjour', english: 'Good morning', category: 'greeting' },
  { soussou: 'Awa', french: "D'accord", english: 'Okay', category: 'greeting' },
];

export const SOUSSOU_ENCOURAGEMENTS: SoussouPhrase[] = [
  { soussou: 'Munafanyi!', french: 'Excellent !', english: 'Excellent!', category: 'encouragement' },
  { soussou: 'I xa wali fanyi!', french: 'Tu fais du bon travail !', english: "You're doing great!", category: 'encouragement' },
  { soussou: 'Siga yire fanyi', french: 'Continue comme ça', english: 'Keep going like that', category: 'encouragement' },
  { soussou: 'Ala i mali', french: 'Que Dieu t’aide', english: 'May God help you', category: 'encouragement' },
];

export const SOUSSOU_VIBE: SoussouPhrase[] = [
  { soussou: 'A fanyi ki fanyi!', french: "C'est trop bon !", english: 'This is too good!', category: 'vibe' },
  { soussou: 'Wasa na yi', french: 'Le bonheur est ici', english: 'The happiness is here', category: 'vibe' },
  { soussou: 'Tofan na', french: "C'est beau", english: 'This is beautiful', category: 'vibe' },
  { soussou: 'A rayabou', french: 'Magnifique', english: 'Gorgeous', category: 'vibe' },
  { soussou: 'N bara ki fanyi', french: 'Je vais très bien', english: "I'm doing great", category: 'vibe' },
];

export const SOUSSOU_CONNECTION: SoussouPhrase[] = [
  { soussou: 'N bore', french: 'Mon ami', english: 'My friend', category: 'connection' },
  { soussou: 'Won na siga', french: 'On y va', english: "Let's go", category: 'connection' },
  { soussou: 'Fo naxan tide', french: 'Pas de problème', english: 'No problem', category: 'connection' },
  { soussou: 'Siga kenema', french: 'Bonne route', english: 'Safe travels', category: 'connection' },
];

const ALL_PHRASES: SoussouPhrase[] = [
  ...SOUSSOU_GREETINGS,
  ...SOUSSOU_ENCOURAGEMENTS,
  ...SOUSSOU_VIBE,
  ...SOUSSOU_CONNECTION,
];

// ---------------------------------------------------------------------------
// Locale detection + weaving
// ---------------------------------------------------------------------------

/**
 * Is this a locale where Soussou weaving is appropriate?
 *
 * Soussou is Guinean, so the safe default is Guinea locales only. But this
 * check is also the gate for a per-user override — a Guinean user living
 * abroad (e.g. Dash in Kuala Lumpur) can flip `localStorage.voyo_soussou_on`
 * to `1` and get the weaving regardless of geo. We explicitly do NOT enable
 * Soussou for all Malaysian users because most don't speak it; it's only on
 * for users who opt in.
 */
export function isSoussouEnabled(locale: string | undefined): boolean {
  // Manual override (per-user preference, persists across sessions)
  if (typeof window !== 'undefined') {
    try {
      if (localStorage.getItem('voyo_soussou_on') === '1') return true;
      if (localStorage.getItem('voyo_soussou_on') === '0') return false;
    } catch {
      // localStorage unavailable (SSR, private mode) — fall through to locale check
    }
  }

  // Locale-based auto-detect (Guinea users get it by default)
  if (!locale) return false;
  const lower = locale.toLowerCase();
  return lower === 'gn' || lower === 'fr-gn' || lower.startsWith('gn-') || lower.endsWith('-gn');
}

/** @deprecated Use isSoussouEnabled — kept for backwards compatibility */
export function isGuineaLocale(locale: string | undefined): boolean {
  return isSoussouEnabled(locale);
}

/**
 * Returns a random Soussou phrase if the user is in Guinea, otherwise null.
 * Optional category filter narrows the pick.
 */
export function weaveSoussou(
  userLocale: string | undefined,
  category?: SoussouPhrase['category'],
): SoussouPhrase | null {
  if (!isSoussouEnabled(userLocale)) return null;

  const pool = category
    ? ALL_PHRASES.filter((p) => p.category === category)
    : ALL_PHRASES;

  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Builds the Soussou instruction block to inject into OYO's system prompt
 * when the user is detected to be in Guinea.
 */
export function buildSoussouBlock(userLocale: string | undefined): string {
  if (!isSoussouEnabled(userLocale)) return '';

  const examples = ALL_PHRASES.slice(0, 12)
    .map((p) => `- "${p.soussou}" = ${p.english}`)
    .join('\n');

  return `=== SOUSSOU (Guinean listener detected) ===
The listener is in Guinea. Occasionally sprinkle Soussou expressions into your responses to connect culturally. Do NOT force it — use it like a Guinean friend would, naturally and warmly.
Safe, verified phrases to use:
${examples}
Rules:
- Never invent Soussou words. Only use the phrases above.
- Use Latin alphabet only (a-z), never special characters.
- Greet in Soussou sometimes: "Anadi?", "Tanàmoufègnê?"
- Celebrate finds with "Munafanyi!" or "A fanyi ki fanyi!"
- Say thanks with "Tanante"`;
}

export function getAllPhrases(): SoussouPhrase[] {
  return ALL_PHRASES;
}
