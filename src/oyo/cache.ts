/**
 * OYO Response Cache — short-TTL LRU cache for Gemini responses.
 *
 * Keyed by a fingerprint of (system prompt hash + user message hash + context hash).
 * TTL: 5 minutes. Max entries: 50. In-memory only — cheap and fast.
 * Purpose: avoid re-paying for identical back-to-back prompts during dev/test.
 */

interface CacheEntry {
  fingerprint: string;
  value: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 50;

const store = new Map<string, CacheEntry>();

function hash(input: string): string {
  // djb2 — small, fast, good enough for cache keys
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function fingerprint(parts: string[]): string {
  return parts.map(hash).join('_');
}

export function getCached(fp: string): string | null {
  const entry = store.get(fp);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(fp);
    return null;
  }
  return entry.value;
}

export function setCached(fp: string, value: string): void {
  if (store.size >= MAX_ENTRIES) {
    // Drop oldest entry (first key in insertion order)
    const firstKey = store.keys().next().value;
    if (firstKey) store.delete(firstKey);
  }
  store.set(fp, {
    fingerprint: fp,
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function clearCache(): void {
  store.clear();
}

export function cacheStats(): { entries: number; maxEntries: number; ttlMs: number } {
  return { entries: store.size, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS };
}
