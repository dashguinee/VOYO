# VOYO AI Architecture — The OS Layers

**VOYO is an OS, not an app.** Music is the first workload. OYO is the intelligence. The visuoir is the ambient shell.

---

## The 4 + 1 layer stack

```
                    ┌──────────────────────────────────┐
          SHELL  →  │          VISUOIR (+1)            │   ambient feedback
                    │  thinking · answering · next-up  │   top of screen
                    │  morphs into Dynamic Island      │
                    │  when notifications appear       │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
    INTELLIGENCE →  │          OYO (Layer 1)           │   personality, voice,
                    │  Chat · Voice · Taste · Memory   │   the "face" the user
                    │  /src/oyo/                       │   talks to
                    └──────────────┬───────────────────┘
                                   │ emits tool_calls
                    ┌──────────────▼───────────────────┐
     TOOL BRIDGE →  │       Tool Registry (Layer 2)    │   action surface
                    │  /src/oyo/tools/music.ts         │   13 tools total
                    │  play/pause/skip/seek/volume/... │   decouples brain
                    └──────────────┬───────────────────┘   from stores
                                   │ dispatches
                    ┌──────────────▼───────────────────┐
      CURATION   →  │    DJ Systems (Layer 3)          │   what to play next
                    │  centralDJ · intelligentDJ       │   /src/services/
                    │  mode training, mix board,       │   pool scoring
                    │  recommendation math             │
                    └──────────────┬───────────────────┘
                                   │ reads
                    ┌──────────────▼───────────────────┐
      KNOWLEDGE  →  │    Brain (Layer 4)               │   signals + patterns
                    │  VoyoBrain · SignalBuffer        │   /src/brain/
                    │  SignalEmitter · KnowledgeStore  │   /src/knowledge/
                    │  track metadata, vibe clusters,  │
                    │  play patterns, time-of-day      │
                    └──────────────────────────────────┘
```

---

## Layer responsibilities

### Layer 4 — Brain (raw cognition)
**Files**: `src/brain/VoyoBrain.ts`, `src/brain/SignalEmitter.ts`, `src/brain/SignalBuffer.ts`, `src/knowledge/KnowledgeStore.ts`

Captures every signal — plays, skips, reactions, time-of-day, vibe shifts — and builds the pattern substrate. Never speaks, never decides. Just knows.

### Layer 3 — DJ Systems (curation math)
**Files**: `src/services/centralDJ.ts`, `src/services/intelligentDJ.ts`, `src/services/poolCurator.ts`, `src/services/personalization.ts`

Turns signals into "what should play next". Pool scoring, mode training, mix board, trending vs discovery balance. Pure math. Doesn't know about the user's words.

### Layer 2 — Tool Registry (action surface)
**File**: `src/oyo/tools/music.ts`

13 tools — the ONLY bridge between OYO's brain and the rest of the app:

**Curation (pick music)**
- `playTrack` — play a specific track
- `addToQueue` — add to queue
- `searchByVibe` — find by mood/vibe

**Playback control (OS layer)**
- `togglePlay` — pause/resume
- `nextTrack` — skip forward
- `prevTrack` — skip back
- `seekTo` — jump to time ("skip to 2 minutes")
- `setVolume` — 0-100, includes mute
- `cycleRepeat` — off/all/one
- `shuffleQueue` — toggle shuffle

**Memory (remember things about the user)**
- `recallMemory` — semantic search over saved essences
- `saveMemory` — persist a thought/preference
- `getCurrentContext` — time, track, mood snapshot

### Layer 1 — OYO (personality + voice)
**Files**: `src/oyo/thoughts.ts`, `src/oyo/providers/gemini.ts`, `src/oyo/data/character.ts`, `src/oyo/data/soussou.ts`, `src/oyo/memory.ts`

The face. Speaks in Dash's character voice (Soussou phrases, Malaysia context, energy matching). Reads context, emits `<tool_call>` XML, threads memory. Gemini 2.5 Flash backend.

**Input surfaces:**
- Text chat — wired (`OyoIsland`, `OyoInvocation`)
- Voice — transcript captured in App.tsx:486, **not yet routed to brain** (single wire missing)

### +1 — Visuoir (ambient shell)

The top-of-screen ambient indicator. Not yet built as a unified component. It's the "eye" that shows OYO's state without being intrusive.

**State → color mapping (proposed):**

| State | Color | Motion |
|-------|-------|--------|
| Idle | none / very dim | static |
| Listening (voice active) | silver-white soft glow | breathing pulse |
| Thinking | silver-white intensifying | slow swirl |
| Answering | VOYO purple (#8b5cf6) | flowing wave |
| Chatting / typing | VOYO purple | typing ripple |
| Next-up notification | amber flash | brief shimmer |
| Error / stall | dim red | static fade |

**Emergent behavior:**
- Morphs into Dynamic Island when a notification arrives (swipe-to-dismiss, tap-to-expand)
- Expands to show now-playing when OYO surfaces a "vibe shift" insight
- Shrinks to dot when idle — ambient, unobtrusive

This is the seam where the OS feel lives. Don't build it as a chat widget — it's more like a cursor: always present, changes shape for context.

---

## Design psychology

**Silver-white = thinking/listening** — neutral, attentive, no commitment yet. Like a face paying attention before speaking.

**Purple (VOYO brand #8b5cf6) = answering/speaking** — warmth, flow, music itself. The app's voice.

**No globe, no chrome** — unlike ZION Synapse cockpit which is admin-dense, the Visuoir is a single ambient element. The rest of the screen is still about the music. The visuoir is the thinnest possible surface for OYO's presence.

---

## Why this unification matters

Before: 4 AI systems (Brain, DJ x2, OYO) running in parallel, each with its own UI surface or no surface at all. Users never saw OYO as one coherent entity.

After: clear **pipe** — signals flow up through Brain → DJ → Tools → OYO → Visuoir. Each layer has one job. The Visuoir becomes the single visible touchpoint for "is the AI thinking? answering? idle?"

This is what lets the shell be adaptive:
- VOYO Music: Visuoir at top, purple accents
- Future VOYO Tivi: Visuoir at top, different accent color, same shape
- Future VOYO work-mode: Visuoir at top, calm blue, different tool set

The Visuoir is the OS chrome. The content below is just the current app the OS is running.

---

## Current state (2026-04-14)

| Layer | Status |
|-------|--------|
| Brain | ✅ Running, capturing signals |
| DJ Systems | ✅ 3 systems (voyoDJ deleted) |
| Tool Registry | ✅ 13 tools (6 added this session) |
| OYO (chat) | ✅ Wired |
| OYO (voice) | ⚠️ Input captured, not routed to brain |
| Visuoir | ❌ Not unified yet (scattered components: OyoIsland, OyoInvocation, OyoTrigger) |

---

## Next moves (when Dash is ready)

1. **Wire voice → OYO brain** — one bridge in App.tsx connects transcript to `oyoThoughts.process()`
2. **Unify Visuoir** — one component, one state machine (idle/listening/thinking/answering/notifying)
3. **Dynamic Island morph** — the emergent behavior when notifications arrive
4. **Color psychology pass** — apply silver-white vs purple consistently

No changes yet — just the map.
