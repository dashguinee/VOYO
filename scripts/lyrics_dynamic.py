#!/usr/bin/env python3
"""
VOYO Dynamic Lyrics - Community Edition
========================================
Uses syncedlyrics (open source, multiple providers)

YouTube ID → Synced LRC Lyrics

Providers: Musixmatch, NetEase, Megalobiz, Genius, Lrclib
No API keys needed. Community-driven.

Usage:
    python3 lyrics_dynamic.py <youtube_id>
    python3 lyrics_dynamic.py --search "Burna Boy Last Last"
    python3 lyrics_dynamic.py --server
    python3 lyrics_dynamic.py --batch A 100
"""

import sys
import json
import urllib.request
import urllib.parse
import re
import time
from typing import Optional, List, Dict
from dataclasses import dataclass, asdict

import syncedlyrics

# ============================================
# CONFIG
# ============================================

SUPABASE_URL = "https://anmgyxhnyhbyxzpjhxgx.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4"

# ============================================
# TYPES
# ============================================

@dataclass
class LyricLine:
    time: float  # seconds
    text: str

@dataclass
class LyricsResult:
    found: bool
    youtube_id: str
    title: str
    artist: str
    synced: bool
    lines: List[Dict]
    lrc: str  # raw LRC format
    plain: str  # plain text

# ============================================
# LRC PARSER
# ============================================

def parse_lrc(lrc: str) -> List[LyricLine]:
    """Parse LRC format into timed lines."""
    lines = []
    pattern = r'\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)'

    for match in re.finditer(pattern, lrc):
        minutes = int(match.group(1))
        seconds = int(match.group(2))
        ms = int(match.group(3).ljust(3, '0'))
        text = match.group(4).strip()

        if text and not text.startswith('作词') and not text.startswith('作曲'):
            time_sec = minutes * 60 + seconds + ms / 1000
            lines.append(LyricLine(time=time_sec, text=text))

    return sorted(lines, key=lambda x: x.time)

# ============================================
# YOUTUBE METADATA
# ============================================

def get_youtube_info(youtube_id: str) -> tuple:
    """Get title/artist from YouTube ID."""
    try:
        url = f"https://noembed.com/embed?url=https://www.youtube.com/watch?v={youtube_id}"
        req = urllib.request.Request(url, headers={'User-Agent': 'VOYO/1.0'})

        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        title = data.get('title', '')
        author = data.get('author_name', '').replace(' - Topic', '').replace('VEVO', '')

        # Parse "Artist - Song" format
        if ' - ' in title:
            parts = title.split(' - ', 1)
            artist = parts[0].strip()
            song = parts[1].strip()
        else:
            artist = author.strip()
            song = title

        # Clean suffixes
        song = re.sub(r'\s*\(Official.*?\)', '', song, flags=re.I)
        song = re.sub(r'\s*\(Audio.*?\)', '', song, flags=re.I)
        song = re.sub(r'\s*\(Lyric.*?\)', '', song, flags=re.I)
        song = re.sub(r'\s*\[.*?\]', '', song)
        song = re.sub(r'\s*\|.*$', '', song)
        song = re.sub(r'\s*ft\..*$', '', song, flags=re.I)
        song = re.sub(r'\s*feat\..*$', '', song, flags=re.I)

        return artist.strip(), song.strip()

    except Exception as e:
        print(f"[YouTube] Error: {e}", file=sys.stderr)
        return '', ''

# ============================================
# MAIN FUNCTIONS
# ============================================

def search_lyrics(query: str) -> LyricsResult:
    """Search for lyrics by query string."""
    try:
        lrc = syncedlyrics.search(query)

        if not lrc:
            return LyricsResult(
                found=False, youtube_id='', title=query, artist='',
                synced=False, lines=[], lrc='', plain=''
            )

        lines = parse_lrc(lrc)
        plain = '\n'.join(l.text for l in lines)

        return LyricsResult(
            found=True,
            youtube_id='',
            title=query,
            artist='',
            synced=bool(lines),
            lines=[{'time': l.time, 'text': l.text} for l in lines],
            lrc=lrc,
            plain=plain
        )

    except Exception as e:
        print(f"[Lyrics] Error: {e}", file=sys.stderr)
        return LyricsResult(
            found=False, youtube_id='', title=query, artist='',
            synced=False, lines=[], lrc='', plain=''
        )

