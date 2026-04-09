#!/usr/bin/env node
/**
 * VOYO Moments Video Upload → R2
 * ================================
 * Scans siphon TikTok/Instagram directories for .mp4 files,
 * uploads to R2 under moments/{platform}/{source_id}.mp4,
 * then updates voyo_moments.r2_video_key in Supabase.
 *
 * Resume-able: checks R2 HEAD before re-uploading.
 *
 * Usage:
 *   node scripts/upload-moments-videos.cjs [--platform tiktok] [--limit 100] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { S3Client, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

// ============================================
// CONFIG
// ============================================

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const R2_ACCOUNT_ID = '2b9fcfd8cd9aedbde62ffdd714d66a3e';
const R2_ACCESS_KEY = '82679709fb4e9f7e77f1b159991c9551';
const R2_SECRET_KEY = '306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52';
const R2_BUCKET = 'voyo-audio';

const SIPHON_BASE = path.join(process.env.HOME, '.zion/renaissance/siphon/content');

const CONCURRENCY = 3;

// ============================================
// R2 CLIENT
// ============================================

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

// ============================================
// HELPERS
// ============================================

async function r2Exists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function r2Upload(key, filePath) {
  const body = fs.readFileSync(filePath);
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'video/mp4',
  }));
  return body.length;
}

async function supabaseUpdateVideoKey(sourceId, r2Key) {
  const url = `${SUPABASE_URL}/rest/v1/voyo_moments?source_id=eq.${sourceId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ r2_video_key: r2Key }),
  });
  return res.ok;
}

function scanVideos(platform) {
  const dir = path.join(SIPHON_BASE, platform);
  if (!fs.existsSync(dir)) return [];

  const videos = [];
  const creators = fs.readdirSync(dir);

  for (const creator of creators) {
    const creatorDir = path.join(dir, creator);
    if (!fs.statSync(creatorDir).isDirectory()) continue;

    const files = fs.readdirSync(creatorDir).filter(f => f.endsWith('.mp4'));
    for (const file of files) {
      // Extract clean numeric ID from filename patterns:
      // "7224457422843251974.mp4" → 7224457422843251974
      // "7224457422843251974 title text [7224457422843251974].mp4" → 7224457422843251974
      const basename = path.basename(file, '.mp4');
      const bracketMatch = basename.match(/\[(\d{15,25})\]\s*$/);
      const sourceId = bracketMatch ? bracketMatch[1] : basename.match(/^(\d{15,25})/)?.[1] || basename;
      videos.push({
        sourceId,
        platform,
        filePath: path.join(creatorDir, file),
        r2Key: `moments/${platform}/${sourceId}.mp4`,
      });
    }
  }

  return videos;
}

// ============================================
// MAIN
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const platformFlag = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null;
  const limitFlag = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : Infinity;
  const dryRun = args.includes('--dry-run');

  const platforms = platformFlag ? [platformFlag] : ['tiktok', 'instagram'];

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  VOYO MOMENTS VIDEO → R2 UPLOADER                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Platforms: ${platforms.join(', ')}`);
  console.log(`  Limit: ${limitFlag === Infinity ? 'none' : limitFlag}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log();

  // Scan all videos
  let allVideos = [];
  for (const platform of platforms) {
    const videos = scanVideos(platform);
    console.log(`  [${platform.toUpperCase()}] Found ${videos.length} .mp4 files`);
    allVideos = allVideos.concat(videos);
  }

  if (allVideos.length === 0) {
    console.log('\n  No videos found. Exiting.');
    return;
  }

  // Apply limit
  if (limitFlag < allVideos.length) {
    allVideos = allVideos.slice(0, limitFlag);
    console.log(`  Applied limit: processing ${allVideos.length} videos`);
  }

  const totalSize = allVideos.reduce((sum, v) => {
    try { return sum + fs.statSync(v.filePath).size; } catch { return sum; }
  }, 0);
  console.log(`  Total size: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log();

  if (dryRun) {
    console.log('  [DRY RUN] Would upload:');
    allVideos.slice(0, 10).forEach(v => console.log(`    ${v.r2Key} (${v.sourceId})`));
    if (allVideos.length > 10) console.log(`    ... and ${allVideos.length - 10} more`);
    return;
  }

  // Process in batches with concurrency
  let uploaded = 0, skipped = 0, failed = 0;
  let bytesUploaded = 0;
  const startTime = Date.now();

  async function processVideo(video, index) {
    const { sourceId, r2Key, filePath } = video;

    // Check R2 first (resume-able)
    const exists = await r2Exists(r2Key);
    if (exists) {
      skipped++;
      process.stdout.write(`  [${index + 1}/${allVideos.length}] ${sourceId} (exists)\n`);
      // Still ensure Supabase is synced
      await supabaseUpdateVideoKey(sourceId, r2Key);
      return;
    }

    try {
      const size = await r2Upload(r2Key, filePath);
      const ok = await supabaseUpdateVideoKey(sourceId, r2Key);
      uploaded++;
      bytesUploaded += size;
      const mb = (size / 1024 / 1024).toFixed(1);
      process.stdout.write(`  [${index + 1}/${allVideos.length}] ${sourceId} ✓ (${mb}MB${ok ? '' : ' DB_WARN'})\n`);
    } catch (err) {
      failed++;
      process.stdout.write(`  [${index + 1}/${allVideos.length}] ${sourceId} ✗ ${err.message}\n`);
    }
  }

  // Process with concurrency pool
  const queue = [...allVideos.map((v, i) => ({ video: v, index: i }))];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      await processVideo(item.video, item.index);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const mbUploaded = (bytesUploaded / 1024 / 1024).toFixed(1);

  console.log();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        RESULTS                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Uploaded:    ${String(uploaded).padStart(6)}  (${mbUploaded} MB)`.padEnd(63) + '║');
  console.log(`║  Skipped:     ${String(skipped).padStart(6)}  (already in R2)`.padEnd(63) + '║');
  console.log(`║  Failed:      ${String(failed).padStart(6)}`.padEnd(63) + '║');
  console.log(`║  Time:        ${elapsed}s`.padEnd(63) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
