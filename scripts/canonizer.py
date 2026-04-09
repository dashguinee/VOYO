#!/usr/bin/env python3
"""
VOYO CANONIZER - Built by DASH & ZION
======================================

Takes 122K raw tracks and transforms them into CULTURAL INFRASTRUCTURE.

- Artist Tiers (A/B/C/D)
- Canon Levels (CORE, ESSENTIAL, DEEP_CUT, ARCHIVE, ECHO)
- Cultural Tags (anthem, diaspora, revolution, tradition...)

ECHO = Hidden gems, not noise. Artists suffocated by circumstance.
"""

import json
import urllib.request
import re
from typing import List, Dict, Optional, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

# ============================================
# TIER A ARTISTS (Global Icons)
# ============================================

TIER_A_ARTISTS = {
    # Nigerian Icons
    'burna boy', 'wizkid', 'davido', 'tiwa savage', 'fela kuti', 'rema',
    'tems', 'ckay', 'ayra starr', 'asake', 'fireboy dml', 'olamide',
    'yemi alade', 'mr eazi', 'tekno', 'kizz daniel', 'joeboy', 'omah lay',
    'patoranking', 'wande coal', 'don jazzy', '2baba', 'phyno', 'flavour',
    # South African Icons
    'black coffee', 'master kg', 'dj maphorisa', 'kabza de small', 'miriam makeba',
    'cassper nyovest', 'nasty c', 'aka', 'sjava', 'sho madjozi', 'makhadzi',
    'amapiano', 'focalistic', 'uncle waffles', 'dj zinhle',
    # Ghanaian Icons
    'sarkodie', 'stonebwoy', 'shatta wale', 'black sherif', 'king promise',
    'r2bees', 'kwesi arthur', 'kuami eugene', 'kidi', 'efya', 'becca',
    # East African Icons
    'diamond platnumz', 'sauti sol', 'harmonize', 'rayvanny', 'ali kiba',
    'zuchu', 'mbosso', 'nandy', 'alikiba', 'vanessa mdee', 'jux',
    'nyashinski', 'khaligraph jones', 'otile brown', 'nviiri', 'bien',
    # Congolese Icons
    'fally ipupa', 'koffi olomide', 'ferre gola', 'innoss b', 'werrason',
    'papa wemba', 'awilo longomba', 'lokua kanza',
    # Francophone Icons
    'youssou ndour', 'salif keita', 'angelique kidjo', 'manu dibango',
    'magic system', 'dj arafat', 'serge beynaud', 'toofan', 'fanicko',
    'rosny kayiba', 'amy koita', 'oumou sangare',
    # USA Icons (Black music)
    'drake', 'beyonce', 'rihanna', 'chris brown', 'kendrick lamar',
    'jay-z', 'kanye west', 'travis scott', 'the weeknd', 'sza', 'doja cat',
    'megan thee stallion', 'cardi b', 'nicki minaj', 'future', 'lil baby',
    'gunna', 'young thug', 'j cole', '21 savage', 'tyler the creator',
    'frank ocean', 'childish gambino', 'bruno mars', 'usher', 'chris brown',
    'michael jackson', 'prince', 'stevie wonder', 'marvin gaye', 'aretha franklin',
    # Caribbean Icons
    'bob marley', 'sean paul', 'shaggy', 'vybz kartel', 'popcaan', 'spice',
    'alkaline', 'chronixx', 'koffee', 'protoje', 'damian marley', 'buju banton',
    'beenie man', 'bounty killer', 'sizzla',
    # UK Icons
    'stormzy', 'dave', 'skepta', 'wiley', 'j hus', 'central cee', 'jorja smith',
    'little simz', 'ella mai', 'ray blk', 'ms banks', 'headie one',
    # Brazil Icons
    'anitta', 'ludmilla', 'iza', 'seu jorge', 'gilberto gil', 'caetano veloso',
    'jorge ben jor', 'tim maia', 'mc kevinho', 'pabllo vittar',
    # Legends
    'femi kuti', 'king sunny ade', 'ebenezer obey', 'sir shina peters',
    'oliver de coque', 'osadebe', 'sunny okosun', 'onyeka onwenu',
}

