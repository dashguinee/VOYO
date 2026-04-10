# VoYo — Session Handoff (April 2, 2026)

## STATUS: LIVE at voyomusic.com

### Fixed Today
- Circular dependency crash (blank screen) — removed forced `manualChunks` store splitting in vite.config.ts
- Push notifications wired (same unified DASH backend as Giraf + Hub)
- Confirmed voyo-music is the source of truth (voyo-fork is stale, archive it)

### What's Working
- App loads and runs on voyomusic.com
- 4 domains: voyomusic.com, voyo.dasuperhub.com, music.dasuperhub.com, voyo-music.vercel.app
- Code-split build (232KB core)
- Push handler in service worker
- usePushNotifications hook created
- api/send-push.js serverless function

### Known Issues
- Console still shows circular dep warnings (non-fatal, app works)
- Push notifications not yet tested on VoYo (tokens save to dash_push_tokens with app='voyo')
- OyoIsland (Dynamic Island) not yet integrated with push
- Cloudflare Edge Worker status unknown — check wrangler config

### Next Steps
1. Test push on VoYo (opt in → welcome notification)
2. Wire OyoIsland to show notifications
3. Check Cloudflare worker / R2 audio serving
4. Full UX audit — battery drain, phone heat, overcomplicated flows
5. Settle voyo-fork (archive or delete)

### Root Cause Log
The blank screen was caused by `vite.config.ts` manualChunks forcing all stores into one chunk:
```js
if (id.includes('/store/')) return 'app-stores'; // ← THIS CAUSED IT
```
Circular imports between stores need Vite's natural tree-shaking to resolve init order. Forcing them into one file breaks that.
