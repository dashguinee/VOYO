/**
 * VOYO Music - Track Verifier Service
 *
 * SELF-HEALING LOOP:
 * When a thumbnail fails to load (hallucinated/invalid YouTube ID),
 * this service verifies the track via searchMusic() and updates it
 * with the real YouTube ID.
 *
 * Flow:
 * 1. SmartImage fails all fallbacks → calls verifyTrack(trackId, artist, title)
 * 2. We search backend for "artist title" → get VERIFIED voyoId
 * 3. Update track in pool/store with new ID
 * 4. Save to Central DB for future users
 * 5. Return new thumbnail URL
 *
 * SUCCESS METRIC: 0 placeholders, 0 lost tracks
 */

import { searchMusic } from './api';
import { saveVerifiedTrack } from './centralDJ';
import { useTrackPoolStore, PooledTrack } from '../store/trackPoolStore';
// Dynamic import to break circular dep (playerStore → personalization → trackVerifier → playerStore)
// import { usePlayerStore } from '../store/playerStore';
import { getThumb } from '../utils/thumbnail';
import { Track } from '../types';
import { devLog, devWarn } from '../utils/logger';

/**
 * Decode VOYO ID (vyo_...) to raw YouTube ID
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

// Flag to prevent multiple batch heals
let hasRunStartupHeal = false;

// Debounce/queue to avoid hammering API
const pendingVerifications = new Map<string, Promise<string | null>>();
const verificationResults = new Map<string, { voyoId: string; thumbnail: string; expiresAt: number } | null>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes for successful verifications
const FAILED_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for failed (don't hammer dead tracks)

// Track permanent failures (video deleted/private) - longer cache
const permanentFailures = new Map<string, { reason: string; failedAt: number }>();
const PERMANENT_FAILURE_TTL = 24 * 60 * 60 * 1000; // 24 hours for permanent failures

// Retry tracking - prevent infinite retry loops
const retryAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_RETRIES = 3;
const RETRY_COOLDOWN = 10 * 60 * 1000; // 10 minutes between retry sets

/**
 * Verify and fix a track with a failed thumbnail
 * Returns the new thumbnail URL if verification succeeds, null otherwise
 */
export async function verifyTrack(
  originalTrackId: string,
  artist: string,
  title: string
): Promise<string | null> {
  const cacheKey = `${artist}|${title}`.toLowerCase();
  const now = Date.now();

  // Check permanent failure cache first (video deleted/private)
  const permFailure = permanentFailures.get(originalTrackId);
  if (permFailure && (now - permFailure.failedAt) < PERMANENT_FAILURE_TTL) {
    devLog(`[TrackVerifier] ⛔ Permanent failure (${permFailure.reason}): ${artist} - ${title}`);
    return null;
  }

  // Check retry limits
  const retryInfo = retryAttempts.get(cacheKey);
  if (retryInfo) {
    const timeSinceLastAttempt = now - retryInfo.lastAttempt;
    if (retryInfo.count >= MAX_RETRIES && timeSinceLastAttempt < RETRY_COOLDOWN) {
      devLog(`[TrackVerifier] 🛑 Max retries (${MAX_RETRIES}) reached, cooling down: ${artist} - ${title}`);
      return null;
    }
    // Reset retry count if cooldown has passed
    if (timeSinceLastAttempt >= RETRY_COOLDOWN) {
      retryAttempts.delete(cacheKey);
    }
  }

  // Check cache (with expiry check)
  const cached = verificationResults.get(cacheKey);
  if (cached !== undefined) {
    if (cached === null) {
      devLog(`[TrackVerifier] ❌ Already failed: ${artist} - ${title}`);
      return null;
    }
    if (now < cached.expiresAt) {
      devLog(`[TrackVerifier] ✅ Cache hit: ${artist} - ${title}`);
      return cached.thumbnail;
    }
    // Cache expired, remove it
    verificationResults.delete(cacheKey);
  }

  // Check if already in progress
  const pending = pendingVerifications.get(cacheKey);
  if (pending) {
    devLog(`[TrackVerifier] ⏳ Already verifying: ${artist} - ${title}`);
    return pending;
  }

  // Update retry tracking
  const currentRetry = retryAttempts.get(cacheKey) || { count: 0, lastAttempt: 0 };
  retryAttempts.set(cacheKey, { count: currentRetry.count + 1, lastAttempt: now });

  // Start verification
  const verificationPromise = doVerification(originalTrackId, artist, title, cacheKey);
  pendingVerifications.set(cacheKey, verificationPromise);

  try {
    return await verificationPromise;
  } finally {
    pendingVerifications.delete(cacheKey);
  }
}

