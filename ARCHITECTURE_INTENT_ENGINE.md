# VOYO Music - Intent Engine Architecture

**Last Updated:** December 16, 2025
**Status:** Core system built, wiring pending
**Next Session:** Complete integration, add LLM DJ mode

---

## Overview

VOYO Music now has an **Intent-First Recommendation System**. Instead of only using passive behavior (what user listened to), we capture **active intent** (what user WANTS via MixBoard).

**Philosophy:** Intent > Behavior
- If user sets Party Mode to 5 bars but history is all chill, we prioritize Party Mode
- User's current desire beats historical patterns

---

## System Components

### 1. Intent Store (`src/store/intentStore.ts`)

Captures MixBoard interactions:
- **manualBars**: User's explicit vibe distribution (taps on MixBoard cards)
- **dragToQueue**: Strongest signal - user wants this vibe NOW
- **tracksQueued**: How many tracks added per mode
- **Time decay**: Stale intents lose weight

```typescript
// Key functions
useIntentStore.getState().getIntentWeights()  // Returns { 'afro-heat': 0.4, 'chill': 0.2, ... }
useIntentStore.getState().getDominantModes(3) // Returns ['afro-heat', 'party-mode', 'chill']
```

### 2. Personalization Service (`src/services/personalization.ts`)

**HOT ENGINE v2.0:**
```
Score = Behavior (40%) + Intent (60%)
```
- Surfaces tracks matching dominant MixBoard modes
- Diversity pass ensures variety across modes

**DISCOVERY ENGINE v2.0:**
```
Score = Similarity (40%) + Intent (40%) + Behavior (20%)
```
- Combines track similarity with MixBoard intent
- If playing chill but MixBoard says party → discovers party-adjacent tracks

### 3. Track Pool Store (`src/store/trackPoolStore.ts`) [NEW]

**Dynamic track management** (not just static 11 tracks):

```
┌─────────────────────────────────────────────────────┐
│  HOT POOL (active)     │  COLD POOL (aged out)     │
│  - High intent match   │  - Low recent activity    │
│  - Recently played     │  - Mismatched intent      │
│  - User reactions      │  - Recoverable on shift   │
└─────────────────────────────────────────────────────┘
```

**Pool grows from:**
1. Seed tracks (initial 11)
2. User searches
3. Related tracks (Piped API)
4. Trending (YouTube/backend)
5. LLM suggestions (future)

**Scoring:**
```
poolScore = intentMatch * 0.4 + recency * 0.3 + engagement * 0.3
```

### 4. MODE_KEYWORDS

Maps track metadata to vibe modes. Keywords must match actual track data!

```typescript
'afro-heat': ['afrobeats', 'afro', 'amapiano', 'burna', 'davido', 'wizkid', ...]
'chill-vibes': ['chill', 'relax', 'smooth', 'rnb', 'love', 'essence', ...]
'party-mode': ['party', 'club', 'dance', 'hype', 'energy', 'mix', 'dj', ...]
'late-night': ['night', 'late', 'heartbreak', 'feels', 'moody', ...]
'workout': ['workout', 'gym', 'fitness', 'pump', 'motivation', ...]
```

---

## Data Flow

```
User Action                 Intent Store              HOT/DISCOVERY
───────────────────────────────────────────────────────────────────
MixBoard tap        →   setManualBars()      →   (significant change)
                                              →   refreshRecommendations()

Drag to queue       →   recordDragToQueue()  →   refreshRecommendations()
                                              →   (immediate, strongest signal)

Search & play       →   addToPool()          →   Track enters hot pool
                    →   recordPlay()         →   Engagement tracked

Skip track          →   recordSkip()         →   Score decreases

React (OYÉ)         →   recordReaction()     →   Score increases
```

---

## What's Working

✅ Intent Store - Captures MixBoard signals
✅ Keyword matching - Fixed to match actual TRACKS data
✅ Intent-triggered refresh - Significant changes trigger HOT/DISCOVERY update
✅ Scoring functions - calculateIntentScore(), calculateBehaviorScore()
✅ Track Pool Store - Hot/cold pool structure with dynamic management
✅ Pool-aware HOT/DISCOVERY v3.0 - Uses track pool with fallback to static
✅ Engagement tracking - Play, skip, complete, react, queue events tracked
✅ Search → Pool integration - Search results added to pool when played/queued/discovered
✅ Pool maintenance - Auto-rescoring every 5 minutes on app mount
✅ Debug tools - voyoDebug.runAllVerifications() in browser console

---

## What's Pending

### Medium Term

1. **Related Tracks Fetching**
   - After track plays, fetch related via Piped
   - Add high-quality matches to pool

### Long Term (LLM Integration)

6. **LLM DJ Mode**
   - "Play me something for a late night drive"
   - LLM understands intent → queries pool → builds queue

7. **Intelligent Tagging**
   - New tracks auto-tagged by LLM
   - Better mode classification than keyword matching

