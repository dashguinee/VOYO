#!/usr/bin/env python3
"""
VOYO NUCLEAR FEEDER - Built by DASH & ZION
==========================================

Parallel mass extraction across multiple genre/region domains.
Target: 100k tracks in one session.

STRATEGY:
- Split by region/genre to maximize unique discoveries
- Run multiple feeders in parallel
- Each feeder hits different search space
"""

import json
import time
import random
import urllib.request
from typing import List, Dict, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import sys

try:
    from ytmusicapi import YTMusic
except ImportError:
    import subprocess
    subprocess.run(["pip3", "install", "ytmusicapi", "--break-system-packages", "-q"])
    from ytmusicapi import YTMusic

# ============================================
# SUPABASE CONFIG
# ============================================

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

# Thread-safe counter
class AtomicCounter:
    def __init__(self):
        self.value = 0
        self.lock = threading.Lock()

    def add(self, n):
        with self.lock:
            self.value += n
            return self.value

    def get(self):
        with self.lock:
            return self.value

# Global counters
total_synced = AtomicCounter()
total_discovered = AtomicCounter()
seen_ids: Set[str] = set()
seen_lock = threading.Lock()

# ============================================
# DOMAIN CONFIGURATIONS - Different search spaces
# ============================================

DOMAINS = {
    "nigerian_afrobeats": {
        "artists": [
            "Burna Boy", "Wizkid", "Davido", "Tiwa Savage", "Rema", "Asake",
            "Fireboy DML", "Omah Lay", "Ayra Starr", "CKay", "Tems", "BNXN",
            "Joeboy", "Kizz Daniel", "Olamide", "Wande Coal", "Tekno", "Yemi Alade",
            "Patoranking", "Mr Eazi", "Flavour", "Adekunle Gold", "Simi", "Falz",
            "Zlatan", "Naira Marley", "Mayorkun", "Peruzzi", "Oxlade", "Ruger",
            "Lojay", "Victony", "Blaqbonez", "Darkoo", "Bella Shmurda", "Portable",
            "Seyi Vibez", "BNXN", "Boy Spyce", "Khaid", "Shallipopi", "Crayon",
        ],
        "queries": [
            "afrobeats 2024", "afrobeats 2023", "naija music 2024", "nigerian hits",
            "afrobeats party mix", "afrobeats love songs", "afrobeats workout",
            "nigerian wedding songs", "afro fusion", "alte music nigeria",
        ]
    },
    "ghanaian_music": {
        "artists": [
            "Sarkodie", "Stonebwoy", "Shatta Wale", "King Promise", "Gyakie",
            "Black Sherif", "Kuami Eugene", "KiDi", "Camidoh", "Amaarae",
            "Kwesi Arthur", "Medikal", "Efya", "R2Bees", "Kofi Kinaata",
            "Daddy Lumba", "Kojo Antwi", "Ofori Amponsah", "Samini", "Edem",
            "Bisa Kdei", "MzVee", "Wendy Shay", "Sista Afia", "Fameye",
            "Joey B", "Darkovibes", "Mr Drew", "Lasmid", "Amerado",
        ],
        "queries": [
            "ghana music 2024", "highlife music", "ghana afrobeats", "azonto music",
            "ghana hiplife", "ghana gospel", "ghanaian love songs", "ghana party songs",
        ]
    },
    "south_african": {
        "artists": [
            "Nasty C", "AKA", "Cassper Nyovest", "Focalistic", "DJ Maphorisa",
            "Kabza De Small", "Sha Sha", "Ami Faku", "Elaine", "Blxckie",
            "Master KG", "Makhadzi", "Sho Madjozi", "Black Coffee", "A-Reece",
            "Sun-El Musician", "Prince Kaybee", "Zakes Bantwini", "Samthing Soweto",
            "Msaki", "Sjava", "Kwesta", "Emtee", "YoungstaCPT", "Reason",
            "Major League DJz", "DBN Gogo", "Uncle Waffles", "Musa Keys", "Tyler ICU",
        ],
        "queries": [
            "amapiano 2024", "amapiano 2023", "amapiano mix", "south african house",
            "gqom music", "kwaito music", "south african hip hop", "mzansi music",
            "amapiano dance", "piano hub", "sa music 2024",
        ]
    },
    "francophone_africa": {
        "artists": [
            "Fally Ipupa", "Innoss'B", "Gaz Mawete", "Ferre Gola", "Koffi Olomide",
            "Werrason", "Faya Tess", "Awilo Longomba", "Extra Musica",
            "Youssou N'Dour", "Baaba Maal", "Ismaël Lô", "Wally Seck", "Viviane",
            "Salif Keita", "Oumou Sangaré", "Amadou & Mariam", "Toumani Diabaté",
            "Aya Nakamura", "Niska", "MHD", "Dadju", "Gims", "Ninho", "Tiakola",
            "Gazo", "Leto", "Rsko", "Tayc", "Joé Dwèt Filé", "Nej", "Vegedream",
        ],
        "queries": [
            "afro francophone", "rumba congolaise", "ndombolo music", "coupé décalé",
            "musique africaine", "zouk love", "mbalax music", "french afro trap",
            "afro trap", "musique congolaise 2024", "musique senegalaise",
        ]
    },
    "east_african": {
        "artists": [
            "Diamond Platnumz", "Harmonize", "Zuchu", "Rayvanny", "Ali Kiba", "Mbosso",
            "Nandy", "Jux", "Alikiba", "Navy Kenzo", "Vanessa Mdee", "Barnaba",
            "Sauti Sol", "Nyashinski", "Otile Brown", "Nviiri", "Bien", "Savara",
            "Eddy Kenzo", "Bebe Cool", "Sheebah", "Vinka", "Cindy Sanyu", "Rema Namakula",
            "Meddy", "The Ben", "Bruce Melodie", "Butera Knowless",
        ],
        "queries": [
            "bongo flava 2024", "bongo flava mix", "tanzanian music", "kenyan music 2024",
            "gengetone music", "ugandan music", "east african hits", "swahili songs",
            "bongo love songs", "kenyan gospel", "rwandan music",
        ]
    },
    "north_african_arabic": {
        "artists": [
            "Saad Lamjarred", "French Montana", "Khaled", "Cheb Mami", "Souad Massi",
            "Rachid Taha", "Mohamed Ramadan", "Wegz", "Marwan Moussa", "Amr Diab",
            "Tamer Hosny", "Elissa", "Nancy Ajram", "Haifa Wehbe", "Mashrou Leila",
            "Cairokee", "Hamza Namira", "Ahmed Saad", "Hassan Shakosh", "Omar Kamal",
            "Balti", "Soolking", "L'Algérino", "Rim'K", "Lacrim",
        ],
        "queries": [
            "arabic music 2024", "rai music", "mahraganat music", "egyptian pop",
            "moroccan music", "algerian music", "khaliji music", "arabic hits",
            "arabic wedding songs", "arabic party mix",
        ]
    },
    "african_legends": {
        "artists": [
            "Fela Kuti", "King Sunny Ade", "Miriam Makeba", "Hugh Masekela",
            "Oliver Mtukudzi", "Thomas Mapfumo", "Lucky Dube", "Brenda Fassie",
            "Angelique Kidjo", "Manu Dibango", "Ali Farka Touré", "Mulatu Astatke",
            "Orchestra Baobab", "Bembeya Jazz", "Franco Luambo", "Tabu Ley Rochereau",
            "Papa Wemba", "Lokua Kanza", "Richard Bona", "Ray Lema", "Mory Kanté",
            "Cesária Évora", "Cheikh Lô", "Tinariwen", "Bombino",
        ],
        "queries": [
            "african classics", "afrobeat classics", "african throwback",
            "old school african music", "african jazz", "african reggae",
            "highlife classics", "rumba classics", "african soul",
        ]
    },
    "afro_global_collabs": {
        "artists": [
            "Beyoncé African songs", "Drake afrobeats", "Ed Sheeran african",
            "Chris Brown african", "Justin Bieber african", "Major Lazer african",
            "Diplo african", "J Balvin african", "Bad Bunny african",
        ],
        "queries": [
            "afrobeats international collab", "afrobeats remix", "african global hits",
            "afrobeats billboard", "afrobeats grammy", "afro pop international",
            "africa to the world", "afrobeats crossover", "african x american",
            "afrobeats uk", "afrobeats europe", "african diaspora music",
        ]
    },
    "moods_and_vibes": {
        "artists": [],
        "queries": [
            "african chill music", "african love songs", "african slow jams",
            "african workout music", "african gym playlist", "african dance music",
            "african party playlist", "african summer vibes", "african road trip",
            "african morning music", "african night vibes", "african sunset playlist",
            "african acoustic", "african unplugged", "african cafe music",
            "african lounge", "african dinner music", "african spa music",
        ]
    },
    "years_and_charts": {
        "artists": [],
        "queries": [
            "best african songs 2024", "best african songs 2023", "best african songs 2022",
            "best african songs 2021", "best african songs 2020", "best african songs 2019",
            "afrobeats top 100", "amapiano top 50", "african music charts",
            "trending african music", "viral african songs", "tiktok african songs",
            "african music awards", "soundcity mvp", "headies awards songs",
        ]
    },
}