async function doVerification(
  originalTrackId: string,
  artist: string,
  title: string,
  cacheKey: string
): Promise<string | null> {
  devLog(`[TrackVerifier] 🔍 Verifying: ${artist} - ${title}`);

  try {
    // Clean up search query - remove duplicate artist from title
    let cleanTitle = title;
    const artistLower = artist.toLowerCase();

    // If title starts with artist name, remove it (e.g., "AK4SEVEN - MoF" → "MoF")
    if (cleanTitle.toLowerCase().startsWith(artistLower)) {
      cleanTitle = cleanTitle.slice(artist.length).replace(/^[\s\-–—:]+/, '').trim();
    }
    // Also check for "Artist feat." pattern at start
    if (cleanTitle.toLowerCase().startsWith(artistLower.split(' ')[0])) {
      const artistFirstWord = artist.split(' ')[0];
      if (cleanTitle.toLowerCase().startsWith(artistFirstWord.toLowerCase())) {
        // Check if it's "AK feat. X" pattern - keep it but search differently
        const featMatch = cleanTitle.match(/^[^-–—]+(?:feat\.?|ft\.?|featuring)[^-–—]+[-–—]\s*/i);
        if (featMatch) {
          cleanTitle = cleanTitle.slice(featMatch[0].length).trim();
        }
      }
    }

    const searchQuery = cleanTitle ? `${artist} ${cleanTitle}` : artist;
    devLog(`[TrackVerifier] 🔍 Search query: ${searchQuery}`);
    const results = await searchMusic(searchQuery, 3);

    if (results.length === 0) {
      devLog(`[TrackVerifier] ❌ No results for: ${searchQuery}`);
      verificationResults.set(cacheKey, null);

      // Clear cache after TTL
      setTimeout(() => verificationResults.delete(cacheKey), CACHE_TTL);
      return null;
    }

    // Use the best match
    const verified = results[0];
    const newThumbnail = verified.thumbnail || getThumb(verified.voyoId);

    devLog(`[TrackVerifier] ✅ Found: ${verified.artist} - ${verified.title}`);
    devLog(`[TrackVerifier]    Old ID: ${originalTrackId}`);
    devLog(`[TrackVerifier]    New ID: ${verified.voyoId}`);

    // Cache the result with expiry timestamp
    verificationResults.set(cacheKey, {
      voyoId: verified.voyoId,
      thumbnail: newThumbnail,
      expiresAt: Date.now() + CACHE_TTL,
    });

    // Reset retry count on success
    retryAttempts.delete(cacheKey);

    // Update track in pool store
    updateTrackInPool(originalTrackId, verified);

    // Update track in player store if it's the current track
    updateCurrentTrack(originalTrackId, verified);

    // Save to Central DB for future users
    saveToDatabase(verified, artist, title);

    return newThumbnail;

  } catch (error) {
    console.error(`[TrackVerifier] Error verifying ${artist} - ${title}:`, error);
    verificationResults.set(cacheKey, null);
    // Use longer TTL for failures to avoid hammering
    setTimeout(() => verificationResults.delete(cacheKey), FAILED_CACHE_TTL);
    return null;
  }
}

/**
 * Check if a track is playable via YouTube oEmbed API
 * Returns: { playable: true } or { playable: false, reason: string }
 */
