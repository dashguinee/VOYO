#!/usr/bin/env python3
"""
VOYO Mass Database Feeder - Built by DASH & ZION
================================================

Uses ytmusicapi to bulk extract YouTube IDs and feed them to Supabase.
Target: 100k+ tracks/day

Grey area but industry standard (same as Invidious, NewPipe, FreeTube)
"""

import json
import time
import random
import urllib.request
import urllib.parse
from datetime import datetime
from typing import List, Dict, Set, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from ytmusicapi import YTMusic
except ImportError:
    print("Installing ytmusicapi...")
    import subprocess
    subprocess.run(["pip3", "install", "ytmusicapi", "--break-system-packages", "-q"])
    from ytmusicapi import YTMusic

# ============================================
# SUPABASE CONFIG
# ============================================

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

# ============================================
# AFRICAN MUSIC DATABASE - Artist IDs & Playlists
# ============================================

# Top African Artists (YouTube Music Artist IDs / Channel IDs)
AFRICAN_ARTISTS = [
    # Nigerian Afrobeats
    "Burna Boy", "Wizkid", "Davido", "Tiwa Savage", "Rema", "Asake",
    "Fireboy DML", "Omah Lay", "Ayra Starr", "CKay", "Tems", "BNXN",
    "Joeboy", "Kizz Daniel", "Olamide", "Wande Coal", "Tekno", "Yemi Alade",
    "Patoranking", "Mr Eazi", "Flavour", "Adekunle Gold", "Simi", "Falz",
    "Zlatan", "Naira Marley", "Mayorkun", "Peruzzi", "Oxlade", "Ruger",
    "Lojay", "Victony", "Raye", "Blaqbonez", "BNXN fka Buju", "Darkoo",

    # Ghanaian Artists
    "Sarkodie", "Stonebwoy", "Shatta Wale", "King Promise", "Gyakie",
    "Black Sherif", "Kuami Eugene", "KiDi", "Camidoh", "Amaarae",
    "Kwesi Arthur", "Medikal", "Efya", "R2Bees", "Kofi Kinaata",
    "Daddy Lumba", "Kojo Antwi", "Ofori Amponsah", "Samini",

    # Francophone Africa
    "Fally Ipupa", "Innoss'B", "Diamond Platnumz", "Gaz Mawete",
    "Ferre Gola", "Koffi Olomide", "Papa Wemba", "Werrason",
    "Youssou N'Dour", "Baaba Maal", "Ismaël Lô", "Salif Keita",
    "Oumou Sangaré", "Amadou & Mariam", "Toumani Diabaté",
    "Aya Nakamura", "Niska", "MHD", "Dadju", "Gims", "Ninho",

    # East African
    "Harmonize", "Zuchu", "Rayvanny", "Ali Kiba", "Mbosso",
    "Nandy", "Sauti Sol", "Nyashinski", "Otile Brown", "Nviiri",
    "Eddy Kenzo", "Bebe Cool", "Sheebah", "Vinka",

    # South African
    "Nasty C", "AKA", "Cassper Nyovest", "Focalistic", "DJ Maphorisa",
    "Kabza De Small", "Sha Sha", "Ami Faku", "Elaine", "Blxckie",
    "Master KG", "Makhadzi", "Sho Madjozi", "Black Coffee",
    "Sun-El Musician", "Prince Kaybee",

    # North African / Arabic
    "Saad Lamjarred", "Maître Gims", "French Montana", "Khaled",
    "Cheb Mami", "Souad Massi", "Rachid Taha", "Mohamed Ramadan",
    "Wegz", "Marwan Moussa", "Amr Diab", "Tamer Hosny",

    # Legends
    "Fela Kuti", "King Sunny Ade", "Miriam Makeba", "Hugh Masekela",
    "Oliver Mtukudzi", "Thomas Mapfumo", "Lucky Dube", "Brenda Fassie",
    "Angelique Kidjo", "Manu Dibango", "Ali Farka Touré",
]

# Search queries for bulk discovery
BULK_QUERIES = [
    # Genre searches
    "afrobeats playlist 2024", "afrobeats hits 2024", "afrobeats mix 2024",
    "amapiano playlist 2024", "amapiano hits 2024", "amapiano mix",
    "naija music 2024", "nigerian music 2024", "ghana music 2024",
    "african music playlist", "african party songs", "african wedding songs",
    "coupé décalé playlist", "ndombolo music", "congolese music",
    "bongo flava playlist", "kenyan music 2024", "tanzanian music",
    "south african house music", "gqom music", "kwaito music",
    "highlife music ghana", "juju music nigeria", "fuji music",
    "afro soul music", "african r&b", "afro pop music",

    # Mood/Activity playlists
    "african chill music", "african love songs", "african slow jams",
    "african workout music", "african gym playlist", "african dance music",
    "african summer hits", "african throwback", "african classics",

    # Year-based
    "best african songs 2024", "best african songs 2023", "best african songs 2022",
    "afrobeats 2024", "afrobeats 2023", "afrobeats 2022", "afrobeats 2021",
    "amapiano 2024", "amapiano 2023", "amapiano 2022",

    # Specific regions
    "west african music", "east african music", "south african music",
    "central african music", "north african music", "francophone african music",
    "lusophone african music", "anglophone african music",

    # Collaborations & Features
    "wizkid features", "burna boy features", "davido features",
    "african international collabs", "afrobeats international",
]

