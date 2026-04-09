/**
 * VOYO Music Backend Server
 * Dark Mode: Uses YouTube's own Innertube API via youtubei.js
 * v2.0.0 - Full control, no third-party dependencies
 */

import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Innertube } from 'youtubei.js';
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  encodeVoyoId,
  decodeVoyoId,
  sanitizeSearchResult,
  isValidVoyoId,
  isValidYouTubeId,
  getVoyoError
} from './stealth.js';

// ========================================
// R2 CLOUDFLARE STORAGE CONFIGURATION
// ========================================
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '2b9fcfd8cd9aedbd862ffd071d66a3e';
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY || '82679709fb4e9f7e77f1b159991c9551';
const R2_SECRET_KEY = process.env.R2_SECRET_KEY || '306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52';
const R2_BUCKET = process.env.R2_BUCKET || 'voyo-audio';
const R2_FEED_BUCKET = 'voyo-feed';

// S3 Client configured for Cloudflare R2
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

// R2 audio availability cache (5 min TTL)
const r2Cache = new Map();
const R2_CACHE_TTL = 5 * 60 * 1000;

/**
 * Check if audio exists in R2 bucket
 * @param {string} trackId - YouTube video ID
 * @param {string} quality - '128' or '64'
 * @returns {Promise<boolean>}
 */
async function checkR2Audio(trackId, quality = '128') {
  const cacheKey = `${trackId}-${quality}`;
  const cached = r2Cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < R2_CACHE_TTL) {
    return cached.exists;
  }

  try {
    await r2Client.send(new HeadObjectCommand({
      Bucket: R2_BUCKET,
      Key: `${quality}/${trackId}.mp3`,
    }));
    r2Cache.set(cacheKey, { exists: true, timestamp: Date.now() });
    return true;
  } catch (err) {
    r2Cache.set(cacheKey, { exists: false, timestamp: Date.now() });
    return false;
  }
}

/**
 * Stream audio from R2 bucket
 * @param {string} trackId - YouTube video ID
 * @param {string} quality - '128' or '64'
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 */
async function streamR2Audio(trackId, quality, req, res) {
  const key = `${quality}/${trackId}.mp3`;

  try {
    // Get object with range support
    const range = req.headers.range;
    const params = {
      Bucket: R2_BUCKET,
      Key: key,
    };

    if (range) {
      params.Range = range;
    }

    const command = new GetObjectCommand(params);
    const response = await r2Client.send(command);

    const headers = {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Cache-Control': 'public, max-age=31536000', // 1 year (immutable audio)
    };

    if (response.ContentLength) {
      headers['Content-Length'] = response.ContentLength;
    }
    if (response.ContentRange) {
      headers['Content-Range'] = response.ContentRange;
    }

    const statusCode = range && response.ContentRange ? 206 : 200;
    res.writeHead(statusCode, headers);

    // Pipe the stream
    response.Body.pipe(res);

    console.log(`[R2] Streaming ${key} (${quality}kbps)`);
  } catch (err) {
    console.error(`[R2] Stream error for ${key}:`, err.message);
    throw err;
  }
}

// R2 feed video availability cache (5 min TTL)
const r2FeedCache = new Map();

/**
 * Find a video in the R2 feed bucket by source_id
 * Tries multiple key patterns: instagram/{id}.mp4, {id}.mp4, {id}
 * @param {string} sourceId - Instagram/TikTok source ID
 * @returns {Promise<{exists: boolean, key: string|null, size: number}>}
 */
async function checkR2FeedVideo(sourceId) {
  const cached = r2FeedCache.get(sourceId);
  if (cached && Date.now() - cached.timestamp < R2_CACHE_TTL) {
    return cached.result;
  }

  const keyPatterns = [
    `instagram/${sourceId}.mp4`,
    `${sourceId}.mp4`,
    `${sourceId}`,
  ];

  for (const key of keyPatterns) {
    try {
      const head = await r2Client.send(new HeadObjectCommand({
        Bucket: R2_FEED_BUCKET,
        Key: key,
      }));
      const result = { exists: true, key, size: head.ContentLength || 0 };
      r2FeedCache.set(sourceId, { result, timestamp: Date.now() });
      return result;
    } catch (err) {
      // Key not found, try next pattern
    }
  }

  const result = { exists: false, key: null, size: 0 };
  r2FeedCache.set(sourceId, { result, timestamp: Date.now() });
  return result;
}

/**
 * Stream video from R2 feed bucket with range support
 * @param {string} key - R2 object key
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 */
async function streamR2FeedVideo(key, req, res) {
  try {
    const range = req.headers.range;
    const params = {
      Bucket: R2_FEED_BUCKET,
      Key: key,
    };

    if (range) {
      params.Range = range;
    }

    const command = new GetObjectCommand(params);
    const response = await r2Client.send(command);

    const headers = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Cache-Control': 'public, max-age=86400', // 24 hours
    };

    if (response.ContentLength) {
      headers['Content-Length'] = response.ContentLength;
    }
    if (response.ContentRange) {
      headers['Content-Range'] = response.ContentRange;
    }

    const statusCode = range && response.ContentRange ? 206 : 200;
    res.writeHead(statusCode, headers);

    response.Body.pipe(res);

    console.log(`[R2/Feed] Streaming ${key}`);
  } catch (err) {
    console.error(`[R2/Feed] Stream error for ${key}:`, err.message);
    throw err;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FIX 5: Global error handlers (prevent crashes)
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  // Don't exit - try to keep serving
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

// FIX 7: Connection pooling for better performance
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50
});

const PORT = process.env.PORT || 3001;
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp'; // Use system yt-dlp in production
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const YT_API_KEY = process.env.YT_API_KEY || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // FIX 1: Move to env var

// Auto-detect API_BASE: Fly.io, Railway, or localhost
let API_BASE = process.env.API_BASE || `http://localhost:${PORT}`;
if (process.env.FLY_APP_NAME) {
  API_BASE = `https://${process.env.FLY_APP_NAME}.fly.dev`;
} else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  API_BASE = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}

// ========================================
// INNERTUBE - YouTube's Internal API
// ========================================
let innertube = null;

async function getInnertube() {
  if (!innertube) {
    console.log('[Innertube] Initializing YouTube internal API...');
    innertube = await Innertube.create({
      cache: new Map(), // Simple in-memory cache
      generate_session_locally: true,
    });
    console.log('[Innertube] Ready.');
  }
  return innertube;
}

/**
 * Extract audio URL using YouTube's Innertube API
 * This is the same API the YouTube app uses
 */
