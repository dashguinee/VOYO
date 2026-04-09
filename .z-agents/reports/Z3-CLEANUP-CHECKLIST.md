# Z3 Code Cleanup Checklist
**VOYO Music - Investor Demo Preparation**

---

## 🔴 CRITICAL - Must Fix Before Demo

### 1. Console.log Cleanup
**Effort**: 2 hours | **Impact**: High

```bash
# Create debug utility
# File: src/utils/debug.ts
const DEBUG = import.meta.env.DEV;
export const debug = {
  log: (...args: any[]) => DEBUG && console.log('[VOYO]', ...args),
  error: (...args: any[]) => DEBUG && console.error('[VOYO ERROR]', ...args),
  warn: (...args: any[]) => DEBUG && console.warn('[VOYO WARN]', ...args),
};
```

**Files to Clean**:
- [ ] `src/services/personalization.ts` (16 logs)
- [ ] `src/store/downloadStore.ts` (12 logs)
- [ ] `src/store/preferenceStore.ts` (8 logs)
- [ ] `src/services/api.ts` (9 logs)
- [ ] `src/services/audioEngine.ts` (8 logs)
- [ ] `src/components/AudioPlayer.tsx` (7 logs)
- [ ] `src/services/clientExtractor.ts` (9 logs)
- [ ] All other files (12 logs total)

**Find & Replace Pattern**:
```bash
# Find all console.log
grep -r "console.log" src/

# Replace with debug.log (manual review each)
```

---

### 2. Mock Data Issue
**Effort**: 1 hour | **Impact**: High

**File**: `src/components/voyo/feed/VoyoVerticalFeed.tsx`

**Option A - Remove Feature** (Recommended for demo):
- [ ] Comment out VoyoVerticalFeed component
- [ ] Disable feed tab in navigation
- [ ] Add "Coming Soon" placeholder

**Option B - Add Demo Indicator**:
- [ ] Add banner: "Demo Mode - Real content coming soon"
- [ ] Style differently to indicate mock state

**Option C - Real API Integration** (3-4 hours):
- [ ] Connect to actual content API
- [ ] Add loading states
- [ ] Add error handling

---

### 3. TODO Comments
**Effort**: 30 minutes | **Impact**: Medium

**File**: `src/services/personalization.ts`

**Option A - Remove TODOs**:
```typescript
// Line 76: Delete or comment out
// Line 80: Delete or comment out
// Line 83: Delete or comment out
```

**Option B - Create GitHub Issues**:
- [ ] Create issue: "Implement artist affinity algorithm"
- [ ] Create issue: "Implement tag affinity scoring"
- [ ] Create issue: "Implement mood-based recommendations"
- [ ] Remove inline TODOs

---

### 4. Build Warning Fix
**Effort**: 15 minutes | **Impact**: Low

**Issue**: preferenceStore.ts mixed static/dynamic import

**File**: `src/store/playerStore.ts`

**Current (Line 428)**:
```typescript
import('./preferenceStore').then(({ usePreferenceStore }) => {
  usePreferenceStore.getState().recordReaction(currentTrack.id);
});
```

**Fix**: Change to static import
```typescript
// Top of file
import { usePreferenceStore } from './preferenceStore';

// In function
usePreferenceStore.getState().recordReaction(currentTrack.id);
```

---

### 5. Error Boundaries
**Effort**: 1 hour | **Impact**: Medium

**Create**: `src/components/ErrorBoundary.tsx`

```typescript
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('VOYO Error:', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center h-screen bg-[#0a0a0f] text-white">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-purple-500 rounded-full"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Wrap App.tsx**:
```typescript
// main.tsx
import { ErrorBoundary } from './components/ErrorBoundary';

<ErrorBoundary>
  <App />
</ErrorBoundary>
```

---

## 🟡 HIGH PRIORITY - Should Fix

### 6. Lazy Loading
**Effort**: 1 hour | **Impact**: High (30-40% bundle reduction)

**File**: `src/App.tsx`

```typescript
import { lazy, Suspense } from 'react';

// Replace static imports with:
const ClassicMode = lazy(() => import('./components/classic/ClassicMode'));
const VideoMode = lazy(() => import('./components/voyo/VideoMode'));
const DJSessionMode = lazy(() => import('./components/voyo/DJSessionMode'));
const SearchOverlayV2 = lazy(() => import('./components/search/SearchOverlayV2'));

// Wrap in Suspense
<Suspense fallback={<LoadingSpinner />}>
  <ClassicMode />
