# VOYO Track Enrichment Strategy
## Enriching 324,000 Tracks for Vibe-Ready Playback

**Created**: January 7, 2026
**Author**: DASH + ZION SYNAPSE
**Goal**: Transform 94% D-tier unclassified tracks into vibe-ready music

---

## Current State Analysis

| Metric | Current | Target |
|--------|---------|--------|
| D-tier (unclassified) | 94% (~305K) | <30% |
| Unknown era | 95% (~308K) | <20% |
| Has cultural tags | 5% (~16K) | 80% |
| Has aesthetic tags | 5% (~16K) | 80% |
| ESSENTIAL tracks | 49 | 5,000+ |
| Vibe-ready | ~200 | 260,000+ |

**Vibe-Ready Definition**: Track has:
- `artist_tier` (A/B/C/D)
- `era` (80s/90s/2000s/2010s/2020s/new_wave)
- At least 2 cultural OR aesthetic tags
- At least 2 vibe_scores > 0

---

## The 5-Phase Enrichment Pipeline

### Phase 1: Artist Master Database (Impact: ~150K tracks)
**Effort**: 2 days | **Cost**: $0

The fastest way to enrich tracks is via artist. One artist classification = hundreds of tracks enriched.

**Data Model**: `artist_master.json`
```json
{
  "burna boy": {
    "canonical_name": "Burna Boy",
    "tier": "A",
    "country": "NG",
    "region": "west-africa",
    "primary_genre": "afrobeats",
    "secondary_genres": ["afro-fusion", "reggae"],
    "era_active": ["2010s", "2020s"],
    "cultural_significance": {
      "historical": 5,
      "social": 5,
      "diasporic": 5,
      "preservational": 3
    },
    "default_cultural_tags": ["anthem", "diaspora", "pan-african"],
    "default_aesthetic_tags": ["influential", "production", "lyricism"],
    "default_vibe_scores": {
      "afro_heat": 80,
      "party": 70,
      "chill": 40,
      "workout": 60,
      "late_night": 50
    }
  }
}
```

**Implementation**: `/home/dash/voyo-music/scripts/build_artist_master.py`

```python
#!/usr/bin/env python3
"""
Phase 1: Build Artist Master Database
- Start with known A/B tier artists from artistTiers.ts (169 artists)
- Expand with top artists from Supabase (by play count)
- Apply to all tracks automatically
"""

import json
from collections import defaultdict

# Import existing tiers from artistTiers.ts (converted)
TIER_A_ARTISTS = {
    # From existing artistTiers.ts - 73 A-tier artists
    'burna boy': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats'},
    'wizkid': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats'},
    'davido': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop'},
    'rema': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats'},
    'asake': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'amapiano'},
    'tems': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afro-soul'},
    'black coffee': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'afro-house'},
    'tyla': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano'},
    'diamond platnumz': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava'},
    'fally ipupa': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'ndombolo'},
    'youssou ndour': {'country': 'SN', 'region': 'west-africa', 'primary_genre': 'mbalax'},
    # ... etc (expand from existing artistTiers.ts)
}

# Default vibe scores by genre
GENRE_VIBE_DEFAULTS = {
    'afrobeats': {'afro_heat': 85, 'party': 75, 'chill': 35, 'workout': 70, 'late_night': 45},
    'amapiano': {'afro_heat': 70, 'party': 90, 'chill': 50, 'workout': 60, 'late_night': 80},
    'afro-house': {'afro_heat': 65, 'party': 85, 'chill': 40, 'workout': 75, 'late_night': 70},
    'afro-soul': {'afro_heat': 40, 'party': 30, 'chill': 85, 'workout': 20, 'late_night': 75},
    'bongo-flava': {'afro_heat': 75, 'party': 70, 'chill': 45, 'workout': 55, 'late_night': 50},
    'ndombolo': {'afro_heat': 80, 'party': 90, 'chill': 20, 'workout': 70, 'late_night': 60},
    'mbalax': {'afro_heat': 75, 'party': 80, 'chill': 30, 'workout': 65, 'late_night': 40},
    'highlife': {'afro_heat': 60, 'party': 65, 'chill': 70, 'workout': 40, 'late_night': 55},
    'rumba': {'afro_heat': 50, 'party': 60, 'chill': 75, 'workout': 30, 'late_night': 80},
    'gqom': {'afro_heat': 90, 'party': 95, 'chill': 10, 'workout': 85, 'late_night': 70},
    'kwaito': {'afro_heat': 65, 'party': 75, 'chill': 55, 'workout': 50, 'late_night': 65},
    'afropop': {'afro_heat': 80, 'party': 70, 'chill': 45, 'workout': 60, 'late_night': 50},
    'alte': {'afro_heat': 50, 'party': 40, 'chill': 80, 'workout': 30, 'late_night': 85},
    'gospel': {'afro_heat': 30, 'party': 40, 'chill': 70, 'workout': 35, 'late_night': 25},
}

def build_artist_master():
    """Build the master artist database."""
    master = {}

    for artist, info in TIER_A_ARTISTS.items():
        genre = info.get('primary_genre', 'afrobeats')
        vibe_scores = GENRE_VIBE_DEFAULTS.get(genre, GENRE_VIBE_DEFAULTS['afrobeats'])

        master[artist] = {
            'canonical_name': artist.title(),
            'tier': 'A',
            'country': info.get('country', 'XX'),
            'region': info.get('region', 'unknown'),
            'primary_genre': genre,
            'default_vibe_scores': vibe_scores,
            # Will be enriched further
        }

    return master

if __name__ == '__main__':
    master = build_artist_master()
    with open('data/artist_master.json', 'w') as f:
        json.dump(master, f, indent=2)
    print(f"Built artist master with {len(master)} artists")
```

