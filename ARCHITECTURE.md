# Voyo Music — Architecture

> Last updated: 2026-04-11 (post commit `eebe619` — dahub freeze + audio crash fix).
> This document replaces everything else. When in doubt, read the source, not the other 65 markdown files at the repo root.

## What it is

Voyo Music is a React 19 + Vite 7 + Tailwind 4 PWA that streams African-first music with an AI-DJ layer on top. It's a single-page app that feels like a superapp: one surface, four tabs (music, feed, create, dahub), a shared Web Audio pipeline, and a Zustand state spine. Content is sourced from a Supabase "collective brain" of ~324K tracks, streamed through a Cloudflare Workers edge ("voyo-edge"), cached progressively (IndexedDB → R2 → edge extraction), and enhanced via a Web Audio processing chain with three boost presets.

- **Stack**: React 19, TypeScript, Vite 7, Tailwind v4, Zustand 5, React Router v7, Supabase JS v2, service worker PWA.
- **Entry**: `src/main.tsx` → `<BrowserRouter>` → `/` = `src/App.tsx`, `/:username` = `src/components/profile/ProfilePage.tsx`.
- **Deployed at**: https://voyomusic.com (Vercel).
- **Auth**: Delegated to DASH Command Center at https://hub.dasuperhub.com.

## High-level architecture

```
                           ┌────────────────────────────┐
                           │       src/main.tsx         │
                           │   BrowserRouter (RRv7)     │
                           │   "/"  →  App              │
                           │   "/:username" → Profile   │
                           └──────────────┬─────────────┘
                                          │
                                  ┌───────▼────────┐
                                  │   App.tsx      │  AppMode state
                                  │  mode router   │  ('classic' | 'voyo'
                                  │  + orientation │   | 'video') with
                                  │  + splash      │   landscape fork
                                  └───────┬────────┘
        ┌────────────────┬─────────────────┼─────────────────┬──────────────────┐
        │                │                 │                 │                  │
   ┌────▼─────┐    ┌─────▼──────┐    ┌─────▼──────┐    ┌─────▼──────┐    ┌──────▼──────┐
   │ Classic  │    │ Portrait   │    │ Landscape  │    │  Video     │    │ Search /    │
   │ Mode     │    │  VOYO      │    │  VOYO      │    │  Mode      │    │ Artist /    │
   │ (Spotify │    │ orchestrator│   │            │    │            │    │ Universe    │
   │  style)  │    │  ⬇         │    │            │    │            │    │ overlays    │
   └────┬─────┘    └────┬───────┘    └─────┬──────┘    └─────┬──────┘    └─────────────┘
        │               │                  │                 │
        │          ┌────┴──────┬──────────┼─────────────┐   │
        │          │           │          │             │   │
        │      ┌───▼──┐   ┌────▼───┐  ┌───▼───┐    ┌────▼───▼──┐
        │      │MUSIC │   │ FEED   │  │ CREATE│    │  DAHUB    │
        │      │tab   │   │ tab    │  │ tab   │    │  tab      │
        │      │Voyo  │   │Voyo    │  │Creator│    │  Dahub.tsx│
        │      │PortP │   │Moments │  │Upload │    │  (social) │
        │      │layer │   │        │  │       │    │           │
        │      └──┬───┘   └───┬────┘  └───────┘    └─────┬─────┘
        │         │           │                           │
        └─────────┼───────────┼───────────────────────────┘
                  │           │
                  ▼           ▼
         ┌──────────────────────────────┐
         │       playerStore (Zustand)  │  ← canonical state
         │  currentTrack, queue, history│
         │  hotTracks, discoverTracks…  │
         └─────────┬────────────────────┘
                   │  (currentTrack change)
                   ▼
         ┌──────────────────────────────┐
         │    components/AudioPlayer    │  <audio> element owner
         │    (1 per app, mounted in    │
         │     App.tsx at all times)    │
         └─────────┬────────────────────┘
                   │
     ┌─────────────┼─────────────────────────┐
     │             │                         │
┌────▼────┐   ┌────▼──────────┐      ┌───────▼───────────┐
│ audio-  │   │ preloadManager│      │ mediaCache (LRU   │
│ Engine  │   │ (next-track   │      │  15 audio elts)   │
│(singleton│  │  lookahead)   │      │                   │
│ context,│   └────┬──────────┘      └───────────────────┘
│ boost,  │        │
│ buffer  │   ┌────▼────────────────────────────────────┐
│ monitor)│   │           SOURCE RESOLUTION              │
└─────────┘   │  1. IndexedDB (downloadManager) — cached │
              │  2. R2 cache  (api.checkR2Cache)         │
              │  3. Edge Worker /stream (voyo-edge)      │
              └──┬──────────────────────────────────────┬┘
                 │                                      │
                 ▼                                      ▼
       ┌─────────────────────┐           ┌────────────────────────┐
       │ Cloudflare R2       │           │ Cloudflare Worker:     │
       │ (collective cache,  │           │ voyo-edge.dash-webtv   │
       │ ~170K tracks)       │           │   /stream /cdn /api    │
       └─────────────────────┘           └────────────┬───────────┘
                                                      │
                                                      ▼
                                           ┌────────────────────┐
                                           │ Supabase           │
                                           │ mclbbkmpovnvcfmwsoqt│
                                           │ voyo_tracks,       │
                                           │ voyo_signals,      │
                                           │ voyo_profiles,     │
                                           │ voyo_lyrics, etc.  │
                                           └────────────────────┘
```

**Boundaries**:

- **UI layer** (components/, App.tsx) reads from stores, never from services directly except for one-shots (search, artist pages).
- **State layer** (store/) is the only place with `create<…>` stores. `playerStore` is canonical; every other store must derive from it or be a secondary aspect (downloads, preferences, reactions, playlists, track pool, intent).
- **Services layer** (services/) is stateless functions + singletons (audioEngine, mediaCache, preloadManager). Nothing in services imports from components.
- **Lib layer** (lib/) holds external clients: `supabase.ts`, `voyo-api.ts`, `dash-auth.tsx`, `dahub/dahub-api.ts`.
- **Brain subsystem** (brain/) is an experimental parallel recommendation engine. Loaded at app mount via `initializeBrainIntegration()` but its output is only consumed by the Brain's own signal-driven curation path.

## Process model

### Build output (Vite 7 SSG + code splitting)

`vite.config.ts` defines manual chunks. Current dist build after `npm run build`:

| Chunk                             | Size    | Contents                                                  |
|-----------------------------------|---------|-----------------------------------------------------------|
| `vendor-react-*.js`               | 193 KB  | react, react-dom, react-router-dom                        |
| `index-*.js`                      | 175 KB  | Main app shell (App.tsx, main.tsx, eager imports)         |
| `vendor-supabase-*.js`            | 169 KB  | @supabase/supabase-js                                     |
| `app-services-*.js`               | 120 KB  | All `src/services/*` except `audioEngine`                 |
| `app-brain-*.js`                  | 116 KB  | `src/brain/*` and `src/scouts/*` (LLM DJ experiment)      |
| `VoyoPortraitPlayer-*.js`         | 108 KB  | Portrait player shell (lazy)                              |
| `ClassicMode-*.js`                | 106 KB  | Spotify-style home/library (lazy)                         |
| `artist_master-*.js`              | 57 KB   | Artist metadata JSON                                      |
| `Dahub-*.js`                      | 57 KB   | Social hub (lazy)                                         |
| `VoyoMoments-*.js`                | 40 KB   | Vertical feed (lazy)                                      |
| `SearchOverlayV2-*.js`            | 35 KB   | Search overlay (lazy)                                     |
| `PortraitVOYO-*.js`               | 19 KB   | Tab orchestrator (lazy)                                   |
| `vendor-icons-*.js`               | 18 KB   | lucide-react                                              |
| `UniversePanel-*.js`              | 15 KB   | Profile universe panel (lazy)                             |
| `ArtistPage-*.js`                 | 15 KB   | Artist page overlay (lazy)                                |
| `LandscapeVOYO-*.js`              | 12 KB   | Landscape mode (lazy)                                     |
| `app-knowledge-*.js`              | 9 KB    | `src/knowledge/*`                                         |
| `BoostButton-*.js`                | 8 KB    | Boost UI (lazy)                                           |
| `VideoMode-*.js`                  | 5 KB    | Full-video immersion mode (lazy)                          |
| `vendor-zustand-*.js`             | 3 KB    | Zustand                                                   |
| `useMobilePlay-*.js`              | small   | Mobile play hook                                          |
| `index-*.css`                     | CSS     | Tailwind build                                            |

