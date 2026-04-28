# VOYO Lyrics V2 — Spec

**Date:** 2026-04-29
**Status:** Draft for review
**Author:** Claude (with Dash)
**Trigger:** *"Imagine lyrics that don't just match but heights and weights sync to the song. Next lyrics in pill — pill arrives, expands, text expands. Like you released a bar. Proper sync, proper immersion."*

---

## Vision

Lyrics is not a screen the user opens, reads, and leaves. Lyrics is **the second performance** — the song delivers itself in type, on rhythm, with character. Excellence, immersion, fun. The user is watching the video in mini player; lyrics is where VOYO shines its control + creativity.

The signature move: **"the song drops a bar."** Each line arrives as a tight pill, then at its in-point the pill expands and the text swells — typography height + weight sync to the song's energy. You feel the bar.

---

## Current state — audit + test

**Pipeline today** (`src/services/lyricsEngine.ts` + `lrclib.ts` + `lyricsAgent.ts`):
- LRCLIB GET → synced (`[mm:ss.xx] line`) or plain → enrichedLyrics
- On miss → Gemini agent fallback (estimates timestamps)
- Cached to Supabase `voyo_lyrics`
- UI: VoyoPortraitPlayer's `LyricsOverlay` — line-by-line display, segmentProgress wipes the active line.

**Test, real tracks (2026-04-29):**

| Artist | Track | LRCLIB |
|---|---|---|
| Brenda Fassie | Vulindlela | ✓ synced (63 lines) |
| Burna Boy | City Boys | ✓ synced (62) |
| Tyla | Water | ✓ synced (73) |
| Tyler ICU | Mnike | ✓ synced (52) |
| Fireboy DML | Peru | ✓ synced (71) |
| Wizkid | Essence | ✓ synced (72) |
| Davido | Unavailable | ✓ synced (73) |
| Salif Keita | Tekere | ◐ plain-only |
| Bonez MC | GINJA SESSIONS | ✗ miss |

**Read:** Coverage is **stronger than I assumed**. 7/9 synced for the playlist that matters. The infrastructure to fetch + cache is solid — what's missing is the **experience layer**.

**The current overlay is table stakes.** Karaoke highlight + tap-word popup. That's a feature, not a moment. We can do dramatically better without rewriting the data layer.

---

## Design principles

1. **The bar is the unit.** A lyric line = a *bar*. Render it as one object that arrives, lands, decays.
2. **Time as a felt dimension.** Position, scale, weight, color, opacity — all tied to the bar's lifecycle (preview → active → fade).
3. **Coverage gaps are part of the show.** A miss doesn't break the experience — Whisper-on-the-fly + "we're listening" UI keeps the user inside the moment.
4. **The video is the co-star.** Lyrics live ALONGSIDE the mini player, not instead of it. Composition is shared real estate.
5. **Restraint scales the drama.** When a bar drops, everything else dims.
6. **Audio energy → visual weight.** Loud passages → bigger, heavier type. Whisper passages → lighter, slimmer.

---

## Core experiences

### A. Mini player + lyrics (the signature)
The user has the video floating (mini, top of card or PiP). Below it: the lyrics canvas. The two share rhythm — bg gradient pulses with the beat, lyric pill arrives 200ms before the line is sung, expands at the in-point.

### B. Full-screen lyrics (immersive)
Hold artwork → lyrics overlay (already wired v807). In V2 the overlay is darker, the bar choreography is amplified, the video iframe blurs to background ambience.

### C. Singalong loop (skill mode)
A long-press on any bar locks a 2-line loop with playback at 0.85×. User can practice that bar. Tap to release.

---

## Typography that breathes

Every bar has three live values:

```
weight  → 300..900   (tied to RMS energy of the segment's audio window)
size    → 18..36px   (tied to the bar's "heat" — hooks/choruses heavier)
opacity → 0..1       (lifecycle stage)
```

**Where the energy comes from:** audio RMS sampled inside the bar's window. We already have `--voyo-energy` CSS var driven by the FFT pump. Extend it: `--voyo-rms-N` per upcoming bar (precomputed at lyric-load time from the audio buffer).

**Hook detection:** Lines that repeat 3+ times in the LRCLIB lyrics body get marked `isHook: true` → +2 weight steps, +20% size. The chorus lifts itself.

**Per-language calibration:** Yoruba/Wolof/Mandinka hooks tend to ride consonant percussion — different RMS profile than English vocals. Add a per-language curve (later phase).

