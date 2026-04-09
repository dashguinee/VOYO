#!/usr/bin/env node
/**
 * VOYO Canonized Data Loader
 *
 * Loads 122K canonized tracks from data/canonized_v4.json into Supabase
 *
 * Usage:
 *   node scripts/load_canonized_to_supabase.js
 *   node scripts/load_canonized_to_supabase.js --dry-run
 *   node scripts/load_canonized_to_supabase.js --limit=1000
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

const BATCH_SIZE = 500;  // Tracks per batch
const DELAY_MS = 100;    // Delay between batches to avoid rate limits

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🎵 VOYO Canonized Data Loader');
  console.log('=============================\n');

  // Check Supabase key
  if (!SUPABASE_KEY) {
    console.error('❌ Missing Supabase key!');
    console.log('\nSet one of these environment variables:');
    console.log('  export VITE_SUPABASE_ANON_KEY=your_anon_key');
    console.log('  export SUPABASE_SERVICE_KEY=your_service_key');
    process.exit(1);
  }

  // Load canonized data
  const dataPath = path.join(__dirname, '..', 'data', 'canonized_v4.json');
  console.log(`📂 Loading: ${dataPath}`);

  if (!fs.existsSync(dataPath)) {
    console.error('❌ File not found: data/canonized_v4.json');
    process.exit(1);
  }

  const raw = fs.readFileSync(dataPath, 'utf-8');
  const data = JSON.parse(raw);

  console.log(`✅ Loaded: v${data.version}`);
  console.log(`   Total tracks: ${data.total_tracks.toLocaleString()}`);
  console.log(`   Generated: ${data.generated_at}\n`);

  // Stats
  console.log('📊 Statistics:');
  console.log(`   Tier A: ${data.statistics.by_tier.A?.toLocaleString() || 0}`);
  console.log(`   Tier B: ${data.statistics.by_tier.B?.toLocaleString() || 0}`);
  console.log(`   Tier C: ${data.statistics.by_tier.C?.toLocaleString() || 0}`);
  console.log(`   Tier D: ${data.statistics.by_tier.D?.toLocaleString() || 0}\n`);

  // Get tracks
  let tracks = data.tracks || [];

  if (LIMIT > 0) {
    tracks = tracks.slice(0, LIMIT);
    console.log(`⚠️  Limited to ${LIMIT} tracks (--limit flag)\n`);
  }

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No database changes will be made\n');
  }

  // Create Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Test connection
  console.log('🔌 Testing Supabase connection...');
  const { count, error: countError } = await supabase
    .from('video_intelligence')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('❌ Supabase connection failed:', countError.message);
    process.exit(1);
  }
  console.log(`✅ Connected! Current tracks in DB: ${count?.toLocaleString() || 0}\n`);

  // Process in batches
  const totalBatches = Math.ceil(tracks.length / BATCH_SIZE);
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  console.log(`🚀 Starting upload: ${tracks.length.toLocaleString()} tracks in ${totalBatches} batches\n`);

  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batch = tracks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Transform tracks to DB format (using existing columns only)
    const records = batch.map(track => ({
      youtube_id: track.id,
      title: track.title || 'Unknown',
      artist: track.artist || null,
      thumbnail_url: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,

      // Enrichment columns (existing in table)
      artist_tier: mapTier(track.tier),
      era: mapEra(track.era),
      cultural_tags: track.cultural_tags || [],
      aesthetic_tags: track.aesthetic_tags || [],
      canon_level: track.canon_level || 'ECHO',
      canon_confidence: track.confidence || 0.5,
      content_type: track.content_type || 'original',
      matched_artist: track.artist || null,
      tier_source: 'canonizer_v4',
      classified_at: track.classified_at || new Date().toISOString(),
    }));

    if (DRY_RUN) {
      console.log(`[${batchNum}/${totalBatches}] Would upsert ${records.length} tracks`);
      successCount += records.length;
    } else {
      // Upsert to database
      const { error } = await supabase
        .from('video_intelligence')
        .upsert(records, {
          onConflict: 'youtube_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`[${batchNum}/${totalBatches}] ❌ Error: ${error.message}`);
        errorCount += records.length;
      } else {
        console.log(`[${batchNum}/${totalBatches}] ✅ Upserted ${records.length} tracks`);
        successCount += records.length;
      }

      // Delay to avoid rate limits
      if (i + BATCH_SIZE < tracks.length) {
        await sleep(DELAY_MS);
      }
    }
  }

  // Final stats
  console.log('\n=============================');
  console.log('📊 COMPLETE');
  console.log(`   ✅ Success: ${successCount.toLocaleString()}`);
  console.log(`   ❌ Errors: ${errorCount.toLocaleString()}`);
  console.log(`   ⏭️  Skipped: ${skippedCount.toLocaleString()}`);

  if (!DRY_RUN) {
    // Verify enrichment stats
    console.log('\n🔍 Verifying enrichment...');
    const { data: stats, error: statsError } = await supabase.rpc('get_enrichment_stats');

    if (stats && stats[0]) {
      const s = stats[0];
      console.log(`   Total tracks: ${s.total_tracks?.toLocaleString()}`);
      console.log(`   Enriched: ${s.enriched_tracks?.toLocaleString()} (${s.enrichment_pct}%)`);
      console.log(`   Tier A: ${s.tier_a_count?.toLocaleString()}`);
      console.log(`   Tier B: ${s.tier_b_count?.toLocaleString()}`);
      console.log(`   Tier C: ${s.tier_c_count?.toLocaleString()}`);
      console.log(`   Tier D: ${s.tier_d_count?.toLocaleString()}`);
    } else if (statsError) {
      console.log('   ⚠️  Could not get stats (migration 002 may not be applied)');
    }
  }

  console.log('\n✨ Done!');
}

// ============================================
// HELPERS
// ============================================

function mapTier(tier) {
  // Map canonized tier to DB tier
  if (!tier) return 'D';
  const t = tier.toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(t)) return t;
  return 'D';
}

function mapEra(era) {
  // Map canonized era to DB era
  if (!era || era === 'unknown') return null;

  const eraMap = {
    'pre-independence': 'pre-1990',
    'independence': 'pre-1990',
    'golden-age': '1990s',
    'transition': '2000s',
    'digital-dawn': '2010s',
    'streaming-era': '2020s',
    'global-explosion': '2020s',
  };

  return eraMap[era] || null;
}

function buildVibeScores(track) {
  // Build vibe scores based on tier and content type
  const tier = track.tier?.toUpperCase() || 'D';
  const contentType = track.content_type || 'original';

  // Base scores by tier
  const baseScores = {
    A: { afro_heat: 80, chill: 50, party: 70, workout: 60, late_night: 50 },
    B: { afro_heat: 70, chill: 50, party: 60, workout: 50, late_night: 50 },
    C: { afro_heat: 60, chill: 50, party: 50, workout: 40, late_night: 50 },
    D: { afro_heat: 50, chill: 50, party: 40, workout: 30, late_night: 50 },
  };

  const scores = { ...baseScores[tier] || baseScores.D };

  // Adjust based on content type
  if (contentType === 'dj_mix' || contentType === 'remix') {
    scores.party += 15;
    scores.workout += 10;
  }
  if (contentType === 'acoustic' || contentType === 'live') {
    scores.chill += 20;
    scores.late_night += 15;
    scores.party -= 10;
  }
  if (contentType === 'instrumental') {
    scores.chill += 10;
    scores.workout += 5;
  }

  // Clamp to 0-100
  for (const key of Object.keys(scores)) {
    scores[key] = Math.max(0, Math.min(100, scores[key]));
  }

  return scores;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// RUN
// ============================================

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
