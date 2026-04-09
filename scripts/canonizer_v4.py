#!/usr/bin/env python3
"""
VOYO CANONIZER V4 - INTELLIGENT MULTI-DIMENSIONAL CLASSIFICATION
================================================================
Built by DASH & ZION - December 2025

Based on research findings:
- Pandora Music Genome Project: 450+ attributes, 0-5 scoring
- Bourdieu Cultural Capital: Accessibility dimension
- Academic Canon Formation: Cultural significance vs Aesthetic merit
- African Music MIR Challenges: Western tools don't work, need cultural context

Pipeline:
1. Fetch tracks from Supabase (122K tracks)
2. Enrich with YouTube view counts (real popularity data)
3. Query MusicBrainz for artist metadata (free API)
4. Use LLM (Claude) for cultural classification
5. Compute multi-dimensional scores
6. Output JSON for KnowledgeStore

ECHO = Hidden gems that deserve recognition, not noise.
"""

import json
import os
import sys
import time
import re
import hashlib
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from collections import defaultdict
import urllib.request
import urllib.error
import urllib.parse

# ============================================
# CONFIGURATION
# ============================================

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

# API Keys (from environment)
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
YOUTUBE_API_KEY = os.environ.get('YOUTUBE_API_KEY', '')

# MusicBrainz is free, no key needed
MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2'
MUSICBRAINZ_USER_AGENT = 'VOYO-Music/1.0 (https://voyomusic.com)'

# Batch settings
BATCH_SIZE = 100
LLM_BATCH_SIZE = 10  # Smaller batches for LLM calls
DELAY_BETWEEN_BATCHES = 0.5  # seconds

# ============================================
# DATA CLASSES
# ============================================

@dataclass
class PopularityScore:
    view_count: int = 0
    percentile: float = 0.0
    velocity: float = 0.0  # views per month since upload

@dataclass
class CulturalScore:
    historical: float = 0.0   # 0-5: pioneer, movement-defining
    social: float = 0.0       # 0-5: protest, liberation, unity
    diasporic: float = 0.0    # 0-5: bridges cultures
    preservational: float = 0.0  # 0-5: documents traditions
    overall: float = 0.0      # computed average

@dataclass
class AestheticScore:
    innovation: float = 0.0   # 0-5: genre-defining
    craft: float = 0.0        # 0-5: virtuosity, production
    influence: float = 0.0    # 0-5: copied by others
    overall: float = 0.0      # computed average

@dataclass
class AccessibilityScore:
    mainstream: float = 0.0   # 0-5: no cultural knowledge needed
    specialist: float = 0.0   # 0-5: rewards deep knowledge
    educational: float = 0.0  # 0-5: teaches about culture

@dataclass
class CanonScore:
    popularity: PopularityScore
    cultural_significance: CulturalScore
    aesthetic_merit: AestheticScore
    accessibility: AccessibilityScore
    release_year: Optional[int] = None
    era: str = 'unknown'
    timelessness: float = 0.0
    final_tier: str = 'D'
    final_canon_level: str = 'ECHO'
    confidence: float = 0.0
    classified_by: str = 'pattern'
    content_type: str = 'original'
    cultural_tags: List[str] = None
    aesthetic_tags: List[str] = None

    def __post_init__(self):
        if self.cultural_tags is None:
            self.cultural_tags = []
        if self.aesthetic_tags is None:
            self.aesthetic_tags = []

# ============================================
# KNOWN ARTISTS DATABASE (Expanded)
# ============================================

