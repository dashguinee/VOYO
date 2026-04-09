/**
 * VOYO Music - Pool Curator Service
 *
 * CLEAN ARCHITECTURE:
 * Session tracking → Smart queries → Our backend search → Pool
 *
 * No Gemini (API expired), No Piped (500 errors)
 * Just our backend which returns VERIFIED working VOYO IDs
 */

import { Track } from '../types';
import { searchMusic, SearchResult } from './api';
import { useTrackPoolStore } from '../store/trackPoolStore';
import { getThumb } from '../utils/thumbnail';
import { safeAddToPool } from './trackVerifier';

// Curator Configuration
const CURATOR_TRIGGER_TRACKS = 5;  // Curate after every 5 tracks
const CURATOR_MIN_INTERVAL = 60000; // Minimum 1 minute between curations
const TRACKS_PER_SEARCH = 10;

// ============================================
// TYPES
// ============================================

interface TrackHistory {
  track: Track;
  playedAt: number;
  completionRate: number;
  wasSkipped: boolean;
  hadReaction: boolean;
}

interface ListeningSession {
  tracks: TrackHistory[];
  startTime: number;
  skipCount: number;
  reactionCount: number;
}

// ============================================
// SESSION STATE
// ============================================

let currentSession: ListeningSession = {
  tracks: [],
  startTime: Date.now(),
  skipCount: 0,
  reactionCount: 0,
};

let lastCurationTime = 0;
let isBootstrapped = false;

// ============================================
// BOOTSTRAP - Fresh start with working tracks
// ============================================

// General trending queries (exported for VoyoFeed discovery)
export const TRENDING_QUERIES = [
  'Burna Boy 2024',
  'Asake latest',
  'Wizkid hits',
  'Ayra Starr',
  'Rema afrobeats',
  'Davido songs',
  'Amapiano 2024 hits',
  'Tyla water',
];

// SECTION: West African Hits - Regional artists (exported for VoyoFeed discovery)
export const WEST_AFRICAN_QUERIES = [
  'Nigerian afrobeats hits',
  'Ghana highlife music',
  'Senegalese mbalax music',
  'Wizkid Essence',
  'Burna Boy Last Last',
  'Davido Fall',
  'Fireboy DML Peru',
  'Rema Calm Down',
  'Omah Lay songs',
  'CKay Love Nwantiti',
  'Aya Nakamura Djadja',
  'Master KG Jerusalema',
];

// SECTION: All Time Classics - Timeless African hits (exported for VoyoFeed discovery)
export const CLASSICS_QUERIES = [
  'Fela Kuti best songs',
  'Youssou N\'Dour classics',
  'Angelique Kidjo songs',
  'King Sunny Ade music',
  'Miriam Makeba songs',
  'Oliver De Coque',
  'Ebenezer Obey',
  'Salif Keita music',
  'Franco TPOK Jazz',
  'Brenda Fassie hits',
  '90s African music',
  '2000s Naija throwback',
  'African legends music',
];

// Combined for bootstrap - mix of all sections
const BOOTSTRAP_QUERIES = [
  ...TRENDING_QUERIES.slice(0, 4),
  ...WEST_AFRICAN_QUERIES.slice(0, 4),
  ...CLASSICS_QUERIES.slice(0, 4),
];

/**
 * Clear stale pool data (bad IDs from old seed tracks)
 */
export function clearStalePool(): void {
  // Clear the persisted pool in localStorage
  localStorage.removeItem('voyo-track-pool');
  console.log('[Pool Curator] 🗑️ Cleared stale pool data');
}

/**
 * SEED POOL - Instant, no API calls
 * Seeds pool from static TRACKS data so app has content immediately
 * DJ then expands with searches as user plays
 */
