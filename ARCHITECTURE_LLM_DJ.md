# VOYO Music - LLM DJ Integration Architecture

**Status:** Research & Design Phase
**Goal:** Intelligent music curation that understands natural language and context

---

## The Vision

Instead of just keyword matching, VOYO could have an **intelligent DJ** that:
- Understands "play something for a late night drive"
- Knows African music context (artists, regions, vibes)
- Learns user preferences over time
- Builds perfect queues for any mood

---

## Use Cases

### 1. Natural Language Queue Building
```
User: "I'm hosting a party, start with chill vibes then build up"
LLM DJ: [Builds queue: Chill tracks → Mid-energy → Bangers]
```

### 2. Contextual Recommendations
```
User: "Something like Burna Boy but more chill"
LLM DJ: [Understands artist style + mood modifier → finds matches]
```

### 3. Smart Tagging
```
New track enters pool
LLM DJ: [Analyzes title, artist, metadata → assigns mode, confidence, tags]
```

### 4. Vibe Detection
```
User's MixBoard: 80% Party, 20% Afro
LLM DJ: "You're in party mode! Here's what I'd add next..."
```

---

## Integration Approaches

### Option A: Claude API (Cloud)

**Architecture:**
```
User Input → VOYO Frontend → API Call → Claude → Response → Queue/Recommendations
```

**Pros:**
- Full Claude intelligence
- Understands complex context
- Can reason about music relationships
- API already exists (Anthropic)

**Cons:**
- Cost per request (~$0.003-0.015 per query)
- Latency (1-3 seconds)
- Requires internet
- Privacy considerations

**Implementation:**
```typescript
// services/llmDJ.ts
export async function askDJ(prompt: string, context: DJContext): Promise<DJResponse> {
  const response = await fetch('/api/dj', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      context: {
        currentTrack: context.currentTrack,
        modeIntents: context.modeIntents,
        recentHistory: context.history.slice(-10),
        availableTracks: context.trackPool.slice(0, 50), // Sample
      }
    })
  });
  return response.json();
}
```

**Backend (Node.js):**
```typescript
// api/dj.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function handleDJRequest(req, res) {
  const { prompt, context } = req.body;

  const systemPrompt = `You are VOYO DJ, an AI music curator specializing in African music.
You understand Afrobeats, Amapiano, and related genres deeply.
Given the user's current vibe and available tracks, suggest the perfect next tracks.
Respond with JSON: { "tracks": ["trackId1", "trackId2"], "reasoning": "..." }`;

  const message = await client.messages.create({
    model: 'claude-3-haiku-20240307', // Fast & cheap for DJ queries
    max_tokens: 500,
    system: systemPrompt,
    messages: [
      { role: 'user', content: `${prompt}\n\nContext: ${JSON.stringify(context)}` }
    ]
  });

  res.json(JSON.parse(message.content[0].text));
}
```

### Option B: Local LLM (Ollama)

**Architecture:**
```
User Input → VOYO Frontend → Local Ollama → Response → Queue/Recommendations
```

**Pros:**
- Free (no API costs)
- Fast (local inference)
- Private (no data leaves device)
- Works offline

**Cons:**
- Less capable than Claude
- Requires local setup
- Limited context window
- May not understand African music nuances

**Implementation:**
```typescript
// services/localDJ.ts
export async function askLocalDJ(prompt: string, context: DJContext): Promise<DJResponse> {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'mistral', // or llama2, phi
      prompt: buildDJPrompt(prompt, context),
      stream: false
    })
  });
  return parseDJResponse(await response.json());
}
```

### Option C: Hybrid (Recommended)

**Use Claude for:**
- Complex DJ conversations
- Natural language queue building
- Learning user preferences

**Use Local/Rules for:**
- Quick tagging of new tracks
- Simple mode detection
- Keyword matching (existing system)

**Architecture:**
```
                    ┌──────────────────┐
                    │  User Request    │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              │     Complexity Router       │
              └──────────────┬──────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐        ┌─────▼─────┐       ┌─────▼─────┐
    │ Simple  │        │  Medium   │       │  Complex  │
    │ (Rules) │        │  (Local)  │       │  (Claude) │
    └────┬────┘        └─────┬─────┘       └─────┬─────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Queue/Response  │
                    └──────────────────┘
```

---

## Implementation Plan

### Phase 1: Backend Endpoint (Week 1)
- Add `/api/dj` endpoint to VOYO backend
- Use Claude Haiku for cost efficiency
- Simple prompt → queue response

