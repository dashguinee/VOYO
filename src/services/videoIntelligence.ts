/**
 * VOYO Video Intelligence - The Collective Brain
 *
 * OCR extraction + centralized database = zero API calls at scale
 *
 * Flow:
 * 1. Screenshot YouTube suggestions region
 * 2. Tesseract.js extracts text (client-side, FREE)
 * 3. Search local DB for video ID
 * 4. If miss → ytsr scrape → cache forever
 * 5. One user's discovery = everyone's knowledge
 */

import Tesseract from 'tesseract.js';
import { videoIntelligenceAPI, isSupabaseConfigured } from '../lib/supabase';

// ============================================
// TYPES
// ============================================

export interface VideoIntelligence {
  youtubeId: string;
  title: string;
  artist?: string;
  channelName?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  searchTerms?: string[];
  normalizedTitle?: string;
  relatedIds?: string[];
  similarIds?: string[];
  genres?: string[];
  moods?: string[];
  language?: string;
  region?: string;
  voyoPlayCount?: number;
  voyoQueueCount?: number;
  voyoReactionCount?: number;
  discoveredBy?: string;
  discoveryMethod?: 'manual_play' | 'ocr_extraction' | 'api_search' | 'related_crawl' | 'import';
}

export interface OCRResult {
  text: string;
  confidence: number;
  lines: string[];
}

export interface ExtractedVideo {
  title: string;
  artist?: string;
  confidence: number;
}

// ============================================
// OCR ENGINE (Tesseract.js)
// ============================================

let worker: Tesseract.Worker | null = null;
let isInitializing = false;
let initPromise: Promise<Tesseract.Worker> | null = null;

/**
 * Initialize Tesseract worker (lazy, singleton)
 */
async function getWorker(): Promise<Tesseract.Worker> {
  if (worker) return worker;

  if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;
  initPromise = (async () => {
    console.log('[VOYO OCR] Initializing Tesseract...');
    const newWorker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[VOYO OCR] Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    worker = newWorker;
    console.log('[VOYO OCR] Ready');
    return worker;
  })();

  return initPromise;
}

/**
 * Extract text from image using OCR
 */
export async function extractTextFromImage(imageSource: string | HTMLCanvasElement | Blob): Promise<OCRResult> {
  const tesseractWorker = await getWorker();

  const startTime = performance.now();
  const result = await tesseractWorker.recognize(imageSource);
  const endTime = performance.now();

  console.log(`[VOYO OCR] Extracted in ${Math.round(endTime - startTime)}ms`);

  const lines = result.data.text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 3); // Filter noise

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    lines
  };
}

/**
 * Capture screenshot of a specific region
 */
export async function captureRegion(
  element: HTMLElement,
  region?: { x: number; y: number; width: number; height: number }
): Promise<HTMLCanvasElement> {
  // Use html2canvas or native canvas capture
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  if (region) {
    canvas.width = region.width;
    canvas.height = region.height;
  } else {
    const rect = element.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  // If element is an iframe, we need a different approach
  // For YouTube iframe, we'll capture the parent region
  if (element instanceof HTMLIFrameElement) {
    // Can't directly access iframe content due to CORS
    // But we can capture the region where suggestions appear
    console.log('[VOYO OCR] Iframe detected - will capture visible region');
  }

  return canvas;
}

// ============================================
// VIDEO TITLE PARSING
// ============================================

/**
 * Parse OCR text to extract video titles
 * YouTube suggestions format: "Title - Artist" or "Title | Artist"
 */
export function parseVideoTitles(ocrResult: OCRResult): ExtractedVideo[] {
  const videos: ExtractedVideo[] = [];

  for (const line of ocrResult.lines) {
    // Skip very short lines or noise
    if (line.length < 5) continue;

    // Skip common YouTube UI text
    const skipPatterns = [
      /^(up next|autoplay|queue|watch later|save|share|report)/i,
      /^\d+:\d+$/,  // Duration only
      /^(views|subscribers|ago)/i,
      /^[0-9,]+\s*(views|likes)/i,
    ];

    if (skipPatterns.some(p => p.test(line))) continue;

    // Try to extract artist from title
    let title = line;
    let artist: string | undefined;

    // Common separators: " - ", " | ", " by ", " ft. ", " feat. "
    const separators = [' - ', ' | ', ' — ', ' – '];
    for (const sep of separators) {
      if (line.includes(sep)) {
        const parts = line.split(sep);
        artist = parts[0].trim();
        title = parts.slice(1).join(sep).trim();
        break;
      }
    }

    // Check for "ft." or "feat." in title
    const featMatch = title.match(/\s+(ft\.?|feat\.?)\s+(.+)/i);
    if (featMatch && !artist) {
      // Artist might be before the feature
      const beforeFeat = title.substring(0, featMatch.index);
      if (beforeFeat.includes(' - ')) {
        const parts = beforeFeat.split(' - ');
        artist = parts[0].trim();
      }
    }

    videos.push({
      title: title.substring(0, 100), // Limit length
      artist,
      confidence: ocrResult.confidence / 100
    });
  }

  return videos;
}

// ============================================
// NORMALIZE & SEARCH
// ============================================

/**
 * Normalize title for fuzzy matching
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '') // Remove brackets
    .replace(/[^a-z0-9\s]/g, '')     // Keep only alphanumeric
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim();
}

/**
 * Calculate similarity between two titles (0-1)
 */
export function titleSimilarity(a: string, b: string): number {
  const aNorm = normalizeTitle(a);
  const bNorm = normalizeTitle(b);

  if (aNorm === bNorm) return 1;

  // Jaccard similarity on words
  const aWords = new Set(aNorm.split(' '));
  const bWords = new Set(bNorm.split(' '));

  const intersection = new Set([...aWords].filter(x => bWords.has(x)));
  const union = new Set([...aWords, ...bWords]);

  return intersection.size / union.size;
}

// ============================================
// LOCAL CACHE (IndexedDB for offline)
// ============================================

const DB_NAME = 'voyo-intelligence';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

let db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
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

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'youtubeId' });
        store.createIndex('normalizedTitle', 'normalizedTitle', { unique: false });
        store.createIndex('artist', 'artist', { unique: false });
      }
    };
  });
}