# ============================================
# SUPABASE HELPER
# ============================================

def sync_to_supabase(tracks: List[Dict]) -> int:
    """Batch sync tracks to Supabase video_intelligence"""
    if not tracks:
        return 0

    # Prepare data - only include columns that exist
    data = []
    for t in tracks:
        if not t.get('youtube_id'):
            continue
        data.append({
            'youtube_id': t['youtube_id'],
            'title': t.get('title', 'Unknown')[:500],  # Limit length
            'artist': t.get('artist', 'Unknown')[:200],
            'thumbnail_url': t.get('thumbnail_url') or f"https://i.ytimg.com/vi/{t['youtube_id']}/hqdefault.jpg"
        })

    if not data:
        return 0

    # Batch upsert
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
        print(f"  ⚠️ Supabase error: {e}")
        return 0

def get_existing_count() -> int:
    """Get current track count in database"""
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
# YTMUSIC EXTRACTION
# ============================================

class MassFeeder:
    def __init__(self):
        self.ytm = YTMusic()
        self.synced_ids: Set[str] = set()
        self.total_synced = 0
        self.errors = 0

    def search_artist(self, artist_name: str) -> List[Dict]:
        """Search for artist and get their songs"""
        tracks = []
        try:
            # Search for artist
            results = self.ytm.search(artist_name, filter='songs', limit=50)

            for item in results:
                video_id = item.get('videoId')
                if video_id and video_id not in self.synced_ids:
                    self.synced_ids.add(video_id)
                    tracks.append({
                        'youtube_id': video_id,
                        'title': item.get('title', 'Unknown'),
                        'artist': ', '.join([a['name'] for a in item.get('artists', [])]) or artist_name,
                        'thumbnail_url': self._get_best_thumbnail(item.get('thumbnails', []))
                    })
        except Exception as e:
            print(f"  ⚠️ Artist search error ({artist_name}): {e}")
            self.errors += 1

        return tracks

    def search_query(self, query: str, limit: int = 50) -> List[Dict]:
        """Generic search query"""
        tracks = []
        try:
            results = self.ytm.search(query, filter='songs', limit=limit)

            for item in results:
                video_id = item.get('videoId')
                if video_id and video_id not in self.synced_ids:
                    self.synced_ids.add(video_id)
                    tracks.append({
                        'youtube_id': video_id,
                        'title': item.get('title', 'Unknown'),
                        'artist': ', '.join([a['name'] for a in item.get('artists', [])]) or 'Unknown',
                        'thumbnail_url': self._get_best_thumbnail(item.get('thumbnails', []))
                    })
        except Exception as e:
            print(f"  ⚠️ Search error ({query}): {e}")
            self.errors += 1

        return tracks

    def get_artist_albums(self, artist_name: str) -> List[Dict]:
        """Get all albums from an artist and extract tracks"""
        tracks = []
        try:
            # Search for artist
            artist_results = self.ytm.search(artist_name, filter='artists', limit=1)
            if not artist_results:
                return []

            artist_id = artist_results[0].get('browseId')
            if not artist_id:
                return []

            # Get artist page
            artist_data = self.ytm.get_artist(artist_id)

            # Get songs from artist page
            if 'songs' in artist_data and 'results' in artist_data['songs']:
                for item in artist_data['songs']['results'][:50]:
                    video_id = item.get('videoId')
                    if video_id and video_id not in self.synced_ids:
                        self.synced_ids.add(video_id)
                        tracks.append({
                            'youtube_id': video_id,
                            'title': item.get('title', 'Unknown'),
                            'artist': artist_name,
                            'thumbnail_url': self._get_best_thumbnail(item.get('thumbnails', []))
                        })

            # Get albums and their tracks
            if 'albums' in artist_data and 'results' in artist_data['albums']:
                for album in artist_data['albums']['results'][:10]:
                    album_id = album.get('browseId')
                    if album_id:
                        try:
                            album_data = self.ytm.get_album(album_id)
                            for track in album_data.get('tracks', []):
                                video_id = track.get('videoId')
                                if video_id and video_id not in self.synced_ids:
                                    self.synced_ids.add(video_id)
                                    tracks.append({
                                        'youtube_id': video_id,
                                        'title': track.get('title', 'Unknown'),
                                        'artist': artist_name,
                                        'thumbnail_url': self._get_best_thumbnail(track.get('thumbnails', []))
                                    })
                            time.sleep(0.3)  # Small delay between album fetches
                        except:
                            pass

        except Exception as e:
            print(f"  ⚠️ Album fetch error ({artist_name}): {e}")
            self.errors += 1

        return tracks

    def search_videos(self, query: str, limit: int = 50) -> List[Dict]:
        """Search for videos (catches more content than songs filter)"""
        tracks = []
        try:
            results = self.ytm.search(query, filter='videos', limit=limit)

            for item in results:
                video_id = item.get('videoId')
                if video_id and video_id not in self.synced_ids:
                    self.synced_ids.add(video_id)
                    tracks.append({
                        'youtube_id': video_id,
                        'title': item.get('title', 'Unknown'),
                        'artist': ', '.join([a['name'] for a in item.get('artists', [])]) or 'Unknown',
                        'thumbnail_url': self._get_best_thumbnail(item.get('thumbnails', []))
                    })
        except Exception as e:
            print(f"  ⚠️ Video search error ({query}): {e}")
            self.errors += 1

        return tracks

    def _get_best_thumbnail(self, thumbnails: List[Dict]) -> Optional[str]:
        """Get highest quality thumbnail"""
        if not thumbnails:
            return None
        # Sort by width and get largest
        sorted_thumbs = sorted(thumbnails, key=lambda x: x.get('width', 0), reverse=True)
        return sorted_thumbs[0].get('url') if sorted_thumbs else None