def get_lyrics_by_id(youtube_id: str, title: str = '', artist: str = '') -> LyricsResult:
    """Get lyrics by YouTube ID."""
    # Get metadata if needed
    if not title or not artist:
        yt_artist, yt_title = get_youtube_info(youtube_id)
        artist = artist or yt_artist
        title = title or yt_title

    if not title:
        return LyricsResult(
            found=False, youtube_id=youtube_id, title='', artist='',
            synced=False, lines=[], lrc='', plain=''
        )

    # Search with artist + title
    query = f"{artist} {title}".strip()
    print(f"[Lyrics] Searching: {query}", file=sys.stderr)

    result = search_lyrics(query)
    result.youtube_id = youtube_id
    result.title = title
    result.artist = artist

    if result.found:
        print(f"[Lyrics] ✓ Found {len(result.lines)} synced lines", file=sys.stderr)
    else:
        print(f"[Lyrics] ✗ Not found", file=sys.stderr)

    return result

# ============================================
# BATCH PROCESSING
# ============================================

def batch_fetch(tier: str = 'A', limit: int = 100, save_to_supabase: bool = True):
    """Batch fetch lyrics for tracks."""
    # Fetch tracks from Supabase
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id,title,artist&artist_tier=eq.{tier}&limit={limit}"
    headers = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        tracks = json.loads(resp.read().decode())

    print(f"Processing {len(tracks)} Tier {tier} tracks...")

    found = 0
    not_found = 0
    results = []

    for i, track in enumerate(tracks):
        youtube_id = track['youtube_id']
        title = track.get('title', '')
        artist = track.get('artist', '')

        print(f"[{i+1}/{len(tracks)}] {artist} - {title}...", end=' ', flush=True)

        result = get_lyrics_by_id(youtube_id, title, artist)

        if result.found:
            found += 1
            print(f"✓ {len(result.lines)} lines")
            results.append(result)
        else:
            not_found += 1
            print("✗")

        time.sleep(0.5)  # Rate limit

    print(f"\nDone: {found} found, {not_found} not found")

    # Save results
    if results:
        output_file = f"lyrics_tier_{tier}.json"
        with open(output_file, 'w') as f:
            json.dump([asdict(r) for r in results], f, indent=2)
        print(f"Saved to {output_file}")

    return results

# ============================================
# HTTP SERVER
# ============================================

def run_server(port: int = 3099):
    from http.server import HTTPServer, BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            if parsed.path == '/lyrics':
                youtube_id = params.get('id', [''])[0]
                title = params.get('title', [''])[0]
                artist = params.get('artist', [''])[0]
                query = params.get('q', [''])[0]

                if query:
                    result = search_lyrics(query)
                elif youtube_id:
                    result = get_lyrics_by_id(youtube_id, title, artist)
                else:
                    self.wfile.write(json.dumps({'error': 'Missing id or q'}).encode())
                    return

                self.wfile.write(json.dumps(asdict(result)).encode())

            elif parsed.path == '/health':
                self.wfile.write(b'{"status":"ok"}')

            else:
                self.wfile.write(b'{"error":"not found"}')

        def do_OPTIONS(self):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.end_headers()

        def log_message(self, *args):
            pass

    print(f"VOYO Lyrics API on http://localhost:{port}")
    print(f"  GET /lyrics?id=<youtube_id>")
    print(f"  GET /lyrics?q=<search_query>")
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()

# ============================================
# CLI
# ============================================

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 lyrics_dynamic.py <youtube_id>")
        print("  python3 lyrics_dynamic.py --search 'Burna Boy Last Last'")
        print("  python3 lyrics_dynamic.py --server [port]")
        print("  python3 lyrics_dynamic.py --batch <tier> <limit>")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == '--server':
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 3099
        run_server(port)

    elif cmd == '--search':
        query = ' '.join(sys.argv[2:])
        result = search_lyrics(query)
        print(json.dumps(asdict(result), indent=2))

    elif cmd == '--batch':
        tier = sys.argv[2] if len(sys.argv) > 2 else 'A'
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 100
        batch_fetch(tier, limit)

    else:
        # Assume it's a YouTube ID
        youtube_id = cmd
        title = sys.argv[2] if len(sys.argv) > 2 else ''
        artist = sys.argv[3] if len(sys.argv) > 3 else ''
        result = get_lyrics_by_id(youtube_id, title, artist)
        print(json.dumps(asdict(result), indent=2))
