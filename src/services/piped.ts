/**
 * VOYO Music - Piped API Integration
 *
 * Connects to YouTube playlists via Piped API to surface albums.
 * Piped is a privacy-focused YouTube frontend with a public API.
 */

const PIPED_API = 'https://pipedapi.kavin.rocks';

// Fallback Piped instances (in case primary is down)
// Updated Dec 2025 - many instances are unreliable, try multiple
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://pipedapi.tokhmi.xyz',
];

// ============================================
// VIDEO STREAM TYPES
// ============================================

export interface VideoStream {
  url: string;
  format: string;
  quality: string;
  mimeType: string;
  fps: number;
  width: number;
  height: number;
}

export interface VideoStreamInfo {
  title: string;
  duration: number;
  thumbnailUrl: string;
  videoStreams: VideoStream[];
  audioStreams: any[];
  hls?: string; // HLS stream URL if available
}

// ============================================
// VIDEO STREAM FUNCTIONS
// ============================================

/**
 * Get video stream info from Piped API
 * Returns direct video URLs for embedding
 */
export async function getVideoStreamInfo(videoId: string): Promise<VideoStreamInfo | null> {
  // Try each Piped instance until one works
  for (const instance of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) continue;

      const data = await response.json();

      return {
        title: data.title || '',
        duration: data.duration || 0,
        thumbnailUrl: data.thumbnailUrl || '',
        videoStreams: (data.videoStreams || []).map((s: any) => ({
          url: s.url,
          format: s.format || '',
          quality: s.quality || '',
          mimeType: s.mimeType || '',
          fps: s.fps || 30,
          width: s.width || 0,
          height: s.height || 0,
        })),
        audioStreams: data.audioStreams || [],
        hls: data.hls || undefined,
      };
    } catch (error) {
      console.warn(`Piped instance ${instance} failed:`, error);
      continue;
    }
  }

  return null;
}

/**
 * Get best video stream URL for a video ID
 * Prefers 720p or 480p for mobile performance
 */
export async function getVideoStreamUrl(videoId: string, preferredQuality: '360p' | '480p' | '720p' | '1080p' = '480p'): Promise<string | null> {
  const info = await getVideoStreamInfo(videoId);
  if (!info) return null;

  // Try HLS first (adaptive, works well on mobile)
  if (info.hls) {
    return info.hls;
  }

  // Filter for MP4 streams (widest compatibility)
  const mp4Streams = info.videoStreams.filter(s =>
    s.mimeType.includes('video/mp4') || s.format.includes('mp4')
  );

  if (mp4Streams.length === 0) {
    // Fall back to any video stream
    if (info.videoStreams.length > 0) {
      return info.videoStreams[0].url;
    }
    return null;
  }

  // Find preferred quality
  const qualityOrder = ['720p', '480p', '360p', '1080p', '240p'];
  const startIndex = qualityOrder.indexOf(preferredQuality);
  const orderedQualities = [
    ...qualityOrder.slice(startIndex),
    ...qualityOrder.slice(0, startIndex)
  ];

  for (const quality of orderedQualities) {
    const stream = mp4Streams.find(s => s.quality === quality);
    if (stream) return stream.url;
  }

  // Return first available
  return mp4Streams[0].url;
}

// ============================================
// PLAYLIST TYPES
// ============================================

export interface PipedPlaylist {
  id: string;
  name: string;
  artist: string;
  thumbnail: string;
  trackCount: number;
}

export interface PipedTrack {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

/**
 * Search for albums (playlists) on YouTube via Piped
 */
export async function searchAlbums(query: string, limit: number = 10): Promise<PipedPlaylist[]> {
  try {
    const response = await fetch(
      `${PIPED_API}/search?q=${encodeURIComponent(query + ' album')}&filter=playlists`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (!response.ok) {
      throw new Error(`Album search failed: ${response.status}`);
    }

    const data = await response.json();

    return (data.items || [])
      .filter((item: any) => item.type === 'playlist')
      .slice(0, limit)
      .map((item: any) => ({
        id: extractPlaylistId(item.url),
        name: cleanAlbumName(item.name),
        artist: cleanArtistName(item.uploaderName || item.uploader || 'Unknown Artist'),
        thumbnail: item.thumbnail || '',
        trackCount: item.videos || 0,
      }));
  } catch (error) {
    console.error('Album search failed:', error);
    return []; // Return empty array, don't crash
  }
}

/**
 * Get tracks from an album/playlist
 */
export async function getAlbumTracks(playlistId: string): Promise<PipedTrack[]> {
  try {
    const response = await fetch(`${PIPED_API}/playlists/${playlistId}`, {
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Album fetch failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data.relatedStreams || !Array.isArray(data.relatedStreams)) {
      console.error('Invalid album data structure');
      return [];
    }

    return data.relatedStreams.map((stream: any) => ({
      videoId: extractVideoId(stream.url),
      title: stream.title || 'Unknown Track',
      artist: cleanArtistName(stream.uploaderName || data.uploader || 'Unknown Artist'),
      duration: stream.duration || 0,
      thumbnail: stream.thumbnail || data.thumbnailUrl || '',
    }));
  } catch (error) {
    console.error('Album fetch failed:', error);
    return []; // Return empty array, don't crash
  }
}

/**
 * Search for artist albums specifically
 */
export async function searchArtistAlbums(artistName: string, limit: number = 5): Promise<PipedPlaylist[]> {
  // Search with optimized query for artist albums
  const query = `${artistName} album playlist`;
  return searchAlbums(query, limit);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extract playlist ID from Piped URL format
 * Example: "/playlist?list=PLxxxxxxxxx" -> "PLxxxxxxxxx"
 */
function extractPlaylistId(url: string): string {
  const match = url.match(/list=([^&]+)/);
  return match ? match[1] : url.replace('/playlist?list=', '');
}

/**
 * Extract video ID from Piped URL format
 * Example: "/watch?v=xxxxxxxxxxx" -> "xxxxxxxxxxx"
 */
function extractVideoId(url: string): string {
  const match = url.match(/v=([^&]+)/);
  if (match) return match[1];

  // Fallback: remove common prefixes
  return url
    .replace('/watch?v=', '')
    .replace('/watch/', '')
    .split('&')[0]; // Remove any query params
}

/**
 * Clean album name by removing common suffixes
 */
function cleanAlbumName(name: string): string {
  return name
    .replace(/\s*\(Full Album\)/gi, '')
    .replace(/\s*\[Full Album\]/gi, '')
    .replace(/\s*- Full Album/gi, '')
    .replace(/\s*\(Official Album\)/gi, '')
    .replace(/\s*\[Official Album\]/gi, '')
    .trim();
}

/**
 * Clean artist name by removing YouTube-specific suffixes
 */
function cleanArtistName(name: string): string {
  return name
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*- Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s*Official$/i, '')
    .trim();
}

/**
 * Check if a playlist looks like an album (heuristics)
 */
export function isLikelyAlbum(playlist: PipedPlaylist): boolean {
  const name = playlist.name.toLowerCase();
  const artist = playlist.artist.toLowerCase();

  // Check for album indicators
  const hasAlbumKeyword = name.includes('album') ||
                          name.includes('ep') ||
                          name.includes('mixtape');

  // Check for "Topic" channel (YouTube Music auto-generated)
  const isTopicChannel = playlist.artist.includes('Topic');

  // Check track count (albums usually have 8-20 tracks)
  const hasReasonableTrackCount = playlist.trackCount >= 5 && playlist.trackCount <= 30;

  return (hasAlbumKeyword || isTopicChannel) && hasReasonableTrackCount;
}