</Suspense>
```

**Create LoadingSpinner**:
- [ ] Simple purple spinner component
- [ ] Match VOYO brand style

---

### 7. TypeScript `any` Cleanup
**Effort**: 1 hour | **Impact**: Medium

**Files to Fix**:

```typescript
// src/hooks/useMobilePlay.ts:81
// BEFORE
} catch (err: any) {

// AFTER
} catch (err: unknown) {
  const error = err as Error;
```

**Create YouTube IFrame Types** (Optional):
```typescript
// src/types/youtube.d.ts
declare global {
  interface Window {
    YT: {
      Player: new (id: string, config: YTPlayerConfig) => YTPlayer;
    };
  }
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getDuration(): number;
  setVolume(volume: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
```

---

### 8. Performance - Reduce Polling
**Effort**: 15 minutes | **Impact**: Medium

**File**: `src/components/AudioPlayer.tsx`

**Line 257 - Change interval**:
```typescript
// BEFORE
const interval = setInterval(() => {
  // ... update time
}, 250);  // Every 250ms

// AFTER
const interval = setInterval(() => {
  // ... update time
}, 500);  // Every 500ms (less CPU usage)
```

---

### 9. React.memo for Pure Components
**Effort**: 2 hours | **Impact**: Medium

**Components to Wrap**:
- [ ] TrackCard components
- [ ] Button components
- [ ] Icon-only components
- [ ] SmartImage (already pure)

**Example**:
```typescript
// Before
export const TrackCard = ({ track }: Props) => { ... }

// After
export const TrackCard = React.memo(({ track }: Props) => { ... });
```

---

### 10. Accessibility Quick Wins
**Effort**: 1 hour | **Impact**: Medium

**Add aria-labels to icon buttons**:

```typescript
// Example: Search button
<button
  aria-label="Search music"
  onClick={() => setIsSearchOpen(true)}
>
  <Search className="w-5 h-5" />
</button>
```

**Files to Update**:
- [ ] `src/App.tsx` - Header buttons
- [ ] `src/components/voyo/VoyoPortraitPlayer.tsx` - Playback controls
- [ ] `src/components/player/PlaybackControls.tsx` - All buttons

---

## 🟢 NICE TO HAVE - Future Improvements

### 11. Memoize Expensive Calculations
**Effort**: 2 hours | **Impact**: Low-Medium

**File**: `src/services/personalization.ts`

```typescript
import { useMemo } from 'react';

// In component using personalized tracks:
const hotTracks = useMemo(() =>
  getPersonalizedHotTracks(5),
  [/* dependencies */]
);
```

---

### 12. Component Splitting
**Effort**: 4 hours | **Impact**: Low (maintainability)

**File**: `src/components/voyo/VoyoPortraitPlayer.tsx` (1500+ lines)

**Extract Sub-components**:
- [ ] `<FullscreenBackground />` (already separate)
- [ ] `<PlaybackControls />` (create new file)
- [ ] `<ReactionButtons />` (create new file)
- [ ] `<QueueHistory />` (create new file)
- [ ] `<DiscoveryGrid />` (create new file)

---

### 13. Bundle Size Monitoring
**Effort**: 30 minutes | **Impact**: Low

**Add to package.json**:
```json
{
  "scripts": {
    "analyze": "vite-bundle-visualizer"
  }
}
```

**Install**:
```bash
npm install -D vite-bundle-visualizer
```

---

### 14. Unit Tests (Future)
**Effort**: 8+ hours | **Impact**: Low (for demo)

**Priority Test Files**:
- [ ] `src/services/personalization.test.ts`
- [ ] `src/store/playerStore.test.ts`
- [ ] `src/utils/thumbnail.test.ts`
- [ ] Component smoke tests

---

## Estimated Total Time

| Priority | Total Tasks | Est. Time |
|----------|-------------|-----------|
| 🔴 Critical | 5 tasks | 4-6 hours |
| 🟡 High | 5 tasks | 6-8 hours |
| 🟢 Nice to Have | 4 tasks | 14+ hours |
| **TOTAL** | **14 tasks** | **24-30 hours** |

**Recommended for Demo**: Complete 🔴 Critical tasks only (4-6 hours)

---

## Quick Win Script

```bash
#!/bin/bash
# File: cleanup-quick.sh

echo "🧹 VOYO Quick Cleanup Script"

# 1. Find all console.logs
echo "📊 Console.log count:"
grep -r "console.log" src/ | wc -l

# 2. Check for TODOs
echo "📝 TODO count:"
grep -r "TODO" src/ | wc -l

# 3. Check for FIXMEs
echo "🔧 FIXME count:"
grep -r "FIXME" src/ | wc -l

# 4. Bundle size
echo "📦 Current bundle size:"
du -h dist/ | tail -1

# 5. TypeScript any types
echo "⚠️  'any' type usage:"
grep -r ": any" src/ | wc -l

echo "✅ Audit complete!"
```

**Usage**:
```bash
chmod +x cleanup-quick.sh
./cleanup-quick.sh
```

---

**Next Steps**: Start with 🔴 Critical tasks, then evaluate if demo timing allows for 🟡 High priority items.

**Generated by Z3 Code Quality Audit Agent**
