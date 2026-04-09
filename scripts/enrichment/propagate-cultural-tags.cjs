#!/usr/bin/env node
/**
 * VOYO MOMENTS CULTURAL TAGS PROPAGATION
 *
 * Two-phase enrichment:
 * Phase 1: Moments WITH parent_track_id — inherit cultural_tags from video_intelligence
 * Phase 2: Moments WITHOUT parent_track_id — infer from artist name + artist_master.json
 *
 * Runs with anon key via REST API.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_HOST = 'anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const ARTIST_MASTER_RAW = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../data/artist_master.json'), 'utf-8')
);
// artist_master.json has nested structure: { artists: { ... }, version, ... }
const ARTIST_MASTER = ARTIST_MASTER_RAW.artists || ARTIST_MASTER_RAW;

// Country code → country name mapping (matching CATEGORY_PRESETS in useMoments)
const COUNTRY_MAP = {
  'NG': 'nigeria', 'GH': 'ghana', 'KE': 'kenya', 'ZA': 'south africa',
  'SN': 'senegal', 'DZ': 'algeria', 'GN': 'guinea', 'CI': 'ivory coast',
  'CD': 'congo', 'CM': 'cameroon', 'TZ': 'tanzania', 'ET': 'ethiopia',
  'ML': 'mali', 'BJ': 'benin', 'TG': 'togo', 'BF': 'burkina faso',
  'MG': 'madagascar', 'MZ': 'mozambique', 'AO': 'angola',
  'GB': 'uk', 'US': 'usa', 'FR': 'france', 'JM': 'jamaica',
};

const REGION_MAP = {
  'west-africa': 'west-africa', 'east-africa': 'east-africa',
  'southern-africa': 'southern-africa', 'central-africa': 'central-africa',
  'diaspora': 'diaspora', 'West Africa': 'west-africa',
  'East Africa': 'east-africa', 'Southern Africa': 'southern-africa',
  'Central Africa': 'central-africa',
};

// Build artist lookup: normalized name → { country, region }
const artistLookup = {};
for (const [key, profile] of Object.entries(ARTIST_MASTER)) {
  const names = [key, profile.normalized_name, profile.canonical_name?.toLowerCase()].filter(Boolean);
  const countryName = COUNTRY_MAP[profile.country] || profile.country?.toLowerCase();
  const region = REGION_MAP[profile.region] || profile.region;
  for (const n of names) {
    artistLookup[n] = { country: countryName, region };
  }
}

// Stats
let phase1Updated = 0, phase1Skipped = 0, phase1Errors = 0;
let phase2Updated = 0, phase2Skipped = 0, phase2NoMatch = 0;

// ============================================
// HTTP HELPERS
// ============================================

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SUPABASE_HOST,
      path: `/rest/v1/${path}`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const count = res.headers['content-range']?.split('/')[1];
          resolve({ data: JSON.parse(data), count: count ? parseInt(count) : null });
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function supabasePatch(path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: SUPABASE_HOST,
      path: `/rest/v1/${path}`,
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Prefer': 'return=minimal',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ============================================
// PHASE 1: Propagate from parent tracks
// ============================================

async function phase1() {
  console.log('\n=== PHASE 1: Propagate from parent tracks ===');

  // Get moments with parent_track_id but empty cultural_tags
  const { data: moments } = await supabaseGet(
    'voyo_moments?select=id,parent_track_id&parent_track_id=not.is.null&cultural_tags=eq.%7B%7D&limit=2000'
  );
  console.log(`Found ${moments.length} moments needing parent track enrichment`);

  if (moments.length === 0) {
    console.log('Phase 1: Nothing to do');
    return;
  }

  // Collect unique parent track IDs
  const trackIds = [...new Set(moments.map(m => m.parent_track_id))];
  console.log(`Looking up ${trackIds.length} unique parent tracks...`);

  // Fetch parent tracks' cultural_tags in batches of 50
  const trackTags = {};
  for (let i = 0; i < trackIds.length; i += 50) {
    const batch = trackIds.slice(i, i + 50);
    const idFilter = batch.map(id => `"${id}"`).join(',');
    const { data: tracks } = await supabaseGet(
      `video_intelligence?select=youtube_id,cultural_tags&youtube_id=in.(${idFilter})`
    );
    for (const t of tracks) {
      if (t.cultural_tags && t.cultural_tags.length > 0) {
        trackTags[t.youtube_id] = t.cultural_tags;
      }
    }
  }
  console.log(`Found cultural_tags for ${Object.keys(trackTags).length}/${trackIds.length} tracks`);

  // Update moments in batches of 10 concurrent
  const CONCURRENCY = 10;
  const queue = moments.filter(m => trackTags[m.parent_track_id]);
  console.log(`Updating ${queue.length} moments...`);

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (m) => {
        const tags = trackTags[m.parent_track_id];
        const res = await supabasePatch(`voyo_moments?id=eq.${m.id}`, { cultural_tags: tags });
        return res.status < 300;
      })
    );
    phase1Updated += results.filter(Boolean).length;
    phase1Errors += results.filter(r => !r).length;
    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= queue.length) {
      console.log(`  Progress: ${Math.min(i + CONCURRENCY, queue.length)}/${queue.length}`);
    }
  }

  phase1Skipped = moments.length - queue.length;
  console.log(`Phase 1 done: ${phase1Updated} updated, ${phase1Skipped} skipped (parent track has no tags), ${phase1Errors} errors`);
}

// ============================================
// PHASE 2: Infer from artist name
// ============================================

async function phase2() {
  console.log('\n=== PHASE 2: Infer from artist/creator name ===');

  // Get moments still without cultural_tags
  let offset = 0;
  let totalProcessed = 0;

  while (true) {
    const { data: moments } = await supabaseGet(
      `voyo_moments?select=id,parent_track_artist,creator_username,creator_name,description&cultural_tags=eq.%7B%7D&limit=500&offset=${offset}`
    );

    if (moments.length === 0) break;
    console.log(`Batch ${offset / 500 + 1}: Processing ${moments.length} moments...`);

    const updates = [];
    for (const m of moments) {
      // Try to match artist name against master database
      const candidates = [
        m.parent_track_artist,
        m.creator_name,
        m.creator_username,
      ].filter(Boolean).map(n => n.toLowerCase().trim());

      let matched = null;
      for (const name of candidates) {
        // Direct match
        if (artistLookup[name]) {
          matched = artistLookup[name];
          break;
        }
        // Partial match — check if any known artist name is contained
        for (const [key, val] of Object.entries(artistLookup)) {
          if (name.includes(key) || key.includes(name)) {
            matched = val;
            break;
          }
        }
        if (matched) break;
      }

      // Also check description for country hints
      if (!matched && m.description) {
        const desc = m.description.toLowerCase();
        // Check for country hashtags or mentions
        for (const [code, name] of Object.entries(COUNTRY_MAP)) {
          if (desc.includes(`#${name}`) || desc.includes(name)) {
            matched = { country: name, region: null };
            break;
          }
        }
        // Check for genre tags that imply region
        if (!matched) {
          if (desc.includes('#afrobeats') || desc.includes('#naija') || desc.includes('#afropop')) {
            matched = { country: 'nigeria', region: 'west-africa' };
          } else if (desc.includes('#amapiano') || desc.includes('#gqom')) {
            matched = { country: 'south africa', region: 'southern-africa' };
          } else if (desc.includes('#bongo') || desc.includes('#bongoflavor')) {
            matched = { country: 'tanzania', region: 'east-africa' };
          } else if (desc.includes('#azonto') || desc.includes('#highlife')) {
            matched = { country: 'ghana', region: 'west-africa' };
          } else if (desc.includes('#gengetone') || desc.includes('#genge')) {
            matched = { country: 'kenya', region: 'east-africa' };
          } else if (desc.includes('#coupe decale') || desc.includes('#zouglou')) {
            matched = { country: 'ivory coast', region: 'west-africa' };
          } else if (desc.includes('#mbalax')) {
            matched = { country: 'senegal', region: 'west-africa' };
          }
        }
      }

      if (matched) {
        const tags = [];
        if (matched.country) tags.push(matched.country);
        if (matched.region) tags.push(matched.region);
        if (tags.length > 0) {
          updates.push({ id: m.id, cultural_tags: tags });
        }
      } else {
        phase2NoMatch++;
      }
    }

    // Apply updates
    const CONCURRENCY = 10;
    for (let i = 0; i < updates.length; i += CONCURRENCY) {
      const batch = updates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (u) => {
          const res = await supabasePatch(`voyo_moments?id=eq.${u.id}`, { cultural_tags: u.cultural_tags });
          return res.status < 300;
        })
      );
      phase2Updated += results.filter(Boolean).length;
    }
    phase2Skipped += moments.length - updates.length;

    totalProcessed += moments.length;
    offset += 500;
    console.log(`  Updated: ${updates.length}, No match: ${moments.length - updates.length}, Total so far: ${totalProcessed}`);
  }

  console.log(`Phase 2 done: ${phase2Updated} updated, ${phase2NoMatch} no match`);
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('============================================');
  console.log('VOYO MOMENTS CULTURAL TAGS PROPAGATION');
  console.log('============================================');
  console.log(`Artist master: ${Object.keys(ARTIST_MASTER).length} artists`);
  console.log(`Artist lookup: ${Object.keys(artistLookup).length} name variants`);

  await phase1();
  await phase2();

  console.log('\n============================================');
  console.log('ENRICHMENT COMPLETE');
  console.log('============================================');
  console.log(`Phase 1 (parent track): ${phase1Updated} updated, ${phase1Skipped} skipped, ${phase1Errors} errors`);
  console.log(`Phase 2 (artist/description): ${phase2Updated} updated, ${phase2NoMatch} no match`);
  console.log(`Total enriched: ${phase1Updated + phase2Updated}`);
}

main().catch(console.error);
