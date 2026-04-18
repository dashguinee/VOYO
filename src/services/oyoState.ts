/**
 * oyoState — OYO's three-file relationship state, persisted in IndexedDB.
 *
 * deck.json  — evolving track deck (OG → OGn), the music relationship
 * tone.md    — how OYO communicates with this user
 * memory.md  — lightweight ZION-style context (key taste facts)
 *
 * All three fit in IndexedDB. No server reads at runtime. OYO boots from local state.
 */

export interface OyoDeck {
  generation: number;           // 0 = OG seed, increments on each evolution
  trackIds: string[];           // ordered deck, max 50
  metadata: Record<string, {    // lightweight track info per id
    title: string;
    artist: string;
    addedAt: number;
    source: 'seed' | 'oye' | 'search' | 'playlist' | 'oyo';
  }>;
  evolvedAt: number;            // timestamp of last evolution
}

export interface OyoStateBundle {
  deck: OyoDeck;
  tone: string;       // markdown
  memory: string;     // markdown
}

export interface OyoSignals {
  oyes: string[];
  searches: string[];
  skippedIds: string[];
  addedToPlaylist: string[];
}

// Mid-flight vibe check state — module-level, resets on page reload (by design)
interface VibeCheckState {
  songsPlayedSinceCheck: number;
  lastCheckAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'voyo-oyo';
const DB_VERSION = 1;
const STORE_NAME = 'state';

const KEY_DECK = 'deck';
const KEY_TONE = 'tone';
const KEY_MEMORY = 'memory';

const MAX_DECK_SIZE = 50;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_DECK: OyoDeck = {
  generation: 0,
  trackIds: [],
  metadata: {},
  evolvedAt: Date.now(),
};

const DEFAULT_TONE = 'Warm, direct, DJ energy. Matches user\'s vibe. African music roots.';

const DEFAULT_MEMORY = '# OYO Memory\n\nNew listener. No preferences learned yet.';

// ---------------------------------------------------------------------------
// IndexedDB layer
// ---------------------------------------------------------------------------

let dbInstance: IDBDatabase | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function dbGet(key: string): Promise<unknown> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = (event) => {
      resolve((event.target as IDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBRequest).error);
    };
  });
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = (event) => {
      reject((event.target as IDBRequest).error);
    };
  });
}

// ---------------------------------------------------------------------------
// State operations
// ---------------------------------------------------------------------------

export async function loadOyoState(): Promise<OyoStateBundle> {
  const [rawDeck, rawTone, rawMemory] = await Promise.all([
    dbGet(KEY_DECK),
    dbGet(KEY_TONE),
    dbGet(KEY_MEMORY),
  ]);

  const deck: OyoDeck = (rawDeck as OyoDeck) ?? { ...DEFAULT_DECK, evolvedAt: Date.now() };
  const tone: string = typeof rawTone === 'string' ? rawTone : DEFAULT_TONE;
  const memory: string = typeof rawMemory === 'string' ? rawMemory : DEFAULT_MEMORY;

  return { deck, tone, memory };
}

export async function saveDeck(deck: OyoDeck): Promise<void> {
  await dbSet(KEY_DECK, deck);
}

export async function saveTone(tone: string): Promise<void> {
  await dbSet(KEY_TONE, tone);
}

export async function saveMemory(memory: string): Promise<void> {
  await dbSet(KEY_MEMORY, memory);
}

// ---------------------------------------------------------------------------
// Deck evolution
// ---------------------------------------------------------------------------

export async function evolveDeck(current: OyoDeck, signals: OyoSignals): Promise<OyoDeck> {
  const nextGeneration = current.generation + 1;

  // Count skip occurrences — tracks skipped 2+ times get removed
  const skipCounts: Record<string, number> = {};
  for (const id of signals.skippedIds) {
    skipCounts[id] = (skipCounts[id] ?? 0) + 1;
  }

  const persistentSkips = new Set(
    Object.entries(skipCounts)
      .filter(([, count]) => count >= 2)
      .map(([id]) => id)
  );

  // Build next trackIds — remove persistent skips, preserve order
  const filteredIds = current.trackIds.filter((id) => !persistentSkips.has(id));

  // Trim to max deck size
  const nextTrackIds = filteredIds.slice(0, MAX_DECK_SIZE);

  // Copy metadata, drop entries for removed tracks
  const nextMetadata: OyoDeck['metadata'] = {};
  for (const id of nextTrackIds) {
    if (current.metadata[id]) {
      nextMetadata[id] = current.metadata[id];
    }
  }

  const evolved: OyoDeck = {
    generation: nextGeneration,
    trackIds: nextTrackIds,
    metadata: nextMetadata,
    evolvedAt: Date.now(),
  };

  console.log(
    `[OYO] Deck evolved OG${current.generation} → OG${nextGeneration}. ` +
    `Removed ${persistentSkips.size} persistent skip(s). ` +
    `Deck size: ${current.trackIds.length} → ${nextTrackIds.length}. ` +
    `Signals — oyes: ${signals.oyes.length}, searches: ${signals.searches.length}, ` +
    `addedToPlaylist: ${signals.addedToPlaylist.length}. ` +
    `(LLM enrichment: phase 2)`
  );

  return evolved;
}

// ---------------------------------------------------------------------------
// Mid-flight vibe check
// ---------------------------------------------------------------------------

const vibeCheck: VibeCheckState = {
  songsPlayedSinceCheck: 0,
  lastCheckAt: Date.now(),
};

/** Returns true if a vibe check is now due. Resets the counter when triggered. */
export function recordTrackPlayed(): boolean {
  vibeCheck.songsPlayedSinceCheck++;
  const songsDue = vibeCheck.songsPlayedSinceCheck >= 5;
  const timeDue = Date.now() - vibeCheck.lastCheckAt >= 15 * 60_000; // 15 min

  if (songsDue || timeDue) {
    vibeCheck.songsPlayedSinceCheck = 0;
    vibeCheck.lastCheckAt = Date.now();
    return true;
  }

  return false;
}

export function resetVibeCheck(): void {
  vibeCheck.songsPlayedSinceCheck = 0;
  vibeCheck.lastCheckAt = Date.now();
}

// ---------------------------------------------------------------------------
// Rapid skip handler
// ---------------------------------------------------------------------------

/**
 * OYO's response when voyoStream signals rapid skipping.
 * Picks a track from the second half of the deck — less familiar = pivot energy.
 */
export async function handleRapidSkip(deck: OyoDeck): Promise<{ pivotTrackId: string | null }> {
  const candidates = deck.trackIds.slice(Math.floor(deck.trackIds.length / 2));
  if (candidates.length === 0) return { pivotTrackId: null };
  const pivotTrackId = candidates[Math.floor(Math.random() * candidates.length)];
  return { pivotTrackId };
}
