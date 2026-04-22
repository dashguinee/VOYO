# AUDIT-5 — Signal Flywheel (write → persist → hydrate → next-track)

**Scope**: The full taste-learning loop from user action to its influence on track selection. Audited after migration 024 (FK drop + RLS tighten) and commits `dec9804` (dedupe) + `58b0c5e` (hydrate).

---

## The Flywheel — Current Topology

```
                             ┌──────────────────────────────────────────┐
                             │            USER ACTION (UI)              │
                             │  tap play | tap skip | oye | commit |    │
                             │  reach 100% | add-to-queue | unlove(?)   │
                             └───────────────┬──────────────────────────┘
                                             │
          ┌──────────────────────────────────┼──────────────────────────────────┐
          │                                  │                                  │
          ▼                                  ▼                                  ▼
┌────────────────────┐          ┌──────────────────────────┐       ┌─────────────────────┐
│ A) AudioPlayer     │          │ B) playerStore.nextTrack │       │ C) oye() / oyeCommit│
│   track-change     │          │   completionRate decider │       │   (services/oyo/app)│
│   useEffect        │          │   <30% → onSkip          │       │   one path, many    │
│   oyo.onPlay()     │          │   ≥30% → onComplete      │       │   side-effects      │
└─────────┬──────────┘          └──────────┬───────────────┘       └──────────┬──────────┘
          │                                 │                                 │
          ▼                                 ▼                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          services/oyo/index.ts  (FANOUT)                         │
│                                                                                  │
│  onPlay  → oyoDJ.onTrackPlay, djRecordPlay, poolCurator, recordPoolEngagement,  │
│           pools.refreshPools()  [throttled 30s]                                  │
│  onSkip  → djRecordPlay(skip), oyoPlan('skip'), oyoDJ.onTrackSkip,              │
│           recordPoolEngagement('skip'), recordRemoteSignal('skip')  [RPC]       │
│  onComplete → djRecordPlay, oyoPlan('completion'),                               │
│            recordPoolEngagement('complete', {completionRate}),                   │
│            recordRemoteSignal('complete')  [RPC]                                 │
│  onOye  → djRecordPlay(reaction), oyoPlan('reaction'),                           │
│           recordPoolEngagement('react'), recordRemoteSignal('react')  [RPC]     │
└──────────────────┬──────────────────────┬───────────────────────────────────────┘
                   │                      │
                   ▼                      ▼
┌────────────────────────────────────┐   ┌─────────────────────────────────────┐
│  personalization.recordPoolEngage  │   │  record_signal RPC batch queue      │
│     → trackPoolStore.recordPlay/   │   │    (10s flush or pagehide)          │
│       recordSkip/recordReaction/…  │   │    → RPC record_signal              │
│     → trackPoolStore also internal-│   │    (hits voyo_signals table + other │
│       ly calls centralSignals.*    │   │     tables — but this is a          │
│       (play/skip/love/queue/complete)  │     SEPARATE path from               │
│     → recordSignal() in centralDJ  │   │     centralSignals.* above)         │
│     → INSERT voyo_signals          │   └─────────────────────────────────────┘
│     [5s dedupe map]                │
└──────────────────┬─────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│     voyo_signals  (Supabase, RLS off,    │
│     anon INSERT/SELECT only, no FK)      │
└──────────────────┬───────────────────────┘
                   │
                   ▼              (on next initOYO / cold boot)
┌────────────────────────────────────────────┐
│  oyoDJ.hydrateFromSignals() [idempotent]   │
│    last 30d voyo_signals for this user     │
│    score each track, top 200 track_ids     │
│    JOIN video_intelligence (100 ids max)   │
│    aggregate by artist, top 20             │
│    UNION with in-session favoriteArtists   │
│    .slice(-20)                             │
│    djProfile.relationship.favoriteArtists  │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  playerStore.refreshRecommendations (merge)     │
│    getOyoInsights().favoriteArtists — sorts     │
│    mergedHotRaw so favs-first                   │
│    FRESHNESS TIER: trending[0..30%]             │
│    + OYO-sorted mergedHot                       │
│    → hotTracks (shelf + background auto-advance)│
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
              NEXT TRACK PLAYED
```

