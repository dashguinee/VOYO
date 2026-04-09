#!/usr/bin/env node
/**
 * VOYO Database Feeder - Direct Node.js Version
 *
 * Bypasses the browser and directly uses the VOYO API + Supabase
 * to populate the collective brain with African music.
 *
 * Usage:
 *   node scripts/feed-database-direct.cjs [--test] [--full]
 */

const https = require('https');

// Configuration
const VOYO_API = 'https://voyo-music-api.fly.dev';
const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

// African music search queries
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
  // South African Stars
  'Tyla official music video',
  'Kabza De Small music',
  'DJ Maphorisa music',
  'Black Coffee DJ set',
  // Ghanaian Artists
  'Black Sherif official video',
  'Sarkodie official music video',
  'Stonebwoy official video',
  // East African Artists
  'Diamond Platnumz official video',
  'Sauti Sol official video',
  // Classics
  'Fela Kuti original',
  'Youssou Ndour official',
];

// Mood classification
const MOOD_KEYWORDS = {
  energetic: ['dance', 'party', 'banger', 'hot', 'fire', 'turnt', 'lit'],
  chill: ['chill', 'vibe', 'mellow', 'smooth', 'easy', 'calm'],
  romantic: ['love', 'baby', 'heart', 'honey', 'sweet', 'forever'],
  party: ['party', 'dance', 'club', 'weekend', 'night'],
  spiritual: ['god', 'jesus', 'prayer', 'blessed', 'gospel'],
};

function classifyMood(title, artist) {
  const text = `${title} ${artist}`.toLowerCase();

  for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      return mood;
    }
  }

  return 'energetic'; // Default for African music
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function searchMusic(query, limit = 10) {
  const url = `${VOYO_API}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const result = await httpsGet(url);

  if (result.status === 429) {
    const retryAfter = result.data?.retryAfter || 60;
    console.log(`  Rate limited, waiting ${retryAfter}s...`);
    await new Promise(r => setTimeout(r, (retryAfter + 5) * 1000));
    return searchMusic(query, limit); // Retry
  }

  if (result.status !== 200) {
    console.log(`  API error: ${result.status}`);
    return [];
  }

  return result.data.results || [];
}

async function feedToSupabase(videos) {
  if (videos.length === 0) return 0;

  const url = `${SUPABASE_URL}/rest/v1/video_intelligence`;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  // Use minimal columns - the table may have been created with fewer columns
  const rows = videos.map(v => ({
    youtube_id: v.youtubeId,
    title: v.title,
    artist: v.artist,
    thumbnail_url: `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg`
  }));

  const result = await httpsPost(url, JSON.stringify(rows), headers);

  if (result.status >= 200 && result.status < 300) {
    return rows.length;
  }

  console.log(`  Supabase error: ${result.status}`, result.data);
  return 0;
}

function decodeVoyoId(voyoId) {
  if (!voyoId.startsWith('vyo_')) return voyoId;

  const encoded = voyoId.substring(4);
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';

  try {
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return voyoId;
  }
}

async function feedFromQuery(query, limit = 10) {
  console.log(`[Feeder] Searching: "${query}"...`);

  const results = await searchMusic(query, limit);

  if (results.length === 0) {
    console.log(`  No results`);
    return 0;
  }

  const videos = results.map(item => {
    const youtubeId = decodeVoyoId(item.voyoId || item.id);
    return {
      youtubeId,
      title: item.title,
      artist: item.artist || 'Unknown',
      mood: classifyMood(item.title, item.artist)
    };
  });

  const fed = await feedToSupabase(videos);
  console.log(`  → ${fed} tracks fed to Supabase`);

  return fed;
}

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isFull = args.includes('--full');

  console.log('='.repeat(60));
  console.log('VOYO DATABASE FEEDER - Direct Mode');
  console.log('='.repeat(60));
  console.log();

  let totalFed = 0;

  if (isTest || (!isTest && !isFull)) {
    // Just run one test query
    console.log('[Mode: TEST]');
    console.log();
    totalFed = await feedFromQuery('Burna Boy official music video', 5);
  } else {
    // Run all queries
    console.log('[Mode: FULL BUILD]');
    console.log(`Queries to run: ${AFRICAN_ARTIST_QUERIES.length}`);
    console.log('Using 3s delay between queries');
    console.log();

    for (let i = 0; i < AFRICAN_ARTIST_QUERIES.length; i++) {
      const query = AFRICAN_ARTIST_QUERIES[i];
      console.log(`[${i + 1}/${AFRICAN_ARTIST_QUERIES.length}] ${query}`);

      const fed = await feedFromQuery(query, 10);
      totalFed += fed;

      // Wait between queries
      if (i < AFRICAN_ARTIST_QUERIES.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`COMPLETE - ${totalFed} tracks fed to Supabase`);
  console.log('='.repeat(60));
}

main().catch(console.error);
