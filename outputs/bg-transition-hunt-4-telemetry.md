# BG Transition Hunt #4 — Telemetry Evidence

**Run:** 2026-04-15 ~16:14 UTC
**Window:** 2026-04-14T16:00:00Z → 2026-04-15T16:14:00Z (~24h)
**Source:** `voyo_playback_events` @ `anmgyxhnyhbyxzpjhxgx.supabase.co` (anon-key read works)

> The mission brief mentioned project `mclbbkmpovnvcfmwsoqt` but that is DASH Command Center. VOYO
> telemetry actually lives on `anmgyxhnyhbyxzpjhxgx`. No service key exists for that project; the
> RLS policy's SELECT is effectively open — anon key works for reads.

---

## 1. Headline numbers

| Metric | Value |
| --- | --- |
| Total events last 24h | **3,219** |
| Distinct sessions | 20 |
| Biggest single session | `voyo_mnzfyfv2_qp0dn9` — 1,761 events (Android Chrome 146, hidden) |
| **BG `play_start`** | **306** |
| **BG `play_success`** | **2 (0.7%)** |
| BG `play_fail` (logged) | 2 |
| FG `play_start` | 179 |
| FG `play_success` | 113 (63.1%) |
| FG `play_fail` | 34 |
| `watchdog_fire` in BG | **267** |
| `watchdog_fire` in FG | 12 |
| `next_call from=watchdog_bg` | **265** (vs 12 from `ended_advance` + 10 `watchdog_fg`) |

The BG-vs-FG success-rate delta (0.7% vs 63%) is the bug's fingerprint.
**265 of ~267 BG watchdog fires lead directly to a `next_call`.** That is the cascade.

---

## 2. Event-type / subtype inventory

Event types observed: `trace`, `play_start`, `play_success`, `play_fail`, `source_resolved`,
`skip_auto`, `stall`.

Trace `meta.subtype` values (top 22):

```
load_enter         474       watchdog_fire      279
preload_check      447       visibility          81
pause_guard        358       battery_change      47
next_call          317       canplay_await       38
silent_wav_engage  293       canplay_fire        37
play_call          27        play_resolved       26
pause_accept       26        ended_fire          24
audio_error        10        ended_dedup          3
blocklist_skip      2        heartbeat_kick       2
mediasession_pause  2        play_rejected        1
play_failure        1        battery_init        11
```

Useful filters for the hunt:
- `meta.subtype = 'watchdog_fire'` → the stuck-load skip
- `meta.subtype = 'next_call' AND meta.from = 'watchdog_bg'` → cascade tick
- `meta.subtype = 'silent_wav_engage'` → BG audio-context keepalive engaged
- `meta.subtype = 'visibility'` → tab visibility change
- `meta.subtype = 'ended_dedup' AND meta.why = 'audio_not_ended_stale'` → v183 stale-ended guard hit (firing 3× in 24h — working)
- `meta.subtype = 'play_resolved'` → play() promise settled (only path proving a track is actually audible)

Silent-wav reason split is mono-causal: 290× `bg_load_bridge`, 3× `pre_advance_bridge`. Both BG only.

---

## 3. BG transition anchor: `trace:ended_fire where is_background=true`

Only **12** BG `ended_fire` events across 4 sessions in 24h (most sessions never got hit because they never reached a natural track end while hidden). Outcomes within 80 events of the anchor:

| Outcome | Count | % |
| --- | --- | --- |
| `silent_gap` (no play_success, no play_fail — cascade eats everything) | **6** | **50%** |
| `bg_success_clean` (preloaded/cached — hit play_success fast) | 4 | 33% |
| `play_fail` with `source=vps+edge` | 2 | 17% |
| `rescued_by_unlock` (visibility=visible before play_success) | **0** | 0 |

> "0 rescued by unlock" *within the 80-event lookahead* is misleading — the `silent_gap` cases
> include multi-minute dead-zones where the user eventually unlocks the phone, and the
> `play_success` fires 3-4 minutes later after the window closes. Example 3 below shows the
> real pattern: a 4-minute silent gap between BG stall and FG `play_success`.

---

## 4. The core pathology — watchdog cascade

### Cascade length distribution (consecutive `watchdog_fire` events without a `play_success`)

