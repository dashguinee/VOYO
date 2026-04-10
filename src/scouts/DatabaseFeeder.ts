/**
 * VOYO Database Feeder
 *
 * Connects Hungry Scouts to Supabase.
 * Scouts discover → Feeder syncs to collective database.
 * Everyone benefits from the knowledge.
 */

import { videoIntelligenceAPI } from '../lib/supabase';
import { TrackKnowledge, useKnowledgeStore } from '../knowledge/KnowledgeStore';
import { scoutManager, unleashScouts, classifyTrack, SCOUT_CONFIGS } from './HungryScouts';
import { PrimaryMood, AfricanGenre, AfricanRegion } from '../knowledge/MoodTags';
import { devLog, devWarn } from '../utils/logger';

// ============================================
// FEED TO SUPABASE
// ============================================

/**
 * Convert TrackKnowledge to VideoIntelligence format and sync to Supabase
 */
export async function feedTrackToDatabase(track: TrackKnowledge): Promise<boolean> {
  try {
    const success = await videoIntelligenceAPI.sync({
      youtube_id: track.id,
      title: track.title,
      artist: track.artistName,
      thumbnail_url: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,
      genres: track.genre ? [track.genre] : [],
      moods: [track.primaryMood, ...track.feelings.slice(0, 3)],
      region: track.region || null,
      discovered_by: 'hungry-scout',
      discovery_method: 'api_search',
    });

    if (success) {
      devLog(`[Feeder] Fed to DB: ${track.artistName} - ${track.title}`);
    }
    return success;
  } catch (error) {
    devWarn(`[Feeder] Failed to feed: ${track.id}`, error);
    return false;
  }
}

/**
 * Batch feed multiple tracks to Supabase
 */
export async function feedTracksToDatabase(tracks: TrackKnowledge[]): Promise<number> {
  if (tracks.length === 0) return 0;

  const videos = tracks.map(track => ({
    youtube_id: track.id,
    title: track.title,
    artist: track.artistName,
    thumbnail_url: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,
    genres: track.genre ? [track.genre] : [],
    moods: [track.primaryMood, ...track.feelings.slice(0, 3)],
    region: track.region || null,
    discovered_by: 'hungry-scout',
    discovery_method: 'api_search' as const,
  }));

  const count = await videoIntelligenceAPI.batchSync(videos);
  devLog(`[Feeder] Batch fed ${count} tracks to Supabase`);
  return count;
}

// ============================================
// UNLEASH AND FEED
// ============================================

/**
 * Run all hungry scouts and feed everything to the database
 * This is the main function to populate the collective brain
 */
