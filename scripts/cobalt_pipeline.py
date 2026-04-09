#!/usr/bin/env python3
"""
VOYO Audio Pipeline - Cobalt Edition
=====================================
⚠️ NOT FUNCTIONAL - Cobalt API now requires JWT authentication (as of Nov 2024)
The public API at api.cobalt.tools is locked down with bot protection.

This script is kept for reference in case we self-host a Cobalt instance.

Usage (if self-hosted):
    python3 scripts/cobalt_pipeline.py --limit 1000 --offset 0 --workers 5
"""

import os
import sys
import json
import argparse
import time
import threading
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from botocore.config import Config

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

# Cobalt API endpoints (try multiple)
COBALT_APIS = [
    'https://api.cobalt.tools',
    'https://co.wuk.sh',  # Alternative instance
]

TEMP_DIR = Path("/tmp/voyo-cobalt")

# Stats
lock = threading.Lock()
stats = {'success': 0, 'failed': 0, 'skipped': 0}

# Thread-local storage
thread_local = threading.local()

# ============================================
# R2 CLIENT
# ============================================

def get_r2():
    if not hasattr(thread_local, 'r2'):
        thread_local.r2 = boto3.client('s3',
            endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            config=Config(signature_version='s3v4', retries={'max_attempts': 3}))
    return thread_local.r2

# ============================================
# COBALT API
# ============================================

def get_audio_url_cobalt(youtube_id: str) -> str:
    """Get audio download URL from Cobalt API"""
    url = f"https://youtube.com/watch?v={youtube_id}"

    for api_base in COBALT_APIS:
        try:
            data = json.dumps({
                'url': url,
                'vQuality': 'max',
                'aFormat': 'mp3',
                'isAudioOnly': True,
                'filenamePattern': 'basic'
            }).encode('utf-8')

            req = urllib.request.Request(
                f'{api_base}/api/json',
                data=data,
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            )

            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode())

                # Cobalt returns 'url' for direct download or 'status' for errors
                if result.get('status') == 'stream' or result.get('status') == 'redirect':
                    return result.get('url')
                elif result.get('url'):
                    return result.get('url')

        except Exception as e:
            continue

    return None

def download_audio(url: str, output_path: Path) -> bool:
    """Download audio from URL"""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })

        with urllib.request.urlopen(req, timeout=120) as resp:
            with open(output_path, 'wb') as f:
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)

        return output_path.exists() and output_path.stat().st_size > 10000
    except:
        return False

# ============================================
# SUPABASE
# ============================================

def get_tracks(limit: int, offset: int) -> list:
    """Get tracks from Supabase"""
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id&limit={limit}&offset={offset}"
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return [t['youtube_id'] for t in json.loads(resp.read().decode()) if t.get('youtube_id')]
    except:
        return []

def get_existing_on_r2() -> set:
    """Get list of already uploaded tracks"""
    existing = set()
    try:
        paginator = get_r2().get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=R2_BUCKET, Prefix="128/"):
            for obj in page.get('Contents', []):
                key = obj['Key']
                if '/' in key:
                    fname = key.split('/')[-1]
                    if '.' in fname:
                        existing.add(fname.rsplit('.', 1)[0])
    except:
        pass
    return existing

# ============================================
# WORKER
# ============================================

def process_track(yt_id: str, idx: int, total: int) -> str:
    """Process a single track via Cobalt"""
    try:
        # Get audio URL from Cobalt
        audio_url = get_audio_url_cobalt(yt_id)
        if not audio_url:
            with lock:
                stats['failed'] += 1
            return f"[{idx}/{total}] {yt_id} ✗ no-url"

        # Download audio
        audio_file = TEMP_DIR / f"{yt_id}.mp3"
        if not download_audio(audio_url, audio_file):
            with lock:
                stats['failed'] += 1
            return f"[{idx}/{total}] {yt_id} ✗ download"

        # Upload to R2 (both tiers - same file for now)
        r2 = get_r2()
        r2.upload_file(str(audio_file), R2_BUCKET, f"128/{yt_id}.mp3",
                      ExtraArgs={'ContentType': 'audio/mpeg'})
        r2.upload_file(str(audio_file), R2_BUCKET, f"64/{yt_id}.mp3",
                      ExtraArgs={'ContentType': 'audio/mpeg'})

        # Cleanup
        try:
            audio_file.unlink()
        except:
            pass

        with lock:
            stats['success'] += 1
        return f"[{idx}/{total}] {yt_id} ✓"

    except Exception as e:
        with lock:
            stats['failed'] += 1
        return f"[{idx}/{total}] {yt_id} ✗ {str(e)[:20]}"

# ============================================
# MAIN
# ============================================

def main():
    parser = argparse.ArgumentParser(description='VOYO Cobalt Pipeline')
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--workers', type=int, default=5)
    args = parser.parse_args()

    print("=" * 60)
    print("VOYO COBALT PIPELINE")
    print("=" * 60)
    print(f"Workers: {args.workers}")
    print(f"Offset: {args.offset}, Limit: {args.limit}")
    print("=" * 60)

    TEMP_DIR.mkdir(exist_ok=True)

    # Get tracks
    print("\n1. Fetching tracks from Supabase...")
    tracks = get_tracks(args.limit, args.offset)
    print(f"   Got {len(tracks)} tracks")

    if not tracks:
        print("   No tracks found!")
        return

    # Get existing
    print("\n2. Checking R2 for existing...")
    existing = get_existing_on_r2()
    print(f"   Found {len(existing)} already uploaded")

    # Filter
    to_process = [t for t in tracks if t not in existing]
    print(f"   To process: {len(to_process)}")

    if not to_process:
        print("\n   Nothing to do!")
        return

    # Test Cobalt API first
    print("\n3. Testing Cobalt API...")
    test_url = get_audio_url_cobalt(to_process[0])
    if test_url:
        print(f"   ✓ Cobalt API working")
    else:
        print(f"   ✗ Cobalt API failed - check if service is up")
        return

    # Process
    print(f"\n4. Processing with {args.workers} workers...\n")
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process_track, t, i+1, len(to_process)): t
                   for i, t in enumerate(to_process)}

        for f in as_completed(futures):
            print(f.result(), flush=True)

    elapsed = time.time() - start_time
    rate = stats['success'] / elapsed * 60 if elapsed > 0 else 0

    print(f"\n{'=' * 60}")
    print(f"COMPLETE in {elapsed/60:.1f} min ({rate:.1f} tracks/min)")
    print(f"✅ Success: {stats['success']}")
    print(f"❌ Failed: {stats['failed']}")
    print(f"⏭️  Skipped: {stats['skipped']}")
    print("=" * 60)

if __name__ == '__main__':
    main()
