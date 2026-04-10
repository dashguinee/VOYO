# VOYO MUSIC - COMPLETE UX VISION

## App Structure Overview

```
┌─────────────────────────────────────────────────┐
│                   VOYO APP                      │
├─────────────────┬───────────────┬───────────────┤
│   🏠 HOME       │   ◉ VOYO      │   👤 PROFILE  │
│   (Classic)     │   (Player)    │   (Classic)   │
├─────────────────┼───────────────┼───────────────┤
│ • Home Feed     │ • Portrait    │ • Settings    │
│ • Library       │   Player      │ • Library     │
│ • Now Playing   │   (main)      │ • CREATOR     │
│   (classic)     │               │   MODE        │
│                 │ • Landscape   │   (TikTok-    │
│                 │   No Video    │   style)      │
│                 │               │               │
│                 │ • Landscape   │               │
│                 │   Video Mode  │               │
└─────────────────┴───────────────┴───────────────┘
```

---

## TAB 1: HOME (Classic Mode)

### Screen 1.1 - Home Feed
Reference: `Classic Mode - When clicked on profile.jpg` (Left phone)

```
┌─────────────────────────────────────┐
│ 👤 Profile   🔍 Search   🔔 Notif   │  ← Header
├─────────────────────────────────────┤
│ Hello, [Username]                   │
├─────────────────────────────────────┤
│ [All] [New Releases] [Trending] ... │  ← Category pills (scrollable)
├─────────────────────────────────────┤
│ ┌─────┐ ┌─────┐                     │
│ │ASAP │ │Kend │  🔥In Charts        │  ← Artist cards grid
│ │Rocky│ │rick │                     │    (masonry layout)
│ │132  │ │98   │                     │
│ └─────┘ └─────┘                     │
│ ┌─────┐ ┌─────┐                     │
│ │Tayl │ │Link │  🏆Gold Record      │
│ │or   │ │in   │                     │
│ └─────┘ └─────┘                     │
├─────────────────────────────────────┤
│  🏠      ◉       ⚙️                 │  ← Bottom Nav
└─────────────────────────────────────┘
```

**Features:**
- Profile avatar top-left
- Search & notifications top-right
- Horizontal scrollable category pills
- Masonry grid of artist/album cards
- Cards show: Image, Name, Song count, Badges (In Charts, Gold Record)

### Screen 1.2 - Your Library
Reference: `Classic Mode - When clicked on profile.jpg` (Middle phone)

```
┌─────────────────────────────────────┐
│ Your library                        │
├─────────────────────────────────────┤
│ 🔍  [All] [Liked] [Saved songs]     │  ← Filter tabs
├─────────────────────────────────────┤
│ 🎵 Money Trees      Kendrick   3:41 │
│ 🎵 A.D.H.D          Kendrick   3:12 │  ← Song list with duration
│ 🎵 Fashion Killa    ASAP       4:01 │
│ 🎵 GBP              Central    2:37 │
│ 🎵 Flashing Lights  Kanye      3:57 │
│ ...                                 │
├─────────────────────────────────────┤
│  🏠      ◉       ⚙️                 │
└─────────────────────────────────────┘
```

**Features:**
- Search within library
- Filter tabs: All, Liked songs, Saved songs
- Song list with thumbnail, title, artist, duration
- Tap to play, opens Classic Now Playing

### Screen 1.3 - Classic Now Playing
Reference: `Classic Mode - When clicked on profile.jpg` (Right phone)

```
┌─────────────────────────────────────┐
│ Your library      Now Playing    ❤️ │
├─────────────────────────────────────┤
│                                     │
│         ┌─────────────────┐         │
│         │                 │         │
│         │   ALBUM ART     │         │  ← Big album cover
│         │   (large)       │         │
│         │                 │         │
│         └─────────────────┘         │
│                                     │
│       Song Title                    │
│         Artist Name                 │
│                                     │
│    1:02 ────●────────── 3:57        │  ← Progress bar
│                                     │
│    🔀    ⏮    ▶    ⏭    📋        │  ← Controls
├─────────────────────────────────────┤
│  🏠      ◉       ⚙️                 │
└─────────────────────────────────────┘
```

