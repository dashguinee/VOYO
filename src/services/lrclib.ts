/**
 * LRCLIB - Free Synced Lyrics API
 * https://lrclib.net/docs
 *
 * ~3 million songs, completely free, no API key needed!
 * Returns both plain lyrics and synced LRC format with timestamps.
 */

const LRCLIB_BASE = 'https://lrclib.net/api';

// ============================================
// TYPES
// ============================================

export interface LRCLibTrack {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;  // LRC format: "[00:07.51] Ohh na-na"
}

export interface ParsedLyricLine {
  time: number;      // seconds
  text: string;
}

export interface LRCLibResult {
  found: boolean;
  track?: LRCLibTrack;
  lines?: ParsedLyricLine[];
  plain?: string;
  synced?: string;
  source: 'lrclib';
}

// ============================================
// API FUNCTIONS
// ============================================

/**
 * Get lyrics by exact track name and artist
 * This is the fastest - use when you have exact metadata
 */
export async function getLyrics(
  trackName: string,
  artistName: string,
  duration?: number
): Promise<LRCLibResult> {
  try {
    const params = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
    });

    if (duration) {
      params.set('duration', Math.round(duration).toString());
    }

    const response = await fetch(`${LRCLIB_BASE}/get?${params}`, {
      headers: {
        'User-Agent': 'VOYO Music/1.0 (https://voyomusic.com)',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { found: false, source: 'lrclib' };
      }
      throw new Error(`LRCLIB error: ${response.status}`);
    }

    const track: LRCLibTrack = await response.json();

    if (!track.plainLyrics && !track.syncedLyrics) {
      return { found: false, source: 'lrclib' };
    }

    const lines = track.syncedLyrics ? parseLRC(track.syncedLyrics) : undefined;

    return {
      found: true,
      track,
      lines,
      plain: track.plainLyrics || undefined,
      synced: track.syncedLyrics || undefined,
      source: 'lrclib',
    };
  } catch (error) {
    console.warn('[LRCLIB] Get failed:', error);
    return { found: false, source: 'lrclib' };
  }
}

/**
 * Search for lyrics - use when exact match might not work
 * Returns multiple results to choose from
 */
export async function searchLyrics(
  query: string,
  limit: number = 5
): Promise<LRCLibTrack[]> {
  try {
    const params = new URLSearchParams({
      q: query,
    });

    const response = await fetch(`${LRCLIB_BASE}/search?${params}`, {
      headers: {
        'User-Agent': 'VOYO Music/1.0 (https://voyomusic.com)',
      },
    });

    if (!response.ok) {
      throw new Error(`LRCLIB search error: ${response.status}`);
    }

    const results: LRCLibTrack[] = await response.json();
    return results.slice(0, limit);
  } catch (error) {
    console.warn('[LRCLIB] Search failed:', error);
    return [];
  }
}

/**
 * Smart lyrics fetch - tries exact match first, then search
 */
export async function fetchLyrics(
  trackName: string,
  artistName: string,
  duration?: number
): Promise<LRCLibResult> {
  // Clean up track name (remove " - Topic", "(Official Video)", etc.)
  const cleanTrack = cleanTrackName(trackName);
  const cleanArtist = cleanArtistName(artistName);

  console.log(`[LRCLIB] Fetching: "${cleanTrack}" by ${cleanArtist}`);

  // 1. Try exact match first
  let result = await getLyrics(cleanTrack, cleanArtist, duration);
  if (result.found) {
    console.log('[LRCLIB] ✅ Found via exact match');
    return result;
  }

  // 2. Try search as fallback
  const searchResults = await searchLyrics(`${cleanTrack} ${cleanArtist}`);
  if (searchResults.length > 0) {
    // Find best match by duration if available
    let bestMatch = searchResults[0];

    if (duration) {
      const durationMatch = searchResults.find(
        r => Math.abs(r.duration - duration) < 10
      );
      if (durationMatch) {
        bestMatch = durationMatch;
      }
    }

    if (bestMatch.plainLyrics || bestMatch.syncedLyrics) {
      const lines = bestMatch.syncedLyrics ? parseLRC(bestMatch.syncedLyrics) : undefined;

      console.log('[LRCLIB] ✅ Found via search');
      return {
        found: true,
        track: bestMatch,
        lines,
        plain: bestMatch.plainLyrics || undefined,
        synced: bestMatch.syncedLyrics || undefined,
        source: 'lrclib',
      };
    }
  }

  console.log('[LRCLIB] ❌ Not found');
  return { found: false, source: 'lrclib' };
}

