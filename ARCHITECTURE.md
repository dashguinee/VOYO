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

6. **Service worker cache must be bumped on deploy.** Currently at `voyo-v6` + `voyo-audio-v2`. When you ship a new entry bundle (any change to `index-*.js`), bump `CACHE_NAME` in `public/service-worker.js` and redeploy. Otherwise returning users get a stale HTML referencing deleted hashed assets and see a white screen.

7. **`universeStore` is deprecated — don't add new code that touches it.** It remains because `App.tsx` still handles the legacy DASH callback through it (`handleDashCallback()` on line 979) and `playerStore`/`preferenceStore` still import it for migration glue. Any new auth/profile/friend work goes through `useAuth()` and `voyo-api.ts`.

8. **Multiple stores hold queue-like state** — `playerStore.queue` (the canonical now-playing queue), `downloadStore` (cached tracks), `trackPoolStore` (scored pool), `intentStore` (mode intent). **`playerStore` is the one source of truth for "what plays next"**; the others are secondary aspects. Do not derive `currentTrack` from anywhere except `playerStore`.

9. **`databaseDiscovery` must stay lazy-imported** in `playerStore.ts`. Static import causes a TDZ crash because `databaseDiscovery` transitively imports `essenceEngine` which imports things that eventually loop back. The `getDatabaseDiscovery()` helper at `playerStore.ts:35-41` is the correct pattern.

10. **Do not add manual chunks for `src/store/*`** in `vite.config.ts`. A previous attempt (commit `53b0b9c`) caused a circular-init crash because store modules have mutual dynamic imports. Let Vite handle it.

11. **`currentTrackAbortController` is module-scoped** in `playerStore.ts` (line ~49), not Zustand state. Any async inside `setCurrentTrack` that touches state must check `signal.aborted` first or you will get "zombie" state from a cancelled track change landing on top of a new one.

12. **Stores use `persist` middleware in Zustand** for `preferenceStore`, `trackPoolStore`, `intentStore`, `downloadStore`, `playlistStore`. `playerStore` does NOT use `persist` — it uses a custom localStorage scheme because it needs surgical control over what hydrates (it deliberately stores track IDs, not full track objects, to avoid stale data after artist/title updates).

13. **Splash screen is gated on a `sessionStorage` key (`voyo-splash-v3`)**, not localStorage. Intentional — shows once per tab session, not once ever. Don't "fix" it to localStorage.

## Cleanup roadmap (post-eebe619)

Ranked by leverage × effort ratio. None of these are blocking; they're technical debt to pay down before the codebase gets bigger.

1. **Deprecate `universeStore` entirely.** Medium effort. Steps: (a) move `handleDashCallback()` out of universeStore into `lib/dash-auth.tsx`, (b) remove the `universeAPI` references in `playerStore`/`preferenceStore` (migrate any remaining reads to `voyo-api.ts`), (c) delete `universeStore.ts` and the `universes` Supabase table reads, (d) also delete `components/universe/UniversePanel.tsx` if unused elsewhere. Unlocks a cleaner auth story.

2. **Consolidate DJ engines into `centralDJ`.** Merge:
   - `intelligentDJ.ts` → fold `recordPlay` into `centralDJ.signals.play`.
   - `oyoDJ.ts` → fold DJ profile into `preferenceStore`, fold track callbacks into `centralDJ`.
   - `feedAlgorithm.ts` → inline `applyTreatment`/`getStartTime`/`getDuration` into `VoyoVerticalFeed` or move to `momentsService`.
   - Result: one DJ service, one `signals` interface, ~2000 fewer lines, no more "which DJ am I looking at" confusion.

3. **Consolidate `syncedLyricsService` into `lyricsEngine`.** 1 caller, 126 lines. Trivial.

4. **Lazy-load the Brain subsystem.** Currently eagerly imported in `App.tsx` (`initializeBrainIntegration`). Moving to dynamic import would shave ~60 KB off the initial bundle (the whole `app-brain-*.js` chunk is 116 KB). The Brain is experimental and not load-bearing for Day 1 UX. Wrap its init in a `setTimeout` or `requestIdleCallback` after first user interaction.

5. **Archive stale markdown files.** ~25 out of 65 root markdown files are pre-migration notes or one-off session logs (see "Loose docs at root" below). Move to `/docs/archive/YYYY-MM/`.

Other nice-to-haves (lower priority):
- Break `App.tsx` (1,410 lines) into `App.tsx` + `AppModeRouter.tsx` + `AppSideEffects.tsx` + `DynamicIsland.tsx`.
- Break `playerStore.ts` (1,410 lines) into slices (playback / queue / discovery / reactions / streaming config).
- Break `Dahub.tsx` (1,285 lines) into `DahubShell` + tab content files.
- Start a smoke test for the audio pipeline (rapid skip → verify no connection pool exhaustion). Prevents regressions of gotcha #4.

## Loose docs at root

65 markdown files live at `/home/dash/voyo-music/` root. Most are one-shot research notes or stale plans. Grouped by topic, with keep/archive recommendations:

### Keep (canonical / current)
- `ARCHITECTURE.md` (this file)
- `README.md`
- `DAHUB_ARCHITECTURE.md` (if still matches current dahub code — verify before keeping)
- `MIGRATION_NORTHSTAR.md`
- `NORTH_STAR_WEEK_JAN22_2026.md`
- `whats-next.md`

