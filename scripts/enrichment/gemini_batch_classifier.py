#!/usr/bin/env python3
"""
VOYO Enrichment Phase 3: Gemini AI Batch Classification
=======================================================
Uses Gemini 2.0 Flash to classify tracks with cultural intelligence.

Usage:
    export GOOGLE_API_KEY=your_key
    python scripts/enrichment/gemini_batch_classifier.py --batch-size 50 --limit 1000
"""

import json
import os
import sys
import time
import asyncio
import re
from typing import Dict, List, Optional
from datetime import datetime

# ============================================
# CONFIGURATION
# ============================================

GOOGLE_API_KEY = os.environ.get('GOOGLE_API_KEY', '')

# Supabase config
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://anmgyxhnyhbyxzpjhxgx.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4')

# Batch settings
DEFAULT_BATCH_SIZE = 50
DELAY_BETWEEN_BATCHES = 1.0  # seconds

# ============================================
# GEMINI CLASSIFICATION PROMPT
# ============================================

SYSTEM_PROMPT = """You are an expert in African and Black diaspora music with encyclopedic knowledge of:

GEOGRAPHIC EXPERTISE:
- West Africa: Nigeria (Afrobeats, Fuji, Juju), Ghana (Highlife, Hiplife), Senegal (Mbalax), Mali, Guinea
- East Africa: Tanzania (Bongo Flava), Kenya (Gengetone, Benga), Uganda
- South Africa: Amapiano, Kwaito, Gqom, SA House, Maskandi
- Central Africa: Congo (Rumba, Soukous, Ndombolo), Cameroon (Makossa)
- Caribbean: Reggae, Dancehall, Soca, Zouk, Kompa
- Diaspora: Hip-Hop, R&B, UK Afroswing, Grime

TIER DEFINITIONS:
- A (Global Icon): Grammy winners, 100M+ streams, household names globally
- B (Regional Star): Multi-country fame, 10M+ streams, known across Africa
- C (National Artist): Known within their country, emerging talent
- D (Underground/Echo): Hidden gems, local scenes, artists who deserve recognition

ERA DEFINITIONS:
- pre-1990: Classic recordings, independence era, early pioneers
- 1990s: Golden age of Highlife/Soukous, early digital
- 2000s: P-Square era, digital revolution begins
- 2010s: Wizkid/Davido rise, streaming era
- 2020s: Global explosion, Grammy wins, TikTok virality

VIBE DEFINITIONS (0-100 scores):
- afro_heat: High energy African music, makes you move
- chill: Relaxed, smooth, easy listening
- party: Club bangers, celebrations, dancing
- workout: Motivational, high BPM, gym music
- late_night: Slow jams, intimate, bedroom vibes

CULTURAL TAGS (choose applicable):
- anthem: National/cultural anthems
- revolution: Political/protest music
- liberation: Freedom themes
- tradition: Traditional sounds preserved
- roots: Deep cultural heritage
- motherland: Africa-centric themes
- diaspora: Diaspora experience
- bridge: Bridges cultures
- street: Street life, hustle
- celebration: Wedding/festival music
- spiritual: Gospel, worship
- healing: Restoration themes

RULES:
1. If you don't recognize an artist, use D tier with confidence 0.3
2. Cultural significance > Commercial success (historical importance matters)
3. Era is about SOUND style, not just release year
4. Be honest about uncertainty
5. ECHO is positive - hidden gems deserve discovery"""

CLASSIFICATION_PROMPT = """Classify these tracks:

{track_list}

For EACH track, output a JSON object:
{{
  "track_number": 1,
  "artist_tier": "A|B|C|D",
  "era": "pre-1990|1990s|2000s|2010s|2020s",
  "primary_genre": "genre name",
  "vibe_scores": {{
    "afro_heat": 0-100,
    "chill": 0-100,
    "party": 0-100,
    "workout": 0-100,
    "late_night": 0-100
  }},
  "cultural_tags": ["tag1", "tag2"],
  "aesthetic_tags": ["tag1"],
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}}

Output as a JSON array only. No markdown, no explanation text."""

# ============================================
# HTTP UTILITIES
# ============================================

import urllib.request
import urllib.error

def http_post(url: str, headers: Dict, body: bytes, timeout: int = 60) -> Dict:
    """Make HTTP POST request."""
    req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode())