async function extractAudioWithInnertube(videoId) {
  try {
    const yt = await getInnertube();
    const info = await yt.getBasicInfo(videoId);

    if (!info.streaming_data?.adaptive_formats) {
      console.log('[Innertube] No adaptive formats found');
      return null;
    }

    // Get audio formats, prefer mp4/m4a, sort by bitrate
    const audioFormats = info.streaming_data.adaptive_formats
      .filter(f => f.mime_type?.startsWith('audio/'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    if (audioFormats.length === 0) {
      console.log('[Innertube] No audio formats available');
      return null;
    }

    // Prefer mp4 audio (better compatibility)
    const mp4Audio = audioFormats.find(f => f.mime_type?.includes('mp4'));
    const bestAudio = mp4Audio || audioFormats[0];

    console.log(`[Innertube] Found: ${bestAudio.mime_type} @ ${bestAudio.bitrate} bps`);

    return {
      url: bestAudio.url,
      mimeType: bestAudio.mime_type?.split(';')[0] || 'audio/mp4',
      bitrate: bestAudio.bitrate,
      title: info.basic_info?.title,
    };
  } catch (err) {
    console.error('[Innertube] Error:', err.message);
    return null;
  }
}

// ========================================
// PRODUCTION-GRADE CACHING SYSTEM
// ========================================

// Stream URL cache (4 hours - YouTube URLs valid for ~6 hours)
const streamCache = new Map();
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// In-flight requests to prevent duplicate yt-dlp calls
const inFlightRequests = new Map();

// Thumbnail cache (24 hours - images don't expire)
const thumbnailCache = new Map();
const THUMBNAIL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_THUMBNAIL_CACHE = 500; // FIX 3: Limit to prevent OOM

// Prefetch cache - warmed up streams ready to go
const prefetchCache = new Map(); // trackId -> { timestamp, warmed: boolean }
const PREFETCH_TTL = 30 * 60 * 1000; // 30 minutes

// Cache statistics for monitoring
const cacheStats = {
  streamHits: 0,
  streamMisses: 0,
  thumbnailHits: 0,
  thumbnailMisses: 0,
  prefetchRequests: 0,
  activeStreams: 0,
  startTime: Date.now()
};

// ========================================
// ANTI-BLOCKING PROTECTION SYSTEM
// Designed for scale while being a good YouTube citizen
// ========================================

// Rate limiting per IP (prevents abuse, shows YouTube we're responsible)
const ipRequestCounts = new Map(); // IP -> { count, windowStart }
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP (generous)
const RATE_LIMIT_YT_DLP = 10; // Max 10 yt-dlp calls per minute per IP (actual YouTube hits)

// Global yt-dlp rate limiting (across all users)
let globalYtDlpCalls = 0;
let globalYtDlpWindowStart = Date.now();
const GLOBAL_YT_DLP_LIMIT = 300; // 300 yt-dlp calls per minute globally (5 per second)

// Request queue for yt-dlp (prevents thundering herd)
const ytDlpQueue = [];
let ytDlpProcessing = false;
const YT_DLP_CONCURRENCY = 3; // Max 3 concurrent yt-dlp processes
let activeYtDlpProcesses = 0;

// User-Agent rotation (look like different clients)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Check and update rate limit for an IP
function checkRateLimit(ip, isYtDlp = false) {
  const now = Date.now();
  const key = ip || 'unknown';

  // Get or create IP tracking
  let ipData = ipRequestCounts.get(key);
  if (!ipData || now - ipData.windowStart > RATE_LIMIT_WINDOW) {
    ipData = { count: 0, ytDlpCount: 0, windowStart: now };
    ipRequestCounts.set(key, ipData);
  }

  // Check general rate limit
  if (ipData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, reason: 'rate_limit_exceeded', retryAfter: Math.ceil((ipData.windowStart + RATE_LIMIT_WINDOW - now) / 1000) };
  }

  // Check yt-dlp specific rate limit
  if (isYtDlp && ipData.ytDlpCount >= RATE_LIMIT_YT_DLP) {
    return { allowed: false, reason: 'yt_dlp_rate_limit', retryAfter: Math.ceil((ipData.windowStart + RATE_LIMIT_WINDOW - now) / 1000) };
  }

  // Check global yt-dlp limit
  if (isYtDlp) {
    if (now - globalYtDlpWindowStart > RATE_LIMIT_WINDOW) {
      globalYtDlpCalls = 0;
      globalYtDlpWindowStart = now;
    }
    if (globalYtDlpCalls >= GLOBAL_YT_DLP_LIMIT) {
      return { allowed: false, reason: 'global_yt_dlp_limit', retryAfter: Math.ceil((globalYtDlpWindowStart + RATE_LIMIT_WINDOW - now) / 1000) };
    }
    globalYtDlpCalls++;
    ipData.ytDlpCount++;
  }

  ipData.count++;
  return { allowed: true };
}

// Get client IP from request
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.socket?.remoteAddress ||
         'unknown';
}

// Clean up old IP tracking entries (run periodically)
function cleanupRateLimitData() {
  const now = Date.now();
  for (const [ip, data] of ipRequestCounts.entries()) {
    if (now - data.windowStart > RATE_LIMIT_WINDOW * 2) {
      ipRequestCounts.delete(ip);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupRateLimitData, 5 * 60 * 1000);

// ========================================
// CACHE CLEANUP - Prevent memory leaks
// ========================================

function cleanupExpiredCache() {
  const now = Date.now();
  let cleaned = 0;

  // FIX 2: Collect keys first, then delete (prevents race condition)
  // Clean stream cache (4 hour TTL)
  const streamKeysToDelete = [];
  for (const [key, entry] of streamCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      streamKeysToDelete.push(key);
    }
  }
  streamKeysToDelete.forEach(k => streamCache.delete(k));
  cleaned += streamKeysToDelete.length;

  // Clean thumbnail cache (24 hour TTL) - CRITICAL: prevents memory leaks
  const thumbKeysToDelete = [];
  for (const [key, entry] of thumbnailCache.entries()) {
    if (now - entry.timestamp > THUMBNAIL_CACHE_TTL) {
      thumbKeysToDelete.push(key);
    }
  }
  thumbKeysToDelete.forEach(k => thumbnailCache.delete(k));
  cleaned += thumbKeysToDelete.length;

  // Clean prefetch cache (30 min TTL)
  const prefetchKeysToDelete = [];
  for (const [key, entry] of prefetchCache.entries()) {
    if (now - entry.timestamp > PREFETCH_TTL) {
      prefetchKeysToDelete.push(key);
    }
  }
  prefetchKeysToDelete.forEach(k => prefetchCache.delete(k));
  cleaned += prefetchKeysToDelete.length;

  // Clean R2 feed cache (5 min TTL)
  const feedKeysToDelete = [];
  for (const [key, entry] of r2FeedCache.entries()) {
    if (now - entry.timestamp > R2_CACHE_TTL) {
      feedKeysToDelete.push(key);
    }
  }
  feedKeysToDelete.forEach(k => r2FeedCache.delete(k));
  cleaned += feedKeysToDelete.length;

  if (cleaned > 0) {
    console.log(`[Cache Cleanup] Removed ${cleaned} expired entries (stream: ${streamCache.size}, thumb: ${thumbnailCache.size}, prefetch: ${prefetchCache.size}, feed: ${r2FeedCache.size})`);
  }
}

// Run cache cleanup every 10 minutes
setInterval(cleanupExpiredCache, 10 * 60 * 1000);

// ========================================

// FIX 4: Restrict CORS origins (production security)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://voyo.app',
  'https://voyo-music.vercel.app'
];

