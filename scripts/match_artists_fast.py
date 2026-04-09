#!/usr/bin/env python3
"""
FAST Artist-to-Track Matcher

Uses exact matching only (no slow fuzzy matching).
Build a lookup table for O(1) matching.
"""

import json
import re
from pathlib import Path
from datetime import datetime

DATA_DIR = Path(__file__).parent.parent / "data"

def normalize_name(name: str) -> str:
    """Normalize artist name for matching."""
    name = name.lower()
    # Remove common suffixes
    name = re.sub(r'\s*(official|music|vevo|records|entertainment|topic|-\s*topic)$', '', name)
    # Remove special characters
    name = re.sub(r'[^\w\s]', '', name)
    # Collapse whitespace
    name = re.sub(r'\s+', ' ', name).strip()
    return name

def build_artist_lookup():
    """Build lookup table from all artist files."""
    lookup = {}  # normalized_name -> {'tier': X, 'original': Y}

    # Additional name variations for major artists
    variations = {
        # Burna Boy variations
        'burna boy': 'burna boy', 'burnaboy': 'burna boy', 'burna': 'burna boy',
        # Wizkid variations
        'wizkid': 'wizkid', 'wiz kid': 'wizkid', 'starboy': 'wizkid',
        # Davido variations
        'davido': 'davido', 'david adeleke': 'davido', 'obo': 'davido',
        # Others
        'fela': 'fela kuti', 'fela kuti': 'fela kuti', 'fela anikulapo': 'fela kuti',
        'diamond': 'diamond platnumz', 'diamond platnumz': 'diamond platnumz',
        'black coffee': 'black coffee', 'blackcoffee': 'black coffee',
        'tyla': 'tyla', 'tyla seethal': 'tyla',
    }

    # Load complete country files
    for filepath in DATA_DIR.glob("artists_*_complete.json"):
        with open(filepath) as f:
            data = json.load(f)

        country = data.get('country', 'unknown')

        def add_artists(items, tier):
            for artist in items:
                name = artist['name'] if isinstance(artist, dict) else artist
                norm = normalize_name(name)
                if norm and (norm not in lookup or tier < lookup[norm]['tier']):
                    lookup[norm] = {'tier': tier, 'original': name, 'country': country}
                    # Also add without spaces
                    nospace = norm.replace(' ', '')
                    if nospace != norm:
                        lookup[nospace] = lookup[norm]

        # Tier A
        for source in ['tier_a', 'tier_a_global', 'tier_a_continental', 'tier_a_verified', 'tier_a_legends']:
            if source in data:
                items = data[source]
                if isinstance(items, dict) and 'artists' in items:
                    items = items['artists']
                add_artists(items, 'A')

        # Tier B
        for source in ['tier_b', 'tier_b_verified', 'tier_b_national', 'tier_b_gospel', 'tier_b_alte', 'tier_b_amapiano', 'tier_b_hiphop', 'tier_b_other']:
            if source in data:
                items = data[source]
                if isinstance(items, dict) and 'artists' in items:
                    items = items['artists']
                add_artists(items, 'B')

        # Tier C
        for source in ['tier_c', 'tier_c_verified', 'tier_c_regional', 'tier_c_hausa', 'tier_c_kwaito_gqom', 'tier_c_legends', 'tier_c_gospel', 'tier_c_highlife_legends']:
            if source in data:
                items = data[source]
                if isinstance(items, dict) and 'artists' in items:
                    items = items['artists']
                add_artists(items, 'C')

    # Load extra countries
    extra_path = DATA_DIR / "artists_more_countries.json"
    if extra_path.exists():
        with open(extra_path) as f:
            extra = json.load(f)

        for country, tiers in extra.get('countries', {}).items():
            for artist in tiers.get('tier_a', []):
                norm = normalize_name(artist)
                if norm and norm not in lookup:
                    lookup[norm] = {'tier': 'A', 'original': artist, 'country': country}
            for artist in tiers.get('tier_b', []):
                norm = normalize_name(artist)
                if norm and norm not in lookup:
                    lookup[norm] = {'tier': 'B', 'original': artist, 'country': country}

    # Add variations
    for var, main in variations.items():
        if main in lookup and var not in lookup:
            lookup[var] = lookup[main]

    return lookup