/**
 * Save video to local cache + sync to Supabase
 */
export async function cacheVideo(video: VideoIntelligence): Promise<void> {
  const database = await getDB();

  // Add normalized title
  const videoWithNorm = {
    ...video,
    normalizedTitle: normalizeTitle(video.title)
  };

  // 1. Save to IndexedDB (local, instant)
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(videoWithNorm);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 2. Sync to Supabase (cloud, async - don't block)
  if (isSupabaseConfigured) {
    videoIntelligenceAPI.sync({
      youtube_id: video.youtubeId,
      title: video.title,
      artist: video.artist || null,
      channel_name: video.channelName || null,
      duration_seconds: video.durationSeconds || null,
      thumbnail_url: video.thumbnailUrl || null,
      discovered_by: video.discoveredBy || null,
      discovery_method: video.discoveryMethod || null,
    }).catch(err => {
      // Don't fail local cache if Supabase sync fails
      console.warn('[VideoIntelligence] Supabase sync failed:', err);
    });
  }
}

/**
 * Search local cache by title, fallback to Supabase
 */
export async function searchLocalCache(query: string): Promise<VideoIntelligence | null> {
  const database = await getDB();
  const normalizedQuery = normalizeTitle(query);

  // 1. Try local IndexedDB first (instant)
  const localResult = await new Promise<VideoIntelligence | null>((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('normalizedTitle');

    const request = index.getAll();

    request.onsuccess = () => {
      const videos = request.result as VideoIntelligence[];

      // Find best match
      let bestMatch: VideoIntelligence | null = null;
      let bestSimilarity = 0;

      for (const video of videos) {
        const sim = titleSimilarity(query, video.title);
        if (sim > bestSimilarity && sim > 0.6) { // 60% threshold
          bestSimilarity = sim;
          bestMatch = video;
        }
      }

      if (bestMatch) {
        console.log(`[VOYO Intelligence] Local HIT: "${query}" → ${bestMatch.youtubeId} (${Math.round(bestSimilarity * 100)}% match)`);
      }

      resolve(bestMatch);
    };

    request.onerror = () => resolve(null);
  });

  if (localResult) return localResult;

  // 2. Try Supabase (cloud, collective brain)
  if (isSupabaseConfigured) {
    try {
      const supabaseResults = await videoIntelligenceAPI.search(query, 1);
      if (supabaseResults.length > 0) {
        const result = supabaseResults[0];
        console.log(`[VOYO Intelligence] Supabase HIT: "${query}" → ${result.youtube_id}`);

        // Cache locally for next time
        const video: VideoIntelligence = {
          youtubeId: result.youtube_id,
          title: result.title,
          artist: result.artist || undefined,
          channelName: result.channel_name || undefined,
          durationSeconds: result.duration_seconds || undefined,
          thumbnailUrl: result.thumbnail_url || undefined,
        };

        // Save to local cache (don't re-sync to Supabase)
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
          ...video,
          normalizedTitle: normalizeTitle(video.title)
        });

        return video;
      }
    } catch (err) {
      console.warn('[VOYO Intelligence] Supabase search failed:', err);
    }
  }

  console.log(`[VOYO Intelligence] Cache MISS: "${query}"`);
  return null;
}

/**
 * Get video by exact YouTube ID
 */
