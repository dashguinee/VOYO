/**
 * VOYO Music - Unified Thumbnail Utility
 * Single source of truth for all thumbnail/image URLs
 */

// YouTube thumbnail quality options
export type ThumbnailQuality = 'default' | 'medium' | 'high' | 'max';

const QUALITY_MAP: Record<ThumbnailQuality, string> = {
  default: 'default',      // 120x90
  medium: 'mqdefault',     // 320x180
  high: 'hqdefault',       // 480x360
  max: 'maxresdefault',    // 1280x720
};

/**
 * Get YouTube thumbnail URL for a track
 * @param trackId - YouTube video ID or VOYO ID
 * @param quality - Thumbnail quality level
 */
export const getThumb = (trackId: string, quality: ThumbnailQuality = 'high'): string => {
  // Guard against undefined/null trackId
  if (!trackId) {
    return '/placeholder-album.svg';
  }

  // Decode VOYO ID if needed
  let ytId = trackId;
  if (trackId.startsWith('vyo_')) {
    const encoded = trackId.substring(4);
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    try { ytId = atob(base64); } catch { ytId = trackId; }
  }
  return `https://i.ytimg.com/vi/${ytId}/${QUALITY_MAP[quality]}.jpg`;
};

/**
 * Get thumbnail with fallback chain (for progressive loading)
 */
export const getThumbWithFallback = (trackId: string) => ({
  primary: getThumb(trackId, 'max'),
  fallback: getThumb(trackId, 'high'),
  fallback2: getThumb(trackId, 'medium'),
});

/**
 * Generate DASH-branded placeholder SVG
 * Used when no thumbnail is available - shows DASH branding instead of generic
 */
export const generatePlaceholder = (title: string, size: number = 400): string => {
  const initial = title.charAt(0).toUpperCase();

  const svg = `
<svg width="${size}" height="${size}" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="dashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#a855f7"/>
      <stop offset="50%" style="stop-color:#7c3aed"/>
      <stop offset="100%" style="stop-color:#4c1d95"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="#0a0a0a"/>
  <circle cx="200" cy="160" r="70" fill="#1a1a1a" stroke="url(#dashGrad)" stroke-width="3"/>
  <circle cx="200" cy="160" r="50" fill="none" stroke="#a855f7" stroke-opacity="0.3" stroke-width="1"/>
  <circle cx="200" cy="160" r="30" fill="none" stroke="#a855f7" stroke-opacity="0.2" stroke-width="1"/>
  <text x="200" y="175" text-anchor="middle" fill="url(#dashGrad)" font-family="system-ui, sans-serif" font-size="48" font-weight="700">${initial}</text>
  <text x="200" y="290" text-anchor="middle" fill="url(#dashGrad)" font-family="system-ui, sans-serif" font-size="28" font-weight="700" letter-spacing="6">DASH</text>
  <text x="200" y="320" text-anchor="middle" fill="#666666" font-family="system-ui, sans-serif" font-size="11" letter-spacing="2">LOADING VIBES</text>
</svg>`.trim();

  return `data:image/svg+xml;base64,${btoa(svg)}`;
};

// Aliases for backward compatibility
export const getThumbnailUrl = getThumb;
export const getYouTubeThumbnail = getThumb;