export async function isTrackPlayable(trackId: string): Promise<{ playable: boolean; reason?: string }> {
  if (!trackId) return { playable: false, reason: 'no_track_id' };

  // Clean the track ID
  let ytId = trackId;
  if (ytId.startsWith('VOYO_')) ytId = ytId.replace('VOYO_', '');

  // Check permanent failure cache
  const permFailure = permanentFailures.get(trackId);
  if (permFailure && (Date.now() - permFailure.failedAt) < PERMANENT_FAILURE_TTL) {
    return { playable: false, reason: permFailure.reason };
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (response.ok) {
      return { playable: true };
    }

    // YouTube returns specific errors
    if (response.status === 401 || response.status === 403) {
      permanentFailures.set(trackId, { reason: 'private_or_removed', failedAt: Date.now() });
      return { playable: false, reason: 'private_or_removed' };
    }
    if (response.status === 404) {
      permanentFailures.set(trackId, { reason: 'video_not_found', failedAt: Date.now() });
      return { playable: false, reason: 'video_not_found' };
    }

    return { playable: false, reason: `http_${response.status}` };
  } catch (error) {
    // Network error - don't mark as permanent failure
    devWarn(`[TrackVerifier] Playability check failed for ${trackId}:`, error);
    return { playable: false, reason: 'network_error' };
  }
}

/**
 * Mark a track as permanently failed (called when YouTube player reports error)
 */
export function markTrackAsFailed(trackId: string, errorCode: number): void {
  let reason = 'unknown_error';

  // YouTube error codes: https://developers.google.com/youtube/iframe_api_reference#onError
  switch (errorCode) {
    case 2:
      reason = 'invalid_parameter';
      break;
    case 5:
      reason = 'html5_player_error';
      break;
    case 100:
      reason = 'video_not_found';
      permanentFailures.set(trackId, { reason, failedAt: Date.now() });
      break;
    case 101:
    case 150:
      reason = 'embedding_disabled';
      permanentFailures.set(trackId, { reason, failedAt: Date.now() });
      break;
    default:
      reason = `youtube_error_${errorCode}`;
  }

  devLog(`[TrackVerifier] ⛔ Marked as failed: ${trackId} (${reason})`);
}

/**
 * Update track in the hot pool with verified ID
 */
function updateTrackInPool(originalTrackId: string, verified: { voyoId: string; title: string; artist: string; thumbnail: string; duration: number }) {
  try {
    const poolStore = useTrackPoolStore.getState();
    const hotPool = poolStore.hotPool;

    // Find tracks with the original ID
    const tracksToUpdate = hotPool.filter(t =>
      t.trackId === originalTrackId ||
      t.id === originalTrackId ||
      t.id === `dj_${originalTrackId}`
    );

    for (const poolTrack of tracksToUpdate) {
      // Update the track in place
      poolTrack.trackId = verified.voyoId;
      poolTrack.coverUrl = verified.thumbnail;
      if (verified.duration) poolTrack.duration = verified.duration;

      devLog(`[TrackVerifier] 📦 Updated pool track: ${poolTrack.title}`);
    }
  } catch (error) {
    devWarn('[TrackVerifier] Could not update pool:', error);
  }
}

/**
 * Update current track if it matches the verified one
 */
async function updateCurrentTrack(originalTrackId: string, verified: { voyoId: string; title: string; artist: string; thumbnail: string; duration: number }) {
  try {
    const { usePlayerStore } = await import('../store/playerStore');
    const playerStore = usePlayerStore.getState();
    const currentTrack = playerStore.currentTrack;

    if (currentTrack && (currentTrack.trackId === originalTrackId || currentTrack.id === originalTrackId)) {
      // Create updated track
      const updatedTrack: Track = {
        ...currentTrack,
        trackId: verified.voyoId,
        coverUrl: verified.thumbnail,
        duration: verified.duration || currentTrack.duration,
      };

      // Update current track (this will trigger re-render with new thumbnail)
      playerStore.setCurrentTrack(updatedTrack);
      devLog(`[TrackVerifier] 🎵 Updated current track: ${currentTrack.title}`);
    }
  } catch (error) {
    devWarn('[TrackVerifier] Could not update current track:', error);
  }
}

/**
 * Save verified track to Central DB
 */