// CORS headers - will be dynamically set per request
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Default, will be overridden
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// FIX 4: Get allowed CORS origin for request
function getCorsOrigin(req) {
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

/**
 * Get stream URL using yt-dlp with quality selection
 * @param {string} videoId - YouTube video ID
 * @param {string} type - 'audio' or 'video'
 * @param {string} quality - 'low', 'medium', 'high' (audio only)
 */
async function getStreamUrl(videoId, type = 'audio', quality = 'high') {
  const cacheKey = `${videoId}-${type}-${quality}`;

  // Check cache first
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[Cache Hit] ${cacheKey}`);
    cacheStats.streamHits++;
    return cached;
  }

  cacheStats.streamMisses++;

  // Check if there's already a request in flight for this video
  if (inFlightRequests.has(cacheKey)) {
    console.log(`[In-Flight] Waiting for existing request: ${cacheKey}`);
    return inFlightRequests.get(cacheKey);
  }

  // Create promise for this request
  const requestPromise = new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[yt-dlp] Fetching ${type} (${quality}) URL for: ${videoId}`);

    // Format selection - HIGHEST QUALITY ONLY
    // 251 = Opus 139kbps (BEST), 140 = AAC 128kbps (fallback)
    // PO Token plugin (bgutil-ytdlp-pot-provider) unlocks all formats
    let format;
    if (type === 'video') {
      format = 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best';
    } else {
      // Audio: ALWAYS highest quality - no compromises
      format = '251/140/bestaudio';
    }

    // Anti-blocking: Use random User-Agent and add delay jitter
    const userAgent = getRandomUserAgent();

    const ytdlp = spawn(YT_DLP_PATH, [
      '-f', format,
      '-g',  // Get URL only
      '--no-warnings',
      '--user-agent', userAgent,
      '--sleep-requests', '0.5',  // 500ms between requests to YouTube
      '--no-check-certificates',  // Skip certificate validation (faster)
      ytUrl
    ], {
      env: { ...process.env, PATH: `${process.env.HOME}/.deno/bin:${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });

    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const urls = stdout.trim().split('\n');
        // For video, yt-dlp may return 2 URLs (video + audio separately)
        // For audio, it returns 1 URL
        const result = {
          url: urls[0],
          audioUrl: urls.length > 1 ? urls[1] : urls[0],
          type,
          timestamp: Date.now()
        };
        // Cache the result
        streamCache.set(cacheKey, result);
        console.log(`[yt-dlp] Success: ${cacheKey}`);
        resolve(result);
      } else {
        console.error(`[yt-dlp] Error for ${videoId}:`, stderr);
        reject(new Error(stderr || 'Failed to get stream URL'));
      }
    });

    ytdlp.on('error', (err) => {
      console.error(`[yt-dlp] Spawn error:`, err);
      reject(err);
    });
  });

  // Track in-flight request
  inFlightRequests.set(cacheKey, requestPromise);

  // Clean up in-flight tracking when done
  requestPromise.finally(() => {
    inFlightRequests.delete(cacheKey);
  });

  return requestPromise;
}

/**
 * Fetch and proxy YouTube thumbnail
 * @param {string} videoId - YouTube video ID
 * @param {string} quality - Thumbnail quality (high, medium, default, max)
 */
async function getThumbnail(videoId, quality = 'high') {
  const cacheKey = `${videoId}-${quality}`;

  // Check cache first (use longer TTL for thumbnails)
  const cached = thumbnailCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < THUMBNAIL_CACHE_TTL) {
    console.log(`[Thumbnail Cache Hit] ${cacheKey}`);
    cacheStats.thumbnailHits++;
    return cached.data;
  }

  cacheStats.thumbnailMisses++;

  return new Promise((resolve, reject) => {
    // Quality mapping
    const qualityMap = {
      'max': 'maxresdefault.jpg',
      'high': 'hqdefault.jpg',
      'medium': 'mqdefault.jpg',
      'default': 'default.jpg'
    };

    const filename = qualityMap[quality] || qualityMap.high;
    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/${filename}`;

    console.log(`[Thumbnail] Fetching for: ${videoId} (${quality})`);

    https.get(thumbnailUrl, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        reject(new Error(`Failed to fetch thumbnail: ${proxyRes.statusCode}`));
        return;
      }

      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const imageData = Buffer.concat(chunks);
        // Cache the result
        thumbnailCache.set(cacheKey, {
          data: imageData,
          timestamp: Date.now()
        });

        // FIX 3: Evict oldest if over limit (LRU)
        if (thumbnailCache.size > MAX_THUMBNAIL_CACHE) {
          const oldest = Array.from(thumbnailCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
          if (oldest) thumbnailCache.delete(oldest[0]);
        }

        console.log(`[Thumbnail] Success: ${cacheKey} (${imageData.length} bytes)`);
        resolve(imageData);
      });
    }).on('error', (err) => {
      console.error(`[Thumbnail] Error for ${videoId}:`, err);
      reject(err);
    });
  });
}

/**
 * Get related videos for a YouTube video using Innertube
 * Returns videos similar to the given video ID
 */
async function getRelatedVideos(videoId, limit = 5) {
  try {
    const yt = await getInnertube();

    // Use getInfo which returns VideoInfo with related videos
    const info = await yt.getInfo(videoId);

    // Try multiple possible locations for related videos
    let related = [];

    // Method 1: watch_next_feed
    if (info.watch_next_feed?.length) {
      related = info.watch_next_feed;
      console.log(`[Innertube] Found ${related.length} in watch_next_feed`);
    }
    // Method 2: autoplay_video
    else if (info.autoplay_video) {
      related = [info.autoplay_video];
      console.log(`[Innertube] Found autoplay_video`);
    }
    // Method 3: related_videos
    else if (info.related_videos?.length) {
      related = info.related_videos;
      console.log(`[Innertube] Found ${related.length} in related_videos`);
    }
    // Method 4: Try secondary_results from page
    else if (info.page?.secondary_results?.length) {
      related = info.page.secondary_results;
      console.log(`[Innertube] Found ${related.length} in secondary_results`);
    }

    const results = [];

    for (const item of related) {
      if (results.length >= limit) break;

      try {
        // Handle CompactVideo type from youtubei.js
        if (item.type === 'CompactVideo') {
          results.push({
            id: item.id,
            title: item.title?.text || item.title?.toString() || 'Unknown',
            artist: item.short_byline?.text || item.author?.name || 'Unknown',
            duration: parseDuration(item.duration?.text || '0:00'),
            thumbnail: `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
          });
          continue;
        }

        // Handle Video type
        if (item.type === 'Video') {
          results.push({
            id: item.id,
            title: item.title?.text || item.title?.toString() || 'Unknown',
            artist: item.author?.name || 'Unknown',
            duration: parseDuration(item.duration?.text || '0:00'),
            thumbnail: `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
          });
          continue;
        }

        // Generic fallback - try various property paths
        const video = item?.content || item?.video || item;
        const id = video?.id || video?.video_id || video?.videoId;
        const title = video?.title?.text || video?.title?.toString() || video?.title;

        if (id && title && typeof id === 'string' && id.length === 11) {
          results.push({
            id: id,
            title: typeof title === 'object' ? title.text : title,
            artist: video.author?.name || video.short_byline?.text || video.owner?.name || 'Unknown',
            duration: parseDuration(video.duration?.text || video.length_text?.text || '0:00'),
            thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
          });
        }
      } catch (parseErr) {
        // Skip items that fail to parse
        continue;
      }
    }

    console.log(`[Innertube] Parsed ${results.length} related videos for ${videoId}`);

    // Fallback: If no related found, search for similar content
    if (results.length === 0) {
      console.log(`[Innertube] No related found, trying search fallback`);
      const searchResults = await searchInnerTube(`${info.basic_info?.title || videoId} music`, limit);
      return searchResults;
    }

    return results;
  } catch (err) {
    console.error('[Innertube] Related videos error:', err.message);
    return [];
  }
}

