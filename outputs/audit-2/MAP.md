# VOYO Final App Map — Audit 2 Reference (2026-04-26)

## Philosophy
- **Premium = restraint**: ONE signature gesture, not three. Apple easing `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Narralogy**: Orange = being added (queue/bucket), Purple = cooking (warming up to R2), Gold = landed (in Disco/R2-cached, gold-faded; Oye'd, gold-filled).
- **Patience-as-contribution**: ~11s R2 extraction is the ritual. User's tap pulls a song into Disco for everyone. Hot swap exists for >5min tracks only.
- **Single source of UI rhythm**: `feedNavDim` on playerStore. All chrome in feed dims together when ambient.

## Audio Pipeline (current, post-v646)
1. Tap card (search non-R2): `ensureTrackReady(p=10)` + `app.oyeCommit` (boostTrack + addToQueue + setExplicitLike) + `markWarming` + warming pill (3s) → play_now pill (7s)
2. Tap Play Now: `app.playTrack` → AudioPlayer track-change effect:
   - `knownInR2Sync` → R2 fast path (el.src = R2 URL)
   - else → `engageSilentWav` + `r2HasTrack` probe:
     - hit → R2 fast path
     - miss → `setSource('iframe')`, `el.loop=true` on silent WAV
3. If iframe-as-audio engages: `useHotSwap` mounts on `playbackSource === 'iframe'` BUT only fires if `currentTrack.duration === 0 || currentTrack.duration >= 300` (gated for long tracks/mixes/unknown)
4. R2 lands → useHotSwap: position-matched equal-power 2s crossfade → `setSource('r2')` → r2KnownStore.add → OyeButton flips gold → "✦ in Disco" pill

## Stores
- `playerStore`: currentTrack, queue, history, isPlaying, playbackSource ('r2'|'iframe'|'cached'|null), videoTarget ('hidden'|'portrait'|'landscape'), feedNavDim, etc.
- `r2KnownStore`: Set<string> of decoded YouTube IDs. Populated by r2Probe + useHotSwap success + gateToR2 + search /exists/.
- `warmingStore`: Set<string> of tracks tapped from non-R2 surfaces. Cleared by 60s timer or visual derivation when r2KnownStore lands.
- `downloadStore`: local IndexedDB cache state. boostTrack downloads via voyo-edge worker.
- `preferenceStore`: trackPreferences (likes, plays, lastPlayedAt).
- `intentStore`, `reactionStore`, `trackPoolStore`, `useR2KnownStore`, `useWarmingStore`.

## Key Files (organized by department)

### AUDIO (department 1)
- `src/components/AudioPlayer.tsx` (always-mounted, the audio core)
- `src/audio/bg/bgEngine.ts` (silent WAV keeper + heartbeat)
- `src/audio/graph/freqPump.ts` (analyser → CSS vars at 10fps)
- `src/audio/graph/useAudioChain.ts` (audio context, gain nodes)
- `src/services/audioEngine.ts` (network-aware bitrate)
- `src/services/voyoStream.ts` (ensureTrackReady, queue upserts)
- `src/player/r2Probe.ts` (HEAD probe with dedup)
- `src/player/useHotSwap.ts` (RT + poll + crossfade — wired in v644, gated >5min in v646)
- `src/player/useHotSwap.ts`, `src/player/iframeBridge.ts`, `src/player/usePlayback.ts`, `src/player/useHotSwap.ts`
- `src/store/downloadStore.ts`

### IFRAME/VIDEO (department 2)
- `src/components/YouTubeIframe.tsx` (single global iframe, mounted in App.tsx)
  - Mount-point pattern: `mountRef` keyed on youtubeId for clean per-track remount (v647)
  - `videoTarget`: hidden | portrait (216x216 floating) | landscape (fullscreen)
  - Inits when `videoTarget !== 'hidden' OR playbackSource === 'iframe'`
- `src/services/pipService.ts` (PiP enter/exit/toggle singleton)

### STORES & STATE (department 3)
- `src/store/playerStore.ts` (~1500 lines — currentTrack, queue, all playback state)
- `src/store/r2KnownStore.ts`, `src/store/warmingStore.ts`
- `src/store/preferenceStore.ts`, `src/store/downloadStore.ts`
- `src/store/intentStore.ts`, `src/store/reactionStore.ts`, `src/store/trackPoolStore.ts`
- `src/store/oyoStore.ts`, `src/store/universeStore.ts`

### PLAYER UI (department 4)
- `src/components/voyo/VoyoPortraitPlayer.tsx` (~6k lines, always-mounted, the main player surface)
- `src/components/voyo/LandscapeVOYO.tsx` (alt orientation player)
- `src/components/oye/OyeButton.tsx` (computeOyeState narralogy)
- `src/components/voyo/feed/VoyoMoments.tsx` (Moments feed with feedNavDim coordination)

### HOME / FEED / SEARCH (department 5)
- `src/components/classic/HomeFeed.tsx` (~3000 lines after revert)
  - **Stations + Vibes both DISABLED in v650** (STATIONS_LIVE=false, VIBES_LIVE=false)
- `src/components/classic/Library.tsx` (My Disco / Oyed / Just Played 3-tab)
- `src/components/classic/StationHero.tsx`, `src/components/classic/VibesReel.tsx` (rendered code paths but disabled)
- `src/components/search/SearchOverlayV2.tsx` (warming pill + R2 fast-path sync + positional header dock at 2 viewports)

### REALTIME / NETWORK / LIFECYCLE (department 6)
- `src/main.tsx` (SW register + 60min update poll + visibilitychange — see SW poll cadence)
- `public/service-worker.js` (audio cache + version detection)
- `src/providers/AuthProvider.tsx` (presence ping every 30s with visibility gate)
- `src/lib/voyo-api.ts`, `src/lib/dash-auth.ts`, `src/lib/supabase.ts`
- `src/services/telemetry.ts` (logPlaybackEvent → voyo_playback_events table)
- `src/components/voyo/navigation/VoyoBottomNav.tsx` (unread DM ping every 30s gated)

## Tonight's Recent Commits (v633 baseline + tonight's tweaks)
- v638: rollback v634-v637 (perf audit + home split, all reverted)
- v639–v640: search overlay UX (35 results, positional thresholds, scrim no blur, transform-only header anim)
- v641: ensureTrackReady(p=10) on first tap (priority bump for R2 extraction)
- v643: hot swap restored to position-matched (no restart)
- v644: useHotSwap WIRED in AudioPlayer (was previously dead code, never called)
- v646: hot swap gate fixed (only skip if duration KNOWN AND <300s)
- v647: iframe wrapper keyed on youtubeId for clean per-track remount
- v648: positional search header dock (2 viewports of scroll, not % of list)
- v649: Stations DISABLED (STATIONS_LIVE=false)
- v650: Vibes DISABLED (VIBES_LIVE=false)

## Verified This Session
- All commits TS-clean via `npx tsc -b` (project refs mode — Vercel uses this)
- v637 had a build break that v641 caught (oyosPicks dedup leak)
- v634 perf audit had a FALSE POSITIVE useHotSwap "leak" — v633 already had removeEventListener in cleanup. Always verify before claiming bugs.

## Bug-Hunting Rules for Audit Agents
1. **Verify before claiming**. The v634 audit invented a "useHotSwap leak" that didn't exist. NEVER report a bug without showing file:line + actual code that proves it.
2. **Glitch/race/leak ONLY**. No performance optimization suggestions. No design feedback. Real bugs only.
3. **Show repro**. Each finding must include the path that triggers it.
4. **Severity honest**. P0 = breaks core flow. P1 = degrades but works. P2 = edge case. Don't inflate.
