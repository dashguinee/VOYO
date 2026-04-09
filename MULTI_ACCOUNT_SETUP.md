# VOYO Audio Upload - Multi-Account Orchestration

## Current Progress
- **R2 Objects:** ~36,760 (18,380 tracks × 2 qualities)
- **Target:** 324,289 tracks
- **Progress:** ~5.7%

---

## GitHub Account Setup

### Account A (MAIN - dashguinee)
- **Repo:** voyo-music-server
- **Offset Range:** 0 - 108,000
- **Status:** Active ✅

### Account B (NEW)
- **Repo:** Fork voyo-music-server
- **Offset Range:** 108,000 - 216,000

### Account C (NEW)
- **Repo:** Fork voyo-music-server
- **Offset Range:** 216,000 - 324,289

---

## Secrets to Add (SAME for all accounts)

Go to: `https://github.com/YOUR_USERNAME/voyo-music-server/settings/secrets/actions`

Add these 4 secrets:

| Secret Name | Value |
|-------------|-------|
| `SUPABASE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4` |
| `R2_ACCOUNT_ID` | `2b9fcfd8cd9aedbd862ffd071d66a3e` |
| `R2_ACCESS_KEY` | `82679709fb4e9f7e77f1b159991c9551` |
| `R2_SECRET_KEY` | `306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52` |

---

## Trigger Commands (per account)

### Account A (dashguinee) - Already running
```
Offset 0-108K (runs #8, #9, #10 cover this)
```

### Account B - Run this after fork + secrets:
```bash
# Trigger via API or manually in Actions tab
# Settings: start_offset=108000, total_jobs=20, chunk_size=5400
```

### Account C - Run this after fork + secrets:
```bash
# Settings: start_offset=216000, total_jobs=20, chunk_size=5500
```

---

## How Deduplication Works

Every worker does this BEFORE downloading:
```python
existing = get_existing()  # Lists ALL files in R2
to_process = [t for t in tracks if t not in existing]
```

So even if ranges overlap, no duplicates. Workers skip existing tracks.

---

## Estimated Timeline

| Accounts | Parallel Workers | Est. Time |
|----------|------------------|-----------|
| 1        | 20               | 6-8 hours |
| 2        | 40               | 3-4 hours |
| 3        | 60               | 2-3 hours |

---

## Quick Start for New Account

1. Create GitHub account (any email works)
2. Go to: https://github.com/dashguinee/voyo-music-server
3. Click **Fork** (top right)
4. Go to your fork's Settings → Secrets → Actions
5. Add all 4 secrets from table above
6. Go to Actions tab → Audio Conquest → Run workflow
7. Set `start_offset` to your assigned range
8. Click Run

That's it. All uploads go to same R2 bucket.
