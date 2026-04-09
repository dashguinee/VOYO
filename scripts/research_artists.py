#!/usr/bin/env python3
"""
VOYO Artist Research Pipeline

Research and tier artists by country using VOYO API for view counts.
Creates verified artist database for canonization.

Usage:
    python3 scripts/research_artists.py --country guinea
    python3 scripts/research_artists.py --artists "Burna Boy,Wizkid,Davido"
"""

import json
import argparse
import urllib.request
import urllib.parse
import time
from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

VOYO_API = "https://voyo-music-api.fly.dev"

# Tier thresholds based on view counts
TIER_THRESHOLDS = {
    'A': {'total': 10_000_000, 'top': 5_000_000},   # 10M+ total OR 5M+ top track
    'B': {'total': 1_000_000, 'top': 500_000},      # 1M+ total OR 500K+ top
    'C': {'total': 100_000, 'top': 50_000},         # 100K+ total OR 50K+ top
    'D': {'total': 0, 'top': 0},                     # Everything else
}

@dataclass
class ArtistData:
    name: str
    country: str
    tier: str
    total_views: int
    top_track_views: int
    track_count: int
    top_tracks: List[Dict]
    verified_at: str
    source: str = "voyo_api"

def fetch_artist_views(artist_name: str, limit: int = 10) -> Optional[Dict]:
    """Query VOYO API for artist's tracks and aggregate views."""
    try:
        encoded = urllib.parse.quote(artist_name)
        url = f"{VOYO_API}/api/search?q={encoded}&limit={limit}"

        req = urllib.request.Request(url, headers={'User-Agent': 'VOYO-Research/1.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode())

        results = data.get('results', [])
        if not results:
            return None

        total_views = sum(r.get('views', 0) for r in results)
        top_views = max(r.get('views', 0) for r in results)

        top_tracks = sorted(results, key=lambda x: x.get('views', 0), reverse=True)[:5]

        return {
            'total_views': total_views,
            'top_track_views': top_views,
            'track_count': len(results),
            'top_tracks': [{
                'title': t.get('title', ''),
                'views': t.get('views', 0),
                'voyoId': t.get('voyoId', ''),
            } for t in top_tracks]
        }
    except Exception as e:
        print(f"  [!] Error fetching {artist_name}: {e}")
        return None

def calculate_tier(total_views: int, top_views: int) -> str:
    """Determine artist tier based on view counts."""
    if total_views >= TIER_THRESHOLDS['A']['total'] or top_views >= TIER_THRESHOLDS['A']['top']:
        return 'A'
    elif total_views >= TIER_THRESHOLDS['B']['total'] or top_views >= TIER_THRESHOLDS['B']['top']:
        return 'B'
    elif total_views >= TIER_THRESHOLDS['C']['total'] or top_views >= TIER_THRESHOLDS['C']['top']:
        return 'C'
    else:
        return 'D'

def research_artists(artists: List[str], country: str) -> List[ArtistData]:
    """Research a list of artists and return verified data."""
    verified = []

    print(f"\n{'='*60}")
    print(f"RESEARCHING {len(artists)} ARTISTS FROM {country.upper()}")
    print(f"{'='*60}\n")

    for i, artist in enumerate(artists, 1):
        print(f"[{i}/{len(artists)}] {artist}...", end=" ", flush=True)

        data = fetch_artist_views(artist)

        if data and data['total_views'] > 0:
            tier = calculate_tier(data['total_views'], data['top_track_views'])
            artist_data = ArtistData(
                name=artist,
                country=country,
                tier=tier,
                total_views=data['total_views'],
                top_track_views=data['top_track_views'],
                track_count=data['track_count'],
                top_tracks=data['top_tracks'],
                verified_at=datetime.now().isoformat(),
            )
            verified.append(artist_data)
            print(f"✓ TIER {tier} | {data['total_views']:,} views | Top: {data['top_track_views']:,}")
        else:
            print("✗ No data")

        time.sleep(0.3)  # Rate limiting

    return verified

# Pre-built artist lists by country
COUNTRY_ARTISTS = {
    'guinea': [
        # Legends
        "Mory Kanté", "Sékouba Bambino", "Bembeya Jazz National",
        "Momo Wandel Soumah", "Mamady Keïta", "Sory Kandia Kouyaté",
        "Keletigui et ses Tambourinis", "Les Amazones de Guinée",
        # Modern Stars
        "Takana Zion", "Soul Bang's", "Azaya", "Instinct Killers",
        "King Alasko", "Koury Simple", "Saifond Baldé", "Thiird",
        "Grand P", "Ba Cissoko", "Sia Tolno", "Djélykaba Bintou",
        # Regional
        "Lama Sidibé", "Kandia Kora", "Kerfala Kanté", "Manambé",
        "Miss Kala Kala", "Moh Kouyaté", "N'famady Kouyaté",
    ],
    'nigeria': [
        # Global Icons
        "Burna Boy", "Wizkid", "Davido", "Fela Kuti", "Tiwa Savage",
        "Rema", "Asake", "Ayra Starr", "Tems", "CKay", "Omah Lay",
        "Fireboy DML", "Olamide", "Yemi Alade", "Joeboy", "Ruger",
        "BNXN", "Pheelz", "Victony", "Lojay", "Kizz Daniel",
        # Legends
        "2Baba", "P-Square", "D'banj", "Don Jazzy", "Wande Coal",
        "Flavour", "Phyno", "Timaya", "Mr Eazi", "Tekno",
        # Rising
        "Rema", "Oxlade", "Bella Shmurda", "Zinoleesky", "Seyi Vibez",
    ],
    'south-africa': [
        # Amapiano/House
        "Kabza De Small", "DJ Maphorisa", "Black Coffee", "Focalistic",
        "Uncle Waffles", "Young Stunna", "DBN Gogo", "Mas Musiq",
        "Kelvin Momo", "Tyler ICU", "De Mthuda", "Vigro Deep",
        # Hip Hop
        "Nasty C", "Cassper Nyovest", "AKA", "A-Reece",
        # Other
        "Tyla", "Makhadzi", "Master KG", "Zakes Bantwini",
    ],
    'ghana': [
        "Black Sherif", "King Promise", "Sarkodie", "Stonebwoy",
        "Shatta Wale", "Kuami Eugene", "KiDi", "Medikal",
        "Gyakie", "Camidoh", "Kwesi Arthur", "R2Bees", "Efya",
        "Bisa Kdei", "Kofi Kinaata", "Darkovibes", "Joey B",
    ],
    'tanzania': [
        "Diamond Platnumz", "Harmonize", "Zuchu", "Rayvanny",
        "Nandy", "Mbosso", "Ali Kiba", "Alikiba", "Jux",
        "Lava Lava", "Marioo", "Darassa", "Navy Kenzo",
    ],
    'kenya': [
        "Sauti Sol", "Nyashinski", "Khaligraph Jones", "Otile Brown",
        "Nviiri the Storyteller", "Bien", "Bensoul", "Karun",
        "Femi One", "Nadia Mukami", "Willy Paul", "Bahati",
    ],
    'drc': [
        "Fally Ipupa", "Innoss'B", "Koffi Olomide", "Papa Wemba",
        "Ferre Gola", "Héritier Watanabe", "Werrason", "JB Mpiana",
        "Gaz Mawete", "Gims", "Dadju",
    ],
    'senegal': [
        "Youssou N'Dour", "Akon", "Wally Seck", "Viviane Chidid",
        "Dip Doundou Guiss", "Ngaaka Blindé", "Pape Diouf",
        "Baaba Maal", "Ismaël Lô", "Thione Seck", "Coumba Gawlo",
    ],
}

def main():
    parser = argparse.ArgumentParser(description='Research and tier artists by country')
    parser.add_argument('--country', type=str, help='Country to research (e.g., guinea, nigeria)')
    parser.add_argument('--artists', type=str, help='Comma-separated list of artist names')
    parser.add_argument('--output', type=str, help='Output JSON file path')
    args = parser.parse_args()

    # Determine artists to research
    if args.artists:
        artists = [a.strip() for a in args.artists.split(',')]
        country = "custom"
    elif args.country:
        country = args.country.lower()
        if country not in COUNTRY_ARTISTS:
            print(f"Country '{country}' not found. Available: {', '.join(COUNTRY_ARTISTS.keys())}")
            return
        artists = COUNTRY_ARTISTS[country]
    else:
        print("Please specify --country or --artists")
        return

    # Research
    verified = research_artists(artists, country)

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")

    by_tier = {'A': [], 'B': [], 'C': [], 'D': []}
    for artist in verified:
        by_tier[artist.tier].append(artist)

    for tier in ['A', 'B', 'C', 'D']:
        if by_tier[tier]:
            print(f"\nTIER {tier} ({len(by_tier[tier])} artists):")
            for a in sorted(by_tier[tier], key=lambda x: x.total_views, reverse=True):
                print(f"  {a.name:30} | {a.total_views:>12,} views")

    print(f"\nNOT FOUND: {len(artists) - len(verified)} artists")

    # Save output
    output_path = args.output or f"data/artists_{country}.json"
    output_data = {
        'country': country,
        'researched_at': datetime.now().isoformat(),
        'total_artists': len(verified),
        'by_tier': {
            'A': len(by_tier['A']),
            'B': len(by_tier['B']),
            'C': len(by_tier['C']),
            'D': len(by_tier['D']),
        },
        'artists': [asdict(a) for a in verified]
    }

    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=2)

    print(f"\nSaved to: {output_path}")

if __name__ == '__main__':
    main()