export async function seedPool(): Promise<number> {
  const { TRACKS } = await import('../data/tracks');
  const poolStore = useTrackPoolStore.getState();

  console.log('[Pool Curator] 🌱 Seeding pool from static data...');

  let added = 0;
  for (const track of TRACKS) {
    // Tag tracks for sections
    const tags = [...(track.tags || [])];

    // Auto-tag for sections based on content
    const lower = ((track.title || '') + ' ' + (track.artist || '')).toLowerCase();
    if (lower.includes('classic') || track.oyeScore > 50000) {
      tags.push('classic');
    }
    if (['burna', 'wizkid', 'davido', 'asake', 'rema', 'ayra', 'tems', 'ckay', 'fireboy', 'omah'].some(a => lower.includes(a))) {
      tags.push('west-african');
    }

    const seededTrack = {
      ...track,
      tags,
    };

    poolStore.addToPool(seededTrack, 'seed');
    added++;
  }

  console.log(`[Pool Curator] 🌱 Seeded ${added} tracks from static data`);
  triggerRecommendationRefresh();

  return added;
}

/**
 * Bootstrap the pool with fresh, verified tracks from our backend
 */
export async function bootstrapPool(forceFresh: boolean = false): Promise<number> {
  if (isBootstrapped && !forceFresh) {
    console.log('[Pool Curator] Already bootstrapped');
    return 0;
  }

  // If forcing fresh, clear the old pool first
  if (forceFresh) {
    clearStalePool();
  }

  console.log('[Pool Curator] 🚀 Bootstrapping pool with fresh tracks...');

  const poolStore = useTrackPoolStore.getState();
  let totalAdded = 0;

  // Shuffle queries and take first 5 for variety
  const shuffledQueries = [...BOOTSTRAP_QUERIES].sort(() => Math.random() - 0.5).slice(0, 5);

  for (const query of shuffledQueries) {
    try {
      const results = await searchMusic(query, TRACKS_PER_SEARCH);
      const tracks = results.map(r => searchResultToTrack(r));

      // GATE: Validate each track BEFORE adding to pool
      let addedFromQuery = 0;
      for (const track of tracks) {
        const added = await safeAddToPool(track, 'trending');
        if (added) addedFromQuery++;
      }

      totalAdded += addedFromQuery;
      console.log(`[Pool Curator] ✅ "${query}" → ${addedFromQuery}/${tracks.length} tracks (validated)`);

      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      console.warn(`[Pool Curator] Query failed: "${query}"`, error);
    }
  }

  isBootstrapped = true;
  console.log(`[Pool Curator] 🎉 Bootstrap complete: ${totalAdded} fresh tracks in pool`);

  // Trigger recommendation refresh
  triggerRecommendationRefresh();

  return totalAdded;
}

/**
 * Force re-bootstrap (clears flag)
 */
export async function forceBootstrap(): Promise<number> {
  isBootstrapped = false;
  return bootstrapPool();
}

// ============================================
// SEARCH RESULT → TRACK CONVERSION
// ============================================

function searchResultToTrack(result: SearchResult, sectionTag?: string): Track {
  const tags = inferTags(result.title, result.artist);
  if (sectionTag) tags.push(sectionTag);

  return {
    id: result.voyoId,
    title: result.title,
    artist: result.artist,
    album: 'VOYO',
    trackId: result.voyoId,
    coverUrl: result.thumbnail || getThumb(result.voyoId),
    duration: result.duration,
    tags,
    mood: inferMood(result.title),
    region: inferRegion(result.artist),
    oyeScore: result.views || 0,
    createdAt: new Date().toISOString(),
  };
}

function inferTags(title: string, artist: string): string[] {
  const tags: string[] = [];
  const lower = ((title || '') + ' ' + (artist || '')).toLowerCase();

  if (lower.includes('amapiano') || lower.includes('piano')) tags.push('amapiano');
  if (lower.includes('afrobeat')) tags.push('afrobeats');
  if (lower.includes('dancehall')) tags.push('dancehall');
  if (lower.includes('rnb') || lower.includes('r&b')) tags.push('rnb');
  if (lower.includes('love') || lower.includes('heart')) tags.push('love');
  if (lower.includes('party') || lower.includes('club')) tags.push('party');

  // Default
  if (tags.length === 0) tags.push('afrobeats');

  return tags;
}

function inferMood(title: string): 'afro' | 'hype' | 'chill' | 'rnb' {
  const lower = (title || '').toLowerCase();
  if (lower.includes('party') || lower.includes('dance')) return 'hype';
  if (lower.includes('love') || lower.includes('heart')) return 'rnb';
  if (lower.includes('chill') || lower.includes('relax')) return 'chill';
  return 'afro';
}

