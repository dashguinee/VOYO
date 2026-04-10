# VOYO GAME PLAN - The Spotify Playbook

**Created:** December 15, 2025
**Status:** EXECUTING
**Vision:** Speed-run Spotify's 10-year evolution with the playbook already visible

---

## THE MODEL

### Free Tier
- Auto-cache (invisible, standard quality) - **unlimited**
- Boost HD - **limited** (3-5 per month)
- Library grows automatically just by listening
- User doesn't know they're building an offline library

### Premium Tier
- Auto-cache (invisible, standard quality) - **unlimited**
- Boost HD - **unlimited**
- Auto-Boost mode (always highest quality)
- Higher audio quality on all boosts
- Cloud sync (library follows you across devices)

---

## THE PSYCHOLOGY

1. User tries VOYO → listens to 20 songs
2. Comes back next week → "Wait, why is everything loading so fast?"
3. Doesn't realize they've built a 20-song offline library
4. Gets attached → "I can't lose this"
5. Hits boost limit → "Want unlimited HD? $X/month"

**The Hook:**
> "Free for life. Your library grows with you. Want the HD experience? Go Premium."

---

## EVOLUTION PHASES

### Phase 1: Local Caching (COMPLETE)
- [x] YouTube iframe for instant play
- [x] Auto-cache after 30s of playback (standard quality)
- [x] Manual Boost HD (high quality)
- [x] User's library stored on their device (IndexedDB)
- [x] Library shows cached/boosted tracks
- [x] ID normalization (VOYO ID ↔ YouTube ID)
- [x] Migration for old cached tracks

### Phase 2: Server-Side Boost
- [ ] User boosts → audio saved to VOYO CDN (S3/Google Cloud)
- [ ] Database tracks which songs are server-boosted
- [ ] Next user plays same song → streams from VOYO CDN (already HD)
- [ ] Popular songs get "community boosted"
- [ ] One person boosts, everyone benefits

### Phase 3: Pre-Boost Popular Tracks
- [ ] VOYO pre-boosts top 1000 songs
- [ ] New user's FIRST play is already HD from VOYO servers
- [ ] Premium users always get server-boosted version
- [ ] Free users get server-boosted if available, else YouTube

### Phase 4: Full Audio Control
Once audio flows through VOYO servers, unlock:
- [ ] Equalizer (bass, treble, genre presets)
- [ ] Crossfade between tracks
- [ ] Gapless playback
- [ ] Volume normalization
- [ ] Lyrics sync
- [ ] Audio visualizers
- [ ] Offline mode toggle
- [ ] Download quality settings

---

## TECHNICAL ARCHITECTURE

### Current (Phase 1)
```
User Device
├── IndexedDB (voyo-music-cache)
│   ├── audio-files (blobs)
│   └── track-meta (metadata)
├── localStorage (settings, boost count)
└── YouTube IFrame (streaming fallback)
```

### Future (Phase 2-4)
```
VOYO CDN (S3/Google Cloud)
├── /boosted/{trackId}.webm (HD audio)
├── /standard/{trackId}.webm (standard audio)
└── /metadata/{trackId}.json

VOYO API
├── GET /stream/{trackId} → Returns best available quality
├── POST /boost/{trackId} → Triggers server-side boost
└── GET /catalog/boosted → List of server-boosted tracks

User Device
├── IndexedDB (local cache)
├── Streams from VOYO CDN (priority)
└── Falls back to YouTube (if not on CDN)
```

---

## BUSINESS MODEL

### Revenue Streams
1. **Premium Subscriptions** - Unlimited boosts, auto-boost, HD always
2. **Cloud Storage Upsell** - Sync library across devices
3. **Artist Promotion** - Pay to pre-boost tracks (visibility)

### Cost Structure
- Cloud storage for boosted tracks
- CDN bandwidth for streaming
- API server costs

### Unit Economics
- Each boost = ~5MB storage
- 1000 boosts = 5GB
- At scale, popular songs amortize across all users

---

## COMPETITIVE ADVANTAGE

| Feature | Spotify | VOYO |
|---------|---------|------|
| Local caching | Hidden | Visible ("Boosted") |
| HD as premium | Yes | Yes |
| Community boost | No | Yes (Phase 2) |
| Instant play | Buffering | YouTube instant |
| Offline library | Manual | Auto-grows |

---

## EXECUTION PRIORITY

1. **NOW:** Auto-cache + Boost working (DONE)
2. **NEXT:** Boost limits for free users
3. **THEN:** Server-side boost storage
4. **LATER:** Pre-boost popular tracks
5. **FUTURE:** Full audio pipeline control

---

## NORTH STAR - Audio Quality Settings (Spotify-style)

**Current Implementation:**
- GAIN_BOOST = 1.3 (130% volume)
- BASS_FREQ = 80Hz, BASS_GAIN = +8dB (lowshelf)
- PRESENCE_FREQ = 3kHz, PRESENCE_GAIN = +3dB (peaking)
- Result: "African Bass Mode" - heavy, punchy, bass heads love it

**Problem:** Too hot for some speakers (clipping/distortion on max volume)

**Future Presets:**
| Preset | Gain | Bass | Presence | Description |
|--------|------|------|----------|-------------|
| **Balanced** | 1.1x | +3dB | +2dB | Clean, safe for all speakers |
| **Bass Boost** | 1.3x | +8dB | +3dB | Current heavy mode (Mad Bass) |
| **Studio Hi-Fi** | 1.0x | 0dB | 0dB | Flat, true to source |
| **Loud** | 1.4x | +5dB | +4dB | Spotify "Loud" equivalent |

**Implementation:**
- Add preset selector in Settings
- Store preference in localStorage
- Apply preset values to Web Audio API filters
- Default: "Balanced" (safer), let users opt into "Bass Boost"

---

## MANTRAS

- "Your library grows with you"
- "Free for life, Premium for HD"
- "One boost benefits everyone" (Phase 2)
- "Sounds better because it's already here"

---

*We cracked Spotify. Now we execute.*
