/**
 * Genius Lyrics Scraper - Grey Zone
 * No API key needed, just scrapes the pages
 * Best coverage for African/Afrobeats music
 */

const GENIUS_SEARCH = 'https://genius.com/api/search/multi';
const CORS_PROXY = 'https://corsproxy.io/?';

export interface GeniusResult {
  found: boolean;
  title?: string;
  artist?: string;
  lyrics?: string;
  url?: string;
  source: 'genius';
}

/**
 * Search Genius for a track
 */
async function searchGenius(query: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ q: query });
    const url = `${CORS_PROXY}${encodeURIComponent(`${GENIUS_SEARCH}?${params}`)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const songs = data?.response?.sections?.find((s: any) => s.type === 'song')?.hits;

    if (songs && songs.length > 0) {
      return songs[0].result.url;
    }
    return null;
  } catch (error) {
    console.warn('[Genius] Search failed:', error);
    return null;
  }
}

/**
 * Scrape lyrics from Genius page
 */
async function scrapeLyrics(geniusUrl: string): Promise<string | null> {
  try {
    const url = `${CORS_PROXY}${encodeURIComponent(geniusUrl)}`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const html = await response.text();

    // Extract lyrics from the page
    // Genius uses data-lyrics-container="true" for lyrics divs
    const lyricsMatch = html.match(/data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g);

    if (!lyricsMatch) {
      // Try alternate pattern
      const altMatch = html.match(/<div class="lyrics"[^>]*>([\s\S]*?)<\/div>/);
      if (altMatch) {
        return cleanLyrics(altMatch[1]);
      }
      return null;
    }

    // Combine all lyrics containers
    const lyrics = lyricsMatch
      .map(div => {
        // Remove HTML tags but keep line breaks
        return div
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
      })
      .join('\n\n');

    return cleanLyrics(lyrics);
  } catch (error) {
    console.warn('[Genius] Scrape failed:', error);
    return null;
  }
}

function cleanLyrics(text: string): string {
  return text
    .replace(/\[.*?\]/g, '\n')  // Keep section markers as line breaks
    .replace(/\n{3,}/g, '\n\n') // Max 2 newlines
    .trim();
}

/**
 * Main entry - search and scrape
 */
export async function getGeniusLyrics(
  trackName: string,
  artistName: string
): Promise<GeniusResult> {
  console.log(`[Genius] Searching: ${trackName} - ${artistName}`);

  // Clean up names
  const cleanTrack = trackName
    .replace(/\s*\(Official.*?\)/gi, '')
    .replace(/\s*\(Audio.*?\)/gi, '')
    .replace(/\s*\[.*?\]/g, '')
    .trim();

  const cleanArtist = artistName
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .trim();

  // Search
  const query = `${cleanArtist} ${cleanTrack}`;
  const geniusUrl = await searchGenius(query);

  if (!geniusUrl) {
    console.log('[Genius] Not found');
    return { found: false, source: 'genius' };
  }

  // Scrape
  const lyrics = await scrapeLyrics(geniusUrl);

  if (!lyrics) {
    console.log('[Genius] Failed to scrape');
    return { found: false, source: 'genius' };
  }

  console.log(`[Genius] Found! ${lyrics.length} chars`);
  return {
    found: true,
    title: cleanTrack,
    artist: cleanArtist,
    lyrics,
    url: geniusUrl,
    source: 'genius',
  };
}

/**
 * Batch fetch for multiple tracks
 */
export async function batchFetchLyrics(
  tracks: Array<{ title: string; artist: string; id: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, GeniusResult>> {
  const results = new Map<string, GeniusResult>();

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const result = await getGeniusLyrics(track.title, track.artist);
    results.set(track.id, result);

    if (onProgress) {
      onProgress(i + 1, tracks.length);
    }

    // Rate limit - 1 request per second
    await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

console.log('[Genius Scraper] Loaded - Grey zone lyrics');
