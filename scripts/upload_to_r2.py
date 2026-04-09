#!/usr/bin/env python3
"""
VOYO R2 Upload Script
=====================
Uploads processed audio files to Cloudflare R2.

Prerequisites:
    pip install boto3

Usage:
    python3 scripts/upload_to_r2.py
    python3 scripts/upload_to_r2.py --tier 256  # Only upload 256k tier
"""

import os
import argparse
from pathlib import Path

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("Install boto3: pip install boto3")
    exit(1)

# ============================================
# R2 CONFIG - UPDATE THESE
# ============================================

R2_ACCOUNT_ID = os.environ.get('R2_ACCOUNT_ID', '2b9fcfd8cd9aedbde62ffdd714d66a3e')
R2_ACCESS_KEY = os.environ.get('R2_ACCESS_KEY', '82679709fb4e9f7e77f1b159991c9551')
R2_SECRET_KEY = os.environ.get('R2_SECRET_KEY', '306f3d28d29500228a67c8cf70cebe03bba3c765fee173aacb26614276e7bb52')
R2_BUCKET = os.environ.get('R2_BUCKET', 'voyo-audio')
R2_PUBLIC_URL = 'https://pub-645c1f5179484e2ca4ec33cbf7caba84.r2.dev'

# ============================================
# PATHS
# ============================================

BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "audio_cache" / "output"

QUALITY_TIERS = ['64', '128', '192', '256']

# ============================================
# R2 CLIENT
# ============================================

def get_r2_client():
    """Create R2 client using S3-compatible API."""
    return boto3.client(
        's3',
        endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        config=Config(signature_version='s3v4')
    )

def ensure_bucket(client):
    """Create bucket if it doesn't exist."""
    try:
        client.head_bucket(Bucket=R2_BUCKET)
        print(f"   Bucket '{R2_BUCKET}' exists")
    except:
        try:
            client.create_bucket(Bucket=R2_BUCKET)
            print(f"   Created bucket '{R2_BUCKET}'")
        except Exception as e:
            print(f"   Error creating bucket: {e}")
            return False
    return True

def upload_file(client, local_path: Path, r2_key: str) -> bool:
    """Upload a file to R2."""
    try:
        client.upload_file(
            str(local_path),
            R2_BUCKET,
            r2_key,
            ExtraArgs={
                'ContentType': 'audio/opus',
                'CacheControl': 'public, max-age=31536000'  # 1 year cache
            }
        )
        return True
    except Exception as e:
        print(f"   Upload error: {e}")
        return False

def get_public_url(youtube_id: str, tier: str) -> str:
    """Get the public URL for a file."""
    # R2 public URL format (when public access is enabled)
    return f"https://pub-{R2_ACCOUNT_ID}.r2.dev/audio/{tier}/{youtube_id}.opus"

# ============================================
# MAIN
# ============================================

def main():
    parser = argparse.ArgumentParser(description='Upload audio to R2')
    parser.add_argument('--tier', choices=['64', '128', '192', '256', 'all'], default='all',
                        help='Which quality tier to upload')
    parser.add_argument('--limit', type=int, default=0,
                        help='Limit number of files (0 = all)')
    args = parser.parse_args()

    print("=" * 60)
    print("VOYO R2 UPLOAD")
    print("=" * 60)

    # Check config
    if R2_ACCESS_KEY == 'YOUR_ACCESS_KEY':
        print("\nERROR: Set R2 credentials as environment variables:")
        print("  export R2_ACCOUNT_ID='your-account-id'")
        print("  export R2_ACCESS_KEY='your-access-key'")
        print("  export R2_SECRET_KEY='your-secret-key'")
        print("\nGet these from Cloudflare Dashboard → R2 → Manage R2 API Tokens")
        return

    # Connect
    print("\n1. Connecting to R2...")
    client = get_r2_client()

    if not ensure_bucket(client):
        return

    # Get tiers to upload
    tiers = QUALITY_TIERS if args.tier == 'all' else [args.tier]

    # Upload
    print(f"\n2. Uploading audio files...")

    total_uploaded = 0
    total_failed = 0

    for tier in tiers:
        tier_dir = OUTPUT_DIR / tier
        if not tier_dir.exists():
            print(f"   Tier {tier} directory not found, skipping")
            continue

        files = list(tier_dir.glob("*.opus"))
        if args.limit > 0:
            files = files[:args.limit]

        print(f"\n   Tier {tier}k: {len(files)} files")

        for i, file_path in enumerate(files):
            youtube_id = file_path.stem
            r2_key = f"audio/{tier}/{youtube_id}.opus"

            if upload_file(client, file_path, r2_key):
                total_uploaded += 1
                if (i + 1) % 50 == 0:
                    print(f"      [{i+1}/{len(files)}] uploaded")
            else:
                total_failed += 1

    # Summary
    print(f"\n3. COMPLETE!")
    print(f"   Uploaded: {total_uploaded}")
    print(f"   Failed: {total_failed}")
    print(f"\n   Files available at:")
    print(f"   https://{R2_BUCKET}.{R2_ACCOUNT_ID}.r2.dev/audio/[tier]/[youtube_id].opus")
    print("=" * 60)

if __name__ == '__main__':
    main()