def match_tracks(canonized_path: str):
    """Match tracks using fast exact lookup."""
    print("=" * 60)
    print("FAST ARTIST-TO-TRACK MATCHER")
    print("=" * 60)

    # Build lookup
    print("\nBuilding artist lookup table...")
    lookup = build_artist_lookup()
    print(f"  Loaded {len(lookup)} name variations")

    # Count by tier
    tiers = {'A': set(), 'B': set(), 'C': set()}
    for info in lookup.values():
        tiers[info['tier']].add(info['original'])
    print(f"  Unique artists: A={len(tiers['A'])}, B={len(tiers['B'])}, C={len(tiers['C'])}")

    # Load tracks
    print(f"\nLoading {canonized_path}...")
    with open(canonized_path) as f:
        data = json.load(f)

    tracks = data.get('tracks', [])
    print(f"  Loaded {len(tracks):,} tracks")

    # Match
    print("\nMatching (fast O(1) lookup)...")
    results = {'A': 0, 'B': 0, 'C': 0, 'D': 0, 'matched': 0}
    matched_artists = {}

    for track in tracks:
        artist = track.get('artist', '')
        norm = normalize_name(artist)

        # Try exact match
        info = lookup.get(norm)

        # Try without spaces
        if not info:
            info = lookup.get(norm.replace(' ', ''))

        # Try first part only (for "Artist - Topic" style)
        if not info and ' ' in artist:
            first_part = normalize_name(artist.split()[0])
            info = lookup.get(first_part)

        if info:
            track['tier'] = info['tier']
            track['matched_artist'] = info['original']
            track['tier_source'] = 'exact_match'
            results[info['tier']] += 1
            results['matched'] += 1
            matched_artists[info['original']] = matched_artists.get(info['original'], 0) + 1
        else:
            track['tier'] = 'D'
            track['tier_source'] = 'default'
            track['matched_artist'] = None
            results['D'] += 1

        # Update canon level
        if track['tier'] == 'A':
            track['canon_level'] = 'ESSENTIAL'
        elif track['tier'] == 'B':
            track['canon_level'] = 'DEEP_CUT'
        else:
            track['canon_level'] = 'ECHO'

    # Save
    output = {
        'version': 'v5-artist-matched',
        'generated_at': datetime.now().isoformat(),
        'total_tracks': len(tracks),
        'statistics': {
            'by_tier': {'A': results['A'], 'B': results['B'], 'C': results['C'], 'D': results['D']},
            'matched': results['matched'],
            'unmatched': results['D'],
            'match_rate': f"{results['matched'] / len(tracks) * 100:.1f}%"
        },
        'top_matched_artists': sorted(matched_artists.items(), key=lambda x: -x[1])[:50],
        'tracks': tracks
    }

    output_path = canonized_path.replace('.json', '_v5_artist_matched.json')
    print(f"\nSaving to {output_path}...")
    with open(output_path, 'w') as f:
        json.dump(output, f)

    # Results
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Tier A: {results['A']:,} ({results['A']/len(tracks)*100:.1f}%)")
    print(f"Tier B: {results['B']:,} ({results['B']/len(tracks)*100:.1f}%)")
    print(f"Tier C: {results['C']:,} ({results['C']/len(tracks)*100:.1f}%)")
    print(f"Tier D: {results['D']:,} ({results['D']/len(tracks)*100:.1f}%)")
    print()
    print(f"Match Rate: {results['matched']:,} / {len(tracks):,} = {results['matched']/len(tracks)*100:.1f}%")
    print()
    print("Top 15 Matched Artists:")
    for artist, count in sorted(matched_artists.items(), key=lambda x: -x[1])[:15]:
        print(f"  {artist}: {count:,} tracks")

if __name__ == '__main__':
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else str(DATA_DIR / "canonized_v4.json")
    match_tracks(path)
