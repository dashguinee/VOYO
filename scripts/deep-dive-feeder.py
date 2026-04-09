#!/usr/bin/env python3
"""
VOYO DEEP DIVE FEEDER - Built by DASH & ZION
=============================================

Goes DEEPER - underground, emerging, niche, specific years,
album tracks, remixes, features, live performances.

For when we've exhausted the obvious searches.
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

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

total_synced = 0
total_lock = threading.Lock()
seen_ids: Set[str] = set()
seen_lock = threading.Lock()

# DEEP DIVE - Underground & Emerging Artists
UNDERGROUND_ARTISTS = [
    # Nigerian Underground/Alte
    "Cruel Santino", "Odunsi the Engine", "Lady Donli", "Tay Iwar", "Santi",
    "Prettyboy D-O", "Psycho YP", "Zilla Oaks", "BOJ", "Teezee", "Fresh L",
    "Show Dem Camp", "Loose Kaynon", "A-Q", "MI Casa", "Nonso Amadi",
    "Wurld", "Moelogo", "Mannywellz", "Melvitto", "Alpha P", "Superboy Cheque",

    # Ghanaian Underground
    "La Meme Gang", "Spacely", "Kiddblack", "$pacely", "RJZ", "Kawabanga",
    "Bryan the Mensah", "J.Derobie", "Kofi Mole", "Yaw Tog", "O'Kenneth",

    # South African Underground
    "Zingah", "Shane Eagle", "Priddy Ugly", "Stogie T", "Yugen Blakrok",
    "Dope Saint Jude", "Moonchild Sanelly", "Nadia Nakai", "Rouge", "Gigi Lamayne",
    "25K", "Lucasraps", "Wordz", "The Big Hash", "Ex Global", "Flame",

    # East African Underground
    "Blinky Bill", "Octopizzo", "Juliani", "Rabbit Kinyozi", "Fena Gitu",
    "Nadia Mukami", "Bensoul", "Nviiri", "Mbogi Genje", "Ethic Entertainment",
    "Susumila", "Willy Paul", "Bahati", "Size 8", "Daddy Owen",

    # Francophone Underground
    "Joé Dwèt Filé", "Gambi", "Koba LaD", "PLK", "Dinos", "Orelsan",
    "Lomepal", "Roméo Elvis", "Hamza", "Damso", "Stromae", "Angèle",
    "Lous and the Yakuza", "Charlotte Adigéry", "Ichon", "Youssoupha",

    # UK Underground
    "Kojey Radical", "Loyle Carner", "Swindle", "Nines", "Potter Payper",
    "Ghetts", "Kano", "D Double E", "JME", "P Money", "Bugzy Malone",
    "Aitch", "Enny", "Berwyn", "BackRoad Gee", "Knucks", "Che Lingo",

    # US Underground
    "JID", "Earthgang", "Spillage Village", "6LACK", "Smino", "Noname",
    "Saba", "Mick Jenkins", "Chance the Rapper", "Vic Mensa", "Joey Purp",
    "Ravyn Lenae", "Jean Deaux", "Amine", "Vince Staples", "Isaiah Rashad",
    "ScHoolboy Q", "Ab-Soul", "Jay Rock", "Bas", "Cozz", "Ari Lennox",

    # Caribbean Underground
    "Koffee", "Lila Iké", "Sevana", "Naomi Cowan", "Moyann", "Jada Kingdom",
    "Shenseea", "Stalk Ashley", "Agent Sasco", "Kabaka Pyramid", "Jesse Royal",
    "Protoje", "Chronixx", "Mortimer", "Kumar", "Runkus",
]

# Niche genre searches
NICHE_QUERIES = [
    # Subgenres
    "alte music", "alté lagos", "alte nigeria", "afro fusion",
    "afro soul", "afro jazz", "afro house deep", "afro tech house",
    "gqom 2024", "sgubhu music", "bacardi music south africa",
    "amapiano log drum", "amapiano private school", "amapiano vocal",
    "afrobeats acoustic", "afrobeats unplugged", "african unplugged",
    "gengetone 2024", "arbantone music", "shrap kenya",
    "bongo flava classic", "singeli music", "mczo bongo",
    "hiplife classic", "azonto 2024", "highlife guitar",
    "afrobeats remix", "amapiano remix", "drill remix african",

    # Specific vibes
    "late night afrobeats", "3am african vibes", "midnight afro",
    "sunday morning african", "african brunch playlist",
    "african sunset vibes", "golden hour african music",
    "rainy day african music", "cozy african playlist",

    # Live & Acoustic
    "african live performance", "afrobeats live session", "colors show african",
    "tiny desk african", "npr music african", "sofar sounds african",
    "acoustic african covers", "african guitar covers",

    # Features & Collaborations
    "wizkid ft", "burna boy featuring", "davido collaboration",
    "rema ft", "tems featuring", "ayra starr ft",
    "african artists featuring international",
    "afrobeats featuring drake", "african music chris brown",

    # Years deep dive
    "afrobeats 2015", "afrobeats 2016", "afrobeats 2017",
    "naija music 2010", "naija music 2011", "naija music 2012",
    "amapiano 2019", "amapiano 2020", "amapiano 2021",
    "ghana music 2015", "kenya music 2018", "tanzania music 2019",

    # Album specific
    "made in lagos album", "twice as tall album", "a good time album",
    "african giant album", "love damini album", "rave and roses album",
    "mr morale african", "Renaissance beyoncé african",
    "black panther wakanda soundtrack",

    # Producer tags
    "p2j productions", "sarz beats", "pheelz productions",
    "kel p beats", "london productions nigerian",
    "speroach beatz", "young john productions", "rexxie productions",

    # Record labels
    "mavin records", "starboy records", "spaceship records",
    "davido music worldwide", "chocolate city music", "aristokrat records",
    "empire africa", "sony africa", "universal africa",

    # Playlists by country
    "cameroon music 2024", "ivory coast music 2024", "benin music",
    "togo music", "burkina faso music", "niger music",
    "guinea music", "sierra leone music", "liberia music",
    "gambia music", "mauritania music", "cape verde music",
    "mozambique music", "angola music kuduro", "namibia music",
    "botswana music", "zambia music", "malawi music",
    "madagascar music", "mauritius sega music", "reunion music",
    "comoros music", "seychelles music", "somalia music",
    "djibouti music", "eritrea music", "south sudan music",

    # Specific city scenes
    "lagos music scene", "accra music scene", "johannesburg music",
    "nairobi music scene", "dar es salaam music", "kampala music",
    "kinshasa music", "dakar music scene", "abidjan music",
    "luanda music", "maputo music", "harare music scene",
    "addis ababa music", "cairo music scene", "casablanca music",

    # African diaspora specific
    "afro caribbean fusion", "afro dancehall", "african reggae fusion",
    "afro latino music", "african brazilian music", "afro cuban",
    "african american african collab", "afropunk music",
    "african electronic music", "african edm", "african dubstep",

    # Gospel deep dive
    "nigerian gospel worship", "south african gospel choir",
    "kenyan gospel 2024", "ghanaian gospel", "congolese gospel",
    "african praise songs", "african worship songs",

    # Traditional fusion
    "fuji music modern", "juju music modern", "apala music",
    "sakara music", "waka music nigeria", "afro highlife",
    "palm wine music", "african blues", "desert blues tuareg",
    "gnawa music morocco", "rai modern", "chaabi music",
    "taarab music", "benga music kenya", "rhumba modern",
    "soukous guitar", "makossa modern", "bikutsi modern",
    "kizomba 2024", "semba music", "kuduro 2024",
    "pantsula music", "mapantsula dance music",

    # TikTok/Viral specific
    "tiktok dance african", "tiktok challenge afrobeats",
    "viral amapiano tiktok", "trending sound african",
    "instagram reel african music", "youtube shorts african",
]

def sync_to_supabase(tracks: List[Dict]) -> int:
    if not tracks:
        return 0
    data = [{
        'youtube_id': t['youtube_id'],
        'title': t.get('title', 'Unknown')[:500],
        'artist': t.get('artist', 'Unknown')[:200],
        'thumbnail_url': t.get('thumbnail_url') or f"https://i.ytimg.com/vi/{t['youtube_id']}/hqdefault.jpg"
    } for t in tracks if t.get('youtube_id')]
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
        with urllib.request.urlopen(req, timeout=30):
            return len(data)
    except:
        return 0

def get_db_count() -> int:
    try:
        req = urllib.request.Request(
            f'{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id&limit=1',
            headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}', 'Prefer': 'count=exact'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            count = resp.headers.get('content-range', '').split('/')[-1]
            return int(count) if count and count != '*' else 0
    except:
        return 0

def search_deep(ytm, query: str, seen: Set[str]) -> List[Dict]:
    """Deep search with multiple filters"""
    tracks = []

    def is_new(vid):
        with seen_lock:
            if vid in seen_ids:
                return False
            seen_ids.add(vid)
            return True

    def get_thumb(thumbnails):
        if not thumbnails:
            return None
        return sorted(thumbnails, key=lambda x: x.get('width', 0), reverse=True)[0].get('url')

    for filter_type in ['songs', 'videos', 'albums']:
        try:
            if filter_type == 'albums':
                results = ytm.search(query, filter='albums', limit=10)
                for album in results:
                    try:
                        album_id = album.get('browseId')
                        if album_id:
                            album_data = ytm.get_album(album_id)
                            for track in album_data.get('tracks', [])[:20]:
                                vid = track.get('videoId')
                                if vid and is_new(vid):
                                    tracks.append({
                                        'youtube_id': vid,
                                        'title': track.get('title', 'Unknown'),
                                        'artist': ', '.join([a.get('name', '') for a in track.get('artists', []) if isinstance(a, dict)]) or 'Unknown',
                                        'thumbnail_url': get_thumb(track.get('thumbnails', []))
                                    })
                            time.sleep(0.2)
                    except:
                        pass
            else:
                results = ytm.search(query, filter=filter_type, limit=50)
                for item in results:
                    vid = item.get('videoId')
                    if vid and is_new(vid):
                        tracks.append({
                            'youtube_id': vid,
                            'title': item.get('title', 'Unknown'),
                            'artist': ', '.join([a.get('name', '') for a in item.get('artists', []) if isinstance(a, dict)]) or 'Unknown',
                            'thumbnail_url': get_thumb(item.get('thumbnails', []))
                        })
        except:
            pass

    return tracks

def worker(items: List[str]):
    global total_synced
    ytm = YTMusic()
    pending = []
    worker_synced = 0

    for item in items:
        try:
            tracks = search_deep(ytm, item, seen_ids)
            pending.extend(tracks)

            if len(pending) >= 50:
                synced = sync_to_supabase(pending[:50])
                with total_lock:
                    total_synced += synced
                worker_synced += synced
                pending = pending[50:]

            time.sleep(random.uniform(0.2, 0.4))
        except:
            pass

    if pending:
        synced = sync_to_supabase(pending)
        with total_lock:
            total_synced += synced
        worker_synced += synced

    return worker_synced

def run_deep_dive(workers: int = 8):
    global total_synced
    total_synced = 0

    print("=" * 70)
    print("  🔬 VOYO DEEP DIVE FEEDER - Built by DASH & ZION 🔬")
    print("  UNDERGROUND. EMERGING. NICHE. DEEP CUTS.")
    print("=" * 70)

    initial = get_db_count()
    print(f"\n📊 Initial: {initial:,} tracks")

    all_items = UNDERGROUND_ARTISTS + NICHE_QUERIES
    random.shuffle(all_items)

    chunk_size = len(all_items) // workers
    chunks = [all_items[i:i+chunk_size] for i in range(0, len(all_items), chunk_size)]

    print(f"🚀 Launching {workers} workers on {len(all_items)} items...")

    start = time.time()

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(worker, chunk) for chunk in chunks]
        for f in as_completed(futures):
            try:
                f.result()
            except:
                pass

    elapsed = time.time() - start
    final = get_db_count()

    print(f"\n{'='*70}")
    print(f"  🔬 DEEP DIVE RESULTS")
    print(f"{'='*70}")
    print(f"  Initial:    {initial:,}")
    print(f"  Final:      {final:,}")
    print(f"  NEW:        +{final - initial:,}")
    print(f"  Time:       {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*70}")

if __name__ == '__main__':
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    run_deep_dive(workers)