**SQL to Apply Artist Enrichment**:
```sql
-- Apply artist tier to all matching tracks
UPDATE video_intelligence vi
SET
  artist_tier = am.tier,
  region = am.region,
  primary_genre = am.primary_genre,
  vibe_scores = am.default_vibe_scores,
  enrichment_source = 'artist_master',
  enriched_at = NOW()
FROM artist_master am
WHERE LOWER(vi.artist) LIKE '%' || am.normalized_name || '%'
  AND vi.artist_tier IS NULL;
```

---

### Phase 2: Title-Based Pattern Enrichment (Impact: ~80K tracks)
**Effort**: 1 day | **Cost**: $0

Extract metadata from track titles using pattern matching.

**Pattern Categories**:

```python
# Era detection from title/channel
ERA_PATTERNS = {
    'pre-1990': [r'\b(198[0-9])\b', r'\b(197[0-9])\b', r'classic', r'old school'],
    '1990s': [r'\b(199[0-9])\b', r'90s', r'nineties'],
    '2000s': [r'\b(200[0-9])\b', r'2000s', r'y2k'],
    '2010s': [r'\b(201[0-9])\b', r'2010s'],
    '2020s': [r'\b(202[0-9])\b', r'2024', r'2025', r'2026'],
}

# Mood/vibe detection from title
VIBE_KEYWORDS = {
    'afro_heat': ['fire', 'banger', 'lit', 'hype', 'energy', 'vibes'],
    'chill': ['chill', 'relax', 'mellow', 'calm', 'smooth', 'easy'],
    'party': ['party', 'club', 'dance', 'turn up', 'celebration', 'fiesta'],
    'workout': ['workout', 'gym', 'motivation', 'beast', 'grind', 'hustle'],
    'late_night': ['late night', 'midnight', 'after hours', 'slow jam', 'bedroom'],
    'romantic': ['love', 'baby', 'darling', 'sweetheart', 'forever'],
    'spiritual': ['god', 'praise', 'worship', 'blessed', 'gospel'],
}

# Language detection -> Region inference
LANGUAGE_PATTERNS = {
    'yoruba': {'keywords': ['omo', 'aye', 'ife', 'oba'], 'region': 'west-africa', 'country': 'NG'},
    'igbo': {'keywords': ['nwanne', 'onye', 'nkem'], 'region': 'west-africa', 'country': 'NG'},
    'swahili': {'keywords': ['bongo', 'mapenzi', 'nakupenda'], 'region': 'east-africa'},
    'french': {'keywords': ['amour', 'coeur', 'vie', 'nuit'], 'region': 'francophone'},
    'portuguese': {'keywords': ['amor', 'coração', 'vida'], 'region': 'lusophone'},
    'zulu': {'keywords': ['umuntu', 'ubuntu', 'inkosi'], 'region': 'south-africa', 'country': 'ZA'},
}

# Cultural tag keywords
CULTURAL_TAG_PATTERNS = {
    'anthem': ['anthem', 'independence', 'unity', 'national', 'movement'],
    'revolution': ['revolution', 'protest', 'freedom', 'liberation', 'fight'],
    'celebration': ['wedding', 'birthday', 'party', 'celebration', 'owambe'],
    'spiritual': ['prayer', 'worship', 'praise', 'god', 'jah', 'blessed'],
    'street': ['street', 'hood', 'ghetto', 'hustle', 'survival'],
    'diaspora': ['diaspora', 'abroad', 'japa', 'overseas'],
    'motherland': ['africa', 'motherland', 'home', 'roots'],
    'tradition': ['traditional', 'folklore', 'heritage', 'ancestors'],
}
```