async function saveToDatabase(verified: { voyoId: string; title: string; artist: string; thumbnail: string; duration: number }, originalArtist: string, originalTitle: string) {
  try {
    const track: Track = {
      id: `verified_${verified.voyoId}`,
      title: verified.title || originalTitle,
      artist: verified.artist || originalArtist,
      album: 'Verified',
      trackId: verified.voyoId,
      coverUrl: verified.thumbnail,
      duration: verified.duration || 0,
      tags: ['verified', 'self-healed'],
      mood: 'afro',
      region: 'NG',
      oyeScore: 0,
      createdAt: new Date().toISOString(),
    };

    const saved = await saveVerifiedTrack(track, undefined, 'user_search');
    if (saved) {
      devLog(`[TrackVerifier] 💾 Saved to Central DB for future users!`);
    }
  } catch (error) {
    devWarn('[TrackVerifier] Could not save to Central DB:', error);
  }
}

/**
 * Clear verification cache (for testing)
 */
export function clearVerificationCache(): void {
  verificationResults.clear();
  pendingVerifications.clear();
  devLog('[TrackVerifier] Cache cleared');
}

// ============================================
// BATCH HEALER - One-time fix for all bad tracks
// ============================================

/**
 * Check if a thumbnail URL is valid (actually loads)
 */
async function isThumbnailValid(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
    // Timeout after 5 seconds
    setTimeout(() => resolve(false), 5000);
  });
}

/**
 * CONTENT MATCH CHECK - Verify video content matches expected track
 * Uses YouTube oEmbed API to get actual video title and check similarity
 */
