# Testing the VOYO Preference Engine

## Quick Test (5 minutes)

### 1. Start the App
```bash
npm run dev
```

### 2. Open Browser Console
- Chrome/Edge: F12 → Console tab
- Look for `[Prefs]` logs

### 3. Play Test Sequence

**Test A: Complete a Track**
1. Play "UNAVAILABLE" by Davido
2. Let it play >80% of the way (at least 2:30 of 3:10)
3. Watch console for: `[Prefs] Completion recorded: 1`
4. Check localStorage: `localStorage.getItem('voyo-preferences')`

**Test B: Skip a Track**
1. Play "Calm Down" by Rema
2. Skip it after 10-20 seconds (<20%)
3. Watch console for: `[Prefs] Skip recorded: 2`

**Test C: Give Reactions**
1. Play "Rush" by Ayra Starr
2. Click OYÉ reaction buttons (🔥, ✨, etc.)
3. Watch console for: `[Prefs] Reaction recorded: 4`
4. Give multiple reactions

### 4. Check Persistence

**Refresh the page**:
1. F5 to reload
2. Open console
3. Check localStorage still has data:
   ```javascript
   JSON.parse(localStorage.getItem('voyo-preferences')).state.trackPreferences
   ```

### 5. Test Personalization

**After playing 3-4 tracks**:
1. Check if AI mode is on (toggle in UI)
2. Switch between tracks
3. Watch DISCOVERY zone update
4. Check console for: `[Prefs] Calculating personalized DISCOVERY for: ...`

---

## Console Commands

### Check Preferences
```javascript
// Get all tracked tracks
const prefs = JSON.parse(localStorage.getItem('voyo-preferences')).state.trackPreferences;
console.table(Object.values(prefs));
```

### Clear All Preferences
```javascript
localStorage.removeItem('voyo-preferences');
location.reload();
```

### Check Specific Track
```javascript
const prefs = JSON.parse(localStorage.getItem('voyo-preferences')).state.trackPreferences;
console.log(prefs['1']); // Track ID 1 = "UNAVAILABLE"
```

---

## Expected Console Output

### When Starting a Track
```
[Prefs] Started tracking: UNAVAILABLE
[AudioPlayer] Loading stream for: UNAVAILABLE
```

### When Completing a Track
```
[Prefs] Track completed: UNAVAILABLE
[Prefs] Ended session: { trackId: '1', duration: 180, completed: true, skipped: false, reactions: 0 }
[Prefs] Completion recorded: 1 { completions: 1, totalListens: 1, completionRate: '100.0%' }
```

### When Skipping a Track
```
[Prefs] Track changed, ending previous session
[Prefs] Skip recorded: 2 { skips: 1, totalListens: 1 }
```

### When Giving Reactions
```
[Prefs] Reaction recorded: 4 { reactions: 3 }
```

### When Calculating Personalization
```
[Prefs] Calculating personalized HOT tracks...
[Prefs] UNAVAILABLE - Behavior: completion=50.0, reactions=30, skips=0
[Prefs] UNAVAILABLE - FINAL SCORE: 80.14
[Prefs] Calm Down - Behavior: completion=0.0, reactions=0, skips=-30
[Prefs] Calm Down - FINAL SCORE: -28.73
```

---

## What to Look For

### Success Indicators
✅ Console shows `[Prefs]` logs for every action
✅ localStorage contains `voyo-preferences` key
✅ Completion rate increases when tracks are played through
✅ Skip count increases when tracks are skipped
✅ Reaction count increases when OYÉ buttons are pressed
✅ Data persists after page refresh

### Red Flags
❌ No `[Prefs]` logs appearing
❌ localStorage is empty
❌ Preferences not persisting after refresh
❌ Scores not changing based on behavior
❌ Console errors mentioning preferences

---

## Advanced Testing

### Test Scenario: "Love Rema, Hate Burna"

1. **Play Rema tracks to completion**:
   - "Calm Down" - let it finish
   - Give it 5+ reactions

2. **Skip Burna Boy tracks early**:
   - "City Boys" - skip after 10 seconds
   - "Last Last" - skip after 15 seconds

3. **Check HOT zone**:
   - Should prioritize Rema
   - Should de-prioritize Burna Boy

4. **Play another Rema track**:
   - DISCOVERY should show more Rema/similar artists

### Expected Scores After Above Test

```javascript
// Rema's "Calm Down" - Completed + Reactions
// Score ≈ +50 (completion) + 50 (reactions) = +100

// Burna's "City Boys" - Skipped
// Score ≈ -30 (skip) = -30

// Next HOT refresh should show Rema higher, Burna lower
```

---

## localStorage Structure

### What It Looks Like
```json
{
  "state": {
    "trackPreferences": {
      "1": {
        "trackId": "1",
        "totalListens": 2,
        "totalDuration": 360,
        "completions": 1,
        "skips": 1,
        "reactions": 5,
        "lastPlayedAt": "2025-12-08T21:30:00.000Z",
        "createdAt": "2025-12-08T21:25:00.000Z"
      }
    },
    "artistPreferences": {},
    "tagPreferences": {},
    "moodPreferences": {},
    "currentSession": null
  },
  "version": 1
}
```

### Key Fields
- `totalListens`: How many times started
- `completions`: Played >80%
- `skips`: Played <20%
- `reactions`: OYÉ buttons pressed
- `totalDuration`: Total seconds listened

---

## Troubleshooting

### "No [Prefs] logs appearing"
- Check if `AudioPlayer` is rendering
- Verify imports are correct
- Check browser console for errors

### "localStorage is empty"
- Might be in incognito mode
- Check browser storage quota
- Try clearing cache and reloading

### "Preferences not persisting"
- Zustand persist might not be working
- Check if `voyo-preferences` key exists
- Verify version number is 1

### "Personalization not working"
- Ensure AI mode is enabled
- Need at least 2-3 tracked tracks to see effect
- Check console for personalization logs

---

## Performance Check

After 10+ tracked tracks:

1. **Check localStorage size**:
   ```javascript
   const size = new Blob([localStorage.getItem('voyo-preferences')]).size;
   console.log(`Size: ${size} bytes (${(size/1024).toFixed(2)} KB)`);
   ```

2. **Expected size**: ~1KB per 10 tracks
3. **Load time**: Should be <1ms
4. **No lag**: UI should remain responsive

---

## Success Criteria

✅ All `[Prefs]` logs appear correctly
✅ localStorage persists across refreshes
✅ Completions tracked when playing >80%
✅ Skips tracked when playing <20%
✅ Reactions increment preference count
✅ Personalized HOT shows preferred tracks higher
✅ Personalized DISCOVERY adapts to behavior
✅ No console errors
✅ No performance issues

---

**Total Test Time**: 5-10 minutes
**Difficulty**: Easy (just play music!)
**Tools Needed**: Browser + DevTools
