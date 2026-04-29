/**
 * VOYO Moments Engine — taste-aware ranking + session signals
 *
 * Mirrors the audio side's pool architecture (oyo/pools.ts) but for the
 * Moments surface. Pure functions over already-fetched rows so the DB
 * query stays simple — taste is layered on the client where the
 * favoriteArtists / favoriteMoods are already hydrated by oyoDJ.
 *
 * Public surface:
 *   rankMoments(rows, ctx)       — score + sort + dedup, returns N moments
 *   recordSessionPlay(creator)   — bumps creator weight (1.5s dwell)
 *   recordSessionSkip(creator)   — small negative on creator
 *   recordSessionStar(creator)   — heavy positive (= follow)
 *   markShown(momentId)          — adds to session dedup set
 *
 * Scoring (per moment):
 *
 *   +60  parent_track_artist ∈ favoriteArtists
 *   +30  vibe_tags ∩ favoriteMoods != ∅
 *   +25  creator already in session-followed (star)
 *   +session creator weight (-15..+50, drifts back to 0 across pages)
 *   + popularity boost     log10(views+10) * 6, capped 25
 *   + reaction boost       log10(reactions+1) * 6, capped 15
 *   + recency curve        30 → 0 across 90d
 *   − 100  if shown this session (hard demotion)
 *   − 25   if creator over-represented in current slice
 *
 * The numbers are calibrated so a strong taste match (favorite artist
 * + favorite mood) beats raw recency, but a brand-new viral moment
 * from an unknown creator can still surface via popularity + recency.
 */

import type { Moment } from '../types/moments';

// ── Session memory ────────────────────────────────────────────────────────
//
// Lives for the lifetime of the page session. Resets on reload — same
// rule the audio side uses for "shown this session" dedup.

const sessionShown = new Set<string>();
const creatorWeights = new Map<string, number>();
const sessionStarred = new Set<string>();
// v858: ring buffer of the last N creators shown. Used to penalize
// back-to-back appearances — even if a creator earns the slot, we
// don't want to see them twice in 3 swipes. Rhythm > raw score.
const RECENT_CREATOR_WINDOW = 5;
const recentCreators: string[] = [];

// v861 — cross-session cooldown. localStorage-persisted map of
// momentId → last-shown timestamp. Moments seen in the last 48h
// are deprioritised (-60 score) so the user genuinely traverses
// the catalog over days, not the same recent set on loop. Critical
// because the catalog has ~6,800 active moments but only 4 creators
// own 74% of them — without cooldown, the same set recirculates
// every session. Backed by Netflix exposure-debiasing research +
// epsilon-greedy literature (Sutton & Barto, RL).
const COOLDOWN_KEY = 'voyo-moments-cooldown-v1';
const COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48h
let _cooldown: Map<string, number> | null = null;
function loadCooldown(): Map<string, number> {
  if (_cooldown) return _cooldown;
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    if (!raw) { _cooldown = new Map(); return _cooldown; }
    const obj = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    _cooldown = new Map();
    // Drop expired entries on load — keeps the map bounded.
    for (const [id, t] of Object.entries(obj)) {
      if (now - t < COOLDOWN_MS) _cooldown.set(id, t);
    }
  } catch {
    _cooldown = new Map();
  }
  return _cooldown;
}
function saveCooldown(): void {
  if (!_cooldown) return;
  try {
    const obj: Record<string, number> = {};
    _cooldown.forEach((t, id) => { obj[id] = t; });
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(obj));
  } catch { /* private mode / quota */ }
}
let _cooldownSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCooldownSave(): void {
  if (_cooldownSaveTimer) return;
  _cooldownSaveTimer = setTimeout(() => {
    _cooldownSaveTimer = null;
    saveCooldown();
  }, 1500);
}

/**
 * Bump creator affinity (positive). Called when the user dwells ≥1.5s
 * on a moment (recordPlay path). Decays slightly each call so the
 * weight stays bounded.
 */