Initial page weight = `index + vendor-react + vendor-supabase + vendor-icons + vendor-zustand + css` ≈ **560 KB** pre-gzip. Everything else is lazy behind `React.lazy()` + `Suspense` in `App.tsx` and `PortraitVOYO.tsx`.

**Gotcha — do NOT try to chunk-split `src/store/*`.** A previous attempt caused a circular-init crash. See commit `53b0b9c` ("remove data-tracks chunk split (circular dep killed app)"). Stores are all bundled by Vite's default splitting, which is working.

### Service Worker (PWA)

`public/service-worker.js` — current cache names: `voyo-v6` (assets) + `voyo-audio-v2` (audio). Strategy:

| Request type                                    | Strategy                                                            |
|-------------------------------------------------|---------------------------------------------------------------------|
| CDN audio (`/cdn/stream`, `pipedapi*`, `audio`) | Cache-first with network fallback, stored in `voyo-audio-v2`        |
| HTML navigation requests (`mode === 'navigate'`)| **Network-first** with cached `offline.html` fallback               |
| Hashed assets (`/assets/*-[hash].[js\|css]`)    | Cache-first (immutable)                                             |
| Other static (png/svg/webp/woff2)               | Stale-while-revalidate                                              |
| Vite dev HMR (`@vite`, `@react-refresh`, etc.)  | Bypass SW entirely                                                  |
| Cross-origin non-audio                          | Bypass SW                                                           |

The HTML-is-network-first rule exists because of commit `871a5b3` ("fix: service worker network-first for HTML — fixes blank page on deploy"). **Cache name must be bumped on every deploy** that changes the entry chunk; otherwise clients get a stale `index.html` pointing at dead hashed assets.

Push notifications and a `SKIP_WAITING` message channel are also wired in the same SW.

### Main app shell

- `main.tsx` (19 lines) — just router wiring.
- `App.tsx` (1,410 lines) — owns `AppMode` state, `isLandscape`, splash gating, error boundary, brain initialization, track pool maintenance, seed track sync, `AudioPlayer` mount (single `<audio>` for the whole app), `YouTubeIframe` fallback, `AuthProvider`. A lot of this should be in smaller files, but it's stable.
- `AudioPlayer.tsx` is always mounted under `App`. Lazy components below it (PortraitVOYO etc.) dispatch into `playerStore` and the audio element follows.

## State model

All stores live in `src/store/`. Zustand, no middleware except `persist` where noted.

### `playerStore.ts` — 1,410 lines — **CANONICAL**

**Purpose**: Single source of truth for everything playback-adjacent.

**Key fields**:
- `currentTrack`, `isPlaying`, `currentTime`, `duration`, `progress`, `volume`, `seekPosition`
- `queue: QueueItem[]`, `history: HistoryItem[]` (both persisted to localStorage via `voyo-player-state`)
- `hotTracks`, `aiPicks`, `discoverTracks` (discovery pools, fed by `databaseDiscovery` + `personalization`)
- `voyoActiveTab: 'music' | 'feed' | 'create' | 'dahub'` (persisted)
- `networkQuality`, `streamQuality`, `bufferHealth`, `bufferStatus`, `playbackSource`, `boostProfile`, `voyexSpatial`, `oyeBarBehavior`
- `shuffleMode`, `repeatMode`, `playbackRate`, `isSkeeping`
- `reactions`, `oyeScore`, `currentMood`, `isRouletteMode`

**Who reads**: essentially every UI component (`AudioPlayer`, `VoyoPortraitPlayer`, `PortraitVOYO`, `ClassicMode`, `NowPlaying`, `PlaybackControls`, `VoyoMoments`, `Dahub` banner, `ProfilePage`, etc.).

**Who writes**:
- User interactions (play/pause/skip/seek/queue/react)
- `AudioPlayer.tsx` for playback state (progress, duration, buffer, source) via store setters
- `refreshRecommendations()` pulls from `databaseDiscovery` (lazy import — see below)
- `setCurrentTrack()` auto-records to history, pool engagement, and video intelligence

**Gotchas**:
- Stores a `currentTrackAbortController` (module-scoped, not in state) that cancels in-flight async on rapid track changes. Any async in setCurrentTrack must check `signal.aborted` before setting state.
- `databaseDiscovery` is lazy-imported via `getDatabaseDiscovery()` (line ~35) to break a circular dep. **Don't change this to a static import**, it will TDZ-crash.
- Merge-mode (accumulator) discovery pools (`MAX_HOT_POOL = 50`, `MAX_DISCOVER_POOL = 50`) — new results merge, don't replace. Don't regress this; users lose recommendations otherwise.
- Persists only `currentTrackId`, `currentTime`, `voyoActiveTab`, minimal `queue` + `history` — not the whole track object. Hydration re-resolves tracks from `TRACKS` seed or shows a "Loading..." placeholder until database hydrates.

### `trackPoolStore.ts` — 562 lines

**Purpose**: Living pool of tracks scored by intent match, recency, engagement. Feeds personalization. Uses `persist` middleware.

**Key fields**: `pool: PooledTrack[]` (with `playCount`, `completionRate`, `reactionCount`, `skippedCount`, `detectedMode`, `intentScore`), cold pool, scoring timestamps.

**Reads**: `poolCurator`, `personalization`, `reactionStore`, `VoyoVerticalFeed`.
**Writes**: `AudioPlayer` (on play/complete/skip), `reactionStore` (on react), `poolCurator` (bootstrap + curation), `startPoolMaintenance()` (rescoring loop from `App.tsx`).

**Gotcha**: Everything that enters the pool also sync-writes to Supabase `voyo_tracks` via `databaseSync`. Do not add write paths that skip that sync.

### `preferenceStore.ts` — 352 lines (persisted)

**Purpose**: Per-track, per-artist, per-tag, per-mood preference weights learned from listen/skip/react behavior.
**Reads**: `personalization`, ranking paths.
**Writes**: `playerStore` on react/complete, `AudioPlayer` on completion, `VoyoPortraitPlayer` on explicit like/dislike.

### `reactionStore.ts` — 601 lines

**Purpose**: Social reactions with Supabase realtime. Hotspots (reaction clusters in a track). Comments view.
**Reads**: `VoyoVerticalFeed`, `VoyoPortraitPlayer`, MixBoard-type views.
**Writes**: Only via `addReaction()` which also writes to `voyo_reactions` (through a realtime-enabled Supabase channel).

### `playlistStore.ts` — 188 lines (persisted)

**Purpose**: Local-first playlists with optional cloud sync (`voyo_playlists` table via `playlistAPI` in `supabase.ts`).
**Reads**: `PlaylistModal`, `Library` (classic mode), universe panel.

### `downloadStore.ts` — 499 lines (persisted, **lazy-loaded**)

**Purpose**: IndexedDB offline-cache manager. "Boost" = manual download. Auto-boost kicks in after user OYEs a track.
**Reads**: `AudioPlayer` (check cache before streaming), `BoostButton`, `BoostSettings`.
**Writes**: User taps boost, `playerStore.addReaction` on OYE auto-boosts.
**Lazy**: Loaded via `import('./downloadStore')` from `playerStore` — never eagerly imported.

### `intentStore.ts` — 489 lines (persisted, **lazy-loaded**)

**Purpose**: Active intent signals from MixBoard taps, drag-to-queue events, per-mode activity with time decay. "Intent > behavior" philosophy.
**Reads**: `trackPoolStore.matchTrackToMode`, `VoyoVerticalFeed`.
**Writes**: MixBoard interactions, drag events.

### `universeStore.ts` — 853 lines — **DEPRECATED**

> **DEPRECATED — migrate to DASH Command Center.**
>
> This store predates the Command Center SSO migration. Its auth model (username + PIN, URL-is-identity) is dead. Remaining callers:
> - `App.tsx` line 979: `handleDashCallback()` — legacy DASH callback handler
> - `playerStore.ts` + `preferenceStore.ts`: internal references
> - `universeStore.ts` itself
>
> **Do not add new code that touches it.** New code uses `useAuth()` from `hooks/useAuth.ts` (which wraps `lib/dash-auth.tsx`) and `voyo-api.ts` for profile/friends/messages. The remaining `universeAPI` references in `lib/supabase.ts` still read from the `universes` Supabase table — that table is being phased out. See the cleanup roadmap below.

## Audio pipeline (the hot path)

This is the performance-critical, don't-break-this path. It's the most stabilized area of the codebase.

### End-to-end walkthrough

