# OYO — VOYO Music Intelligence Layer

OYO is the ambient AI embodied by the VOYO orb. Users invoke it; it morphs into a mercury wobble with beams; they talk to it about music, culture, their vibe. OYO remembers them, has opinions, keeps conversations centered on music, and builds queues through chat.

This directory contains **Phase 1 — the BRAIN**. Phase 2 wires the visual morph UI. Phase 3 adds Gemini Live voice streaming. The public API stays stable across phases.

---

## Quick start

```ts
import { oyo } from '@/oyo';

const reply = await oyo.think({
  userMessage: "I'm in a chill mood, what should I play?",
  context: { timeOfDay: 'night' },
});

console.log(reply.response);
// "Late night chill? Say no more. Here's Tems and a slow Sampha cut to start."

console.log(reply.toolCalls);
// [{ name: 'addToQueue', args: { trackId: '...' } }, ...]

console.log(reply.mood); // "chill-late-night"
console.log(reply.newMemories); // ["User gravitates toward chill vibes"]
```

---

## Architecture

```
src/oyo/
├── index.ts            Public API: think(), remember(), recall(), reset(), getState()
├── schema.ts           Data model types (consciousness, memory, signals, tool calls)
├── consciousness.ts    OYO's persistent identity + state (localStorage)
├── session.ts          Per-conversation turn buffer (sessionStorage)
├── memory.ts           Long-term essence + signals (IndexedDB with fallback)
├── pattern.ts          Behavior signal aggregation → PatternSnapshot
├── essence.ts          Rule-based fact extraction from conversation turns
├── cache.ts            5-minute LRU cache for Gemini responses
├── thoughts.ts         Multi-step orchestrator — one think() cycle
├── providers/
│   └── gemini.ts       Gemini 2.5 Flash client with circuit breaker
├── tools/
│   ├── types.ts        ToolCall, ToolResult, ToolDefinition
│   ├── parser.ts       Extract <tool_call> XML blocks from model text
│   ├── registry.ts     Central dispatcher: executeTool(), getToolDescriptions()
│   └── music.ts        Music action tools (playTrack, addToQueue, searchByVibe, …)
└── data/
    ├── soussou.ts      Guinea language phrases + weaveSoussou() helper
    └── character.ts    OYO system prompt builder (personality + context injection)
```

---

## Memory model

Four layers, each with a different lifetime and purpose:

| Layer | Storage | Lifetime | Purpose |
|-------|---------|----------|---------|
| **Session** | `sessionStorage` | Tab close | Current conversation turns |
| **Consciousness** | `localStorage` | Forever | OYO's identity state about the listener (EODAS-H) |
| **Essence** | `IndexedDB` | Forever | Long-term fact memories ("loves late-90s hip-hop") |
| **Signals** | `IndexedDB` | Ring buffer (2000) | Raw behavior traces (plays, skips, reactions) |
| **Response cache** | In-memory LRU | 5 min | Dedupe identical prompts |

All IDB access is fault-tolerant — if IndexedDB is unavailable (SSR, private browsing), we fall back to in-memory Maps. Nothing throws.

### Consciousness (EODAS-H Lite)

```
E — Essence      WHO: name, locale, streak, first met
O — Objectives   WHAT: current vibe, musical interests, recent moods
D — Decisions    WHY: loved/avoided artists + tracks
A — Actions      DID: recommendation count, conversation count, last summary
S — Signals      PATTERNS: top artists, top genres, skip rate, time-of-day
```

Consciousness is injected into every system prompt so OYO can reference what it remembers without round-tripping through memory.ts.

---

## Tool system

OYO emits tool calls as XML blocks inside its response:

```xml
<tool_call><tool>addToQueue</tool><trackId>vyo_abc123</trackId></tool_call>
```

The parser (`tools/parser.ts`) extracts these, the registry (`tools/registry.ts`) dispatches them, and the music tools (`tools/music.ts`) wire directly to `usePlayerStore` and `useTrackPoolStore`. Tools execute BEFORE the natural language response is returned, so by the time the UI shows the reply, the action has already happened.

### Registered tools

| Tool | Purpose | Wires to |
|------|---------|----------|
| `playTrack` | Play a specific track immediately | `playerStore.playTrack()` |
| `addToQueue` | Queue a track | `playerStore.addToQueue()` |
| `shuffleQueue` | Toggle shuffle | `playerStore.toggleShuffle()` |
| `searchByVibe` | Score tracks in hot pool for vibe match | `trackPoolStore.hotPool` |
| `recallMemory` | Search essence memories by topic | `memory.searchEssences()` |
| `saveMemory` | Persist a new fact about the listener | `memory.saveEssence()` |
| `getCurrentContext` | Read now-playing + recent history | `playerStore` |

Adding a new tool = write a `ToolDefinition` in `tools/music.ts` (or a new file) and push it into `MUSIC_TOOLS`.

---

## Character

OYO's personality lives in `data/character.ts`. It's a LAYERED prompt:

1. **Core character** (stable): music-centric, opinionated, action-oriented, warm
2. **Consciousness block** (dynamic): what OYO remembers about this listener
3. **Soussou block** (conditional): if locale is `gn` / `fr-GN`, inject Soussou phrases
4. **Context block** (per-turn): now playing, time of day, recent plays, current mood

Key character rules:
- Music-centric gravity — drift-back if conversation strays
- Action-oriented — every turn ends with a concrete musical move
- Short-form — 1-4 sentences most of the time
- Opinionated — never neutral on music takes
- Cultural depth — drop one detail per turn, never lecture
- Guinea awareness — if Soussou block is injected, sprinkle warm phrases naturally

OYO also emits a hidden `<!--MOOD:...-->` marker at the end of each response which is parsed out and used for the orb's visual animation.

---

## Gemini integration

- **Model**: `gemini-2.5-flash`
- **Key**: `import.meta.env.VITE_GEMINI_API_KEY`
- **Timeout**: 20s (conversations should feel snappy)
- **Circuit breaker**: 3 failures → 10min cooldown, doubles to 60min max
- **History**: last 10 turns from session memory injected as `contents`
- **System prompt**: injected as `systemInstruction`
- **Cache**: 5-min LRU on (systemPrompt + userMessage + context) fingerprint

On Gemini failure, `thoughts.ts` returns a graceful fallback response keyed to common mood phrases so the UI keeps working.

---

## Public API

```ts
// Run one think cycle
oyo.think(input: OyoThinkInput): Promise<OyoThinkOutput>

// Save a fact about the listener
oyo.remember(fact: string, category?: MemoryCategory): Promise<EssenceMemory>

// Search memory
oyo.recall(topic: string, limit?: number): Promise<string[]>

// Reset session (+ optional full wipe)
oyo.reset(options?: { fullReset?: boolean }): Promise<void>

// Inspect current state
oyo.getState(): Promise<OyoState>

// Check if Gemini is reachable
oyo.isAvailable(): boolean
```

---

## Roadmap

- **Phase 1 (this)**: Brain only — text reasoning, tool calls, memory persistence
- **Phase 2**: Visual morph UI — orb wobble + beams on invoke, mood-driven animation
- **Phase 3**: Gemini Live voice streaming — swap `providers/gemini.ts` for the Live client, everything else stays

The Phase 1 API contract is designed so Phase 2/3 plug in without touching consumers of `oyo.think()`.
