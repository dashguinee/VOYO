# VOYO Music Stealth Mode - Quick Start Guide

## 🚀 Start the App

```bash
# Terminal 1: Backend
cd /home/dash/voyo-music/server
node index.js

# Terminal 2: Frontend
cd /home/dash/voyo-music
npm run dev
```

## ✅ Verify Stealth Mode

1. Open browser to `http://localhost:5173`
2. Open DevTools → Network tab
3. Search for any song
4. Play a track
5. **Verify:** All requests to `localhost:3001/cdn/*` or `/api/*`
6. **Verify:** NO `youtube.com`, `googlevideo.com`, or `ytimg.com` URLs
7. **Verify:** All IDs use `vyo_` prefix

## 🧪 Run Tests

```bash
cd /home/dash/voyo-music
./test-stealth.sh
```

Expected: All tests pass with ✅

## 📚 Documentation

- **STEALTH-MODE.md** - Complete technical documentation
- **IMPLEMENTATION-SUMMARY.md** - Detailed implementation summary
- **STEALTH-VERIFICATION.txt** - Test results

## 🎯 What Changed

### Backend
- **New file:** `server/stealth.js` - ID obfuscation
- **Modified:** `server/index.js` - Added `/cdn/*` and `/api/search` endpoints

### Frontend
- **Modified:** `src/services/api.ts` - Updated to use VOYO IDs

### Key Changes
- YouTube IDs → VOYO IDs (`vyo_XXXXX`)
- YouTube URLs → CDN URLs (`/cdn/stream/`, `/cdn/art/`)
- YouTube errors → VOYO errors ("VOYO stream unavailable")

## 🔄 Example Transformation

**Before:**
```javascript
// Search returns
{ id: "OSBan_sH_b8", thumbnail: "https://img.youtube.com/..." }

// Stream URL
"http://localhost:3001/proxy?v=OSBan_sH_b8"
```

**After (Stealth):**
```javascript
// Search returns
{ voyoId: "vyo_T1NCYW5fc0hfYjg", thumbnail: "/cdn/art/vyo_T1NCYW5fc0hfYjg" }

// Stream URL
"http://localhost:3001/cdn/stream/vyo_T1NCYW5fc0hfYjg"
```

## ✨ Result

Users see **ONLY** VOYO infrastructure. No YouTube traces anywhere.

---

**Status:** Production Ready
**Date:** December 8, 2025