# Tier B - Regional Stars (not exhaustive, pattern matching)
TIER_B_PATTERNS = [
    'feat', 'ft.', 'remix', 'official', 'audio', 'video', 'lyrics',
]

# ============================================
# CULTURAL TAG KEYWORDS
# ============================================

CULTURAL_KEYWORDS = {
    # Movement markers
    'anthem': ['anthem', 'national', 'independence', 'unity', 'stand up', 'rise up', 'we are'],
    'revolution': ['revolution', 'change', 'fight', 'power to', 'system', 'struggle', 'freedom fighter'],
    'liberation': ['freedom', 'free', 'liberation', 'independent', 'chains', 'emancipation', 'free at last'],
    'protest': ['protest', 'injustice', 'police', 'government', 'corruption', 'sars', 'endsars'],
    # Heritage markers
    'tradition': ['traditional', 'heritage', 'ancestors', 'elders', 'culture', 'village', 'folklore'],
    'roots': ['roots', 'origin', 'homeland', 'native', 'indigenous'],
    'motherland': ['africa', 'mama africa', 'motherland', 'continent', 'african queen', 'african king'],
    'pan-african': ['pan-african', 'united africa', 'one africa', 'african unity'],
    # Diaspora markers
    'diaspora': ['diaspora', 'abroad', 'overseas', 'japa', 'abroad life', 'immigrant'],
    'homecoming': ['return', 'coming home', 'back home', 'welcome home', 'homecoming'],
    'bridge': ['fusion', 'blend', 'mix', 'afro-'],
    # Street markers
    'street': ['street', 'hood', 'block', 'area', 'ghetto', 'trenches', 'outside'],
    'hustle': ['hustle', 'grind', 'money', 'paper', 'cheddar', 'bag', 'secure'],
    'survival': ['survive', 'struggle', 'make it', 'overcome', 'rise', 'from nothing'],
    # Celebration markers
    'wedding': ['wedding', 'marriage', 'bride', 'groom', 'owambe', 'owanbe', 'asoebi'],
    'festival': ['festival', 'carnival', 'detty', 'december', 'party', 'fiesta'],
    'celebration': ['celebrate', 'joy', 'happy', 'blessed', 'thankful', 'grateful'],
    # Spiritual markers
    'spiritual': ['spirit', 'soul', 'divine', 'holy', 'sacred', 'anointed'],
    'prayer': ['prayer', 'pray', 'lord', 'god', 'jesus', 'allah', 'worship', 'praise'],
    'healing': ['heal', 'restoration', 'peace', 'calm', 'comfort', 'strength'],
    # Love markers
    'love': ['love', 'baby', 'darling', 'heart', 'forever', 'together', 'my love'],
    'heartbreak': ['heartbreak', 'pain', 'tears', 'cry', 'hurt', 'broken', 'miss you'],
}

# ============================================
# GENRE DETECTION
# ============================================

GENRE_KEYWORDS = {
    'afrobeats': ['afrobeat', 'naija', 'nigerian', 'lagos', 'wizkid', 'davido', 'burna'],
    'amapiano': ['amapiano', 'piano', 'yanos', 'maphorisa', 'kabza', 'log drum'],
    'afro-house': ['afro house', 'afro-house', 'black coffee', 'deep house africa'],
    'gqom': ['gqom', 'durban', 'babes wodumo'],
    'highlife': ['highlife', 'high life', 'ghana', 'ghanaian'],
    'hiplife': ['hiplife', 'hip life', 'sarkodie'],
    'bongo-flava': ['bongo flava', 'bongo', 'tanzania', 'diamond platnumz'],
    'gengetone': ['gengetone', 'kenya', 'nairobi', 'ethic'],
    'dancehall': ['dancehall', 'dance hall', 'jamaica', 'vybz kartel', 'popcaan'],
    'reggae': ['reggae', 'rasta', 'bob marley', 'roots'],
    'soca': ['soca', 'trinidad', 'carnival'],
    'zouk': ['zouk', 'kizomba', 'kompa'],
    'rumba': ['rumba', 'congolese', 'soukous', 'ndombolo'],
    'hip-hop': ['hip hop', 'hiphop', 'rap', 'rapper', 'bars', 'flow'],
    'rnb': ['r&b', 'rnb', 'r n b', 'slow jam', 'soul'],
    'gospel': ['gospel', 'worship', 'praise', 'christian', 'church', 'hallelujah'],
    'funk': ['funk', 'funky', 'carioca', 'baile'],
    'drill': ['drill', 'uk drill', 'brooklyn drill'],
    'grime': ['grime', 'mc', 'uk rap'],
}

