# PlaybackControls - Quick Integration Guide

## Import the Component

```tsx
import { PlaybackControls } from './components/player';
```

## Option 1: Add to Existing Player UI

If you have an existing player component (like `AudioPlayer.tsx`), add the controls:

```tsx
// Inside your player component
<div className="player-bottom-section">
  {/* Your existing play/pause/skip buttons */}
  <div className="main-controls">
    {/* ... */}
  </div>

  {/* Add playback controls */}
  <PlaybackControls compact />
</div>
```

## Option 2: Bottom Bar Layout

```tsx
<div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-xl">
  <div className="flex items-center justify-between p-4">
    {/* Track info */}
    <div className="flex-1">
      <TrackInfo />
    </div>

    {/* Playback controls */}
    <PlaybackControls compact />

    {/* Additional actions */}
    <div className="flex-1 flex justify-end gap-3">
      <QueueButton />
      <LyricsButton />
    </div>
  </div>
</div>
```

## Option 3: Sidebar Player

```tsx
<div className="player-sidebar">
  {/* Album art */}
  <div className="album-art">
    {/* ... */}
  </div>

  {/* Track info */}
  <div className="track-info">
    {/* ... */}
  </div>

  {/* Playback controls - full mode with labels */}
  <PlaybackControls />

  {/* Progress bar */}
  <ProgressBar />
</div>
```

## Usage with Store

The component automatically connects to the player store. You can also access the state directly:

```tsx
import { usePlayerStore } from './store/playerStore';

function MyComponent() {
  const { shuffleMode, repeatMode, volume } = usePlayerStore();

  // Display current modes
  console.log('Shuffle:', shuffleMode);
  console.log('Repeat:', repeatMode);
  console.log('Volume:', volume);

  return <PlaybackControls />;
}
```

## Customization Examples

### Custom Colors
```tsx
<PlaybackControls
  className="[&_button]:text-blue-500 [&_button.active]:text-blue-600"
/>
```

### Larger Icons
```tsx
// Modify the component or wrap it:
<div className="scale-125">
  <PlaybackControls compact />
</div>
```

### Custom Layout
```tsx
<div className="flex flex-col gap-2">
  <PlaybackControls compact />
  <div className="text-xs text-center text-gray-400">
    {shuffleMode && '🎲 Shuffle On'}
    {repeatMode === 'one' && '🔂 Repeat One'}
    {repeatMode === 'all' && '🔁 Repeat All'}
  </div>
</div>
```

## Testing the Features

### Test Shuffle
1. Click the shuffle button
2. Watch for the spinning animation
3. Skip to next track - should pick random
4. Toggle off - should return to normal

### Test Repeat Modes
1. Click repeat button (OFF → ALL)
2. Click again (ALL → ONE)
3. Click again (ONE → OFF)
4. With repeat ONE: track should restart
5. With repeat ALL: queue should restart from beginning

### Test Volume
1. Drag the slider left/right
2. Click anywhere on the bar
3. Click volume icon to mute
4. Click again to unmute (returns to previous level)

## Troubleshooting

### Controls Not Showing
- Check import path
- Verify component is rendered
- Check parent container overflow/display

### State Not Updating
- Verify playerStore is imported correctly
- Check browser console for errors
- Ensure Zustand is installed

### Animations Not Working
- Check if CSS animation is loaded
- Verify browser supports CSS animations
- Clear cache and rebuild

## Performance Notes

- Component uses React hooks efficiently
- Volume slider updates are throttled for smooth performance
- Animations use CSS transforms (GPU accelerated)
- No unnecessary re-renders

## Next Steps

1. Add to your main player component
2. Test all three features
3. Customize styling to match your theme
4. Consider adding keyboard shortcuts (space for play/pause, S for shuffle, R for repeat)
5. Add persistence (save shuffle/repeat/volume to localStorage)

## File Locations

- Component: `/home/dash/voyo-music/src/components/player/PlaybackControls.tsx`
- Store: `/home/dash/voyo-music/src/store/playerStore.ts`
- Examples: `/home/dash/voyo-music/src/components/player/PlaybackControls.example.tsx`
- Documentation: `/home/dash/voyo-music/PLAYBACK_CONTROLS.md`