1. **Track selection** — user taps a track somewhere in the UI. Handler calls `playerStore.setCurrentTrack(track)` or the higher-level `playTrack(track)`. `setCurrentTrack`:
   - Cancels any pending per-track async via `currentTrackAbortController.abort()` + creates a fresh one.
   - Flushes the previous track to history and records pool engagement if it played >30%.
   - Resets `progress`, `currentTime`, `seekPosition`, `playbackRate`, `playbackSource`, `bufferHealth`.
   - Records a pool-engagement `'play'` signal and fires video-intelligence telemetry (async, non-blocking, both abort-aware).

2. **AudioPlayer reacts** (`components/AudioPlayer.tsx`). It watches `currentTrack` via `usePlayerStore` and runs its source-resolution flow. It also calls `preloadNextTrack(predictedId, checkLocalCache)` in parallel to prep the next track.

3. **Source resolution**, highest priority first:
   1. **Local IndexedDB cache** (`services/downloadManager.ts.getCachedTrackUrl`). If hit, `playbackSource = 'cached'`. Audio element src is set from the blob URL. Instant.
   2. **R2 collective cache** (`api.checkR2Cache(youtubeId, quality)`). Hits Cloudflare edge with a HEAD; if exists, `playbackSource = 'r2'`. Stream URL is an R2 presigned URL returned by the edge.
   3. **Edge Worker extraction** — `fetch('${EDGE_WORKER_URL}/stream?v=${id}', { signal })`. The worker runs yt-dlp, caches to R2 for everyone, returns a direct stream URL. `playbackSource = 'r2'` (treated identically downstream).

4. **`mediaCache` (`services/mediaCache.ts`)** keeps up to **15 audio elements** LRU-cached in memory (`MAX_CACHE_SIZE = 15`), plus a separate per-trackId blob/URL map. `precacheAhead()` preloads 3 tracks ahead; `CACHE_BEHIND = 5` tracks stay warm for back-scroll. Stale entries TTL out at 5 minutes. Used by the feed scroller for instant forward/back.

5. **`audioEngine.ts` — Web Audio singleton chain**. See `services/audioEngine.ts` lines 26-119. Exports `connectAudioChain(audio)` which is idempotent:
   - First call: creates one `AudioContext` (`_audioCtx`), one `MediaElementAudioSourceNode` (`_sourceNode`) bound to the passed `<audio>`, and marks `_chainWired = true`.
   - Subsequent calls with the same element: returns the existing chain.
   - Subsequent calls with a different element: disconnects the old source, creates a new one (very rare — only if the DOM `<audio>` element itself is replaced).
   - Handles `closed` context recovery by nulling and recreating.
   - The boost processing graph (EQ, compressor, multiband for VOYEX) is built once per `sourceNode` lifetime in `AudioPlayer.tsx` from the returned source node.

6. **iOS/Android suspend/resume** — `audioEngine.ts` lines 44-57. Global listeners:
   - `visibilitychange` (on return to foreground) → resume context.
   - `window.focus` → resume context.
   - `touchstart` / `click` passive listeners → resume context. This is **required** on iOS, where after lock/unlock the context goes to `'interrupted'` state and needs a user gesture to come back.

7. **Buffer health monitoring** — `audioEngine.startBufferMonitoring(audio, onEmergency, onWarning)` runs every 2s:
   - `EMERGENCY_THRESHOLD = 3s`, `WARNING_THRESHOLD = 8s`, `BUFFER_TARGET = 15s`.
   - Emergency → usually triggers a quality downgrade or reload from R2.
   - Status flows back into `playerStore.setBufferHealth()`.

8. **Bitrate adaptation** — `audioEngine.selectOptimalBitrate()` picks `high | medium | low` from `networkStats.speed`:
   - `>1000 kbps` → high (256 kbps)
   - `>400 kbps` → medium (128 kbps)
   - else → low (64 kbps)
   - Speed is averaged over the last ≤10 download measurements from the last 30s window. Measurements are recorded by `recordDownloadMeasurement(bytes, durationMs)` at the end of every stream fetch.

### CRITICAL: the AbortSignal lesson (commit `eebe619`)

**Every fetch in this hot path MUST pass a per-track `AbortSignal`. Period.**

Before `eebe619`, `preloadManager.preloadNextTrack` created a per-track `AbortController`, wired it into the audio element's abort cleanup — but forgot to pass `{ signal }` to the `fetch('${EDGE_WORKER_URL}/stream?v=…')` call on step 3 (YouTube direct stream). Consequence:

- User rapidly skips tracks. For each skip, a new preload starts, with a new controller.
- The old controller `.abort()`s, which clears the local state and the audio element's src — but **the in-flight `fetch` keeps running to completion** because no one asked it to cancel.
- Each zombie fetch holds a slot in the browser's per-host (edge worker) connection pool (typically 6 concurrent).
- After ~5-10 rapid skips, the pool is exhausted. Every subsequent playback request blocks waiting for a slot.
- Audio halts entirely. Recovery takes ~60 seconds of idle time while GC collects the finished fetches and TCP timeouts clear the dead sockets.
- User-visible symptom (verbatim from Dash): *"sound crashes, stabilizes after rest."*

**The fix is one line**: add `{ signal }` to `fetch(…)` at `services/preloadManager.ts:196-199`. Now every skip actively cancels the in-flight fetch and returns the connection slot immediately. See the comment block at lines 191-195 in the source — leave it alone, it's load-bearing documentation.

**Rule**: if you add any new fetch in `preloadManager.ts`, `AudioPlayer.tsx`, `api.ts`, or `downloadManager.ts` that runs inside the track lifecycle, it MUST accept and pass an AbortSignal that's cancelled when the track changes. Validate by rapidly clicking "next" 15 times and confirming audio doesn't halt.

## Curation & discovery

There are currently four parallel DJ/curation engines. `centralDJ` is the intended canonical one; the others are personality wrappers that predate consolidation.

### `centralDJ.ts` — 681 lines — **CANONICAL**

Caller count: **5** (verified via grep of `import .* centralDJ`):
- `src/App.tsx` — `syncSeedTracks(TRACKS)` on mount
- `src/brain/VoyoBrain.ts` — `getTracksByMode(mode)` for belt hydration
- `src/store/trackPoolStore.ts` — `signals` re-export for cloud signal logging
- `src/services/trackVerifier.ts` — `saveVerifiedTrack()` on successful verification
- `src/services/personalization.ts` — `saveVerifiedTrack()` on pool engagement

Writes to `voyo_tracks` and `voyo_signals` in Supabase. Functions as the collective-brain write path.

### `intelligentDJ.ts` — 752 lines — cleanup candidate

Caller count: **1** (`components/AudioPlayer.tsx` calls `recordPlay`). Exposes `window.voyoDJ` debug global. Personality-oriented (learns from engagement; skip vs complete). **Cleanup candidate** — fold `recordPlay` into `centralDJ.signals.play` and delete.

### `oyoDJ.ts` — 878 lines — cleanup candidate

Caller count: **2** (`components/AudioPlayer.tsx` for `onTrackPlay`/`onTrackComplete`, `components/voyo/OyoIsland.tsx` for `getProfile`). Maintains a localStorage-backed "DJ profile" tied to the OyoIsland UI persona. **Cleanup candidate** — merge profile state into `preferenceStore`, merge track callbacks into `centralDJ`.

### `feedAlgorithm.ts` — 390 lines — cleanup candidate

Caller count: **1** (`components/voyo/feed/VoyoVerticalFeed.tsx` for `applyTreatment`, `getStartTime`, `getDuration`). Feed-specific "treatment" logic (cut-in timing for vertical snippets). **Cleanup candidate** — inline into `VoyoVerticalFeed` or merge into `momentsService.ts`.

### `poolCurator.ts` — 560 lines — canonical

Caller count: **3** (`App.tsx` for `bootstrapPool`/`curateAllSections`, `AudioPlayer.tsx` for `recordTrackInSession`, `VoyoVerticalFeed` for `TRENDING_QUERIES`, `WEST_AFRICAN_QUERIES`, `CLASSICS_QUERIES`). Drives the initial pool hydration on app mount and periodic curation sweeps. **Keep.**

### `databaseDiscovery.ts` — 493 lines (**lazy-loaded**, kept despite audit flag)

Caller: lazy-loaded by `playerStore.getDatabaseDiscovery()` (line ~35) and called from `refreshRecommendations()` on every discovery refresh. Queries Supabase `voyo_tracks` via the essence engine (`getHotTracks`, `getDiscoveryTracks`). **Load-bearing — do not delete.** Commit `eebe619` explicitly notes this as a false positive in the audit.