### Archive — Animation research (6 files, one project)
- `ANIMATION_DOCS_INDEX.md`, `ANIMATION_IMPLEMENTATION_GUIDE.md`, `ANIMATION_PATTERNS_RESEARCH.md`, `ANIMATION_QUICK_REFERENCE.md`, `ANIMATION_START_HERE.txt`, `README_ANIMATIONS.md`

### Archive — Framer Motion research (5 files, redundant with above)
- `FRAMER_MOTION_ADVANCED_GUIDE.md`, `FRAMER_MOTION_ADVANCED_TECHNIQUES.md`, `FRAMER_MOTION_CHEAT_SHEET.md`, `FRAMER_MOTION_RESEARCH_INDEX.md`

### Archive — Neon effects research (7 files, one project)
- `NEON_ADVANCED_PATTERNS.md`, `NEON_CHEAT_SHEET.txt`, `NEON_INDEX.md`, `NEON_MANIFEST.txt`, `NEON_QUICK_REFERENCE.md`, `NEON_RESEARCH.md`, `README_NEON.md`

### Archive — Old architecture / plans
- `ARCHITECTURE_INTENT_ENGINE.md`, `ARCHITECTURE_LLM_DJ.md` (now covered in this file)
- `AUDIO_CONQUEST_SAUCE.md`, `AUDIO_PIPELINE.md`, `AUDIO_UPLOAD_RESUME.md` (audio pipeline now documented here)
- `CONTENT_STRATEGY.md`, `CHANGES.md`, `DEPLOYMENT_CHECKLIST.md`
- `DYNAMICISLAND-NOTIFICATIONS.md`
- `ENRICHMENT_STRATEGY.md`
- `EXECUTION_PLAN.md`, `PLAN.md`
- `IMPLEMENTATION-SUMMARY.md`, `IMPLEMENTATION_SUMMARY.md`, `INTEGRATION_GUIDE.md`
- `MULTI_ACCOUNT_SETUP.md`
- `NEXT-SESSION-CONTEXT.md`
- `OFFLINE_MODE.md` (covered here)
- `OPTIMIZATION_WIRING_REPORT.md`, `PRODUCTION_OPTIMIZATIONS.md`
- `PIPED_ALBUMS_INTEGRATION.md`
- `PLAYBACK_CONTROLS.md`, `PLAYBACK_FEATURES_SUMMARY.txt`
- `PREFERENCE_ENGINE_README.md` (covered here)
- `PREMIUM_APP_COMPARISON.md`
- `QUICK-START.md`, `QUICK_START.md` (duplicates)
- `RECOVERY_CHECKPOINT.md`, `RESCUE.md`, `RESUME.md`, `SSO_RESUME.md`
- `ROADMAP-DJ-LLM.md`, `ROADMAP-RELEASE.md`
- `SCALING_STRATEGY.md`
- `SEARCH_OPTIMIZATION_REPORT.md`
- `START_HERE.md`, `START_HERE.txt`
- `STEALTH-MODE.md`, `STEALTH-VERIFICATION.txt`
- `TEAM_DEPLOYMENT.md`
- `TEST_DYNAMIC_SEARCH.md`, `TEST_PREFERENCES.md`
- `VOYO-VISION.md`, `VOYO_VISION.md` (duplicates)
- `VOYO_GAME_PLAN.md`, `VOYO_VIBES_PLAN.md`
- `ZION_CHAT.md`, `ZION_COORDINATION.md`

Destination: `/home/dash/voyo-music/docs/archive/2026-04/`. Do not delete — some contain the only written trail of why things are the way they are. Archive = git-preserved demotion.

## Roadmap notes

**Where the codebase is heading**:

- **AI-DJ work is ongoing.** `centralDJ` is the target consolidation point. The `brain/` subsystem is experimental and intended to eventually replace or subsume the DJ services once the LLM curation pattern is proven. Not blocking.
- **Brain subsystem is experimental.** Currently loaded on every page because `initializeBrainIntegration()` is called from `App.tsx:1029`. It should move to lazy + idle initialization (see cleanup roadmap #4). Its output is partially consumed (belts are exposed via `sessionExecutor.getHotBelt()` / `getDiscoveryBelt()`) but the main playback path still reads from `playerStore.hotTracks` / `discoverTracks` fed by `databaseDiscovery`, not from Brain. Wiring the two together cleanly is the long-term move.
- **Scouts are disabled** (`App.tsx:1044-1053`). The rationale in the comment: "HungryScouts make 64+ YouTube API calls per session; with 324K tracks in Supabase we don't need real-time scouting." Re-enable once YouTube API quota management is in place.
- **DASH Command Center SSO** has already landed. The cleanup is finishing the `universeStore` migration.
- **West Africa conquest**: the product roadmap targets Guinea → Liberia → Sierra Leone → Senegal → Ivory Coast. The codebase reflects this in seed data (`data/tracks.ts` is ~40 African bangers) and curation queries (`WEST_AFRICAN_QUERIES` in `poolCurator.ts`).
- **Cleanup needs are real but not blocking.** The audit path is: ship user-facing improvements; pay down debt in dedicated sweeps like `eebe619`; keep this doc as the single source of architectural truth.