def run_mass_feed(target_tracks: int = 10000, batch_size: int = 50):
    """
    Main function to run mass feeding operation

    Args:
        target_tracks: Target number of new tracks to add
        batch_size: Number of tracks to sync at once
    """
    print("=" * 70)
    print("  VOYO MASS DATABASE FEEDER - Built by DASH & ZION")
    print("=" * 70)
    print()

    start_time = time.time()
    feeder = MassFeeder()

    # Get initial count
    initial_count = get_existing_count()
    print(f"📊 Initial database count: {initial_count:,} tracks")
    print(f"🎯 Target: +{target_tracks:,} new tracks")
    print()

    pending_tracks: List[Dict] = []

    def sync_batch():
        nonlocal pending_tracks
        if len(pending_tracks) >= batch_size:
            synced = sync_to_supabase(pending_tracks[:batch_size])
            feeder.total_synced += synced
            pending_tracks = pending_tracks[batch_size:]
            return synced
        return 0

    # Phase 1: Artist Discovery
    print("=" * 70)
    print("  PHASE 1: Artist Discovery")
    print("=" * 70)

    for i, artist in enumerate(AFRICAN_ARTISTS):
        if feeder.total_synced >= target_tracks:
            break

        print(f"\n[{i+1}/{len(AFRICAN_ARTISTS)}] 🎤 {artist}")

        # Get artist songs
        songs = feeder.search_artist(artist)
        print(f"  └── Found {len(songs)} songs from search")
        pending_tracks.extend(songs)

        # Get artist albums/discography
        albums = feeder.get_artist_albums(artist)
        print(f"  └── Found {len(albums)} tracks from albums")
        pending_tracks.extend(albums)

        # Sync batch if we have enough
        if len(pending_tracks) >= batch_size:
            synced = sync_batch()
            print(f"  └── ✅ Synced batch ({feeder.total_synced:,} total)")

        # Rate limiting - be nice
        time.sleep(random.uniform(0.5, 1.5))

    # Sync remaining
    if pending_tracks:
        synced = sync_to_supabase(pending_tracks)
        feeder.total_synced += synced
        pending_tracks = []

    # Phase 2: Bulk Query Discovery
    print()
    print("=" * 70)
    print("  PHASE 2: Bulk Query Discovery")
    print("=" * 70)

    for i, query in enumerate(BULK_QUERIES):
        if feeder.total_synced >= target_tracks:
            break

        print(f"\n[{i+1}/{len(BULK_QUERIES)}] 🔍 \"{query}\"")

        # Search songs
        songs = feeder.search_query(query, limit=50)
        print(f"  └── Found {len(songs)} songs")
        pending_tracks.extend(songs)

        # Search videos too
        videos = feeder.search_videos(query, limit=30)
        print(f"  └── Found {len(videos)} videos")
        pending_tracks.extend(videos)

        # Sync batch
        if len(pending_tracks) >= batch_size:
            synced = sync_batch()
            print(f"  └── ✅ Synced batch ({feeder.total_synced:,} total)")

        time.sleep(random.uniform(0.5, 1.0))

    # Final sync
    if pending_tracks:
        synced = sync_to_supabase(pending_tracks)
        feeder.total_synced += synced

    # Results
    elapsed = time.time() - start_time
    final_count = get_existing_count()

    print()
    print("=" * 70)
    print("  RESULTS")
    print("=" * 70)
    print(f"  Initial count:  {initial_count:,}")
    print(f"  Final count:    {final_count:,}")
    print(f"  New tracks:     +{final_count - initial_count:,}")
    print(f"  Synced:         {feeder.total_synced:,}")
    print(f"  Errors:         {feeder.errors}")
    print(f"  Time elapsed:   {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"  Rate:           {feeder.total_synced / (elapsed/60):.0f} tracks/min")
    print("=" * 70)
    print("  Built by DASH & ZION 🔥")
    print("=" * 70)

    return feeder.total_synced


if __name__ == '__main__':
    import sys

    target = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    run_mass_feed(target_tracks=target)
