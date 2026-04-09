#!/usr/bin/env node
/**
 * VOYO Download Flagged Tracks
 *
 * Demand-driven acquisition pipeline:
 * 1. Query video_intelligence for tracks flagged by users (manual_play + not in R2)
 * 2. Download audio via yt-dlp
 * 3. Upload to R2
 * 4. Update database
 *
 * Run: node scripts/download-flagged.cjs [--limit=N] [--dry-run]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Config
const SUPABASE_HOST = 'anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const R2_CREDS_FILE = path.join(process.env.HOME || '/home/dash', '.r2_credentials');
const TEMP_DIR = path.join(__dirname, '../.temp/downloads');
const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const LIMIT = parseInt(ARGS.find(a => a.startsWith('--limit='))?.split('=')[1]) || 50;

// Stats
let downloaded = 0, uploaded = 0, skipped = 0, failed = 0;

function supabaseGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: SUPABASE_HOST,
      path: `/rest/v1/${apiPath}`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('============================================');
  console.log('VOYO Download Flagged Tracks');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT}`);
  console.log('============================================\n');

  // Check R2 credentials
  if (!fs.existsSync(R2_CREDS_FILE)) {
    console.error('R2 credentials not found at', R2_CREDS_FILE);
    process.exit(1);
  }

  // Check yt-dlp
  try {
    execSync('which yt-dlp', { stdio: 'pipe' });
  } catch {
    console.error('yt-dlp not found. Install: pip install yt-dlp');
    process.exit(1);
  }

  // Ensure temp dir
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Get flagged tracks (manual_play = user listened >30s)
  const tracks = await supabaseGet(
    `video_intelligence?select=youtube_id,title,artist&discovery_method=eq.manual_play&order=updated_at.desc&limit=${LIMIT}`
  );

  console.log(`Found ${tracks.length} flagged tracks\n`);

  if (DRY_RUN) {
    tracks.forEach((t, i) => console.log(`  ${i + 1}. [${t.youtube_id}] ${t.artist || '?'} - ${t.title}`));
    console.log('\nDry run complete. Use without --dry-run to download.');
    return;
  }

  for (const track of tracks) {
    const id = track.youtube_id;
    const outFile = path.join(TEMP_DIR, `${id}.opus`);

    console.log(`\n[${downloaded + skipped + failed + 1}/${tracks.length}] ${track.artist || '?'} - ${track.title}`);

    // Check if already in R2 (via edge worker)
    try {
      const checkRes = await fetch(`https://voyo-edge.dash-webtv.workers.dev/r2/audio/${id}/check`);
      const checkData = await checkRes.json();
      if (checkData.exists) {
        console.log('  Already in R2, skipping');
        skipped++;
        continue;
      }
    } catch {
      // Can't check, proceed with download
    }

    // Download via yt-dlp
    try {
      execSync(
        `yt-dlp -x --audio-format opus --audio-quality 128K -o "${outFile}" "https://youtube.com/watch?v=${id}" 2>&1`,
        { timeout: 60000, stdio: 'pipe' }
      );
      downloaded++;
      console.log('  Downloaded');
    } catch (e) {
      console.log('  Download FAILED:', e.message?.slice(0, 100));
      failed++;
      continue;
    }

    // Upload to R2 (using existing audio pipeline pattern)
    if (fs.existsSync(outFile)) {
      try {
        const r2Creds = JSON.parse(fs.readFileSync(R2_CREDS_FILE, 'utf-8'));
        // Use aws cli with R2 endpoint
        execSync(
          `aws s3 cp "${outFile}" "s3://voyo-audio/audio/${id}.opus" ` +
          `--endpoint-url "https://${r2Creds.account_id}.r2.cloudflarestorage.com" ` +
          `--content-type "audio/opus" 2>&1`,
          {
            timeout: 30000,
            stdio: 'pipe',
            env: {
              ...process.env,
              AWS_ACCESS_KEY_ID: r2Creds.access_key_id,
              AWS_SECRET_ACCESS_KEY: r2Creds.secret_access_key,
            }
          }
        );
        uploaded++;
        console.log('  Uploaded to R2');

        // Clean up temp file
        fs.unlinkSync(outFile);
      } catch (e) {
        console.log('  Upload FAILED:', e.message?.slice(0, 100));
        failed++;
      }
    }
  }

  console.log('\n============================================');
  console.log('DOWNLOAD COMPLETE');
  console.log('============================================');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Uploaded to R2: ${uploaded}`);
  console.log(`Skipped (already in R2): ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