**Features:**
- Standard music player (Spotify-style)
- Large album art
- Song title & artist
- Progress bar with timestamps
- Shuffle, Previous, Play/Pause, Next, Queue
- Heart to like

---

## TAB 2: VOYO MODE (The Main Player Experience)

### Portrait VOYO Player (PRIMARY - What we're building)
Reference: `VOYO - Portrait mode Mobile.jpg`

```
┌─────────────────────────────────────┐
│  ┌───┐ ┌───┐ ┌─────────┐ ┌───┐ +   │  ← TOP: Timeline
│  │Fre│ │All│ │ CURRENT │ │Ene│     │    Past ← Current → Queue
│  │dom│ │My │ │ Starboy │ │rge│     │    (horizontal scroll)
│  └───┘ └───┘ │ Lamar   │ └───┘     │
│              └─────────┘           │
├─────────────────────────────────────┤
│                                     │
│         ┌─────────────┐             │
│    ⏮   │  ║║  ▓▓▓▓▓  │    ⏭       │  ← MIDDLE: Neon play circle
│         │   (pause)    │            │    Purple/pink glow
│         └─────────────┘             │    Waveform animation inside
│              (purple glow)          │
├─────────────────────────────────────┤
│ [OYO⚡] [OYÉÉ] [Wazzguán] [🔥Fireee]│  ← Reaction buttons
├─────────────────────────────────────┤
│      HOT      VOYO      DISCOVERY   │  ← Section tabs
│              ─────                  │    (underline active)
├─────────────────────────────────────┤
│ ┌───┐┌───┐  ╭─────╮  ┌───┐┌───┐    │
│ │SBT││Ayo│  │VOYO │  │Any││Sug│    │  ← BOTTOM: Music DNA Mixer
│ │RN ││Jay│  │FEED │  │a  ││ge │    │    HOT | VOYO FEED | DISCOVERY
│ └───┘└───┘  ╰─────╯  └───┘└───┘    │
├─────────────────────────────────────┤
│ ┌────────────┐  ┌────────────┐      │  ← Genre cards (bottom)
│ │ SBΓRN      │  │ Amapiano   │      │
│ │ DJ Jamzy   │  │ Festgince  │      │
│ └────────────┘  └────────────┘      │
└─────────────────────────────────────┘
```

**Features:**
- **TOP Timeline**: Horizontal scroll showing past songs (left), current (center, bigger), queue (right)
- **Play Circle**: Neon purple/pink glowing circle with pause icon and waveform
- **Skip Buttons**: Previous/Next on sides of circle
- **Reaction Buttons**: OYO⚡, OYÉÉ, Wazzguán, 🔥Fireee (tap to send reactions)
- **Section Tabs**: HOT | VOYO | DISCOVERY (VOYO underlined when active)
- **Music DNA Mixer**:
  - HOT cards (left) - Songs you love, from library
  - VOYO FEED circle (center) - AI recommendations, tap to enter feed
  - DISCOVERY cards (right) - New suggestions
- **Genre Cards**: Filter by genre at bottom

**Gestures:**
- Scroll timeline horizontally
- Tap card to play
- Swipe HOT left for more
- Swipe DISCOVERY right for more
- Drag any card to center = play now
- Drag up = add to queue
- Long press = OYÉ reaction

### Landscape VOYO (No Video)
Reference: `Voyo No Video - V2 Lanscape.jpg`
**Trigger**: Rotate phone to landscape

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ┌─────┐┌─────┐     ┌───────────────┐      ┌─────┐        🔊              │
│ │Free ││All  │     │   Starboy     │      │Ener │   +                   │  ← TOP: Past | Current | Queue
│ │dom  ││My   │     │   Lamar Scott │      │getic│                       │
│ └─────┘└─────┘     └───────────────┘      └─────┘                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                        ┌─────────────┐                                   │
│              ⏪        │     ║║      │        ⏩                          │  ← Big play circle
│                        └─────────────┘                                   │
│                          (neon glow)                                     │
│                                                                          │
│         [OYÉ⚡]                              [Wazzguán] [🔥Fireee]        │  ← Reactions (split sides)
├──────────────────────────────────────────────────────────────────────────┤
│   HOT                    VOYO                      DISCOVERY             │
│ ┌───┐┌───┐┌───┐┌───┐   ╭─────╮    ┌───┐┌───┐    ┌───┐┌───┐             │  ← Horizontal card rows
│ │SBT││Ayo││   ││   │   │VOYO │    │Any││Sug│    │Waz││Fes│             │
│ └───┘└───┘└───┘└───┘   ╰─────╯    └───┘└───┘    └───┘└───┘             │
└──────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Same as Portrait but wider layout
- More cards visible horizontally
- Reactions split to left and right sides
- More breathing room for everything