/**
 * Search YouTube using yt-dlp
 */
/**
 * FAST search using Innertube (YouTube's internal API)
 * ~500ms vs 5-10sec with yt-dlp
 */
async function searchInnerTube(query, limit = 10) {
  console.log(`[Innertube] Fast searching: ${query}`);

  try {
    const response = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${YT_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20231219.04.00',
            hl: 'en',
            gl: 'US',
          }
        },
        query: query,
      }),
    });

    if (!response.ok) {
      throw new Error(`Innertube search failed: ${response.status}`);
    }

    const data = await response.json();
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

    const results = [];
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const video = item?.videoRenderer;
        if (video && results.length < limit) {
          results.push({
            id: video.videoId,
            title: video.title?.runs?.[0]?.text || 'Unknown',
            artist: video.ownerText?.runs?.[0]?.text || video.shortBylineText?.runs?.[0]?.text || 'Unknown',
            duration: parseDuration(video.lengthText?.simpleText || '0:00'),
            thumbnail: `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`,
            views: parseViews(video.viewCountText?.simpleText || '0'),
          });
        }
      }
    }

    console.log(`[Innertube] Found ${results.length} results in ~500ms`);
    return results;
  } catch (error) {
    console.error('[Innertube] Search failed:', error.message);
    // Fallback to yt-dlp
    return searchYouTubeYtDlp(query, limit);
  }
}

function parseDuration(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function parseViews(str) {
  if (!str) return 0;
  const num = str.replace(/[^0-9.KMB]/gi, '');
  if (num.includes('B')) return parseFloat(num) * 1000000000;
  if (num.includes('M')) return parseFloat(num) * 1000000;
  if (num.includes('K')) return parseFloat(num) * 1000;
  return parseInt(num) || 0;
}

// Use Innertube by default, fallback to yt-dlp
async function searchYouTube(query, limit = 10) {
  return searchInnerTube(query, limit);
}

// Original yt-dlp search (slow but reliable fallback)
async function searchYouTubeYtDlp(query, limit = 10) {
  return new Promise((resolve, reject) => {
    console.log(`[yt-dlp] Fallback searching: ${query}`);

    const ytdlp = spawn(YT_DLP_PATH, [
      `ytsearch${limit}:${query}`,
      '--flat-playlist',
      '-j',
      '--no-warnings'
    ], {
      env: { ...process.env, PATH: `${process.env.HOME}/.deno/bin:${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });

    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const results = stdout.trim().split('\n')
            .filter(line => line.trim())
            .map(line => {
              const data = JSON.parse(line);
              return {
                id: data.id,
                title: data.title,
                artist: data.uploader || data.channel || 'Unknown',
                duration: data.duration || 0,
                thumbnail: data.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${data.id}/hqdefault.jpg`,
                views: data.view_count || 0
              };
            });
          console.log(`[yt-dlp] Found ${results.length} results`);
          resolve(results);
        } catch (e) {
          console.error('[yt-dlp] Parse error:', e);
          reject(e);
        }
      } else {
        console.error(`[yt-dlp] Search error:`, stderr);
        reject(new Error(stderr || 'Search failed'));
      }
    });

    ytdlp.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Download audio file using yt-dlp
 * @param {string} videoId - YouTube video ID
 */
async function downloadAudio(videoId) {
  return new Promise((resolve, reject) => {
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(DOWNLOADS_DIR, `${videoId}.mp3`);

    // Check if already downloaded
    if (fs.existsSync(outputPath)) {
      console.log(`[Download] Already exists: ${videoId}`);
      resolve({ success: true, path: `/downloads/${videoId}.mp3`, alreadyExists: true });
      return;
    }

    console.log(`[Download] Starting download for: ${videoId}`);

    const ytdlp = spawn(YT_DLP_PATH, [
      '-f', '251/140/bestaudio',  // HIGHEST QUALITY: 251 = Opus 139kbps
      '-x',
      '--audio-format', 'mp3',
      '-o', outputPath,
      '--no-warnings',
      ytUrl
    ], {
      env: { ...process.env, PATH: `${process.env.HOME}/.deno/bin:${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });

    let stderr = '';

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log progress
      const progressMatch = stderr.match(/(\d+\.\d+)%/);
      if (progressMatch) {
        console.log(`[Download] Progress: ${progressMatch[1]}%`);
      }
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[Download] Success: ${videoId}`);
        resolve({
          success: true,
          path: `/downloads/${videoId}.mp3`,
          alreadyExists: false
        });
      } else {
        console.error(`[Download] Failed for ${videoId}:`, stderr);
        reject(new Error(stderr || 'Download failed'));
      }
    });

    ytdlp.on('error', (err) => {
      console.error(`[Download] Spawn error:`, err);
      reject(err);
    });
  });
}

/**
 * Get list of downloaded video IDs
 */
function getDownloadedIds() {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const audioExts = ['.mp3', '.m4a', '.webm', '.opus'];
    return files
      .filter(file => audioExts.some(ext => file.endsWith(ext)))
      .map(file => {
        // Remove extension
        for (const ext of audioExts) {
          if (file.endsWith(ext)) {
            return file.replace(ext, '');
          }
        }
        return file;
      });
  } catch (error) {
    console.error('[Downloads] Error reading directory:', error);
    return [];
  }
}

/**
 * Delete a downloaded file
 * @param {string} videoId - YouTube video ID
 */
