# Z4 MISSION: Add Scroll Functionality to ALL 4 Corners

## WHO YOU ARE
You are Z4, a UX engineer on the VOYO Music team. You understand that EXPLORATION is key to music discovery. Users need to be able to scroll through their history, queue, hot tracks, and discoveries. Without scroll, they're stuck seeing only a few items. Your job is to make every corner scrollable and explorable.

## THE VISION (WHY)
The VOYO player has 4 content zones (corners):
- **TOP LEFT**: History - tracks user has played
- **TOP RIGHT**: Queue - upcoming tracks
- **BOTTOM LEFT**: HOT - user's heavy rotation
- **BOTTOM RIGHT**: DISCOVERY - new recommendations

Currently:
- TOP LEFT shows only 2 cards (no scroll)
- TOP RIGHT shows only 2 cards + add button (no scroll)
- BOTTOM LEFT/RIGHT have PortalBelt with auto-scroll and drag

We need consistent scroll behavior across ALL corners so users can explore their full music library.

## THE CODEBASE CONTEXT

### Current Structure (VoyoPortraitPlayer.tsx)

**TOP SECTION (lines ~1744-1789):**
```jsx
{/* Left: History (played tracks) */}
<div className="flex gap-3">
  {historyTracks.slice(0, 2).map((track, i) => (
    <SmallCard ... />
  ))}
</div>

{/* Right: Queue + Add */}
<div className="flex gap-3">
  {queueTracks.map((track, i) => (
    <SmallCard ... />
  ))}
  <button>+</button>
</div>
```

**BOTTOM SECTION (lines ~1952-2018):**
```jsx
{/* HOT Zone */}
<PortalBelt tracks={hotTracks} type="hot" ... />

{/* DISCOVERY Zone */}
<PortalBelt tracks={discoverTracks} type="discovery" ... />
```

### PortalBelt Component (lines ~603-800)
Already has:
- Auto-scroll animation (watch dial style)
- Drag-to-pause functionality
- Manual scroll with mouse/touch handlers
- `handleDragEnd`, `handleMouseDown`, `handleMouseMove`, `handleTouchStart`, etc.

## THE TASK (WHAT)

### Step 1: Make History Corner Scrollable

Replace the static `flex gap-3` with a horizontally scrollable container:

```jsx
{/* Left: History - Scrollable */}
<div
  className="flex gap-3 overflow-x-auto scrollbar-hide max-w-[50%]"
  style={{ scrollSnapType: 'x mandatory' }}
>
  {historyTracks.length > 0 ? (
    historyTracks.slice(0, 10).map((track, i) => (  // Show more tracks
      <div key={track.id + i} style={{ scrollSnapAlign: 'start' }}>
        <SmallCard
          track={track}
          onTap={() => setCurrentTrack(track)}
          isPlayed={true}
        />
      </div>
    ))
  ) : (
    <>
      <DashPlaceholder onClick={onSearch} label="history" />
      <DashPlaceholder onClick={onSearch} label="history" />
    </>
  )}
</div>
```

### Step 2: Make Queue Corner Scrollable

Same pattern for queue:

```jsx
{/* Right: Queue - Scrollable */}
<div
  className="flex gap-3 overflow-x-auto scrollbar-hide max-w-[50%] flex-row-reverse"
  style={{ scrollSnapType: 'x mandatory' }}
>
  {/* Add button always visible at end */}
  <button
    onClick={onSearch}
    className="flex-shrink-0 w-[70px] h-[70px] rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
  >
    <Plus size={24} className="text-gray-500" />
  </button>

  {queueTracks.length > 0 ? (
    queueTracks.slice(0, 10).map((track, i) => (  // Show more tracks
      <div key={track.id + i} style={{ scrollSnapAlign: 'start' }}>
        <SmallCard
          track={track}
          onTap={() => setCurrentTrack(track)}
          isPlayed={playedTrackIds.has(track.id)}
        />
      </div>
    ))
  ) : (
    <DashPlaceholder onClick={onSearch} label="queue" />
  )}
</div>
```

### Step 3: Add Visual Scroll Indicators

Add subtle gradient fades to show there's more content:

```jsx
{/* History with scroll fade */}
<div className="relative max-w-[50%]">
  {/* Scroll fade indicator - right edge */}
  {historyTracks.length > 2 && (
    <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#0a0a0f] to-transparent pointer-events-none z-10" />
  )}

  <div className="flex gap-3 overflow-x-auto scrollbar-hide pr-8" ...>
    {/* cards */}
  </div>
</div>
```

### Step 4: Add Swipe Gesture Hints (Optional Enhancement)

For new users, briefly show a swipe hint animation:

```jsx
// Small arrow hint that fades after first interaction
const [showScrollHint, setShowScrollHint] = useState(true);

useEffect(() => {
  const timer = setTimeout(() => setShowScrollHint(false), 3000);
  return () => clearTimeout(timer);
}, []);

{showScrollHint && historyTracks.length > 2 && (
  <motion.div
    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30"
    animate={{ x: [0, 5, 0] }}
    transition={{ duration: 1, repeat: Infinity }}
  >
    →
  </motion.div>
)}
```

### Step 5: Verify Bottom Belts Still Work

The PortalBelt component already has:
- `onMouseDown`, `onMouseMove`, `onMouseUp` for mouse drag
- `onTouchStart`, `onTouchMove`, `onTouchEnd` for touch drag
- `handleDragEnd` with 2-second pause after drag

Verify these are working correctly. If not, check:
1. Event handlers are attached to the container
2. `isDragging` ref is being set/cleared properly
3. `isPaused` state is toggling scroll

### Step 6: Consistent Scroll Behavior

All 4 corners should have:
- Horizontal scroll (left-right)
- Touch-friendly (swipe gesture)
- Visual feedback (momentum, snap)
- Optional: scroll fade indicators

## HOW TO VERIFY (SELF-ASSESSMENT)

1. **History scroll**: Can swipe left-right to see more history tracks
2. **Queue scroll**: Can swipe left-right to see full queue
3. **HOT belt**: Drag pauses auto-scroll, can manually position
4. **DISCOVERY belt**: Same as HOT
5. **Visual feedback**: Fades show when there's more content
6. **Mobile test**: Touch scroll works smoothly on mobile

## TECHNICAL CONSTRAINTS

- Use Tailwind's `overflow-x-auto` and `scrollbar-hide` (already defined in CSS)
- Use CSS `scroll-snap-type` for smooth snapping
- Don't break the existing PortalBelt functionality
- Keep z-index hierarchy intact (TOP section is z-20, BOTTOM is z-40)
- Maintain touch targets of at least 44px for mobile

## CSS UTILITIES AVAILABLE

```css
/* Already in index.css or can add */
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
```

## OUTPUT REQUIREMENTS

1. Updated TOP SECTION with scrollable History and Queue
2. Scroll fade indicators for content overflow
3. Verification that BOTTOM belts still work correctly
4. Summary of changes made
5. Test results on mobile viewport

## GO TIME

You're giving users the power to explore their music. Every swipe should feel smooth and responsive. The corners should invite interaction - users should WANT to scroll and discover what's there.

Make exploration feel natural.