export async function unleashAndFeed(): Promise<{
  tracksDiscovered: number;
  tracksFed: number;
  scoutsRun: number;
}> {
  devLog('[Feeder] UNLEASHING HUNGRY SCOUTS...');
  devLog('[Feeder] They will discover African music and feed the collective brain!');

  const startTime = Date.now();
  let totalDiscovered = 0;
  let totalFed = 0;
  let scoutsRun = 0;

  // Run scouts in batches to avoid rate limits
  const scouts = scoutManager.getAllScouts();
  const batchSize = 3;

  for (let i = 0; i < scouts.length; i += batchSize) {
    const batch = scouts.slice(i, i + batchSize);
    devLog(`[Feeder] Running batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(scouts.length / batchSize)}...`);

    const results = await Promise.all(batch.map(async (scout) => {
      try {
        const tracks = await scout.hunt();
        scoutsRun++;

        // Feed to database
        if (tracks.length > 0) {
          const fed = await feedTracksToDatabase(tracks);
          return { discovered: tracks.length, fed };
        }
        return { discovered: 0, fed: 0 };
      } catch (error) {
        devWarn(`[Feeder] Scout ${scout.config.name} failed:`, error);
        return { discovered: 0, fed: 0 };
      }
    }));

    results.forEach(r => {
      totalDiscovered += r.discovered;
      totalFed += r.fed;
    });

    // Small delay between batches to be nice to APIs
    if (i + batchSize < scouts.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  devLog(`[Feeder] COMPLETE in ${duration}s`);
  devLog(`[Feeder] Scouts run: ${scoutsRun}`);
  devLog(`[Feeder] Tracks discovered: ${totalDiscovered}`);
  devLog(`[Feeder] Tracks fed to DB: ${totalFed}`);

  return { tracksDiscovered: totalDiscovered, tracksFed: totalFed, scoutsRun };
}

/**
 * Run priority scouts only (faster, for regular feeding)
 */
export async function feedPriorityScouts(): Promise<{
  tracksDiscovered: number;
  tracksFed: number;
}> {
  devLog('[Feeder] Running priority scouts...');

  const priorityScouts = scoutManager.getAllScouts()
    .filter(s => s.config.priority >= 8);

  let totalDiscovered = 0;
  let totalFed = 0;

  const results = await Promise.all(priorityScouts.map(async (scout) => {
    try {
      const tracks = await scout.hunt();
      if (tracks.length > 0) {
        const fed = await feedTracksToDatabase(tracks);
        return { discovered: tracks.length, fed };
      }
      return { discovered: 0, fed: 0 };
    } catch {
      return { discovered: 0, fed: 0 };
    }
  }));

  results.forEach(r => {
    totalDiscovered += r.discovered;
    totalFed += r.fed;
  });

  devLog(`[Feeder] Priority run: ${totalDiscovered} discovered, ${totalFed} fed`);
  return { tracksDiscovered: totalDiscovered, tracksFed: totalFed };
}

// ============================================
// SYNC EXISTING KNOWLEDGE TO DATABASE
// ============================================

/**
 * Sync all existing knowledge to Supabase
 * Use this to push local knowledge to the collective
 */
export async function syncKnowledgeToDatabase(): Promise<number> {
  const store = useKnowledgeStore.getState();
  const tracks = Array.from(store.tracks.values());

  if (tracks.length === 0) {
    devLog('[Feeder] No local knowledge to sync');
    return 0;
  }

  devLog(`[Feeder] Syncing ${tracks.length} tracks from local knowledge...`);
  const fed = await feedTracksToDatabase(tracks);
  devLog(`[Feeder] Synced ${fed} tracks to Supabase`);
  return fed;
}

// ============================================
// GET DATABASE STATS
// ============================================

export async function getDatabaseStats(): Promise<{
  totalVideos: number;
  totalPlays: number;
  recentDiscoveries: number;
}> {
  return videoIntelligenceAPI.getStats();
}

// ============================================
// VOYO API - Use our own backend
// ============================================

const VOYO_API = 'https://voyo-edge.dash-webtv.workers.dev';

// ============================================
// MANUAL SEARCH AND FEED
// ============================================

/**
 * Search for music via VOYO backend and feed results to database
 * Uses our own Fly.io backend with yt-dlp
 */
export async function searchAndFeed(query: string, limit: number = 15): Promise<number> {
  devLog(`[Feeder] Searching: "${query}"...`);

  try {
    const response = await fetch(
      `${VOYO_API}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { signal: AbortSignal.timeout(20000) }
    );

    if (!response.ok) {
      devWarn(`[Feeder] VOYO API error: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    const items = data.results || [];

    if (items.length === 0) {
      devLog(`[Feeder] No results for "${query}"`);
      return 0;
    }

    const tracks: TrackKnowledge[] = [];

    for (const item of items) {
      // VOYO API returns voyoId (base64 encoded YouTube ID)
      const voyoId = item.id || item.voyoId;
      if (!voyoId) continue;

      // Decode VOYO ID to get YouTube ID
      let videoId = voyoId;
      if (voyoId.startsWith('vyo_')) {
        const encoded = voyoId.substring(4);
        try {
          let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
          while (base64.length % 4) base64 += '=';
          videoId = atob(base64);
        } catch {
          videoId = voyoId; // Keep as-is if decode fails
        }
      }

      const title = item.title || '';
      const artist = item.artist || 'Unknown Artist';

      // Classify the track
      const classification = classifyTrack(title, artist, '');

      tracks.push({
        id: videoId,
        title: title,
        artistId: artist.toLowerCase().replace(/\s+/g, '-'),
        artistName: artist,
        primaryMood: classification.primaryMood,
        feelings: classification.feelings,
        energy: classification.energy,
        isClassic: false,
        isTrending: true,
        discoveredAt: Date.now(),
        classifiedAt: Date.now(),
        confidence: classification.confidence,
        // Canon system defaults (will be enriched by canonizer)
        canonLevel: 'ECHO' as const,  // Default to ECHO - will be upgraded by canonizer
        culturalTags: [],             // Will be enriched by canonizer
      });
    }

    if (tracks.length === 0) {
      devLog(`[Feeder] No valid tracks from "${query}"`);
      return 0;
    }

    // Add to local knowledge
    const store = useKnowledgeStore.getState();
    store.addTracks(tracks);

    // Feed to database
    const fed = await feedTracksToDatabase(tracks);
    devLog(`[Feeder] "${query}" → ${fed} tracks fed`);

    return fed;
  } catch (error) {
    devWarn(`[Feeder] Search failed for "${query}":`, error);
    return 0;
  }
}

/**
 * Feed a list of queries (for manual bulk discovery)
 */
export async function bulkSearchAndFeed(queries: string[]): Promise<number> {
  let totalFed = 0;

  for (const query of queries) {
    const fed = await searchAndFeed(query);
    totalFed += fed;

    // Small delay between searches
    await new Promise(r => setTimeout(r, 500));
  }

  devLog(`[Feeder] Bulk search complete: ${totalFed} total tracks fed`);
  return totalFed;
}

// ============================================
// AFRICAN ARTIST DATABASE BUILDER
// ============================================

// Key African artists to seed the database
const AFRICAN_ARTIST_QUERIES = [
  // Nigerian Superstars
  'Burna Boy official music video',
  'Wizkid official music video',
  'Davido official music video',
  'Rema official music video',
  'Asake official music video',
  'Ayra Starr official music video',
  'Tems official music video',
  'CKay official music video',
  'Omah Lay official music video',
  'Fireboy DML official music video',
  'Olamide official music video',
  'Tiwa Savage official music video',
  'Yemi Alade official music video',
  'Joeboy official music video',
  'Ruger official music video',
  'BNXN official music video',
  'Pheelz official music video',
  'Victony official music video',
  'Lojay official music video',

  // South African Stars
  'Tyla official music video',
  'Kabza De Small music',
  'DJ Maphorisa music',
  'Focalistic official video',
  'Uncle Waffles official video',
  'Young Stunna music',
  'DBN Gogo music',
  'Nasty C official music video',
  'Black Coffee DJ set',

  // Ghanaian Artists
  'Black Sherif official video',
  'King Promise official video',
  'Sarkodie official music video',
  'Stonebwoy official video',
  'Shatta Wale music video',
  'Kuami Eugene official video',
  'KiDi official music video',

  // East African Artists
  'Diamond Platnumz official video',
  'Harmonize official video',
  'Zuchu official video',
  'Rayvanny official video',
  'Nandy Tanzania music',
  'Mbosso official video',
  'Sauti Sol official video',

  // Francophone African Artists
  'Fally Ipupa official video',
  'Innoss B official video',
  'Aya Nakamura official video',
  'Dadju official video',
  'Gims official video',
  'Ferre Gola music',

  // Classics & Legends
  'Fela Kuti original',
  'King Sunny Ade music',
  'Youssou Ndour official',
  'Salif Keita music',
  'Angelique Kidjo official',
  '2Baba official video',

  // Genre-specific searches
  'afrobeats 2024 hits',
  'amapiano 2024 best',
  'bongo flava 2024',
  'afro house 2024',
  'african gospel songs',
  'highlife music Ghana',
  'gqom music Durban',
  'kizomba 2024',
  'afro soul music',
  'african RnB',
];

/**
 * Build the African Artist Database
 * Run this to populate the collective brain with quality African music
 * Uses gentle rate limiting to avoid 429 errors
 */
export async function buildAfricanMusicDatabase(): Promise<{
  queriesRun: number;
  tracksFed: number;
  duration: number;
}> {
  devLog('');
  devLog('='.repeat(60));
  devLog('🌍 BUILDING AFRICAN MUSIC DATABASE');
  devLog('='.repeat(60));
  devLog(`Queries to run: ${AFRICAN_ARTIST_QUERIES.length}`);
  devLog('⏱️  Using 2s delay between queries to avoid rate limits');
  devLog('');

  const startTime = Date.now();
  let totalFed = 0;
  let queriesRun = 0;
  let consecutiveFailures = 0;

  for (const query of AFRICAN_ARTIST_QUERIES) {
    try {
      // If we've had 3+ consecutive failures, wait longer
      if (consecutiveFailures >= 3) {
        devLog(`[Feeder] 💤 Rate limit pause (5s)...`);
        await new Promise(r => setTimeout(r, 5000));
        consecutiveFailures = 0;
      }

      const fed = await searchAndFeed(query, 10); // Reduce to 10 results per query
      totalFed += fed;
      queriesRun++;

      if (fed > 0) {
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
      }

      // Progress
      devLog(`[${queriesRun}/${AFRICAN_ARTIST_QUERIES.length}] "${query}" → ${fed} tracks`);

      // Rate limit: 2s between queries to be gentle on the API
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      consecutiveFailures++;
      devWarn(`Failed: ${query}`);
    }
  }

  const duration = (Date.now() - startTime) / 1000;

  devLog('');
  devLog('='.repeat(60));
  devLog('🌍 DATABASE BUILD COMPLETE');
  devLog('='.repeat(60));
  devLog(`Queries run: ${queriesRun}`);
  devLog(`Tracks fed: ${totalFed}`);
  devLog(`Duration: ${duration.toFixed(1)}s`);
  devLog('');

  return { queriesRun, tracksFed: totalFed, duration };
}

// ============================================
// EXPORTS FOR CONSOLE ACCESS
// ============================================

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as any).feedDatabase = {
    unleash: unleashAndFeed,
    priority: feedPriorityScouts,
    sync: syncKnowledgeToDatabase,
    search: searchAndFeed,
    bulk: bulkSearchAndFeed,
    build: buildAfricanMusicDatabase,
    stats: getDatabaseStats,
  };

  devLog('[Feeder] Database feeding commands available:');
  devLog('  window.feedDatabase.unleash()  - Run ALL scouts and feed DB');
  devLog('  window.feedDatabase.build()    - Build African music database');
  devLog('  window.feedDatabase.search(q)  - Search and feed specific query');
  devLog('  window.feedDatabase.stats()    - Get database stats');
}