export function recordSessionPlay(creator: string | undefined): void {
  if (!creator) return;
  const cur = creatorWeights.get(creator) ?? 0;
  creatorWeights.set(creator, Math.min(50, cur + 8));
}

/**
 * Soft-negative on creator. Skips on the moments feed are nuanced — a
 * skip might mean "not now" rather than "never again". Keep the
 * penalty small.
 */
export function recordSessionSkip(creator: string | undefined): void {
  if (!creator) return;
  const cur = creatorWeights.get(creator) ?? 0;
  creatorWeights.set(creator, Math.max(-25, cur - 4));
}

/**
 * Heavy positive — star = follow on this surface, deliberate intent.
 */
export function recordSessionStar(creator: string | undefined): void {
  if (!creator) return;
  sessionStarred.add(creator);
  const cur = creatorWeights.get(creator) ?? 0;
  creatorWeights.set(creator, Math.min(60, cur + 30));
}

export function markShown(momentId: string, creator?: string): void {
  sessionShown.add(momentId);
  // v858: keep last N creators for back-to-back penalty.
  if (creator) {
    recentCreators.push(creator);
    if (recentCreators.length > RECENT_CREATOR_WINDOW) recentCreators.shift();
  }
  // v861: persist to localStorage cooldown. Debounced save so 20
  // moments scrolling don't hit storage 20 times.
  const cd = loadCooldown();
  cd.set(momentId, Date.now());
  scheduleCooldownSave();
}

// v861 — exposed for OYE handler so OYE'd moments can be EXEMPTED
// from cooldown (loved content can resurface).
export function clearCooldownForMoment(momentId: string): void {
  const cd = loadCooldown();
  if (cd.delete(momentId)) scheduleCooldownSave();
}

// v860 — surface the social-graph creators for the Friends lane.
// Currently sessionStarred only; track engaged-via-OYE separately
// for the same view (recordSessionPlay already bumps creatorWeights
// but doesn't add to a friend set — the threshold approach below
// surfaces strong signals without the user explicitly starring).
export function getEngagedCreators(): Set<string> {
  const out = new Set<string>(sessionStarred);
  // Heavy positive session-weight (>= 25) = "friend-equivalent" intent
  // even without an explicit star (e.g. multiple OYEs / plays in a
  // single session). Threshold tuned conservatively: a single play
  // gives +8, OYE on its parent track flows in via the same channel,
  // 25 ≈ 3 plays or 1 play + cross-surface taste match.
  for (const [creator, weight] of creatorWeights.entries()) {
    if (weight >= 25) out.add(creator);
  }
  return out;
}

// ── Scoring helpers ───────────────────────────────────────────────────────

const RECENCY_FULL_DAYS = 7;
const RECENCY_HALF_DAYS = 30;
const RECENCY_FADE_DAYS = 90;

function recencyScore(discoveredAt: string | undefined): number {
  if (!discoveredAt) return 0;
  const t = Date.parse(discoveredAt);
  if (!isFinite(t)) return 0;
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (ageDays <= RECENCY_FULL_DAYS) return 30;
  if (ageDays <= RECENCY_HALF_DAYS) return 30 - ((ageDays - RECENCY_FULL_DAYS) / (RECENCY_HALF_DAYS - RECENCY_FULL_DAYS)) * 18; // 30 → 12
  if (ageDays <= RECENCY_FADE_DAYS) return 12 - ((ageDays - RECENCY_HALF_DAYS) / (RECENCY_FADE_DAYS - RECENCY_HALF_DAYS)) * 12; // 12 → 0
  return 0;
}

function popularityBoost(views: number | undefined): number {
  const v = Math.max(0, views ?? 0);
  return Math.min(25, Math.log10(v + 10) * 6);
}

function reactionBoost(reactions: number | undefined): number {
  const r = Math.max(0, reactions ?? 0);
  return Math.min(15, Math.log10(r + 1) * 6);
}