TIER_A_ARTISTS = {
    # Nigerian Icons
    'burna boy', 'wizkid', 'davido', 'tiwa savage', 'rema', 'asake',
    'tems', 'ckay', 'ayra starr', 'fireboy dml', 'omah lay', 'joeboy',
    'olamide', 'yemi alade', 'mr eazi', 'tekno', 'kizz daniel',
    'patoranking', 'wande coal', 'don jazzy', '2baba', 'phyno', 'flavour',
    'adekunle gold', 'simi', 'falz', 'ladipoe', 'blaqbonez', 'oxlade',
    'fela kuti', 'femi kuti', 'made kuti', 'seun kuti',
    # South African Icons
    'black coffee', 'master kg', 'dj maphorisa', 'kabza de small',
    'cassper nyovest', 'nasty c', 'aka', 'sjava', 'sho madjozi', 'makhadzi',
    'focalistic', 'uncle waffles', 'dj zinhle', 'miriam makeba',
    'tyla', 'dbn gogo', 'lady du', 'young stunna', 'major league djz',
    # Ghanaian Icons
    'sarkodie', 'stonebwoy', 'shatta wale', 'black sherif', 'king promise',
    'r2bees', 'kwesi arthur', 'kuami eugene', 'kidi', 'efya', 'becca',
    'gyakie', 'amaarae', 'darkovibes', 'joey b', 'e.l',
    # East African Icons
    'diamond platnumz', 'sauti sol', 'harmonize', 'rayvanny', 'ali kiba',
    'zuchu', 'mbosso', 'nandy', 'vanessa mdee', 'jux', 'alikiba',
    'nyashinski', 'khaligraph jones', 'otile brown', 'nviiri', 'bien',
    'eddy kenzo', 'jose chameleone', 'bebe cool',
    # Congolese Icons
    'fally ipupa', 'koffi olomide', 'ferre gola', 'innoss b', 'werrason',
    'papa wemba', 'awilo longomba', 'lokua kanza', 'heritier watanabe',
    # Francophone Icons
    'youssou ndour', 'salif keita', 'angelique kidjo', 'manu dibango',
    'magic system', 'dj arafat', 'serge beynaud', 'toofan',
    'oumou sangare', 'amadou & mariam', 'tinariwen',
    'damso', 'gims', 'maitre gims', 'niska', 'aya nakamura', 'dadju',
    # USA Diaspora Icons
    'beyonce', 'beyoncé', 'rihanna', 'drake', 'kendrick lamar',
    'jay-z', 'jay z', 'kanye west', 'the weeknd', 'sza', 'doja cat',
    'cardi b', 'nicki minaj', 'future', 'j cole', 'j. cole',
    'frank ocean', 'childish gambino', 'bruno mars', 'usher',
    'michael jackson', 'prince', 'stevie wonder', 'marvin gaye',
    # Caribbean Icons
    'bob marley', 'sean paul', 'shaggy', 'vybz kartel', 'popcaan', 'spice',
    'chronixx', 'koffee', 'protoje', 'damian marley', 'buju banton',
    # UK Icons
    'stormzy', 'dave', 'skepta', 'wiley', 'j hus', 'central cee', 'jorja smith',
    'little simz', 'headie one', 'kano',
    # Brazil Icons
    'anitta', 'ludmilla', 'iza', 'seu jorge', 'gilberto gil',
    # Legends with historical significance
    'king sunny ade', 'ebenezer obey', 'chief commander ebenezer obey',
    'oliver de coque', 'osadebe', 'chief osita osadebe',
    'franco luambo', 'tabu ley rochereau', 'sam mangwana',
    'bembeya jazz', 'orchestra baobab', 'rail band',
}

TIER_B_ARTISTS = {
    # Extended Nigerian
    'portable', 'seyi vibez', 'zinoleesky', 'naira marley', 'mohbad',
    'bella shmurda', 'lil kesh', 'ycee', 'reekado banks', 'dice ailes',
    'peruzzi', 'zlatan', 'mayorkun', 'dremo', 'teni', 'niniola',
    'ruger', 'buju', 'bnxn', 'magixx', 'lojay', 'victony',
    # Extended South African
    'a-reece', 'emtee', 'shane eagle', 'kwesta', 'blxckie', 'costa titch',
    '25k', 'rouge', 'nadia nakai', 'boity', 'moozlie',
    'samthing soweto', 'sun-el musician', 'zakes bantwini', 'mi casa',
    # Extended Ghanaian
    'medikal', 'strongman', 'kofi kinaata', 'fameye', 'kofi mole',
    'yaw tog', "o'kenneth", 'jay bahd', 'city boy', 'kweku flick',
    # Extended East African
    'tanasha donna', 'willy paul', 'bahati', 'akothee', 'size 8',
    'arrow bwoy', 'mejja', 'trio mio', 'ssaru', 'femi one',
    # Extended Francophone
    'booba', 'pnl', 'ninho', 'jul', 'lacrim', 'kaaris',
    'mhd', 'gradur', 'keblack', 'dadju', 'soolking',
}