function deleteDownload(videoId) {
  const audioExts = ['.mp3', '.m4a', '.webm', '.opus'];
  try {
    // Find and delete file with any supported audio extension
    for (const ext of audioExts) {
      const filePath = path.join(DOWNLOADS_DIR, `${videoId}${ext}`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Download] Deleted: ${videoId}${ext}`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`[Download] Delete error for ${videoId}:`, error);
    return false;
  }
}

/**
 * HTTP Server
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;
  const clientIP = getClientIP(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Rate limit check for all requests (except health check)
  if (pathname !== '/health') {
    const isYtDlpRequest = ['/cdn/stream', '/proxy', '/stream', '/search', '/api/search'].some(p => pathname.startsWith(p));
    const rateLimit = checkRateLimit(clientIP, isYtDlpRequest && !streamCache.has(query.v));

    if (!rateLimit.allowed) {
      console.log(`[Rate Limit] Blocked ${clientIP}: ${rateLimit.reason}`);
      res.writeHead(429, {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': rateLimit.retryAfter
      });
      res.end(JSON.stringify({
        error: 'Too many requests',
        reason: rateLimit.reason,
        retryAfter: rateLimit.retryAfter
      }));
      return;
    }
  }

  // ========================================
  // PRODUCTION MONITORING ENDPOINTS
  // ========================================

  // Enhanced health check with detailed metrics
  if (pathname === '/health') {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    const hitRate = cacheStats.streamHits + cacheStats.streamMisses > 0
      ? ((cacheStats.streamHits / (cacheStats.streamHits + cacheStats.streamMisses)) * 100).toFixed(2)
      : 0;

    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'voyo-backend',
      uptime: Math.floor(uptime),
      uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`
      },
      cache: {
        streamCacheSize: streamCache.size,
        thumbnailCacheSize: thumbnailCache.size,
        prefetchCacheSize: prefetchCache.size,
        streamHitRate: `${hitRate}%`,
        stats: cacheStats
      },
      rateLimit: {
        activeIPs: ipRequestCounts.size,
        globalYtDlpCalls: globalYtDlpCalls,
        globalYtDlpLimit: GLOBAL_YT_DLP_LIMIT,
        perIPLimit: RATE_LIMIT_MAX_REQUESTS,
        perIPYtDlpLimit: RATE_LIMIT_YT_DLP
      },
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Debug endpoint - check yt-dlp availability
  if (pathname === '/debug') {
    const { exec } = await import('child_process');
    const checkYtDlp = () => new Promise((resolve) => {
      exec('which yt-dlp && yt-dlp --version', (error, stdout, stderr) => {
        resolve({
          available: !error,
          path: stdout.trim().split('\n')[0] || 'not found',
          version: stdout.trim().split('\n')[1] || 'unknown',
          error: error ? error.message : null
        });
      });
    });
    const checkDeno = () => new Promise((resolve) => {
      exec('which deno && deno --version', (error, stdout, stderr) => {
        resolve({
          available: !error,
          path: stdout.trim().split('\n')[0] || 'not found',
          version: stdout.trim().split('\n')[1] || 'unknown',
          error: error ? error.message : null
        });
      });
    });

    const ytdlpInfo = await checkYtDlp();
    const denoInfo = await checkDeno();
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ytdlp: ytdlpInfo,
      deno: denoInfo,
      ytdlpPath: YT_DLP_PATH,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        RAILWAY: !!process.env.RAILWAY_PUBLIC_DOMAIN
      }
    }));
    return;
  }

  // Prefetch warming endpoint - warm up stream URL before needed
  if (pathname === '/prefetch' && query.v) {
    try {
      const videoId = query.v;
      const quality = query.quality || 'high';
      const type = query.type || 'audio';

      console.log(`[Prefetch] Warming ${videoId} (${quality})`);
      cacheStats.prefetchRequests++;

      // Mark as warming
      prefetchCache.set(videoId, {
        timestamp: Date.now(),
        warmed: false,
        quality
      });

      // Start warming in background (don't await)
      getStreamUrl(videoId, type, quality)
        .then(() => {
          prefetchCache.set(videoId, {
            timestamp: Date.now(),
            warmed: true,
            quality
          });
          console.log(`[Prefetch] Warmed ${videoId}`);
        })
        .catch(err => {
          console.error(`[Prefetch] Failed for ${videoId}:`, err.message);
          prefetchCache.delete(videoId);
        });

      // Respond immediately (non-blocking)
      res.writeHead(202, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'warming',
        videoId,
        message: 'Stream warming initiated'
      }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get stream URL (audio or video) with quality selection
  // VOYO BOOST: Check cache first, background download for future plays
  if (pathname === '/stream' && query.v) {
    // SECURITY: Validate video ID before processing
    if (!isValidYouTubeId(query.v)) {
      console.warn(`[Stream] REJECTED invalid video ID: ${query.v}`);
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
      return;
    }

    const videoId = query.v;
    const type = query.type === 'video' ? 'video' : 'audio';
    const quality = query.quality || 'high';

    // CHECK CACHE FIRST - Serve from our storage if available
    const cachedPath = path.join(DOWNLOADS_DIR, `${videoId}.mp3`);
    if (type === 'audio' && fs.existsSync(cachedPath)) {
      console.log(`[Stream] 🚀 VOYO BOOST - Serving cached: ${videoId}`);

      // Get file stats for content length
      const stats = fs.statSync(cachedPath);

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        url: `${API_BASE}/downloads/${videoId}.mp3`,
        audioUrl: `${API_BASE}/downloads/${videoId}.mp3`,
        videoId: videoId,
        type: 'audio',
        quality: 'boosted',
        cached: true,
        contentLength: stats.size,
        source: 'voyo_cache'
      }));
      return;
    }

    // NOT CACHED - Start background download and return PROXY URL
    // CRITICAL: We return our PROXY URL, not the raw googlevideo URL
    // because googlevideo URLs are IP-locked to whoever extracted them
    try {
      // START BACKGROUND DOWNLOAD (fire and forget)
      if (type === 'audio') {
        console.log(`[Stream] Starting background boost for: ${videoId}`);
        downloadAudio(videoId).then(() => {
          console.log(`[Stream] ✅ BOOST COMPLETE: ${videoId} now cached`);
        }).catch(err => {
          console.warn(`[Stream] Boost failed for ${videoId}:`, err.message);
        });
      }

      // Return OUR proxy URL - browser plays from us, we fetch from YouTube
      // Use /proxy endpoint (yt-dlp based) NOT /cdn/stream (Innertube based)
      // because Innertube is getting blocked by YouTube
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        url: `${API_BASE}/proxy?v=${videoId}&quality=${quality}`,
        audioUrl: `${API_BASE}/proxy?v=${videoId}&quality=${quality}`,
        videoId: videoId,
        type: type,
        quality,
        cached: false,
        boosting: type === 'audio', // Let frontend know boost is in progress
        source: 'voyo_proxy'
      }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // PROXY endpoint - streams audio through our server with range support
  if (pathname === '/proxy' && query.v) {
    // SECURITY: Validate video ID before processing
    if (!isValidYouTubeId(query.v)) {
      console.warn(`[Proxy] REJECTED invalid video ID: ${query.v}`);
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
      return;
    }
    try {
      const type = query.type === 'video' ? 'video' : 'audio';
      const quality = query.quality || 'high'; // low, medium, high
      const result = await getStreamUrl(query.v, type, quality);
      const streamUrl = type === 'audio' ? result.audioUrl : result.url;

      console.log(`[Proxy] Streaming ${type} (${quality}) for ${query.v}`);
      cacheStats.activeStreams++;

      // Parse the googlevideo URL
      const parsedStream = new URL(streamUrl);

      // Forward request to googlevideo with range support
      const proxyReq = https.request({
        hostname: parsedStream.hostname,
        path: parsedStream.pathname + parsedStream.search,
        method: 'GET',
        agent: httpsAgent, // FIX 7: Use connection pooling
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Range': req.headers.range || 'bytes=0-',
        }
      }, (proxyRes) => {
        // Forward headers with CORS
        let contentType = 'audio/webm; codecs=opus';
        const origType = proxyRes.headers['content-type'] || '';
        if (origType.includes('mp4') || origType.includes('m4a')) contentType = 'audio/mp4';
        else if (origType.includes('mpeg') || origType.includes('mp3')) contentType = 'audio/mpeg';

        const headers = {
          ...corsHeaders,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        };

        // Forward Content-Length if present
        if (proxyRes.headers['content-length']) {
          headers['Content-Length'] = proxyRes.headers['content-length'];
        }

        // Forward Content-Range for partial content (206 responses)
        if (proxyRes.headers['content-range']) {
          headers['Content-Range'] = proxyRes.headers['content-range'];
        }

        // Use appropriate status code (206 for range requests, 200 for full)
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);

        // Track when stream ends
        proxyRes.on('end', () => {
          cacheStats.activeStreams--;
        });
      });

      proxyReq.on('error', (err) => {
        console.error('[Proxy] Error:', err);
        cacheStats.activeStreams--;
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: 'Proxy failed' }));
      });

      proxyReq.end();
    } catch (err) {
      console.error('[Proxy] Error:', err);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Search
  if (pathname === '/search' && query.q) {
    try {
      const limit = parseInt(query.limit) || 10;
      const results = await searchYouTube(query.q, limit);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Related videos - for interceptor
  if (pathname === '/related' && query.v) {
    // SECURITY: Validate video ID before processing
    if (!isValidYouTubeId(query.v)) {
      console.warn(`[Related] REJECTED invalid video ID: ${query.v}`);
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
      return;
    }
    try {
      const limit = parseInt(query.limit) || 5;
      const results = await getRelatedVideos(query.v, limit);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ videos: results }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Thumbnail proxy - HIDE YouTube completely
  if (pathname === '/thumbnail' && query.id) {
    // SECURITY: Validate video ID before processing
    if (!isValidYouTubeId(query.id)) {
      console.warn(`[Thumbnail] REJECTED invalid video ID: ${query.id}`);
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
      return;
    }
    try {
      const quality = query.quality || 'high';
      const imageData = await getThumbnail(query.id, quality);

      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'image/jpeg',
        'Content-Length': imageData.length,
        'Cache-Control': 'public, max-age=3600' // 1 hour browser cache
      });
      res.end(imageData);
    } catch (err) {
      console.error('[Thumbnail] Error:', err);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Download audio file
  if (pathname === '/download' && req.method === 'GET' && query.v) {
    // SECURITY: Validate video ID before processing
    if (!isValidYouTubeId(query.v)) {
      console.warn(`[Download] REJECTED invalid video ID: ${query.v}`);
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
      return;
    }
    try {
      const result = await downloadAudio(query.v);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Delete downloaded file
  if (pathname === '/download' && req.method === 'DELETE' && query.v) {
    // SECURITY: Validate video ID before processing
    if (!isValidYouTubeId(query.v)) {
      console.warn(`[Delete] REJECTED invalid video ID: ${query.v}`);
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
      return;
    }
    try {
      const success = deleteDownload(query.v);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get list of downloaded tracks
  if (pathname === '/downloaded') {
    try {
      const downloads = getDownloadedIds();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ downloads }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Serve downloaded audio file (supports multiple formats)
  if (pathname.startsWith('/downloads/')) {
    const audioExts = ['.mp3', '.m4a', '.webm', '.opus'];
    let videoId = null;
    let fileExt = null;

    // Extract videoId and extension
    for (const ext of audioExts) {
      if (pathname.endsWith(ext)) {
        videoId = pathname.replace('/downloads/', '').replace(ext, '');
        fileExt = ext;
        break;
      }
    }

    if (!videoId || !fileExt) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file format' }));
      return;
    }

    const filePath = path.join(DOWNLOADS_DIR, `${videoId}${fileExt}`);

    try {
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      // Determine content type based on extension
      const contentTypes = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.webm': 'audio/webm',
        '.opus': 'audio/opus'
      };
      const contentType = contentTypes[fileExt] || 'audio/mpeg';

      if (range) {
        // Handle range request for seeking
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          ...corsHeaders,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });
        fileStream.pipe(res);
      } else {
        // Full file
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (err) {
      console.error('[Downloads] Serve error:', err);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ========================================
  // STEALTH MODE ENDPOINTS
  // ========================================

  // STEALTH: Search with VOYO IDs - /api/search?q=QUERY
  if (pathname === '/api/search' && query.q) {
    try {
      const limit = parseInt(query.limit) || 10;
      const results = await searchYouTube(query.q, limit);

      // Transform all results to use VOYO IDs
      const voyoResults = results.map(sanitizeSearchResult);

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: voyoResults }));
    } catch (err) {
      console.error('[API/Search] Error:', err);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('SEARCH_FAILED') }));
    }
    return;
  }

  // STEALTH: CDN Art endpoint - accepts both vyo_XXXXX and raw YouTube IDs
  if (pathname.startsWith('/cdn/art/')) {
    try {
      const trackId = pathname.split('/cdn/art/')[1];

      // Accept BOTH VOYO IDs (vyo_XXXXX) and raw YouTube IDs (for seed tracks)
      // SECURITY: All IDs validated with strict regex to prevent command injection
      let youtubeId;
      if (isValidVoyoId(trackId)) {
        youtubeId = decodeVoyoId(trackId);
        console.log(`[CDN/Art] VOYO ID: ${trackId} -> ${youtubeId}`);
      } else if (isValidYouTubeId(trackId)) {
        // Raw YouTube ID - VALIDATED with strict alphanumeric regex
        youtubeId = trackId;
        console.log(`[CDN/Art] Raw ID: ${trackId}`);
      } else {
        console.warn(`[CDN/Art] REJECTED invalid ID: ${trackId}`);
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
        return;
      }

      const quality = query.quality || 'high';
      const imageData = await getThumbnail(youtubeId, quality);

      console.log(`[CDN/Art] Served art for ${youtubeId}`);

      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'image/jpeg',
        'Content-Length': imageData.length,
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(imageData);
    } catch (err) {
      console.error('[CDN/Art] Error:', err);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('THUMBNAIL_FAILED') }));
    }
    return;
  }

  // STEALTH: CDN Stream endpoint - accepts both vyo_XXXXX and raw YouTube IDs
  if (pathname.startsWith('/cdn/stream/')) {
    try {
      const trackId = pathname.split('/cdn/stream/')[1];

      // Accept BOTH VOYO IDs (vyo_XXXXX) and raw YouTube IDs (for seed tracks)
      // SECURITY: All IDs validated with strict regex to prevent command injection
      let youtubeId;
      if (isValidVoyoId(trackId)) {
        youtubeId = decodeVoyoId(trackId);
        console.log(`[CDN/Stream] VOYO ID: ${trackId} -> ${youtubeId}`);
      } else if (isValidYouTubeId(trackId)) {
        // Raw YouTube ID - VALIDATED with strict alphanumeric regex
        youtubeId = trackId;
        console.log(`[CDN/Stream] Raw ID: ${trackId}`);
      } else {
        console.warn(`[CDN/Stream] REJECTED invalid ID: ${trackId}`);
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: getVoyoError('INVALID_ID') }));
        return;
      }

      const type = query.type === 'video' ? 'video' : 'audio';
      const quality = query.quality || 'high'; // Support quality selection

      console.log(`[CDN/Stream] Streaming ${type} (${quality}) for ${youtubeId}`);
      cacheStats.activeStreams++;

      // DARK MODE: Use YouTube's own Innertube API
      // Same API the YouTube app uses - no third-party dependencies
      if (type === 'audio') {
        console.log(`[CDN/Stream] Extracting audio via Innertube for ${youtubeId}`);

        let audioUrl = null;
        let contentType = 'audio/mp4';

        // PRIMARY: Innertube (YouTube's internal API)
        const innertubeResult = await extractAudioWithInnertube(youtubeId);
        if (innertubeResult?.url) {
          audioUrl = innertubeResult.url;
          contentType = innertubeResult.mimeType || 'audio/mp4';
          console.log(`[CDN/Stream] ✓ Innertube: ${innertubeResult.bitrate} bps`);
        }

        // FALLBACK: Piped (if Innertube fails)
        if (!audioUrl) {
          console.log(`[CDN/Stream] Innertube failed, trying Piped fallback...`);
          const PIPED_INSTANCES = [
            'https://pipedapi.kavin.rocks',
            'https://api.piped.private.coffee',
            'https://pipedapi.r4fo.com',
          ];

          for (const pipedInstance of PIPED_INSTANCES) {
            try {
              const pipedResponse = await fetch(`${pipedInstance}/streams/${youtubeId}`, {
                signal: AbortSignal.timeout(8000),
              });

              if (pipedResponse.ok) {
                const data = await pipedResponse.json();
                const audioStreams = data.audioStreams || [];
                const mp4Streams = audioStreams.filter(s => s.mimeType?.includes('mp4'));
                const bestAudio = mp4Streams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]
                  || audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

                if (bestAudio?.url) {
                  audioUrl = bestAudio.url;
                  contentType = bestAudio.mimeType?.split(';')[0] || 'audio/mp4';
                  console.log(`[CDN/Stream] ✓ Piped fallback: ${bestAudio.bitrate} bps`);
                  break;
                }
              }
            } catch (err) {
              // Silent fail, try next
            }
          }

        }

        if (!audioUrl) {
          cacheStats.activeStreams--;
          res.writeHead(503, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Audio extraction failed. Try again.' }));
          return;
        }

        // Proxy the audio stream through our server (handles CORS)
        try {
          const audioUrlParsed = new URL(audioUrl);
          const proxyReq = https.request({
            hostname: audioUrlParsed.hostname,
            path: audioUrlParsed.pathname + audioUrlParsed.search,
            method: 'GET',
            agent: httpsAgent, // FIX 7: Use connection pooling
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Range': req.headers.range || 'bytes=0-',
            }
          }, (proxyRes) => {
            const headers = {
              ...corsHeaders,
              'Content-Type': contentType,
              'Accept-Ranges': 'bytes',
            };

            if (proxyRes.headers['content-length']) {
              headers['Content-Length'] = proxyRes.headers['content-length'];
            }
            if (proxyRes.headers['content-range']) {
              headers['Content-Range'] = proxyRes.headers['content-range'];
            }

            res.writeHead(proxyRes.statusCode, headers);
            proxyRes.pipe(res);

            proxyRes.on('end', () => {
              cacheStats.activeStreams--;
            });
          });

          proxyReq.on('error', (err) => {
            console.error('[CDN/Stream] Proxy error:', err);
            cacheStats.activeStreams--;
            if (!res.headersSent) {
              res.writeHead(500, corsHeaders);
              res.end(JSON.stringify({ error: 'Stream proxy failed' }));
            }
          });

          proxyReq.end();
        } catch (err) {
          cacheStats.activeStreams--;
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }

        return;
      }

      // VIDEO: Direct URL - proxy as normal (video formats work with proxy)
      const result = await getStreamUrl(youtubeId, type, quality);
      const streamUrl = result.url;
      // Parse the googlevideo URL
      const parsedStream = new URL(streamUrl);

      // Forward request to googlevideo with full range support
      const proxyReq = https.request({
        hostname: parsedStream.hostname,
        path: parsedStream.pathname + parsedStream.search,
        method: 'GET',
        agent: httpsAgent, // FIX 7: Use connection pooling
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Range': req.headers.range || 'bytes=0-',
        }
      }, (proxyRes) => {
        // Forward headers with CORS
        let contentType = 'audio/webm; codecs=opus';
        const origType = proxyRes.headers['content-type'] || '';
        if (origType.includes('mp4') || origType.includes('m4a')) contentType = 'audio/mp4';
        else if (origType.includes('mpeg') || origType.includes('mp3')) contentType = 'audio/mpeg';

        const headers = {
          ...corsHeaders,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        };

        // Forward Content-Length if present
        if (proxyRes.headers['content-length']) {
          headers['Content-Length'] = proxyRes.headers['content-length'];
        }

        // Forward Content-Range for partial content (206 responses)
        if (proxyRes.headers['content-range']) {
          headers['Content-Range'] = proxyRes.headers['content-range'];
        }

        // Use appropriate status code (206 for range requests, 200 for full)
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);

        // Track when stream ends
        proxyRes.on('end', () => {
          cacheStats.activeStreams--;
        });
      });

      proxyReq.on('error', (err) => {
        console.error('[CDN/Stream] Error:', err);
        cacheStats.activeStreams--;
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: getVoyoError('STREAM_UNAVAILABLE') }));
      });

      proxyReq.end();
    } catch (err) {
      console.error('[CDN/Stream] Error:', err);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: getVoyoError('STREAM_UNAVAILABLE') }));
    }
    return;
  }

  // ========================================
  // R2 AUDIO STREAMING ENDPOINTS
  // ========================================

  // Check if audio exists in R2
  if (pathname === '/r2/exists' && query.v) {
    if (!isValidYouTubeId(query.v)) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid video ID' }));
      return;
    }

    try {
      const quality = query.q === '64' ? '64' : '128';
      const exists = await checkR2Audio(query.v, quality);

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exists,
        trackId: query.v,
        quality,
        url: exists ? `${API_BASE}/r2/stream/${query.v}?q=${quality}` : null
      }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Stream audio from R2 (with YouTube fallback)
  if (pathname.startsWith('/r2/stream/')) {
    const trackId = pathname.split('/r2/stream/')[1];

    if (!isValidYouTubeId(trackId)) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid video ID' }));
      return;
    }

    try {
      const quality = query.q === '64' ? '64' : '128';

      // Check if exists in R2
      const existsInR2 = await checkR2Audio(trackId, quality);

      if (existsInR2) {
        // Stream directly from R2 - FAST!
        console.log(`[R2] 🚀 Serving from R2: ${trackId} (${quality}kbps)`);
        await streamR2Audio(trackId, quality, req, res);
        return;
      }

      // FALLBACK: Not in R2, redirect to YouTube proxy
      console.log(`[R2] Track ${trackId} not in R2, falling back to YouTube`);
      res.writeHead(302, {
        ...corsHeaders,
        'Location': `${API_BASE}/proxy?v=${trackId}&quality=high`
      });
      res.end();
    } catch (err) {
      console.error(`[R2] Error streaming ${trackId}:`, err.message);
      // On any error, fallback to YouTube
      res.writeHead(302, {
        ...corsHeaders,
        'Location': `${API_BASE}/proxy?v=${trackId}&quality=high`
      });
      res.end();
    }
    return;
  }

  // Get best stream URL (R2 first, then YouTube)
  if (pathname === '/r2/best' && query.v) {
    if (!isValidYouTubeId(query.v)) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid video ID' }));
      return;
    }

    try {
      const quality = query.q === '64' ? '64' : '128';
      const existsInR2 = await checkR2Audio(query.v, quality);

      if (existsInR2) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          source: 'r2',
          url: `${API_BASE}/r2/stream/${query.v}?q=${quality}`,
          trackId: query.v,
          quality: `${quality}kbps`,
          cached: true
        }));
      } else {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          source: 'youtube',
          url: `${API_BASE}/proxy?v=${query.v}&quality=high`,
          trackId: query.v,
          quality: 'high',
          cached: false
        }));
      }
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // R2 stats - how many tracks are cached
  if (pathname === '/r2/stats') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      cacheSize: r2Cache.size,
      feedCacheSize: r2FeedCache.size,
      bucket: R2_BUCKET,
      feedBucket: R2_FEED_BUCKET,
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      note: '41K+ pre-cached tracks in R2'
    }));
    return;
  }

  // ========================================
  // R2 FEED VIDEO STREAMING ENDPOINTS
  // ========================================

  // Check if feed video exists in R2
  if (pathname.match(/^\/r2\/feed\/[^/]+\/check$/)) {
    const sourceId = pathname.split('/r2/feed/')[1].replace('/check', '');

    if (!sourceId || sourceId.length > 100) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid source ID' }));
      return;
    }

    try {
      const result = await checkR2FeedVideo(sourceId);

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exists: result.exists,
        size: result.size,
        sourceId,
      }));
    } catch (err) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Stream feed video from R2
  if (pathname.match(/^\/r2\/feed\/[^/]+$/) && !pathname.endsWith('/check')) {
    const sourceId = pathname.split('/r2/feed/')[1];

    if (!sourceId || sourceId.length > 100) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid source ID' }));
      return;
    }

    try {
      const result = await checkR2FeedVideo(sourceId);

      if (!result.exists || !result.key) {
        console.log(`[R2/Feed] Video not found: ${sourceId}`);
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Video not found', sourceId }));
        return;
      }

      // Stream the video with range support
      await streamR2FeedVideo(result.key, req, res);
    } catch (err) {
      console.error(`[R2/Feed] Error streaming ${sourceId}:`, err.message);
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stream failed' }));
    }
    return;
  }

  // 404
  res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  // Ensure downloads directory exists
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  // Clear caches on startup to ensure fresh URLs
  streamCache.clear();
  thumbnailCache.clear();
  prefetchCache.clear();

  console.log(`🎵 VOYO Backend running on http://localhost:${PORT}`);
  console.log(`\n   🚀 PRODUCTION-GRADE STREAMING ACTIVE\n`);
  console.log(`   📊 MONITORING:`);
  console.log(`   - GET /health                        → Health check + cache metrics`);
  console.log(`   - GET /prefetch?v=ID&quality=LEVEL   → Warm up stream (202 async)`);
  console.log(`\n   🥷 STEALTH ENDPOINTS (VOYO IDs):`);
  console.log(`   - GET /cdn/stream/vyo_XXXXX?quality=LEVEL  → Stream audio (STEALTH)`);
  console.log(`   - GET /cdn/art/vyo_XXXXX                   → Album art (STEALTH)`);
  console.log(`   - GET /api/search?q=QUERY                  → Search with VOYO IDs`);
  console.log(`\n   🔧 LEGACY ENDPOINTS (YouTube IDs):`);
  console.log(`   - GET /proxy?v=ID&quality=LEVEL      → Stream audio/video`);
  console.log(`   - GET /stream?v=ID&quality=LEVEL     → Get raw stream URL`);
  console.log(`   - GET /search?q=QUERY                → Search YouTube`);
  console.log(`   - GET /thumbnail?id=VIDEO_ID         → Proxy thumbnails`);
  console.log(`\n   ☁️  R2 CLOUDFLARE STORAGE (41K+ cached tracks):`);
  console.log(`   - GET /r2/exists?v=ID&q=128|64       → Check if in R2`);
  console.log(`   - GET /r2/stream/VIDEO_ID?q=128|64   → Stream from R2 (fast!)`);
  console.log(`   - GET /r2/best?v=ID&q=128|64         → Best URL (R2 or YouTube)`);
  console.log(`   - GET /r2/stats                      → R2 cache stats`);
  console.log(`\n   🎬 R2 FEED VIDEO STREAMING (voyo-feed bucket):`);
  console.log(`   - GET /r2/feed/:sourceId              → Stream video from R2`);
  console.log(`   - GET /r2/feed/:sourceId/check        → Check if video exists`);
  console.log(`\n   💾 OFFLINE PLAYBACK:`);
  console.log(`   - GET /download?v=VIDEO_ID           → Download track`);
  console.log(`   - DELETE /download?v=VIDEO_ID        → Delete downloaded track`);
  console.log(`   - GET /downloaded                    → List downloaded IDs`);
  console.log(`   - GET /downloads/VIDEO_ID.mp3        → Serve downloaded file`);
  console.log(`\n   🎚️  QUALITY LEVELS: low (64kbps) | medium (128kbps) | high (best)`);
});
