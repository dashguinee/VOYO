#!/usr/bin/env python3
"""
VOYO AUTONOMOUS BEAST - Built by DASH & ZION
=============================================

NON-STOP. NO RESTRAINTS. UNTIL WE HIT THE GOAL.

Runs continuously, cycling through all domains,
generating new queries, expanding artist networks.
"""

import json
import time
import random
import urllib.request
from typing import List, Dict, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import sys
from datetime import datetime

try:
    from ytmusicapi import YTMusic
except ImportError:
    import subprocess
    subprocess.run(["pip3", "install", "ytmusicapi", "--break-system-packages", "-q"])
    from ytmusicapi import YTMusic

# ============================================
# CONFIG
# ============================================

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

TARGET_TRACKS = 200000  # 200k goal

# Thread-safe
class AtomicCounter:
    def __init__(self, initial=0):
        self.value = initial
        self.lock = threading.Lock()
    def add(self, n):
        with self.lock:
            self.value += n
            return self.value
    def get(self):
        with self.lock:
            return self.value
    def set(self, n):
        with self.lock:
            self.value = n

total_synced = AtomicCounter()
seen_ids: Set[str] = set()
seen_lock = threading.Lock()
round_count = AtomicCounter()

# ============================================
# MEGA DATABASE - EVERYTHING x10
# ============================================

# All the artists we know
ALL_ARTISTS = [
    # NIGERIA - MASSIVE
    "Burna Boy", "Wizkid", "Davido", "Tiwa Savage", "Rema", "Asake", "Fireboy DML",
    "Omah Lay", "Ayra Starr", "CKay", "Tems", "BNXN", "Joeboy", "Kizz Daniel",
    "Olamide", "Wande Coal", "Tekno", "Yemi Alade", "Patoranking", "Mr Eazi",
    "Flavour", "Adekunle Gold", "Simi", "Falz", "Zlatan", "Naira Marley",
    "Mayorkun", "Peruzzi", "Oxlade", "Ruger", "Lojay", "Victony", "Blaqbonez",
    "Bella Shmurda", "Portable", "Seyi Vibez", "Boy Spyce", "Khaid", "Shallipopi",
    "Crayon", "Chike", "Johnny Drille", "Ladipoe", "Reminisce", "Phyno", "Zoro",
    "2Baba", "D'banj", "Don Jazzy", "P-Square", "Timaya", "Duncan Mighty",
    "Banky W", "9ice", "Asa", "Omawumi", "Waje", "Chidinma", "Sinach",
    "Frank Edwards", "Mercy Chinwo", "Nathaniel Bassey", "Tope Alabi",

    # GHANA
    "Sarkodie", "Stonebwoy", "Shatta Wale", "King Promise", "Gyakie", "Black Sherif",
    "Kuami Eugene", "KiDi", "Camidoh", "Amaarae", "Kwesi Arthur", "Medikal",
    "Efya", "R2Bees", "Kofi Kinaata", "Daddy Lumba", "Kojo Antwi", "Samini",
    "Bisa Kdei", "MzVee", "Wendy Shay", "Fameye", "Darkovibes", "Lasmid",

    # SOUTH AFRICA
    "Nasty C", "AKA", "Cassper Nyovest", "Focalistic", "DJ Maphorisa", "Kabza De Small",
    "Sha Sha", "Ami Faku", "Elaine", "Blxckie", "Master KG", "Makhadzi",
    "Sho Madjozi", "Black Coffee", "A-Reece", "Sun-El Musician", "Prince Kaybee",
    "Major League DJz", "DBN Gogo", "Uncle Waffles", "Musa Keys", "Tyler ICU",
    "Costa Titch", "Kamo Mphela", "Young Stunna", "Kelvin Momo", "De Mthuda",
    "Brenda Fassie", "Hugh Masekela", "Miriam Makeba", "Lucky Dube", "Ladysmith Black Mambazo",

    # EAST AFRICA
    "Diamond Platnumz", "Harmonize", "Zuchu", "Rayvanny", "Ali Kiba", "Mbosso",
    "Nandy", "Jux", "Sauti Sol", "Nyashinski", "Otile Brown", "Khaligraph Jones",
    "Eddy Kenzo", "Bebe Cool", "Sheebah", "Jose Chameleone", "Meddy", "Bruce Melodie",
    "Teddy Afro", "Aster Aweke", "Mulatu Astatke",

    # FRANCOPHONE AFRICA
    "Fally Ipupa", "Innoss'B", "Gaz Mawete", "Ferre Gola", "Koffi Olomide",
    "Papa Wemba", "Werrason", "Franco Luambo", "Youssou N'Dour", "Baaba Maal",
    "Salif Keita", "Oumou Sangaré", "Amadou & Mariam", "Aya Nakamura", "Niska",
    "MHD", "Dadju", "Gims", "Ninho", "Tiakola", "Tayc", "Vegedream",
    "DJ Arafat", "Serge Beynaud", "Magic System", "Alpha Blondy",

    # NORTH AFRICA / ARABIC
    "Amr Diab", "Tamer Hosny", "Mohamed Ramadan", "Wegz", "Saad Lamjarred",
    "Khaled", "Cheb Mami", "Soolking", "French Montana", "DJ Snake",

    # USA HIP HOP
    "Drake", "Kendrick Lamar", "J. Cole", "Travis Scott", "Future", "Lil Baby",
    "Gunna", "Young Thug", "21 Savage", "Lil Durk", "Polo G", "Rod Wave",
    "NBA YoungBoy", "Megan Thee Stallion", "Cardi B", "Nicki Minaj", "Doja Cat",
    "Ice Spice", "Metro Boomin", "Don Toliver", "Tyler the Creator", "A$AP Rocky",
    "Jay-Z", "Nas", "Kanye West", "50 Cent", "Lil Wayne", "Snoop Dogg",
    "Eminem", "OutKast", "Tupac", "Notorious B.I.G.", "Wu-Tang Clan",

    # USA R&B
    "SZA", "Summer Walker", "Kehlani", "Jhené Aiko", "H.E.R.", "Daniel Caesar",
    "Giveon", "Brent Faiyaz", "Chris Brown", "The Weeknd", "Frank Ocean",
    "Beyoncé", "Rihanna", "Usher", "Alicia Keys", "Mary J. Blige",
    "Erykah Badu", "D'Angelo", "Michael Jackson", "Prince", "Stevie Wonder",

    # CARIBBEAN
    "Bob Marley", "Vybz Kartel", "Popcaan", "Shenseea", "Koffee", "Sean Paul",
    "Shaggy", "Damian Marley", "Buju Banton", "Beenie Man", "Bounty Killer",
    "Machel Montano", "Bunji Garlin", "Wyclef Jean",

    # UK
    "Stormzy", "Dave", "Central Cee", "J Hus", "Skepta", "AJ Tracey",
    "Headie One", "Little Simz", "Jorja Smith", "RAYE", "FLO",

    # BRAZIL / LATIN
    "Anitta", "Ludmilla", "IZA", "Bad Bunny", "J Balvin", "Daddy Yankee",
]