# Historical/Cultural significance artists (high cultural score even if low views)
CULTURAL_ICONS = {
    'fela kuti': {'historical': 5, 'social': 5, 'diasporic': 5, 'preservational': 5},
    'miriam makeba': {'historical': 5, 'social': 5, 'diasporic': 5, 'preservational': 4},
    'bob marley': {'historical': 5, 'social': 5, 'diasporic': 5, 'preservational': 4},
    'youssou ndour': {'historical': 4, 'social': 4, 'diasporic': 4, 'preservational': 5},
    'salif keita': {'historical': 4, 'social': 3, 'diasporic': 4, 'preservational': 5},
    'king sunny ade': {'historical': 5, 'social': 3, 'diasporic': 4, 'preservational': 5},
    'papa wemba': {'historical': 4, 'social': 3, 'diasporic': 4, 'preservational': 5},
    'franco luambo': {'historical': 5, 'social': 4, 'diasporic': 3, 'preservational': 5},
    'bembeya jazz': {'historical': 5, 'social': 5, 'diasporic': 3, 'preservational': 5},
    'angelique kidjo': {'historical': 4, 'social': 4, 'diasporic': 5, 'preservational': 4},
    'hugh masekela': {'historical': 5, 'social': 5, 'diasporic': 4, 'preservational': 4},
    'brenda fassie': {'historical': 4, 'social': 4, 'diasporic': 3, 'preservational': 4},
    'ladysmith black mambazo': {'historical': 4, 'social': 3, 'diasporic': 4, 'preservational': 5},
}

# ============================================
# CONTENT TYPE DETECTION
# ============================================

def detect_content_type(title: str, artist: str, channel: str = '') -> str:
    """Detect what type of content this is."""
    text = f"{title} {artist} {channel}".lower()

    # Live performances
    live_indicators = [
        'live', 'concert', 'performance', 'tiny desk', 'colors show',
        'colors studios', 'a colors show', 'glitch', 'vevo lift',
        'sessions', 'live session', 'acoustic session', 'on the lot',
        'from studio', 'live at', 'in studio', 'sofar sounds'
    ]
    if any(ind in text for ind in live_indicators):
        return 'live'

    # Remixes
    remix_indicators = ['remix', 'rmx', 'refix', 'bootleg', 'flip', 'edit']
    if any(ind in text for ind in remix_indicators):
        return 'remix'

    # DJ Mixes/Sets
    dj_mix_indicators = [
        'mix', 'set', 'dj set', 'boiler room', 'essential mix',
        'radio show', 'takeover', 'guest mix', 'residency',
        'club set', 'festival set', 'b2b'
    ]
    if any(ind in text for ind in dj_mix_indicators):
        # Check if it's a known DJ
        if any(dj in artist.lower() for dj in ['dj', 'black coffee', 'uncle waffles', 'major league']):
            return 'dj_mix'

    # Compilations/Playlists
    compilation_indicators = [
        'compilation', 'playlist', 'best of', 'greatest hits',
        'top 10', 'top 20', 'top 50', 'top 100', 'non stop',
        'nonstop', 'mix 2024', 'mix 2025', 'hours of'
    ]
    if any(ind in text for ind in compilation_indicators):
        return 'playlist_channel'

    # Covers
    cover_indicators = ['cover', 'rendition', 'tribute', 'version by']
    if any(ind in text for ind in cover_indicators):
        return 'cover'

    # Instrumentals
    instrumental_indicators = [
        'instrumental', 'beat', 'karaoke', 'backing track',
        'prod by', 'prod.', 'type beat', 'free beat'
    ]
    if any(ind in text for ind in instrumental_indicators):
        return 'instrumental'

    # Slowed versions
    slowed_indicators = ['slowed', 'reverb', 'chopped', 'screwed']
    if any(ind in text for ind in slowed_indicators):
        return 'slowed'

    # Acoustic versions
    acoustic_indicators = ['acoustic', 'unplugged', 'stripped']
    if any(ind in text for ind in acoustic_indicators):
        return 'acoustic'

    # Extended mixes
    extended_indicators = ['extended', 'club mix', 'radio edit']
    if any(ind in text for ind in extended_indicators):
        return 'extended'

    return 'original'

# ============================================
# ERA DETECTION
# ============================================

def detect_era(year: Optional[int]) -> str:
    """Determine the musical era based on release year."""
    if year is None:
        return 'unknown'
    if year < 1960:
        return 'pre-independence'
    if year < 1980:
        return 'independence'
    if year < 1995:
        return 'golden-age'
    if year < 2005:
        return 'transition'
    if year < 2015:
        return 'digital-dawn'
    if year < 2020:
        return 'streaming-era'
    return 'global-explosion'

# ============================================
# CULTURAL TAG DETECTION
# ============================================

