# VOYO — AI Music Architect

## What VOYO Is

VOYO is not a music player. It is not a playlist app. It is not a mood companion.

**VOYO is an AI Music Architect** — a system that learns your taste over time and builds the perfect listening experience for where you are, what you've heard, and who you are musically.

The distinction matters because:
- A music player gives you control
- A companion tries to match your emotion
- An architect **reads the room** and constructs the experience

VOYO constructs. Every session is a building — not a stream.

---

## The OYO Core Principle

OYO is the brain. It is a DJ that has heard you play, skip, react, and listen. It doesn't ask what you want. It knows.

A great DJ:
- Anchors the room first (familiar, proven tracks)
- Takes measured risks when trust is established
- Knows when you're locked in and goes deeper
- Pivots before you realize you needed it
- Never plays the same artist twice in a row unless you're in love

OYO embodies this. The `engagement` state machine (`searching → warming → vibing → locked`) is the DJ reading the room. The session arc is the set.

---

## The Anti-Repeat Contract

Based on research across Spotify, Apple Music, Deezer, YouTube Music, Tidal, and SoundCloud:

**Threshold**: After 8–10 songs, a repeat track causes measurable session abandonment.
**Target**: < 20% repeat rate within any 20-track window.
**Implementation**:
- 40-track exclusion window (playerStore) — no track replayed in last 40
- Freshness-score shuffle (pools.ts) — penalizes back-to-back same-artist slots, picks ordering with best separation
- Discovery pool diversity (oyoPlan.ts) — favorite artists capped at 30% of DISCOVER pool, preventing echo chamber
- 3-tier fallback: excluded → partially excluded (shuffled) → anything except current

---

## The 70/30 Rule

Research consensus (Spotify internal, Deezer UX studies, music psychology):

| Context | Familiar | New |
|---------|----------|-----|
| Morning (5–10h) | 90% | 10% |
| Afternoon (10–18h) | 70% | 30% |
| Evening (18–22h) | 80% | 20% |
| Late night (22–5h) | 75% | 25% |

**Default: 70% familiar, 30% new.** New music peaks at 10–20 plays (mere exposure effect). Beyond that, familiarity breeds the positive arousal response that keeps people listening.

VOYO implements this via time-of-day pool sizing in `oyoPlan.ts` — the discoverPool entering the candidate mixer is scaled by hour-of-day, not by a global ratio.

---

## The Session Arc

Spotify Loud & Clear data: AI DJ sessions are 25% longer than manual playlist sessions because the arc is designed, not random.

The VOYO session arc (implemented in `oyo/dj.ts` + `oyo/arc.ts`):
```
Anchor (familiar) → Comfort (groove established) → Discovery (cultural risk) → Familiar closer
```

The arc is adaptive:
- Skip streak → skip pivot → cycle to a new direction
- 3+ completions → "in flow" → delay the scheduled shift, go deeper
- Reaction → reaction boost → surface more of what triggered it

---

## VOYO Is African Music-First

Not "world music." Not "afrobeats-ish." African music-first.

The cultural tag system (`cultural_tags`, `CULTURAL_PIVOTS` in dj.ts) preserves African cultural coherence across bridges. When the DJ pivots:
- `celebration` pivots to `roots` or `tradition` (not trap)
- `festival` pivots to `liberation` or `pan-african`
- `street` pivots to `motherland`

The goal is a session that feels like being at a great African club night — flowing, surprising, coherent, never random.

---

## The Flywheel

```
User plays → signal recorded → DJ profile updated → better recommendations
User skips → skip weight added → that track deprioritized for this user
User reacts → reaction boost → surface more like it → vibe training RPC
```

Every session teaches VOYO. The product gets better the more you use it. This is why VOYO is an architect, not a player — it builds a model of you.

---

## What We Don't Do

- No "smart shuffle" that's just random (random is the enemy of taste)
- No mood detection via microphone or sensor
- No "you might also like" cold email recommendation loops
- No algorithm pop-ups asking you to rate things
- No generic "Chill Vibes" playlists — VOYO is personal, not generic

---

*VOYO Identity v1 — locked 2026-05-04. Written after overnight audit session (v1039→v1042) + industry research covering Spotify, Apple Music, Deezer, YouTube Music, Tidal, SoundCloud.*