export async function getVideoById(youtubeId: string): Promise<VideoIntelligence | null> {
  const database = await getDB();

  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(youtubeId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

// ============================================
// YOUTUBE SEARCH (Fallback - No API Key)
// ============================================

/**
 * Search YouTube using ytsr (scraping, no API key)
 * This runs on the server to avoid CORS
 */
export async function searchYouTube(query: string): Promise<VideoIntelligence | null> {
  try {
    // Call our server endpoint that uses ytsr
    const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);

    if (!response.ok) {
      console.warn('[VOYO Intelligence] YouTube search failed');
      return null;
    }

    const data = await response.json();

    if (data.videos && data.videos.length > 0) {
      const video = data.videos[0];
      return {
        youtubeId: video.id,
        title: video.title,
        artist: video.artist,
        channelName: video.channel,
        durationSeconds: video.duration,
        thumbnailUrl: video.thumbnail,
        discoveryMethod: 'api_search'
      };
    }

    return null;
  } catch (err) {
    console.error('[VOYO Intelligence] Search error:', err);
    return null;
  }
}

// ============================================
// RELATED VIDEOS - For Interceptor
// ============================================

export interface RelatedVideo {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

/**
 * Get related videos for a YouTube video ID
 * Uses our backend which calls YouTube's Innertube API
 */
export async function getRelatedVideos(videoId: string, limit = 5): Promise<RelatedVideo[]> {
  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const response = await fetch(`${API_BASE}/related?v=${videoId}&limit=${limit}`);

    if (!response.ok) {
      console.warn('[VOYO Intelligence] Related videos failed');
      return [];
    }

    const data = await response.json();
    console.log(`[VOYO Intelligence] Got ${data.videos?.length || 0} related videos`);
    return data.videos || [];
  } catch (err) {
    console.error('[VOYO Intelligence] Related videos error:', err);
    return [];
  }
}

// ============================================
// MAIN FLOW: Extract → Search → Cache
// ============================================

/**
 * Process OCR-extracted video title
 * Returns YouTube ID if found, null if not
 */
export async function processExtractedTitle(
  extractedVideo: ExtractedVideo,
  discoveredBy?: string
): Promise<string | null> {
  const searchQuery = extractedVideo.artist
    ? `${extractedVideo.artist} ${extractedVideo.title}`
    : extractedVideo.title;

  // 1. Check local cache first (instant, free)
  const cached = await searchLocalCache(searchQuery);
  if (cached) {
    return cached.youtubeId;
  }

  // 2. Search YouTube (scraping, rate-limited but free)
  const found = await searchYouTube(searchQuery);
  if (found) {
    // Cache for everyone
    await cacheVideo({
      ...found,
      discoveredBy,
      discoveryMethod: 'ocr_extraction'
    });
    return found.youtubeId;
  }

  return null;
}

/**
 * Full OCR pipeline: Screenshot → Extract → Find IDs
 */
export async function extractVideosFromScreenshot(
  imageSource: string | HTMLCanvasElement | Blob,
  discoveredBy?: string
): Promise<string[]> {
  // 1. OCR extraction
  const ocrResult = await extractTextFromImage(imageSource);
  console.log('[VOYO Intelligence] OCR extracted:', ocrResult.lines);

  // 2. Parse video titles
  const extractedVideos = parseVideoTitles(ocrResult);
  console.log('[VOYO Intelligence] Parsed videos:', extractedVideos);

  // 3. Find YouTube IDs for each
  const videoIds: string[] = [];

  for (const video of extractedVideos) {
    const id = await processExtractedTitle(video, discoveredBy);
    if (id) {
      videoIds.push(id);
    }
  }

  console.log('[VOYO Intelligence] Found IDs:', videoIds);
  return videoIds;
}

// ============================================
// REGISTER TRACK ON PLAY (Build the database)
// ============================================

/**
 * Register a track when it plays (builds the collective brain)
 */
export async function registerTrackPlay(
  youtubeId: string,
  title: string,
  artist?: string,
  discoveredBy?: string
): Promise<void> {
  // Check if already in cache
  const existing = await getVideoById(youtubeId);

  if (existing) {
    // Update play count locally
    await cacheVideo({
      ...existing,
      voyoPlayCount: (existing.voyoPlayCount || 0) + 1
    });
  } else {
    // New video - add to cache
    await cacheVideo({
      youtubeId,
      title,
      artist,
      discoveredBy,
      discoveryMethod: 'manual_play',
      voyoPlayCount: 1
    });
  }

  // Sync play count to Supabase (async, don't block)
  if (isSupabaseConfigured) {
    videoIntelligenceAPI.recordPlay(youtubeId).catch(() => {});
  }
}

/**
 * Register a track when it's added to queue
 */
export async function registerTrackQueue(youtubeId: string): Promise<void> {
  // Sync queue count to Supabase
  if (isSupabaseConfigured) {
    videoIntelligenceAPI.recordQueue(youtubeId).catch(() => {});
  }
}

// ============================================
// CLEANUP
// ============================================

/**
 * Terminate OCR worker (call on app unmount)
 */
export async function terminateOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
    console.log('[VOYO OCR] Terminated');
  }
}
