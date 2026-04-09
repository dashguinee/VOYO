/**
 * VOYO Download Manager - Spotify-style local caching
 *
 * Auto-downloads songs to user's device for:
 * - Offline playback
 * - Faster load times
 * - Data savings on repeat plays
 * - High quality "Boosted" versions
 */

import { uploadToR2 } from './api';

const DB_NAME = 'voyo-music-cache';
const DB_VERSION = 1;
const STORE_NAME = 'audio-files';
const META_STORE = 'track-meta';

interface CachedTrack {
  id: string;
  blob: Blob;
  mimeType: string;
  size: number;
  downloadedAt: number;
  playCount: number;
  quality: 'standard' | 'boosted';
}

interface TrackMeta {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  quality: 'standard' | 'boosted';
  size: number;
  downloadedAt: number;
}

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB
 */
export async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Store for audio blobs
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }

      // Store for track metadata
      if (!database.objectStoreNames.contains(META_STORE)) {
        const metaStore = database.createObjectStore(META_STORE, { keyPath: 'id' });
        metaStore.createIndex('downloadedAt', 'downloadedAt', { unique: false });
      }
    };
  });
}

/**
 * Check if track is cached locally
 */
export async function isTrackCached(trackId: string): Promise<boolean> {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(trackId);

      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Get cached track quality (null if not cached)
 */
export async function getTrackQuality(trackId: string): Promise<'standard' | 'boosted' | null> {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(trackId);

      request.onsuccess = () => {
        const cached = request.result as CachedTrack | undefined;
        resolve(cached?.quality || null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Mark a cached track as "kept" (permanent - won't be evicted by LRU)
 * Triggered at 75% playback - genuine interest signal
 */
export async function markTrackAsKept(trackId: string): Promise<void> {
  try {
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME, META_STORE], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const metaStore = transaction.objectStore(META_STORE);
    const request = store.get(trackId);

    request.onsuccess = () => {
      const cached = request.result as CachedTrack | undefined;
      if (cached && cached.quality !== 'boosted') {
        cached.quality = 'boosted';
        store.put(cached);
      }
    };

    // Also upgrade meta store
    const metaRequest = metaStore.get(trackId);
    metaRequest.onsuccess = () => {
      const meta = metaRequest.result as TrackMeta | undefined;
      if (meta && meta.quality !== 'boosted') {
        meta.quality = 'boosted';
        metaStore.put(meta);
      }
    };
  } catch {
    // Silent fail - not critical
  }
}

/**
 * Get cached track URL (creates blob URL)
 */
export async function getCachedTrackUrl(trackId: string): Promise<string | null> {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(trackId);

      request.onsuccess = () => {
        const cached = request.result as CachedTrack | undefined;
        if (cached?.blob) {
          const url = URL.createObjectURL(cached.blob);
          resolve(url);

          // Increment play count
          incrementPlayCount(trackId);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Increment play count for a cached track
 */
async function incrementPlayCount(trackId: string): Promise<void> {
  try {
    const database = await initDB();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(trackId);

    request.onsuccess = () => {
      const cached = request.result as CachedTrack | undefined;
      if (cached) {
        cached.playCount = (cached.playCount || 0) + 1;
        store.put(cached);
      }
    };
  } catch {
    // Ignore errors
  }
}

/**
 * Download and cache a track
 */
export async function downloadTrack(
  trackId: string,
  audioUrl: string,
  meta: Omit<TrackMeta, 'id' | 'downloadedAt' | 'size'>,
  quality: 'standard' | 'boosted' = 'boosted',
  onProgress?: (progress: number) => void
): Promise<boolean> {
  try {
    // Fetch with retry logic for rate limiting (429)
    let response: Response | null = null;
    const MAX_RETRIES = 3;
    let retryDelay = 2000; // Start with 2 seconds

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      response = await fetch(audioUrl);

      if (response.status === 429) {
        // Rate limited - exponential backoff
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : retryDelay;
        console.log(`🎵 CACHE: Rate limited (429), retrying in ${waitTime / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retryDelay *= 2; // Double the delay for next retry
        continue;
      }

      if (response.ok) break; // Success, exit retry loop

      // Other errors - don't retry
      throw new Error(`Download failed: ${response.status}`);
    }

    if (!response || !response.ok) {
      throw new Error('Download failed after retries');
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    // Read the stream with progress
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const chunks: ArrayBuffer[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      // Convert Uint8Array to ArrayBuffer for Blob compatibility
      chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      received += value.length;

      if (total && onProgress) {
        onProgress(Math.round((received / total) * 100));
      }
    }

    // Create blob from chunks
    const blob = new Blob(chunks, {
      type: response.headers.get('content-type') || 'audio/webm'
    });

    // Store in IndexedDB
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME, META_STORE], 'readwrite');

    const audioStore = transaction.objectStore(STORE_NAME);
    const metaStore = transaction.objectStore(META_STORE);

    const cachedTrack: CachedTrack = {
      id: trackId,
      blob,
      mimeType: blob.type,
      size: blob.size,
      downloadedAt: Date.now(),
      playCount: 0,
      quality,
    };

    const trackMeta: TrackMeta = {
      id: trackId,
      title: meta.title,
      artist: meta.artist,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      quality,
      size: blob.size,
      downloadedAt: Date.now(),
    };

    audioStore.put(cachedTrack);
    metaStore.put(trackMeta);

    return new Promise((resolve) => {
      transaction.oncomplete = () => {
        // PHASE 4: Upload to R2 collective (async, don't block)
        // Every user who boosts contributes to the shared library
        uploadToR2(trackId, blob, quality === 'boosted' ? 'high' : 'low')
          .then(result => {
            if (result.success) {
              console.log(`🌐 [COLLECTIVE] Contributed ${trackId} to shared library`);
            }
          })
          .catch(() => {}); // Silent fail - local cache is primary

        resolve(true);
      };
      transaction.onerror = () => {
        resolve(false);
      };
    });

  } catch (error) {
    return false;
  }
}

/**
 * Get all cached tracks metadata
 */
export async function getCachedTracks(): Promise<TrackMeta[]> {
  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(META_STORE, 'readonly');
      const store = transaction.objectStore(META_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Get total cache size
 */
export async function getCacheSize(): Promise<number> {
  const tracks = await getCachedTracks();
  return tracks.reduce((total, track) => total + (track.size || 0), 0);
}

/**
 * Delete a cached track
 */
export async function deleteTrack(trackId: string): Promise<boolean> {
  try {
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME, META_STORE], 'readwrite');

    transaction.objectStore(STORE_NAME).delete(trackId);
    transaction.objectStore(META_STORE).delete(trackId);

    return new Promise((resolve) => {
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Clear all cached tracks
 */
export async function clearCache(): Promise<boolean> {
  try {
    const database = await initDB();
    const transaction = database.transaction([STORE_NAME, META_STORE], 'readwrite');

    transaction.objectStore(STORE_NAME).clear();
    transaction.objectStore(META_STORE).clear();

    return new Promise((resolve) => {
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Check if on WiFi (Network Information API)
 */
export function isOnWiFi(): boolean {
  const connection = (navigator as any).connection;
  if (!connection) return true; // Assume WiFi if API not available

  return connection.type === 'wifi' || connection.effectiveType === '4g';
}

/**
 * Get download settings from localStorage
 */
export type DownloadSetting = 'always' | 'wifi-only' | 'ask' | 'never';

export function getDownloadSetting(): DownloadSetting {
  return (localStorage.getItem('voyo-download-setting') as DownloadSetting) || 'wifi-only';
}

export function setDownloadSetting(setting: DownloadSetting): void {
  localStorage.setItem('voyo-download-setting', setting);
}

/**
 * Should auto-download based on settings and network
 */
export function shouldAutoDownload(): boolean {
  const setting = getDownloadSetting();

  switch (setting) {
    case 'always':
      return true;
    case 'wifi-only':
      return isOnWiFi();
    case 'never':
      return false;
    case 'ask':
      return false; // Will prompt user
    default:
      return isOnWiFi();
  }
}

/**
 * Decode VOYO ID to raw YouTube ID
 */
function decodeVoyoId(voyoId: string): string {
  if (!voyoId.startsWith('vyo_')) {
    return voyoId;
  }
  const encoded = voyoId.substring(4);
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  try {
    return atob(base64);
  } catch {
    return voyoId;
  }
}

/**
 * Migrate old VOYO ID keys to raw YouTube IDs
 * This runs once to fix tracks stored with vyo_ prefix
 */
export async function migrateVoyoIds(): Promise<void> {
  try {
    const database = await initDB();
    const tracks = await getCachedTracks();

    for (const track of tracks) {
      // Check if this track has a VOYO ID
      if (track.id.startsWith('vyo_')) {
        const rawId = decodeVoyoId(track.id);
        console.log('🔄 MIGRATE: Converting', track.id, '→', rawId, '| title:', track.title);

        // Get the audio blob
        const audioTransaction = database.transaction(STORE_NAME, 'readonly');
        const audioStore = audioTransaction.objectStore(STORE_NAME);
        const audioRequest = audioStore.get(track.id);

        await new Promise<void>((resolve) => {
          audioRequest.onsuccess = async () => {
            const cachedTrack = audioRequest.result;
            if (cachedTrack) {
              // Write with new ID
              const writeTransaction = database.transaction([STORE_NAME, META_STORE], 'readwrite');

              // Update audio blob with new ID
              cachedTrack.id = rawId;
              writeTransaction.objectStore(STORE_NAME).put(cachedTrack);

              // Update meta with new ID
              const newMeta = { ...track, id: rawId };
              writeTransaction.objectStore(META_STORE).put(newMeta);

              // Delete old entries
              writeTransaction.objectStore(STORE_NAME).delete(track.id);
              writeTransaction.objectStore(META_STORE).delete(track.id);

              writeTransaction.oncomplete = () => {
                console.log('✅ MIGRATE: Successfully migrated', track.title);
                resolve();
              };
              writeTransaction.onerror = () => resolve();
            } else {
              resolve();
            }
          };
          audioRequest.onerror = () => resolve();
        });
      }
    }
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

// Initialize DB on load
initDB().catch(() => {});