def http_get(url: str, headers: Dict, timeout: int = 30) -> Dict:
    """Make HTTP GET request."""
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode())

# ============================================
# SUPABASE OPERATIONS
# ============================================

def fetch_unclassified_tracks(limit: int = 1000, offset: int = 0) -> List[Dict]:
    """Fetch tracks that need classification."""
    # Fetch tracks without enrichment
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id,title,artist,channel_name&order=voyo_play_count.desc.nullslast&limit={limit}&offset={offset}"

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json'
    }

    try:
        return http_get(url, headers)
    except Exception as e:
        print(f"Error fetching tracks: {e}")
        return []

def update_track_enrichment(youtube_id: str, enrichment: Dict) -> bool:
    """Update a track with enrichment data."""
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?youtube_id=eq.{youtube_id}"

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }

    # Prepare update payload
    payload = {
        'artist_tier': enrichment.get('artist_tier'),
        'era': enrichment.get('era'),
        'primary_genre': enrichment.get('primary_genre'),
        'vibe_scores': enrichment.get('vibe_scores'),
        'cultural_tags': enrichment.get('cultural_tags', []),
        'aesthetic_tags': enrichment.get('aesthetic_tags', []),
        'enrichment_source': 'gemini',
        'enrichment_confidence': enrichment.get('confidence', 0.5),
        'enriched_at': datetime.now().isoformat(),
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers=headers,
            method='PATCH'
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            return True
    except Exception as e:
        print(f"Error updating {youtube_id}: {e}")
        return False

# ============================================
# GEMINI API
# ============================================

def classify_with_gemini(tracks: List[Dict]) -> List[Dict]:
    """Classify tracks using Gemini 2.0 Flash."""
    if not GOOGLE_API_KEY:
        print("ERROR: GOOGLE_API_KEY not set")
        return []

    # Build track list
    track_list = "\n".join([
        f"{i+1}. \"{t.get('title', 'Unknown')}\" by {t.get('artist', t.get('channel_name', 'Unknown'))}"
        for i, t in enumerate(tracks)
    ])

    prompt = CLASSIFICATION_PROMPT.format(track_list=track_list)

    # Gemini API call
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key={GOOGLE_API_KEY}"

    headers = {
        'Content-Type': 'application/json'
    }

    body = json.dumps({
        "contents": [{
            "parts": [
                {"text": SYSTEM_PROMPT},
                {"text": prompt}
            ]
        }],
        "generationConfig": {
            "temperature": 0.3,
            "topK": 40,
            "topP": 0.95,
            "maxOutputTokens": 8192,
        }
    }).encode()

    try:
        response = http_post(url, headers, body, timeout=120)

        # Extract text from response
        candidates = response.get('candidates', [])
        if not candidates:
            print("No candidates in Gemini response")
            return []

        text = candidates[0].get('content', {}).get('parts', [{}])[0].get('text', '')

        # Parse JSON from response
        # Try to find JSON array in response
        json_match = re.search(r'\[[\s\S]*\]', text)
        if json_match:
            return json.loads(json_match.group())
        else:
            print(f"Could not find JSON in response: {text[:200]}...")
            return []

    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        return []
    except Exception as e:
        print(f"Gemini API error: {e}")
        return []

# ============================================
# BATCH PROCESSING
# ============================================

def process_batch(tracks: List[Dict], save_to_db: bool = True) -> List[Dict]:
    """Process a batch of tracks through Gemini."""
    print(f"  Classifying {len(tracks)} tracks with Gemini...")

    results = classify_with_gemini(tracks)

    if not results:
        print("  No results from Gemini")
        return []

    print(f"  Got {len(results)} classifications")

    # Match results back to tracks
    enriched = []
    for result in results:
        idx = result.get('track_number', 0) - 1
        if 0 <= idx < len(tracks):
            track = tracks[idx]
            enrichment = {
                'youtube_id': track.get('youtube_id'),
                'title': track.get('title'),
                'artist': track.get('artist'),
                'artist_tier': result.get('artist_tier', 'D'),
                'era': result.get('era', '2020s'),
                'primary_genre': result.get('primary_genre', 'unknown'),
                'vibe_scores': result.get('vibe_scores', {}),
                'cultural_tags': result.get('cultural_tags', []),
                'aesthetic_tags': result.get('aesthetic_tags', []),
                'confidence': result.get('confidence', 0.5),
                'reasoning': result.get('reasoning', ''),
            }
            enriched.append(enrichment)

            # Save to database
            if save_to_db:
                success = update_track_enrichment(track['youtube_id'], enrichment)
                if success:
                    print(f"    Updated: {track['title'][:40]}... [{enrichment['artist_tier']}]")

    return enriched

def run_enrichment_pipeline(
    batch_size: int = DEFAULT_BATCH_SIZE,
    limit: int = 1000,
    offset: int = 0,
    save_to_db: bool = True,
    output_file: Optional[str] = None
):
    """Run the full enrichment pipeline."""
    print("=" * 60)
    print("VOYO Gemini Batch Classifier")
    print("=" * 60)
    print()

    if not GOOGLE_API_KEY:
        print("ERROR: GOOGLE_API_KEY environment variable not set")
        print("Run: export GOOGLE_API_KEY=your_api_key")
        sys.exit(1)

    print(f"Batch size: {batch_size}")
    print(f"Total limit: {limit}")
    print(f"Starting offset: {offset}")
    print(f"Save to DB: {save_to_db}")
    print()

    # Fetch tracks
    print("Fetching tracks from Supabase...")
    tracks = fetch_unclassified_tracks(limit, offset)
    print(f"Fetched {len(tracks)} tracks")
    print()

    if not tracks:
        print("No tracks to process")
        return

    # Process in batches
    all_enriched = []
    total_batches = (len(tracks) + batch_size - 1) // batch_size

    for i in range(0, len(tracks), batch_size):
        batch_num = i // batch_size + 1
        batch = tracks[i:i + batch_size]

        print(f"Batch {batch_num}/{total_batches}")
        enriched = process_batch(batch, save_to_db)
        all_enriched.extend(enriched)

        # Rate limiting
        if i + batch_size < len(tracks):
            print(f"  Waiting {DELAY_BETWEEN_BATCHES}s...")
            time.sleep(DELAY_BETWEEN_BATCHES)

    print()
    print("=" * 60)
    print("ENRICHMENT COMPLETE")
    print("=" * 60)
    print()
    print(f"Total tracks processed: {len(tracks)}")
    print(f"Successfully enriched: {len(all_enriched)}")

    # Stats
    if all_enriched:
        tier_counts = {}
        era_counts = {}
        for e in all_enriched:
            tier = e.get('artist_tier', 'D')
            era = e.get('era', 'unknown')
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
            era_counts[era] = era_counts.get(era, 0) + 1

        print()
        print("Tier Distribution:")
        for tier in ['A', 'B', 'C', 'D']:
            count = tier_counts.get(tier, 0)
            pct = (count / len(all_enriched) * 100) if all_enriched else 0
            print(f"  {tier}: {count} ({pct:.1f}%)")

        print()
        print("Era Distribution:")
        for era, count in sorted(era_counts.items(), key=lambda x: -x[1]):
            pct = (count / len(all_enriched) * 100) if all_enriched else 0
            print(f"  {era}: {count} ({pct:.1f}%)")

    # Save to file if requested
    if output_file:
        with open(output_file, 'w') as f:
            json.dump({
                'generated_at': datetime.now().isoformat(),
                'total_processed': len(tracks),
                'total_enriched': len(all_enriched),
                'tracks': all_enriched
            }, f, indent=2)
        print()
        print(f"Results saved to: {output_file}")

    return all_enriched

# ============================================
# CLI
# ============================================

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='VOYO Gemini Batch Classifier')
    parser.add_argument('--batch-size', type=int, default=DEFAULT_BATCH_SIZE, help='Tracks per API call')
    parser.add_argument('--limit', type=int, default=1000, help='Total tracks to process')
    parser.add_argument('--offset', type=int, default=0, help='Starting offset')
    parser.add_argument('--no-save', action='store_true', help='Do not save to database')
    parser.add_argument('--output', type=str, help='Save results to JSON file')

    args = parser.parse_args()

    run_enrichment_pipeline(
        batch_size=args.batch_size,
        limit=args.limit,
        offset=args.offset,
        save_to_db=not args.no_save,
        output_file=args.output
    )
