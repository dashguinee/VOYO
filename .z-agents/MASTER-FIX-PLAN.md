# VOYO MASTER FIX PLAN
**Generated**: 2025-12-13
**Goal**: Silicon Valley Fundraising Ready
**Status**: READY FOR EXECUTION

---

## PRIORITY TIERS

### TIER 0 - CRITICAL BLOCKERS (Must fix for demo)
These will crash/break the app during an investor demo.

| ID | Issue | Agent | File | Est. Time |
|----|-------|-------|------|-----------|
| T0-1 | Mobile playback broken (audio.play outside gesture) | Z2-FIX | AudioPlayer.tsx | 45 min |
| T0-2 | setupMobileAudioUnlock() never called | Z2-FIX | App.tsx | 15 min |
| T0-3 | Blob URLs never revoked (memory leak) | Z2-FIX | AudioPlayer.tsx | 30 min |
| T0-4 | Race condition track load vs play | Z2-FIX | AudioPlayer.tsx | 45 min |
| T0-5 | IFrame player retry has no limit | Z2-FIX | AudioPlayer.tsx | 20 min |
| T0-6 | Console.log cleanup (61 statements) | Z3-FIX | Multiple | 60 min |
| T0-7 | Hardcoded YouTube API key in server | Z5-FIX | server/index.js | 15 min |

**Total T0**: ~4 hours

---

### TIER 1 - HIGH PRIORITY (Should fix for polish)
These create poor UX or visual glitches.

| ID | Issue | Agent | File | Est. Time |
|----|-------|-------|------|-----------|
| T1-1 | Portal Belt duplicate/flash on wrap | Z1-FIX | VoyoPortraitPlayer.tsx | 90 min |
| T1-2 | Animation cleanup (memory leaks) | Z1-FIX | VoyoPortraitPlayer.tsx | 45 min |
| T1-3 | Touch targets < 44px | Z1-FIX | Multiple | 45 min |
| T1-4 | Mobile 100vh includes browser chrome | Z1-FIX | VoyoPortraitPlayer.tsx | 30 min |
| T1-5 | Safe-area-insets for notched devices | Z1-FIX | VoyoPortraitPlayer.tsx | 30 min |
| T1-6 | Discovery zone not wired | Z4-FIX | SearchOverlayV2.tsx | 30 min |
| T1-7 | No search history UI | Z4-FIX | SearchOverlayV2.tsx | 45 min |
| T1-8 | No empty results state | Z4-FIX | SearchOverlayV2.tsx | 20 min |
| T1-9 | AudioEngine preload cache unbounded | Z2-FIX | audioEngine.ts | 30 min |
| T1-10 | Download progress causes 100 re-renders | Z2-FIX | downloadStore.ts | 25 min |

**Total T1**: ~6.5 hours

---

### TIER 2 - MEDIUM PRIORITY (Nice to have for demo)
These improve performance and developer experience.

| ID | Issue | Agent | File | Est. Time |
|----|-------|-------|------|-----------|
| T2-1 | z-index stack organization | Z1-FIX | Multiple | 45 min |
| T2-2 | Animation timing tokens | Z1-FIX | Multiple | 30 min |
| T2-3 | Vinyl spin state transitions | Z1-FIX | VoyoPortraitPlayer.tsx | 30 min |
| T2-4 | seekPosition not cleared on track change | Z2-FIX | playerStore.ts | 10 min |
| T2-5 | Volume not persisted | Z2-FIX | playerStore.ts | 15 min |
| T2-6 | Debounce seek requests | Z2-FIX | playerStore.ts | 15 min |
| T2-7 | Queue duplicate detection | Z4-FIX | playerStore.ts | 20 min |
| T2-8 | Mock data in VoyoVerticalFeed | Z3-FIX | VoyoVerticalFeed.tsx | 30 min |
| T2-9 | Remove TODO comments | Z3-FIX | personalization.ts | 15 min |
| T2-10 | Fix preferenceStore import warning | Z3-FIX | Multiple | 15 min |

**Total T2**: ~4 hours

---

### TIER 3 - SERVER FIXES (Backend stability)

