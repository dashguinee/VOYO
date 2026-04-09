#!/usr/bin/env node
/**
 * propagate-by-creator.cjs
 *
 * Fast local inference: if a creator has tagged moments, propagate their
 * most common country+region to all their untagged moments.
 * Also: if a moment has a parent_track_id, inherit from artist_master.json.
 *
 * Zero API calls. Pure Supabase reads + writes.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIG
// ============================================

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

// Country → region mapping
const COUNTRY_REGION = {
  'nigeria': 'west-africa',
  'ghana': 'west-africa',
  'senegal': 'west-africa',
  'mali': 'west-africa',
  'guinea': 'west-africa',
  'ivory-coast': 'west-africa',
  'cameroon': 'west-africa',
  'benin': 'west-africa',
  'togo': 'west-africa',
  'burkina-faso': 'west-africa',
  'sierra-leone': 'west-africa',
  'liberia': 'west-africa',
  'gambia': 'west-africa',
  'niger': 'west-africa',
  'south-africa': 'southern-africa',
  'zimbabwe': 'southern-africa',
  'botswana': 'southern-africa',
  'kenya': 'east-africa',
  'tanzania': 'east-africa',
  'uganda': 'east-africa',
  'ethiopia': 'east-africa',
  'rwanda': 'east-africa',
  'congo': 'central-africa',
  'drc': 'central-africa',
  'angola': 'lusophone-africa',
  'mozambique': 'lusophone-africa',
  'cape-verde': 'lusophone-africa',
  'algeria': 'north-africa',
  'morocco': 'north-africa',
  'egypt': 'north-africa',
  'tunisia': 'north-africa',
  'usa': 'diaspora',
  'uk': 'diaspora',
  'france': 'diaspora',
  'brazil': 'diaspora',
  'portugal': 'diaspora',
  'canada': 'diaspora',
};

// Known region tags (not countries)
const REGION_TAGS = new Set([
  'west-africa', 'east-africa', 'southern-africa', 'central-africa',
  'north-africa', 'lusophone-africa', 'diaspora'
]);

// Tags to skip (too vague)
const SKIP_TAGS = new Set(['africa', 'spiritual', 'naija', 'mzansi', 'ng']);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ============================================
// PHASE 1: Build creator → country map from existing tags
// ============================================

async function buildCreatorMap() {
  log('Phase 1: Building creator tag map from existing tagged moments...');

  let allTagged = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('voyo_moments')
      .select('creator_username, cultural_tags')
      .neq('cultural_tags', '{}')
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allTagged.push(...data);
    offset += PAGE;
    if (data.length < PAGE) break;
  }

  log(`  Loaded ${allTagged.length} tagged moments`);

  // Count tags per creator, focusing on countries only
  const creatorTags = {};
  allTagged.forEach(m => {
    const creator = m.creator_username;
    if (!creator) return;
    if (!creatorTags[creator]) creatorTags[creator] = {};

    (m.cultural_tags || []).forEach(tag => {
      if (SKIP_TAGS.has(tag)) return;
      if (REGION_TAGS.has(tag)) return; // Skip region-only tags, we derive region from country
      // Normalize "south africa" → "south-africa"
      const normalized = tag.replace(/\s+/g, '-').toLowerCase();
      if (COUNTRY_REGION[normalized] || normalized in COUNTRY_REGION) {
        creatorTags[creator][normalized] = (creatorTags[creator][normalized] || 0) + 1;
      }
    });
  });

  // Pick top country per creator (majority vote)
  const creatorCountry = {};
  for (const [creator, tags] of Object.entries(creatorTags)) {
    const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const country = sorted[0][0];
      const region = COUNTRY_REGION[country];
      if (region) {
        creatorCountry[creator] = [country, region];
      }
    }
  }

  log(`  ${Object.keys(creatorCountry).length} creators mapped to countries`);
  return creatorCountry;
}

// ============================================
// PHASE 2: Load artist_master for parent track inference
// ============================================

function loadArtistMaster() {
  const masterPath = path.join(__dirname, '../../src/data/artist_master.json');
  if (!fs.existsSync(masterPath)) {
    log('  artist_master.json not found, skipping Phase 2b');
    return {};
  }

  const raw = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const artists = raw.artists || raw;
  const artistCountry = {};

  for (const [key, entry] of Object.entries(artists)) {
    if (entry.country) {
      const country = entry.country.replace(/\s+/g, '-').toLowerCase();
      const region = COUNTRY_REGION[country] || entry.region?.replace(/\s+/g, '-').toLowerCase();
      if (region) {
        artistCountry[key] = [country, region];
        // Also map canonical name
        if (entry.canonical_name) {
          artistCountry[entry.canonical_name.toLowerCase()] = [country, region];
        }
      }
    }
  }

  log(`  ${Object.keys(artistCountry).length} artists mapped from artist_master.json`);
  return artistCountry;
}

// ============================================
// PHASE 3: Fetch untagged moments and propagate
// ============================================

async function propagate(creatorCountry, artistCountry) {
  log('Phase 3: Fetching untagged moments...');

  let totalUpdated = 0;
  let totalSkipped = 0;
  let offset = 0;
  const PAGE = 500;

  while (true) {
    const { data, error } = await supabase
      .from('voyo_moments')
      .select('id, creator_username, parent_track_id, parent_track_artist')
      .eq('cultural_tags', '{}')
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    log(`  Batch at offset ${offset}: ${data.length} moments`);

    // Build updates
    const updates = [];

    for (const m of data) {
      let tags = null;

      // Strategy 1: Creator already has tagged moments
      if (m.creator_username && creatorCountry[m.creator_username]) {
        tags = creatorCountry[m.creator_username];
      }

      // Strategy 2: Parent track artist in artist_master
      if (!tags && m.parent_track_artist) {
        const artistKey = m.parent_track_artist.toLowerCase();
        if (artistCountry[artistKey]) {
          tags = artistCountry[artistKey];
        }
      }

      if (tags) {
        updates.push({ id: m.id, cultural_tags: tags });
      } else {
        totalSkipped++;
      }
    }

    // Batch update
    if (updates.length > 0 && !DRY_RUN) {
      // Supabase doesn't support bulk update easily, do in batches of 50
      for (let i = 0; i < updates.length; i += 50) {
        const batch = updates.slice(i, i + 50);
        const promises = batch.map(u =>
          supabase
            .from('voyo_moments')
            .update({ cultural_tags: u.cultural_tags })
            .eq('id', u.id)
        );
        await Promise.all(promises);
      }
    }

    totalUpdated += updates.length;
    log(`  Updated: ${updates.length}, Skipped: ${data.length - updates.length}`);

    offset += PAGE;
    if (data.length < PAGE) break;
  }

  return { totalUpdated, totalSkipped };
}

// ============================================
// MAIN
// ============================================

async function main() {
  log('============================================');
  log('VOYO MOMENTS — Fast Creator Propagation');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log('============================================');

  const creatorCountry = await buildCreatorMap();
  const artistCountry = loadArtistMaster();

  const { totalUpdated, totalSkipped } = await propagate(creatorCountry, artistCountry);

  log('');
  log('============================================');
  log('PROPAGATION COMPLETE');
  log('============================================');
  log(`Updated: ${totalUpdated}`);
  log(`Skipped: ${totalSkipped} (no known creator or artist)`);
  log('============================================');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