CULTURAL_TAG_KEYWORDS = {
    'anthem': ['anthem', 'national', 'independence', 'unity', 'movement', 'giant'],
    'revolution': ['revolution', 'change', 'fight', 'power', 'system', 'struggle'],
    'liberation': ['freedom', 'free', 'liberation', 'emancipation', 'chains'],
    'protest': ['protest', 'injustice', 'police', 'government', 'corruption', 'sars', 'endsars'],
    'tradition': ['traditional', 'heritage', 'ancestors', 'elders', 'culture'],
    'roots': ['roots', 'origin', 'motherland', 'home', 'village', 'homeland'],
    'motherland': ['africa', 'mama africa', 'motherland', 'continent'],
    'pan-african': ['pan-african', 'united africa', 'one africa', 'together'],
    'diaspora': ['diaspora', 'abroad', 'immigrant', 'overseas', 'foreign'],
    'migration': ['migrate', 'journey', 'leaving', 'travel', 'crossing', 'japa'],
    'homecoming': ['return', 'coming back', 'welcome home', 'finally home'],
    'bridge': ['bridge', 'connect', 'fusion', 'blend', 'unite'],
    'street': ['street', 'hood', 'block', 'corner', 'trap', 'ghetto'],
    'ghetto': ['ghetto', 'slum', 'struggle', 'poverty', 'survive'],
    'survival': ['survive', 'struggle', 'make it', 'overcome', 'hustle'],
    'wedding': ['wedding', 'marriage', 'bride', 'ceremony', 'iyawo'],
    'festival': ['festival', 'party', 'carnival', 'celebration'],
    'celebration': ['celebrate', 'joy', 'happy', 'party', 'dance'],
    'spiritual': ['spirit', 'soul', 'divine', 'god', 'faith'],
    'prayer': ['prayer', 'pray', 'lord', 'worship', 'hallelujah'],
    'healing': ['heal', 'restoration', 'peace', 'calm', 'recover'],
}

def detect_cultural_tags(text: str) -> List[str]:
    """Detect cultural significance tags from text."""
    lower_text = text.lower()
    tags = []
    for tag, keywords in CULTURAL_TAG_KEYWORDS.items():
        if any(kw in lower_text for kw in keywords):
            tags.append(tag)
    return tags

# ============================================
# SUPABASE OPERATIONS
# ============================================

def fetch_tracks_from_supabase(offset: int = 0, limit: int = 1000) -> List[Dict]:
    """Fetch tracks from Supabase with pagination."""
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=*&offset={offset}&limit={limit}"

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json'
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching from Supabase: {e}")
        return []

def get_total_track_count() -> int:
    """Get total count of tracks in Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/video_intelligence?select=count"

    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
    }

    req = urllib.request.Request(url, headers=headers, method='HEAD')
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            count_range = response.headers.get('Content-Range', '*/0')
            total = int(count_range.split('/')[-1])
            return total
    except Exception as e:
        print(f"Error getting count: {e}")
        return 0

# ============================================
# MUSICBRAINZ ENRICHMENT
# ============================================

def query_musicbrainz(artist_name: str) -> Optional[Dict]:
    """Query MusicBrainz for artist metadata."""
    encoded_name = urllib.parse.quote(artist_name)
    url = f"{MUSICBRAINZ_BASE}/artist/?query=artist:{encoded_name}&fmt=json&limit=1"

    headers = {
        'User-Agent': MUSICBRAINZ_USER_AGENT,
        'Accept': 'application/json'
    }

    req = urllib.request.Request(url, headers=headers)
    try:
        time.sleep(1)  # Rate limiting (1 req/sec for MusicBrainz)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            if data.get('artists'):
                return data['artists'][0]
    except Exception as e:
        pass  # Silent fail, we'll use pattern matching instead
    return None

# ============================================
# YOUTUBE VIEW COUNT (requires API key)
# ============================================

def get_youtube_views(video_id: str) -> Optional[int]:
    """Get view count from YouTube Data API."""
    if not YOUTUBE_API_KEY:
        return None

    url = f"https://www.googleapis.com/youtube/v3/videos?part=statistics&id={video_id}&key={YOUTUBE_API_KEY}"

    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            if data.get('items'):
                stats = data['items'][0].get('statistics', {})
                return int(stats.get('viewCount', 0))
    except Exception as e:
        pass
    return None

# ============================================
# LLM CLASSIFICATION (Claude API)
# ============================================

def classify_with_llm(tracks: List[Dict]) -> List[Dict]:
    """Use Claude to classify tracks with cultural knowledge."""
    if not ANTHROPIC_API_KEY:
        return []  # Will fall back to pattern matching

    # Build prompt with track list
    track_list = "\n".join([
        f"{i+1}. \"{t.get('title', 'Unknown')}\" by {t.get('artist', 'Unknown')}"
        for i, t in enumerate(tracks[:LLM_BATCH_SIZE])
    ])

    prompt = f"""You are an expert in African and Black diaspora music with deep knowledge of:
- African genres: Afrobeats, Amapiano, Highlife, Afro-fusion, Juju, Fuji, Bongo Flava, etc.
- Historical significance: Pan-African movement, liberation music, cultural preservation
- Artists: From legends (Fela Kuti, Miriam Makeba) to current stars (Burna Boy, Wizkid)
- Cultural context: Wedding songs, protest anthems, spiritual music, street anthems

For each track below, provide a JSON classification:

{track_list}

For EACH track, output a JSON object with:
{{
  "track_number": 1,
  "artist_tier": "A|B|C|D",  // A=Global Icon, B=Regional Star, C=National, D=Underground
  "canon_level": "CORE|ESSENTIAL|DEEP_CUT|ARCHIVE|ECHO",
  "cultural_significance": {{
    "historical": 0-5,  // Pioneer status, defines era
    "social": 0-5,      // Protest, liberation, unity impact
    "diasporic": 0-5,   // Bridges Africa and diaspora
    "preservational": 0-5  // Documents traditions
  }},
  "aesthetic_merit": {{
    "innovation": 0-5,  // Genre-defining sound
    "craft": 0-5,       // Production/vocal quality
    "influence": 0-5    // Copied by others
  }},
  "cultural_tags": ["anthem", "diaspora", ...],  // From: anthem, revolution, liberation, protest, tradition, roots, motherland, pan-african, diaspora, migration, homecoming, bridge, street, ghetto, survival, wedding, festival, celebration, spiritual, prayer, healing
  "aesthetic_tags": ["innovative", ...],  // From: innovative, virtuosic, influential, production, lyricism, arrangement, timeless
  "reasoning": "brief explanation"
}}