// ============================================
// LRC PARSING
// ============================================

/**
 * Parse LRC format into timed lines
 * Format: "[00:07.51] Ohh na-na"
 */
export function parseLRC(lrc: string): ParsedLyricLine[] {
  const lines: ParsedLyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/g;

  let match;
  while ((match = regex.exec(lrc)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const ms = parseInt(match[3].padEnd(3, '0'), 10);

    const time = minutes * 60 + seconds + ms / 1000;
    const text = match[4].trim();

    if (text) {  // Skip empty lines
      lines.push({ time, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Get current lyric line for a given playback time
 */
export function getCurrentLine(
  lines: ParsedLyricLine[],
  currentTime: number
): ParsedLyricLine | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].time <= currentTime) {
      return lines[i];
    }
  }
  return null;
}

/**
 * Get current and upcoming lines for karaoke display
 */
export function getLyricWindow(
  lines: ParsedLyricLine[],
  currentTime: number,
  windowSize: number = 4
): { current: ParsedLyricLine | null; upcoming: ParsedLyricLine[] } {
  let currentIndex = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].time <= currentTime) {
      currentIndex = i;
      break;
    }
  }

  const current = currentIndex >= 0 ? lines[currentIndex] : null;
  const upcoming = lines.slice(
    Math.max(0, currentIndex + 1),
    currentIndex + 1 + windowSize
  );

  return { current, upcoming };
}

// ============================================
// HELPERS
// ============================================

function cleanTrackName(name: string): string {
  return name
    .replace(/\s*\(Official.*?\)/gi, '')
    .replace(/\s*\(Audio.*?\)/gi, '')
    .replace(/\s*\(Lyric.*?\)/gi, '')
    .replace(/\s*\(Music Video.*?\)/gi, '')
    .replace(/\s*\[.*?\]/g, '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArtistName(name: string): string {
  return name
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s*Official$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================
// CACHE (localStorage)
// ============================================

const CACHE_KEY = 'voyo_lrclib_cache';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  result: LRCLibResult;
  timestamp: number;
}

function getCacheKey(trackName: string, artistName: string): string {
  return `${trackName.toLowerCase()}|${artistName.toLowerCase()}`;
}

export function getCachedLyrics(trackName: string, artistName: string): LRCLibResult | null {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const key = getCacheKey(trackName, artistName);
    const entry: CacheEntry | undefined = cache[key];

    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.result;
    }
  } catch {
    // Ignore cache errors
  }
  return null;
}

export function cacheLyrics(
  trackName: string,
  artistName: string,
  result: LRCLibResult
): void {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const key = getCacheKey(trackName, artistName);

    cache[key] = {
      result,
      timestamp: Date.now(),
    } as CacheEntry;

    // Keep cache under 100 entries
    const keys = Object.keys(cache);
    if (keys.length > 100) {
      const oldest = keys
        .map(k => ({ key: k, ts: cache[k].timestamp }))
        .sort((a, b) => a.ts - b.ts)
        .slice(0, 20);
      oldest.forEach(({ key }) => delete cache[key]);
    }

    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore cache errors
  }
}

/**
 * Main entry point - checks cache first, then fetches
 */
export async function getLyricsWithCache(
  trackName: string,
  artistName: string,
  duration?: number
): Promise<LRCLibResult> {
  // Check cache first
  const cached = getCachedLyrics(trackName, artistName);
  if (cached) {
    console.log('[LRCLIB] ✅ Cache hit');
    return cached;
  }

  // Fetch from API
  const result = await fetchLyrics(trackName, artistName, duration);

  // Cache the result (even if not found, to avoid repeated lookups)
  cacheLyrics(trackName, artistName, result);

  return result;
}

console.log('[LRCLIB] Service loaded - Free lyrics for everyone! 🎵');