// ── Public ranker ─────────────────────────────────────────────────────────

export interface RankContext {
  /** Lower-cased favorite artist names from getInsights(). */
  favoriteArtists: Set<string>;
  /** Lower-cased favorite moods/vibes from getInsights(). */
  favoriteMoods: Set<string>;
  /** How many slots to return (typically MOMENTS_PER_PAGE). */
  take: number;
  /** Hard cap for any single creator in the returned slice. */
  maxPerCreator: number;
  /** v858 — cross-surface seed. The currently-playing track's
   *  detected mode (e.g. "dance", "afrobeats") and parent artist.
   *  Moments matching either get a +35 / +20 boost so the feed
   *  drops near the vibe of what's playing in the player.
   *  This is the "vibe of the last song that was playing" Dash
   *  described as the natural entry point. */
  seedMode?: string;
  seedArtist?: string;
  seedTags?: string[];
}

interface ScoredMoment {
  moment: Moment;
  score: number;
  /** Creator key used for round-robin grouping. */
  creatorKey: string;
}

/**
 * Score one moment in isolation. Slice-local penalties (over-rep, dedup
 * tie-breaks) get applied during the round-robin assembly below.
 */
function scoreMoment(m: Moment, ctx: RankContext): number {
  let s = 0;

  // Cross-session taste affinity (oyoDJ insights).
  const artist = (m.parent_track_artist || '').toLowerCase();
  if (artist && ctx.favoriteArtists.has(artist)) s += 60;

  if (m.vibe_tags?.some(t => ctx.favoriteMoods.has(String(t).toLowerCase()))) {
    s += 30;
  }

  // v858 cross-surface seed — the vibe of what's currently playing
  // in the audio player should bias what shows up in Moments.
  if (ctx.seedArtist && artist === ctx.seedArtist.toLowerCase()) s += 20;
  if (ctx.seedMode) {
    const mLow = ctx.seedMode.toLowerCase();
    if ((m.content_type || '').toLowerCase() === mLow) s += 35;
    if (m.vibe_tags?.some(t => String(t).toLowerCase().includes(mLow))) s += 18;
  }
  if (ctx.seedTags?.length) {
    const seedSet = new Set(ctx.seedTags.map(t => t.toLowerCase()));
    if (m.vibe_tags?.some(t => seedSet.has(String(t).toLowerCase()))) s += 12;
    if (m.cultural_tags?.some(t => seedSet.has(String(t).toLowerCase()))) s += 12;
  }

  const creator = m.creator_username || m.creator_name || '';
  if (creator && sessionStarred.has(creator)) s += 25;
  if (creator) s += creatorWeights.get(creator) ?? 0;

  // v858 — last-N creator rhythm penalty. If the same creator has
  // appeared in the last 5 moments, drop their score so the immediate
  // scroll varies even when one creator is winning the global rank.
  if (creator && recentCreators.includes(creator)) {
    // Count occurrences for graduated penalty (-12 per appearance,
    // capped at -36 so we don't fully blacklist).
    const occurrences = recentCreators.filter(c => c === creator).length;
    s -= Math.min(36, occurrences * 12);
  }

  // Engagement priors
  s += popularityBoost(m.view_count);
  s += reactionBoost(m.voyo_reactions);

  // Recency
  s += recencyScore(m.discovered_at);

  // Session dedup (in-tab)
  if (sessionShown.has(m.id)) s -= 100;

  // v861 cross-session cooldown — penalize moments shown in the
  // last 48h across ANY session. Smaller penalty than session
  // dedup so a recently-seen moment can still surface if it
  // crushes everything else (catalog is small, sometimes there's
  // no other choice). Linearly tapers from -55 (just shown) to
  // -10 (24h ago) to 0 (48h ago).
  const cd = loadCooldown();
  const lastShown = cd.get(m.id);
  if (lastShown) {
    const ageMs = Date.now() - lastShown;
    if (ageMs < COOLDOWN_MS) {
      const decay = 1 - (ageMs / COOLDOWN_MS); // 1 → 0 across 48h
      s -= 55 * decay;
    }
  }

  // v842 jitter — breaks deterministic ordering between fetches.
  s += (Math.random() - 0.5) * 24;

  return s;
}