# Endless query generator
def generate_queries():
    """Generate infinite variety of search queries"""

    bases = [
        # Genres
        "afrobeats", "amapiano", "naija", "bongo flava", "highlife", "juju",
        "fuji", "afro soul", "afro pop", "afro house", "gqom", "kwaito",
        "rumba", "ndombolo", "coupé décalé", "mbalax", "soukous",
        "hip hop", "rap", "trap", "drill", "r&b", "rnb", "soul", "neo soul",
        "reggae", "dancehall", "soca", "funk", "gospel", "worship",
        "afro trap", "afroswing", "uk rap", "grime",

        # Moods
        "chill", "party", "love songs", "slow jams", "workout", "hype",
        "vibes", "summer", "night", "morning", "driving", "study",

        # Descriptors
        "hits", "best", "top", "new", "latest", "trending", "viral",
        "classics", "throwback", "old school", "underground",
    ]

    years = ["2024", "2023", "2022", "2021", "2020", "2019", "2018", "2010s", "2000s", "90s"]

    regions = [
        "african", "nigerian", "ghana", "south african", "kenyan", "tanzanian",
        "congolese", "senegalese", "ethiopian", "ugandan", "zimbabwe",
        "american", "uk", "caribbean", "jamaican", "brazilian",
    ]

    actions = ["mix", "playlist", "compilation", "collection", "songs", "music", "tracks"]

    queries = []

    # Combo 1: region + genre + year
    for region in regions:
        for base in bases[:20]:
            for year in years[:5]:
                queries.append(f"{region} {base} {year}")

    # Combo 2: genre + mood
    for base in bases:
        for mood in ["hits", "best", "top", "playlist", "mix"]:
            queries.append(f"{base} {mood}")
            queries.append(f"best {base}")

    # Combo 3: year + descriptor
    for year in years:
        queries.append(f"best songs {year}")
        queries.append(f"top hits {year}")
        queries.append(f"music {year}")

    # Combo 4: TikTok / Viral
    viral_bases = ["tiktok", "viral", "trending", "instagram reels", "spotify"]
    for v in viral_bases:
        for base in bases[:10]:
            queries.append(f"{v} {base}")
        queries.append(f"{v} songs 2024")
        queries.append(f"{v} african music")

    # Shuffle for variety
    random.shuffle(queries)
    return queries

# ============================================
# SUPABASE
# ============================================

def sync_to_supabase(tracks: List[Dict]) -> int:
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
    except:
        return 0

def get_db_count() -> int:
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
# WORKER
# ============================================

