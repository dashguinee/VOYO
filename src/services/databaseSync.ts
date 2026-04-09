/**
 * VOYO Database Sync Service
 *
 * Ensures EVERYTHING that surfaces in VOYO goes to the collective database.
 * One function, called everywhere. No track left behind.
 */

import { videoIntelligenceAPI, isSupabaseConfigured } from '../lib/supabase';
import { Track } from '../types';

// Debounce map to avoid syncing the same track multiple times in quick succession
const recentlySynced = new Map<string, number>();
const DEBOUNCE_MS = 5000; // Don't re-sync same track within 5 seconds

/**
 * Sync a track to the collective database
 * Call this EVERYWHERE a track surfaces:
 * - When played
 * - When searched
 * - When added to pool
 * - When discovered by scouts
 */
export async function syncToDatabase(track: Track | {
  trackId?: string;
  id?: string;
  title: string;
  artist?: string;
  coverUrl?: string;
}): Promise<boolean> {
  if (!isSupabaseConfigured) {
    return false;
  }

  const trackId = (track as any).trackId || (track as any).id;
  if (!trackId) {
    return false;
  }

  // Debounce check
  const lastSynced = recentlySynced.get(trackId);
  if (lastSynced && Date.now() - lastSynced < DEBOUNCE_MS) {
    return true; // Already synced recently
  }

  try {
    // Use only columns that definitely exist in the table
    const success = await videoIntelligenceAPI.sync({
      youtube_id: trackId,
      title: track.title || 'Unknown',
      artist: (track as any).artist || null,
      thumbnail_url: (track as any).coverUrl || `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
    });

    if (success) {
      recentlySynced.set(trackId, Date.now());
      // Clean old entries periodically
      if (recentlySynced.size > 1000) {
        const now = Date.now();
        for (const [id, time] of recentlySynced.entries()) {
          if (now - time > 60000) recentlySynced.delete(id);
        }
      }
    }

    return success;
  } catch (error) {
    console.warn('[DatabaseSync] Failed:', trackId, error);
    return false;
  }
}

/**
 * Batch sync multiple tracks (more efficient)
 */
export async function syncManyToDatabase(tracks: Array<Track | {
  trackId?: string;
  id?: string;
  title: string;
  artist?: string;
  coverUrl?: string;
}>): Promise<number> {
  if (!isSupabaseConfigured || tracks.length === 0) {
    return 0;
  }

  // Filter out recently synced and invalid tracks
  const now = Date.now();
  const toSync = tracks.filter(track => {
    const trackId = (track as any).trackId || (track as any).id;
    if (!trackId) return false;
    const lastSynced = recentlySynced.get(trackId);
    return !lastSynced || now - lastSynced >= DEBOUNCE_MS;
  });

  if (toSync.length === 0) {
    return 0;
  }

  try {
    const videos = toSync.map(track => {
      const trackId = (track as any).trackId || (track as any).id;
      return {
        youtube_id: trackId,
        title: track.title || 'Unknown',
        artist: (track as any).artist || null,
        thumbnail_url: (track as any).coverUrl || `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`,
      };
    });

    const count = await videoIntelligenceAPI.batchSync(videos);

    // Mark all as synced
    for (const track of toSync) {
      const trackId = (track as any).trackId || (track as any).id;
      if (trackId) recentlySynced.set(trackId, now);
    }

    console.log(`[DatabaseSync] Batch synced ${count} tracks`);
    return count;
  } catch (error) {
    console.warn('[DatabaseSync] Batch sync failed:', error);
    return 0;
  }
}

/**
 * Sync search results to database
 */
export function syncSearchResults(results: Array<{
  voyoId?: string;
  title: string;
  artist?: string;
  thumbnail?: string;
}>): void {
  if (!isSupabaseConfigured || results.length === 0) return;

  // Fire and forget - don't block search UX
  const tracks = results.map(r => ({
    trackId: r.voyoId,
    title: r.title,
    artist: r.artist,
    coverUrl: r.thumbnail,
  }));

  syncManyToDatabase(tracks).catch(() => {});
}