### `personalization.ts` — 862 lines

Pool-aware wrapper around preference + pool + intent signals. Exports `getPoolAwareHotTracks`, `getPoolAwareDiscoveryTracks`, `recordPoolEngagement`. Called from `playerStore` and `AudioPlayer`.

### `essenceEngine.ts` — 417 lines

Utility layer for `databaseDiscovery`. Extracts a `VibeEssence` fingerprint from tracks or free-text queries; used to score Supabase candidates for match.

### `piped.ts` — 299 lines

YouTube mirror via the public Piped API (with a ranked list of 7 fallback instances as of Dec 2025). Used for album lookups, playlist hydration, and as an extraction fallback when the edge worker is cold.

### Lyrics — `lyricsEngine.ts` (canonical, 983 lines)

Pipeline:
1. `lrclib.ts` — free, ~3M synced lyrics, no API key.
2. Local cache (localStorage + `voyo_lyrics` Supabase table).
3. `geniusScraper.ts` — fallback for unsynced.
4. `whisperService.ts` — last-resort Whisper transcription.

`syncedLyricsService.ts` (126 lines, 1 caller) is a thin wrapper around synced-lyrics fetch by YouTube ID. **Cleanup candidate** — fold into `lyricsEngine`.

### Deleted (commit `eebe619`)

- `services/voyoDJ.ts` (710 lines) — never imported anywhere.
- `services/geminiCurator.ts` (526 lines) — never imported anywhere.

## Routing & auth

### Routes (React Router v7, `main.tsx`)

| Path         | Element                                                 | Purpose                                      |
|--------------|---------------------------------------------------------|----------------------------------------------|
| `/`          | `App` (lazy modes: classic / voyo / video / landscape)  | Main app                                     |
| `/:username` | `ProfilePage`                                           | Public profile at `voyomusic.com/:dashId`    |

The `/` route **must come first** in the `<Routes>` block to avoid `App` being caught as `:username`. See comment in `main.tsx`.

### Auth flow — DASH Command Center

- **Provider**: `AuthProvider` wraps the whole app from `providers/AuthProvider.tsx`.
- **Hook**: `useAuth()` in `hooks/useAuth.ts` — the only auth hook. Returns `{ isLoggedIn, dashId, voyoId, displayName, initials, signIn, signOut, openSignIn }`.
- **Implementation**: `lib/dash-auth.tsx` — persists citizen state to `localStorage['dash_citizen_storage']`, supports `signInWithDashId(dashId, pin, 'V')` and SSO callback from https://hub.dasuperhub.com.
- **User identity**: `dashId` (e.g. `0046AAD`) is the primary key. Display is `V{dashId}` (e.g. `V0046AAD`). Username-as-identity is dead.
- **Profile data**: `voyo-api.ts` → `profileAPI`, `friendsAPI`, `messagesAPI` hit Supabase tables directly.

## Data & persistence

### Supabase (project `mclbbkmpovnvcfmwsoqt`)

Tables referenced from src/:

| Table                | Used by                                            | Notes                                                   |
|----------------------|----------------------------------------------------|---------------------------------------------------------|
| `voyo_tracks`        | `centralDJ`, `databaseDiscovery`                   | ~324K-track collective brain; upserted on verification  |
| `voyo_signals`       | `centralDJ`                                        | Engagement signal log                                   |
| `voyo_profiles`      | `voyo-api.ts`, `dahub`, `universeStore` (legacy)   | Public profile storage                                  |
| `voyo_lyrics`        | `lyricsEngine`, `supabase.ts` `lyricsAPI`          | Lyrics cache                                            |
| `voyo_playlists`     | `playlistStore`, `supabase.ts` `playlistAPI`       | Cloud playlist sync                                     |
| `video_intelligence` | `services/videoIntelligence.ts`, `supabase.ts`     | Playback telemetry aggregated across users              |
| `friends`            | `voyo-api.ts` `friendsAPI`, `dahub/dahub-api.ts`   | DASH friend graph                                       |
| `messages`           | `voyo-api.ts` `messagesAPI`, `dahub`               | DM threads                                              |
| `universes`          | `lib/supabase.ts` `universeAPI`, `universeStore`   | **Legacy** — phasing out with universeStore             |
| `portal_messages`    | `lib/supabase.ts` `portalChatAPI`, `PortalChat`    | Live listening-portal chat                              |

Note: the `track_metadata` and `user_sessions` tables referenced in the old architecture doc are not currently queried from `src/` — the table set in use is the one above.

**Graceful fallback**: `lib/supabase.ts` exports `isSupabaseConfigured`. Every database-dependent code path checks this flag and either skips or falls back to the static `TRACKS` seed in `src/data/tracks.ts` (41 hand-curated tracks). App is functional without Supabase — it just has no discovery.

### IndexedDB

Owned by `services/downloadManager.ts`. Stores full audio blobs for offline playback. Keyed by (normalized) YouTube ID. Accessed via `downloadStore` (lazy-loaded Zustand store). Quota is user-controlled via Boost Settings UI.

### localStorage keys (inventory)

| Key                                   | Owner                               | Content                                                |
|---------------------------------------|-------------------------------------|--------------------------------------------------------|
| `voyo-player-state`                   | `playerStore`                       | Current track ID, currentTime, active tab, queue, history (trimmed) |
| `voyo-volume`                         | `playerStore`                       | Last volume (0-100)                                    |
| `voyo-app-mode`                       | `App.tsx`                           | `'classic' \| 'voyo' \| 'video'`                       |
| `voyo-mode-migrated-v12`              | `App.tsx`                           | One-time migration flag (forces default to 'voyo')     |
| `dash_citizen_storage`                | `lib/dash-auth.tsx`                 | DASH Command Center session                            |
| `voyo-splash-v3` (sessionStorage)     | `App.tsx`                           | Per-session splash screen shown flag                   |
| `voyo-bg-image`, `voyo-bg-blur`, `voyo-bg-animation`, `voyo-bg-brightness` | `AnimatedBackgrounds.tsx` | User background customization |
| `voyo-search-history`                 | `SearchOverlayV2`                   | Recent searches                                        |
| `voyo_artist_follows_{dashId}`        | `VoyoVerticalFeed`                  | Followed artist IDs per user                           |
| `voyo_dj_profile`                     | `oyoDJ`                             | OyoIsland DJ persona learning                          |
| `voyo_lexicon_cache`, `voyo_lexicon_user` | `lexiconService`                | Vocab learning from lyrics                             |
| `voyo-preference-store`               | `preferenceStore` (zustand persist) | Track/artist/tag/mood weights                          |
| `voyo-track-pool`                     | `trackPoolStore` (zustand persist)  | Pool state + scores                                    |
| `voyo-intent-store`                   | `intentStore` (zustand persist)     | MixBoard intent                                        |
| `voyo-download-store`                 | `downloadStore` (zustand persist)   | Cached track registry                                  |
| `voyo-playlists`                      | `playlistStore` (zustand persist)   | Local-first playlists                                  |
| `voyo_lyrics_issues`                  | `lyricsEngine`                      | User-reported lyrics issues                            |

### R2 (Cloudflare) — collective audio cache

- Endpoint: `https://voyo-edge.dash-webtv.workers.dev`
- `/stream?v={youtubeId}` → resolves to an R2 presigned URL or runs extraction + caches + returns.
- `/cdn/art/{id}?quality=high` → thumbnails.
- Read path: `api.checkR2Cache()` → worker returns `{ exists, url, quality }`.
- Write path: workers extract via yt-dlp on miss and upload to R2. ~170K tracks as of last count.
- Also the free replacement for the old Fly.io backend (see `api.ts` header comment).

## PWA & offline

### Service worker strategy

(See "Process model → Service Worker" above for the full table.)

- **Navigation (HTML): network-first.** Non-negotiable — fixes blank-page-on-deploy.
- **Hashed assets: cache-first.** Safe because the hash in the filename is a perfect cache key.
- **Audio: cache-first.** Enables background playback after tab loses network.
- **Other static: stale-while-revalidate.** Icons, images.

### Cache versioning

- **`CACHE_NAME = 'voyo-v6'`** — HTML, JS, CSS, icons, images.
- **`AUDIO_CACHE_NAME = 'voyo-audio-v2'`** — audio blobs.
- **Bump `CACHE_NAME` on every deploy** that ships a new entry bundle. Otherwise returning users get the previous `index.html` pointing at deleted hashed chunks → white screen. The `activate` event deletes any cache name that doesn't match the current two names.

### Offline mode UX