/**
 * Rank + dedup + diversify a freshly-fetched batch of moments.
 *
 * v861 algorithm (research-backed):
 *   1. Score every row (taste + seed + rhythm + cooldown + jitter).
 *   2. Sort high → low.
 *   3. EPSILON-GREEDY: reserve EPSILON of slots for random exploration
 *      from the candidate pool. The other (1-EPSILON) take the
 *      highest-scoring rows under the creator cap.
 *
 *   Backed by Sutton & Barto (RL) + Spotify's reported 70/30 affinity
 *   /adjacent split + TikTok's ~10-15% pure-exploration heuristic.
 *   Default ε=0.10 → ~2 of 20 slots are off-graph surprises.
 *   Surfaces the long tail of the catalog (we have 6,788 moments but
 *   without exploration, top-5% recirculates forever).
 *
 *   Hard creator cap STILL applies — a random pick can be vetoed if
 *   it busts the cap. The exploration slots prefer moments OUTSIDE
 *   the score top 30% so they're genuinely off-graph.
 */
const EPSILON = 0.10; // 10% exploration budget
const TASTE_FLOOR_RATIO = 0.7; // upper 70% of scored is "in-taste"
export function rankMoments(rows: Moment[], ctx: RankContext): Moment[] {
  if (!rows.length) return rows;

  const scored: ScoredMoment[] = rows.map(m => ({
    moment: m,
    score: scoreMoment(m, ctx),
    creatorKey: m.creator_username || m.creator_name || m.source_id || 'unknown',
  }));
  scored.sort((a, b) => b.score - a.score);

  const explorationSlots = Math.max(1, Math.round(ctx.take * EPSILON));
  const tasteSlots = ctx.take - explorationSlots;

  const out: Moment[] = [];
  const perCreator = new Map<string, number>();
  const taken = new Set<string>();

  // Pass 1: TASTE — fill (take - exploration) slots from top of sorted list.
  for (const s of scored) {
    if (out.length >= tasteSlots) break;
    const used = perCreator.get(s.creatorKey) ?? 0;
    if (used >= ctx.maxPerCreator) continue;
    out.push(s.moment);
    perCreator.set(s.creatorKey, used + 1);
    taken.add(s.moment.id);
  }

  // Pass 2: EXPLORATION — random picks from the LOWER portion of the
  // sorted list (below TASTE_FLOOR_RATIO). Off-graph by construction.
  // Cap still enforced; cooldown penalty already applied during scoring.
  const explorePool = scored.slice(Math.floor(scored.length * TASTE_FLOOR_RATIO));
  // Fisher-Yates shuffle (in-place on a slice copy)
  const shuffled = [...explorePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const s of shuffled) {
    if (out.length >= ctx.take) break;
    if (taken.has(s.moment.id)) continue;
    const used = perCreator.get(s.creatorKey) ?? 0;
    if (used >= ctx.maxPerCreator) continue;
    out.push(s.moment);
    perCreator.set(s.creatorKey, used + 1);
    taken.add(s.moment.id);
  }

  // Pass 3: SAFETY UNDERFILL — if exploration didn't fill (small
  // catalog), top up from the top sorted list under cap. Maintains
  // diversity but prevents <80% page fill on tiny pools.
  if (out.length < ctx.take) {
    for (const s of scored) {
      if (out.length >= ctx.take) break;
      if (taken.has(s.moment.id)) continue;
      const used = perCreator.get(s.creatorKey) ?? 0;
      if (used >= ctx.maxPerCreator) continue;
      out.push(s.moment);
      perCreator.set(s.creatorKey, used + 1);
      taken.add(s.moment.id);
    }
  }

  return out;
}
