# VOYO Release Roadmap

## Current Status: December 2025

---

## The VOYO Soul

**VOYO = African Putomayo + Spotify + Collective Intelligence**

What makes VOYO different from Spotify:
1. **Dash's DNA** - Curated African essence as the foundation (not algorithm-first)
2. **African DJ Originals** - Putomayo-style curated playlists from Africa
3. **Community Vibes** - Users create playlists that grow organically
4. **Collective Intelligence** - Every user makes it smarter for everyone
5. **Transparent Algorithm** - MixBoard shows what's influencing your feed

### The Three Sources (ALWAYS BLEND)
```
Feed = Seed Essence + Gemini Discovery + Collective Heat
       (Dash DNA)    (Fresh finds)      (What's working)
```

**Gemini NEVER stops.** It keeps discovering. DB just prevents redundant verification.

---

## Pages Status

| Page | Status | Notes |
|------|--------|-------|
| **Player Page** | ✅ DONE | Smart DJ working, MixBoard, reactions, flywheel |
| **Feed Page** | 🟡 BASIC | TikTok-style scroll, needs polish |
| **Home Page** | 🔴 NEXT | MixBoard connections, vibes selector |
| **DashHub** | 🔴 TODO | After home page |
| **Login (Portals)** | 🔴 LAST | Authentication system |

---

## Open Questions: Vibes System

### The Core Question
> "The vibes mixboard - it's basically playlists added from the home screen. Is that logic set yet?"

### Current State
- MixBoard has 6 hardcoded modes: `afro-heat`, `chill-vibes`, `party-mode`, `late-night`, `workout`, `random-mixer`
- These are stored in `voyo_vibes` Supabase table
- Tracks get vibe scores trained by user actions

### Proposed Evolution

#### 1. User-Created Vibes
```
Can users CREATE their own vibes?
├── Personal vibes (private) → Only you see them
└── Public vibes → Community can search/follow
```

#### 2. Community Vibes Discovery
```
Where do vibes appear?
├── Home Screen → Vibes selector (current MixBoard location)
├── Search → Under "Albums" section, add "Vibes" section
└── Player → Quick-add to vibe from reaction bar
```

#### 3. Smart Vibe Surfacing
```
How do we show relevant vibes?
├── Your activity → Vibes you interact with most
├── Community heat → Most followed/active vibes
├── Pattern matching → "Users like you follow these vibes"
└── Time-based → "Popular right now" / "Late night vibes"
```

### Database Changes Needed

```sql
-- Add to voyo_vibes table:
ALTER TABLE voyo_vibes ADD COLUMN IF NOT EXISTS
  created_by_user TEXT,           -- NULL = system, else user_hash
  is_public BOOLEAN DEFAULT false,
  follower_count INTEGER DEFAULT 0,
  track_count INTEGER DEFAULT 0,
  last_active TIMESTAMPTZ;

-- New table: user_vibe_follows
CREATE TABLE IF NOT EXISTS voyo_vibe_follows (
  user_hash TEXT NOT NULL,
  vibe_id UUID REFERENCES voyo_vibes(id),
  followed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_hash, vibe_id)
);
```

### UX Flow (Proposed)

```
HOME SCREEN
├── [Your Vibes] ← Vibes you follow/created
│   ├── Afro Heat (system)
│   ├── My Workout Mix (yours)
│   └── Lagos Nights (community, you follow)
│
├── [Trending Vibes] ← Community hot right now
│   ├── Amapiano 2025 (1.2k followers)
│   └── Christmas Afro (seasonal)
│
└── [Create Vibe] button
    └── Opens vibe creator
        ├── Name
        ├── Public/Private toggle
        └── Initial tracks (optional)

SEARCH
├── Songs
├── Artists
├── Albums
└── [Vibes] ← NEW
    └── Search community vibes
```

---

## The Flywheel Extension

Current flywheel: Tracks get smarter from collective use
Extended flywheel: **Vibes get smarter from collective curation**

```
User creates "Late Night Lagos" vibe
    ↓
Adds tracks, others follow
    ↓
System learns: these tracks = late-night + lagos
    ↓
Auto-suggests similar tracks to vibe
    ↓
Vibe grows organically
    ↓
Other users discover it
    ↓
THE VIBE BECOMES ALIVE
```

---

## Implementation Order

### Phase 1: Home Page (NEXT)
- [ ] Vibes selector component
- [ ] Connect to existing MixBoard modes
- [ ] "Your Vibes" section

### Phase 2: Community Vibes
- [ ] Create vibe flow
- [ ] Public/private toggle
- [ ] Follow/unfollow vibes
- [ ] Vibes in search

### Phase 3: Smart Surfacing
- [ ] Trending vibes algorithm
- [ ] Personalized vibe recommendations
- [ ] Auto-suggest tracks to vibes

### Phase 4: DashHub
- [ ] Creator dashboard
- [ ] Vibe analytics
- [ ] Content management

### Phase 5: Portals (Login)
- [ ] Auth system
- [ ] User profiles
- [ ] Cross-device sync

---

## Differentiation Points

What makes VOYO different:

1. **Transparent Algorithm** - MixBoard shows what's influencing your feed
2. **Collective Intelligence** - Every user makes it smarter for everyone
3. **Community Vibes** - Playlists that grow organically, not just curated
4. **African-First** - Built for Afrobeats, Amapiano, not retrofitted

---

*Last Updated: December 24, 2025*
