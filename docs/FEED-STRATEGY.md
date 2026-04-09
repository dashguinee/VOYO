# VOYO Feed Strategy - Video Teaser Formats

## The Problem
- Full HD/4K videos = high bandwidth = slow load = bad UX
- Full song length = users skip anyway
- No "hook" = less engagement

## The Solution: 5 Teaser Formats

### Format 1: HOOK CLIP (30 seconds @ 360p)
**Best for: Discovery feed**
```
- Start: 30 seconds into song (skip intro)
- Duration: 30 seconds (the hook)
- Resolution: 360p (vq=medium)
- Bandwidth: ~2-4MB per clip
```
YouTube params: `start=30&end=60`

### Format 2: INSTANT PREVIEW (15 seconds @ 240p)
**Best for: Search results, quick browse**
```
- Start: 45 seconds (chorus)
- Duration: 15 seconds
- Resolution: 240p (vq=small)
- Bandwidth: ~500KB-1MB
```
YouTube params: `start=45&end=60`

### Format 3: THUMBNAIL + AUDIO
**Best for: Data saver mode, slow connections**
```
- Video: Static thumbnail with subtle animation
- Audio: Full quality from YouTube (audio-only would need backend)
- Bandwidth: Audio only (~128kbps)
```
No video iframe, just AnimatedArtCard

### Format 4: FULL VIDEO (current)
**Best for: Wi-Fi users, engaged listeners**
```
- Start: 0 (beginning)
- Duration: Full song
- Resolution: Auto (YouTube decides)
```
No params - current behavior

### Format 5: ADAPTIVE (Smart Selection)
**Best for: Production**
```
- Detect: navigator.connection.effectiveType
- 4g/wifi → Format 4 (Full)
- 3g → Format 1 (Hook Clip)
- 2g/slow-2g → Format 3 (Thumbnail + Audio)
```

## Implementation Priority

1. **Format 1 (Hook Clip)** - Biggest impact, easy to implement
2. **Format 5 (Adaptive)** - Smart default selection
3. **Format 3 (Thumbnail + Audio)** - Data saver fallback

## YouTube Embed Params

```typescript
// Resolution control (via JS API after load)
iframe.contentWindow?.postMessage(
  '{"event":"command","func":"setPlaybackQuality","args":["medium"]}',
  '*'
);

// Time control (via URL params)
const params = {
  start: 30,  // Start at 30 seconds
  end: 60,    // End at 60 seconds
  // ... other params
};
```

## Quality Levels
- `small` = 240p
- `medium` = 360p
- `large` = 480p
- `hd720` = 720p
- `hd1080` = 1080p

## Audio Extraction Strategy

For pure audio (Format 3), options:
1. **Current**: YouTube iframe with video hidden → still loads video
2. **Better**: Backend audio-only stream endpoint
3. **Best**: YouTube Music API (requires auth)

For now, Format 3 uses AnimatedArtCard + YouTube iframe (muted video, audio plays).

---

*Created: December 24, 2024*