### Landscape VOYO (Video Mode)
Reference: `Livre reactiosn example.jpg` for floating reactions
**Trigger**: Triple-tap center circle

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                                                      ❤️  👍              │
│                                                   ✨                     │
│                         FULL SCREEN VIDEO              🔥                │
│                                                     ❤️                   │
│                           Starboy                        👏              │
│                        Lamar Scott                  ❤️                   │
│                                                  ✨     ❤️               │
│   ╭───╮                                                       ╭───╮     │
│   │ ◀ │                                                       │ ▶ │     │  ← Overlay controls
│   ╰───╯              ┌─────────┐                              ╰───╯     │    (fade after 2s)
│                      │   ║║    │                                        │
│                      └─────────┘                                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Full screen video/visualizer
- Overlay controls fade after 2 seconds
- Left overlay = Previous
- Right overlay = Next
- Center overlay = Play/Pause
- Floating reactions (hearts, fire, thumbs up, etc.) rise up like TikTok Live
- Tap screen to show controls
- Triple-tap to exit back to Landscape No Video

**Gestures:**
- Swipe up = Next video
- Swipe down = Previous video
- Double-tap = Send OYÉ reaction (triggers reaction storm)
- Triple-tap = Exit video mode
- Tap = Show/hide overlays

---

## TAB 3: PROFILE (Settings + Creator Mode)

### Settings & Library
Standard profile settings, playlists, liked songs, etc.

### Creator Mode
Reference: `Lanscape Polished - Creator Mode.jpg`
**Location**: Inside Profile tab, NOT the VOYO player

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ┌─────┐           ┌───────┐ ┌───────┐           ┌─────┐                  │
│ │Free │           │Starboy│ │       │           │Ener │   +              │  ← Timeline (for video)
│ │dom  │           │L.Scott│ │       │           │getic│                  │
│ └─────┘           └───────┘ └───────┘           └─────┘                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ╭○╮                                                          ╭○╮      │
│  ╭○╯               ┌─────────────────┐                          ╰○╮     │
│ ╭○╯                │                 │                            ╰○╮   │  ← Roulettes curve OUTWARD
│○╯                  │  YOUR VIDEO     │                              ╰○  │
│                    │  (replace with  │                                  │
│                    │   your content) │                                  │
│○╮                  │                 │                              ╭○  │
│ ╰○╮                └─────────────────┘                            ╭○╯   │
│  ╰○╮                                                            ╭○╯     │
│   ╰○╯                    ╭───╮                                  ╰○╯      │
│                          │ ● │                                          │
│    MAGENTA               ╰───╯                              BLUE        │
│    (HOT songs)                                         (DISCOVERY)      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Purpose**: Content CREATION, not consumption
- User uploads/records their own video
- Drops songs from roulettes onto their video
- Creates reaction videos
- TikTok-style feed of user-created content
- Share vibes with the community

**Key Difference from Player Mode:**
- Same roulette UI but for CREATING content
- Center is YOUR video, not streamed content
- Drag songs TO your video to add soundtrack
- NOT for listening - for MAKING

---

## Roulette Design (IMPORTANT)

Reference: `Player mode - Inwards (SHould be outwards...stupid Chatgpt).jpg`

**CURVES MUST BE OUTWARD** (away from center, not inward):

