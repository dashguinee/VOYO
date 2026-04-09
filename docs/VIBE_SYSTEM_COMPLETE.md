# VOYO VIBE SYSTEM - COMPLETE ARCHITECTURE

## Overview

VOYO is a **VIBES FIRST** music experience. Not genre. Not popularity. **VIBES**.

The vibe system has 5 core dimensions:
- **afro_heat**: High energy African bangers (0-100)
- **chill**: Laid back, relaxed, smooth (0-100)
- **party**: Maximum celebration energy (0-100)
- **workout**: Energy to push through (0-100)
- **late_night**: After midnight mood (0-100)

---

## System Components

### 1. User Vibe Fingerprint (essenceEngine.ts)

Extracts user's vibe preferences from:
- **Intent (40%)**: MixBoard slider bars, drag-to-queue events
- **Reactions (30%)**: Like, OYÉ, Fire reactions
- **Behavior (30%)**: Completions, skips, play counts

```typescript
interface VibeEssence {
  afro_heat: number;  // 0-1, normalized
  chill: number;
  party: number;
  workout: number;
  late_night: number;
  dominantVibes: string[];
  discoveryHints: DiscoveryHint[];
  freshToFamiliarRatio: number;  // 0.7 = 70% fresh, 30% familiar
  confidence: number;  // 0-1
}
```

### 2. Vibe Definitions (vibeEngine.ts)

22 curated vibes across 5 categories:

| Category | Vibes |
|----------|-------|
| Regional | conakry-nights, kaloum-memories, guinea-romance, lagos-nights, naija-party, accra-highlife, johannesburg-heat |
| Mood | chill-vibes, afro-heat, late-night, workout |
| Era | golden-era, throwback, new-wave |
| Activity | party-mode, study-flow, morning-rise |
| Cultural | motherland-roots, diaspora-connection, african-gospel |

Each vibe has query_rules:
```typescript
interface VibeQueryRules {
  prefer_tiers?: ('A' | 'B' | 'C' | 'D')[];
  eras?: string[];
  countries?: string[];
  cultural_tags?: string[];
  matched_artist_patterns?: string[];
  sort_by?: 'play_count' | 'random' | 'canon_level';
}
```

### 3. Database Discovery (databaseDiscovery.ts)

Queries 324K tracks from Supabase:

| Function | Purpose |
|----------|---------|
| `getHotTracks()` | Trending NOW + matches user vibes |
| `getDiscoveryTracks()` | Expand horizons + unique flavors |
| `getFamiliarTracks()` | Previously played (30% ratio) |
| `searchTracks()` | Supabase first, YouTube fallback |

### 4. Supabase RPCs

```sql
-- HOT: Heat score + vibe match
get_hot_tracks(p_afro_heat, p_chill, p_party, p_workout, p_late_night, p_limit, p_exclude_ids)

-- DISCOVERY: Vibe match + novelty bonus
get_discovery_tracks(..., p_dominant_vibe, p_played_ids)

-- SEARCH: Full-text + vibe weighting
search_tracks_by_vibe(p_query, ...)

-- FAMILIAR: Shuffle played tracks
get_familiar_tracks(p_played_ids, p_limit)
```

---

## Database Schema

### video_intelligence table

| Column | Type | Description |
|--------|------|-------------|
| youtube_id | TEXT | Primary key |
| title | TEXT | Track title |
| artist | TEXT | Artist name |
| artist_tier | TEXT | A/B/C/D quality tier |
| era | TEXT | pre-1990, 1990s, 2000s, 2010s, 2020s |
| primary_genre | TEXT | Main genre |
| cultural_tags | TEXT[] | Cultural categories |
| aesthetic_tags | TEXT[] | Aesthetic properties |
| vibe_scores | JSONB | {afro_heat, chill, party, workout, late_night} |
| play_count | INTEGER | Total plays |
| queue_count | INTEGER | Times queued |