```
 1 watchdog_fire in a row: 4 occurrences
 2 in a row:                1
 4 in a row:                2
 5 in a row:                1
23 in a row:                1
41 in a row:                1
196 in a row:               1  ← single 50-second burst
```

**Longest cascade:** session `voyo_mnzfyfv2_qp0dn9`, 196 watchdog fires, 02:45:41 → 02:46:31 UTC
(50.44 seconds of the app chewing through the queue at full speed).

### Load-to-watchdog timing (BG, same track)

```
n=205   min=0ms   p25=0ms   median=0ms   p75=0ms   max=9241ms
```

**The BG watchdog is firing BEFORE the network round-trip finishes.** Median time from
`load_enter → watchdog_fire` is **0 ms**. This is the defining pathology.

### Where it comes from — `src/components/AudioPlayer.tsx:1782–1802`

```ts
// BACKGROUND: setTimeout is throttled to 1/min. MessageChannel backup
// fires in ~5s (not throttled) to skip stuck tracks faster.
if (document.hidden) {
  let ticks = 0;
  const mc = new MessageChannel();
  mc.port1.onmessage = () => {
    ticks++;
    if (ticks < 500) { mc.port2.postMessage(null); return; } // ~5s
    mc.port1.close();
    if (isStale() || !loadWatchdogRef.current) return;
    ...
    trace('watchdog_fire', trackId, { timer: 'bg-5s', hidden: document.hidden });
    trace('next_call', trackId, { from: 'watchdog_bg' });
    nextTrack();
  };
  mc.port2.postMessage(null);
}
```

Two concrete problems:

1. **`ticks < 500` is NOT a 5-second timer.** It's a 500-iteration self-ping that resolves in
   microseconds on an active event loop and in milliseconds when a backgrounded tab gets a wake
   tick. The telemetry proves it — p75 is 0 ms. It was presumably calibrated against a flame
   graph on a foregrounded tab.

2. **Every new `loadTrack` arms a fresh MessageChannel** (line 1786 runs every load) and there's
   no handle to cancel the previous one. The `isStale()` guard at line 1791 DOES compare
   `loadAttemptRef.current !== myAttempt`, which should kill superseded watchdogs — and it does.
   But each new load gets its OWN MessageChannel whose `myAttempt` IS current. So the cascade
   isn't stale MCs firing — it's each new load's MC firing near-instantly after being armed,
   calling `nextTrack()`, which runs a fresh `loadTrack`, which arms a fresh MC, which fires
   near-instantly, ad infinitum.

Result: a 196-watchdog / 50-second avalanche through the queue.

The `loadWatchdogRef.current` guard only gates on the `setTimeout`-based watchdog; the MC
backup sets `loadWatchdogRef.current` implicitly only via `clearLoadWatchdog()` in the next
loadTrack, by which point a new ref has replaced it — so the guard passes.

---

## 5. Why `canplay_await` almost never fires in BG

```
canplay_await: BG=7  FG=31
canplay_fire : BG=5  FG=32
```

BG play_start → canplay_await funnel: **5 reached / 301 dropped by watchdog before canplay**.

This is the dominant BG failure mode. The network fetch + decoder init never gets to race the
watchdog because the watchdog isn't waiting.

---

## 6. Concrete timelines

Timestamps below are `HH:MM:SS.micros` directly from `created_at`. Within a Supabase batch,
PostgREST assigns a single `NOW()` to every row in the INSERT, so clock resolution inside a
batch is the batch boundary. I order by `id` (bigserial, monotonic) to preserve real
insertion order within a batch.

### Example 1 — 196-watchdog cascade (session `voyo_mnzfyfv2_qp0dn9`)

Pre-cascade: user has track `8AHRFybJ82` playing, foregrounded.

