/**
 * VOYO STEALTH MODE - YouTube ID Obfuscation
 * Converts YouTube video IDs to VOYO IDs and back
 * Ensures zero YouTube traces in frontend
 */

/**
 * Encode YouTube ID to VOYO ID
 * Uses base64url encoding with 'vyo_' prefix for brand consistency
 * Example: OSBan_sH_b8 -> vyo_T1NCYW5fc0hfYjg
 *
 * @param {string} youtubeId - YouTube video ID (11 chars)
 * @returns {string} VOYO ID (vyo_XXXXXXXX)
 */
export function encodeVoyoId(youtubeId) {
  if (!youtubeId || typeof youtubeId !== 'string') {
    throw new Error('Invalid YouTube ID');
  }

  // Base64 encode, then make it URL-safe
  const base64 = Buffer.from(youtubeId).toString('base64');
  const urlSafe = base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, ''); // Remove padding

  return `vyo_${urlSafe}`;
}

/**
 * Decode VOYO ID back to YouTube ID
 *
 * @param {string} voyoId - VOYO ID (vyo_XXXXXXXX)
 * @returns {string} YouTube video ID
 */
export function decodeVoyoId(voyoId) {
  if (!voyoId || typeof voyoId !== 'string') {
    throw new Error('Invalid VOYO ID');
  }

  // Strip prefix
  if (!voyoId.startsWith('vyo_')) {
    throw new Error('Invalid VOYO ID format - must start with vyo_');
  }

  const encoded = voyoId.substring(4);

  // Reverse URL-safe base64
  let base64 = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Add back padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  try {
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch (err) {
    throw new Error('Failed to decode VOYO ID');
  }
}

/**
 * Transform search result to use VOYO IDs
 * Replaces 'id' with 'voyoId' and removes YouTube URLs
 *
 * @param {Object} result - Raw search result from yt-dlp
 * @param {string} baseUrl - Base URL for thumbnails (auto-detected based on environment)
 * @returns {Object} Sanitized result with VOYO ID
 */
export function sanitizeSearchResult(result) {
  const voyoId = encodeVoyoId(result.id);

  // Auto-detect API_BASE: Fly.io, Railway, or localhost
  let API_BASE = process.env.API_BASE || 'http://localhost:3001';
  if (process.env.FLY_APP_NAME) {
    API_BASE = `https://${process.env.FLY_APP_NAME}.fly.dev`;
  } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    API_BASE = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }

  return {
    voyoId,
    title: result.title,
    artist: result.artist,
    duration: result.duration,
    // Use ABSOLUTE URL so frontend can load from any origin
    thumbnail: `${API_BASE}/cdn/art/${voyoId}`,
    views: result.views
  };
}

/**
 * Validate VOYO ID format
 * @param {string} voyoId
 * @returns {boolean}
 */
export function isValidVoyoId(voyoId) {
  if (!voyoId || typeof voyoId !== 'string') return false;
  if (!voyoId.startsWith('vyo_')) return false;
  if (voyoId.length < 8) return false; // vyo_ + at least 4 chars

  try {
    // Try to decode - if it works, it's valid
    const decoded = decodeVoyoId(voyoId);
    // Also validate the decoded YouTube ID
    return isValidYouTubeId(decoded);
  } catch {
    return false;
  }
}

/**
 * SECURITY: Validate YouTube video ID format
 * YouTube IDs are 11 characters: alphanumeric, hyphens, underscores only
 * This prevents command injection when IDs are passed to yt-dlp
 *
 * @param {string} youtubeId
 * @returns {boolean}
 */
export function isValidYouTubeId(youtubeId) {
  if (!youtubeId || typeof youtubeId !== 'string') return false;
  // YouTube IDs: exactly 11 chars, only alphanumeric + hyphen + underscore
  // Strict regex prevents ANY shell metacharacters
  const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
  return YOUTUBE_ID_REGEX.test(youtubeId);
}

/**
 * Branded error messages - NO YouTube mentions
 */
export const VOYO_ERRORS = {
  NOT_FOUND: 'Content not found in VOYO library',
  STREAM_UNAVAILABLE: 'VOYO stream temporarily unavailable',
  SEARCH_FAILED: 'VOYO search service unavailable',
  THUMBNAIL_FAILED: 'Album art temporarily unavailable',
  INVALID_ID: 'Invalid VOYO track ID',
  NETWORK_ERROR: 'VOYO service unreachable - check your connection'
};

/**
 * Get branded error message
 * @param {string} errorType
 * @returns {string}
 */
export function getVoyoError(errorType) {
  return VOYO_ERRORS[errorType] || 'An unexpected error occurred';
}
