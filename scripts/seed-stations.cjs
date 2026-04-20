#!/usr/bin/env node
/**
 * Seed VOYO stations + parse tracklists + queue individual tracks.
 *
 * What this does:
 *   1. Upsert two stations into voyo_stations (Amapiano, Ginga Me)
 *   2. Fetch each hero video's YouTube description
 *   3. Ask Gemini to extract a structured tracklist from the description
 *   4. Save the tracklist jsonb back onto the station row
 *   5. For each tracklist track, YT-search → top result → enqueue in
 *      voyo_upload_queue at priority=5 (so lanes start caching them)
 *
 * Safe to re-run: station upserts, queue inserts use ignoreDuplicates.
 *
 * Prereqs:
 *   - migrations/018_voyo_stations.sql applied to Supabase
 *   - .env has SUPABASE_SERVICE_KEY, VITE_GEMINI_API_KEY, YOUTUBE_API_KEY
 *
 * Run: node scripts/seed-stations.cjs [--dry-run]
 */

const fs = require('fs');
const path = require('path');

// ── ENV ────────────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
const envRaw = fs.readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envRaw.split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_KEY;
const GEMINI_KEY = env.VITE_GEMINI_API_KEY;
const YT_KEY = env.YOUTUBE_API_KEY;
const DRY = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SB_KEY) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY');
if (!GEMINI_KEY) throw new Error('Missing VITE_GEMINI_API_KEY');
if (!YT_KEY) throw new Error('Missing YOUTUBE_API_KEY');

// ── STATIONS SPEC ──────────────────────────────────────────────────────────

const STATIONS = [
  {
    id: 'amapiano-station',
    hero_video_id: 'l53ib3uFGts',
    title: 'Amapiano Station',
    tagline: 'Sunday afternoon, Johannesburg heat',
    curator: 'Major League DJz',
    location_code: 'ZA',
    location_label: 'Johannesburg',
    vibe_axes:     { afro: 85, chill: 45, hype: 75, late_night: 60, workout: 30 },
    accent_colors: { primary: '#007749', secondary: '#FFB612' }, // SA green / gold
    is_featured: true,
    sort_order: 1,
  },
  {
    id: 'ginga-me',
    hero_video_id: 'kppnLyS5Apc',
    title: 'Ginga Me',
    tagline: 'Hype me up — Afrobeats, Amapiano, Dancehall',
    curator: 'Ethan Tomas',
    location_code: 'NG',
    location_label: 'Lagos',
    vibe_axes:     { afro: 90, chill: 20, hype: 95, late_night: 40, workout: 70 },
    accent_colors: { primary: '#008751', secondary: '#FFFFFF' }, // NG green / white
    is_featured: true,
    sort_order: 2,
  },
];

// ── SUPABASE HELPERS ───────────────────────────────────────────────────────

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SB ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── YOUTUBE ────────────────────────────────────────────────────────────────

async function ytVideoDescription(videoId) {
  const u = new URL('https://www.googleapis.com/youtube/v3/videos');
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('id', videoId);
  u.searchParams.set('key', YT_KEY);
  const res = await fetch(u);
  const json = await res.json();
  const item = json.items && json.items[0];
  if (!item) throw new Error(`No YT snippet for ${videoId}`);
  return { title: item.snippet.title, description: item.snippet.description };
}

async function ytSearchFirst(query) {
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.searchParams.set('part', 'id');
  u.searchParams.set('type', 'video');
  u.searchParams.set('q', query);
  u.searchParams.set('maxResults', '1');
  u.searchParams.set('videoCategoryId', '10'); // Music
  u.searchParams.set('key', YT_KEY);
  const res = await fetch(u);
  const json = await res.json();
  const it = json.items && json.items[0];
  return it?.id?.videoId || null;
}

// ── GEMINI ─────────────────────────────────────────────────────────────────

