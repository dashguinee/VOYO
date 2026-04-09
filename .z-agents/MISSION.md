# VOYO MUSIC - Z-AGENT MISSION CONTROL

## MISSION: Silicon Valley Fundraising Ready

**Goal**: Transform VOYO into a production-ready, investor-demo quality app
**Standard**: Zero glitches, perfect responsiveness, exquisite code

---

## THE VISION

VOYO is a revolutionary music platform combining:
- **African-first content** with global reach
- **TikTok-style vertical feed** (VOYO FEED)
- **Spotify-quality audio** with YouTube backend
- **Cultural features**: OYÉ reactions, mood tunnels, artist connections

### Core Experience
1. **Portrait Player** - Main music player with album art, controls
2. **Portal Belts** - HOT (red) and DISCOVERY (blue) recommendation streams
3. **Search** - Fast YouTube search with portal zones for queue/discovery
4. **VOYO Feed** - Vertical swipe content feed
5. **Boost System** - Download tracks for HD offline playback

---

## Z-AGENT ARCHITECTURE

### Z1 - UI/ANIMATION SPECIALIST
**Focus**: Visual perfection, smooth animations, responsive design
- Fix all animation glitches
- Perfect sizing on all devices (mobile-first)
- Portal belt animations (snake-wrap scroll)
- Transition smoothness
- Touch responsiveness

### Z2 - AUDIO/PLAYBACK ENGINEER
**Focus**: Audio engine, streaming, caching
- IFrame playback reliability
- Boost/download system
- Audio state management
- Playback controls
- Buffer health monitoring

### Z3 - CODE QUALITY ARCHITECT
**Focus**: Clean code, no dead code, optimization
- Remove all placeholders/mockups
- Eliminate dead code
- Performance optimization
- Memory leak prevention
- Bundle size reduction

### Z4 - SEARCH/DISCOVERY SPECIALIST
**Focus**: Search UX, recommendations
- Fast search response
- Portal zone functionality
- Queue management
- Discovery algorithm
- Search history

### Z5 - INTEGRATION TESTER
**Focus**: End-to-end functionality
- All features working
- Cross-device testing
- Edge case handling
- Error states
- Loading states

---

## COMMUNICATION PROTOCOL

Agents report to: `.z-agents/reports/`
- `Z1-UI.md` - UI status
- `Z2-AUDIO.md` - Audio status
- `Z3-CODE.md` - Code quality status
- `Z4-SEARCH.md` - Search status
- `Z5-TEST.md` - Test results

### Blocking Issues Format
```
## BLOCKED: [Issue Title]
**Agent**: Z[N]
**File**: path/to/file.tsx
**Line**: 123
**Issue**: Description
**Needs**: What's needed to unblock
```

### Completion Format
```
## COMPLETE: [Task Title]
**Agent**: Z[N]
**Files Changed**: list
**Summary**: What was done
**Verified**: How it was tested
```

---

## QUALITY STANDARDS

1. **No console errors/warnings**
2. **No TypeScript errors**
3. **All animations 60fps**
4. **Touch targets 44px minimum**
5. **Loading states for all async**
6. **Error handling for all failures**
7. **Mobile-first responsive**
8. **No placeholder content**
9. **No dead/unreachable code**
10. **Bundle size < 500KB gzip**

---

## FILE STRUCTURE

```
src/
├── components/
│   ├── voyo/           # Main VOYO components
│   ├── search/         # Search overlay
│   ├── player/         # Playback controls
│   ├── ui/             # Reusable UI (Boost, etc.)
│   └── AudioPlayer.tsx # Core audio engine
├── store/              # Zustand stores
├── services/           # API, audio, downloads
├── hooks/              # Custom hooks
├── utils/              # Helpers
└── types/              # TypeScript types
```

---

## CURRENT STATE SNAPSHOT

- **Lines of Code**: ~12,000
- **Main Component**: VoyoPortraitPlayer.tsx (1,680 lines)
- **Stack**: React 19 + TypeScript + Vite + Tailwind 4 + Framer Motion + Zustand
- **Backend**: Fly.io (yt-dlp) + Cloudflare Worker
- **Audio**: IFrame-first with Boost HD caching

---

## SUCCESS CRITERIA

App is ready when:
- [ ] All features functional (no dead buttons)
- [ ] All animations smooth (no jank)
- [ ] All devices responsive (mobile to desktop)
- [ ] All code clean (no TODOs, placeholders)
- [ ] Build passes with 0 warnings
- [ ] Demo can run 10 minutes without issues
