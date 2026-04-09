#!/usr/bin/env node
/**
 * Fix R2 Video Keys — Delete bad keys with titles in them, re-upload with clean IDs
 *
 * Problem: first upload used full filename as sourceId, creating keys like:
 *   moments/tiktok/7224457422843251974 I'm so unavailable... [7224457422843251974].mp4
 * instead of:
 *   moments/tiktok/7224457422843251974.mp4
 *
 * This script:
 * 1. Lists all moments/tiktok/ objects in R2
 * 2. Identifies ones with bad keys (contain spaces or brackets)
 * 3. Deletes the bad keys
 * 4. Re-uploads with clean numeric-only keys
 */

const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const R2_ACCOUNT_ID = '2b9fcfd8cd9aedbde62ffdd714d66a3e';
const R2_ACCESS_KEY = '82679709fb4e9f7e77f1b159991c9551';
const R2_SECRET_KEY = '306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52';
const R2_BUCKET = 'voyo-audio';

const SIPHON_BASE = path.join(process.env.HOME, '.zion/renaissance/siphon/content');
const CONCURRENCY = 5;

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

async function listR2Objects(prefix) {
  const objects = [];
  let continuationToken;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });
    const result = await r2.send(cmd);
    if (result.Contents) objects.push(...result.Contents);
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

// Build local file index: sourceId → filePath
function buildLocalIndex(platform) {
  const dir = path.join(SIPHON_BASE, platform);
  if (!fs.existsSync(dir)) return new Map();

  const index = new Map();
  const creators = fs.readdirSync(dir);

  for (const creator of creators) {
    const creatorDir = path.join(dir, creator);
    if (!fs.statSync(creatorDir).isDirectory()) continue;

    const files = fs.readdirSync(creatorDir).filter(f => f.endsWith('.mp4'));
    for (const file of files) {
      const basename = path.basename(file, '.mp4');
      const bracketMatch = basename.match(/\[(\d{15,25})\]\s*$/);
      const sourceId = bracketMatch ? bracketMatch[1] : basename.match(/^(\d{15,25})/)?.[1] || basename;
      index.set(sourceId, path.join(creatorDir, file));
    }
  }

  return index;
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  FIX R2 VIDEO KEYS — Clean ID Re-upload     ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Step 1: List all objects in moments/tiktok/
  console.log('[1/4] Listing R2 objects under moments/tiktok/...');
  const objects = await listR2Objects('moments/tiktok/');
  console.log(`  Found ${objects.length} objects\n`);

  // Step 2: Classify good vs bad keys
  const badKeys = [];
  const goodKeys = new Set();

  for (const obj of objects) {
    const filename = obj.Key.replace('moments/tiktok/', '');
    // Good key: just digits + .mp4
    if (/^\d{15,25}\.mp4$/.test(filename)) {
      goodKeys.add(filename.replace('.mp4', ''));
    } else {
      // Bad key: has spaces, brackets, title text
      const match = filename.match(/(\d{15,25})/);
      if (match) {
        badKeys.push({ key: obj.Key, sourceId: match[1], size: obj.Size });
      }
    }
  }

  console.log(`[2/4] Classification:`);
  console.log(`  Good keys (clean ID): ${goodKeys.size}`);
  console.log(`  Bad keys (with title): ${badKeys.length}`);

  // Filter: only fix bad keys that DON'T already have a good version
  const toFix = badKeys.filter(b => !goodKeys.has(b.sourceId));
  const toDeleteOnly = badKeys.filter(b => goodKeys.has(b.sourceId));

  console.log(`  Need re-upload: ${toFix.length}`);
  console.log(`  Delete only (good exists): ${toDeleteOnly.length}\n`);

  // Step 3: Build local file index for re-uploads
  console.log('[3/4] Building local file index...');
  const localIndex = buildLocalIndex('tiktok');
  console.log(`  Local files indexed: ${localIndex.size}\n`);

  // Step 4: Fix — re-upload with clean key, then delete bad key
  console.log('[4/4] Fixing...');
  let fixed = 0, deleted = 0, failed = 0;

  // Process re-uploads
  const queue = [...toFix];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const { key, sourceId } = item;
      const cleanKey = `moments/tiktok/${sourceId}.mp4`;
      const localPath = localIndex.get(sourceId);

      if (!localPath || !fs.existsSync(localPath)) {
        console.log(`  [SKIP] ${sourceId} — no local file found`);
        failed++;
        continue;
      }

      try {
        // Upload with clean key
        const body = fs.readFileSync(localPath);
        await r2.send(new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: cleanKey,
          Body: body,
          ContentType: 'video/mp4',
        }));

        // Delete bad key
        await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));

        fixed++;
        const mb = (body.length / 1024 / 1024).toFixed(1);
        process.stdout.write(`  [${fixed + deleted}/${toFix.length + toDeleteOnly.length}] ${sourceId} ✓ re-uploaded (${mb}MB)\n`);
      } catch (err) {
        failed++;
        process.stdout.write(`  [ERR] ${sourceId}: ${err.message}\n`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  // Delete bad keys that already have good versions
  for (const item of toDeleteOnly) {
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: item.key }));
      deleted++;
    } catch (err) {
      // Non-critical
    }
  }

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  RESULTS                                     ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  Re-uploaded:  ${String(fixed).padStart(5)}                          ║`);
  console.log(`║  Deleted only: ${String(deleted).padStart(5)}                          ║`);
  console.log(`║  Failed:       ${String(failed).padStart(5)}                          ║`);
  console.log(`║  Total clean:  ${String(goodKeys.size + fixed).padStart(5)}                          ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