function inferRegion(artist: string): string {
  const lower = (artist || '').toLowerCase();
  if (lower.includes('burna') || lower.includes('wizkid') || lower.includes('davido') || lower.includes('asake')) return 'NG';
  if (lower.includes('tyla') || lower.includes('kabza') || lower.includes('maphorisa')) return 'ZA';
  if (lower.includes('stonebwoy') || lower.includes('sarkodie')) return 'GH';
  return 'NG';
}

// ============================================
// SESSION TRACKING
// ============================================

/**
 * Record a track play in the current session
 */
export function recordTrackInSession(
  track: Track,
  completionRate: number = 100,
  wasSkipped: boolean = false,
  hadReaction: boolean = false
): void {
  currentSession.tracks.push({
    track,
    playedAt: Date.now(),
    completionRate,
    wasSkipped,
    hadReaction,
  });

  if (wasSkipped) currentSession.skipCount++;
  if (hadReaction) currentSession.reactionCount++;

  // Keep only last 10
  if (currentSession.tracks.length > 10) {
    currentSession.tracks = currentSession.tracks.slice(-10);
  }

  console.log(`[Pool Curator] Session: ${currentSession.tracks.length} tracks`);

  // Check if we should expand the pool
  checkCurationTrigger();
}

/**
 * Check if we should trigger pool expansion
 */
async function checkCurationTrigger(): Promise<void> {
  const now = Date.now();
  const timeSinceLastCuration = now - lastCurationTime;

  if (currentSession.tracks.length >= CURATOR_TRIGGER_TRACKS && timeSinceLastCuration >= CURATOR_MIN_INTERVAL) {
    await expandPool();
  }
}

// ============================================
// SMART POOL EXPANSION
// ============================================

/**
 * Expand pool based on current listening patterns
 */
export async function expandPool(): Promise<number> {
  lastCurationTime = Date.now();

  // Build smart queries based on recent tracks
  const queries = buildSmartQueries();

  console.log('[Pool Curator] 🔄 Expanding pool with:', queries);

  const poolStore = useTrackPoolStore.getState();
  let totalAdded = 0;

  for (const query of queries) {
    try {
      const results = await searchMusic(query, TRACKS_PER_SEARCH);
      const tracks = results.map(r => searchResultToTrack(r));

      // GATE: Validate each track BEFORE adding to pool
      for (const track of tracks) {
        const added = await safeAddToPool(track, 'related');
        if (added) totalAdded++;
      }
    } catch (error) {
      console.warn(`[Pool Curator] Expansion query failed: "${query}"`);
    }
  }

  console.log(`[Pool Curator] ✅ Expanded pool with ${totalAdded} validated tracks`);

  triggerRecommendationRefresh();

  return totalAdded;
}

/**
 * Build smart queries based on listening session
 */
function buildSmartQueries(): string[] {
  const queries: string[] = [];
  const recentTracks = currentSession.tracks.slice(-5);

  if (recentTracks.length === 0) {
    return ['afrobeats trending 2024'];
  }

  // Get unique artists from recent tracks
  const artists = [...new Set(recentTracks.map(h => h.track.artist))];

  // Get loved tracks (had reaction or high completion)
  const lovedTracks = recentTracks.filter(h => h.hadReaction || h.completionRate > 80);

  // Query 1: More from favorite artist
  if (lovedTracks.length > 0) {
    queries.push(`${lovedTracks[0].track.artist} songs`);
  } else if (artists.length > 0) {
    queries.push(`${artists[0]} latest`);
  }

  // Query 2: Related artist or genre
  const lastTrack = recentTracks[recentTracks.length - 1]?.track;
  if (lastTrack) {
    const tags = lastTrack.tags || [];
    if (tags.includes('amapiano')) {
      queries.push('amapiano hits 2024');
    } else if (tags.includes('rnb')) {
      queries.push('afro rnb songs');
    } else {
      queries.push('afrobeats trending');
    }
  }

  // Query 3: Discovery - similar but new
  if (artists.length > 0) {
    queries.push(`artists like ${artists[0]}`);
  }

  return queries.slice(0, 3); // Max 3 queries
}

// ============================================
// HELPERS
// ============================================

function triggerRecommendationRefresh(): void {
  import('../store/playerStore').then(({ usePlayerStore }) => {
    usePlayerStore.getState().refreshRecommendations?.();
  }).catch(() => {});
}

