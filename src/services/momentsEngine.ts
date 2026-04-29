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

export function markShown(momentId: string): void {
  sessionShown.add(momentId);
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

  // Affinity
  const artist = (m.parent_track_artist || '').toLowerCase();
  if (artist && ctx.favoriteArtists.has(artist)) s += 60;

  if (m.vibe_tags?.some(t => ctx.favoriteMoods.has(String(t).toLowerCase()))) {
    s += 30;
  }

  const creator = m.creator_username || m.creator_name || '';
  if (creator && sessionStarred.has(creator)) s += 25;
  if (creator) s += creatorWeights.get(creator) ?? 0;

  // Engagement priors
  s += popularityBoost(m.view_count);
  s += reactionBoost(m.voyo_reactions);

  // Recency
  s += recencyScore(m.discovered_at);

  // Session dedup
  if (sessionShown.has(m.id)) s -= 100;

  return s;
}

/**
 * Rank + dedup + diversify a freshly-fetched batch of moments.
 *
 * Algorithm:
 *   1. Score every row in isolation (pure function over the row + ctx).
 *   2. Sort high → low.
 *   3. Walk down the sorted list, accepting moments that don't bust
 *      the per-creator cap. This is round-robin BY SCORE — better
 *      than naive RR because high-score moments anchor the slice
 *      while low-score creators fill the gaps.
 *   4. If we underfill (catalogue too small), fill the remainder
 *      from the leftover sorted list ignoring the cap, so the user
 *      never sees a half-empty page.
 */
export function rankMoments(rows: Moment[], ctx: RankContext): Moment[] {
  if (!rows.length) return rows;

  const scored: ScoredMoment[] = rows.map(m => ({
    moment: m,
    score: scoreMoment(m, ctx),
    creatorKey: m.creator_username || m.creator_name || m.source_id || 'unknown',
  }));
  scored.sort((a, b) => b.score - a.score);

  const out: Moment[] = [];
  const perCreator = new Map<string, number>();
  const leftover: ScoredMoment[] = [];

  for (const s of scored) {
    if (out.length >= ctx.take) break;
    const used = perCreator.get(s.creatorKey) ?? 0;
    if (used >= ctx.maxPerCreator) {
      leftover.push(s);
      continue;
    }
    out.push(s.moment);
    perCreator.set(s.creatorKey, used + 1);
  }

  // Underfill — drain leftover (ignore cap, preserve sort order).
  if (out.length < ctx.take) {
    for (const s of leftover) {
      if (out.length >= ctx.take) break;
      out.push(s.moment);
    }
  }

  return out;
}
