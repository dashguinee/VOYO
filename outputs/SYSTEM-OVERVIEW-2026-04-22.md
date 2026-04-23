# VOYO Audio District — System Overview (2026-04-22)

Canonical current-state document for the VOYO Music audio pipeline after
today's 30+ commit reliability sweep. Supersedes `AUDIO-PIPELINE-INVENTORY.md`
(archived). Read this first when touching anything audio.

---

## The invariant

**While `store.isPlaying === true`, the `<audio>` element is ALWAYS
playing something** — a real track, or bgEngine's silent WAV keeper.
Never idle. The OS therefore never revokes audio focus; BG return
finds a live session.

Corollary: **OYO never stops.** When a track ends, `nextTrack()` selects
from queue → repeat → discoverTracks → hotTracks → TRACKS seed → (as a
last resort) loops the current track while firing `refreshRecommendations()`
in the background. No silent-stall end-state.

---

## Layer map

```
┌─────────────────────────────────────────────────────────────────┐
│  User action (tap, gesture, OS media control, BG watchdog)      │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  playerStore.ts (Zustand)                                        │
│    • currentTrack, queue, history, isPlaying, playbackSource     │
│    • nextTrack(): queue → repeat → discover → hot → TRACKS       │
│      — auto-refills pool when ≥50% filtered                      │
│      — always addToHistory on advance (no currentTime guard)     │
│      — exclusion window: last-40 tracks                          │
│    • refreshRecommendations(): pulls from databaseDiscovery,     │
│      merges into hot/discover, sorts by favoriteArtists          │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  AudioPlayer.tsx (React component, singleton at App root)        │
│    • useAudioChain → Web Audio graph                             │
│    • useBgEngine   → BG invariant (see below)                    │
│    • useWakeLock   → keeps screen awake while playing            │
│    • useHotSwap    → iframe↔R2 crossfade                         │
│    • handleTimeUpdate: at 50% fires predictive pre-warm          │
│      (ensureTrackReady on next track at priority 7)              │
│    • handleEnded: engages silent-WAV bridge before nextTrack()   │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  <audio> element + YouTube iframe (both singletons)              │
│    • audio el: R2 direct playback via MediaElementAudioSourceNode│
│    • iframe  : YouTube fallback when R2 not yet extracted        │
│    • hot-swap: 2s equal-power crossfade iframe → audio when R2   │
│      extraction lands (via Realtime channel + 2s poll fallback)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## bgEngine — BG-playback orchestration

Single module (`src/audio/bg/bgEngine.ts`) that owns every BG
mitigation. Originally written for v198, removed in the VPS-streaming
switch, restored today.

### What it runs

1. **Silent WAV keeper**: 2s 8kHz mono WAV (~16KB blob) looped during
   transitions. `engageSilentWav('ended_advance', trackId)` called from
   `AudioPlayer.handleEnded` just before `nextTrack()`. Element never
   reaches idle, OS never revokes audio focus.

2. **Capture-phase visibility handler**: fires BEFORE the browser's
   pause event during hide transitions. Sets `isTransitioningToBackground`
   flag (synchronous) so onPause doesn't clobber `store.isPlaying=false`.

3. **Battery-suspend timer** (5s): suspends AudioContext only when
   `paused + hidden` for 5s. Cancels on play or unhide. NEVER suspends
   while playing.

4. **MessageChannel heartbeat** (~4s cadence): NOT throttled in BG
   (setTimeout IS, setInterval IS; MC isn't). Every tick:
   - **MediaSession keep-alive** — `setPositionState` + `playbackState`
   - **AudioContext resume** — if suspended/interrupted
   - **Gain rescue** — if master gain stuck near zero while playing
   - **Silent-paused kick** — if element paused but store says playing
   - **Synthetic-ended** — near duration + paused + hidden → force advance
   - **Stuck-playback** — currentTime frozen 2 ticks → force advance
   - **Baseline pulse** (every other tick, 8s cadence) — `heartbeat_tick`
     trace so we can verify the loop is alive

5. **WakeLock** (useWakeLock.ts): requests screen wake lock while
   `isPlaying`; releases on pause. Android/iOS 16.4+.

### What it does NOT own

- iframe → R2 hot-swap (that's `useHotSwap.ts`)
- Track selection / queue management (that's `playerStore.nextTrack`)
- MediaSession action handlers (`play`/`pause`/`nexttrack`/`previoustrack`)
  — those live in `AudioPlayer.tsx`'s mediaSession useEffect

---

## Signal flywheel

```
User plays/skips/loves/completes
  ↓
centralSignals.play/skip/love/complete/queue + OYE→react
  ↓ (5s dedupe window inside recordSignal)
voyo_signals table (Supabase)
  ↓ (on next app boot)
