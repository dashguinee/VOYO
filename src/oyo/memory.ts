/**
 * OYO Memory — Long-term memory persistence.
 *
 * Uses IndexedDB for essence memory (potentially unlimited) + behavior signals,
 * and localStorage for the OYO consciousness state (small, critical, sync read).
 *
 * Operations are fault-tolerant: never throw, always resolve. If IDB is
 * unavailable (SSR, private mode), everything falls back to in-memory only.
 */

import type { EssenceMemory, BehaviorSignal, MemoryCategory } from './schema';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'voyo-oyo-brain';
const DB_VERSION = 1;

const STORES = {
  essence: 'essence',
  signals: 'signals',
  meta: 'meta',
} as const;

type StoreName = typeof STORES[keyof typeof STORES];

const MAX_SIGNALS = 2000; // ring buffer — drop oldest when full
const MAX_ESSENCES = 500;

// ---------------------------------------------------------------------------
// IDB singleton
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;
let idbAvailable = true;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        idbAvailable = false;
        reject(new Error('IndexedDB not available'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.essence)) {
          const store = db.createObjectStore(STORES.essence, { keyPath: 'id' });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.signals)) {
          const store = db.createObjectStore(STORES.signals, { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta);
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbAvailable = false;
        reject(req.error);
      };
    } catch (err) {
      idbAvailable = false;
      reject(err);
    }
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Generic helpers (all silent-fail)
// ---------------------------------------------------------------------------

async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* silent */
  }
}

async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  try {
    const db = await openDB();
    return await new Promise<T[]>((resolve) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function idbDelete(store: StoreName, key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* silent */
  }
}

async function idbClear(store: StoreName): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* silent */
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (always populated, used when IDB is unavailable)
// ---------------------------------------------------------------------------

const fallbackEssences = new Map<string, EssenceMemory>();
const fallbackSignals = new Map<string, BehaviorSignal>();

// ---------------------------------------------------------------------------
// Essence API
// ---------------------------------------------------------------------------

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function saveEssence(
  fact: string,
  category: MemoryCategory = 'preference',
  source: EssenceMemory['source'] = 'user-told',
): Promise<EssenceMemory> {
  // Dedupe — if an essence with very similar text exists, bump it instead
  const existing = await findSimilarEssence(fact);
  if (existing) {
    existing.mentionCount += 1;
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.updatedAt = Date.now();
    await persistEssence(existing);
    return existing;
  }

  const memory: EssenceMemory = {
    id: newId('ess'),
    fact: fact.trim().slice(0, 400),
    category,
    confidence: source === 'user-told' ? 0.8 : 0.5,
    mentionCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source,
  };

  await persistEssence(memory);
  await enforceEssenceCap();
  return memory;
}

async function persistEssence(memory: EssenceMemory): Promise<void> {
  fallbackEssences.set(memory.id, memory);
  if (idbAvailable) {
    await idbPut(STORES.essence, memory);
  }
}

async function findSimilarEssence(fact: string): Promise<EssenceMemory | null> {
  const all = await listEssences();
  const normalized = fact.toLowerCase().trim();
  const words = new Set(normalized.split(/\s+/).filter((w) => w.length > 3));
  if (words.size === 0) return null;

  for (const m of all) {
    const mWords = new Set(m.fact.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...words].filter((w) => mWords.has(w)).length;
    const similarity = overlap / Math.max(words.size, mWords.size);
    if (similarity >= 0.6) return m;
  }
  return null;
}

export async function listEssences(): Promise<EssenceMemory[]> {
  if (idbAvailable) {
    const all = await idbGetAll<EssenceMemory>(STORES.essence);
    // Seed fallback cache
    all.forEach((e) => fallbackEssences.set(e.id, e));
    return all;
  }
  return [...fallbackEssences.values()];
}

export async function searchEssences(topic: string, limit = 10): Promise<EssenceMemory[]> {
  const all = await listEssences();
  const q = topic.toLowerCase().trim();
  if (!q) return all.slice(0, limit);

  const words = q.split(/\s+/).filter((w) => w.length > 2);

  const scored = all
    .map((m) => {
      let score = 0;
      const text = m.fact.toLowerCase();
      for (const w of words) {
        if (text.includes(w)) score += 10;
      }
      if (text.includes(q)) score += 20;
      score += m.confidence * 5;
      score += Math.min(10, m.mentionCount);
      return { memory: m, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.memory);
}

export async function deleteEssence(id: string): Promise<void> {
  fallbackEssences.delete(id);
  if (idbAvailable) await idbDelete(STORES.essence, id);
}

async function enforceEssenceCap(): Promise<void> {
  const all = await listEssences();
  if (all.length <= MAX_ESSENCES) return;

  // Drop lowest-confidence + oldest
  const sorted = [...all].sort((a, b) => {
    const scoreA = a.confidence * 10 + a.mentionCount;
    const scoreB = b.confidence * 10 + b.mentionCount;
    return scoreA - scoreB;
  });

  const toDrop = sorted.slice(0, all.length - MAX_ESSENCES);
  for (const m of toDrop) {
    await deleteEssence(m.id);
  }
}

// ---------------------------------------------------------------------------
// Signal API
// ---------------------------------------------------------------------------

export async function recordSignal(
  signal: Omit<BehaviorSignal, 'id' | 'timestamp'>,
): Promise<void> {
  const full: BehaviorSignal = {
    ...signal,
    id: newId('sig'),
    timestamp: Date.now(),
  };

  fallbackSignals.set(full.id, full);
  if (idbAvailable) {
    await idbPut(STORES.signals, full);
  }

  // Trim if over cap
  if (fallbackSignals.size > MAX_SIGNALS) {
    await enforceSignalCap();
  }
}

export async function listSignals(limit = 200): Promise<BehaviorSignal[]> {
  let all: BehaviorSignal[];
  if (idbAvailable) {
    all = await idbGetAll<BehaviorSignal>(STORES.signals);
    all.forEach((s) => fallbackSignals.set(s.id, s));
  } else {
    all = [...fallbackSignals.values()];
  }
  return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

async function enforceSignalCap(): Promise<void> {
  const all = await listSignals(10_000);
  if (all.length <= MAX_SIGNALS) return;

  const toDrop = all.slice(MAX_SIGNALS);
  for (const s of toDrop) {
    fallbackSignals.delete(s.id);
    if (idbAvailable) await idbDelete(STORES.signals, s.id);
  }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export async function clearMemory(): Promise<void> {
  fallbackEssences.clear();
  fallbackSignals.clear();
  if (idbAvailable) {
    await idbClear(STORES.essence);
    await idbClear(STORES.signals);
  }
}

export function isMemoryAvailable(): boolean {
  return idbAvailable;
}
