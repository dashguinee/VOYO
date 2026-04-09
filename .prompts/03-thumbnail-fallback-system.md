# VOYO Music - Robust Thumbnail Fallback System

## Context
You are implementing a bulletproof thumbnail system for VOYO Music that NEVER shows broken images. This handles cases where YouTube thumbnails fail to load.

## Current Architecture
- Thumbnail Helper: `/home/dash/voyo-music/src/data/tracks.ts` (getThumbnailUrl, getThumbnailWithFallback)
- Components using thumbnails: Various in `/home/dash/voyo-music/src/components/`

## Your Mission: Zero Broken Thumbnails

### Implementation Tasks:

#### 1. Create `/home/dash/voyo-music/src/components/ui/SmartImage.tsx`
A React component that handles all image loading with fallbacks:

```typescript
interface SmartImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackSrc?: string;
  placeholderColor?: string;
  trackId?: string; // For YouTube thumbnail fallback chain
}

const SmartImage: React.FC<SmartImageProps> = ({
  src,
  alt,
  className,
  fallbackSrc,
  placeholderColor = '#1a1a1a',
  trackId
}) => {
  // States: loading, loaded, error
  // If trackId provided, try fallback chain:
  // 1. maxresdefault.jpg
  // 2. hqdefault.jpg
  // 3. mqdefault.jpg
  // 4. default.jpg
  // 5. Generated placeholder (gradient with first letter)

  // Features:
  // - Skeleton loading animation
  // - Smooth fade-in on load
  // - Error boundary with graceful fallback
  // - Intersection Observer for lazy loading
};
```

#### 2. Create `/home/dash/voyo-music/src/utils/imageUtils.ts`
```typescript
// YouTube thumbnail quality chain
export const THUMBNAIL_QUALITIES = ['maxresdefault', 'hqdefault', 'mqdefault', 'default'] as const;

// Generate thumbnail URL with specific quality
export const getYouTubeThumbnail = (trackId: string, quality: typeof THUMBNAIL_QUALITIES[number]) => {
  return `https://i.ytimg.com/vi/${trackId}/${quality}.jpg`;
};

// Get all possible thumbnail URLs for a track
export const getThumbnailFallbackChain = (trackId: string): string[] => {
  return THUMBNAIL_QUALITIES.map(q => getYouTubeThumbnail(trackId, q));
};

// Generate placeholder with gradient and initial
export const generatePlaceholder = (title: string, size: number = 200): string => {
  // Return a data URL for an SVG/canvas placeholder
  // Gradient background based on title hash
  // First letter of title centered
};

// Preload an image
export const preloadImage = (src: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
};

// Find first working thumbnail from chain
export const findWorkingThumbnail = async (trackId: string): Promise<string | null> => {
  for (const quality of THUMBNAIL_QUALITIES) {
    const url = getYouTubeThumbnail(trackId, quality);
    if (await preloadImage(url)) {
      return url;
    }
  }
  return null;
};
```

#### 3. Create a Thumbnail Cache Hook
`/home/dash/voyo-music/src/hooks/useThumbnailCache.ts`
```typescript
// Cache verified working thumbnails in localStorage
// Key: trackId -> Value: { url: string, quality: string, verified: timestamp }
// Auto-expire after 24 hours
```

#### 4. Update Components to Use SmartImage
Replace all `<img>` tags showing track artwork with `<SmartImage>`:
- Track cards
- Queue items
- Now playing display
- Playlist covers
- Search results

### Success Criteria:
1. No broken image icons EVER
2. Smooth skeleton loading animation
3. Graceful fallback to generated placeholder
4. Cached thumbnails load instantly
5. Lazy loading for off-screen images

## Files to Read First:
1. `/home/dash/voyo-music/src/data/tracks.ts` - Current thumbnail helpers
2. `/home/dash/voyo-music/src/components/voyo/VoyoPortraitPlayer.tsx` - Example component using images
3. `/home/dash/voyo-music/src/components/voyo/LandscapeVOYO.tsx` - Another component with images

## Output
Create the SmartImage component and utils, then update 2-3 key components to use it as a proof of concept.