8. **Collaborative Filtering**
   - Users with similar MixBoard settings
   - "People who boosted Party Mode also liked..."

---

## External API Options (Research)

### Current Sources
- **VOYO Backend** (`voyo-music-api.fly.dev`): Search, streaming, thumbnails
- **Piped API** (`pipedapi.kavin.rocks`): Album/playlist browsing

### Potential Additions

| Source | What It Offers | Integration Difficulty |
|--------|---------------|----------------------|
| YouTube Data API | Trending, related videos, categories | Medium (needs API key) |
| MusicBrainz | Metadata, genres, related artists | Easy (free, no key) |
| Last.fm | Tags, similar artists, user scrobbles | Easy (free tier) |
| Spotify API | Rich metadata, audio features | Hard (OAuth, not for playback) |
| Discogs | Vinyl/album metadata | Easy (free) |

### LLM Integration Options

| Approach | Pros | Cons |
|----------|------|------|
| Claude API direct | Full intelligence, context | Cost, latency |
| Local LLM (Ollama) | Free, fast, private | Less capable |
| Hybrid | Claude for DJ, local for tagging | Complex |

---

## Files Reference

```
src/
├── store/
│   ├── intentStore.ts       # MixBoard intent signals
│   ├── trackPoolStore.ts    # Dynamic track management [NEW]
│   ├── preferenceStore.ts   # Behavior tracking (existing)
│   └── playerStore.ts       # Playback state (existing)
├── services/
│   ├── personalization.ts   # HOT/DISCOVERY engines (v2.0)
│   ├── api.ts              # VOYO backend (search, stream)
│   └── piped.ts            # Album browsing
├── components/voyo/
│   └── VoyoPortraitPlayer.tsx  # MixBoard UI + intent sync
└── utils/
    └── debugIntent.ts      # Verification tools
```

---

## Debug Commands (Browser Console)

```javascript
// Run full verification
voyoDebug.runAllVerifications()

// Individual checks
voyoDebug.verifyKeywordMatching()  // See which tracks match which modes
voyoDebug.debugKeywordHits()       // See which keywords are matching
voyoDebug.verifyScoring()          // Test scoring math
voyoDebug.verifyModeRetrieval()    // Test getTracksByMode()
```

---

## Key Decisions Made

1. **Intent > Behavior (60/40 split)** - User's current desire matters more than history
2. **Blend not Replace** - Don't jarring refresh, smoothly evolve
3. **Hot/Cold Pools** - Never delete tracks, age them out (recoverable)
4. **Debounced Refresh** - Only refresh on significant MixBoard changes (2+ bars)
5. **Drag = Strongest Signal** - Immediate refresh when user drags to queue

---

## For Next LLM Instance

**Completed this session:**
✅ Track Pool wired to HOT/DISCOVERY engines (v3.0 pool-aware functions)
✅ Search results flow into pool when played/queued/discovered
✅ Engagement tracking (play, skip, complete, react, queue) wired to pool
✅ Pool maintenance starts on app mount (rescoring every 5 min)
✅ TypeScript compiles clean, dev server running

**Next Priorities:**
1. **LLM DJ Integration** - See ARCHITECTURE_LLM_DJ.md for research
2. **Related Tracks Fetching** - Fetch Piped related after plays → add to pool
3. **Album Tracks** - Add Piped album/playlist tracks to pool

**Questions to Explore:**
- Should LLM DJ be real-time or pre-computed?
- How to handle new users with no history?
- What's the right pool size balance (current: 100 hot, 200 cold)?

**Key Files:**
- `src/store/trackPoolStore.ts` - Hot/cold pool system
- `src/services/personalization.ts` - v3.0 pool-aware engines
- `src/store/intentStore.ts` - MixBoard intent capture
- `src/store/playerStore.ts` - Engagement tracking wired

---

## Session Handoff - Dec 17, 2025

**Last Commit:** `128e025 feat(intent): Add Intent Engine with dynamic track pool system`

**App Status:** ✅ Building, ✅ Running, ✅ Pushed to main

**What Works Now:**
1. MixBoard taps → Intent Store → HOT/DISCOVERY refresh
2. Search results → Track Pool → Future recommendations
3. Play/skip/react/queue → Pool engagement tracking
4. Pool maintenance runs every 5 mins (auto-rescoring)

**To Test in Browser:**
```javascript
// Open DevTools console at http://localhost:5173
voyoDebug.runAllVerifications()  // Full system check
voyoDebug.verifyKeywordMatching() // See track-to-mode mapping
voyoDebug.getPoolStats()  // Check pool sizes
```

**Ready for Next Session:**
- LLM DJ integration (Claude API or local Ollama)
- Related tracks fetching (Piped API → pool)
- Album/playlist tracks → pool

---

*Updated by ZION SYNAPSE - Dec 17, 2025*
