/**
 * Image Helper Utilities - Re-exports from unified thumbnail utility
 * @deprecated Use utils/thumbnail.ts directly
 */

import { Track } from '../types';
import { getThumb } from './thumbnail';

// Re-export for backward compatibility
export { getThumb as getThumbnailUrl } from './thumbnail';

/**
 * Get the best available thumbnail URL for a track
 */
export function getTrackThumbnailUrl(
  track: Track,
  quality: 'default' | 'medium' | 'high' | 'max' = 'high'
): string {
  if (track.coverUrl && track.coverUrl.startsWith('http')) {
    return track.coverUrl;
  }
  return getThumb(track.trackId, quality);
}