async function verifyContentMatch(
  trackId: string,
  expectedArtist: string,
  expectedTitle: string
): Promise<{ valid: boolean; actualTitle?: string }> {
  // CRITICAL: Decode VOYO ID to YouTube ID for oembed API
  const ytId = decodeVoyoId(trackId);

  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`
    );

    if (!response.ok) {
      // Video doesn't exist
      return { valid: false };
    }

    const data = await response.json();
    const actualTitle = (data.title || '').toLowerCase();
    const expectedArtistLower = expectedArtist.toLowerCase();
    const expectedTitleLower = expectedTitle.toLowerCase();

    // Check if actual video title contains artist OR track title
    const hasArtist = expectedArtistLower.split(/[,&]/).some(part =>
      actualTitle.includes(part.trim().split(' ')[0]) // First word of artist name
    );
    const hasTitle = expectedTitleLower.split(/[|()\[\]]/).some(part =>
      part.trim().length > 2 && actualTitle.includes(part.trim())
    );

    const isMatch = hasArtist || hasTitle;

    if (!isMatch) {
      devLog(`[TrackVerifier] ❌ CONTENT MISMATCH:`);
      devLog(`   Expected: ${expectedArtist} - ${expectedTitle}`);
      devLog(`   Actual: ${data.title}`);
    }

    return { valid: isMatch, actualTitle: data.title };
  } catch (error) {
    devWarn(`[TrackVerifier] Could not verify content for ${trackId}:`, error);
    return { valid: true }; // Assume valid if we can't check
  }
}

/**
 * BATCH HEAL - Fix ALL tracks with bad thumbnails
 * Run once to ensure no user ever sees a placeholder
 *
 * Returns: { healed: number, failed: string[], total: number }
 */
export async function batchHealTracks(): Promise<{
  healed: number;
  failed: string[];
  total: number;
  skipped: number;
}> {
  devLog('[TrackVerifier] 🔧 BATCH HEAL STARTED...');

  const poolStore = useTrackPoolStore.getState();
  const hotPool = poolStore.hotPool;

  let healed = 0;
  let skipped = 0;
  const failed: string[] = [];

  devLog(`[TrackVerifier] 📊 Checking ${hotPool.length} tracks in pool...`);

  for (const track of hotPool) {
    const thumbnailUrl = getThumb(track.trackId);

    // Check if thumbnail is valid
    const thumbnailValid = await isThumbnailValid(thumbnailUrl);

    if (thumbnailValid) {
      // Thumbnail works, but check content match too
      const contentCheck = await verifyContentMatch(track.trackId, track.artist, track.title);
      if (contentCheck.valid) {
        skipped++;
        continue; // Both valid, skip
      }
      devLog(`[TrackVerifier] ⚠️ CONTENT MISMATCH: ${track.artist} - ${track.title}`);
      devLog(`[TrackVerifier]    Actual video: ${contentCheck.actualTitle}`);
    } else {
      devLog(`[TrackVerifier] ❌ Bad thumbnail: ${track.artist} - ${track.title}`);
    }

    // Try to heal
    const result = await verifyTrack(track.trackId, track.artist, track.title);

    if (result) {
      healed++;
      devLog(`[TrackVerifier] ✅ Healed: ${track.artist} - ${track.title}`);
    } else {
      failed.push(`${track.artist} - ${track.title}`);
      devLog(`[TrackVerifier] ⚠️ Could not heal: ${track.artist} - ${track.title}`);
    }

    // Small delay to avoid hammering API
    await new Promise(r => setTimeout(r, 300));
  }

  devLog(`[TrackVerifier] 🎉 BATCH HEAL COMPLETE`);
  devLog(`[TrackVerifier]    Total: ${hotPool.length}`);
  devLog(`[TrackVerifier]    Valid: ${skipped}`);
  devLog(`[TrackVerifier]    Healed: ${healed}`);
  devLog(`[TrackVerifier]    Failed: ${failed.length}`);

  return { healed, failed, total: hotPool.length, skipped };
}

/**
 * Pre-validate a track BEFORE it enters the pool
 * Call this when adding tracks from any source
 * Now includes CONTENT MATCH verification!
 */
export async function validateBeforePool(
  trackId: string,
  artist: string,
  title: string
): Promise<{ valid: boolean; verifiedId?: string; thumbnail?: string; mismatch?: string }> {
  const thumbnailUrl = getThumb(trackId);
  const thumbnailValid = await isThumbnailValid(thumbnailUrl);

  if (!thumbnailValid) {
    // Thumbnail doesn't load, definitely need to verify
    devLog(`[TrackVerifier] 🔍 Thumbnail failed, verifying: ${artist} - ${title}`);
    return await findCorrectTrack(artist, title);
  }

  // Thumbnail loads, but does CONTENT match?
  const contentCheck = await verifyContentMatch(trackId, artist, title);

  if (!contentCheck.valid) {
    // CONTENT MISMATCH! Wrong video ID (like Gobe → Fleetwood Mac)
    devLog(`[TrackVerifier] ⚠️ CONTENT MISMATCH detected for: ${artist} - ${title}`);
    devLog(`[TrackVerifier]    Video is actually: ${contentCheck.actualTitle}`);
    return await findCorrectTrack(artist, title, contentCheck.actualTitle);
  }

  // Both thumbnail and content are valid
  return { valid: true };
}

/**
 * Helper to find the correct track via search
 */
async function findCorrectTrack(
  artist: string,
  title: string,
  mismatchedTitle?: string
): Promise<{ valid: boolean; verifiedId?: string; thumbnail?: string; mismatch?: string }> {
  try {
    const results = await searchMusic(`${artist} ${title}`, 3);

    if (results.length > 0) {
      const verified = results[0];
      devLog(`[TrackVerifier] ✅ Found correct: ${verified.artist} - ${verified.title}`);
      return {
        valid: true,
        verifiedId: verified.voyoId,
        thumbnail: verified.thumbnail,
        mismatch: mismatchedTitle,
      };
    }
  } catch (error) {
    devWarn(`[TrackVerifier] Search failed for ${artist} - ${title}`);
  }

  return { valid: false, mismatch: mismatchedTitle };
}

/**
 * SAFE ADD TO POOL - Validates before adding
 * Use this instead of addToPool directly to ensure no bad tracks enter
 */
export async function safeAddToPool(
  track: Track,
  source: PooledTrack['source']
): Promise<boolean> {
  const validation = await validateBeforePool(track.trackId, track.artist, track.title);

  if (!validation.valid) {
    devWarn(`[TrackVerifier] ❌ Rejected invalid track: ${track.artist} - ${track.title}`);
    return false;
  }

  // Update track with verified ID if different
  const finalTrack = validation.verifiedId ? {
    ...track,
    trackId: validation.verifiedId,
    coverUrl: validation.thumbnail || track.coverUrl,
  } : track;

  // Add to pool
  useTrackPoolStore.getState().addToPool(finalTrack, source);
  return true;
}

/**
 * SAFE ADD MANY TO POOL - Validates each track before adding
 * Use this instead of addManyToPool directly
 */
export async function safeAddManyToPool(
  tracks: Track[],
  source: PooledTrack['source']
): Promise<number> {
  let added = 0;
  for (const track of tracks) {
    const wasAdded = await safeAddToPool(track, source);
    if (wasAdded) added++;
  }
  return added;
}

/**
 * RUN AT APP STARTUP - Heal any existing bad tracks
 * Called once when app initializes
 */
export async function runStartupHeal(): Promise<void> {
  if (hasRunStartupHeal) {
    devLog('[TrackVerifier] Startup heal already ran');
    return;
  }

  hasRunStartupHeal = true;

  // Wait a bit for app to stabilize
  await new Promise(r => setTimeout(r, 2000));

  const poolStore = useTrackPoolStore.getState();

  if (poolStore.hotPool.length === 0) {
    devLog('[TrackVerifier] No tracks in pool, skipping startup heal');
    return;
  }

  devLog('[TrackVerifier] 🚀 Running startup heal...');

  // Run batch heal in background
  batchHealTracks().then(result => {
    if (result.healed > 0) {
      devLog(`[TrackVerifier] ✅ Startup heal fixed ${result.healed} tracks`);
    }
    if (result.failed.length > 0) {
      devWarn(`[TrackVerifier] ⚠️ Could not heal ${result.failed.length} tracks`);
    }
  }).catch(err => {
    console.error('[TrackVerifier] Startup heal error:', err);
  });
}

/**
 * Check if a track is known to be unplayable (from permanent failure cache)
 */
export function isKnownUnplayable(trackId: string): boolean {
  if (!trackId) return false;
  const permFailure = permanentFailures.get(trackId);
  if (!permFailure) return false;
  return (Date.now() - permFailure.failedAt) < PERMANENT_FAILURE_TTL;
}

/**
 * Remove a track from permanent failure cache (for manual retry)
 */
export function clearFailure(trackId: string): void {
  permanentFailures.delete(trackId);
  devLog(`[TrackVerifier] Cleared failure for: ${trackId}`);
}

/**
 * Get verification stats for debugging
 */
export function getVerificationStats(): {
  cachedResults: number;
  pendingVerifications: number;
  permanentFailures: number;
  retryTracking: number;
} {
  return {
    cachedResults: verificationResults.size,
    pendingVerifications: pendingVerifications.size,
    permanentFailures: permanentFailures.size,
    retryTracking: retryAttempts.size,
  };
}

// Debug helper
if (typeof window !== 'undefined') {
  (window as any).trackVerifier = {
    verify: verifyTrack,
    batchHeal: batchHealTracks,
    safeAdd: safeAddToPool,
    safeAddMany: safeAddManyToPool,
    validateBeforePool,
    runStartupHeal,
    clearCache: clearVerificationCache,
    isPlayable: isTrackPlayable,
    isKnownUnplayable,
    markFailed: markTrackAsFailed,
    clearFailure,
    stats: getVerificationStats,
    getPending: () => Array.from(pendingVerifications.keys()),
    getCached: () => Array.from(verificationResults.entries()),
    getFailures: () => Array.from(permanentFailures.entries()),
  };
  devLog('🔧 [TrackVerifier] Debug commands:');
  devLog('   window.trackVerifier.batchHeal()  - Fix ALL bad thumbnails NOW');
  devLog('   window.trackVerifier.verify(id, artist, title)  - Fix single track');
  devLog('   window.trackVerifier.stats()  - Get verification statistics');
  devLog('   window.trackVerifier.getFailures()  - List permanently failed tracks');
}

export default {
  verifyTrack,
  batchHealTracks,
  safeAddToPool,
  safeAddManyToPool,
  validateBeforePool,
  runStartupHeal,
  clearVerificationCache,
  isTrackPlayable,
  markTrackAsFailed,
  isKnownUnplayable,
  clearFailure,
  getVerificationStats,
};
