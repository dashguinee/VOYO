#!/usr/bin/env node
/**
 * VOYO Sitemap Generator
 * ======================
 * Generates sitemap.xml for voyomusic.com
 *
 * URLs:
 * - / (homepage)
 * - /:username (profile pages from universes table)
 *
 * Future: /artist/:slug when voyo_artists table is populated
 *
 * Usage: node scripts/generate-sitemap.cjs
 * Output: public/sitemap.xml
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4';

const SITE_URL = 'https://voyomusic.com';
const OUTPUT = path.join(__dirname, '..', 'public', 'sitemap.xml');

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function generate() {
  console.log('Generating sitemap for voyomusic.com...\n');

  const urls = [];
  const today = new Date().toISOString().split('T')[0];

  // 1. Homepage
  urls.push({ loc: SITE_URL, changefreq: 'daily', priority: '1.0', lastmod: today });

  // 2. Profile pages (from universes table)
  try {
    const profiles = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/universes?select=username,updated_at&limit=1000`
    );
    if (Array.isArray(profiles)) {
      for (const p of profiles) {
        urls.push({
          loc: `${SITE_URL}/${p.username}`,
          changefreq: 'weekly',
          priority: '0.7',
          lastmod: p.updated_at ? p.updated_at.split('T')[0] : today
        });
      }
      console.log(`  Profiles: ${profiles.length}`);
    }
  } catch (e) {
    console.warn('  Profiles: skipped (table may not exist)');
  }

  // 3. Artist pages (from voyo_artists if table exists)
  try {
    const artists = await fetchJSON(
      `${SUPABASE_URL}/rest/v1/voyo_artists?select=slug,updated_at&limit=1000`
    );
    if (Array.isArray(artists)) {
      for (const a of artists) {
        urls.push({
          loc: `${SITE_URL}/artist/${a.slug}`,
          changefreq: 'weekly',
          priority: '0.8',
          lastmod: a.updated_at ? a.updated_at.split('T')[0] : today
        });
      }
      console.log(`  Artists: ${artists.length}`);
    }
  } catch (e) {
    console.warn('  Artists: skipped (table may not exist yet)');
  }

  // Build XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  fs.writeFileSync(OUTPUT, xml);
  console.log(`\nSitemap written: ${OUTPUT}`);
  console.log(`Total URLs: ${urls.length}`);
}

generate().catch(console.error);