# ============================================
# CLASSIFICATION FUNCTIONS
# ============================================

def normalize_name(name: str) -> str:
    """Normalize artist name for matching."""
    return name.lower().strip()

def get_artist_tier(artist: str) -> str:
    """Determine artist tier (A/B/C/D)."""
    normalized = normalize_name(artist)

    # Check Tier A (exact match or contains)
    for tier_a in TIER_A_ARTISTS:
        if tier_a in normalized or normalized in tier_a:
            return 'A'

    # Check for featuring major artists
    if any(tier_a in normalized for tier_a in list(TIER_A_ARTISTS)[:50]):
        return 'B'

    # Default to D (underground/emerging) - ECHO territory
    return 'D'

def get_canon_level(title: str, artist: str, tier: str) -> str:
    """Determine canon level."""
    title_lower = title.lower()

    # CORE indicators (defines an era)
    core_indicators = [
        'official video', 'official music video', 'official audio',
        'ft.', 'feat.', 'featuring',  # Collaborations often important
    ]

    # Tier A with official release = likely ESSENTIAL or higher
    if tier == 'A':
        if any(ind in title_lower for ind in core_indicators):
            return 'ESSENTIAL'
        return 'ESSENTIAL'  # Tier A default

    # Tier B = DEEP_CUT
    if tier == 'B':
        return 'DEEP_CUT'

    # Tier C = ARCHIVE
    if tier == 'C':
        return 'ARCHIVE'

    # Tier D = ECHO (hidden gems, not noise!)
    return 'ECHO'

def detect_cultural_tags(title: str, artist: str) -> List[str]:
    """Detect cultural tags from title and artist."""
    text = f"{title} {artist}".lower()
    tags = []

    for tag, keywords in CULTURAL_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text:
                tags.append(tag)
                break  # One match per tag is enough

    return tags[:5]  # Max 5 tags

def detect_genre(title: str, artist: str) -> Optional[str]:
    """Detect genre from title and artist."""
    text = f"{title} {artist}".lower()

    for genre, keywords in GENRE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text:
                return genre

    return None

def classify_track(track: Dict) -> Dict:
    """Classify a single track with tier, canon, tags."""
    title = track.get('title', '') or ''
    artist = track.get('artist', '') or ''
    youtube_id = track.get('youtube_id', '')

    tier = get_artist_tier(artist)
    canon = get_canon_level(title, artist, tier)
    tags = detect_cultural_tags(title, artist)
    genre = detect_genre(title, artist)

    return {
        'youtube_id': youtube_id,
        'title': title,
        'artist': artist,
        'artist_tier': tier,
        'canon_level': canon,
        'cultural_tags': tags,
        'genre': genre,
        'is_echo': canon == 'ECHO',
    }

# ============================================
# SUPABASE FUNCTIONS
# ============================================

