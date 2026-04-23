#!/usr/bin/env node
/**
 * Reconcile video_intelligence.r2_cached from R2 bucket reality.
 *
 * Why it exists: the Cloudflare upload worker writes r2_cached=true to the
 * `voyo_tracks` table (a different/older source). Meanwhile, the home feed
 * reads from `video_intelligence` which is the 324k row metadata source.
 * Those two tables diverged — R2 has ~275k opus files under /128/ but
 * only ~575 rows in video_intelligence have r2_cached=true.
 *
 * This script lists every object in R2 under /128/, extracts the youtube_id
 * from the filename (128/<id>.opus), and bulk-PATCHes video_intelligence
 * with r2_cached=true. After this runs, the feed's r2-cached-only filter
 * returns the full ~275k playable pool instead of the 575 sliver.
 *
 * Run: node scripts/reconcile-vi-from-r2.cjs [--dry-run]
 */

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
// Anon key — RLS lets anon PATCH video_intelligence per earlier session test.
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

// Run with: node --env-file=.env scripts/reconcile-vi-from-r2.cjs
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET     = 'voyo-audio';
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error('Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY. Run with: node --env-file=.env ...');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const PATCH_CHUNK = 50; // anon PostgREST bulk PATCH — keep under 500ms budget
const PREFIX      = '128/'; // primary quality — sufficient to mark cached

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

async function listAllR2Ids() {
  const ids = [];
  let token;
  let page = 0;
  while (true) {
    const res = await r2.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: PREFIX, MaxKeys: 1000,
      ContinuationToken: token,
    }));
    page++;
    for (const obj of res.Contents || []) {
      // Keys look like: 128/xxxxxxxxxxx.opus
      const m = obj.Key.match(/^128\/([A-Za-z0-9_-]{11})\.opus$/);
      if (m) ids.push(m[1]);
    }
    process.stdout.write(`\r  page ${page}: ${ids.length.toLocaleString()} ids collected`);
    if (!res.IsTruncated) break;
    token = res.NextContinuationToken;
  }
  process.stdout.write('\n');
  return ids;
}

async function patchChunk(ids) {
  const quoted = ids.map(x => `"${x}"`).join(',');
  const url = `${SUPABASE_URL}/rest/v1/video_intelligence?youtube_id=in.(${quoted})`;
  const nowIso = new Date().toISOString();
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ r2_cached: true, r2_cached_at: nowIso }),
  });
  return res.status;
}

(async () => {
  console.log('Listing R2 audio files under /128/...');
  const ids = await listAllR2Ids();
  console.log(`Got ${ids.length.toLocaleString()} youtube_ids from R2.`);

  if (dryRun) {
    console.log('DRY RUN — not patching.');
    return;
  }

  console.log(`Patching video_intelligence in chunks of ${PATCH_CHUNK}...`);
  let done = 0, failed = 0;
  for (let i = 0; i < ids.length; i += PATCH_CHUNK) {
    const chunk = ids.slice(i, i + PATCH_CHUNK);
    try {
      const status = await patchChunk(chunk);
      if (status >= 200 && status < 300) done += chunk.length;
      else { failed += chunk.length; process.stdout.write(`\n  chunk ${i} HTTP ${status}`); }
    } catch (e) {
      failed += chunk.length;
      process.stdout.write(`\n  chunk ${i} error: ${e.message || e}`);
    }
    if (i % (PATCH_CHUNK * 20) === 0) {
      process.stdout.write(`\r  ${done.toLocaleString()} patched, ${failed.toLocaleString()} failed`);
    }
  }
  process.stdout.write('\n');
  console.log(`DONE: ${done.toLocaleString()} patched, ${failed.toLocaleString()} failed.`);

  // Final count check
  const r = await fetch(`${SUPABASE_URL}/rest/v1/video_intelligence?r2_cached=eq.true&select=youtube_id&limit=1`, {
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact', Range: '0-0',
    },
  });
  const cr = r.headers.get('content-range');
  console.log(`video_intelligence.r2_cached=true count: ${cr}`);
})();