```
       HOT (Magenta/Pink)                      DISCOVERY (Blue/Cyan)
       curves OUT ←                                    → curves OUT

            ╭○╮                                          ╭○╮
          ╭○╯                                              ╰○╮
        ╭○╯                                                  ╰○╮
      ╭○╯                                                      ╰○╮
     ○╯            ┌─────────────────┐                          ╰○
                   │                 │
                   │   CURRENT SONG  │
                   │   (or VIDEO)    │
                   │                 │
                   └─────────────────┘
     ○╮                                                          ╭○
      ╰○╮                                                      ╭○╯
        ╰○╮                                                  ╭○╯
          ╰○╮                                              ╭○╯
            ╰○╯                                          ╰○╯
```

- Left roulette: Magenta/pink glow, curves outward to the LEFT
- Right roulette: Blue/cyan glow, curves outward to the RIGHT
- Circles contain artist faces/album art
- Scroll vertically to browse
- Drag to center = action (play or add to video)

---

## Live Reactions System

Reference: `Reactions.gif`, `reactions.webp`, `Livre reactiosn example.jpg`

**Floating Reactions:**
- Hearts ❤️
- Thumbs up 👍
- Fire 🔥
- Clapping hands 👏
- Sparkles ✨
- Emojis float upward like bubbles
- Appear when users tap reaction buttons
- In Video Mode: reaction storm on double-tap

**OYÉ Reaction Buttons:**
- OYO⚡ - Quick appreciation
- OYÉÉ - Strong appreciation
- Wazzguán - "What's good" / vibe check
- 🔥Fireee - This is fire!

---

## Color Scheme

- **Background**: Deep dark (#0a0a0f to #1a1a2e)
- **Primary Accent**: Purple/Magenta gradient (#a855f7 to #ec4899)
- **Secondary Accent**: Cyan/Blue (#06b6d4 to #3b82f6)
- **HOT Color**: Red/Magenta (#ef4444 to #ec4899)
- **DISCOVERY Color**: Blue/Cyan (#3b82f6 to #06b6d4)
- **Text**: White with opacity variations
- **Glow Effects**: Neon purple/pink/blue

---

## Gesture Summary

| Screen | Gesture | Action |
|--------|---------|--------|
| Portrait VOYO | Tap timeline card | Jump to that song |
| Portrait VOYO | Scroll timeline | Browse past/queue |
| Portrait VOYO | Tap play circle | Play/Pause |
| Portrait VOYO | Tap reaction btn | Send reaction |
| Portrait VOYO | Swipe HOT left | More HOT songs |
| Portrait VOYO | Swipe DISCOVERY right | More discoveries |
| Portrait VOYO | Drag card to center | Play immediately |
| Portrait VOYO | Drag card up | Add to queue |
| Portrait VOYO | Long press card | OYÉ reaction menu |
| Portrait VOYO | Tap VOYO FEED | Enter feed |
| Landscape | Same as portrait + more space |
| Landscape | Triple-tap center | Enter Video Mode |
| Video Mode | Tap | Show/hide overlays |
| Video Mode | Double-tap | Reaction storm |
| Video Mode | Swipe up | Next video |
| Video Mode | Swipe down | Previous video |
| Video Mode | Triple-tap | Exit to Landscape |
| Creator Mode | Drag song to center | Add to your video |

---

## Build Priority

1. **Portrait VOYO Mode** (current focus) - Refine what we have
2. **Classic Mode** (Home/Library/Now Playing) - Standard app foundation
3. **Landscape No Video** - Responsive layout
4. **Landscape Video Mode** - Full immersion
5. **Creator Mode** - Content creation (future)

---

## File References

- `VOYO - Portrait mode Mobile.jpg` - Portrait VOYO player
- `Classic Mode - When clicked on profile.jpg` - Classic mode screens
- `Voyo No Video - V2 Lanscape.jpg` - Landscape no video
- `Voyo Mix Mode Landscape - No Video Background.jpg` - Alt landscape
- `Concept (just concept).jpg` - Roulette concept (DNA style)
- `Player mode - Inwards...jpg` - Roulette curves (should be OUTWARD)
- `Lanscape Polished - Creator Mode.jpg` - Creator mode
- `Livre reactiosn example.jpg` - Live floating reactions
- `Reactions.gif` / `reactions.webp` - Reaction animations

---

*Last Updated: December 4, 2025*
*Vision Document for VOYO Music by DASUPERHUB*
