# VOYO Music — Architecture Documentation

## Overview

VOYO Music is an African music streaming PWA built for markets with unreliable connectivity, limited device power, and price-sensitive users. It streams audio extracted from YouTube via a multi-tier pipeline, applies professional-grade audio enhancement client-side, and progressively caches tracks to R2 for the collective user base. Every listen makes the system faster for the next user.

**Live URL**: [voyomusic.com](https://voyomusic.com)

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 7 + Tailwind CSS 4 |
| State | Zustand 5 (fine-grained selectors, persisted stores) |
| Audio | Web Audio API (AudioContext singleton, multiband chain) |
| Backend | Cloudflare Worker (edge extraction, R2 gateway) |
| VPS | OVH server at `stream.zionsynapse.online:8443` (yt-dlp + yt-dlp + processing) |
| Storage | Cloudflare R2 (`voyo-audio` bucket, `voyo-feed` bucket) |
| Database | Supabase (collective track intelligence, user auth, reactions) |
| Caching | IndexedDB (local device), R2 (collective), Service Worker |
| Icons | Lucide React + Phosphor Icons |
| AI | Gemini 2.5 Flash (OYO DJ personality, cultural context) |
| Search | Piped API (privacy YouTube frontend) for album/playlist discovery |
| PWA | Service Worker, manifest.json, Wake Lock API, MediaSession API |

### Deployment

- **Frontend**: Vercel (SPA with rewrites to `index.html`)
- **Edge Worker**: Cloudflare Workers (`voyo-edge.dash-webtv.workers.dev`)
- **Backend Server**: Railway (Node.js, `server/index.js`, youtubei.js + R2)
- **VPS Audio Proxy**: OVH Gravelines (`stream.zionsynapse.online:8443`)

---

## Audio Pipeline

The audio pipeline is the heart of VOYO. It consists of three layers: the AudioContext singleton (created once), the VOYEX Araba enhancement chain (multiband mastering), and the frequency pump (real-time visualization).

### Recent Audio Surgery (April 2026)

**Session 11** fixed 13 root causes in the audio chain:
- **3ms micro-ramp** replaces 10ms — first beat arrives at 95%+ volume
- **Cold start crackle** fixed — limiter threshold -1→-0.3, ratio 20→8
- **latencyHint: 'playback'** — 256-512 sample buffers, fewer underruns
- **preservesPitch: false** — kills expensive resampler per buffer
- See `docs/session-11-handoff.md` and `docs/CLIENT_AUDIO_CHAIN.md` for full details.

**Session 12 (April 13)** — launch hardening pass (20 commits):
- **Skip hiccup** fixed — gain ramp fully drains (10ms) before pause
- **Volume slider lag** fixed — localStorage persist debounced 200ms
- **Auto-resume** — always triggers on reload regardless of saved position
- **Background playback** — `isTransitioningToBackgroundRef` prevents `onPause` from killing `isPlaying` during browser background transitions
- **False seek data** — iframe time tracking skips updates when `document.hidden`
- **VPS streaming** — R2 redirects stream directly from CDN (no full blob download), critical for long tracks/DJ mixes
- **Iframe retry at 15%** — retries VPS/edge hot-swap for iframe tracks, boosting background playback coverage ~95%→98%
- **PiP crash fixes** — 7 crash paths patched in `useMiniPiP.ts` (mounted guards, ref cleanup, race prevention)
- **Deep crash audit** — 16 crash paths fixed across SearchOverlay, KnowledgeStore, reactionStore, playerStore, ProfilePage
- **Skip button** — `wasSkeeping` dead zone reduced from 50ms `setTimeout` to `requestAnimationFrame`

### audioEngine.ts — AudioContext Singleton

**File**: `src/services/audioEngine.ts` (704 lines)

The module manages a single `AudioContext` and `MediaElementAudioSourceNode` that persist across track changes. Key design:

- **`connectAudioChain(audio)`**: Idempotent. First call creates `AudioContext` (latencyHint: `'playback'` for larger buffers, less underrun risk) + `MediaElementAudioSourceNode` + `AnalyserNode` (fftSize=256, 128 frequency bins). Subsequent calls return the existing chain with `alreadyWired: true`.
- **`MediaElementAudioSourceNode` is permanent**: Once connected, it follows the audio element through `src` changes automatically (Web Audio API design). Never re-created.
- **`AnalyserNode`**: Passive read-only tap. fftSize=256, smoothingTimeConstant=0.8. The frequency pump in `AudioPlayer.tsx` reads it.
- **Visibility/focus resume**: Synchronous `ctx.resume()` on `visibilitychange` and `focus` events (no rAF delay — eliminates the background-to-foreground silence gap). Gesture listeners installed on-demand when context is suspended/interrupted (iOS lock/unlock).
- **AudioEngine class** (singleton): Buffer health monitoring (15s target, 3s emergency, 8s warning), adaptive bitrate selection (low=64kbps, medium=128kbps, high=256kbps), network speed estimation from download measurements, LRU preload cache (max 10 entries), and `getBestAudioUrl()` cascade: MediaCache blob > AudioEngine blob > CDN.

### AudioPlayer.tsx — The Playback Controller

**File**: `src/components/AudioPlayer.tsx` (3147 lines)

A headless React component (renders a hidden `<audio>` element) that orchestrates all playback. Core responsibilities:

#### Audio Enhancement Chain (VOYEX Araba)

Three presets plus raw mode, all sharing a unified Web Audio graph:

```
source → highPass(25Hz) → [multiband bypass | multiband chain] → standardEQ → stereoWidening → masterGain → compressor → limiter → spatialInput → [spatial bypass | spatial chain] → destination
```

**Presets** (`BOOST_PRESETS` object):
- **`off`**: Raw audio. Source connects directly to spatial input, all processing bypassed.
- **`boosted`**: Bass +5dB, presence +2dB, sub-bass +2dB, warmth +1dB, air +1dB. Compressor: threshold=-12dB, ratio=4:1. Gain: 1.15x.
- **`calm`**: Gentler EQ (bass +3dB, air +2dB, warmth +2dB). Compressor: threshold=-15dB, ratio=3:1. Gain: 1.05x.
- **`voyex`**: Professional multiband mastering. Three bands split at 180Hz and 4500Hz (24dB/octave Linkwitz-Riley crossovers). Per-band compression + gain. Harmonic exciter (WaveShaper with memoized curves). Stereo widening (0.015s inter-channel delay). Gain: 1.4x.

**Multiband bypass system**: Non-VOYEX presets route through a direct gain path (zero phase distortion). VOYEX routes through the full multiband chain. Cross-fade between paths uses `linearRampToValueAtTime` for click-free transitions. This is the root-cause fix for the "muffling on non-VOYEX presets" bug — Linkwitz-Riley sums to flat amplitude but accumulates phase smear.

**VOYEX Spatial Layer** (created once, shared by all presets):
- Crossfeed: Channel splitter → 0.3ms delayed low-passed crossfeed between L/R channels
- Organic stereo panner: 3 sine LFOs at irrational frequencies (0.037Hz, 0.071Hz, 0.113Hz) for never-repeating pan movement
- Haas delay: Right channel delay (0-4.6ms) for spatial width
- DIVE reverb: Convolver with procedurally generated IR (2.5s, decay 2.0, LP 1800Hz) — dark room effect
- IMMERSE reverb: Convolver with brighter IR (1.5s, decay 3.5, LP 9000Hz) — open space effect
- Sub-harmonic synthesizer: Bandpass(90Hz) → WaveShaper(tanh) → LowPass(80Hz) for deep bass extension
- Spatial bypass: Same parallel-path technique as multiband — non-VOYEX routes direct, VOYEX routes through the full spatial chain

**Heavy VOYEX nodes are deferred to `requestIdleCallback`** (convolver IR generation: ~352K math ops; sub-harmonic curve: 44K tanh calls). Never blocks the audio thread during first track startup.

#### fadeInMasterGain (10ms micro-ramp)

Called from `canplaythrough` handlers right before `audio.play()`. Sets gain to target BEFORE play starts — first sample enters at full volume. A 10ms linear ramp (441 samples at 44.1kHz) prevents theoretical click. Human loudness resolution is ~100ms, so 10ms is imperceptible. This is the "instant presence" design — tracks arrive fully present from the first beat.

#### muteMasterGainInstantly (15ms fade)

Ramps masterGain to 0.0001 over 15ms before `audio.pause()` on track swaps. Arms a 6s gain-stuck watchdog that forces a fade-in if `canplaythrough` never fires. All loudness transitions go through masterGain inside the Web Audio chain (not `audio.volume`, which is pinned at 1.0).

#### Frequency Pump (10fps, delta-gated CSS custom properties)

Runs at ~10fps (every 6th rAF frame on 60fps displays). Reads AnalyserNode frequency data into a pre-allocated `Uint8Array` (no GC per frame). Computes four band values:

- `--voyo-bass`: Average of bins 0-15 (~60-250Hz), normalized 0-1
- `--voyo-mid`: Average of bins 16-80 (~250-5kHz), normalized 0-1
- `--voyo-treble`: Average of bins 81-127 (~5-20kHz), normalized 0-1
- `--voyo-energy`: RMS of all 128 bins (overall loudness), normalized 0-1

**Delta-gated writes**: Only touches the DOM when a value changes by >0.05 (5%). Most frames during steady playback, treble/mid barely move — skipping writes saves 2-3 style recalcs per frame. Visual components read these via `var(--voyo-bass)` etc. in CSS — zero React re-renders, pure GPU-composited response.

Visibility-gated: stops pumping when document is hidden. Only runs when `isPlaying`.

#### Harmonic Exciter Curves (Memoized)

The `makeHarmonicCurve(amount)` function generates a 44100-sample `Float32Array` WaveShaper curve. Cached by rounded amount key (`Map<number, Float32Array>`). First call for a given amount computes; subsequent calls return cached. Prevents regenerating 44K trig ops on every preset switch.

#### Epsilon-Guarded Parameter Ramps

The `ramp()` helper in `updateBoostPreset` skips the `cancelScheduledValues`/`setValueAtTime`/`linearRampToValueAtTime` triplet when `|current - target| < 0.0005`. Prevents wasted audio-thread scheduling when switching between presets that share parameter values.

---

## Playback Sources

### loadTrack Flow

The `loadTrack` function in `AudioPlayer.tsx` uses a monotonic counter (`loadAttemptRef`) as a cancellation token. Every await boundary checks if a newer load has started and bails if stale. Priority order:

1. **Preloaded audio** (`preloadManager.ts`): Check if next track was already preloaded → instant playback
2. **IndexedDB cache** (`downloadManager.ts`): Check local device cache → play with full EQ
3. **R2 collective cache** (`api.ts` → `checkR2Cache`): Check 170K+ shared tracks on Cloudflare R2 → play with EQ
4. **VPS server** (`stream.zionsynapse.online:8443`): Server-side extraction + normalization → blob URL → play with EQ
5. **Iframe fallback**: YouTube iframe plays instantly (audible); parallel VPS/Edge fetch runs for hot-swap

### The Hot-Swap System (iframe to audio element)

When all caches miss:
1. Set `playbackSource='iframe'`. The always-mounted `YouTubeIframe` component unmutes and plays YouTube audio instantly.
2. Point the main `<audio>` element at a **silent WAV** (2s, 8kHz, 8-bit mono, ~16KB, generated in-memory). This keeps iOS audio focus alive through screen-off — iOS sees `HTMLMediaElement.playing=true` and keeps the PWA in "has audio focus" state.
3. Fire VPS fetch in parallel (15s timeout). On success:
   - Create blob URL from response
   - Seek audio element to iframe's current position
   - `fadeInMasterGain(80)` → `audio.play()`
   - Switch `playbackSource` to `'cached'`
4. If VPS fails, try Edge Worker `/stream` endpoint (5s timeout). Same hot-swap flow.
5. If both fail, iframe stays as audio source. Foreground playback works; background won't for this track.

**Hot-swap guard**: Skipped if progress > 35% (not worth the audible interruption; cache is ready for next play).

### Silent WAV Keeper

Generated on component mount: minimal WAV header (44 bytes) + 16000 silence samples (8-bit unsigned PCM, midpoint=128). Blob URL held in ref. Used during iframe phase so the main audio element is continuously "playing", maintaining iOS/Android audio focus without any audible output (masterGain is muted to 0.0001).

### Flow Watchdog (8s auto-skip)

Armed when `loadTrack` starts, cleared when `play()` succeeds. If 8 seconds pass without playback starting (stream URL null, fetch failed silently, canplaythrough never fired, play() rejected), auto-skips to next track. Stale guard prevents late fires from skipping the current track after recovery. Does NOT mark the track as permanently failed (could be transient network issue).

### Error Recovery (4-tier cascade)

1. **Local cache** (fastest — IndexedDB)
2. **R2 collective** (fast — CDN)
3. **Edge Worker re-extract** (5s timeout)
4. **Skip to next track** (music never stops)

Each tier uses `oncanplay` (not `oncanplaythrough`) for fastest possible resume. Position is preserved across recovery. Stalled audio (no `onerror` fired) triggers a separate 4s timer that forces the same recovery flow.

---

## VPS Server

**URL**: `stream.zionsynapse.online:8443`
**Endpoint**: `/voyo/audio/:trackId?quality=high|medium|low`
**Technology**: Node.js + yt-dlp + R2 (OVH VPS, Gravelines)

The VPS handles server-side audio extraction and processing:
- **yt-dlp** extracts audio from YouTube (max 3 concurrent processes, rate-limited per-IP and globally)
- Audio served as Opus/WebM streams with chunked transfer encoding
- On R2 cache hit: 302 redirect to R2 CDN (zero VPS bandwidth)
- On miss: extract → stream while processing (3-8s startup)
- Tracks cached to R2 after processing — one listen benefits all future users

**Rate limiting**:
- Per IP: 60 requests/min general, 10 yt-dlp calls/min
- Global: 300 yt-dlp calls/min (5/sec)
- User-agent rotation across 5 browser/OS strings

---

## Edge Worker

**File**: `worker/index.js` (1278 lines)
**URL**: `voyo-edge.dash-webtv.workers.dev`

Cloudflare Worker running at 300+ edge locations. Zero-gap architecture: Supabase = source of truth, R2 = dumb storage, Worker = single gateway.

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/exists/{id}` | Query Supabase for R2 cache status |
| `/audio/{id}` | Stream audio from R2 |
| `/extract/{id}` | YouTube extraction → actual audio bytes (pipe-through) |
| `/stream?v={id}` | Get extraction URL (JSON response with `url` field) |
| `/upload/{id}` | Atomic: R2 put + Supabase upsert |
| `/thumb/{id}` | Thumbnail proxy (CORS bypass) |
| `/api/search?q=` | YouTube search via InnerTube WEB client |
| `/debug?v={id}` | Probe every client, return per-client diagnostics |
| `/cdn/art/{id}` | Album art CDN proxy |

### YouTube Extraction (InnerTube clients)

Multi-client fallback strategy, ordered by success rate:
1. **IOS** (v19.45.4, iPhone16,2): Most reliable, returns unciphered URLs
2. **ANDROID_VR** (v1.62.27, Quest 3): Less throttled, sometimes lower bitrate
3. **WEB_CREATOR** (v1.20260401): Browser fallback, unciphered URLs, no sign-in
4. **ANDROID** (v19.44.38): Last resort

Each attempt generates a fresh `visitorData` token (base64-encoded protobuf with random visitor ID). `signatureTimestamp` set to 20350 (2026-Q1). Uses the public InnerTube API key (not a secret, embedded in `ytcfg` on youtube.com).

---

## State Management

### playerStore.ts (1690 lines)

**File**: `src/store/playerStore.ts`

The central playback state store (Zustand, persisted to localStorage). Key state:

- `currentTrack: Track | null` — currently playing track (full metadata)
- `isPlaying: boolean` — play/pause state (mirrored from audio element)
- `progress: number` — 0-100 playback progress
- `currentTime: number` — seconds elapsed
- `duration: number` — track duration in seconds
- `volume: number` — 0-100
- `queue: QueueItem[]` — upcoming tracks (with source: manual/auto/roulette/ai)
- `history: HistoryItem[]` — recently played (persisted with full metadata)
- `playbackSource: 'cached' | 'r2' | 'iframe' | 'cdn'` — current audio source
- `boostProfile: BoostPreset` — active EQ preset (off/boosted/calm/voyex)
- `voyexSpatial: number` — -100 to 100 (DIVE to IMMERSE intensity)
- `voyoActiveTab: VoyoTab` — current UI tab
- `hotTracks: Track[]` / `discoverTracks: Track[]` — feed tracks from database discovery
- `bufferHealth: number` / `bufferStatus: BufferStatus` — buffer monitoring

**Persistence**: Saves `currentTrackId` + full metadata (title/artist/coverUrl), `currentTime`, `voyoActiveTab`, queue (with per-item metadata), and history to localStorage. Rehydrates on reload with full track objects — no "Loading..." stubs.

**4Hz store-write throttle**: `handleTimeUpdate` in AudioPlayer uses 250ms buckets (`lastProgressWriteBucketRef`) — smooth enough for progress bars, 16x lighter on Safari's 66Hz timeupdate.

### downloadStore.ts (502 lines)

**File**: `src/store/downloadStore.ts`

Manages local device caching (IndexedDB). Two modes:
- **Manual Boost**: User clicks "Boost HD" → downloads to IndexedDB at high quality
- **Auto-Boost**: After 3 manual boosts, prompts to enable automatic background caching

Tracks boost start times for hot-swap timing. VOYO IDs decoded to raw YouTube IDs for storage normalization. WiFi-only gate configurable. Persists `manualBoostCount` and `autoBoostEnabled` to localStorage.

### preferenceStore.ts (~200+ lines)

**File**: `src/store/preferenceStore.ts`

localStorage-first personalization. Tracks per-track and per-artist preferences:
- `totalListens`, `completions` (>80% played), `skips` (<20% played)
- `reactions` (OYE score), `explicitLike`
- `totalDuration`, `lastPlayedAt`
- Artist/tag/mood preference aggregates

Listen sessions: `startListenSession(trackId)` / `endListenSession(duration)` with automatic completion/skip recording at 80%/20% thresholds.

### trackPoolStore.ts (581 lines)

**File**: `src/store/trackPoolStore.ts`

Dynamic track pool with hot/cold partitions:

```
HOT POOL (active rotation)     COLD POOL (aged out)
- High intent match            - Low recent activity
- Recently played              - Mismatched intent
- User reactions               - Recoverable on shift
```

**Scoring formula**: `trackScore = intentMatch * 0.4 + recency * 0.3 + engagement * 0.3`

Tracks enter hot (score=50), age to cold after 7 days without play. Source tracking: seed/search/related/trending/llm/album. Content filter blocks non-music (news, podcasts, politics). All pool additions sync to Supabase via `databaseSync.ts`.

### intentStore.ts (489 lines)

**File**: `src/store/intentStore.ts`

Captures active user intent from MixBoard interactions. Signal sources ranked by strength:
1. `dragToQueue` events (strongest — explicit intent)
2. `manualBars` (MixBoard tap distribution)
3. `queueComposition` (tracks added by mode)
4. `modeActivity` (recent activity with time decay)

Six vibe modes: `afro-heat`, `chill-vibes`, `party-mode`, `late-night`, `workout`, `random-mixer`.

### Other Stores

- **reactionStore.ts** (622 lines): OYE reaction system, community signals, real-time reaction subscriptions via Supabase
- **universeStore.ts** (854 lines): Social features, user profiles, messaging
- **oyoStore.ts**: OYO AI DJ invocation state
- **playlistStore.ts**: User playlist management

---

## UI Architecture

### VoyoPortraitPlayer (6085 lines)

**File**: `src/components/voyo/VoyoPortraitPlayer.tsx`

The main player view. Structured top-to-bottom:

1. **Top**: History (left 2 cards) + Queue/Add (right)
2. **Center**: Big artwork card with title overlay — the **BigCenterCard**
3. **Play Controls**: Neon purple ring (prev/play-pause/next)
4. **Reactions**: Clean pill buttons with hold-to-charge OYE multiplier
5. **Bottom**: 3-column PortalBelt (HOT | VOYO FEED | DISCOVERY)

**BigCenterCard**: 3D CSS perspective with depth transforms. Bass-reactive pulse via `--voyo-bass` CSS custom property. Album art loads via `SmartImage` with thumbnail fallback cascade.

**Draggable card gesture**: Full-screen touch surface for swipe navigation. Hold-to-preference cards for quick queue additions.

**MixBoard system**: 6 preset modes (Afro Heat, Chill Vibes, Party Mode, Late Night, Workout, OYO DJ). Each mode has neon color, glow, taglines, mood-based timing, and text animation variant. Taps increase mode weight in the track pool scoring.

**Isolated time components**: `CurrentTimeDisplay` and `ProgressSlider` are `memo`-wrapped components with their own `usePlayerStore` subscriptions for `currentTime`/`duration`. This prevents the 6000-line parent from re-rendering at 4Hz.

**PortalBelt**: Auto-scrolling horizontal card belts for HOT, VOYO FEED, and DISCOVERY zones. Cards are hold-to-play with neon mode borders.

**Signal system**: Double-tap on MixBoard column opens text input for "billboard contribution" — short punchy comments (<=30 chars) attached to a vibe category and track position.

**Lyrics overlay**: Tap album art to show synced lyrics (via `lyricsEngine.ts` + `lyricsAgent.ts`). Word-tap translation via `lexiconService.ts`.

**Voice features**: Hold mic for voice command (3-2-1 countdown → recording → OYO DJ processes). Tap mic for Shazam-style sing/hum search (8s recording → Whisper transcription → search).

**Backdrop picker**: Visual background themes (animated gradients, patterns).

### OYO Island (916 lines)

**File**: `src/components/voyo/OyoIsland.tsx`

Voice search and chat interface. Morphs between collapsed (circle), voice, chat, and lyrics modes. The circle-to-square morph is the "OYO Island" visual identity. Features:
- Voice Search (hold to sing/hum, phonetic matching)
- Chat Mode (text with OYO for requests like "play Burna Boy")
- Lyrics Preview (current phonetic lyrics)
- Auto-hides after 5s of inactivity
- Cultural context via Gemini 2.5 Flash

### VoyoMoments (1676 lines)

**File**: `src/components/voyo/feed/VoyoMoments.tsx`

Social feed with directional navigation:
- UP = Control (deeper in same category, deterministic)
- DOWN = Surrender (bleed into adjacent category, organic)
- LEFT = Memory (retrace trail with fading precision)
- RIGHT = Drift (explore somewhere new, weighted random)

Hold = position overlay. Double-tap = OYE reaction. Double-tap + hold = Star panel.

Spring physics: Control directions (UP, LEFT) use snappy spring (stiffness=400, damping=35). Surrender directions (DOWN, RIGHT) use floaty spring (stiffness=280, damping=25).

### VoyoBottomNav

**File**: `src/components/voyo/navigation/VoyoBottomNav.tsx`

Three-tab navigation: HOME | VOYO (toggle player/feed) | DAHUB. Adapted from DashTivi+ pattern:
- 3-tier opacity fade: scrolling 30%, idle 2s 100%, idle 5s+ 12% ghost
- Glass surface with backdrop-blur-16
- Center VOYO orb with purple gradient
- Long-press VOYO orb invokes OYO AI
- Unread DM badge on DAHUB tab

**Player mode**: Drops central orb, renders Home/Dahub as floating corner buttons at 7% opacity.

### ClassicMode + HomeFeed

**Files**: `src/components/classic/ClassicMode.tsx` (615 lines), `src/components/classic/HomeFeed.tsx` (1863 lines)

Alternative Spotify-style layout with:
- Home Feed (trending, continue listening, heavy rotation, vibe sections)
- Library view
- Now Playing full-screen overlay

### LandscapeVOYO (862 lines)

**File**: `src/components/voyo/LandscapeVOYO.tsx`

Wide layout auto-detected by orientation. Two-panel: left (album art + controls) and right (queue/lyrics/chat).

### VideoMode (344 lines)

**File**: `src/components/voyo/VideoMode.tsx`

Full immersion mode with floating reactions. YouTube iframe in fullscreen/landscape with overlay UI.

### BoostSettings

**File**: `src/components/ui/BoostSettings.tsx`

VOYEX Araba branded settings panel:
- Audio preset selector (Off/Boosted/Calm/VOYEX)
- VOYEX spatial intensity slider (DIVE to IMMERSE)
- Auto-boost enable/disable
- WiFi-only download toggle
- Cache management (view/clear cached tracks, storage usage)
- Sleep timer (5m/15m/30m/1h with fade-out)

---

## Background Play

Multiple systems work together to maintain audio through screen-off and app-switch:

1. **MediaSession API**: Sets metadata (title, artist, artwork), action handlers (play, pause, previoustrack, nexttrack, seekto), and position state sync. Drives lock-screen controls on all platforms.

2. **Wake Lock API**: Requests `navigator.wakeLock.request('screen')` when playing, releases on pause. Prevents screen dimming during active listening.

3. **Iframe hot-swap architecture**: During iframe phase, the main `<audio>` element plays a silent WAV to maintain iOS/Android audio focus. The iframe provides audible sound. When VPS/Edge audio arrives, hot-swap replaces silent WAV with real audio.

4. **Silent WAV keeper**: 2-second silent WAV (8kHz, 8-bit mono) generated in-memory. Looped on the main audio element during iframe phase. MasterGain muted so no sound leaks. iOS sees `HTMLMediaElement.playing=true` → keeps PWA alive in background.

5. **VPS-first path**: VPS-processed audio plays as a standard `<audio>` element with blob URL. Native background play — no iframe dependency, no YouTube restrictions.

6. **AudioContext lifecycle**: Suspended on hidden+paused (battery). Resumed immediately on visibility change (no rAF delay). Gesture listeners installed on-demand for iOS lock/unlock recovery.

---

## Caching Strategy

### Local Device (IndexedDB)

**File**: `src/services/downloadManager.ts` (517 lines)

- Database: `voyo-music-cache`, stores: `audio-files` (blobs) + `track-meta` (metadata)
- Two quality levels: `standard` (auto-cache) and `boosted` (manual HD download)
- Tracks marked as "kept" at 75% listen progress (permanent cache)
- VOYO ID to YouTube ID normalization for storage
- Uploads to R2 after local cache (one listen benefits all users)

### R2 Collective Cache

**Bucket**: `voyo-audio` on Cloudflare R2 (170K+ tracks)

- Two quality tiers per track: `64/{id}.mp3` (low) and `128/{id}.mp3` (high)
- Quality upgrade triggered at 50% listen progress (low→high)
- Worker `/upload/{id}` is atomic: R2 put + Supabase upsert
- Cache status tracked in Supabase `video_intelligence` table

### Service Worker Cache

**File**: `public/service-worker.js`

- `voyo-v85`: Static assets (index.html, icons, offline.html)
- `voyo-audio-v2`: Audio streams (CDN streams, Piped API responses)
- Network-first for navigation, cache-first for audio
- Auto-update broadcast: signals open tabs when new SW activates

### Queue Pre-Boost

When tracks are added to queue (in `playerStore.addToQueue`), background `cacheTrack()` fires so queued tracks hit the cached/R2 path instead of iframe fallback.

### Progress-Triggered Caching

| Progress | Trigger |
|----------|---------|
| 50% | R2 quality upgrade (low→high) with 5s defer + buffer health check |
| 70% | Next-track preload (staggered: 500ms, 5.5s, 10.5s) |
| 75% | Mark as "kept" (permanent local cache) |
| 85% | Edge-stream tracks: cache + upload to R2 |
| 100% | `handleEnded` fallback: cache if 85% trigger missed |

---

## Performance Optimizations

### Store Write Throttling

- **4Hz progress writes**: `handleTimeUpdate` uses 250ms buckets. `trackProgressRef.current` still updates every fire for milestone checks, but store writes (which trigger 9+ component re-renders) happen at most 4x/sec.
- **Fine-grained selectors**: AudioPlayer uses individual `usePlayerStore(s => s.field)` selectors instead of broad destructures. Prevents re-renders on unrelated field changes (critical for a 2988-line component with 40+ useEffects).
- **Isolated time subscribers**: `CurrentTimeDisplay`, `ProgressSlider`, and `OverlayTimingSync` are memo-wrapped components with their own store subscriptions, preventing parent tree re-renders.

### Deferred Work

- **`requestIdleCallback`**: All play telemetry (6 service calls totaling 5-20ms sync work) deferred to idle with 3s timeout. VOYEX spatial node construction (convolver IR generation, sub-harmonic curve) deferred to idle with 4s timeout.
- **Batched iframe state writes**: YouTubeIframe's `OverlayTimingSync` only writes to parent on zone transitions, not on every time tick.
- **`oyoDJ.saveProfile` debounced**: Profile serialization (JSON.stringify + localStorage) debounced to avoid blocking during rapid interactions.
- **`recordPlayEvent` deferred to idle**: Pool engagement, DJ recording, OYO tracking, video intelligence — all wrapped in `requestIdleCallback`.

### Audio Thread Protection

- `latencyHint: 'playback'` on AudioContext: Larger buffers (~256-512 samples vs ~128 for 'interactive'), dramatically reduces audio thread underruns on weak devices.
- `preservesPitch = false` on audio element: Disables pitch-preserving resampler CPU cost.
- Epsilon-guarded parameter ramps: Skip identical automation scheduling.
- WaveShaper `oversample: 'none'` when curve is null: Prevents oversampling filter latency when exciter is bypassed.
- Delta-gated frequency pump CSS writes: Only touch DOM when value changes >5%.
- Memoized harmonic exciter curves: Cache by rounded amount key.
- Buffer monitoring interval: 5s (reduced from 2s).

### Code Splitting

Vite config (`vite.config.ts`) splits:
- `vendor-react`: React + ReactDOM
- `vendor-zustand`: Zustand
- `vendor-supabase`: Supabase client
- `vendor-icons`: Lucide React
- `app-services`: All services except audioEngine
- `app-knowledge`: Knowledge subsystem

Mode components lazy-loaded via `React.lazy()`:
- `PortraitVOYO`, `LandscapeVOYO`, `VideoMode`, `ClassicMode`
- `SearchOverlay`, `ArtistPage`, `UniversePanel`, `OyoInvocation`

Brain + scouts subsystem deferred to `requestIdleCallback` in App.tsx (not on playback hot path).

---

## Key Files

### Core Playback
| File | Lines | Description |
|------|-------|-------------|
| `src/components/AudioPlayer.tsx` | 2988 | Playback controller: loadTrack, Web Audio chain, EQ presets, hot-swap, recovery |
| `src/services/audioEngine.ts` | 693 | AudioContext singleton, AnalyserNode, buffer health, network stats, preload cache |
| `src/services/preloadManager.ts` | 527 | Spotify-style next-track preloading (up to 3 tracks, multi-source) |
| `src/services/downloadManager.ts` | 517 | IndexedDB cache: download, store, retrieve, migrate, upload to R2 |
| `src/services/mediaCache.ts` | 462 | In-memory LRU cache for feed pre-caching (audio blobs + thumbnails) |
| `src/components/YouTubeIframe.tsx` | 776 | Single iframe: audio streaming, video display (hidden/portrait/landscape) |

### State Management
| File | Lines | Description |
|------|-------|-------------|
| `src/store/playerStore.ts` | 1690 | Central player state: track, queue, history, playback, persistence |
| `src/store/trackPoolStore.ts` | 581 | Dynamic hot/cold track pools with intent-weighted scoring |
| `src/store/downloadStore.ts` | 502 | Local cache state: boost tracking, auto-boost, download progress |
| `src/store/intentStore.ts` | 489 | Vibe mode intent signals from MixBoard interactions |
| `src/store/preferenceStore.ts` | ~250 | Per-track/artist/tag listen behavior and preferences |
| `src/store/reactionStore.ts` | 622 | OYE reaction system, community signals, Supabase subscriptions |
| `src/store/universeStore.ts` | 854 | Social features, user profiles, messaging state |
| `src/store/oyoStore.ts` | — | OYO AI invocation state |
| `src/store/playlistStore.ts` | — | User playlist management |

### UI Components
| File | Lines | Description |
|------|-------|-------------|
| `src/components/voyo/VoyoPortraitPlayer.tsx` | 6065 | Main player: BigCenterCard, MixBoard, PortalBelt, reactions, signals |
| `src/components/voyo/OyoIsland.tsx` | 916 | Voice search, chat, lyrics preview (circle-to-square morph) |
| `src/components/voyo/LandscapeVOYO.tsx` | 862 | Wide layout with two-panel design |
| `src/components/voyo/ArtistPage.tsx` | 767 | Artist profile with discography and stats |
| `src/components/classic/HomeFeed.tsx` | 1863 | Spotify-style home feed (trending, continue, heavy rotation) |
| `src/components/classic/ClassicMode.tsx` | 615 | Classic mode container (Home/Library/NowPlaying) |
| `src/components/voyo/feed/VoyoMoments.tsx` | 1676 | Social feed with directional swipe navigation |
| `src/components/voyo/VideoMode.tsx` | 344 | Fullscreen video immersion mode |
| `src/components/voyo/navigation/VoyoBottomNav.tsx` | — | 3-tab nav with VOYO orb and DashTivi+ fade pattern |
| `src/components/ui/BoostSettings.tsx` | — | Audio settings: presets, spatial, cache, sleep timer |
| `src/components/ui/BoostButton.tsx` | — | Lightning boost button for manual HD download |
| `src/components/ui/SmartImage.tsx` | — | Progressive image loading with thumbnail fallback |
| `src/components/search/SearchOverlayV2.tsx` | — | Search with database + YouTube dual-source |
| `src/components/voyo/VoyoSplash.tsx` | — | Brand splash screen on app load |
| `src/components/backgrounds/AnimatedBackgrounds.tsx` | — | Animated gradient backgrounds + reaction canvas |

### Services (Intelligence Layer)
| File | Lines | Description |
|------|-------|-------------|
| `src/services/oyoDJ.ts` | 950 | OYO AI DJ: personality, Gemini-powered responses, taste learning |
| `src/services/personalisation.ts` | 863 | Pool-aware hot/discovery track selection, engagement recording |
| `src/services/intelligentDJ.ts` | 768 | Play recording, skip detection, transition analysis |
| `src/services/centralDJ.ts` | 692 | Collective intelligence flywheel: vibe training, Supabase sync |
| `src/services/trackVerifier.ts` | 743 | Track health verification, failure marking, startup heal |
| `src/services/videoIntelligence.ts` | 620 | Track metadata sync, play tracking, Supabase video_intelligence |
| `src/services/poolCurator.ts` | 591 | Bootstrap pool from database, section curation, session recording |
| `src/services/databaseDiscovery.ts` | 494 | Discovery from 324K tracks in Supabase, vibe-filtered queries |
| `src/services/databaseSync.ts` | ~100 | Sync every surfaced track to collective database (debounced) |
| `src/services/lyricsEngine.ts` | 996 | Synced lyrics with segment timing |
| `src/services/lyricsAgent.ts` | — | Lyrics sourcing agent |
| `src/services/lexiconService.ts` | 518 | Word-tap translation (multi-language) |
| `src/services/whisperService.ts` | 500 | Voice search via Whisper, microphone recording |
| `src/services/essenceEngine.ts` | 418 | Track essence extraction for DJ decisions |
| `src/services/momentsService.ts` | 799 | Social moments CRUD, category navigation |
| `src/services/piped.ts` | — | Piped API integration for YouTube album/playlist discovery |
| `src/services/api.ts` | 501 | Edge Worker API client: search, stream, R2 cache check, upload |
| `src/services/syncedLyricsService.ts` | — | LRCLIB synced lyrics fetcher |
| `src/services/geniusScraper.ts` | — | Genius lyrics scraper |

### Backend
| File | Lines | Description |
|------|-------|-------------|
| `worker/index.js` | 1278 | Cloudflare Worker: R2 gateway, YouTube extraction, search |
| `server/index.js` | 2047 | Railway server: youtubei.js, R2 streaming, rate limiting |
| `public/service-worker.js` | ~100 | PWA service worker: static + audio caching, offline support |

### Brain / Knowledge
| File | Lines | Description |
|------|-------|-------------|
| `src/brain/VoyoBrain.ts` | — | Intelligent DJ brain (lazy-loaded, not on playback hot path) |
| `src/brain/SessionExecutor.ts` | — | Session-based track execution |
| `src/brain/SignalBuffer.ts` | — | Buffered signal processing |
| `src/brain/SignalEmitter.ts` | — | Event emission for brain signals |
| `src/brain/YouTubeInterceptor.ts` | — | YouTube API interception |
| `src/knowledge/KnowledgeStore.ts` | — | Track knowledge graph |
| `src/knowledge/MoodTags.ts` | — | Mood classification taxonomy |
| `src/knowledge/artistTiers.ts` | — | Artist popularity tiering |

### OYO AI System
| File | Lines | Description |
|------|-------|-------------|
| `src/oyo/consciousness.ts` | — | OYO awareness/context system |
| `src/oyo/memory.ts` | — | Conversation memory |
| `src/oyo/session.ts` | — | Chat session management |
| `src/oyo/providers/gemini.ts` | — | Gemini API integration |
| `src/oyo/tools/music.ts` | — | Music tool functions (play, search, queue) |
| `src/oyo-ui/OyoInvocation.tsx` | — | Ambient AI overlay (mercury orb + chat) |
| `src/oyo-ui/OyoChat.tsx` | — | Chat interface |
| `src/oyo-ui/MercuryOrb.tsx` | — | Mercury fluid SVG animation |

### Configuration
| File | Description |
|------|-------------|
| `src/App.tsx` (1686 lines) | Root component: mode switching, error boundary, lazy loading, boot sequence |
| `src/main.tsx` (42 lines) | Entry point: React root render |
| `src/types/index.ts` | Core types: Track, Playlist, Album, ViewMode, QueueItem, etc. |
| `src/data/tracks.ts` | Seed tracks + thumbnail/track conversion helpers |
| `vite.config.ts` | Build config: manual chunks, version stamping |
| `vercel.json` | Vercel deployment: SPA rewrites |
| `worker/wrangler.toml` | Cloudflare Worker config |
| `public/manifest.json` | PWA manifest |

### Utilities
| File | Description |
|------|-------------|
| `src/utils/logger.ts` | `devLog`/`devWarn` (production-safe logging) |
| `src/utils/haptics.ts` | Haptic feedback patterns (light, medium, success, reaction) |
| `src/utils/mobileAudioUnlock.ts` | iOS/Android audio unlock on first gesture |
| `src/utils/thumbnail.ts` | YouTube thumbnail URL helpers |
| `src/utils/imageHelpers.ts` | Image URL resolution + fallback cascade |
| `src/utils/searchCache.ts` | Search result caching |
| `src/utils/voyoId.ts` | VOYO ID encoding/decoding (base64url with `vyo_` prefix) |
| `src/utils/format.ts` | Number/time formatting |

### Hooks
| File | Description |
|------|-------------|
| `src/hooks/useMobilePlay.ts` | Mobile audio play gesture handling |
| `src/hooks/useMiniPiP.ts` | Mini picture-in-picture for background video |
| `src/hooks/usePullToRefresh.ts` | Pull-to-refresh gesture |
| `src/hooks/useAuth.ts` | Authentication state (Supabase) |
| `src/hooks/useArtist.ts` | Artist data fetching |
| `src/hooks/useMoments.ts` | Social moments navigation state |
| `src/hooks/useThumbnailCache.ts` | Thumbnail blob caching |
| `src/hooks/usePWA.ts` | PWA install prompt handling |