/**
 * SECTION-AWARE CURATION
 * DJ actively fills specific sections with fresh content
 */
export async function curateSection(section: 'west-african' | 'classics' | 'trending'): Promise<number> {
  const queries = section === 'west-african' ? WEST_AFRICAN_QUERIES
    : section === 'classics' ? CLASSICS_QUERIES
    : TRENDING_QUERIES;

  const sectionTag = section === 'west-african' ? 'west-african'
    : section === 'classics' ? 'classic'
    : 'trending';

  console.log(`[Pool Curator] 🎯 Curating "${section}" section...`);

  let totalAdded = 0;

  // Pick 5 random queries from the section
  const shuffled = [...queries].sort(() => Math.random() - 0.5).slice(0, 5);

  for (const query of shuffled) {
    try {
      const results = await searchMusic(query, TRACKS_PER_SEARCH);
      const tracks = results.map(r => searchResultToTrack(r, sectionTag));

      for (const track of tracks) {
        const added = await safeAddToPool(track, 'trending');
        if (added) totalAdded++;
      }

      console.log(`[Pool Curator] ✅ "${query}" → added tracks`);
      await new Promise(r => setTimeout(r, 300));
    } catch (error) {
      console.warn(`[Pool Curator] Section query failed: "${query}"`);
    }
  }

  console.log(`[Pool Curator] 🎉 "${section}" section: ${totalAdded} fresh tracks`);
  triggerRecommendationRefresh();

  return totalAdded;
}

/**
 * Curate ALL sections (called on app load for fresh content)
 */
export async function curateAllSections(): Promise<void> {
  console.log('[Pool Curator] 🚀 Curating all sections...');

  await curateSection('west-african');
  await curateSection('classics');
  await curateSection('trending');

  console.log('[Pool Curator] ✅ All sections curated');
}

/**
 * Reset session
 */
export function resetSession(): void {
  currentSession = {
    tracks: [],
    startTime: Date.now(),
    skipCount: 0,
    reactionCount: 0,
  };
}

/**
 * Get session stats
 */
export function getSessionStats() {
  return {
    trackCount: currentSession.tracks.length,
    skipCount: currentSession.skipCount,
    reactionCount: currentSession.reactionCount,
    isBootstrapped,
    lastCurationTime,
  };
}

// ============================================
// AUTO-BOOTSTRAP ON IMPORT
// ============================================

// On load: Seed pool first (instant), then expand with searches
setTimeout(async () => {
  const poolStore = useTrackPoolStore.getState();
  const stats = poolStore.getPoolStats();

  // If pool is empty or very small, seed it first
  if (stats.hot < 10) {
    console.log(`[Pool Curator] Pool empty/small (${stats.hot}), seeding...`);
    await seedPool();
  }

  // Check again after seed
  const newStats = poolStore.getPoolStats();
  if (newStats.hot < 30) {
    console.log(`[Pool Curator] Pool has ${newStats.hot} tracks, expanding with searches...`);
    bootstrapPool(); // This does API searches to add more variety
  } else {
    console.log(`[Pool Curator] Pool has ${newStats.hot} tracks, ready`);
    isBootstrapped = true;
  }
}, 1500);

// ============================================
// DEBUG HELPERS (available in browser console)
// ============================================

if (typeof window !== 'undefined') {
  (window as any).voyoPool = {
    seed: seedPool,
    bootstrap: () => bootstrapPool(false),
    forceBootstrap: () => bootstrapPool(true),
    clearStale: clearStalePool,
    expand: expandPool,
    stats: getSessionStats,
    reset: resetSession,
    // Section-aware curation
    curateWestAfrican: () => curateSection('west-african'),
    curateClassics: () => curateSection('classics'),
    curateTrending: () => curateSection('trending'),
    curateAll: curateAllSections,
  };
  console.log('🎵 [Pool Curator] Debug: voyoPool.seed() / .curateAll() / .curateClassics()');
}

export default {
  seedPool,
  bootstrapPool,
  forceBootstrap,
  clearStalePool,
  expandPool,
  recordTrackInSession,
  resetSession,
  getSessionStats,
  curateSection,
  curateAllSections,
};