def fetch_all_tracks() -> List[Dict]:
    """Fetch all tracks from Supabase."""
    print("📥 Fetching tracks from Supabase...")
    all_tracks = []
    offset = 0
    limit = 1000

    while True:
        try:
            url = f'{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id,title,artist&offset={offset}&limit={limit}'
            req = urllib.request.Request(url, headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                batch = json.loads(resp.read().decode('utf-8'))
                if not batch:
                    break
                all_tracks.extend(batch)
                offset += limit
                print(f"  Fetched {len(all_tracks):,} tracks...")
        except Exception as e:
            print(f"  Error fetching: {e}")
            break

    return all_tracks

def get_db_count() -> int:
    """Get current database count."""
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

# ============================================
# MAIN CANONIZER
# ============================================

def run_canonizer():
    """Run the full canonization process."""
    print("=" * 70)
    print("  🏛️  VOYO CANONIZER - Built by DASH & ZION 🏛️")
    print("  CULTURAL INFRASTRUCTURE. ECHO = HIDDEN GEMS.")
    print("=" * 70)

    db_count = get_db_count()
    print(f"\n📊 Database: {db_count:,} tracks")

    # Fetch all tracks
    tracks = fetch_all_tracks()
    print(f"\n📦 Loaded {len(tracks):,} tracks for classification")

    # Classify
    print("\n🔬 Classifying tracks...")
    start = time.time()

    results = {
        'A': 0, 'B': 0, 'C': 0, 'D': 0,
        'CORE': 0, 'ESSENTIAL': 0, 'DEEP_CUT': 0, 'ARCHIVE': 0, 'ECHO': 0,
        'tags': {},
        'genres': {},
    }

    classified = []
    for i, track in enumerate(tracks):
        c = classify_track(track)
        classified.append(c)

        # Stats
        results[c['artist_tier']] += 1
        results[c['canon_level']] += 1
        for tag in c['cultural_tags']:
            results['tags'][tag] = results['tags'].get(tag, 0) + 1
        if c['genre']:
            results['genres'][c['genre']] = results['genres'].get(c['genre'], 0) + 1

        if (i + 1) % 10000 == 0:
            print(f"  Classified {i+1:,} tracks...")

    elapsed = time.time() - start

    # Print results
    print(f"\n{'=' * 70}")
    print(f"  🏛️  CANONIZATION COMPLETE")
    print(f"{'=' * 70}")
    print(f"\n  ⏱️  Time: {elapsed:.1f}s ({len(tracks)/elapsed:.0f} tracks/sec)")

    print(f"\n  📊 ARTIST TIERS:")
    print(f"     A (Global Icons):     {results['A']:,}")
    print(f"     B (Regional Stars):   {results['B']:,}")
    print(f"     C (National):         {results['C']:,}")
    print(f"     D (Underground):      {results['D']:,}")

    print(f"\n  📊 CANON LEVELS:")
    print(f"     CORE (Era-defining):  {results['CORE']:,}")
    print(f"     ESSENTIAL:            {results['ESSENTIAL']:,}")
    print(f"     DEEP_CUT:             {results['DEEP_CUT']:,}")
    print(f"     ARCHIVE:              {results['ARCHIVE']:,}")
    print(f"     ECHO (Hidden gems):   {results['ECHO']:,}")

    print(f"\n  🏷️  TOP CULTURAL TAGS:")
    sorted_tags = sorted(results['tags'].items(), key=lambda x: x[1], reverse=True)[:10]
    for tag, count in sorted_tags:
        print(f"     {tag}: {count:,}")

    print(f"\n  🎵 TOP GENRES:")
    sorted_genres = sorted(results['genres'].items(), key=lambda x: x[1], reverse=True)[:10]
    for genre, count in sorted_genres:
        print(f"     {genre}: {count:,}")

    print(f"\n{'=' * 70}")

    # Save to JSON for now (can update Supabase schema later)
    output_file = '/home/dash/voyo-music/data/canonized_tracks.json'
    print(f"\n💾 Saving to {output_file}...")

    import os
    os.makedirs('/home/dash/voyo-music/data', exist_ok=True)

    with open(output_file, 'w') as f:
        json.dump({
            'meta': {
                'total_tracks': len(classified),
                'classified_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'stats': {
                    'tiers': {'A': results['A'], 'B': results['B'], 'C': results['C'], 'D': results['D']},
                    'canon': {'CORE': results['CORE'], 'ESSENTIAL': results['ESSENTIAL'],
                              'DEEP_CUT': results['DEEP_CUT'], 'ARCHIVE': results['ARCHIVE'], 'ECHO': results['ECHO']},
                    'top_tags': dict(sorted_tags),
                    'top_genres': dict(sorted_genres),
                }
            },
            'tracks': classified
        }, f)

    print(f"✅ Saved {len(classified):,} canonized tracks!")
    print(f"\n🔥 CULTURAL WEAPON LOADED 🔥")

if __name__ == '__main__':
    run_canonizer()
