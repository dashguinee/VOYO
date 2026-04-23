# NEED TO FINISH

Tracking items parked from the 2026-04-23 post-crash recovery session.
These need proper attention — don't batch blindly. Each has design or
schema decisions that should be made deliberately, not dispatched.

---

## In flight (dispatched, landing soon)

- [ ] **CardHoldActions** — global hold/swipe action system
  - Long-press: plush pills rise, themed edge-beam, dim backdrop, haptic
  - Swipe L/R: card follows finger, themed trail, threshold action
  - Two variants: has OYÉ (Like + Playlist) / no OYÉ (OYÉ + Download)
  - Wrapping: WideTrackCard, TrackCard, SongRow, portrait deck cards
  - Download action is stubbed — infra pass needed

---

## Audit P0 inventory (from pre-crash audits, still open)

### Security + schema
- [ ] **voyo_profiles RLS lockdown** — currently `USING (true)` means anyone can rewrite anyone's profile. Needs DASH-auth RPC written first, then policy that checks auth.uid() against dash_id. (SOCIAL-3 P0-2)
- [ ] **friendships table schema split** — two competing schemas (`users` vs `citizens`). Consolidate on one, migrate the other. (SOCIAL-1 P0-2)
- [ ] **Moments atomic increment RPC** — reactions use counter column + race, no atomic increment. Build a Postgres RPC `increment_moment_reaction(moment_id, reaction_type)` and call it instead. (MOMENTS-2 P0)
- [ ] **Moments schema: owner_id + stars uniqueness** — can't build per-user RLS without owner column; stars trivially inflatable without uniqueness. (MOMENTS-2)

### Data flywheel
- [ ] **Dual signal system dedup** — `src/brain/*` and `centralDJ` both subscribe to the same actions, double-counting locally. Pick one subscriber, delete the other. (AUDIT-5 F-01)
- [ ] **Grow LAST RESORT seed from 27 → 500+** — `data/tracks.ts` has 27 rows; when fallback chain tiers down, users hear the same 27 forever. Deferred in continuity batch — needs `video_intelligence` schema confirmation (safe SELECT cols, stable ordering at 324k rows). (AUDIT-4 P0-3)
- [ ] **afro-heat universal default bucket** — mood detection failures all fall into afro-heat. Mood-aware fallback. (SEARCH-2 P0-3)
- [ ] **pools.hot() local-preference** — prefers local `hotPool` when ≥20 items even if server has better content. Tilt the scale back to server. (SEARCH-2 P0-5)

### Audio lifecycle leftovers
- [ ] **Iframe post-swap streaming leak (up to 60s)** — pause+mute doesn't actually stop YouTube. Kill the iframe src, don't just mute. (AUDIT-2 #3)
- [ ] **nextTrack fires signals BEFORE AudioPlayer effect** — `play_start` never fires for auto-advanced tracks. Reorder so the effect mounts before signal emission. (AUDIT-1 #1)
- [ ] **Hot-swap canplay race can prime a stale src** — add a token check like we did for useHotSwap, but in the canplay listener. (AUDIT-2 #1)

### Social messaging
- [ ] **Messages realtime is INSERT-only** — read receipts never propagate because UPDATE isn't subscribed. Add `UPDATE` to the filter. (SOCIAL-1)
- [ ] **Presence ping dies on BG tabs** — 30s interval throttles to 1-2min when hidden, friends see you as offline. Use `visibilitychange` + `BroadcastChannel` so hidden tabs still report online. (SOCIAL-1)
- [ ] **Conversation channel subscribes to ALL messages** — filters client-side, bandwidth waste + RLS leak. Server-side filter via the realtime filter arg. (SOCIAL-1)

---

## VOYO Verse follow-up features (v2-v5)

v1 (deck + play + position sync) shipped 2026-04-23 as commit `8a18bd1`.

- [ ] **v2 — Person chat in OYO scroll area**
  - Horizontal swipe in the OYO chat row reveals friend chat
  - Chat messages scoped to the current jam session
  - New surface inside VoyoPortraitPlayer, reuses existing chat components
- [ ] **v3 — OYO-to-OYO thread**
  - Two AI DJs share session state, can emit "I'd add X next" proposals
  - User can accept → added to shared queue
  - Needs a thin agent-to-agent protocol on top of Supabase realtime
- [ ] **v4 — Shared queue**
  - Currently jam queue is host-owned, visitor rides along
  - v4: both can add via the "add next" RPC, votes resolve ties
- [ ] **v5 — Per-friend Dynamic Island grant**
  - Right now portal_open is a global bool (anyone can jam)
  - v5: allow/deny list + Dynamic Island notification to host when new visitor requests
  - More intimate, less spam

---

## Idle dim levels 2–3

v1 (simple 30s/60s fade) shipped 2026-04-23 as commit `fee2ae3`.

- [ ] **Level 2 — Time-of-day palette**
  - Morning / afternoon / golden-hour / night ambient states
  - 90s transition between states when hour flips
  - Purely cosmetic, no logic break
- [ ] **Level 3 — Audio-reactive ambient**
  - Use the analyser node (already feeding freqPump) to modulate a
    `--voyo-ambient-glow` CSS var in the 0.85–1.0 range
  - Subtle (max ±7%) — the UI "breathes" with the track
  - Signature feature — "this app literally pulses with the music"
  - Disable on low battery (< 20%) + prefers-reduced-motion

---

## UX polish

- [ ] **Font identity sprint** — dedicated pass to decide if Fraunces stays or if we move to Author/Neue Machina for the wordmark (the VOYO letters themselves). Current Satoshi body is fine; the question is just the brand moment.
- [ ] **Remaining X button migrations** — smaller X's still use ad-hoc styles. Audit + migrate the rest to `VoyoCloseX` where appropriate. Skip the clear-input / remove-from-queue X's — those are different semantic roles.
- [ ] **Download infra** — CardHoldActions has a Download button but it's stubbed. Needs:
  - Service Worker offline cache strategy for R2 audio
  - Per-user quota (indexedDB or cache API)
  - Download badge on cached tracks so user knows what's offline-ready
  - Background Sync API for queued downloads on flaky networks

---

## Deploy / ops

- [ ] **Fly.io zombie destroyed** — verify `voyo-music-api` is gone from Fly dashboard
- [ ] **R2 credentials rotated** — verified via smoke test ✓ (done)
- [ ] **/etc/voyo-health.env** on VPS — already existed ✓ (done)
- [ ] **VPS reload** — v418+ proxy changes + voyo-stream kill ✓ (done)

---

## Session state

- Post-crash recovery landed across ~20 commits (v414 → v423+)
- All live on voyomusic.com via Vercel auto-deploy from master
- CardHoldActions pending completion of final dispatched agent
