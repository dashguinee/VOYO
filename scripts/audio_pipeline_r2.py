#!/usr/bin/env python3
"""
VOYO Audio Pipeline - Direct to R2
===================================
Downloads, converts, and uploads directly to R2.
Deletes local files after upload to save disk space.

Usage:
    python3 scripts/audio_pipeline_r2.py --tier A --limit 100
"""

import os
import json
import subprocess
import argparse
from pathlib import Path
import urllib.request
import time

import boto3
from botocore.config import Config

# ============================================
# CONFIG
# ============================================

SUPABASE_URL = "https://anmgyxhnyhbyxzpjhxgx.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4"

# R2 Config
R2_ACCOUNT_ID = '2b9fcfd8cd9aedbde62ffdd714d66a3e'
R2_ACCESS_KEY = '82679709fb4e9f7e77f1b159991c9551'
R2_SECRET_KEY = '306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52'
R2_BUCKET = 'voyo-audio'
R2_PUBLIC_URL = 'https://pub-645c1f5179484e2ca4ec33cbf7caba84.r2.dev'

# Directories
BASE_DIR = Path(__file__).parent.parent
TEMP_DIR = BASE_DIR / "audio_cache" / "temp"

# Quality tiers
QUALITY_TIERS = {'64': 64, '128': 128, '192': 192, '256': 256}

# ============================================
# R2 CLIENT
# ============================================

def get_r2_client():
    return boto3.client(
        's3',
        endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version='s3v4')
    )

def upload_to_r2(client, local_path: Path, r2_key: str) -> bool:
    try:
        client.upload_file(
            str(local_path),
            R2_BUCKET,
            r2_key,
            ExtraArgs={
                'ContentType': 'audio/opus',
                'CacheControl': 'public, max-age=31536000'
            }
        )
        return True
    except Exception as e:
        print(f"   Upload error: {e}")
        return False

def check_exists_on_r2(client, r2_key: str) -> bool:
    try:
        client.head_object(Bucket=R2_BUCKET, Key=r2_key)
        return True
    except:
        return False

# ============================================
# HELPERS
# ============================================

def ensure_dirs():
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

def fetch_tracks(tier: str = None, limit: int = 1000, offset: int = 0) -> list:
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id,title,artist,artist_tier"
    if tier:
        url += f"&artist_tier=eq.{tier}"
    url += f"&limit={limit}&offset={offset}"

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching tracks: {e}")
        return []

def download_from_youtube(youtube_id: str, output_path: Path) -> Path:
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    output_template = str(output_path / f"{youtube_id}.%(ext)s")

    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "opus",
        "--audio-quality", "0",
        "-o", output_template,
        "--no-playlist",
        "--quiet",
        url
    ]

    try:
        subprocess.run(cmd, capture_output=True, timeout=120)
        for ext in ['opus', 'webm', 'm4a', 'mp3']:
            file_path = output_path / f"{youtube_id}.{ext}"
            if file_path.exists():
                return file_path
    except subprocess.TimeoutExpired:
        print(f"   Timeout: {youtube_id}")
    except Exception as e:
        print(f"   Download error: {e}")
    return None

def convert_to_opus(input_file: Path, output_file: Path, bitrate: int) -> bool:
    cmd = [
        "ffmpeg",
        "-i", str(input_file),
        "-c:a", "libopus",
        "-b:a", f"{bitrate}k",
        "-vn",
        "-y",
        "-loglevel", "error",
        str(output_file)
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        return result.returncode == 0 and output_file.exists()
    except:
        return False

# ============================================
# MAIN
# ============================================

def process_track(client, youtube_id: str) -> dict:
    """Download, convert to all tiers, upload to R2, delete local."""
    result = {'success': False, 'uploaded': 0, 'skipped': 0}

    # Check if already on R2 (check 256k tier)
    if check_exists_on_r2(client, f"audio/256/{youtube_id}.opus"):
        result['skipped'] = 4
        result['success'] = True
        return result

    # Download
    downloaded = download_from_youtube(youtube_id, TEMP_DIR)
    if not downloaded:
        return result

    # Convert and upload each tier
    for tier_name, bitrate in QUALITY_TIERS.items():
        opus_file = TEMP_DIR / f"{youtube_id}_{tier_name}.opus"

        if convert_to_opus(downloaded, opus_file, bitrate):
            r2_key = f"audio/{tier_name}/{youtube_id}.opus"
            if upload_to_r2(client, opus_file, r2_key):
                result['uploaded'] += 1

            # Delete local opus file immediately
            try:
                opus_file.unlink()
            except:
                pass

    # Delete downloaded file
    try:
        downloaded.unlink()
    except:
        pass

    result['success'] = result['uploaded'] > 0
    return result

def main():
    parser = argparse.ArgumentParser(description='VOYO Audio Pipeline - Direct to R2')
    parser.add_argument('--tier', choices=['A', 'B', 'C', 'D', 'all'], default='A')
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--offset', type=int, default=0)
    args = parser.parse_args()

    print("=" * 60)
    print("VOYO AUDIO PIPELINE - Direct to R2")
    print("=" * 60)

    ensure_dirs()

    # Check dependencies
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        subprocess.run(["yt-dlp", "--version"], capture_output=True, check=True)
    except:
        print("ERROR: Install ffmpeg and yt-dlp first")
        return

    # Connect to R2
    print("\n1. Connecting to R2...")
    client = get_r2_client()
    print(f"   ✓ Connected to {R2_BUCKET}")

    # Fetch tracks
    print(f"\n2. Fetching Tier {args.tier} tracks...")
    if args.tier == 'all':
        tracks = []
        for t in ['A', 'B', 'C', 'D']:
            tracks.extend(fetch_tracks(t, args.limit // 4, args.offset // 4))
    else:
        tracks = fetch_tracks(args.tier, args.limit, args.offset)

    print(f"   Found {len(tracks)} tracks")

    if not tracks:
        return

    # Process
    print(f"\n3. Processing and uploading...")

    success = 0
    failed = 0
    skipped = 0

    for i, track in enumerate(tracks):
        youtube_id = track['youtube_id']
        print(f"   [{i+1}/{len(tracks)}] {youtube_id}...", end=" ", flush=True)

        result = process_track(client, youtube_id)

        if result['skipped'] > 0:
            print("(exists)")
            skipped += 1
        elif result['success']:
            print(f"✓ {result['uploaded']} tiers")
            success += 1
        else:
            print("✗")
            failed += 1

        time.sleep(0.3)

    # Summary
    print(f"\n4. COMPLETE!")
    print(f"   Uploaded: {success}")
    print(f"   Skipped (exists): {skipped}")
    print(f"   Failed: {failed}")
    print(f"\n   Audio URL pattern:")
    print(f"   {R2_PUBLIC_URL}/audio/[64|128|192|256]/[youtube_id].opus")
    print("=" * 60)

if __name__ == '__main__':
    main()