- `public/offline.html` is pre-cached during SW install and served by the navigation fallback when the network is dead and there's no HTML cache entry.
- `components/ui/OfflineIndicator.tsx` shows a transient banner when `navigator.onLine === false`.
- Cached tracks in IndexedDB continue to play; the audio SW cache entries also let uncached tracks continue playing as long as they were streamed once.
- `usePWA.ts` hook exposes install prompt + service worker state to the UI (`InstallButton`).

## File map (the parts that matter)

```
src/
├── main.tsx                  # React + Router entry
├── App.tsx                   # Mode router, error boundary, app-level side effects
├── index.css                 # Tailwind v4 + design tokens
│
├── components/
│   ├── AudioPlayer.tsx       # Single <audio> owner; source resolution + Web Audio chain wiring
│   ├── YouTubeIframe.tsx     # Last-resort iframe fallback for protected content
│   ├── backgrounds/          # Animated background system
│   ├── classic/              # Classic (Spotify-style) mode: ClassicMode, HomeFeed, Library, NowPlaying, Hub
│   ├── voyo/                 # VOYO-native UI
│   │   ├── PortraitVOYO.tsx       # Tab orchestrator (MUSIC | FEED | CREATE | DAHUB)
│   │   ├── VoyoPortraitPlayer.tsx # Main player view (lyrics, waveform, controls)
│   │   ├── LandscapeVOYO.tsx
│   │   ├── VideoMode.tsx
│   │   ├── OyoIsland.tsx          # AI DJ persona UI (oyoDJ consumer)
│   │   ├── ArtistPage.tsx
│   │   ├── TiviPlusCrossPromo.tsx
│   │   ├── VoyoSplash.tsx
│   │   ├── feed/                  # Vertical feed (Moments + VerticalFeed)
│   │   ├── navigation/VoyoBottomNav.tsx
│   │   └── upload/CreatorUpload.tsx
│   ├── dahub/                # Social hub (friends, DMs, shared accounts)
│   │   ├── Dahub.tsx              # Main hub (Promise.allSettled on 4 backends)
│   │   ├── DahubCore.tsx
│   │   ├── VoyoDahub.tsx
│   │   └── DirectMessageChat.tsx
│   ├── player/               # Low-level player UI (PlaybackControls, EnergyWave, BufferHealthIndicator)
│   ├── playlist/PlaylistModal.tsx
│   ├── portal/PortalChat.tsx      # Live listening portal chat
│   ├── profile/ProfilePage.tsx    # /:username route
│   ├── search/                    # SearchOverlayV2 + AlbumSection + VibesSection
│   ├── social/                    # SignInPrompt, VoyoLiveCard
│   ├── ui/                        # BoostButton, OfflineIndicator, InstallButton, LottieIcon, SmartImage
│   └── universe/UniversePanel.tsx # Legacy (still lazy-loaded)
│
├── store/                    # Zustand stores
│   ├── playerStore.ts             # CANONICAL playback state
│   ├── trackPoolStore.ts          # Dynamic scored track pool
│   ├── reactionStore.ts           # Social reactions + hotspots
│   ├── preferenceStore.ts         # Learned user preferences
│   ├── playlistStore.ts           # Local + cloud playlists
│   ├── downloadStore.ts           # IndexedDB offline cache (lazy-loaded)
│   ├── intentStore.ts             # MixBoard intent signals (lazy-loaded)
│   └── universeStore.ts           # DEPRECATED
│
├── services/                 # Stateless functions + singletons
│   ├── audioEngine.ts             # Web Audio singleton + boost chain + buffer monitoring
│   ├── preloadManager.ts          # Next-track lookahead (AbortSignal-aware)
│   ├── mediaCache.ts              # 15-slot LRU audio element cache
│   ├── api.ts                     # Edge worker client (search, stream, R2 check)
│   ├── downloadManager.ts         # IndexedDB wrapper
│   ├── centralDJ.ts               # CANONICAL DJ — Supabase write path
│   ├── databaseDiscovery.ts       # Lazy-loaded Supabase discovery (324K tracks)
│   ├── databaseSync.ts            # Pool-to-Supabase sync
│   ├── personalization.ts         # Pool-aware ranking layer
│   ├── poolCurator.ts             # Pool bootstrapping + periodic curation
│   ├── essenceEngine.ts           # Vibe essence extraction utility
│   ├── piped.ts                   # YouTube/Piped mirror client
│   ├── intelligentDJ.ts           # Cleanup candidate (1 caller)
│   ├── oyoDJ.ts                   # Cleanup candidate (2 callers)
│   ├── feedAlgorithm.ts           # Cleanup candidate (1 caller)
│   ├── lyricsEngine.ts            # CANONICAL lyrics pipeline
│   ├── lrclib.ts                  # lrclib.net (free synced lyrics)
│   ├── geniusScraper.ts           # Genius fallback
│   ├── syncedLyricsService.ts     # Cleanup candidate — merge into lyricsEngine
│   ├── whisperService.ts          # Whisper transcription fallback
│   ├── lexiconService.ts          # Vocab learning
│   ├── trackVerifier.ts           # Track playability verification + startup heal
│   ├── videoIntelligence.ts       # Playback telemetry aggregation
│   ├── momentsService.ts          # Feed "moments" generation
│   ├── feedContentService.ts      # Feed content assembly
│   └── index.ts                   # Barrel
│
├── lib/
│   ├── supabase.ts                # Supabase client + legacy APIs
│   ├── voyo-api.ts                # profileAPI, friendsAPI, messagesAPI, playlistAPI (current)
│   ├── dash-auth.tsx              # DASH Command Center SSO
│   ├── vibeEngine.ts
│   └── dahub/dahub-api.ts         # Dahub-specific APIs + APP_CODES
│
├── hooks/
│   ├── useAuth.ts                 # The only auth hook
│   ├── useArtist.ts
│   ├── useMobilePlay.ts
│   ├── useMiniPiP.ts
│   ├── useMoments.ts
│   ├── usePWA.ts
│   ├── usePageVisibility.ts
│   ├── usePushNotifications.ts
│   └── useThumbnailCache.ts
│
├── providers/AuthProvider.tsx     # Wraps app with DASH auth context
│
├── brain/                    # EXPERIMENTAL — Gemini-powered DJ
│   ├── VoyoBrain.ts               # LLM curator (1 call = ~105 tracks)
│   ├── SignalEmitter.ts           # 60+ signal types
│   ├── SignalBuffer.ts            # Accumulator + trigger conditions
│   ├── SessionExecutor.ts         # Local execution of Brain output
│   ├── YouTubeInterceptor.ts      # Captures YouTube recs as free intelligence
│   ├── BrainIntegration.ts        # Wires into the app
│   └── index.ts                   # Barrel + facade
│
├── scouts/                   # Background knowledge agents (currently DISABLED in App.tsx)
│   ├── HungryScouts.ts
│   ├── DatabaseFeeder.ts          # window.feedDatabase
│   └── KnowledgeIntegration.ts
│
├── knowledge/                # Static knowledge store (artist tiers, mood tags)
│   ├── KnowledgeStore.ts
│   ├── MoodTags.ts
│   └── artistTiers.ts
│
├── data/
│   ├── tracks.ts                  # 41 seed tracks + MOOD_TUNNELS
│   └── artist_master.json         # Artist metadata (chunked as artist_master-*.js)
│
├── types/                    # TypeScript types (index.ts, feed.ts, youtube.d.ts)
│
└── utils/                    # Pure helpers (thumbnail, logger, haptics, mobileAudioUnlock, voyoId, etc.)
```

## Known gotchas

Every load-bearing weirdness future contributors must internalize:

1. **AudioContext singleton** (`services/audioEngine.ts:31-34`). Only ONE `AudioContext` per app. If you call `new AudioContext()` anywhere else, the Web Audio chain will desync silently and half the boost presets will stop working.

2. **`MediaElementAudioSourceNode` can only be created ONCE per audio element.** `createMediaElementSource(audio)` is non-idempotent — calling it twice on the same element throws `InvalidStateError`. `connectAudioChain()` is idempotent by design; always go through it. See `audioEngine.ts:27-30, 100-103`.

3. **iOS AudioContext `'interrupted'` state.** After lock/unlock on iOS (or phone call / Siri activation on iOS+Android), the context transitions to `'interrupted'` and needs a user gesture to resume. `audioEngine.ts:52-56` installs `touchstart` + `click` listeners for exactly this reason. Don't remove them.

4. **`preloadManager` fetch MUST pass AbortSignal.** See commit `eebe619` and "Audio pipeline → CRITICAL" above. Verbatim comment at `services/preloadManager.ts:191-195`. If you add new fetches in this file, wire the per-track signal or you will re-introduce the ~60s zombie-connection crash.