Parallel stack: `src/brain/*` observes all store changes and emits its OWN `signals.*` namespace into `SignalEmitter`→`SignalBuffer`→`VoyoBrain.forceCurate()`. Feeds `sessionExecutor`, NOT voyo_signals. **Two independent taste graphs exist in the same process. See F-01.**

---

## Findings

### F-01 — P0 — Dual signal system in the same process (brain vs. centralDJ)

**Location**: `src/brain/BrainIntegration.ts` (all) vs `src/services/oyo/index.ts` + `src/store/trackPoolStore.ts`
**Wired in**: `src/App.tsx:521` — `brain.initializeBrainIntegration()`; `src/services/oyoDJ.ts:1054` — `initOYO()` runs automatically on module import.

**What's wrong**: When a user taps play, `playerStore.setCurrentTrack` fires. Zustand subscribers see the change. At least **three** independent paths now emit signals for the same action:

1. `AudioPlayer` track-change `useEffect` → `oyo.onPlay(currentTrack)` → fanout to `oyoDJ`, `djRecordPlay`, `poolCurator`, `recordPoolEngagement('play')` → `trackPoolStore.recordPlay` → `centralSignals.play(trackId)` → INSERT `voyo_signals`.
2. `playerStore.setCurrentTrack` also calls `recordPoolEngagement(track.id, 'play')` directly (line 518) → same `centralSignals.play()` → INSERT `voyo_signals`.
3. `BrainIntegration.setupPlayerStoreIntegration` subscribes to the same `currentTrack` change and emits `signals.play(info)` into the Brain SignalEmitter/Buffer, which feeds `VoyoBrain.forceCurate()` and `sessionExecutor`. This path does NOT write to `voyo_signals` — it's a parallel taste graph.

**Why it matters**: Paths 1 and 2 were the exact double-fire that commit `dec9804` papered over with the 5-second dedupe map. The fix hides the double INSERT but doesn't fix the architecture — the same track play still walks `recordPoolEngagement` TWICE, mutating `trackPoolStore.playCount`, `videoIntelligenceAPI.recordPlay`, and other counters twice. Only the DB row is suppressed.

Path 3 means a user's taste is being modeled in TWO reinforcement engines that can disagree. `VoyoBrain.forceCurate` runs its own curation and pushes it into `sessionExecutor` — if the brain system ever actually drives next-track selection, it would contend with the `oyoDJ`-driven `playerStore.refreshRecommendations` merge block.

**Fix**:

1. Remove the `recordPoolEngagement(track.id, 'play')` in `playerStore.setCurrentTrack:518`. `AudioPlayer`'s `oyo.onPlay` is the canonical boundary (per the comment in `services/oyo/app.ts:62-67`). The dedupe map then becomes insurance, not load-bearing.
2. Also kill the direct `recordPoolEngagement` calls in `playerStore.nextTrack:825`, `playerStore.nextTrack:1033`, `playerStore.prevTrack` region — all of these fire before `setCurrentTrack` would anyway, so `oyo.onPlay` already covers them.
3. Decide the brain system's role explicitly. Either: (a) disconnect `brainIntegration.initialize()` from App bootstrap, or (b) have `brain/SignalEmitter` PIPE into `voyo_signals` and unify the schema. Running two parallel taste graphs with no integration is a latent bug.

---

### F-02 — P0 — `oye` weighted 4 in hydrate but NEVER emitted as `action='oye'`

**Location**: `src/services/oyoDJ.ts:958` (weight table) vs. all emit sites
**Weights**:
```
SIGNAL_WEIGHTS = {
  love: 5, complete: 3, queue: 2, play: 1,
  skip: -2, unlove: -3,
  oye: 4,     ← never emitted
}
```

