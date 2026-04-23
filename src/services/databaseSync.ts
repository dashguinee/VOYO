import { videoIntelligenceAPI, isSupabaseConfigured } from '../lib/supabase';
import { devLog, devWarn } from '../utils/logger';

type SyncableTrack = {
  trackId?: string;
  id?: string;
  title: string;
  artist?: string;
  coverUrl?: string;
};

const recentlySynced = new Map<string, number>();
const DEBOUNCE_MS = 5000;

function getTrackId(track: SyncableTrack): string | undefined {
  return track.trackId || track.id;
}

function toVideo(track: SyncableTrack) {
  const youtube_id = getTrackId(track)!;
  return {
    youtube_id,
    title: track.title || 'Unknown',
    artist: track.artist || null,
    thumbnail_url: track.coverUrl || `https://i.ytimg.com/vi/${youtube_id}/hqdefault.jpg`,
  };
}

export async function syncToDatabase(track: SyncableTrack): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const trackId = getTrackId(track);
  if (!trackId) return false;

  const lastSynced = recentlySynced.get(trackId);
  if (lastSynced && Date.now() - lastSynced < DEBOUNCE_MS) return true;

  try {
    const success = await videoIntelligenceAPI.sync(toVideo(track));
    if (success) {
      recentlySynced.set(trackId, Date.now());
      if (recentlySynced.size > 1000) {
        const now = Date.now();
        for (const [id, time] of recentlySynced.entries()) {
          if (now - time > 60000) recentlySynced.delete(id);
        }
      }
    }
    return success;
  } catch (error) {
    devWarn('[DatabaseSync] Failed:', trackId, error);
    return false;
  }
}

export async function syncManyToDatabase(tracks: SyncableTrack[]): Promise<number> {
  if (!isSupabaseConfigured || tracks.length === 0) return 0;

  const now = Date.now();
  const toSync = tracks.filter(track => {
    const trackId = getTrackId(track);
    if (!trackId) return false;
    const lastSynced = recentlySynced.get(trackId);
    return !lastSynced || now - lastSynced >= DEBOUNCE_MS;
  });

  if (toSync.length === 0) return 0;

  try {
    const count = await videoIntelligenceAPI.batchSync(toSync.map(toVideo));
    for (const track of toSync) {
      const trackId = getTrackId(track);
      if (trackId) recentlySynced.set(trackId, now);
    }
    devLog(`[DatabaseSync] Batch synced ${count} tracks`);
    return count;
  } catch (error) {
    devWarn('[DatabaseSync] Batch sync failed:', error);
    return 0;
  }
}

export function syncSearchResults(results: Array<{
  voyoId?: string;
  title: string;
  artist?: string;
  thumbnail?: string;
}>): void {
  if (!isSupabaseConfigured || results.length === 0) return;
  syncManyToDatabase(results.map(r => ({
    trackId: r.voyoId,
    title: r.title,
    artist: r.artist,
    coverUrl: r.thumbnail,
  }))).catch(() => {});
}
