# VOYO Music - Integration Gaps Analysis
**Generated**: January 17, 2026

## CRITICAL FINDINGS

### 1. vibeEngine.ts - COMPLETELY ORPHANED
- **File**: `src/lib/vibeEngine.ts` (607 lines)
- **Status**: Created but NEVER imported or used
- **Impact**: 36+ vibes defined but zero functionality

**Where it should connect:**
- `VibesSection.tsx` - Should use `getTracksForVibe()` instead of hardcoded data
- `trackPoolStore.ts` - Should use vibe-aware curation
- `intentStore.ts` - MixBoard sliders should drive vibe queries

### 2. DASH Auth - Partially Integrated
- `DashAuthBadge` rendered in App.tsx
- `useDashCitizen()` hook IMPORTED but NEVER CALLED
- Dual auth systems (VOYO PIN + DASH ID) not unified

### 3. Enrichment Pipeline - Disconnected
- Scripts exist: `build_artist_master.py`, `enrich-by-artist.cjs`, `gemini_batch_classifier.py`
- Data files exist: `artist_master.json`, `genre_vibe_defaults.json`
- **BUT**: Migration 002 not applied, data not loaded

### 4. voyo_tracks Table - Orphaned
- Defined in migration 001 with full vibe schema
- Has NO API layer in supabase.ts
- Completely unused

## PRIORITY FIXES

| Priority | Item | Time |
|----------|------|------|
| 1 | Apply migration 002 | 5 min |
| 2 | Load canonized data to DB | 30 min |
| 3 | Wire vibeEngine to VibesSection | 1 hour |
| 4 | Call useDashCitizen() in App.tsx | 15 min |
| 5 | Add API layer for voyo_tracks | 2 hours |