**Implementation**: Regex-based batch processing

```python
def enrich_from_title(title: str, artist: str) -> dict:
    """Extract metadata from title using patterns."""
    text = f"{title} {artist}".lower()

    enrichment = {
        'era': detect_era(text),
        'vibe_scores': detect_vibes(text),
        'cultural_tags': detect_cultural_tags(text),
        'language_region': detect_language_region(text),
    }

    return enrichment
```

---

### Phase 3: AI Batch Classification (Impact: ~100K tracks)
**Effort**: 3-5 days | **Cost**: ~$50-100 (Gemini API)

Use Gemini 2.0 Flash for intelligent classification of remaining unclassified tracks.

**Gemini Prompt Template**:
```
You are an expert in African and Black diaspora music. Classify these tracks:

TRACK LIST:
1. "Calm Down" by Rema
2. "Last Last" by Burna Boy
3. "Water" by Tyla
... (batch of 50)

For each track, output JSON:
{
  "track_number": 1,
  "artist_tier": "A",  // A=Global Icon, B=Regional Star, C=National, D=Underground
  "era": "2020s",  // pre-1990, 1990s, 2000s, 2010s, 2020s
  "primary_genre": "afrobeats",
  "vibe_scores": {
    "afro_heat": 85,  // 0-100
    "chill": 30,
    "party": 75,
    "workout": 60,
    "late_night": 40
  },
  "cultural_tags": ["celebration", "diaspora"],
  "aesthetic_tags": ["production", "influential"],
  "confidence": 0.9
}

Rules:
- If unknown artist, use D tier with low confidence
- Era based on sound style, not just release year
- Cultural > Commercial (historical significance matters)
- Be honest about uncertainty
```

**Batch Processing Strategy**:
```python
# Process in batches of 50 tracks
# Priority order:
# 1. Tracks from A/B tier artists (already identified) - fill gaps
# 2. Tracks with high play counts but no tags
# 3. Remaining tracks by artist alphabetically

async def batch_classify_with_gemini(tracks: list[dict], batch_size=50):
    """Classify tracks using Gemini 2.0 Flash."""
    results = []

    for i in range(0, len(tracks), batch_size):
        batch = tracks[i:i+batch_size]
        prompt = build_classification_prompt(batch)

        response = await gemini.generate_content(prompt)
        classifications = parse_gemini_response(response)

        results.extend(classifications)
        await asyncio.sleep(0.5)  # Rate limiting

    return results
```

**Cost Estimation**:
- Gemini 2.0 Flash: ~$0.075 per 1M input tokens
- Average prompt: ~500 tokens per batch
- 324K tracks / 50 = 6,480 batches
- Total tokens: ~3.2M input + ~3.2M output
- Estimated cost: ~$50-100

---