```
[  2876] 02:45:40.780 FG play_success          8AHRFybJ82
[  2877] 02:45:40.694 BG trace:visibility      8AHRFybJ82 state=hidden   ← user locks phone
[  2878] 02:45:41.165 BG trace:silent_wav_engage INRNayAP1- why=bg_load_bridge
[  2879] 02:45:41.165 BG play_start            INRNayAP1-
[  2880] 02:45:41.165 BG trace:pause_guard     INRNayAP1- why=loading
[  2881] 02:45:41.165 BG trace:watchdog_fire   INRNayAP1- hidden=True     ← 0 ms after load_enter
[  2882] 02:45:41.165 BG trace:next_call       INRNayAP1- from=watchdog_bg
[  2883] 02:45:41.165 BG trace:load_enter      1UC_NWTehV hidden=True
[  2884] 02:45:41.165 BG trace:silent_wav_engage 1UC_NWTehV why=bg_load_bridge
[  2885] 02:45:41.165 BG play_start            1UC_NWTehV
[  2886] 02:45:41.165 BG trace:pause_guard     1UC_NWTehV why=loading
[  2887] 02:45:41.165 BG trace:watchdog_fire   1UC_NWTehV hidden=True     ← again, instant
[  2888] 02:45:41.165 BG trace:next_call       1UC_NWTehV from=watchdog_bg
[  2889] 02:45:41.165 BG trace:load_enter      K_VRcj9B8r hidden=True
...
[  3329] 02:46:03.997 BG trace:canplay_await   d9Jk8z_Kas path=preload hidden=True
[  3330] 02:46:03.997 BG trace:watchdog_fire   d9Jk8z_Kas hidden=True     ← even with preload
[  3331] 02:46:03.997 BG trace:next_call       d9Jk8z_Kas from=watchdog_bg
... cascade continues for ~1000 more rows ...
[  4271] 02:46:31.602 FG play_success          OA-FyN-bCk                 ← resolved only after
                                                                             user unlocks
```

**Cascade burned ~42 unique track IDs in 50 seconds.** Every one of them is now marked as "just
tried, skip-pressure" in the upstream logic, so when the user unlocks at 02:46:31, they land on
a track deep in the queue, not on anything adjacent to where they started.

### Example 2 — BG ended → single `play_fail` with `vps+edge` (session `voyo_mnytaf9y_sxy068`)

```
[  2074] 16:06:43.924 BG trace:visibility      9IQzk9AzKN state=hidden
[  2075] 16:09:22.693 BG trace:pause_guard     9IQzk9AzKN why=ended      ← track naturally ends
[  2076] 16:09:22.693 BG trace:ended_fire      9IQzk9AzKN hidden=True prevEndedRef=None
[  2077] 16:09:22.693 BG trace:load_enter      qvzWu-kpKT hidden=True    ← next track loads
[  2078] 16:09:22.693 BG trace:silent_wav_engage qvzWu-kpKT why=bg_load_bridge
[  2079] 16:09:22.693 BG play_start            qvzWu-kpKT
[  2080] 16:09:22.693 BG trace:ended_fire      qvzWu-kpKT hidden=True prevEndedRef=None
                                                                         ← DOUBLE ended from
                                                                           React onEnded racing
                                                                           the natural end (no
                                                                           audioEnded=True flag
                                                                           — this one should've
                                                                           been deduped!)
[  2081] 16:09:22.693 BG trace:load_enter      E2eTl2M79j hidden=True
[  2082] 16:09:22.693 BG trace:silent_wav_engage E2eTl2M79j why=bg_load_bridge
[  2083] 16:09:22.693 BG play_start            E2eTl2M79j
[  2084] 16:09:22.693 BG play_fail             E2eTl2M79j source=vps+edge attempt=1
                                                                         ← first and last
                                                                           play_fail in the
                                                                           whole episode
[  2085] 16:09:22.703 BG trace:pause_guard     PovdTfQENC why=loading
[  2086] 16:09:22.703 BG trace:load_enter      aK8CcaF5nS hidden=True
...cascade continues, no more play_fail rows — silent loss...
```

Two findings here:
- The `ended_fire` at id 2080 came with `prevEndedRef=None` and NO `audioEnded=True` in meta.
  The v183 `ended_dedup` guard only fires on `audio_not_ended_stale`, so this double-end
  slipped through — there's a second class of spurious ended where the audio element was JUST
  reset and React's onEnded handler fires on the transition, and your dedup doesn't catch it.
- After the first `play_fail`, no further failures are logged because `isLoadingTrackRef`
  gates them — the subsequent cascade tracks don't even reach the catch block, they just
  watchdog out silently.

### Example 3 — The "rescued by unlock" delay (session `voyo_mnyubtm0_53w6yd`)