**What's wrong**: Grep the entire tree for `action: 'oye'` or a `signals.oye(…)` that writes to `voyo_signals` — it does not exist. The `SignalData.action` union in `centralDJ.ts:67` is literally typed `'play' | 'love' | 'skip' | 'complete' | 'queue' | 'unlove'`. TypeScript would reject `oye` there. Meanwhile in `BrainIntegration.ts:277` `signals.oye(...)` fires — but that's the Brain's in-memory `SignalEmitter`, a different system, and it never touches `voyo_signals`.

When a user actually OYEs a track: `services/oyo/app.ts:oye()` → `onOye()` → `djRecordPlay(track, reaction=true)` + `oyoPlan('reaction')` + `recordPoolEngagement(trackId, 'react')` + `recordRemoteSignal(trackId, 'react')`. Then `playerStore.addReaction` (line 1676) fires `record_signal RPC` with `p_action='love'`. So the DB ends up with `action='react'` (via record_signal RPC) and possibly `action='love'` — **never** `'oye'`.

**Why it matters**: The most specific positive signal in the schema is unreachable. Dead weight. The hydrate query will never see an `oye` row, so weight=4 is decorative.

**Fix**: Either (a) remove `oye: 4` from `SIGNAL_WEIGHTS` and add `react: 4` to match what actually lands in `voyo_signals` via the RPC path, or (b) add `oye` to the `SignalData.action` union and wire `signals.oye()` in `centralDJ.ts` then have `onOye` fire BOTH `signals.oye(trackId)` and the existing `record_signal('react')` with distinct semantics. Option (a) is the one-liner that's correct today.

Also: the weights table references `unlove: -3` but there is ZERO code path that calls `centralSignals.unlove()` or `recordSignal({action:'unlove'})` — grep confirms. Same dead-weight issue. `preferenceStore.setExplicitLike(id, false)` is the nearest thing (BrainIntegration catches it and fires `signals.dislike` into the brain), but it never reaches `voyo_signals`.

---

### F-03 — P0 — `react` writes bypass hydrate weight table (mismatched schemas)

**Location**: `src/services/oyo/index.ts:88-94, 163-164` (writes `action='react'`) vs `src/services/oyoDJ.ts:951-959` (weight table has no `react` key).

**What's wrong**: `onOye` calls `recordRemoteSignal(track.trackId, 'react')`. The RPC `record_signal` writes an `action='react'` row. But the hydrate weight table (`SIGNAL_WEIGHTS`) has no `react` entry — it falls through to `?? 0` (line 989). An OYE produces a signal worth **zero** to favoriteArtists scoring.

Meanwhile the `trackPoolStore.recordReaction` fanout fires `centralSignals.love(trackId)` (trackPoolStore.ts:305) which writes `action='love'` to `voyo_signals` via `recordSignal`. So an OYE produces BOTH a `love` row (via trackPoolStore/centralSignals) AND a `react` row (via oyo/index.ts record_signal RPC). The `love` one hydrates (+5); the `react` one is ignored.

**Why it matters**: Double-counting from one gesture (F-01) plus schema drift (F-02/F-03) means the ONE UI action users care about most (the unified Oye button) lands as two different rows with different weights. New users' favoriteArtists will be biased toward whichever of the two rows the hydrate happens to see first (limited to 2000 rows, lines 979).