5. **`Dahub.loadData` must use `Promise.allSettled` + `try/finally`.** Commit `eebe619` replaced `Promise.all` + no catch, which would lock `isLoading = true` forever if any one of the 4 backend calls threw. Keep it `allSettled`; per-call `.status === 'fulfilled'` checks; `setIsLoading(false)` in `finally`. See `components/dahub/Dahub.tsx:1058-1093`.

6. **Service worker cache must be bumped on deploy.** Currently at `voyo-v7` + `voyo-audio-v2`. When you ship a new entry bundle (any change to `index-*.js`), bump `CACHE_NAME` in `public/service-worker.js` and redeploy. Otherwise returning users get a stale HTML referencing deleted hashed assets and see a white screen.

7. **`universeStore` is deprecated — don't add new code that touches it.** It remains because `App.tsx` still handles the legacy DASH callback through it (`handleDashCallback()` on line 979) and `playerStore`/`preferenceStore` still import it for migration glue. Any new auth/profile/friend work goes through `useAuth()` and `voyo-api.ts`.

8. **Multiple stores hold queue-like state** — `playerStore.queue` (the canonical now-playing queue), `downloadStore` (cached tracks), `trackPoolStore` (scored pool), `intentStore` (mode intent). **`playerStore` is the one source of truth for "what plays next"**; the others are secondary aspects. Do not derive `currentTrack` from anywhere except `playerStore`.

9. **`databaseDiscovery` must stay lazy-imported** in `playerStore.ts`. Static import causes a TDZ crash because `databaseDiscovery` transitively imports `essenceEngine` which imports things that eventually loop back. The `getDatabaseDiscovery()` helper at `playerStore.ts:35-41` is the correct pattern.

10. **Do not add manual chunks for `src/store/*`** in `vite.config.ts`. A previous attempt (commit `53b0b9c`) caused a circular-init crash because store modules have mutual dynamic imports. Let Vite handle it.

11. **`currentTrackAbortController` is module-scoped** in `playerStore.ts` (line ~49), not Zustand state. Any async inside `setCurrentTrack` that touches state must check `signal.aborted` first or you will get "zombie" state from a cancelled track change landing on top of a new one.

12. **Stores use `persist` middleware in Zustand** for `preferenceStore`, `trackPoolStore`, `intentStore`, `downloadStore`, `playlistStore`. `playerStore` does NOT use `persist` — it uses a custom localStorage scheme because it needs surgical control over what hydrates (it deliberately stores track IDs, not full track objects, to avoid stale data after artist/title updates).

13. **Splash screen is gated on a `sessionStorage` key (`voyo-splash-v3`)**, not localStorage. Intentional — shows once per tab session, not once ever. Don't "fix" it to localStorage.

## Cleanup roadmap (post April 2026 sweep)

Status of items the audits surfaced. **Don't trust audit reports without
reading the actual code first** — about half of the candidates that came
back from automated audits were false positives (see Lessons section).

### ✅ Done in April 2026
1. ✅ **Lazy-load the Brain subsystem.** `a4c2503` — `initializeBrainIntegration` is now dynamic-imported via `requestIdleCallback` in `App.tsx`. Removed the `manualChunks(/brain/) → 'app-brain'` rule from `vite.config.ts` so Vite can split it as a real lazy chunk. Initial bundle dropped ~52 KB, total bundle dropped ~15 KB after dedupe. The dead `./scouts` static imports were also removed (only used in commented-out useEffect).
2. ✅ **Archive stale root markdown.** `d97c005` — 71 → 29 root files. 43 docs moved to `docs/archive/`. Animation guides, Neon research, session notes, plans, duplicates all archived.
3. ✅ **Audio crash root cause.** `eebe619` — `preloadManager.ts:191` was missing `signal:` on the Edge Worker fetch. Stale fetches drained the per-host connection pool on rapid skips, causing ~60s recovery (the "stabilizes after rest" symptom). Round 2 (`5c51a76`) added `AbortSignal.any([signal, AbortSignal.timeout(5000)])` so a slow Edge Worker can't hang.
4. ✅ **dahub login freeze.** `eebe619` — `Dahub.loadData()` had `Promise.all` + no try/catch. Replaced with `Promise.allSettled` + `try/finally` so a single failing backend can't lock the spinner.
5. ✅ **AudioPlayer loadTrack race condition.** `b4044d3` — `useEffect` had 10+ await points with no cancellation guard. Added `loadAttemptRef` monotonic counter + `isStale()` checks at every await boundary so a slow R2/Edge fetch for an old track can't clobber `audio.src` after a skip.
6. ✅ **Console noise.** `b4044d3` — 459 → 0 raw `console.log/warn` calls in `src/`. Mass-converted to the existing `devLog`/`devWarn` utility (which `import.meta.env.DEV`-gates and tree-shakes in production). ~14 KB shaved from production bundle.
7. ✅ **Dead code.** `eebe619` — `voyoDJ.ts` (19 KB) and `geminiCurator.ts` (16 KB) deleted, both 0 imports anywhere.
8. ✅ **Service worker error caching.** `5c51a76` — navigation request handler now requires `response.ok && response.status === 200` before caching. Was caching 4xx/5xx responses → bricking the app on origin hiccups.
9. ✅ **UniversePanel handlers.** `5c51a76` — added try/catch/finally + idempotency guards to `handleSaveProfile` and `handleTogglePortal`.
10. ✅ **Production audit round 2 polish.** `5c51a76` — `lyricsEngine` swallowed-catch fixed, `BoostButton` setTimeout cleanups, `audioEngine` two production logs gated.

### 🟡 Verified false positives — DO NOT touch
These came back from audits as "delete this" or "fix this" but turned out to already be correct on inspection. Documented here so the next audit doesn't waste time re-flagging them:

- `databaseDiscovery.ts` — flagged as 0-callers. Actually lazy-imported via `playerStore.ts::getDatabaseDiscovery` (line 35) and called from the discovery refresh flow. **Load-bearing.** Deleting it crashes the discovery feed.
- `syncedLyricsService.ts` — flagged as dead. Actually imported by `lyricsEngine.ts:24` and called at line 339 (`fetchByYoutubeId`). **Load-bearing.**
- `universeStore.ts` — flagged as deprecated. Has 6 lazy imports in `playerStore.ts` (`isPortalOpen`, `updateNowPlaying`, `isLoggedIn`, `syncToCloud`) plus DASH auth callback in `App.tsx:979`. **Load-bearing.** The "deprecated" label is aspirational, not actual.
- `useThumbnailCache.ts` JSON.parse — flagged as needing try/catch. Already wrapped at lines 22-40, returns `{}` on error.
- `mediaCache.ts` `audioElements` Map — flagged as unbounded. Already LRU-bounded at `MAX_CACHE_SIZE = 15` with proper eviction at line 365.
- `playerStore.ts` `connection.addEventListener('change')` — flagged as accumulating leak. Already guarded by `listenerAttached` flag at line 1398, store is a singleton.

### 🔴 Still open (real, not yet fixed — ranked by leverage)

1. **Wire surfaces back to OYO DJ.** This is the architectural North Star: one brain (`oyoDJ`), N branches (UI surfaces). Currently `oyoDJ.ts` (879 lines) has only **2 callers** in the codebase: `AudioPlayer.tsx` (uses `onTrackPlay`/`onTrackComplete`) and `OyoIsland.tsx` (uses `getProfile` read-only). The other event hooks (`onTrackSkip`, `onTrackReaction`), the speech (`speak`, `say`, `introduce`, `vibeCheck`), the insights, the social — all dormant. Each tab / surface should route events through `oyoDJ` so it learns, AND display its voice/personality output. See the OYO DJ section.

2. **Deprecate `universeStore` (medium effort)** — for real this time. Steps: (a) move `handleDashCallback()` out of universeStore into `lib/dash-auth.tsx`, (b) migrate the 6 `playerStore` lazy-imports to a thinner Hub-side API or to `dash-auth.tsx`, (c) only THEN can the file go away. Don't rip it out without the migration or playback breaks.

3. **Consolidate DJ engines into `centralDJ` (or `oyoDJ`).** `centralDJ` (canonical, 5 callers), `intelligentDJ` (1 caller), `oyoDJ` (2 callers, dormant), `feedAlgorithm` (1 caller). The product owner's vision treats `oyoDJ` as the central brain — the simplest collapse is to merge `centralDJ`'s curation logic INTO `oyoDJ` so there's one service that does both curation AND personality.

