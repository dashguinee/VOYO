# Background Playback Testing Checklist

**Date**: 2025-12-26
**Changes**: Added visibility handler, wake lock, service worker audio caching

---

## Quick Test (2 minutes)

### Test 1: Boosted Track Background Playback
1. Open VOYO Music PWA
2. Boost a track (click ⚡ Boost HD button)
3. Wait for boost to complete
4. Play the boosted track
5. **Check console**: Should see `🔒 [VOYO] Wake lock active`
6. **Minimize app** (press home button or switch apps)
7. **Expected**: Music continues playing ✅
8. **Check lock screen**: Controls should appear
9. **Return to app**: UI should be in sync

**If music stops**: Check browser console for errors

### Test 2: CDN Stream Background Playback
1. Play a track that's NOT boosted
2. **Check console**: Should see CDN streaming URL
3. **Minimize app**
4. **Expected**: Music continues playing ✅
5. **Lock screen controls**: Should work

**If music stops**: Track may have fallen back to IFrame - this is expected

---

## Detailed Test (10 minutes)

### Wake Lock Test
1. Play a track (boosted or CDN)
2. **Console check**: `🔒 [VOYO] Wake lock active`
3. Lock phone screen (power button)
4. Wait 30 seconds
5. Unlock screen
6. **Expected**: Screen didn't sleep during playback
7. **Console check**: May see `🔓 [VOYO] Wake lock released` on unlock

### Visibility Change Test
1. Play a track
2. Open DevTools → Console
3. Switch to another app
4. **Console check**: Should see audio context resume logs
5. Switch back
6. **Expected**: Music never paused

### Service Worker Cache Test
1. Play a CDN track (not boosted)
2. Let it play for 10 seconds
3. **Console check**: `[SW] Audio cached: /cdn/stream/...`
4. Refresh the page
5. Play the same track
6. **Console check**: `[SW] Audio cache hit: /cdn/stream/...`

### IFrame Fallback Test (Expected to Fail)
1. Disable network (simulate CDN failure)
2. Play a track → Falls back to YouTube IFrame
3. Minimize app
4. **Expected**: Music STOPS (YouTube policy) ❌
5. This is normal - no workaround exists

---

## Browser Compatibility

### Chrome/Edge (Desktop & Mobile)
- ✅ Wake lock supported
- ✅ Visibility API supported
- ✅ Service worker caching works
- **Result**: Full background playback

### Safari (iOS)
- ⚠️ Wake lock may not be supported (check console)
- ✅ Visibility API supported
- ✅ Service worker caching works
- **Result**: Background playback works, screen may sleep

### Firefox (Desktop & Mobile)
- ⚠️ Wake lock may not be supported
- ✅ Visibility API supported
- ✅ Service worker caching works
- **Result**: Background playback works, screen may sleep

---

## Console Logs to Look For

### Success Indicators
```
🔒 [VOYO] Wake lock active - screen won't sleep
[SW] Audio cached: /cdn/stream/...
[SW] Audio cache hit: /cdn/stream/...
🎵 [VOYO] Audio Enhancement Active (BOOSTED): ...
```

### Warning Indicators
```
[VOYO] Wake lock not available: [error]
# This is OK on HTTP or old browsers - background still works
```

### Error Indicators
```
[VOYO IFrame] Error: ...
# Means IFrame fallback failed - skip to next track
```

---

## Troubleshooting

### Music stops when minimizing
**Possible causes**:
1. Track is using YouTube IFrame (expected - no fix)
2. Browser doesn't support background audio (very rare)
3. Service worker not registered (check Application tab in DevTools)

**Solutions**:
1. Boost the track (guarantees background playback)
2. Try a different track (may be CDN issue)
3. Check if PWA is installed (standalone mode helps)

### Wake lock not working
**Possible causes**:
1. HTTP connection (wake lock requires HTTPS)
2. Old browser (wake lock API added 2020+)
3. Browser policy (some browsers disable on certain devices)

**Solutions**:
1. Use HTTPS in production
2. Background playback still works without wake lock
3. Screen may sleep but audio continues

### Service worker not caching
**Possible causes**:
1. Service worker not registered
2. DevTools has "Disable cache" enabled
3. Private/incognito mode

**Solutions**:
1. Check Application → Service Workers in DevTools
2. Disable "Disable cache" in Network tab
3. Use normal browsing mode

---

## Production Deployment

### Pre-deployment Checklist
- [ ] Build succeeded: `npm run build`
- [ ] Service worker cache name updated: `voyo-audio-v1`
- [ ] HTTPS enabled (required for wake lock)
- [ ] PWA manifest verified
- [ ] Console logs added for debugging

### Post-deployment Testing
1. Install PWA on mobile device
2. Test boosted track background playback
3. Test CDN track background playback
4. Check wake lock in console
5. Verify lock screen controls

### Rollback Plan
If issues occur:
1. Revert `src/components/AudioPlayer.tsx` (remove lines 157, 202-275)
2. Revert `public/service-worker.js` (remove audio caching)
3. Rebuild and deploy

---

## Expected Results

### Success Rate
- **95%+** of tracks support background playback
- **5%** YouTube IFrame fallback (expected limitation)

### Battery Impact
- **Wake lock**: Minimal - same as screen staying on
- **Service worker**: Negligible - efficient caching
- **Visibility handler**: None - single event listener

### User Experience
- ✅ Music continues when switching apps
- ✅ Music continues when locking screen
- ✅ Lock screen controls work
- ✅ Faster playback from cached streams
- ✅ Better reliability (offline fallback)

---

**END OF TEST PLAN**
