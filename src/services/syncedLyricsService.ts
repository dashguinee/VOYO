/**
 * Synced Lyrics Service - Community Edition
 *
 * Calls the Python backend (lyrics_dynamic.py) which uses syncedlyrics
 * to fetch from multiple community sources: Musixmatch, NetEase, Megalobiz, Lrclib
 *
 * This is the PRIMARY lyrics source - best coverage for African music.
 */

const LYRICS_API_URL = import.meta.env.VITE_LYRICS_API_URL || 'http://localhost:3099';

export interface SyncedLine {
  time: number;
  text: string;
}

export interface SyncedLyricsResult {
  found: boolean;
  youtube_id: string;
  title: string;
  artist: string;
  synced: boolean;
  lines: SyncedLine[];
  lrc: string;
  plain: string;
}

/**
 * Fetch lyrics by YouTube ID
 */
export async function fetchByYoutubeId(
  youtubeId: string,
  title?: string,
  artist?: string
): Promise<SyncedLyricsResult> {
  try {
    const params = new URLSearchParams({ id: youtubeId });
    if (title) params.set('title', title);
    if (artist) params.set('artist', artist);

    const response = await fetch(`${LYRICS_API_URL}/lyrics?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn('[SyncedLyrics] Backend not available, using fallback');
    return {
      found: false,
      youtube_id: youtubeId,
      title: title || '',
      artist: artist || '',
      synced: false,
      lines: [],
      lrc: '',
      plain: '',
    };
  }
}

/**
 * Search lyrics by query string
 */
export async function searchLyrics(query: string): Promise<SyncedLyricsResult> {
  try {
    const params = new URLSearchParams({ q: query });

    const response = await fetch(`${LYRICS_API_URL}/lyrics?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn('[SyncedLyrics] Search failed:', error);
    return {
      found: false,
      youtube_id: '',
      title: query,
      artist: '',
      synced: false,
      lines: [],
      lrc: '',
      plain: '',
    };
  }
}

/**
 * Check if lyrics backend is available
 */
export async function isBackendAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${LYRICS_API_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Convert SyncedLyricsResult to LRC format string
 */
export function toLRC(result: SyncedLyricsResult): string {
  if (result.lrc) return result.lrc;

  return result.lines
    .map(line => {
      const mins = Math.floor(line.time / 60);
      const secs = Math.floor(line.time % 60);
      const ms = Math.floor((line.time % 1) * 100);
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}] ${line.text}`;
    })
    .join('\n');
}

console.log('[SyncedLyrics] Service loaded - Community lyrics via syncedlyrics');
