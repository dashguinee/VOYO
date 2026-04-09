# VOYO Audio Upload Pipeline - RESUME DOCUMENT

**Last Updated**: January 3, 2026
**Purpose**: Complete reference for resuming audio upload operations

---

## CURRENT STATUS

| Metric | Value |
|--------|-------|
| **Target Tracks** | 324,289 |
| **R2 Objects** | ~41,000 (est. ~20K unique tracks × 2 qualities) |
| **Progress** | ~6% |
| **Cookies Status** | VALID until 2027 |

---

## THE PIPELINE THAT WORKED

### GitHub Actions: `audio_conquest.yml`

**Location**: `.github/workflows/audio_conquest.yml`

**What it does**:
1. Triggers manually via `workflow_dispatch`
2. Creates a matrix of N parallel jobs (default: 20)
3. Each job processes a chunk of tracks (default: 5000)
4. Downloads audio via yt-dlp with cookies
5. Uploads to R2 in 2 qualities: `128/` and `64/`

**Key Parameters**:
```yaml
inputs:
  chunk_size: '5000'      # Tracks per job
  total_jobs: '20'        # Parallel workers
  start_offset: '0'       # Where to start in database
```

**Success History**:
- Run #8: 20/20 jobs SUCCESS
- Uploaded ~18,000 tracks

**R2 Path Pattern**: `128/{youtube_id}.opus` and `64/{youtube_id}.opus`

---

## HOW TO RUN GITHUB ACTIONS

### Step 1: Access the workflow
```
https://github.com/dashguinee/voyo-music-server/actions
```

### Step 2: Click "Audio Conquest" → "Run workflow"

### Step 3: Set parameters
| Parameter | Recommended Value | Notes |
|-----------|-------------------|-------|
| chunk_size | 5000 | Tracks per job |
| total_jobs | 20 | Max parallel jobs |
| start_offset | 0 | Change for different ranges |

### Step 4: Click "Run workflow"

---

## MULTI-ACCOUNT STRATEGY (For Scale)

To process faster, use multiple GitHub accounts with forked repos:

| Account | Offset Range | Status |
|---------|--------------|--------|
| A (dashguinee) | 0 - 108,000 | Active |
| B (new account) | 108,000 - 216,000 | Optional |
| C (new account) | 216,000 - 324,289 | Optional |

**Secrets needed for each account**:
```
SUPABASE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
R2_ACCOUNT_ID = 2b9fcfd8cd9aedbd862ffd071d66a3e
R2_ACCESS_KEY = 82679709fb4e9f7e77f1b159991c9551
R2_SECRET_KEY = 306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52
```

**Deduplication**: Workers check R2 before downloading, so overlap is safe.

---

## LOCAL SCRIPTS (Backup Option)

### 1. hacker_mode.py
**Location**: `scripts/hacker_mode.py`
**Purpose**: Fast 2-tier upload matching GitHub Actions
**R2 Path**: `128/` and `64/` (same as GitHub Actions)

```bash
python3 scripts/hacker_mode.py --limit 1000 --offset 0 --workers 5
```

### 2. audio_pipeline_parallel.py
**Location**: `scripts/audio_pipeline_parallel.py`
**Purpose**: Parallel local processing
**R2 Path**: `audio/128/` and `audio/64/` (different from GitHub Actions!)

```bash
python3 scripts/audio_pipeline_parallel.py --limit 1000 --offset 0 --workers 8
```

---

## R2 FOLDER STRUCTURE

```
voyo-audio/
├── 128/                    # GitHub Actions + hacker_mode.py
│   └── {youtube_id}.opus
├── 64/                     # GitHub Actions + hacker_mode.py
│   └── {youtube_id}.opus
├── audio/128/              # audio_pipeline_parallel.py (local)
│   └── {youtube_id}.opus
├── audio/64/               # audio_pipeline_parallel.py (local)
│   └── {youtube_id}.opus
├── audio/192/              # audio_pipeline_parallel.py (local) - optional tier
│   └── {youtube_id}.opus
└── audio/256/              # audio_pipeline_parallel.py (local) - optional tier
    └── {youtube_id}.opus
```

**Note**: Two different path patterns exist due to different scripts. Both work.

---

## COOKIES

**Status**: VALID until February 2027

**Location in workflow**: Line 67 of `audio_conquest.yml` (base64 encoded)

**If cookies expire**:
1. Export YouTube cookies from browser (use extension like "Get cookies.txt")
2. Base64 encode: `cat cookies.txt | base64 -w0`
3. Replace the base64 string in workflow line 67
4. Commit and push

---

## CREDENTIALS REFERENCE

### Supabase
```
URL: https://anmgyxhnyhbyxzpjhxgx.supabase.co
Table: video_intelligence
Total tracks: 324,289
```

### Cloudflare R2
```
Account ID: 2b9fcfd8cd9aedbd862ffd071d66a3e8
Bucket: voyo-audio
Access Key: 82679709fb4e9f7e77f1b159991c9551
Secret Key: 306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52
```

---

## WHAT DOESN'T WORK (Jan 3, 2026)

### Cobalt API ❌
- **Status**: NOT VIABLE
- **Reason**: API now requires JWT authentication (locked down Nov 2024)
- **Source**: https://github.com/imputnet/cobalt/discussions/860
- **Script**: `scripts/cobalt_pipeline.py` (kept for reference)

### Local yt-dlp ❌
- **Status**: BLOCKED
- **Reason**: YouTube's signature challenge solver not working in WSL
- **Error**: "Signature solving failed" + "n challenge solving failed"
- **Root cause**: Missing challenge solver script distribution

### What DOES Work ✅
- **GitHub Actions**: Different IPs bypass bot detection
- **Fresh cookies**: Updated Jan 3, 2026 (commit 5431763)
- **Multi-account strategy**: Scale with additional GitHub accounts

---

## TROUBLESHOOTING

### "Cookies are no longer valid"
- Export fresh cookies from YouTube (logged in)
- Base64 encode and update workflow

### Low success rate (~20-30%)
- Normal! Many YouTube videos are:
  - Deleted/unavailable
  - Region-restricted
  - Private/unlisted
  - Bot-detected

### Network unreachable (WSL)
- Restart WSL: `wsl --shutdown` (in PowerShell)
- Or use GitHub Actions instead (runs on GitHub servers)

### R2 connection timeout
- Check firewall settings
- WSL DNS issue: restart WSL

---

## QUICK START CHECKLIST

- [ ] Go to: https://github.com/dashguinee/voyo-music-server/actions
- [ ] Click "Audio Conquest"
- [ ] Click "Run workflow"
- [ ] Set start_offset (0 for beginning, or higher for continuation)
- [ ] Set total_jobs: 20
- [ ] Set chunk_size: 5000
- [ ] Click "Run workflow"
- [ ] Wait ~2-4 hours for completion

---

## ESTIMATED COMPLETION

| Workers | Coverage per Run | Runs Needed | Est. Time |
|---------|-----------------|-------------|-----------|
| 20 jobs | 100,000 tracks | 4 runs | 8-16 hours total |
| 40 jobs (2 accounts) | 200,000 tracks | 2 runs | 4-8 hours total |
| 60 jobs (3 accounts) | 300,000 tracks | 1-2 runs | 2-4 hours total |

---

## NEXT STEPS

1. **Trigger GitHub Actions run** with offset=0
2. **Monitor progress** in Actions tab
3. **Trigger additional runs** with different offsets as needed:
   - Run 1: offset=0
   - Run 2: offset=100000
   - Run 3: offset=200000
   - Run 4: offset=300000

---

*This document is the single source of truth for VOYO audio upload operations.*
