/**
 * VOYO ID Utilities - Frontend decoder
 * Converts VOYO IDs back to YouTube IDs for the IFrame player
 */

/**
 * Check if a string is a VOYO ID (starts with vyo_)
 */
export function isVoyoId(id: string): boolean {
  return id?.startsWith('vyo_');
}

/**
 * Encode YouTube ID to VOYO ID
 * VOYO ID format: vyo_<base64url encoded YouTube ID>
 */
export function encodeVoyoId(youtubeId: string): string {
  if (!youtubeId || typeof youtubeId !== 'string') {
    throw new Error('Invalid YouTube ID');
  }

  // If it's already a VOYO ID, return as-is
  if (youtubeId.startsWith('vyo_')) {
    return youtubeId;
  }

  try {
    // Base64 encode the YouTube ID
    const base64 = btoa(youtubeId);

    // Make it URL-safe
    const urlSafe = base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, ''); // Remove padding

    return `vyo_${urlSafe}`;
  } catch (err) {
    throw new Error('Failed to encode YouTube ID');
  }
}

/**
 * Decode VOYO ID to YouTube ID
 * VOYO ID format: vyo_<base64url encoded YouTube ID>
 */
export function decodeVoyoId(voyoId: string): string {
  if (!voyoId || typeof voyoId !== 'string') {
    throw new Error('Invalid VOYO ID');
  }

  // If it's already a raw YouTube ID (11 chars, no prefix), return as-is
  if (!voyoId.startsWith('vyo_')) {
    return voyoId;
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
    return atob(base64);
  } catch (err) {
    throw new Error('Failed to decode VOYO ID');
  }
}

/**
 * Get YouTube ID from track - handles both VOYO IDs and raw YouTube IDs
 */
export function getYouTubeId(trackId: string): string {
  if (!trackId) return '';

  // If it's a VOYO ID, decode it
  if (isVoyoId(trackId)) {
    return decodeVoyoId(trackId);
  }

  // Otherwise assume it's already a YouTube ID
  return trackId;
}
