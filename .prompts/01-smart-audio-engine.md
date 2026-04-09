# VOYO Music - Smart Audio Engine Implementation

## Context
You are implementing a Spotify-beating audio playback engine for VOYO Music. This is a React + TypeScript web app that streams music via a yt-dlp backend.

## Current Architecture
- Frontend: `/home/dash/voyo-music/src/`
- Audio Player: `/home/dash/voyo-music/src/components/AudioPlayer.tsx`
- Player Store: `/home/dash/voyo-music/src/store/playerStore.ts`
- API Service: `/home/dash/voyo-music/src/services/api.ts`
- Backend: `/home/dash/voyo-music/server/index.js`

## Your Mission: Build a Spotify-Beating Prebuffer System

### Key Insights from Spotify Research:
1. **15-second initial buffer** - Request ~15 seconds of audio on track start
2. **3-second emergency threshold** - If buffer drops below 3s, enter emergency mode
3. **Prefetch next track at 50%** - Start loading next track when current is 50% played
4. **512KB chunk size** - Optimal chunk size for streaming
5. **Adaptive bitrate** - Switch quality based on network conditions

### Implementation Tasks:

#### 1. Create `/home/dash/voyo-music/src/services/audioEngine.ts`
A smart audio engine class with:
```typescript
class AudioEngine {
  // Buffer management
  private bufferTarget: number = 15; // seconds
  private emergencyThreshold: number = 3; // seconds
  private prefetchProgress: number = 50; // percent

  // Preloaded tracks cache
  private preloadCache: Map<string, ArrayBuffer>;

  // Methods:
  // - preloadTrack(trackId: string): Promise<void>
  // - getBufferHealth(): { current: number, target: number, status: 'healthy' | 'warning' | 'emergency' }
  // - estimateNetworkSpeed(): number (kbps)
  // - selectOptimalBitrate(): 'low' | 'medium' | 'high'
}
```

#### 2. Update AudioPlayer.tsx
- Integrate the new AudioEngine
- Add buffer health monitoring
- Implement adaptive bitrate switching
- Add prefetch trigger at 50% progress

#### 3. Update playerStore.ts
Add new state:
```typescript
interface PlayerState {
  // Existing...
  bufferHealth: number; // 0-100
  networkSpeed: number; // kbps estimate
  currentBitrate: 'low' | 'medium' | 'high';
  prefetchStatus: Map<string, 'pending' | 'loading' | 'ready'>;
}
```

### Quality Levels (Match Backend):
- Low: 64kbps (emergency/slow networks)
- Medium: 128kbps (default)
- High: 256kbps (fast networks)

### Success Criteria:
1. Track starts playing within 500ms (vs current ~2-3s)
2. Next track in queue is preloaded by 70% mark
3. Buffer health indicator shows real-time status
4. Graceful degradation on slow networks
5. Zero stutters on normal connections

## Files to Read First:
1. `/home/dash/voyo-music/src/components/AudioPlayer.tsx` - Current implementation
2. `/home/dash/voyo-music/src/store/playerStore.ts` - State management
3. `/home/dash/voyo-music/src/services/api.ts` - Backend API calls

## Output
Create/modify the files listed above. Test by running `npm run dev` and verifying:
- Faster track start times
- Prefetch console logs appearing at 50% progress
- Buffer health visible in player UI (optional)