### Phase 4: Community Enrichment (Impact: Ongoing refinement)
**Effort**: Build once, runs forever | **Cost**: $0

Let users provide feedback on vibe accuracy during playback.

**UI Integration**:
```typescript
// In player UI, after track plays for 30+ seconds
<VibeCheck
  trackId={currentTrack.id}
  currentVibe={currentVibe}  // e.g., "party-mode"
  onFeedback={(correct: boolean, actualVibe?: string) => {
    submitVibeFeedback(trackId, currentVibe, correct, actualVibe);
  }}
/>

// Simple UI:
// "Is this track right for Party Mode? 👍 👎"
// If thumbs down: "What vibe is it? [Chill] [Workout] [Late Night] [Other]"
```

**Backend Processing**:
```sql
-- Track vibe feedback table
CREATE TABLE vibe_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id TEXT NOT NULL,
  suggested_vibe TEXT NOT NULL,
  user_response BOOLEAN NOT NULL,  -- true=correct, false=incorrect
  alternative_vibe TEXT,  -- if incorrect, what they suggested
  username TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-correct vibes after N consistent feedback
CREATE OR REPLACE FUNCTION auto_correct_vibes()
RETURNS TRIGGER AS $$
BEGIN
  -- If 5+ users say a track doesn't fit a vibe
  -- And 3+ suggest the same alternative
  -- Auto-update the vibe scores
  ...
END;
$$ LANGUAGE plpgsql;
```

---

### Phase 5: Vibe Score Computation (Final Assembly)
**Effort**: 1 day | **Cost**: $0

Combine all enrichment sources into final vibe scores.

**Vibe Score Formula**:
```python
def compute_final_vibe_scores(track: dict) -> dict:
    """Compute final vibe scores from all sources."""

    scores = {
        'afro_heat': 0,
        'chill': 0,
        'party': 0,
        'workout': 0,
        'late_night': 0,
    }

    # Weight sources differently
    weights = {
        'artist_master': 0.4,      # Artist defaults
        'title_patterns': 0.2,     # Keyword detection
        'ai_classification': 0.3,  # Gemini output
        'community_feedback': 0.1, # User corrections
    }

    # Blend scores from all sources
    for source, weight in weights.items():
        source_scores = track.get(f'{source}_vibes', {})
        for vibe, score in source_scores.items():
            scores[vibe] += score * weight

    # Normalize to 0-100
    max_score = max(scores.values()) or 1
    return {k: int(v / max_score * 100) for k, v in scores.items()}
```

---

## Priority Queue: Which Tracks to Enrich First

### Priority 1: A-Tier Artists (Est. 15K tracks)
**Why**: Highest impact. These tracks are most likely to be played.
```sql
SELECT * FROM video_intelligence
WHERE LOWER(artist) IN (SELECT normalized_name FROM artist_master WHERE tier = 'A')
  AND artist_tier IS NULL
LIMIT 15000;
```

### Priority 2: B-Tier Artists (Est. 25K tracks)
**Why**: Regional stars, high engagement potential.
```sql
SELECT * FROM video_intelligence
WHERE LOWER(artist) IN (SELECT normalized_name FROM artist_master WHERE tier = 'B')
  AND artist_tier IS NULL
LIMIT 25000;
```

### Priority 3: High Play Count, No Tags (Est. 10K tracks)
**Why**: Popular tracks need classification for recommendations.
```sql
SELECT * FROM video_intelligence
WHERE voyo_play_count > 100
  AND (cultural_tags IS NULL OR array_length(cultural_tags, 1) = 0)
ORDER BY voyo_play_count DESC
LIMIT 10000;
```

### Priority 4: Strong Title Keywords (Est. 30K tracks)
**Why**: Easy to classify with pattern matching.
```sql
SELECT * FROM video_intelligence
WHERE (
  LOWER(title) LIKE '%party%' OR
  LOWER(title) LIKE '%love%' OR
  LOWER(title) LIKE '%worship%' OR
  LOWER(title) LIKE '%remix%'
)
AND vibe_scores IS NULL
LIMIT 30000;
```

