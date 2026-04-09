# VOYO Music - Utilities Documentation

Complete documentation for all utility functions in the VOYO Music application.

---

## Table of Contents

1. [debugIntent.ts](#debugintentts) - Intent Engine Debug Utilities
2. [format.ts](#formatts) - Formatting Utilities
3. [haptics.ts](#hapticts) - Haptic Feedback System
4. [imageHelpers.ts](#imagehelpersts) - Image Helper Functions (Deprecated)
5. [imageUtils.ts](#imageutilsts) - Image Utilities (Deprecated)
6. [mobileAudioUnlock.ts](#mobileaudiounlockts) - Mobile Audio Unlock
7. [searchCache.ts](#searchcachets) - Search Result Cache
8. [thumbnail.ts](#thumbnailst) - Thumbnail Utilities
9. [voyoId.ts](#voyoidts) - VOYO ID Encoding/Decoding

---

## debugIntent.ts

**File**: `/src/utils/debugIntent.ts`

### Purpose
Debug and verification utilities for the VOYO Intent Engine. Provides functions to verify that the keyword matching system works correctly, analyze scoring algorithms, and diagnose mode classification issues. Essential for tuning the personalization engine.

### Dependencies
- `../data/tracks` - Track database
- `../store/intentStore` - Intent keywords and mode matching
- `../services/personalization` - Scoring functions

---

### Exported Functions

---

#### `verifyKeywordMatching(): void`

**Lines 17-62**

**Purpose**: Test how well MODE_KEYWORDS match actual tracks in the database. Identifies which modes are over/under-represented and calculates match rate.

**Returns**: void (logs to console)

**How it works**:

**1. Initialize Mode Buckets** (Lines 22-29):
```typescript
const modeMatches: Record<VibeMode, string[]> = {
  'afro-heat': [],
  'chill-vibes': [],
  'party-mode': [],
  'late-night': [],
  'workout': [],
  'random-mixer': [],
};
```
- Creates empty arrays for each vibe mode
- Will store track titles that match each mode

**2. Classify Each Track** (Lines 31-41):
```typescript
TRACKS.forEach((track) => {
  const matchedMode = matchTrackToMode({
    title: track.title,
    artist: track.artist,
    tags: track.tags,
    mood: track.mood,
  });

  modeMatches[matchedMode].push(`${track.artist} - ${track.title}`);
});
```
- **Line 33-38**: Calls `matchTrackToMode()` with track metadata
- **Line 40**: Adds track to matched mode's array
- Tracks that don't match any mode fall into `random-mixer`

**3. Print Results** (Lines 43-51):
```typescript
Object.entries(modeMatches).forEach(([mode, tracks]) => {
  console.log(`\n📁 ${mode.toUpperCase()} (${tracks.length} tracks):`);
  if (tracks.length === 0) {
    console.log('   ⚠️  NO MATCHES - Keywords need adjustment!');
  } else {
    tracks.forEach((t) => console.log(`   • ${t}`));
  }
});
```
- Shows which tracks matched each mode
- Highlights modes with zero matches (need better keywords)

**4. Calculate Summary** (Lines 53-61):
```typescript
const unmatched = modeMatches['random-mixer'].length;
const total = TRACKS.length;
const matchRate = ((total - unmatched) / total * 100).toFixed(1);

console.log('\n========================================');
console.log(`📊 MATCH RATE: ${matchRate}% (${total - unmatched}/${total} tracks matched)`);
console.log(`⚠️  Unmatched (fell to random-mixer): ${unmatched}`);
console.log('========================================\n');
```
- **Match rate**: Percentage of tracks matched to specific modes
- **Unmatched**: Tracks that fell back to `random-mixer`
- **Goal**: 80%+ match rate for good personalization

**Example Output**:
```
========================================
🔍 KEYWORD MATCHING VERIFICATION
========================================

📁 AFRO-HEAT (12 tracks):
   • Burna Boy - Last Last
   • Wizkid - Essence
   ...

📁 RANDOM-MIXER (3 tracks):
   ⚠️  These tracks need better keywords!
   • Unknown Artist - Obscure Song

========================================
📊 MATCH RATE: 87.5% (35/40 tracks matched)
⚠️  Unmatched (fell to random-mixer): 5
========================================
```

**When to use**:
- After adding new tracks to database
- After modifying MODE_KEYWORDS
- When personalization feels inaccurate

---

#### `debugKeywordHits(): void`

**Lines 67-105**

**Purpose**: Show which keywords are actually matching tracks and which are unused. Helps identify dead keywords (no matches) and popular keywords (many matches).

**Returns**: void (logs to console)

**How it works**:

**1. Initialize Hit Counter** (Line 72):
```typescript
const keywordHits: Record<string, number> = {};
```
- Stores count for each `mode:keyword` pair

**2. Count Keyword Hits** (Lines 74-85):
```typescript
TRACKS.forEach((track) => {
  const searchText = `${track.title} ${track.artist} ${track.tags?.join(' ') || ''} ${track.mood || ''}`.toLowerCase();

  Object.entries(MODE_KEYWORDS).forEach(([mode, keywords]) => {
    keywords.forEach((kw) => {
      if (searchText.includes(kw.toLowerCase())) {
        const key = `${mode}:${kw}`;
        keywordHits[key] = (keywordHits[key] || 0) + 1;
      }
    });
  });
});
```
- **Line 75**: Builds searchable string from all track metadata
- **Line 77-84**: Tests every keyword against every track
- **Line 79**: Case-insensitive substring match
- **Line 80-81**: Increments counter for matched keywords

**3. Sort by Popularity** (Line 88):
```typescript
const sorted = Object.entries(keywordHits).sort((a, b) => b[1] - a[1]);
```
- Sorts keywords by hit count (descending)
- Shows most effective keywords first

**4. Print Matches** (Lines 90-93):
```typescript
console.log('Keywords that matched (sorted by hits):');
sorted.forEach(([key, hits]) => {
  console.log(`   ${key}: ${hits} hits`);
});
```

**5. Find Dead Keywords** (Lines 95-104):
```typescript
console.log('\n⚠️  Keywords with ZERO matches:');
Object.entries(MODE_KEYWORDS).forEach(([mode, keywords]) => {
  keywords.forEach((kw) => {
    const key = `${mode}:${kw}`;
    if (!keywordHits[key]) {
      console.log(`   ${key}`);
    }
  });
});
```
- Identifies keywords that matched nothing
- These should be removed or replaced

**Example Output**:
```
🎯 KEYWORD HIT ANALYSIS
========================================

Keywords that matched (sorted by hits):
   afro-heat:afrobeat: 15 hits
   party-mode:party: 12 hits
   chill-vibes:chill: 8 hits
   workout:energy: 5 hits
   ...

⚠️  Keywords with ZERO matches:
   workout:crossfit
   late-night:midnight
   afro-heat:juju
```

**When to use**:
- Optimizing keyword effectiveness
- Removing unused keywords (reduce processing)
- Adding new keywords based on common terms

---

#### `verifyScoring(): void`

**Lines 114-138**

**Purpose**: Test the scoring system with different intent configurations. Shows how intent and behavior scores combine to rank tracks.

**Returns**: void (logs to console)

**How it works**:

**1. Test Sample Tracks** (Line 122):
```typescript
TRACKS.slice(0, 5).forEach((track) => {
```
- Tests first 5 tracks only (for brevity)
- Can be changed to test all tracks or specific subset

**2. Calculate Scores** (Lines 123-130):
```typescript
const intentScore = calculateIntentScore(track);
const behaviorScore = calculateBehaviorScore(track, {});
const mode = matchTrackToMode({
  title: track.title,
  artist: track.artist,
  tags: track.tags,
  mood: track.mood,
});
```
- **intentScore**: Based on current MixBoard configuration (0-100)
- **behaviorScore**: Based on user behavior (play count, likes, skips)
- **mode**: Which vibe mode this track belongs to

**3. Print Results** (Lines 132-136):
```typescript
console.log(`\n   ${track.artist} - ${track.title}`);
console.log(`   Mode: ${mode}`);
console.log(`   Intent Score: ${intentScore.toFixed(2)}`);
console.log(`   Behavior Score: ${behaviorScore.toFixed(2)}`);
console.log(`   Combined (60/40): ${(intentScore * 0.6 + behaviorScore * 0.4).toFixed(2)}`);
```
- Shows all three scores for comparison
- **Combined score**: 60% intent, 40% behavior (current weighting)

**Example Output**:
```
📈 SCORING SYSTEM VERIFICATION
========================================

Intent Scores (based on current MixBoard state):

   Burna Boy - Last Last
   Mode: afro-heat
   Intent Score: 85.00
   Behavior Score: 42.00
   Combined (60/40): 67.80

   Adele - Easy On Me
   Mode: chill-vibes
   Intent Score: 30.00
   Behavior Score: 90.00
   Combined (60/40): 54.00
```

**What to look for**:
- High intent score when mode is boosted on MixBoard
- High behavior score for frequently played tracks
- Combined score properly balancing both signals

---

#### `verifyModeRetrieval(): void`

**Lines 143-155**

**Purpose**: Test the `getTracksByMode()` function to ensure each mode returns appropriate tracks.

**Returns**: void (logs to console)

**How it works**:

```typescript
export function verifyModeRetrieval(): void {
  console.log('\n========================================');
  console.log('🎵 MODE RETRIEVAL VERIFICATION');
  console.log('========================================\n');

  const modes: VibeMode[] = ['afro-heat', 'chill-vibes', 'party-mode', 'late-night', 'workout', 'random-mixer'];

  modes.forEach((mode) => {
    const tracks = getTracksByMode(mode, 3);
    console.log(`\n${mode.toUpperCase()}:`);
    tracks.forEach((t) => console.log(`   • ${t.artist} - ${t.title}`));
  });
}
```

- **Line 151**: Gets top 3 tracks for each mode
- **Line 153**: Prints track list for manual verification

**Example Output**:
```
🎵 MODE RETRIEVAL VERIFICATION
========================================

AFRO-HEAT:
   • Burna Boy - Last Last
   • Wizkid - Essence
   • Tems - Free Mind

CHILL-VIBES:
   • Adele - Easy On Me
   • Ed Sheeran - Shivers
   • Billie Eilish - Happier Than Ever
```

**When to use**:
- After changing scoring algorithm
- Verifying mode diversity (not always same tracks)
- Testing with different MixBoard configurations

---

#### `runAllVerifications(): void`

**Lines 161-170**

**Purpose**: Run all verification functions in sequence for comprehensive testing.

**Returns**: void (logs to console)

**How it works**:

```typescript
export function runAllVerifications(): void {
  console.log('\n🚀 VOYO INTENT ENGINE - FULL VERIFICATION\n');

  verifyKeywordMatching();
  debugKeywordHits();
  verifyScoring();
  verifyModeRetrieval();

  console.log('\n✅ Verification complete!\n');
}
```

- Runs all 4 verification functions sequentially
- Provides complete picture of intent engine health

**When to use**:
- After major changes to intent engine
- Before deploying new personalization features
- When debugging recommendation issues

---

### Browser Console Integration

**Lines 173-182**

```typescript
if (typeof window !== 'undefined') {
  (window as any).voyoDebug = {
    verifyKeywordMatching,
    debugKeywordHits,
    verifyScoring,
    verifyModeRetrieval,
    runAllVerifications,
  };
  console.log('🔧 VOYO Debug tools loaded. Run: voyoDebug.runAllVerifications()');
}
```

**How it works**:
- Attaches debug functions to `window.voyoDebug` object
- Only runs in browser environment (not SSR)
- Makes functions accessible in browser console

**Usage**:
```javascript
// In browser console
voyoDebug.runAllVerifications()

// Or individual functions
voyoDebug.verifyKeywordMatching()
voyoDebug.debugKeywordHits()
```

**Developer Experience**:
- No need to modify code to run verifications
- Quick access during development
- Safe for production (debug tools don't affect app)

---

### Technical Notes

1. **Why Console Logs?**
   - Debug utils are dev tools, not production features
   - Console provides formatted, collapsible output
   - Easier than building debug UI

2. **Performance Considerations**:
   - Verification loops through entire track database
   - Only call during development (not on every render)
   - ~10-50ms execution time for 100 tracks

3. **Match Rate Goals**:
   - 80%+ : Excellent keyword coverage
   - 60-80% : Good, but some modes may need keywords
   - < 60% : Need keyword improvement

---

## format.ts

**File**: `/src/utils/format.ts`

### Purpose
Single source of truth for all formatting functions in VOYO Music. Handles time duration, view counts, OYE scores, and relative dates. Ensures consistent formatting across the entire app.

---

### Exported Functions

---

#### `formatTime(seconds: number): string`

**Lines 9-20**

**Purpose**: Format seconds to MM:SS or HH:MM:SS (for long durations).

**Parameters**:
- `seconds`: Duration in seconds (can be float)

**Returns**: Formatted time string

**How it works**:

**1. Input Validation** (Line 10):
```typescript
if (!seconds || isNaN(seconds)) return '0:00';
```
- Handles `0`, `null`, `undefined`, `NaN`
- Returns safe default instead of crashing

**2. Calculate Time Components** (Lines 12-14):
```typescript
const hrs = Math.floor(seconds / 3600);
const mins = Math.floor((seconds % 3600) / 60);
const secs = Math.floor(seconds % 60);
```
- **hrs**: Integer hours (3600 seconds = 1 hour)
- **mins**: Integer minutes (60 seconds = 1 minute), remainder after hours
- **secs**: Integer seconds, remainder after minutes
- `Math.floor`: Truncates decimals (3.9 seconds becomes 3)

**3. Format with Hours** (Lines 16-18):
```typescript
if (hrs > 0) {
  return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
```
- For durations ≥ 1 hour
- Format: `H:MM:SS` or `HH:MM:SS`
- `.padStart(2, '0')`: Ensures 2 digits (e.g., `5` becomes `05`)

**4. Format without Hours** (Line 19):
```typescript
return `${mins}:${secs.toString().padStart(2, '0')}`;
```
- For durations < 1 hour
- Format: `M:SS` or `MM:SS`
- Minutes NOT zero-padded (3:45, not 03:45)

**Examples**:
```typescript
formatTime(45)        // "0:45"
formatTime(125)       // "2:05"
formatTime(3661)      // "1:01:01"
formatTime(7200)      // "2:00:00"
formatTime(0)         // "0:00"
formatTime(NaN)       // "0:00"
formatTime(3599)      // "59:59"
formatTime(3600)      // "1:00:00"
```

**Edge Cases**:
- Very long durations (>24h) work correctly
- Fractional seconds truncated (no rounding)
- Negative numbers treated as 0

---

#### `formatDuration(seconds: number): string`

**Line 23**

**Purpose**: Alias for `formatTime()` for backward compatibility.

```typescript
export const formatDuration = formatTime;
```

**Why?**:
- Original name was `formatDuration`
- Renamed to `formatTime` (shorter, clearer)
- Kept alias to avoid breaking existing code

**Usage**:
```typescript
// Both work identically
formatTime(125)      // "2:05"
formatDuration(125)  // "2:05"
```

---

#### `formatViews(views: number): string`

**Lines 28-41**

**Purpose**: Format large numbers to K/M/B format (YouTube-style).

**Parameters**:
- `views`: Number to format (e.g., view count, play count)

**Returns**: Formatted string with suffix

**How it works**:

**1. Input Validation** (Line 29):
```typescript
if (!views || isNaN(views)) return '0';
```

**2. Billion Scale** (Lines 31-33):
```typescript
if (views >= 1_000_000_000) {
  return `${(views / 1_000_000_000).toFixed(1)}B`;
}
```
- **Threshold**: 1 billion+
- **Format**: One decimal place (e.g., `2.5B`)
- `.toFixed(1)`: Always shows 1 decimal (even `.0`)

**3. Million Scale** (Lines 34-36):
```typescript
if (views >= 1_000_000) {
  return `${(views / 1_000_000).toFixed(1)}M`;
}
```
- **Threshold**: 1 million to 999 million
- **Format**: One decimal place (e.g., `14.2M`)

**4. Thousand Scale** (Lines 37-39):
```typescript
if (views >= 1_000) {
  return `${(views / 1_000).toFixed(0)}K`;
}
```
- **Threshold**: 1,000 to 999,999
- **Format**: Zero decimals (e.g., `542K`)
- **Why no decimal?**: Precision not important at this scale

**5. Small Numbers** (Line 40):
```typescript
return views.toString();
```
- Numbers < 1,000 shown exactly (e.g., `42`, `999`)

**Examples**:
```typescript
formatViews(42)              // "42"
formatViews(999)             // "999"
formatViews(1000)            // "1K"
formatViews(1500)            // "2K" (rounded)
formatViews(999999)          // "1000K"
formatViews(1000000)         // "1.0M"
formatViews(1234567)         // "1.2M"
formatViews(1000000000)      // "1.0B"
formatViews(2500000000)      // "2.5B"
```

**Edge Cases**:
- `999,999` shows as `1000K` (not `1.0M` - due to rounding)
- Always shows `.0` for M/B (consistent format)
- No decimals for K (cleaner look)

---

#### `formatOyeScore(score: number): string`

**Lines 46-48**

**Purpose**: Format OYE reaction score (same as views but semantically distinct).

```typescript
export const formatOyeScore = (score: number): string => {
  return formatViews(score);
};
```

**Why separate function?**:
- Semantic clarity (score vs. views)
- Allows different formatting in future (e.g., "2.5K OYE")
- Type safety for OYE-specific contexts

**Usage**:
```typescript
const score = 50000;
formatOyeScore(score)  // "50K"
```

---

#### `formatRelativeDate(dateString: string): string`

**Lines 53-65**

**Purpose**: Format date as human-readable relative time (e.g., "2 days ago").

**Parameters**:
- `dateString`: ISO date string (e.g., `"2024-12-15T10:30:00Z"`)

**Returns**: Relative time string

**How it works**:

**1. Calculate Difference** (Lines 54-57):
```typescript
const date = new Date(dateString);
const now = new Date();
const diffMs = now.getTime() - date.getTime();
const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
```
- **Line 54**: Parse input date
- **Line 55**: Get current time
- **Line 56**: Difference in milliseconds
- **Line 57**: Convert to days (1 day = 86,400,000 ms)

**2. Time Scale Logic** (Lines 59-64):
```typescript
if (diffDays === 0) return 'Today';
if (diffDays === 1) return 'Yesterday';
if (diffDays < 7) return `${diffDays} days ago`;
if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
return `${Math.floor(diffDays / 365)} years ago`;
```

**Thresholds**:
- **0 days**: "Today"
- **1 day**: "Yesterday"
- **2-6 days**: "N days ago"
- **7-29 days**: "N weeks ago" (7 days = 1 week)
- **30-364 days**: "N months ago" (30 days = 1 month)
- **365+ days**: "N years ago" (365 days = 1 year)

**Examples**:
```typescript
formatRelativeDate('2024-12-19')  // "Today" (if today is Dec 19)
formatRelativeDate('2024-12-18')  // "Yesterday"
formatRelativeDate('2024-12-14')  // "5 days ago"
formatRelativeDate('2024-12-01')  // "2 weeks ago"
formatRelativeDate('2024-06-01')  // "6 months ago"
formatRelativeDate('2023-01-01')  // "1 years ago" (grammar issue!)
```

**Edge Cases**:
- Assumes 30 days = 1 month (simplified)
- Assumes 365 days = 1 year (ignores leap years)
- Singular/plural grammar not handled ("1 years ago")
- Future dates return negative time (not handled)

**Potential Improvements**:
```typescript
// Handle singular/plural
if (diffDays < 365) {
  const months = Math.floor(diffDays / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

// Handle future dates
if (diffDays < 0) return 'In the future';
```

---

### Technical Notes

1. **Why Math.floor?**
   - Consistent truncation (never rounds up)
   - `3.9 days ago` becomes `3 days ago` (not 4)
   - User expectation: "3 days ago" means "at least 3, less than 4"

2. **Numeric Separators**:
   - `1_000_000` === `1000000` (same number, more readable)
   - ES2021 feature for clarity in large numbers

3. **Performance**:
   - All functions O(1) constant time
   - No loops or recursion
   - Safe to call in render (pure functions)

4. **Localization**:
   - Currently English-only
   - To support i18n, use Intl.RelativeTimeFormat API:
   ```typescript
   const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
   rtf.format(-1, 'day');  // "yesterday"
   rtf.format(-2, 'day');  // "2 days ago"
   ```

---

## haptics.ts

**File**: `/src/utils/haptics.ts`

### Purpose
TikTok/Instagram-level haptic feedback system for mobile interactions. Provides tactile feedback that makes the app feel premium and responsive on mobile devices.

### Dependencies
- None (uses native Vibration API)

---

### Type Definitions

#### `HapticPattern`

**Line 6**

```typescript
type HapticPattern = number | number[];
```

**Purpose**: Type for vibration patterns

**Values**:
- `number`: Single vibration duration in milliseconds
- `number[]`: Pattern of vibrate/pause durations (e.g., `[100, 50, 100]`)

---

### Helper Functions (Internal)

---

#### `canVibrate(): boolean`

**Lines 9-11**

**Purpose**: Check if Vibration API is supported on current device.

```typescript
const canVibrate = (): boolean => {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
};
```

**How it works**:
- **Line 10a**: `typeof navigator !== 'undefined'` - Check if in browser (not SSR)
- **Line 10b**: `'vibrate' in navigator` - Check if Vibration API exists

**Returns**:
- `true`: Device supports vibration
- `false`: SSR environment or unsupported device

**Browser Support**:
- Android: ✅ Chrome 32+, Firefox 16+
- iOS: ❌ Not supported (Apple doesn't expose Vibration API)
- Desktop: ❌ Not supported

---

#### `vibrate(pattern: HapticPattern): boolean`

**Lines 14-22**

**Purpose**: Core vibration function with safety checks.

**Parameters**:
- `pattern`: Single duration or array of durations

**Returns**:
- `true`: Vibration triggered successfully
- `false`: Vibration failed or not supported

**How it works**:

```typescript
const vibrate = (pattern: HapticPattern): boolean => {
  if (!canVibrate()) return false;

  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
};
```

**Line 15**: Early return if not supported
**Line 18**: Call native API
**Lines 19-21**: Catch errors (permission denied, etc.)

**navigator.vibrate() behavior**:
- **Single number**: Vibrate for N milliseconds
- **Array**: Vibrate-pause-vibrate pattern
  - `[100]` - Vibrate 100ms
  - `[100, 50, 100]` - Vibrate 100ms, pause 50ms, vibrate 100ms
- **Max pattern length**: 128 entries (browser limit)
- **Max duration**: ~10,000ms (browser-dependent)

---

### Exported Haptics Object

**Lines 27-85**

```typescript
export const haptics = {
  // ... pattern functions
};
```

---

#### `haptics.light(): boolean`

**Lines 32**

**Purpose**: Light tap feedback for subtle interactions.

```typescript
light: (): boolean => vibrate(10),
```

**Duration**: 10ms

**Use Cases**:
- Button presses
- Tab selections
- Checkbox toggles
- Subtle confirmations

**Feels like**: Gentle tap, barely noticeable

---

#### `haptics.medium(): boolean`

**Lines 38**

**Purpose**: Medium tap for standard interactions.

```typescript
medium: (): boolean => vibrate(20),
```

**Duration**: 20ms

**Use Cases**:
- Play/pause button
- Navigation actions
- Search submit
- Modal open/close

**Feels like**: Clear tap, noticeable but not jarring

---

#### `haptics.heavy(): boolean`

**Lines 44**

**Purpose**: Heavy tap for significant actions.

```typescript
heavy: (): boolean => vibrate(30),
```

**Duration**: 30ms

**Use Cases**:
- Add to queue
- Boost track on MixBoard
- Delete/remove actions
- Important confirmations

**Feels like**: Firm thump, satisfying feedback

---

#### `haptics.success(): boolean`

**Lines 50**

**Purpose**: Double pulse pattern for successful actions.

```typescript
success: (): boolean => vibrate([10, 5, 10]),
```

**Pattern**: Vibrate 10ms, pause 5ms, vibrate 10ms

**Use Cases**:
- Track added to queue
- Playlist saved
- Settings applied
- Download complete

**Feels like**: Quick double-tap, celebratory

---

#### `haptics.error(): boolean`

**Lines 56**

**Purpose**: Longer buzz for errors/failures.

```typescript
error: (): boolean => vibrate(100),
```

**Duration**: 100ms

**Use Cases**:
- Failed search
- Network error
- Invalid input
- Action blocked

**Feels like**: Harsh buzz, attention-grabbing

---

#### `haptics.selection(): boolean`

**Lines 62**

**Purpose**: Very light feedback for selection changes.

```typescript
selection: (): boolean => vibrate(5),
```

**Duration**: 5ms

**Use Cases**:
- Scrolling through picker
- Dragging sliders
- Carousel swipe
- Range selection

**Feels like**: Subtle tick, barely perceptible

---

#### `haptics.impact(): boolean`

**Lines 68**

**Purpose**: Impact pattern for reaction explosions (OYE 10x).

```typescript
impact: (): boolean => vibrate([30, 10, 30]),
```

**Pattern**: Vibrate 30ms, pause 10ms, vibrate 30ms

**Use Cases**:
- OYE button hit 10x multiplier
- Achievement unlocked
- Level up
- Explosive visual effects

**Feels like**: Strong double-thump, impactful

---

#### `haptics.notification(): boolean`

**Lines 74**

**Purpose**: Attention-grabbing pattern for notifications.

```typescript
notification: (): boolean => vibrate([20, 50, 20, 50, 20]),
```

**Pattern**: Vibrate 20ms, pause 50ms, vibrate 20ms, pause 50ms, vibrate 20ms

**Use Cases**:
- New message received
- Track finished downloading
- Important alert
- Background task complete

**Feels like**: Triple pulse, like a phone ringing

---

#### `haptics.custom(pattern: HapticPattern): boolean`

**Lines 79**

**Purpose**: Custom pattern for advanced use cases.

```typescript
custom: (pattern: HapticPattern): boolean => vibrate(pattern),
```

**Parameters**:
- `pattern`: Number or array of durations

**Use Cases**:
- Unique interactions (e.g., long-press timer)
- Morse code patterns
- Rhythm-based feedback
- Experimental features

**Example**:
```typescript
// Custom pattern: SOS in morse code
haptics.custom([100, 50, 100, 50, 100, 200, 300, 50, 300, 50, 300, 200, 100, 50, 100, 50, 100]);
```

---

#### `haptics.isSupported: () => boolean`

**Line 84**

**Purpose**: Check if haptics are supported.

```typescript
isSupported: canVibrate,
```

**Returns**: `true` if device supports vibration

**Usage**:
```typescript
if (haptics.isSupported()) {
  console.log('Haptics enabled');
} else {
  console.log('Haptics not available');
}
```

---

### Exported Helper Function

#### `getReactionHaptic(multiplier: number): () => boolean`

**Lines 91-96**

**Purpose**: Get appropriate haptic intensity based on OYE multiplier level.

**Parameters**:
- `multiplier`: Current multiplier value (1-10)

**Returns**: Haptic function matching intensity

**How it works**:

```typescript
export const getReactionHaptic = (multiplier: number): (() => boolean) => {
  if (multiplier >= 10) return haptics.impact;
  if (multiplier >= 5) return haptics.heavy;
  if (multiplier >= 2) return haptics.medium;
  return haptics.light;
};
```

**Intensity Mapping**:
- **1x**: Light (10ms)
- **2-4x**: Medium (20ms)
- **5-9x**: Heavy (30ms)
- **10x**: Impact (30-10-30 pattern)

**Usage**:
```typescript
function OYEButton({ multiplier, onPress }) {
  const handlePress = () => {
    const haptic = getReactionHaptic(multiplier);
    haptic(); // Trigger appropriate haptic
    onPress();
  };

  return <button onClick={handlePress}>OYE</button>;
}
```

**Progressive Feedback**:
- As multiplier grows, feedback intensifies
- User feels progress toward 10x
- 10x explosion gets special impact pattern

---

### Usage Patterns

#### Basic Button Feedback

```typescript
import { haptics } from '@/utils/haptics';

function PlayButton({ onPlay }) {
  return (
    <button onClick={() => {
      haptics.medium();
      onPlay();
    }}>
      Play
    </button>
  );
}
```

#### Conditional Haptics

```typescript
function AddToQueue({ track, queue }) {
  const handleAdd = () => {
    const success = queue.add(track);

    if (success) {
      haptics.success();
    } else {
      haptics.error();
    }
  };

  return <button onClick={handleAdd}>Add to Queue</button>;
}
```

#### Progressive Feedback

```typescript
function VolumeSlider({ value, onChange }) {
  const handleChange = (newValue) => {
    if (newValue !== value) {
      haptics.selection(); // Tick on each step
      onChange(newValue);
    }
  };

  return <input type="range" value={value} onChange={e => handleChange(+e.target.value)} />;
}
```

---

### Technical Notes

1. **iOS Limitation**:
   - iOS doesn't support Vibration API (privacy/UX reasons)
   - Use Taptic Engine via native app wrapper (Capacitor/React Native)
   - Progressive enhancement: works on Android, silent on iOS

2. **Battery Impact**:
   - Vibration uses power (motor)
   - Keep patterns short (< 100ms total)
   - Don't vibrate continuously (drains battery)

3. **Accessibility**:
   - Some users disable vibration (motion sensitivity)
   - Always pair with visual feedback
   - Don't rely solely on haptics for critical info

4. **Browser Permissions**:
   - Most browsers allow vibration without prompt
   - Some require user gesture (first interaction)
   - Chrome may throttle if overused

5. **Best Practices**:
   - Use sparingly (every action = fatigue)
   - Match intensity to action importance
   - Test on real devices (emulators don't vibrate)
   - Respect user preferences (allow disabling)

---

## imageHelpers.ts

**File**: `/src/utils/imageHelpers.ts`

### Purpose
**DEPRECATED** - Backward compatibility wrapper for old import paths. All functionality moved to `thumbnail.ts`.

### Migration Status
This file exists solely to prevent breaking changes. New code should import from `thumbnail.ts` directly.

---

### Exported Functions

#### `getThumbnailUrl(trackId, quality): string`

**Line 10**

```typescript
export { getThumb as getThumbnailUrl } from './thumbnail';
```

**Status**: Deprecated
**Replacement**: `import { getThumb } from './thumbnail'`

---

#### `getTrackThumbnailUrl(track, quality): string`

**Lines 15-23**

```typescript
export function getTrackThumbnailUrl(
  track: Track,
  quality: 'default' | 'medium' | 'high' | 'max' = 'high'
): string {
  if (track.coverUrl && track.coverUrl.startsWith('http')) {
    return track.coverUrl;
  }
  return getThumb(track.trackId, quality);
}
```

**Purpose**: Get thumbnail URL from Track object (prefers custom coverUrl).

**How it works**:
- **Line 19**: If track has custom cover URL (HTTP/HTTPS), use it
- **Line 22**: Otherwise, generate YouTube thumbnail

**Status**: Legacy helper
**Replacement**: Direct `getThumb()` call with fallback logic in component

**Example Migration**:
```typescript
// Old
import { getTrackThumbnailUrl } from './imageHelpers';
const url = getTrackThumbnailUrl(track);

// New
import { getThumb } from './thumbnail';
const url = track.coverUrl?.startsWith('http') ? track.coverUrl : getThumb(track.trackId);
```

---

### Migration Guide

**Old Code**:
```typescript
import { getThumbnailUrl, getTrackThumbnailUrl } from '@/utils/imageHelpers';

const url1 = getThumbnailUrl(trackId, 'high');
const url2 = getTrackThumbnailUrl(track, 'max');
```

**New Code**:
```typescript
import { getThumb } from '@/utils/thumbnail';

const url1 = getThumb(trackId, 'high');
const url2 = track.coverUrl || getThumb(track.trackId, 'max');
```

---

## imageUtils.ts

**File**: `/src/utils/imageUtils.ts`

### Purpose
**DEPRECATED** - Re-exports from unified thumbnail utility. All functionality moved to `thumbnail.ts`.

### Status
Exists for backward compatibility. Import from `thumbnail.ts` directly for new code.

---

### Re-Exported Types

```typescript
export type { ThumbnailQuality };
```

**Original**: `thumbnail.ts`

---

### Re-Exported Functions

#### `getYouTubeThumbnail(trackId, quality): string`

**Line 12**

```typescript
export const getYouTubeThumbnail = getThumb;
```

**Status**: Deprecated
**Replacement**: `import { getThumb } from './thumbnail'`

---

#### `generatePlaceholder(title, size): string`

**Line 11**

```typescript
export { generatePlaceholder };
```

**Purpose**: Generate SVG placeholder for missing thumbnails

**Original**: `thumbnail.ts`

---

### New Functions (SmartImage Support)

#### `getThumbnailFallbackChain(trackId: string): string[]`

**Lines 15-18**

**Purpose**: Get array of fallback URLs for progressive loading.

**Returns**: `[maxres, high, medium]` URLs

```typescript
export const getThumbnailFallbackChain = (trackId: string): string[] => {
  const fallbacks = getThumbWithFallback(trackId);
  return [fallbacks.primary, fallbacks.fallback, fallbacks.fallback2];
};
```

**Usage**:
```typescript
const urls = getThumbnailFallbackChain('dQw4w9WgXcQ');
// ["https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
//  "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
//  "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"]
```

---

#### `preloadImage(src: string): Promise<boolean>`

**Lines 25-32**

**Purpose**: Preload an image and test if it loads successfully.

**Returns**: Promise resolving to `true` (success) or `false` (failure)

**How it works**:

```typescript
export const preloadImage = (src: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
};
```

**Line 27**: Create new Image object (not inserted in DOM)
**Line 28**: Success handler
**Line 29**: Failure handler (404, CORS, network error)
**Line 30**: Start loading (triggers handlers)

**Usage**:
```typescript
const success = await preloadImage('https://example.com/image.jpg');
if (success) {
  console.log('Image loaded');
} else {
  console.log('Image failed to load');
}
```

---

#### `findWorkingThumbnail(trackId: string): Promise<string | null>`

**Lines 37-46**

**Purpose**: Find first working thumbnail from fallback chain.

**Returns**: Promise resolving to working URL or `null`

**How it works**:

```typescript
export const findWorkingThumbnail = async (trackId: string): Promise<string | null> => {
  const chain = getThumbnailFallbackChain(trackId);

  for (const url of chain) {
    const success = await preloadImage(url);
    if (success) return url;
  }

  return null;
};
```

**Line 38**: Get fallback URLs (max, high, medium)
**Line 40-43**: Test each URL sequentially
**Line 41**: Preload test
**Line 42**: Return first working URL
**Line 45**: All failed, return null

**Sequential Testing**:
- Tries `maxresdefault` first (best quality)
- Falls back to `hqdefault` if max fails
- Falls back to `mqdefault` if high fails
- Returns `null` if all fail (video deleted/private)

**Performance**:
- Fast path: ~100ms (max works)
- Slow path: ~300ms (all fail)
- Cached by useThumbnailCache (avoid repeating)

---

#### `getThumbnailQualityFromUrl(url: string): ThumbnailQuality | null`

**Lines 51-65**

**Purpose**: Extract quality level from YouTube thumbnail URL.

**Returns**: Quality level or `null` if not recognized

**How it works**:

```typescript
export const getThumbnailQualityFromUrl = (url: string): ThumbnailQuality | null => {
  const qualityMap: Record<string, ThumbnailQuality> = {
    'maxresdefault': 'max',
    'hqdefault': 'high',
    'mqdefault': 'medium',
    'default': 'default',
  };

  for (const [ytQuality, quality] of Object.entries(qualityMap)) {
    if (url.includes(`/${ytQuality}.jpg`)) {
      return quality;
    }
  }
  return null;
};
```

**Line 52-57**: Mapping of YouTube quality names to VOYO quality
**Line 59-63**: Pattern matching
**Line 60**: Checks for `/maxresdefault.jpg`, `/hqdefault.jpg`, etc.

**Examples**:
```typescript
getThumbnailQualityFromUrl('https://i.ytimg.com/vi/abc/maxresdefault.jpg')  // 'max'
getThumbnailQualityFromUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')      // 'high'
getThumbnailQualityFromUrl('https://example.com/custom.jpg')                 // null
```

---

#### `extractTrackIdFromUrl(url: string): string | null`

**Lines 70-73**

**Purpose**: Extract YouTube video ID from thumbnail URL.

**Returns**: Video ID or `null`

**How it works**:

```typescript
export const extractTrackIdFromUrl = (url: string): string | null => {
  const match = url.match(/\/vi\/([^\/]+)\//);
  return match ? match[1] : null;
};
```

**Line 71**: Regex matches `/vi/{VIDEO_ID}/`
**Line 72**: Returns captured group (video ID)

**Examples**:
```typescript
extractTrackIdFromUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')  // 'dQw4w9WgXcQ'
extractTrackIdFromUrl('https://example.com/custom.jpg')                          // null
```

---

### Constants

#### `THUMBNAIL_QUALITIES`

**Line 76**

```typescript
export const THUMBNAIL_QUALITIES = ['maxresdefault', 'hqdefault', 'mqdefault', 'default'] as const;
```

**Purpose**: Ordered list of YouTube thumbnail quality names (best to worst)

**Type**: `readonly ['maxresdefault', 'hqdefault', 'mqdefault', 'default']`

**Usage**:
```typescript
THUMBNAIL_QUALITIES.forEach(quality => {
  console.log(`Testing ${quality}`);
});
```

---

## mobileAudioUnlock.ts

**File**: `/src/utils/mobileAudioUnlock.ts`

### Purpose
Unlocks audio playback on iOS/Android devices that require user gesture before playing audio. Creates a silent audio context on first interaction to bypass autoplay restrictions.

---

### Module State

```typescript
let audioUnlocked = false;
let audioContext: AudioContext | null = null;
```

**audioUnlocked**: Flag indicating if audio has been unlocked
**audioContext**: Shared Web Audio API context (persists across calls)

---

### Exported Functions

---

#### `unlockMobileAudio(): Promise<void>`

**Lines 11-43**

**Purpose**: Unlock audio pipeline by playing silent buffer in user gesture context.

**Returns**: Promise that resolves when unlock complete (always succeeds)

**How it works**:

**1. Check if Already Unlocked** (Line 12):
```typescript
if (audioUnlocked) return Promise.resolve();
```
- Idempotent: safe to call multiple times
- Early return if already unlocked

**2. Create Audio Context** (Lines 16-21):
```typescript
const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
if (!AudioContextClass) {
  audioUnlocked = true;
  resolve();
  return;
}
```
- **Line 16**: Try standard `AudioContext` or webkit prefix (Safari)
- **Lines 17-21**: If not supported (old browser), mark as unlocked anyway

**3. Initialize Context** (Line 23):
```typescript
audioContext = new AudioContextClass();
```
- Creates Web Audio API context
- Stored in module variable (reused)

**4. Resume if Suspended** (Lines 25-27):
```typescript
if (audioContext.state === 'suspended') {
  audioContext.resume();
}
```
- Contexts start suspended on mobile
- `resume()` unlocks audio pipeline

**5. Play Silent Buffer** (Lines 29-34):
```typescript
const buffer = audioContext.createBuffer(1, 1, 22050);
const source = audioContext.createBufferSource();
source.buffer = buffer;
source.connect(audioContext.destination);
source.start(0);
```
- **Line 30**: Create 1-channel, 1-sample buffer at 22.05kHz (silent)
- **Line 31**: Create buffer source node
- **Line 32**: Assign silent buffer
- **Line 33**: Connect to speakers (required to unlock)
- **Line 34**: Play immediately (< 1ms duration)

**Why Silent Buffer?**:
- Playing any audio unlocks the pipeline
- Silent buffer is inaudible to user
- Very short (1 sample = 0.045ms at 22kHz)

**6. Mark Unlocked** (Lines 36-37):
```typescript
audioUnlocked = true;
resolve();
```

**7. Error Handling** (Lines 38-41):
```typescript
} catch (e) {
  audioUnlocked = true;
  resolve();
}
```
- Always marks as unlocked (even on error)
- Don't block app if unlock fails
- Actual audio play will handle the error

---

#### `isAudioUnlocked(): boolean`

**Lines 45-47**

**Purpose**: Check if audio has been unlocked.

```typescript
export function isAudioUnlocked(): boolean {
  return audioUnlocked;
}
```

**Returns**: `true` if unlocked, `false` otherwise

**Usage**:
```typescript
if (!isAudioUnlocked()) {
  console.log('Audio still locked - need user interaction');
}
```

---

#### `isMobileDevice(): boolean`

**Lines 49-53**

**Purpose**: Detect if running on mobile device.

```typescript
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints > 0 && /Mobi|Touch/i.test(navigator.userAgent));
}
```

**How it works**:

**Line 50**: SSR safety check

**Line 51**: User agent detection
- Matches iPhone, iPad, iPod, Android

**Line 52**: Touch device detection
- `maxTouchPoints > 0`: Device has touch screen
- `/Mobi|Touch/i`: User agent hints mobile/touch

**Why Two Checks?**:
- User agent can be spoofed
- Touch devices aren't always mobile (touch laptops)
- Combined check is more accurate

**Examples**:
```typescript
// iPhone
navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)'
isMobileDevice()  // true

// iPad
navigator.userAgent = '... (iPad; ...'
isMobileDevice()  // true

// Desktop Chrome
navigator.userAgent = '... Windows NT ...'
navigator.maxTouchPoints = 0
isMobileDevice()  // false

// Surface Pro (touch laptop)
navigator.userAgent = '... Windows NT ...'
navigator.maxTouchPoints = 10
isMobileDevice()  // true (because has "Touch" in UA)
```

---

#### `setupMobileAudioUnlock(): void`

**Lines 55-64**

**Purpose**: Auto-unlock audio on first user interaction (touchstart or click).

**Returns**: void (side effect: adds event listeners)

**How it works**:

```typescript
export function setupMobileAudioUnlock(): void {
  const unlockHandler = () => {
    unlockMobileAudio();
    document.removeEventListener('touchstart', unlockHandler);
    document.removeEventListener('click', unlockHandler);
  };

  document.addEventListener('touchstart', unlockHandler, { once: true, passive: true });
  document.addEventListener('click', unlockHandler, { once: true });
}
```

**Line 56-60**: Unlock handler
- Calls `unlockMobileAudio()`
- Removes both listeners (cleanup)

**Line 62**: Touch event listener
- `once: true`: Auto-removes after first fire
- `passive: true`: Improves scroll performance

**Line 63**: Click event listener (desktop fallback)
- `once: true`: Auto-removes after first fire

**Why Both Events?**:
- Mobile fires `touchstart` before `click`
- Desktop only fires `click`
- Handlers remove both (whichever fires first)

**Usage**:
```typescript
// In app initialization (App.tsx)
useEffect(() => {
  setupMobileAudioUnlock();
}, []);
```

---

### Technical Deep Dive

#### Why iOS/Android Need Unlocking

**Autoplay Policy** (introduced 2017):
1. Prevents auto-playing audio (saves data, prevents annoyance)
2. Requires user gesture to start audio
3. User gesture = tap, click, key press (not scroll/hover)

**What Gets Blocked**:
```typescript
// This FAILS on mobile (no user gesture)
useEffect(() => {
  const audio = new Audio('song.mp3');
  audio.play(); // ❌ DOMException: NotAllowedError
}, []);
```

**What Works**:
```typescript
// This WORKS (direct user gesture)
<button onClick={() => {
  const audio = new Audio('song.mp3');
  audio.play(); // ✅ Allowed
}}>Play</button>
```

---

#### How Web Audio API Helps

**Problem**: React state updates are async, losing gesture context

```typescript
// This FAILS (async state update breaks gesture chain)
const [isPlaying, setIsPlaying] = useState(false);

<button onClick={() => {
  setIsPlaying(true); // State update queued
}}>Play</button>

useEffect(() => {
  if (isPlaying) {
    audio.play(); // ❌ No gesture context here
  }
}, [isPlaying]);
```

**Solution**: Unlock audio context ONCE in gesture, then play anytime

```typescript
// Unlock once
<button onClick={async () => {
  await unlockMobileAudio(); // ✅ In gesture
}}>Start App</button>

// Play later (no gesture needed)
useEffect(() => {
  audio.play(); // ✅ Allowed (context unlocked)
}, [trackChange]);
```

---

#### Why 22.05kHz Sample Rate?

**Common sample rates**:
- 44,100 Hz: CD quality
- 48,000 Hz: Professional audio
- 22,050 Hz: Half CD quality

**Why 22kHz?**:
- Minimum for unlocking (browser doesn't care about quality)
- Uses less CPU (faster creation)
- Still above human hearing minimum (20 Hz - 20 kHz)

---

#### Browser Compatibility

| Browser | AudioContext | webkitAudioContext | Autoplay Policy |
|---------|--------------|-------------------|-----------------|
| Chrome Mobile | ✅ Yes | ✅ Yes | ✅ Strict |
| Safari iOS | ✅ Yes | ✅ Yes (legacy) | ✅ Very Strict |
| Firefox Android | ✅ Yes | ❌ No | ✅ Strict |
| Samsung Internet | ✅ Yes | ✅ Yes | ✅ Strict |
| Desktop Browsers | ✅ Yes | ❌ Deprecated | ⚠️ Less strict |

---

### Best Practices

1. **Call Early**:
   ```typescript
   // Good: Unlock on app init
   useEffect(() => {
     setupMobileAudioUnlock();
   }, []);

   // Bad: Unlock on play button (delays playback)
   <button onClick={async () => {
     await unlockMobileAudio(); // Adds latency
     play();
   }}>Play</button>
   ```

2. **Check Before Play**:
   ```typescript
   const handlePlay = async () => {
     if (!isAudioUnlocked()) {
       await unlockMobileAudio();
     }
     audio.play();
   };
   ```

3. **Don't Rely Solely on Unlock**:
   ```typescript
   // Still handle play errors
   try {
     await audio.play();
   } catch (err) {
     if (err.name === 'NotAllowedError') {
       // Show "Tap to play" button
     }
   }
   ```

---

## searchCache.ts

**File**: `/src/utils/searchCache.ts`

### Purpose
LRU (Least Recently Used) cache with TTL (Time To Live) for search results. Prevents duplicate API calls for the same query within 5 minutes. Dramatically improves search performance for repeat queries.

### Dependencies
- `../services/api` - SearchResult type

---

### Types

#### `CacheEntry`

**Lines 9-12**

```typescript
interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}
```

**Purpose**: Internal cache entry structure

**Fields**:
- `results`: Array of search results
- `timestamp`: Unix timestamp when cached (milliseconds)

---

### SearchCache Class

**Lines 14-102**

---

#### Constructor

**Lines 19-23**

```typescript
constructor(maxSize: number = 50, ttlMinutes: number = 5) {
  this.cache = new Map();
  this.maxSize = maxSize;
  this.ttl = ttlMinutes * 60 * 1000;
}
```

**Parameters**:
- `maxSize`: Maximum cache entries (default: 50)
- `ttlMinutes`: Time-to-live in minutes (default: 5)

**Fields**:
- `cache`: Map storing query -> CacheEntry
- `maxSize`: LRU eviction threshold
- `ttl`: TTL in milliseconds (5 min = 300,000 ms)

**Why 50 max size?**:
- Average query: ~20 chars
- Average result: ~500 bytes per track × 20 tracks = 10KB
- 50 queries: ~500KB memory (acceptable)

**Why 5 minute TTL?**:
- Search results change slowly (new uploads hourly, not every second)
- Long enough to help repeat searches in same session
- Short enough to catch new uploads reasonably fast

---

#### `get(query: string): SearchResult[] | null`

**Lines 29-42**

**Purpose**: Retrieve cached results if valid (not expired).

**Parameters**:
- `query`: Search query string

**Returns**: Cached results or `null` (cache miss or expired)

**How it works**:

**1. Normalize Query** (Line 30):
```typescript
const key = this.normalizeQuery(query);
```
- Ensures consistent cache keys (lowercase, trimmed, collapsed spaces)

**2. Lookup** (Line 31):
```typescript
const entry = this.cache.get(key);
```

**3. Check Expiry** (Lines 36-39):
```typescript
if (Date.now() - entry.timestamp > this.ttl) {
  this.cache.delete(key);
  return null;
}
```
- **Line 36**: Calculate age
- **Line 37**: Expired, remove from cache
- **Line 38**: Return null (cache miss)

**4. Return Results** (Line 41):
```typescript
return entry.results;
```

**Cache Hit Flow**:
```
Query "burna boy"
  → Normalize to "burna boy"
  → Lookup in cache
  → Found entry from 2 minutes ago
  → Not expired (< 5 min)
  → Return cached results ✅
```

**Cache Miss Flow**:
```
Query "burna boy"
  → Normalize to "burna boy"
  → Lookup in cache
  → Found entry from 6 minutes ago
  → Expired (> 5 min)
  → Delete entry
  → Return null ❌
```

---

#### `set(query: string, results: SearchResult[]): void`

**Lines 48-65**

**Purpose**: Store results in cache with LRU eviction.

**Parameters**:
- `query`: Search query
- `results`: Search results to cache

**How it works**:

**1. Normalize** (Line 49):
```typescript
const key = this.normalizeQuery(query);
```

**2. LRU Eviction** (Lines 51-57):
```typescript
if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
  const firstKey = this.cache.keys().next().value;
  if (firstKey) {
    this.cache.delete(firstKey);
  }
}
```
- **Line 52**: Only evict if cache full AND key not already present
- **Line 53**: Get oldest key (first in Map)
- **Line 55**: Remove oldest entry

**Why Oldest?**:
- JavaScript Map preserves insertion order
- First key = least recently used (LRU)

**3. Update Cache** (Lines 59-64):
```typescript
this.cache.delete(key);
this.cache.set(key, {
  results,
  timestamp: Date.now(),
});
```
- **Line 60**: Delete existing entry (if present)
- **Line 61**: Re-add at end (most recently used position)
- **Line 63**: Store results with current timestamp

**Why Delete Then Set?**:
- Moves entry to end of Map (most recently used)
- Map iteration order = insertion order
- Deleting and re-adding = updating position

**Example**:
```
Initial: ["apple", "banana", "cherry"]
set("banana", [...])
  → Delete "banana": ["apple", "cherry"]
  → Re-add "banana": ["apple", "cherry", "banana"]
Result: "banana" now most recently used
```

---

#### `has(query: string): boolean`

**Lines 70-72**

**Purpose**: Check if query is cached and valid.

```typescript
has(query: string): boolean {
  return this.get(query) !== null;
}
```

**Returns**: `true` if cached and not expired

**Usage**:
```typescript
if (searchCache.has('burna boy')) {
  console.log('Cache hit!');
}
```

---

#### `clear(): void`

**Lines 77-79**

**Purpose**: Clear all cached results.

```typescript
clear(): void {
  this.cache.clear();
}
```

**Usage**:
```typescript
// Settings page
<button onClick={() => searchCache.clear()}>
  Clear Search Cache
</button>
```

---

#### `getStats()`

**Lines 84-91**

**Purpose**: Get cache statistics for debugging.

**Returns**:
```typescript
{
  size: number;       // Current entries
  maxSize: number;    // Max entries allowed
  ttl: number;        // TTL in milliseconds
  queries: string[];  // All cached queries
}
```

**Usage**:
```typescript
const stats = searchCache.getStats();
console.log(`Cache: ${stats.size}/${stats.maxSize} entries`);
console.log(`TTL: ${stats.ttl / 1000 / 60} minutes`);
console.log(`Queries: ${stats.queries.join(', ')}`);
```

---

#### `normalizeQuery(query: string): string` (Private)

**Lines 99-101**

**Purpose**: Normalize query for consistent cache keys.

```typescript
private normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}
```

**Transformations**:
1. **Lowercase**: `"Burna Boy"` → `"burna boy"`
2. **Trim**: `"  burna boy  "` → `"burna boy"`
3. **Collapse spaces**: `"burna  boy"` → `"burna boy"`

**Why Normalize?**:
```typescript
// These should hit the same cache entry:
searchCache.get("Burna Boy")
searchCache.get("burna boy")
searchCache.get("  BURNA  BOY  ")
// All normalize to "burna boy"
```

**Without Normalization**:
```
"Burna Boy" → Cache miss
"burna boy" → Cache miss
"BURNA BOY" → Cache miss
// 3 API calls for same query!
```

---

### Singleton Instance

**Lines 104-105**

```typescript
export const searchCache = new SearchCache();
```

**Purpose**: Global cache instance (shared across app)

**Why Singleton?**:
- Single cache for all search components
- Avoid duplicate caching (memory waste)
- Share hits across different UI elements

**Usage**:
```typescript
// In search service
import { searchCache } from '@/utils/searchCache';

export async function search(query: string) {
  // Check cache
  const cached = searchCache.get(query);
  if (cached) return cached;

  // API call
  const results = await api.search(query);

  // Cache results
  searchCache.set(query, results);

  return results;
}
```

---

### LRU Algorithm Explained

**LRU = Least Recently Used**

**Goal**: Keep most frequently accessed data, evict old data

**How it works**:

1. **Access Updates Position**:
   ```
   Initial: [A, B, C, D, E]  (size=5, max=5)
   Access C → [A, B, D, E, C]  (C moved to end)
   ```

2. **New Entry Evicts Oldest**:
   ```
   Current: [A, B, D, E, C]  (size=5, max=5)
   Add F → [B, D, E, C, F]  (A evicted, F added)
   ```

3. **Hot Data Stays**:
   ```
   Queries: ["burna", "wizkid", "burna", "tems", "burna"]
   Cache: [..., "wizkid", "tems", "burna"]  (burna kept, accessed 3x)
   ```

**Why LRU for Search?**:
- Popular searches stay cached (multiple users searching same thing)
- One-time searches evicted (won't search again)
- Memory bounded (max 50 entries)

---

### Performance Impact

**Cache Hit** (query found):
- Time: ~0-1ms (Map lookup)
- Network: 0 bytes
- API: 0 calls

**Cache Miss** (query not found):
- Time: ~200-500ms (API call)
- Network: ~10-50KB (JSON response)
- API: 1 call

**Improvement**:
- 200-500x faster on cache hit
- Reduces API load by 60-80% (assuming repeat searches)
- Saves user data (mobile networks)

---

### Technical Notes

1. **Why Map Instead of Object?**
   ```typescript
   // Map preserves insertion order (ES2015)
   const map = new Map();
   map.set('a', 1);
   map.set('b', 2);
   [...map.keys()]  // ['a', 'b'] (order guaranteed)

   // Object order was undefined until ES2015
   const obj = {};
   obj.a = 1;
   obj.b = 2;
   Object.keys(obj)  // ['a', 'b'] (now guaranteed, but Map is clearer)
   ```

2. **TTL Alternatives**:
   - **No TTL**: Memory grows, stale data
   - **Short TTL (1 min)**: Fewer hits, more API calls
   - **Long TTL (1 hour)**: Stale results, more memory
   - **5 min**: Sweet spot for search

3. **Memory Estimation**:
   ```
   1 entry = query (20 bytes) + results (10KB) = ~10KB
   50 entries = 500KB (acceptable)
   1000 entries = 10MB (too much)
   ```

---

## thumbnail.ts

**File**: `/src/utils/thumbnail.ts`

### Purpose
Unified thumbnail utility - single source of truth for all YouTube thumbnail URLs. Handles VOYO ID decoding, quality selection, fallback chains, and placeholder generation.

---

### Types

#### `ThumbnailQuality`

**Line 7**

```typescript
export type ThumbnailQuality = 'default' | 'medium' | 'high' | 'max';
```

**Purpose**: YouTube thumbnail quality levels

**Values**:
- `'default'`: 120×90 pixels (very low quality)
- `'medium'`: 320×180 pixels (SD)
- `'high'`: 480×360 pixels (HD, recommended)
- `'max'`: 1280×720 pixels (Full HD, best quality but may not exist)

---

### Constants

#### `QUALITY_MAP`

**Lines 9-14**

```typescript
const QUALITY_MAP: Record<ThumbnailQuality, string> = {
  default: 'default',      // 120x90
  medium: 'mqdefault',     // 320x180
  high: 'hqdefault',       // 480x360
  max: 'maxresdefault',    // 1280x720
};
```

**Purpose**: Maps VOYO quality names to YouTube API quality names

**YouTube Quality Names**:
- `default.jpg`: Low quality (always exists)
- `mqdefault.jpg`: Medium quality (usually exists)
- `hqdefault.jpg`: High quality (always exists)
- `maxresdefault.jpg`: Maximum quality (may not exist for old/low-res videos)

---

### Exported Functions

---

#### `getThumb(trackId: string, quality?: ThumbnailQuality): string`

**Lines 21-31**

**Purpose**: Get YouTube thumbnail URL for a track (VOYO ID or raw YouTube ID).

**Parameters**:
- `trackId`: YouTube video ID (11 chars) or VOYO ID (`vyo_...`)
- `quality`: Thumbnail quality (default: `'high'`)

**Returns**: Full YouTube thumbnail URL

**How it works**:

**1. Decode VOYO ID** (Lines 23-29):
```typescript
let ytId = trackId;
if (trackId.startsWith('vyo_')) {
  const encoded = trackId.substring(4);
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) base64 += '=';
  try { ytId = atob(base64); } catch { ytId = trackId; }
}
```

**Line 24**: Check if VOYO ID (starts with `vyo_`)
**Line 25**: Extract encoded part (remove `vyo_` prefix)
**Line 26**: Reverse URL-safe base64 (`-` → `+`, `_` → `/`)
**Line 27**: Add padding if needed (base64 must be multiple of 4)
**Line 28**: Decode base64 to get YouTube ID
**Line 28 catch**: If decode fails, use original trackId

**2. Generate URL** (Line 30):
```typescript
return `https://i.ytimg.com/vi/${ytId}/${QUALITY_MAP[quality]}.jpg`;
```

**URL Format**: `https://i.ytimg.com/vi/{VIDEO_ID}/{QUALITY}.jpg`

**Examples**:
```typescript
getThumb('dQw4w9WgXcQ', 'high')
// → "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"

getThumb('vyo_ZFF3NGQ5V2dYY1E', 'max')
// → Decodes to "dQw4w9WgXcQ"
// → "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"

getThumb('dQw4w9WgXcQ')  // No quality specified
// → "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" (default: high)
```

---

#### `getThumbWithFallback(trackId: string)`

**Lines 36-40**

**Purpose**: Get thumbnail with full fallback chain for progressive loading.

**Parameters**:
- `trackId`: YouTube ID or VOYO ID

**Returns**:
```typescript
{
  primary: string;    // Max quality
  fallback: string;   // High quality
  fallback2: string;  // Medium quality
}
```

**How it works**:

```typescript
export const getThumbWithFallback = (trackId: string) => ({
  primary: getThumb(trackId, 'max'),
  fallback: getThumb(trackId, 'high'),
  fallback2: getThumb(trackId, 'medium'),
});
```

**Usage**:
```typescript
const { primary, fallback, fallback2 } = getThumbWithFallback('dQw4w9WgXcQ');

// Try loading in order:
// 1. primary (maxresdefault) - best quality, may 404
// 2. fallback (hqdefault) - good quality, always exists
// 3. fallback2 (mqdefault) - medium quality, always exists
```

**Why Fallbacks?**:
- `maxresdefault` doesn't exist for all videos (old uploads, live streams)
- Progressive loading: try best, fall back to reliable
- `hqdefault` always exists (YouTube guarantees)

---

#### `generatePlaceholder(title: string, size?: number): string`

**Lines 46-71**

**Purpose**: Generate SVG placeholder with gradient and initial letter for missing thumbnails.

**Parameters**:
- `title`: Track title (first letter used)
- `size`: SVG dimensions in pixels (default: 200)

**Returns**: Data URI with base64-encoded SVG

**How it works**:

**1. Extract Initial** (Line 47):
```typescript
const initial = title.charAt(0).toUpperCase();
```
- Gets first character of title
- Uppercase for consistency

**2. Generate Hash** (Lines 48-50):
```typescript
const hash = Math.abs(title.split('').reduce((acc, char) => {
  return ((acc << 5) - acc) + char.charCodeAt(0);
}, 0));
```
- **Hash function**: Creates deterministic number from title
- **Line 49**: `(acc << 5) - acc` = `acc * 31` (fast multiplier)
- **Line 49**: Add character code
- **Math.abs**: Ensure positive number

**Why Hash?**:
- Same title = same colors (consistent)
- Different titles = different colors (variety)

**3. Calculate Hue** (Lines 52-53):
```typescript
const hue1 = hash % 360;
const hue2 = (hash + 60) % 360;
```
- **hue1**: Primary color (0-360 degrees on color wheel)
- **hue2**: Secondary color (60° offset = complementary)
- `% 360`: Wrap around color wheel

**4. Generate SVG** (Lines 55-68):
```typescript
const svg = `
  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:hsl(${hue1}, 70%, 50%)" />
        <stop offset="100%" style="stop-color:hsl(${hue2}, 70%, 40%)" />
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#grad)" />
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
      font-family="system-ui, sans-serif" font-size="${size * 0.4}" font-weight="bold"
      fill="white" opacity="0.9">${initial}</text>
  </svg>
`.trim();
```

**Components**:
- **Lines 57-61**: Gradient definition (diagonal top-left to bottom-right)
- **Line 63**: Background rectangle with gradient
- **Lines 64-66**: Centered text with initial letter

**Text Styling**:
- **x="50%", y="50%"**: Center position
- **dominant-baseline="middle"**: Vertical center
- **text-anchor="middle"**: Horizontal center
- **font-size="${size * 0.4}"**: 40% of image size (e.g., 80px for 200px image)

**5. Encode to Data URI** (Line 70):
```typescript
return `data:image/svg+xml;base64,${btoa(svg)}`;
```
- `btoa()`: Base64 encode SVG string
- Data URI: Embeddable in `<img src="...">`

**Examples**:
```typescript
generatePlaceholder('Burna Boy', 200)
// → "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ..."
// Renders: Orange-to-red gradient with "B"

generatePlaceholder('Wizkid', 200)
// → Different hash → Different colors
// Renders: Blue-to-purple gradient with "W"

generatePlaceholder('Track Name', 100)
// → Smaller size
// Renders: 100×100 image with "T"
```

**Visual Result**:
```
┌───────────────────┐
│ ╱╲╱╲╱╲╱╲╱╲╱╲╱╲  │  ← Gradient
│ ╱╲╱╲╱╲╱╲╱╲╱╲╱╲  │
│   ╱╲  B  ╱╲     │  ← Initial letter
│ ╱╲╱╲╱╲╱╲╱╲╱╲╱╲  │
│ ╱╲╱╲╱╲╱╲╱╲╱╲╱╲  │
└───────────────────┘
```

---

### Aliases (Backward Compatibility)

**Lines 74-76**

```typescript
export const getThumbnailUrl = getThumb;
export const getYouTubeThumbnail = getThumb;
```

**Purpose**: Old function names still work (avoid breaking changes)

**Usage**:
```typescript
// All equivalent:
getThumb('abc123')
getThumbnailUrl('abc123')
getYouTubeThumbnail('abc123')
```

---

### Technical Notes

1. **Why Base64URL in VOYO IDs?**
   ```
   Standard base64: +, /, =
   URL-safe base64: -, _, (no padding)

   Example:
   YouTube ID: "dQw4w9WgXcQ"
   Base64: "ZFF3NGQ5V2dYY1E="
   Base64URL: "ZFF3NGQ5V2dYY1E" (no =)
   VOYO ID: "vyo_ZFF3NGQ5V2dYY1E"
   ```

2. **YouTube Thumbnail CDN**:
   - Hosted on `i.ytimg.com` (images subdomain)
   - Fast global CDN (edge caching)
   - CORS-enabled (can load cross-origin)
   - No authentication needed (public)

3. **Quality Availability**:
   ```
   default.jpg    ✅ Always exists
   mqdefault.jpg  ✅ Always exists (created on upload)
   hqdefault.jpg  ✅ Always exists (created on upload)
   maxresdefault  ⚠️ Only for HD+ videos (may 404)
   sddefault.jpg  ⚠️ Alternative to mqdefault (same size)
   ```

4. **Placeholder Design Decisions**:
   - **Gradient**: More visually interesting than solid color
   - **Initial letter**: Quick visual identification
   - **HSL colors**: Easy to generate consistent hues
   - **SVG**: Scales perfectly, no pixelation
   - **Data URI**: No external request needed

---

## voyoId.ts

**File**: `/src/utils/voyoId.ts`

### Purpose
VOYO ID utilities for encoding/decoding YouTube video IDs. VOYO IDs obfuscate YouTube IDs for cleaner URLs and potential analytics tracking. Format: `vyo_{base64url_encoded_youtube_id}`

---

### Exported Functions

---

#### `isVoyoId(id: string): boolean`

**Lines 9-11**

**Purpose**: Check if a string is a VOYO ID.

```typescript
export function isVoyoId(id: string): boolean {
  return id?.startsWith('vyo_');
}
```

**Returns**: `true` if starts with `vyo_`, `false` otherwise

**Examples**:
```typescript
isVoyoId('vyo_ZFF3NGQ5V2dYY1E')  // true
isVoyoId('dQw4w9WgXcQ')          // false
isVoyoId('')                      // false
isVoyoId(null)                    // false (safe with ?.)
```

---

#### `encodeVoyoId(youtubeId: string): string`

**Lines 17-41**

**Purpose**: Encode YouTube video ID to VOYO ID.

**Parameters**:
- `youtubeId`: YouTube video ID (11 characters, e.g., `dQw4w9WgXcQ`)

**Returns**: VOYO ID string (e.g., `vyo_ZFF3NGQ5V2dYY1E`)

**Throws**: Error if invalid input

**How it works**:

**1. Input Validation** (Lines 18-20):
```typescript
if (!youtubeId || typeof youtubeId !== 'string') {
  throw new Error('Invalid YouTube ID');
}
```
- Ensures input is non-empty string

**2. Check if Already Encoded** (Lines 22-25):
```typescript
if (youtubeId.startsWith('vyo_')) {
  return youtubeId;
}
```
- Idempotent: encoding a VOYO ID returns itself

**3. Base64 Encode** (Lines 27-40):
```typescript
try {
  const base64 = btoa(youtubeId);

  const urlSafe = base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `vyo_${urlSafe}`;
} catch (err) {
  throw new Error('Failed to encode YouTube ID');
}
```

**Line 29**: `btoa()` - Base64 encode
**Lines 32-34**: Make URL-safe
  - `+` → `-` (URL-safe character)
  - `/` → `_` (URL-safe character)
  - Remove `=` padding (not needed for decoding)
**Line 36**: Add `vyo_` prefix

**Examples**:
```typescript
encodeVoyoId('dQw4w9WgXcQ')
// → btoa('dQw4w9WgXcQ') = 'ZFF3NGQ5V2dYY1E='
// → Make URL-safe = 'ZFF3NGQ5V2dYY1E'
// → Add prefix = 'vyo_ZFF3NGQ5V2dYY1E'

encodeVoyoId('abc123')
// → 'vyo_YWJjMTIz'

encodeVoyoId('vyo_already_encoded')
// → 'vyo_already_encoded' (idempotent)
```

**Error Cases**:
```typescript
encodeVoyoId('')              // Error: Invalid YouTube ID
encodeVoyoId(null)            // Error: Invalid YouTube ID
encodeVoyoId(123)             // Error: Invalid YouTube ID
```

---

#### `decodeVoyoId(voyoId: string): string`

**Lines 47-74**

**Purpose**: Decode VOYO ID back to YouTube video ID.

**Parameters**:
- `voyoId`: VOYO ID string (e.g., `vyo_ZFF3NGQ5V2dYY1E`)

**Returns**: YouTube video ID (e.g., `dQw4w9WgXcQ`)

**Throws**: Error if invalid input or decode fails

**How it works**:

**1. Input Validation** (Lines 48-50):
```typescript
if (!voyoId || typeof voyoId !== 'string') {
  throw new Error('Invalid VOYO ID');
}
```

**2. Check if Already Raw YouTube ID** (Lines 52-55):
```typescript
if (!voyoId.startsWith('vyo_')) {
  return voyoId;
}
```
- Idempotent: decoding a raw YouTube ID returns itself

**3. Extract Encoded Part** (Line 57):
```typescript
const encoded = voyoId.substring(4);
```
- Removes `vyo_` prefix (first 4 characters)

**4. Reverse URL-Safe Base64** (Lines 59-62):
```typescript
let base64 = encoded
  .replace(/-/g, '+')
  .replace(/_/g, '/');
```
- `-` → `+` (restore base64 character)
- `_` → `/` (restore base64 character)

**5. Add Padding** (Lines 64-66):
```typescript
while (base64.length % 4 !== 0) {
  base64 += '=';
}
```
- Base64 strings must be multiple of 4
- Add `=` padding until length is divisible by 4

**6. Decode Base64** (Lines 68-73):
```typescript
try {
  return atob(base64);
} catch (err) {
  throw new Error('Failed to decode VOYO ID');
}
```
- `atob()`: Base64 decode
- Throws if invalid base64

**Examples**:
```typescript
decodeVoyoId('vyo_ZFF3NGQ5V2dYY1E')
// → Remove prefix = 'ZFF3NGQ5V2dYY1E'
// → Reverse URL-safe = 'ZFF3NGQ5V2dYY1E='
// → atob() = 'dQw4w9WgXcQ'

decodeVoyoId('vyo_YWJjMTIz')
// → 'abc123'

decodeVoyoId('dQw4w9WgXcQ')
// → 'dQw4w9WgXcQ' (already raw YouTube ID)
```

**Error Cases**:
```typescript
decodeVoyoId('')                  // Error: Invalid VOYO ID
decodeVoyoId('vyo_invalid!!!')    // Error: Failed to decode (invalid base64)
```

---

#### `getYouTubeId(trackId: string): string`

**Lines 79-89**

**Purpose**: Get YouTube ID from track - handles both VOYO IDs and raw YouTube IDs.

**Parameters**:
- `trackId`: VOYO ID or raw YouTube ID

**Returns**: YouTube video ID

**How it works**:

```typescript
export function getYouTubeId(trackId: string): string {
  if (!trackId) return '';

  if (isVoyoId(trackId)) {
    return decodeVoyoId(trackId);
  }

  return trackId;
}
```

**Line 80**: Empty string for falsy input (safe default)
**Lines 83-85**: Decode if VOYO ID
**Line 88**: Otherwise assume raw YouTube ID

**Examples**:
```typescript
getYouTubeId('vyo_ZFF3NGQ5V2dYY1E')  // 'dQw4w9WgXcQ' (decoded)
getYouTubeId('dQw4w9WgXcQ')          // 'dQw4w9WgXcQ' (pass-through)
getYouTubeId('')                      // '' (safe default)
getYouTubeId(null)                    // '' (safe default)
```

**Usage**:
```typescript
function YouTubePlayer({ trackId }) {
  const youtubeId = getYouTubeId(trackId);

  return (
    <iframe
      src={`https://www.youtube.com/embed/${youtubeId}`}
    />
  );
}
```

---

### Why VOYO IDs?

**Benefits**:
1. **Cleaner URLs**:
   ```
   Before: voyo.com/track/dQw4w9WgXcQ
   After:  voyo.com/track/vyo_ZFF3NGQ5V2dYY1E
   ```

2. **Obfuscation**:
   - Hides raw YouTube IDs from casual inspection
   - Makes direct YouTube access less obvious

3. **Analytics Tracking**:
   - VOYO ID in URL = came from VOYO
   - YouTube ID in URL = external link
   - Can track referral sources

4. **Future-Proofing**:
   - Can add metadata to VOYO ID (version, flags)
   - Example: `vyo_v2_...` for format changes

**Trade-offs**:
- Extra encoding/decoding overhead (~1-5ms)
- Slightly longer URLs (base64 is ~33% larger)
- Need consistent encoding across frontend/backend

---

### Technical Deep Dive

#### Base64 vs Base64URL

**Standard Base64**:
```
Characters: A-Z, a-z, 0-9, +, /
Padding: = (for length multiple of 4)
Example: "Hello" → "SGVsbG8="
```

**Base64URL** (RFC 4648):
```
Characters: A-Z, a-z, 0-9, -, _
Padding: Optional (usually omitted)
Example: "Hello" → "SGVsbG8"
```

**Why URL-Safe?**:
```
Standard base64: "a+b/c=" (+ and / need escaping in URLs)
URL-safe:        "a-b_c"  (- and _ don't need escaping)

URL with standard: /track/vyo_a%2Bb%2Fc%3D (ugly)
URL with URL-safe: /track/vyo_a-b_c       (clean)
```

---

#### Padding Behavior

**Why Padding Exists**:
- Base64 encodes 3 bytes → 4 characters
- If input not divisible by 3, padding added
- Padding indicates "incomplete group"

**Example**:
```
Input: "Hi" (2 bytes)
Binary: 01001000 01101001
Base64 groups: 010010 000110 1001xx xxxx
Base64 chars: S      G      l      =
Result: "SGl="
```

**Decoding Without Padding**:
- Decoder calculates missing bytes
- Padding not strictly needed (but helps validate)
- We add padding back before decoding (safety)

---

#### Error Handling Philosophy

**Encode**: Strict validation
```typescript
encodeVoyoId('')  // ❌ Throws error (invalid input)
encodeVoyoId(123) // ❌ Throws error (wrong type)
```

**Decode**: Permissive fallback
```typescript
decodeVoyoId('dQw4w9WgXcQ')  // ✅ Returns as-is (already decoded)
getYouTubeId('')              // ✅ Returns '' (safe default)
```

**Why Different?**:
- Encoding: Controlled environment (our code creates IDs)
- Decoding: User input (URLs, copy-paste, external sources)
- Strict on write, permissive on read

---

### Usage Patterns

#### In URL Routing

```typescript
// App.tsx routes
<Route path="/track/:id" element={<TrackPage />} />

// TrackPage.tsx
function TrackPage() {
  const { id } = useParams(); // Could be VOYO ID or YouTube ID
  const youtubeId = getYouTubeId(id);

  return <YouTubePlayer videoId={youtubeId} />;
}
```

#### In API Responses

```typescript
// Backend: Encode IDs before sending
tracks.map(track => ({
  ...track,
  trackId: encodeVoyoId(track.youtubeId)
}))

// Frontend: Decode when needed
const { trackId } = track;
const youtubeId = getYouTubeId(trackId);
```

#### In Share Links

```typescript
function ShareButton({ track }) {
  const shareUrl = `https://voyo.app/track/${track.trackId}`;

  return (
    <button onClick={() => navigator.clipboard.writeText(shareUrl)}>
      Share
    </button>
  );
}
```

---

**Last Updated**: December 19, 2025
**Version**: 1.0.0
**Maintainer**: VOYO Development Team