**Fix**: Add `react: 4` to `SIGNAL_WEIGHTS`. Drop either the `trackPoolStore.recordReaction → centralSignals.love` emission OR the `record_signal RPC → 'react'` emission — pick one. Preferred: keep `record_signal RPC` (it's the cross-device / collective path via video_intelligence); drop the `centralSignals.love` from `trackPoolStore.recordReaction` since that duplicates `oye` semantics as `love`.

---

### F-04 — P1 — `addToQueue` fires `queue` signal but `oyeCommit` does too, and `app.oye` ALSO does

**Location**: `src/store/playerStore.ts:1271`, `src/services/oyo/app.ts:236-244` (oyeCommit → addToQueue → same recordPoolEngagement('queue') path)

**What's wrong**: `oyeCommit` is the unified gesture (commits + warms + queues + explicitLike). In one tap it:

1. Calls `oye(track)` → `onOye` → records `react` RPC + `centralSignals.love` via trackPoolStore fanout
2. Calls `addToQueue(track)` → `recordPoolEngagement(track.id, 'queue')` → `trackPoolStore.recordQueue` → `centralSignals.queue(trackId)` → INSERTs `voyo_signals` with `action='queue'`
3. Sets `explicitLike=true` → `BrainIntegration` observes this → `signals.love({trackId, videoId: trackId})` in the brain namespace (not voyo_signals)

So one user tap → 2 voyo_signals rows (`queue` + `love`) + 1 RPC row (`react`) + 1 brain-memory event (`love`). Four distinct taste records for one intent. The dedupe map in centralDJ catches duplicates only on the same (user, track, action) key within 5s — `queue`, `love`, `react` are all different actions so they all land.

**Why it matters**: Within scoring, that's weight 2 + 5 + 0 = 7 per oyeCommit tap, which is reasonable — except a pure `love` reaction (double-tap without queue) scores 5, and a pure `queue` (drag into queue) scores 2. So oyeCommit (the "commit" gesture) over-weights by design. Probably fine, but ensure `queue` signal shouldn't be firing on oyeCommit if the spec is "queue is a separate intent from love."

**Fix**: Decide: is oyeCommit a single high-intent gesture (weight ~5), or genuinely three actions? If single-intent, don't fire the `queue` engagement — or score-cap via dedupe across actions when oyeCommit is the source. Small but affects the learning signal shape.

---

### F-05 — P1 — Hydrate idempotency flag is module-level; `initOYO()` can run twice with inconsistent results

**Location**: `src/services/oyoDJ.ts:961` (`let hydrateDone = false`), `src/services/oyoDJ.ts:1054` (auto-run on module import), `src/services/oyoDJ.ts:265-297` (`initOYO`), `src/App.tsx` (if it ever calls `initOYO` or imports the module after bootstrap).

**What's wrong**:

- `hydrateDone` is set to `true` eagerly (line 966), BEFORE the actual Supabase query. If the query fails (network, RLS regression, auth expired) the flag blocks retry forever for the life of this tab. User stays in local-only mode with no hydrate chance until page refresh.
- Because the module-scoped auto-run at line 1054 fires the FIRST time the file is imported (HMR, dynamic import, etc.), a second explicit `initOYO()` call from App.tsx will noop the hydrate (flag already true) but still increment `totalSessionsStarted` twice and re-run `saveProfile()`.
- During an HMR reload in dev, the module re-evaluates, `hydrateDone` resets to `false`, and hydrate fires again — but by then `djProfile.relationship.favoriteArtists` may already have in-session reactions. The UNION merge at line 1035-1038 preserves them, which is correct. On production (no HMR) this is a non-issue.

**Why it matters**: The "retry forever" blockage is the real bug. If hydrate fires at app boot before network is up (e.g. launched from lockscreen in airplane mode), the flag is set and never un-set. When network returns later in-session, taste learning never hydrates.

**Fix**:

```ts
// Don't set the flag until we actually complete successfully
export async function hydrateFromSignals(): Promise<void> {
  if (hydrateDone) return;
  if (!supabase || !isSupabaseConfigured) return;

  try {
    const userHash = getUserHash();
    if (!userHash) return;
    const since = ...
    const { data: signalRows, error: sigErr } = await supabase.from('voyo_signals')...
    if (sigErr) {
      devWarn('[OYO hydrate] signals query failed — will retry next init', sigErr);
      return; // hydrateDone stays false; retry on next initOYO call
    }
    // ... rest ...
    hydrateDone = true; // only on success (or zero-row path, which IS success)
  } catch (err) { ... }
}
```

Additionally: expose a `retryHydrate()` export or hook it to `window.online` event so reconnection triggers a retry.

---

### F-06 — P1 — `.slice(-20)` on Set → wrong semantics

**Location**: `src/services/oyoDJ.ts:1038`

```ts
const union = new Set<string>();
for (const a of topArtists) union.add(a);
for (const a of djProfile.relationship.favoriteArtists) union.add(a);
djProfile.relationship.favoriteArtists = [...union].slice(-20);
```

**What's wrong**: `[...union]` preserves insertion order — topArtists (hydrated, score-ordered) come first, then in-session artists. `.slice(-20)` takes the LAST 20. That means:

- If union.size ≤ 20 → keeps all. Fine.
- If union.size > 20 → drops the topArtists with HIGHEST hydrated score (inserted first) and keeps the in-session ones (inserted last).

This is inverted. The hydrated top artists are the ones we MOST want to keep — they represent 30 days of positive signal. In-session reactions are ephemeral and redundant (they'll be captured by the next hydrate anyway).

For a heavy user with 20+ varied session interactions, their cross-session persistent favorites get truncated away.

**Why it matters**: The stated goal of the hydrate is "persist cross-session learning." The slice quietly inverts that goal when the union overflows.

**Fix**:
```ts
djProfile.relationship.favoriteArtists = [...union].slice(0, 20); // top-N from score-ordered union, in-session appended after but truncated first
```

Or, if you want to guarantee in-session additions always make it in, sort the union: hydrated top first (by score), then in-session, then truncate at 20.

---

### F-07 — P1 — Hydrate JOIN misses every track not in `video_intelligence`

**Location**: `src/services/oyoDJ.ts:1005-1009`

```ts
const { data: meta, error: metaErr } = await supabase
  .from('video_intelligence')
  .select('youtube_id, artist')
  .in('youtube_id', topTrackIds.slice(0, 100));
```

**What's wrong**: `voyo_signals.track_id` is any track the user interacted with — could be from user searches, Piped API, discovered recommendations. `video_intelligence` is a curated catalog; not every signalled track is in it. Any track not in video_intelligence is silently dropped from the artist aggregation.

Further:
- `topTrackIds.slice(0, 100)` truncates to 100 even though scoring was done over 200. Scores 101-200 are thrown away entirely.
- The score aggregation at line 1017-1022 still uses `trackScore.get(row.youtube_id)` — but `row.youtube_id` is the video_intelligence PK. Only tracks that exist in both tables contribute. If a user's top-scoring track is a newly-discovered search result not yet in video_intelligence, it doesn't count. First-week users of a new catalog see empty favoriteArtists.

**Why it matters**: New track discoveries (which are explicitly the "exploration" goal of VOYO — moving beyond the seed tracks) are under-counted in the taste graph. The system biases toward already-catalogued tracks.

**Fix**: Two options.

1. **Add artist to voyo_signals schema**: already a breaking change, but the simplest. One column, denormalized. Then the hydrate query is one table, no JOIN, no missing rows.
2. **Fetch from multiple sources**: query video_intelligence AND voyo_tracks AND trackPoolStore (local cache) and merge. More code but works today.

Also: bump the `.slice(0, 100)` to match the 200 scored or batch into two queries.

---

### F-08 — P1 — `resolveSessionVibe()` returns null on 100% of first-session users

**Location**: `src/services/centralDJ.ts:348-352`

```ts
function resolveSessionVibe(): string | null {
  try {
    return getPlan()?.direction ?? null;
  } catch { return null; }
}
```

**What's wrong**: `getPlan()` returns `null` until `initPlan()` has run. `initPlan()` is called where? Grep:

```
grep -rn "initPlan\b" src/ --include="*.ts" --include="*.tsx"
```

Only self-reference in oyoPlan. `initPlan()` is never called from App bootstrap. So for a fresh session, `plan === null` → `resolveSessionVibe()` → `null` → every row written to `voyo_signals` has `session_vibe=null` until some UI code eventually calls `initPlan()`. Grep for that caller — probably `oyoState.loadOyoState()` or a panel that doesn't render on first load.

**Why it matters**: The column `session_vibe` exists specifically to bucket signals by mood for mood-aware recommendations later. If it's silently null for 80% of signals, analytics are distorted.

**Fix**: Either (a) call `initPlan()` from App.tsx bootstrap explicitly so a plan exists from t=0, or (b) `resolveSessionVibe()` should fall back to a reasonable default like `djProfile.relationship.favoriteMoods[-1] ?? 'afro-heat'` when getPlan is null. Better yet, let centralDJ expose a setter for session vibe that intentStore / vibeCheck UI calls.

---

### F-09 — P2 — Dedupe map growth + key collision across user switches

**Location**: `src/services/centralDJ.ts:346-369`

```ts
const recentSignals = new Map<string, number>();
// key = `${userHash}:${signal.trackId}:${signal.action}`
// GC trigger at size > 500
```

**What's wrong**:

- GC runs only after size > 500. On a heavy session (user plays 200 tracks, skips 80, reacts 20, queues 15) that's ~315 entries — no GC fires. Every future new key adds to the map, unbounded until the 500 trigger.
- When GC fires, it sweeps entries older than `SIGNAL_DEDUPE_MS * 2 = 10s`. This is fine but means the map size can sit at 500+ indefinitely if the user is active (each signal refreshes its own key's timestamp only if duplicate-fired within 5s; otherwise the old entry ages).
- If a user logs in/out mid-session, `userHash` changes (per userHash.ts:10-20 it prefers account id). Old entries for the anon hash stay in the map forever, never GC'd if they never exceed 500. Low-impact.
- The map is module-scoped — survives HMR / logout / login. In a long-lived PWA session it's a minor memory leak (1KB per 50 entries, so 10KB typical — not critical, but worth noting).

**Why it matters**: Real leak is the "never GC'd when map stays under 500" case. An entry for a 5-minute-old play still sits there consuming space. Not a production crasher, but sloppy.

**Fix**: Move to time-based GC (every flushSignals pass or every 10 min via setInterval, sweep anything older than 60s). Keep the size-based fallback.

---

### F-10 — P2 — `playerStore.addReaction` only fires `record_signal RPC` on the currentTrack, not on the reacted-to track

**Location**: `src/store/playerStore.ts:1676`

```ts
const r = await supabase?.rpc('record_signal', { p_youtube_id: currentTrack.trackId, p_action: 'love' });
```

**What's wrong**: `addReaction` fires on `currentTrack`. If a user reacts from the scrubber while the player has just advanced (race: reaction was intended for the PREVIOUS track but fired during the track-change window), it records against the new track. More importantly, any UI that wants to record a reaction on a NON-current track (e.g., long-pressing a card in the feed to "love" it without playing it) currently ties it to currentTrack instead.

`app.oye()` takes a `track` param and is the correct boundary — but this `addReaction` flow is separate and older.

**Why it matters**: Minor — in practice OYE gestures go through `oyeCommit`, not `addReaction`. But if any new UI hooks into `addReaction` for cross-track reactions, the signal attribution is wrong.

**Fix**: Deprecate `addReaction` for signal purposes, or have it accept an explicit track param. Search for its call sites and migrate them to `app.oye(track)` which is track-parameterized.

---

### F-11 — P2 — HomeFeed emits `recordPoolEngagement('skip')` with no global signal

**Location**: `src/components/classic/HomeFeed.tsx:585`

**What's wrong**: HomeFeed's swipe-away gesture fires `recordPoolEngagement(track.id || track.trackId, 'skip')` but does NOT call `oyo.onSkip` or `recordRemoteSignal`. So the taste graph gets a local pool-score decrement but the `voyo_signals` table never sees this "implicit skip" gesture. User swipes past 20 tracks in a feed browse session → local scores shift, but DB has zero signal, so next-session hydrate won't reflect it.

**Why it matters**: Broken symmetry. playerStore.nextTrack DOES go through `oyo.onSkip`. HomeFeed doesn't. Signal volume from HomeFeed browse sessions is lost.

**Fix**: Replace `recordPoolEngagement(... 'skip')` with `oyo.onSkip(track, 0)` (position=0 because the user didn't play it). Same fanout everywhere else uses.

---

### F-12 — P2 — Signal queue lost on hard crash or `localStorage.clear()`

**Location**: `src/services/oyo/index.ts:53-106` (batch flushSignals + pagehide/visibilitychange listeners)

**What's wrong**: Batched RPC signals flush on a 10s timer OR on pagehide/visibilitychange=hidden. If the tab crashes, the renderer dies, or the user kills the process without hitting pagehide (Android low-memory kill, iOS background terminate), up to 10s of queued signals are lost.

Mitigations in place:
- `visibilitychange` + `pagehide` covers most graceful exits.
- pagehide fires even on bfcache eviction.

Gap:
- No localStorage-backed queue for true reliability.
- If user goes offline at second 9 of the flush interval, the next flush at second 10 silently fails the RPC (supabase returns error) — but the queue is already emptied at that point. The signals are gone.

**Why it matters**: Low-frequency but permanent data loss during network flaps.

**Fix**: Before emptying `_signalQueue`, snapshot it to `localStorage.setItem('voyo-signal-backlog', JSON.stringify(batch))`. On flush success, clear. On failure, leave for next retry. On App bootstrap, drain any backlog first.

---

### F-13 — P3 — `trackPoolStore.recordPlay` fires centralSignals.play on EVERY play including repeats

**Location**: `src/store/trackPoolStore.ts:262-273`

**What's wrong**: `recordPlay` always emits `centralSignals.play(trackId)`. If a user restarts the same track 5 times in a minute (loop mode or manual), 5 signals are recorded over the first minute. The 5-second dedupe catches repeats WITHIN 5s but not a 20s-loop track restarted every 20s. Each restart counts as a new `play` signal.

**Why it matters**: Loop-heavy listening inflates play count. Scoring says "play=1" so one user on loop generates play weight disproportionate to their unique taste signal. Not catastrophic but noisy.

**Fix**: Either reduce dedupe to per-session (one play per track per session) or accept as-is and add a downstream "unique user signal" aggregation layer.

---

### F-14 — P3 — No integration between BrainIntegration.cleanupBrainIntegration and the centralDJ signal queue

**Location**: `src/brain/BrainIntegration.ts:395` cleans up brain subscribers but doesn't flush centralDJ signal queue.

**What's wrong**: Minor — these are independent systems (F-01). BrainIntegration's `cleanup()` unsubscribes its zustand subscribers but has no awareness of `oyo/index.ts` `_signalQueue`. Not a leak because both use the pagehide listener. Mentioned here because if F-01 is fixed (by unifying the two), the cleanup flow needs care.

---

## Write-Sites Inventory (full)

| Site | File:Line | Action | Target |
|------|-----------|--------|--------|
| AudioPlayer track-change | `components/AudioPlayer.tsx:323` | oyo.onPlay | full fanout |
| playerStore.setCurrentTrack | `store/playerStore.ts:518` | recordPoolEngagement('play') | **F-01 duplicate** |
| playerStore.setCurrentTrack | `store/playerStore.ts:497` | recordPoolEngagement('complete', rate) | for the ENDING track |
| playerStore.nextTrack | `store/playerStore.ts:786-788` | oyo.onSkip / oyo.onComplete | split at 30% threshold (NB: SPEC says 80% — F-15 below) |
| playerStore.nextTrack queue path | `store/playerStore.ts:825` | recordPoolEngagement('play') | **F-01 duplicate** |
| playerStore.nextTrack discover path | `store/playerStore.ts:1033` | recordPoolEngagement('play') | **F-01 duplicate** |
| playerStore.addToQueue | `store/playerStore.ts:1271` | recordPoolEngagement('queue') | → voyo_signals |
| playerStore.addReaction | `store/playerStore.ts:1672-1679` | recordPoolEngagement('react') + record_signal RPC 'love' | **F-03 duplicate** |
| HomeFeed swipe | `components/classic/HomeFeed.tsx:585` | recordPoolEngagement('skip') only | **F-11 missing global signal** |
| oye() / oyeCommit | `services/oyo/app.ts` | onOye + addToQueue + setExplicitLike | **F-04 triple-fire** |
| BrainIntegration (parallel) | `brain/BrainIntegration.ts` | signals.* to in-memory SignalEmitter | **F-01 parallel graph** |

### F-15 — P1 — Completion threshold is 30%, not 80% as brief states

**Location**: `src/store/playerStore.ts:784-789`

```ts
const completionRate = (state.currentTime / state.duration) * 100;
if (completionRate < 30) {
  oyo.onSkip(state.currentTrack, state.currentTime);
} else {
  oyo.onComplete(state.currentTrack, completionRate);
}
```

Audit brief specified "complete fires correctly at >80%." Current code fires `onComplete` at `≥30%`. In `personalization.recordPoolEngagement → poolStore.recordCompletion → centralSignals.complete(trackId)` at `completionRate >= 80` (trackPoolStore.ts:290). So:

- 30%-80%: fires `oyo.onComplete` (which writes `record_signal RPC 'complete'`) BUT trackPoolStore doesn't write `centralSignals.complete` to voyo_signals.
- ≥80%: both fire.
- <30%: fires `oyo.onSkip`, writes signal `skip`.

The window 30-80% is a "partial listen" that writes `complete` to video_intelligence via RPC but NOT to `voyo_signals` via centralSignals. Schema drift again.

**Fix**: Either raise the nextTrack threshold to 80% (match centralDJ), or lower centralDJ's threshold to 30% (match nextTrack), or introduce a third action `partial_complete` with its own weight.

---

## Consumers (read-side) Inventory

| Consumer | Location | Reads |
|----------|----------|-------|
| `hydrateFromSignals` | `services/oyoDJ.ts:963-1047` | 30d window, user scoped |
| `getStats` | `services/centralDJ.ts:547` | count only, head:true |

That's it. No other code reads from voyo_signals. No aggregation view, no heat score, no cross-user collaborative filter. Migration `025_voyo_track_heat.sql` (unapplied per brief) would be the third consumer.

---

## Top 3 for chat return

1. **F-02 / F-03**: `oye` weight is unreachable, `react` action is unweighted. The single most common user gesture (OYE) writes rows that hydrate as 0, while an adjacent write fires the correct weight via a parallel path. Symptom: OYE gestures are noise to the hydrate. One-line fix: add `react: 4` to SIGNAL_WEIGHTS.
2. **F-05**: `hydrateDone = true` set BEFORE Supabase query completes. Transient failure (network/RLS) locks hydrate for the whole session. Move the flag-set to AFTER success. Also matters because RLS was just tightened today — exactly the kind of change that might fail silently for a first load.
3. **F-01**: Double/triple-fire write paths that commit dec9804's 5s dedupe map papers over. `recordPoolEngagement('play')` exists in 4 places in playerStore.ts PLUS in AudioPlayer's `oyo.onPlay`. Remove the `playerStore` direct calls; `AudioPlayer` is the canonical boundary. Unifies the flywheel to one edge.

Honourable mention: **F-06** slice inverts hydrate priority when >20 artists exist (keeps in-session, drops top-scored cross-session). One-char fix: `.slice(0, 20)` not `.slice(-20)`.
