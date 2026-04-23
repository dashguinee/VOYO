# Audit: Skip / State Transitions / Leaks (post-Omah Lay test)

Evidence collected from sessions voyo_mo0df78y_hakw4v (Omah Lay) + voyo_mo0de2r1_t971te (other overlapping).

---

## 🚨 FINDING #1 — TWO TABS OVERLAPPING (user-side)

Two VOYO PWA tabs were both running 18:15:46–18:19:45.

**Impact:**
- Two AudioPlayer components, two audio elements, two Web Audio graphs (each per-tab)
- Two MediaSession registrations — last writer wins, OS controls target only one tab
- Android audio focus war: only ONE tab can produce audio at a time; the other gets silently paused by OS
- When tab in FG has control and user switches: focus flips, both pause/resume rapidly
- Cross-tab localStorage writes ping-pong the persisted state

**"Seekbar jerking" most likely cause:** Tab A was playing in BG, OS pulled focus (maybe handed to Tab B briefly, or power-save). Element paused silently. User unlocks → visibility handler re-kicks play() → brief audio before focus flips again → currentTime updates come in bursts after being quiet → UI redraws with stale positions before catching up.

**Fix options:**
- **User:** close one tab. No code change.
- **Code:** use BroadcastChannel to detect sibling tabs and show "paused in favor of other tab" UI. Defer actual playback to whichever tab the user focuses.

---

## 🔴 FINDING #2 — PRELOAD ONLY FIRES FOR THE FIRST TRACK OF A SESSION

**The bug:** `hasTriggeredPreloadRef` is declared at `AudioPlayer.tsx:191`, checked at `489-496`, set to `true` at `549`, and reset to `false` **inside the async loadTrack body** at `1779`.

**Problem:** When `currentTrack.trackId` changes, React fires effects in declaration order:

1. Preload effect body (line 489) — checks `hasTriggeredPreloadRef.current` — **TRUE** (from previous track) — bails immediately
2. Preload-cleanup effect body (line 570) — registers new cleanup
3. loadTrack effect body — calls `loadTrack()` async — only NOW does it reset the flag at line 1779

By step 3, step 1 already ran and bailed. The preload effect **never schedules preloads for the new track**.

**Confirmed by telemetry:** v194 Omah Lay session — preload_start only fires ONCE at +0.00s (first track). No preload_start after that, yet track advanced 3 times. Every subsequent `preload_check hit=False`.

**Fix:** dedup by trackId, not by a reset-able flag. The flag pattern has a race with the async reset; a per-trackId dedup has no timing dependency.

```ts
const preloadedForTrackIdRef = useRef<string | null>(null);
// In preload effect:
if (!currentTrack?.trackId) return;
if (preloadedForTrackIdRef.current === currentTrack.trackId) return;
preloadedForTrackIdRef.current = currentTrack.trackId;
// ... schedule preloads
```

**This is likely the biggest single reason BG auto-advance feels broken: preload NEVER hits, so every transition falls to live extraction (6s+ silence floor).**

---

## 🟡 FINDING #3 — BG TELEMETRY STILL DROPS (v192 sendBeacon unverified)

Omah Lay session has a 142-second gap (+53.39s to +195.59s) during which:
- Track changed DqUd72pK15Y → gFtZqhnXyGw (we see the after-state)
- source_resolved attempt=3 (means 2 attempts failed before succeeding)
- preload_fail iOGJ76ct8G8 (a separate preload failed)

ALL these events flushed at +195.59s (when visibility returned). Meaning: BG events queued and flushed on visibility, sendBeacon didn't deliver them live.

**Hypothesis:** sendBeacon per-event IS delivering some events, but the burst rate in BG is so high that browser drops/queues them. Or sendBeacon is being throttled on Android Chrome in deep BG despite spec promise.

**Not a playback bug** — a debuggability bug. Fixing #2 might reduce BG trace volume enough that sendBeacon keeps up.

---

## 🟢 NON-ISSUES (Audited, clean)

- **Event listener leaks:** checked all `addEventListener` sites. `once:true` used appropriately, explicit removeEventListener in handlers. No leaks found.
- **Timer leaks:** `setTimeout` sites all have cleanups OR use `isStale()` guards inside. Silent WAV keeper timer (line 2187) uses isStale guard.
- **canplay handlers:** belt-and-suspenders removal (both `once:true` and explicit remove). Safe.
- **Preload audio element cleanup:** `consumePreloadedAudio` pauses + clears src of the preload element after transferring URL. No dangling audio.
- **Seek effect:** only fires when `seekPosition` changes. No spurious seeks.

---

## FIX ORDER

**v196 IMMEDIATE:**
- Finding #2: preload dedup by trackId. One-file change in AudioPlayer.tsx. High confidence, high impact.

**v196+ (discuss):**
- Finding #1: cross-tab detection via BroadcastChannel. Shows warning UI when sibling tab opens. Defers playback to focused tab.

**Background:**
- Finding #3: investigate sendBeacon burst rate if BG telemetry still drops after #2 reduces noise.
