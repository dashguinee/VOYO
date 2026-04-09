# VOYO DJ LLM - The Intelligent Music Experience

> "VOYO is an experience, not a music player. Music player is part of the experience."
> — Dash, December 2024

---

## THE VISION

VOYO isn't competing with Spotify on features. We're building an AI DJ that FEELS the room.

Real DJs read energy, anticipate needs, know when to bring it up and when to let it breathe.
VOYO does this digitally - learning from every tap, every reaction, every vibe.

---

## PHASE 1: REACTION SYSTEM (NOW)

### The Canvas Tap Flow
```
Default State     → Clean canvas, reactions ghosted/blurred
Single Tap        → OYÉ appears center - the VOYO handshake
Tap OYÉ / Again   → Reaction mode - full squad lights up
Triple Tap        → DJ Chat mode (future)
```

### Core Reactions (User Customizable)
| Reaction | Meaning | DJ Signal |
|----------|---------|-----------|
| OYÉ | "I'm vibing" | Engagement confirmed |
| Fireee | "THIS IS IT" | Play more like this |
| Wazzgúán | "What's good?" | Curious, exploring |
| Replay | "Again!" | High replay value |
| DJJJJJ | "Keep it coming!" | Momentum is good |

### What Reactions Feed
- **HOT Algorithm**: What's getting energy RIGHT NOW
- **DISCOVERY Algorithm**: "People who vibed with this → found these fire later"
- **Live Sync**: See others vibing with you in real-time (future)

---

## PHASE 2: DJ LLM BRAIN (NEXT)

### Intelligence Signals
| Signal | Interpretation |
|--------|----------------|
| Song added X times + 0 skips | FIRE (high confidence) |
| Long pause → return to track | Wine down moment needed |
| Multiple "Fireee" reactions | Increase similar tracks |
| "Slow down" reactions | Transition to chill |
| Skip within 10 seconds | Not vibing, learn from it |

### Natural Language Commands
- "Add Caribbean to the queue" → Search trending → Curate → Add
- "More Afrobeats" → Adjust algorithm weights live
- "Wine down" → Gradual tempo decrease
- "Build it up" → Energy escalation sequence

### Cultural Awareness Layer
The LLM doesn't just see data patterns - it understands:
- Genre transitions that work (Afrobeats → Dancehall = smooth)
- Cultural moments (drop timing, build-ups, wine sections)
- Regional preferences and trending sounds

---

## PHASE 3: LIVE DJ EXPERIENCE (FUTURE)

### DJ Mode Features
- Real-time reaction aggregation across listeners
- DJ can see crowd energy visualization
- Suggested next tracks based on room vibe
- User can validate DJ suggestions quickly
- Collaborative queue building

### The Formula
```
LLM + Algorithm > Hardcoded Algorithm
Cultural Awareness + User Signals = Intelligent DJ
```

---

## TECHNICAL ARCHITECTURE (Draft)

```
┌─────────────────────────────────────────────────┐
│                    VOYO APP                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │  Reactions  │  │  Playback   │  │  Queue  │ │
│  │   System    │  │   Events    │  │  State  │ │
│  └──────┬──────┘  └──────┬──────┘  └────┬────┘ │
│         │                │               │       │
│         └────────────────┼───────────────┘       │
│                          ▼                       │
│              ┌───────────────────┐               │
│              │   Signal Router   │               │
│              └─────────┬─────────┘               │
└────────────────────────┼─────────────────────────┘
                         ▼
              ┌───────────────────┐
              │    DJ LLM API     │
              │  ┌─────────────┐  │
              │  │   Claude    │  │
              │  │  (Cultural  │  │
              │  │  Awareness) │  │
              │  └─────────────┘  │
              └─────────┬─────────┘
                        ▼
              ┌───────────────────┐
              │  HOT / DISCOVERY  │
              │    Algorithms     │
              └───────────────────┘
```

---

## IMMEDIATE NEXT STEPS

1. [x] Redesign reaction system (tap canvas → OYÉ → expand)
2. [x] Implement ghosted/blurred default state
3. [x] OYÉ as central gateway interaction
4. [x] Reaction mode expansion animation
5. [x] Wire reactions to preference store
6. [ ] Feed reactions into Hot/Discovery weights
7. [x] SKEEP - Hold skip to fast-forward (2x → 4x → 8x chipmunk effect)
8. [x] Wazzguán → Chat transformation (DJ commands via natural language)

---

## THE NORTH STAR

**"Imagine telling the DJ 'add Caribbean to the queue' and it just... happens. While you're dancing."**

That's VOYO.

---

*Created: December 14, 2025*
*Authors: Dash + ZION Synapse*
*Status: LET'S BUILD*
