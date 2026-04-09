# VOYO Music - Supabase Status
**Updated**: January 19, 2026

## STATUS: OPERATIONAL

All critical systems are now working.

## Database Stats

| Metric | Value |
|--------|-------|
| Total Tracks | 324,876 |
| With artist_tier | 324,876 (100%) |
| With vibe_scores | 324,728 (99.95%) |
| With cultural_tags | 70,376 (22%) |
| With thumbnail_url | 123,053 (38%) |

## Working RPCs

### get_hot_tracks
Returns trending tracks weighted by user's vibe essence.
```sql
SELECT * FROM get_hot_tracks(
  p_afro_heat := 0.3,
  p_chill := 0.2,
  p_party := 0.2,
  p_workout := 0.2,
  p_late_night := 0.1,
  p_limit := 30,
  p_exclude_ids := '{}'
);
```

### get_discovery_tracks
Returns mix of A-tier artists + fresh finds with discovery reasons.
```sql
SELECT * FROM get_discovery_tracks(
  p_afro_heat := 0.3,
  p_chill := 0.2,
  p_party := 0.2,
  p_workout := 0.2,
  p_late_night := 0.1,
  p_dominant_vibe := 'afro_heat',
  p_limit := 30,
  p_exclude_ids := '{}',
  p_played_ids := '{}'
);
```

### search_tracks_by_vibe
ILIKE search on title/artist with tier ranking.
```sql
SELECT * FROM search_tracks_by_vibe(
  p_query := 'burna boy',
  p_afro_heat := 0.3,
  p_chill := 0.2,
  p_party := 0.2,
  p_workout := 0.2,
  p_late_night := 0.1,
  p_limit := 20
);
```

### get_familiar_tracks
Returns previously played tracks for 70/30 fresh/familiar ratio.
```sql
SELECT * FROM get_familiar_tracks(
  p_played_ids := ARRAY['abc123', 'def456'],
  p_limit := 10
);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        VOYO APP                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   HOT Feed ──────► get_hot_tracks RPC ──────► Supabase      │
│                                                (324K)        │
│   DISCOVERY ─────► get_discovery_tracks RPC ──►    ↓        │
│                                                              │
│   SEARCH ────────► search_tracks_by_vibe RPC                │
│        │                    ↓                                │
│        └──────► YouTube fallback (if RPC fails)             │
│                                                              │
│   VIBES (72) ────► vibeEngine.ts ──► Direct Supabase query  │
│                    (Lagos Nights, Conakry Nights, etc.)     │
│                                                              │
│   PLAY ──────────► R2 check ──► YouTube iframe fallback     │
│        │                                                     │
│        └──────────► videoIntelligenceAPI.sync() ──► Supabase│
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Two Discovery Systems

### 1. EssenceEngine (RPCs)
- File: `src/services/essenceEngine.ts`
- Extracts user's vibe fingerprint from MixBoard + reactions + behavior
- Outputs: `{ afro_heat, chill, party, workout, late_night }` weights
- Powers: HOT feed, DISCOVERY feed, Search ranking

### 2. VibeEngine (Direct Queries)
- File: `src/lib/vibeEngine.ts`
- 72 curated vibes with query rules
- Categories: regional, mood, activity, era, cultural
- Examples: `lagos-nights`, `conakry-nights`, `golden-era`, `chill-vibes`
- Powers: VibesSection in search overlay

## Columns in video_intelligence

| Column | Type | Description |
|--------|------|-------------|
| youtube_id | TEXT | Primary key |
| title | TEXT | Track title |
| artist | TEXT | Artist name |
| thumbnail_url | TEXT | YouTube thumbnail |
| artist_tier | TEXT | A/B/C/D classification |
| vibe_scores | JSONB | `{afro_heat, chill, party, workout, late_night}` |
| cultural_tags | TEXT[] | Cultural classification |
| era | TEXT | 1970s, 1980s, 1990s, 2000s, 2010s, 2020s |
| primary_genre | TEXT | Genre classification |
| play_count | INTEGER | VOYO play count |
| queue_count | INTEGER | Times added to queue |
| matched_artist | TEXT | Canonical artist match |
| first_seen | TIMESTAMP | When discovered |
| last_played | TIMESTAMP | Last play time |

## Fix Applied

File: `supabase/FIX_SUPABASE_DISCOVERY.sql`

Run in Supabase SQL Editor to:
1. Add missing columns (if not present)
2. Create all RPC functions
3. Create performance indexes

## Tables Status

| Table | Status |
|-------|--------|
| `video_intelligence` | ✅ Working (324K tracks) |
| `universes` | ✅ Working (user profiles) |
| `reactions` | ✅ Working (OYE reactions) |
| `track_stats` | ✅ Working (aggregated stats) |