def worker(worker_id: int, items: List[str], item_type: str):
    """Worker that processes artists or queries"""
    ytm = YTMusic()
    worker_synced = 0

    def is_new(video_id: str) -> bool:
        with seen_lock:
            if video_id in seen_ids:
                return False
            seen_ids.add(video_id)
            return True

    def get_thumb(thumbnails):
        if not thumbnails:
            return None
        sorted_t = sorted(thumbnails, key=lambda x: x.get('width', 0), reverse=True)
        return sorted_t[0].get('url') if sorted_t else None

    pending = []

    for item in items:
        try:
            # Search songs
            results = ytm.search(item, filter='songs', limit=30)
            for r in results:
                vid = r.get('videoId')
                if vid and is_new(vid):
                    artists = r.get('artists', [])
                    artist_str = ', '.join([a.get('name', '') for a in artists if isinstance(a, dict)]) if artists else 'Unknown'
                    pending.append({
                        'youtube_id': vid,
                        'title': r.get('title', 'Unknown'),
                        'artist': artist_str,
                        'thumbnail_url': get_thumb(r.get('thumbnails', []))
                    })

            # Search videos
            results = ytm.search(item, filter='videos', limit=15)
            for r in results:
                vid = r.get('videoId')
                if vid and is_new(vid):
                    artists = r.get('artists', [])
                    artist_str = ', '.join([a.get('name', '') for a in artists if isinstance(a, dict)]) if artists else 'Unknown'
                    pending.append({
                        'youtube_id': vid,
                        'title': r.get('title', 'Unknown'),
                        'artist': artist_str,
                        'thumbnail_url': get_thumb(r.get('thumbnails', []))
                    })

            # Batch sync
            if len(pending) >= 50:
                synced = sync_to_supabase(pending[:50])
                worker_synced += synced
                total_synced.add(synced)
                pending = pending[50:]

            time.sleep(random.uniform(0.15, 0.35))

        except Exception as e:
            time.sleep(0.5)

    # Final sync
    if pending:
        synced = sync_to_supabase(pending)
        worker_synced += synced
        total_synced.add(synced)

    return worker_synced


def run_round(round_num: int, workers: int = 6):
    """Run one round of feeding"""
    print(f"\n{'='*70}")
    print(f"  🔄 ROUND {round_num} - {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'='*70}")

    current_count = get_db_count()
    print(f"  📊 Current: {current_count:,} tracks")

    if current_count >= TARGET_TRACKS:
        print(f"  🎯 TARGET REACHED! {current_count:,} >= {TARGET_TRACKS:,}")
        return False

    round_start = time.time()

    # Split work
    artists = ALL_ARTISTS.copy()
    random.shuffle(artists)
    queries = generate_queries()[:200]  # 200 queries per round

    all_items = artists + queries
    random.shuffle(all_items)

    # Chunk for workers
    chunk_size = len(all_items) // workers
    chunks = [all_items[i:i+chunk_size] for i in range(0, len(all_items), chunk_size)]

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(worker, i, chunk, 'mixed')
            for i, chunk in enumerate(chunks)
        ]
        for f in as_completed(futures):
            try:
                f.result()
            except:
                pass

    elapsed = time.time() - round_start
    new_count = get_db_count()
    added = new_count - current_count

    print(f"  ✅ Round {round_num} done: +{added:,} tracks in {elapsed:.0f}s")
    print(f"  📊 Total: {new_count:,} tracks ({new_count/TARGET_TRACKS*100:.1f}% of target)")

    return True


def run_autonomous():
    """Run autonomously until target is reached"""
    print("=" * 70)
    print("  🤖 VOYO AUTONOMOUS BEAST - Built by DASH & ZION 🤖")
    print("  NON-STOP UNTIL 200K TRACKS")
    print("=" * 70)

    start_time = time.time()
    initial_count = get_db_count()

    print(f"\n  🎯 TARGET: {TARGET_TRACKS:,} tracks")
    print(f"  📊 Starting: {initial_count:,} tracks")
    print(f"  🚀 Need: +{TARGET_TRACKS - initial_count:,} tracks")
    print(f"\n  ⏰ Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("  🔥 LET'S GO MENTAL 🔥")

    round_num = 1

    while True:
        try:
            should_continue = run_round(round_num, workers=6)
            if not should_continue:
                break
            round_num += 1

            # Brief pause between rounds
            time.sleep(2)

        except KeyboardInterrupt:
            print("\n\n  ⚠️ Interrupted by user")
            break
        except Exception as e:
            print(f"\n  ❌ Error in round {round_num}: {e}")
            time.sleep(5)

    # Final stats
    elapsed = time.time() - start_time
    final_count = get_db_count()

    print("\n" + "=" * 70)
    print("  🏁 AUTONOMOUS RUN COMPLETE 🏁")
    print("=" * 70)
    print(f"  Initial:    {initial_count:,}")
    print(f"  Final:      {final_count:,}")
    print(f"  Added:      +{final_count - initial_count:,}")
    print(f"  Rounds:     {round_num}")
    print(f"  Time:       {elapsed/60:.1f} min ({elapsed/3600:.2f} hours)")
    print(f"  Rate:       {(final_count - initial_count) / (elapsed/60):.0f} tracks/min")
    print("=" * 70)
    print("  🔥 Built by DASH & ZION 🔥")
    print("=" * 70)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        TARGET_TRACKS = int(sys.argv[1])
    run_autonomous()
