# VOYO Recovery Checkpoint - Dec 26, 2025

## GIT STATE
- **Production (Vercel)**: `df18576` - WORKS
- **Local main**: `b8cd226` - BROKEN (2 commits ahead)
- **Origin**: `origin/main` at `df18576`

## COMMITS TO ANALYZE
```
b8cd226 fix(AudioPlayer): Aggressive background playback protection  <- BROKEN?
4d772bc feat(VOYO): Intelligent feed algorithm + background playback  <- BROKEN?
df18576 feat(VOYO Verse): Complete background playback + QR friend invites <- WORKS
```

## WHAT WAS CHANGED

### Commit 4d772bc (Agent Work)
Files modified:
- `src/components/AudioPlayer.tsx` - Added visibility handler, wake lock, media session improvements
- `src/components/voyo/feed/VoyoVerticalFeed.tsx` - Added feed treatment fields
- `public/service-worker.js` - Added audio caching

Files created:
- `src/services/feedAlgorithm.ts` - Feed algorithm service
- `src/types/feed.ts` - Feed types
- `.checkpoints/*` - Documentation

### Commit b8cd226 (Background Fix)
- `src/components/AudioPlayer.tsx` - Fixed visibility handler, added onPause interceptor, playsInline

## THE GOAL
Fix background playback so music NEVER stops when app minimized.

## KEY CODE CHANGES

### 1. Visibility Handler (AudioPlayer.tsx ~line 205)
```typescript
useEffect(() => {
  const handleVisibilityChange = () => {
    const { isPlaying: shouldBePlaying } = usePlayerStore.getState();
    if (document.visibilityState === 'hidden') {
      if (playbackMode === 'cached' && audioRef.current && shouldBePlaying) {
        if (audioContextRef.current?.state === 'suspended') {
          audioContextRef.current.resume();
        }
        audioRef.current.play().catch(() => {});
      }
    } else if (document.visibilityState === 'visible') {
      if (audioRef.current && shouldBePlaying) {
        if (audioContextRef.current?.state === 'suspended') {
          audioContextRef.current.resume();
        }
        if (audioRef.current.paused) {
          audioRef.current.play().catch(() => {});
        }
      }
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, [playbackMode]);
```

### 2. Wake Lock (AudioPlayer.tsx ~line 246)
```typescript
useEffect(() => {
  const requestWakeLock = async () => {
    if (!isPlaying) {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      return;
    }
    if ('wakeLock' in navigator) {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
    }
  };
  requestWakeLock();
  return () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
    }
  };
}, [isPlaying]);
```

### 3. onPause Interceptor (audio element)
```typescript
<audio
  ref={audioRef}
  preload="auto"
  playsInline
  onPause={() => {
    const { isPlaying: shouldBePlaying } = usePlayerStore.getState();
    if (shouldBePlaying && audioRef.current) {
      setTimeout(() => {
        if (audioRef.current && usePlayerStore.getState().isPlaying) {
          audioRef.current.play().catch(() => {});
        }
      }, 100);
    }
  }}
  ...
/>
```

### 4. Feed Algorithm Import (VoyoVerticalFeed.tsx)
```typescript
import { applyTreatment, getStartTime, getDuration } from '../../../services/feedAlgorithm';
```

## RECOVERY COMMANDS

### Reset to working production version:
```bash
git checkout df18576
npm run dev
```

### Go back to main with my changes:
```bash
git checkout main
npm run dev
```

### Create a safe branch with my work:
```bash
git checkout -b background-playback-fix
```

### Revert my changes but keep them saved:
```bash
git checkout main
git branch background-playback-backup  # Save my work
git reset --hard df18576              # Reset to production
```

## NEXT STEPS
1. Bisect: Test 4d772bc alone (without b8cd226)
2. If 4d772bc works, issue is in b8cd226
3. If 4d772bc broken, issue is in that commit
4. Find exact breaking change
5. Fix and recommit cleanly
