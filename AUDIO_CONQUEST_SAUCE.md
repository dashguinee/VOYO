# VOYO Audio Conquest - The Working Sauce

**Date Discovered**: 2026-01-03
**Success Rate**: 97%
**Backup File**: `.github/workflows/audio_conquest_WORKING_BACKUP.yml`

## What Works

Run #26 structure (commit `5431763`) + fresh cookies

### Key Components

1. **20 parallel jobs** with matrix strategy
2. **Binary yt-dlp** from GitHub releases (not pip)
3. **Deno installed** for JS challenge solving
4. **NO `--extractor-args`** - let yt-dlp auto-negotiate
5. **Fresh login cookies** exported from incognito, session frozen immediately

### Cookie Export Process

1. Open Chrome Incognito
2. Log into YouTube
3. Install "Get cookies.txt LOCALLY" extension
4. Export cookies immediately
5. **CLOSE INCOGNITO RIGHT AWAY** - freezes the session
6. Base64 encode: `cat cookies.txt | base64 -w0`
7. Paste into workflow

### Workflow Parameters

```
total_jobs: 20        # 20 parallel workers
chunk_size: 5000      # 5000 tracks per job
start_offset: X       # Where to resume from
```

### Math

- 20 jobs × 5000 tracks = 100,000 tracks per run
- ~97% success rate = ~97,000 uploads per run
- 324,289 total tracks ÷ 100k = 3-4 runs to complete

### Failure Types (Normal)

- "Video unavailable" - deleted videos
- "Not available in your country" - geo-blocked
- "audio conversion failed" - rare codec issues

### Files

