#!/usr/bin/env node
/**
 * Reconcile R2 Audio → voyo_tracks
 * =================================
 * Lists all audio files in R2, checks which youtube_ids exist in voyo_tracks,
 * and marks them as r2_cached = true.
 *
 * R2 bucket structure: audio/{quality}/{youtube_id}.opus (e.g. audio/128/xxx.opus)
 * Only updates tracks already in voyo_tracks table.
 *
 * Usage: node scripts/reconcile-r2-tracks.cjs [--dry-run] [--limit 1000]
 */

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const R2_ACCOUNT_ID = '2b9fcfd8cd9aedbde62ffdd714d66a3e';
const R2_ACCESS_KEY = '82679709fb4e9f7e77f1b159991c9551';
const R2_SECRET_KEY = '306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52';
const R2_BUCKET = 'voyo-audio';

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const maxKeys = limitArg >= 0 ? parseInt(process.argv[limitArg + 1]) : Infinity;

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
});

async function listR2AudioKeys() {
  const keys = [];
  let continuationToken;

  console.log('Listing R2 audio files...');

  while (true) {
    const cmd = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: 'audio/',
      MaxKeys: 1000,
      ContinuationToken: continuationToken
    });

    const res = await r2.send(cmd);
    const contents = res.Contents || [];

    for (const obj of contents) {
      // Extract youtube_id from key: audio/{quality}/{id}.opus
      // Supports both audio/128/xxx.opus and audio/xxx.opus
      const match = obj.Key.match(/^audio\/(?:\d+\/)?([^/]+)\.[^.]+$/);
      if (match) {
        keys.push({
          youtubeId: match[1],
          size: obj.Size,
          key: obj.Key
        });
      }
    }

    if (keys.length % 10000 === 0 && keys.length > 0) {
      console.log(`  Listed ${keys.length} files...`);
    }

    if (!res.IsTruncated || keys.length >= maxKeys) break;
    continuationToken = res.NextContinuationToken;
  }

  console.log(`Total R2 audio files: ${keys.length}`);
  return keys;
}

async function reconcile() {
  const r2Keys = await listR2AudioKeys();
  if (r2Keys.length === 0) {
    console.log('No R2 audio files found.');
    return;
  }

  // Get all tracks from Supabase
  console.log('\nFetching voyo_tracks...');
  let allTracks = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/voyo_tracks?select=id,youtube_id,r2_cached&limit=1000&offset=${offset}`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    allTracks.push(...rows);
    offset += rows.length;
  }
  console.log(`Total tracks in DB: ${allTracks.length}`);

  // Build set of R2 youtube IDs
  const r2Set = new Set(r2Keys.map(k => k.youtubeId));
  const r2Map = new Map(r2Keys.map(k => [k.youtubeId, k]));

  // Find tracks that are in R2 but not marked
  const toUpdate = allTracks.filter(t => r2Set.has(t.youtube_id) && !t.r2_cached);
  console.log(`Tracks to mark as r2_cached: ${toUpdate.length}`);

  if (dryRun) {
    console.log('[DRY RUN] Would update', toUpdate.length, 'tracks');
    toUpdate.slice(0, 10).forEach(t => console.log(`  ${t.youtube_id}`));
    return;
  }

  // Batch update
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50);
    await Promise.all(batch.map(async (track) => {
      const r2Info = r2Map.get(track.youtube_id);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/voyo_tracks?id=eq.${track.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            r2_cached: true,
            r2_quality: r2Info.key.endsWith('.opus') ? 'opus' : 'mp3',
            r2_size: r2Info.size,
            r2_cached_at: new Date().toISOString()
          })
        }
      );
      if (res.ok) updated++;
    }));
    process.stdout.write(`\r  Updated ${updated}/${toUpdate.length}`);
  }

  console.log(`\n\nDone! ${updated} tracks marked as r2_cached.`);
  console.log(`R2 has ${r2Keys.length} files, DB tracks: ${allTracks.length}`);
  console.log(`Note: ${r2Keys.length - allTracks.length} R2 files have no matching voyo_tracks row`);
}

reconcile().catch(console.error);
