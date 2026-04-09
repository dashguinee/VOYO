# VOYO VIBES SYSTEM - PLAN

**Date**: Jan 17, 2026
**Status**: Foundation Complete, Matrix Emerging

---

## WHAT WE HAVE (Completed)

### Database Layer
- [x] **324K tracks** with `vibe_scores` (100% coverage)
- [x] **cultural_tag_vibes** - 40 tags mapped to 5 vibe dimensions
- [x] **compound_vibes** - 13 real compounds emerged from data
- [x] **genre_vibe_map** - 41 genres mapped to vibes
- [x] **Energy types** - Earth, Fire, Water, Air, Storm on tags

### RPCs (Working)
- [x] `get_hot_tracks(essence)` - Tier A/B first, vibe-weighted
- [x] `get_discovery_tracks(essence)` - Fresh finds, diversity
- [x] `get_compound_vibe_tracks(tag1, tag2)` - Dynamic compounds

### Services (Built)
- [x] `essenceEngine.ts` - User vibe fingerprint from signals
- [x] `databaseDiscovery.ts` - Queries 324K tracks
- [x] `vibeEngine.ts` - 22 curated vibes with query rules

---

## THE MATRIX (Vision)

```
VIBE = Tag × Energy × Country × Era
```

### Dimensions Available

| Dimension | Source | Status |
|-----------|--------|--------|
| **Tags** | cultural_tags (40) | ✅ Ready |
| **Energy** | cultural_tag_vibes.energy | ✅ Ready |
| **Country** | artist_master.json | ⏳ Need to add column |
| **Era** | video_intelligence.era | ⏳ Partially populated |

### Example Generated Vibes
- Guinea + 90s + Water = "Guinea 90s Romance"
- Nigeria + Fire + 2020s = "Lagos Heat"
- Caribbean + Air + spiritual = "Island Worship"
- South Africa + Storm = "SA Liberation"

---

## PHASE 1: Complete the Matrix (Next)

### 1.1 Add Country/Region to Tracks
```sql
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE video_intelligence ADD COLUMN IF NOT EXISTS region TEXT;
```

Then populate from matched_artist → artist_master mapping.

### 1.2 Verify Era Coverage
```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE era IS NOT NULL) as has_era
FROM video_intelligence;
```

### 1.3 Create Dynamic Vibe RPC
```sql
-- Query any dimension combination
get_matrix_vibe_tracks(
  p_tags TEXT[],
  p_energy TEXT,
  p_country TEXT,
  p_era TEXT,
  p_limit INTEGER
)
```

---

## PHASE 2: Wire to Frontend

### 2.1 Update playerStore
- `refreshRecommendations()` already uses databaseDiscovery
- Verify it's calling the RPCs correctly

### 2.2 Update VibesSection
- Currently uses vibeEngine.ts (local queries)
- Add compound vibes browsing
- Add energy-based filtering

### 2.3 MixBoard Integration
- Sliders map to essence weights
- Essence feeds into RPCs
- Real-time vibe-matched results

---

## PHASE 3: Vibe Journeys (Future)

### Energy Flow Sequences
```
EARTH → FIRE → WATER → AIR
(grounding → heat → cooldown → elevation)
```

### Auto-Generated Playlists
- "Sunday Morning Journey" = Earth → Air
- "Saturday Night Arc" = Water → Fire → Water
- "Workout Push" = Storm → Fire → Storm

### Connected Compounds
- Compound vibes link to related compounds
- Exploration graph for discovery

---

## FILES REFERENCE

| File | Purpose |
|------|---------|
| `src/services/essenceEngine.ts` | User vibe fingerprint |
| `src/services/databaseDiscovery.ts` | Query 324K tracks |
| `src/lib/vibeEngine.ts` | 22 curated vibes |
| `data/artist_master.json` | 110 artists with country |
| `data/genre_vibe_defaults.json` | Genre → vibe mapping |

---

## IMMEDIATE NEXT STEPS

1. **Add country/region columns** to video_intelligence
2. **Populate from artist_master** (matched_artist lookup)
3. **Check era coverage** and fill gaps
4. **Create matrix RPC** for dynamic vibes
5. **Test frontend** with real data

---

## SUCCESS METRICS

- [ ] 80%+ tracks have country
- [ ] 80%+ tracks have era
- [ ] Matrix vibe queries return diverse results
- [ ] Frontend shows vibe-matched recommendations
- [ ] Compound vibes browsable in UI

---

*"Music is memory. Music is medicine. Music is movement."*