async function geminiExtractTracklist(videoTitle, description) {
  const prompt = `You are parsing a DJ mix description for its tracklist.
Video title: ${videoTitle}

Description (raw):
${description.slice(0, 8000)}

Return ONLY a JSON array of up to 30 tracks actually played in the mix, in order, each shaped:
  { "t_seconds": number|null, "title": "string", "artist": "string" }

Rules:
- t_seconds is the timestamp within the mix if present (convert mm:ss or hh:mm:ss)
- Skip non-track lines (credits, social links, sponsor tags, hashtags, "Follow me")
- If artist is bundled with title like "Artist - Song", split them
- If you can't confidently identify tracks, return an empty array []
- Output raw JSON only, no markdown fences, no commentary`;

  const u = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t) => t && t.title && t.artist);
  } catch (e) {
    console.warn('  gemini parse failed:', e.message, 'raw:', text.slice(0, 200));
    return [];
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────────

// Enqueue one youtube_id; 23505 (unique violation) counts as success.
async function enqueue(videoId, title, artist, priority, stationId) {
  try {
    await sb('voyo_upload_queue', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify([{
        youtube_id: videoId,
        title: title || null,
        artist: artist || null,
        priority,
        status: 'pending',
        requested_by_session: `station:${stationId}`,
      }]),
    });
    return { ok: true, dupe: false };
  } catch (e) {
    if (/23505|duplicate key/.test(e.message)) return { ok: true, dupe: true };
    return { ok: false, error: e.message };
  }
}

async function processStation(spec) {
  console.log(`\n━━━ ${spec.title} (${spec.hero_video_id}) ━━━`);

  // 1. Upsert station row (empty tracklist first, we'll fill it)
  if (!DRY) {
    await sb('voyo_stations', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: JSON.stringify([{ ...spec, tracklist: [] }]),
    });
    console.log('  ✓ station row upserted');
  }

  // 2. Enqueue the hero mix itself at priority=10 (the station's headline audio).
  if (!DRY) {
    const r = await enqueue(spec.hero_video_id, spec.title, spec.curator, 10, spec.id);
    console.log(`  ✓ hero enqueued p=10 ${r.dupe ? '(already queued)' : ''}`);
  }

  // 3. Fetch YT description
  const { title: ytTitle, description } = await ytVideoDescription(spec.hero_video_id);
  console.log(`  ✓ got YT description (${description.length} chars)`);

  // 4. Gemini extract tracklist
  const tracklist = await geminiExtractTracklist(ytTitle, description);
  console.log(`  ✓ gemini parsed ${tracklist.length} tracks`);
  tracklist.slice(0, 5).forEach((t, i) =>
    console.log(`    ${i + 1}. [${t.t_seconds ?? '?'}] ${t.artist} — ${t.title}`)
  );

  if (tracklist.length === 0) {
    console.log('  (no tracklist — station ships with hero only; individual tracks backfill later)');
    return;
  }

  // 5. Resolve each tracklist item → YT search → skip self-ref → enqueue
  const resolved = [];
  let queued = 0, dupes = 0, skipped = 0, failed = 0;
  for (const t of tracklist) {
    const query = `${t.artist} ${t.title}`.slice(0, 120);
    try {
      const vid = await ytSearchFirst(query);
      // Skip if YT returned the hero mix itself (Gemini queries sometimes
      // match the mix's description text better than any real track page).
      if (vid && vid === spec.hero_video_id) {
        resolved.push({ ...t, youtube_id: null, r2_cached: false });
        skipped++;
        continue;
      }
      resolved.push({ ...t, youtube_id: vid, r2_cached: false });
      if (vid && !DRY) {
        const r = await enqueue(vid, t.title, t.artist, 5, spec.id);
        if (r.ok && !r.dupe) queued++;
        else if (r.ok && r.dupe) dupes++;
        else { failed++; console.warn(`    ! enqueue ${vid}: ${r.error}`); }
      }
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      console.warn(`    ! resolve failed for "${query}": ${e.message}`);
      resolved.push({ ...t, youtube_id: null, r2_cached: false });
      failed++;
    }
  }
  console.log(`  ✓ resolved ${resolved.filter((t) => t.youtube_id).length}/${resolved.length} to YT ids`);
  console.log(`    queue: ${queued} new · ${dupes} already-there · ${skipped} self-ref skips · ${failed} fails`);

  // 5. Save tracklist back onto station row
  if (!DRY) {
    await sb(`voyo_stations?id=eq.${spec.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({ tracklist: resolved, updated_at: new Date().toISOString() }),
    });
    console.log('  ✓ tracklist saved to station row');
  } else {
    console.log('  (dry-run — skipped writes)');
  }
}

(async () => {
  console.log(DRY ? 'DRY-RUN mode (no writes)' : 'LIVE mode');
  for (const s of STATIONS) {
    try {
      await processStation(s);
    } catch (e) {
      console.error(`✗ ${s.id} failed:`, e.message);
    }
  }
  console.log('\ndone.');
})();