- Workflow: `.github/workflows/audio_conquest.yml`
- Working commit: `5431763` (original Run #26)
- Current with fresh cookies: `556db2a`

## DO NOT

- Use `--extractor-args` flags
- Use pip install yt-dlp (use binary)
- Share cookies across multiple accounts
- Keep browser open after cookie export
- Overcomplicate it

---

## Full Working Workflow (audio_conquest.yml)

```yaml
name: Audio Conquest

on:
  workflow_dispatch:
    inputs:
      chunk_size:
        description: 'Tracks per job'
        default: '5000'
        type: string
      total_jobs:
        description: 'Number of parallel jobs'
        default: '20'
        type: string
      start_offset:
        description: 'Starting offset (for parallel runs)'
        default: '0'
        type: string

jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - name: Get tracks to process
        id: set-matrix
        run: |
          NUM_JOBS=${{ inputs.total_jobs }}
          CHUNK_SIZE=${{ inputs.chunk_size }}
          START=${{ inputs.start_offset }}

          MATRIX="["
          for i in $(seq 0 $((NUM_JOBS - 1))); do
            OFFSET=$((START + i * CHUNK_SIZE))
            if [ $i -gt 0 ]; then MATRIX="$MATRIX,"; fi
            MATRIX="$MATRIX{\"job_id\":$i,\"offset\":$OFFSET,\"limit\":$CHUNK_SIZE}"
          done
          MATRIX="$MATRIX]"

          echo "Starting at offset $START with $NUM_JOBS jobs of $CHUNK_SIZE each"
          echo "matrix={\"include\":$MATRIX}" >> $GITHUB_OUTPUT

  download:
    needs: prepare
    runs-on: ubuntu-latest
    timeout-minutes: 350
    strategy:
      fail-fast: false
      max-parallel: 20
      matrix: ${{ fromJson(needs.prepare.outputs.matrix) }}

    steps:
      - name: Setup
        run: |
          echo "Job ${{ matrix.job_id }}: offset=${{ matrix.offset }}, limit=${{ matrix.limit }}"
          # Install ffmpeg
          sudo apt-get update && sudo apt-get install -y ffmpeg
          # Install deno for yt-dlp signature solving
          curl -fsSL https://deno.land/install.sh | sh
          export DENO_INSTALL="$HOME/.deno"
          export PATH="$DENO_INSTALL/bin:$PATH"
          echo "$DENO_INSTALL/bin" >> $GITHUB_PATH
          # Install yt-dlp
          sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
          sudo chmod a+rx /usr/local/bin/yt-dlp
          pip install boto3 requests
          echo "YOUR_BASE64_COOKIES_HERE" | base64 -d > /tmp/cookies.txt

      - name: Create worker script
        run: |
          cat << 'SCRIPT' > worker.py
          import os
          import subprocess
          import time
          import random
          from pathlib import Path
          import boto3
          from botocore.config import Config
          import requests
          from concurrent.futures import ThreadPoolExecutor, as_completed

          SUPABASE_URL = "https://anmgyxhnyhbyxzpjhxgx.supabase.co"
          SUPABASE_KEY = os.environ['SUPABASE_KEY']
          R2_ACCOUNT_ID = os.environ['R2_ACCOUNT_ID']
          R2_ACCESS_KEY = os.environ['R2_ACCESS_KEY']
          R2_SECRET_KEY = os.environ['R2_SECRET_KEY']
          R2_BUCKET = 'voyo-audio'
          OFFSET = int(os.environ['OFFSET'])
          LIMIT = int(os.environ['LIMIT'])
          JOB_ID = os.environ['JOB_ID']

          TEMP_DIR = Path("/tmp/voyo-audio")
          TEMP_DIR.mkdir(exist_ok=True)

          r2 = boto3.client('s3',
              endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
              aws_access_key_id=R2_ACCESS_KEY,
              aws_secret_access_key=R2_SECRET_KEY,
              config=Config(retries={'max_attempts': 3}))

          def log(msg):
              print(f"[Job {JOB_ID}] {msg}", flush=True)

          def get_tracks():
              headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
              url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id&limit={LIMIT}&offset={OFFSET}"
              resp = requests.get(url, headers=headers, timeout=60)
              resp.raise_for_status()
              return [t['youtube_id'] for t in resp.json() if t.get('youtube_id')]

          def get_existing():
              existing = set()
              try:
                  paginator = r2.get_paginator('list_objects_v2')
                  for page in paginator.paginate(Bucket=R2_BUCKET, Prefix="128/"):
                      for obj in page.get('Contents', []):
                          key = obj['Key']
                          if '/' in key:
                              filename = key.split('/')[-1]
                              if '.' in filename:
                                  existing.add(filename.rsplit('.', 1)[0])
              except Exception as e:
                  log(f"Warning getting existing: {e}")
              return existing

          def download_and_upload(yt_id, debug=False):
              output = TEMP_DIR / f"{yt_id}.opus"
              cmd = ["yt-dlp", "-x", "--audio-format", "opus", "--audio-quality", "5",
                  "-o", str(TEMP_DIR / f"{yt_id}.%(ext)s"),
                  "--no-playlist",
                  "--cookies", "/tmp/cookies.txt",
                  "--retries", "2", "--socket-timeout", "30",
                  f"https://www.youtube.com/watch?v={yt_id}"]
              try:
                  result = subprocess.run(cmd, capture_output=True, timeout=120, text=True)
                  if debug or result.returncode != 0:
                      log(f"yt-dlp exit={result.returncode} stderr={result.stderr[:200] if result.stderr else 'none'}")
                  if not output.exists():
                      webm = TEMP_DIR / f"{yt_id}.webm"
                      if webm.exists():
                          webm.rename(output)
                  if output.exists():
                      r2.upload_file(str(output), R2_BUCKET, f"128/{yt_id}.opus")
                      r2.upload_file(str(output), R2_BUCKET, f"64/{yt_id}.opus")
                      output.unlink()
                      return True
              except Exception as e:
                  log(f"Exception for {yt_id}: {e}")
              return False

          def main():
              log(f"Starting: offset={OFFSET}, limit={LIMIT}")
              tracks = get_tracks()
              log(f"Got {len(tracks)} tracks from DB")

              existing = get_existing()
              log(f"Found {len(existing)} already on R2")

              to_process = [t for t in tracks if t not in existing]
              log(f"Need to process: {len(to_process)}")

              if not to_process:
                  log("Nothing to process!")
                  return

              uploaded = 0
              failed = 0

              for i, yt_id in enumerate(to_process):
                  time.sleep(random.uniform(0.1, 0.3))
                  if download_and_upload(yt_id, debug=(i < 3)):
                      uploaded += 1
                  else:
                      failed += 1
                  if (i + 1) % 25 == 0:
                      log(f"Progress: {i+1}/{len(to_process)} | ✅ {uploaded} | ❌ {failed}")

              log(f"DONE: ✅ {uploaded} | ❌ {failed}")

          if __name__ == "__main__":
              main()
          SCRIPT

      - name: Run worker
        env:
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY: ${{ secrets.R2_ACCESS_KEY }}
          R2_SECRET_KEY: ${{ secrets.R2_SECRET_KEY }}
          OFFSET: ${{ matrix.offset }}
          LIMIT: ${{ matrix.limit }}
          JOB_ID: ${{ matrix.job_id }}
        run: python worker.py
```
