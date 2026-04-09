/**
 * VOYO Music - Search Result Cache
 * LRU Cache with TTL for search results
 * Prevents duplicate API calls for same query
 */

import { SearchResult } from '../services/api';

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

class SearchCache {
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly ttl: number; // Time to live in milliseconds

  constructor(maxSize: number = 50, ttlMinutes: number = 5) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttlMinutes * 60 * 1000;
  }

  /**
   * Get cached results for a query
   * Returns null if not found or expired
   */
  get(query: string): SearchResult[] | null {
    const key = this.normalizeQuery(query);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.results;
  }

  /**
   * Store results for a query
   * Implements LRU eviction when cache is full
   */
  set(query: string, results: SearchResult[]): void {
    const key = this.normalizeQuery(query);

    // If cache is full, remove oldest entry (first in Map)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    // Delete and re-add to move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, {
      results,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if query is cached and valid
   */
  has(query: string): boolean {
    return this.get(query) !== null;
  }

  /**
   * Clear all cached results
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats for debugging
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      queries: Array.from(this.cache.keys()),
    };
  }

  /**
   * Normalize query for consistent cache keys
   * - Lowercase
   * - Trim whitespace
   * - Collapse multiple spaces
   */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }
}

// Singleton instance
export const searchCache = new SearchCache();