4. **Consolidate `syncedLyricsService` into `lyricsEngine`.** Trivial (1 caller, 126 lines, same domain).

5. **`VoyoPortraitPlayer.tsx` is 5072 lines.** Single biggest hot-spot in the codebase. Split into smaller pieces — at minimum extract the MixBoard, the lyrics drawer, and the reaction layer.

### Other nice-to-haves (lower priority)
- Break `App.tsx` (~1,410 lines) into `App.tsx` + `AppModeRouter.tsx` + `AppSideEffects.tsx` + `DynamicIsland.tsx`.
- Break `playerStore.ts` into slices (playback / queue / discovery / reactions / streaming config).
- Break `Dahub.tsx` into `DahubShell` + tab content files.
- Smoke test for the audio pipeline (rapid skip → verify no connection pool exhaustion). Prevents regressions of gotcha #4.

## OYO DJ — the central brain (current state + winning architecture)

The product owner's vision is **one brain (OYO DJ) with N branches (UI surfaces)**. Every surface should tie back to OYO DJ as both an event sink (so it learns from interactions) and a personality voice (so it speaks back through the UI). Below is the current state, the gap, and the path.

### What OYO DJ actually is today

`src/services/oyoDJ.ts` — 879 lines. **It's a personality layer, not a curator.** It manages:
- DJ identity (`name`, `nickname`, `personality traits`, `catchphrases`, `voice settings`)
- Learned preferences (`favoriteArtists`, `favoriteMoods`, `peakListeningHours`, `dislikedArtists`)
- Track lifecycle event handlers (`onTrackPlay`, `onTrackSkip`, `onTrackReaction`, `onTrackComplete`)
- Voice output (`speak`, `say`, `introduce`, `vibeCheck` — uses Web Speech API + Gemini for announcements)
- Social (`shareMoment`, `getSharedMoments`, `setPublicProfile`)
- Insights (`getInsights()` returns favouriteArtists/favouriteMoods/peakHours)

**What it does NOT do today**: pick tracks. The hot belt and discovery belt are populated by `databaseDiscovery` → `essenceEngine` (via `playerStore.refreshRecommendations`), with secondary input from `centralDJ`, `personalization`, and `poolCurator`. Three competing curation systems, none of which feed through OYO.

### Current call sites (verified)

| File:line | Function | Purpose |
|---|---|---|
| `components/AudioPlayer.tsx:39` | `onTrackPlay`, `onTrackComplete` | Already wired. Records playback events. |
| `components/voyo/OyoIsland.tsx:18` | `getProfile()` | Read-only — pulls DJ identity for the Island UI. |
| `store/reactionStore.ts` (NEW) | `onTrackReaction(track)` | Wired in `eebe619`'s sibling commit. Reactions now feed `favoriteArtists`. |
| `store/playerStore.ts` (NEW) | `getInsights()` | Wired in the same commit. Hot belt is now sorted with OYO favourites first. |

### The 4 surfaces (not 6 — the agent verified the count)

The branches the product owner imagined as "6 surfaces of experience" are **actually 4 in the codebase today**, each tied to an `App.tsx` mode lazy chunk:

1. **Classic Mode** (`components/classic/ClassicMode.tsx`) — sub-surfaces: `HomeFeed`, `Library`, `Hub`, `NowPlaying`. Reads from `playerStore.hotTracks` + `personalization.getPoolAwareHotTracks`. Connection to OYO DJ: **VIA-STORE** now that hotTracks is OYO-sorted.
2. **Portrait VOYO** (`components/voyo/PortraitVOYO.tsx`) — tab orchestrator: `MUSIC | FEED | CREATE | DAHUB`. The MUSIC tab renders `VoyoPortraitPlayer` (3-column grid: HOT | VOYO FEED | DISCOVERY). Connection: **VIA-STORE** for HOT, **TRANSITIVE** for everything else (OyoIsland imports `getProfile` for personality display, no event hooks).
3. **Landscape VOYO** (`components/voyo/LandscapeVOYO.tsx`) — full-screen player + side panels, auto-activated on rotation. Same data sources as Portrait. Same connection.
4. **Video Mode** (`components/voyo/VideoMode.tsx`) — full-screen video playback with floating reactions overlay. Connection to OYO DJ: **NONE** today. Reactions land in `reactionStore` but VideoMode never imports oyoDJ.

`CREATE` tab is hidden until backend is ready. Brain subsystem (`src/brain/`) is lazy-loaded but its outputs are **not yet consumed** by the playback path — see Cleanup roadmap #1.

### Disconnected surfaces (real wiring gaps)

1. **`HomeFeed` (Classic Mode)** — calls `personalization.getPoolAwareHotTracks` directly instead of reading `playerStore.hotTracks`. The OYO boost in `playerStore` doesn't reach HomeFeed because HomeFeed bypasses the store. **Fix**: route HomeFeed through `playerStore.hotTracks` so it inherits the OYO sort. Medium effort.
2. **`VoyoMoments` feed** — uses `useMoments()` → `momentsService`, no OYO context at all. Could weave OYO catchphrases between moments using `oyoDJ.say()`. Medium effort, low risk.
3. **`VideoMode` reactions** — records to `reactionStore` but never feeds OYO. Now resolved indirectly because `reactionStore.createReaction` calls `oyoDJ.onTrackReaction` for ALL surfaces (not just VideoMode) — Video gets the wiring for free.
4. **`VoyoPortraitPlayer` lyrics moments** — `lyricsEngine` displays text but doesn't call `oyoDJ.introduce()` or `oyoDJ.say()`. Could surface DJ commentary at lyrical pauses. Low priority.

### Curation services consolidation (where this is heading)

| Service | Callers | Role today | Target role |
|---|---|---|---|
| **`oyoDJ`** | 4 (after this commit) | Personality + learning | **Promoted to unified DJ.** Ingests all signals. Outputs: `favoriteArtists` boost on `playerStore.hotTracks`, voice on every surface. |
| `centralDJ` | 5 | Vibe-to-track Supabase signal logger | Keep as canonical Supabase writer. Add `getSignalContext()` so OYO can read historical vibes. |
| `intelligentDJ` | 1 (AudioPlayer:38) | Gemini-powered DJ flywheel after every N plays | **KEEP** — verified by inspection. The agent flagged it for deletion but it runs `runDJ()` which is the Gemini discovery loop. Not redundant. |
| `personalization` | 3 | Per-track/artist/mood weights | Subordinate to OYO. Provides preference WEIGHTS that OYO consumes. |
| `poolCurator` | 3 | Living pool bootstrap + scoring refresh | Keep unchanged. |
| `feedAlgorithm` | 1 | Feed timing/treatment for VoyoMoments | Could merge into `momentsService`. Low priority. |
| `databaseDiscovery` | 1 (lazy) | Supabase essence-fingerprint search | **KEEP — load-bearing.** Lazy-imported by playerStore. The agent flagged this for deletion in TWO separate audits and it was wrong both times. |
| `geminiCurator`, `voyoDJ` | — | — | **DELETED** in `eebe619` (truly 0 callers). |

### The winning architecture

```
                    ┌──────────────────────────────┐
                    │   ONE BRAIN — OYO DJ         │
                    │   (services/oyoDJ.ts)        │
                    │                              │
                    │  Learns from:                │
                    │   • play / complete          │
                    │   • skip                     │
                    │   • reaction (OYÉ)           │
                    │   • peak hours, moods        │
                    │                              │
                    │  Outputs:                    │
                    │   • favoriteArtists  ──┐     │
                    │   • voice (Web Speech) ─┐    │
                    │   • milestones, social  │    │
                    └──────────┬──────────────┴────┘
                               │ getInsights()    │ speak() / say()
              ┌────────────────┼──────────────────┘
              │   playerStore  │
              │   .hotTracks   │
              │   (OYO-sorted) │
              └────────┬───────┘
                       │
   ┌──────────┬────────┼────────────┬────────────┐
   │          │        │            │            │
┌──▼────┐  ┌──▼────┐  ┌▼─────────┐  ┌▼─────────┐  ┌▼─────────┐
│Classic│  │Portr. │  │Landscape │  │  Video   │  │ Dahub    │
│ Home  │  │ VOYO  │  │  VOYO    │  │   Mode   │  │ (social) │
│ Lib   │  │MUSIC  │  │          │  │          │  │          │
│ Hub   │  │FEED   │  │          │  │          │  │          │
└───────┘  │CREATE │  └──────────┘  └──────────┘  └──────────┘
           │DAHUB  │
           └───────┘
   All surfaces:
   • read playerStore.hotTracks (OYO-sorted)
   • emit reactions → oyoDJ.onTrackReaction → favoriteArtists ↑
   • emit plays → oyoDJ.onTrackPlay → peakHours ↑, totalTime ↑
   • emit completes → oyoDJ.onTrackComplete → favoriteMoods ↑

   Supporting (no UI ownership):
   • databaseDiscovery — Supabase essence search (lazy, load-bearing)
   • centralDJ — Supabase signal write path
   • intelligentDJ — Gemini DJ flywheel (every N plays)
   • personalization — preference weights
   • poolCurator — living pool bootstrap
```

