#!/usr/bin/env node
/**
 * VOYO ARTIST ENRICHMENT v1.0
 *
 * Updates tracks based on artist master database.
 * Works with anon key - bulk updates via REST API.
 *
 * What it does:
 * 1. Load artist_master.json with 110+ artist profiles
 * 2. For each artist, find their tracks in video_intelligence
 * 3. Update artist_tier, era, cultural_tags, aesthetic_tags
 *
 * Usage:
 *   node scripts/enrichment/enrich-by-artist.js [--dry-run] [--limit=N]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const SUPABASE_URL = 'anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const ARTIST_MASTER_PATH = path.join(__dirname, '../../data/artist_master.json');
const PROGRESS_FILE = path.join(__dirname, 'enrich_progress.json');
const LOG_FILE = path.join(__dirname, 'enrich.log');

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const LIMIT = parseInt(ARGS.find(a => a.startsWith('--limit='))?.split('=')[1]) || 0;

// ============================================
// LOGGING
// ============================================

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ============================================
// SUPABASE API HELPERS
// ============================================

function supabaseRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_URL,
      path: `/rest/v1/${path}`,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${res.statusCode}: ${data}`));
        } else {
          resolve(data ? JSON.parse(data) : null);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Get tracks matching artist name
async function getTracksByArtist(artistName, limit = 1000) {
  const encoded = encodeURIComponent(artistName);
  const path = `video_intelligence?artist=ilike.*${encoded}*&select=youtube_id,title,artist,artist_tier&limit=${limit}`;
  return supabaseRequest('GET', path, null, { 'Prefer': 'return=representation' });
}

// Update track by youtube_id
async function updateTrack(youtubeId, updates) {
  const path = `video_intelligence?youtube_id=eq.${youtubeId}`;
  return supabaseRequest('PATCH', path, updates);
}

// Batch update tracks
async function batchUpdateTracks(youtubeIds, updates) {
  // PostgREST doesn't support true batch updates, so we do one by one
  // But we can use PATCH with or filter
  if (youtubeIds.length === 0) return;

  const filter = youtubeIds.map(id => `youtube_id.eq.${id}`).join(',');
  const path = `video_intelligence?or=(${filter})`;
  return supabaseRequest('PATCH', path, updates);
}

// ============================================
// MAIN ENRICHMENT
// ============================================

async function enrichByArtist() {
  log('='.repeat(50));
  log('VOYO ARTIST ENRICHMENT v1.0');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log('='.repeat(50));

  // Load artist master
  if (!fs.existsSync(ARTIST_MASTER_PATH)) {
    log('ERROR: Artist master not found at ' + ARTIST_MASTER_PATH);
    process.exit(1);
  }

  const artistMaster = JSON.parse(fs.readFileSync(ARTIST_MASTER_PATH, 'utf8'));
  const artists = Object.entries(artistMaster.artists);
  log(`Loaded ${artists.length} artists from master database`);

  // Load progress
  let progress = {};
  if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Process each artist
  const artistsToProcess = LIMIT > 0 ? artists.slice(0, LIMIT) : artists;

  for (const [normalizedName, profile] of artistsToProcess) {
    if (progress[normalizedName]?.completed) {
      log(`⏭️  Skipping ${profile.canonical_name} (already processed)`);
      totalSkipped++;
      continue;
    }

    log(`\n🎵 Processing: ${profile.canonical_name} (${profile.tier})`);

    try {
      // Find tracks by this artist
      const tracks = await getTracksByArtist(normalizedName);

      if (!tracks || tracks.length === 0) {
        log(`   No tracks found for ${profile.canonical_name}`);
        progress[normalizedName] = { completed: true, tracks: 0 };
        continue;
      }

      log(`   Found ${tracks.length} tracks`);

      // Prepare update payload
      const updates = {
        artist_tier: profile.tier,
        tier_source: 'artist_master_v1'
      };

      // Add era if we have it (pick most recent)
      if (profile.era_active && profile.era_active.length > 0) {
        updates.era = profile.era_active[profile.era_active.length - 1];
      }

      // Add cultural tags based on region/country
      const culturalTags = [];
      if (profile.region) culturalTags.push(profile.region);
      if (profile.country) culturalTags.push(profile.country.toLowerCase());
      if (culturalTags.length > 0) {
        updates.cultural_tags = culturalTags;
      }

      // Add aesthetic tags based on genre
      const aestheticTags = [];
      if (profile.primary_genre) aestheticTags.push(profile.primary_genre);
      if (profile.default_aesthetic_tags) {
        aestheticTags.push(...profile.default_aesthetic_tags);
      }
      if (aestheticTags.length > 0) {
        updates.aesthetic_tags = aestheticTags;
      }

      // Count tracks needing update (tier not already set or different)
      const tracksNeedingUpdate = tracks.filter(t =>
        !t.artist_tier || t.artist_tier !== profile.tier
      );

      if (tracksNeedingUpdate.length === 0) {
        log(`   All tracks already have correct tier`);
        progress[normalizedName] = { completed: true, tracks: tracks.length, updated: 0 };
        totalProcessed += tracks.length;
        continue;
      }

      log(`   ${tracksNeedingUpdate.length} tracks need tier update`);

      if (!DRY_RUN) {
        // Update in batches of 50
        const BATCH_SIZE = 50;
        for (let i = 0; i < tracksNeedingUpdate.length; i += BATCH_SIZE) {
          const batch = tracksNeedingUpdate.slice(i, i + BATCH_SIZE);
          const ids = batch.map(t => t.youtube_id);

          try {
            await batchUpdateTracks(ids, updates);
            log(`   ✅ Updated batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(tracksNeedingUpdate.length/BATCH_SIZE)}`);
            totalUpdated += batch.length;
          } catch (err) {
            log(`   ❌ Error updating batch: ${err.message}`);
            totalErrors += batch.length;
          }

          // Small delay between batches
          await new Promise(r => setTimeout(r, 500));
        }
      } else {
        log(`   [DRY RUN] Would update ${tracksNeedingUpdate.length} tracks`);
      }

      progress[normalizedName] = {
        completed: true,
        tracks: tracks.length,
        updated: tracksNeedingUpdate.length
      };
      totalProcessed += tracks.length;

      // Save progress after each artist
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

    } catch (err) {
      log(`   ❌ Error processing ${profile.canonical_name}: ${err.message}`);
      totalErrors++;
    }

    // Delay between artists
    await new Promise(r => setTimeout(r, 1000));
  }

  // Final report
  log('\n' + '='.repeat(50));
  log('ENRICHMENT COMPLETE');
  log('='.repeat(50));
  log(`Total artists processed: ${artistsToProcess.length - totalSkipped}`);
  log(`Total tracks found: ${totalProcessed}`);
  log(`Total tracks updated: ${totalUpdated}`);
  log(`Total skipped (already done): ${totalSkipped}`);
  log(`Total errors: ${totalErrors}`);
  log('='.repeat(50));
}

// Run
enrichByArtist().catch(err => {
  log(`FATAL ERROR: ${err.message}`);
  process.exit(1);
});
