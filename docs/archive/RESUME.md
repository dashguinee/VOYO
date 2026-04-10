# VOYO Music - FINAL VERSION
**Consolidated**: 2026-01-25
**Status**: PRODUCTION READY ✅
**Repo**: /home/dash/voyo-music
**Branch**: main

---

## ARCHITECTURE

```
voyo-music/src/
├── components/
│   ├── dahub/           # Social Layer (FINAL)
│   │   ├── Dahub.tsx         # Main social hub (1333 lines)
│   │   ├── DahubCore.tsx     # Shared core logic (1001 lines)
│   │   ├── VoyoDahub.tsx     # VOYO-specific features (388 lines)
│   │   └── DirectMessageChat.tsx  # DM component (420 lines)
│   ├── classic/         # Classic Mode
│   │   ├── HomeFeed.tsx      # Main feed with shelves
│   │   ├── ClassicMode.tsx   # Desktop/landscape view
│   │   └── Hub.tsx           # OLD social (deprecated, use Dahub)
│   ├── voyo/            # Portrait Mode
│   │   ├── PortraitVOYO.tsx  # Main VOYO experience
│   │   └── feed/             # Vertical feed
│   └── AudioPlayer.tsx  # Core audio player
├── lib/
│   ├── dahub/
│   │   └── dahub-api.ts      # Social APIs (friends, messages, presence)
│   ├── dash-auth.tsx         # SSO with Command Center
│   ├── vibeEngine.ts         # 72 vibes → smart queries
│   └── voyo-api.ts           # VOYO + Command Center dual Supabase
├── store/
│   ├── playerStore.ts        # Audio playback state
│   ├── universeStore.ts      # Auth + user state (SSO works!)
│   └── trackPoolStore.ts     # Track cache
├── services/
│   ├── intelligentDJ.ts      # AI recommendations
│   └── ...
├── brain/
│   └── VoyoBrain.ts          # AI logic
├── hooks/
│   └── useAuth.ts            # Auth hook
└── providers/
    └── AuthProvider.tsx      # Auth context
```

---

## WHAT WORKS ✅

### Auth/SSO
- ✅ Sign in via Command Center
- ✅ `universeStore.handleDashCallback()` parses `?dashAuth=` param
- ✅ `dash_citizen_storage` shared across DASH apps
- ✅ Auto-detect identity in DaHub via `useDashIdentity`

### DaHub Social
- ✅ Friends list from Command Center
- ✅ Direct messages with real-time updates
- ✅ Presence (who's online, what app they're using)
- ✅ Notes (Instagram-style status bubbles)
- ✅ Add friend modal
- ✅ Profile card with DASH ID

### Player
- ✅ YouTube audio extraction
- ✅ R2 boosted audio (edge worker)
- ✅ Queue management
- ✅ Background playback

### Recommendations/AI
- ✅ vibeEngine (72 vibes → Supabase queries)
- ✅ intelligentDJ
- ✅ VoyoBrain

### Data
- ✅ 325K tracks in Supabase (video_intelligence)
- ✅ ~4K R2 audio objects
- ✅ Edge worker: voyo-edge.dash-webtv.workers.dev

---

## DEPLOYMENT

```bash
# Dev
cd /home/dash/voyo-music
npm run dev  # localhost:5173

# Deploy
git push  # Auto-deploys to Vercel
```

**URLs:**
- Production: voyo-music.vercel.app
- Domain: voyomusic.com (DNS pending)

---

## DEPRECATED (Don't Use)

- `src/components/classic/Hub.tsx` → Use `Dahub.tsx` instead
- `voyo-fork/` repo → This repo (voyo-music) is canonical

---

## NEXT STEPS

1. ⏳ voyomusic.com DNS config
2. ⏳ R2 audio upload (~4K local tracks)
3. ⏳ StoryViewer (fullscreen stories) - optional enhancement

---

*Last Updated: 2026-01-25*
*Status: CONSOLIDATED & READY*