| ID | Issue | Agent | File | Est. Time |
|----|-------|-------|------|-----------|
| T3-1 | Cache cleanup race condition | Z5-FIX | server/index.js | 20 min |
| T3-2 | Piped fallback Node 18+ issue | Z5-FIX | server/index.js | 30 min |
| T3-3 | Thumbnail cache unbounded | Z5-FIX | server/index.js | 30 min |
| T3-4 | CORS restrict to known origins | Z5-FIX | server/index.js | 15 min |
| T3-5 | Add connection pooling | Z5-FIX | server/index.js | 30 min |
| T3-6 | Async file operations | Z5-FIX | server/index.js | 30 min |
| T3-7 | Global error handlers | Z5-FIX | server/index.js | 20 min |

**Total T3**: ~3 hours

---

## FIX AGENT DEPLOYMENT

### WAVE 1 - Critical Path (Run in Parallel)

**Z1-FIX-AGENT**: UI/Animation Fixes
- T1-1: Portal Belt wrap fix
- T1-2: Animation cleanup
- T1-3: Touch targets
- T1-4: 100vh fix
- T1-5: Safe-area-insets

**Z2-FIX-AGENT**: Audio/Playback Fixes
- T0-1: Mobile playback gesture
- T0-2: Mobile audio unlock
- T0-3: Blob URL revocation
- T0-4: Race condition fix
- T0-5: IFrame retry limit
- T1-9: Preload cache LRU
- T1-10: Download progress throttle

**Z3-FIX-AGENT**: Code Quality Fixes
- T0-6: Console.log cleanup
- T2-8: Mock data resolution
- T2-9: TODO removal
- T2-10: Import warning fix

**Z4-FIX-AGENT**: Search/Discovery Fixes
- T1-6: Wire discovery zone
- T1-7: Search history UI
- T1-8: Empty results state
- T2-7: Queue duplicates

**Z5-FIX-AGENT**: Server Fixes
- T0-7: API key to env var
- T3-1 to T3-7: Server hardening

---

## EXECUTION ORDER

```
PHASE 1: PARALLEL FIX DEPLOYMENT
├── Z1-FIX-AGENT (UI/Animation) → 3-4 hours
├── Z2-FIX-AGENT (Audio/Playback) → 3-4 hours
├── Z3-FIX-AGENT (Code Quality) → 2 hours
├── Z4-FIX-AGENT (Search/Discovery) → 2 hours
└── Z5-FIX-AGENT (Server) → 3 hours

PHASE 2: INTEGRATION
├── Run TypeScript check (npx tsc --noEmit)
├── Run build (npm run build)
├── Fix any conflicts/errors
└── Verify bundle size < 500KB

PHASE 3: VERIFICATION
├── Test mobile playback
├── Test search + discovery flow
├── Test boost/download
├── Test 10-minute demo run
└── Final visual inspection
```

---

## SUCCESS CRITERIA

All checked = Ready for Silicon Valley:

- [ ] Build passes with 0 warnings
- [ ] 0 console.log in production
- [ ] Mobile playback works first tap
- [ ] No memory leaks in 10 minute session
- [ ] Touch targets 44px minimum
- [ ] Safe-area-insets on iPhone
- [ ] Portal Belt scrolls smoothly
- [ ] Discovery zone updates recommendations
- [ ] Search history visible
- [ ] No mock data visible
- [ ] Server handles 100 concurrent streams
- [ ] Total bundle < 500KB gzipped

---

## AGENT COMMUNICATION PROTOCOL

Agents write status to: `.z-agents/status/`
- `Z1-FIX-STATUS.md`
- `Z2-FIX-STATUS.md`
- `Z3-FIX-STATUS.md`
- `Z4-FIX-STATUS.md`
- `Z5-FIX-STATUS.md`

Format:
```
## [TIMESTAMP] STATUS: IN_PROGRESS | BLOCKED | COMPLETE
### Current Task: [Description]
### Files Modified: [List]
### Blockers: [If any]
### Next: [What's next]
```

---

**Plan Author**: ZION SYNAPSE (Mission Control)
**Ready for Execution**: YES