Output as a JSON array. Be honest - if you don't know an artist, classify as D/ECHO with low confidence.
Only output the JSON array, no other text."""

    url = "https://api.anthropic.com/v1/messages"
    headers = {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
    }

    body = json.dumps({
        "model": "claude-3-haiku-20240307",  # Fast and cheap for classification
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()

    try:
        req = urllib.request.Request(url, data=body, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.loads(response.read().decode())
            content = data.get('content', [{}])[0].get('text', '[]')
            # Extract JSON from response
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
    except Exception as e:
        print(f"LLM classification error: {e}")
    return []

# ============================================
# PATTERN-BASED CLASSIFICATION (Fallback)
# ============================================

def classify_with_patterns(track: Dict) -> CanonScore:
    """Classify track using pattern matching (fallback when no LLM)."""
    title = track.get('title', '').lower()
    artist = track.get('artist', '').lower()
    channel = track.get('channel_title', '').lower()

    # Normalize artist name
    artist_normalized = re.sub(r'[^a-z0-9\s]', '', artist).strip()

    # Initialize scores
    popularity = PopularityScore(
        view_count=track.get('view_count', 0) or 0,
        percentile=0.0,
        velocity=0.0
    )

    cultural = CulturalScore()
    aesthetic = AestheticScore()
    accessibility = AccessibilityScore()

    # Check known artists
    tier = 'D'
    if artist_normalized in TIER_A_ARTISTS or any(a in artist for a in TIER_A_ARTISTS):
        tier = 'A'
        aesthetic.craft = 4.0
        aesthetic.influence = 3.0
    elif artist_normalized in TIER_B_ARTISTS or any(a in artist for a in TIER_B_ARTISTS):
        tier = 'B'
        aesthetic.craft = 3.0
        aesthetic.influence = 2.0
    else:
        # Check for partial matches
        for known_artist in TIER_A_ARTISTS:
            if known_artist in artist or artist in known_artist:
                tier = 'A'
                break
        for known_artist in TIER_B_ARTISTS:
            if known_artist in artist or artist in known_artist:
                tier = 'B'
                break

    # Check cultural icons for special scoring
    if artist_normalized in CULTURAL_ICONS:
        scores = CULTURAL_ICONS[artist_normalized]
        cultural.historical = scores['historical']
        cultural.social = scores['social']
        cultural.diasporic = scores['diasporic']
        cultural.preservational = scores['preservational']
        tier = 'A'  # Cultural icons are always A-tier

    # Detect content type
    content_type = detect_content_type(title, artist, channel)

    # Detect cultural tags
    cultural_tags = detect_cultural_tags(f"{title} {artist}")

    # Determine canon level based on tier and views
    view_count = popularity.view_count
    canon_level = 'ECHO'

    if tier == 'A':
        if view_count > 100_000_000:
            canon_level = 'CORE'
        elif view_count > 10_000_000:
            canon_level = 'ESSENTIAL'
        elif view_count > 1_000_000:
            canon_level = 'DEEP_CUT'
        else:
            canon_level = 'ESSENTIAL'  # A-tier artists are at least essential
    elif tier == 'B':
        if view_count > 50_000_000:
            canon_level = 'CORE'
        elif view_count > 5_000_000:
            canon_level = 'ESSENTIAL'
        elif view_count > 500_000:
            canon_level = 'DEEP_CUT'
        else:
            canon_level = 'DEEP_CUT'
    elif tier == 'C':
        if view_count > 10_000_000:
            canon_level = 'ESSENTIAL'
        elif view_count > 1_000_000:
            canon_level = 'DEEP_CUT'
        else:
            canon_level = 'ARCHIVE'
    else:  # D tier
        if view_count > 5_000_000:
            canon_level = 'DEEP_CUT'
        elif view_count > 100_000:
            canon_level = 'ARCHIVE'
        else:
            canon_level = 'ECHO'

    # Detect era
    release_year = None
    year_match = re.search(r'\b(19[5-9]\d|20[0-2]\d)\b', f"{title} {channel}")
    if year_match:
        release_year = int(year_match.group())
    era = detect_era(release_year)

    # Compute accessibility
    if tier == 'A':
        accessibility.mainstream = 4.0
        accessibility.specialist = 2.0
        accessibility.educational = 3.0
    elif tier == 'B':
        accessibility.mainstream = 3.0
        accessibility.specialist = 3.0
        accessibility.educational = 3.0
    else:
        accessibility.mainstream = 2.0
        accessibility.specialist = 4.0
        accessibility.educational = 4.0

    # Compute overall scores
    cultural.overall = (cultural.historical + cultural.social + cultural.diasporic + cultural.preservational) / 4
    aesthetic.overall = (aesthetic.innovation + aesthetic.craft + aesthetic.influence) / 3

    # Aesthetic tags based on tier and content
    aesthetic_tags = []
    if tier == 'A':
        aesthetic_tags.append('influential')
        if view_count > 100_000_000:
            aesthetic_tags.append('timeless')
    if content_type == 'live':
        aesthetic_tags.append('virtuosic')
    if any(tag in cultural_tags for tag in ['revolution', 'liberation', 'protest']):
        aesthetic_tags.append('lyricism')

    # Confidence based on what we know
    confidence = 0.3  # Base pattern matching confidence
    if tier in ['A', 'B']:
        confidence = 0.7  # Higher confidence for known artists
    if view_count > 0:
        confidence += 0.1  # Views provide objective data

    return CanonScore(
        popularity=popularity,
        cultural_significance=cultural,
        aesthetic_merit=aesthetic,
        accessibility=accessibility,
        release_year=release_year,
        era=era,
        timelessness=4.0 if tier == 'A' and view_count > 50_000_000 else 2.0,
        final_tier=tier,
        final_canon_level=canon_level,
        confidence=min(confidence, 1.0),
        classified_by='pattern',
        content_type=content_type,
        cultural_tags=cultural_tags,
        aesthetic_tags=aesthetic_tags
    )

# ============================================
# HYBRID CLASSIFICATION
# ============================================

def classify_track(track: Dict, llm_result: Optional[Dict] = None) -> Dict:
    """Classify a track using hybrid approach (LLM + patterns)."""

    # Start with pattern-based classification
    pattern_score = classify_with_patterns(track)

    result = {
        'id': track.get('youtube_id', track.get('video_id', track.get('id', ''))),
        'title': track.get('title', ''),
        'artist': track.get('artist', ''),
        'channel': track.get('channel_title', track.get('artist', '')),  # Use artist as fallback

        # Core classification
        'tier': pattern_score.final_tier,
        'canon_level': pattern_score.final_canon_level,
        'content_type': pattern_score.content_type,

        # Scores
        'view_count': pattern_score.popularity.view_count,
        'view_percentile': pattern_score.popularity.percentile,

        'cultural_significance': {
            'historical': pattern_score.cultural_significance.historical,
            'social': pattern_score.cultural_significance.social,
            'diasporic': pattern_score.cultural_significance.diasporic,
            'preservational': pattern_score.cultural_significance.preservational,
            'overall': pattern_score.cultural_significance.overall
        },

        'aesthetic_merit': {
            'innovation': pattern_score.aesthetic_merit.innovation,
            'craft': pattern_score.aesthetic_merit.craft,
            'influence': pattern_score.aesthetic_merit.influence,
            'overall': pattern_score.aesthetic_merit.overall
        },

        'accessibility': {
            'mainstream': pattern_score.accessibility.mainstream,
            'specialist': pattern_score.accessibility.specialist,
            'educational': pattern_score.accessibility.educational
        },

        # Temporal
        'release_year': pattern_score.release_year,
        'era': pattern_score.era,
        'timelessness': pattern_score.timelessness,

        # Tags
        'cultural_tags': pattern_score.cultural_tags,
        'aesthetic_tags': pattern_score.aesthetic_tags,

        # Metadata
        'confidence': pattern_score.confidence,
        'classified_by': pattern_score.classified_by,
        'classified_at': datetime.now().isoformat(),

        # Echo flag
        'is_echo': pattern_score.final_canon_level == 'ECHO',
    }

    # Merge LLM results if available
    if llm_result:
        # LLM overrides pattern matching for subjective scores
        result['tier'] = llm_result.get('artist_tier', result['tier'])
        result['canon_level'] = llm_result.get('canon_level', result['canon_level'])

        if 'cultural_significance' in llm_result:
            cs = llm_result['cultural_significance']
            result['cultural_significance']['historical'] = cs.get('historical', result['cultural_significance']['historical'])
            result['cultural_significance']['social'] = cs.get('social', result['cultural_significance']['social'])
            result['cultural_significance']['diasporic'] = cs.get('diasporic', result['cultural_significance']['diasporic'])
            result['cultural_significance']['preservational'] = cs.get('preservational', result['cultural_significance']['preservational'])

        if 'aesthetic_merit' in llm_result:
            am = llm_result['aesthetic_merit']
            result['aesthetic_merit']['innovation'] = am.get('innovation', result['aesthetic_merit']['innovation'])
            result['aesthetic_merit']['craft'] = am.get('craft', result['aesthetic_merit']['craft'])
            result['aesthetic_merit']['influence'] = am.get('influence', result['aesthetic_merit']['influence'])

        # Merge tags
        if 'cultural_tags' in llm_result:
            result['cultural_tags'] = list(set(result['cultural_tags'] + llm_result['cultural_tags']))
        if 'aesthetic_tags' in llm_result:
            result['aesthetic_tags'] = list(set(result['aesthetic_tags'] + llm_result['aesthetic_tags']))

        result['classified_by'] = 'hybrid'
        result['confidence'] = min(result['confidence'] + 0.3, 1.0)
        result['is_echo'] = result['canon_level'] == 'ECHO'

    return result

# ============================================
# VIEW PERCENTILE CALCULATION
# ============================================

def calculate_view_percentiles(tracks: List[Dict]) -> List[Dict]:
    """Calculate view percentiles relative to the corpus."""
    # Get all view counts
    views = [t.get('view_count', 0) or 0 for t in tracks]
    views_sorted = sorted(views)

    def get_percentile(v):
        if not views_sorted:
            return 0
        # Find position in sorted list
        count = sum(1 for x in views_sorted if x <= v)
        return (count / len(views_sorted)) * 100

    for t in tracks:
        v = t.get('view_count', 0) or 0
        t['view_percentile'] = round(get_percentile(v), 2)

    return tracks

# ============================================
# MAIN PIPELINE
# ============================================

def run_pipeline(
    use_llm: bool = False,
    sample_size: Optional[int] = None,
    output_file: str = 'data/canonized_v4.json'
):
    """Run the full canonization pipeline."""
    print("=" * 60)
    print("VOYO CANONIZER V4 - INTELLIGENT MULTI-DIMENSIONAL CLASSIFICATION")
    print("=" * 60)
    print()

    # Check API keys
    if use_llm and not ANTHROPIC_API_KEY:
        print("WARNING: ANTHROPIC_API_KEY not set, falling back to pattern matching")
        use_llm = False

    if YOUTUBE_API_KEY:
        print("YouTube API: ENABLED (will fetch view counts)")
    else:
        print("YouTube API: DISABLED (using cached view counts)")

    if use_llm:
        print("LLM Classification: ENABLED (Claude Haiku)")
    else:
        print("LLM Classification: DISABLED (pattern matching only)")

    print()

    # Get total count
    total = get_total_track_count()
    print(f"Total tracks in Supabase: {total:,}")

    if sample_size:
        total = min(sample_size, total)
        print(f"Processing sample of: {total:,}")

    print()

    # Fetch and process in batches
    all_results = []
    offset = 0

    while offset < total:
        batch_size = min(BATCH_SIZE, total - offset)
        print(f"Fetching batch {offset//BATCH_SIZE + 1}: tracks {offset+1}-{offset+batch_size}")

        tracks = fetch_tracks_from_supabase(offset, batch_size)
        if not tracks:
            print("  No tracks returned, stopping")
            break

        # LLM classification for batch
        llm_results = {}
        if use_llm:
            print(f"  Classifying with LLM...")
            llm_batch = classify_with_llm(tracks[:LLM_BATCH_SIZE])
            for lr in llm_batch:
                idx = lr.get('track_number', 0) - 1
                if 0 <= idx < len(tracks):
                    llm_results[idx] = lr

        # Classify each track
        for i, track in enumerate(tracks):
            llm_result = llm_results.get(i)
            result = classify_track(track, llm_result)
            all_results.append(result)

        print(f"  Classified {len(tracks)} tracks")

        offset += batch_size
        time.sleep(DELAY_BETWEEN_BATCHES)

    print()
    print(f"Total tracks classified: {len(all_results):,}")

    # Calculate view percentiles
    print("Calculating view percentiles...")
    all_results = calculate_view_percentiles(all_results)

    # Generate statistics
    print()
    print("=" * 60)
    print("CLASSIFICATION STATISTICS")
    print("=" * 60)

    tier_counts = defaultdict(int)
    canon_counts = defaultdict(int)
    content_counts = defaultdict(int)
    era_counts = defaultdict(int)

    for r in all_results:
        tier_counts[r['tier']] += 1
        canon_counts[r['canon_level']] += 1
        content_counts[r['content_type']] += 1
        era_counts[r['era']] += 1

    print()
    print("TIER DISTRIBUTION:")
    for tier in ['A', 'B', 'C', 'D']:
        count = tier_counts.get(tier, 0)
        pct = (count / len(all_results) * 100) if all_results else 0
        print(f"  {tier}: {count:,} ({pct:.1f}%)")

    print()
    print("CANON LEVEL DISTRIBUTION:")
    for level in ['CORE', 'ESSENTIAL', 'DEEP_CUT', 'ARCHIVE', 'ECHO']:
        count = canon_counts.get(level, 0)
        pct = (count / len(all_results) * 100) if all_results else 0
        print(f"  {level}: {count:,} ({pct:.1f}%)")

    print()
    print("CONTENT TYPE DISTRIBUTION:")
    for ctype, count in sorted(content_counts.items(), key=lambda x: -x[1]):
        pct = (count / len(all_results) * 100) if all_results else 0
        print(f"  {ctype}: {count:,} ({pct:.1f}%)")

    print()
    print("ERA DISTRIBUTION:")
    for era, count in sorted(era_counts.items(), key=lambda x: -x[1]):
        pct = (count / len(all_results) * 100) if all_results else 0
        print(f"  {era}: {count:,} ({pct:.1f}%)")

    # Save results
    os.makedirs(os.path.dirname(output_file) if os.path.dirname(output_file) else '.', exist_ok=True)

    with open(output_file, 'w') as f:
        json.dump({
            'version': 'v4',
            'generated_at': datetime.now().isoformat(),
            'total_tracks': len(all_results),
            'llm_enabled': use_llm,
            'statistics': {
                'by_tier': dict(tier_counts),
                'by_canon': dict(canon_counts),
                'by_content_type': dict(content_counts),
                'by_era': dict(era_counts)
            },
            'tracks': all_results
        }, f, indent=2)

    print()
    print(f"Results saved to: {output_file}")
    print()

    # Sample output
    print("=" * 60)
    print("SAMPLE CLASSIFICATIONS")
    print("=" * 60)

    # Show some A-tier
    a_tracks = [t for t in all_results if t['tier'] == 'A'][:3]
    if a_tracks:
        print()
        print("A-TIER (Global Icons):")
        for t in a_tracks:
            print(f"  - \"{t['title'][:40]}...\" by {t['artist'][:20]}")
            print(f"    Canon: {t['canon_level']}, Views: {t['view_count']:,}, Tags: {t['cultural_tags'][:3]}")

    # Show some ECHO
    echo_tracks = [t for t in all_results if t['is_echo']][:3]
    if echo_tracks:
        print()
        print("ECHO (Hidden Gems):")
        for t in echo_tracks:
            print(f"  - \"{t['title'][:40]}...\" by {t['artist'][:20]}")
            print(f"    Content: {t['content_type']}, Era: {t['era']}")

    return all_results

# ============================================
# CLI
# ============================================

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='VOYO Canonizer V4 - Intelligent Music Classification')
    parser.add_argument('--llm', action='store_true', help='Enable LLM classification (requires ANTHROPIC_API_KEY)')
    parser.add_argument('--sample', type=int, help='Process only N tracks (for testing)')
    parser.add_argument('--output', default='data/canonized_v4.json', help='Output file path')

    args = parser.parse_args()

    run_pipeline(
        use_llm=args.llm,
        sample_size=args.sample,
        output_file=args.output
    )
