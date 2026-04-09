#!/usr/bin/env python3
"""
VOYO Audio Pipeline - Crème de la Crème
========================================
Downloads, converts, and prepares audio for R2 storage.

Tier A+B: Deezer (FLAC) → 256k Opus
Tier C+D: YouTube (yt-dlp) → 160k Opus
All tiers: 64k, 128k, 192k, 256k versions for adaptive streaming

Usage:
    python3 scripts/audio_pipeline.py --tier A
    python3 scripts/audio_pipeline.py --tier B
    python3 scripts/audio_pipeline.py --all
"""

import os
import json
import subprocess
import argparse
from pathlib import Path
import urllib.request
import urllib.error
import time
import hashlib

# ============================================
# CONFIG
# ============================================

SUPABASE_URL = "https://anmgyxhnyhbyxzpjhxgx.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4"

# Directories
BASE_DIR = Path(__file__).parent.parent
DOWNLOAD_DIR = BASE_DIR / "audio_cache" / "downloads"
OUTPUT_DIR = BASE_DIR / "audio_cache" / "output"

# Quality tiers (bitrate in kbps)
QUALITY_TIERS = {
    '64': 64,
    '128': 128,
    '192': 192,
    '256': 256,
}

# ============================================
# HELPERS
# ============================================

def ensure_dirs():
    """Create necessary directories."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for tier in QUALITY_TIERS:
        (OUTPUT_DIR / tier).mkdir(exist_ok=True)

def fetch_tracks(tier: str = None, limit: int = 1000) -> list:
    """Fetch tracks from Supabase by tier."""
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id,title,artist,artist_tier"
    if tier:
        url += f"&artist_tier=eq.{tier}"
    url += f"&limit={limit}"

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

def search_deezer(query: str) -> dict:
    """Search Deezer for a track."""
    import urllib.parse
    encoded = urllib.parse.quote(query)
    url = f"https://api.deezer.com/search?q={encoded}&limit=1"

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'VOYO/1.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            if data.get('data'):
                return data['data'][0]
    except Exception as e:
        print(f"Deezer search error: {e}")
    return None

def download_from_youtube(youtube_id: str, output_path: Path) -> bool:
    """Download audio from YouTube using yt-dlp."""
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    output_template = str(output_path / f"{youtube_id}.%(ext)s")

    cmd = [
        "yt-dlp",
        "-x",  # Extract audio
        "--audio-format", "opus",
        "--audio-quality", "0",  # Best quality
        "-o", output_template,
        "--no-playlist",
        "--quiet",
        url
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        # Find the downloaded file
        for ext in ['opus', 'webm', 'm4a', 'mp3']:
            file_path = output_path / f"{youtube_id}.{ext}"
            if file_path.exists():
                return True
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"Timeout downloading {youtube_id}")
        return False
    except Exception as e:
        print(f"Error downloading {youtube_id}: {e}")
        return False

def download_from_deezer(track_id: str, output_path: Path) -> bool:
    """
    Download from Deezer using deemix.
    Requires deemix to be installed and configured with ARL token.
    """
    # Check if deemix is available
    try:
        result = subprocess.run(["deemix", "--help"], capture_output=True)
        if result.returncode != 0:
            return False
    except FileNotFoundError:
        return False

    url = f"https://www.deezer.com/track/{track_id}"
    cmd = [
        "deemix",
        "-b", "flac",  # FLAC quality
        "-p", str(output_path),
        url
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=180)
        return result.returncode == 0
    except Exception as e:
        print(f"Deemix error: {e}")
        return False

def convert_to_opus(input_file: Path, output_file: Path, bitrate: int) -> bool:
    """Convert audio file to Opus at specified bitrate."""
    cmd = [
        "ffmpeg",
        "-i", str(input_file),
        "-c:a", "libopus",
        "-b:a", f"{bitrate}k",
        "-vn",  # No video
        "-y",   # Overwrite
        str(output_file)
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        return result.returncode == 0 and output_file.exists()
    except Exception as e:
        print(f"FFmpeg error: {e}")
        return False

def process_track(track: dict, use_deezer: bool = False) -> dict:
    """
    Process a single track:
    1. Download (Deezer for A+B, YouTube for C+D)
    2. Convert to all quality tiers
    3. Return file paths
    """
    youtube_id = track['youtube_id']
    artist = track.get('artist', 'Unknown')
    title = track.get('title', 'Unknown')

    result = {
        'youtube_id': youtube_id,
        'success': False,
        'source': None,
        'files': {}
    }

    # Step 1: Download
    downloaded_file = None

    if use_deezer:
        # Try Deezer first
        query = f"{artist} {title}"
        deezer_track = search_deezer(query)

        if deezer_track:
            deezer_id = deezer_track['id']
            if download_from_deezer(deezer_id, DOWNLOAD_DIR):
                # Find the downloaded FLAC
                for f in DOWNLOAD_DIR.glob("*.flac"):
                    downloaded_file = f
                    result['source'] = 'deezer'
                    break

    # Fallback to YouTube
    if not downloaded_file:
        if download_from_youtube(youtube_id, DOWNLOAD_DIR):
            for ext in ['opus', 'webm', 'm4a', 'mp3']:
                f = DOWNLOAD_DIR / f"{youtube_id}.{ext}"
                if f.exists():
                    downloaded_file = f
                    result['source'] = 'youtube'
                    break

    if not downloaded_file:
        print(f"  ✗ Failed to download: {youtube_id}")
        return result

    # Step 2: Convert to all quality tiers
    for tier_name, bitrate in QUALITY_TIERS.items():
        output_file = OUTPUT_DIR / tier_name / f"{youtube_id}.opus"

        if convert_to_opus(downloaded_file, output_file, bitrate):
            result['files'][tier_name] = str(output_file)
        else:
            print(f"  ✗ Failed to convert to {tier_name}k: {youtube_id}")

    # Cleanup downloaded file
    try:
        downloaded_file.unlink()
    except:
        pass

    result['success'] = len(result['files']) > 0
    return result

# ============================================
# MAIN
# ============================================

def main():
    parser = argparse.ArgumentParser(description='VOYO Audio Pipeline')
    parser.add_argument('--tier', choices=['A', 'B', 'C', 'D', 'all'], default='A',
                        help='Which tier to process')
    parser.add_argument('--limit', type=int, default=100,
                        help='Number of tracks to process')
    parser.add_argument('--skip-existing', action='store_true',
                        help='Skip tracks that already have files')
    args = parser.parse_args()

    print("=" * 60)
    print("VOYO AUDIO PIPELINE - Crème de la Crème")
    print("=" * 60)

    # Setup
    ensure_dirs()

    # Check ffmpeg
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except:
        print("ERROR: ffmpeg not installed. Run:")
        print("  sudo apt-get install ffmpeg")
        return

    # Fetch tracks
    print(f"\n1. Fetching Tier {args.tier} tracks (limit: {args.limit})...")

    if args.tier == 'all':
        tracks = []
        for t in ['A', 'B', 'C', 'D']:
            tracks.extend(fetch_tracks(t, args.limit // 4))
    else:
        tracks = fetch_tracks(args.tier, args.limit)

    print(f"   Found {len(tracks)} tracks")

    if not tracks:
        print("   No tracks found!")
        return

    # Process
    print(f"\n2. Processing tracks...")

    # Use Deezer for Tier A and B
    use_deezer = args.tier in ['A', 'B']

    success = 0
    failed = 0

    for i, track in enumerate(tracks):
        youtube_id = track['youtube_id']

        # Skip if already processed
        if args.skip_existing:
            existing = OUTPUT_DIR / '256' / f"{youtube_id}.opus"
            if existing.exists():
                print(f"   [{i+1}/{len(tracks)}] Skipping {youtube_id} (exists)")
                success += 1
                continue

        print(f"   [{i+1}/{len(tracks)}] Processing {youtube_id}...")

        result = process_track(track, use_deezer=use_deezer)

        if result['success']:
            success += 1
            print(f"   ✓ {result['source']} → {len(result['files'])} quality tiers")
        else:
            failed += 1

        # Small delay to avoid rate limits
        time.sleep(0.5)

    # Summary
    print(f"\n3. COMPLETE!")
    print(f"   Success: {success}")
    print(f"   Failed: {failed}")
    print(f"   Output: {OUTPUT_DIR}")
    print("=" * 60)

if __name__ == '__main__':
    main()