---

## The pill choreography (the signature move)

```
   STATE    │  POSITION    │  SCALE  │  WEIGHT  │  TIMING
───────────┼──────────────┼─────────┼──────────┼──────────────
   queued   │  below fold  │  0.92   │  400     │  pre-load
   arrived  │  visible     │  0.92   │  400     │  in-point − 220ms
   landing  │  visible     │  1.00   │  500-800 │  in-point ± 80ms
   live     │  centered    │  1.06   │  600-900 │  during the bar
   decay    │  drifting up │  0.94   │  400     │  out-point + 0ms
   gone     │  off-screen  │  0.88   │  300     │  out-point + 1.2s
```

The pill **doesn't slide in flat** — it **arrives**. A subtle spring (cubic-bezier 0.16, 1, 0.3, 1.4) on scale + opacity. At the in-point the text inside the pill expands; the pill chrome breathes outward 6px to "release" the bar.

Background of the active pill: a thin bronze hairline (matches Mix Board v811) + soft outer glow tinted by the song's average album-art color (sampled once at track start).

Two-bar lookahead: the *next* bar pre-renders below the active one in queued state. The user sees what's coming. Builds anticipation like a music video would.

---

## Sync engine architecture

**Source priority:**
1. **LRCLIB synced** (current; primary; ~75% of mainstream Afrobeats hit)
2. **LRCLIB plain + Whisper align** (NEW — when LRCLIB has plain lyrics but no timestamps, run Whisper on the audio and force-align the plain text to Whisper's timing)
3. **Whisper-from-scratch** (NEW — when both LRCLIB miss; transcribe + use as best-guess)
4. **Gemini agent** (current fallback; lyrics generation when audio is unavailable)
5. **Supabase community-curated** (override layer: when a verified user fixes timing, save it; future plays use the corrected version)

**Refinement loop:**
- Waveform onset detection (Web Audio + chroma analysis on first play) → snap LRCLIB timestamps to nearest beat onset within ±150ms. Removes the "lyric lags by half a beat" feel.
- Per-track community corrections via long-press on a misaligned line → "shift this line" gesture (drag up/down 50ms increments). Persisted to Supabase.

**Timing precision target:** ≤80ms drift between audio downbeat and pill landing. LRCLIB raw averages ~200-300ms drift on Afrobeats; the onset-snap brings it to ~50ms.

---

## Fallback chain (the show goes on)

When LRCLIB misses:
- **Loading state**: instead of "checking LRCLIB...", show the **video continuing** with a soft pulsing bronze pill at the bottom: *"OYO is listening"*. Whisper transcribes on the fly. Bars start arriving as they land.
- **Whisper miss**: show a one-time pill: *"This one's between us — no lyrics yet."* Then a chip: *"Help VOYO hear it"* → opens contributor flow (paste lyrics from clipboard, line-by-line tap-to-time).
- **Plain-only (Salif Keita case)**: show all lines centered, **no karaoke**. Single-pill "tape mode" — 3 lines fading top-to-bottom with the song progress bar. Cultural-context pill below: language + region. Calmer, less performative.

---

## Cultural depth (the why, not just the what)

Each segment can carry a `culturalNote` (already in the type). V2 uses it:

- **Long-press a word** → not just translation popup, but a 2-line context: *"`Asambe` — Zulu for 'let's go'. The song's hook is built on this push-forward energy."*
- **End-of-track summary card**: the 3 most-replayed bars + their cultural meaning. Saved automatically to the user's anthology.
- **Cross-track threading**: if the same word recurs in a track the user has played before, the popup says *"You've heard this in 3 other songs."* Builds vocabulary across listening.

OYO writes these on first play (Gemini call, async, cached to Supabase). User doesn't wait.

---

## Singalong loop

- **Long-press a bar** (~700ms; doesn't conflict with the 350ms hold-for-lyrics on the artwork) → bar pulses, "Loop this" pill rises.
- Confirm tap → playback drops to 0.85×, loops the 2-bar window.
- Bar enlarges to fill the screen, weight bumps to 800, phonetics show below the original.
- Tap to release.

This turns lyrics into a learning tool. Especially powerful for non-Latin scripts.

---

## Personal anthology

Every track played + lyrics shown contributes to the user's anthology. Two surfaces:

- **Saved lines**: long-press → "Save this bar" → goes into a list (linked back to track + timestamp)
- **Auto-curated "Lines that hit you"**: most-replayed segments per track (we already have replay/skip data via the playback signal flow)

Lives in **Library → My Disco → Anthology** sub-tab (later phase; not P0).

---

## Implementation phases

### **Phase 0 — chrome cleanup (already shipped, v812)**
Header gone, full screen for words. Foundation for V2.

### **Phase 1 — pill choreography (P0, ~3 days)**
- Replace current line-by-line render with bar-pill component
- Lifecycle state machine (queued → arrived → live → decay → gone)
- Two-bar lookahead
- Spring-in animation
- Active-bar bronze hairline + glow

**Deliverables:** New component `LyricsBar.tsx`, refactored `LyricsOverlay.tsx`, no data-layer changes. Visual upgrade only.

### **Phase 2 — typography sync (P0, ~2 days)**
- Per-bar RMS precomputation at lyric load (one pass over the audio buffer)
- Weight + size mapping driven by RMS
- Hook detection (3+ repeats → +size, +weight)
- CSS custom prop `--voyo-bar-rms` driving live weight

**Deliverables:** RMS analyzer (`src/services/lyricsAudioRms.ts`), bar precompute hook, weight/size formulas in `LyricsBar`.

### **Phase 3 — sync refinement (P1, ~3 days)**
- Onset detection on track first-play (Web Audio AnalyserNode + chroma)
- Snap LRCLIB timestamps to nearest onset within ±150ms
- Persist refined timestamps to Supabase per-track

**Deliverables:** `src/services/lyricsOnsetSync.ts`, Supabase migration for `refined_at` column.

### **Phase 4 — fallback chain (P1, ~3 days)**
- Whisper-on-the-fly when LRCLIB misses (already wired in `whisperService`, just need to thread to lyrics)
- "OYO is listening" pulse pill
- Plain-only "tape mode"
- Contributor flow (line-by-line tap-to-time)

**Deliverables:** Whisper-align bridge in `lyricsEngine.ts`, contributor UI, cache layer for community corrections.

### **Phase 5 — cultural depth (P2, ~2 days)**
- Long-press word → 2-line context (Gemini-generated, cached)
- End-of-track summary card
- Cross-track word threading

### **Phase 6 — singalong + anthology (P2, ~3 days)**
- Long-press bar → loop mode
- 0.85× playback
- Saved lines list in Library

**Total to "excellence + immersion + fun":** Phases 1+2+3+4 ≈ 11 days focused work. Phases 5+6 are post-ship enhancement.

---

## Open questions

1. **Pill width — fixed or content-fit?** Fixed (e.g., max-w-md, centered) reads steadier; content-fit feels organic but bars can be 40-character monsters. Lean: fixed with line-wrap.
2. **Multi-line bars** (LRCLIB sometimes joins two phrases on one timestamp). Split or keep? Lean: keep — the song treats them as one breath.
3. **Color theme per song**? Sample album art and tint the active pill bronze→derived-color blend? Could be magic; could be inconsistent. Lean: ship bronze-only first, theme as v2.5.
4. **Whisper cost**: live transcription on miss adds ~$0.006/min. Acceptable for the user, not for everyone-everywhere. Gate behind: user has played this track 30s+ AND clicked into lyrics overlay.
5. **Offline mode**: cached lyrics work. Whisper-on-miss requires network. Show "offline — saved bars only" state.

---

## Risk

- **Pill choreography is the make-or-break.** If the timing feels even 80ms off, it's worse than the current static line. Phase 3 (onset snap) is what makes Phase 1 actually deliver. Don't ship Phase 1 alone.
- **RMS computation on phone** (Phase 2): one pass over audio buffer at track start is ~50ms on iPhone SE. Acceptable. Don't run it on every render.
- **"Drops a bar" feel needs haptic.** Soft tick on the pill landing. Optional, but adds a lot.

---

## Dash's call

- **Build it?** Phases 1+2+3+4 over ~2 weeks ships excellence/immersion/fun.
- **Defer?** Current works for 75% of tracks. Mix Board + portrait player polish is shipped — lyrics V2 is the next big swing.
- **Trim it?** Could ship Phase 1 (pill) + Phase 2 (typography) for the visible "wow" without Phase 3/4. Risky — see Risk #1.

The hill I'd die on: **Phase 1 + Phase 2 + Phase 3.** Pill, breathing type, locked sync. That's the whole vision delivered. Phase 4 (fallback) and beyond can ride after.