### genre_vibe_map table

Maps 40+ genres to default vibe scores:

| Genre | afro_heat | chill | party | workout | late_night |
|-------|-----------|-------|-------|---------|------------|
| afrobeats | 85 | 35 | 75 | 70 | 45 |
| amapiano | 70 | 50 | 90 | 60 | 80 |
| reggae | 40 | 85 | 50 | 30 | 70 |
| ... | ... | ... | ... | ... | ... |

---

## Data Files

| File | Purpose |
|------|---------|
| `data/artist_master.json` | 110 artists with tier, country, default_vibe_scores |
| `data/genre_vibe_defaults.json` | 40+ genres → vibe_scores mapping |
| `scripts/prompts/cultural_classifier.md` | AI classification prompts |

---

## Intent Store Integration

MixBoard modes map to vibes:

| MixBoard Mode | Vibe Key |
|---------------|----------|
| afro-heat | afro_heat |
| chill-vibes | chill |
| party-mode | party |
| workout | workout |
| late-night | late_night |

Intent signals:
- **MIXBOARD_BAR**: 0.08 points per bar (0-6 bars)
- **DRAG_TO_QUEUE**: 0.15 points (strongest signal!)
- **TRACK_QUEUED**: 0.05 points per track

---

## UI Components

### VibesSection.tsx
- Vibe browser with category filters
- Color-coded by category
- Energy level display (1-5 bars)
- Connected vibes navigation

### VoyoPortraitPlayer.tsx
- MixBoard with 6 mode sliders
- 3-column feed: HOT | VOYO FEED | DISCOVERY
- Reactions: Like, OYÉ, Fire

---

## Cultural Tags (70K tracks have these)

From cultural_classifier.md:

**Movement**: anthem, revolution, liberation, protest
**Heritage**: tradition, roots, motherland, pan-african
**Diaspora**: diaspora, migration, homecoming, bridge
**Street**: street, ghetto, survival
**Celebration**: wedding, festival, celebration
**Spiritual**: spiritual, prayer, healing

---

## Aesthetic Tags

- innovative - Genre-defining sound
- virtuosic - Technical mastery
- influential - Copied by others
- production - Outstanding production quality
- lyricism - Exceptional lyrics
- arrangement - Complex arrangements
- timeless - Sounds fresh regardless of era

---

## Signal Flow

```
User Actions
    │
    ├── MixBoard sliders → intentStore
    ├── Drag-to-queue → intentStore (highest weight!)
    ├── Reactions (Like/OYÉ/Fire) → reactionStore
    └── Listen behavior → preferenceStore
                │
                ▼
        essenceEngine.getVibeEssence()
                │
                ▼
        databaseDiscovery.getHotTracks(essence)
        databaseDiscovery.getDiscoveryTracks(essence)
                │
                ▼
        Supabase RPC with vibe_scores matching
                │
                ▼
        HOT + DISCOVERY + FAMILIAR tracks (70/30 ratio)
                │
                ▼
        Player displays curated feed
```

---

## Key Principles

1. **VIBES FIRST**: Primary filter is vibe match, not popularity
2. **70/30 Ratio**: 70% fresh discoveries, 30% familiar tracks
3. **Intent > Behavior**: What user WANTS matters more than history
4. **Discovery Hints**: Cross-vibe suggestions for exploration
5. **ECHO Artists**: Hidden gems who never got their shine

---

## Migrations

| Migration | Purpose |
|-----------|---------|
| 002_enrichment_schema.sql | Adds vibe columns to video_intelligence |
| 004_vibes_first_discovery.sql | Creates HOT/DISCOVERY/SEARCH RPCs |
| 005_vibes_from_cultural_tags.sql | Alternative RPCs using cultural_tags |
| 006_populate_vibe_scores.sql | Populates vibe_scores from genre/tags |

---

*"324K tracks. 22 vibes. VIBES FIRST."*
