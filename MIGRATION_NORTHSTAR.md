# VOYO Infrastructure Migration North Star

## Current State (Feb 8 2026)

### Single Infra: Cloudflare Edge Worker
- **URL**: `https://voyo-edge.dash-webtv.workers.dev`
- **Version**: v6 (Unified Gateway)
- **R2 Bucket**: `voyo-audio` (342K audio files + moments videos)
- **Endpoints**: /exists, /audio, /extract, /stream, /thumb, /proxy, /upload, /reconcile, /r2/feed, /api/search, /cdn/art, /health, /debug

### Fly.io (DEPRECATED — can be shut down)
- All 13 src/ references swapped to Edge Worker
- Fly.io still running but unused by frontend
- **Action**: `fly apps destroy voyo-music-api` when ready

---

## What Works

| Feature | Endpoint | Status |
|---------|----------|--------|
| Audio streaming (R2) | `/audio/{id}` | LIVE - 200, 65MB in 2.6s |
| Audio existence check | `/exists/{id}` | LIVE - Supabase + R2 fallback |
| YouTube extraction | `/extract/{id}` | LIVE - 5 Innertube clients |
| YouTube search | `/api/search?q=` | LIVE - Innertube search API |
| Album artwork | `/cdn/art/{id}` | LIVE - YouTube thumbnail proxy |
| Thumbnail proxy | `/thumb/{id}` | LIVE - Multiple quality levels |
| Moment video check | `/r2/feed/{id}/check` | LIVE (but no videos in R2 yet) |
| Moment video stream | `/r2/feed/{id}` | LIVE (but no videos in R2 yet) |
| R2 upload (atomic) | `/upload/{id}` | LIVE - R2 + Supabase sync |

## What's Broken

| Issue | Impact | Fix |
|-------|--------|-----|
| Moment videos not in R2 | Video playback 404s | Run upload-moments-videos.cjs |
| `/cdn/stream/` refs in src/ | ~~Audio CDN broken~~ | FIXED — all swapped to `/audio/{id}` |

## Remaining Fly.io Refs (non-src — docs/scripts only)

These are in docs, markdown files, and scripts. Not blocking:
- RESCUE.md, ARCHITECTURE.md, .docs/*, .checkpoints/*
- scripts/feed-database.py, scripts/research_artists.py, scripts/feed-database-direct.cjs
- server/fly.toml

---

## Data Coverage

| Dataset | Count | Coverage |
|---------|-------|----------|
| Total moments | 6,788 | 100% |
| Cultural tags | 6,788 | 100% (propagated) |
| R2 audio files | ~342K | In bucket (only 14/472 marked in DB) |
| R2 moment videos | 0 | 0% (3,788 keys in DB, files missing) |
| Artist master | 130 artists | Tier A complete (JSON only) |
| voyo_artists table | 0 | Table doesn't exist yet |

---

## RUNBOOK — Things Dash Must Run

### Step 1: SQL Migrations (Supabase Dashboard → SQL Editor)

Run these **in order**. Copy-paste each file into SQL Editor:

```
Migration 012 ✅ ALREADY APPLIED (r2_video_key column exists)
```

**013 — Artists Table** (creates voyo_artists for artist pages):
```bash
cat supabase/migrations/013_artists_table.sql
# Copy & paste into Supabase SQL Editor → Run
```

**014 — R2 Track Columns** (ensures r2_cached tracking columns exist):
```bash
cat supabase/migrations/014_reconcile_r2_tracks.sql
# Copy & paste into Supabase SQL Editor → Run
```

**015 — Backfill Video Keys** (sets r2_video_key for ALL moments):
```bash
cat supabase/migrations/015_backfill_r2_video_keys.sql
# Copy & paste into Supabase SQL Editor → Run
# Expected: ~3,000 rows updated (fills remaining NULL keys)
```

### Step 2: Upload Moment Videos to R2 (BIGGEST GAP)

This uploads 7,975 Instagram + 929 TikTok videos from siphon dirs to R2:
```bash
cd /home/dash/voyo-music
node scripts/upload-moments-videos.cjs
```
- **Time estimate**: ~2-4 hours (8,904 videos, ~5GB total)
- **Resume-able**: safe to Ctrl+C and re-run
- **R2 key format**: `moments/instagram/{source_id}.mp4`, `moments/tiktok/{source_id}.mp4`

### Step 3: Reconcile R2 Audio → Database

R2 has ~342K audio files but voyo_tracks only shows 14 as cached:
```bash
cd /home/dash/voyo-music
node scripts/reconcile-r2-tracks.cjs --dry-run   # Preview first
node scripts/reconcile-r2-tracks.cjs              # Then run for real
```

### Step 4: Kill Fly.io (saves $$$)

All frontend references already swapped. This is safe:
```bash
fly apps destroy voyo-music-api
```

### Step 5: Generate & Deploy Sitemap

```bash
cd /home/dash/voyo-music
node scripts/generate-sitemap.cjs
```
- Outputs `public/sitemap.xml` + `public/robots.txt` (already created)
- Re-run after populating voyo_artists table for artist URLs

### Step 6: SEO Setup (Manual)

- [ ] **Google Search Console**: Add property `voyomusic.com`
- [ ] **Submit sitemap**: `https://voyomusic.com/sitemap.xml` in GSC
- [ ] **IndexNow batch ping** (after videos uploaded):
  ```bash
  # Will create indexnow script when artist pages are populated
  ```

### Step 7: DNS Verification (Manual)

- [ ] `voyomusic.com` → Verify pointing to Vercel
- [ ] `music.dasuperhub.com` → Verify CNAME to Vercel

### Step 8: Vercel Environment Variables (Manual)

Verify in Vercel Dashboard → Settings → Environment Variables:
- [ ] `VITE_SUPABASE_URL` = `https://anmgyxhnyhbyxzpjhxgx.supabase.co`
- [ ] `VITE_SUPABASE_ANON_KEY` = (the anon key)

---

## Architecture (Final State)

```
User → Vercel (React SPA)
         ↓
    Edge Worker (voyo-edge.dash-webtv.workers.dev)
         ↓                    ↓
    R2 Bucket              YouTube API
    (audio/video)          (search/extract)
         ↓
    Supabase
    (metadata, moments, tracks, user data)
```

One frontend (Vercel), one backend (Edge Worker), one database (Supabase), one storage (R2).
No Fly.io. No cold starts. No split brain.

---

## Scripts Reference

| Script | Purpose | When |
|--------|---------|------|
| `scripts/upload-moments-videos.cjs` | Upload siphon videos to R2 | Step 2 |
| `scripts/reconcile-r2-tracks.cjs` | Sync R2 audio with DB | Step 3 |
| `scripts/generate-sitemap.cjs` | Generate sitemap.xml | Step 5 |
| `scripts/enrichment/propagate-by-creator.cjs` | Cultural tag propagation | Already done (97%) |
| `scripts/enrichment/ai-tag-moments.cjs` | Gemini cultural tagging | Already done (1,499) |
| `scripts/audio_pipeline_parallel.py` | Download+convert+upload audio | Optional boost |
| `scripts/reconcile-r2-keys.cjs` | Backfill r2_video_key in DB | Already done |
| `scripts/fix-r2-video-keys.cjs` | Fix bad R2 key formats | If needed |
