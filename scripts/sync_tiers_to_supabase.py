#!/usr/bin/env python3
"""
Sync Artist Tiers to Supabase

1. Add artist_tier column to video_intelligence table
2. Batch update all tracks with artist tiers
3. Add artist_country, canon_level columns

Usage:
    python3 scripts/sync_tiers_to_supabase.py
"""

import json
import os
import re
from pathlib import Path
from datetime import datetime
import urllib.request
import urllib.parse

# Supabase config
SUPABASE_URL = "https://jnqgjsgqlnvhakpfeify.supabase.co"
SUPABASE_KEY = os.environ.get('SUPABASE_KEY') or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpucWdqc2dxbG52aGFrcGZlaWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0MDE5NjQsImV4cCI6MjA1MDk3Nzk2NH0.Se0CwxsWHFNOkDfOhxzfwUS9jHNkY3nPWM2s0JQEPN4"

DATA_DIR = Path(__file__).parent.parent / "data"

def normalize_name(name: str) -> str:
    """Normalize artist name for matching."""
    name = name.lower()
    name = re.sub(r'\s*(official|music|vevo|records|entertainment|topic|-\s*topic)$', '', name)
    name = re.sub(r'[^\w\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name

def load_artist_tiers():
    """Load artist tier lookup from JSON files."""
    artists = {}

    for filepath in DATA_DIR.glob("artists_*_complete.json"):
        with open(filepath) as f:
            data = json.load(f)

        country = data.get('country', 'unknown')

        def add(items, tier):
            for artist in items:
                name = artist['name'] if isinstance(artist, dict) else artist
                norm = normalize_name(name)
                if norm and (norm not in artists or tier < artists[norm]['tier']):
                    artists[norm] = {'tier': tier, 'name': name, 'country': country}
                    # Also add without spaces
                    nospace = norm.replace(' ', '')
                    if nospace != norm:
                        artists[nospace] = artists[norm]

        # Load all tiers
        for src in ['tier_a', 'tier_a_global', 'tier_a_continental', 'tier_a_verified', 'tier_a_legends']:
            if src in data:
                items = data[src]['artists'] if isinstance(data[src], dict) and 'artists' in data[src] else data[src]
                add(items, 'A')

        for src in ['tier_b', 'tier_b_verified', 'tier_b_national', 'tier_b_gospel', 'tier_b_alte', 'tier_b_amapiano', 'tier_b_hiphop', 'tier_b_other']:
            if src in data:
                items = data[src]['artists'] if isinstance(data[src], dict) and 'artists' in data[src] else data[src]
                add(items, 'B')

        for src in ['tier_c', 'tier_c_verified', 'tier_c_regional', 'tier_c_hausa', 'tier_c_kwaito_gqom', 'tier_c_legends', 'tier_c_gospel', 'tier_c_highlife_legends']:
            if src in data:
                items = data[src]['artists'] if isinstance(data[src], dict) and 'artists' in data[src] else data[src]
                add(items, 'C')

    # Extra countries
    extra_path = DATA_DIR / "artists_more_countries.json"
    if extra_path.exists():
        with open(extra_path) as f:
            extra = json.load(f)
        for country, tiers in extra.get('countries', {}).items():
            for artist in tiers.get('tier_a', []):
                norm = normalize_name(artist)
                if norm and norm not in artists:
                    artists[norm] = {'tier': 'A', 'name': artist, 'country': country}
            for artist in tiers.get('tier_b', []):
                norm = normalize_name(artist)
                if norm and norm not in artists:
                    artists[norm] = {'tier': 'B', 'name': artist, 'country': country}

    return artists

def supabase_request(method: str, endpoint: str, data: dict = None, params: dict = None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status in [200, 201, 204]:
                try:
                    return json.loads(response.read().decode())
                except:
                    return True
            return None
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}")
        try:
            print(e.read().decode())
        except:
            pass
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None

def fetch_all_tracks(batch_size: int = 1000):
    """Fetch all tracks from Supabase in batches."""
    tracks = []
    offset = 0

    while True:
        print(f"  Fetching tracks {offset} to {offset + batch_size}...")

        url = f"{SUPABASE_URL}/rest/v1/video_intelligence"
        params = {
            'select': 'youtube_id,artist',
            'limit': batch_size,
            'offset': offset
        }
        url += "?" + urllib.parse.urlencode(params)

        headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
        }

        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                batch = json.loads(response.read().decode())
                if not batch:
                    break
                tracks.extend(batch)
                offset += batch_size
                if len(batch) < batch_size:
                    break
        except Exception as e:
            print(f"Error fetching: {e}")
            break

    return tracks

def update_track_tier(youtube_id: str, tier: str, country: str = None):
    """Update a single track's tier in Supabase."""
    data = {
        'artist_tier': tier,
        'canon_level': 'ESSENTIAL' if tier == 'A' else 'DEEP_CUT' if tier == 'B' else 'ECHO'
    }
    if country:
        data['artist_country'] = country

    return supabase_request(
        'PATCH',
        'video_intelligence',
        data=data,
        params={'youtube_id': f'eq.{youtube_id}'}
    )

def batch_update_tiers(updates: list):
    """Batch update tiers using Supabase RPC or multiple requests."""
    success = 0
    for update in updates:
        result = update_track_tier(
            update['youtube_id'],
            update['tier'],
            update.get('country')
        )
        if result is not None:
            success += 1
    return success

def main():
    print("=" * 60)
    print("SYNC ARTIST TIERS TO SUPABASE")
    print("=" * 60)

    # Load artist tiers
    print("\n1. Loading artist tier database...")
    artist_tiers = load_artist_tiers()
    print(f"   Loaded {len(artist_tiers)} artist name variations")

    # Fetch tracks from Supabase
    print("\n2. Fetching tracks from Supabase...")
    tracks = fetch_all_tracks()
    print(f"   Fetched {len(tracks):,} tracks")

    if not tracks:
        print("   ERROR: Could not fetch tracks. Check Supabase connection.")
        return

    # Match artists to tiers
    print("\n3. Matching artists to tiers...")
    updates = []
    matched = 0

    for track in tracks:
        artist = track.get('artist', '') or ''
        norm = normalize_name(artist)

        info = artist_tiers.get(norm) or artist_tiers.get(norm.replace(' ', ''))

        if info:
            updates.append({
                'youtube_id': track['youtube_id'],
                'tier': info['tier'],
                'country': info.get('country')
            })
            matched += 1

    print(f"   Matched {matched:,} / {len(tracks):,} tracks ({matched/len(tracks)*100:.1f}%)")

    # Update Supabase
    print(f"\n4. Updating Supabase ({len(updates):,} tracks)...")
    print("   This may take a while...")

    batch_size = 100
    total_success = 0

    for i in range(0, len(updates), batch_size):
        batch = updates[i:i + batch_size]
        success = batch_update_tiers(batch)
        total_success += success

        if (i + batch_size) % 1000 == 0:
            print(f"   Progress: {i + batch_size:,} / {len(updates):,}")

    print(f"\n   Successfully updated {total_success:,} tracks")

    print("\n" + "=" * 60)
    print("SYNC COMPLETE")
    print("=" * 60)

if __name__ == '__main__':
    main()