### Phase 2: Frontend Integration (Week 1-2)
- Add "Ask DJ" button in VOYO interface
- Natural language input field
- Display DJ reasoning

### Phase 3: Context Enhancement (Week 2-3)
- Pass MixBoard state to DJ
- Include recent history
- Pass track pool for selection

### Phase 4: Learning (Week 3-4)
- Store successful DJ suggestions
- Track user satisfaction (plays, skips, reactions)
- Feed back into DJ prompts

---

## Prompt Engineering

### System Prompt (Claude)
```
You are VOYO DJ, the world's premier AI music curator for African music.

Your expertise includes:
- Afrobeats (Nigeria): Burna Boy, Wizkid, Davido, Rema, Asake, Ayra Starr
- Amapiano (South Africa): Kabza De Small, DJ Maphorisa, Focalistic, Tyla
- Afro-fusion: CKay, Tems, Omah Lay
- Dancehall influences: Shatta Wale, Stonebwoy

You understand:
- Energy levels: from chill late-night vibes to explosive party bangers
- Regional sounds: Lagos vs Johannesburg vs Accra
- Mood progressions: how to build a set, when to peak, when to wind down

When curating:
1. Consider the user's current vibe (MixBoard state)
2. Look at what they've been playing (history)
3. Suggest tracks that flow naturally
4. Explain your reasoning briefly

Response format (JSON):
{
  "tracks": ["trackId1", "trackId2", ...],
  "reasoning": "Brief explanation of why these tracks",
  "vibeProgression": "chill → building → peak" // optional
}
```

### Example Interactions

**User:** "I'm working from home, need focus music"
**DJ Response:**
```json
{
  "tracks": ["essence_wizkid", "calm_down_rema", "love_nwantiti"],
  "reasoning": "Selected smooth Afrobeats with steady rhythms - no sudden drops to break concentration. Wizkid's Essence has that perfect work flow energy.",
  "vibeProgression": "steady chill"
}
```

**User:** "Party starts in 30 mins, warm up the crowd"
**DJ Response:**
```json
{
  "tracks": ["joha_asake", "unavailable_davido", "water_tyla", "city_boys_burna"],
  "reasoning": "Starting with Asake's infectious rhythm, building through Davido's party energy, Tyla brings the Amapiano heat, then Burna Boy to establish we're here for a good time.",
  "vibeProgression": "warm → building → ready to explode"
}
```

---

## Cost Analysis

### Claude API Costs (Haiku)
- Input: $0.25/MTok
- Output: $1.25/MTok
- Average DJ query: ~500 tokens in, ~200 tokens out
- Cost per query: ~$0.00037

**At 100 queries/day:** ~$1.11/month
**At 1000 queries/day:** ~$11.10/month

### Cost Optimization
1. Use Haiku (fastest, cheapest) for DJ queries
2. Cache common query responses
3. Batch similar requests
4. Use local fallback when possible

---

## Alternative: YouTube's Own Intelligence

YouTube already has recommendation systems. We could leverage:

### YouTube Mix Playlists
```
https://www.youtube.com/watch?v=VIDEO_ID&list=RDMM
```
Returns personalized mix starting from a video.

### YouTube Music API (if available)
- Related videos endpoint
- Trending music by region
- Auto-generated playlists

### Piped Related Streams
```typescript
// Already available in Piped API
const response = await fetch(`${PIPED_API}/streams/${videoId}`);
const data = await response.json();
// data.relatedStreams contains YouTube's recommendations
```

**Pros:**
- Free
- YouTube's algorithm is excellent
- Already understands music relationships

**Cons:**
- No natural language
- Can't explain reasoning
- Not customizable

---

## Recommendation

### Start With:
1. **Piped related streams** - Free, good quality, already available
2. **Rule-based mode matching** - Current system, improve keywords
3. **Track pool with engagement** - Learn from user behavior

### Add Later:
4. **Claude DJ** for natural language queries
5. **Local LLM** for tagging new tracks
6. **Hybrid** router for cost/quality balance

### Don't Build:
- Complex recommendation algorithm from scratch
- Training custom ML models (use existing)
- Real-time audio analysis (overkill)

---

## Questions for Next Session

1. Should DJ be a chat interface or single-query?
2. How much context to send to LLM (cost vs quality)?
3. Should DJ suggestions be auto-played or require approval?
4. How to handle "I don't have that track" gracefully?
5. Should DJ learn cross-user patterns (privacy implications)?

---

*Research by ZION SYNAPSE - Dec 16, 2025*
