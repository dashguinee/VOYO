#!/usr/bin/env python3
"""
VOYO Audio Pipeline - Parallel to R2
=====================================
3 parallel workers for faster downloads.

Usage:
    python3 scripts/audio_pipeline_parallel.py --tier A --limit 1000
"""

import os
import json
import subprocess
import argparse
from pathlib import Path
import urllib.request
import time
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import boto3
from botocore.config import Config

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)

# ============================================
# CONFIG
# ============================================

SUPABASE_URL = "https://anmgyxhnyhbyxzpjhxgx.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4"

R2_ACCOUNT_ID = '2b9fcfd8cd9aedbde62ffdd714d66a3e'
R2_ACCESS_KEY = '82679709fb4e9f7e77f1b159991c9551'
R2_SECRET_KEY = '306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52'
R2_BUCKET = 'voyo-audio'
R2_PUBLIC_URL = 'https://pub-645c1f5179484e2ca4ec33cbf7caba84.r2.dev'

BASE_DIR = Path(__file__).parent.parent
TEMP_DIR = BASE_DIR / "audio_cache" / "temp"

QUALITY_TIERS = {'64': 64, '128': 128}  # 2 tiers only
WORKERS = 3

# Thread-safe counter
lock = threading.Lock()
stats = {'success': 0, 'failed': 0, 'skipped': 0}

# ============================================
# R2 CLIENT (thread-local)
# ============================================

thread_local = threading.local()

def get_r2_client():
    if not hasattr(thread_local, 'client'):
        thread_local.client = boto3.client(
            's3',
            endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            config=Config(signature_version='s3v4')
        )
    return thread_local.client

def upload_to_r2(local_path: Path, r2_key: str) -> bool:
    try:
        get_r2_client().upload_file(
            str(local_path), R2_BUCKET, r2_key,
            ExtraArgs={'ContentType': 'audio/opus', 'CacheControl': 'public, max-age=31536000'}
        )
        return True
    except:
        return False

def check_exists_on_r2(r2_key: str) -> bool:
    try:
        get_r2_client().head_object(Bucket=R2_BUCKET, Key=r2_key)
        return True
    except:
        return False

# ============================================
# HELPERS
# ============================================

def fetch_tracks(tier: str, limit: int, offset: int = 0) -> list:
    # Get ALL tracks, not filtered by tier
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id&limit={limit}&offset={offset}"
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode())
    except:
        return []

def download_from_youtube(youtube_id: str, output_path: Path) -> Path:
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    output_template = str(output_path / f"{youtube_id}.%(ext)s")
    cmd = ["yt-dlp", "-x", "--audio-format", "opus", "--audio-quality", "0",
           "-o", output_template, "--no-playlist", "--quiet", "--no-warnings", url]
    try:
        subprocess.run(cmd, capture_output=True, timeout=90)
        for ext in ['opus', 'webm', 'm4a', 'mp3']:
            f = output_path / f"{youtube_id}.{ext}"
            if f.exists():
                return f
    except:
        pass
    return None

def convert_to_opus(input_file: Path, output_file: Path, bitrate: int) -> bool:
    cmd = ["ffmpeg", "-i", str(input_file), "-c:a", "libopus", "-b:a", f"{bitrate}k",
           "-vn", "-y", "-loglevel", "error", str(output_file)]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        return result.returncode == 0 and output_file.exists()
    except:
        return False

# ============================================
# WORKER
# ============================================

def process_track(youtube_id: str, idx: int, total: int) -> str:
    # Check if exists
    if check_exists_on_r2(f"audio/128/{youtube_id}.opus"):
        with lock:
            stats['skipped'] += 1
        return f"[{idx}/{total}] {youtube_id} (exists)"

    # Create unique temp dir for this track
    track_temp = TEMP_DIR / youtube_id
    track_temp.mkdir(exist_ok=True)

    try:
        # Download
        downloaded = download_from_youtube(youtube_id, track_temp)
        if not downloaded:
            with lock:
                stats['failed'] += 1
            return f"[{idx}/{total}] {youtube_id} ✗ download"

        # Convert and upload each tier
        uploaded = 0
        for tier_name, bitrate in QUALITY_TIERS.items():
            opus_file = track_temp / f"{tier_name}.opus"
            if convert_to_opus(downloaded, opus_file, bitrate):
                if upload_to_r2(opus_file, f"audio/{tier_name}/{youtube_id}.opus"):
                    uploaded += 1
                try:
                    opus_file.unlink()
                except:
                    pass

        # Cleanup
        try:
            downloaded.unlink()
            track_temp.rmdir()
        except:
            pass

        if uploaded > 0:
            with lock:
                stats['success'] += 1
            return f"[{idx}/{total}] {youtube_id} ✓ {uploaded} tiers"
        else:
            with lock:
                stats['failed'] += 1
            return f"[{idx}/{total}] {youtube_id} ✗ convert"

    except Exception as e:
        with lock:
            stats['failed'] += 1
        return f"[{idx}/{total}] {youtube_id} ✗ {str(e)[:20]}"

# ============================================
# MAIN
# ============================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tier', default='A')
    parser.add_argument('--limit', type=int, default=1000)
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--workers', type=int, default=WORKERS)
    args = parser.parse_args()

    print("=" * 60)
    print(f"VOYO PARALLEL PIPELINE - {args.workers} workers")
    print("=" * 60)

    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nFetching Tier {args.tier} tracks...")
    tracks = fetch_tracks(args.tier, args.limit, args.offset)
    print(f"Found {len(tracks)} tracks")

    if not tracks:
        return

    print(f"\nProcessing with {args.workers} parallel workers...\n")

    start_time = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(process_track, t['youtube_id'], i+1, len(tracks)): t
            for i, t in enumerate(tracks)
        }

        for future in as_completed(futures):
            result = future.result()
            print(result, flush=True)

    elapsed = time.time() - start_time
    rate = (stats['success'] + stats['skipped']) / elapsed * 60 if elapsed > 0 else 0

    print(f"\n{'=' * 60}")
    print(f"COMPLETE in {elapsed/60:.1f} min ({rate:.1f} tracks/min)")
    print(f"  Success: {stats['success']}")
    print(f"  Skipped: {stats['skipped']}")
    print(f"  Failed:  {stats['failed']}")
    print("=" * 60)

if __name__ == '__main__':
    main()