oyoDJ.hydrateFromSignals — scores each track by action weight, joins
  video_intelligence for artist names, merges top 20 into
  djProfile.relationship.favoriteArtists (slice(0,20), head not tail)
  ↓
playerStore.refreshRecommendations merge block
  ↓ favoriteArtists used to promote tracks to front of hotTracks
  ↓
Next track plays with taste-shaped ordering
```

### Action weights (in oyoDJ.ts SIGNAL_WEIGHTS)

| action | weight |
|--------|--------|
| love | 5 |
| react (OYE) | 5 |
| complete | 3 |
| queue | 2 |
| play | 1 |
| skip | -2 |
| unlove | -3 |

---

## Telemetry — what to watch

All events land in `voyo_playback_events` table. Healthy post-v412:

| event | what it means |
|-------|---------------|
| `play_start` | a track has started (user tap, auto-advance, BG watchdog) |
| `stream_ended` | natural end via `<audio>` 'ended' OR iframe ENDED when iframe owns playback |
| `skip_auto` | advance triggered by a watchdog/error path (meta.reason identifies which) |
| `heartbeat_tick` | bgEngine alive in BG (~8s cadence, every other tick) |
| `silent_wav_engage` | keeper bridge engaged (meta.why = ended_advance/etc) |
| `synthetic_ended` | Chrome didn't fire 'ended'; heartbeat detector forced advance |
| `stuck_escalate` | currentTime frozen 2 ticks; heartbeat forced advance |
| `heartbeat_kick_ok` / `heartbeat_kick_rejected` | element paused in BG; play() result |
| `ctx_resume_ok` / `ctx_resume_rejected` | AudioContext brought back |
| `bg_disconnect` | FG return handler invoked (should be rare now — bgEngine handles most of it) |
| `nt_discover_pick` | nextTrack selected from discover pool |
| `nt_queue_pick` | nextTrack selected from user queue |
| `nt_pool_refill_kick` | pool ≥50% filtered by history; background refresh kicked |
| `nt_no_tracks_looping_current` | pool fully drained; looping current + refreshing in BG |
| `iframe_ended_owner` | iframe's ENDED advanced when iframe was audio source |
| `iframe_ended_watchdog_fired` | iframe ENDED + audio-buffer check → force advance |
| `iframe_ended_watchdog_suppressed` | iframe ENDED but audio still playing — no advance |
| `predictive_prewarm` | at 50% of current, warmed next track's R2 extraction |
| `state_transition` / `state_illegal` | playbackState machine transitions |

### Health metrics

- **Advance ratio**: `(stream_ended + skip_auto) / play_start` should reach ≥ 50% over a healthy session.
- **Silent stall**: `play_start` without any advance event → real problem. Query: `play_start` events where the NEXT event for the same session is another `play_start` more than ~5s after the track should have ended naturally.

---

## Commit history — today's sweep

All 30+ commits shipped between `dec9804` and `b396da7` (v405 → v412).
Highlights:

- **Data loop** (signals write): FK drop, RLS disable, trigger removal, 5s dedupe, session_vibe wiring, hydrateFromSignals
- **OYO never stops**: trackSwapInProgressRef iframe-clear, BG watchdog → setInterval → (superseded by) bgEngine heartbeat, iframe ENDED watchdog with audio-advance snapshot, nt_no_tracks loop-current, force-reload playback guard
- **Hot-swap**: bail guarded by trackId match, RT reconnect on TIMED_OUT/CLOSED, AudioErrorBoundary state preservation
- **Telemetry truth**: stream_ended + skip_auto emitted at every advance path (was just handleEnded)
- **Predictive pre-warm**: 50% mark fires ensureTrackReady on next track
- **BG invariant restored**: bgEngine + useWakeLock + playbackState brought back from `1098988^`
- **History + exclusion**: addToHistory on every advance (no currentTime gate); exclusion window 20 → 40
- **Pool auto-refill**: when ≥50% filtered, kick refreshRecommendations in BG

See `git log --oneline origin/master~30..origin/master` for the full list.

---

## Known open items

- **voyo_profiles RLS** (`USING (true)`): profile-takeover surface exists but needs DASH-token validation in a SECURITY DEFINER RPC before locking down. Parked.
- **Cross-device taste backfill**: historical anon `voyo_signals.user_hash` rows should be rewritten to `dash_id` on first authentication. Parked.
- **Migration 025** (`voyo_track_heat` materialized view): SQL file written, not applied. Apply when aggregated heat scoring is wanted.
- **Auth model**: DASH Command Center owns identity; no Supabase auth. Any per-user write needs a SECURITY DEFINER RPC that validates the DASH token server-side.

---

Last updated: 2026-04-22 (end of the v412 ship sweep).