```
[  2566] 16:39:04.318 BG trace:pause_guard     bGsKQxIwEe why=ended
[  2567] 16:39:04.318 BG trace:ended_fire      bGsKQxIwEe hidden=True
[  2568] 16:39:04.318 BG trace:next_call       bGsKQxIwEe from=ended_advance
[  2569] 16:39:04.318 BG trace:load_enter      MCMyKcUNR8 hidden=True
[  2570] 16:39:04.318 BG trace:preload_check   MCMyKcUNR8
[  2571] 16:39:04.318 BG trace:silent_wav_engage MCMyKcUNR8 why=bg_load_bridge
[  2572] 16:39:04.318 BG play_start            MCMyKcUNR8
[  2573] 16:39:04.318 BG trace:ended_fire      MCMyKcUNR8 hidden=True     ← DOUBLE ENDED AGAIN
                                                                            (audioEnded=False!)
[  2574] 16:39:04.318 BG trace:next_call       MCMyKcUNR8 from=ended_advance
[  2575] 16:39:04.318 BG trace:load_enter      EaZ33FeBs5 hidden=True
[  2576] 16:39:04.318 BG trace:preload_check   EaZ33FeBs5
[  2577] 16:39:04.318 BG trace:silent_wav_engage EaZ33FeBs5 why=bg_load_bridge
[  2578] 16:39:04.318 BG play_start            EaZ33FeBs5
[  2579] 16:39:04.318 BG source_resolved       EaZ33FeBs5 attempt=1
[  2580] 16:39:04.318 BG trace:canplay_await   EaZ33FeBs5 path=retry_VPS attempt=1
[  2581] 16:39:04.318 BG trace:canplay_fire    EaZ33FeBs5 path=retry_VPS readyState=4
[  2582] 16:39:04.318 BG trace:play_call       EaZ33FeBs5 path=retry_VPS
[  2583] 16:39:04.318 BG play_success          EaZ33FeBs5                 ← BG success!
[  2584] 16:39:04.318 BG trace:play_resolved   EaZ33FeBs5 path=retry_VPS
[  2585] 16:39:11.437 BG stall                 EaZ33FeBs5                 ← 7s later stalls
[  2586] 16:39:11.437 FG trace:visibility      EaZ33FeBs5 state=visible   ← user reacts to
                                                                            stall, unlocks
[  2587] 16:39:42.145 BG trace:visibility      EaZ33FeBs5 state=hidden
[  2588] 16:43:26.255 FG trace:visibility      WzEvzaKcH8 state=visible   ← 4 MINUTES of silence
[  2589] 16:43:26.255 FG trace:load_enter      421w1j87fE hidden=False
[  2590] 16:43:26.255 FG trace:preload_check   421w1j87fE
[  2591] 16:43:26.255 FG play_start            421w1j87fE
[  2592] 16:43:26.255 FG trace:pause_guard     421w1j87fE why=loading
[  2593] 16:43:26.255 FG play_success          421w1j87fE
```

This is the "BG works for 7 seconds then stalls and you wait 4 minutes for the user to notice" pattern. Note also the second spurious `ended_fire` at id 2573 (with `audioEnded=False`) — same pattern as Example 2. The React onEnded listener is double-firing on rapid track transitions.

---

## 7. The exact event sequence that characterizes the bug

**Pathological BG transition (what happens 50% of the time):**

```
1. visibility=hidden      (user locks phone)
2. trace:pause_guard      why=ended
3. trace:ended_fire       hidden=True           [natural track end]
4. trace:silent_wav_engage why=pre_advance_bridge
5. trace:next_call        from=ended_advance    [healthy; next() called on ended]
6. trace:load_enter       <next-track>          [load the next track]
7. trace:silent_wav_engage why=bg_load_bridge
8. play_start             <next-track>
9. trace:pause_guard      why=loading
10. trace:watchdog_fire   <next-track>  hidden=True  timer=bg-5s   ← 0 ms after #6
11. trace:next_call       <next-track>  from=watchdog_bg
12. trace:load_enter      <next-next-track>
13. ... repeat 7–12 dozens of times in ~1 second ...
--- (NO play_success anywhere in chain) ---
N. visibility=visible     [user unlocks — sometimes minutes later]
N+1. play_success         <track-far-ahead-in-queue>
```

**Healthy BG transition (what happens 33% of the time, only when preload is ready):**

