#!/usr/bin/env node
/**
 * Reconcile r2_video_key for all voyo_moments
 * Sets r2_video_key = moments/{platform}/{source_id}.mp4 for every row missing it
 */

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const BATCH = 1000;
const CONCURRENCY = 10;

async function reconcile() {
  console.log('Reconciling r2_video_key for all voyo_moments...\n');

  let offset = 0;
  let updated = 0;
  let total = 0;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/voyo_moments?r2_video_key=is.null&select=id,source_id,source_platform&limit=${BATCH}&offset=${offset}`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    total += rows.length;

    // Process in chunks for concurrency
    const chunks = [];
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      chunks.push(rows.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (row) => {
        const platform = row.source_platform || 'tiktok';
        const key = `moments/${platform}/${row.source_id}.mp4`;
        const upRes = await fetch(
          `${SUPABASE_URL}/rest/v1/voyo_moments?id=eq.${row.id}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ r2_video_key: key }),
          }
        );
        if (upRes.ok) updated++;
      }));
    }

    process.stdout.write(`  [${total}] checked, ${updated} updated\n`);
    offset += BATCH;
  }

  console.log(`\nRECONCILIATION COMPLETE: ${updated}/${total} moments updated with r2_video_key`);
}

reconcile().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