### What landed in this commit (the OYO wiring round)

- **`reactionStore.createReaction`** now calls `oyoDJ.onTrackReaction(track)` after every reaction (offline path AND Supabase path). This is the critical wire — without it, `favoriteArtists` stays empty forever and the boost below is a no-op.
- **`playerStore.refreshRecommendations`** now reads `oyoDJ.getInsights().favoriteArtists` and stable-sorts the merged hot belt with favourites first. New users (empty list) see no behaviour change. Returning users see their reaction history bubble to the top of every surface that reads `hotTracks` (Portrait MUSIC, Landscape, Dahub previews).
- **No tracks are removed**, only reordered. The MAX_HOT_POOL cap (50) is unchanged. Discovery is intentionally NOT OYO-sorted (it's the diversity channel).

### Done in commit `2e4c277`

1. ✅ **Route `HomeFeed` Made-For-You through OYO** — turned out HomeFeed already read `playerStore.hotTracks` but then re-sorted by `calculateBehaviorScore`, destroying the OYO sort. Fixed with a two-tier stable sort: favourites first (by behavior within), non-favourites second (also by behavior within). Preserves both signals. Empty favourites list (new user) → no behavior change.
2. ✅ **Wire `onTrackSkip` at the `playerStore.nextTrack` boundary** — every surface that skips (Portrait MUSIC, Landscape, Classic Mode NowPlaying, queue advance, hotkey) goes through `nextTrack()`, so wiring `oyoOnTrackSkip` at the same place where skip-vs-completion is already detected gives universal coverage. After 3 skips of the same artist, OYO appends to `dislikedArtists`.

### Still open

1. **Surface OYO voice in the UI** — `OyoIsland` displays `getProfile()` but doesn't render `speak()` output. Add a small subtitle/toast that shows the latest DJ utterance.
2. **Promote OYO from sort-only to merge-source** — the next step beyond sorting is having OYO actually CONTRIBUTE tracks to the hot pool from its `favoriteArtists` (e.g., fetch the user's top 5 favourites' latest releases and inject them).
3. **Wire Brain outputs into OYO** — `sessionExecutor.getHotBelt()` produces a curated belt that nothing reads. Either consume it (and Brain becomes load-bearing) or delete the Brain subsystem entirely (it's currently lazy-loaded for ~38 KB). Decide which.

## Lessons from the April 2026 cleanup

These are the rules that got beaten into the codebase across 4 production
commits. Every one corresponds to a real bug we paid for. Read them before
touching anything in `services/`, `store/`, or the audio path.

### 1. Never trust an audit without reading the actual code

**~50% of automated audit findings were false positives.** Three rounds of
audits flagged "delete this dead service" or "fix this missing try/catch",
and roughly half turned out to be already-handled (try/catch already there,
LRU bound already enforced) or simply wrong about who-imports-what (lazy
imports invisible to static grep).

**The protocol:** when an audit (human OR AI) flags a fix, the FIRST step
is `Read` the file at the cited line and verify the bug exists. The second
step is verify the surrounding context. Only the third step is shipping a
fix. Document false positives in commit messages so the next audit doesn't
re-flag the same things.

### 2. Every fetch in the track lifecycle MUST pass an AbortSignal

Voyo had a missing `signal:` on the Edge Worker stream fetch in
`preloadManager.ts`. Symptom (which Dash reported verbatim): *"sound
crashes, stabilizes after rest."* Cause: rapid skips left zombie fetches
draining the per-host connection pool. Recovery only happened after ~60s
of GC + TCP timeout.

**The rule:** every `fetch()` in the player path takes the per-track signal.
For services that aren't track-scoped, use `AbortSignal.timeout(N)` standalone.
For paths that need both (track skip OR slow upstream), combine via
`AbortSignal.any([signal, AbortSignal.timeout(5000)])`. The audit comment
at `services/preloadManager.ts:191-205` is load-bearing documentation.

### 3. `Promise.all` without try/catch in loading flows = guaranteed freeze

`Dahub.loadData()` had `Promise.all` over 4 backend calls with no try/catch.
A single failing call left `setIsLoading(true)` permanently set — UI froze
on the spinner forever, looked like the app crashed. Fix: `Promise.allSettled`
+ per-call `if (status === 'fulfilled')` + `try/finally` so `setIsLoading(false)`
always runs.

**The rule:** anywhere you fan out backend calls to render a screen, use
`Promise.allSettled`. `Dahub.tsx:1058-1093` is the canonical pattern.

### 4. `console.log` ships to production unless it's `devLog`

The `src/utils/logger.ts` utility has existed for a while, but only 4 files
were using it. The other 50+ files dumped 459 raw `console.log/warn` calls
straight into the production bundle. After `b4044d3` the count is **zero**
at line-start.

**The rule:** new code uses `devLog` / `devWarn` (tree-shaken in prod) for
diagnostics. `console.error` is preserved for actual errors that should
reach production logs. If you mass-add files, run this and the answer
should stay 0:

```bash
grep -rE "^\s*console\.(log|warn)" src/ --include="*.ts" --include="*.tsx" | wc -l
```

### 5. Manual chunking is a footgun for dynamic imports

Vite's `manualChunks` rule pulls files into a named chunk regardless of
how they're imported. If you also `await import('./brain')`, Vite still
preloads the named chunk via `<link rel="modulepreload">` because the
chunk exists in the entry's module graph. Result: you THINK Brain is
lazy, the network panel says it's eager.

**The rule:** for code paths you want to be truly lazy, drop the
`manualChunks` rule for that path AND use `await import()`. Only force-chunk
pure vendors (`vendor-react`, `vendor-supabase`, `vendor-icons`,
`vendor-zustand`). Stores stay un-chunked because they have circular
runtime imports — `manualChunks(/store/)` caused commit `53b0b9c`'s
"circular dep killed app" crash.

### 6. Whisper truncation is a category, not a one-off

Documented in Meetel Flow but applies anywhere we send audio to a Whisper
model. Whisper's decoder treats trailing silence as the no-speech region
and eats the last syllable. Fix: pad audio with zero samples on both
ends before encoding. ~25 KB extra per dictation, fixes the "missing
last word" complaint that plagues every Whisper-based dictation tool.

(Voyo's `whisperService.ts` is for hum-to-search, not dictation, so
the same padding isn't required — but if you ever build a feature that
sends a whole utterance to Whisper, remember the rule.)

## Roadmap notes

**Where the codebase is heading**:

- **AI-DJ work is ongoing.** `centralDJ` is the target consolidation point. The `brain/` subsystem is experimental and intended to eventually replace or subsume the DJ services once the LLM curation pattern is proven. Not blocking.
- **Brain subsystem is experimental.** Currently loaded on every page because `initializeBrainIntegration()` is called from `App.tsx:1029`. It should move to lazy + idle initialization (see cleanup roadmap #4). Its output is partially consumed (belts are exposed via `sessionExecutor.getHotBelt()` / `getDiscoveryBelt()`) but the main playback path still reads from `playerStore.hotTracks` / `discoverTracks` fed by `databaseDiscovery`, not from Brain. Wiring the two together cleanly is the long-term move.
- **Scouts are disabled** (`App.tsx:1044-1053`). The rationale in the comment: "HungryScouts make 64+ YouTube API calls per session; with 324K tracks in Supabase we don't need real-time scouting." Re-enable once YouTube API quota management is in place.
- **DASH Command Center SSO** has already landed. The cleanup is finishing the `universeStore` migration.
- **West Africa conquest**: the product roadmap targets Guinea → Liberia → Sierra Leone → Senegal → Ivory Coast. The codebase reflects this in seed data (`data/tracks.ts` is ~40 African bangers) and curation queries (`WEST_AFRICAN_QUERIES` in `poolCurator.ts`).
- **Cleanup needs are real but not blocking.** The audit path is: ship user-facing improvements; pay down debt in dedicated sweeps like `eebe619`; keep this doc as the single source of architectural truth.