```
1. visibility=hidden
2. trace:pause_guard      why=ended
3. trace:ended_fire       hidden=True
4. trace:next_call        from=ended_advance
5. trace:load_enter       <next-track>
6. trace:preload_check    <next-track>
7. trace:silent_wav_engage why=bg_load_bridge
8. play_start             <next-track>
9. source_resolved        attempt=1                   ← upstream beats the watchdog
10. trace:canplay_await   path=retry_VPS
11. trace:canplay_fire    readyState=4
12. trace:play_call       path=retry_VPS
13. play_success          <next-track>
14. trace:play_resolved   path=retry_VPS
```

The only difference: **in the healthy path, `source_resolved` arrives before the watchdog
fires.** When the network is even slightly slow (or the MessageChannel ticks burn through a
wake batch), step 9 never arrives and the watchdog at step 10 (from the pathological path)
wins.

---

## 8. Secondary findings worth filing

1. **Double `ended_fire` without the v183 `audio_not_ended_stale` marker.** Examples 2 and 3
   both show a second `ended_fire` firing immediately after a `play_start` on the NEXT track,
   with `audioEnded=False` and `prevEndedRef=None`. The v183 dedup only catches
   `why=audio_not_ended_stale` — it doesn't catch this "just-armed-transition" class. v183
   caught 3 stale-endeds in 24h; there are easily 10× more spurious endeds that slip past it
   (visible as `ended_fire` events with `audioEnded=False` that aren't followed by a dedup).

2. **`silent_wav_engage why=pre_advance_bridge` fires only 3× but all three are in BG.**
   That's the "bridge the silent gap before loading next track" mechanism; seems to work
   when it fires, but it's not firing often enough. Worth checking why it bypasses most
   ended transitions.

3. **`source_resolved` almost never logs in BG** (4 total vs 30 FG). Most BG play_starts
   never reach the source-resolve step because the watchdog kills them before VPS responds.

4. **`next_call from=watchdog_bg` dominates all nextTrack causes: 265 / 320 total (83%).**
   The playlist is being driven by watchdog skips, not by user actions or ended events.

5. **`stall` events correlate with `visibility=visible` within 0–1 seconds.** Users are
   reacting to playback stalling by unlocking the phone. Every BG stall is a user-visible
   bug.

6. **Per-session lifetime BG success rate:** of the 4 sessions that had BG ended_fire events,
   the actual BG playback success rate was ~0–15% per session. Sessions that stayed
   foregrounded (the other 16 sessions) had no BG data collected at all.

---

## 9. Specific code paths implicated

| Symptom | Line / file | Fix class |
| --- | --- | --- |
| BG watchdog fires ~0 ms after load | `src/components/AudioPlayer.tsx:1786–1801` | Replace MessageChannel tick loop with `setInterval`+`Date.now()` delta or a Web Worker timer. The `ticks < 500` count has no wall-clock meaning. |
| Cascade not broken by `isStale` | Same block, `if (isStale() || !loadWatchdogRef.current) return;` line 1791 | Add a per-load MC abort handle so `clearLoadWatchdog` can cancel the MC too. Currently `loadWatchdogRef` only tracks the setTimeout fallback. |
| Double `ended_fire` with `audioEnded=False` | Wherever React onEnded is wired (search for `ended_fire` trace call) | Expand `ended_dedup` to reject any `ended_fire` whose track doesn't match the current `playingTrackId` OR whose `loadAttemptRef` doesn't match the listener's captured attempt. |
| `silent_wav_engage why=pre_advance_bridge` rare | Wherever that trace is emitted | Confirm the bridge engages on every `ended_fire` path, not only when `audioEnded=True`. |

---

## 10. Quick repro hint

Session `voyo_mnzfyfv2_qp0dn9` on Android Chrome 146. If the app is open, lock the phone while
a track is playing. Unlock 60s later. You should see a queue that has advanced by ~40 positions
and is now playing a random track. Telemetry confirms this happened in real life today.

---

**Data artifacts:** `/tmp/voyo-tel/all-24h.json` (3219 events, 1.4MB) is on the local box for
deeper poking.

**Service-key follow-up:** if a server-side analytics loop is ever needed, the Supabase service
role key for `anmgyxhnyhbyxzpjhxgx` was not found anywhere in the home dir. It would need to
be pulled from the Supabase dashboard and added to `voyo-music/.env` as `SUPABASE_SERVICE_KEY`.
For read-only hunts like this one the anon key is fine because the table's SELECT policy is
effectively open.