### Priority 5: AI Batch (Remaining ~244K tracks)
**Why**: Everything else gets AI classification.

---

## Database Schema Updates

Add these columns to `video_intelligence`:

```sql
-- Enrichment columns
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS artist_tier TEXT CHECK (artist_tier IN ('A', 'B', 'C', 'D'));
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS era TEXT CHECK (era IN ('pre-1990', '1990s', '2000s', '2010s', '2020s', 'unknown'));
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS primary_genre TEXT;
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS cultural_tags TEXT[] DEFAULT '{}';
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS aesthetic_tags TEXT[] DEFAULT '{}';
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS vibe_scores JSONB DEFAULT '{}';

-- Enrichment metadata
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS enrichment_source TEXT; -- 'artist_master', 'title_pattern', 'gemini', 'community'
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS enrichment_confidence REAL DEFAULT 0;
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- Indexes for vibe queries
CREATE INDEX IF NOT EXISTS idx_vi_tier ON video_intelligence(artist_tier);
CREATE INDEX IF NOT EXISTS idx_vi_era ON video_intelligence(era);
CREATE INDEX IF NOT EXISTS idx_vi_genre ON video_intelligence(primary_genre);
CREATE INDEX IF NOT EXISTS idx_vi_vibes ON video_intelligence USING gin(vibe_scores);
CREATE INDEX IF NOT EXISTS idx_vi_cultural ON video_intelligence USING gin(cultural_tags);
```

---

## Timeline to 80% Vibe-Ready

| Phase | Tracks Enriched | Cumulative | Timeline |
|-------|-----------------|------------|----------|
| Phase 1: Artist Master | 150,000 | 46% | Day 1-2 |
| Phase 2: Title Patterns | 80,000 | 71% | Day 3 |
| Phase 3: AI Batch | 30,000 | 80% | Day 4-7 |
| Phase 4: Community | Ongoing | 80%+ | Continuous |

**Total**: 260,000 tracks vibe-ready in ~7 days

---

## Cost Summary

| Phase | Cost |
|-------|------|
| Phase 1: Artist Master | $0 |
| Phase 2: Title Patterns | $0 |
| Phase 3: AI (50K tracks) | ~$50 |
| Phase 4: Community | $0 |
| **Total** | **~$50** |

---

## Implementation Files

```
/home/dash/voyo-music/
├── scripts/
│   ├── enrichment/
│   │   ├── build_artist_master.py      # Phase 1
│   │   ├── title_pattern_enricher.py   # Phase 2
│   │   ├── gemini_batch_classifier.py  # Phase 3
│   │   ├── apply_enrichment.py         # Apply all to Supabase
│   │   └── compute_vibe_scores.py      # Phase 5
│   └── prompts/
│       └── cultural_classifier.md      # Already exists
├── data/
│   ├── artist_master.json              # Master artist DB
│   ├── genre_vibe_defaults.json        # Genre -> vibe mappings
│   └── enriched_tracks.json            # Output cache
└── supabase/
    └── migrations/
        └── 002_enrichment_schema.sql   # Schema updates
```

---

## Success Metrics

After enrichment:
- [ ] 80%+ tracks have `artist_tier` set
- [ ] 80%+ tracks have `era` set
- [ ] 80%+ tracks have 2+ cultural/aesthetic tags
- [ ] 80%+ tracks have all 5 vibe_scores > 0
- [ ] Vibe Mode playlists feel coherent
- [ ] User feedback shows 85%+ accuracy

---

## Next Steps

1. **Today**: Run Phase 1 - Build artist_master.json from existing artistTiers.ts
2. **Tomorrow**: Apply artist enrichment to Supabase, run Phase 2
3. **Day 3-5**: Run Gemini batch classification for top 50K tracks
4. **Day 6-7**: Validate, fix edge cases, ship to production

**Command to Start**:
```bash
cd /home/dash/voyo-music
python scripts/enrichment/build_artist_master.py
python scripts/enrichment/apply_enrichment.py --phase 1
```

---

*"324,000 tracks. 7 days. $50. Let's make VOYO vibe."*