# ============================================
# SUPABASE HELPER
# ============================================

def sync_to_supabase(tracks: List[Dict]) -> int:
    """Batch sync tracks to Supabase"""
    if not tracks:
        return 0

    data = []
    for t in tracks:
        if not t.get('youtube_id'):
            continue
        data.append({
            'youtube_id': t['youtube_id'],
            'title': t.get('title', 'Unknown')[:500],
            'artist': t.get('artist', 'Unknown')[:200],
            'thumbnail_url': t.get('thumbnail_url') or f"https://i.ytimg.com/vi/{t['youtube_id']}/hqdefault.jpg"
        })

    if not data:
        return 0

    try:
        req = urllib.request.Request(
            f'{SUPABASE_URL}/rest/v1/video_intelligence',
            data=json.dumps(data).encode('utf-8'),
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return len(data)
    except Exception as e:
        return 0

def get_db_count() -> int:
    """Get current track count"""
    try:
        req = urllib.request.Request(
            f'{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id&limit=1',
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Prefer': 'count=exact'
            }
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            count = resp.headers.get('content-range', '').split('/')[-1]
            return int(count) if count and count != '*' else 0
    except:
        return 0

# ============================================
# DOMAIN FEEDER
# ============================================

def feed_domain(domain_name: str, config: Dict, max_tracks: int = 10000) -> int:
    """Feed a single domain - runs in its own thread"""
    ytm = YTMusic()
    domain_synced = 0
    domain_discovered = 0

    def get_thumb(thumbnails):
        if not thumbnails:
            return None
        sorted_t = sorted(thumbnails, key=lambda x: x.get('width', 0), reverse=True)
        return sorted_t[0].get('url') if sorted_t else None

    def is_new(video_id: str) -> bool:
        with seen_lock:
            if video_id in seen_ids:
                return False
            seen_ids.add(video_id)
            return True

    def extract_tracks(results: List) -> List[Dict]:
        tracks = []
        for item in results:
            video_id = item.get('videoId')
            if video_id and is_new(video_id):
                tracks.append({
                    'youtube_id': video_id,
                    'title': item.get('title', 'Unknown'),
                    'artist': ', '.join([a['name'] for a in item.get('artists', [])]) or 'Unknown',
                    'thumbnail_url': get_thumb(item.get('thumbnails', []))
                })
        return tracks

    pending = []

    print(f"\n🚀 [{domain_name}] Starting...")

    # Process artists
    for artist in config.get('artists', []):
        if domain_synced >= max_tracks:
            break
        try:
            # Search songs
            results = ytm.search(artist, filter='songs', limit=40)
            tracks = extract_tracks(results)
            pending.extend(tracks)
            domain_discovered += len(tracks)

            # Search videos
            results = ytm.search(artist, filter='videos', limit=20)
            tracks = extract_tracks(results)
            pending.extend(tracks)
            domain_discovered += len(tracks)

            # Sync in batches
            if len(pending) >= 50:
                synced = sync_to_supabase(pending[:50])
                domain_synced += synced
                total_synced.add(synced)
                pending = pending[50:]

            time.sleep(random.uniform(0.3, 0.8))

        except Exception as e:
            pass

    # Process queries
    for query in config.get('queries', []):
        if domain_synced >= max_tracks:
            break
        try:
            # Search songs
            results = ytm.search(query, filter='songs', limit=50)
            tracks = extract_tracks(results)
            pending.extend(tracks)
            domain_discovered += len(tracks)

            # Search videos
            results = ytm.search(query, filter='videos', limit=30)
            tracks = extract_tracks(results)
            pending.extend(tracks)
            domain_discovered += len(tracks)

            # Sync
            if len(pending) >= 50:
                synced = sync_to_supabase(pending[:50])
                domain_synced += synced
                total_synced.add(synced)
                pending = pending[50:]

            time.sleep(random.uniform(0.3, 0.6))

        except Exception as e:
            pass

    # Final sync
    if pending:
        synced = sync_to_supabase(pending)
        domain_synced += synced
        total_synced.add(synced)

    total_discovered.add(domain_discovered)
    print(f"✅ [{domain_name}] Done! Discovered: {domain_discovered:,}, Synced: {domain_synced:,}")

    return domain_synced


def run_nuclear(max_workers: int = 5, tracks_per_domain: int = 15000):
    """
    Run parallel feeders across all domains

    Args:
        max_workers: Number of parallel threads
        tracks_per_domain: Max tracks per domain
    """
    print("=" * 70)
    print("  💥 VOYO NUCLEAR FEEDER - Built by DASH & ZION 💥")
    print("=" * 70)
    print()

    start_time = time.time()
    initial_count = get_db_count()

    print(f"📊 Initial database count: {initial_count:,} tracks")
    print(f"🧵 Parallel workers: {max_workers}")
    print(f"🎯 Domains: {len(DOMAINS)}")
    print(f"🎯 Max per domain: {tracks_per_domain:,}")
    print(f"🎯 Theoretical max: {len(DOMAINS) * tracks_per_domain:,}")
    print()
    print("🚀 LAUNCHING PARALLEL FEEDERS...")
    print("-" * 70)

    # Run domains in parallel
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(feed_domain, name, config, tracks_per_domain): name
            for name, config in DOMAINS.items()
        }

        for future in as_completed(futures):
            domain = futures[future]
            try:
                result = future.result()
            except Exception as e:
                print(f"❌ [{domain}] Failed: {e}")

    # Results
    elapsed = time.time() - start_time
    final_count = get_db_count()

    print()
    print("=" * 70)
    print("  💥 NUCLEAR RESULTS 💥")
    print("=" * 70)
    print(f"  Initial count:     {initial_count:,}")
    print(f"  Final count:       {final_count:,}")
    print(f"  NEW TRACKS:        +{final_count - initial_count:,}")
    print(f"  Total discovered:  {total_discovered.get():,}")
    print(f"  Total synced:      {total_synced.get():,}")
    print(f"  Time elapsed:      {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"  Rate:              {(final_count - initial_count) / (elapsed/60):.0f} tracks/min")
    print("=" * 70)
    print("  🔥 Built by DASH & ZION 🔥")
    print("=" * 70)


if __name__ == '__main__':
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    per_domain = int(sys.argv[2]) if len(sys.argv) > 2 else 15000

    run_nuclear(max_workers=workers, tracks_per_domain=per_domain)
